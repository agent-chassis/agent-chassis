

import {
  HOST_WRITE_AUTHORITY_LAUNCH_INPUT_FIELDS,
  HOST_WRITE_AUTHORITY_OPS,
  HOST_WRITE_AUTHORITY_REFUSAL_REASONS,
  HOST_WRITE_AUTHORITY_REQUEST_SCHEMA_VERSION,
  HOST_WRITE_AUTHORITY_RESPONSE_KINDS,
  HOST_WRITE_AUTHORITY_RESPONSE_SCHEMA_VERSION,
  HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
  HOST_WRITE_AUTHORITY_SUBSTRATE_PROTOCOL_VERSION,
  SLICE_REVIEW_SURFACE_PREPARATION_SCHEMA_VERSION,
  SLICE_REVIEW_SURFACE_PREPARATION_VERIFIED_PARTS,
  WORKER_GATE_REFUSAL_DETAIL_KIND,
  isPlainObject
} from "./protocol-constants.mjs";
import {
  findForbiddenTokenInResponseEnvelope
} from "./forbidden-token-scan.mjs";
import {
  isCanonicalGitObjectId,
  isCompleteIntegrateSliceRequestIdentity
} from "./request-envelopes-primitives.mjs";

export const HOST_WRITE_AUTHORITY_PROVISION_WORKTREE_REQUEST_FIELDS = Object.freeze([
  "role",
  "subject",
  "initiative",
  "launch_ref",
  "run_id",
  "retry_id"
]);

const HOST_WRITE_AUTHORITY_WORKTREE_PROVISIONED_RESPONSE_FIELDS = Object.freeze([
  "schema_version",
  "substrate_id",
  "protocol_version",
  "kind",
  "provisioning"
]);

export const HOST_WRITE_AUTHORITY_COMMIT_SLICE_REQUEST_FIELDS = Object.freeze([
  "assigned_unit",
  "launch_ref",
  "run_id",
  "retry_id"
]);

const HOST_WRITE_AUTHORITY_SLICE_COMMITTED_RESPONSE_FIELDS = Object.freeze([
  "schema_version",
  "substrate_id",
  "protocol_version",
  "kind",
  "commit_result"
]);

export const HOST_WRITE_AUTHORITY_INTEGRATE_SLICE_REQUEST_FIELDS = Object.freeze([
  "assigned_unit",
  "launch_ref",
  "run_id",
  "retry_id"
]);

export const HOST_WRITE_AUTHORITY_PREPARE_SLICE_REVIEW_SURFACE_REQUEST_FIELDS =
  Object.freeze(["assigned_unit", "launch_ref", "run_id", "retry_id"]);

const HOST_WRITE_AUTHORITY_SLICE_REVIEW_SURFACE_PREPARED_RESPONSE_FIELDS =
  Object.freeze([
    "schema_version",
    "substrate_id",
    "protocol_version",
    "kind",
    "preparation"
  ]);

export const HOST_WRITE_AUTHORITY_SLICE_REVIEW_SURFACE_PREPARATION_RESULT_FIELDS =
  Object.freeze([
    "schema_version",
    "assigned_unit",
    "launch_ref",
    "run_id",
    "retry_id",
    "worktree_identity_digest",
    "worktree_path",
    "slice_ref",
    "base_sha",
    "reviewed_sha",
    "reviewed_tree",
    "verified_parts"
  ]);

const HOST_WRITE_AUTHORITY_SLICE_INTEGRATED_RESPONSE_FIELDS = Object.freeze([
  "schema_version",
  "substrate_id",
  "protocol_version",
  "kind",
  "integration"
]);

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

export function buildHostWriteAuthorityProvisionWorktreeRequest(request) {
  if (!isPlainObject(request)) return Object.freeze({});
  const sanitized = {};
  for (const field of HOST_WRITE_AUTHORITY_PROVISION_WORKTREE_REQUEST_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(request, field)) {
      sanitized[field] = request[field];
    }
  }
  return Object.freeze(sanitized);
}

