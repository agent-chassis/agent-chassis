

import path from "node:path";
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeSync
} from "node:fs";

import { defaultRunGit, resolveWorktreeBinding } from "./worktree-substrate.mjs";
import { confirmedDead } from "./worktree-lease.mjs";

export const WORKTREE_REAPER_SCHEMA_VERSION = "worktree-reaper-audit.v1";

export const WORKTREE_REAPER_DIAGNOSTIC_CODES = Object.freeze({
  INVALID_ARG: "agent_launch.worktree_reaper.invalid_arg.v1",
  INVALID_REASON: "agent_launch.worktree_reaper.invalid_reason.v1",
  BINDING_INVALID: "agent_launch.worktree_reaper.binding_invalid.v1",
  PROTECTED_REF: "agent_launch.worktree_reaper.protected_ref.v1",
  PROTECTED_WORKTREE: "agent_launch.worktree_reaper.protected_worktree.v1",
  ALIVE_OR_INDETERMINATE: "agent_launch.worktree_reaper.alive_or_indeterminate.v1",
  WORKER_NOT_TERMINATED: "agent_launch.worktree_reaper.worker_not_terminated.v1",
  REVIEW_UNRESOLVED: "agent_launch.worktree_reaper.review_unresolved.v1",
  DIRTY_WORKTREE: "agent_launch.worktree_reaper.dirty_worktree.v1",
  MISSING_OR_MISMATCHED_BINDING: "agent_launch.worktree_reaper.missing_or_mismatched_binding.v1",
  AUDIT_CAPTURE_FAILED: "agent_launch.worktree_reaper.audit_capture_failed.v1",
  AUDIT_WRITE_FAILED: "agent_launch.worktree_reaper.audit_write_failed.v1",
  REAP_FAILED: "agent_launch.worktree_reaper.reap_failed.v1"
});

export const WORKTREE_REAPER_REASONS = Object.freeze(["unit-done", "cancelled", "operator-directed"]);
export const RETAINED_SLICE_CLEANUP_DISPOSITIONS = Object.freeze([
  "accepted-review",
  "orchestrator-cancelled",
  "orchestrator-revert"
]);

const PER_WK_BRANCH_RE = /^wk\/IN-\d{4}\/WK-\d{4}$/;
const PER_WK_WORKTREE_DIR_RE = /^wk-IN-\d{4}-WK-\d{4}$/;
const OID_RE = /^[0-9a-f]{40}$/;
const SLICE_BRANCH_RE = /^slice\/IN-\d{4}\/WK-\d{4}\/SLICE-\d{3}$/;
const SLICE_WORKTREE_DIR_RE = /^slice-IN-\d{4}-WK-\d{4}-SLICE-\d{3}$/;

export class WorktreeReaperError extends Error {
  constructor(message, { code, detail = null, cause = null } = {}) {
    super(message);
    this.name = "WorktreeReaperError";
    this.code = code ?? "agent_launch.worktree_reaper.error.v1";
    if (detail !== null) this.detail = detail;
    if (cause !== null) this.cause = cause;
  }
}

function fail(code, message, detail = null, cause = null) {
  throw new WorktreeReaperError(`agent-launch worktree-reaper: ${message}`, { code, detail, cause });
}

function assertAbsolutePath(p, label) {
  if (typeof p !== "string" || p.length === 0) {
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.INVALID_ARG, `${label} must be a non-empty string`);
  }
  if (!path.isAbsolute(p)) {
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.INVALID_ARG, `${label} must be absolute: ${p}`);
  }
  return p;
}

function assertReason(reason) {
  if (typeof reason !== "string" || !WORKTREE_REAPER_REASONS.includes(reason)) {
    fail(
      WORKTREE_REAPER_DIAGNOSTIC_CODES.INVALID_REASON,
      `reason must be one of ${WORKTREE_REAPER_REASONS.join("|")}, got: ${JSON.stringify(reason)}`
    );
  }
  return reason;
}

function realpathOrLexical(p) {
  try {
    return realpathSync(p);
  } catch {
    const parent = path.dirname(p);
    try {
      return path.join(realpathSync(parent), path.basename(p));
    } catch {
      return p;
    }
  }
}

function pathWithin(inner, outer) {
  if (inner === outer) return true;
  const prefix = outer.endsWith(path.sep) ? outer : `${outer}${path.sep}`;
  return inner.startsWith(prefix);
}

