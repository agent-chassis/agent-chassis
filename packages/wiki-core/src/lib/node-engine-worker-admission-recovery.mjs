const WORKER_ADMISSION_RECOVERY_SCHEMA_VERSION = "worker_admission.recovery.v1";
const WORKER_ADMISSION_RECOVERY_AUTHORITY = "advisory_recovery_only";
const WORKER_ADMISSION_RECOVERY_ACTION_SUMMARY_MAX = 16;
const WORKER_ADMISSION_RECOVERY_TOKEN_MAX = 24;
const WORKER_ADMISSION_RECOVERY_TOKEN_LENGTH_MAX = 128;
const WORKER_ADMISSION_RECOVERY_NEXT_ACTION_MAX = 240;
const WORKER_ADMISSION_RECOVERY_PROJECTION_MODES = new Set([
  "bounded_current_decision_recovery",
  "route_problem_recovery",
]);
const WORKER_ADMISSION_RECOVERY_PACK_RESULT_EFFECTS = new Set([
  "needs_review",
  "reject",
]);
const WORKER_ADMISSION_RECOVERY_ROUTE_PROBLEM_TYPES = new Set([
  "/errors/pack-input-required",
  "/errors/pack-input-invalid",
  "/errors/non-object-data",
  "/errors/request-schema-digest-mismatch",
  "/errors/precondition_graph_too_large",
  "/errors/invalid-request",
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
  "provide_idempotency_key",
]);
const WORKER_ADMISSION_RECOVERY_TOP_LEVEL_FIELDS = new Set([
  "schema_version",
  "projection_mode",
  "authority",
  "requires_resubmission",
  "truncated",
  "actions",
]);
const WORKER_ADMISSION_RECOVERY_ACTION_FIELDS = new Set([
  "kind",
  "reason_codes",
  "problem_types",
  "fields",
  "controls",
  "next_action",
  "remedy_guidance",
]);

const WORKER_ADMISSION_REMEDY_GUIDANCE_FIELDS = new Set([
  "paths",
  "expected_edit_targets_shape",
]);
const WORKER_ADMISSION_REMEDY_GUIDANCE_PATH_FIELDS = new Set([
  "remedy",
  "applies_when",
]);
const WORKER_ADMISSION_REMEDY_GUIDANCE_TARGET_SHAPE_FIELDS = new Set([
  "target_fields",
  "kind_values",
  "operation_values",
]);
const WORKER_ADMISSION_REMEDY_GUIDANCE_PATHS_MAX = 8;
const WORKER_ADMISSION_REMEDY_GUIDANCE_REMEDIES = new Set([
  "self_attest_bounded_target_plan",
  "obtain_review_attestation",
  "refactor_split_over_hard_reject",
  "narrow_to_one_write_path",
  "reduce_or_consolidate_validation",
  "reduce_count_control",
]);
const WORKER_ADMISSION_REMEDY_GUIDANCE_APPLIES_WHEN = new Set([
  "small_edit_in_large_file",
  "large_edit_in_large_file",
  "file_at_or_above_hard_reject",
  "write_scope_count_over_threshold",
  "validation_command_count_over_threshold",
  "other_count_control_over_threshold",
  "collapsed_file_loc_bands",
]);

const WORKER_ADMISSION_REMEDY_GUIDANCE_TARGET_FIELDS = new Set([
  "name",
  "path",
  "kind",
  "operation",
]);
const WORKER_ADMISSION_REMEDY_GUIDANCE_TARGET_KINDS = new Set([
  "function",
  "method",
  "class",
  "module",
  "export",
  "test_case",
  "schema_field",
  "docs_section",
  "config_key",
  "other",
]);
const WORKER_ADMISSION_REMEDY_GUIDANCE_TARGET_OPERATIONS = new Set([
  "create",
  "modify",
  "delete",
  "inspect",
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyAllowedFields(object, allowedFields) {
  return Object.keys(object).every((key) => allowedFields.has(key));
}

function summarizeRecoveryTokenList(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > WORKER_ADMISSION_RECOVERY_TOKEN_MAX) return null;
  const tokens = [];
  for (const item of value) {
    if (
      typeof item !== "string" ||
      item.length === 0 ||
      item.length > WORKER_ADMISSION_RECOVERY_TOKEN_LENGTH_MAX
    ) {
      return null;
    }
    tokens.push(item);
  }
  return tokens;
}

function summarizeRemedyGuidanceEnumList(value, allowedValues, maxLength) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxLength) {
    return null;
  }
  const members = [];
  for (const item of value) {
    if (typeof item !== "string" || !allowedValues.has(item)) return null;
    members.push(item);
  }
  return members;
}

function summarizeRemedyGuidanceTargetShape(shape) {
  if (!isPlainObject(shape) || !hasOnlyAllowedFields(shape, WORKER_ADMISSION_REMEDY_GUIDANCE_TARGET_SHAPE_FIELDS)) {
    return null;
  }
  const targetFields = summarizeRemedyGuidanceEnumList(
    shape.target_fields,
    WORKER_ADMISSION_REMEDY_GUIDANCE_TARGET_FIELDS,
    WORKER_ADMISSION_REMEDY_GUIDANCE_TARGET_FIELDS.size
  );
  const kindValues = summarizeRemedyGuidanceEnumList(
    shape.kind_values,
    WORKER_ADMISSION_REMEDY_GUIDANCE_TARGET_KINDS,
    WORKER_ADMISSION_REMEDY_GUIDANCE_TARGET_KINDS.size
  );
  const operationValues = summarizeRemedyGuidanceEnumList(
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
    operation_values: operationValues,
  };
}

