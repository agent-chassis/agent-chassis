

import path from "node:path";
import {
  CRASH_DURABLE_RESULTS,
  createSyncEffects,
  planLogicalAppend,
  runCrashDurablePlanSync
} from "@agent-chassis/wiki-core/src/lib/crash-durable-state.mjs";
import {
  closeSync,
  constants as fsConstants,
  mkdirSync,
  openSync,
  readFileSync,
  writeSync
} from "node:fs";

import { defaultRunGit, defaultRunGitAsync, resolveWorktreeBinding } from "./worktree-substrate.mjs";
import {
  observeExactWorktree,
  pathWithin,
  readExactWorktreeStatus,
  realpathOrLexical,
  removeExactWorktreePreservingRef,
  withPreparedExactRefLock
} from "./worktree-removal.mjs";
import { confirmedDead } from "./worktree-lease.mjs";
import { digestTrustedExactReviewEvidence } from "./workspace-agent-dispatch-run-receipt.mjs";
import { WORKTREE_REAPER_DIAGNOSTIC_CODES, WorktreeReaperError, assertAbsolutePath, fail } from "./worktree-reaper-diagnostics.mjs";

import { assertWkTerminalDisposition, defaultResolveWkTerminalDispositionProof } from "./worktree-reaper-wk-terminal-proof.mjs";

export { WORKTREE_REAPER_DIAGNOSTIC_CODES, WorktreeReaperError, defaultResolveWkTerminalDispositionProof };
export {
  WK_TERMINAL_DISPOSITION_PROOF_FIELDS,
  WK_TERMINAL_DISPOSITION_PROOF_INPUT_FIELDS,
  WK_TERMINAL_DISPOSITION_PROOF_SCHEMA_VERSION,
  WK_TERMINAL_DISPOSITION_VALUES,
  WK_TERMINAL_PROOF_DIAGNOSTIC_CODES,
  buildWkTerminalDispositionProof,
  computeWkTerminalDispositionProofDigest,
  computeWkTerminalDispositionReceiptDigest,
  validateWkTerminalDispositionProof,
  wkTerminalDispositionProofPath
} from "./worktree-reaper-wk-terminal-proof.mjs";

export const WORKTREE_REAPER_SCHEMA_VERSION = "worktree-reaper-audit.v1";

export const WORKTREE_REAPER_REASONS = Object.freeze(["unit-done", "cancelled", "operator-directed"]);
export const RETAINED_SLICE_CLEANUP_DISPOSITIONS = Object.freeze([
  "successful-integration",
  "accepted-review",
  "orchestrator-cancelled",
  "orchestrator-revert"
]);

const PER_WK_BRANCH_RE = /^wk\/IN-\d{4}\/WK-\d{4}$/;
const PER_WK_WORKTREE_DIR_RE = /^wk-IN-\d{4}-WK-\d{4}$/;
const LEGACY_INTEGRATION_BRANCH_RE = /^integration\/IN-\d{4}$/;
const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const SHA256_DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const SLICE_BRANCH_RE = /^slice\/IN-\d{4}\/WK-\d{4}\/SLICE-\d{3}$/;
const SLICE_WORKTREE_DIR_RE = /^slice-IN-\d{4}-WK-\d{4}-SLICE-\d{3}$/;

function assertReason(reason) {
  if (typeof reason !== "string" || !WORKTREE_REAPER_REASONS.includes(reason)) {
    fail(
      WORKTREE_REAPER_DIAGNOSTIC_CODES.INVALID_REASON,
      `reason must be one of ${WORKTREE_REAPER_REASONS.join("|")}, got: ${JSON.stringify(reason)}`
    );
  }
  return reason;
}

