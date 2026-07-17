

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

export const HOST_WRITE_AUTHORITY_SLICE_COMMITTED_RESULT_FIELDS = Object.freeze([
  "committed",
  "submitted_for_review",
  "assigned_unit",
  "commit",
  "tree",
  "base_sha",
  "ref",
  "idempotent",
  "changed_paths",
  "metrics",
  "baseline",
  "attestation",
  "expected_envelope_invariant",
  "transition"
]);

const CANONICAL_GIT_OBJECT_ID_RE = /^[0-9a-f]{40}$/u;
export function isCanonicalGitObjectId(value) {
  return typeof value === "string" && CANONICAL_GIT_OBJECT_ID_RE.test(value);
}

const COMMIT_RESULT_ASSIGNED_UNIT_RE = /^(WK-\d{4})#(SLICE-\d{3})$/u;
const CANONICAL_SLICE_OUTPUT_REF_RE =
  /^refs\/heads\/slice\/(IN-\d{4})\/(WK-\d{4})\/(SLICE-\d{3})$/u;

export function isCompleteCommitSliceRequestIdentity(identity) {
  return isPlainObject(identity) &&
    typeof identity.assigned_unit === "string" &&
    COMMIT_RESULT_ASSIGNED_UNIT_RE.test(identity.assigned_unit) &&
    typeof identity.launch_ref === "string" && identity.launch_ref.length > 0 &&
    typeof identity.run_id === "string" && identity.run_id.length > 0 &&
    Number.isInteger(identity.retry_id) && identity.retry_id >= 0;
}

export function validateSliceCommittedCommitResult(commitResult, boundAssignedUnit) {
  if (!isPlainObject(commitResult)) {
    return { ok: false, detail: { issue: "commit_result_not_object" } };
  }
  const keys = Object.keys(commitResult);
  const exact =
    keys.length === HOST_WRITE_AUTHORITY_SLICE_COMMITTED_RESULT_FIELDS.length &&
    HOST_WRITE_AUTHORITY_SLICE_COMMITTED_RESULT_FIELDS.every(
      (field) => Object.prototype.hasOwnProperty.call(commitResult, field)
    );
  if (!exact) {
    return {
      ok: false,
      detail: { issue: "commit_result_fields_not_exact", keys: [...keys].sort() }
    };
  }

  if (commitResult.committed !== true) {
    return { ok: false, detail: { issue: "commit_result_not_committed" } };
  }
  if (commitResult.submitted_for_review !== false) {
    return { ok: false, detail: { issue: "commit_result_submitted_for_review_invalid" } };
  }

  for (const oidField of ["commit", "tree", "base_sha"]) {
    if (!isCanonicalGitObjectId(commitResult[oidField])) {
      return {
        ok: false,
        detail: { issue: "commit_result_object_id_malformed", field: oidField }
      };
    }
  }

  const unitMatch = COMMIT_RESULT_ASSIGNED_UNIT_RE.exec(commitResult.assigned_unit);
  if (!unitMatch) {
    return { ok: false, detail: { issue: "commit_result_assigned_unit_malformed" } };
  }

  const refMatch = typeof commitResult.ref === "string"
    ? CANONICAL_SLICE_OUTPUT_REF_RE.exec(commitResult.ref)
    : null;
  if (!refMatch) {
    return { ok: false, detail: { issue: "commit_result_ref_malformed" } };
  }
  if (refMatch[2] !== unitMatch[1] || refMatch[3] !== unitMatch[2]) {
    return { ok: false, detail: { issue: "commit_result_ref_unit_mismatch" } };
  }

  if (typeof commitResult.idempotent !== "boolean") {
    return { ok: false, detail: { issue: "commit_result_idempotent_not_boolean" } };
  }
  if (!Array.isArray(commitResult.changed_paths)) {
    return { ok: false, detail: { issue: "commit_result_changed_paths_not_array" } };
  }
  for (const objField of [
    "metrics",
    "baseline",
    "attestation",
    "expected_envelope_invariant",
    "transition"
  ]) {
    if (!isPlainObject(commitResult[objField])) {
      return {
        ok: false,
        detail: { issue: "commit_result_nested_object_invalid", field: objField }
      };
    }
  }

  if (commitResult.assigned_unit !== boundAssignedUnit) {
    return {
      ok: false,
      detail: {
        issue: "commit_result_unit_not_bound_to_request",
        expected: typeof boundAssignedUnit === "string" ? boundAssignedUnit : null,
        received: commitResult.assigned_unit
      }
    };
  }
  return { ok: true };
}