function assertRemovableTarget(mainRepo, branch, worktreePath) {
  if (typeof branch !== "string" || !PER_WK_BRANCH_RE.test(branch)) {
    fail(
      WORKTREE_REAPER_DIAGNOSTIC_CODES.PROTECTED_REF,
      `refusing to remove a non per-WK branch: ${JSON.stringify(branch)} ` +
        "(only ephemeral wk/IN-XXXX/WK-YYYY refs are removable; integration/IN-*, " +
        "refs/agent-launch/lease/*, and main are protected)",
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
        "(only ephemeral wk-IN-XXXX-WK-YYYY dirs are removable; the integration-IN-* " +
        "worktree persists, §8.3)",
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

export function worktreeReaperAuditDir(mainRepo) {
  const repo = assertAbsolutePath(mainRepo, "mainRepo");
  return path.join(repo, ".agent-launch", "worktree-reaper-audit");
}

export function defaultWriteAudit({ auditDir, line }) {
  mkdirSync(auditDir, { recursive: true });
  const filePath = path.join(auditDir, "reaper-audit.jsonl");
  let fd;
  try {
    fd = openSync(filePath, fsConstants.O_CREAT | fsConstants.O_WRONLY | fsConstants.O_APPEND, 0o600);
  } catch (err) {
    fail(
      WORKTREE_REAPER_DIAGNOSTIC_CODES.AUDIT_WRITE_FAILED,
      `failed to open reaper audit sink: ${filePath}`,
      { errno: err?.code ?? null },
      err
    );
  }
  try {
    writeSync(fd, line);
  } catch (err) {
    try { closeSync(fd); } catch {   }
    fail(
      WORKTREE_REAPER_DIAGNOSTIC_CODES.AUDIT_WRITE_FAILED,
      `failed to append to reaper audit sink: ${filePath}`,
      { errno: err?.code ?? null },
      err
    );
  }
  try { closeSync(fd); } catch {   }
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

function parseWorktreePorcelain(text) {
  const entries = [];
  let current = null;
  for (const line of String(text ?? "").split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current) entries.push(current);
      current = { path: line.slice("worktree ".length), branch: null, head: null };
    } else if (current && line.startsWith("branch refs/heads/")) {
      current.branch = line.slice("branch refs/heads/".length);
    } else if (current && line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    }
  }
  if (current) entries.push(current);
  return entries;
}

function priorExactSliceAudit(mainRepo, binding, disposition) {
  const file = path.join(worktreeReaperAuditDir(mainRepo), "reaper-audit.jsonl");
  let lines;
  try { lines = readFileSync(file, "utf8").trim().split("\n"); } catch { return null; }
  for (const line of lines.reverse()) {
    try {
      const record = JSON.parse(line);
      if (record.schema_version === WORKTREE_REAPER_SCHEMA_VERSION &&
          record.completed === true &&
          record.unit_address === binding.unit_address &&
          record.output_branch === binding.output_branch &&
          record.worktree_path === binding.worktree_path &&
          record.disposition === disposition) return record;
    } catch {   }
  }
  return null;
}

function priorExactSliceAttempt(mainRepo, binding, disposition, launchRef, runId, retryId) {
  const file = path.join(worktreeReaperAuditDir(mainRepo), "reaper-audit.jsonl");
  let lines;
  try { lines = readFileSync(file, "utf8").trim().split("\n"); } catch { return null; }
  for (const line of lines.reverse()) {
    try {
      const record = JSON.parse(line);
      if (record.schema_version === WORKTREE_REAPER_SCHEMA_VERSION &&
          record.completed === false &&
          record.unit_address === binding.unit_address &&
          record.output_branch === binding.output_branch &&
          record.worktree_path === binding.worktree_path &&
          record.disposition === disposition &&
          record.launch_ref === launchRef &&
          record.run_id === runId &&
          record.retry_id === retryId &&
          OID_RE.test(record.tip_sha)) return record;
    } catch {   }
  }
  return null;
}

export function releaseRetainedSlice({
  mainRepo,
  launchRef,
  runId,
  retryId = 0,
  disposition,
  workerTerminated,
  reviewResolved,
  identity = null,
  deps = {}
} = {}) {
  const runGit = deps.runGit ?? defaultRunGit;
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
  if (reviewResolved !== true) {
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.REVIEW_UNRESOLVED, "retain the exact slice while WK review is unresolved");
  }

  const binding = resolveBinding({ mainRepo: repo, launchRef, runId, retryId });
  if (!binding || typeof binding !== "object" ||
      typeof binding.unit_address !== "string" ||
      !/^IN-\d{4}\/WK-\d{4}\/SLICE-\d{3}$/u.test(binding.unit_address) ||
      !SLICE_BRANCH_RE.test(binding.output_branch) ||
      !path.isAbsolute(binding.worktree_path) ||
      !SLICE_WORKTREE_DIR_RE.test(path.basename(binding.worktree_path))) {
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.MISSING_OR_MISMATCHED_BINDING, "resolved binding is not an exact sparse slice binding");
  }
  const repoReal = realpathOrLexical(repo);
  const worktreeReal = realpathOrLexical(binding.worktree_path);
  if (pathWithin(worktreeReal, repoReal) || pathWithin(repoReal, worktreeReal)) {
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.PROTECTED_WORKTREE, "slice worktree overlaps the main checkout");
  }

  const listed = gitResultOrRefusal(runGit, repo, ["worktree", "list", "--porcelain"]);
  const entry = parseWorktreePorcelain(listed.stdout).find((candidate) => realpathOrLexical(candidate.path) === worktreeReal);
  const branchResult = runGit({ repo, args: ["rev-parse", "--verify", `refs/heads/${binding.output_branch}^{commit}`] });
  const pathPresent = existsSync(binding.worktree_path);
  const branchPresent = Boolean(branchResult && branchResult.ok === true);
  const priorAttempt = priorExactSliceAttempt(repo, binding, disposition, launchRef, runId, retryId);
  if (!pathPresent && !branchPresent && !entry) {
    const prior = priorExactSliceAudit(repo, binding, disposition);
    if (prior) return Object.freeze({ reaped: true, idempotent: true, ...prior, audit_dir: worktreeReaperAuditDir(repo) });
    if (priorAttempt) {
      const auditDir = worktreeReaperAuditDir(repo);
      const completed = Object.freeze({ ...priorAttempt, completed: true, reaped_at: clock() });
      writeAudit({ auditDir, record: completed, line: `${JSON.stringify(completed)}\n` });
      return Object.freeze({ reaped: true, idempotent: false, recovered_after_mutation: true, ...completed, audit_dir: auditDir });
    }
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.MISSING_OR_MISMATCHED_BINDING, "slice worktree/ref are missing without an exact prior cleanup audit");
  }
  const branchTip = branchPresent ? branchResult.stdout.trim() : null;
  const expectedTip = priorAttempt?.tip_sha ?? branchTip;
  if (typeof expectedTip !== "string" || !OID_RE.test(expectedTip)) {
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.MISSING_OR_MISMATCHED_BINDING, "verified slice ref does not resolve to an expected cleanup tip");
  }
  if (branchPresent && branchTip !== expectedTip) {
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.MISSING_OR_MISMATCHED_BINDING, "slice ref changed after the retained-tip binding was minted", {
      expected_tip: expectedTip,
      actual_tip: branchTip
    });
  }

  const retryAfterWorktreeRemoval = !pathPresent && !entry && branchPresent;
  if ((!retryAfterWorktreeRemoval && (!pathPresent || !entry)) ||
      !branchPresent ||
      (entry && (entry.branch !== binding.output_branch || entry.head !== expectedTip))) {
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.MISSING_OR_MISMATCHED_BINDING, "slice worktree/ref/binding association is missing or mismatched");
  }
  if (!retryAfterWorktreeRemoval) {
    const dirty = gitResultOrRefusal(runGit, binding.worktree_path, ["status", "--porcelain=v1", "--untracked-files=all"]);
    if (dirty.stdout.length > 0) {
      fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.DIRTY_WORKTREE, "refusing to remove a dirty retained slice", { status: dirty.stdout });
    }
  }

  const auditBase = Object.freeze({
    schema_version: WORKTREE_REAPER_SCHEMA_VERSION,
    unit_address: binding.unit_address,
    disposition,
    output_branch: binding.output_branch,
    worktree_path: binding.worktree_path,
    tip_sha: expectedTip,
    launch_ref: launchRef,
    run_id: runId,
    retry_id: retryId
  });
  const auditDir = worktreeReaperAuditDir(repo);

  const attemptRecord = Object.freeze({ ...auditBase, completed: false, started_at: clock() });
  writeAudit({ auditDir, record: attemptRecord, line: `${JSON.stringify(attemptRecord)}\n` });
  const remove = retryAfterWorktreeRemoval
    ? { ok: true, skipped: true }
    : runGit({ repo, args: ["worktree", "remove", binding.worktree_path] });

  const del = remove?.ok === true
    ? runGit({ repo, args: ["update-ref", "-d", `refs/heads/${binding.output_branch}`, expectedTip] })
    : null;
  if (!remove || remove.ok !== true || !del || del.ok !== true) {
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.REAP_FAILED, "exact-slice cleanup failed", {
      worktree_remove: remove?.stderr ?? remove?.error ?? remove?.status ?? null,
      branch_delete: del?.stderr ?? del?.error ?? del?.status ?? null,
      audit: attemptRecord
    });
  }

  const auditRecord = Object.freeze({ ...auditBase, completed: true, reaped_at: clock() });
  writeAudit({ auditDir, record: auditRecord, line: `${JSON.stringify(auditRecord)}\n` });
  return Object.freeze({ reaped: true, idempotent: false, ...auditRecord, audit_dir: auditDir });
}

function gitResultOrRefusal(runGit, repo, args) {
  const result = runGit({ repo, args });
  if (!result || result.ok !== true) {
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.MISSING_OR_MISMATCHED_BINDING, "could not verify exact slice binding", {
      args,
      stderr: result?.stderr ?? result?.error ?? result?.status ?? null
    });
  }
  return result;
}
