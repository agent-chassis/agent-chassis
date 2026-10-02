import { WORK_RECORD_FRESHNESS_PATTERN } from "@agent-chassis/wiki-core/src/lib/work-record-schema-constants.mjs";
import { Buffer } from "node:buffer";
import {
  WORK_RECORD_EDIT_FIELD_REGISTRY,
  parseWorkRecordUnitAddress
} from "@agent-chassis/wiki-core/src/lib/work-record-contract-edit.mjs";
import { WORK_RECORD_EDIT_SPECIALIZED_FIELD_OWNERS } from
  "@agent-chassis/wiki-core/src/lib/work-record-contract-edit-operations.mjs";
import { RECORD_ID_PATTERN } from
  "@agent-chassis/wiki-core/src/lib/work-record-contract-edit-shared.mjs";
import { SLICE_ID_PATTERN } from
  "@agent-chassis/wiki-core/src/lib/work-record-schema-constants.mjs";
import { declareRequestConstraints } from "./zod-request-constraint-declarations.mjs";
import { projectZodRequestContract } from "./zod-request-contract-projection.mjs";
import {
  readyAcceptanceCriterion,
  readyValidationEntry,
  workRecordEntryContent
} from "./work-record-write-tool-schema-vocabulary.mjs";

const REGISTRY_ITEM_SHAPE_SCHEMAS = Object.freeze({
  acceptance_criterion: readyAcceptanceCriterion,
  acceptance_note: readyValidationEntry
});

export const WORK_RECORD_EDIT_INPUT_FACTS_SCHEMA_VERSION =
  "work-record-edit-input-facts.v1";
export const WORK_RECORD_EDIT_INPUT_FAILURE_SCHEMA_VERSION =
  "work-record-edit-input-validation-failure.v1";

const COMMON_KEYS = Object.freeze(["repo", "unit", "expected_source_digest", "verbose"]);
const EDIT_KEYS = Object.freeze(["kind", "field", "action", "value", "text", "index"]);
const ALL_KEYS = new Set([...COMMON_KEYS, ...EDIT_KEYS]);

function unanchor(pattern) {
  return pattern.source.replace(/^\^/u, "").replace(/\$$/u, "");
}

const EDITOR_UNIT_PATTERN = new RegExp(
  `^\\s*(?:${unanchor(RECORD_ID_PATTERN)})(?:#(?:${unanchor(SLICE_ID_PATTERN)}))?\\s*$`,
  "u"
);

export class WorkRecordEditInputContractCoverageError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "WorkRecordEditInputContractCoverageError";
    this.code = code;
    Object.assign(this, details);
  }
}

function coverageFailure(code, entry, detail) {
  const entryId = entry?.id ?? "<unknown>";
  throw new WorkRecordEditInputContractCoverageError(
    code,
    `work-record edit input contract cannot cover registry entry ${entryId}: ${detail}`,
    { entry_id: entryId, field: entry?.field ?? null, kind: entry?.kind ?? null }
  );
}

export function createWorkRecordEditCommonShape(z) {
  return {
    repo: z.string().optional(),
    unit: z.string().regex(EDITOR_UNIT_PATTERN),
    expected_source_digest: z.string().regex(WORK_RECORD_FRESHNESS_PATTERN).optional(),
    verbose: z.boolean().optional()
  };
}

export function createWorkRecordTaskIndexSchema(z) {
  return z.union([
    z.number().int().nonnegative(),
    z.string().regex(/^(0|[1-9][0-9]*)$/)
  ]);
}

function stringSchemaForRegistry(z, schema, entry, action) {
  if (schema?.type !== "string") {
    coverageFailure(
      "unsupported_registry_value_schema",
      entry,
      `${action} requires a string value schema`
    );
  }
  if (schema.entry_content === true) return workRecordEntryContent(z);
  if (Array.isArray(schema.enum)) return z.enum(schema.enum);
  let value = z.string();
  if (schema.trim) value = value.trim();
  if (schema.min_length !== undefined) value = value.min(schema.min_length);
  if (schema.max_utf8_bytes !== undefined) {
    const maximum = schema.max_utf8_bytes;
    const statement = `Value must be at most ${maximum} UTF-8 bytes.`;
    value = declareRequestConstraints(
      value.refine((item) => Buffer.byteLength(item, "utf8") <= maximum, statement),
      [{
        constraint: "max_utf8_bytes",
        maximum,
        encoding: "utf8",
        statement
      }]
    );
  }
  return value;
}

