import { createHash } from "node:crypto";

export const WORKER_ADMISSION_RECOVERY_SCHEMA_VERSION = "worker_admission.recovery.v1";
export const WORKER_ADMISSION_RECOVERY_SOURCE_BOUNDARY =
  "cce.worker-admission-response.recovery";
export const WORKER_ADMISSION_RECOVERY_OWNING_BOUNDARY =
  "cce.worker-admission-recovery-producer";
export const WORKER_ADMISSION_RECOVERY_VALIDATION_BOUNDARY =
  "wiki-core.node-engine-worker-admission-recovery";
const WORKER_ADMISSION_RECOVERY_AUTHORITY = "advisory_recovery_only";
const WORKER_ADMISSION_RECOVERY_ACTION_SUMMARY_MAX = 16;
const WORKER_ADMISSION_RECOVERY_TOKEN_MAX = 24;
const WORKER_ADMISSION_RECOVERY_TOKEN_LENGTH_MAX = 128;
const WORKER_ADMISSION_RECOVERY_NEXT_ACTION_MAX = 240;
const WORKER_ADMISSION_RECOVERY_PROJECTION_MODES = new Set([
  "bounded_current_decision_recovery",
  "route_problem_recovery",
]);
export const WORKER_ADMISSION_RECOVERY_VALIDATION_ISSUES = Object.freeze({
  MISSING: "worker_admission_recovery_missing",
  MALFORMED: "worker_admission_recovery_malformed",
  UNKNOWN_VERSION: "worker_admission_recovery_unknown_version",
  UNKNOWN_FIELD: "worker_admission_recovery_unknown_field",
  WRONG_PROJECTION_MODE: "worker_admission_recovery_wrong_projection_mode",
  AUTHORITY_MISMATCH: "worker_admission_recovery_authority_mismatch",
  RESUBMISSION_MISMATCH: "worker_admission_recovery_resubmission_mismatch",
  TRUNCATED: "worker_admission_recovery_truncated",
  ACTIONS_MALFORMED: "worker_admission_recovery_actions_malformed"
});

export class WorkerAdmissionRecoveryDiagnosticConstructionError extends Error {
  constructor(cause) {
    super("worker_admission_recovery_diagnostic_construction_failed", { cause });
    this.name = "WorkerAdmissionRecoveryDiagnosticConstructionError";
    this.code = "worker_admission_recovery_diagnostic_construction_failed";
  }
}

export const WORKER_ADMISSION_RECOVERY_REDACTION_REASONS = Object.freeze({
  UNAUTHENTICATED_PAYLOAD: "unauthenticated_recovery_payload",
  UNKNOWN_CONTRACT_MEMBER: "unknown_recovery_contract_member",
  OVERSIZED_PAYLOAD: "oversized_recovery_payload"
});
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
  "thresholds",
  "next_action",
  "remedy_guidance",
]);
const WORKER_ADMISSION_RECOVERY_THRESHOLD_FIELDS = new Set([
  "field",
  "observed",
  "threshold",
  "boundary",
]);
const WORKER_ADMISSION_RECOVERY_THRESHOLD_BOUNDARIES = new Set(["review", "reject"]);

