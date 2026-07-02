

import { validateWorkRecord } from "./work-record-schema.mjs";
import { SLICE_ID_PATTERN } from "./work-record-schema-constants.mjs";

const RECORD_ID_PATTERN = /^WK-[0-9]{4}$/;
const ORDINAL_SLICE_ID_PATTERN = /^SLICE-[0-9]{3}$/;

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
    target.acceptance = { criteria: [], validation: [] };
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
