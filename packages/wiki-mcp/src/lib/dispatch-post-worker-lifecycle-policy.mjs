

import { SLICE_INTEGRATION_DIAGNOSTIC_CODES } from
  "../../../agent-launch-cli/src/lib/slice-integration.mjs";
import {
  lifecycleError,
  resolvedCommit
} from "./dispatch-post-worker-lifecycle-bindings.mjs";

export const POLICY_LIFECYCLE_CODES = Object.freeze({
  INTEGRATION_MISMATCH:
    "agent_launch.terminal_review_policy.integration_mismatch.v1",
  CANONICAL_STATE_INVALID:
    "agent_launch.terminal_review_policy.canonical_state_invalid.v1"
});

export const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export function policyLifecycleError(code, message, detail = null, cause = null) {
  return lifecycleError(code, message, detail, cause);
}

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
    throw policyLifecycleError(
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

export async function reconstructPolicyReviewTarget({ runGit, workspaceDir, initiative, wkId, wkRef, wkSha }) {
  const mainSha = await resolvedCommit(
    runGit,
    workspaceDir,
    "refs/heads/main",
    "terminal replay could not resolve the canonical main tip",
    SLICE_INTEGRATION_DIAGNOSTIC_CODES.GIT_FAILED
  );
  const mergeBaseResult = await runGit({ repo: workspaceDir, args: ["merge-base", mainSha, wkSha] });
  const diffBaseSha = mergeBaseResult?.ok === true
    ? String(mergeBaseResult.stdout ?? "").trim()
    : "";
  if (!OID_RE.test(diffBaseSha) || /^0+$/u.test(diffBaseSha)) {
    throw policyLifecycleError(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.GIT_FAILED,
      "terminal replay could not derive the exact whole-WK diff base",
      {
        status: mergeBaseResult?.status ?? null,
        stderr: mergeBaseResult?.stderr ?? mergeBaseResult?.error ?? null
      }
    );
  }
  return Object.freeze({
    schema_version: "slice-integration.v1",
    unit_address: `${initiative}/${wkId}`,
    ref: wkRef,
    sha: wkSha,
    diff_base_sha: diffBaseSha,
    diff_head_sha: wkSha,
    diff_range: `${diffBaseSha}..${wkSha}`,
    complete_parent_wk_contract: true,
    accumulated_wk_diff: true
  });
}

export function assertCanonicalReviewIdentity(reviewUnit, { wkId, initiative }) {
  if (reviewUnit?.record_id !== wkId || reviewUnit?.initiative !== initiative) {
    throw policyLifecycleError(
      POLICY_LIFECYCLE_CODES.CANONICAL_STATE_INVALID,
      "terminal reconstruction canonical review unit does not match the exact launcher WK identity"
    );
  }
  return reviewUnit;
}
