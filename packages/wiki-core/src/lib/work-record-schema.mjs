

import { createHash } from "node:crypto";

import {
  hasOwn,
  isObject,
  isString,
  addDiagnostic,
  createDiagnostic,
  validateEnumField,
  validateStringField,
  validateStringArrayField,
  validateNullableStringField
} from "./work-record-schema-validators.mjs";
import {
  validateTopLevelArrays,
  validateDispatchIntent,
  validateAcceptance,
  validateSections,
  validateMigration,
  validateExpectedEditTargets,
  validateProjection,
  validateDerivedEvidence
} from "./work-record-schema-structure.mjs";
import { validateWorkUnitFeatureVectorInto } from "./work-record-schema-feature-vector.mjs";
import {
  WORK_RECORD_SCHEMA_VERSION,
  WORK_RECORD_RECORD_KIND_VALUES,
  WORK_RECORD_WORK_KIND_VALUES,
  WORK_RECORD_STATUS_VALUES,
  REQUIRED_TOP_LEVEL_FIELDS,
  REQUIRED_STRING_TOP_LEVEL_FIELDS,
  OPTIONAL_STRING_TOP_LEVEL_FIELDS
} from "./work-record-schema-constants.mjs";

export {
  WORK_RECORD_SCHEMA_VERSION,
  WORK_RECORD_CLOSURE_FIELD_NAMES,
  WORK_RECORD_RENDER_SCHEMA_VERSION,
  WORK_RECORD_PROJECTION_AUTHORITY,
  WORK_RECORD_DERIVED_EVIDENCE_SCHEMA_VERSION,
  WORK_UNIT_FEATURE_VECTOR_SCHEMA_VERSION,
  WORK_UNIT_ONTOLOGY_SCHEMA_VERSION,
  WORK_RECORD_DERIVED_EVIDENCE_DECISION_KIND_VALUES,
  WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_REQUIRED_METRIC_FIELD_SPECS,
  WORK_RECORD_RECORD_KIND_VALUES,
  WORK_RECORD_WORK_KIND_VALUES,
  WORK_RECORD_STATUS_VALUES,
  WORK_RECORD_TARGET_UNIT_VALUES,
  WORK_RECORD_AGENT_ROLE_VALUES,
  WORK_RECORD_ESCALATION_KIND_VALUES,
  WORK_RECORD_ESCALATION_STATUS_VALUES,
  WORK_RECORD_PROJECTION_KIND_VALUES,
  WORK_UNIT_FEATURE_VECTOR_ACTIVITY_KIND_VALUES,
  WORK_UNIT_FEATURE_VECTOR_ARTIFACT_KIND_VALUES,
  WORK_UNIT_FEATURE_VECTOR_OPERATION_VALUES,
  WORK_UNIT_FEATURE_VECTOR_GRANULARITY_VALUES,
  WORK_UNIT_FEATURE_VECTOR_VERIFICATION_METHOD_VALUES,
  WORK_UNIT_FEATURE_VECTOR_SCENARIO_KIND_VALUES,
  WORK_UNIT_FEATURE_VECTOR_RUNTIME_MODE_VALUES,
  WORK_UNIT_FACET_PROVENANCE_VALUES,
  WORK_RECORD_MIGRATION_REVIEW_STATE_VALUES,
  WORK_REPORT_SCHEMA_VERSION,
  WORK_REPORT_STATUS_VALUES,
  WORK_REPORT_VALIDATION_STATUS_VALUES,
  WORK_RECORD_ESCALATION_PROVENANCE_SOURCE_KIND_VALUES,
  WORK_RECORD_ESCALATION_PROVENANCE_CANONICALITY_VALUES,
  WORK_RECORD_ESCALATION_PROVENANCE_EVIDENCE_BASIS_VALUES,
  WORK_RECORD_DIAGNOSTIC_CODES
} from "./work-record-schema-constants.mjs";
export { validateWorkUnitFeatureVector } from "./work-record-schema-feature-vector.mjs";
export { validateWorkerAdmissionDerivedEvidence } from "./work-record-schema-derived-evidence.mjs";
export { validateWorkReport } from "./work-record-schema-work-report.mjs";

function canonicalizeValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalizeValue(entry)).join(",")}]`;
  }
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort(compareCanonicalObjectKeys)
      .map((key) => `${JSON.stringify(key)}:${canonicalizeValue(value[key])}`)
      .join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("work record canonicalization requires finite numbers");
  }
  return JSON.stringify(value);
}

function compareCanonicalObjectKeys(left, right) {
  const leftPoints = Array.from(left);
  const rightPoints = Array.from(right);
  const limit = Math.min(leftPoints.length, rightPoints.length);

  for (let index = 0; index < limit; index += 1) {
    const leftCodePoint = leftPoints[index].codePointAt(0);
    const rightCodePoint = rightPoints[index].codePointAt(0);
    if (leftCodePoint < rightCodePoint) {
      return -1;
    }
    if (leftCodePoint > rightCodePoint) {
      return 1;
    }
  }

  return leftPoints.length - rightPoints.length;
}

export function canonicalizeWorkRecordJson(value) {
  return canonicalizeValue(value);
}

export function computeWorkRecordSourceDigest(record) {
  const { derived_evidence, projections, ...digestInput } = record || {};
  const hash = createHash("sha256");
  hash.update(canonicalizeWorkRecordJson(digestInput));
  return `sha256:${hash.digest("hex")}`;
}

export function createWorkRecordDiagnostic(code, message, options = {}) {
  return createDiagnostic(code, message, options);
}

export function createWorkRecordValidationResult(overrides = {}) {
  return {
    valid: false,
    diagnostics: [],
    ...overrides
  };
}

export function isSupportedWorkRecordSchemaVersion(schemaVersion) {
  return schemaVersion === WORK_RECORD_SCHEMA_VERSION;
}

export function parseWorkRecordJson(text, { sourcePath = null } = {}) {
  try {
    return {
      ok: true,
      value: JSON.parse(text),
      diagnostics: []
    };
  } catch (error) {
    return {
      ok: false,
      value: null,
      diagnostics: [
        createDiagnostic(
          "invalid_json",
          `Failed to parse work record JSON${sourcePath ? ` at ${sourcePath}` : ""}: ${error.message}`
        )
      ]
    };
  }
}

export function mergeReadScopeRefs(unit) {
  const refs = [];
  const seen = new Set();
  for (const field of ["read_scope", "docs"]) {
    const list = unit?.[field];
    if (!Array.isArray(list)) {
      continue;
    }
    for (const entry of list) {
      if (typeof entry !== "string" || seen.has(entry)) {
        continue;
      }
      seen.add(entry);
      refs.push(entry);
    }
  }
  return refs;
}

function canonicalizeUnitReadScope(unit) {
  if (!isObject(unit) || (!hasOwn(unit, "read_scope") && !hasOwn(unit, "docs"))) {
    return unit;
  }
  const merged = mergeReadScopeRefs(unit);
  const out = {};
  let placed = false;
  for (const [key, value] of Object.entries(unit)) {
    if (key === "read_scope" || key === "docs") {
      if (!placed) {
        out.read_scope = merged;
        placed = true;
      }
      continue;
    }
    out[key] = value;
  }
  if (!placed) {
    out.read_scope = merged;
  }
  return out;
}

export function canonicalizeWorkRecordReadScope(record) {
  if (!isObject(record)) {
    return record;
  }
  const canonical = canonicalizeUnitReadScope(record);
  const result = canonical === record ? { ...record } : canonical;
  if (Array.isArray(record.slices)) {
    result.slices = record.slices.map((slice) => canonicalizeUnitReadScope(slice));
  }
  return result;
}

function defineReadScopeAlias(unit) {
  if (!isObject(unit)) {
    return;
  }
  const hasRead = Array.isArray(unit.read_scope);
  const hasDocs = Array.isArray(unit.docs);
  if (hasRead && !hasDocs) {
    Object.defineProperty(unit, "docs", {
      value: unit.read_scope,
      enumerable: false,
      configurable: true,
      writable: true
    });
  } else if (hasDocs && !hasRead) {
    Object.defineProperty(unit, "read_scope", {
      value: unit.docs,
      enumerable: false,
      configurable: true,
      writable: true
    });
  }
}

export function attachWorkRecordReadScopeAlias(record) {
  if (!isObject(record)) {
    return record;
  }
  defineReadScopeAlias(record);
  if (Array.isArray(record.slices)) {
    for (const slice of record.slices) {
      defineReadScopeAlias(slice);
    }
  }
  return record;
}

function validateReadScopeField(diagnostics, unit, basePath = "") {
  const prefix = basePath ? `${basePath}.` : "";
  const hasRead = hasOwn(unit, "read_scope");
  const hasDocs = hasOwn(unit, "docs");
  if (!hasRead && !hasDocs) {
    addDiagnostic(diagnostics, "invalid_record", `${prefix}read_scope is required`, {
      path: `${prefix}read_scope`
    });
    return;
  }
  if (hasRead) {
    validateStringArrayField(diagnostics, unit, "read_scope", {
      path: `${prefix}read_scope`,
      required: false
    });
  }
  if (hasDocs) {
    validateStringArrayField(diagnostics, unit, "docs", {
      path: `${prefix}docs`,
      required: false
    });
  }
}

export function validateWorkRecord(record, { sourcePath = null, sourceDigest = null } = {}) {
  const diagnostics = [];

  if (!isObject(record)) {
    addDiagnostic(diagnostics, "invalid_record", "work record must be an object", {
      path: sourcePath
    });
    return diagnostics;
  }

  if (!hasOwn(record, "schema_version")) {
    addDiagnostic(diagnostics, "invalid_record", "schema_version is required", {
      path: "schema_version"
    });
    return diagnostics;
  }
  if (!isString(record.schema_version)) {
    addDiagnostic(diagnostics, "invalid_record", "schema_version must be a string", {
      path: "schema_version"
    });
    return diagnostics;
  }
  if (!isSupportedWorkRecordSchemaVersion(record.schema_version)) {
    addDiagnostic(
      diagnostics,
      "unknown_schema_version",
      `Unsupported work record schema version: ${record.schema_version}`,
      { path: "schema_version" }
    );
    return diagnostics;
  }

  if (!hasOwn(record, "record_kind")) {
    addDiagnostic(diagnostics, "invalid_record", "record_kind is required", {
      path: "record_kind"
    });
    return diagnostics;
  }
  if (!isString(record.record_kind)) {
    addDiagnostic(diagnostics, "invalid_record", "record_kind must be a string", {
      path: "record_kind"
    });
    return diagnostics;
  }
  if (!WORK_RECORD_RECORD_KIND_VALUES.includes(record.record_kind)) {
    addDiagnostic(
      diagnostics,
      "invalid_record",
      `record_kind must be one of: ${WORK_RECORD_RECORD_KIND_VALUES.join(", ")}`,
      { path: "record_kind" }
    );
    return diagnostics;
  }
  if (record.record_kind !== "work_item") {
    addDiagnostic(
      diagnostics,
      "unsupported_record_kind",
      `Unsupported work record kind for v1: ${record.record_kind}`,
      { path: "record_kind" }
    );
    return diagnostics;
  }

  if (hasOwn(record, "dispatchable")) {
    addDiagnostic(
      diagnostics,
      "invalid_record",
      "dispatchable is authored dispatch authority and must not be stored in work-record.v1",
      { path: "dispatchable" }
    );
  }

  for (const field of REQUIRED_TOP_LEVEL_FIELDS) {
    if (!hasOwn(record, field)) {
      addDiagnostic(diagnostics, "invalid_record", `${field} is required`, { path: field });
    }
  }

  for (const field of REQUIRED_STRING_TOP_LEVEL_FIELDS) {
    validateStringField(diagnostics, record, field, { path: field, allowEmpty: false });
  }
  for (const field of OPTIONAL_STRING_TOP_LEVEL_FIELDS) {
    validateNullableStringField(diagnostics, record, field, { path: field });
  }

  validateEnumField(diagnostics, record, "work_kind", WORK_RECORD_WORK_KIND_VALUES, {
    path: "work_kind"
  });
  validateEnumField(diagnostics, record, "status", WORK_RECORD_STATUS_VALUES, { path: "status" });

  validateTopLevelArrays(diagnostics, record);
  validateReadScopeField(diagnostics, record);
  validateDispatchIntent(diagnostics, record.dispatch_intent);
  validateAcceptance(diagnostics, record.acceptance);
  validateSections(diagnostics, record.sections);
  validateMigration(diagnostics, record.migration);
  if (hasOwn(record, "expected_edit_targets")) {
    validateExpectedEditTargets(diagnostics, record.expected_edit_targets, "expected_edit_targets");
  }

  if (sourcePath && isString(record.id)) {
    const normalizedSourcePath = String(sourcePath).replaceAll("\\", "/");
    const stem = normalizedSourcePath.split("/").pop()?.replace(/\.json$/i, "") || "";
    if (stem && stem !== record.id) {
      addDiagnostic(
        diagnostics,
        "path_id_mismatch",
        `Work record path stem ${stem} does not match record id ${record.id}`,
        { path: sourcePath }
      );
    }
  }

  if (Array.isArray(record.projections) && sourceDigest) {
    record.projections.forEach((projection, index) =>
      validateProjection(diagnostics, projection, `projections[${index}]`, sourceDigest, record.id)
    );
  } else if (Array.isArray(record.projections)) {
    record.projections.forEach((projection, index) =>
      validateProjection(diagnostics, projection, `projections[${index}]`, null, record.id)
    );
  }

  if (Array.isArray(record.derived_evidence)) {
    record.derived_evidence.forEach((evidence, index) =>
      validateDerivedEvidence(diagnostics, evidence, `derived_evidence[${index}]`, record.id, record.repo)
    );
  }

  if (hasOwn(record, "feature_vector")) {
    validateWorkUnitFeatureVectorInto(diagnostics, record.feature_vector, "feature_vector");
  }

  return diagnostics;
}

export function isMigrationReviewAcknowledged(migration) {
  if (!isObject(migration)) {
    return false;
  }
  if (migration.review_state !== "reviewed") {
    return false;
  }
  if (!isObject(migration.review_acknowledgement)) {
    return false;
  }

  return (
    isString(migration.review_acknowledgement.reviewed_at) &&
    isString(migration.review_acknowledgement.reviewed_by) &&
    isString(migration.review_acknowledgement.reviewed_via)
  );
}
