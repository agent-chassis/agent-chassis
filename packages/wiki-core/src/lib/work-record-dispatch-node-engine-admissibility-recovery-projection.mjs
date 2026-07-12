

import { isNonEmptyString, isObject } from "./work-record-dispatch-shared.mjs";

import {
  WORK_RECORD_EXPECTED_EDIT_TARGET_KIND_VALUES,
  WORK_RECORD_EXPECTED_EDIT_TARGET_OPERATION_VALUES
} from "./work-record-target-metrics.mjs";
import {
  REVIEW_THRESHOLD_REASON_CODES,
  classifyNeedsReviewReasonShape,
  projectBoundedNeedsReviewReasonFacts,
  selectedUnitFactsFromReadiness
} from "./work-record-dispatch-node-engine-admissibility-reason-projection.mjs";

const NEEDS_REVIEW_REVIEW_THRESHOLD_TAXONOMY_CODE =
  "worker_admission_review_threshold_exceeded";

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
  "next_action",
  "remedy_guidance"
]);

const WORKER_ADMISSION_REMEDY_GUIDANCE_FIELDS = new Set([
  "paths",
  "expected_edit_targets_shape"
]);
const WORKER_ADMISSION_REMEDY_GUIDANCE_PATH_FIELDS = new Set([
  "remedy",
  "applies_when"
]);
const WORKER_ADMISSION_REMEDY_GUIDANCE_TARGET_SHAPE_FIELDS = new Set([
  "target_fields",
  "kind_values",
  "operation_values"
]);
const WORKER_ADMISSION_REMEDY_GUIDANCE_PATHS_MAX = 8;
const WORKER_ADMISSION_REMEDY_GUIDANCE_REMEDIES = new Set([
  "self_attest_bounded_target_plan",
  "obtain_review_attestation",
  "refactor_split_over_hard_reject",
  "narrow_to_one_write_path",
  "reduce_or_consolidate_validation",
  "reduce_or_consolidate_tests",
  "reduce_count_control"
]);
const WORKER_ADMISSION_REMEDY_GUIDANCE_APPLIES_WHEN = new Set([
  "small_edit_in_large_file",
  "large_edit_in_large_file",
  "file_at_or_above_hard_reject",
  "write_scope_count_over_threshold",
  "write_scope_test_count_over_threshold",
  "validation_command_count_over_threshold",
  "other_count_control_over_threshold",
  "collapsed_file_loc_bands"
]);
const WORKER_ADMISSION_REMEDY_GUIDANCE_TARGET_FIELDS = new Set([
  "name",
  "path",
  "kind",
  "operation"
]);

const WORKER_ADMISSION_REMEDY_GUIDANCE_TARGET_KINDS = new Set(
  WORK_RECORD_EXPECTED_EDIT_TARGET_KIND_VALUES
);
const WORKER_ADMISSION_REMEDY_GUIDANCE_TARGET_OPERATIONS = new Set(
  WORK_RECORD_EXPECTED_EDIT_TARGET_OPERATION_VALUES
);

function hasOnlyAllowedFields(object, allowedFields) {
  return Object.keys(object).every((key) => allowedFields.has(key));
}

function projectRemedyGuidanceEnumList(value, allowedValues, maxLength) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxLength) {
    return null;
  }
  const members = [];
  for (const item of value) {
    if (!isNonEmptyString(item) || !allowedValues.has(item)) {
      return null;
    }
    members.push(item);
  }
  return members;
}

function projectRemedyGuidanceTargetShape(shape) {
  if (
    !isObject(shape) ||
    !hasOnlyAllowedFields(shape, WORKER_ADMISSION_REMEDY_GUIDANCE_TARGET_SHAPE_FIELDS)
  ) {
    return null;
  }
  const targetFields = projectRemedyGuidanceEnumList(
    shape.target_fields,
    WORKER_ADMISSION_REMEDY_GUIDANCE_TARGET_FIELDS,
    WORKER_ADMISSION_REMEDY_GUIDANCE_TARGET_FIELDS.size
  );
  const kindValues = projectRemedyGuidanceEnumList(
    shape.kind_values,
    WORKER_ADMISSION_REMEDY_GUIDANCE_TARGET_KINDS,
    WORKER_ADMISSION_REMEDY_GUIDANCE_TARGET_KINDS.size
  );
  const operationValues = projectRemedyGuidanceEnumList(
    shape.operation_values,
    WORKER_ADMISSION_REMEDY_GUIDANCE_TARGET_OPERATIONS,
    WORKER_ADMISSION_REMEDY_GUIDANCE_TARGET_OPERATIONS.size
  );
  if (targetFields === null || kindValues === null || operationValues === null) {
    return null;
  }
  return {
    target_fields: targetFields,
    kind_values: kindValues,
    operation_values: operationValues
  };
}

