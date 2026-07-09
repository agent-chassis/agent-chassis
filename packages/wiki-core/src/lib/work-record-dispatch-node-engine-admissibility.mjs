

import {
  executeWorkerAdmissionDomainPackValidation,
  NODE_ENGINE_WORKER_ADMISSION_RATIFIED_BINDING_STATUS,
  resolveClientConfig,
  resolveWorkerAdmissionRoute
} from "./node-engine-api-client.mjs";
import {
  createSelectedUnitWorkerAdmissionDomainPackInput,
  NODE_ENGINE_UNRATIFIED_PLACEHOLDER
} from "./work-record-admission-derived-evidence.mjs";
import {
  createReviewAttestationBindingFromRemoteNeedsReview,
  preserveFirstPassReviewThresholdReasonsForOpaqueRetryResult
} from "./review-attestation-pack-carry.mjs";
import {
  clone,
  isNonEmptyString,
  isObject
} from "./work-record-dispatch-shared.mjs";

import { BOUNDED_EXTRACTION_REFACTOR_PREDICATE } from "./work-record-admission-record-inputs.mjs";

export const NODE_ENGINE_ADMISSIBILITY_UNDETERMINED_DECISION_CODE =
  "node_engine_admissibility_undetermined";
export const NODE_ENGINE_ADMISSIBILITY_UNAVAILABLE_DECISION_CODE =
  "node_engine_admissibility_unavailable";
export const NODE_ENGINE_ADMISSIBILITY_DENIED_DECISION_CODE =
  "node_engine_admissibility_denied";
export const NODE_ENGINE_ADMISSIBILITY_NEEDS_REVIEW_DECISION_CODE =
  "node_engine_admissibility_needs_review";

export const NODE_ENGINE_ADMISSIBILITY_UNRATIFIED_DECISION_CODE =
  "node_engine_admissibility_unratified";

const NODE_ENGINE_NON_PACK_ADMISSIBILITY_MAP = Object.freeze({
  service_url_unconfigured: ["unavailable", "node_engine_config_unavailable"],
  api_key_unconfigured: ["unavailable", "node_engine_config_unavailable"],
  route_unratified_placeholder: ["unavailable", "node_engine_route_unratified"],
  request_contract_digest_missing: ["unavailable", "node_engine_request_contract_unbound"],
  pack_input_missing: ["unavailable", "node_engine_pack_input_missing"],
  pack_input_assembly_failed: ["unavailable", "node_engine_pack_input_assembly_failed"],
  auth_rejected: ["undetermined", "node_engine_auth_rejected"],
  entitlement_rejected: ["undetermined", "node_engine_entitlement_rejected"],
  invalid_request: ["undetermined", "node_engine_request_invalid"],
  pack_input_required: ["undetermined", "node_engine_pack_input_required"],
  pack_input_invalid: ["undetermined", "node_engine_pack_input_invalid"],
  request_schema_digest_mismatch: [
    "undetermined",
    "node_engine_request_schema_digest_mismatch"
  ],
  precondition_graph_too_large: [
    "undetermined",
    "node_engine_precondition_graph_too_large"
  ],
  non_object_data: ["undetermined", "node_engine_non_object_data"],
  non_json: ["undetermined", "node_engine_unrecognized_response"],
  problem: ["undetermined", "node_engine_unrecognized_response"],
  malformed_result: ["undetermined", "node_engine_unrecognized_response"],
  availability_failure: ["unavailable", "node_engine_unavailable"],
  timeout_abort: ["unavailable", "node_engine_unavailable"],
  transport_failure: ["unavailable", "node_engine_unavailable"]
});

function buildNodeEngineAdmissibilityOutcome(status, admissible, diagnosticCode, extra = {}) {
  return {
    evaluated: true,
    authority: "node_engine",
    status,
    admissible: admissible === true,
    effect: isNonEmptyString(extra.effect) ? extra.effect : null,
    pack_backed: extra.pack_backed === true,
    node_engine_backed: extra.node_engine_backed === true,

    binding_status: isNonEmptyString(extra.binding_status) ? extra.binding_status : null,
    ratified: extra.ratified === true,
    diagnostic_code: diagnosticCode,
    reasons: Array.isArray(extra.reasons) ? extra.reasons : [],
    ...(isObject(extra.recovery) ? { recovery: extra.recovery } : {}),
    ...(typeof extra.authenticated_request_sent === "boolean"
      ? { authenticated_request_sent: extra.authenticated_request_sent }
      : {})
  };
}

function packResultIsRatified(packResult) {
  if (!isObject(packResult)) {
    return false;
  }
  if (packResult.node_engine_binding_ratified === true) {
    return true;
  }
  return packResult.node_engine_binding_status === NODE_ENGINE_WORKER_ADMISSION_RATIFIED_BINDING_STATUS;
}

const KNOWN_NODE_ENGINE_BINDING_STATUSES = new Set([
  NODE_ENGINE_WORKER_ADMISSION_RATIFIED_BINDING_STATUS,
  NODE_ENGINE_UNRATIFIED_PLACEHOLDER
]);

