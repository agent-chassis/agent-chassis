

import {
  isPlainObject
} from "./protocol-constants.mjs";
import {
  isIntegrationOid,
  INTEGRATION_ASSIGNED_UNIT_RE,
  INTEGRATION_WK_REF_RE,
  INTEGRATION_SLICE_REF_RE,
  INTEGRATION_REVIEW_UNIT_ADDRESS_RE
} from "./request-envelopes-primitives.mjs";

import {
  TERMINAL_REVIEW_MATERIALIZATION_SCHEMA_VERSION,
  TERMINAL_REVIEW_VERIFY_PARTS
} from "./terminal-review-materialization.mjs";

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
  "tuple",
  "terminal_review_evidence"
]);

export const HOST_WRITE_AUTHORITY_SLICE_INTEGRATED_RECOVERY_FIELDS = Object.freeze([
  "recovered",
  "integrated_state"
]);

const INTEGRATION_RECOVERED_STATES = Object.freeze(["final", "non_final"]);

export const TERMINAL_REVIEW_EVIDENCE_SCHEMA_VERSION =
  "agent_launch.terminal_review_evidence.v1";

export const HOST_WRITE_AUTHORITY_TERMINAL_REVIEW_EVIDENCE_FIELDS = Object.freeze([
  "schema_version",
  "materialization",
  "review_target",
  "run",
  "wk_binding"
]);

const TERMINAL_REVIEW_EVIDENCE_MATERIALIZATION_FIELDS = Object.freeze([
  "schema_version",
  "worktree_path",
  "wk_ref",
  "reviewed_sha",
  "reviewed_tree",
  "verified",
  "verified_parts"
]);

const TERMINAL_REVIEW_EVIDENCE_RUN_FIELDS = Object.freeze([
  "assigned_unit",
  "launch_ref",
  "run_id",
  "retry_id"
]);

export const TERMINAL_REVIEW_EVIDENCE_WK_BINDING_SCHEMA_VERSION =
  "worktree-identity-binding.v1";

export const TERMINAL_REVIEW_EVIDENCE_WK_BINDING_FIELDS = Object.freeze([
  "schema_version",
  "run_id",
  "retry_id",
  "unit_address",
  "output_branch",
  "worktree_path",
  "base_ref",
  "base_sha"
]);

