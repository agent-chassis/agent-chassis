

import {
  HOST_WRITE_AUTHORITY_LAUNCH_INPUT_FIELDS
} from "../host-write-authority-launch-input-fields.mjs";

export const BACKEND_CODE_BACKEND_UNAVAILABLE = "backend_unavailable";
export const BACKEND_CODE_LAUNCH_REFUSED = "validation_failure";
export const BACKEND_CODE_LAUNCH_FAILED_BEFORE_START = "operator_recovery_needed";

export const HOST_WRITE_AUTHORITY_SUBSTRATE_ID =
  "agent_launch.host_write_authority.v1";

export const HOST_WRITE_AUTHORITY_SUBSTRATE_UNAVAILABLE_REASON =
  "host_write_authority_substrate_unavailable";

export const HOST_WRITE_AUTHORITY_SUBSTRATE_PROTOCOL_VERSION = "1";

export const HOST_WRITE_AUTHORITY_REQUEST_SCHEMA_VERSION =
  "agent_launch.host_write_authority.request.v1";
export const HOST_WRITE_AUTHORITY_RESPONSE_SCHEMA_VERSION =
  "agent_launch.host_write_authority.response.v1";

export const HOST_WRITE_AUTHORITY_OPS = Object.freeze({
  START_LAUNCH: "start_launch",
  PROBE_RUN: "probe_run",
  PROVISION_WORKTREE: "provision_worktree",
  COMMIT_SLICE: "commit_slice",
  INTEGRATE_SLICE: "integrate_slice"
});

export const HOST_WRITE_AUTHORITY_RESPONSE_KINDS = Object.freeze({
  LAUNCH_ACCEPTED: "launch_accepted",
  PROBE_RESULT: "probe_result",
  WORKTREE_PROVISIONED: "worktree_provisioned",

  SLICE_COMMITTED: "slice_committed",

  SLICE_INTEGRATED: "slice_integrated",
  REFUSAL: "refusal"
});

export { HOST_WRITE_AUTHORITY_LAUNCH_INPUT_FIELDS };

export const HOST_WRITE_AUTHORITY_FORBIDDEN_TOKENS = Object.freeze([
  "stdio_authentication_prelude",
  "registration_prelude",
  "CODEX_HOME",
  "codex_home_overlay",
  "bwrap_widening",
  "graph_impact_side_channel",
  "wrapper_fallback",
  "shell_fallback",
  "temp_worktree",
  "codex-worker",
  "codex-review",
  "codex-redteam",
  "claude-worker",
  "claude-review",
  "claude-redteam",
  "agy-worker",
  "agy-review",
  "agy-redteam",
  "gemini-worker",
  "gemini-review",
  "gemini-redteam"
]);

export const HOST_WRITE_AUTHORITY_REFUSAL_REASONS = Object.freeze({
  CHANNEL_MISSING: "host_write_authority_channel_missing",
  CHANNEL_THREW: "host_write_authority_channel_threw",
  RESPONSE_MALFORMED: "host_write_authority_response_malformed",
  BROKER_REFUSED: "host_write_authority_broker_refused",
  PROTOCOL_VERSION_UNSUPPORTED:
    "host_write_authority_protocol_version_unsupported",
  FORBIDDEN_TOKEN_IN_LAUNCH_INPUT:
    "host_write_authority_forbidden_token_in_launch_input",

  PROVISIONING_CARRIER_INVALID:
    "host_write_authority_provisioning_carrier_invalid",

  COMMIT_RESULT_INVALID:
    "host_write_authority_commit_result_invalid",

  INTEGRATION_RESULT_INVALID:
    "host_write_authority_integration_result_invalid"
});

export const REFUSAL_REASON_TO_BACKEND_CODE = Object.freeze({
  [HOST_WRITE_AUTHORITY_REFUSAL_REASONS.CHANNEL_MISSING]:
    BACKEND_CODE_BACKEND_UNAVAILABLE,
  [HOST_WRITE_AUTHORITY_REFUSAL_REASONS.PROTOCOL_VERSION_UNSUPPORTED]:
    BACKEND_CODE_BACKEND_UNAVAILABLE,
  [HOST_WRITE_AUTHORITY_REFUSAL_REASONS.CHANNEL_THREW]:
    BACKEND_CODE_LAUNCH_FAILED_BEFORE_START,
  [HOST_WRITE_AUTHORITY_REFUSAL_REASONS.RESPONSE_MALFORMED]:
    BACKEND_CODE_LAUNCH_FAILED_BEFORE_START,
  [HOST_WRITE_AUTHORITY_REFUSAL_REASONS.BROKER_REFUSED]:
    BACKEND_CODE_LAUNCH_REFUSED,
  [HOST_WRITE_AUTHORITY_REFUSAL_REASONS.FORBIDDEN_TOKEN_IN_LAUNCH_INPUT]:
    BACKEND_CODE_LAUNCH_REFUSED,
  [HOST_WRITE_AUTHORITY_REFUSAL_REASONS.PROVISIONING_CARRIER_INVALID]:
    BACKEND_CODE_LAUNCH_FAILED_BEFORE_START,
  [HOST_WRITE_AUTHORITY_REFUSAL_REASONS.COMMIT_RESULT_INVALID]:
    BACKEND_CODE_LAUNCH_FAILED_BEFORE_START,
  [HOST_WRITE_AUTHORITY_REFUSAL_REASONS.INTEGRATION_RESULT_INVALID]:
    BACKEND_CODE_LAUNCH_FAILED_BEFORE_START
});

export const WORKER_GATE_REFUSAL_DETAIL_KIND = "worker_gate_refusal";

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}