export function buildHostWriteAuthorityProvisionWorktreeEnvelope(request) {
  return Object.freeze({
    schema_version: HOST_WRITE_AUTHORITY_REQUEST_SCHEMA_VERSION,
    substrate_id: HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
    protocol_version: HOST_WRITE_AUTHORITY_SUBSTRATE_PROTOCOL_VERSION,
    op: HOST_WRITE_AUTHORITY_OPS.PROVISION_WORKTREE,
    provision_request: buildHostWriteAuthorityProvisionWorktreeRequest(request)
  });
}

export function buildHostWriteAuthorityCommitSliceRequest(request) {
  if (!isPlainObject(request)) return Object.freeze({});
  const sanitized = {};
  for (const field of HOST_WRITE_AUTHORITY_COMMIT_SLICE_REQUEST_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(request, field)) {
      sanitized[field] = request[field];
    }
  }
  return Object.freeze(sanitized);
}

export function buildHostWriteAuthorityCommitSliceEnvelope(request) {
  return Object.freeze({
    schema_version: HOST_WRITE_AUTHORITY_REQUEST_SCHEMA_VERSION,
    substrate_id: HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
    protocol_version: HOST_WRITE_AUTHORITY_SUBSTRATE_PROTOCOL_VERSION,
    op: HOST_WRITE_AUTHORITY_OPS.COMMIT_SLICE,
    commit_request: buildHostWriteAuthorityCommitSliceRequest(request)
  });
}

export function buildHostWriteAuthorityIntegrateSliceRequest(request) {
  if (!isPlainObject(request)) return Object.freeze({});
  const sanitized = {};
  for (const field of HOST_WRITE_AUTHORITY_INTEGRATE_SLICE_REQUEST_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(request, field)) {
      sanitized[field] = request[field];
    }
  }
  return Object.freeze(sanitized);
}

export function buildHostWriteAuthorityIntegrateSliceEnvelope(request) {
  return Object.freeze({
    schema_version: HOST_WRITE_AUTHORITY_REQUEST_SCHEMA_VERSION,
    substrate_id: HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
    protocol_version: HOST_WRITE_AUTHORITY_SUBSTRATE_PROTOCOL_VERSION,
    op: HOST_WRITE_AUTHORITY_OPS.INTEGRATE_SLICE,
    integrate_request: buildHostWriteAuthorityIntegrateSliceRequest(request)
  });
}

export function buildHostWriteAuthorityPrepareSliceReviewSurfaceRequest(request) {
  if (!isPlainObject(request)) return Object.freeze({});
  const sanitized = {};
  for (const field of HOST_WRITE_AUTHORITY_PREPARE_SLICE_REVIEW_SURFACE_REQUEST_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(request, field)) {
      sanitized[field] = request[field];
    }
  }
  return Object.freeze(sanitized);
}

export function buildHostWriteAuthorityPrepareSliceReviewSurfaceEnvelope(request) {
  return Object.freeze({
    schema_version: HOST_WRITE_AUTHORITY_REQUEST_SCHEMA_VERSION,
    substrate_id: HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
    protocol_version: HOST_WRITE_AUTHORITY_SUBSTRATE_PROTOCOL_VERSION,
    op: HOST_WRITE_AUTHORITY_OPS.PREPARE_SLICE_REVIEW_SURFACE,
    prepare_request: buildHostWriteAuthorityPrepareSliceReviewSurfaceRequest(request)
  });
}

export function isCompletePrepareSliceReviewSurfaceRequestIdentity(request) {
  return exactObjectFields(
    request,
    HOST_WRITE_AUTHORITY_PREPARE_SLICE_REVIEW_SURFACE_REQUEST_FIELDS
  ) && isCompleteIntegrateSliceRequestIdentity(request) &&
    !request.run_id.endsWith(".slice") && !request.run_id.endsWith(".wk");
}

function exactObjectFields(value, fields) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every(
    (field) => Object.prototype.hasOwnProperty.call(value, field)
  );
}