export const WORKER_ADMISSION_RECOVERY_REVIEW_THRESHOLD_REASON_CODES = Object.freeze([
  "review_threshold_exceeded",
  "worker_admission.work_unit_atomicity.review_threshold_exceeded.v1"
]);
export const WORKER_ADMISSION_RECOVERY_PUBLIC_REASON_CODES = Object.freeze([
  ...WORKER_ADMISSION_RECOVERY_REVIEW_THRESHOLD_REASON_CODES,
  "request_schema_unrecognized",
  "worker_admission.work_unit_atomicity.write_scope_count_denied.v1"
]);
export const WORKER_ADMISSION_RECOVERY_REASON_CONTROL_IDS = Object.freeze([
  "write_scope_total_loc",
  "max_write_file_loc",
  "write_scope_count",
  "write_scope_test_count",
  "acceptance_criteria_count",
  "validation_command_count",
  "expected_changed_line_budget",
  "expected_edit_targets",
  "declared_runtime_mode_count",
  "artifact_kind_count"
]);
export const WORKER_ADMISSION_RECOVERY_REASON_FIELDS = Object.freeze([
  ...WORKER_ADMISSION_RECOVERY_REASON_CONTROL_IDS,
  "accepted_authority",
  "accepted_authorities",
  "review_attestation",
  "review_attestations",
  "request_schema",
  "request_contract_digest"
]);
export const WORKER_ADMISSION_RECOVERY_REASON_FAMILIES = Object.freeze([
  Object.freeze(["accepted_authority_", "accepted_authority_failure"]),
  Object.freeze(["review_attestation_", "review_attestation_failure"])
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
  "reduce_or_consolidate_tests",
  "reduce_count_control",
]);
const WORKER_ADMISSION_REMEDY_GUIDANCE_APPLIES_WHEN = new Set([
  "small_edit_in_large_file",
  "large_edit_in_large_file",
  "file_at_or_above_hard_reject",
  "write_scope_count_over_threshold",
  "write_scope_test_count_over_threshold",
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

function summarizeRecoveryThresholds(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) return null;
  const thresholds = [];
  for (const fact of value) {
    if (
      !isPlainObject(fact) ||
      !hasOnlyAllowedFields(fact, WORKER_ADMISSION_RECOVERY_THRESHOLD_FIELDS) ||
      typeof fact.field !== "string" ||
      fact.field.length === 0 ||
      !(
        fact.observed === null ||
        typeof fact.observed === "string" ||
        typeof fact.observed === "boolean" ||
        (typeof fact.observed === "number" && Number.isFinite(fact.observed))
      ) ||
      typeof fact.threshold !== "number" ||
      !Number.isFinite(fact.threshold) ||
      typeof fact.boundary !== "string" ||
      !WORKER_ADMISSION_RECOVERY_THRESHOLD_BOUNDARIES.has(fact.boundary)
    ) {
      return null;
    }
    thresholds.push({
      field: fact.field,
      observed: fact.observed,
      threshold: fact.threshold,
      boundary: fact.boundary,
    });
  }
  return thresholds;
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
  const thresholds = summarizeRecoveryThresholds(action.thresholds);
  if (thresholds === null) return null;
  if (thresholds !== undefined) summary.thresholds = thresholds;
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

const INVALID_RECOVERY_TUPLES = new Map([
  [
    WORKER_ADMISSION_RECOVERY_VALIDATION_ISSUES.MALFORMED,
    ["recovery", WORKER_ADMISSION_RECOVERY_REDACTION_REASONS.UNAUTHENTICATED_PAYLOAD]
  ],
  [
    WORKER_ADMISSION_RECOVERY_VALIDATION_ISSUES.UNKNOWN_FIELD,
    ["recovery.unknown_field", WORKER_ADMISSION_RECOVERY_REDACTION_REASONS.UNKNOWN_CONTRACT_MEMBER]
  ],
  [
    WORKER_ADMISSION_RECOVERY_VALIDATION_ISSUES.UNKNOWN_VERSION,
    ["recovery.schema_version", WORKER_ADMISSION_RECOVERY_REDACTION_REASONS.UNAUTHENTICATED_PAYLOAD]
  ],
  [
    WORKER_ADMISSION_RECOVERY_VALIDATION_ISSUES.WRONG_PROJECTION_MODE,
    ["recovery.projection_mode", WORKER_ADMISSION_RECOVERY_REDACTION_REASONS.UNAUTHENTICATED_PAYLOAD]
  ],
  [
    WORKER_ADMISSION_RECOVERY_VALIDATION_ISSUES.AUTHORITY_MISMATCH,
    ["recovery.authority", WORKER_ADMISSION_RECOVERY_REDACTION_REASONS.UNAUTHENTICATED_PAYLOAD]
  ],
  [
    WORKER_ADMISSION_RECOVERY_VALIDATION_ISSUES.RESUBMISSION_MISMATCH,
    ["recovery.requires_resubmission", WORKER_ADMISSION_RECOVERY_REDACTION_REASONS.UNAUTHENTICATED_PAYLOAD]
  ],
  [
    WORKER_ADMISSION_RECOVERY_VALIDATION_ISSUES.TRUNCATED,
    ["recovery", WORKER_ADMISSION_RECOVERY_REDACTION_REASONS.OVERSIZED_PAYLOAD]
  ],
  [
    WORKER_ADMISSION_RECOVERY_VALIDATION_ISSUES.ACTIONS_MALFORMED,
    ["recovery.actions", WORKER_ADMISSION_RECOVERY_REDACTION_REASONS.UNAUTHENTICATED_PAYLOAD]
  ]
]);

function deepFreeze(value) {
  const pending = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || typeof current !== "object" || Object.isFrozen(current)) continue;
    const members = Object.values(current);
    Object.freeze(current);
    for (const member of members) pending.push(member);
  }
  return value;
}

