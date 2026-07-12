

import {
  WORK_RECORD_STATUS_VALUES,
  WORK_RECORD_WORK_KIND_VALUES,
  REQUIRED_STRING_TOP_LEVEL_FIELDS,
  REQUIRED_ARRAY_OF_STRING_TOP_LEVEL_FIELDS,
  OPTIONAL_STRING_TOP_LEVEL_FIELDS,
  OPTIONAL_ARRAY_OF_STRING_TOP_LEVEL_FIELDS,
  OPTIONAL_NON_NEGATIVE_INTEGER_TOP_LEVEL_FIELDS
} from "./work-record-schema-constants.mjs";
import {
  hasOwn,
  isObject,
  isString,
  isStringArray,
  isNullableString,
  addDiagnostic
} from "./work-record-schema-validators.mjs";

export const DECISION_STATUS_VALUES = Object.freeze([
  "proposed",
  "accepted",
  "rejected",
  "superseded",
  "expired",
  "deprecated"
]);

export const INITIATIVE_STATUS_VALUES = Object.freeze([
  "todo", "in_progress", "blocked", "review", "done", "parked", "cancelled", "deprecated"
]);

function buildWorkItemRequiredTopLevel() {
  const spec = {
    schema_version: { type: "string" },
    record_kind: { type: "const", value: "work_item" },
    work_kind: { type: "enum", values: WORK_RECORD_WORK_KIND_VALUES },
    status: { type: "status" },
    read_scope: { type: "read_scope" },
    dispatch_intent: { type: "object" },
    acceptance: { type: "object" },
    sections: { type: "object" },
    children: { type: "array" },
    slices: { type: "array" },
    escalations: { type: "array" },
    projections: { type: "array" }
  };
  for (const field of REQUIRED_STRING_TOP_LEVEL_FIELDS) {
    spec[field] = { type: "string" };
  }
  for (const field of REQUIRED_ARRAY_OF_STRING_TOP_LEVEL_FIELDS) {
    spec[field] = { type: "string_array" };
  }
  return spec;
}

function buildWorkItemOptionalTopLevel() {
  const spec = {
    migration: { type: "nullable_object" },
    derived_evidence: { type: "array" }
  };
  for (const field of OPTIONAL_STRING_TOP_LEVEL_FIELDS) {
    spec[field] = { type: "nullable_string" };
  }
  for (const field of OPTIONAL_ARRAY_OF_STRING_TOP_LEVEL_FIELDS) {
    spec[field] = { type: "string_array" };
  }
  for (const field of OPTIONAL_NON_NEGATIVE_INTEGER_TOP_LEVEL_FIELDS) {
    spec[field] = { type: "nullable_integer" };
  }
  return spec;
}

const WORK_ITEM_SPEC = Object.freeze({
  recordKind: "work_item",
  requiredTopLevel: Object.freeze(buildWorkItemRequiredTopLevel()),
  optionalTopLevel: Object.freeze(buildWorkItemOptionalTopLevel()),
  statusEnum: WORK_RECORD_STATUS_VALUES,
  sectionSpec: Object.freeze({
    summary: { type: "string", allowEmpty: true },
    why_it_matters: { type: "string", allowEmpty: true },
    scope: { type: "object" },
    tasks: { type: "array" },
    references: { type: "string_array" },
    agent_notes: { type: "string", allowEmpty: true },
    closure: { type: "nullable_object" }
  })
});

const DECISION_SPEC = Object.freeze({
  recordKind: "decision",
  requiredTopLevel: Object.freeze({
    id: { type: "string" },
    record_kind: { type: "const", value: "decision" },
    title: { type: "string" },
    status: { type: "status" },
    date: { type: "string" },
    owners: { type: "string_array" }
  }),
  optionalTopLevel: Object.freeze({
    area: { type: "nullable_string" },
    docs: { type: "string_array" },
    related: { type: "string_array" },
    supersedes: { type: "nullable_string" },
    superseded_by: { type: "nullable_string" },

    updated: { type: "nullable_string" },
    updated_by: { type: "nullable_string" },
    ratified: { type: "nullable_string" },
    ratified_by: { type: "nullable_string" },

    enforcement: { type: "reserved" }
  }),
  statusEnum: DECISION_STATUS_VALUES,
  sectionSpec: Object.freeze({
    context: { type: "string", allowEmpty: true },
    decision: { type: "string", allowEmpty: true },
    consequences: { type: "string", allowEmpty: true }
  })
});

const INITIATIVE_SPEC = Object.freeze({
  recordKind: "initiative",
  requiredTopLevel: Object.freeze({
    id: { type: "string" },
    record_kind: { type: "const", value: "initiative" },
    title: { type: "string" },
    status: { type: "status" },
    priority: { type: "string" },
    owner: { type: "string" },
    created: { type: "string" },
    updated: { type: "string" }
  }),
  optionalTopLevel: Object.freeze({
    summary: { type: "nullable_string" },
    area: { type: "nullable_string" },
    tags: { type: "string_array" },
    docs: { type: "string_array" },
    depends_on: { type: "string_array" },
    blocks: { type: "string_array" },
    related: { type: "string_array" },
    write_scope: { type: "string_array" },
    assignees: { type: "string_array" },
    agents: { type: "string_array" },
    reviewers: { type: "string_array" },
    target: { type: "nullable_string" },
    started: { type: "nullable_string" },
    completed: { type: "nullable_string" },

    updated_by: { type: "nullable_string" },

    included_issues: { type: "reserved" }
  }),
  statusEnum: INITIATIVE_STATUS_VALUES,
  sectionSpec: Object.freeze({
    summary: { type: "string", allowEmpty: true },
    goals: { type: "string", allowEmpty: true },
    milestones: { type: "string", allowEmpty: true }
  })
});

