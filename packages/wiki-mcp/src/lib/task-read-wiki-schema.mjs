

import { FILTER_KEYS } from "@agent-chassis/wiki-core/src/operations/search.mjs";
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
  ["criteria", "requirements", "obligations", "cases", "references", "coverage"]);

const READ_WIKI_SOURCES = Object.freeze(["subject", "search", "assignment", "reference"]);

export function describeReadWikiTool(inputSchema) {
  const declared = new Set(READ_WIKI_SOURCES.filter((key) => Object.hasOwn(inputSchema._def.schema.shape, key)));
  const list = (items) => items.length > 1 ? `${items.slice(0, -1).join(", ")} or ${items.at(-1)}` : items[0];
  const material = [
    ...(declared.has("subject") || declared.has("search") ? ["saved work", "reference material"] : []),
    ...(declared.has("assignment") ? ["a frozen assignment"] : []),
    ...(declared.has("subject") || declared.has("search") ? [] : ["the references this server returns"])
  ];
  const sources = [...declared].map((key) => key === "reference" ? "a returned reference" : key);
  return `Read ${list(material)}. Name one source (${list(sources)}) for compact context; pass its ` +
    "returned reference and one select for the complete result. Read-only." +
    (declared.has("subject") ? " WK subject facts carry advisory terminal_review_designation; findings-unit facts and " +
      "inventory:\"slices\" members carry review_purpose when in effect. These saved facts grant no permission." : "");
}

function selectionSchemas(z, grants) {
  const text = z.string().min(1);
  const positive = z.number().int().positive();
  return {
    context: [z.object({ context: z.literal(true) }).strict()],
    field: [z.object({ field: z.enum([...new Set([
      ...(grants.granted("record", "field") ? WORK_RECORD_EDIT_FIELD_REGISTRY.map(row => row.field) : []),
      ...Object.entries({ canonical_record: WIKI_CANONICAL_RECORD_READ_FIELDS,
        document: WIKI_DOCUMENT_READ_FIELDS, manifest: CONTRACT_MANIFEST_READ_FIELDS,
        entry: WORK_RECORD_REFERENCE_READ_FIELDS, assignment: MANAGED_ASSIGNMENT_READ_FIELDS,
        package_document: PACKAGE_DOCUMENT_READ_FIELDS })
        .flatMap(([kind, fields]) => grants.granted(kind, "field") ? fields : [])
    ])]) }).strict()],
    inventory: [z.object({ inventory: z.enum(READ_WIKI_INVENTORIES) }).strict()],
    entry: [
      z.object({ entry: positive, version: positive.optional() }).strict(),
      z.object({ entry: positive, history: z.literal(true) }).strict()
    ],
    text: [z.object({ text }).strict()],
    integrity: [z.object({ integrity: z.literal(true) }).strict()],
    currentness: [z.object({ currentness: z.literal(true) }).strict()],
    membership: [z.object({ membership: z.enum(READ_WIKI_MEMBERSHIPS) }).strict()],
    action: [z.object({ action: text }).strict()],
    contract: [z.object({ contract: z.enum(READ_WIKI_CONTRACT_POPULATIONS) }).strict()],
    obligation: [z.object({ obligation: text, parameters: z.literal(true).optional() }).strict()],
    finding: [z.object({ finding: text }).strict()],

    guidance: [z.object({ guidance: z.array(text).min(1) }).strict()],

    input_contract: [z.object({ input_contract: z.object({
      tool: z.enum(grants.granted("record_kind", "input_contract") ? INPUT_CONTRACT_TOOLS : INPUT_CONTRACT_TOOLS.slice(0, 1)),
      members: z.array(z.string().min(1)).min(1)
        .describe("Every member the job needs, together, each once; the unit or kind decides which apply.")
    }).strict().describe("{tool, members}: the complete input schema of the named members in one result: " +
      "save_record changes with a saved unit's reference" + (grants.granted("record_kind", "input_contract")
      ? ", workspace_create_record initial with a record kind's" : "") + ". Never required.") }).strict(),

    z.object({ input_contract: z.object({
      tool: z.literal(INPUT_CONTRACT_TOOLS[0]),
      operation: z.literal(INPUT_CONTRACT_EXCEPTION_OPERATION),
      kind: z.enum(RECORD_AUTHORING_EXCEPTION_KINDS).optional()
        .describe("One exception kind; omitted, every kind is returned.")
    }).strict().describe("{tool:\"save_record\", operation:\"exception\", kind?}: the complete exception request " +
      "contract of a saved work item or slice, with each kind's meaning and consequence. Read-only; never required.") }).strict()]
  };
}