const NEEDS_REVIEW_REVIEW_THRESHOLD_TAXONOMY_CODE =
  "worker_admission_review_threshold_exceeded";

const REVIEW_THRESHOLD_REASON_CODES = new Set([
  "review_threshold_exceeded",
  "worker_admission.work_unit_atomicity.review_threshold_exceeded.v1"
]);

const ALLOWED_NEEDS_REVIEW_REASON_CODES = new Set([
  ...REVIEW_THRESHOLD_REASON_CODES,
  "request_schema_unrecognized"
]);

const ALLOWED_PUBLIC_REASON_CODES = new Set([
  ...ALLOWED_NEEDS_REVIEW_REASON_CODES,
  "worker_admission.work_unit_atomicity.write_scope_count_denied.v1"
]);

const ALLOWED_NEEDS_REVIEW_CONTROL_IDS = new Set([
  "write_scope_total_loc",
  "max_write_file_loc",
  "write_scope_count",
  "acceptance_criteria_count",
  "validation_command_count",
  "expected_changed_line_budget",
  "expected_edit_targets",
  "declared_runtime_mode_count",
  "artifact_kind_count"
]);

const ALLOWED_NEEDS_REVIEW_REASON_FIELDS = new Set([
  ...ALLOWED_NEEDS_REVIEW_CONTROL_IDS,
  "accepted_authority",
  "accepted_authorities",
  "review_attestation",
  "review_attestations",
  "request_schema",
  "request_contract_digest"
]);

const NEEDS_REVIEW_REASON_FAMILIES = Object.freeze([
  ["accepted_authority_", "accepted_authority_failure"],
  ["review_attestation_", "review_attestation_failure"]
]);

const SAFE_REASON_TOKEN_PATTERN = /^[a-z][a-z0-9_]{0,119}$/u;
const SAFE_EVIDENCE_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,119}$/u;
const BOUNDED_REASON_OBSERVED_STRING_MAX = 256;
const WORKER_ADMISSION_RECOVERY_SCHEMA_VERSION = "worker_admission.recovery.v1";
const WORKER_ADMISSION_RECOVERY_AUTHORITY = "advisory_recovery_only";
const WORKER_ADMISSION_RECOVERY_ACTION_SUMMARY_MAX = 16;
const WORKER_ADMISSION_RECOVERY_TOKEN_MAX = 24;
const WORKER_ADMISSION_RECOVERY_TOKEN_LENGTH_MAX = 128;
const WORKER_ADMISSION_RECOVERY_NEXT_ACTION_MAX = 240;
const WORKER_ADMISSION_RECOVERY_PROJECTION_MODES = new Set([
  "bounded_current_decision_recovery",
  "route_problem_recovery"
]);
const WORKER_ADMISSION_RECOVERY_ACTION_KINDS = new Set([
  "obtain_review_attestation",
  "obtain_accepted_authority",
  "split_or_reduce_scope",
  "fix_metrics",
  "fix_local_hard_refusal",
  "fix_precondition_graph",
  "wait_for_dependency",
  "fix_request_schema_digest",
  "fix_pack_input",
  "fix_non_object_data",
  "fix_precondition_graph_too_large",
  "fix_preparation_audit",
  "fix_evidence_trust",
  "fix_policy_profile",
  "provide_idempotency_key"
]);
const WORKER_ADMISSION_RECOVERY_TOP_LEVEL_FIELDS = new Set([
  "schema_version",
  "projection_mode",
  "authority",
  "requires_resubmission",
  "truncated",
  "actions"
]);
const WORKER_ADMISSION_RECOVERY_ACTION_FIELDS = new Set([
  "kind",
  "reason_codes",
  "problem_types",
  "fields",
  "controls",
  "next_action"
]);

function clampNodeEngineBindingStatus(value) {
  return KNOWN_NODE_ENGINE_BINDING_STATUSES.has(value) ? value : null;
}

function allowlistNeedsReviewReasonCode(value) {
  if (!isNonEmptyString(value)) {
    return null;
  }
  const trimmed = value.trim();
  if (ALLOWED_NEEDS_REVIEW_REASON_CODES.has(trimmed)) {
    return trimmed;
  }
  if (
    SAFE_REASON_TOKEN_PATTERN.test(trimmed) &&
    NEEDS_REVIEW_REASON_FAMILIES.some(([prefix]) => trimmed.startsWith(prefix))
  ) {
    return trimmed;
  }
  return null;
}

function allowlistPublicReasonCode(value) {
  if (!isNonEmptyString(value)) {
    return null;
  }
  const trimmed = value.trim();
  return ALLOWED_PUBLIC_REASON_CODES.has(trimmed) || allowlistNeedsReviewReasonCode(trimmed)
    ? trimmed
    : null;
}

function allowlistNeedsReviewControlId(value) {
  if (!isNonEmptyString(value)) {
    return null;
  }
  const trimmed = value.trim();
  return ALLOWED_NEEDS_REVIEW_CONTROL_IDS.has(trimmed) ? trimmed : null;
}

