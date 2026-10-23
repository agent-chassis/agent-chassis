import { z } from "zod";
import { selectedResponseDetailSchema } from "./selected-response-snapshot.mjs";

export function codeIndexDetailSchema(z) {
  const shared = selectedResponseDetailSchema(z).shape;
  return z.object({
    source: shared.source,
    collection: shared.collection.describe("A returned code-meaning collection; index/provider bookkeeping is not selectable."),
    selector: z.object({ id: z.string().min(1).max(4096) }).strict().optional(),
    path: z.string().min(1).max(4096).optional(),
    symbol: z.string().min(1).max(4096).optional(),
    relationship: z.string().min(1).max(256).optional(),
    input_path: z.string().min(1).max(4096).optional(),
    regions: z.array(z.object({
      path: z.string().min(1).max(4096),
      start_line: z.number().int().positive().nullable(),
      end_line: z.number().int().positive().nullable(),
      relationship: z.string().min(1).max(256).optional()
    }).strict())
      .min(1).describe("Choose any nonempty subset of the returned exact context-region extents. Reads only their union from this source; relationship qualifies a native navigation part. Do not combine with other row filters.").optional(),
    lines: z.object({ start_line: z.number().int().positive(),
      end_line: z.number().int().positive() }).strict().describe("Absolute one-based inclusive source lines inside the selected source, region or file.").optional()
  }).strict();
}

const QUESTION_FIELD_SHAPES = Object.freeze({
  paths: () => z.array(z.string()).describe("Empty [] explicitly selects no changes."),
  patchText: () => z.string().describe("Empty text explicitly selects no changes."),
  diffRecords: () => z.array(z.object({
    changeKind: z.string().describe("added, deleted, modified, renamed or copied; unsupported kinds are reported.").optional(),
    oldPath: z.string().nullable().optional(),
    newPath: z.string().nullable().optional()
  }).strict()).describe("Empty [] selects no changes. added needs only newPath; deleted only oldPath; modified/renamed/copied need both endpoints."),
  liveGit: () => z.boolean().describe("true selects live Git changes; false alone selects nothing."),
  path: () => z.string().describe("Repository-relative file. In navigation, accompanies only document-local symbols. In impact, path/symbol select a union of seed paths within the changed subject."),
  symbol: () => z.string().describe("Exact raw SCIP symbol returned by the index; preserve it unchanged. Navigation locals require their document path; impact uses the symbol's definition paths."),
  line: () => z.union([z.number(), z.string()]).describe("One-based line: safe integer >= 1 or canonical decimal text."),
  character: () => z.union([z.number(), z.string()]).describe("Zero-based character: safe integer >= 0 or canonical decimal text; requires line. Resolution remains whole-line; changing character does not narrow it."),
  relationship: (relationships) => z.enum([...relationships]).describe("One navigation relationship; omit only when all four are needed. References do not establish calls."),
  includeSuppressed: () => z.boolean().describe("Include suppressed canonical records for context/impact; not accepted in navigation.")
});

export const codeIndexQueryInputSchema = ({ fields, relationships }) => z.object({
  ...Object.fromEntries(fields.map((field) => {
    if (!Object.hasOwn(QUESTION_FIELD_SHAPES, field)) {
      throw new TypeError(`code question field ${field} has no registered shape`);
    }
    return [field, QUESTION_FIELD_SHAPES[field](relationships).optional()];
  })),
  status: z.literal(true).optional(),
  detail: codeIndexDetailSchema(z).optional()
}).strict();

