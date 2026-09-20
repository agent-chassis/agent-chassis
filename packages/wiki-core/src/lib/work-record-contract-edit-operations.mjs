

import {
  SLICE_ID_PATTERN,
  WORK_RECORD_AGENT_NOTES_MAX_UTF8_BYTES
} from "./work-record-schema-constants.mjs";
import { analyzeWorkRecordFindingsUnit } from "./work-record-findings-semantics.mjs";
import { validateWorkRecordMaterialRefs } from "./work-record-entry-material.mjs";
import { planAcceptanceNarrativeValidation } from "./work-record-contract-edit-acceptance.mjs";
import { normalizeAcceptanceCriteria } from "./work-record-ready-slice-contract.mjs";
import {
  INITIATIVE_ID_PATTERN,
  cloneJson,
  createDiagnostic,
  hasOwn,
  defaultSliceTemplate,
  finalizeEdit,
  findExistingSliceDelegatedField,
  findSliceIndex,
  isObject,
  isOrdinalSliceId,
  isString,
  jsonEqual,
  mergeSliceContractBody,
  nextOrdinalSliceId,
  prefixSliceField,
  refusal,
  selectScopedTarget
} from "./work-record-contract-edit-shared.mjs";

const STRING_SCHEMA = Object.freeze({ type: "string" });
const CONTENT_STRING_SCHEMA = Object.freeze({ type: "string", entry_content: true });
const NONEMPTY_STRING_SCHEMA = Object.freeze({ type: "string", trim: true, min_length: 1 });
const CONTENT_NONEMPTY_STRING_SCHEMA = Object.freeze({
  type: "string", trim: true, min_length: 1, entry_content: true
});
const CONTENT_BOUNDED_NOTES_SCHEMA = Object.freeze({
  type: "string", max_utf8_bytes: WORK_RECORD_AGENT_NOTES_MAX_UTF8_BYTES,
  entry_content: true
});
const STRING_LIST_SCHEMA = Object.freeze({ type: "array", items: STRING_SCHEMA });
const MATERIAL_REF_LIST_SCHEMA = Object.freeze({
  type: "array",
  max_items: 16,
  items: Object.freeze({ type: "object", required: Object.freeze(["ref"]),
    additional_properties: false, properties: Object.freeze({ ref: STRING_SCHEMA }) })
});

const ACCEPTANCE_CRITERIA_LIST_SCHEMA = Object.freeze({
  type: "array", items: Object.freeze({ shape: "acceptance_criterion" })
});
const ACCEPTANCE_NOTE_LIST_SCHEMA = Object.freeze({
  type: "array", items: Object.freeze({ shape: "acceptance_note" })
});
const REPLACE = Object.freeze(["replace"]);
const REPLACE_APPEND = Object.freeze(["replace", "append"]);

function fieldEntry(entry) {
  return Object.freeze({
    ...entry,
    canonical_address: Object.freeze([...entry.canonical_address]),
    ...(entry.planner_address
      ? { planner_address: Object.freeze([...entry.planner_address]) }
      : {}),
    applicability: Object.freeze([...entry.applicability]),
    actions: Object.freeze([...entry.actions]),
    value_schema: Object.freeze({ ...entry.value_schema })
  });
}