function allowlistNeedsReviewReasonField(value) {
  if (!isNonEmptyString(value)) {
    return null;
  }
  const trimmed = value.trim();
  return ALLOWED_NEEDS_REVIEW_REASON_FIELDS.has(trimmed) ? trimmed : null;
}

function classifyNeedsReviewReasonFamily(reasonCode) {
  if (reasonCode === "request_schema_unrecognized") {
    return "request_schema_unrecognized";
  }
  for (const [prefix, family] of NEEDS_REVIEW_REASON_FAMILIES) {
    if (reasonCode.startsWith(prefix)) {
      return family;
    }
  }
  return null;
}

function hasOnlyAllowedFields(object, allowedFields) {
  return Object.keys(object).every((key) => allowedFields.has(key));
}

function projectWorkerAdmissionRecoveryTokenList(value) {
  if (value === undefined) {
    return { valid: true, value: undefined };
  }
  if (!Array.isArray(value) || value.length > WORKER_ADMISSION_RECOVERY_TOKEN_MAX) {
    return { valid: false };
  }
  const tokens = [];
  for (const item of value) {
    if (
      !isNonEmptyString(item) ||
      item.length > WORKER_ADMISSION_RECOVERY_TOKEN_LENGTH_MAX
    ) {
      return { valid: false };
    }
    tokens.push(item);
  }
  return { valid: true, value: tokens };
}

function projectWorkerAdmissionRecoveryAction(action) {
  if (!isObject(action) || !hasOnlyAllowedFields(action, WORKER_ADMISSION_RECOVERY_ACTION_FIELDS)) {
    return null;
  }
  if (
    !isNonEmptyString(action.kind) ||
    !WORKER_ADMISSION_RECOVERY_ACTION_KINDS.has(action.kind)
  ) {
    return null;
  }
  const projected = { kind: action.kind };
  for (const key of ["reason_codes", "problem_types", "fields", "controls"]) {
    const tokens = projectWorkerAdmissionRecoveryTokenList(action[key]);
    if (!tokens.valid) {
      return null;
    }
    if (tokens.value !== undefined) {
      projected[key] = tokens.value;
    }
  }
  if (action.next_action !== undefined) {
    if (
      !isNonEmptyString(action.next_action) ||
      action.next_action.length > WORKER_ADMISSION_RECOVERY_NEXT_ACTION_MAX
    ) {
      return null;
    }
    projected.next_action = action.next_action;
  }
  return projected;
}

function projectWorkerAdmissionRecoverySummary(recovery) {
  if (
    !isObject(recovery) ||
    !hasOnlyAllowedFields(recovery, WORKER_ADMISSION_RECOVERY_TOP_LEVEL_FIELDS)
  ) {
    return null;
  }
  if (recovery.schema_version !== WORKER_ADMISSION_RECOVERY_SCHEMA_VERSION) {
    return null;
  }
  if (!WORKER_ADMISSION_RECOVERY_PROJECTION_MODES.has(recovery.projection_mode)) {
    return null;
  }
  if (recovery.authority !== WORKER_ADMISSION_RECOVERY_AUTHORITY) {
    return null;
  }
  if (recovery.requires_resubmission !== true || typeof recovery.truncated !== "boolean") {
    return null;
  }
  if (
    !Array.isArray(recovery.actions) ||
    recovery.actions.length === 0 ||
    recovery.actions.length > WORKER_ADMISSION_RECOVERY_ACTION_SUMMARY_MAX
  ) {
    return null;
  }
  const actions = recovery.actions.map((action) => projectWorkerAdmissionRecoveryAction(action));
  if (actions.some((action) => action === null)) {
    return null;
  }
  return {
    schema_version: recovery.schema_version,
    projection_mode: recovery.projection_mode,
    authority: recovery.authority,
    requires_resubmission: recovery.requires_resubmission,
    truncated: recovery.truncated,
    actions
  };
}

function isReviewThresholdReasonCode(reasonCode) {
  return REVIEW_THRESHOLD_REASON_CODES.has(reasonCode);
}

function projectBoundedEvidenceKeys(reason) {
  if (!Array.isArray(reason?.evidence_keys)) {
    return [];
  }
  return [
    ...new Set(
      reason.evidence_keys
        .filter((key) => isNonEmptyString(key))
        .map((key) => key.trim())
        .filter((key) => SAFE_EVIDENCE_KEY_PATTERN.test(key))
    )
  ].slice(0, 24);
}

function projectLegacyPublicEvidenceKeys(reason) {
  if (!Array.isArray(reason?.evidence_keys)) {
    return [];
  }
  return [
    ...new Set(
      reason.evidence_keys
        .filter((key) => isNonEmptyString(key))
        .map((key) => key.trim())
        .filter((key) => key === "evidence_field_name")
    )
  ];
}

