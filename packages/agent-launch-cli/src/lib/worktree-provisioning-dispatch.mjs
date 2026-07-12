

import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  rmdirSync,
  rmSync,
  unlinkSync
} from "node:fs";
import { RUNTIME_BLOCKER_CODES } from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";

import {
  allocatePerWkWorktree as defaultAllocatePerWkWorktree,
  resolveWorktreeBinding as defaultResolveWorktreeBinding,
  perWkBranchRef as defaultPerWkBranchRef,
  integrationBranchRef as defaultIntegrationBranchRef,
  defaultRunGit,
  allocateExactUnitWorktree as defaultAllocateExactUnitWorktree,
  allocateSparseExactUnitWorktree as defaultAllocateSparseExactUnitWorktree,
  deriveExactUnitName,
  WORKTREE_SUBSTRATE_SCHEMA_VERSION,
  defaultWriteBindingFile,
  resolveWorktreeBinding
} from "./worktree-substrate.mjs";
import {
  resetWorktreeToIntegrationTip as defaultResetWorktreeToIntegrationTip
} from "./worktree-lease.mjs";
import { bindingFilePath } from "./worktree-substrate-identity.mjs";

export const WORKTREE_PROVISIONING_DISPATCH_SCHEMA_VERSION =
  "worktree-provisioning-dispatch.v1";

if (typeof RUNTIME_BLOCKER_CODES.MANAGED_WORKTREE_PROVISIONING_UNAVAILABLE !== "string") {
  throw new Error("WK-1471 managed_worktree_provisioning_unavailable capability interface is absent or incompatible");
}

export const DEFAULT_EXPECTED_ENVELOPE_FIELD = "expected";

export const WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES = Object.freeze({
  INVALID_ARG: "agent_launch.worktree_provisioning_dispatch.invalid_arg.v1",
  INVALID_SUBJECT: "agent_launch.worktree_provisioning_dispatch.invalid_subject.v1",

  INTEGRATION_BRANCH_MISSING:
    "agent_launch.worktree_provisioning_dispatch.integration_branch_missing.v1",

  INTEGRATION_BRANCH_UNBORN:
    "agent_launch.worktree_provisioning_dispatch.integration_branch_unborn.v1",

  WK_RECORD_UNREADABLE_IN_TREE:
    "agent_launch.worktree_provisioning_dispatch.wk_record_unreadable_in_tree.v1",

  EXPECTED_ENVELOPE_MISSING:
    "agent_launch.worktree_provisioning_dispatch.expected_envelope_missing.v1",

  RE_PROVISION_NOT_FAST_FORWARD:
    "agent_launch.worktree_provisioning_dispatch.re_provision_not_fast_forward.v1",

  BASE_SHA_RACED:
    "agent_launch.worktree_provisioning_dispatch.base_sha_raced.v1",
  GIT_FAILED: "agent_launch.worktree_provisioning_dispatch.git_failed.v1",
  ROOT_REFUSED: "agent_launch.worktree_provisioning_dispatch.root_refused.v1",
  DEPENDENCY_REFUSED: "agent_launch.worktree_provisioning_dispatch.dependency_refused.v1",
  BINDING_INCOMPLETE: RUNTIME_BLOCKER_CODES.MANAGED_WORKTREE_PROVISIONING_UNAVAILABLE,
  REISSUE_REFUSED: "agent_launch.worktree_provisioning_dispatch.reissue_refused.v1",
  ROLLBACK_FAILED: "agent_launch.worktree_provisioning_dispatch.rollback_failed.v1"
});

export const WORKTREE_PROVISIONING_ISOLATION_INVARIANT = Object.freeze({

  shared_git_non_worker_writable: true,

  worktree_pointer_file_non_worker_writable: true,

  trusted_committer_gitdir_server_side: true,

  content_inert_populate: true
});

export class WorktreeProvisioningDispatchError extends Error {
  constructor(message, { code, detail = null, cause = null } = {}) {
    super(message);
    this.name = "WorktreeProvisioningDispatchError";
    this.code = code ?? "agent_launch.worktree_provisioning_dispatch.error.v1";
    if (detail !== null) this.detail = detail;
    if (cause !== null) this.cause = cause;
  }
}

function fail(code, message, detail = null, cause = null) {
  throw new WorktreeProvisioningDispatchError(
    `agent-launch worktree-provisioning-dispatch: ${message}`,
    { code, detail, cause }
  );
}

const SUBJECT_RE = /^WK-\d{4}(#[A-Za-z0-9._-]+)?$/;
const WK_ID_RE = /^WK-\d{4}$/;
const INITIATIVE_ID_RE = /^IN-\d{4}$/;

function parseSubject(subject) {
  if (typeof subject !== "string" || !SUBJECT_RE.test(subject)) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.INVALID_SUBJECT,
      `subject must match ^WK-\\d{4}(#<slice>)?$, got: ${JSON.stringify(subject)}`
    );
  }
  const hashIdx = subject.indexOf("#");
  if (hashIdx === -1) return { wkId: subject, sliceId: null };
  return { wkId: subject.slice(0, hashIdx), sliceId: subject.slice(hashIdx + 1) };
}

function assertInitiativeId(initiative) {
  if (typeof initiative !== "string" || !INITIATIVE_ID_RE.test(initiative)) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.INVALID_ARG,
      `initiative must match ^IN-\\d{4}$, got: ${JSON.stringify(initiative)}`
    );
  }
  return initiative;
}

function assertAbsolutePath(p, label) {
  if (typeof p !== "string" || p.length === 0 || !path.isAbsolute(p)) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.INVALID_ARG,
      `${label} must be a non-empty absolute path, got: ${JSON.stringify(p)}`
    );
  }
  return p;
}