function assertRemovableTarget(mainRepo, branch, worktreePath) {
  if (typeof branch === "string" && LEGACY_INTEGRATION_BRANCH_RE.test(branch)) {
    fail(
      WORKTREE_REAPER_DIAGNOSTIC_CODES.BINDING_INVALID,
      `binding output_branch names a retired DEC-0170 integration ref: ${JSON.stringify(branch)}`,
      { branch }
    );
  }
  if (typeof branch !== "string" || !PER_WK_BRANCH_RE.test(branch)) {
    fail(
      WORKTREE_REAPER_DIAGNOSTIC_CODES.PROTECTED_REF,
      `refusing to remove a non per-WK branch: ${JSON.stringify(branch)} ` +
        "(only ephemeral wk/IN-XXXX/WK-YYYY refs are removable; " +
        "refs/agent-launch/lease/* and main are protected)",
      { branch }
    );
  }
  if (typeof worktreePath !== "string" || worktreePath.length === 0 || !path.isAbsolute(worktreePath)) {
    fail(
      WORKTREE_REAPER_DIAGNOSTIC_CODES.BINDING_INVALID,
      `binding worktree_path must be a non-empty absolute path, got: ${JSON.stringify(worktreePath)}`,
      { worktreePath }
    );
  }
  const base = path.basename(worktreePath);
  if (!PER_WK_WORKTREE_DIR_RE.test(base)) {
    fail(
      WORKTREE_REAPER_DIAGNOSTIC_CODES.PROTECTED_WORKTREE,
      `refusing to remove a non per-WK worktree dir: ${JSON.stringify(base)} ` +
        "(only ephemeral wk-IN-XXXX-WK-YYYY dirs are removable)",
      { worktreePath, base }
    );
  }

  const repoReal = realpathOrLexical(mainRepo);
  const worktreeReal = realpathOrLexical(worktreePath);
  if (pathWithin(worktreeReal, repoReal) || pathWithin(repoReal, worktreeReal)) {
    fail(
      WORKTREE_REAPER_DIAGNOSTIC_CODES.PROTECTED_WORKTREE,
      `refusing to remove a worktree inside/at the main repo working tree: ${worktreeReal} vs ${repoReal}`,
      { worktreeReal, repoReal }
    );
  }
}

export const WORKTREE_REAPER_AUDIT_MAX_IMAGE_BYTES = 16 * 1024 * 1024;

export function worktreeReaperAuditDir(mainRepo) {
  const repo = assertAbsolutePath(mainRepo, "mainRepo");
  return path.join(repo, ".agent-launch", "worktree-reaper-audit");
}

export function defaultWriteAudit({ auditDir, line }) {
  mkdirSync(auditDir, { recursive: true });
  const filePath = path.join(auditDir, "reaper-audit.jsonl");

  let priorBytes = "";
  try {
    priorBytes = readFileSync(filePath, "utf8");
  } catch (err) {
    if (err?.code !== "ENOENT") {
      fail(
        WORKTREE_REAPER_DIAGNOSTIC_CODES.AUDIT_WRITE_FAILED,
        `failed to read the reaper audit image: ${filePath}`,
        { errno: err?.code ?? null },
        err
      );
    }
  }

  const nextByteLength = Buffer.byteLength(priorBytes, "utf8") + Buffer.byteLength(line, "utf8");
  if (nextByteLength > WORKTREE_REAPER_AUDIT_MAX_IMAGE_BYTES) {

    fail(
      WORKTREE_REAPER_DIAGNOSTIC_CODES.AUDIT_WRITE_FAILED,
      `reaper audit image would exceed the supported ${WORKTREE_REAPER_AUDIT_MAX_IMAGE_BYTES}-byte envelope: ${filePath}`,
      {
        issue: "reaper_audit_image_envelope_exceeded",
        current_bytes: Buffer.byteLength(priorBytes, "utf8"),
        appended_bytes: Buffer.byteLength(line, "utf8"),
        max_bytes: WORKTREE_REAPER_AUDIT_MAX_IMAGE_BYTES
      }
    );
  }

  const published = runCrashDurablePlanSync(
    planLogicalAppend({
      targetPath: filePath,
      privatePath: `${filePath}.publish-${process.pid}.tmp`,
      priorBytes,
      appendedBytes: line
    }),
    createSyncEffects({ mode: 0o600 })
  );
  if (published.classification !== CRASH_DURABLE_RESULTS.PUBLISHED) {
    fail(
      WORKTREE_REAPER_DIAGNOSTIC_CODES.AUDIT_WRITE_FAILED,
      `failed to publish the reaper audit image: ${filePath}`,
      { errno: published.error?.code ?? null },
      published.error ?? undefined
    );
  }
  return filePath;
}