function normalizeBoundedReasonScalar(value) {
  if (value === null || typeof value === "boolean") {
    return { present: true, value };
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? { present: true, value } : { present: false };
  }
  if (typeof value === "string") {
    return value.length <= BOUNDED_REASON_OBSERVED_STRING_MAX
      ? { present: true, value }
      : { present: true, value: `${value.slice(0, BOUNDED_REASON_OBSERVED_STRING_MAX)}…` };
  }
  return { present: false };
}

function projectBoundedNeedsReviewReasonFacts(reasons) {
  if (!Array.isArray(reasons)) {
    return [];
  }
  const facts = [];
  for (const reason of reasons) {
    if (!isObject(reason)) {
      continue;
    }
    const reasonCode = allowlistNeedsReviewReasonCode(reason.code);
    if (!reasonCode) {
      continue;
    }
    const fact = { reason_code: reasonCode };
    const family = classifyNeedsReviewReasonFamily(reasonCode);
    if (family) {
      fact.reason_family = family;
    }
    const control = allowlistNeedsReviewControlId(reason.field);
    if (control) {
      fact.control = control;
    }
    const field = control ? null : allowlistNeedsReviewReasonField(reason.field);
    if (field) {
      fact.field = field;
    }
    const observed = normalizeBoundedReasonScalar(reason.observed);
    if (observed.present) {
      fact.observed = observed.value;
    }
    if (typeof reason.threshold === "number" && Number.isFinite(reason.threshold)) {
      fact.threshold = reason.threshold;
    }
    const evidenceKeys = family ? projectBoundedEvidenceKeys(reason) : [];
    if (evidenceKeys.length > 0) {
      fact.evidence_keys = evidenceKeys;
    }
    facts.push(fact);
  }
  return facts;
}

function projectBoundedPublicReasons(reasons) {
  if (!Array.isArray(reasons)) {
    return [];
  }
  const projected = [];
  for (const reason of reasons) {
    if (!isObject(reason) || !isNonEmptyString(reason.code)) {
      continue;
    }
    const code = allowlistPublicReasonCode(reason.code);
    if (!code) {
      continue;
    }
    const entry = { code };
    const field = allowlistNeedsReviewControlId(reason.field);
    if (field) {
      entry.field = field;
    } else {
      const reasonField = allowlistNeedsReviewReasonField(reason.field);
      if (reasonField) {
        entry.field = reasonField;
      }
    }
    const observed = normalizeBoundedReasonScalar(reason.observed);
    if (observed.present) {
      entry.observed = observed.value;
    }
    if (typeof reason.threshold === "number" && Number.isFinite(reason.threshold)) {
      entry.threshold = reason.threshold;
    }
    const reasonFamily = classifyNeedsReviewReasonFamily(code);
    const evidenceKeys = reasonFamily
      ? projectBoundedEvidenceKeys(reason)
      : projectLegacyPublicEvidenceKeys(reason);
    if (evidenceKeys.length > 0) {
      entry.evidence_keys = evidenceKeys;
    }
    projected.push(entry);
  }
  return projected;
}

function classifyNeedsReviewReasonShape({
  packReasonCount,
  recognizedReasonCount,
  reviewThresholdControls,
  reasonFamilies
}) {
  if (packReasonCount === 0) {
    return "needs_review_no_pack_reasons";
  }
  if (recognizedReasonCount === 0) {
    return "needs_review_unrecognized_reasons";
  }
  if (reasonFamilies.includes("review_attestation_failure")) {
    return "review_attestation_failure";
  }
  if (reasonFamilies.includes("accepted_authority_failure")) {
    return "accepted_authority_failure";
  }
  if (reasonFamilies.includes("request_schema_unrecognized")) {
    return "request_schema_unrecognized";
  }
  if (reviewThresholdControls.length > 0) {
    return "review_threshold_exceeded";
  }
  return "needs_review_unprojectable_control";
}

function selectedUnitFactsFromReadiness(readiness) {
  const unit = isObject(readiness?.unit) ? readiness.unit : null;
  const selectedUnitAddress = isNonEmptyString(unit?.address)
    ? unit.address.trim()
    : isNonEmptyString(readiness?.unit)
      ? readiness.unit.trim()
      : null;
  const selectedRecordId = isNonEmptyString(unit?.record_id)
    ? unit.record_id.trim()
    : isNonEmptyString(readiness?.record_id)
      ? readiness.record_id.trim()
      : null;
  const selectedSliceId = isNonEmptyString(unit?.slice_id) ? unit.slice_id.trim() : null;
  return {
    selected_unit_address: selectedUnitAddress,
    selected_record_id: selectedRecordId,
    selected_slice_id: selectedSliceId
  };
}