function canonicalJson(value) {
  const fragments = [];
  const pending = [{ kind: "value", value }];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current.kind === "literal") {
      fragments.push(current.value);
      continue;
    }
    const member = current.value;
    if (
      member === null ||
      typeof member === "boolean" ||
      typeof member === "string" ||
      (typeof member === "number" && Number.isFinite(member))
    ) {
      fragments.push(JSON.stringify(member));
      continue;
    }
    if (Array.isArray(member)) {
      fragments.push("[");
      pending.push({ kind: "literal", value: "]" });
      for (let index = member.length - 1; index >= 0; index -= 1) {
        pending.push({ kind: "value", value: member[index] });
        if (index > 0) pending.push({ kind: "literal", value: "," });
      }
      continue;
    }
    if (isPlainObject(member)) {
      fragments.push("{");
      pending.push({ kind: "literal", value: "}" });
      const keys = Object.keys(member).sort();
      for (let index = keys.length - 1; index >= 0; index -= 1) {
        const key = keys[index];
        pending.push({ kind: "value", value: member[key] });
        pending.push({
          kind: "literal",
          value: `${index > 0 ? "," : ""}${JSON.stringify(key)}:`
        });
      }
      continue;
    }
    throw new TypeError("recovery_not_json_value");
  }
  return fragments.join("");
}

function cloneJsonValue(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const clone = Array.isArray(value) ? new Array(value.length) : isPlainObject(value) ? {} : null;
  if (clone === null) throw new TypeError("recovery_not_json_value");
  const visited = new WeakSet([value]);
  const pending = [{ source: value, target: clone }];
  while (pending.length > 0) {
    const { source, target } = pending.pop();
    const keys = Array.isArray(source)
      ? Array.from({ length: source.length }, (_, index) => index)
      : Object.keys(source);
    for (const key of keys) {
      const member = source[key];
      let clonedMember;
      if (
        member === null ||
        typeof member === "boolean" ||
        typeof member === "string" ||
        (typeof member === "number" && Number.isFinite(member))
      ) {
        clonedMember = member;
      } else if (Array.isArray(member) || isPlainObject(member)) {
        if (visited.has(member)) throw new TypeError("recovery_not_json_value");
        visited.add(member);
        clonedMember = Array.isArray(member) ? new Array(member.length) : {};
        pending.push({ source: member, target: clonedMember });
      } else {
        throw new TypeError("recovery_not_json_value");
      }
      Object.defineProperty(target, key, {
        value: clonedMember,
        enumerable: true,
        configurable: true,
        writable: true
      });
    }
  }
  return clone;
}

function jsonType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function jsonPointerSegment(value) {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1");
}

