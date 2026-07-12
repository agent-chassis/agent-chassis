

import {
  isObject,
  isNonEmptyString,
  hasOwn,
  hasOnlyAllowedFields
} from "./kernel.mjs";

const WORKER_ADMISSION_RECOVERY_SCHEMA_VERSION = "worker_admission.recovery.v1";
const WORKER_ADMISSION_RECOVERY_AUTHORITY = "advisory_recovery_only";
const WORKER_ADMISSION_RECOVERY_ACTION_SUMMARY_MAX = 16;
const WORKER_ADMISSION_RECOVERY_TOKEN_MAX = 24;
const WORKER_ADMISSION_RECOVERY_TOKEN_LENGTH_MAX = 128;
const WORKER_ADMISSION_RECOVERY_NEXT_ACTION_MAX = 240;
const WORKER_ADMISSION_CURRENT_DECISION_RECOVERY_MODE = "bounded_current_decision_recovery";
const WORKER_ADMISSION_ROUTE_PROBLEM_RECOVERY_MODE = "route_problem_recovery";
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

const WORKER_ADMISSION_RECOVERY_REMEDY_PATHS_MAX = 8;
const WORKER_ADMISSION_RECOVERY_REMEDY_GUIDANCE_FIELDS = new Set([
  "paths",
  "expected_edit_targets_shape"
]);
const WORKER_ADMISSION_RECOVERY_REMEDY_PATH_FIELDS = new Set([
  "remedy",
  "applies_when"
]);
const WORKER_ADMISSION_RECOVERY_REMEDY_TARGET_SHAPE_FIELDS = new Set([
  "target_fields",
  "kind_values",
  "operation_values"
]);

const WORKER_ADMISSION_RECOVERY_REMEDY_REMEDIES = new Set([
  "self_attest_bounded_target_plan",
  "obtain_review_attestation",
  "refactor_split_over_hard_reject",
  "narrow_to_one_write_path",
  "reduce_or_consolidate_validation",
  "reduce_count_control"
]);
const WORKER_ADMISSION_RECOVERY_REMEDY_APPLIES_WHEN = new Set([
  "small_edit_in_large_file",
  "large_edit_in_large_file",
  "file_at_or_above_hard_reject",
  "write_scope_count_over_threshold",
  "validation_command_count_over_threshold",
  "other_count_control_over_threshold",
  "collapsed_file_loc_bands"
]);

const WORKER_ADMISSION_RECOVERY_REMEDY_TARGET_FIELDS = new Set([
  "name",
  "path",
  "kind",
  "operation"
]);
const WORKER_ADMISSION_RECOVERY_REMEDY_TARGET_KINDS = new Set([
  "function",
  "method",
  "class",
  "module",
  "export",
  "test_case",
  "schema_field",
  "docs_section",
  "config_key",
  "other"
]);
const WORKER_ADMISSION_RECOVERY_REMEDY_TARGET_OPERATIONS = new Set([
  "create",
  "modify",
  "delete",
  "inspect"
]);

function projectRecoveryTokenList(value) {
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
    tokens.push(item.trim());
  }
  return { valid: true, value: tokens };
}

function projectRemedyGuidanceEnumList(value, allowedValues, maxLength) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxLength) {
    return null;
  }
  const members = [];
  for (const item of value) {
    if (typeof item !== "string" || !allowedValues.has(item)) {
      return null;
    }
    members.push(item);
  }
  return members;
}

function projectRemedyGuidanceTargetShape(shape) {
  if (!isObject(shape) || !hasOnlyAllowedFields(shape, WORKER_ADMISSION_RECOVERY_REMEDY_TARGET_SHAPE_FIELDS)) {
    return null;
  }
  const targetFields = projectRemedyGuidanceEnumList(
    shape.target_fields,
    WORKER_ADMISSION_RECOVERY_REMEDY_TARGET_FIELDS,
    WORKER_ADMISSION_RECOVERY_REMEDY_TARGET_FIELDS.size
  );
  const kindValues = projectRemedyGuidanceEnumList(
    shape.kind_values,
    WORKER_ADMISSION_RECOVERY_REMEDY_TARGET_KINDS,
    WORKER_ADMISSION_RECOVERY_REMEDY_TARGET_KINDS.size
  );
  const operationValues = projectRemedyGuidanceEnumList(
    shape.operation_values,
    WORKER_ADMISSION_RECOVERY_REMEDY_TARGET_OPERATIONS,
    WORKER_ADMISSION_RECOVERY_REMEDY_TARGET_OPERATIONS.size
  );
  if (targetFields === null || kindValues === null || operationValues === null) {
    return null;
  }
  return Object.freeze({
    target_fields: Object.freeze(targetFields),
    kind_values: Object.freeze(kindValues),
    operation_values: Object.freeze(operationValues)
  });
}