function gitOrThrow(runGit, repo, args, whatFailed, code = WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.GIT_FAILED) {
  const res = runGit({ repo, args });
  if (!res || res.ok !== true) {
    fail(
      code,
      `${whatFailed} (git ${args.join(" ")})`,
      {
        status: res?.status ?? null,
        signal: res?.signal ?? null,
        error: res?.error ?? null,
        stderr: res?.stderr ?? null
      }
    );
  }
  return res;
}

function integrationBranchExists(runGit, mainRepo, integrationRef) {
  const res = runGit({
    repo: mainRepo,
    args: ["show-ref", "--verify", "--quiet", `refs/heads/${integrationRef}`]
  });
  return Boolean(res && res.ok === true);
}

function resolveIntegrationTip(runGit, mainRepo, initiative, integrationBranchRefFn) {
  const integrationRef = integrationBranchRefFn(initiative);
  if (!integrationBranchExists(runGit, mainRepo, integrationRef)) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.INTEGRATION_BRANCH_MISSING,
      `integration branch ${integrationRef} does not exist; allocate it before provisioning (no auto-create)`,
      { integrationRef }
    );
  }
  const res = runGit({
    repo: mainRepo,
    args: ["rev-parse", "--verify", "--quiet", `${integrationRef}^{commit}`]
  });
  const sha = res && res.ok === true ? String(res.stdout ?? "").trim() : "";
  if (!sha) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.INTEGRATION_BRANCH_UNBORN,
      `integration branch ${integrationRef} has no resolvable commit (unborn/empty); cannot mint base_sha`,
      { integrationRef }
    );
  }
  return { integrationRef, baseSha: sha };
}

function isNonEmptyExpected(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;

  return true;
}

function readWkRecordFromTree(runGit, mainRepo, baseSha, wkId) {
  const recordPathInTree = `wiki/work-records/${wkId}.json`;
  const res = runGit({ repo: mainRepo, args: ["show", `${baseSha}:${recordPathInTree}`] });
  if (!res || res.ok !== true) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.WK_RECORD_UNREADABLE_IN_TREE,
      `WK record ${recordPathInTree} not present in base_sha tree ${baseSha}`,
      { baseSha, recordPathInTree, stderr: res?.stderr ?? null }
    );
  }
  try {
    return JSON.parse(res.stdout);
  } catch (err) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.WK_RECORD_UNREADABLE_IN_TREE,
      `WK record ${recordPathInTree} in base_sha tree ${baseSha} is not valid JSON`,
      { baseSha, recordPathInTree, message: err?.message ?? null },
      err
    );
  }
}

function resolveExpectedForSubject(record, sliceId, expectedField) {
  if (sliceId !== null) {
    const slices = Array.isArray(record?.slices) ? record.slices : [];
    const slice = slices.find((s) => s && s.id === sliceId);
    if (slice && Object.prototype.hasOwnProperty.call(slice, expectedField)) {
      return { value: slice[expectedField], source: `slices[${sliceId}].${expectedField}` };
    }
  }
  return { value: record?.[expectedField], source: expectedField };
}

export function assertExpectedEnvelopePresent({
  runGit = defaultRunGit,
  mainRepo,
  baseSha,
  subject,
  expectedEnvelopeField = DEFAULT_EXPECTED_ENVELOPE_FIELD
} = {}) {
  const repo = assertAbsolutePath(mainRepo, "mainRepo");
  const { wkId, sliceId } = parseSubject(subject);
  if (typeof baseSha !== "string" || baseSha.trim().length === 0) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.INVALID_ARG,
      `baseSha must be a non-empty string, got: ${JSON.stringify(baseSha)}`
    );
  }
  const record = readWkRecordFromTree(runGit, repo, baseSha, wkId);
  const { value, source } = resolveExpectedForSubject(record, sliceId, expectedEnvelopeField);
  if (!isNonEmptyExpected(value)) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.EXPECTED_ENVELOPE_MISSING,
      `refusing to provision / mint base_sha: WK record for ${subject} carries no non-empty '${source}' ` +
        `as-of base_sha ${baseSha}; base_sha may be minted only AFTER the expected-envelope is committed ` +
        "(WK-1432 is the sole ordering guarantor)",
      { subject, baseSha, expectedField: expectedEnvelopeField, source }
    );
  }
  return Object.freeze({ present: true, baseSha, source });
}

function resolveRefTip(runGit, mainRepo, ref) {
  const res = runGit({
    repo: mainRepo,
    args: ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]
  });
  const sha = res && res.ok === true ? String(res.stdout ?? "").trim() : "";
  return sha || null;
}

function assertFastForwardDescendant(runGit, mainRepo, currentWkTip, candidateBaseSha, detail) {
  if (currentWkTip === candidateBaseSha) return;
  const res = runGit({
    repo: mainRepo,
    args: ["merge-base", "--is-ancestor", currentWkTip, candidateBaseSha]
  });
  if (!res || res.ok !== true) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.RE_PROVISION_NOT_FAST_FORWARD,
      `refusing re-provision: recomputed base_sha ${candidateBaseSha} is not a fast-forward descendant of the ` +
        `current per-WK ref tip ${currentWkTip}; a reset would orphan un-integrated WK commits`,
      { ...detail, currentWkTip, candidateBaseSha }
    );
  }
}

