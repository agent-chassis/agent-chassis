

import { createRequire } from "node:module";
import { sourceAreaBirthSchema } from "../operations/record-birth-plan.mjs";

import { CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_UPSERT_INPUT_SCHEMA } from "./controlled-contract-tools.mjs";
import { kindRecordEditableScalarFields } from "./kind-record-edit.mjs";
import { WORK_RECORD_EDIT_FIELD_REGISTRY, WORK_RECORD_TASK_EDIT_ACTIONS } from
  "./work-record-contract-edit-operations.mjs";
import { ADVISORY_DISPOSITION_JUDGMENTS } from "./review-disposition.mjs";
import {
  WORK_RECORD_READY_SLICE_ACCEPTANCE_SCHEMA,
  WORK_RECORD_READY_SLICE_ACCEPTED_VALUES,
  WORK_RECORD_READY_SLICE_CREATION_REQUIREMENTS,
  WORK_RECORD_READY_SLICE_DISPATCH_INTENT_ASSERTION_VALUES,
  WORK_RECORD_READY_SLICE_DISPATCH_INTENT_CONTROL_FLAGS,
  WORK_RECORD_READY_SLICE_EXPECTED_EDIT_TARGET_SCHEMA,
  WORK_RECORD_READY_SLICE_SHAPING_MODES,
  emptyWorkRecordReadySliceCreationFields,
  missingWorkRecordReadySliceCreationFields
} from "./work-record-ready-slice-contract.mjs";
import { getRecordKindSpec } from "./work-record-kind-registry.mjs";
import { WORK_RECORD_EXPECTED_EDIT_TARGET_SCHEMA } from "./work-record-schema-structure.mjs";
import {
  WORK_RECORD_CLOSURE_FIELD_NAMES,
  WORK_RECORD_STATUS_VALUES
} from "./work-record-schema-constants.mjs";

export const RECORD_AUTHORING_SLICE_CONTEXT = "existing_slice";
export const RECORD_AUTHORING_CONTEXTS = Object.freeze(["existing", RECORD_AUTHORING_SLICE_CONTEXT, "birth"]);
export const RECORD_AUTHORING_LABEL_PATTERN = "^[a-z][a-z0-9-]{0,63}$";
export const RECORD_AUTHORING_LABEL_REFERENCE_PATTERN = "^\\$[a-z][a-z0-9-]{0,63}$";

const semantic = CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_UPSERT_INPUT_SCHEMA;
const upsertObligation = semantic.properties.obligations.items.properties;
const upsertRequirement = semantic.properties.contract_requirements.properties.requirements.items;
const retiredClaim = semantic.properties.contract_requirements.properties.retire_claim_ids.items;

const label = Object.freeze({ type: "string", pattern: RECORD_AUTHORING_LABEL_PATTERN });
const labelReference = Object.freeze({ type: "string",
  pattern: RECORD_AUTHORING_LABEL_REFERENCE_PATTERN });
const orLabel = (schema) => ({ anyOf: [schema, labelReference] });
const closed = (properties, required = []) => ({ type: "object", additionalProperties: false,
  ...(required.length > 0 ? { required } : {}), properties });
const open = Object.freeze({ type: "object", additionalProperties: true });
const strings = Object.freeze({ type: "array", items: { type: "string" } });

const ROW = "x-record-authoring-row";
const keyed = (id, properties, required = []) => ({ [ROW]: "key_or_id", oneOf: [
  closed({ key: label, ...properties }, ["key", ...required]),
  closed({ id, ...properties }, ["id"])] });

const optionallyKeyed = (id, properties, required = []) => ({ [ROW]: "key_optional", oneOf: [
  closed({ key: label, ...properties }, required),
  closed({ id, ...properties }, ["id", ...required])] });

const contentLeaf = { oneOf: [closed({ text: { type: "string" } }, ["text"]),
  closed({ ref: { type: "string", minLength: 1 } }, ["ref"])] };
const contentCarrier = { oneOf: [...contentLeaf.oneOf,
  closed({ parts: { type: "array", minItems: 1, items: contentLeaf } }, ["parts"])] };