export function createReadWikiInputSchema(z, grants) {
  if (grants.rows.length === 0) return null;
  const contextKinds = new Set(grants.contextKinds);
  const { selections } = grants;
  const allowsSubject = SUBJECT_SOURCE_KINDS.some((kind) => contextKinds.has(kind));
  const allowsSearch = contextKinds.has("search");
  const allowsAssignment = contextKinds.has("assignment");
  const nonEmpty = z.string().min(1);

  const shape = {};
  if (allowsSubject) {

    const guidance = contextKinds.has("requirement_guidance");

    const recordKind = contextKinds.has("record_kind");
    shape.subject = z.union([
      nonEmpty,
      z.object({ repository: z.literal(true) }).strict(),
      z.object({ contract: z.literal(true) }).strict(),
      ...(recordKind ? [z.object({ record_kind: z.enum(recordBirthKinds()) }).strict()] : []),
      ...(guidance ? [z.object({ requirement_guidance: z.literal(true),

        topic: z.array(z.string().min(1)).min(1).optional() }).strict()] : [])
    ]).optional().describe(
      "A canonical id (WK-0001, WK-0001#SLICE-001, DEC-0001, IN-0001), a docs/ or wiki/ document path, the " +
      `repository${guidance ? ", the contract manifest or requirement guidance for save_record (topic chooses the " +
        "recommended selection)" : " or the contract manifest"}${recordKind ? "; or a record kind to create, whose " +
        "reference reads workspace_create_record's complete initial schema before any record exists" : ""}. ` +
      "Returns compact context and its selections.");
  }
  if (allowsSearch) {
    shape.search = z.object({
      query: nonEmpty.optional(),
      where: z.object(Object.fromEntries(FILTER_KEYS.map((key) => [key, z.string().optional()]))).strict().optional(),
      history: z.boolean().optional(),
      inventory: z.literal(true).optional()
    }).strict().optional().describe(
      "Ranked search needs query. inventory:true selects the complete filtered population, with or without query.");
  }
  if (allowsAssignment) {
    shape.assignment = z.literal(true).optional().describe(
      "Managed workers only: the launcher-published frozen assignment.");
  }
  const referenceForms = [
    ...(grants.rows.some(row => row.source_kind === "entry")
      ? [z.object({ ref: nonEmpty }).strict()] : []),
    z.object({ ...selectedResponseLocatorSchema(z).shape,
      ...(grants.granted("receipt", "finding") ? { finding_id: nonEmpty.optional() } : {}) }).strict(),

    ...(contextKinds.has("package_document")
      ? [z.object({ tool_name: nonEmpty, path: nonEmpty }).strict()] : [])
  ];
  shape.reference = (referenceForms.length === 1 ? referenceForms[0] : z.union(referenceForms)).optional().describe(
    "A reference this server returned. Alone it returns compact context; with select it returns the complete selection.");
  const byName = selectionSchemas(z, grants);
  const members = selections.flatMap((name) => byName[name] ?? []);
  shape.select = (members.length === 1 ? members[0] : z.union(members)).optional().describe(
    "Only with reference: exactly one semantic selection of that resource.");

  const sources = READ_WIKI_SOURCES.filter((key) => Object.hasOwn(shape, key));
  return z.object(shape).strict().superRefine((args, context) => {
    const present = sources.filter((key) => args[key] !== undefined);
    if (present.length !== 1) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: present.length === 0 ? [] : [present[1]],
        message: `exactly one source is required: ${sources.join(", ")}` });
    }
    if (args.select !== undefined && args.reference === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["select"],
        message: "select needs the reference a first context returned; call without select first" });
    }
    if (args.search !== undefined && args.search.query === undefined && args.search.inventory !== true) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["search", "query"],
        message: "search needs query, or inventory:true for the complete filtered population" });
    }
    if (args.reference?.finding_id !== undefined && args.select !== undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["select"],
        message: "finding_id already selects one receipt finding" });
    }
  });
}