function summarizeRemedyGuidance(value) {
  if (
    !isPlainObject(value) ||
    !hasOnlyAllowedFields(value, WORKER_ADMISSION_REMEDY_GUIDANCE_FIELDS)
  ) {
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
    if (!isPlainObject(path) || !hasOnlyAllowedFields(path, WORKER_ADMISSION_REMEDY_GUIDANCE_PATH_FIELDS)) {
      return null;
    }
    if (typeof path.remedy !== "string" || !WORKER_ADMISSION_REMEDY_GUIDANCE_REMEDIES.has(path.remedy)) {
      return null;
    }
    if (
      typeof path.applies_when !== "string" ||
      !WORKER_ADMISSION_REMEDY_GUIDANCE_APPLIES_WHEN.has(path.applies_when)
    ) {
      return null;
    }
    paths.push({ remedy: path.remedy, applies_when: path.applies_when });
  }
  const summary = { paths };
  if (value.expected_edit_targets_shape !== undefined) {
    const shape = summarizeRemedyGuidanceTargetShape(value.expected_edit_targets_shape);
    if (shape === null) return null;
    summary.expected_edit_targets_shape = shape;
  }
  return summary;
}

function summarizeRecoveryAction(action) {
  if (!isPlainObject(action) || !hasOnlyAllowedFields(action, WORKER_ADMISSION_RECOVERY_ACTION_FIELDS)) {
    return null;
  }
  if (typeof action.kind !== "string" || !WORKER_ADMISSION_RECOVERY_ACTION_KINDS.has(action.kind)) {
    return null;
  }

  const summary = { kind: action.kind };
  for (const key of ["reason_codes", "problem_types", "fields", "controls"]) {
    const tokens = summarizeRecoveryTokenList(action[key]);
    if (tokens === null) return null;
    if (tokens !== undefined) summary[key] = tokens;
  }
  if (action.next_action !== undefined) {
    if (
      typeof action.next_action !== "string" ||
      action.next_action.length === 0 ||
      action.next_action.length > WORKER_ADMISSION_RECOVERY_NEXT_ACTION_MAX
    ) {
      return null;
    }
    summary.next_action = action.next_action;
  }
  if (action.remedy_guidance !== undefined) {
    const remedyGuidance = summarizeRemedyGuidance(action.remedy_guidance);
    if (remedyGuidance === null) return null;
    summary.remedy_guidance = remedyGuidance;
  }
  return summary;
}

function summarizeWorkerAdmissionRecoveryObject(recovery) {
  if (!isPlainObject(recovery) || !hasOnlyAllowedFields(recovery, WORKER_ADMISSION_RECOVERY_TOP_LEVEL_FIELDS)) {
    return null;
  }
  if (recovery.schema_version !== WORKER_ADMISSION_RECOVERY_SCHEMA_VERSION) return null;
  if (
    typeof recovery.projection_mode !== "string" ||
    !WORKER_ADMISSION_RECOVERY_PROJECTION_MODES.has(recovery.projection_mode)
  ) {
    return null;
  }
  if (recovery.authority !== WORKER_ADMISSION_RECOVERY_AUTHORITY) return null;
  if (recovery.requires_resubmission !== true) return null;
  if (typeof recovery.truncated !== "boolean") return null;
  if (
    !Array.isArray(recovery.actions) ||
    recovery.actions.length === 0 ||
    recovery.actions.length > WORKER_ADMISSION_RECOVERY_ACTION_SUMMARY_MAX
  ) {
    return null;
  }

  const actions = recovery.actions.map(summarizeRecoveryAction);
  if (actions.some((action) => action === null)) return null;
  return {
    schema_version: recovery.schema_version,
    projection_mode: recovery.projection_mode,
    authority: recovery.authority,
    requires_resubmission: recovery.requires_resubmission,
    truncated: recovery.truncated,
    actions,
  };
}

function readPackResultEffect(packResult) {
  const effect = typeof packResult?.decision === "string" ? packResult.decision : packResult?.effect;
  return WORKER_ADMISSION_RECOVERY_PACK_RESULT_EFFECTS.has(effect) ? effect : null;
}

function summarizePackResultRecovery(packResult) {
  if (!isPlainObject(packResult) || !Object.prototype.hasOwnProperty.call(packResult, "recovery")) {
    return null;
  }
  if (readPackResultEffect(packResult) === null) return null;

  const recovery = summarizeWorkerAdmissionRecoveryObject(packResult.recovery);
  if (recovery?.projection_mode !== "bounded_current_decision_recovery") return null;
  return recovery;
}

function summarizeRouteProblemRecovery(body) {
  if (
    typeof body.type !== "string" ||
    !WORKER_ADMISSION_RECOVERY_ROUTE_PROBLEM_TYPES.has(body.type)
  ) {
    return null;
  }

  const recovery = summarizeWorkerAdmissionRecoveryObject(body.recovery);
  if (recovery?.projection_mode !== "route_problem_recovery") return null;
  return recovery;
}

export function summarizeWorkerAdmissionRecovery(body, recognizedPackResultObject) {
  if (!isPlainObject(body)) return null;
  const packResult =
    typeof recognizedPackResultObject === "function" ? recognizedPackResultObject(body) : null;
  if (packResult) {
    return summarizePackResultRecovery(packResult);
  }
  return summarizeRouteProblemRecovery(body);
}