function collectMemberCensus(value, pointer = "", census = []) {
  const pending = [{ value, pointer }];
  while (pending.length > 0) {
    const current = pending.pop();
    census.push(Object.freeze({ pointer: current.pointer, type: jsonType(current.value) }));
    if (Array.isArray(current.value)) {
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        pending.push({
          value: current.value[index],
          pointer: `${current.pointer}/${index}`
        });
      }
    } else if (isPlainObject(current.value)) {
      const keys = Object.keys(current.value).sort();
      for (let index = keys.length - 1; index >= 0; index -= 1) {
        const key = keys[index];
        pending.push({
          value: current.value[key],
          pointer: `${current.pointer}/${jsonPointerSegment(key)}`
        });
      }
    }
  }
  return census;
}

function publicDiagnosticFromCarrier(carrier) {
  return Object.freeze({
    issue: carrier.validation.issue,
    source_boundary: carrier.source_boundary,
    owning_boundary: carrier.validation.owning_boundary,
    validation_boundary: carrier.validation.validation_boundary,
    canonical_json_sha256: carrier.canonical_json_sha256,
    utf8_byte_count: carrier.utf8_byte_count,
    member_count: carrier.member_count
  });
}

function sanitizeEvidenceObject(value, sourceKey, presentKey) {
  if (!isPlainObject(value)) return null;
  const source = value[sourceKey];
  return Object.freeze({
    [sourceKey]: typeof source === "string" && source.length <= 128 ? source : null,
    [presentKey]: value[presentKey] === true
  });
}

function sanitizeDiagnosticContext(context) {
  const provenanceFields = ["schema_version", "pack", "operation"];
  const rawProvenance = isPlainObject(context?.response_provenance)
    ? context.response_provenance
    : null;
  const responseProvenance = rawProvenance === null ||
    Object.keys(rawProvenance).length !== provenanceFields.length
    ? null
    : Object.freeze(Object.fromEntries(provenanceFields.map((field) => [
        field,
        typeof rawProvenance[field] === "string" && rawProvenance[field].length <= 128
          ? rawProvenance[field]
          : null
      ])));
  return Object.freeze({
    response_provenance: responseProvenance,
    digest_evidence: sanitizeEvidenceObject(
      context?.digest_evidence,
      "request_contract_digest_source",
      "request_contract_digest_present"
    ),
    authority_binding_evidence: sanitizeEvidenceObject(
      context?.authority_binding_evidence,
      "worker_admission_authority_binding_source",
      "worker_admission_authority_binding_present"
    )
  });
}

function buildDiagnosticCarrier(recovery, recoveryPresent, context, validation) {
  try {
    const safeContext = sanitizeDiagnosticContext(context);
    const retainedRecovery = cloneJsonValue(recoveryPresent ? recovery : null);
    const canonical = canonicalJson(retainedRecovery);
    const memberCensus = Object.freeze(collectMemberCensus(retainedRecovery));
    return deepFreeze({
      source_boundary: WORKER_ADMISSION_RECOVERY_SOURCE_BOUNDARY,
      recovery_present: recoveryPresent,
      response_provenance: safeContext.response_provenance,
      digest_evidence: safeContext.digest_evidence,
      authority_binding_evidence: safeContext.authority_binding_evidence,
      canonical_json_sha256: createHash("sha256").update(canonical, "utf8").digest("hex"),
      utf8_byte_count: Buffer.byteLength(canonical, "utf8"),
      member_count: memberCensus.length,
      member_census: memberCensus,
      recovery: retainedRecovery,
      validation: {
        state: validation.state,
        classification: validation.state,
        issue: validation.issue,
        owning_boundary: validation.owning_boundary,
        validation_boundary: validation.validation_boundary
      }
    });
  } catch (cause) {
    if (cause instanceof WorkerAdmissionRecoveryDiagnosticConstructionError) throw cause;
    throw new WorkerAdmissionRecoveryDiagnosticConstructionError(cause);
  }
}

