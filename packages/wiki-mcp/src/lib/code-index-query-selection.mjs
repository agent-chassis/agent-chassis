import { selectRetainedSourceLines } from "@agent-chassis/wiki-core/src/lib/sidecar-source-regions.mjs";
import { selectedResponseDetailSchema, selectedResponseQueryInvalidError } from "./selected-response-snapshot.mjs";
import { codeMeaningSubjects, codePathLimits, codeUnsupportedChanges } from "./code-index-query-meaning.mjs";

const RETAINED_QUERY_MATERIAL = new Set(["input_diff_sources"]);
const DETAIL_FRAME_MEMBERS = new Set(["schema_version", "workspaceRepo", "query_kind", "observation",
  "selected_detail", "page", "next_calls", "read_mode", "mixed_source"]);

const ROW_IDENTITY_FIELDS = Object.freeze(["hit_id", "region_id", "edge_id", "id", "symbol_key"]);
const ROW_PATH_FIELDS = Object.freeze(["path", "document_path", "input_path", "newPath", "oldPath"]);
const ROW_SYMBOL_FIELDS = Object.freeze(["symbol", "symbol_key", "symbol_id", "caller_symbol",
  "callee_symbol"]);
const SELECTION_FIELDS = Object.freeze(["selector", "path", "symbol", "relationship", "input_path", "lines"]);

const COLLECTION_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;

const plainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

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
    lines: z.object({ start_line: z.number().int().positive(),
      end_line: z.number().int().positive() }).strict().describe("Absolute one-based inclusive source lines inside the selected source, region or file.").optional()
  }).strict();
}

const NAVIGATION_PART_COLLECTIONS = Object.freeze(["source_hits", "context_regions", "complete_files"]);
export function selectableSubjects(carrier) {
  const subjects = new Map();
  for (const [name, value] of Object.entries(carrier)) {
    if (RETAINED_QUERY_MATERIAL.has(name) || DETAIL_FRAME_MEMBERS.has(name) ||
        !COLLECTION_NAME_PATTERN.test(name)) continue;
    if (Array.isArray(value)) subjects.set(name, { kind: "rows", rows: value });
    else if (plainObject(value)) subjects.set(name, { kind: "member", rows: [value] });
  }
  if (Array.isArray(carrier.symbol_resolution?.candidates)) {
    subjects.set("candidates", { kind: "rows", rows: carrier.symbol_resolution.candidates });
  } else if (plainObject(carrier.parts)) {
    const parts = Object.entries(carrier.parts).filter(([, part]) => plainObject(part));
    const across = (rowsOf) => parts.flatMap(([relationship, part]) => rowsOf(part).map((row) =>
      (plainObject(row) ? { ...row, relationship_kind: relationship } : row)));
    const candidates = across((part) => (Array.isArray(part.symbol_resolution?.candidates)
      ? part.symbol_resolution.candidates : []));
    if (candidates.length > 0) subjects.set("candidates", { kind: "rows", rows: candidates });
    for (const name of NAVIGATION_PART_COLLECTIONS) {
      if (subjects.has(name) || !parts.some(([, part]) => Array.isArray(part[name]))) continue;
      subjects.set(name, { kind: "rows", rows: across((part) => (Array.isArray(part[name]) ? part[name] : [])) });
    }
  }
  const pathLimits = codePathLimits(carrier);
  if (pathLimits.length) subjects.set("path_limits", { kind: "rows", rows: pathLimits });
  const unsupportedChanges = codeUnsupportedChanges(carrier);
  if (unsupportedChanges.length) subjects.set("unsupported_changes", { kind: "rows", rows: unsupportedChanges });
  return codeMeaningSubjects(subjects, { project: false });
}

export function codeIndexCollectionCounts(carrier) {
  return Object.fromEntries([...selectableSubjects(carrier)]
    .filter(([, subject]) => subject.kind === "rows")
    .map(([name, subject]) => [name, subject.rows.length]));
}

function rowIdentity(row) {
  if (typeof row === "string") return row;
  if (!plainObject(row)) return null;
  const field = ROW_IDENTITY_FIELDS.find((name) => typeof row[name] === "string");
  return field === undefined ? null : row[field];
}

function rowPath(row) {
  if (typeof row === "string") return row;
  if (!plainObject(row)) return null;
  const field = ROW_PATH_FIELDS.find((name) => typeof row[name] === "string");
  return field === undefined ? null : row[field];
}

function namesPath(row, path) {
  if (typeof row === "string") return row === path;
  return plainObject(row) && ROW_PATH_FIELDS.some((field) => row[field] === path);
}

function namesSymbol(row, symbol) {
  if (!plainObject(row)) return false;
  return ROW_SYMBOL_FIELDS.some((field) => row[field] === symbol) ||
    (Array.isArray(row.symbol_keys) && row.symbol_keys.includes(symbol));
}