export const WORK_ITEM_ORDINARY_MEMBERS = Object.freeze([
  ["title", "title"], ["summary", "sections.summary"],
  ["user_requirements", "sections.user_requirements"],
  ["why_it_matters", "sections.why_it_matters"], ["notes", "sections.agent_notes"],
  ["priority", "priority"], ["base_branch", "base_branch"], ["read_scope", "read_scope"],
  ["write_scope", "write_scope"], ["repo_paths", "repo_paths"], ["depends_on", "depends_on"],
  ["related", "related"], ["blocks", "blocks"], ["material_refs", "sections.material_refs"],
  ["validation", "acceptance.validation"], ["owner", "owner"], ["tags", "tags"],
  ["scope_items", "sections.scope.items"], ["scope_out_of_scope", "sections.scope.out_of_scope"],
  ["references", "sections.references"]
].map(([member, field]) => Object.freeze({ member, field })));

export const WORK_ITEM_SLICE_CONTRACT_MEMBERS = Object.freeze(["work_kind", "target_unit",
  "agent_role", "expected_edit_targets", "expected_changed_line_budget"]);

const SLICE_ROW_MEMBER = Object.freeze({ target_unit: "dispatch_intent.target_unit",
  agent_role: "dispatch_intent.intended_agent_role" });
const SLICE_ROW_LISTS = Object.freeze(["ready_slices", "slices"]);

export const WORK_ITEM_SLICE_CONTRACT_MEMBER_NOTE = "Slice unit (WK#SLICE) only.";

export function sliceContractMemberPlacementDiagnostics(members, context = "existing") {
  return members.map((member) => {
    const rowMember = SLICE_ROW_MEMBER[member] ?? member;
    const path = `changes.${member}`;
    return Object.freeze({ code: "record_authoring_member_not_applicable", severity: "error", path,
      message: context === "birth"
        ? `${path} is a slice contract member; it does not apply to a new record. Author it as ${rowMember} of a ` +
          `${SLICE_ROW_LISTS.join(" or ")} row, or save it on the slice unit once the record exists`
        : `${path} is a slice contract member; it does not apply to the record unit. Select the slice unit it ` +
          `belongs to, or author it as ${rowMember} of a ${SLICE_ROW_LISTS.join(" or ")} row`,
      constraint: { keyword: "applicability", member, applies_to: "slice_unit",
        row_members: SLICE_ROW_LISTS.map((list) => `${list}[].${rowMember}`) } });
  });
}

const ordinaryEditTargets = () => ({ type: "array", items: WORK_RECORD_EXPECTED_EDIT_TARGET_SCHEMA });

const SLICE_BODY_MEMBERS = Object.freeze({ title: { type: "string" }, work_kind: { type: "string" },
  priority: { type: "string" }, owner: { type: "string" }, depends_on: strings, read_scope: strings,
  repo_paths: strings, write_scope: strings, dispatch_intent: open, acceptance: open, sections: open,
  expected_edit_targets: ordinaryEditTargets(), expected_changed_line_budget: { type: "integer", minimum: 0 },
  review_purpose: { type: "string" } });

const SLICE_ROW_IDENTITY_NOTE = "key creates a slice; id selects an existing one. The server allocates the slice " +
  "ID and returns it in bindings.slice[key]; later selected-unit operations use WK#<returned ID>.";
export const WORK_ITEM_SLICE_LIST_NOTES = Object.freeze({
  slices: "Parent WK only, never WK#SLICE. Creates or edits ordinary slice definitions, including incomplete " +
    `drafts. ${SLICE_ROW_IDENTITY_NOTE} A supplied dispatch_intent replaces the saved object whole.`,
  ready_slices: "Parent WK only, never WK#SLICE. Creates or updates slices through assignment shaping and its " +
    "structural completeness checks; it does not approve dispatch, start an agent or grant proof credit. " +
    `${SLICE_ROW_IDENTITY_NOTE} Shaping derives the agent role and target unit; dispatch_intent is a partial ` +
    "update, unlike the slices list's whole-object replacement.",
  shaping_mode: `One of ${WORK_RECORD_READY_SLICE_SHAPING_MODES.supported.join(", ")}. Creation defaults to ` +
    `${WORK_RECORD_READY_SLICE_SHAPING_MODES.creation_default}. An update that omits it uses the saved shape when ` +
    "that is one of these; an unsupported saved shape is refused, never defaulted."
});

const readyDispatchAssertionNote = (values, meaning) => "Normally omit: shaping derives it. " +
  `${meaning}: ${values.join(", ")}. The slice owner validates it, ignoring surrounding whitespace.`;