function diagnosticCarrierMatches(carrier, recovery, recoveryPresent, validation) {
  if (!isPlainObject(carrier)) return false;
  const expected = buildDiagnosticCarrier(recovery, recoveryPresent, {
    response_provenance: carrier.response_provenance,
    digest_evidence: carrier.digest_evidence,
    authority_binding_evidence: carrier.authority_binding_evidence
  }, validation);
  return canonicalJson(carrier) === canonicalJson(expected);
}

function diagnosticProjectionIsConsistent(diagnostic, validation) {
  if (diagnostic === undefined) return true;
  return isPlainObject(diagnostic) &&
    Object.keys(diagnostic).length === 7 &&
    diagnostic.issue === validation.issue &&
    diagnostic.source_boundary === WORKER_ADMISSION_RECOVERY_SOURCE_BOUNDARY &&
    diagnostic.owning_boundary === WORKER_ADMISSION_RECOVERY_OWNING_BOUNDARY &&
    diagnostic.validation_boundary === WORKER_ADMISSION_RECOVERY_VALIDATION_BOUNDARY &&
    /^[a-f0-9]{64}$/u.test(diagnostic.canonical_json_sha256) &&
    Number.isInteger(diagnostic.utf8_byte_count) && diagnostic.utf8_byte_count >= 0 &&
    Number.isInteger(diagnostic.member_count) && diagnostic.member_count >= 1;
}

function withDiagnosticCarrier(validation, recovery, recoveryPresent, context) {
  const carrier = buildDiagnosticCarrier(recovery, recoveryPresent, context, validation);
  const result = { ...validation, diagnostic: publicDiagnosticFromCarrier(carrier) };
  Object.defineProperty(result, "diagnostic_carrier", {
    value: carrier,
    enumerable: false,
    configurable: false,
    writable: false
  });
  return deepFreeze(result);
}

function invalidRecovery(issue) {
  const [field, reason] = INVALID_RECOVERY_TUPLES.get(issue) ??
    INVALID_RECOVERY_TUPLES.get(WORKER_ADMISSION_RECOVERY_VALIDATION_ISSUES.MALFORMED);
  return {
    state: "invalid",
    issue,
    owning_boundary: WORKER_ADMISSION_RECOVERY_OWNING_BOUNDARY,
    validation_boundary: WORKER_ADMISSION_RECOVERY_VALIDATION_BOUNDARY,
    recovery: null,
    redactions: [Object.freeze({ field, reason })]
  };
}

function missingRecovery() {
  return {
    state: "missing",
    issue: WORKER_ADMISSION_RECOVERY_VALIDATION_ISSUES.MISSING,
    owning_boundary: WORKER_ADMISSION_RECOVERY_OWNING_BOUNDARY,
    validation_boundary: WORKER_ADMISSION_RECOVERY_VALIDATION_BOUNDARY,
    recovery: null,
    redactions: []
  };
}