function withRelationship(row, relationship) {
  if (!plainObject(row)) return null;
  if (row.kind === relationship || row.relationship_kind === relationship) return row;
  let matched = false;
  const selected = { ...row };
  for (const [field, value] of Object.entries(row)) {
    if (!Array.isArray(value) || !value.some((entry) => plainObject(entry) && typeof entry.kind === "string")) {
      continue;
    }
    selected[field] = value.filter((entry) => entry?.kind === relationship);
    matched ||= selected[field].length > 0;
  }
  return matched ? selected : null;
}

function selectRows(rows, selection) {
  const selected = [];
  const positions = [];
  for (const [position, row] of rows.entries()) {
    if (selection.selector !== undefined && rowIdentity(row) !== selection.selector.id) continue;
    if (selection.path !== undefined && !namesPath(row, selection.path)) continue;
    if (selection.symbol !== undefined && !namesSymbol(row, selection.symbol)) continue;
    let chosen = selection.relationship === undefined ? row : withRelationship(row, selection.relationship);
    if (chosen !== null && selection.input_path !== undefined) {
      if (!Array.isArray(chosen.relationships)) continue;
      const relationships = chosen.relationships.filter((entry) => entry?.input_path === selection.input_path);
      if (relationships.length === 0) continue;
      chosen = { ...chosen, relationships };
    }
    if (chosen !== null) {
      selected.push(chosen);
      positions.push(position);
    }
  }
  return { selected, positions };
}

function selectionOf(detail) {
  const selection = {};
  for (const field of SELECTION_FIELDS) {
    if (detail[field] !== undefined) selection[field] = structuredClone(detail[field]);
  }
  return selection;
}

export function selectCodeIndexRetainedCollection({ route, carrier, detail }) {
  const subjects = selectableSubjects(carrier);
  return selectFromSubject({ route, collections: [...subjects.keys()],
    subject: subjects.get(detail.collection), detail });
}

function selectFromSubject({ route, collections, subject, detail }) {
  if (subject === undefined) {
    throw selectedResponseQueryInvalidError(route, "collection_unknown", {
      collection: detail.collection,
      collections,
      ...(RETAINED_QUERY_MATERIAL.has(detail.collection) ? { retained_query_material: true } : {})
    });
  }
  const selection = selectionOf(detail);
  const filtered = Object.keys(selection).length > 0;
  if (selection.input_path !== undefined && (detail.collection !== "affected_files" ||
      selection.path === undefined && selection.selector === undefined)) {
    throw selectedResponseQueryInvalidError(route, "selection_not_applicable",
      { collection: detail.collection, selection: ["input_path"],
        required: "one affected file selected by path or selector.id" });
  }
  if (selection.lines !== undefined && (!new Set(["source", "context_regions", "complete_files"])
    .has(detail.collection) || (detail.collection !== "source" && selection.path === undefined && selection.selector === undefined))) {
    throw selectedResponseQueryInvalidError(route, "selection_not_applicable",
      { collection: detail.collection, selection: ["lines"],
        required: "one retained region by selector.id or complete file by path" });
  }
  if (subject.kind === "member" && Object.keys(selection).some(field => field !== "lines")) {
    throw selectedResponseQueryInvalidError(route, "selection_not_applicable",
      { collection: detail.collection, selection: Object.keys(selection) });
  }
  const chosen = filtered ? selectRows(subject.rows, selection)
    : { selected: subject.rows, positions: subject.rows.map((_row, position) => position) };
  let matched = chosen.selected;
  if (filtered && matched.length === 0) {
    throw selectedResponseQueryInvalidError(route, "selection_matched_nothing",
      { collection: detail.collection, selection });
  }
  let relationshipCounts = null;
  if (selection.input_path !== undefined) {
    if (matched.length !== 1) throw selectedResponseQueryInvalidError(route,
      "selection_ambiguous", { collection: detail.collection, selection });
    const original = subject.rows.find((row) => rowPath(row) === rowPath(matched[0]));
    relationshipCounts = { total: original.relationships.length,
      matched: matched[0].relationships.length, returned: matched[0].relationships.length,
      truncated: false };
  }
  if (selection.lines !== undefined) {
    if (matched.length !== 1) throw selectedResponseQueryInvalidError(route,
      "selection_ambiguous", { collection: detail.collection, selection });
    const [row] = matched;
    try {
      const source_text = selectRetainedSourceLines(row, selection.lines);
      matched = [{ ...row, source_text, selected_lines: { ...selection.lines } }];
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      throw selectedResponseQueryInvalidError(route, "source_lines_out_of_range",
        { collection: detail.collection, selection, retained_bounds:
          { start_line: row.start_line, end_line: row.end_line } });
    }
  }
  return { subject, selection, matched, relationshipCounts, positions: chosen.positions };
}