function hasExactFields(value, fields) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length === fields.length &&
    fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function validateTerminalReviewEvidence(evidence, integration, target, tuple) {
  if (!hasExactFields(evidence, HOST_WRITE_AUTHORITY_TERMINAL_REVIEW_EVIDENCE_FIELDS)) {
    return {
      ok: false,
      detail: {
        issue: "integration_terminal_review_evidence_fields_not_exact",
        keys: isPlainObject(evidence) ? Object.keys(evidence).sort() : null
      }
    };
  }
  if (evidence.schema_version !== TERMINAL_REVIEW_EVIDENCE_SCHEMA_VERSION) {
    return { ok: false, detail: { issue: "integration_terminal_review_evidence_schema_unknown" } };
  }

  const materialization = evidence.materialization;
  if (!hasExactFields(materialization, TERMINAL_REVIEW_EVIDENCE_MATERIALIZATION_FIELDS)) {
    return { ok: false, detail: { issue: "integration_terminal_review_materialization_fields_not_exact" } };
  }
  if (materialization.schema_version !== TERMINAL_REVIEW_MATERIALIZATION_SCHEMA_VERSION ||
      materialization.verified !== true ||
      !Array.isArray(materialization.verified_parts) ||
      materialization.verified_parts.length !== TERMINAL_REVIEW_VERIFY_PARTS.length ||
      materialization.verified_parts.some((part, index) => part !== TERMINAL_REVIEW_VERIFY_PARTS[index])) {
    return { ok: false, detail: { issue: "integration_terminal_review_materialization_not_verified" } };
  }
  if (!isIntegrationOid(materialization.reviewed_sha) || !isIntegrationOid(materialization.reviewed_tree)) {
    return { ok: false, detail: { issue: "integration_terminal_review_materialization_object_id_malformed" } };
  }
  if (!isNonEmptyString(materialization.worktree_path)) {
    return { ok: false, detail: { issue: "integration_terminal_review_materialization_worktree_path_invalid" } };
  }

  if (materialization.wk_ref !== integration.wk_ref) {
    return { ok: false, detail: { issue: "integration_terminal_review_materialization_ref_mismatch" } };
  }
  if (materialization.reviewed_sha !== integration.wk_sha) {
    return { ok: false, detail: { issue: "integration_terminal_review_materialization_sha_mismatch" } };
  }

  const echoedTarget = evidence.review_target;
  if (!hasExactFields(echoedTarget, HOST_WRITE_AUTHORITY_INTEGRATION_REVIEW_TARGET_FIELDS)) {
    return { ok: false, detail: { issue: "integration_terminal_review_evidence_target_fields_not_exact" } };
  }
  for (const field of HOST_WRITE_AUTHORITY_INTEGRATION_REVIEW_TARGET_FIELDS) {
    if (echoedTarget[field] !== target[field]) {
      return {
        ok: false,
        detail: { issue: "integration_terminal_review_evidence_target_mismatch", field }
      };
    }
  }

  const run = evidence.run;
  if (!hasExactFields(run, TERMINAL_REVIEW_EVIDENCE_RUN_FIELDS)) {
    return { ok: false, detail: { issue: "integration_terminal_review_evidence_run_fields_not_exact" } };
  }
  for (const field of TERMINAL_REVIEW_EVIDENCE_RUN_FIELDS) {
    if (run[field] !== tuple[field]) {
      return {
        ok: false,
        detail: { issue: "integration_terminal_review_evidence_run_mismatch", field }
      };
    }
  }

  const wkBinding = evidence.wk_binding;
  if (!hasExactFields(wkBinding, TERMINAL_REVIEW_EVIDENCE_WK_BINDING_FIELDS)) {
    return { ok: false, detail: { issue: "integration_terminal_review_evidence_wk_binding_fields_not_exact" } };
  }

  if (wkBinding.schema_version !== TERMINAL_REVIEW_EVIDENCE_WK_BINDING_SCHEMA_VERSION) {
    return { ok: false, detail: { issue: "integration_terminal_review_evidence_wk_binding_schema_unknown" } };
  }
  if (!isNonEmptyString(wkBinding.base_ref) ||
      !isIntegrationOid(wkBinding.base_sha)) {
    return { ok: false, detail: { issue: "integration_terminal_review_evidence_wk_binding_malformed" } };
  }
  if (wkBinding.run_id !== `${tuple.run_id}.wk` || wkBinding.retry_id !== tuple.retry_id) {
    return { ok: false, detail: { issue: "integration_terminal_review_evidence_wk_binding_run_mismatch" } };
  }
  const wkRefMatch = INTEGRATION_WK_REF_RE.exec(integration.wk_ref);
  const boundUnitMatch = typeof wkBinding.unit_address === "string"
    ? INTEGRATION_REVIEW_UNIT_ADDRESS_RE.exec(wkBinding.unit_address)
    : null;
  if (!boundUnitMatch || boundUnitMatch[1] !== wkRefMatch[1] || boundUnitMatch[2] !== wkRefMatch[2]) {
    return { ok: false, detail: { issue: "integration_terminal_review_evidence_wk_binding_unit_mismatch" } };
  }

  const boundBranch = wkBinding.output_branch;
  if (!isNonEmptyString(boundBranch)) {
    return { ok: false, detail: { issue: "integration_terminal_review_evidence_wk_binding_branch_invalid" } };
  }
  const normalizedBoundBranch = boundBranch.startsWith("refs/heads/") ? boundBranch : `refs/heads/${boundBranch}`;
  if (normalizedBoundBranch !== integration.wk_ref) {
    return { ok: false, detail: { issue: "integration_terminal_review_evidence_wk_binding_branch_mismatch" } };
  }
  if (wkBinding.worktree_path !== materialization.worktree_path) {
    return { ok: false, detail: { issue: "integration_terminal_review_evidence_wk_binding_path_mismatch" } };
  }
  return { ok: true };
}

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

