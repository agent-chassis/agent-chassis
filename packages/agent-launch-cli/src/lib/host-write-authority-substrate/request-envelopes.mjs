

import {
  HOST_WRITE_AUTHORITY_LAUNCH_INPUT_FIELDS,
  HOST_WRITE_AUTHORITY_OPS,
  HOST_WRITE_AUTHORITY_REFUSAL_REASONS,
  HOST_WRITE_AUTHORITY_REQUEST_SCHEMA_VERSION,
  HOST_WRITE_AUTHORITY_RESPONSE_KINDS,
  HOST_WRITE_AUTHORITY_RESPONSE_SCHEMA_VERSION,
  HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
  HOST_WRITE_AUTHORITY_SUBSTRATE_PROTOCOL_VERSION,
  WORKER_GATE_REFUSAL_DETAIL_KIND,
  isPlainObject
} from "./protocol-constants.mjs";
import {
  findForbiddenTokenInResponseEnvelope
} from "./forbidden-token-scan.mjs";

export function buildWorkerGateRefusalDetail(refusal) {
  if (!isPlainObject(refusal)) {
    return null;
  }
  const remediation = isPlainObject(refusal.worker_admission_remediation)
    ? refusal.worker_admission_remediation
    : isPlainObject(refusal.worker_admission) &&
      isPlainObject(refusal.worker_admission.remediation)
      ? refusal.worker_admission.remediation
      : null;
  const admissionDecisionCode =
    typeof refusal.decision_code === "string" && refusal.decision_code.length > 0
      ? refusal.decision_code
      : isPlainObject(refusal.worker_admission) &&
        typeof refusal.worker_admission.decision_code === "string" &&
        refusal.worker_admission.decision_code.length > 0
        ? refusal.worker_admission.decision_code
        : null;
  return {
    kind: WORKER_GATE_REFUSAL_DETAIL_KIND,
    wrapper_gate_code:
      typeof refusal.wrapper_gate_code === "string" ? refusal.wrapper_gate_code : null,
    unit_address: typeof refusal.unit_address === "string" ? refusal.unit_address : null,
    expected_unit_address:
      typeof refusal.expected_unit_address === "string"
        ? refusal.expected_unit_address
        : null,
    readiness_decision_code:
      isPlainObject(refusal.readiness) &&
      typeof refusal.readiness.decision_code === "string"
        ? refusal.readiness.decision_code
        : null,
    worker_admission_decision_code: admissionDecisionCode,
    diagnostics: Array.isArray(refusal.diagnostics) ? refusal.diagnostics : [],
    worker_admission: refusal.worker_admission ?? null,

    remote_worker_admission: refusal.remote_worker_admission ?? null,
    remediation
  };
}

export function isWorkerGateRefusalDetail(detail) {
  return isPlainObject(detail) && detail.kind === WORKER_GATE_REFUSAL_DETAIL_KIND;
}

export function buildHostWriteAuthorityLaunchInput(input) {
  if (!isPlainObject(input)) return Object.freeze({});
  const sanitized = {};
  for (const field of HOST_WRITE_AUTHORITY_LAUNCH_INPUT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      sanitized[field] = input[field];
    }
  }
  if (
    Object.prototype.hasOwnProperty.call(sanitized, "provisionedWorktreeGitBinding") &&
    !Object.prototype.hasOwnProperty.call(sanitized, "provisioned_worktree_git_binding")
  ) {
    sanitized.provisioned_worktree_git_binding = sanitized.provisionedWorktreeGitBinding;
  } else if (
    Object.prototype.hasOwnProperty.call(sanitized, "provisioned_worktree_git_binding") &&
    !Object.prototype.hasOwnProperty.call(sanitized, "provisionedWorktreeGitBinding")
  ) {
    sanitized.provisionedWorktreeGitBinding = sanitized.provisioned_worktree_git_binding;
  }
  return Object.freeze(sanitized);
}

export function buildHostWriteAuthorityStartLaunchEnvelope(input) {
  return Object.freeze({
    schema_version: HOST_WRITE_AUTHORITY_REQUEST_SCHEMA_VERSION,
    substrate_id: HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
    protocol_version: HOST_WRITE_AUTHORITY_SUBSTRATE_PROTOCOL_VERSION,
    op: HOST_WRITE_AUTHORITY_OPS.START_LAUNCH,
    launch_input: buildHostWriteAuthorityLaunchInput(input)
  });
}

export function buildHostWriteAuthorityProbeEnvelope(run_handle) {
  return Object.freeze({
    schema_version: HOST_WRITE_AUTHORITY_REQUEST_SCHEMA_VERSION,
    substrate_id: HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
    protocol_version: HOST_WRITE_AUTHORITY_SUBSTRATE_PROTOCOL_VERSION,
    op: HOST_WRITE_AUTHORITY_OPS.PROBE_RUN,
    run_handle: typeof run_handle === "string" ? run_handle : null
  });
}