function projectRemedyGuidance(value) {
  if (value === undefined) {
    return { valid: true, value: undefined };
  }
  if (!isObject(value) || !hasOnlyAllowedFields(value, WORKER_ADMISSION_RECOVERY_REMEDY_GUIDANCE_FIELDS)) {
    return { valid: false };
  }
  if (
    !Array.isArray(value.paths) ||
    value.paths.length === 0 ||
    value.paths.length > WORKER_ADMISSION_RECOVERY_REMEDY_PATHS_MAX
  ) {
    return { valid: false };
  }
  const paths = [];
  for (const path of value.paths) {
    if (!isObject(path) || !hasOnlyAllowedFields(path, WORKER_ADMISSION_RECOVERY_REMEDY_PATH_FIELDS)) {
      return { valid: false };
    }
    if (typeof path.remedy !== "string" || !WORKER_ADMISSION_RECOVERY_REMEDY_REMEDIES.has(path.remedy)) {
      return { valid: false };
    }
    if (
      typeof path.applies_when !== "string" ||
      !WORKER_ADMISSION_RECOVERY_REMEDY_APPLIES_WHEN.has(path.applies_when)
    ) {
      return { valid: false };
    }
    paths.push(Object.freeze({ remedy: path.remedy, applies_when: path.applies_when }));
  }
  const projected = { paths: Object.freeze(paths) };
  if (value.expected_edit_targets_shape !== undefined) {
    const shape = projectRemedyGuidanceTargetShape(value.expected_edit_targets_shape);
    if (shape === null) {
      return { valid: false };
    }
    projected.expected_edit_targets_shape = shape;
  }
  return { valid: true, value: Object.freeze(projected) };
}

function projectRecoveryAction(action) {
  if (!isObject(action) || !hasOnlyAllowedFields(action, WORKER_ADMISSION_RECOVERY_ACTION_FIELDS)) {
    return null;
  }
  if (
    !isNonEmptyString(action.kind) ||
    !WORKER_ADMISSION_RECOVERY_ACTION_KINDS.has(action.kind)
  ) {
    return null;
  }
  const projected = { kind: action.kind.trim() };
  for (const key of ["reason_codes", "problem_types", "fields", "controls"]) {
    const tokens = projectRecoveryTokenList(action[key]);
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
    projected.next_action = action.next_action.trim();
  }

  const remedyGuidance = projectRemedyGuidance(action.remedy_guidance);
  if (!remedyGuidance.valid) {
    return null;
  }
  if (remedyGuidance.value !== undefined) {
    projected.remedy_guidance = remedyGuidance.value;
  }
  return Object.freeze(projected);
}