function listValueSchema(z, entry, action) {
  const schema = entry.value_schema;
  if (schema?.type !== "array" || schema.items === undefined) {
    coverageFailure(
      "unsupported_registry_value_schema",
      entry,
      `${action} requires an array item schema`
    );
  }
  let item;
  if (schema.items.type === "string") item = z.string();
  else if (typeof schema.items.shape === "string") {
    const factory = REGISTRY_ITEM_SHAPE_SCHEMAS[schema.items.shape];
    if (factory === undefined) {
      coverageFailure("unsupported_registry_value_schema", entry,
        `${action} names unsupported item shape ${schema.items.shape}`);
    }
    item = factory(z);
  } else if (schema.items.type === "object" && schema.items.additional_properties === false &&
      Array.isArray(schema.items.required) && schema.items.required.length === 1 &&
      schema.items.required[0] === "ref" && schema.items.properties?.ref?.type === "string") {
    item = z.object({ ref: z.string().min(1) }).strict();
  } else {
    coverageFailure("unsupported_registry_value_schema", entry,
      `${action} has an unsupported array item schema`);
  }
  if (action === "replace") {
    let result = z.array(item);
    if (Number.isSafeInteger(schema.max_items)) result = result.max(schema.max_items);
    return result;
  }
  if (action === "append") return item;
  coverageFailure("unsupported_registry_action", entry, `unsupported list action ${action}`);
}

function taskShape(z, entry, action, selector) {
  const shape = {};
  if (action === "append_todo") {
    if (selector !== null) {
      coverageFailure("unsupported_registry_selector", entry, `${action} accepts no selector`);
    }
    shape.value = stringSchemaForRegistry(z, entry.value_schema[action], entry, action);
    return shape;
  }
  if (action !== "mark_done" && action !== "replace_text") {
    coverageFailure("unsupported_registry_action", entry, `unsupported task action ${action}`);
  }
  if (selector !== "text" && selector !== "index") {
    coverageFailure("unsupported_registry_selector", entry, `${action} requires text or index`);
  }
  shape[selector] = selector === "index"
    ? createWorkRecordTaskIndexSchema(z)
    : z.string().trim().min(1);
  if (action === "replace_text") {
    shape.value = stringSchemaForRegistry(z, entry.value_schema[action], entry, action);
  }
  return shape;
}

function editVariant(z, entry, action, selector = null) {
  const shape = {
    ...createWorkRecordEditCommonShape(z),
    kind: z.literal(entry.kind),
    field: z.literal(entry.field),
    action: z.literal(action)
  };
  if (entry.kind === "scalar") {
    if (action !== "replace") {
      coverageFailure("unsupported_registry_action", entry, `unsupported scalar action ${action}`);
    }
    shape.value = stringSchemaForRegistry(z, entry.value_schema, entry, action);
  } else if (entry.kind === "list") {
    shape.value = listValueSchema(z, entry, action);
  } else if (entry.kind === "task") {
    Object.assign(shape, taskShape(z, entry, action, selector));
  } else {
    coverageFailure("unsupported_registry_kind", entry, `unsupported kind ${entry.kind}`);
  }
  return z.object(shape).strict();
}

function selectorsFor(entry, action) {
  if (entry.kind !== "task" || action === "append_todo") return [null];
  if (action === "mark_done" || action === "replace_text") return ["text", "index"];
  coverageFailure("unsupported_registry_action", entry, `unsupported task action ${action}`);
}

function semanticRefusalVariant(z, field) {
  return z.object({
    ...createWorkRecordEditCommonShape(z),
    kind: z.literal("scalar"),
    field: z.literal(field),
    action: z.literal("replace"),
    value: z.string()
  }).strict();
}

function projectOrFail(schema, identity) {
  const projected = projectZodRequestContract(schema);
  if (projected !== null) return projected;
  throw new WorkRecordEditInputContractCoverageError(
    "request_contract_projection_unavailable",
    `work-record edit request contract projection is unavailable for ${identity}`,
    { identity }
  );
}

