import { SLICE_REVIEW_POSTCHECK_FAILED_CODE } from "./dispatch-tool-helpers.mjs";

export function provenDeathDeps(deps, verdictFor) {
  const seen = [];
  return {
    deps: {
      ...deps,
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

export function postcheckError(detail, options = {}) {
  const error = new Error("agent-launch slice-review materialization: trusted state changed");
  error.name = "SliceReviewMaterializationError";

  error.code = Object.hasOwn(options, "code") ? options.code : SLICE_REVIEW_POSTCHECK_FAILED_CODE;
  if (detail !== undefined) error.detail = detail;
  return error;
}
