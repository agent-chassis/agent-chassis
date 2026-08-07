

import { SLICE_ID_PATTERN } from "./work-record-schema-constants.mjs";
import {
  INITIATIVE_ID_PATTERN,
  cloneJson,
  createDiagnostic,
  defaultSliceTemplate,
  finalizeEdit,
  findSliceIndex,
  isObject,
  isOrdinalSliceId,
  isString,
  isStringArray,
  jsonEqual,
  nextOrdinalSliceId,
  prefixSliceField,
  refusal,
  selectScopedTarget
} from "./work-record-contract-edit-shared.mjs";

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

export function shapeReviewUnit(record, { sliceId = null, reviewPurpose = "standalone" } = {}) {
  if (!["standalone", "terminal_whole_wk"].includes(reviewPurpose)) {
    return refusal(createDiagnostic(
      "invalid_review_purpose",
      "reviewPurpose must be standalone or terminal_whole_wk",
      { path: prefixSliceField(sliceId ?? null, "review_purpose") }
    ));
  }
  if (sliceId === null && reviewPurpose !== "standalone") {
    return refusal(createDiagnostic(
      "invalid_review_purpose",
      "terminal_whole_wk reviewPurpose is valid only on a findings-only slice",
      { path: "review_purpose" }
    ));
  }
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
  if (sliceId !== null && target.review_purpose !== reviewPurpose) {
    target.review_purpose = reviewPurpose;
    changedFields.push(prefixSliceField(sliceId, "review_purpose"));
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