function createSchemaParts(z, {
  registry = WORK_RECORD_EDIT_FIELD_REGISTRY,
  specializedOwners = WORK_RECORD_EDIT_SPECIALIZED_FIELD_OWNERS
} = {}) {
  const variants = [];
  const byIdentity = new Map();
  for (const entry of registry.filter(({ facade }) => facade)) {
    if (!Array.isArray(entry.actions) || entry.actions.length === 0) {
      coverageFailure("missing_registry_actions", entry, "actions must be a non-empty array");
    }
    for (const action of entry.actions) {
      for (const selector of selectorsFor(entry, action)) {
        const identity = `${entry.kind}:${entry.field}:${action}:${selector ?? "none"}`;
        const existing = byIdentity.get(identity);
        if (existing !== undefined) {
          existing.registry_entry_ids.push(entry.id);
          continue;
        }
        const schema = editVariant(z, entry, action, selector);
        const fact = {
          identity,
          registry_entry_ids: [entry.id],
          field: entry.field,
          kind: entry.kind,
          action,
          selector
        };
        byIdentity.set(identity, fact);
        variants.push({ schema, fact });
      }
    }
  }

  const refusalVariants = [];
  for (const { prefixes, owner } of specializedOwners) {
    for (const field of prefixes) {
      const schema = semanticRefusalVariant(z, field);
      refusalVariants.push({
        schema,
        fact: {
          field,
          owner
        }
      });
    }
  }
  const schemas = [...variants, ...refusalVariants].map(({ schema }) => schema);
  if (schemas.length < 2) {
    throw new WorkRecordEditInputContractCoverageError(
      "insufficient_request_variants",
      "work-record edit input contract requires at least two request variants"
    );
  }
  const schema = z.union(schemas);
  return { schema, variants, refusalVariants };
}

function requestFactsForSchemaParts(z, { schema, variants, refusalVariants }) {
  const commonSchema = z.object(createWorkRecordEditCommonShape(z)).strict();
  return {
    schema_version: WORK_RECORD_EDIT_INPUT_FACTS_SCHEMA_VERSION,
    common_request_contract: projectOrFail(commonSchema, "common editor request keys"),
    variants: variants.map(({ schema: variantSchema, fact }) => ({
      ...fact,
      request_contract: projectOrFail(variantSchema, fact.identity)
    })),
    semantic_refusals: refusalVariants.map(({ schema: refusalSchema, fact }) => ({
      ...fact,
      request_contract: projectOrFail(refusalSchema, `semantic-refusal:${fact.field}`)
    })),
    complete_request_contract: projectOrFail(schema, "complete editor request"),
    unprojected_constraints: [
      {
        path: "$.repo",
        reason: "post_schema_repository_resolution",
        owner: "resolveWorkspaceRepo",
        statement: "When supplied, repo must name a configured repository alias."
      },
      {
        path: "$.unit",
        reason: "post_schema_unit_resolution",
        owner: "editWorkRecordByUnit",
        statement: "unit must resolve to an existing canonical WK record or WK#slice target."
      },
      {
        path: "$.expected_source_digest",
        reason: "post_schema_validation",
        owner: "resolveExpectedSourceDigest",
        statement:
          "When supplied, expected_source_digest must be the 16 lowercase hexadecimal " +
          "source_digest a read returned, and must match the current canonical record."
      },
      {
        path: "$.value",
        reason: "post_resolution_destination_validation",
        owner: "editWorkRecordByUnit",
        statement:
          "For enrolled summary, notes, and task-text edits, the closed {text}, {ref}, or " +
          "flat nonempty {parts} value resolves under the writer lock; destination trim, " +
          "nonempty, UTF-8 byte, and record limits are then enforced on the exact result."
      },
      {
        path: "$",
        reason: "post_schema_registry_and_record_validation",
        owner: "editWorkRecordByUnit",
        statement:
          "Field applicability, semantic ownership, record-source CAS, and complete " +
          "prospective-record validation run after structural request parsing."
      }
    ]
  };
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function scopeForUnit(unit) {
  const parsed = parseWorkRecordUnitAddress(unit);
  if (!parsed.ok) return null;
  return parsed.unit.slice_id === null ? "record" : "slice";
}

function diagnostic(code, path, message, expected = undefined) {
  return {
    code,
    path,
    severity: "error",
    authority_limb: "mechanical_failure",
    message,
    ...(expected === undefined ? {} : { expected })
  };
}

function pathText(path) {
  if (!Array.isArray(path) || path.length === 0) return "$";
  return path.reduce((result, part) => Number.isInteger(part)
    ? `${result}[${part}]`
    : `${result}.${part}`, "$" );
}

function compareDiagnostics(left, right) {
  return left.path.localeCompare(right.path) || left.code.localeCompare(right.code);
}

function existingPrefixLength(input, issuePath) {
  let value = input;
  let length = 0;
  for (const segment of issuePath ?? []) {
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, segment)) break;
    value = value[segment];
    length += 1;
  }
  return length;
}