export function validateSliceReviewSurfacePreparationResult(result, request) {
  if (!exactObjectFields(
    result,
    HOST_WRITE_AUTHORITY_SLICE_REVIEW_SURFACE_PREPARATION_RESULT_FIELDS
  )) {
    return {
      ok: false,
      detail: {
        issue: "slice_review_surface_preparation_result_shape_invalid",
        keys: isPlainObject(result) ? Object.keys(result).sort() : null
      }
    };
  }
  if (!isCompletePrepareSliceReviewSurfaceRequestIdentity(request) ||
      result.assigned_unit !== request.assigned_unit ||
      result.launch_ref !== request.launch_ref ||
      result.run_id !== request.run_id ||
      result.retry_id !== request.retry_id) {
    return { ok: false, detail: { issue: "slice_review_surface_preparation_tuple_mismatch" } };
  }
  const assigned = /^(WK-\d{4})#(SLICE-\d{3})$/u.exec(result.assigned_unit);
  const sliceRef = /^refs\/heads\/slice\/(IN-\d{4})\/(WK-\d{4})\/(SLICE-\d{3})$/u.exec(
    result.slice_ref
  );
  const canonicalPath = typeof result.worktree_path === "string" &&
    result.worktree_path.startsWith("/") &&
    !result.worktree_path.includes("\0") &&
    !/(?:^|\/)\.\.?\//u.test(result.worktree_path) &&
    !result.worktree_path.endsWith("/");
  const expectedBasename = sliceRef === null
    ? null
    : `slice-${sliceRef[1]}-${sliceRef[2]}-${sliceRef[3]}`;
  const actualBasename = canonicalPath ? result.worktree_path.split("/").at(-1) : null;
  const digestValid = typeof result.worktree_identity_digest === "string" &&
    /^sha256:[0-9a-f]{64}$/u.test(result.worktree_identity_digest);
  const objectsValid = [result.base_sha, result.reviewed_sha, result.reviewed_tree]
    .every((value) => isCanonicalGitObjectId(value));
  const partsValid = Array.isArray(result.verified_parts) &&
    result.verified_parts.length === SLICE_REVIEW_SURFACE_PREPARATION_VERIFIED_PARTS.length &&
    result.verified_parts.every(
      (part, index) => part === SLICE_REVIEW_SURFACE_PREPARATION_VERIFIED_PARTS[index]
    );
  if (result.schema_version !== SLICE_REVIEW_SURFACE_PREPARATION_SCHEMA_VERSION ||
      assigned === null || sliceRef === null ||
      assigned[1] !== sliceRef[2] || assigned[2] !== sliceRef[3] ||
      !canonicalPath || actualBasename !== expectedBasename ||
      !digestValid || !objectsValid || result.base_sha === result.reviewed_sha || !partsValid) {
    return {
      ok: false,
      detail: { issue: "slice_review_surface_preparation_result_invalid" }
    };
  }
  return { ok: true };
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

  if (
    response.kind === HOST_WRITE_AUTHORITY_RESPONSE_KINDS.WORKTREE_PROVISIONED &&
    expectedOp !== HOST_WRITE_AUTHORITY_OPS.PROVISION_WORKTREE
  ) {
    return {
      ok: false,
      reason: HOST_WRITE_AUTHORITY_REFUSAL_REASONS.RESPONSE_MALFORMED,
      detail: { issue: "worktree_provisioned_for_non_provision_op", expected_op: expectedOp ?? null }
    };
  }
  if (
    expectedOp === HOST_WRITE_AUTHORITY_OPS.PROVISION_WORKTREE &&
    (response.kind === HOST_WRITE_AUTHORITY_RESPONSE_KINDS.LAUNCH_ACCEPTED ||
      response.kind === HOST_WRITE_AUTHORITY_RESPONSE_KINDS.PROBE_RESULT)
  ) {
    return {
      ok: false,
      reason: HOST_WRITE_AUTHORITY_REFUSAL_REASONS.RESPONSE_MALFORMED,
      detail: { issue: "launch_or_probe_kind_for_provision_worktree", received_kind: response.kind }
    };
  }

  if (
    response.kind === HOST_WRITE_AUTHORITY_RESPONSE_KINDS.SLICE_COMMITTED &&
    expectedOp !== HOST_WRITE_AUTHORITY_OPS.COMMIT_SLICE
  ) {
    return {
      ok: false,
      reason: HOST_WRITE_AUTHORITY_REFUSAL_REASONS.RESPONSE_MALFORMED,
      detail: { issue: "slice_committed_for_non_commit_op", expected_op: expectedOp ?? null }
    };
  }
  if (
    expectedOp === HOST_WRITE_AUTHORITY_OPS.COMMIT_SLICE &&
    (response.kind === HOST_WRITE_AUTHORITY_RESPONSE_KINDS.LAUNCH_ACCEPTED ||
      response.kind === HOST_WRITE_AUTHORITY_RESPONSE_KINDS.PROBE_RESULT ||
      response.kind === HOST_WRITE_AUTHORITY_RESPONSE_KINDS.WORKTREE_PROVISIONED ||
      response.kind === HOST_WRITE_AUTHORITY_RESPONSE_KINDS.SLICE_REVIEW_SURFACE_PREPARED ||
      response.kind === HOST_WRITE_AUTHORITY_RESPONSE_KINDS.SLICE_INTEGRATED)
  ) {
    return {
      ok: false,
      reason: HOST_WRITE_AUTHORITY_REFUSAL_REASONS.RESPONSE_MALFORMED,
      detail: { issue: "non_commit_kind_for_commit_slice", received_kind: response.kind }
    };
  }

  if (
    response.kind === HOST_WRITE_AUTHORITY_RESPONSE_KINDS.SLICE_INTEGRATED &&
    expectedOp !== HOST_WRITE_AUTHORITY_OPS.INTEGRATE_SLICE
  ) {
    return {
      ok: false,
      reason: HOST_WRITE_AUTHORITY_REFUSAL_REASONS.RESPONSE_MALFORMED,
      detail: { issue: "slice_integrated_for_non_integrate_op", expected_op: expectedOp ?? null }
    };
  }
  if (
    expectedOp === HOST_WRITE_AUTHORITY_OPS.INTEGRATE_SLICE &&
    (response.kind === HOST_WRITE_AUTHORITY_RESPONSE_KINDS.LAUNCH_ACCEPTED ||
      response.kind === HOST_WRITE_AUTHORITY_RESPONSE_KINDS.PROBE_RESULT ||
      response.kind === HOST_WRITE_AUTHORITY_RESPONSE_KINDS.WORKTREE_PROVISIONED ||
      response.kind === HOST_WRITE_AUTHORITY_RESPONSE_KINDS.SLICE_COMMITTED ||
      response.kind === HOST_WRITE_AUTHORITY_RESPONSE_KINDS.SLICE_REVIEW_SURFACE_PREPARED)
  ) {
    return {
      ok: false,
      reason: HOST_WRITE_AUTHORITY_REFUSAL_REASONS.RESPONSE_MALFORMED,
      detail: { issue: "non_integrate_kind_for_integrate_slice", received_kind: response.kind }
    };
  }
  if (
    response.kind === HOST_WRITE_AUTHORITY_RESPONSE_KINDS.SLICE_REVIEW_SURFACE_PREPARED &&
    expectedOp !== HOST_WRITE_AUTHORITY_OPS.PREPARE_SLICE_REVIEW_SURFACE
  ) {
    return {
      ok: false,
      reason: HOST_WRITE_AUTHORITY_REFUSAL_REASONS.RESPONSE_MALFORMED,
      detail: { issue: "slice_review_surface_prepared_for_wrong_op", expected_op: expectedOp ?? null }
    };
  }
  if (
    expectedOp === HOST_WRITE_AUTHORITY_OPS.PREPARE_SLICE_REVIEW_SURFACE &&
    response.kind !== HOST_WRITE_AUTHORITY_RESPONSE_KINDS.SLICE_REVIEW_SURFACE_PREPARED &&
    response.kind !== HOST_WRITE_AUTHORITY_RESPONSE_KINDS.REFUSAL
  ) {
    return {
      ok: false,
      reason: HOST_WRITE_AUTHORITY_REFUSAL_REASONS.RESPONSE_MALFORMED,
      detail: { issue: "wrong_kind_for_prepare_slice_review_surface", received_kind: response.kind }
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
  if (response.kind === HOST_WRITE_AUTHORITY_RESPONSE_KINDS.WORKTREE_PROVISIONED) {

    const responseKeys = Object.keys(response);
    const outerExact =
      responseKeys.length === HOST_WRITE_AUTHORITY_WORKTREE_PROVISIONED_RESPONSE_FIELDS.length &&
      HOST_WRITE_AUTHORITY_WORKTREE_PROVISIONED_RESPONSE_FIELDS.every(
        (field) => Object.prototype.hasOwnProperty.call(response, field)
      );
    if (!outerExact) {
      return {
        ok: false,
        reason: HOST_WRITE_AUTHORITY_REFUSAL_REASONS.RESPONSE_MALFORMED,
        detail: { issue: "worktree_provisioned_outer_envelope_not_exact", keys: [...responseKeys].sort() }
      };
    }
    if (!isPlainObject(response.provisioning)) {
      return {
        ok: false,
        reason: HOST_WRITE_AUTHORITY_REFUSAL_REASONS.RESPONSE_MALFORMED,
        detail: { issue: "worktree_provisioned_carrier_missing" }
      };
    }
  }
  if (response.kind === HOST_WRITE_AUTHORITY_RESPONSE_KINDS.SLICE_COMMITTED) {

    const responseKeys = Object.keys(response);
    const outerExact =
      responseKeys.length === HOST_WRITE_AUTHORITY_SLICE_COMMITTED_RESPONSE_FIELDS.length &&
      HOST_WRITE_AUTHORITY_SLICE_COMMITTED_RESPONSE_FIELDS.every(
        (field) => Object.prototype.hasOwnProperty.call(response, field)
      );
    if (!outerExact) {
      return {
        ok: false,
        reason: HOST_WRITE_AUTHORITY_REFUSAL_REASONS.RESPONSE_MALFORMED,
        detail: { issue: "slice_committed_outer_envelope_not_exact", keys: [...responseKeys].sort() }
      };
    }
    if (!isPlainObject(response.commit_result)) {
      return {
        ok: false,
        reason: HOST_WRITE_AUTHORITY_REFUSAL_REASONS.RESPONSE_MALFORMED,
        detail: { issue: "slice_committed_result_missing" }
      };
    }
  }
  if (response.kind === HOST_WRITE_AUTHORITY_RESPONSE_KINDS.SLICE_INTEGRATED) {

    const responseKeys = Object.keys(response);
    const outerExact =
      responseKeys.length === HOST_WRITE_AUTHORITY_SLICE_INTEGRATED_RESPONSE_FIELDS.length &&
      HOST_WRITE_AUTHORITY_SLICE_INTEGRATED_RESPONSE_FIELDS.every(
        (field) => Object.prototype.hasOwnProperty.call(response, field)
      );
    if (!outerExact) {
      return {
        ok: false,
        reason: HOST_WRITE_AUTHORITY_REFUSAL_REASONS.RESPONSE_MALFORMED,
        detail: { issue: "slice_integrated_outer_envelope_not_exact", keys: [...responseKeys].sort() }
      };
    }
    if (!isPlainObject(response.integration)) {
      return {
        ok: false,
        reason: HOST_WRITE_AUTHORITY_REFUSAL_REASONS.RESPONSE_MALFORMED,
        detail: { issue: "slice_integrated_result_missing" }
      };
    }
  }
  if (response.kind === HOST_WRITE_AUTHORITY_RESPONSE_KINDS.SLICE_REVIEW_SURFACE_PREPARED) {
    const responseKeys = Object.keys(response);
    const outerExact = responseKeys.length ===
      HOST_WRITE_AUTHORITY_SLICE_REVIEW_SURFACE_PREPARED_RESPONSE_FIELDS.length &&
      HOST_WRITE_AUTHORITY_SLICE_REVIEW_SURFACE_PREPARED_RESPONSE_FIELDS.every(
        (field) => Object.prototype.hasOwnProperty.call(response, field)
      );
    if (!outerExact || !isPlainObject(response.preparation)) {
      return {
        ok: false,
        reason: HOST_WRITE_AUTHORITY_REFUSAL_REASONS.RESPONSE_MALFORMED,
        detail: {
          issue: "slice_review_surface_prepared_outer_envelope_invalid",
          keys: responseKeys.sort()
        }
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