export function provisionWorktreeAtDispatch({
  mainRepo,
  initiative,
  subject,
  launchRef,
  runId,
  retryId = 0,
  worktreeRoot,
  priorIdentity = null,
  livenessDeps,
  expectedEnvelopeField = DEFAULT_EXPECTED_ENVELOPE_FIELD,
  deps = {}
} = {}) {
  const runGit = deps.runGit ?? defaultRunGit;
  const allocatePerWk = deps.allocatePerWkWorktree ?? defaultAllocatePerWkWorktree;
  const resolveBinding = deps.resolveWorktreeBinding ?? defaultResolveWorktreeBinding;
  const resetWorktree = deps.resetWorktreeToIntegrationTip ?? defaultResetWorktreeToIntegrationTip;
  const perWkBranchRefFn = deps.perWkBranchRef ?? defaultPerWkBranchRef;
  const integrationBranchRefFn = deps.integrationBranchRef ?? defaultIntegrationBranchRef;

  const repo = assertAbsolutePath(mainRepo, "mainRepo");
  assertInitiativeId(initiative);
  const { wkId } = parseSubject(subject);
  if (!Number.isInteger(retryId) || retryId < 0) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.INVALID_ARG,
      `retryId must be a non-negative integer, got: ${JSON.stringify(retryId)}`
    );
  }

  if (retryId === 0) {
    return provisionFirstAttempt({
      repo,
      initiative,
      subject,
      launchRef,
      runId,
      worktreeRoot,
      expectedEnvelopeField,
      runGit,
      allocatePerWk,
      integrationBranchRefFn
    });
  }

  return reProvision({
    repo,
    initiative,
    subject,
    wkId,
    launchRef,
    runId,
    retryId,
    priorIdentity,
    livenessDeps,
    expectedEnvelopeField,
    runGit,
    resolveBinding,
    resetWorktree,
    perWkBranchRefFn,
    integrationBranchRefFn
  });
}

function provisionFirstAttempt({
  repo,
  initiative,
  subject,
  launchRef,
  runId,
  worktreeRoot,
  expectedEnvelopeField,
  runGit,
  allocatePerWk,
  integrationBranchRefFn
}) {
  assertAbsolutePath(worktreeRoot, "worktreeRoot");

  const { integrationRef, baseSha: gatedBaseSha } = resolveIntegrationTip(
    runGit,
    repo,
    initiative,
    integrationBranchRefFn
  );

  assertExpectedEnvelopePresent({
    runGit,
    mainRepo: repo,
    baseSha: gatedBaseSha,
    subject,
    expectedEnvelopeField
  });

  const binding = allocatePerWk({
    mainRepo: repo,
    initiative,
    subject,
    launchRef,
    runId,
    retryId: 0,
    worktreeRoot,
    deps: { runGit }
  });

  if (binding.base_sha !== gatedBaseSha) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BASE_SHA_RACED,
      `integration tip advanced between the expected-presence gate (${gatedBaseSha}) and allocation ` +
        `(${binding.base_sha}); the minted base_sha was not gated — re-run provisioning`,
      { integrationRef, gatedBaseSha, mintedBaseSha: binding.base_sha }
    );
  }

  return freezeProvisionResult({
    repo,
    mode: "first-attempt",
    initiative,
    subject,
    binding,
    integrationRef,
    baseSha: binding.base_sha,
    expectedEnvelopeField
  });
}

function reProvision({
  repo,
  initiative,
  subject,
  wkId,
  launchRef,
  runId,
  retryId,
  priorIdentity,
  livenessDeps,
  expectedEnvelopeField,
  runGit,
  resolveBinding,
  resetWorktree,
  perWkBranchRefFn,
  integrationBranchRefFn
}) {

  const existing = resolveBinding({ mainRepo: repo, launchRef, runId, retryId: 0 });
  const outputBranch = existing.output_branch ?? perWkBranchRefFn(initiative, wkId);

  const { integrationRef, baseSha: candidateBaseSha } = resolveIntegrationTip(
    runGit,
    repo,
    initiative,
    integrationBranchRefFn
  );

  const currentWkTip = resolveRefTip(runGit, repo, outputBranch);
  if (currentWkTip !== null) {
    assertFastForwardDescendant(runGit, repo, currentWkTip, candidateBaseSha, {
      outputBranch,
      integrationRef
    });
  }

  assertExpectedEnvelopePresent({
    runGit,
    mainRepo: repo,
    baseSha: candidateBaseSha,
    subject,
    expectedEnvelopeField
  });

  const reset = resetWorktree({
    mainRepo: repo,
    launchRef,
    runId,
    retryId: 0,
    priorIdentity,
    ...(livenessDeps ? { deps: livenessDeps } : {}),
    runGit
  });

  if (reset.reset_to_sha !== candidateBaseSha) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BASE_SHA_RACED,
      `integration tip advanced between the expected-presence gate (${candidateBaseSha}) and the reset ` +
        `(${reset.reset_to_sha}); the re-provisioned base_sha was not gated — re-run provisioning`,
      { integrationRef, gatedBaseSha: candidateBaseSha, resetToSha: reset.reset_to_sha }
    );
  }

  const binding = {
    output_branch: outputBranch,
    worktree_path: existing.worktree_path ?? reset.worktree_path,
    write_scope: existing.write_scope ?? [],
    base_sha: reset.reset_to_sha,
    base_ref: existing.base_ref ?? integrationRef
  };

  return freezeProvisionResult({
    repo,
    mode: "re-provision",
    initiative,
    subject,
    binding,
    integrationRef,
    baseSha: binding.base_sha,
    expectedEnvelopeField,
    extra: {
      retry_id: retryId,
      prior_wk_tip: currentWkTip,
      reset_to_sha: reset.reset_to_sha,
      liveness: reset.liveness ?? null
    }
  });
}

