

import {
  REPOSITORY_SCOPE_FIELDS,
  UNSUPPORTED_REPOSITORY_SCOPE_SELECTOR,
  findUnsupportedRepositoryScopeSelector,
  isRepositoryRelativePath,
  normalizeRepositoryRelativePath,
  repositoryScopeSelectorRefusalMessage,
  NORMALIZED_REPOSITORY_PATH_SCHEMA
} from "./work-record-repository-path.mjs";
import { canonicalizeWorkRecordReadScope } from "./work-record-schema.mjs";
import { REPOSITORY_TEST_DECLARATION_SCHEMA, VALIDATION_NOTE_SCHEMA } from "./work-record-test-proof-bindings.mjs";
import { findSliceRegressionTestsDefect } from "./work-record-schema-structure.mjs";
import {
  collectControlledContractPrivateScopeIntersections
} from "./controlled-contract-private-path-policy.mjs";
import {
  WORK_RECORD_FINDINGS_ACCEPTED_REVIEW_PURPOSES,
  WORK_RECORD_FINDINGS_TECHNICAL_ROLE_BY_WORK_KIND,
  analyzeWorkRecordFindingsUnit
} from "./work-record-findings-semantics.mjs";
import {
  SHA256_PATTERN,
  WORK_RECORD_COMPLETION_POLICY_VALUES,
  WORK_RECORD_REVIEW_PURPOSE_VALUES,
  WORK_RECORD_STATUS_VALUES,
  WORK_UNIT_FACET_PROVENANCE_VALUES,
  WORK_UNIT_FEATURE_VECTOR_ACTIVITY_KIND_VALUES,
  WORK_UNIT_FEATURE_VECTOR_ARTIFACT_KIND_VALUES,
  WORK_UNIT_FEATURE_VECTOR_GRANULARITY_VALUES,
  WORK_UNIT_FEATURE_VECTOR_VERIFICATION_METHOD_VALUES
} from "./work-record-schema-constants.mjs";
import {
  WORK_RECORD_EXPECTED_EDIT_TARGET_KIND_VALUES,
  WORK_RECORD_EXPECTED_EDIT_TARGET_OPERATION_VALUES
} from "./work-record-target-metrics.mjs";
import {
  ORDINAL_SLICE_ID_PATTERN,
  RECORD_ID_PATTERN,
  cloneJson,
  collectJsonDiffPaths,
  createDiagnostic,
  diagnosticPathIsWithin,
  finalizeEdit,
  findSliceIndexes,
  hasOwn,
  isObject,
  isString,
  jsonEqual,
  nextOrdinalSliceId,
  refusal
} from "./work-record-contract-edit-shared.mjs";
import { validateWorkRecordMaterialRefs } from "./work-record-entry-material.mjs";
import { planAcceptanceNarrativeValidation } from "./work-record-contract-edit-acceptance.mjs";
import { validateWorkRecordEntryContent } from "./work-record-entry-schema.mjs";

const READY_SLICE_DIFF_PATH_LIMIT = 64;

const READY_SLICE_CONTROL_FIELDS = Object.freeze([
  "unit", "slice_id", "expected_source_digest", "shaping_mode", "verbose",
  "completion_policy"
]);
const READY_SLICE_PAYLOAD_FIELDS = Object.freeze([
  "title", "status", "work_kind", "priority", "owner", "depends_on", "read_scope",
  "repo_paths", "write_scope", "dispatch_intent", "acceptance", "expected_edit_targets",
  "expected_changed_line_budget", "summary", "why_it_matters", "agent_notes",
  "review_purpose", "material_refs", "regression_tests"
]);
export const WORK_RECORD_READY_SLICE_FIELDS = Object.freeze([
  ...READY_SLICE_CONTROL_FIELDS,
  ...READY_SLICE_PAYLOAD_FIELDS
]);
const READY_SLICE_FIELD_SET = new Set(WORK_RECORD_READY_SLICE_FIELDS);

export const WORK_RECORD_READY_SLICE_DISPATCH_INTENT_CONTROL_FLAGS = Object.freeze([
  "requires_graph_impact", "requires_escalation"
]);

const READY_SHAPES = Object.freeze({
  implementation: { work_kind: "implementation", role: "worker" },
  reviewer: {
    work_kind: "review",
    role: WORK_RECORD_FINDINGS_TECHNICAL_ROLE_BY_WORK_KIND.review
  },
  redteam: {
    work_kind: "redteam",
    role: WORK_RECORD_FINDINGS_TECHNICAL_ROLE_BY_WORK_KIND.redteam
  }
});

const READY_DISPATCH_TARGET_UNIT = "slice";

export const WORK_RECORD_READY_SLICE_DISPATCH_INTENT_ASSERTION_VALUES = Object.freeze({
  intended_agent_role: Object.freeze([...new Set(Object.values(READY_SHAPES).map(({ role }) => role))]),
  target_unit: Object.freeze([READY_DISPATCH_TARGET_UNIT])
});
export const WORK_RECORD_READY_SLICE_DISPATCH_INTENT_ASSERTIONS = Object.freeze(
  Object.keys(WORK_RECORD_READY_SLICE_DISPATCH_INTENT_ASSERTION_VALUES)
);
const READY_DISPATCH_INTENT_FIELDS = new Set([
  ...WORK_RECORD_READY_SLICE_DISPATCH_INTENT_ASSERTIONS,
  ...WORK_RECORD_READY_SLICE_DISPATCH_INTENT_CONTROL_FLAGS
]);

const [REDTEAM_SHAPING_REVIEW_PURPOSE] = WORK_RECORD_FINDINGS_ACCEPTED_REVIEW_PURPOSES.redteam;

const READY_SLICE_FINDINGS_DIAGNOSTIC_CODES = Object.freeze({
  findings_ready_review_purpose_required: "ready_slice_missing_required_field",
  findings_review_purpose_incompatible: "ready_slice_review_purpose_incompatible",
  findings_review_purpose_invalid_value: "ready_slice_review_purpose_incompatible",
  findings_role_conflict: "ready_slice_shaping_conflict"
});

export const WORK_RECORD_READY_SLICE_ACCEPTED_VALUES = Object.freeze({
  shaping_mode: Object.freeze(Object.keys(READY_SHAPES)),
  status: Object.freeze([...WORK_RECORD_STATUS_VALUES]),
  priority: Object.freeze(["low", "medium", "high", "critical"]),
  work_kind: Object.freeze([...new Set(Object.values(READY_SHAPES).map((shape) => shape.work_kind))]),
  review_purpose: Object.freeze([...WORK_RECORD_REVIEW_PURPOSE_VALUES]),
  completion_policy: Object.freeze([...WORK_RECORD_COMPLETION_POLICY_VALUES])
});
export const readySliceControlledValueSchema = values => ({ type: 'string',
  pattern: `^\\s*(?:${values.join('|')})\\s*$`,
  description: `Choose one of: ${values.join(', ')}; surrounding whitespace is ignored.` });