export const WORK_ITEM_READY_DISPATCH_ASSERTION_NOTES = Object.freeze(Object.fromEntries(
  Object.entries(WORK_RECORD_READY_SLICE_DISPATCH_INTENT_ASSERTION_VALUES).map(([member, values]) =>
    [member, readyDispatchAssertionNote(values, { intended_agent_role:
      "A stated value only asserts the derived assignment and must agree with shaping_mode",
    target_unit: "Assignment category, not a WK address. A stated value only asserts the derived assignment" }[member])])));

export const WORK_ITEM_READY_CLOSED_VALUE_NOTES = Object.freeze(Object.fromEntries(Object.entries({
  status: "", priority: "", work_kind: "Normally omit: shaping derives it. ",
  review_purpose: "Reviewer shaping only. ", completion_policy: "terminal_whole_wk review only. "
}).map(([member, applies]) =>
  [member, `${applies}One of: ${WORK_RECORD_READY_SLICE_ACCEPTED_VALUES[member].join(", ")}.`])));
const readyClosedValue = (member) => ({ type: "string", description: WORK_ITEM_READY_CLOSED_VALUE_NOTES[member] });

const withSliceListNotes = (properties) => ({ ...properties,
  slices: { ...properties.slices, description: WORK_ITEM_SLICE_LIST_NOTES.slices },
  ready_slices: { ...properties.ready_slices, description: WORK_ITEM_SLICE_LIST_NOTES.ready_slices } });

export const WORK_ITEM_CRITERION_NOTES = Object.freeze({
  criteria: "Readable criteria of the selected unit. A new row's key is its same-request label.",
  obligation_criteria: "Criterion ids or $key labels of changes.criteria rows; a label resolves to the issued " +
    "identity, never to text."
});

function registryValueSchema(field) {
  const entry = WORK_RECORD_EDIT_FIELD_REGISTRY.find((candidate) => candidate.field === field);
  const declared = entry.value_schema;
  if (declared.type === "string") {
    const text = { type: "string", ...(declared.enum ? { enum: [...declared.enum] } : {}) };

    return declared.entry_content === true ? { anyOf: [text, contentCarrier] } : text;
  }

  const items = declared.items?.shape === "acceptance_note" ? { anyOf: [{ type: "string" }, open] }
    : declared.items?.shape === "acceptance_criterion" ? { anyOf: [{ type: "string" }, open] }
      : declared.items?.type === "object" ? closed({ ref: { type: "string" } }, ["ref"]) : { type: "string" };
  return { type: "array", items, ...(declared.max_items ? { maxItems: declared.max_items } : {}) };
}