export const HOST_WRITE_AUTHORITY_INTEGRATE_SLICE_REQUEST_FIELDS = Object.freeze([
  "assigned_unit",
  "launch_ref",
  "run_id",
  "retry_id"
]);

const HOST_WRITE_AUTHORITY_SLICE_INTEGRATED_RESPONSE_FIELDS = Object.freeze([
  "schema_version",
  "substrate_id",
  "protocol_version",
  "kind",
  "integration"
]);

export const HOST_WRITE_AUTHORITY_SLICE_INTEGRATED_RESULT_FIELDS = Object.freeze([
  "schema_version",
  "integrated",
  "rebased",
  "previous_wk_sha",
  "slice_ref",
  "slice_sha",
  "wk_ref",
  "wk_sha",
  "review_target",
  "transition",
  "tuple"
]);

const HOST_WRITE_AUTHORITY_INTEGRATION_REVIEW_TARGET_FIELDS = Object.freeze([
  "schema_version",
  "unit_address",
  "ref",
  "sha",
  "diff_base_sha",
  "diff_head_sha",
  "diff_range",
  "complete_parent_wk_contract",
  "accumulated_wk_diff"
]);

const HOST_WRITE_AUTHORITY_INTEGRATION_TUPLE_FIELDS = Object.freeze([
  "assigned_unit",
  "launch_ref",
  "run_id",
  "retry_id"
]);

const INTEGRATION_OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
function isIntegrationOid(value) {
  return typeof value === "string" && INTEGRATION_OID_RE.test(value) && !/^0+$/u.test(value);
}
const INTEGRATION_ASSIGNED_UNIT_RE = /^(WK-\d{4})#(SLICE-\d{3})$/u;
const INTEGRATION_WK_REF_RE = /^refs\/heads\/wk\/(IN-\d{4})\/(WK-\d{4})$/u;
const INTEGRATION_SLICE_REF_RE = /^refs\/heads\/slice\/(IN-\d{4})\/(WK-\d{4})\/(SLICE-\d{3})$/u;
const INTEGRATION_REVIEW_UNIT_ADDRESS_RE = /^(IN-\d{4})\/(WK-\d{4})$/u;

export function isCompleteIntegrateSliceRequestIdentity(identity) {
  return isPlainObject(identity) &&
    typeof identity.assigned_unit === "string" &&
    INTEGRATION_ASSIGNED_UNIT_RE.test(identity.assigned_unit) &&
    typeof identity.launch_ref === "string" && identity.launch_ref.length > 0 &&
    typeof identity.run_id === "string" && identity.run_id.length > 0 &&
    Number.isInteger(identity.retry_id) && identity.retry_id >= 0;
}