export function workRecordReadySliceRowConstraints({ create }) {
  const controls = values => readySliceControlledValueSchema(values);
  const conditions = Object.entries(READY_SHAPES).map(([mode, shape]) => ({
    if: create && mode === READY_CREATION_DEFAULT_SHAPING_MODE
      ? { anyOf: [{ not: { required: ['shaping_mode'] } }, { required: ['shaping_mode'], properties: { shaping_mode: controls([mode]) } }] }
      : { required: ['shaping_mode'], properties: { shaping_mode: controls([mode]) } },
    then: { description: `${mode} shaping must preserve its derived ${shape.work_kind}/${shape.role}/slice assignment. ` +
      (mode === 'implementation' ? 'Creation requires nonempty write_scope and expected_edit_targets; review_purpose and completion_policy do not apply.'
        : 'write_scope must be empty and supplied targets must use inspect; review purpose and completion policy retain their declared applicability.'),
      ...(create ? { required: [...WORK_RECORD_READY_SLICE_CREATION_REQUIREMENTS[mode]] } : {}),
      properties: { work_kind: controls([shape.work_kind]),
        dispatch_intent: { properties: { intended_agent_role: controls([shape.role]), target_unit: controls([READY_DISPATCH_TARGET_UNIT]) } },
        ...(mode === 'implementation' ? { write_scope: { minItems: 1 }, expected_edit_targets: { minItems: 1 }, review_purpose: false, completion_policy: false }
          : { write_scope: { maxItems: 0 }, expected_edit_targets: { items: { properties: { operation: controls(['inspect']) } } },
            ...(mode === 'redteam' ? { review_purpose: controls([REDTEAM_SHAPING_REVIEW_PURPOSE]), completion_policy: false } : {}) }) } }
  }));
  conditions.push({ if: { required: ['completion_policy'] }, then: {
    ...(create ? { required: ['review_purpose'] } : {}), properties: { review_purpose: controls(['terminal_whole_wk']) } } });
  return conditions;
}
const READY_TARGET_PROVENANCE_FIELDS = new Set([
  "path", "name", "kind", "operation", "activity_kind", "artifact_kind", "granularity", "optional"
]);

export const ACCEPTANCE_CRITERION_METADATA_KEYS = Object.freeze([
  "verification_method", "evidence_target", "facet_provenance"
]);
const deepFreeze = (value) => {
  if (value !== null && typeof value === "object") Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
};

const criterionTextSchema = { type: "string", pattern: "\\S",
  description: "Supply nonblank criterion text; surrounding whitespace is trimmed." };
const criterionControlledSchema = values => ({ anyOf: [{ type: "string",
  pattern: `^\\s*(?:${values.join("|")})\\s*$`,
  description: `Choose one of: ${values.join(", ")}; surrounding whitespace is ignored.` }, { type: "null" }] });
export const WORK_RECORD_STRUCTURED_ACCEPTANCE_CRITERION_SCHEMA = deepFreeze({
  type: "object", additionalProperties: false, required: ["text"],
  description: "A slice criterion requires nonblank text. Allowed fields: text, typed_identity, verification_method, " +
    "evidence_target, facet_provenance. key is a root changes.criteria creation label, not a slice criterion field; " +
    "choose the intended slice text and optional metadata explicitly.",
  properties: {
    text: criterionTextSchema,
    typed_identity: { type: "string", minLength: 1,
      description: "Supply a nonempty authored identity string, preserved exactly without trimming." },
    verification_method: criterionControlledSchema(WORK_UNIT_FEATURE_VECTOR_VERIFICATION_METHOD_VALUES),
    evidence_target: { anyOf: [{ type: "string" }, { type: "null" }],
      description: "Supply an authored evidence string or null. Preserved exactly; this field does not resolve a path." },
    facet_provenance: { type: "object", additionalProperties: false,
      description: "Supply only text, verification_method and/or evidence_target provenance. Each value is one declared provenance value or null.",
      properties: Object.fromEntries(["text", "verification_method", "evidence_target"].map(field =>
        [field, criterionControlledSchema(WORK_UNIT_FACET_PROVENANCE_VALUES)])) }
  }
});
export const WORK_RECORD_ACCEPTANCE_CRITERION_SCHEMA = deepFreeze({ anyOf: [criterionTextSchema,
  WORK_RECORD_STRUCTURED_ACCEPTANCE_CRITERION_SCHEMA] });
const ACCEPTANCE_CRITERION_KEYS = new Set(Object.keys(WORK_RECORD_STRUCTURED_ACCEPTANCE_CRITERION_SCHEMA.properties));
const READY_ACCEPTANCE_PROVENANCE_FIELDS = new Set(Object.keys(
  WORK_RECORD_STRUCTURED_ACCEPTANCE_CRITERION_SCHEMA.properties.facet_provenance.properties));

const READY_TARGET_COARSE_ACTIVITY_KIND = "implementation";
const READY_TARGET_COARSE_ACTIVITY_BY_OPERATION = Object.freeze({
  create: "implementation_new",
  modify: "implementation_modify",
  delete: "implementation_remove"
});
const READY_TARGET_COARSE_ARTIFACT_KIND = "source";
const READY_TARGET_COARSE_ARTIFACT_BY_TARGET_KIND = Object.freeze({
  module: "production_code_module",
  export: "production_code_export"
});
export const READY_TARGET_COARSE_FACET_VALUES = Object.freeze({
  activity_kind: READY_TARGET_COARSE_ACTIVITY_KIND,
  artifact_kind: READY_TARGET_COARSE_ARTIFACT_KIND
});