function provisionedWorktreeGitIdentity({ repo, binding }) {
  const worktreePath = assertAbsolutePath(binding.worktree_path, "binding.worktree_path");
  const mainGitDir = path.join(repo, ".git");
  const gitDir = path.join(mainGitDir, "worktrees", path.basename(worktreePath));
  const gitPointerFile = path.join(worktreePath, ".git");

  return Object.freeze({
    schemaVersion: "provisioned-worktree-git-identity.v1",
    schema_version: "provisioned-worktree-git-identity.v1",
    worktreePath,
    worktree_path: worktreePath,
    gitDir,
    worktreeGitDir: gitDir,
    worktree_git_dir: gitDir,
    mainGitDir,
    sharedGitDir: mainGitDir,
    shared_git_dir: mainGitDir,
    gitPointerFile,
    worktreeGitPointerFile: gitPointerFile,
    worktree_git_pointer_file: gitPointerFile
  });
}

function freezeProvisionResult({
  repo,
  mode,
  initiative,
  subject,
  binding,
  integrationRef,
  baseSha,
  expectedEnvelopeField,
  extra = {}
}) {
  const gitIdentity = provisionedWorktreeGitIdentity({
    repo: assertAbsolutePath(repo, "mainRepo"),
    binding
  });
  return Object.freeze({
    schema_version: WORKTREE_PROVISIONING_DISPATCH_SCHEMA_VERSION,
    mode,
    initiative,
    subject,

    output_branch: binding.output_branch,
    worktree_path: binding.worktree_path,
    write_scope: Object.freeze([...(binding.write_scope ?? [])]),
    base_sha: baseSha,
    base_ref: binding.base_ref ?? integrationRef,

    expected_envelope_present: true,
    expected_envelope_field: expectedEnvelopeField,

    isolation_invariant: WORKTREE_PROVISIONING_ISOLATION_INVARIANT,
    provisionedWorktreeGitIdentity: gitIdentity,
    provisioned_worktree_git_identity: gitIdentity,
    worktreePath: gitIdentity.worktreePath,
    gitDir: gitIdentity.gitDir,
    worktree_git_dir: gitIdentity.worktree_git_dir,
    mainGitDir: gitIdentity.mainGitDir,
    shared_git_dir: gitIdentity.shared_git_dir,
    gitPointerFile: gitIdentity.gitPointerFile,
    worktree_git_pointer_file: gitIdentity.worktree_git_pointer_file,
    ...extra
  });
}

export const MANAGED_WORKTREE_BINDING_SCHEMA_VERSION =
  "managed-worktree-binding.v1";

function pathEntryExists(candidate) {
  try { lstatSync(candidate); return true; } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function canonicalizeOwnedPath(candidate, label, { mustExist = false } = {}) {
  const absolute = path.resolve(assertAbsolutePath(candidate, label));
  const parsed = path.parse(absolute);
  let cursor = parsed.root;
  for (const component of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, component);
    if (!pathEntryExists(cursor)) break;
    const stat = lstatSync(cursor);
    if (stat.isSymbolicLink()) {
      fail(
        WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.ROOT_REFUSED,
        `${label} contains a symlink component`,
        { label, path: absolute, component: cursor }
      );
    }
  }
  if (mustExist && !pathEntryExists(absolute)) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.ROOT_REFUSED,
      `${label} does not exist`,
      { label, path: absolute }
    );
  }
  if (existsSync(absolute)) return realpathSync(absolute);
  let ancestor = path.dirname(absolute);
  const suffix = [path.basename(absolute)];
  while (!existsSync(ancestor)) {
    suffix.unshift(path.basename(ancestor));
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  return path.join(realpathSync(ancestor), ...suffix);
}

function assertDistinctOwnedRoots(roots) {
  const entries = Object.entries(roots);
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const [leftName, left] = entries[i];
      const [rightName, right] = entries[j];
      if (left === right || left.startsWith(`${right}${path.sep}`) || right.startsWith(`${left}${path.sep}`)) {
        fail(
          WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.ROOT_REFUSED,
          "launcher-owned roots alias, collide, or contain one another",
          { left: { name: leftName, path: left }, right: { name: rightName, path: right } }
        );
      }
    }
  }
}

function bindingIdentity(runId, kind) {
  return `${runId}.${kind}`;
}

function removeBindingFile(repo, launchRef, runId, retryId, failures) {
  const filePath = bindingFilePath(repo, launchRef, runId, retryId);
  if (!existsSync(filePath)) return;
  try { unlinkSync(filePath); } catch (error) {
    failures.push({ stage: "binding", path: filePath, message: error?.message ?? String(error) });
  }
}

function compensateManagedAllocation({ runGit, repo, launchRef, runId, retryId, bindings, cachePath, cacheCreated, createdRoots = [], cause }) {
  const failures = [];
  if (cacheCreated && existsSync(cachePath)) {
    try { rmSync(cachePath, { recursive: true, force: false }); } catch (error) {
      failures.push({ stage: "cache", path: cachePath, message: error?.message ?? String(error) });
    }
  }
  for (const [kind, binding] of [["slice", bindings.slice], ["wk", bindings.wk]]) {
    if (!binding) continue;
    removeBindingFile(repo, launchRef, bindingIdentity(runId, kind), retryId, failures);
    const remove = runGit({ repo, args: ["worktree", "remove", "--force", binding.worktree_path] });
    if (!remove || remove.ok !== true) failures.push({ stage: `${kind}_worktree`, detail: remove ?? null });
    const branch = runGit({ repo, args: ["branch", "-D", binding.output_branch] });
    if (!branch || branch.ok !== true) failures.push({ stage: `${kind}_ref`, detail: branch ?? null });
  }
  for (const root of createdRoots) {
    if (!existsSync(root)) continue;
    try { rmdirSync(root); } catch (error) {
      failures.push({ stage: "root", path: root, message: error?.message ?? String(error) });
    }
  }
  if (failures.length > 0) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.ROLLBACK_FAILED,
      "managed allocation rollback did not fully compensate",
      { failures, originalError: cause?.message ?? String(cause) },
      cause
    );
  }
}