export const RECORD_KIND_SPECS = Object.freeze({
  work_item: WORK_ITEM_SPEC,
  decision: DECISION_SPEC,
  initiative: INITIATIVE_SPEC
});

export function getRecordKindSpec(recordKind) {
  if (!isString(recordKind) || !hasOwn(RECORD_KIND_SPECS, recordKind)) {
    return null;
  }
  return RECORD_KIND_SPECS[recordKind];
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function validateFieldByType(diagnostics, record, name, descriptor, spec, path, required) {
  const present = hasOwn(record, name);
  if (!present) {
    if (required) {
      addDiagnostic(diagnostics, "invalid_record", `${path} is required`, { path });
    }
    return;
  }
  const value = record[name];
  switch (descriptor.type) {
    case "reserved":

      return;
    case "const":
      if (value !== descriptor.value) {
        addDiagnostic(diagnostics, "invalid_record", `${path} must be ${JSON.stringify(descriptor.value)}`, {
          path
        });
      }
      return;
    case "string":
      if (!isString(value) || (descriptor.allowEmpty !== true && value.trim() === "")) {
        addDiagnostic(
          diagnostics,
          "invalid_record",
          descriptor.allowEmpty === true
            ? `${path} must be a string`
            : `${path} must be a non-empty string`,
          { path }
        );
      }
      return;
    case "nullable_string":
      if (!isNullableString(value)) {
        addDiagnostic(diagnostics, "invalid_record", `${path} must be a string or null`, { path });
      }
      return;
    case "string_array":
      if (!isStringArray(value)) {
        addDiagnostic(diagnostics, "invalid_record", `${path} must be an array of strings`, { path });
      }
      return;
    case "array":
      if (!Array.isArray(value)) {
        addDiagnostic(diagnostics, "invalid_record", `${path} must be an array`, { path });
      }
      return;
    case "object":
      if (!isObject(value)) {
        addDiagnostic(diagnostics, "invalid_record", `${path} must be an object`, { path });
      }
      return;
    case "nullable_object":
      if (value !== null && !isObject(value)) {
        addDiagnostic(diagnostics, "invalid_record", `${path} must be null or an object`, { path });
      }
      return;
    case "boolean":
      if (typeof value !== "boolean") {
        addDiagnostic(diagnostics, "invalid_record", `${path} must be a boolean`, { path });
      }
      return;
    case "nullable_integer":
      if (value !== null && !isNonNegativeInteger(value)) {
        addDiagnostic(diagnostics, "invalid_record", `${path} must be a non-negative integer or null`, {
          path
        });
      }
      return;
    case "enum":
      if (!descriptor.values.includes(value)) {
        addDiagnostic(
          diagnostics,
          "invalid_record",
          `${path} must be one of: ${descriptor.values.join(", ")}`,
          { path }
        );
      }
      return;
    case "status":
      if (!spec.statusEnum.includes(value)) {
        addDiagnostic(
          diagnostics,
          "invalid_record",
          `${path} must be one of: ${spec.statusEnum.join(", ")}`,
          { path }
        );
      }
      return;
    case "read_scope":
      validateReadScopeField(diagnostics, record, path);
      return;
    default:
      return;
  }
}

function validateReadScopeField(diagnostics, record, path) {
  const hasRead = hasOwn(record, "read_scope");
  const hasDocs = hasOwn(record, "docs");
  if (!hasRead && !hasDocs) {
    addDiagnostic(diagnostics, "invalid_record", `${path} is required`, { path });
    return;
  }
  if (hasRead && !isStringArray(record.read_scope)) {
    addDiagnostic(diagnostics, "invalid_record", "read_scope must be an array of strings", {
      path: "read_scope"
    });
  }
  if (hasDocs && !isStringArray(record.docs)) {
    addDiagnostic(diagnostics, "invalid_record", "docs must be an array of strings", { path: "docs" });
  }
}

function validateSectionSpec(diagnostics, sections, sectionSpec) {

  if (!hasOwn(sections, "sections")) {
    return;
  }
  const value = sections.sections;
  if (value === null) {
    return;
  }
  if (!isObject(value)) {
    addDiagnostic(diagnostics, "invalid_record", "sections must be an object", { path: "sections" });
    return;
  }
  for (const [name, descriptor] of Object.entries(sectionSpec)) {
    validateFieldByType(diagnostics, value, name, descriptor, null, `sections.${name}`, false);
  }
}

export function validateRecordByKind(record) {
  const diagnostics = [];
  if (!isObject(record)) {
    addDiagnostic(diagnostics, "invalid_record", "record must be an object", { path: null });
    return diagnostics;
  }
  if (!hasOwn(record, "record_kind") || !isString(record.record_kind)) {
    addDiagnostic(diagnostics, "invalid_record", "record_kind is required", { path: "record_kind" });
    return diagnostics;
  }
  const spec = getRecordKindSpec(record.record_kind);
  if (!spec) {
    addDiagnostic(
      diagnostics,
      "unsupported_record_kind",
      `Unsupported record kind: ${record.record_kind}`,
      { path: "record_kind" }
    );
    return diagnostics;
  }

  for (const [name, descriptor] of Object.entries(spec.requiredTopLevel)) {
    validateFieldByType(diagnostics, record, name, descriptor, spec, name, true);
  }
  for (const [name, descriptor] of Object.entries(spec.optionalTopLevel)) {
    validateFieldByType(diagnostics, record, name, descriptor, spec, name, false);
  }
  validateSectionSpec(diagnostics, record, spec.sectionSpec);

  return diagnostics;
}
