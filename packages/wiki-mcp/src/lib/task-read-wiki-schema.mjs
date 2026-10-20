import { buildPublicSelectionSchema } from '@agent-chassis/wiki-core/src/operations/controlled-contract/public-selection.mjs';
import { requestSchema } from './proof-request-schema.mjs';
import { readySliceAuthoringOperations } from "@agent-chassis/wiki-core/src/lib/record-authoring-schema.mjs";
import { DEFAULT_EXCEPTION_PUBLICATION } from "@agent-chassis/wiki-core/src/lib/controlled-acceptance-publication-config.mjs";

import { FILTER_KEYS, SEARCH_FILTER_GUIDANCE } from "@agent-chassis/wiki-core/src/operations/search.mjs";
import { WIKI_DOCUMENT_READ_FIELDS, WIKI_CANONICAL_RECORD_READ_FIELDS } from
  "@agent-chassis/wiki-core/src/operations/read.mjs";
import { CONTRACT_MANIFEST_READ_FIELDS } from "@agent-chassis/wiki-core/src/lib/contract.mjs";
import { WORK_RECORD_REFERENCE_READ_FIELDS } from "@agent-chassis/wiki-core/src/lib/work-record-entry-content.mjs";
import { WORK_RECORD_EDIT_FIELD_REGISTRY } from
  "@agent-chassis/wiki-core/src/lib/work-record-contract-edit-operations.mjs";
import { MANAGED_ASSIGNMENT_READ_FIELDS } from "./managed-assignment-read.mjs";
import { PACKAGE_DOCUMENT_READ_FIELDS } from "./tool-doc-read-tools.mjs";
import { selectedResponseLocatorSchema } from "./selected-response-snapshot.mjs";
import { RECORD_AUTHORING_EXCEPTION_KINDS } from "@agent-chassis/wiki-core/src/lib/record-authoring-exception.mjs";
import { INPUT_CONTRACT_EXCEPTION_OPERATION, INPUT_CONTRACT_TOOLS } from "./task-read-wiki-input-contract.mjs";
import { recordBirthKinds } from "./task-read-wiki-record-kind.mjs";

const SUBJECT_SOURCE_KINDS = ["record", "canonical_record", "document", "manifest", "repository", "record_kind",
  "requirement_guidance"];
export const READ_WIKI_INVENTORIES = Object.freeze(["entries", "slices", "tasks", "fields", "matches", "findings"]);
export const READ_WIKI_MEMBERSHIPS = Object.freeze(["work", "integration"]);
export const READ_WIKI_CONTRACT_POPULATIONS = Object.freeze(
  ["criteria", "requirements", "verifications", "collections", "obligations", "cases", "references", "coverage"]);

export function requirementChoiceQueryIssue(select) {
  if (select === null || typeof select !== 'object' || select.contract !== 'requirements' || !Object.hasOwn(select, 'query')) return null;
  if (select.view !== 'choices') return {
    code: 'requirement_query_not_applicable', message: 'query is allowed only with contract requirements, view choices.' };
  if (typeof select.query !== 'string') return {
    code: 'requirement_query_type_invalid', message: 'The requirement query must be a string of caller-authored search words.' };
  if (select.query.trim().length === 0) return {
    code: 'requirement_query_blank', message: 'The requirement query must contain at least one non-whitespace term; a blank query is not a full inventory request.' };
  return null;
}

export const WORK_RECORD_PLANNING_READ_FIELDS = Object.freeze([
  "dispatch_intent", "expected_edit_targets", "expected_changed_line_budget", "priority", "owner"
]);

const READ_WIKI_SOURCES = Object.freeze(["subject", "search", "assignment", "reference"]);

export function describeReadWikiTool(inputSchema) {
  return 'Read requested saved meaning in bulk. Known subjects accept selections directly.';
}