export function validateWorkerAdmissionRecovery(
  recovery,
  { expectedProjectionMode = null, diagnosticContext = null } = {}
) {
  const recoveryPresent = recovery !== undefined;
  let validation;
  if (recovery === undefined) {
    validation = missingRecovery();
  } else if (!isPlainObject(recovery)) {
    validation = invalidRecovery(WORKER_ADMISSION_RECOVERY_VALIDATION_ISSUES.MALFORMED);
  } else if (Object.keys(recovery).some(
    (key) => !WORKER_ADMISSION_RECOVERY_TOP_LEVEL_FIELDS.has(key)
  )) {
    validation = invalidRecovery(WORKER_ADMISSION_RECOVERY_VALIDATION_ISSUES.UNKNOWN_FIELD);
  } else if (recovery.schema_version !== WORKER_ADMISSION_RECOVERY_SCHEMA_VERSION) {
    validation = invalidRecovery(WORKER_ADMISSION_RECOVERY_VALIDATION_ISSUES.UNKNOWN_VERSION);
  } else if (
    !WORKER_ADMISSION_RECOVERY_PROJECTION_MODES.has(recovery.projection_mode) ||
    (expectedProjectionMode !== null && recovery.projection_mode !== expectedProjectionMode)
  ) {
    validation = invalidRecovery(WORKER_ADMISSION_RECOVERY_VALIDATION_ISSUES.WRONG_PROJECTION_MODE);
  } else if (recovery.authority !== WORKER_ADMISSION_RECOVERY_AUTHORITY) {
    validation = invalidRecovery(WORKER_ADMISSION_RECOVERY_VALIDATION_ISSUES.AUTHORITY_MISMATCH);
  } else if (recovery.requires_resubmission !== true) {
    validation = invalidRecovery(WORKER_ADMISSION_RECOVERY_VALIDATION_ISSUES.RESUBMISSION_MISMATCH);
  } else if (recovery.truncated === true) {
    validation = invalidRecovery(WORKER_ADMISSION_RECOVERY_VALIDATION_ISSUES.TRUNCATED);
  } else {
    const summary = summarizeWorkerAdmissionRecoveryObject(recovery);
    validation = summary === null
      ? invalidRecovery(WORKER_ADMISSION_RECOVERY_VALIDATION_ISSUES.ACTIONS_MALFORMED)
      : {
          state: "valid",
          issue: null,
          owning_boundary: WORKER_ADMISSION_RECOVERY_OWNING_BOUNDARY,
          validation_boundary: WORKER_ADMISSION_RECOVERY_VALIDATION_BOUNDARY,
          recovery: deepFreeze(summary),
          redactions: []
        };
  }
  return withDiagnosticCarrier(validation, recovery, recoveryPresent, diagnosticContext);
}