function relevantLeafIssues(issue, input) {
  if (issue?.code !== "invalid_union" || !Array.isArray(issue.unionErrors)) return [issue];
  const scored = issue.unionErrors.map((error) => ({
    error,
    score: Math.max(issue.path?.length ?? 0, ...error.issues.map((candidate) =>
      existingPrefixLength(input, candidate.path)))
  }));
  const best = Math.max(...scored.map(({ score }) => score));
  if (best <= (issue.path?.length ?? 0)) return [issue];
  const selected = scored.find(({ score }) => score === best);
  return selected.error.issues.flatMap((candidate) => relevantLeafIssues(candidate, input));
}

function selectedRegistryEntries(registry, field) {
  return registry.filter((entry) => entry.facade && entry.field === field);
}

function commonDiagnostics(args, unionErrors) {
  const candidates = unionErrors.flatMap((error) => error?.issues ?? []);
  const diagnostics = [];
  for (const key of COMMON_KEYS) {
    const issue = candidates.find((entry) => entry.path?.length === 1 && entry.path[0] === key);
    if (issue !== undefined) {
      diagnostics.push(diagnostic(
        key === "unit" ? "invalid_unit_address" :
          key === "expected_source_digest" ? "invalid_expected_source_digest" :
            "invalid_edit_request",
        `$.${key}`,
        issue.message
      ));
    }
  }
  const unknown = new Set();
  for (const issue of candidates.filter(({ code, path }) =>
    code === "unrecognized_keys" && path?.length === 0)) {
    for (const key of issue.keys ?? []) if (!ALL_KEYS.has(key)) unknown.add(key);
  }
  for (const key of [...unknown].sort()) {
    diagnostics.push(diagnostic(
      "unbounded_edit_request",
      `$.${key}`,
      `${key} is not accepted by the bounded editor request`
    ));
  }
  return diagnostics.sort(compareDiagnostics);
}

function selectedValueDiagnostics({ args, entry, selectedIssues }) {
  const diagnostics = [];
  const valueCode = entry.kind === "task" ? "invalid_task_value" : "invalid_edit_value";
  const selectedValueSchema = entry.kind === "task"
    ? entry.value_schema?.[args.action]
    : entry.value_schema;
  for (const issue of selectedIssues.flatMap((candidate) => relevantLeafIssues(candidate, args))) {
    const root = issue.path?.[0];
    if (issue.code === "unrecognized_keys" && issue.path?.length === 0) {
      for (const key of issue.keys ?? []) {
        if (!ALL_KEYS.has(key) || !Object.hasOwn(args, key)) continue;
        diagnostics.push(diagnostic(
          "unbounded_edit_request",
          `$.${key}`,
          `${key} is not accepted by the selected editor variant`
        ));
      }
    } else if (root === "value") {
      if (selectedValueSchema?.entry_content === true) {
        diagnostics.push(diagnostic(
          valueCode,
          pathText(issue.path),
          "value must be exactly {text:string}, {ref:nonempty-string}, or " +
            "{parts:[nonempty flat text/ref leaves]}; minimally use {text:\"replacement\"}",
          ["{text:string}", "{ref:nonempty-string}", "{parts:[text-or-ref,...]}"]
        ));
      } else {
        diagnostics.push(diagnostic(valueCode, pathText(issue.path), issue.message));
      }
    } else if (root === "index") {
      diagnostics.push(diagnostic("invalid_task_index", pathText(issue.path), issue.message));
    } else if (root === "text") {
      diagnostics.push(diagnostic("invalid_task_selector", pathText(issue.path), issue.message));
    }
  }
  if (entry.kind === "task" && ["mark_done", "replace_text"].includes(args.action)) {
    const hasText = Object.hasOwn(args, "text");
    const hasIndex = Object.hasOwn(args, "index");
    if (hasText && hasIndex) {
      diagnostics.push(diagnostic(
        "ambiguous_task_selector", "$", "supply exactly one task selector: text or index",
        ["text", "index"]
      ));
    } else if (!hasText && !hasIndex) {
      diagnostics.push(diagnostic(
        "missing_task_selector", "$", "supply exactly one task selector: text or index",
        ["text", "index"]
      ));
    }
  }
  if (entry.kind === "task" && args.action === "append_todo" &&
      (Object.hasOwn(args, "text") || Object.hasOwn(args, "index"))) {
    diagnostics.push(diagnostic(
      "ambiguous_task_selector", "$", "append_todo accepts no task selector", []
    ));
  }
  return diagnostics
    .filter((entryValue, index, all) => all.findIndex((candidate) =>
      candidate.code === entryValue.code && candidate.path === entryValue.path &&
      candidate.message === entryValue.message) === index)
    .sort(compareDiagnostics);
}

