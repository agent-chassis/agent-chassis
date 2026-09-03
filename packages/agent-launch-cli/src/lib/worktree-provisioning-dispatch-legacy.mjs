

import {
  WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES,
  fail,
  parseSubject,
  assertInitiativeId,
  assertAbsolutePath
} from "./worktree-provisioning-dispatch-constants.mjs";

export function provisionWorktreeAtDispatch({
  mainRepo,
  initiative,
  subject,
  retryId = 0
} = {}) {
  assertAbsolutePath(mainRepo, "mainRepo");
  assertInitiativeId(initiative);
  parseSubject(subject);
  if (!Number.isInteger(retryId) || retryId < 0) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.INVALID_ARG,
      `retryId must be a non-negative integer, got: ${JSON.stringify(retryId)}`
    );
  }
  fail(
    WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.INVALID_ARG,
    "legacy integration-based provisioning is prohibited: DEC-0170 retired durable " +
      "integration branches; use current-main exact-unit provisioning"
  );
}