const COMPLETE_EXACT_BINDING_FIELDS = Object.freeze([
  "schema_version", "launch_ref", "run_id", "retry_id", "unit_address",
  "initiative", "record_id", "slice_id", "base_ref", "base_sha",
  "output_branch", "worktree_path", "write_scope", "write_scope_source"
]);
const COMPLETE_SPARSE_BINDING_FIELDS = Object.freeze([
  ...COMPLETE_EXACT_BINDING_FIELDS, "cone_dirs", "index_sparse"
]);

function isPathWithinRoot(candidate, root) {
  return candidate !== root && candidate.startsWith(`${root}${path.sep}`);
}

function canonicalizeContainedPath(candidate, label, root, { mustExist = true } = {}) {
  const canonical = canonicalizeOwnedPath(candidate, label, { mustExist });
  if (!isPathWithinRoot(canonical, root)) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
      `${label} escapes its launcher-owned canonical root`,
      { label, path: canonical, root }
    );
  }
  return canonical;
}

function assertCompleteManagedBinding({
  binding,
  repo,
  unitAddress,
  launchRef,
  runId,
  retryId,
  worktreeRoot,
  sparse,
  runGit = defaultRunGit,
  allowAdvancedTip = false
}) {
  const required = sparse ? COMPLETE_SPARSE_BINDING_FIELDS : COMPLETE_EXACT_BINDING_FIELDS;
  for (const field of required) {
    const nullableFullWkSliceId = !sparse && field === "slice_id";
    if ((!nullableFullWkSliceId && binding?.[field] === null) || binding?.[field] === undefined ||
        (typeof binding[field] === "string" && binding[field].length === 0) ||
        ((field === "write_scope" || field === "cone_dirs") && !Array.isArray(binding[field]))) {
      fail(
        WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
        `exact-unit binding is incomplete at ${field}`,
        { field, unitAddress }
      );
    }
  }
  const expectedName = deriveExactUnitName({ unitAddress, worktreeRoot });
  const expectedSliceId = expectedName.kind === "slice" ? expectedName.slice_id : null;
  const expectedBaseRef = expectedName.kind === "slice"
    ? `wk/${expectedName.initiative}/${expectedName.wk_id}`
    : "main";
  const mismatches = {
    schema_version: [binding.schema_version, WORKTREE_SUBSTRATE_SCHEMA_VERSION],
    unit_address: [binding.unit_address, unitAddress],
    launch_ref: [binding.launch_ref, launchRef],
    run_id: [binding.run_id, runId],
    retry_id: [binding.retry_id, retryId],
    initiative: [binding.initiative, expectedName.initiative],
    record_id: [binding.record_id, expectedName.wk_id],
    slice_id: [binding.slice_id ?? null, expectedSliceId],
    base_ref: [binding.base_ref, expectedBaseRef],
    output_branch: [binding.output_branch, expectedName.output_branch],
    worktree_path: [path.resolve(binding.worktree_path), path.resolve(expectedName.worktree_path)],
    write_scope_source: [
      binding.write_scope_source,
      `wiki/work-records/${expectedName.wk_id}.json${expectedSliceId ? `#${expectedSliceId}` : ""}`
    ]
  };
  const mismatch = Object.entries(mismatches).find(([, [actual, expected]]) => actual !== expected);
  if (mismatch) {
    const [field, [actual, expected]] = mismatch;
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
      `exact-unit binding does not match the selected unit at ${field}`,
      { field, expected, actual: actual ?? null }
    );
  }
  if (sparse && binding.index_sparse !== false) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
      "sparse binding must pin index_sparse=false",
      { actual: binding.index_sparse ?? null }
    );
  }
  if (!Number.isInteger(binding.retry_id) || binding.retry_id < 0 ||
      binding.write_scope.some((entry) => typeof entry !== "string" || entry.length === 0) ||
      (sparse && (binding.cone_dirs.length === 0 || binding.cone_dirs.some((entry) => typeof entry !== "string" || entry.length === 0)))) {
    fail(WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE, "exact-unit binding carries invalid retry or scope fields");
  }
  const worktree = canonicalizeContainedPath(binding.worktree_path, "binding.worktree_path", worktreeRoot);
  if (worktree === repo || worktree.startsWith(`${repo}${path.sep}`)) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
      "managed binding points at the main checkout",
      { repo, worktree }
    );
  }
  const head = runGit({ repo: worktree, args: ["rev-parse", "--verify", "HEAD^{commit}"] });
  const ref = runGit({ repo, args: ["rev-parse", "--verify", `${binding.output_branch}^{commit}`] });
  const headSha = head?.ok === true ? String(head.stdout ?? "").trim() : "";
  const refSha = ref?.ok === true ? String(ref.stdout ?? "").trim() : "";
  if (!headSha || headSha !== refSha || (!allowAdvancedTip && headSha !== binding.base_sha)) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
      "exact-unit worktree HEAD, bound ref, and commit base do not match",
      { head: headSha || null, ref: refSha || null, base_sha: binding.base_sha ?? null }
    );
  }
}