export const WORK_RECORD_EDIT_FIELD_REGISTRY = Object.freeze([
  fieldEntry({ id: "title.record", field: "title", kind: "scalar", canonical_address: ["title"], applicability: ["record"], value_schema: NONEMPTY_STRING_SCHEMA, actions: REPLACE, owner: "editWorkRecordByUnit", facade: true }),
  fieldEntry({ id: "priority.record", field: "priority", kind: "scalar", canonical_address: ["priority"], applicability: ["record"], value_schema: { type: "string", enum: Object.freeze(["critical", "high", "medium", "low"]) }, actions: REPLACE, owner: "editWorkRecordByUnit", facade: true }),
  fieldEntry({ id: "owner.record", field: "owner", kind: "scalar", canonical_address: ["owner"], applicability: ["record"], value_schema: NONEMPTY_STRING_SCHEMA, actions: REPLACE, owner: "editWorkRecordByUnit", facade: true }),
  fieldEntry({ id: "summary.record_slice", field: "sections.summary", kind: "scalar", canonical_address: ["sections", "summary"], applicability: ["record", "slice"], value_schema: CONTENT_STRING_SCHEMA, actions: REPLACE, owner: "editWorkRecordByUnit", facade: true }),
  fieldEntry({ id: "why_it_matters.record_slice", field: "sections.why_it_matters", kind: "scalar", canonical_address: ["sections", "why_it_matters"], applicability: ["record", "slice"], value_schema: CONTENT_STRING_SCHEMA, actions: REPLACE, owner: "editWorkRecordByUnit", facade: true }),
  fieldEntry({ id: "agent_notes.record_slice", field: "sections.agent_notes", kind: "scalar", canonical_address: ["sections", "agent_notes"], applicability: ["record", "slice"], value_schema: CONTENT_BOUNDED_NOTES_SCHEMA, actions: REPLACE, owner: "editWorkRecordByUnit", facade: true }),
  fieldEntry({ id: "tags.record", field: "tags", kind: "list", canonical_address: ["tags"], applicability: ["record"], value_schema: STRING_LIST_SCHEMA, actions: REPLACE_APPEND, owner: "editWorkRecordByUnit", facade: true }),
  fieldEntry({ id: "scope_items.record", field: "sections.scope.items", kind: "list", canonical_address: ["sections", "scope", "items"], applicability: ["record"], value_schema: STRING_LIST_SCHEMA, actions: REPLACE_APPEND, owner: "editWorkRecordByUnit", facade: true }),
  fieldEntry({ id: "scope_out_of_scope.record", field: "sections.scope.out_of_scope", kind: "list", canonical_address: ["sections", "scope", "out_of_scope"], applicability: ["record"], value_schema: STRING_LIST_SCHEMA, actions: REPLACE_APPEND, owner: "editWorkRecordByUnit", facade: true }),
  fieldEntry({ id: "references.record", field: "sections.references", kind: "list", canonical_address: ["sections", "references"], applicability: ["record"], value_schema: STRING_LIST_SCHEMA, actions: REPLACE_APPEND, owner: "editWorkRecordByUnit", facade: true }),
  fieldEntry({ id: "material_refs.record_slice", field: "sections.material_refs", kind: "list", canonical_address: ["sections", "material_refs"], applicability: ["record", "slice"], value_schema: MATERIAL_REF_LIST_SCHEMA, actions: REPLACE_APPEND, owner: "setListField", facade: true }),
  fieldEntry({ id: "read_scope.record_slice", field: "read_scope", kind: "list", canonical_address: ["read_scope"], applicability: ["record", "slice"], value_schema: STRING_LIST_SCHEMA, actions: REPLACE_APPEND, owner: "setListField", facade: true }),
  ...["repo_paths", "write_scope", "depends_on"].map((field) => fieldEntry({ id: `${field}.record_slice`, field, kind: "list", canonical_address: [field], applicability: ["record", "slice"], value_schema: STRING_LIST_SCHEMA, actions: REPLACE_APPEND, owner: "setListField", facade: true })),
  ...["related", "blocks"].map((field) => fieldEntry({ id: `${field}.record`, field, kind: "list", canonical_address: [field], applicability: ["record"], value_schema: STRING_LIST_SCHEMA, actions: REPLACE_APPEND, owner: "setListField", facade: true })),
  fieldEntry({ id: "acceptance_criteria.record_slice", field: "acceptance.criteria", kind: "list", canonical_address: ["acceptance", "criteria"], applicability: ["record", "slice"], value_schema: ACCEPTANCE_CRITERIA_LIST_SCHEMA, actions: REPLACE_APPEND, owner: "editWorkRecordByUnit", facade: true }),
  fieldEntry({ id: "acceptance_validation.record_slice", field: "acceptance.validation", kind: "list", canonical_address: ["acceptance", "validation"], applicability: ["record", "slice"], value_schema: ACCEPTANCE_NOTE_LIST_SCHEMA, actions: REPLACE_APPEND, owner: "planAcceptanceNarrativeValidation", facade: true }),
  fieldEntry({ id: "tasks.record_slice", field: "sections.tasks", kind: "task", canonical_address: ["sections", "tasks"], applicability: ["record", "slice"], value_schema: { mark_done: null, replace_text: CONTENT_NONEMPTY_STRING_SCHEMA, append_todo: CONTENT_NONEMPTY_STRING_SCHEMA }, actions: ["mark_done", "replace_text", "append_todo"], owner: "setWorkRecordTaskByUnit", facade: true })
]);