export function validateHostWriteAuthorityResponseEnvelope(response, expectedOp) {
  if (!isPlainObject(response)) {
    return {
      ok: false,
      reason: HOST_WRITE_AUTHORITY_REFUSAL_REASONS.RESPONSE_MALFORMED,
      detail: { issue: "response_not_object", received_type: typeof response }
    };
  }
  if (response.schema_version !== HOST_WRITE_AUTHORITY_RESPONSE_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: HOST_WRITE_AUTHORITY_REFUSAL_REASONS.RESPONSE_MALFORMED,
      detail: {
        issue: "response_schema_version_mismatch",
        expected: HOST_WRITE_AUTHORITY_RESPONSE_SCHEMA_VERSION,
        received: response.schema_version ?? null
      }
    };
  }
  if (response.substrate_id !== HOST_WRITE_AUTHORITY_SUBSTRATE_ID) {
    return {
      ok: false,
      reason: HOST_WRITE_AUTHORITY_REFUSAL_REASONS.RESPONSE_MALFORMED,
      detail: {
        issue: "response_substrate_id_mismatch",
        expected: HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
        received: response.substrate_id ?? null
      }
    };
  }
  if (response.protocol_version !== HOST_WRITE_AUTHORITY_SUBSTRATE_PROTOCOL_VERSION) {
    return {
      ok: false,
      reason: HOST_WRITE_AUTHORITY_REFUSAL_REASONS.PROTOCOL_VERSION_UNSUPPORTED,
      detail: {
        expected: HOST_WRITE_AUTHORITY_SUBSTRATE_PROTOCOL_VERSION,
        received: response.protocol_version ?? null
      }
    };
  }
  const validKinds = Object.values(HOST_WRITE_AUTHORITY_RESPONSE_KINDS);
  if (!validKinds.includes(response.kind)) {
    return {
      ok: false,
      reason: HOST_WRITE_AUTHORITY_REFUSAL_REASONS.RESPONSE_MALFORMED,
      detail: {
        issue: "response_kind_unrecognized",
        received_kind: typeof response.kind === "string" ? response.kind : null
      }
    };
  }
  if (
    expectedOp === HOST_WRITE_AUTHORITY_OPS.START_LAUNCH &&
    response.kind === HOST_WRITE_AUTHORITY_RESPONSE_KINDS.PROBE_RESULT
  ) {
    return {
      ok: false,
      reason: HOST_WRITE_AUTHORITY_REFUSAL_REASONS.RESPONSE_MALFORMED,
      detail: { issue: "probe_result_for_start_launch" }
    };
  }
  if (
    expectedOp === HOST_WRITE_AUTHORITY_OPS.PROBE_RUN &&
    response.kind === HOST_WRITE_AUTHORITY_RESPONSE_KINDS.LAUNCH_ACCEPTED
  ) {
    return {
      ok: false,
      reason: HOST_WRITE_AUTHORITY_REFUSAL_REASONS.RESPONSE_MALFORMED,
      detail: { issue: "launch_accepted_for_probe_run" }
    };
  }
  if (response.kind === HOST_WRITE_AUTHORITY_RESPONSE_KINDS.LAUNCH_ACCEPTED) {
    if (typeof response.run_handle !== "string" || response.run_handle.length === 0) {
      return {
        ok: false,
        reason: HOST_WRITE_AUTHORITY_REFUSAL_REASONS.RESPONSE_MALFORMED,
        detail: { issue: "launch_accepted_run_handle_missing" }
      };
    }
    if (typeof response.status !== "string" || response.status.length === 0) {
      return {
        ok: false,
        reason: HOST_WRITE_AUTHORITY_REFUSAL_REASONS.RESPONSE_MALFORMED,
        detail: { issue: "launch_accepted_status_missing" }
      };
    }
  }
  if (response.kind === HOST_WRITE_AUTHORITY_RESPONSE_KINDS.PROBE_RESULT) {
    if (typeof response.status !== "string" || response.status.length === 0) {
      return {
        ok: false,
        reason: HOST_WRITE_AUTHORITY_REFUSAL_REASONS.RESPONSE_MALFORMED,
        detail: { issue: "probe_result_status_missing" }
      };
    }
  }
  if (response.kind === HOST_WRITE_AUTHORITY_RESPONSE_KINDS.REFUSAL) {
    if (!isPlainObject(response.refusal)) {
      return {
        ok: false,
        reason: HOST_WRITE_AUTHORITY_REFUSAL_REASONS.RESPONSE_MALFORMED,
        detail: { issue: "refusal_payload_missing" }
      };
    }
  }
  const forbidden = findForbiddenTokenInResponseEnvelope(response);
  if (forbidden) {
    return {
      ok: false,
      reason: HOST_WRITE_AUTHORITY_REFUSAL_REASONS.RESPONSE_MALFORMED,
      detail: { issue: "response_contains_forbidden_token", token: forbidden }
    };
  }
  return { ok: true, response };
}