function freezeManagedResult({ initiative, wkId, sliceId, wkBinding, sliceBinding, roots, cachePath, runAuthority, retryId }) {
  const dependencySource = canonicalizeOwnedPath(roots.sharedDependencyRoot, "sharedDependencyRoot", { mustExist: true });
  const dependencyTarget = canonicalizeContainedPath(
    path.join(sliceBinding.worktree_path, "node_modules"),
    "dependencyMountTarget",
    roots.worktreeRoot,
    { mustExist: false }
  );
  const canonicalCachePath = canonicalizeContainedPath(cachePath, "perWkCachePath", roots.cacheRoot);
  const dependencyMount = Object.freeze({
    source: dependencySource,
    target: dependencyTarget,
    mode: "read_only"
  });
  return Object.freeze({
    schema_version: MANAGED_WORKTREE_BINDING_SCHEMA_VERSION,
    complete: true,
    initiative,
    record_id: wkId,
    slice_id: sliceId,
    unit_address: `${initiative}/${wkId}/${sliceId}`,
    retry_id: retryId,
    run_authority: runAuthority,
    wk_binding: Object.freeze({ ...wkBinding }),
    slice_binding: Object.freeze({ ...sliceBinding }),
    worktree_path: sliceBinding.worktree_path,
    output_branch: sliceBinding.output_branch,
    base_ref: sliceBinding.base_ref,
    base_sha: sliceBinding.base_sha,
    write_scope: Object.freeze([...(sliceBinding.write_scope ?? [])]),
    cone_dirs: Object.freeze([...(sliceBinding.cone_dirs ?? [])]),
    index_sparse: sliceBinding.index_sparse,
    validation_worktree_path: wkBinding.worktree_path,
    dependency_mount: dependencyMount,
    cache: Object.freeze({ path: canonicalCachePath, mode: "per_wk_writable" }),
    shared_git_exposed: false
  });
}

export function assertCompleteManagedProvisioningResult({
  provisioning,
  mainRepo,
  initiative,
  subject,
  launchRef,
  runId,
  retryId,
  worktreeRoot,
  sharedDependencyRoot,
  cacheRoot
} = {}) {
  const repo = canonicalizeOwnedPath(mainRepo, "mainRepo", { mustExist: true });
  const parsed = parseSubject(subject);
  if (parsed.sliceId === null) {
    fail(WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE, "complete managed result requires an exact slice subject");
  }
  const roots = Object.freeze({
    worktreeRoot: canonicalizeOwnedPath(worktreeRoot, "worktreeRoot", { mustExist: true }),
    sharedDependencyRoot: canonicalizeOwnedPath(sharedDependencyRoot, "sharedDependencyRoot", { mustExist: true }),
    cacheRoot: canonicalizeOwnedPath(cacheRoot, "cacheRoot", { mustExist: true })
  });
  assertDistinctOwnedRoots({ mainRepo: repo, ...roots });
  const unitAddress = `${initiative}/${parsed.wkId}/${parsed.sliceId}`;
  const requiredTopLevel = [
    "schema_version", "initiative", "record_id", "slice_id", "unit_address",
    "retry_id", "run_authority", "wk_binding", "slice_binding", "worktree_path",
    "output_branch", "base_ref", "base_sha", "write_scope", "cone_dirs",
    "index_sparse", "validation_worktree_path", "dependency_mount", "cache",
    "shared_git_exposed"
  ];
  const missing = requiredTopLevel.find((field) => provisioning?.[field] === null || provisioning?.[field] === undefined);
  if (provisioning?.complete !== true || missing) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
      `managed provisioning result is partial${missing ? ` at ${missing}` : ""}`,
      { field: missing ?? "complete" }
    );
  }
  if (provisioning.schema_version !== MANAGED_WORKTREE_BINDING_SCHEMA_VERSION ||
      provisioning.initiative !== initiative || provisioning.record_id !== parsed.wkId ||
      provisioning.slice_id !== parsed.sliceId || provisioning.unit_address !== unitAddress ||
      provisioning.retry_id !== retryId || typeof provisioning.run_authority !== "string" ||
      provisioning.run_authority.length === 0) {
    fail(WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE, "managed provisioning result identity is mismatched");
  }
  assertCompleteManagedBinding({
    binding: provisioning.wk_binding, repo, unitAddress: `${initiative}/${parsed.wkId}`,
    launchRef, runId: bindingIdentity(runId, "wk"), retryId,
    worktreeRoot: roots.worktreeRoot, sparse: false
  });
  assertCompleteManagedBinding({
    binding: provisioning.slice_binding, repo, unitAddress, launchRef,
    runId: bindingIdentity(runId, "slice"), retryId,
    worktreeRoot: roots.worktreeRoot, sparse: true
  });
  const slice = provisioning.slice_binding;
  const mirroredFields = ["worktree_path", "output_branch", "base_ref", "base_sha", "index_sparse"];
  const mirroredMismatch = mirroredFields.find((field) => provisioning[field] !== slice[field]);
  if (mirroredMismatch ||
      JSON.stringify(provisioning.write_scope) !== JSON.stringify(slice.write_scope) ||
      JSON.stringify(provisioning.cone_dirs) !== JSON.stringify(slice.cone_dirs) ||
      provisioning.validation_worktree_path !== provisioning.wk_binding.worktree_path ||
      provisioning.shared_git_exposed !== false) {
    fail(WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE, "managed provisioning result aliases do not exactly mirror the selected sparse binding");
  }
  const dependencySource = canonicalizeOwnedPath(provisioning.dependency_mount?.source, "dependencyMountSource", { mustExist: true });
  const dependencyTarget = canonicalizeContainedPath(
    provisioning.dependency_mount?.target,
    "dependencyMountTarget",
    roots.worktreeRoot,
    { mustExist: false }
  );
  const cachePath = canonicalizeContainedPath(provisioning.cache?.path, "cache.path", roots.cacheRoot);
  if (dependencySource !== roots.sharedDependencyRoot ||
      dependencyTarget !== path.join(slice.worktree_path, "node_modules") ||
      provisioning.dependency_mount?.mode !== "read_only" ||
      cachePath !== path.join(roots.cacheRoot, parsed.wkId) ||
      provisioning.cache?.mode !== "per_wk_writable") {
    fail(WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE, "dependency or cache binding is aliased, escaped, or mismatched");
  }
  return provisioning;
}

