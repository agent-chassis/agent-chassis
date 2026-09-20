

import { lifecycleError } from "./dispatch-post-worker-lifecycle-bindings.mjs";

export const POLICY_LIFECYCLE_CODES = Object.freeze({
  INTEGRATION_MISMATCH:
    "agent_launch.terminal_review_policy.integration_mismatch.v1"
});

export function sameReviewTarget(left, right) {
  const fields = [
    "schema_version", "unit_address", "ref", "sha", "diff_base_sha",
    "diff_head_sha", "diff_range", "complete_parent_wk_contract",
    "accumulated_wk_diff"
  ];
  return left !== null && right !== null && fields.every((field) => left[field] === right[field]);
}

export function assertTerminalTargetOwnership(integration) {
  if (integration?.review_target !== null &&
      integration?.slice_sha !== integration?.wk_sha) {
    throw lifecycleError(
      POLICY_LIFECYCLE_CODES.INTEGRATION_MISMATCH,
      "terminal whole-WK review target requires the integrated slice to own the current WK tip",
      {
        slice_sha: integration?.slice_sha ?? null,
        wk_sha: integration?.wk_sha ?? null
      }
    );
  }
  return integration;
}