function buildNeedsReviewRecoveryProjection({ readiness, reasons }) {
  const packReasonCount = Array.isArray(reasons) ? reasons.length : 0;
  const reasonFacts = projectBoundedNeedsReviewReasonFacts(reasons);
  const recognizedReasonCount = reasonFacts.length;
  const unrecognizedReasonCount = Math.max(0, packReasonCount - recognizedReasonCount);
  const thresholdReasonControls = [
    ...new Set(
      reasonFacts
        .filter((fact) => isReviewThresholdReasonCode(fact.reason_code))
        .map((fact) => fact.control)
        .filter((control) => control)
    )
  ];
  const reasonFamilies = [
    ...new Set(reasonFacts.map((fact) => fact.reason_family).filter((family) => family))
  ];
  const reviewThresholdControls = reasonFamilies.length > 0 ? [] : thresholdReasonControls;
  const classification = classifyNeedsReviewReasonShape({
    packReasonCount,
    recognizedReasonCount,
    reviewThresholdControls,
    reasonFamilies
  });
  const recovery = {
    classification,
    recovery_source: "legacy_reason_fact_recovery",
    is_deny_or_reject: false,
    ...selectedUnitFactsFromReadiness(readiness),
    review_threshold_controls: reviewThresholdControls,
    reason_families: reasonFamilies,
    reason_facts: reasonFacts,
    pack_reason_count: packReasonCount,
    recognized_reason_count: recognizedReasonCount,
    unrecognized_reason_count: unrecognizedReasonCount,
    dropped_reason_count: unrecognizedReasonCount,
    bounded_by_returned_reason_facts: true,
    controls_note:
      "This remediation packet lists only the review-threshold control(s) Node Engine " +
      "returned in bounded reason facts; it infers no hidden or additional controls.",
    authority_note:
      "Node Engine remains the only authority that can return a ratified pack-backed " +
      "admit; needs_review is structurally dispatchable but not launch authority."
  };

  if (classification === "review_threshold_exceeded") {
    recovery.taxonomy_code = NEEDS_REVIEW_REVIEW_THRESHOLD_TAXONOMY_CODE;
    recovery.reduce_split_narrow_actions = [
      "Prefer reducing, splitting, or narrowing first: repair expected_changed_line_budget " +
        "and expected_edit_targets when those controls are named, narrow or split write_scope, " +
        "and reduce or consolidate validation commands so the returned review-threshold " +
        "control(s) clear without review evidence."
    ];
    recovery.structured_wk_repair_actions = [
      "Update the selected WK or slice with bounded expected_changed_line_budget when budget " +
        "evidence is missing, misplaced, invalid, or exceeded.",
      "Update expected_edit_targets with a resolved target plan when target-plan evidence is " +
        "missing, unresolved, ambiguous, or too broad."
    ];
    recovery.review_attestation_actions = [
      "Only if structured WK repair and reducing/splitting/narrowing are not viable, record " +
        "accepted review-attestation evidence for the selected unit and returned control(s) " +
        "so the next pack request can carry it.",
      "Ask the operator or Node Engine owner before treating an unprojected control as actionable."
    ];
    recovery.next_actions = [
      ...recovery.reduce_split_narrow_actions,
      ...recovery.structured_wk_repair_actions,
      ...recovery.review_attestation_actions
    ];
    recovery.dec_esc_note =
      "DEC/ESC/accepted_authorities are separate policy or escalation authorities; they are " +
      "NOT proof that review was performed for review_threshold_exceeded and must not be " +
      "presented as the normal review-threshold fix.";
    return recovery;
  }

  recovery.structured_wk_repair_actions = [
    "Do not edit the WK to guess a missing control; first obtain a bounded, projectable Node Engine reason."
  ];
  if (classification === "needs_review_no_pack_reasons") {
    recovery.reduce_split_narrow_actions = [
      "Node Engine returned needs_review without pack reason entries; do not infer a review-threshold control locally."
    ];
    recovery.review_attestation_actions = [
      "Ask the operator or Node Engine owner to inspect the upstream admission response and restore bounded reason emission, then re-run dispatch."
    ];
  } else if (classification === "needs_review_unrecognized_reasons") {
    recovery.reduce_split_narrow_actions = [
      "Node Engine returned needs_review reason entries outside the closed vocabulary; do not echo or act on the raw unknown reason values."
    ];
    recovery.review_attestation_actions = [
      "Ask the operator or Node Engine owner to reconcile the reason vocabulary or update the bounded projection contract, then re-run dispatch."
    ];
  } else {
    recovery.reduce_split_narrow_actions = [
      "Node Engine returned a recognized needs_review reason, but no allowlisted review-threshold control was projectable; do not infer a control locally."
    ];
    recovery.review_attestation_actions = [
      "Use the bounded CCE reason family and reason facts as refusal/recovery context only; do not add random review evidence, accepted_authorities, or local admits. If the returned reason is not actionable from the projected fields, ask the operator or Node Engine owner for the owning CCE-side contract fix, then re-run dispatch."
    ];
  }
  recovery.next_actions = [
    ...recovery.reduce_split_narrow_actions,
    ...recovery.structured_wk_repair_actions,
    ...recovery.review_attestation_actions
  ];
  return recovery;
}

function attachNeedsReviewRecoveryProjection(admissibility, recovery) {
  Object.defineProperty(admissibility, "needs_review_recovery", {
    value: recovery,
    enumerable: false,
    configurable: true
  });
  Object.defineProperty(admissibility, "toJSON", {
    value() {
      return { ...this, needs_review_recovery: recovery };
    },
    enumerable: false,
    configurable: true
  });
}