function selectionSchemas(z, grants, exceptionPublication) {
  const text = z.string().min(1);
  const positive = z.number().int().positive();
  const authoredMatch = z.record(z.unknown()).refine(value => Object.keys(value).length > 0,
    'A nonempty authored pattern is required.');
  return {
    context: [z.object({ context: z.literal(true) }).strict()],
    field: [...(grants.granted('document', 'field') || grants.granted('package_document', 'field') ? [z.object({
      field: z.enum([...(grants.granted('document', 'field') ? ['body'] : []),
        ...(grants.granted('package_document', 'field') ? ['text'] : [])]),
      view: z.literal('sections'), match: authoredMatch.optional() }).strict()] : []),
      ...(grants.granted('record', 'field') ? [z.object({ field: z.enum(['read_scope', 'write_scope']),
      directory: z.string().min(1).describe('Scope directory; root: dot.') }).strict()] : []),
      z.object({ field: z.enum([...new Set([
      ...(grants.granted("record", "field") ? [...WORK_RECORD_EDIT_FIELD_REGISTRY.map(row => row.field),
        ...WORK_RECORD_PLANNING_READ_FIELDS] : []),
      ...Object.entries({ canonical_record: WIKI_CANONICAL_RECORD_READ_FIELDS,
        document: WIKI_DOCUMENT_READ_FIELDS, manifest: CONTRACT_MANIFEST_READ_FIELDS,
        entry: WORK_RECORD_REFERENCE_READ_FIELDS, assignment: [...MANAGED_ASSIGNMENT_READ_FIELDS, 'test_commands'],
        package_document: PACKAGE_DOCUMENT_READ_FIELDS })
        .flatMap(([kind, fields]) => grants.granted(kind, "field") ? fields : [])
    ])]) }).strict()],
    inventory: [z.object({ inventory: z.enum(READ_WIKI_INVENTORIES) }).strict(),
      z.object({ inventory: z.literal('tasks'), match: authoredMatch }).strict()],
    entry: [
      z.object({ entry: positive, version: positive.optional() }).strict(),
      z.object({ entry: positive, history: z.literal(true) }).strict(),
      z.object({ entry: positive, version: positive.optional(), view: z.literal('structure'),
        path: z.array(z.union([text, z.object({ match: authoredMatch }).strict()])).optional(), full: z.literal(true).optional() }).strict()
    ],
    text: [z.object({ text }).strict()],
    integrity: [z.object({ integrity: z.literal(true) }).strict()],
    currentness: [z.object({ currentness: z.literal(true) }).strict()],
    membership: [z.object({ membership: z.enum(READ_WIKI_MEMBERSHIPS) }).strict()],
    action: [z.object({ action: text }).strict()],
    contract: [
      z.object({ contract: z.enum(READ_WIKI_CONTRACT_POPULATIONS),
        where: requestSchema(z, buildPublicSelectionSchema({ kinds: ['requirement', 'claim', 'verification', 'collection', 'case', 'obligation', 'entity', 'criterion', 'unresolved'] }), {}, { memoize: true })
          .optional().describe('Authored semantic selector.'),
        include: z.array(z.enum(['verifications', 'dependencies'])).min(1).optional() }).strict(),
      z.object({ contract: z.literal('requirements'), view: z.literal('choices'),
        query: z.string().regex(/\S/u, 'requirement_query_blank').optional() }).strict()
    ],
    finding: [],

    guidance: [z.object({ guidance: z.array(text).min(1) }).strict()],

    input_contract: [z.object({ input_contract: z.object({
      tool: z.enum(grants.granted("record_kind", "input_contract") ? INPUT_CONTRACT_TOOLS : INPUT_CONTRACT_TOOLS.slice(0, 1)),
      branches: z.object({ requirements: z.array(z.string().min(1)).min(1).optional(),
        ready_slices: z.array(z.enum(readySliceAuthoringOperations())).min(1).optional() }).strict().optional()
        .describe("Returned member capabilities; omitted: full members."),
      members: z.array(z.string().min(1)).min(1)
        .describe("Needed members together, once; unit/kind decides applicability.")
    }).strict().describe("{tool,members}: save_record changes schema via unit reference" +
      (grants.granted("record_kind", "input_contract")
      ? "; workspace_create_record initial schema via kind reference" : "") + ".") }).strict(),
    z.object({ input_contract: z.object({
      tool: z.enum(grants.granted("record_kind", "input_contract") ? INPUT_CONTRACT_TOOLS : INPUT_CONTRACT_TOOLS.slice(0, 1)),
      view: z.literal("choices"),
      members: z.array(z.string().min(1)).min(1).optional()
    }).strict() }).strict(),

    z.object({ input_contract: z.object({
      tool: z.literal(INPUT_CONTRACT_TOOLS[0]),
      operation: z.literal(INPUT_CONTRACT_EXCEPTION_OPERATION),
      kind: z.enum(exceptionPublication.kinds(RECORD_AUTHORING_EXCEPTION_KINDS)).optional()
        .describe("One exception kind; omitted, every kind is returned.")
    }).strict().describe("{tool:\"save_record\", operation:\"exception\", kind?}: the complete exception request " +
      "contract of a saved work item or slice, with each kind's meaning and consequence. Read-only; never required.") }).strict()]
  };
}