function workItemChangeProperties() {
  const { verification, replace_claim_id: _replace, ...requirement } = upsertRequirement.properties;
  const { obligation_id: obligationId, controlled_contract_node_ids: _nodes,
    acceptance_criteria: _criteria, proof_name: proofName, parameters, clear_parameters: clearParameters,
    refresh_proof_version: refresh, case: authoredCase, ...obligation } = upsertObligation;
  const { case_id: caseId, verification_id: verificationId, ...caseBody } = authoredCase.properties;
  return {
    ...Object.fromEntries(WORK_ITEM_ORDINARY_MEMBERS.map(({ member, field }) =>
      [member, registryValueSchema(field)])),
    retained_graph_evidence: closed({ ref_id: { type: "string", pattern: "^[A-Za-z0-9_-]{8}$" } }, ["ref_id"]),
    initiative: { type: "string", pattern: "^IN-[0-9]{4}$" },
    work_kind: { type: "string", minLength: 1 },
    target_unit: { type: "string", minLength: 1 },
    agent_role: { type: "string", minLength: 1 },
    expected_edit_targets: ordinaryEditTargets(),
    expected_changed_line_budget: { type: "integer", minimum: 0 },

    tasks: { type: "array", minItems: 1, items: { type: "object", additionalProperties: false,
      required: ["action"], properties: { action: { type: "string", enum: [...WORK_RECORD_TASK_EDIT_ACTIONS] },
        text: { type: "string" }, index: { type: "integer", minimum: 0 }, value: { type: "string" } } } },

    entries: { type: "array", minItems: 1, items: keyed({ type: "integer", minimum: 1 },
      { title: { type: "string" }, kind: { type: "string" }, content: contentCarrier }, ["title", "content"]) },

    dispositions: { type: "array", minItems: 1, items: keyed({ type: "integer", minimum: 1 }, {
      entry: { type: "object", additionalProperties: false, required: ["id"], properties: {
        id: orLabel({ type: "integer", minimum: 1 }), version: { type: "integer", minimum: 1 } } },
      finding_id: { type: "string", minLength: 1 },
      selected_text: { type: "object", additionalProperties: false, required: ["text"], properties: {
        text: { type: "string", minLength: 1 }, occurrence: { type: "integer", minimum: 0 } } },
      disposition: { type: "string", enum: [...ADVISORY_DISPOSITION_JUDGMENTS] },
      rationale: { type: "string" } }) },
    criteria: { type: "array", minItems: 1, description: WORK_ITEM_CRITERION_NOTES.criteria,
      items: keyed({ type: "string", minLength: 1 }, { text: { type: "string", minLength: 1 } }, ["text"]) },
    requirements: { type: "array", minItems: 1, maxItems: 8, items: optionallyKeyed(retiredClaim, { ...requirement,
      verification: { ...verification, properties: { key: label, ...verification.properties } } },
    [...upsertRequirement.required]) },
    obligations: { type: "array", minItems: 1, items: keyed(obligationId, { ...obligation,
      criteria: { type: "array", uniqueItems: true, description: WORK_ITEM_CRITERION_NOTES.obligation_criteria,
        items: orLabel({ type: "string", minLength: 1 }) },
      claims: { type: "array", uniqueItems: true, items: orLabel(semantic.$defs.id) },
      proof: { type: "object", additionalProperties: false, properties: { name: proofName,
        parameters, clear_parameters: clearParameters, refresh } },
      case: optionallyKeyed(caseId, { verification: orLabel(verificationId), ...caseBody }) }) },
    controlled_acceptance: semantic.properties.controlled_acceptance,
    slices: { type: "array", minItems: 1, items: keyed({ type: "string", minLength: 1 },
      SLICE_BODY_MEMBERS) },

    ready_slices: { type: "array", minItems: 1, items: keyed({ type: "string", pattern: "^SLICE-[0-9]{3}$" }, {
      shaping_mode: { type: "string", description: WORK_ITEM_SLICE_LIST_NOTES.shaping_mode },
      completion_policy: readyClosedValue("completion_policy"), title: { type: "string" },
      status: readyClosedValue("status"), work_kind: readyClosedValue("work_kind"), priority: readyClosedValue("priority"),
      owner: { type: "string" }, depends_on: strings, read_scope: strings, repo_paths: strings,
      write_scope: strings, acceptance: WORK_RECORD_READY_SLICE_ACCEPTANCE_SCHEMA,
      dispatch_intent: closed({
        ...Object.fromEntries(Object.entries(WORK_ITEM_READY_DISPATCH_ASSERTION_NOTES).map(([member, description]) =>
          [member, { type: "string", description }])),
        ...Object.fromEntries(WORK_RECORD_READY_SLICE_DISPATCH_INTENT_CONTROL_FLAGS.map((member) =>
          [member, { type: "boolean" }])) }),

      expected_edit_targets: { type: "array", items: WORK_RECORD_READY_SLICE_EXPECTED_EDIT_TARGET_SCHEMA },
      expected_changed_line_budget: { type: "integer", minimum: 0 },
      summary: { anyOf: [{ type: "string" }, contentCarrier] },
      why_it_matters: { anyOf: [{ type: "string" }, contentCarrier] },
      agent_notes: { anyOf: [{ type: "string" }, contentCarrier] },
      review_purpose: readyClosedValue("review_purpose"),
      material_refs: { type: "array", items: closed({ ref: { type: "string" } }, ["ref"]) } },
    [...WORK_RECORD_READY_SLICE_CREATION_REQUIREMENTS.every_shaping_mode]) },
    remove: { type: "object", additionalProperties: false, properties: {
      criteria: { type: "array", minItems: 1, uniqueItems: true,
        items: { type: "string", minLength: 1 } },
      requirements: semantic.properties.contract_requirements.properties.retire_claim_ids,
      obligations: { type: "array", minItems: 1, maxItems: 64, items: { type: "object",
        additionalProperties: false, required: ["id", "scope"], properties: { id: obligationId,
          scope: { type: "string", enum: ["selection", "obligation"] } } } },
      slices: { type: "array", minItems: 1, uniqueItems: true,
        items: { type: "string", minLength: 1 } } } },
    status: { type: "string", enum: [...WORK_RECORD_STATUS_VALUES] },
    closure: { type: "object", additionalProperties: false,
      properties: Object.fromEntries(WORK_RECORD_CLOSURE_FIELD_NAMES.map((name) =>
        [name, name === "summary" ? { type: "string" } : strings])) }
  };
}