function attachPrimaryRecoveryProjection(admissibility, recovery) {
  Object.defineProperty(admissibility, "recovery", {
    value: recovery,
    enumerable: true,
    configurable: true
  });
}

function validRatifiedCurrentDecisionRecovery(outcome) {
  if (
    !["needs_review", "reject"].includes(outcome.status) ||
    outcome.pack_backed !== true ||
    outcome.node_engine_backed !== true ||
    outcome.ratified !== true
  ) {
    return null;
  }
  const recovery = projectWorkerAdmissionRecoverySummary(outcome.recovery);
  return recovery?.projection_mode === "bounded_current_decision_recovery" ? recovery : null;
}

function synthesizeBoundedExtractionNeedsReviewRecovery() {
  const predicate = BOUNDED_EXTRACTION_REFACTOR_PREDICATE;
  const budget = predicate.expected_changed_line_budget;
  const ops = predicate.operation_counts;
  const nextAction =
    "Reshape as a bounded large-file extraction refactor: " +
    `exactly ${ops.modify.exactly} modify + >=${ops.create.min} create, ` +
    `${ops.delete.exactly} delete, ${ops.inspect.exactly} inspect, ` +
    `expected_changed_line_budget ${budget.min}-${budget.max}, ` +
    `one >=${predicate.oversized_source_loc_min}-LOC source, ` +
    "verifiable new destinations, validation covers source and destinations.";
  return projectWorkerAdmissionRecoverySummary({
    schema_version: WORKER_ADMISSION_RECOVERY_SCHEMA_VERSION,
    projection_mode: "bounded_current_decision_recovery",
    authority: WORKER_ADMISSION_RECOVERY_AUTHORITY,
    requires_resubmission: true,
    truncated: false,
    actions: [
      {
        kind: "split_or_reduce_scope",
        controls: ["expected_changed_line_budget", "expected_edit_targets"],
        next_action: nextAction
      }
    ]
  });
}

function resolveNeedsReviewEnumerableRecovery(outcome) {
  if (isObject(outcome.recovery)) {
    const packRecovery = projectWorkerAdmissionRecoverySummary(outcome.recovery);
    return packRecovery?.projection_mode === "bounded_current_decision_recovery"
      ? packRecovery
      : null;
  }
  return synthesizeBoundedExtractionNeedsReviewRecovery();
}

export function interpretNodeEngineAdmissibility(packResult) {
  if (!isObject(packResult)) {
    return buildNodeEngineAdmissibilityOutcome(
      "undetermined",
      false,
      "node_engine_admissibility_undetermined"
    );
  }

  const outcome = isNonEmptyString(packResult.outcome) ? packResult.outcome : null;
  const effect = isNonEmptyString(packResult.effect) ? packResult.effect : null;
  const packBacked = packResult.pack_backed === true;
  const nodeEngineBacked = packResult.node_engine_backed_success === true;
  const authenticatedRequestSent =
    typeof packResult.authenticated_request_sent === "boolean"
      ? packResult.authenticated_request_sent
      : null;

  const bindingStatus = clampNodeEngineBindingStatus(packResult.node_engine_binding_status);
  const ratified = packResultIsRatified(packResult);

  const reasons = Array.isArray(packResult.pack_result_reasons) ? packResult.pack_result_reasons : [];
  const recovery = isObject(packResult.recovery) ? packResult.recovery : null;

  if (outcome === "pack_backed_result" && packBacked) {
    if (effect === "admit") {

      if (!nodeEngineBacked) {
        return buildNodeEngineAdmissibilityOutcome(
          "undetermined",
          false,
          "node_engine_admit_not_backed",
          {
            effect,
            pack_backed: packBacked,
            node_engine_backed: nodeEngineBacked,
            binding_status: bindingStatus,
            ratified,
            reasons,
            recovery
          }
        );
      }

      if (ratified) {
        return buildNodeEngineAdmissibilityOutcome("admit", true, "node_engine_admit", {
          effect,
          pack_backed: packBacked,
          node_engine_backed: nodeEngineBacked,
          binding_status: bindingStatus,
          ratified,
          reasons,
          recovery
        });
      }
      return buildNodeEngineAdmissibilityOutcome("unratified", false, "node_engine_admit_unratified", {
        effect,
        pack_backed: packBacked,
        node_engine_backed: nodeEngineBacked,
        binding_status: bindingStatus,
        ratified,
        reasons,
        recovery
      });
    }
    if (effect === "needs_review") {
      return buildNodeEngineAdmissibilityOutcome("needs_review", false, "node_engine_needs_review", {
        effect,
        pack_backed: packBacked,
        node_engine_backed: nodeEngineBacked,
        binding_status: bindingStatus,
        ratified,
        reasons,
        recovery
      });
    }
    if (effect === "reject") {
      return buildNodeEngineAdmissibilityOutcome("reject", false, "node_engine_reject", {
        effect,
        pack_backed: packBacked,
        node_engine_backed: nodeEngineBacked,
        binding_status: bindingStatus,
        ratified,
        reasons,
        recovery
      });
    }
    return buildNodeEngineAdmissibilityOutcome(
      "undetermined",
      false,
      "node_engine_unrecognized_effect",
      { binding_status: bindingStatus, ratified }
    );
  }

  const mapped = NODE_ENGINE_NON_PACK_ADMISSIBILITY_MAP[outcome] ?? [
    "undetermined",
    "node_engine_admissibility_undetermined"
  ];
  return buildNodeEngineAdmissibilityOutcome(mapped[0], false, mapped[1], {
    effect,
    pack_backed: packBacked,
    node_engine_backed: nodeEngineBacked,
    binding_status: bindingStatus,
    ratified,
    ...(authenticatedRequestSent !== null
      ? { authenticated_request_sent: authenticatedRequestSent }
      : {})
  });
}

