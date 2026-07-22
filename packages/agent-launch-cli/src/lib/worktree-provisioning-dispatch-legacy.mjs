

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
import {
  WORKTREE_PROVISIONING_DISPATCH_SCHEMA_VERSION,
  WORKTREE_PROVISIONING_ISOLATION_INVARIANT,
  DEFAULT_EXPECTED_ENVELOPE_FIELD,
  WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES,
  fail,
  parseSubject,
  assertInitiativeId,
  assertAbsolutePath
} from "./worktree-provisioning-dispatch-constants.mjs";
import {
  assertExpectedEnvelopePresent,
  assertFastForwardDescendant,
  replayWkBranchOntoMain
} from "./worktree-provisioning-dispatch-replay.mjs";

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

function resolveRefTip(runGit, mainRepo, ref) {
  const res = runGit({
    repo: mainRepo,
    args: ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]
  });
  const sha = res && res.ok === true ? String(res.stdout ?? "").trim() : "";
  return sha || null;
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

  const replayScratchRoot = deps.replayScratchRoot ?? null;
  const replayWkBranch = deps.replayWkBranchOntoMain ??
    (replayScratchRoot !== null ? replayWkBranchOntoMain : null);

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
      integrationBranchRefFn,
      perWkBranchRefFn,
      replayWkBranch,
      replayScratchRoot
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
  integrationBranchRefFn,
  perWkBranchRefFn = defaultPerWkBranchRef,
  replayWkBranch = null,
  replayScratchRoot = null
}) {
  assertAbsolutePath(worktreeRoot, "worktreeRoot");

  let replay = null;
  if (typeof replayWkBranch === "function") {
    replay = replayWkBranch({
      mainRepo: repo,
      wkRef: `refs/heads/${perWkBranchRefFn(initiative, parseSubject(subject).wkId)}`,
      scratchRoot: replayScratchRoot,
      deps: { runGit }
    });
  }

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
    expectedEnvelopeField,
    ...(replay ? { extra: { dispatch_replay: replay } } : {})
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