const nullableEnum = (values) => ({ anyOf: [readySliceControlledValueSchema(values), { type: "null" }] });
const READY_TARGET_REQUIRED_FIELDS = Object.freeze(["path", "name", "kind", "operation"]);
export const WORK_RECORD_READY_SLICE_EXPECTED_EDIT_TARGET_SCHEMA = deepFreeze({
  type: "object",
  additionalProperties: false,
  required: [...READY_TARGET_REQUIRED_FIELDS],
  properties: {
    path: NORMALIZED_REPOSITORY_PATH_SCHEMA,
    name: { type: "string", pattern: '\\S' },
    kind: readySliceControlledValueSchema(WORK_RECORD_EXPECTED_EDIT_TARGET_KIND_VALUES),
    operation: readySliceControlledValueSchema(WORK_RECORD_EXPECTED_EDIT_TARGET_OPERATION_VALUES),
    activity_kind: nullableEnum([...WORK_UNIT_FEATURE_VECTOR_ACTIVITY_KIND_VALUES,
      READY_TARGET_COARSE_FACET_VALUES.activity_kind]),
    artifact_kind: nullableEnum([...WORK_UNIT_FEATURE_VECTOR_ARTIFACT_KIND_VALUES,
      READY_TARGET_COARSE_FACET_VALUES.artifact_kind]),
    granularity: nullableEnum(WORK_UNIT_FEATURE_VECTOR_GRANULARITY_VALUES),
    optional: { type: "boolean" },
    facet_provenance: {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries([...READY_TARGET_PROVENANCE_FIELDS].map((field) =>
        [field, nullableEnum(WORK_UNIT_FACET_PROVENANCE_VALUES)]))
    }
  }
});
const READY_TARGET_FIELDS = new Set(Object.keys(WORK_RECORD_READY_SLICE_EXPECTED_EDIT_TARGET_SCHEMA.properties));

export const WORK_RECORD_READY_SLICE_ACCEPTANCE_SCHEMA = deepFreeze({
  type: "object",
  additionalProperties: false,
  required: ["criteria", "validation"],
  properties: {
    criteria: { type: "array", items: WORK_RECORD_ACCEPTANCE_CRITERION_SCHEMA, description: "The slice's own readable outcomes. A string is literal " +
      "text, never a $key reference; a parent criterion label copies no text and transfers no coverage. An object " +
      "may retain an authored typed_identity exactly and " +
      `states text beside ${ACCEPTANCE_CRITERION_METADATA_KEYS.slice(0, -1).join(", ")} or ` +
      `${ACCEPTANCE_CRITERION_METADATA_KEYS.at(-1)}.` },
    validation: { anyOf: [{ type: "array", items: VALIDATION_NOTE_SCHEMA }, { type: "object",
      additionalProperties: false, required: ["repository_tests"], properties: {
        repository_tests: { type: "array", items: REPOSITORY_TEST_DECLARATION_SCHEMA,
          description: "Supply repository commands with distinct command ids. Replacement changes this selected unit only; commands carry no proof credit." },
        notes: { type: "array", items: VALIDATION_NOTE_SCHEMA }
      } }] }
  }
});
const READY_ACCEPTANCE_FIELDS = WORK_RECORD_READY_SLICE_ACCEPTANCE_SCHEMA.required;

export function workRecordReadySliceAcceptanceSchema() {
  return { ...WORK_RECORD_READY_SLICE_ACCEPTANCE_SCHEMA, allOf: [{ properties: {
    criteria: { minItems: 1 }, validation: { anyOf: [{ type: 'array', minItems: 1 }, { type: 'object', anyOf:
      ['notes', 'repository_tests'].map(member => ({ required: [member], properties: { [member]: { minItems: 1 } } })) }] }
  } }] };
}

const READY_CREATION_DEFAULT_SHAPING_MODE = "implementation";
const READY_CREATION_FIELDS = ["title", "depends_on", "read_scope", "repo_paths", "acceptance"];

const READY_IMPLEMENTATION_CREATION_FIELDS = ["write_scope", "expected_edit_targets"];

export const WORK_RECORD_READY_SLICE_SHAPING_MODES = deepFreeze({
  supported: Object.keys(READY_SHAPES),
  creation_default: READY_CREATION_DEFAULT_SHAPING_MODE
});
export const WORK_RECORD_READY_SLICE_CREATION_REQUIREMENTS = deepFreeze({
  every_shaping_mode: [...READY_CREATION_FIELDS],
  ...Object.fromEntries(Object.keys(READY_SHAPES).map((mode) =>
    [mode, [...READY_CREATION_FIELDS, ...(mode === "implementation" ? READY_IMPLEMENTATION_CREATION_FIELDS : [])]]))
});

export function missingWorkRecordReadySliceCreationFields(request) {
  if (!isObject(request)) return [];
  const mode = creationShapingMode(request);
  const required = hasOwn(READY_SHAPES, mode) ? WORK_RECORD_READY_SLICE_CREATION_REQUIREMENTS[mode]
    : WORK_RECORD_READY_SLICE_CREATION_REQUIREMENTS.every_shaping_mode;
  return required.filter((field) => !hasOwn(request, field));
}

const creationShapingMode = (request) => !hasOwn(request, "shaping_mode") ? READY_CREATION_DEFAULT_SHAPING_MODE
  : isString(request.shaping_mode) ? request.shaping_mode.trim() : null;

function incompleteContractDiagnostics(slice, mode, { authoredOnly = false } = {}) {
  const empty = (value) => Array.isArray(value) ? value.length === 0 : !authoredOnly;
  const diagnostics = [];
  const report = (incomplete, code, message, path) => {
    if (incomplete) diagnostics.push(createDiagnostic(code, message, { path }));
  };
  for (const field of ["read_scope", "repo_paths"]) {
    report(empty(slice[field]), "ready_slice_incomplete_contract", `${field} must be non-empty`, field);
  }
  if (!isObject(slice.acceptance)) {
    report(!authoredOnly, "ready_slice_incomplete_contract", "acceptance criteria and validation must be non-empty", "acceptance");
  } else {
    for (const member of READY_ACCEPTANCE_FIELDS) {
      report(slice.acceptance[member]?.length === 0, "ready_slice_incomplete_contract",
        `acceptance.${member} must be non-empty`, `acceptance.${member}`);
    }
  }
  if (mode === "implementation") {
    report(empty(slice.write_scope), "ready_slice_implementation_write_scope_empty",
      "implementation write_scope must be non-empty", "write_scope");
    report(empty(slice.expected_edit_targets), "ready_slice_implementation_targets_empty",
      "implementation expected_edit_targets must be non-empty", "expected_edit_targets");
  }
  return diagnostics;
}

export function emptyWorkRecordReadySliceCreationFields(request) {
  return isObject(request) ? incompleteContractDiagnostics(request, creationShapingMode(request), { authoredOnly: true }) : [];
}