function admissibilityReasonText(outcome) {
  if (outcome.status === "reject") {
    return `Node Engine admissibility denied (${outcome.diagnostic_code})`;
  }
  if (outcome.status === "needs_review") {
    return `Node Engine admissibility requires review (${outcome.diagnostic_code})`;
  }
  if (outcome.status === "unratified") {
    return `Node Engine admissibility admit is not ratified launch authority (${outcome.diagnostic_code})`;
  }
  if (outcome.status === "unavailable") {
    return `Node Engine admissibility unavailable (${outcome.diagnostic_code})`;
  }
  return `Node Engine admissibility could not be determined (${outcome.diagnostic_code})`;
}

function admissibilityOverlayDecisionCode(outcome) {
  if (outcome.status === "reject") {
    return NODE_ENGINE_ADMISSIBILITY_DENIED_DECISION_CODE;
  }
  if (outcome.status === "needs_review") {
    return NODE_ENGINE_ADMISSIBILITY_NEEDS_REVIEW_DECISION_CODE;
  }
  if (outcome.status === "unratified") {
    return NODE_ENGINE_ADMISSIBILITY_UNRATIFIED_DECISION_CODE;
  }
  if (outcome.status === "unavailable") {
    return NODE_ENGINE_ADMISSIBILITY_UNAVAILABLE_DECISION_CODE;
  }
  return NODE_ENGINE_ADMISSIBILITY_UNDETERMINED_DECISION_CODE;
}

export function foldNodeEngineAdmissibilityIntoReadiness(readiness, outcome) {
  const structuralDispatchable = readiness.dispatchable === true;
  const boundedReasons = outcome.status === "needs_review"
    ? projectBoundedPublicReasons(outcome.reasons)
    : outcome.reasons;
  const isNeedsReview = outcome.status === "needs_review";

  const needsReviewRecovery = isNeedsReview ? resolveNeedsReviewEnumerableRecovery(outcome) : null;
  const primaryRecovery = isNeedsReview
    ? needsReviewRecovery
    : validRatifiedCurrentDecisionRecovery(outcome);
  const attachNeedsReviewRecovery = isNeedsReview;
  const admissibility = {
    evaluated: outcome.evaluated,
    authority: outcome.authority,
    status: outcome.status,
    admissible: outcome.admissible,
    effect: outcome.effect,
    pack_backed: outcome.pack_backed,
    node_engine_backed: outcome.node_engine_backed,

    binding_status: outcome.binding_status,
    ratified: outcome.ratified,
    diagnostic_code: outcome.diagnostic_code,
    reasons: boundedReasons,
    ...(typeof outcome.authenticated_request_sent === "boolean"
      ? { authenticated_request_sent: outcome.authenticated_request_sent }
      : {})
  };
  if (primaryRecovery) {
    attachPrimaryRecoveryProjection(admissibility, primaryRecovery);
  }
  if (attachNeedsReviewRecovery) {
    attachNeedsReviewRecoveryProjection(
      admissibility,
      primaryRecovery ?? buildNeedsReviewRecoveryProjection({ readiness, reasons: outcome.reasons })
    );
  }
  const enriched = {
    ...readiness,
    structural_readiness: {
      dispatchable: structuralDispatchable,
      decision_code: readiness.decision_code
    },
    admissibility
  };

  if (structuralDispatchable && outcome.admissible !== true) {
    enriched.dispatchable = false;
    enriched.decision_code = admissibilityOverlayDecisionCode(outcome);
    enriched.reasons = [...new Set([admissibilityReasonText(outcome), ...readiness.reasons])];
  }

  return enriched;
}

function createValidateDispatchAdmissionOperationId(unit) {
  const address = isNonEmptyString(unit?.address)
    ? String(unit.address).trim()
    : isNonEmptyString(unit?.record_id)
      ? String(unit.record_id).trim()
      : "unknown";
  return `workspace_validate_dispatch:${address}:node_engine_admissibility`;
}

