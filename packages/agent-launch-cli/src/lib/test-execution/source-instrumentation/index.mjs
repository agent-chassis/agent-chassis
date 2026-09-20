

import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const WEB_TREE_SITTER_ENTRY = require.resolve("web-tree-sitter");
const GRAMMAR_ROOT = path.join(path.dirname(require.resolve("@vscode/tree-sitter-wasm/package.json")),
  "wasm");

let parserModule = null;
const languages = new Map();

async function languageParser(grammar) {
  if (parserModule === null) {
    parserModule = await import(WEB_TREE_SITTER_ENTRY);
    await parserModule.Parser.init({
      locateFile: (file) => path.join(path.dirname(WEB_TREE_SITTER_ENTRY), file)
    });
  }
  let language = languages.get(grammar);
  if (language === undefined) {
    language = await parserModule.Language.load(path.join(GRAMMAR_ROOT, `tree-sitter-${grammar}.wasm`));
    languages.set(grammar, language);
  }
  const parser = new parserModule.Parser();
  parser.setLanguage(language);
  return parser;
}

export function probeToken() {
  return randomBytes(16).toString("hex");
}

export function probeFacts(token, name, line, mutated) {
  return Object.freeze({ token, function_name: name, line, mutated: mutated === true });
}

export class SourceInstrumentationError extends Error {
  constructor(reason, detail = {}) {
    super(`source instrumentation refused: ${reason}`);
    this.name = "SourceInstrumentationError";
    this.code = "test_proof_native_instrumentation_unsupported";
    this.reason = reason;
    this.detail = detail;
  }
}

export function unsupported(reason, detail = {}) {
  throw new SourceInstrumentationError(reason, detail);
}

export async function parseSource(grammar, source, { allowErrors = false } = {}) {
  const parser = await languageParser(grammar);
  const tree = parser.parse(source);
  if (!allowErrors && tree.rootNode.hasError) unsupported("source_unparsable", { grammar });
  return tree;
}

export function applyEdits(source, edits) {
  const ordered = [...edits].sort((left, right) => right.index - left.index);
  let result = source;
  let floor = Infinity;
  for (const edit of ordered) {
    if (edit.index + (edit.remove ?? 0) > floor) unsupported("overlapping_edits");
    if (edit.insert.includes("\n") || source.slice(edit.index, edit.index + (edit.remove ?? 0))
      .includes("\n")) unsupported("edit_changes_lines");
    result = result.slice(0, edit.index) + edit.insert + result.slice(edit.index + (edit.remove ?? 0));
    floor = edit.index;
  }
  return result;
}

export const namedChildren = (node) => node.namedChildren.filter((child) =>
  !["comment", "line_comment", "block_comment"].includes(child.type));

export function replacementKind(value) {
  if (value === null) return "null";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string") return "string";
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? "integer" : "float";
  }
  return "unsupported";
}

export function assertDistinctReplacement({ originalKind, originalValue, replacement,
  compatible }) {
  const kind = replacementKind(replacement);
  if (kind === "unsupported") unsupported("replacement_not_scalar");
  if (!compatible(originalKind, kind)) {
    unsupported("replacement_kind_incompatible", { original_kind: originalKind, replacement_kind: kind });
  }
  if (JSON.stringify(originalValue) === JSON.stringify(replacement)) {
    unsupported("replacement_not_distinct");
  }
  return kind;
}