function projectRecoverySummaryForMode(recovery, projectionMode) {
  if (
    !isObject(recovery) ||
    !hasOnlyAllowedFields(recovery, WORKER_ADMISSION_RECOVERY_TOP_LEVEL_FIELDS)
  ) {
    return null;
  }
  if (recovery.schema_version !== WORKER_ADMISSION_RECOVERY_SCHEMA_VERSION) {
    return null;
  }
  if (recovery.projection_mode !== projectionMode) {
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
  const actions = recovery.actions.map((action) => projectRecoveryAction(action));
  if (actions.some((action) => action === null)) {
    return null;
  }
  return Object.freeze({
    schema_version: recovery.schema_version,
    projection_mode: recovery.projection_mode,
    authority: recovery.authority,
    requires_resubmission: recovery.requires_resubmission,
    truncated: recovery.truncated,
    actions: Object.freeze(actions)
  });
}

function recoveryProjectionForMode(remote, projectionMode) {
  if (!isObject(remote) || !hasOwn(remote, "recovery")) {
    return { state: "absent", recovery: null };
  }
  const recovery = projectRecoverySummaryForMode(remote.recovery, projectionMode);
  return recovery
    ? { state: "valid", recovery }
    : { state: "projection_mismatch", recovery: null };
}

function uniqueActionTokens(actions, key) {
  return [
    ...new Set(
      actions
        .flatMap((action) => (Array.isArray(action[key]) ? action[key] : []))
        .filter((token) => isNonEmptyString(token))
    )
  ];
}

function selectedUnitRecoveryFacts(unit) {
  return {
    selected_unit_address: unit?.address ?? null,
    selected_record_id: unit?.record_id ?? null,
    selected_slice_id: unit?.slice_id ?? null
  };
}

function buildRecoveryProjectionMismatchDetail({ unit, isDenyOrReject, projectionLabel }) {
  const expectedProjection = isNonEmptyString(projectionLabel)
    ? projectionLabel
    : "current-decision";
  return Object.freeze({
    classification: "cce_recovery_projection_mismatch",
    recovery_source: "cce_recovery_v1_projection_mismatch",
    is_deny_or_reject: isDenyOrReject,
    ...selectedUnitRecoveryFacts(unit),
    authority_note:
      "CCE supplied a recovery field that this launcher could not validate as bounded " +
      `worker_admission.recovery.v1 ${expectedProjection} guidance. The launcher will not infer ` +
      "local recovery policy from malformed or out-of-scope recovery data.",
    next_actions: [
      "Ask the operator or CCE owner to fix the recovery.v1 projection contract, then resubmit and obtain a fresh CCE worker-admission decision."
    ]
  });
}

export function buildCceRecoveryV1Detail({
  unit,
  remote,
  isDenyOrReject,
  projectionMode = WORKER_ADMISSION_CURRENT_DECISION_RECOVERY_MODE,
  projectionLabel = "current-decision"
}) {
  const projection = recoveryProjectionForMode(remote, projectionMode);
  if (projection.state === "absent") {
    return null;
  }
  if (projection.state === "projection_mismatch") {
    return buildRecoveryProjectionMismatchDetail({ unit, isDenyOrReject, projectionLabel });
  }
  const recovery = projection.recovery;
  const actionNextActions = recovery.actions
    .map((action) => action.next_action)
    .filter((nextAction) => isNonEmptyString(nextAction));
  return Object.freeze({
    classification: "cce_recovery_v1",
    recovery_source: "cce_recovery_v1",
    is_deny_or_reject: isDenyOrReject,
    ...selectedUnitRecoveryFacts(unit),
    cce_recovery: recovery,
    recovery_actions: recovery.actions,
    recovery_action_kinds: Object.freeze(recovery.actions.map((action) => action.kind)),
    reason_codes: Object.freeze(uniqueActionTokens(recovery.actions, "reason_codes")),
    problem_types: Object.freeze(uniqueActionTokens(recovery.actions, "problem_types")),
    fields: Object.freeze(uniqueActionTokens(recovery.actions, "fields")),
    controls: Object.freeze(uniqueActionTokens(recovery.actions, "controls")),
    authority_note:
      "CCE recovery.v1 actions are advisory resubmission guidance only. They are not " +
      "review evidence, accepted authority, admission, or launch authority; the worker " +
      "must resubmit and obtain a fresh CCE worker-admission decision.",
    next_actions: Object.freeze(
      actionNextActions.length > 0
        ? [
            ...actionNextActions,
            "After completing the advisory recovery action(s), resubmit and obtain a fresh CCE worker-admission decision before any launch."
          ]
        : [
            "Apply only the bounded CCE recovery.v1 action kind(s) and projected tokens, then resubmit and obtain a fresh CCE worker-admission decision before any launch."
          ]
    )
  });
}

export function buildRouteProblemRecoveryDetail({ unit, remote }) {
  return buildCceRecoveryV1Detail({
    unit,
    remote,
    isDenyOrReject: true,
    projectionMode: WORKER_ADMISSION_ROUTE_PROBLEM_RECOVERY_MODE,
    projectionLabel: "route-problem"
  });
}
