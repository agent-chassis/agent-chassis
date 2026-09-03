

import {
  WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES,
  fail,
  parseSubject,
  assertInitiativeId,
  assertOpaqueId,
  assertRetryIdZero,
  assertAbsolutePath,
  assertWorktreeRootOutsideMainRepo,
  assertStoreDisjointFromWorktree,
  perWkWorktreePath
} from "./worktree-substrate-primitives.mjs";

function refuseRetiredIntegrationOperation(operation) {
  fail(
    WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_ARG,
    `${operation} is prohibited: DEC-0170 retired durable integration branches; ` +
      "use current-main exact-unit allocation"
  );
}

export function integrationBranchRef(initiative) {
  assertInitiativeId(initiative);
  refuseRetiredIntegrationOperation("integration branch ref construction");
}

export function integrationWorktreePath(worktreeRoot, initiative) {
  assertAbsolutePath(worktreeRoot, "worktreeRoot");
  assertInitiativeId(initiative);
  refuseRetiredIntegrationOperation("integration worktree path construction");
}

export function allocateIntegrationWorktree({
  mainRepo,
  initiative,
  worktreeRoot,
  base = "main"
} = {}) {
  const repo = assertAbsolutePath(mainRepo, "mainRepo");
  assertInitiativeId(initiative);
  const root = assertAbsolutePath(worktreeRoot, "worktreeRoot");
  assertWorktreeRootOutsideMainRepo(repo, root);
  if (typeof base !== "string" || base.length === 0) {
    fail(WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_ARG, "base must be a non-empty string");
  }
  refuseRetiredIntegrationOperation("integration worktree allocation");
}

export function allocatePerWkWorktree({
  mainRepo,
  initiative,
  subject,
  launchRef,
  runId,
  retryId = 0,
  worktreeRoot
} = {}) {
  const repo = assertAbsolutePath(mainRepo, "mainRepo");
  assertInitiativeId(initiative);
  const { wkId } = parseSubject(subject);
  assertOpaqueId(launchRef, "launch_ref");
  assertOpaqueId(runId, "run_id");
  assertRetryIdZero(retryId);
  const root = assertAbsolutePath(worktreeRoot, "worktreeRoot");
  assertWorktreeRootOutsideMainRepo(repo, root);
  assertStoreDisjointFromWorktree(repo, perWkWorktreePath(root, initiative, wkId));
  refuseRetiredIntegrationOperation("legacy per-WK integration-based allocation");
}