const KIND_SCALAR_SCHEMAS = Object.freeze({ string: { type: "string" },
  nullable_string: { anyOf: [{ type: "string" }, { type: "null" }] }, string_array: strings,
  reserved: { anyOf: [open, { type: "array", items: open }, { type: "string" }, { type: "null" }] } });

function kindRecordChangeProperties(kind) {
  const spec = getRecordKindSpec(kind);
  return {
    ...Object.fromEntries(kindRecordEditableScalarFields(kind).map((field) => [field,
      KIND_SCALAR_SCHEMAS[(spec.optionalTopLevel[field] ?? spec.requiredTopLevel[field]).type]])),
    sections: { type: "object", additionalProperties: false,
      properties: Object.fromEntries(Object.keys(spec.sectionSpec).map((name) =>
        [name, { type: "string" }])) },

    ...(kind === "decision" ? { status: { type: "string", enum: ["rejected"] } } : {})
  };
}

function birthRowSchema(schema) {
  if (Array.isArray(schema)) return schema.map(birthRowSchema);
  if (schema === null || typeof schema !== "object") return schema;
  if (Object.hasOwn(schema, ROW)) return birthRowSchema(schema.oneOf[0]);
  return Object.fromEntries(Object.entries(schema).map(([key, value]) => [key, birthRowSchema(value)]));
}

const schemas = new Map();

export function recordAuthoringChangeSchema(kind, context = "existing") {
  if (!RECORD_AUTHORING_CONTEXTS.includes(context)) {
    throw new TypeError(`record authoring context must be one of: ${RECORD_AUTHORING_CONTEXTS.join(", ")}`);
  }
  const cacheKey = `${kind}\u0000${context}`;
  if (context === "birth" && (kind === "source" || kind === "area")) {
    if (!schemas.has(cacheKey)) schemas.set(cacheKey, Object.freeze(sourceAreaBirthSchema(kind)));
    return schemas.get(cacheKey);
  }
  if (getRecordKindSpec(kind) === null) {
    throw new TypeError(`record kind '${kind}' has no existing-record authoring schema`);
  }
  if (!schemas.has(cacheKey)) {
    let properties = kind === "work_item" ? workItemChangeProperties() : kindRecordChangeProperties(kind);

    if (kind !== "work_item") {
      if (context === RECORD_AUTHORING_SLICE_CONTEXT) {
        throw new TypeError(`record kind '${kind}' has no slice units`);
      }
    } else {
      for (const member of WORK_ITEM_SLICE_CONTRACT_MEMBERS) {
        if (context === RECORD_AUTHORING_SLICE_CONTEXT) {
          properties[member] = { ...properties[member], description: WORK_ITEM_SLICE_CONTRACT_MEMBER_NOTE };
        } else delete properties[member];
      }
    }

    if (kind === "work_item" && context !== "birth") properties = withSliceListNotes(properties);
    if (context === "birth") {
      properties = birthRowSchema(properties);
      for (const member of ["remove", "status", "closure"]) delete properties[member];
      if (kind === "work_item") {
        const task = properties.tasks.items.properties;
        properties.tasks = { ...properties.tasks, items: closed({
          action: { ...task.action, enum: WORK_RECORD_TASK_EDIT_ACTIONS.filter(action => action === "append_todo") },
          value: task.value
        }, ["action", "value"]) };
      }
    }
    schemas.set(cacheKey, Object.freeze({ type: "object", additionalProperties: false,
      ...(context === "birth" ? {} : { minProperties: 1 }), $defs: semantic.$defs, properties }));
  }
  return schemas.get(cacheKey);
}

const require = createRequire(import.meta.url);
const validators = new Map();
function validatorFor(schema) {
  if (!validators.has(schema)) {
    const loaded = require("ajv");
    const Ajv = loaded.default ?? loaded;
    validators.set(schema, new Ajv({ strict: false, allErrors: true }).compile(schema));
  }
  return validators.get(schema);
}

const pathOf = (instancePath) => `changes${instancePath.replace(/\/([0-9]+)(?=\/|$)/gu, "[$1]")
  .replace(/\//gu, ".")}`;