function normalizeCoarseTargetFacet({ field, value, target, shapingMode, path }) {
  if (!isString(value) || value.trim() !== READY_TARGET_COARSE_FACET_VALUES[field]) {
    return undefined;
  }
  const fieldPath = `${path}.${field}`;
  const coarse = value.trim();

  if (shapingMode !== null && shapingMode !== "implementation") {
    readyInputError(
      "ready_slice_unsupported_coarse_facet",
      `${fieldPath} coarse value '${coarse}' is supported only for shaping_mode 'implementation'; omit ` +
        `${field} or supply one canonical value`,
      fieldPath
    );
  }
  if (field === "activity_kind") {
    const canonical = READY_TARGET_COARSE_ACTIVITY_BY_OPERATION[target.operation];
    if (!canonical) {
      readyInputError(
        "ready_slice_unsupported_coarse_facet",
        `${fieldPath} coarse value '${coarse}' has no canonical activity for operation '${target.operation}'; ` +
          `omit ${field} or supply one canonical value`,
        fieldPath
      );
    }
    return canonical;
  }
  const canonical = READY_TARGET_COARSE_ARTIFACT_BY_TARGET_KIND[target.kind];
  if (!canonical) {
    readyInputError(
      "ready_slice_unsupported_coarse_facet",
      `${fieldPath} coarse value '${coarse}' is ambiguous for target kind '${target.kind}'; omit ${field} or ` +
        "supply one canonical value",
      fieldPath
    );
  }
  return canonical;
}

class ReadySliceInputError extends Error {

  constructor(code, message, path) {
    const diagnostics = Array.isArray(code) ? code
      : [isObject(code) ? code : createDiagnostic(code, message, { path })];
    super(diagnostics[0].message);
    this.diagnostic = diagnostics[0];
    this.diagnostics = diagnostics;
  }
}
function readyInputError(code, message, path) {
  throw new ReadySliceInputError(code, message, path);
}

function controlled(value, values, path, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (!isString(value) || !values.includes(value.trim())) {
    readyInputError({
      ...createDiagnostic("ready_slice_invalid_field", `${path} has an unsupported value; accepted: ` +
        `${values.join(", ")}. State one accepted value${nullable ? " or null" : ""}`, { path }),
      constraint: { keyword: "enum", allowedValues: [...values] }
    });
  }
  return value.trim();
}
function nonemptyString(value, path) {
  if (!isString(value) || !value.trim()) {
    readyInputError("ready_slice_invalid_field", `${path} must be a non-empty string`, path);
  }
  return value.trim();
}

function repoPath(value, path) {
  const trimmed = nonemptyString(value, path);
  if (!isRepositoryRelativePath(trimmed)) {
    readyInputError("ready_slice_invalid_path", `${path} must be a canonical repository-relative POSIX path; ` +
      `received ${JSON.stringify(value)}. Remove absolute prefixes, traversal and malformed separators, then retry.`, path);
  }
  return normalizeRepositoryRelativePath(trimmed);
}
function stringList(value, path, { paths = false } = {}) {
  if (!Array.isArray(value)) {
    readyInputError("ready_slice_invalid_field", `${path} must be an array`, path);
  }

  const unsupported = REPOSITORY_SCOPE_FIELDS.includes(path)
    ? findUnsupportedRepositoryScopeSelector(value)
    : null;
  if (unsupported !== null) {
    readyInputError(UNSUPPORTED_REPOSITORY_SCOPE_SELECTOR,
      repositoryScopeSelectorRefusalMessage(path, unsupported.entry), `${path}[${unsupported.index}]`);
  }
  return value.map((entry, index) => paths
    ? repoPath(entry, `${path}[${index}]`)
    : nonemptyString(entry, `${path}[${index}]`));
}

function regressionTests(value) {
  const defect = findSliceRegressionTestsDefect(value);
  if (defect !== null) {
    const path = `regression_tests${defect.index === null ? "" : `[${defect.index}]`}`;
    readyInputError("ready_slice_invalid_regression_tests", `${path} ${defect.message}`, path);
  }
  return [...value];
}
function strictProvenance(value, allowedFields, path, declaration = null) {
  const reject = (code, message, at, constraint) => declaration === null
    ? readyInputError(code, message, at)
    : readyInputError({ ...createDiagnostic(code, message, { path: at }),
      constraint: { ...constraint, rule: declaration.description } });
  if (!isObject(value)) {
    reject("ready_slice_invalid_field", `${path} must be an object`, path, { keyword: "type", type: "object" });
  }
  const result = {};
  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) {
      reject("ready_slice_unknown_field", `${path}.${key} is not allowed`, `${path}.${key}`,
        { keyword: "additionalProperties", additionalProperty: key });
    }
    result[key] = value[key] === null
      ? null
      : controlled(value[key], WORK_UNIT_FACET_PROVENANCE_VALUES, `${path}.${key}`);
  }
  return result;
}
function normalizeAcceptanceCriterion(entry, path) {
  if (isString(entry)) return nonemptyString(entry, path);
  if (!isObject(entry)) readyInputError("ready_slice_invalid_acceptance", `${path} must be a string or object`, path);
  for (const key of Object.keys(entry)) {
    if (!ACCEPTANCE_CRITERION_KEYS.has(key)) readyInputError({
      ...createDiagnostic("ready_slice_unknown_field", `${path}.${key} is not allowed`, { path: `${path}.${key}` }),
      constraint: { keyword: "additionalProperties", additionalProperty: key,
        rule: WORK_RECORD_STRUCTURED_ACCEPTANCE_CRITERION_SCHEMA.description }
    });
  }
  const result = { text: nonemptyString(entry.text, `${path}.text`) };
  if (hasOwn(entry, "typed_identity")) {
    if (!isString(entry.typed_identity) || entry.typed_identity.length === 0) {
      readyInputError("ready_slice_invalid_acceptance", `${path}.typed_identity must be a non-empty string`, `${path}.typed_identity`);
    }
    result.typed_identity = entry.typed_identity;
  }
  if (hasOwn(entry, "verification_method")) {
    result.verification_method = controlled(
      entry.verification_method,
      WORK_UNIT_FEATURE_VECTOR_VERIFICATION_METHOD_VALUES,
      `${path}.verification_method`,
      { nullable: true }
    );
  }
  if (hasOwn(entry, "evidence_target")) {
    if (entry.evidence_target !== null && !isString(entry.evidence_target)) {
      readyInputError("ready_slice_invalid_acceptance", `${path}.evidence_target must be a string or null`, `${path}.evidence_target`);
    }
    result.evidence_target = entry.evidence_target;
  }
  if (hasOwn(entry, "facet_provenance")) {
    result.facet_provenance = strictProvenance(
      entry.facet_provenance,
      READY_ACCEPTANCE_PROVENANCE_FIELDS,
      `${path}.facet_provenance`,
      WORK_RECORD_STRUCTURED_ACCEPTANCE_CRITERION_SCHEMA.properties.facet_provenance
    );
  }
  return result;
}

