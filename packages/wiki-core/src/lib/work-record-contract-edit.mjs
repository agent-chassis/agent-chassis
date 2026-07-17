

import {
  canonicalizeWorkRecordReadScope,
  validateWorkRecord
} from "./work-record-schema.mjs";
import {
  SLICE_ID_PATTERN,
  SHA256_PATTERN,
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

const RECORD_ID_PATTERN = /^WK-[0-9]{4}$/;
const INITIATIVE_ID_PATTERN = /^IN-[0-9]{4}$/;
const ORDINAL_SLICE_ID_PATTERN = /^SLICE-[0-9]{3}$/;
const PERSISTED_DIFF_DIAGNOSTIC_PATH_LIMIT = 5;
const PERSISTED_DIFF_DIAGNOSTIC_PATH_LENGTH_LIMIT = 96;
const READY_SLICE_DIFF_PATH_LIMIT = 64;

export const WORK_RECORD_ACCEPTANCE_REPAIR_MANAGED_PATHS = Object.freeze(["updated"]);

export const WORK_RECORD_CONTRACT_LIST_FIELDS = Object.freeze([
  "read_scope",
  "docs",
  "repo_paths",
  "write_scope",
  "depends_on",
  "related",
  "blocks"
]);

export const WORK_RECORD_SLICE_LIST_FIELDS = Object.freeze([
  "read_scope",
  "docs",
  "repo_paths",
  "write_scope",
  "depends_on"
]);

export const WORK_RECORD_CONTRACT_EDIT_OPERATIONS = Object.freeze([
  "upsert_slice",
  "delete_slice",
  "set_list_field",
  "set_acceptance",
  "shape_review_unit"
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isString(value) {
  return typeof value === "string";
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((entry) => isString(entry));
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createDiagnostic(code, message, { severity = "error", path = null } = {}) {
  return { code, severity, message, path };
}

function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function collectJsonDiffPaths(left, right, path = "", paths = []) {
  const leftObject = isObject(left);
  const rightObject = isObject(right);
  const leftArray = Array.isArray(left);
  const rightArray = Array.isArray(right);
  if (leftObject || rightObject) {
    const keys = new Set([
      ...(leftObject ? Object.keys(left) : []),
      ...(rightObject ? Object.keys(right) : [])
    ]);
    if (keys.size === 0 && leftObject !== rightObject) {
      paths.push(path);
      return paths;
    }
    for (const key of keys) {
      const childPath = path ? `${path}.${key}` : key;
      collectJsonDiffPaths(
        leftObject && hasOwn(left, key) ? left[key] : undefined,
        rightObject && hasOwn(right, key) ? right[key] : undefined,
        childPath,
        paths
      );
    }
    return paths;
  }

  if (leftArray || rightArray) {
    const length = Math.max(leftArray ? left.length : 0, rightArray ? right.length : 0);
    if (length === 0 && leftArray !== rightArray) {
      paths.push(path);
      return paths;
    }
    for (let index = 0; index < length; index += 1) {
      collectJsonDiffPaths(
        leftArray ? left[index] : undefined,
        rightArray ? right[index] : undefined,
        `${path}[${index}]`,
        paths
      );
    }
    return paths;
  }

  if (!jsonEqual(left, right)) {
    paths.push(path);
  }
  return paths;
}

function diagnosticPathIsWithin(path, subtreePath) {
  return (
    isString(path) &&
    (path === subtreePath || path.startsWith(`${subtreePath}.`) || path.startsWith(`${subtreePath}[`))
  );
}

function findSliceIndexes(record, sliceId) {
  if (!Array.isArray(record?.slices)) {
    return [];
  }
  const indexes = [];
  record.slices.forEach((entry, index) => {
    if (isObject(entry) && entry.id === sliceId) {
      indexes.push(index);
    }
  });
  return indexes;
}

export function parseWorkRecordUnitAddress(unitAddress) {
  const normalized = isString(unitAddress) ? unitAddress.trim() : "";
  if (!normalized) {
    return {
      ok: false,
      error: createDiagnostic("invalid_unit_address", "unit address is required", {
        path: "unit"
      })
    };
  }

  const pieces = normalized.split("#");
  if (pieces.length > 2 || !RECORD_ID_PATTERN.test(pieces[0])) {
    return {
      ok: false,
      error: createDiagnostic("invalid_unit_address", `Invalid unit address: ${normalized}`, {
        path: "unit"
      })
    };
  }

  if (pieces.length === 1) {
    return {
      ok: true,
      recordId: pieces[0],
      unit: {
        kind: "work_item",
        address: pieces[0],
        record_id: pieces[0],
        slice_id: null
      }
    };
  }

  const sliceId = pieces[1];
  if (!SLICE_ID_PATTERN.test(sliceId)) {
    return {
      ok: false,
      error: createDiagnostic("invalid_slice_id", `Invalid slice id: ${sliceId}`, {
        path: "unit"
      })
    };
  }

  return {
    ok: true,
    recordId: pieces[0],
    unit: {
      kind: "slice",
      address: normalized,
      record_id: pieces[0],
      slice_id: sliceId
    }
  };
}

function defaultSliceTemplate(id) {
  return {
    id,
    title: "",
    work_kind: "implementation",
    status: "todo",
    priority: "medium",
    owner: "unassigned",
    depends_on: [],
    read_scope: [],
    repo_paths: [],
    write_scope: [],
    dispatch_intent: {
      intended_agent_role: "worker",
      target_unit: "slice",
      requires_graph_impact: false,
      requires_escalation: false
    },
    acceptance: {
      criteria: [],
      validation: []
    }
  };
}

function findSliceIndex(record, sliceId) {
  if (!Array.isArray(record.slices)) {
    return -1;
  }
  return record.slices.findIndex((entry) => isObject(entry) && entry.id === sliceId);
}

function isOrdinalSliceId(sliceId) {
  return isString(sliceId) && ORDINAL_SLICE_ID_PATTERN.test(sliceId);
}

function nextOrdinalSliceId(record) {
  const usedOrdinals = new Set();
  if (Array.isArray(record.slices)) {
    for (const slice of record.slices) {
      if (!isObject(slice) || !isOrdinalSliceId(slice.id)) {
        continue;
      }
      usedOrdinals.add(slice.id);
    }
  }

  for (let ordinal = 1; ordinal <= 999; ordinal += 1) {
    const candidate = `SLICE-${String(ordinal).padStart(3, "0")}`;
    if (!usedOrdinals.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

function prefixSliceField(sliceId, fieldPath) {
  return sliceId ? `slices[${sliceId}].${fieldPath}` : fieldPath;
}

function collectContractPolicyDiagnostics(record) {
  const diagnostics = [];

  if (
    record.work_kind === "review" &&
    Array.isArray(record.write_scope) &&
    record.write_scope.length > 0
  ) {
    diagnostics.push(
      createDiagnostic(
        "review_write_scope_not_empty",
        "record work_kind 'review' requires an empty write_scope",
        { path: "write_scope" }
      )
    );
  }

  if (Array.isArray(record.slices)) {
    const seen = new Set();
    record.slices.forEach((slice, index) => {
      if (!isObject(slice)) {
        return;
      }
      if (isString(slice.id)) {
        if (seen.has(slice.id)) {
          diagnostics.push(
            createDiagnostic("duplicate_slice_id", `slice id '${slice.id}' is not unique within the record`, {
              path: `slices[${index}].id`
            })
          );
        }
        seen.add(slice.id);
      }
      if (
        slice.work_kind === "review" &&
        Array.isArray(slice.write_scope) &&
        slice.write_scope.length > 0
      ) {
        diagnostics.push(
          createDiagnostic(
            "review_write_scope_not_empty",
            `slice '${slice.id}' work_kind 'review' requires an empty write_scope`,
            { path: `slices[${index}].write_scope` }
          )
        );
      }
    });
  }

  return diagnostics;
}

function finalizeEdit(updatedRecord, changedFields) {
  const diagnostics = [
    ...validateWorkRecord(updatedRecord),
    ...collectContractPolicyDiagnostics(updatedRecord)
  ];
  if (diagnostics.some((entry) => entry.severity === "error")) {
    return { ok: false, updatedRecord: null, changedFields: [], diagnostics };
  }
  return { ok: true, updatedRecord, changedFields, diagnostics };
}

function refusal(diagnostic) {
  return {
    ok: false,
    updatedRecord: null,
    changedFields: [],
    diagnostics: [diagnostic]
  };
}

export function assessAcceptanceRepairEligibility(
  record,
  { sliceId = null, diagnostics = [] } = {}
) {
  if (!isObject(record)) {
    return {
      ok: false,
      diagnostic: createDiagnostic(
        "acceptance_repair_unparseable_base",
        "set_acceptance repair requires a structurally parsed work-record object",
        { path: null }
      )
    };
  }

  let acceptancePath = "acceptance";
  let sliceIndex = null;
  if (sliceId !== null && sliceId !== undefined) {
    const indexes = findSliceIndexes(record, sliceId);
    if (indexes.length === 0) {
      return {
        ok: false,
        diagnostic: createDiagnostic("slice_not_found", `Slice '${sliceId}' does not exist on ${record.id}`, {
          path: "unit"
        })
      };
    }
    if (indexes.length !== 1) {
      return {
        ok: false,
        diagnostic: createDiagnostic(
          "acceptance_repair_ambiguous_slice",
          `set_acceptance repair requires exactly one slice '${sliceId}', found ${indexes.length}`,
          { path: "unit" }
        )
      };
    }
    sliceIndex = indexes[0];
    acceptancePath = `slices[${sliceIndex}].acceptance`;
  }

  const enumerableRecord = cloneJson(record);
  const canonicalRecord = canonicalizeWorkRecordReadScope(enumerableRecord);
  const normalizationDiff = collectJsonDiffPaths(enumerableRecord, canonicalRecord);
  if (normalizationDiff.length > 0) {
    return {
      ok: false,
      diagnostic: createDiagnostic(
        "acceptance_repair_non_canonical_record",
        `set_acceptance repair refuses a base record that persistence would normalize outside the selected acceptance subtree: ${normalizationDiff.join(", ")}`,
        { path: normalizationDiff[0] }
      )
    };
  }

  const baseErrors = diagnostics.filter((entry) => entry?.severity === "error");
  const outsideError = baseErrors.find(
    (entry) => !diagnosticPathIsWithin(entry?.path, acceptancePath)
  );
  if (outsideError) {
    return {
      ok: false,
      diagnostic: createDiagnostic(
        "acceptance_repair_invalidity_outside_target",
        `set_acceptance repair refuses base error '${outsideError.code}' outside ${acceptancePath}`,
        { path: outsideError.path ?? null }
      )
    };
  }

  if (baseErrors.length === 0) {
    return {
      ok: false,
      diagnostic: createDiagnostic(
        "acceptance_repair_valid_base_not_required",
        "the invalid-base repair path requires at least one base error diagnostic",
        { path: acceptancePath }
      )
    };
  }

  return { ok: true, acceptancePath, sliceIndex };
}

export function guardAcceptanceRepairPersistedDiff(
  baseRecord,
  candidateRecord,
  {
    sliceIndex = null,
    hasCriteria = false,
    hasValidation = false,
    managedPaths = WORK_RECORD_ACCEPTANCE_REPAIR_MANAGED_PATHS
  } = {}
) {
  const normalizedBase = canonicalizeWorkRecordReadScope(cloneJson(baseRecord));
  const normalizedCandidate = canonicalizeWorkRecordReadScope(cloneJson(candidateRecord));
  const acceptancePath = sliceIndex === null ? "acceptance" : `slices[${sliceIndex}].acceptance`;
  const allowedPaths = new Set(managedPaths);
  if (hasCriteria) {
    allowedPaths.add(`${acceptancePath}.criteria`);
  }
  if (hasValidation) {
    allowedPaths.add(`${acceptancePath}.validation`);
  }

  const diffPaths = collectJsonDiffPaths(normalizedBase, normalizedCandidate);
  const disallowedPath = diffPaths.find(
    (entry) =>
      !Array.from(allowedPaths).some(
        (allowedPath) => entry === allowedPath || entry.startsWith(`${allowedPath}[`)
      )
  );
  if (disallowedPath) {
    return {
      ok: false,
      normalizedCandidate: null,
      diffPaths,
      diagnostic: createDiagnostic(
        "acceptance_repair_diff_guard_failed",
        `set_acceptance repair would persist an unauthorized change at ${disallowedPath}`,
        { path: disallowedPath }
      )
    };
  }

  return { ok: true, normalizedCandidate, diffPaths, diagnostic: null };
}

function boundPersistedDiffPaths(diffPaths) {
  return diffPaths
    .slice(0, PERSISTED_DIFF_DIAGNOSTIC_PATH_LIMIT)
    .map((entry) =>
      entry.length <= PERSISTED_DIFF_DIAGNOSTIC_PATH_LENGTH_LIMIT
        ? entry
        : `${entry.slice(0, PERSISTED_DIFF_DIAGNOSTIC_PATH_LENGTH_LIMIT - 3)}...`
    );
}

export function guardInitiativeAssignmentPersistedDiff(baseRecord, candidateRecord) {
  const persistedBase = cloneJson(baseRecord);
  const normalizedCandidate = canonicalizeWorkRecordReadScope(cloneJson(candidateRecord));
  const diffPaths = collectJsonDiffPaths(persistedBase, normalizedCandidate);
  if (diffPaths.length === 1 && diffPaths[0] === "initiative") {
    return { ok: true, normalizedCandidate, diffPaths, diagnostic: null };
  }

  const changedPaths = boundPersistedDiffPaths(diffPaths);
  const firstDisallowedPath = diffPaths.find((entry) => entry !== "initiative") ?? diffPaths[0];
  const firstPath = firstDisallowedPath
    ? boundPersistedDiffPaths([firstDisallowedPath])[0]
    : null;
  const diagnostic = {
    ...createDiagnostic(
      "initiative_assignment_persisted_diff_guard_failed",
      firstPath
        ? `initiative assignment would persist changes outside its one-scalar contract: ${changedPaths.join(", ")}`
        : "initiative assignment did not produce the required one-scalar persisted change",
      { path: firstPath }
    ),
    changed_paths: changedPaths,
    changed_paths_truncated: diffPaths.length > changedPaths.length
  };

  return {
    ok: false,
    normalizedCandidate: null,
    diffPaths,
    diagnostic
  };
}

function selectScopedTarget(clone, sliceId) {
  if (sliceId === null || sliceId === undefined) {
    return { ok: true, target: clone };
  }
  if (!SLICE_ID_PATTERN.test(sliceId)) {
    return {
      ok: false,
      refusal: refusal(
        createDiagnostic("invalid_slice_id", `Invalid slice id: ${sliceId}`, { path: "unit" })
      )
    };
  }
  const index = findSliceIndex(clone, sliceId);
  if (index === -1) {
    return {
      ok: false,
      refusal: refusal(
        createDiagnostic("slice_not_found", `Slice '${sliceId}' does not exist on ${clone.id}`, {
          path: "unit"
        })
      )
    };
  }
  return { ok: true, target: clone.slices[index] };
}

export function upsertSlice(record, { slice } = {}) {
  if (!isObject(slice)) {
    return refusal(
      createDiagnostic("invalid_slice_payload", "slice payload must be an object", {
        path: "slice"
      })
    );
  }
  const hasSliceId = slice.id !== undefined && slice.id !== null;
  if (hasSliceId && (!isString(slice.id) || !SLICE_ID_PATTERN.test(slice.id))) {
    return refusal(
      createDiagnostic("invalid_slice_id", `slice.id must match ${SLICE_ID_PATTERN.source}`, {
        path: "slice.id"
      })
    );
  }

  const clone = cloneJson(record);
  if (!Array.isArray(clone.slices)) {
    clone.slices = [];
  }
  const incoming = cloneJson(slice);
  let sliceId = hasSliceId ? slice.id : null;
  if (!hasSliceId) {
    sliceId = nextOrdinalSliceId(clone);
    if (!sliceId) {
      return refusal(
        createDiagnostic("ordinal_slice_id_exhausted", "no unused ordinal slice ids remain", {
          path: "slice.id"
        })
      );
    }
    incoming.id = sliceId;
  }

  const index = findSliceIndex(clone, sliceId);

  if (index === -1) {
    if (!isOrdinalSliceId(sliceId)) {
      return refusal(
        createDiagnostic(
          "semantic_slice_id_creation_not_allowed",
          `new slice ids must use an ordinal SLICE-### id; '${sliceId}' is grandfathered only if it already exists`,
          { path: "slice.id" }
        )
      );
    }
    const created = { ...defaultSliceTemplate(sliceId), ...incoming };
    clone.slices.push(created);
    return finalizeEdit(clone, [`slices[${sliceId}]`]);
  }

  const existing = clone.slices[index];
  const merged = { ...existing, ...incoming };
  const changedFields = Object.keys(incoming)
    .filter((key) => !jsonEqual(existing[key], merged[key]))
    .map((key) => `slices[${sliceId}].${key}`);
  clone.slices[index] = merged;
  return finalizeEdit(clone, changedFields);
}

export function deleteSlice(record, { sliceId } = {}) {
  if (!isString(sliceId) || !SLICE_ID_PATTERN.test(sliceId)) {
    return refusal(
      createDiagnostic("invalid_slice_id", `sliceId must match ${SLICE_ID_PATTERN.source}`, {
        path: "unit"
      })
    );
  }
  const clone = cloneJson(record);
  const index = findSliceIndex(clone, sliceId);
  if (index === -1) {
    return refusal(
      createDiagnostic("slice_not_found", `Slice '${sliceId}' does not exist on ${clone.id}`, {
        path: "unit"
      })
    );
  }
  clone.slices.splice(index, 1);
  return finalizeEdit(clone, [`slices[${sliceId}]`]);
}

export function setListField(record, { sliceId = null, field, values } = {}) {
  if (!WORK_RECORD_CONTRACT_LIST_FIELDS.includes(field)) {
    return refusal(
      createDiagnostic(
        "unsupported_list_field",
        `Unsupported list field '${field}'; expected one of: ${WORK_RECORD_CONTRACT_LIST_FIELDS.join(", ")}`,
        { path: "field" }
      )
    );
  }
  if (sliceId !== null && sliceId !== undefined && !WORK_RECORD_SLICE_LIST_FIELDS.includes(field)) {
    return refusal(
      createDiagnostic(
        "unsupported_slice_field",
        `List field '${field}' is record-scoped only; slice list fields are: ${WORK_RECORD_SLICE_LIST_FIELDS.join(", ")}`,
        { path: "field" }
      )
    );
  }
  if (!isStringArray(values)) {
    return refusal(
      createDiagnostic("invalid_list_value", `${field} must be an array of strings`, {
        path: "values"
      })
    );
  }

  const clone = cloneJson(record);
  const selected = selectScopedTarget(clone, sliceId ?? null);
  if (!selected.ok) {
    return selected.refusal;
  }
  const target = selected.target;
  const nextValues = cloneJson(values);
  if (jsonEqual(target[field], nextValues)) {
    return finalizeEdit(clone, []);
  }
  target[field] = nextValues;
  return finalizeEdit(clone, [prefixSliceField(sliceId ?? null, field)]);
}

export function setAcceptance(record, { sliceId = null, criteria, validation } = {}) {
  const hasCriteria = criteria !== undefined;
  const hasValidation = validation !== undefined;
  if (!hasCriteria && !hasValidation) {
    return refusal(
      createDiagnostic(
        "missing_acceptance_payload",
        "set_acceptance requires criteria and/or validation",
        { path: "acceptance" }
      )
    );
  }
  if (hasCriteria && !Array.isArray(criteria)) {
    return refusal(
      createDiagnostic("invalid_acceptance_payload", "acceptance.criteria must be an array", {
        path: "acceptance.criteria"
      })
    );
  }
  if (hasValidation && !isStringArray(validation)) {
    return refusal(
      createDiagnostic(
        "invalid_acceptance_payload",
        "acceptance.validation must be an array of strings",
        { path: "acceptance.validation" }
      )
    );
  }

  const clone = cloneJson(record);
  const selected = selectScopedTarget(clone, sliceId ?? null);
  if (!selected.ok) {
    return selected.refusal;
  }
  const target = selected.target;
  if (!isObject(target.acceptance)) {
    if (!hasCriteria || !hasValidation) {
      return refusal(
        createDiagnostic(
          "acceptance_repair_requires_whole_replacement",
          "a missing or non-object acceptance value requires both criteria and validation arrays",
          { path: prefixSliceField(sliceId ?? null, "acceptance") }
        )
      );
    }
    target.acceptance = {
      criteria: cloneJson(criteria),
      validation: cloneJson(validation)
    };
    return finalizeEdit(clone, [
      prefixSliceField(sliceId ?? null, "acceptance.criteria"),
      prefixSliceField(sliceId ?? null, "acceptance.validation")
    ]);
  }

  const changedFields = [];
  if (hasCriteria) {
    const nextCriteria = cloneJson(criteria);
    if (!jsonEqual(target.acceptance.criteria, nextCriteria)) {
      target.acceptance.criteria = nextCriteria;
      changedFields.push(prefixSliceField(sliceId ?? null, "acceptance.criteria"));
    }
  }
  if (hasValidation) {
    const nextValidation = cloneJson(validation);
    if (!jsonEqual(target.acceptance.validation, nextValidation)) {
      target.acceptance.validation = nextValidation;
      changedFields.push(prefixSliceField(sliceId ?? null, "acceptance.validation"));
    }
  }
  return finalizeEdit(clone, changedFields);
}

export function assignWorkRecordToInitiative(record, { initiative } = {}) {
  if (!isString(initiative) || !INITIATIVE_ID_PATTERN.test(initiative)) {
    return refusal(
      createDiagnostic(
        "invalid_initiative_selector",
        `initiative must match ${INITIATIVE_ID_PATTERN.source}`,
        { path: "initiative" }
      )
    );
  }

  const clone = cloneJson(record);
  if (clone.initiative === initiative) {
    return finalizeEdit(clone, []);
  }

  clone.initiative = initiative;
  return finalizeEdit(clone, ["initiative"]);
}

export function shapeReviewUnit(record, { sliceId = null } = {}) {
  const clone = cloneJson(record);
  const selected = selectScopedTarget(clone, sliceId ?? null);
  if (!selected.ok) {
    return selected.refusal;
  }
  const target = selected.target;
  const changedFields = [];

  if (target.work_kind !== "review") {
    target.work_kind = "review";
    changedFields.push(prefixSliceField(sliceId ?? null, "work_kind"));
  }
  if (!Array.isArray(target.write_scope) || target.write_scope.length > 0) {
    target.write_scope = [];
    changedFields.push(prefixSliceField(sliceId ?? null, "write_scope"));
  }
  if (!isObject(target.dispatch_intent)) {
    target.dispatch_intent = {
      intended_agent_role: "reviewer",
      target_unit: sliceId ? "slice" : "record",
      requires_graph_impact: false,
      requires_escalation: false
    };
    changedFields.push(prefixSliceField(sliceId ?? null, "dispatch_intent"));
  } else if (target.dispatch_intent.intended_agent_role !== "reviewer") {
    target.dispatch_intent.intended_agent_role = "reviewer";
    changedFields.push(prefixSliceField(sliceId ?? null, "dispatch_intent.intended_agent_role"));
  }

  return finalizeEdit(clone, changedFields);
}

const PLANNER_BY_OPERATION = Object.freeze({
  upsert_slice: (record, params) => upsertSlice(record, params),
  delete_slice: (record, params) => deleteSlice(record, params),
  set_list_field: (record, params) => setListField(record, params),
  set_acceptance: (record, params) => setAcceptance(record, params),
  shape_review_unit: (record, params) => shapeReviewUnit(record, params)
});

export function applyWorkRecordContractEdit(record, { operation, ...params } = {}) {
  const planner = PLANNER_BY_OPERATION[operation];
  if (!planner) {
    return refusal(
      createDiagnostic(
        "unsupported_operation",
        `Unsupported contract edit operation '${operation}'; expected one of: ${WORK_RECORD_CONTRACT_EDIT_OPERATIONS.join(", ")}`,
        { path: "operation" }
      )
    );
  }
  return planner(record, params);
}

const READY_SLICE_CONTROL_FIELDS = Object.freeze([
  "unit", "slice_id", "expected_source_digest", "shaping_mode", "attestation_action", "verbose"
]);
const READY_SLICE_PAYLOAD_FIELDS = Object.freeze([
  "title", "status", "work_kind", "priority", "owner", "depends_on", "read_scope",
  "repo_paths", "write_scope", "dispatch_intent", "acceptance", "expected_edit_targets",
  "expected_changed_line_budget", "agent_notes"
]);
export const WORK_RECORD_READY_SLICE_FIELDS = Object.freeze([
  ...READY_SLICE_CONTROL_FIELDS,
  ...READY_SLICE_PAYLOAD_FIELDS
]);
const READY_SLICE_FIELD_SET = new Set(WORK_RECORD_READY_SLICE_FIELDS);
const READY_SHAPES = Object.freeze({
  implementation: { work_kind: "implementation", role: "worker" },
  reviewer: { work_kind: "review", role: "reviewer" },
  redteam: { work_kind: "redteam", role: "redteam" }
});
const READY_PRIORITIES = new Set(["low", "medium", "high", "critical"]);
const READY_ATTESTATION_ACTIONS = new Set(["preserve_or_refuse", "invalidate_for_review"]);
const READY_PROVENANCE = new Set(WORK_UNIT_FACET_PROVENANCE_VALUES);
const READY_TARGET_PROVENANCE_FIELDS = new Set([
  "path", "name", "kind", "operation", "activity_kind", "artifact_kind", "granularity", "optional"
]);
const READY_ACCEPTANCE_PROVENANCE_FIELDS = new Set([
  "text", "verification_method", "evidence_target"
]);

class ReadySliceInputError extends Error {
  constructor(code, message, path) {
    super(message);
    this.diagnostic = createDiagnostic(code, message, { path });
  }
}
function readyInputError(code, message, path) {
  throw new ReadySliceInputError(code, message, path);
}
function controlled(value, values, path, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (!isString(value) || !values.has(value.trim())) {
    readyInputError("ready_slice_invalid_field", `${path} has an unsupported value`, path);
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
  let normalized = nonemptyString(value, path);
  if (normalized.startsWith("./")) normalized = normalized.slice(2);
  const segments = normalized.split("/");
  if (
    !normalized || normalized.startsWith("/") || normalized.startsWith("~") ||
    /^[A-Za-z]:/u.test(normalized) || normalized.includes("\\") || normalized.includes("\0") ||
    segments.some((entry) => !entry || entry === "." || entry === "..")
  ) {
    readyInputError("ready_slice_invalid_path", `${path} must be a canonical repository-relative POSIX path`, path);
  }
  return normalized;
}
function stringList(value, path, { paths = false } = {}) {
  if (!Array.isArray(value)) {
    readyInputError("ready_slice_invalid_field", `${path} must be an array`, path);
  }
  return value.map((entry, index) => paths
    ? repoPath(entry, `${path}[${index}]`)
    : nonemptyString(entry, `${path}[${index}]`));
}
function strictProvenance(value, allowedFields, path) {
  if (!isObject(value)) {
    readyInputError("ready_slice_invalid_field", `${path} must be an object`, path);
  }
  const result = {};
  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) {
      readyInputError("ready_slice_unknown_field", `${path}.${key} is not allowed`, `${path}.${key}`);
    }
    result[key] = value[key] === null
      ? null
      : controlled(value[key], READY_PROVENANCE, `${path}.${key}`);
  }
  return result;
}
function normalizeAcceptance(value) {
  if (!isObject(value) || !Array.isArray(value.criteria) || !Array.isArray(value.validation)) {
    readyInputError("ready_slice_invalid_acceptance", "acceptance must contain complete criteria and validation arrays", "acceptance");
  }
  for (const key of Object.keys(value)) {
    if (!["criteria", "validation"].includes(key)) {
      readyInputError("ready_slice_unknown_field", `acceptance.${key} is not allowed`, `acceptance.${key}`);
    }
  }
  const criteria = value.criteria.map((entry, index) => {
    const path = `acceptance.criteria[${index}]`;
    if (isString(entry)) return nonemptyString(entry, path);
    if (!isObject(entry)) readyInputError("ready_slice_invalid_acceptance", `${path} must be a string or object`, path);
    const allowed = new Set(["text", "verification_method", "evidence_target", "facet_provenance"]);
    for (const key of Object.keys(entry)) {
      if (!allowed.has(key)) readyInputError("ready_slice_unknown_field", `${path}.${key} is not allowed`, `${path}.${key}`);
    }
    const result = { text: nonemptyString(entry.text, `${path}.text`) };
    if (hasOwn(entry, "verification_method")) {
      result.verification_method = controlled(
        entry.verification_method,
        new Set(WORK_UNIT_FEATURE_VECTOR_VERIFICATION_METHOD_VALUES),
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
        `${path}.facet_provenance`
      );
    }
    return result;
  });
  return { criteria, validation: stringList(value.validation, "acceptance.validation") };
}
function normalizeTargets(value) {
  if (!Array.isArray(value)) readyInputError("ready_slice_invalid_targets", "expected_edit_targets must be an array", "expected_edit_targets");
  return value.map((entry, index) => {
    const path = `expected_edit_targets[${index}]`;
    if (!isObject(entry)) readyInputError("ready_slice_invalid_targets", `${path} must be an object`, path);
    const allowed = new Set(["path", "name", "kind", "operation", "activity_kind", "artifact_kind", "granularity", "optional", "facet_provenance"]);
    for (const key of Object.keys(entry)) {
      if (!allowed.has(key)) readyInputError("ready_slice_unknown_field", `${path}.${key} is not allowed`, `${path}.${key}`);
    }
    const result = {
      path: repoPath(entry.path, `${path}.path`),
      name: nonemptyString(entry.name, `${path}.name`),
      kind: controlled(entry.kind, new Set(WORK_RECORD_EXPECTED_EDIT_TARGET_KIND_VALUES), `${path}.kind`),
      operation: controlled(entry.operation, new Set(WORK_RECORD_EXPECTED_EDIT_TARGET_OPERATION_VALUES), `${path}.operation`)
    };
    const optionalEnums = [
      ["activity_kind", WORK_UNIT_FEATURE_VECTOR_ACTIVITY_KIND_VALUES],
      ["artifact_kind", WORK_UNIT_FEATURE_VECTOR_ARTIFACT_KIND_VALUES],
      ["granularity", WORK_UNIT_FEATURE_VECTOR_GRANULARITY_VALUES]
    ];
    for (const [field, values] of optionalEnums) {
      if (hasOwn(entry, field)) result[field] = controlled(entry[field], new Set(values), `${path}.${field}`, { nullable: true });
    }
    if (hasOwn(entry, "optional")) {
      if (typeof entry.optional !== "boolean") readyInputError("ready_slice_invalid_targets", `${path}.optional must be boolean`, `${path}.optional`);
      result.optional = entry.optional;
    }
    if (hasOwn(entry, "facet_provenance")) {
      result.facet_provenance = strictProvenance(entry.facet_provenance, READY_TARGET_PROVENANCE_FIELDS, `${path}.facet_provenance`);
    }
    return result;
  });
}
function normalizeReadyDispatchIntent(value) {
  if (!isObject(value)) readyInputError("ready_slice_invalid_dispatch_intent", "dispatch_intent must be an object", "dispatch_intent");
  const fields = ["intended_agent_role", "target_unit", "requires_graph_impact", "requires_escalation"];
  if (Object.keys(value).length !== fields.length || fields.some((field) => !hasOwn(value, field))) {
    readyInputError("ready_slice_invalid_dispatch_intent", "dispatch_intent must be a strict complete object", "dispatch_intent");
  }
  for (const key of Object.keys(value)) {
    if (!fields.includes(key)) readyInputError("ready_slice_unknown_field", `dispatch_intent.${key} is not allowed`, `dispatch_intent.${key}`);
  }
  if (typeof value.requires_graph_impact !== "boolean" || typeof value.requires_escalation !== "boolean") {
    readyInputError("ready_slice_invalid_dispatch_intent", "dispatch_intent control flags must be boolean", "dispatch_intent");
  }
  return {
    intended_agent_role: controlled(
      value.intended_agent_role,
      new Set(["worker", "reviewer", "redteam"]),
      "dispatch_intent.intended_agent_role"
    ),
    target_unit: controlled(value.target_unit, new Set(["slice"]), "dispatch_intent.target_unit"),
    requires_graph_impact: value.requires_graph_impact,
    requires_escalation: value.requires_escalation
  };
}
function normalizeAgentNotes(value) {
  if (Array.isArray(value)) {
    if (!value.every(isString)) readyInputError("ready_slice_invalid_agent_notes", "agent_notes entries must be strings", "agent_notes");
    value = value.join("\n");
  }
  if (!isString(value) || Buffer.byteLength(value, "utf8") > 8192) {
    readyInputError("ready_slice_invalid_agent_notes", "agent_notes must be a string bounded to 8192 UTF-8 bytes", "agent_notes");
  }
  return value;
}

export function validateWorkRecordReadySliceRequest(request) {
  try {
    if (!isObject(request)) readyInputError("ready_slice_invalid_request", "ready-slice input must be an object", null);
    for (const key of Object.keys(request)) {
      if (!READY_SLICE_FIELD_SET.has(key)) readyInputError("ready_slice_unknown_field", `ready-slice field '${key}' is not allowed`, key);
    }
    if (!isString(request.unit) || !RECORD_ID_PATTERN.test(request.unit)) readyInputError("invalid_unit_address", "unit must be a canonical parent WK-#### address", "unit");
    if (hasOwn(request, "slice_id") && (!isString(request.slice_id) || !ORDINAL_SLICE_ID_PATTERN.test(request.slice_id))) readyInputError("invalid_slice_id", "slice_id must be SLICE-###", "slice_id");
    if (hasOwn(request, "expected_source_digest") && (!isString(request.expected_source_digest) || !SHA256_PATTERN.test(request.expected_source_digest))) readyInputError("invalid_expected_source_digest", "expected_source_digest must be sha256:<64 lowercase hex>", "expected_source_digest");
    if (hasOwn(request, "shaping_mode")) controlled(request.shaping_mode, new Set(Object.keys(READY_SHAPES)), "shaping_mode");
    if (hasOwn(request, "attestation_action")) controlled(request.attestation_action, READY_ATTESTATION_ACTIONS, "attestation_action");
    if (hasOwn(request, "verbose") && typeof request.verbose !== "boolean") readyInputError("ready_slice_invalid_field", "verbose must be boolean", "verbose");
    if (hasOwn(request, "title")) nonemptyString(request.title, "title");
    if (hasOwn(request, "status")) controlled(request.status, new Set(WORK_RECORD_STATUS_VALUES), "status");
    if (hasOwn(request, "priority")) controlled(request.priority, READY_PRIORITIES, "priority");
    if (hasOwn(request, "owner")) nonemptyString(request.owner, "owner");
    if (hasOwn(request, "depends_on")) stringList(request.depends_on, "depends_on");
    if (hasOwn(request, "read_scope")) stringList(request.read_scope, "read_scope");
    if (hasOwn(request, "repo_paths")) stringList(request.repo_paths, "repo_paths", { paths: true });
    if (hasOwn(request, "write_scope")) stringList(request.write_scope, "write_scope", { paths: true });
    if (hasOwn(request, "acceptance")) normalizeAcceptance(request.acceptance);
    if (hasOwn(request, "expected_edit_targets")) normalizeTargets(request.expected_edit_targets);
    if (hasOwn(request, "dispatch_intent")) normalizeReadyDispatchIntent(request.dispatch_intent);
    if (hasOwn(request, "agent_notes")) normalizeAgentNotes(request.agent_notes);
    if (
      hasOwn(request, "expected_changed_line_budget") &&
      request.expected_changed_line_budget !== null &&
      (!Number.isInteger(request.expected_changed_line_budget) || request.expected_changed_line_budget < 0)
    ) readyInputError("ready_slice_invalid_field", "expected_changed_line_budget must be a non-negative integer or null", "expected_changed_line_budget");
    if (hasOwn(request, "work_kind")) controlled(request.work_kind, new Set(["implementation", "review", "redteam"]), "work_kind");
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
      slice?.dispatch_intent?.target_unit === "slice" &&
      typeof slice?.dispatch_intent?.requires_graph_impact === "boolean" &&
      typeof slice?.dispatch_intent?.requires_escalation === "boolean"
    ) return mode;
  }
  return null;
}

export function planWorkRecordReadySlice(record, request = {}) {
  const requestCheck = validateWorkRecordReadySliceRequest(request);
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
      if (indexes.length !== 1) readyInputError(indexes.length ? "ready_slice_ambiguous_slice" : "slice_not_found", `slice '${sliceId}' must identify exactly one existing slice`, "slice_id");
      sliceIndex = indexes[0];
    }
    const existing = create ? null : slices[sliceIndex];
    const requestedMode = hasOwn(request, "shaping_mode") ? request.shaping_mode.trim() : null;
    const mode = requestedMode ?? (create ? "implementation" : effectiveShapeForUpdate(existing));
    if (!mode) readyInputError("ready_slice_unsupported_effective_shape", "existing slice requires explicit implementation, reviewer, or redteam shaping", "shaping_mode");
    const shape = READY_SHAPES[mode];
    const action = hasOwn(request, "attestation_action") ? request.attestation_action.trim() : "preserve_or_refuse";
    if (create && action === "invalidate_for_review") readyInputError("ready_slice_invalid_attestation_action", "creation cannot invalidate an attestation", "attestation_action");

    const supplied = {};
    if (hasOwn(request, "title")) supplied.title = nonemptyString(request.title, "title");
    if (hasOwn(request, "status")) supplied.status = controlled(request.status, new Set(WORK_RECORD_STATUS_VALUES), "status");
    if (hasOwn(request, "priority")) supplied.priority = controlled(request.priority, READY_PRIORITIES, "priority");
    if (hasOwn(request, "owner")) supplied.owner = nonemptyString(request.owner, "owner");
    if (hasOwn(request, "depends_on")) supplied.depends_on = stringList(request.depends_on, "depends_on");
    if (hasOwn(request, "read_scope")) supplied.read_scope = stringList(request.read_scope, "read_scope");
    if (hasOwn(request, "repo_paths")) supplied.repo_paths = stringList(request.repo_paths, "repo_paths", { paths: true });
    if (hasOwn(request, "write_scope")) supplied.write_scope = stringList(request.write_scope, "write_scope", { paths: true });
    if (hasOwn(request, "acceptance")) supplied.acceptance = normalizeAcceptance(request.acceptance);
    if (hasOwn(request, "expected_edit_targets")) supplied.expected_edit_targets = normalizeTargets(request.expected_edit_targets);
    if (hasOwn(request, "expected_changed_line_budget")) {
      if (request.expected_changed_line_budget !== null && (!Number.isInteger(request.expected_changed_line_budget) || request.expected_changed_line_budget < 0)) readyInputError("ready_slice_invalid_field", "expected_changed_line_budget must be a non-negative integer or null", "expected_changed_line_budget");
      supplied.expected_changed_line_budget = request.expected_changed_line_budget;
    }
    if (hasOwn(request, "agent_notes")) supplied.agent_notes = normalizeAgentNotes(request.agent_notes);
    if (hasOwn(request, "work_kind") && request.work_kind.trim() !== shape.work_kind) readyInputError("ready_slice_shaping_conflict", "work_kind contradicts shaping_mode", "work_kind");
    const incomingIntent = hasOwn(request, "dispatch_intent") ? normalizeReadyDispatchIntent(request.dispatch_intent) : null;
    if (incomingIntent && (incomingIntent.intended_agent_role !== shape.role || incomingIntent.target_unit !== "slice")) readyInputError("ready_slice_shaping_conflict", "dispatch_intent contradicts shaping_mode", "dispatch_intent");

    if (create) {
      for (const field of ["title", "read_scope", "repo_paths", "acceptance"]) {
        if (!hasOwn(supplied, field)) readyInputError("ready_slice_missing_required_field", `${field} is required on create`, field);
      }
    }
    const next = create ? {
      id: sliceId,
      title: supplied.title,
      work_kind: shape.work_kind,
      status: supplied.status ?? "todo",
      priority: supplied.priority ?? "medium",
      owner: supplied.owner ?? "unassigned",
      depends_on: supplied.depends_on ?? [],
      read_scope: supplied.read_scope,
      repo_paths: supplied.repo_paths,
      write_scope: supplied.write_scope ?? [],
      dispatch_intent: incomingIntent ?? {
        intended_agent_role: shape.role,
        target_unit: "slice",
        requires_graph_impact: false,
        requires_escalation: false
      },
      acceptance: supplied.acceptance,
      expected_edit_targets: supplied.expected_edit_targets ?? [],
      expected_changed_line_budget: supplied.expected_changed_line_budget ?? null
    } : { ...cloneJson(existing), ...cloneJson(supplied) };
    delete next.agent_notes;
    next.work_kind = shape.work_kind;
    const preservedIntent = incomingIntent ?? cloneJson(existing?.dispatch_intent) ?? {};
    next.dispatch_intent = {
      intended_agent_role: shape.role,
      target_unit: "slice",
      requires_graph_impact: preservedIntent.requires_graph_impact ?? false,
      requires_escalation: preservedIntent.requires_escalation ?? false
    };
    if (hasOwn(supplied, "agent_notes")) {
      next.sections = isObject(next.sections) ? cloneJson(next.sections) : {};
      next.sections.agent_notes = supplied.agent_notes;
    }
    if (mode !== "implementation") {
      if (hasOwn(request, "write_scope") && supplied.write_scope.length > 0) readyInputError("ready_slice_findings_write_scope_nonempty", "reviewer/redteam write_scope must be empty", "write_scope");
      next.write_scope = [];
      if (
        Array.isArray(next.expected_edit_targets) &&
        next.expected_edit_targets.some((target) => target?.operation !== "inspect")
      ) readyInputError("ready_slice_findings_targets_not_read_only", "reviewer/redteam expected_edit_targets must be an inspection plan", "expected_edit_targets");
    }
    if (!Array.isArray(next.read_scope) || next.read_scope.length === 0) readyInputError("ready_slice_incomplete_contract", "read_scope must be non-empty", "read_scope");
    if (!Array.isArray(next.repo_paths) || next.repo_paths.length === 0) readyInputError("ready_slice_incomplete_contract", "repo_paths must be non-empty", "repo_paths");
    if (!isObject(next.acceptance) || next.acceptance.criteria?.length === 0 || next.acceptance.validation?.length === 0) readyInputError("ready_slice_incomplete_contract", "acceptance criteria and validation must be non-empty", "acceptance");
    if (mode === "implementation" && (!Array.isArray(next.write_scope) || next.write_scope.length === 0)) readyInputError("ready_slice_implementation_write_scope_empty", "implementation write_scope must be non-empty", "write_scope");
    if (mode === "implementation" && (!Array.isArray(next.expected_edit_targets) || next.expected_edit_targets.length === 0)) readyInputError("ready_slice_implementation_targets_empty", "implementation expected_edit_targets must be non-empty", "expected_edit_targets");

    const clone = cloneJson(record);
    if (create) {
      sliceIndex = clone.slices.length;
      clone.slices.push(next);
    } else clone.slices[sliceIndex] = next;
    const changedSliceFields = create
      ? ["slice"]
      : Object.keys({ ...existing, ...next }).filter((field) => !jsonEqual(existing[field], next[field]));
    const changedFields = changedSliceFields.map((field) => field === "slice" ? `slices[${sliceId}]` : `slices[${sliceId}].${field}`);
    const canonical = canonicalizeWorkRecordReadScope(clone);
    const diffPaths = collectJsonDiffPaths(record, canonical);
    const allowedPrefixes = create
      ? [`slices[${sliceIndex}]`]
      : changedSliceFields.map((field) => `slices[${sliceIndex}].${field}`);
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
      attestationAction: action,
      create
    };
  } catch (error) {
    if (!(error instanceof ReadySliceInputError)) throw error;
    return refusal(error.diagnostic);
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