export function validateSliceIntegratedResult(integration, boundTuple) {
  if (!isPlainObject(integration)) {
    return { ok: false, detail: { issue: "integration_not_object" } };
  }
  const keys = Object.keys(integration);
  const exact = keys.length === HOST_WRITE_AUTHORITY_SLICE_INTEGRATED_RESULT_FIELDS.length &&
    HOST_WRITE_AUTHORITY_SLICE_INTEGRATED_RESULT_FIELDS.every(
      (field) => Object.prototype.hasOwnProperty.call(integration, field)
    );
  if (!exact) {
    return { ok: false, detail: { issue: "integration_fields_not_exact", keys: [...keys].sort() } };
  }
  if (integration.integrated !== true) {
    return { ok: false, detail: { issue: "integration_not_integrated" } };
  }
  if (typeof integration.rebased !== "boolean") {
    return { ok: false, detail: { issue: "integration_rebased_not_boolean" } };
  }
  for (const oidField of ["previous_wk_sha", "slice_sha", "wk_sha"]) {
    if (!isIntegrationOid(integration[oidField])) {
      return { ok: false, detail: { issue: "integration_object_id_malformed", field: oidField } };
    }
  }

  if (integration.slice_sha !== integration.wk_sha) {
    return { ok: false, detail: { issue: "integration_slice_wk_sha_disagree" } };
  }
  const sliceMatch = typeof integration.slice_ref === "string"
    ? INTEGRATION_SLICE_REF_RE.exec(integration.slice_ref)
    : null;
  if (!sliceMatch) {
    return { ok: false, detail: { issue: "integration_slice_ref_malformed" } };
  }
  const wkMatch = typeof integration.wk_ref === "string"
    ? INTEGRATION_WK_REF_RE.exec(integration.wk_ref)
    : null;
  if (!wkMatch) {
    return { ok: false, detail: { issue: "integration_wk_ref_malformed" } };
  }

  if (sliceMatch[1] !== wkMatch[1] || sliceMatch[2] !== wkMatch[2]) {
    return { ok: false, detail: { issue: "integration_slice_wk_ref_mismatch" } };
  }

  const target = integration.review_target;
  if (!isPlainObject(target)) {
    return { ok: false, detail: { issue: "integration_review_target_not_object" } };
  }
  const targetKeys = Object.keys(target);
  const targetExact = targetKeys.length === HOST_WRITE_AUTHORITY_INTEGRATION_REVIEW_TARGET_FIELDS.length &&
    HOST_WRITE_AUTHORITY_INTEGRATION_REVIEW_TARGET_FIELDS.every(
      (field) => Object.prototype.hasOwnProperty.call(target, field)
    );
  if (!targetExact) {
    return { ok: false, detail: { issue: "integration_review_target_fields_not_exact", keys: [...targetKeys].sort() } };
  }
  const targetUnitMatch = typeof target.unit_address === "string"
    ? INTEGRATION_REVIEW_UNIT_ADDRESS_RE.exec(target.unit_address)
    : null;
  if (!targetUnitMatch || targetUnitMatch[1] !== wkMatch[1] || targetUnitMatch[2] !== wkMatch[2]) {
    return { ok: false, detail: { issue: "integration_review_target_unit_mismatch" } };
  }
  if (target.ref !== integration.wk_ref) {
    return { ok: false, detail: { issue: "integration_review_target_ref_mismatch" } };
  }
  if (target.sha !== integration.wk_sha || !isIntegrationOid(target.sha)) {
    return { ok: false, detail: { issue: "integration_review_target_sha_mismatch" } };
  }
  if (!isIntegrationOid(target.diff_base_sha)) {
    return { ok: false, detail: { issue: "integration_review_target_diff_base_malformed" } };
  }
  if (target.diff_head_sha !== integration.wk_sha) {
    return { ok: false, detail: { issue: "integration_review_target_diff_head_mismatch" } };
  }
  if (target.diff_range !== `${target.diff_base_sha}..${integration.wk_sha}`) {
    return { ok: false, detail: { issue: "integration_review_target_diff_range_mismatch" } };
  }
  if (target.complete_parent_wk_contract !== true || target.accumulated_wk_diff !== true) {
    return { ok: false, detail: { issue: "integration_review_target_contract_flags_invalid" } };
  }

  if (!isPlainObject(integration.transition)) {
    return { ok: false, detail: { issue: "integration_transition_not_object" } };
  }

  const tuple = integration.tuple;
  if (!isPlainObject(tuple)) {
    return { ok: false, detail: { issue: "integration_tuple_not_object" } };
  }
  const tupleKeys = Object.keys(tuple);
  const tupleExact = tupleKeys.length === HOST_WRITE_AUTHORITY_INTEGRATION_TUPLE_FIELDS.length &&
    HOST_WRITE_AUTHORITY_INTEGRATION_TUPLE_FIELDS.every(
      (field) => Object.prototype.hasOwnProperty.call(tuple, field)
    );
  if (!tupleExact) {
    return { ok: false, detail: { issue: "integration_tuple_fields_not_exact", keys: [...tupleKeys].sort() } };
  }
  if (!isPlainObject(boundTuple)) {
    return { ok: false, detail: { issue: "integration_bound_tuple_missing" } };
  }
  for (const field of HOST_WRITE_AUTHORITY_INTEGRATION_TUPLE_FIELDS) {
    if (tuple[field] !== boundTuple[field]) {
      return {
        ok: false,
        detail: {
          issue: "integration_tuple_not_bound_to_request",
          field,
          expected: boundTuple[field] ?? null,
          received: tuple[field] ?? null
        }
      };
    }
  }

  const requestedUnit = INTEGRATION_ASSIGNED_UNIT_RE.exec(
    typeof boundTuple.assigned_unit === "string" ? boundTuple.assigned_unit : ""
  );
  if (!requestedUnit || requestedUnit[1] !== wkMatch[2] || requestedUnit[2] !== sliceMatch[3]) {
    return { ok: false, detail: { issue: "integration_unit_not_bound_to_request" } };
  }
  return { ok: true };
}

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
      response.kind === HOST_WRITE_AUTHORITY_RESPONSE_KINDS.SLICE_COMMITTED)
  ) {
    return {
      ok: false,
      reason: HOST_WRITE_AUTHORITY_REFUSAL_REASONS.RESPONSE_MALFORMED,
      detail: { issue: "non_integrate_kind_for_integrate_slice", received_kind: response.kind }
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