export function normalizeAcceptanceCriteria(entries, { path = "acceptance.criteria", append = false } = {}) {
  try {
    if (append) return { ok: true, value: normalizeAcceptanceCriterion(entries, path) };
    if (!Array.isArray(entries)) {
      readyInputError("ready_slice_invalid_acceptance", `${path} must be an array`, path);
    }
    return {
      ok: true,
      value: entries.map((entry, index) => normalizeAcceptanceCriterion(entry, `${path}[${index}]`))
    };
  } catch (error) {
    if (!(error instanceof ReadySliceInputError)) throw error;
    return { ok: false, diagnostic: error.diagnostic };
  }
}

function composeAcceptanceValidation(requested, current = []) {
  const composed = planAcceptanceNarrativeValidation({
    current,
    requested,
    action: "replace",
    path: "acceptance.validation"
  });
  if (!composed.ok) throw new ReadySliceInputError(composed.diagnostics ?? composed.diagnostic);
  return composed.validation;
}

function normalizeAcceptance(value, { currentValidation = [] } = {}) {
  if (!isObject(value) || !Array.isArray(value.criteria) ||
      (!Array.isArray(value.validation) && !isObject(value.validation))) {
    readyInputError("ready_slice_invalid_acceptance", "acceptance must contain complete criteria and validation arrays", "acceptance");
  }
  for (const key of Object.keys(value)) {
    if (!READY_ACCEPTANCE_FIELDS.includes(key)) {
      readyInputError("ready_slice_unknown_field", `acceptance.${key} is not allowed`, `acceptance.${key}`);
    }
  }
  const criteria = value.criteria.map((entry, index) =>
    normalizeAcceptanceCriterion(entry, `acceptance.criteria[${index}]`));
  return { criteria, validation: composeAcceptanceValidation(value.validation, currentValidation) };
}