export function validateWorkerAdmissionRecoveryResult(
  validation,
  { expectedProjectionMode = null } = {}
) {
  if (!isPlainObject(validation)) {
    return validateWorkerAdmissionRecovery(null, { expectedProjectionMode });
  }
  if (!diagnosticProjectionIsConsistent(validation.diagnostic, validation)) {
    return validateWorkerAdmissionRecovery(null, { expectedProjectionMode });
  }
  if (validation.state === "valid") {
    const checked = validateWorkerAdmissionRecovery(validation.recovery, { expectedProjectionMode });
    const carrier = validation.diagnostic_carrier;
    if (checked.state !== "valid" || carrier === undefined) return checked;
    const carriedRaw = carrier?.recovery_present === true ? carrier.recovery : undefined;
    if (!diagnosticCarrierMatches(carrier, carriedRaw, true, validation)) {
      return validateWorkerAdmissionRecovery(null, { expectedProjectionMode });
    }
    const carriedValidation = validateWorkerAdmissionRecovery(carriedRaw, { expectedProjectionMode });
    if (carriedValidation.state !== "valid") {
      return validateWorkerAdmissionRecovery(null, { expectedProjectionMode });
    }
    return withDiagnosticCarrier(checked, carriedRaw, true, {
      response_provenance: carrier.response_provenance,
      digest_evidence: carrier.digest_evidence,
      authority_binding_evidence: carrier.authority_binding_evidence
    });
  }
  if (validation.state === "missing") {
    if (
      validation.issue === WORKER_ADMISSION_RECOVERY_VALIDATION_ISSUES.MISSING &&
      validation.recovery === null &&
      validation.owning_boundary === WORKER_ADMISSION_RECOVERY_OWNING_BOUNDARY &&
      validation.validation_boundary === WORKER_ADMISSION_RECOVERY_VALIDATION_BOUNDARY &&
      Array.isArray(validation.redactions) &&
      validation.redactions.length === 0
    ) {
      const carrier = validation.diagnostic_carrier;
      if (carrier === undefined) {
        return validateWorkerAdmissionRecovery(undefined, { expectedProjectionMode });
      }
      const carriedRaw = carrier?.recovery_present === true ? carrier.recovery : undefined;
      if (!diagnosticCarrierMatches(carrier, null, false, validation)) {
        return validateWorkerAdmissionRecovery(null, { expectedProjectionMode });
      }
      const carriedValidation = validateWorkerAdmissionRecovery(carriedRaw, {
        expectedProjectionMode
      });
      if (carriedValidation.state !== "missing") {
        return validateWorkerAdmissionRecovery(null, { expectedProjectionMode });
      }
      return withDiagnosticCarrier(missingRecovery(), null, false, {
        response_provenance: carrier.response_provenance,
        digest_evidence: carrier.digest_evidence,
        authority_binding_evidence: carrier.authority_binding_evidence
      });
    }
    return validateWorkerAdmissionRecovery(null, { expectedProjectionMode });
  }
  const tuple = INVALID_RECOVERY_TUPLES.get(validation.issue);
  if (
    validation.state !== "invalid" ||
    tuple === undefined ||
    validation.recovery !== null ||
    validation.owning_boundary !== WORKER_ADMISSION_RECOVERY_OWNING_BOUNDARY ||
    validation.validation_boundary !== WORKER_ADMISSION_RECOVERY_VALIDATION_BOUNDARY ||
    !Array.isArray(validation.redactions) ||
    validation.redactions.length !== 1 ||
    !isPlainObject(validation.redactions[0]) ||
    validation.redactions[0].field !== tuple[0] ||
    validation.redactions[0].reason !== tuple[1]
  ) {
    return validateWorkerAdmissionRecovery(null, { expectedProjectionMode });
  }
  const canonical = invalidRecovery(validation.issue);
  const carrier = validation.diagnostic_carrier;
  if (carrier === undefined) {
    return deepFreeze(canonical);
  }
  const carriedRaw = carrier?.recovery_present === true ? carrier.recovery : undefined;
  if (!diagnosticCarrierMatches(
    carrier,
    carriedRaw,
    carrier?.recovery_present === true,
    validation
  )) {
    return validateWorkerAdmissionRecovery(null, { expectedProjectionMode });
  }
  const carriedValidation = validateWorkerAdmissionRecovery(carriedRaw, { expectedProjectionMode });
  if (carriedValidation.state !== validation.state || carriedValidation.issue !== validation.issue) {
    return validateWorkerAdmissionRecovery(null, { expectedProjectionMode });
  }
  const context = {
    response_provenance: carrier.response_provenance,
    digest_evidence: carrier.digest_evidence,
    authority_binding_evidence: carrier.authority_binding_evidence
  };
  return withDiagnosticCarrier(canonical, carriedRaw, carrier.recovery_present === true, context);
}

export function workerAdmissionRecoveryProjectionState(validation) {
  const checked = validateWorkerAdmissionRecoveryResult(validation, {
    expectedProjectionMode: "bounded_current_decision_recovery"
  });
  return checked.state === "valid" ? "valid" : checked.state === "missing" ? "absent" : "invalid";
}

function readPackResultEffect(packResult) {
  return WORKER_ADMISSION_RECOVERY_PACK_RESULT_EFFECTS.has(packResult?.decision)
    ? packResult.decision
    : null;
}

function summarizePackResultRecovery(packResult) {
  if (!isPlainObject(packResult) || !Object.prototype.hasOwnProperty.call(packResult, "recovery")) {
    return null;
  }
  if (readPackResultEffect(packResult) === null) return null;

  return validateWorkerAdmissionRecovery(packResult.recovery, {
    expectedProjectionMode: "bounded_current_decision_recovery"
  }).recovery;
}

function summarizeRouteProblemRecovery(body) {
  if (
    typeof body.type !== "string" ||
    !WORKER_ADMISSION_RECOVERY_ROUTE_PROBLEM_TYPES.has(body.type)
  ) {
    return null;
  }

  return validateWorkerAdmissionRecovery(body.recovery, {
    expectedProjectionMode: "route_problem_recovery"
  }).recovery;
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
