import {
  WORK_RECORD_EDIT_FIELD_REGISTRY,
  WORK_RECORD_EDIT_SPECIALIZED_FIELD_OWNERS
} from "./work-record-contract-edit-operations.mjs";
import { WORK_RECORD_CONTENT_MAX_PARTS } from "./work-record-entry-schema.mjs";
import { isCanonicalWorkRecordBaseBranch } from "./work-record-base-branch.mjs";

export const WORK_RECORD_EDIT_INPUT_GUIDANCE_SCHEMA_VERSION =
  "work-record-edit-input-guidance.v1";
const REQUEST_FACTS_SCHEMA_VERSION = "work-record-edit-input-facts.v1";
const SCOPES = Object.freeze(["record", "slice"]);

export const WORK_RECORD_EDIT_FIELD_NAVIGATION =
  "kind is the edit shape (scalar|list|task); applicability is the edit target (record|slice) " +
  "named by unit. Select input_contract {kind:\"field\",field,scope} for one field's complete " +
  "value constraints, request shapes and schema-valid example.";

export class WorkRecordEditInputGuidanceCoverageError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "WorkRecordEditInputGuidanceCoverageError";
    this.code = code;
    Object.assign(this, details);
  }
}

function failCoverage(code, message, details = {}) {
  throw new WorkRecordEditInputGuidanceCoverageError(code, message, details);
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function facadeEntries(registry) {
  if (!Array.isArray(registry)) {
    failCoverage("invalid_registry", "work-record edit guidance requires a registry array");
  }
  return registry.filter(({ facade }) => facade);
}

function validateRequestFacts(requestFacts) {
  if (requestFacts?.schema_version !== REQUEST_FACTS_SCHEMA_VERSION) {
    failCoverage(
      "unsupported_request_facts_version",
      `work-record edit guidance requires ${REQUEST_FACTS_SCHEMA_VERSION}`,
      { received: requestFacts?.schema_version ?? null }
    );
  }
  if (!Array.isArray(requestFacts.variants) ||
      !Array.isArray(requestFacts.semantic_refusals) ||
      requestFacts.common_request_contract?.contract === undefined ||
      requestFacts.complete_request_contract?.contract === undefined ||
      !Array.isArray(requestFacts.unprojected_constraints)) {
    failCoverage(
      "incomplete_request_facts",
      "work-record edit guidance requires common, variant, refusal, complete-contract, and unprojected request facts"
    );
  }
  const identities = requestFacts.variants.map(({ identity }) => identity);
  if (identities.some((identity) => typeof identity !== "string") ||
      new Set(identities).size !== identities.length) {
    failCoverage(
      "invalid_request_variant_identities",
      "schema-owned request variant identities must be present and unique"
    );
  }
}

function validateSemanticRefusalFacts(specializedOwners, requestFacts) {
  const expected = specializedOwners.flatMap(({ prefixes, owner }) =>
    prefixes.map((field) => ({ field, owner })));
  for (const candidate of expected) {
    const matches = requestFacts.semantic_refusals.filter(({ field }) =>
      field === candidate.field);
    if (matches.length !== 1 || matches[0].owner !== candidate.owner ||
        matches[0].request_contract?.contract === undefined) {
      failCoverage(
        "missing_semantic_refusal_variant",
        `guidance has no exact schema-owned semantic refusal for ${candidate.field}`,
        { field: candidate.field, owner: candidate.owner }
      );
    }
  }
  const expectedFields = new Set(expected.map(({ field }) => field));
  const unexpected = requestFacts.semantic_refusals.find(({ field }) =>
    !expectedFields.has(field));
  if (unexpected !== undefined) {
    failCoverage(
      "unexpected_semantic_refusal_variant",
      `guidance request facts contain an unowned semantic refusal for ${unexpected.field}`,
      { field: unexpected.field }
    );
  }
}

function valueConstraints(entry, action) {
  const project = (schema) => {
    if (schema?.entry_content !== true) return clone(schema);
    const destination = clone(schema);
    delete destination.entry_content;
    return {
      type: "entry_content",
      alternatives: ["text", "ref", "parts"],
      max_parts: WORK_RECORD_CONTENT_MAX_PARTS,
      destination
    };
  };
  if (entry.kind === "scalar") return project(entry.value_schema);
  if (entry.kind === "list") {
    if (entry.value_schema?.type !== "array" || entry.value_schema.items === undefined) {
      failCoverage(
        "unsupported_registry_value_schema",
        `guidance cannot project ${entry.id}: list value_schema must declare items`,
        { entry_id: entry.id, action }
      );
    }
    if (action === "replace") return clone(entry.value_schema);
    if (action === "append") return clone(entry.value_schema.items);
  }
  if (entry.kind === "task" && Object.hasOwn(entry.value_schema ?? {}, action)) {
    return project(entry.value_schema[action]);
  }
  failCoverage(
    "unsupported_registry_action_shape",
    `guidance cannot project ${entry.id} action ${action}`,
    { entry_id: entry.id, action, kind: entry.kind }
  );
}

const FORMAT_EXAMPLES = Object.freeze({
  local_branch_name: Object.freeze({ value: "feature/example-base",
    valid: isCanonicalWorkRecordBaseBranch })
});

function exampleString(schema, field) {
  if (Array.isArray(schema?.enum) && schema.enum.length > 0) return schema.enum[0];
  if (typeof schema?.format === "string") {
    const example = FORMAT_EXAMPLES[schema.format];
    if (example === undefined || !example.valid(example.value)) {
      failCoverage(
        "unsupported_registry_value_format",
        `guidance has no valid example for ${field} format ${schema.format}`,
        { field, format: schema.format }
      );
    }
    return example.value;
  }
  if (field === "sections.agent_notes") return "Complete replacement notes text";
  return "Example value";
}

function exampleValue(schema, field, fallback = null) {
  const enrolled = schema?.type === "entry_content";
  const text = fallback ?? exampleString(enrolled ? schema.destination : schema, field);
  return enrolled ? { text } : text;
}

function exampleFor(entry, fact, scope) {
  const example = {
    unit: scope === "slice" ? "WK-0000#SLICE-001" : "WK-0000",
    kind: entry.kind,
    field: entry.field,
    action: fact.action
  };
  const constraints = valueConstraints(entry, fact.action);
  if (fact.selector === "text") example.text = "Existing task text";
  if (fact.selector === "index") example.index = 0;
  if (entry.kind === "scalar") {
    example.value = exampleValue(constraints, entry.field);
  } else if (entry.kind === "list") {
    const item = (constraints?.items ?? constraints)?.type === "object"
      ? { ref: "wkentry.v1.<opaque-returned-reference>" }
      : "Example item";
    example.value = fact.action === "replace" ? [item] : item;
  } else if (fact.action === "append_todo" || fact.action === "replace_text") {
    example.value = exampleValue(constraints, entry.field, "Example task text");
  }
  return example;
}

function factsForEntry(entry, requestFacts) {
  const facts = requestFacts.variants.filter((fact) =>
    Array.isArray(fact.registry_entry_ids) && fact.registry_entry_ids.includes(entry.id));
  for (const action of entry.actions) {
    if (!facts.some((fact) => fact.action === action)) {
      failCoverage(
        "missing_request_variant",
        `guidance has no schema-owned request variant for ${entry.id} action ${action}`,
        { entry_id: entry.id, action }
      );
    }
  }
  const unexpected = facts.find((fact) =>
    fact.field !== entry.field || fact.kind !== entry.kind || !entry.actions.includes(fact.action) ||
    fact.request_contract?.contract === undefined);
  if (unexpected !== undefined) {
    failCoverage(
      "inconsistent_request_variant",
      `guidance request facts disagree with registry entry ${entry.id}`,
      { entry_id: entry.id, variant_identity: unexpected.identity ?? null }
    );
  }
  return facts;
}

export const WORK_RECORD_EDIT_REQUEST_CONTRACT_EXTENDS = "common_request.contract";
export const WORK_RECORD_EDIT_SHARED_CONTRACT_RULE =
  "A request_contract naming extends omits only properties byte-identical to " +
  "common_request.contract.properties, and a constraint carries its statement in " +
  "constraint_definitions under the same identity. Merge both in; every other member, " +
  "including required and additionalProperties, is already complete.";

function collectConstraintStatements(value, seen) {
  if (Array.isArray(value)) {
    for (const member of value) collectConstraintStatements(member, seen);
    return seen;
  }
  if (value === null || typeof value !== "object") return seen;
  if (typeof value.constraint === "string" && typeof value.statement === "string") {
    if (!seen.has(value.constraint)) seen.set(value.constraint, new Set());
    seen.get(value.constraint).add(value.statement);
  }
  for (const member of Object.values(value)) collectConstraintStatements(member, seen);
  return seen;
}

function shareConstraintStatements(value, definitions) {
  if (Array.isArray(value)) {
    for (const member of value) shareConstraintStatements(member, definitions);
    return value;
  }
  if (value === null || typeof value !== "object") return value;
  if (typeof value.constraint === "string" &&
      definitions[value.constraint] === value.statement) {
    delete value.statement;
  }
  for (const member of Object.values(value)) shareConstraintStatements(member, definitions);
  return value;
}

export function sharedConstraintDefinitions(contracts) {
  const seen = collectConstraintStatements(contracts, new Map());
  const definitions = {};
  for (const [constraint, statements] of seen) {
    if (statements.size === 1) definitions[constraint] = [...statements][0];
  }
  return definitions;
}

function projectRequestContract(requestContract, commonProperties, definitions) {
  const projected = shareConstraintStatements(clone(requestContract), definitions);
  const properties = projected?.contract?.properties;
  if (commonProperties === undefined || properties === undefined) return projected;
  let elided = false;
  for (const [name, schema] of Object.entries(commonProperties)) {
    if (Object.hasOwn(properties, name) && equal(properties[name], schema)) {
      delete properties[name];
      elided = true;
    }
  }
  return elided
    ? { ...projected, extends: WORK_RECORD_EDIT_REQUEST_CONTRACT_EXTENDS }
    : projected;
}

function actionGuidance(entry, facts, scope, commonProperties, definitions) {
  return entry.actions.map((action) => {
    const actionFacts = facts.filter((fact) => fact.action === action);
    return {
      action,
      value_constraints: valueConstraints(entry, action),
      request_shapes: actionFacts.map((fact) => ({
        ...(fact.selector === null ? {} : { selector: fact.selector }),
        selector_rule: fact.selector === null
          ? "This request shape accepts no selector."
          : "Supply exactly this selector; text and index are mutually exclusive.",
        ...(fact.selector === "index" ? { index_base: 0 } : {}),
        request_contract: projectRequestContract(
          fact.request_contract,
          commonProperties,
          definitions
        ),
        example: exampleFor(entry, fact, scope)
      }))
    };
  });
}

function entriesByField(entries, requestFacts) {
  const grouped = new Map();
  const entryIds = new Set(entries.map(({ id }) => id));
  const orphan = requestFacts.variants.find(({ registry_entry_ids: ids }) =>
    !Array.isArray(ids) || ids.length === 0 || ids.some((id) => !entryIds.has(id)));
  if (orphan !== undefined) {
    failCoverage(
      "orphan_request_variant",
      `guidance request variant ${orphan.identity ?? "<unknown>"} has no facade registry owner`,
      { variant_identity: orphan.identity ?? null }
    );
  }
  for (const entry of entries) {
    for (const scope of entry.applicability ?? []) {
      if (!SCOPES.includes(scope)) {
        failCoverage(
          "unsupported_registry_scope",
          `guidance cannot project ${entry.id} applicability ${scope}`,
          { entry_id: entry.id, scope }
        );
      }
    }
    const facts = factsForEntry(entry, requestFacts);
    const existing = grouped.get(entry.field);
    if (existing !== undefined && existing.kind !== entry.kind) {
      failCoverage(
        "ambiguous_registry_field_kind",
        `guidance found multiple kinds for field ${entry.field}`,
        { field: entry.field, kinds: [existing.kind, entry.kind] }
      );
    }
    if (existing === undefined) {
      grouped.set(entry.field, {
        field: entry.field,
        kind: entry.kind,
        registry_entries: [{ entry, facts }]
      });
    } else {
      existing.registry_entries.push({ entry, facts });
    }
  }
  return grouped;
}

function mergeInventoryField(group) {
  const applicability = [];
  const actions = new Map();
  for (const { entry, facts } of group.registry_entries) {
    for (const scope of entry.applicability) {
      if (!applicability.includes(scope)) applicability.push(scope);
    }
    for (const action of entry.actions) {
      const candidate = {
        action,
        value_constraints: valueConstraints(entry, action),
        selectors: facts.filter((fact) => fact.action === action)
          .map(({ selector }) => selector).filter((selector) => selector !== null)
      };
      const existing = actions.get(action);
      if (existing !== undefined && !equal(existing, candidate)) {
        failCoverage(
          "inconsistent_registry_scope_shape",
          `guidance found different ${action} shapes for field ${entry.field}`,
          { field: entry.field, action }
        );
      }
      actions.set(action, candidate);
    }
  }
  const selectors = {};
  for (const [action, candidate] of actions) {
    if (candidate.selectors.length > 0) selectors[action] = [...candidate.selectors];
  }
  return {
    field: group.field,
    kind: group.kind,
    applicability,
    actions: [...actions.keys()],
    ...(Object.keys(selectors).length === 0 ? {} : { selectors })
  };
}

function semantics(requestFacts) {
  const structurallyUnprojected = requestFacts.complete_request_contract.unprojected ?? [];
  const unprojected = [
    ...clone(structurallyUnprojected),
    ...clone(requestFacts.unprojected_constraints)
  ];
  return {
    replacement: {
      scalar: "replace changes the whole selected scalar value",
      list: "replace supplies the complete replacement array; omitted entries are removed",
      acceptance_criteria:
        "acceptance.criteria states the unit's own acceptance criteria; a new work record starts " +
        "with none. Author criteria that make the intended behavior or invariant explicit and " +
        "identify the verification plan or regression coverage. Each obligation then declares the " +
        "criteria it covers in workspace_controlled_contract_obligation_coverage_upsert " +
        "obligations[].acceptance_criteria",
      acceptance_validation:
        "acceptance.validation replace supplies the complete note list and append adds one note; " +
        "stored executable node_test bindings are preserved after the notes in their existing order, " +
        "are refused as input, and are authored only by controlled-contract proof operations. " +
        "Record post-run results and limitations as a NEW workspace_work_record_entry_upsert " +
        "entry: omit entry_id, pass the record's current source_digest as expected_source_digest, " +
        "and keep candidate-bound acceptance and existing entries unchanged. Changing " +
        "acceptance.validation can block candidate publication even when generation_transition " +
        "is unchanged. A new entry records evidence only and cures no other drift",
      notes:
        "sections.agent_notes replacement replaces the whole notes field; " +
        "include prior notes with {text}, a returned {ref}, or flat {parts} when they " +
        "must be preserved exactly"
    },
    no_op: "Exact replay and duplicate append are no-ops and do not churn the record digest.",
    tasks: "replace_text preserves the selected task status; append_todo creates one todo task.",
    digests: {
      mutation_record: {
        request_path: "expected_source_digest",
        source: "the selected canonical work record returned by the ordinary record read",
        checked_before_no_op: true
      },
      guidance_traversal: {
        request_path: "input_contract.expected_source_digest",
        source: "editor_input_contract",
        status: "live version-checked traversal with no cursor store or time expiry",
        accepted_as_mutation_digest: false
      }
    },
    contract_coverage: {
      completeness: unprojected.length === 0 ? "exact" : "partial",
      statement: unprojected.length === 0
        ? "Every enforced request constraint is projected."
        : "Structural schema constraints are projected; unprojected_constraints " +
          "names post-schema enforcement and any structural omissions.",
      unprojected_constraints: unprojected
    }
  };
}

function selectedSemantics(requestFacts, entry) {
  const complete = semantics(requestFacts);
  const replacement = {};
  if (entry.kind === "scalar") replacement.scalar = complete.replacement.scalar;
  if (entry.kind === "list") replacement.list = complete.replacement.list;
  if (entry.kind === "task") replacement.tasks = complete.tasks;
  if (entry.field === "sections.agent_notes") {
    replacement.notes = complete.replacement.notes;
  }

  if (entry.field === "acceptance.validation") {
    replacement.acceptance_validation = complete.replacement.acceptance_validation;
  }
  if (entry.field === "acceptance.criteria") {
    replacement.acceptance_criteria = complete.replacement.acceptance_criteria;
  }
  return {
    no_op: complete.no_op,
    shared_contract: WORK_RECORD_EDIT_SHARED_CONTRACT_RULE,
    digests: complete.digests,
    replacement,
    contract_coverage: complete.contract_coverage
  };
}

function refusal(code, message, details = {}) {
  return {
    ok: false,
    diagnostic: {
      code,
      severity: "error",
      authority_limb: "mechanical_failure",
      message,
      ...details
    }
  };
}

export function createWorkRecordEditFieldInventory({
  registry = WORK_RECORD_EDIT_FIELD_REGISTRY,
  specializedOwners = WORK_RECORD_EDIT_SPECIALIZED_FIELD_OWNERS,
  requestFacts
} = {}) {
  validateRequestFacts(requestFacts);
  validateSemanticRefusalFacts(specializedOwners, requestFacts);
  const entries = facadeEntries(registry);
  const fields = [...entriesByField(entries, requestFacts).values()].map(mergeInventoryField);
  return {
    schema_version: WORK_RECORD_EDIT_INPUT_GUIDANCE_SCHEMA_VERSION,
    source: "WORK_RECORD_EDIT_FIELD_REGISTRY facade:true",
    complete: true,
    total_count: fields.length,
    registry_entry_count: entries.length,
    common_request: clone(requestFacts.common_request_contract),
    navigation: WORK_RECORD_EDIT_FIELD_NAVIGATION,
    fields,
    semantics: semantics(requestFacts)
  };
}

export function createWorkRecordEditFieldGuidance({
  field,
  scope,
  registry = WORK_RECORD_EDIT_FIELD_REGISTRY,
  specializedOwners = WORK_RECORD_EDIT_SPECIALIZED_FIELD_OWNERS,
  requestFacts
} = {}) {
  validateRequestFacts(requestFacts);
  validateSemanticRefusalFacts(specializedOwners, requestFacts);
  if (typeof field !== "string" || field.length === 0) {
    return refusal("invalid_guidance_field", "field must be a non-empty string");
  }
  if (!SCOPES.includes(scope)) {
    return refusal(
      "invalid_guidance_scope",
      `scope must be one of: ${SCOPES.join(", ")}`,
      { field, scope: scope ?? null }
    );
  }
  const entries = facadeEntries(registry);
  const grouped = entriesByField(entries, requestFacts);
  const group = grouped.get(field);
  if (group === undefined) {
    const semantic = specializedOwners.find(({ prefixes }) => prefixes.some(
      (prefix) => field === prefix || field.startsWith(`${prefix}.`)
    ));
    return semantic === undefined
      ? refusal("unsupported_edit_field", `${field} is not an ordinary editable field`, { field })
      : refusal(
        "field_owner_mismatch",
        `${field} is not generally editable; use ${semantic.owner}`,
        { field, owner: semantic.owner }
      );
  }
  const matches = group.registry_entries.filter(({ entry }) =>
    entry.applicability.includes(scope));
  if (matches.length === 0) {
    const applicability = mergeInventoryField(group).applicability;
    return refusal(
      "invalid_edit_applicability",
      `${field} is not editable on ${scope} targets; scope names the edit target ` +
      "(record|slice), while kind names the edit shape (scalar|list|task)",
      { field, scope, applicability }
    );
  }
  if (matches.length > 1) {
    failCoverage(
      "ambiguous_registry_scope",
      `guidance found multiple ${scope} registry entries for field ${field}`,
      { field, scope, entry_ids: matches.map(({ entry }) => entry.id) }
    );
  }
  const { entry, facts } = matches[0];
  const definitions = sharedConstraintDefinitions(
    facts.map(({ request_contract: contract }) => contract)
  );
  return {
    ok: true,
    schema_version: WORK_RECORD_EDIT_INPUT_GUIDANCE_SCHEMA_VERSION,
    source: "WORK_RECORD_EDIT_FIELD_REGISTRY facade:true",
    common_request: clone(requestFacts.common_request_contract),
    field: entry.field,
    kind: entry.kind,
    scope,
    applicability: [...entry.applicability],
    registry_entry_id: entry.id,
    constraint_definitions: definitions,
    actions: actionGuidance(
      entry,
      facts,
      scope,
      requestFacts.common_request_contract?.contract?.properties,
      definitions
    ),
    semantics: selectedSemantics(requestFacts, entry)
  };
}