function reissueManagedWorktrees({ repo, initiative, wkId, sliceId, launchRef, runId, retryId, priorIdentity, roots, deps }) {
  const retainedLaunchRef = priorIdentity?.launchRef ?? priorIdentity?.launch_ref ?? priorIdentity?.monitorHandle ?? priorIdentity?.monitor_handle;
  const retainedRunId = priorIdentity?.runId ?? priorIdentity?.run_id;
  const retainedRetryId = priorIdentity?.retryId ?? priorIdentity?.retry_id ?? 0;
  if (typeof retainedLaunchRef !== "string" || retainedLaunchRef.length === 0 ||
      typeof retainedRunId !== "string" || retainedRunId.length === 0 ||
      !Number.isInteger(retainedRetryId) || retainedRetryId < 0 || retainedRunId === runId) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.REISSUE_REFUSED,
      "same-slice reissue requires a distinct fresh run identity and an exact retained binding identity"
    );
  }
  if (typeof deps.confirmPriorWorkerTerminated !== "function" || deps.confirmPriorWorkerTerminated({
    launchRef, runId, retryId, priorIdentity: {
      launchRef: retainedLaunchRef,
      runId: retainedRunId,
      retryId: retainedRetryId
    }, unitAddress: `${initiative}/${wkId}/${sliceId}`
  }) !== true) {
    fail(WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.REISSUE_REFUSED, "prior worker termination is not confirmed");
  }
  const runGit = deps.runGit ?? defaultRunGit;
  const resolveBinding = deps.resolveWorktreeBinding ?? resolveWorktreeBinding;
  const retainedWkRunId = bindingIdentity(retainedRunId, "wk");
  const retainedSliceRunId = bindingIdentity(retainedRunId, "slice");
  const wkBinding = resolveBinding({ mainRepo: repo, launchRef: retainedLaunchRef, runId: retainedWkRunId, retryId: retainedRetryId });
  const sliceBinding = resolveBinding({ mainRepo: repo, launchRef: retainedLaunchRef, runId: retainedSliceRunId, retryId: retainedRetryId });
  assertCompleteManagedBinding({
    binding: wkBinding, repo, unitAddress: `${initiative}/${wkId}`, launchRef: retainedLaunchRef,
    runId: retainedWkRunId, retryId: retainedRetryId, worktreeRoot: roots.worktreeRoot, sparse: false,
    runGit, allowAdvancedTip: true
  });
  assertCompleteManagedBinding({
    binding: sliceBinding, repo, unitAddress: `${initiative}/${wkId}/${sliceId}`, launchRef: retainedLaunchRef,
    runId: retainedSliceRunId, retryId: retainedRetryId, worktreeRoot: roots.worktreeRoot, sparse: true,
    runGit, allowAdvancedTip: true
  });
  const dirtyWk = runGit({ repo: wkBinding.worktree_path, args: ["status", "--porcelain"] });
  const dirty = runGit({ repo: sliceBinding.worktree_path, args: ["status", "--porcelain"] });
  const wkHead = runGit({ repo: wkBinding.worktree_path, args: ["rev-parse", "HEAD"] });
  const wkRef = runGit({ repo, args: ["rev-parse", wkBinding.output_branch] });
  const head = runGit({ repo: sliceBinding.worktree_path, args: ["rev-parse", "HEAD"] });
  const ref = runGit({ repo, args: ["rev-parse", sliceBinding.output_branch] });
  if (!dirtyWk?.ok || String(dirtyWk.stdout ?? "").trim() ||
      !wkHead?.ok || !wkRef?.ok || String(wkHead.stdout ?? "").trim() !== String(wkRef.stdout ?? "").trim() ||
      !dirty?.ok || String(dirty.stdout ?? "").trim() || !head?.ok || !ref?.ok ||
      String(head.stdout ?? "").trim() !== String(ref.stdout ?? "").trim()) {
    fail(WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.REISSUE_REFUSED, "retained slice binding is dirty, missing, live, or mismatched");
  }
  const cachePath = canonicalizeOwnedPath(path.join(roots.cacheRoot, wkId), "perWkCachePath", { mustExist: true });
  const runAuthority = randomUUID();
  const writer = deps.writeBindingFile ?? defaultWriteBindingFile;
  const reboundBindings = {};
  try {
    for (const [kind, binding] of [["wk", wkBinding], ["slice", sliceBinding]]) {
      const currentTip = kind === "slice"
        ? String(head.stdout ?? "").trim()
        : String(wkHead.stdout ?? "").trim();
      const rebound = {
        ...binding,
        launch_ref: launchRef,
        run_id: bindingIdentity(runId, kind),
        base_sha: currentTip,
        retry_id: retryId,
        run_authority: runAuthority
      };
      writer({
        filePath: bindingFilePath(repo, launchRef, bindingIdentity(runId, kind), retryId),
        contents: `${JSON.stringify(rebound, null, 2)}\n`
      });
      reboundBindings[kind] = Object.freeze(rebound);
    }
  } catch (error) {
    const failures = [];
    for (const kind of ["slice", "wk"]) removeBindingFile(repo, launchRef, bindingIdentity(runId, kind), retryId, failures);
    if (failures.length > 0) fail(WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.ROLLBACK_FAILED, "reissue binding rollback failed", { failures }, error);
    throw error;
  }
  return freezeManagedResult({
    initiative,
    wkId,
    sliceId,
    wkBinding: reboundBindings.wk,
    sliceBinding: reboundBindings.slice,
    roots,
    cachePath,
    runAuthority,
    retryId
  });
}