export const WORK_RECORD_CONTRACT_LIST_FIELDS = Object.freeze(WORK_RECORD_EDIT_FIELD_REGISTRY
  .filter((entry) => entry.kind === "list" && entry.owner === "setListField")
  .map((entry) => entry.field));
export const WORK_RECORD_SLICE_LIST_FIELDS = Object.freeze(WORK_RECORD_EDIT_FIELD_REGISTRY
  .filter((entry) => entry.kind === "list" && entry.owner === "setListField" && entry.applicability.includes("slice"))
  .map((entry) => entry.field));
export const WORK_RECORD_LIST_FIELD_WRITE_MODES = Object.freeze([...new Set(
  WORK_RECORD_EDIT_FIELD_REGISTRY
    .filter((entry) => entry.kind === "list" && entry.owner === "setListField")
    .flatMap((entry) => entry.actions)
)]);
export const WORK_RECORD_TASK_EDIT_ACTIONS = WORK_RECORD_EDIT_FIELD_REGISTRY
  .find((entry) => entry.kind === "task").actions;

export function workRecordProseRegistryEntries(scope) {
  return WORK_RECORD_EDIT_FIELD_REGISTRY.filter((entry) =>
    entry.kind === "scalar" && entry.value_schema?.entry_content === true &&
    entry.applicability.includes(scope)
  );
}

function resolveListFieldAddress(field) {
  const entry = WORK_RECORD_EDIT_FIELD_REGISTRY.find(
    (candidate) => candidate.field === field && candidate.owner === "setListField"
  );
  if (!entry) return null;
  const address = entry.planner_address || entry.canonical_address;
  return {
    container: address.slice(0, -1),
    key: address.at(-1),
    canonicalField: entry.canonical_address.join(".")
  };
}

function resolveListFieldContainer(target, address) {
  let container = target;
  for (const step of address.container) {
    if (!isObject(container[step])) {
      return null;
    }
    container = container[step];
  }
  return container;
}

function normalizeListFieldEntry(entry, field, repository) {
  if (field === "sections.material_refs") {
    const diagnostics = validateWorkRecordMaterialRefs([entry], { path: field, repository });
    return diagnostics.length === 0
      ? { ok: true, value: cloneJson(entry) }
      : { ok: false, message: diagnostics[0].message };
  }
  return isString(entry)
    ? { ok: true, value: entry }
    : { ok: false, message: "must be a string" };
}

function resolveFindingsRoleOnUpsert(prospective, { roleAuthored, callerNamedFindingsFields }) {
  const analysis = analyzeWorkRecordFindingsUnit(prospective);
  if (!analysis.is_findings_unit) {
    return { ok: true };
  }
  if (!roleAuthored) {
    prospective.dispatch_intent = {
      ...(isObject(prospective.dispatch_intent) ? prospective.dispatch_intent : {}),
      intended_agent_role: analysis.required_technical_role
    };
    return { ok: true, derived: true };
  }
  const conflict = analysis.diagnostics.find((entry) => entry.code === "findings_role_conflict");
  if (conflict && callerNamedFindingsFields) {
    return {
      ok: false,
      diagnostic: createDiagnostic(conflict.code, conflict.message, {
        path: "slice.dispatch_intent.intended_agent_role"
      })
    };
  }
  return { ok: true };
}