function captureBranchTip(runGit, mainRepo, branch) {
  const res = runGit({ repo: mainRepo, args: ["rev-parse", "--verify", `refs/heads/${branch}^{commit}`] });
  if (!res || res.ok !== true) {
    fail(
      WORKTREE_REAPER_DIAGNOSTIC_CODES.AUDIT_CAPTURE_FAILED,
      `could not capture pre-delete tip of ${branch} (refs/heads/${branch} does not resolve to a commit)`,
      { branch, stderr: res?.stderr ?? res?.error ?? null, status: res?.status ?? null }
    );
  }
  const sha = (res.stdout ?? "").trim();
  if (!OID_RE.test(sha)) {
    fail(
      WORKTREE_REAPER_DIAGNOSTIC_CODES.AUDIT_CAPTURE_FAILED,
      `pre-delete tip of ${branch} is not a 40-hex object id, got: ${JSON.stringify(sha)}`,
      { branch }
    );
  }
  return sha;
}

function branchExists(runGit, mainRepo, branch) {
  const res = runGit({ repo: mainRepo, args: ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`] });
  return Boolean(res && res.ok === true);
}

function removeWorktreeAndBranch(runGit, mainRepo, worktreePath, branch, auditRecord) {
  const failures = [];
  const remove = runGit({ repo: mainRepo, args: ["worktree", "remove", "--force", worktreePath] });
  if (!remove || remove.ok !== true) {
    failures.push({ step: "worktree remove --force", detail: remove?.stderr ?? remove?.error ?? remove?.status ?? null });
  }
  const prune = runGit({ repo: mainRepo, args: ["worktree", "prune"] });
  if (!prune || prune.ok !== true) {
    failures.push({ step: "worktree prune", detail: prune?.stderr ?? prune?.error ?? prune?.status ?? null });
  }

  if (branchExists(runGit, mainRepo, branch)) {
    const del = runGit({ repo: mainRepo, args: ["branch", "-D", branch] });
    if (!del || del.ok !== true) {
      failures.push({ step: "branch -D", detail: del?.stderr ?? del?.error ?? del?.status ?? null });
    }
  }
  if (failures.length > 0) {
    fail(
      WORKTREE_REAPER_DIAGNOSTIC_CODES.REAP_FAILED,
      "worktree/branch removal failed to fully complete; half-state remains and must be resolved by the operator " +
        "(the pre-delete tip is in the audit record and reflog-recoverable)",
      { worktreePath, branch, removalFailures: failures, audit: auditRecord }
    );
  }
}

export function releaseWorktree({
  mainRepo,
  launchRef,
  runId,
  retryId = 0,
  reason,
  identity = null,
  deps = {}
} = {}) {
  const runGit = deps.runGit ?? defaultRunGit;
  const writeAudit = deps.writeAudit ?? defaultWriteAudit;
  const resolveBinding = deps.resolveBinding ?? resolveWorktreeBinding;
  const isConfirmedDead = deps.confirmedDead ?? confirmedDead;
  const resolveProof = deps.resolveWkTerminalDispositionProof ?? defaultResolveWkTerminalDispositionProof;
  const clock = deps.clock ?? (() => new Date().toISOString());

  const repo = assertAbsolutePath(mainRepo, "mainRepo");
  assertReason(reason);

  const binding = resolveBinding({ mainRepo: repo, launchRef, runId, retryId });
  if (!binding || typeof binding !== "object") {
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.BINDING_INVALID, "resolved binding is not an object");
  }
  const outputBranch = binding.output_branch;
  const worktreePath = binding.worktree_path;

  assertRemovableTarget(repo, outputBranch, worktreePath);

  const dispositionProof = assertWkTerminalDisposition({
    mainRepo: repo,
    binding,
    runGit,
    resolveProof
  });

  if (identity !== null) {
    if (!isConfirmedDead(identity, deps.livenessDeps)) {
      fail(
        WORKTREE_REAPER_DIAGNOSTIC_CODES.ALIVE_OR_INDETERMINATE,
        "refusing removal: supplied identity is not confirmed dead (alive or indeterminate); " +
          "reaping is gated on a confirmed death when an identity is provided (fail closed)",
        { output_branch: outputBranch }
      );
    }
  }

  const tipSha = captureBranchTip(runGit, repo, outputBranch);
  const auditRecord = Object.freeze({
    schema_version: WORKTREE_REAPER_SCHEMA_VERSION,
    reason,
    initiative: binding.initiative ?? null,
    subject: binding.subject ?? null,
    wk_id: binding.wk_id ?? null,
    output_branch: outputBranch,
    worktree_path: worktreePath,
    tip_sha: tipSha,
    launch_ref: launchRef,
    run_id: runId,
    retry_id: retryId,
    liveness_checked: identity !== null,

    wk_terminal_disposition: dispositionProof,
    reaped_at: clock()
  });
  const auditDir = worktreeReaperAuditDir(repo);
  writeAudit({ auditDir, record: auditRecord, line: `${JSON.stringify(auditRecord)}\n` });

  removeWorktreeAndBranch(runGit, repo, worktreePath, outputBranch, auditRecord);

  return Object.freeze({
    reaped: true,
    ...auditRecord,
    audit_dir: auditDir
  });
}

function exactSliceAuditMatches({
  record,
  binding,
  disposition,
  launchRef,
  runId,
  retryId,
  expectedTip,
  worktreeIdentityDigest
}) {
  return record.schema_version === WORKTREE_REAPER_SCHEMA_VERSION &&
    record.unit_address === binding.unit_address &&
    record.output_branch === binding.output_branch &&
    record.worktree_path === binding.worktree_path &&
    record.disposition === disposition &&
    record.launch_ref === launchRef &&
    record.run_id === runId &&
    record.retry_id === retryId &&
    record.worktree_identity_digest === worktreeIdentityDigest &&
    record.tip_sha === expectedTip &&
    (disposition !== "successful-integration" || record.integrated_sha === expectedTip);
}

function priorExactSliceAudit(
  mainRepo,
  binding,
  disposition,
  launchRef,
  runId,
  retryId,
  expectedTip,
  worktreeIdentityDigest
) {
  const file = path.join(worktreeReaperAuditDir(mainRepo), "reaper-audit.jsonl");
  let lines;
  try { lines = readFileSync(file, "utf8").trim().split("\n"); } catch { return null; }
  for (const line of lines.reverse()) {
    try {
      const record = JSON.parse(line);
      if (record.completed === true && exactSliceAuditMatches({
        record,
        binding,
        disposition,
        launchRef,
        runId,
        retryId,
        expectedTip,
        worktreeIdentityDigest
      })) return record;
    } catch {   }
  }
  return null;
}

function priorExactSliceAttempt(
  mainRepo,
  binding,
  disposition,
  launchRef,
  runId,
  retryId,
  expectedTip,
  worktreeIdentityDigest
) {
  const file = path.join(worktreeReaperAuditDir(mainRepo), "reaper-audit.jsonl");
  let lines;
  try { lines = readFileSync(file, "utf8").trim().split("\n"); } catch { return null; }
  for (const line of lines.reverse()) {
    try {
      const record = JSON.parse(line);
      if (record.completed === false && exactSliceAuditMatches({
        record,
        binding,
        disposition,
        launchRef,
        runId,
        retryId,
        expectedTip,
        worktreeIdentityDigest
      })) return record;
    } catch {   }
  }
  return null;
}

export async function releaseRetainedSlice({
  mainRepo,
  launchRef,
  runId,
  retryId = 0,
  disposition,
  workerTerminated,
  integrationSucceeded,
  integratedSha,
  worktreeIdentityDigest,
  reviewResolved,
  identity = null,
  deps = {}
} = {}) {
  const runGit = deps.runGit ?? defaultRunGitAsync;
  const resolveBinding = deps.resolveBinding ?? resolveWorktreeBinding;
  const writeAudit = deps.writeAudit ?? defaultWriteAudit;
  const isConfirmedDead = deps.confirmedDead ?? confirmedDead;
  const clock = deps.clock ?? (() => new Date().toISOString());
  const repo = assertAbsolutePath(mainRepo, "mainRepo");

  if (!RETAINED_SLICE_CLEANUP_DISPOSITIONS.includes(disposition)) {
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.INVALID_REASON, "invalid exact-slice cleanup disposition");
  }
  if (workerTerminated !== true || (identity !== null && !isConfirmedDead(identity, deps.livenessDeps))) {
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.WORKER_NOT_TERMINATED, "exact-slice cleanup requires confirmed worker termination");
  }
  if (disposition === "successful-integration" && integrationSucceeded !== true) {
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.REVIEW_UNRESOLVED, "exact-slice integration cleanup requires successful integration");
  }
  if (disposition === "successful-integration" &&
      (typeof integratedSha !== "string" || !OID_RE.test(integratedSha) || /^0+$/u.test(integratedSha))) {
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.MISSING_OR_MISMATCHED_BINDING,
      "exact-slice integration cleanup requires the server-verified integrated SHA");
  }
  if (typeof worktreeIdentityDigest !== "string" || !SHA256_DIGEST_RE.test(worktreeIdentityDigest)) {
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.MISSING_OR_MISMATCHED_BINDING,
      "exact-slice cleanup requires the canonical retained worktree identity digest");
  }
  if (disposition !== "successful-integration" && reviewResolved !== true) {
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.REVIEW_UNRESOLVED, "retain the exact slice while WK review is unresolved");
  }

  const binding = resolveBinding({ mainRepo: repo, launchRef, runId, retryId });
  if (!binding || typeof binding !== "object" ||
      typeof binding.unit_address !== "string" ||
      !/^IN-\d{4}\/WK-\d{4}\/SLICE-\d{3}$/u.test(binding.unit_address) ||
      !SLICE_BRANCH_RE.test(binding.output_branch) ||
      !path.isAbsolute(binding.worktree_path) ||
      !SLICE_WORKTREE_DIR_RE.test(path.basename(binding.worktree_path))) {
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.MISSING_OR_MISMATCHED_BINDING, "resolved binding is not an exact slice binding");
  }
  const resolvedIdentityDigest = digestTrustedExactReviewEvidence(binding);
  if (resolvedIdentityDigest !== worktreeIdentityDigest) {
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.MISSING_OR_MISMATCHED_BINDING,
      "resolved exact-slice binding does not match the retained worktree identity digest", {
        expected_worktree_identity_digest: worktreeIdentityDigest,
        actual_worktree_identity_digest: resolvedIdentityDigest
      });
  }
  const repoReal = realpathOrLexical(repo);
  const worktreeReal = realpathOrLexical(binding.worktree_path);
  if (pathWithin(worktreeReal, repoReal) || pathWithin(repoReal, worktreeReal)) {
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.PROTECTED_WORKTREE, "slice worktree overlaps the main checkout");
  }

  const { entry, pathPresent, branchPresent, branchTip } = await observeExactWorktree({
    runGit,
    repo,
    worktreePath: binding.worktree_path,
    branch: binding.output_branch
  });

  const expectedTip = disposition === "successful-integration" ? integratedSha : branchTip;
  if (typeof expectedTip !== "string" || !OID_RE.test(expectedTip)) {
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.MISSING_OR_MISMATCHED_BINDING, "verified slice ref does not resolve to an expected cleanup tip");
  }
  const prior = priorExactSliceAudit(
    repo, binding, disposition, launchRef, runId, retryId, expectedTip, worktreeIdentityDigest
  );
  const priorAttempt = priorExactSliceAttempt(
    repo, binding, disposition, launchRef, runId, retryId, expectedTip, worktreeIdentityDigest
  );
  if (branchPresent && branchTip !== expectedTip) {
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.MISSING_OR_MISMATCHED_BINDING, "slice ref changed after the retained-tip binding was minted", {
      expected_tip: expectedTip,
      actual_tip: branchTip
    });
  }

  if (!pathPresent && !entry && branchPresent) {
    if (prior) {
      return await withPreparedExactRefLock({
        repo,
        ref: `refs/heads/${binding.output_branch}`,
        expectedSha: expectedTip,
        deps
      }, () => Object.freeze({
        reaped: true,
        idempotent: true,
        ...prior,
        audit_dir: worktreeReaperAuditDir(repo)
      }));
    }
    if (priorAttempt) {
      return await withPreparedExactRefLock({
        repo,
        ref: `refs/heads/${binding.output_branch}`,
        expectedSha: expectedTip,
        deps
      }, () => {
        const auditDir = worktreeReaperAuditDir(repo);
        const completed = Object.freeze({ ...priorAttempt, completed: true, reaped_at: clock() });
        writeAudit({ auditDir, record: completed, line: `${JSON.stringify(completed)}\n` });
        return Object.freeze({
          reaped: true,
          idempotent: false,
          recovered_after_mutation: true,
          ...completed,
          audit_dir: auditDir
        });
      });
    }
  }
  if (!pathPresent || !entry || !branchPresent ||
      (entry && (entry.branch !== binding.output_branch || entry.head !== expectedTip))) {
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.MISSING_OR_MISMATCHED_BINDING, "slice worktree/ref/binding association is missing or mismatched");
  }
  if (disposition !== "successful-integration") {
    const status = await readExactWorktreeStatus({ runGit, worktreePath: binding.worktree_path });
    if (status.length > 0) {
      fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.DIRTY_WORKTREE, "refusing to remove a dirty retained slice", { status });
    }
  }

  const auditBase = Object.freeze({
    schema_version: WORKTREE_REAPER_SCHEMA_VERSION,
    unit_address: binding.unit_address,
    disposition,
    output_branch: binding.output_branch,
    worktree_path: binding.worktree_path,
    tip_sha: expectedTip,
    ...(disposition === "successful-integration" ? { integrated_sha: expectedTip } : {}),
    launch_ref: launchRef,
    run_id: runId,
    retry_id: retryId,
    worktree_identity_digest: worktreeIdentityDigest
  });
  const auditDir = worktreeReaperAuditDir(repo);

  const attemptRecord = Object.freeze({ ...auditBase, completed: false, started_at: clock() });
  writeAudit({ auditDir, record: attemptRecord, line: `${JSON.stringify(attemptRecord)}\n` });

  await removeExactWorktreePreservingRef({
    runGit,
    repo,
    worktreePath: binding.worktree_path,
    branch: binding.output_branch,
    expectedTip,
    force: disposition === "successful-integration",
    audit: attemptRecord,
    deps
  });

  const auditRecord = Object.freeze({ ...auditBase, completed: true, reaped_at: clock() });
  writeAudit({ auditDir, record: auditRecord, line: `${JSON.stringify(auditRecord)}\n` });
  return Object.freeze({ reaped: true, idempotent: false, ...auditRecord, audit_dir: auditDir });
}
