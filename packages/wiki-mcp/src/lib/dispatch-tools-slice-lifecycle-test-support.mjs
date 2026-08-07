import assert from "node:assert/strict";

import {
  SAFE_POSTCHECK_MISMATCH_FIELDS,
  SLICE_REVIEW_POSTCHECK_FAILED_CODE
} from "./dispatch-tool-helpers.mjs";

export function withSliceReviewPreparation(deps) {
  const resolveManagedRunBinding = () => {
    const provisioning = deps.resolveManagedRunBinding();
    return {
      ...provisioning,
      slice_binding: {
        ...provisioning.slice_binding,
        retry_id: provisioning.slice_binding.retry_id ?? 0
      }
    };
  };
  return {
    ...deps,
    resolveManagedRunBinding,
    hostSliceReviewPreparationAdapter: async (request) => {
      const provisioning = resolveManagedRunBinding();
      const binding = provisioning.slice_binding;
      const sliceRef = binding.output_branch.startsWith("refs/heads/")
        ? binding.output_branch
        : `refs/heads/${binding.output_branch}`;
      const reviewed = deps.runGit({
        repo: binding.worktree_path,
        args: ["rev-parse", "--verify", `${sliceRef}^{commit}`]
      }).stdout.trim();
      const tree = deps.runGit({
        repo: binding.worktree_path,
        args: ["rev-parse", "--verify", `${reviewed}^{tree}`]
      }).stdout.trim();
      return {
        accepted: true,
        preparation: {
          ...request,
          worktree_path: binding.worktree_path,
          slice_ref: sliceRef,
          base_sha: binding.base_sha,
          reviewed_sha: reviewed,
          reviewed_tree: tree
        }
      };
    }
  };
}

export function provenDeathDeps(deps, verdictFor) {
  const seen = [];
  return {
    deps: {
      ...withSliceReviewPreparation(deps),
      resolveManagedWorkerProvenDeath: (tuple) => {
        seen.push(tuple);
        return verdictFor(tuple);
      }
    },
    seen
  };
}

export const GENERIC_LIFECYCLE_FAILURE_CODE = "agent_launch.slice_lifecycle.failed.v1";
export const GENERIC_LIFECYCLE_FAILURE_MESSAGE = "post-worker slice lifecycle invocation failed";

const POSTCHECK_ERROR_MESSAGE_TEXT =
  "agent-launch slice-review materialization: trusted state changed";
const POSTCHECK_ERROR_NAME = "SliceReviewMaterializationError";

export function assertNoPostcheckExceptionText(label, response) {
  const serialized = JSON.stringify(response);
  for (const [what, text] of [
    ["message", POSTCHECK_ERROR_MESSAGE_TEXT],
    ["name", POSTCHECK_ERROR_NAME],
    ["code", SLICE_REVIEW_POSTCHECK_FAILED_CODE]
  ]) {
    assert.equal(
      serialized.includes(text), false,
      `${label}: the raw postcheck exception ${what} reached the serialized response`
    );
  }
}

export function assertClosedPostcheckLifecycle(label, lifecycle, field) {
  assert.equal(lifecycle.error_code, GENERIC_LIFECYCLE_FAILURE_CODE, label);
  assert.equal(lifecycle.error_message, GENERIC_LIFECYCLE_FAILURE_MESSAGE, label);
  assert.equal(lifecycle.error_message_truncated, false, label);
  assert.equal(lifecycle.postcheck_mismatch_field, field, label);
  assert.equal(SAFE_POSTCHECK_MISMATCH_FIELDS.length, 15, label);
  assert.ok(
    SAFE_POSTCHECK_MISMATCH_FIELDS.includes(lifecycle.postcheck_mismatch_field),
    `${label}: the discriminator must be a member of the closed vocabulary`
  );
}

export function postcheckError(detail, options = {}) {
  const error = new Error("agent-launch slice-review materialization: trusted state changed");
  error.name = "SliceReviewMaterializationError";

  error.code = Object.hasOwn(options, "code") ? options.code : SLICE_REVIEW_POSTCHECK_FAILED_CODE;
  if (detail !== undefined) error.detail = detail;
  return error;
}