export function validateSliceIntegratedResult(integration, boundTuple) {
  if (!isPlainObject(integration)) {
    return { ok: false, detail: { issue: "integration_not_object" } };
  }
  const keys = Object.keys(integration);

  const hasRecoveryPair = HOST_WRITE_AUTHORITY_SLICE_INTEGRATED_RECOVERY_FIELDS.every(
    (field) => Object.prototype.hasOwnProperty.call(integration, field)
  );
  const admissibleFields = hasRecoveryPair
    ? [
        ...HOST_WRITE_AUTHORITY_SLICE_INTEGRATED_RESULT_FIELDS,
        ...HOST_WRITE_AUTHORITY_SLICE_INTEGRATED_RECOVERY_FIELDS
      ]
    : HOST_WRITE_AUTHORITY_SLICE_INTEGRATED_RESULT_FIELDS;
  const exact = keys.length === admissibleFields.length &&
    admissibleFields.every((field) => Object.prototype.hasOwnProperty.call(integration, field));
  if (!exact) {
    return { ok: false, detail: { issue: "integration_fields_not_exact", keys: [...keys].sort() } };
  }
  if (integration.integrated !== true) {
    return { ok: false, detail: { issue: "integration_not_integrated" } };
  }
  if (typeof integration.rebased !== "boolean") {
    return { ok: false, detail: { issue: "integration_rebased_not_boolean" } };
  }

  if (hasRecoveryPair) {
    if (integration.recovered !== true) {
      return { ok: false, detail: { issue: "integration_recovered_flag_invalid" } };
    }
    if (!INTEGRATION_RECOVERED_STATES.includes(integration.integrated_state)) {
      return { ok: false, detail: { issue: "integration_recovered_state_invalid" } };
    }
  }
  for (const oidField of ["slice_sha", "wk_sha"]) {
    if (!isIntegrationOid(integration[oidField])) {
      return { ok: false, detail: { issue: "integration_object_id_malformed", field: oidField } };
    }
  }

  if (hasRecoveryPair) {
    if (integration.previous_wk_sha !== null) {
      return { ok: false, detail: { issue: "integration_recovered_previous_wk_sha_not_null" } };
    }
  } else if (!isIntegrationOid(integration.previous_wk_sha)) {
    return { ok: false, detail: { issue: "integration_object_id_malformed", field: "previous_wk_sha" } };
  }

  if (integration.review_target !== null && integration.slice_sha !== integration.wk_sha) {
    return { ok: false, detail: { issue: "integration_terminal_target_not_tip_owner" } };
  }

  if (integration.review_target !== null && hasRecoveryPair &&
      integration.integrated_state !== "final") {
    return { ok: false, detail: { issue: "integration_recovered_state_contradicts_target" } };
  }

  if (integration.slice_sha !== integration.wk_sha) {
    if (!hasRecoveryPair || integration.integrated_state !== "non_final") {
      return { ok: false, detail: { issue: "integration_slice_wk_sha_disagree" } };
    }

    if (integration.terminal_review_evidence !== null) {
      return { ok: false, detail: { issue: "integration_historical_recovery_carries_terminal_evidence" } };
    }
    if (integration.rebased !== false) {
      return { ok: false, detail: { issue: "integration_historical_recovery_claims_rebase" } };
    }

    const transition = integration.transition;
    if (!isPlainObject(transition) ||
        transition.valid !== true ||
        transition.written !== false ||
        transition.no_op !== true ||
        transition.recovered !== true ||
        transition.status !== "done") {
      return { ok: false, detail: { issue: "integration_historical_recovery_transition_invalid" } };
    }
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
  if (target !== null) {

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
  } else if (integration.terminal_review_evidence !== null) {

    return { ok: false, detail: { issue: "integration_terminal_review_evidence_present_on_non_final" } };
  }

  if (!isPlainObject(integration.transition)) {
    return { ok: false, detail: { issue: "integration_transition_not_object" } };
  }

  if (hasRecoveryPair) {
    const transition = integration.transition;
    if (transition.valid !== true ||
        transition.written !== false ||
        transition.no_op !== true ||
        transition.recovered !== true) {
      return { ok: false, detail: { issue: "integration_recovered_transition_not_no_op" } };
    }
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

  if (target !== null) {
    const evidenceCheck = validateTerminalReviewEvidence(
      integration.terminal_review_evidence, integration, target, tuple
    );
    if (!evidenceCheck.ok) return evidenceCheck;
  }
  return { ok: true };
}