function upsertPayloadAuthoredRole(incoming, fallback) {
  const source = isObject(incoming?.dispatch_intent) ? incoming.dispatch_intent : fallback;
  return isObject(source) && hasOwn(source, "intended_agent_role") &&
    source.intended_agent_role !== null;
}

export const WORK_RECORD_CONTRACT_EDIT_OPERATIONS = Object.freeze([
  "upsert_slice",
  "delete_slice",
  "set_list_field",
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
  if (isObject(slice.sections)) {
    for (const entry of workRecordProseRegistryEntries("slice")) {
      const key = entry.canonical_address.at(-1);
      if (!hasOwn(slice.sections, key)) continue;
      const destination = validateWorkRecordProseDestination({
        field: entry.field,
        scope: "slice",
        value: slice.sections[key],
        path: `slice.sections.${key}`
      });
      if (!destination.ok) return refusal(destination.diagnostic);
    }
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

  if (isObject(incoming.acceptance) && hasOwn(incoming.acceptance, "validation")) {
    const stored = index === -1 ? undefined : clone.slices[index].acceptance;
    const composed = planAcceptanceNarrativeValidation({
      current: isObject(stored) && hasOwn(stored, "validation") ? stored.validation : [],
      requested: incoming.acceptance.validation,
      action: "replace",
      path: "slice.acceptance.validation",
      storedPath: `slices[${sliceId}].acceptance.validation`
    });
    if (!composed.ok) {
      return refusal(composed.diagnostic);
    }
    incoming.acceptance = { ...incoming.acceptance, validation: composed.validation };
  }

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
    const createdRole = resolveFindingsRoleOnUpsert(created, {
      roleAuthored: upsertPayloadAuthoredRole(incoming, null),
      callerNamedFindingsFields: true
    });
    if (!createdRole.ok) {
      return refusal(createdRole.diagnostic);
    }
    clone.slices.push(created);
    return finalizeEdit(clone, [`slices[${sliceId}]`]);
  }

  const existing = clone.slices[index];
  const delegatedField = findExistingSliceDelegatedField(incoming);
  if (delegatedField) {
    return refusal(
      createDiagnostic(
        "field_owner_mismatch",
        "slice.sections.tasks is owned by setWorkRecordTaskByUnit after slice creation; use workspace_work_record_edit with a task action",
        { path: `slice.${delegatedField}` }
      )
    );
  }

  const mergeResult = mergeSliceContractBody(existing, incoming);
  if (!mergeResult.ok) {
    return refusal(
      createDiagnostic(
        "unsupported_nested_slice_merge",
        `slice.${mergeResult.key} is a nested object outside the merge policy; replacing it would drop ` +
          `${mergeResult.droppedKeys.length ? mergeResult.droppedKeys.join(", ") : "previously written nested content"}. ` +
          `Supply the complete ${mergeResult.key} object, ` +
          "or make the change through the route that owns that field.",
        { path: `slice.${mergeResult.key}` }
      )
    );
  }
  const merged = mergeResult.merged;
  const mergedRole = resolveFindingsRoleOnUpsert(merged, {
    roleAuthored: upsertPayloadAuthoredRole(incoming, existing.dispatch_intent),
    callerNamedFindingsFields: hasOwn(incoming, "work_kind") || hasOwn(incoming, "dispatch_intent")
  });
  if (!mergedRole.ok) {
    return refusal(mergedRole.diagnostic);
  }
  const changedFields = Object.keys(incoming)
    .filter((key) => !jsonEqual(existing[key], merged[key]))
    .map((key) => `slices[${sliceId}].${key}`);

  const derivedRoleField = `slices[${sliceId}].dispatch_intent`;
  if (mergedRole.derived && !changedFields.includes(derivedRoleField)) {
    changedFields.push(derivedRoleField);
  }
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

export function setListField(record, { sliceId = null, field, values, mode = "replace", repository = null } = {}) {
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
  if (!WORK_RECORD_LIST_FIELD_WRITE_MODES.includes(mode)) {
    return refusal(
      createDiagnostic(
        "unsupported_list_field_mode",
        `Unsupported write mode '${mode}'; expected one of: ${WORK_RECORD_LIST_FIELD_WRITE_MODES.join(", ")}`,
        { path: "mode" }
      )
    );
  }
  const address = resolveListFieldAddress(field);
  if (!address) {
    return refusal(
      createDiagnostic(
        "unaddressable_list_field",
        `List field '${field}' has no declared address; a nested field must declare its container path before it can be written`,
        { path: "field" }
      )
    );
  }
  if (!Array.isArray(values)) {
    return refusal(
      createDiagnostic("invalid_list_value", `${field} must be an array`, {
        path: "values"
      })
    );
  }
  if (mode === "append" && values.length !== 1) {
    return refusal(
      createDiagnostic(
        "invalid_append_payload",
        `append adds exactly one entry to ${field}; ${values.length} were supplied`,
        { path: "values" }
      )
    );
  }
  const nextValues = [];
  for (const [index, entry] of values.entries()) {
    const normalized = normalizeListFieldEntry(entry, field, repository);
    if (!normalized.ok) {
      return refusal(
        createDiagnostic(
          "invalid_list_value",
          `${field}[${index}] ${normalized.message}`,
          { path: "values" }
        )
      );
    }
    nextValues.push(normalized.value);
  }

  const clone = cloneJson(record);
  const selected = selectScopedTarget(clone, sliceId ?? null);
  if (!selected.ok) {
    return selected.refusal;
  }
  const container = resolveListFieldContainer(selected.target, address);
  if (!container) {
    return refusal(
      createDiagnostic(
        "list_field_container_missing",
        `${prefixSliceField(sliceId ?? null, address.container.join("."))} is missing or is not an object; repair it before writing ${field}`,
        { path: prefixSliceField(sliceId ?? null, address.container.join(".")) }
      )
    );
  }
  const currentValue = container[address.key];

  if (mode === "append") {
    if (currentValue !== undefined && !Array.isArray(currentValue)) {
      return refusal(
        createDiagnostic(
          "invalid_list_field_state",
          `${prefixSliceField(sliceId ?? null, address.canonicalField)} is not an array; a whole-field replacement must repair it before an append`,
          { path: prefixSliceField(sliceId ?? null, address.canonicalField) }
        )
      );
    }
    const currentValues = Array.isArray(currentValue) ? currentValue : [];
    const [appended] = nextValues;
    if (currentValues.some((existing) => jsonEqual(existing, appended))) {
      return finalizeEdit(clone, []);
    }
    container[address.key] = [...currentValues, appended];
    return finalizeEdit(clone, [prefixSliceField(sliceId ?? null, address.canonicalField)]);
  }

  if (jsonEqual(currentValue, nextValues)) {
    return finalizeEdit(clone, []);
  }
  container[address.key] = nextValues;
  return finalizeEdit(clone, [prefixSliceField(sliceId ?? null, address.canonicalField)]);
}

const GENERAL_EDIT_KEYS = Object.freeze(["kind", "field", "action", "value", "text", "index"]);

export const WORK_RECORD_EDIT_SPECIALIZED_FIELD_OWNERS = Object.freeze([
  { prefixes: ["status"], owner: "workspace_work_record_set_status" },
  { prefixes: ["acceptance"], owner: "the acceptance.criteria or acceptance.validation list field; executable validation bindings belong to controlled-contract semantic operations" },
  { prefixes: ["sections.closure", "closure"], owner: "workspace_work_record_set_closure" },
  { prefixes: ["initiative"], owner: "assign_work_record_to_initiative" },
  { prefixes: ["dispatch_intent"], owner: "workspace_work_record_ready_slice or workspace_work_record_upsert_slice" },
  { prefixes: ["controlled_contract", "proof", "proof_posture"], owner: "controlled-contract semantic operations" },
  { prefixes: ["controlled_acceptance_state"], owner: "no writer; derived from canonical proof_posture and current controlled-contract state" },
  { prefixes: ["evidence", "derived_evidence", "review_provenance"], owner: "the evidence-producing semantic operation" },
  { prefixes: ["projections"], owner: "structured wiki generation" },
  { prefixes: ["migration"], owner: "workspace work-record migration" },
  { prefixes: ["schema_version", "id", "repo", "record_kind", "work_kind", "resolution", "created", "updated", "expected_edit_targets", "expected_changed_line_budget"], owner: "no general editor; use the field's specialized semantic owner" }
]);

export function resolveWorkRecordEditRegistryEntry({ field, kind, sliceId = null, facadeOnly = true } = {}) {
  const scope = sliceId === null || sliceId === undefined ? "record" : "slice";
  const named = WORK_RECORD_EDIT_FIELD_REGISTRY.filter((entry) => entry.field === field);
  const scoped = named.find((entry) => entry.applicability.includes(scope));
  const entry = scoped || named[0] || null;
  if (!entry) return { ok: false, code: "unsupported_edit_field", entry: null, scope };
  if (!entry.applicability.includes(scope)) {
    return { ok: false, code: "invalid_edit_applicability", entry, scope };
  }
  if (facadeOnly && !entry.facade) {
    return { ok: false, code: "field_owner_mismatch", entry, scope };
  }
  if (entry.kind !== kind) {
    return { ok: false, code: "edit_kind_mismatch", entry, scope };
  }
  return { ok: true, entry, scope };
}

function editRefusal(code, message, path = "edit") {
  return refusal(createDiagnostic(code, message, { path }));
}

function knownFieldOwner(field) {
  return WORK_RECORD_EDIT_SPECIALIZED_FIELD_OWNERS.find(({ prefixes }) => prefixes.some(
    (prefix) => field === prefix || field.startsWith(`${prefix}.`)
  ))?.owner || null;
}

function normalizeScalarValue(entry, value) {
  const schema = entry.value_schema;
  if (typeof value !== "string") return { ok: false, message: `${entry.field} must be a string` };
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    return { ok: false, message: `${entry.field} must be one of: ${schema.enum.join(", ")}` };
  }
  const normalized = schema.trim ? value.trim() : value;
  if (schema.min_length && normalized.length < schema.min_length) {
    return { ok: false, message: `${entry.field} must not be blank` };
  }
  if (schema.max_utf8_bytes && Buffer.byteLength(normalized, "utf8") > schema.max_utf8_bytes) {
    return { ok: false, message: `${entry.field} must be at most ${schema.max_utf8_bytes} UTF-8 bytes` };
  }
  return { ok: true, value: normalized };
}

export function validateWorkRecordProseDestination({
  field,
  scope,
  value,
  path = field
}) {
  const entry = WORK_RECORD_EDIT_FIELD_REGISTRY.find((candidate) =>
    candidate.kind === "scalar" && candidate.field === field &&
    candidate.applicability.includes(scope) && candidate.value_schema?.entry_content === true
  );
  if (!entry) {
    return {
      ok: false,
      diagnostic: createDiagnostic(
        "unsupported_prose_destination",
        `${field} is not a registry-owned prose destination for ${scope}`,
        { path }
      )
    };
  }
  const normalized = normalizeScalarValue(entry, value);
  if (!normalized.ok) {
    return {
      ok: false,
      diagnostic: createDiagnostic(
        "invalid_prose_destination",
        normalized.message,
        { path }
      )
    };
  }
  return { ok: true, value: normalized.value, entry };
}

function resolveAddressContainer(target, address) {
  let container = target;
  for (const step of address.slice(0, -1)) {
    if (!isObject(container[step])) return null;
    container = container[step];
  }
  return { container, key: address.at(-1) };
}

function selectAcceptanceTarget(record, sliceId) {
  const clone = cloneJson(record);
  const selected = selectScopedTarget(clone, sliceId);
  if (!selected.ok) return selected;
  const field = prefixSliceField(sliceId, "acceptance");
  if (!isObject(selected.target.acceptance)) {
    return {
      ok: false,
      refusal: editRefusal("edit_field_container_missing", `${field} is missing or is not an object`, field)
    };
  }
  return { ok: true, clone, acceptance: selected.target.acceptance };
}

function planAcceptanceCriteriaEdit(record, { sliceId, action, value }) {
  if (action === "replace" ? !Array.isArray(value) : Array.isArray(value)) {
    return editRefusal(
      "invalid_edit_value",
      action === "replace"
        ? "acceptance.criteria replace requires an array of criteria"
        : "acceptance.criteria append requires exactly one criterion",
      "edit.value"
    );
  }
  const normalized = normalizeAcceptanceCriteria(value, { path: "edit.value", append: action === "append" });
  if (!normalized.ok) {
    return editRefusal("invalid_edit_value", normalized.diagnostic.message, normalized.diagnostic.path);
  }
  const selected = selectAcceptanceTarget(record, sliceId);
  if (!selected.ok) return selected.refusal;
  const field = prefixSliceField(sliceId, "acceptance.criteria");
  const current = selected.acceptance.criteria;
  if (action === "append") {
    if (!Array.isArray(current)) {
      return editRefusal("invalid_list_field_state", `${field} is not an array`, field);
    }
    if (current.some((entry) => jsonEqual(entry, normalized.value))) return finalizeEdit(selected.clone, []);
    selected.acceptance.criteria = [...current, normalized.value];
  } else {
    if (jsonEqual(current, normalized.value)) return finalizeEdit(selected.clone, []);
    selected.acceptance.criteria = normalized.value;
  }
  return finalizeEdit(selected.clone, [field]);
}

function planAcceptanceValidationEdit(record, { sliceId, action, value }) {
  const selected = selectAcceptanceTarget(record, sliceId);
  if (!selected.ok) return selected.refusal;
  const field = prefixSliceField(sliceId, "acceptance.validation");
  const planned = planAcceptanceNarrativeValidation({
    current: selected.acceptance.validation,
    requested: value,
    action,
    path: "edit.value",
    storedPath: field
  });
  if (!planned.ok) return refusal(planned.diagnostic);
  if (!planned.changed) return finalizeEdit(selected.clone, []);
  selected.acceptance.validation = planned.validation;
  return finalizeEdit(selected.clone, [field]);
}

export function editWorkRecordByUnit(record, { sliceId = null, edit, repository = null } = {}) {
  if (!isObject(edit)) return editRefusal("invalid_edit_request", "edit must be one scalar, list, or task request");
  const unknownKey = Object.keys(edit).find((key) => !GENERAL_EDIT_KEYS.includes(key));
  if (unknownKey) {
    return editRefusal(
      "unbounded_edit_request",
      `edit.${unknownKey} is not accepted; arbitrary paths, roots, objects, and whole-record payloads are refused`,
      `edit.${unknownKey}`
    );
  }
  if (!isString(edit.field) || !isString(edit.kind) || !isString(edit.action)) {
    return editRefusal("invalid_edit_request", "edit requires string kind, field, and action discriminators");
  }
  const resolution = resolveWorkRecordEditRegistryEntry({
    field: edit.field,
    kind: edit.kind,
    sliceId
  });
  if (!resolution.ok) {
    if (!resolution.entry) {
      const owner = knownFieldOwner(edit.field);
      return owner
        ? editRefusal("field_owner_mismatch", `${edit.field} is not generally editable; use ${owner}`, "edit.field")
        : editRefusal("unsupported_edit_field", `Unsupported work-record edit field '${edit.field}'; use one exact registry field`, "edit.field");
    }
    if (resolution.code === "invalid_edit_applicability") {
      return editRefusal(
        resolution.code,
        `${edit.field} is ${resolution.entry.applicability.join("/")}-scoped and cannot edit a ${resolution.scope} unit`,
        "edit.field"
      );
    }
    if (resolution.code === "field_owner_mismatch") {
      return editRefusal(
        resolution.code,
        `${edit.field} is not generally editable; use ${resolution.entry.owner}`,
        "edit.field"
      );
    }
    return editRefusal(
      resolution.code,
      `${edit.field} is a ${resolution.entry.kind} field, not ${edit.kind}`,
      "edit.kind"
    );
  }
  const { entry } = resolution;
  if (!entry.actions.includes(edit.action)) {
    return editRefusal(
      "unsupported_edit_action",
      `${entry.field} supports only: ${entry.actions.join(", ")}`,
      "edit.action"
    );
  }
  if (entry.kind === "task") {
    return editRefusal(
      "field_owner_mismatch",
      "sections.tasks is owned by setWorkRecordTaskByUnit",
      "edit.field"
    );
  }
  if (edit.text !== undefined || edit.index !== undefined) {
    return editRefusal("ambiguous_edit_request", "text and index selectors are valid only for task edits");
  }

  if (entry.id === "acceptance_criteria.record_slice") {
    return planAcceptanceCriteriaEdit(record, { sliceId, action: edit.action, value: edit.value });
  }
  if (entry.owner === "planAcceptanceNarrativeValidation") {
    return planAcceptanceValidationEdit(record, { sliceId, action: edit.action, value: edit.value });
  }

  if (entry.kind === "list" && entry.owner === "setListField") {
    const values = edit.action === "append" ? [edit.value] : edit.value;
    return setListField(record, { sliceId, field: entry.field, values, mode: edit.action, repository });
  }

  if (entry.kind === "scalar") {
    const normalized = normalizeScalarValue(entry, edit.value);
    if (!normalized.ok) return editRefusal("invalid_edit_value", normalized.message, "edit.value");
    const clone = cloneJson(record);
    const selected = selectScopedTarget(clone, sliceId);
    if (!selected.ok) return selected.refusal;
    if (
      sliceId !== null &&
      entry.value_schema?.entry_content === true &&
      entry.canonical_address[0] === "sections" &&
      selected.target.sections === undefined
    ) {
      selected.target.sections = {};
    }
    const address = resolveAddressContainer(selected.target, entry.canonical_address);
    if (!address) return editRefusal("edit_field_container_missing", `${entry.field} container is missing`, entry.field);
    if (jsonEqual(address.container[address.key], normalized.value)) return finalizeEdit(clone, []);
    address.container[address.key] = normalized.value;
    return finalizeEdit(clone, [prefixSliceField(sliceId, entry.canonical_address.join("."))]);
  }

  if (!Array.isArray(edit.value) && edit.action === "replace") {
    return editRefusal("invalid_edit_value", `${entry.field} replace requires an array of strings`, "edit.value");
  }
  const values = edit.action === "append" ? [edit.value] : edit.value;
  if (!values.every(isString)) {
    return editRefusal("invalid_edit_value", `${entry.field} values must be strings`, "edit.value");
  }
  const clone = cloneJson(record);
  const selected = selectScopedTarget(clone, sliceId);
  if (!selected.ok) return selected.refusal;
  const address = resolveAddressContainer(selected.target, entry.canonical_address);
  if (!address) return editRefusal("edit_field_container_missing", `${entry.field} container is missing`, entry.field);
  const current = address.container[address.key];
  if (edit.action === "append") {
    if (current !== undefined && !Array.isArray(current)) {
      return editRefusal("invalid_list_field_state", `${entry.field} is not an array`, entry.field);
    }
    if ((current || []).some((value) => jsonEqual(value, edit.value))) return finalizeEdit(clone, []);
    address.container[address.key] = [...(current || []), edit.value];
  } else {
    if (jsonEqual(current, values)) return finalizeEdit(clone, []);
    address.container[address.key] = cloneJson(values);
  }
  return finalizeEdit(clone, [entry.canonical_address.join(".")]);
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
  edit_work_record: (record, params) => editWorkRecordByUnit(record, params),
  set_list_field: (record, params) => setListField(record, params),
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