function storedAcceptanceValidation(slice) {
  return isObject(slice?.acceptance) && hasOwn(slice.acceptance, "validation")
    ? slice.acceptance.validation
    : [];
}
function normalizeTargets(value, { shapingMode = null } = {}) {
  if (!Array.isArray(value)) readyInputError("ready_slice_invalid_targets", "expected_edit_targets must be an array", "expected_edit_targets");
  return value.map((entry, index) => {
    const path = `expected_edit_targets[${index}]`;
    if (!isObject(entry)) readyInputError("ready_slice_invalid_targets", `${path} must be an object`, path);
    for (const key of Object.keys(entry)) {
      if (!READY_TARGET_FIELDS.has(key)) readyInputError("ready_slice_unknown_field", `${path}.${key} is not allowed`, `${path}.${key}`);
    }
    const result = {
      path: repoPath(entry.path, `${path}.path`),
      name: nonemptyString(entry.name, `${path}.name`),
      kind: controlled(entry.kind, WORK_RECORD_EXPECTED_EDIT_TARGET_KIND_VALUES, `${path}.kind`),
      operation: controlled(entry.operation, WORK_RECORD_EXPECTED_EDIT_TARGET_OPERATION_VALUES, `${path}.operation`)
    };
    const optionalEnums = [
      ["activity_kind", WORK_UNIT_FEATURE_VECTOR_ACTIVITY_KIND_VALUES],
      ["artifact_kind", WORK_UNIT_FEATURE_VECTOR_ARTIFACT_KIND_VALUES],
      ["granularity", WORK_UNIT_FEATURE_VECTOR_GRANULARITY_VALUES]
    ];

    const derivedFacets = [];
    for (const [field, values] of optionalEnums) {
      if (!hasOwn(entry, field)) continue;
      const derived = normalizeCoarseTargetFacet({
        field,
        value: entry[field],
        target: result,
        shapingMode,
        path
      });
      if (derived !== undefined) {
        result[field] = derived;
        derivedFacets.push(field);
        continue;
      }

      result[field] = controlled(entry[field], hasOwn(READY_TARGET_COARSE_FACET_VALUES, field)
        ? [...values, READY_TARGET_COARSE_FACET_VALUES[field]] : values, `${path}.${field}`, { nullable: true });
    }
    if (hasOwn(entry, "optional")) {
      if (typeof entry.optional !== "boolean") readyInputError("ready_slice_invalid_targets", `${path}.optional must be boolean`, `${path}.optional`);
      result.optional = entry.optional;
    }
    if (hasOwn(entry, "facet_provenance")) {
      result.facet_provenance = strictProvenance(entry.facet_provenance, READY_TARGET_PROVENANCE_FIELDS, `${path}.facet_provenance`);
    }
    if (derivedFacets.length > 0) {
      result.facet_provenance = { ...(result.facet_provenance ?? {}) };
      for (const field of derivedFacets) {
        result.facet_provenance[field] = "derived_normalizer";
      }
    }
    return result;
  });
}
function normalizeReadyDispatchIntent(value) {
  if (!isObject(value)) readyInputError("ready_slice_invalid_dispatch_intent", "dispatch_intent must be an object", "dispatch_intent");
  for (const key of Object.keys(value)) {
    if (!READY_DISPATCH_INTENT_FIELDS.has(key)) readyInputError("ready_slice_unknown_field", `dispatch_intent.${key} is not allowed`, `dispatch_intent.${key}`);
  }

  const result = {};
  for (const [member, accepted] of Object.entries(WORK_RECORD_READY_SLICE_DISPATCH_INTENT_ASSERTION_VALUES)) {
    if (!hasOwn(value, member)) continue;
    const path = `dispatch_intent.${member}`;

    if (!isString(value[member]) || !accepted.includes(value[member].trim())) {
      readyInputError({
        ...createDiagnostic("ready_slice_invalid_field", `${path} has an unsupported value; accepted: ` +
          `${accepted.join(", ")}. Omit it, because shaping derives it, or state the accepted value the derived ` +
          "assignment has", { path }),
        constraint: { keyword: "enum", allowedValues: [...accepted] }
      });
    }
    result[member] = value[member].trim();
  }
  for (const flag of WORK_RECORD_READY_SLICE_DISPATCH_INTENT_CONTROL_FLAGS) {
    if (!hasOwn(value, flag)) continue;
    if (typeof value[flag] !== "boolean") {
      readyInputError("ready_slice_invalid_dispatch_intent", `dispatch_intent.${flag} must be boolean`, `dispatch_intent.${flag}`);
    }
    result[flag] = value[flag];
  }
  return result;
}
export function validateWorkRecordReadySliceRequest(request, { resolvedProse = false } = {}) {
  try {
    if (!isObject(request)) readyInputError("ready_slice_invalid_request", "ready-slice input must be an object", null);
    for (const key of Object.keys(request)) {
      if (!READY_SLICE_FIELD_SET.has(key)) readyInputError("ready_slice_unknown_field", `ready-slice field '${key}' is not allowed`, key);
    }
    if (!isString(request.unit) || !RECORD_ID_PATTERN.test(request.unit)) readyInputError("invalid_unit_address", "unit must be a canonical parent WK-#### address", "unit");
    if (hasOwn(request, "slice_id") && (!isString(request.slice_id) || !ORDINAL_SLICE_ID_PATTERN.test(request.slice_id))) readyInputError("invalid_slice_id", "slice_id must be SLICE-###", "slice_id");
    if (hasOwn(request, "expected_source_digest") && (!isString(request.expected_source_digest) || !SHA256_PATTERN.test(request.expected_source_digest))) readyInputError("invalid_expected_source_digest", "expected_source_digest must be sha256:<64 lowercase hex>", "expected_source_digest");
    if (hasOwn(request, "shaping_mode")) controlled(request.shaping_mode, WORK_RECORD_READY_SLICE_ACCEPTED_VALUES.shaping_mode, "shaping_mode");
    if (hasOwn(request, "verbose") && typeof request.verbose !== "boolean") readyInputError("ready_slice_invalid_field", "verbose must be boolean", "verbose");
    if (hasOwn(request, "title")) nonemptyString(request.title, "title");
    if (hasOwn(request, "status")) controlled(request.status, WORK_RECORD_READY_SLICE_ACCEPTED_VALUES.status, "status");
    if (hasOwn(request, "priority")) controlled(request.priority, WORK_RECORD_READY_SLICE_ACCEPTED_VALUES.priority, "priority");
    if (hasOwn(request, "owner")) nonemptyString(request.owner, "owner");
    if (hasOwn(request, "depends_on")) stringList(request.depends_on, "depends_on");
    if (hasOwn(request, "read_scope")) stringList(request.read_scope, "read_scope");
    if (hasOwn(request, "repo_paths")) stringList(request.repo_paths, "repo_paths", { paths: true });
    if (hasOwn(request, "write_scope")) stringList(request.write_scope, "write_scope", { paths: true });
    if (hasOwn(request, "regression_tests")) regressionTests(request.regression_tests);
    if (hasOwn(request, "acceptance")) normalizeAcceptance(request.acceptance);

    if (hasOwn(request, "expected_edit_targets")) {
      normalizeTargets(request.expected_edit_targets, {
        shapingMode: hasOwn(request, "shaping_mode") && isString(request.shaping_mode)
          ? request.shaping_mode.trim()
          : (hasOwn(request, "slice_id") ? null : READY_CREATION_DEFAULT_SHAPING_MODE)
      });
    }
    if (hasOwn(request, "dispatch_intent")) normalizeReadyDispatchIntent(request.dispatch_intent);
    for (const field of ["summary", "why_it_matters", "agent_notes"]) {
      if (!hasOwn(request, field)) continue;
      if (resolvedProse) {
        if (!isString(request[field])) readyInputError(
          "ready_slice_invalid_prose_destination",
          `${field} must resolve to a string`,
          field
        );
      } else {
        const content = validateWorkRecordEntryContent(request[field], { path: field });
        if (!content.ok) throw new ReadySliceInputError(content.diagnostic);
      }
    }
    if (
      hasOwn(request, "expected_changed_line_budget") &&
      request.expected_changed_line_budget !== null &&
      (!Number.isInteger(request.expected_changed_line_budget) || request.expected_changed_line_budget < 0)
    ) readyInputError("ready_slice_invalid_field", "expected_changed_line_budget must be a non-negative integer or null", "expected_changed_line_budget");
    for (const member of ["work_kind", "review_purpose", "completion_policy"]) {
      if (hasOwn(request, member)) controlled(request[member], WORK_RECORD_READY_SLICE_ACCEPTED_VALUES[member], member);
    }
    return { ok: true, diagnostics: [] };
  } catch (error) {
    if (!(error instanceof ReadySliceInputError)) throw error;
    return { ok: false, diagnostics: [error.diagnostic] };
  }
}

function effectiveShapeForUpdate(slice) {
  for (const [mode, shape] of Object.entries(READY_SHAPES)) {
    if (
      slice?.work_kind === shape.work_kind &&
      slice?.dispatch_intent?.intended_agent_role === shape.role &&
      slice?.dispatch_intent?.target_unit === READY_DISPATCH_TARGET_UNIT &&
      typeof slice?.dispatch_intent?.requires_graph_impact === "boolean" &&
      typeof slice?.dispatch_intent?.requires_escalation === "boolean"
    ) return mode;
  }
  return null;
}

