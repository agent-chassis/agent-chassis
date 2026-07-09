

import path from "node:path";

import {
  allocatePerWkWorktree as defaultAllocatePerWkWorktree,
  resolveWorktreeBinding as defaultResolveWorktreeBinding,
  perWkBranchRef as defaultPerWkBranchRef,
  integrationBranchRef as defaultIntegrationBranchRef,
  defaultRunGit
} from "./worktree-substrate.mjs";
import {
  resetWorktreeToIntegrationTip as defaultResetWorktreeToIntegrationTip
} from "./worktree-lease.mjs";

export const WORKTREE_PROVISIONING_DISPATCH_SCHEMA_VERSION =
  "worktree-provisioning-dispatch.v1";

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
  GIT_FAILED: "agent_launch.worktree_provisioning_dispatch.git_failed.v1"
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