export function createReadWikiReadSchema(z, grants, exceptionPublication = DEFAULT_EXCEPTION_PUBLICATION) {
  if (grants.rows.length === 0) return null;
  const contextKinds = new Set(grants.contextKinds);
  const { selections } = grants;
  const allowsSubject = SUBJECT_SOURCE_KINDS.some((kind) => contextKinds.has(kind));
  const allowsSearch = contextKinds.has("search");
  const allowsAssignment = contextKinds.has("assignment");

  const nonEmpty = () => z.string().min(1);

  const shape = {};
  if (allowsSubject) {

    const guidance = contextKinds.has("requirement_guidance");

    const recordKind = contextKinds.has("record_kind");
    shape.subject = z.union([
      nonEmpty(),
      z.object({ repository: z.literal(true) }).strict(),
      z.object({ contract: z.literal(true) }).strict(),
      ...(recordKind ? [z.object({ record_kind: z.enum(recordBirthKinds()) }).strict()] : []),
      ...(guidance ? [z.object({ requirement_guidance: z.literal(true),

        topic: z.array(z.string().min(1)).min(1).optional() }).strict()] : [])
    ]).optional().describe(
      "WK/IN/DEC (WK-0001#SLICE-001), docs/wiki path" +
      (guidance ? "; requirement_guidance" : "") +
      (recordKind ? " or record_kind." : "."));
  }
  if (allowsSearch) {
    shape.search = z.object({
      query: nonEmpty().optional(),
      where: z.object(Object.fromEntries(FILTER_KEYS.map((key) => [key, z.string().optional()]))).strict().optional()
        .describe(SEARCH_FILTER_GUIDANCE),
      history: z.boolean().optional(),
      inventory: z.literal(true).optional()
    }).strict().optional().describe(
      "query ranks; inventory:true lists all filtered matches (query optional).");
  }
  if (allowsAssignment) {
    shape.assignment = z.literal(true).optional().describe(
      "Managed workers only: the launcher-published frozen assignment.");
  }
  const referenceForms = [
    ...(grants.rows.some(row => row.source_kind === "entry")
      ? [z.object({ ref: nonEmpty() }).strict()] : []),
    selectedResponseLocatorSchema(z),

    ...(contextKinds.has("package_document")
      ? [z.object({ tool_name: nonEmpty(), path: nonEmpty() }).strict()] : [])
  ];
  shape.reference = (referenceForms.length === 1 ? referenceForms[0] : z.union(referenceForms)).optional().describe(
    "Issued source.");
  const byName = selectionSchemas(z, grants, exceptionPublication);
  const members = selections.flatMap((name) => byName[name] ?? []);
  shape.select = (members.length === 1 ? members[0] : z.union(members)).optional().describe(
    "Requested meaning.");

  if (grants.granted('record', 'input_contract')) shape.for_changes = z.array(z.string().min(1)).min(1).optional()
    .describe('Needed save members; current unit only.');
  const sources = READ_WIKI_SOURCES.filter((key) => Object.hasOwn(shape, key));
  return z.object(shape).strict().superRefine((args, context) => {
    const queryIssue = requirementChoiceQueryIssue(args.select);
    if (queryIssue) context.addIssue({ code: z.ZodIssueCode.custom, path: ['select', 'query'], message: queryIssue.code });
    const present = sources.filter((key) => args[key] !== undefined);
    if (present.length !== 1) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: present.length === 0 ? [] : [present[1]],
        message: `exactly one source is required: ${sources.join(", ")}` });
    }
    if (args.search !== undefined && args.search.query === undefined && args.search.inventory !== true) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["search", "query"],
        message: "search needs query, or inventory:true for the complete filtered population" });
    }

  });
}

export function createReadWikiInputSchema(z, grants, exceptionPublication = DEFAULT_EXCEPTION_PUBLICATION,
  { advertise = false } = {}) {
  const read = createReadWikiReadSchema(z, grants, exceptionPublication);
  if (read === null) return null;
  return z.object({ reads: z.array(advertise ? read : z.unknown()).min(1) }).strict();
}