export function planWorkRecordReadySlice(record, request = {}, { repository = null } = {}) {
  const requestCheck = validateWorkRecordReadySliceRequest(request, { resolvedProse: true });
  if (!requestCheck.ok) return refusal(requestCheck.diagnostics[0]);
  try {
    if (!isObject(record) || record.id !== request.unit) readyInputError("ready_slice_record_mismatch", "unit does not match the loaded work record", "unit");
    const create = !hasOwn(request, "slice_id");
    const slices = Array.isArray(record.slices) ? record.slices : [];
    let sliceId = request.slice_id;
    let sliceIndex = -1;
    if (create) {
      sliceId = nextOrdinalSliceId(record);
      if (!sliceId) readyInputError("ordinal_slice_id_exhausted", "no unused ordinal slice ids remain", "slice_id");
    } else {
      const indexes = findSliceIndexes(record, sliceId);

      if (indexes.length === 0) {
        readyInputError(
          "slice_not_found",
          `slice '${sliceId}' does not exist on ${record.id}; slice_id selects an existing ` +
          "slice to update. Omit slice_id to create one: the route allocates the next ordinal " +
          "id and returns it as slice_id",
          "slice_id"
        );
      }
      if (indexes.length > 1) readyInputError("ready_slice_ambiguous_slice", `slice '${sliceId}' must identify exactly one existing slice`, "slice_id");
      sliceIndex = indexes[0];
    }
    const existing = create ? null : slices[sliceIndex];
    const requestedMode = hasOwn(request, "shaping_mode") ? request.shaping_mode.trim() : null;
    const mode = requestedMode ?? (create ? READY_CREATION_DEFAULT_SHAPING_MODE : effectiveShapeForUpdate(existing));
    if (!mode) readyInputError("ready_slice_unsupported_effective_shape", "existing slice requires explicit implementation, reviewer, or redteam shaping", "shaping_mode");
    const shape = READY_SHAPES[mode];
    const supplied = {};
    const suppliedProse = {};
    if (hasOwn(request, "title")) supplied.title = nonemptyString(request.title, "title");
    if (hasOwn(request, "status")) supplied.status = controlled(request.status, WORK_RECORD_READY_SLICE_ACCEPTED_VALUES.status, "status");
    if (hasOwn(request, "priority")) supplied.priority = controlled(request.priority, WORK_RECORD_READY_SLICE_ACCEPTED_VALUES.priority, "priority");
    if (hasOwn(request, "owner")) supplied.owner = nonemptyString(request.owner, "owner");
    if (hasOwn(request, "depends_on")) supplied.depends_on = stringList(request.depends_on, "depends_on");
    if (hasOwn(request, "read_scope")) supplied.read_scope = stringList(request.read_scope, "read_scope");
    if (hasOwn(request, "repo_paths")) supplied.repo_paths = stringList(request.repo_paths, "repo_paths", { paths: true });
    if (hasOwn(request, "write_scope")) supplied.write_scope = stringList(request.write_scope, "write_scope", { paths: true });
    if (hasOwn(request, "regression_tests")) supplied.regression_tests = regressionTests(request.regression_tests);
    if (hasOwn(request, "acceptance")) {

      supplied.acceptance = normalizeAcceptance(request.acceptance, {
        currentValidation: create ? [] : storedAcceptanceValidation(existing)
      });
    }
    if (hasOwn(request, "expected_edit_targets")) supplied.expected_edit_targets = normalizeTargets(request.expected_edit_targets, { shapingMode: mode });
    if (hasOwn(request, "expected_changed_line_budget")) {
      if (request.expected_changed_line_budget !== null && (!Number.isInteger(request.expected_changed_line_budget) || request.expected_changed_line_budget < 0)) readyInputError("ready_slice_invalid_field", "expected_changed_line_budget must be a non-negative integer or null", "expected_changed_line_budget");
      supplied.expected_changed_line_budget = request.expected_changed_line_budget;
    }
    for (const field of ["summary", "why_it_matters", "agent_notes"]) {
      if (hasOwn(request, field)) suppliedProse[field] = request[field];
    }
    if (hasOwn(request, "material_refs")) {
      const materialDiagnostics = validateWorkRecordMaterialRefs(request.material_refs, {
        path: "material_refs",
        repository
      });
      if (materialDiagnostics.length > 0) {
        readyInputError(materialDiagnostics[0].code, materialDiagnostics[0].message,
          materialDiagnostics[0].path);
      }
      supplied.material_refs = cloneJson(request.material_refs);
    }
    if (hasOwn(request, "review_purpose")) supplied.review_purpose = controlled(request.review_purpose, WORK_RECORD_READY_SLICE_ACCEPTED_VALUES.review_purpose, "review_purpose");
    const completionPolicy = hasOwn(request, "completion_policy")
      ? controlled(request.completion_policy, WORK_RECORD_READY_SLICE_ACCEPTED_VALUES.completion_policy, "completion_policy")
      : null;
    if (hasOwn(request, "work_kind") && request.work_kind.trim() !== shape.work_kind) readyInputError("ready_slice_shaping_conflict", "work_kind contradicts shaping_mode", "work_kind");
    const incomingIntent = hasOwn(request, "dispatch_intent") ? normalizeReadyDispatchIntent(request.dispatch_intent) : {};
    if (hasOwn(incomingIntent, "intended_agent_role") && incomingIntent.intended_agent_role !== shape.role) readyInputError("ready_slice_shaping_conflict", "dispatch_intent contradicts shaping_mode", "dispatch_intent");

    const controlFlags = {};
    for (const flag of WORK_RECORD_READY_SLICE_DISPATCH_INTENT_CONTROL_FLAGS) {
      if (hasOwn(incomingIntent, flag)) controlFlags[flag] = incomingIntent[flag];
      else if (create) controlFlags[flag] = false;
      else if (typeof existing.dispatch_intent?.[flag] === "boolean") controlFlags[flag] = existing.dispatch_intent[flag];
      else readyInputError("ready_slice_unsupported_effective_shape", `existing slice has no saved boolean dispatch_intent.${flag} to preserve; state it explicitly`, `dispatch_intent.${flag}`);
    }

    if (create) {

      const missing = missingWorkRecordReadySliceCreationFields(request);
      const targetsOmitted = missing.includes("expected_edit_targets");
      if (missing.length > 0) {
        throw new ReadySliceInputError([
          ...missing.filter((field) => field !== "expected_edit_targets").map((field) => createDiagnostic(
            "ready_slice_missing_required_field", `${field} is required on create`, { path: field })),
          ...incompleteContractDiagnostics({ ...supplied, ...(targetsOmitted ? { expected_edit_targets: [] } : {}) },
            mode, { authoredOnly: true })
        ]);
      }
    }
    const next = create ? {
      id: sliceId,
      title: supplied.title,
      work_kind: shape.work_kind,
      status: supplied.status ?? "todo",
      priority: supplied.priority ?? "medium",
      owner: supplied.owner ?? "unassigned",
      depends_on: supplied.depends_on,
      read_scope: supplied.read_scope,
      repo_paths: supplied.repo_paths,
      write_scope: supplied.write_scope,
      dispatch_intent: null,
      acceptance: supplied.acceptance,
      expected_edit_targets: supplied.expected_edit_targets ?? [],
      expected_changed_line_budget: supplied.expected_changed_line_budget ?? null,
      ...(supplied.regression_tests === undefined ? {} : { regression_tests: supplied.regression_tests })
    } : { ...cloneJson(existing), ...cloneJson(supplied) };
    next.work_kind = shape.work_kind;
    if (mode === "reviewer") {
      next.review_purpose = supplied.review_purpose ?? next.review_purpose ?? "standalone";
    } else if (mode === "redteam") {
      if (supplied.review_purpose === "terminal_whole_wk") {
        readyInputError(
          "ready_slice_review_purpose_incompatible",
          "terminal_whole_wk review_purpose is valid only for reviewer shaping",
          "review_purpose"
        );
      }

      if (requestedMode === "redteam" || supplied.review_purpose === REDTEAM_SHAPING_REVIEW_PURPOSE) {
        next.review_purpose = REDTEAM_SHAPING_REVIEW_PURPOSE;
      } else if (!hasOwn(existing ?? {}, "review_purpose")) {
        delete next.review_purpose;
      }
    } else {
      if (hasOwn(request, "review_purpose")) readyInputError("ready_slice_review_purpose_incompatible", "review_purpose is valid only for reviewer shaping", "review_purpose");
      delete next.review_purpose;
    }

    if (completionPolicy && next.review_purpose !== "terminal_whole_wk") {
      readyInputError(
        "ready_slice_completion_policy_incompatible",
        "completion_policy is valid only for terminal_whole_wk review shaping",
        "completion_policy"
      );
    }
    next.dispatch_intent = {
      intended_agent_role: shape.role,
      target_unit: READY_DISPATCH_TARGET_UNIT,
      requires_graph_impact: controlFlags.requires_graph_impact,
      requires_escalation: controlFlags.requires_escalation
    };
    if (["summary", "why_it_matters", "agent_notes"].some((field) =>
      hasOwn(suppliedProse, field))) {
      next.sections = isObject(next.sections) ? cloneJson(next.sections) : {};
      for (const field of ["summary", "why_it_matters", "agent_notes"]) {
        if (hasOwn(suppliedProse, field)) {
          next.sections[field] = suppliedProse[field];
        }
      }
    }
    if (hasOwn(supplied, "material_refs")) {
      next.sections = isObject(next.sections) ? cloneJson(next.sections) : {};
      next.sections.material_refs = supplied.material_refs;
      delete next.material_refs;
    }
    if (mode !== "implementation") {
      if (hasOwn(request, "write_scope") && supplied.write_scope.length > 0) readyInputError("ready_slice_findings_write_scope_nonempty", "reviewer/redteam write_scope must be empty", "write_scope");
      next.write_scope = [];
      if (
        Array.isArray(next.expected_edit_targets) &&
        next.expected_edit_targets.some((target) => target?.operation !== "inspect")
      ) readyInputError("ready_slice_findings_targets_not_read_only", "reviewer/redteam expected_edit_targets must be an inspection plan", "expected_edit_targets");
    }

    const incomplete = incompleteContractDiagnostics(next, mode);
    if (incomplete.length > 0) throw new ReadySliceInputError(incomplete);

    const findingsAnalysis = analyzeWorkRecordFindingsUnit(next, {
      requireExplicitRedteamPurpose: true
    });
    const findingsRefusal = findingsAnalysis.diagnostics.find(
      (entry) => entry.severity === "error"
    );
    if (findingsRefusal) {
      readyInputError(
        READY_SLICE_FINDINGS_DIAGNOSTIC_CODES[findingsRefusal.code] ??
          "ready_slice_incomplete_contract",
        findingsRefusal.message,
        findingsRefusal.path
      );
    }

    const clone = cloneJson(record);
    const policyChanged = Boolean(completionPolicy) && clone.completion_policy !== completionPolicy;
    if (policyChanged) clone.completion_policy = completionPolicy;
    if (create) {
      sliceIndex = clone.slices.length;
      clone.slices.push(next);
    } else clone.slices[sliceIndex] = next;
    const changedSliceFields = create
      ? ["slice"]
      : Object.keys({ ...existing, ...next }).filter((field) => !jsonEqual(existing[field], next[field]));
    const changedFields = changedSliceFields.map((field) => field === "slice" ? `slices[${sliceId}]` : `slices[${sliceId}].${field}`);
    if (policyChanged) changedFields.push("completion_policy");
    const canonical = canonicalizeWorkRecordReadScope(clone);
    const diffPaths = collectJsonDiffPaths(record, canonical);
    const allowedPrefixes = create
      ? [`slices[${sliceIndex}]`]
      : changedSliceFields.map((field) => `slices[${sliceIndex}].${field}`);
    if (policyChanged) allowedPrefixes.push("completion_policy");
    const disallowed = diffPaths.find((path) => !allowedPrefixes.some((prefix) => diagnosticPathIsWithin(path, prefix)));
    if (disallowed) readyInputError("ready_slice_persisted_diff_guard_failed", `ready-slice would persist an unrelated change at ${disallowed}`, disallowed);
    const finalized = finalizeEdit(canonical, changedFields);
    if (!finalized.ok) return finalized;
    const boundedPaths = diffPaths.slice(0, READY_SLICE_DIFF_PATH_LIMIT);
    if (diffPaths.length > boundedPaths.length) {
      finalized.diagnostics.push(createDiagnostic(
        "ready_slice_diff_truncated",
        `ready-slice normalized diff is bounded to ${READY_SLICE_DIFF_PATH_LIMIT} paths`,
        { severity: "warning", path: null }
      ));
    }
    return {
      ...finalized,
      selectedUnit: { kind: "slice", address: `${record.id}#${sliceId}`, record_id: record.id, slice_id: sliceId },
      changedPaths: boundedPaths,
      allowedPersistedPrefixes: allowedPrefixes,
      shapingMode: mode,
      create,
      policyFacts: collectControlledContractPrivateScopeIntersections(next, {
        unitAddress: `${record.id}#${sliceId}`,
        status: next.status
      })
    };
  } catch (error) {
    if (!(error instanceof ReadySliceInputError)) throw error;
    return { ...refusal(error.diagnostic), diagnostics: error.diagnostics };
  }
}

export function guardWorkRecordReadySlicePersistedDiff(
  baseRecord,
  candidateRecord,
  { allowedPrefixes = [], allowEvidenceInvalidation = false } = {}
) {
  const normalizedCandidate = canonicalizeWorkRecordReadScope(cloneJson(candidateRecord));
  const diffPaths = collectJsonDiffPaths(baseRecord, normalizedCandidate);
  const allowed = [...allowedPrefixes, "updated"];
  if (allowEvidenceInvalidation) allowed.push("derived_evidence");
  const disallowed = diffPaths.find((entry) => !allowed.some((prefix) => diagnosticPathIsWithin(entry, prefix)));
  if (disallowed) {
    return {
      ok: false,
      normalizedCandidate: null,
      diffPaths,
      diagnostic: createDiagnostic(
        "ready_slice_persisted_diff_guard_failed",
        `ready-slice would persist an unauthorized change at ${disallowed}`,
        { path: disallowed }
      )
    };
  }
  return { ok: true, normalizedCandidate, diffPaths, diagnostic: null };
}