function projectRemedyGuidance(value) {
  if (!isObject(value) || !hasOnlyAllowedFields(value, WORKER_ADMISSION_REMEDY_GUIDANCE_FIELDS)) {
    return null;
  }
  if (
    !Array.isArray(value.paths) ||
    value.paths.length === 0 ||
    value.paths.length > WORKER_ADMISSION_REMEDY_GUIDANCE_PATHS_MAX
  ) {
    return null;
  }
  const paths = [];
  for (const path of value.paths) {
    if (!isObject(path) || !hasOnlyAllowedFields(path, WORKER_ADMISSION_REMEDY_GUIDANCE_PATH_FIELDS)) {
      return null;
    }
    if (!isNonEmptyString(path.remedy) || !WORKER_ADMISSION_REMEDY_GUIDANCE_REMEDIES.has(path.remedy)) {
      return null;
    }
    if (
      !isNonEmptyString(path.applies_when) ||
      !WORKER_ADMISSION_REMEDY_GUIDANCE_APPLIES_WHEN.has(path.applies_when)
    ) {
      return null;
    }
    paths.push({ remedy: path.remedy, applies_when: path.applies_when });
  }
  const projected = { paths };
  if (value.expected_edit_targets_shape !== undefined) {
    const shape = projectRemedyGuidanceTargetShape(value.expected_edit_targets_shape);
    if (shape === null) {
      return null;
    }
    projected.expected_edit_targets_shape = shape;
  }
  return projected;
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
  if (action.remedy_guidance !== undefined) {
    const remedyGuidance = projectRemedyGuidance(action.remedy_guidance);
    if (remedyGuidance === null) {
      return null;
    }
    projected.remedy_guidance = remedyGuidance;
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

export function buildNeedsReviewRecoveryProjection({ readiness, reasons }) {
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

export function attachNeedsReviewRecoveryProjection(admissibility, recovery) {
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

export function attachPrimaryRecoveryProjection(admissibility, recovery) {
  Object.defineProperty(admissibility, "recovery", {
    value: recovery,
    enumerable: true,
    configurable: true
  });
}

export function validRatifiedCurrentDecisionRecovery(outcome) {
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

const FILE_LOC_REVIEW_THRESHOLD_CONTROLS = new Set([
  "write_scope_total_loc",
  "max_write_file_loc",
  "expected_changed_line_budget",
  "expected_edit_targets"
]);
const WRITE_SCOPE_COUNT_CONTROL = "write_scope_count";
const WRITE_SCOPE_TEST_COUNT_CONTROL = "write_scope_test_count";
const VALIDATION_COMMAND_COUNT_CONTROL = "validation_command_count";
const OTHER_COUNT_REVIEW_THRESHOLD_CONTROLS = new Set([
  "acceptance_criteria_count",
  "declared_runtime_mode_count",
  "artifact_kind_count"
]);

function remedyGuidanceExpectedEditTargetsShape() {
  return {
    target_fields: ["name", "path", "kind", "operation"],
    kind_values: [...WORK_RECORD_EXPECTED_EDIT_TARGET_KIND_VALUES],
    operation_values: [...WORK_RECORD_EXPECTED_EDIT_TARGET_OPERATION_VALUES]
  };
}

function fileLocThreePathAction(controls) {
  return {
    kind: "split_or_reduce_scope",
    controls,
    next_action:
      "Edit-too-large has three paths (see remedy_guidance): small edit in a large file -> " +
      "self-attest via expected_edit_targets + expected_changed_line_budget; larger edit -> " +
      "review-attestation; at/above hard-reject -> refactor/split.",
    remedy_guidance: {
      paths: [
        { remedy: "self_attest_bounded_target_plan", applies_when: "small_edit_in_large_file" },
        { remedy: "obtain_review_attestation", applies_when: "large_edit_in_large_file" },
        { remedy: "refactor_split_over_hard_reject", applies_when: "file_at_or_above_hard_reject" }
      ],
      expected_edit_targets_shape: remedyGuidanceExpectedEditTargetsShape()
    }
  };
}

function synthesizeDimensionSpecificRecoveryActions(controls) {
  const actions = [];
  const fileLocControls = controls.filter((control) =>
    FILE_LOC_REVIEW_THRESHOLD_CONTROLS.has(control)
  );
  if (fileLocControls.length > 0) {
    actions.push(fileLocThreePathAction(fileLocControls));
  }
  if (controls.includes(WRITE_SCOPE_COUNT_CONTROL)) {
    actions.push({
      kind: "split_or_reduce_scope",
      controls: [WRITE_SCOPE_COUNT_CONTROL],
      next_action:
        "write_scope_count over threshold: narrow to one write path — split into slices that " +
        "share the parent contract, one write_scope path each.",
      remedy_guidance: {
        paths: [
          { remedy: "narrow_to_one_write_path", applies_when: "write_scope_count_over_threshold" }
        ]
      }
    });
  }
  if (controls.includes(WRITE_SCOPE_TEST_COUNT_CONTROL)) {
    actions.push({
      kind: "split_or_reduce_scope",
      controls: [WRITE_SCOPE_TEST_COUNT_CONTROL],
      next_action:
        "write_scope_test_count over threshold: reduce or consolidate the test files in this unit " +
        "(DEC-0150 test-breadth budget, distinct from write_scope_count) so the test count clears.",
      remedy_guidance: {
        paths: [
          { remedy: "reduce_or_consolidate_tests", applies_when: "write_scope_test_count_over_threshold" }
        ]
      }
    });
  }
  if (controls.includes(VALIDATION_COMMAND_COUNT_CONTROL)) {
    actions.push({
      kind: "split_or_reduce_scope",
      controls: [VALIDATION_COMMAND_COUNT_CONTROL],
      next_action:
        "validation_command_count over threshold: reduce or consolidate validation commands so the " +
        "count clears without review evidence.",
      remedy_guidance: {
        paths: [
          {
            remedy: "reduce_or_consolidate_validation",
            applies_when: "validation_command_count_over_threshold"
          }
        ]
      }
    });
  }
  const otherCountControls = controls.filter((control) =>
    OTHER_COUNT_REVIEW_THRESHOLD_CONTROLS.has(control)
  );
  if (otherCountControls.length > 0) {
    actions.push({
      kind: "split_or_reduce_scope",
      controls: otherCountControls,
      next_action:
        "Count control(s) over threshold: reduce the named count (acceptance criteria / declared " +
        "runtime modes / artifact kinds) so it clears.",
      remedy_guidance: {
        paths: [
          { remedy: "reduce_count_control", applies_when: "other_count_control_over_threshold" }
        ]
      }
    });
  }
  return actions;
}

function synthesizeDimensionSpecificNeedsReviewRecovery(reasons) {
  const reasonFacts = projectBoundedNeedsReviewReasonFacts(reasons);
  const controls = [
    ...new Set(
      reasonFacts
        .filter((fact) => isReviewThresholdReasonCode(fact.reason_code))
        .map((fact) => fact.control)
        .filter((control) => control)
    )
  ];
  const actions = synthesizeDimensionSpecificRecoveryActions(controls);
  if (actions.length === 0) {
    return null;
  }
  return projectWorkerAdmissionRecoverySummary({
    schema_version: WORKER_ADMISSION_RECOVERY_SCHEMA_VERSION,
    projection_mode: "bounded_current_decision_recovery",
    authority: WORKER_ADMISSION_RECOVERY_AUTHORITY,
    requires_resubmission: true,
    truncated: false,
    actions
  });
}

export function resolveNeedsReviewEnumerableRecovery(outcome) {
  if (isObject(outcome.recovery)) {
    const packRecovery = projectWorkerAdmissionRecoverySummary(outcome.recovery);
    return packRecovery?.projection_mode === "bounded_current_decision_recovery"
      ? packRecovery
      : null;
  }
  return synthesizeDimensionSpecificNeedsReviewRecovery(outcome.reasons);
}