function createValidateDispatchNodeEngineCarrierFacts(readiness) {
  const normalizedClusterCount = Array.isArray(readiness?.clusters)
    ? readiness.clusters.length
    : null;
  const clusterCount = normalizedClusterCount === 0 && readiness?.dispatchable === true
    ? 1
    : normalizedClusterCount;
  if (!Number.isInteger(clusterCount) || clusterCount < 0) {
    return null;
  }

  const localBlastRadius = isNonEmptyString(readiness?.blast_radius?.level)
    ? String(readiness.blast_radius.level).trim().toLowerCase()
    : null;
  const blastRadiusSeverity = {
    low: "none",
    medium: "elevated",
    elevated: "elevated",
    critical: "critical"
  }[localBlastRadius] ?? null;

  return {
    cluster_count: clusterCount,
    ...(blastRadiusSeverity ? { blast_radius_severity: blastRadiusSeverity } : {})
  };
}

function projectValidateDispatchPackInputCarrier(packInput, readiness) {
  if (!isObject(packInput)) {
    return packInput;
  }
  const carrierFacts = createValidateDispatchNodeEngineCarrierFacts(readiness);
  if (!carrierFacts) {
    return packInput;
  }
  const normalizedFacts = isObject(packInput.normalized_portfolio_facts)
    ? packInput.normalized_portfolio_facts
    : {};

  const existingMetrics = isObject(normalizedFacts.work_unit_metrics)
    ? normalizedFacts.work_unit_metrics
    : {};
  return {
    ...packInput,
    normalized_portfolio_facts: {
      ...normalizedFacts,
      schema_version: isNonEmptyString(normalizedFacts.schema_version)
        ? String(normalizedFacts.schema_version).trim()
        : "worker-admission-request.v1",
      decision_kind: isNonEmptyString(normalizedFacts.decision_kind)
        ? String(normalizedFacts.decision_kind).trim()
        : "work_unit_atomicity",
      subject: clone(normalizedFacts.subject ?? null),
      claim: null,
      ...(isNonEmptyString(packInput.source_record_digest)
        ? { source_digest: String(packInput.source_record_digest).trim() }
        : {}),
      work_unit_metrics: { ...existingMetrics, ...carrierFacts }
    }
  };
}

export async function resolveNodeEngineAdmissibility({ request, record, selectedUnit, unit, dir, readiness }) {
  const bundle = isObject(request) ? request : {};
  try {
    if (typeof bundle.resolver === "function") {
      return await bundle.resolver({ record, selectedUnit, unit, dir });
    }
    const config = isObject(bundle.config)
      ? bundle.config
      : resolveClientConfig(bundle.env ?? process.env);

    const createPackInput = async (review_attestation_binding = null) =>
      typeof bundle.packInputAssembler === "function"
        ? bundle.packInputAssembler({
            dir,
            record,
            selectedUnit,
            unit,
            review_attestation_binding,
            now: bundle.now ?? null
          })
        : createSelectedUnitWorkerAdmissionDomainPackInput({
            dir,
            record,
            unit,
            review_attestation_binding,
            now: bundle.now ?? null
          });
    let packInput = null;
    try {
      packInput = await createPackInput();
    } catch {
      return {
        outcome: "pack_input_assembly_failed",
        authenticated_request_sent: false
      };
    }
    if (!isObject(packInput)) {
      return {
        outcome: "pack_input_missing",
        authenticated_request_sent: false
      };
    }
    packInput = projectValidateDispatchPackInputCarrier(packInput, readiness);

    const routeInfo = resolveWorkerAdmissionRoute({ config, route: bundle.route ?? null });
    const firstResult = await executeWorkerAdmissionDomainPackValidation(
      {
        config,
        packInput,
        route: routeInfo.value,
        requestContractDigest: bundle.requestContractDigest ?? null
      },
      bundle.fetchImpl
    );
    const reviewAttestationBinding = createReviewAttestationBindingFromRemoteNeedsReview(
      firstResult,
      {
        admitting_run_id:
          bundle.admitting_run_id ??
          bundle.admittingRunId ??
          createValidateDispatchAdmissionOperationId(unit)
      }
    );
    if (!reviewAttestationBinding) {
      return firstResult;
    }

    let secondPackInput = null;
    try {
      secondPackInput = await createPackInput(reviewAttestationBinding);
    } catch {
      return firstResult;
    }
    if (
      !isObject(secondPackInput) ||
      !Array.isArray(secondPackInput.review_attestations) ||
      secondPackInput.review_attestations.length === 0
    ) {
      return firstResult;
    }
    secondPackInput = projectValidateDispatchPackInputCarrier(secondPackInput, readiness);

    const secondResult = await executeWorkerAdmissionDomainPackValidation(
      {
        config,
        packInput: secondPackInput,
        route: routeInfo.value,
        requestContractDigest: bundle.requestContractDigest ?? null
      },
      bundle.fetchImpl
    );
    return preserveFirstPassReviewThresholdReasonsForOpaqueRetryResult(secondResult, {
      firstResult,
      review_attestation_binding: reviewAttestationBinding
    });
  } catch {
    return null;
  }
}