function rawUnionErrors(validationError) {
  const union = validationError?.issues?.find(({ code }) => code === "invalid_union");
  return Array.isArray(union?.unionErrors) ? union.unionErrors : [];
}

export function projectWorkRecordEditInputFailure({
  args,
  validationError,
  contract,
  registry = WORK_RECORD_EDIT_FIELD_REGISTRY,
  specializedOwners = WORK_RECORD_EDIT_SPECIALIZED_FIELD_OWNERS
}) {
  const input = args !== null && typeof args === "object" && !Array.isArray(args) ? args : {};
  const unionErrors = rawUnionErrors(validationError);
  const common = commonDiagnostics(input, unionErrors.length > 0
    ? unionErrors
    : [{ issues: validationError?.issues ?? [] }]);
  const selected = [];
  const named = selectedRegistryEntries(registry, input.field);
  const scope = scopeForUnit(input.unit);
  const specialized = typeof input.field === "string"
    ? specializedOwners.find(({ prefixes }) => prefixes.some((prefix) =>
      input.field === prefix || input.field.startsWith(`${prefix}.`)))
    : null;
  const entry = named.find((candidate) => scope !== null && candidate.applicability.includes(scope)) ??
    named[0] ?? null;

  if (entry === null) {
    selected.push(diagnostic(
      specialized ? "field_owner_mismatch" : "unsupported_edit_field",
      "$.field",
      specialized
        ? `${input.field} is not generally editable; use ${specialized.owner}`
        : "field must name one exact ordinary editable field"
    ));
  } else {
    if (scope !== null && !entry.applicability.includes(scope)) {
      selected.push(diagnostic(
        "invalid_edit_applicability", "$.field",
        `${entry.field} is not editable on ${scope} targets; the target is chosen by unit ` +
        "(WK-#### for record, WK-#####SLICE-### for slice)", entry.applicability
      ));
    }

    if (input.kind !== entry.kind) {
      selected.push(diagnostic(
        "edit_kind_mismatch", "$.kind",
        `${entry.field} is a ${entry.kind} field, not ${String(input.kind)}; kind is the edit ` +
        "shape (scalar|list|task), while record-or-slice is the target named by unit",
        [entry.kind]
      ));
    }
    if (!entry.actions.includes(input.action)) {
      selected.push(diagnostic(
        entry.kind === "task" ? "unsupported_task_action" : "unsupported_edit_action",
        "$.action", `${entry.field} supports only: ${entry.actions.join(", ")}`,
        entry.actions
      ));
    } else {
      const matchingFacts = contract.projectionFacts.variants.filter((fact) =>
        fact.field === entry.field && fact.kind === entry.kind && fact.action === input.action &&
        (fact.selector === null || Object.hasOwn(input, fact.selector)));
      const selectedIssues = matchingFacts.flatMap(({ union_index: index }) =>
        unionErrors[index]?.issues ?? []);
      selected.push(...selectedValueDiagnostics({ args: input, entry, selectedIssues }));
    }
  }

  if (selected.length === 0 && common.length === 0) {
    selected.push(diagnostic(
      "invalid_edit_request", "$", "request does not satisfy the selected editor variant"
    ));
  }
  return {
    diagnostics: [...common, ...selected.sort(compareDiagnostics)],
    field: typeof input.field === "string" && (entry !== null || specialized !== undefined)
      ? input.field
      : null,
    scope,
    raw_failure: {
      schema_version: WORK_RECORD_EDIT_INPUT_FAILURE_SCHEMA_VERSION,
      tool: "workspace_work_record_edit",
      accepted: false,
      issues: clone(validationError?.issues ?? [])
    }
  };
}

export function createWorkRecordEditInputContract(z, options = {}) {
  const parts = createSchemaParts(z, options);
  const requestFacts = requestFactsForSchemaParts(z, parts);
  return Object.freeze({
    schema: parts.schema,
    requestFacts,
    projectionFacts: Object.freeze({
      variants: Object.freeze(parts.variants.map(({ fact }, union_index) =>
        Object.freeze({ ...fact, union_index }))),
      semantic_refusals: Object.freeze(parts.refusalVariants.map(({ fact }, offset) =>
        Object.freeze({ ...fact, union_index: parts.variants.length + offset })))
    })
  });
}

export function createWorkRecordEditInputSchema(z, options = {}) {
  return createWorkRecordEditInputContract(z, options).schema;
}

export function createWorkRecordEditInputRequestFacts(z, options = {}) {
  return createWorkRecordEditInputContract(z, options).requestFacts;
}