export function provisionManagedWorktreesAtDispatch({
  mainRepo,
  initiative,
  subject,
  launchRef,
  runId,
  retryId = 0,
  worktreeRoot,
  sharedDependencyRoot,
  cacheRoot,
  priorIdentity = null,
  deps = {}
} = {}) {
  const repo = canonicalizeOwnedPath(mainRepo, "mainRepo", { mustExist: true });
  assertInitiativeId(initiative);
  const { wkId, sliceId } = parseSubject(subject);
  if (sliceId === null || !/^SLICE-\d{3}$/.test(sliceId)) {
    fail(WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.INVALID_SUBJECT, "managed implementation dispatch requires one exact SLICE-NNN subject");
  }
  if (!Number.isInteger(retryId) || retryId < 0) {
    fail(WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.INVALID_ARG, "retryId must be a non-negative integer");
  }
  const roots = Object.freeze({
    worktreeRoot: canonicalizeOwnedPath(worktreeRoot, "worktreeRoot"),
    sharedDependencyRoot: canonicalizeOwnedPath(sharedDependencyRoot, "sharedDependencyRoot", { mustExist: true }),
    cacheRoot: canonicalizeOwnedPath(cacheRoot, "cacheRoot")
  });
  assertDistinctOwnedRoots({ mainRepo: repo, ...roots });
  if (retryId > 0) {
    return reissueManagedWorktrees({ repo, initiative, wkId, sliceId, launchRef, runId, retryId, priorIdentity, roots, deps });
  }

  const runGit = deps.runGit ?? defaultRunGit;
  const allocateWk = deps.allocateExactUnitWorktree ?? defaultAllocateExactUnitWorktree;
  const allocateSlice = deps.allocateSparseExactUnitWorktree ?? defaultAllocateSparseExactUnitWorktree;
  const bindings = { wk: null, slice: null };
  const cachePath = path.join(roots.cacheRoot, wkId);
  let cacheCreated = false;
  const createdRoots = [];
  try {
    for (const root of [roots.worktreeRoot, roots.cacheRoot]) {
      if (!existsSync(root)) {
        mkdirSync(root, { recursive: true, mode: 0o700 });
        createdRoots.unshift(root);
      }
    }
    const canonicalCachePath = canonicalizeOwnedPath(cachePath, "perWkCachePath");
    if (canonicalCachePath !== cachePath) {
      fail(WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.ROOT_REFUSED, "per-WK cache path aliases or escapes its launcher-owned root");
    }
    bindings.wk = allocateWk({
      mainRepo: repo,
      unitAddress: `${initiative}/${wkId}`,
      launchRef,
      runId: bindingIdentity(runId, "wk"),
      retryId: 0,
      worktreeRoot: roots.worktreeRoot,
      deps: { ...deps, runGit }
    });
    assertCompleteManagedBinding({
      binding: bindings.wk, repo, unitAddress: `${initiative}/${wkId}`, launchRef,
      runId: bindingIdentity(runId, "wk"), retryId: 0, worktreeRoot: roots.worktreeRoot, sparse: false,
      runGit
    });
    bindings.slice = allocateSlice({
      mainRepo: repo,
      unitAddress: `${initiative}/${wkId}/${sliceId}`,
      launchRef,
      runId: bindingIdentity(runId, "slice"),
      retryId: 0,
      worktreeRoot: roots.worktreeRoot,
      deps: { ...deps, runGit }
    });
    assertCompleteManagedBinding({
      binding: bindings.slice, repo, unitAddress: `${initiative}/${wkId}/${sliceId}`, launchRef,
      runId: bindingIdentity(runId, "slice"), retryId: 0, worktreeRoot: roots.worktreeRoot, sparse: true,
      runGit
    });
    if (bindings.wk.base_sha !== bindings.slice.base_sha ||
        bindings.wk.output_branch === bindings.slice.output_branch ||
        bindings.wk.worktree_path === bindings.slice.worktree_path) {
      fail(WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE, "WK and slice bindings do not share one immutable captured WK-tip identity or collide");
    }
    if (!existsSync(cachePath)) {
      const prepareCache = deps.prepareCache ?? ((target) => mkdirSync(target, { recursive: false, mode: 0o700 }));
      try {
        prepareCache(cachePath);
      } finally {
        cacheCreated = existsSync(cachePath);
      }
      if (!cacheCreated || !lstatSync(cachePath).isDirectory()) {
        fail(WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE, "per-WK writable cache preparation returned without creating the cache");
      }
    }
    const runAuthority = randomUUID();
    return freezeManagedResult({ initiative, wkId, sliceId, wkBinding: bindings.wk, sliceBinding: bindings.slice, roots, cachePath, runAuthority, retryId });
  } catch (error) {
    compensateManagedAllocation({ runGit, repo, launchRef, runId, retryId, bindings, cachePath, cacheCreated, createdRoots, cause: error });
    throw error;
  }
}