const has = (value, key) => value !== null && typeof value === "object" && Object.hasOwn(value, key);

function rowVariant(kind, row) {
  const key = has(row, "key"), id = has(row, "id");
  if (key && id) return null;
  if (kind === "key_or_id") return key ? 0 : id ? 1 : null;
  return id ? 1 : 0;
}

function classifyError(schema, changes, error) {
  const tokens = error.schemaPath.replace(/^#\/?/u, "").split("/");
  const at = error.instancePath.split("/").slice(1);
  let node = schema, instance = changes, consumed = 0;
  for (let index = 0; index < tokens.length && node !== undefined && node !== null; index += 1) {
    const token = tokens[index];
    if (token === "properties") {
      const name = tokens[index += 1];
      node = node.properties?.[name];
      if (at[consumed] === name) { instance = instance?.[name]; consumed += 1; }
    } else if (token === "items") {
      node = node.items;
      if (consumed < at.length) { instance = instance?.[at[consumed]]; consumed += 1; }
    } else if (token === "oneOf" || token === "anyOf") {
      const kind = node[ROW];
      const branch = Number(tokens[index + 1]);
      if (kind !== undefined) {

        if (instance === null || typeof instance !== "object" || Array.isArray(instance)) return {};
        const selected = rowVariant(kind, instance);
        const rowPath = pathOf(consumed === 0 ? "" : `/${at.slice(0, consumed).join("/")}`);
        if (selected === null) return { row: rowPath };
        if (Number.isInteger(branch) && branch !== selected) return { drop: true };

        if (!Number.isInteger(branch)) return { drop: true };
      }
      if (!Number.isInteger(branch)) break;
      node = node[token][branch];
      index += 1;
    } else break;
  }
  return {};
}

export function validateRecordAuthoringChanges(kind, context, changes) {
  const schema = recordAuthoringChangeSchema(kind, context);
  const validate = validatorFor(schema);
  if (validate(changes)) return Object.freeze([]);

  const byPath = new Map();
  const misplaced = kind === "work_item" && context !== RECORD_AUTHORING_SLICE_CONTEXT
    ? WORK_ITEM_SLICE_CONTRACT_MEMBERS : [];
  for (const error of validate.errors) {

    if (error.keyword === "additionalProperties" && error.instancePath === "" &&
        misplaced.includes(error.params.additionalProperty)) {
      const [placement] = sliceContractMemberPlacementDiagnostics([error.params.additionalProperty], context);
      byPath.set(placement.path, placement);
      continue;
    }
    const classified = classifyError(schema, changes, error);
    if (classified.drop) continue;
    if (classified.row !== undefined) {
      byPath.set(classified.row, { message: "must carry exactly one of key (a new row) or id (an existing row)",
        constraint: { keyword: "oneOf", members: ["key", "id"] } });
      continue;
    }
    const unknown = error.keyword === "additionalProperties";
    const member = unknown ? error.params.additionalProperty
      : error.keyword === "required" ? error.params.missingProperty : null;
    const path = `${pathOf(error.instancePath)}${member === null ? "" : `.${member}`}`;
    const message = unknown ? "is not an accepted member" : error.message;
    if (!byPath.has(path) || unknown) byPath.set(path, { message,
      constraint: { keyword: error.keyword, ...error.params } });
  }

  if (kind === "work_item" && Array.isArray(changes?.ready_slices)) {
    changes.ready_slices.forEach((row, index) => {
      if (rowVariant("key_or_id", row) !== 0) return;
      for (const member of missingWorkRecordReadySliceCreationFields(row)) {
        const path = `changes.ready_slices[${index}].${member}`;
        if (!byPath.has(path)) byPath.set(path, { message: `must have required property '${member}'`,
          constraint: { keyword: "required", missingProperty: member } });
      }
      for (const { code, severity, message, path: member } of emptyWorkRecordReadySliceCreationFields(row)) {
        const path = `changes.ready_slices[${index}].${member}`;
        if (!byPath.has(path)) byPath.set(path, Object.freeze({ code, severity, path,
          message: `changes.ready_slices[${index}].${message}` }));
      }
    });
  }
  return Object.freeze([...byPath].map(([path, entry]) => entry.code !== undefined ? entry : Object.freeze({
    code: "record_authoring_change_invalid", severity: "error", path, message: `${path} ${entry.message}`,
    constraint: entry.constraint })));
}
