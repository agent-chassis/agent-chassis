import { createRequire } from "node:module";
import path from "node:path";

import { Language, Parser } from "web-tree-sitter";

export const WORK_RECORD_TARGET_TEST_CASE_RESOLVER_PROVIDER = Object.freeze({
  id: "portfolio-local.target-test-case-resolver",
  version: "0.1.0",
  mode: "local"
});
const UNAVAILABLE_TARGET_TEST_CASE_RESOLVER_PROVIDER = Object.freeze({
  id: null,
  version: null,
  mode: "unavailable"
});
export const WORK_RECORD_TARGET_TEST_CASE_RESOLVER_SUPPORTED_KIND_VALUES = new Set(["test_case"]);

const CANONICAL_REPOSITORY_TEST_FILE_BASENAME_PATTERN = /^[^/\\]+\.test\.(?:mjs|js)$/u;
const WINDOWS_DRIVE_LETTER_PREFIX_PATTERN = /^[A-Za-z]:[/\\]/u;

export function isSupportedRepositoryTestFilePath(value) {
  if (typeof value !== "string" || value.length === 0) return false;

  if (value !== value.trim()) return false;

  if (value.includes("\0") || value.includes("\\") || value.startsWith("/")) return false;
  if (WINDOWS_DRIVE_LETTER_PREFIX_PATTERN.test(value)) return false;

  const segments = value.split("/");
  for (const segment of segments) {
    if (segment.length === 0 || segment === "." || segment === "..") return false;
  }

  return CANONICAL_REPOSITORY_TEST_FILE_BASENAME_PATTERN.test(segments[segments.length - 1]);
}

const OPERATION_VALUES = new Set(["create", "modify", "delete", "inspect"]);
const MODULE_VAR_SCOPE_BOUNDARY_TYPES = new Set([
  "arrow_function",
  "class",
  "class_declaration",
  "function_declaration",
  "function_expression",
  "generator_function",
  "generator_function_declaration",
  "method_definition"
]);
const require = createRequire(import.meta.url);
const WEB_TREE_SITTER_ROOT = path.dirname(require.resolve("web-tree-sitter"));
const WASM_GRAMMAR_ROOT = path.dirname(require.resolve("@vscode/tree-sitter-wasm/package.json"));

const parserProvider = await loadParserProvider();

async function loadParserProvider() {
  try {
    await Parser.init({
      locateFile(file) {
        return path.join(WEB_TREE_SITTER_ROOT, file);
      }
    });
    return {
      available: true,
      language: await Language.load(path.join(WASM_GRAMMAR_ROOT, "wasm", "tree-sitter-javascript.wasm"))
    };
  } catch {
    return { available: false, language: null };
  }
}

function stringValue(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function repoPath(value) {
  return stringValue(value)?.replaceAll("\\", "/").replace(/^\.\//u, "") ?? null;
}

function controlled(value, allowed) {
  const normalized = stringValue(value)?.toLowerCase().replaceAll("-", "_").replace(/\s+/gu, "_") ?? null;
  return normalized && allowed.has(normalized) ? normalized : null;
}

function targetFrom(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    path: repoPath(input.path),
    kind: stringValue(input.kind)?.toLowerCase() ?? null,
    name: stringValue(input.name),
    operation: controlled(input.operation, OPERATION_VALUES),
    optional: input.optional === true
  };
}

function selectedUnitFrom(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const unit = {
    kind: stringValue(value.kind)?.toLowerCase() ?? null,
    address: stringValue(value.address ?? value.work_unit_address ?? value.workUnitAddress),
    record_id: stringValue(value.record_id ?? value.recordId),
    slice_id: stringValue(value.slice_id ?? value.sliceId),
    repo: stringValue(value.repo ?? value.repository)
  };
  return Object.values(unit).some(Boolean) ? unit : null;
}

function spanFrom(startLine, endLine) {
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) return null;
  return { start_line: startLine, end_line: endLine, line_count: endLine - startLine + 1 };
}

function evidence(target, status, reason, options = {}) {
  const candidateCount = Number.isInteger(options.candidateCount) ? options.candidateCount : 0;
  const provider =
    status === "provider_unavailable"
      ? UNAVAILABLE_TARGET_TEST_CASE_RESOLVER_PROVIDER
      : Object.prototype.hasOwnProperty.call(options, "provider")
        ? options.provider
        : WORK_RECORD_TARGET_TEST_CASE_RESOLVER_PROVIDER;
  return {
    target_resolution_evidence_status: status === "resolved" || status === "not_applicable" ? "present" : status === "ambiguous" ? "partial" : "degraded",
    target_resolution_provider: provider,
    target_resolution_target: target,
    target_resolution_status: status,
    target_resolution_status_reason: reason,
    target_resolution_span: options.span ?? null,
    target_resolution_fanout: candidateCount > 0 ? { direct_reference_count: candidateCount, affected_symbol_count: candidateCount } : null,
    target_resolution_candidates: Array.isArray(options.candidates) ? options.candidates : [],
    source_record_digest: stringValue(options.source_record_digest),
    selected_unit: selectedUnitFrom(options.selected_unit),
    payload_bound_input_digest: stringValue(options.payload_bound_input_digest)
  };
}

function namedChildren(node) {
  return Array.from({ length: node?.namedChildCount ?? 0 }, (_, index) => node.namedChild(index)).filter(Boolean);
}

function children(node) {
  return Array.from({ length: node?.childCount ?? 0 }, (_, index) => node.child(index)).filter(Boolean);
}

function textForNode(text, node) {
  return node ? text.slice(node.startIndex, node.endIndex) : "";
}

function stringLiteralValue(text, node) {
  if (node?.type !== "string") return null;
  const raw = textForNode(text, node);
  const quote = raw[0];
  if (raw.length < 2 || !["\"", "'"].includes(quote) || raw.at(-1) !== quote || raw.includes("\\")) return null;
  return raw.slice(1, -1);
}

function importBindings(rootNode, text) {
  const supported = new Map();
  const allLocals = new Map();
  for (const statement of namedChildren(rootNode)) {
    if (statement.type !== "import_statement") continue;
    const source = statement.childForFieldName("source") ?? namedChildren(statement).find((node) => node.type === "string");
    const clause = namedChildren(statement).find((node) => node.type === "import_clause");
    if (!clause) continue;
    const clauseChildren = namedChildren(clause);

    for (const local of importClauseLocalNames(clauseChildren, text)) addImportLocal(allLocals, local);
    if (stringLiteralValue(text, source) !== "node:test") continue;

    const supportedLocal = supportedNodeTestBindingLocal(clauseChildren, text);
    if (supportedLocal) addImportLocal(supported, supportedLocal);
  }
  return { allLocals, supported };
}

function importClauseLocalNames(clauseChildren, text) {
  const locals = [];
  for (const child of clauseChildren) {
    if (child.type === "identifier") {
      locals.push(textForNode(text, child));
    } else if (child.type === "named_imports") {
      for (const specifier of namedChildren(child).filter((node) => node.type === "import_specifier")) {
        const local = specifier.childForFieldName("alias") ?? specifier.childForFieldName("name");
        locals.push(textForNode(text, local));
      }
    } else if (child.type === "namespace_import") {
      locals.push(textForNode(text, namedChildren(child).find((node) => node.type === "identifier")));
    }
  }
  return locals;
}

function supportedNodeTestBindingLocal(clauseChildren, text) {
  if (clauseChildren.length !== 1) return null;
  const only = clauseChildren[0];
  if (only.type === "identifier") return textForNode(text, only) || null;
  if (only.type !== "named_imports") return null;
  const specifiers = namedChildren(only).filter((node) => node.type === "import_specifier");
  if (specifiers.length !== 1) return null;
  const imported = specifiers[0].childForFieldName("name");
  const alias = specifiers[0].childForFieldName("alias");
  if (imported?.type !== "identifier" || textForNode(text, imported) !== "test") return null;
  if (alias && alias.type !== "identifier") return null;
  return textForNode(text, alias ?? imported) || null;
}

function addImportLocal(bindings, name) {
  if (name) bindings.set(name, (bindings.get(name) ?? 0) + 1);
}

function collectBindingIdentifiers(node, text, names) {
  if (!node) return;
  if (node.type === "identifier" || node.type === "shorthand_property_identifier_pattern") {
    names.add(textForNode(text, node));
    return;
  }
  for (const child of namedChildren(node)) collectBindingIdentifiers(child, text, names);
}

function topLevelDeclaredNames(rootNode, text) {
  const names = new Set();
  function inspect(statement) {
    if (["lexical_declaration", "variable_declaration"].includes(statement.type)) {
      for (const declarator of namedChildren(statement).filter((node) => node.type === "variable_declarator")) {
        collectBindingIdentifiers(declarator.childForFieldName("name"), text, names);
      }
      return;
    }
    if (["function_declaration", "generator_function_declaration", "class_declaration"].includes(statement.type)) {
      collectBindingIdentifiers(statement.childForFieldName("name"), text, names);
      return;
    }
    if (statement.type === "export_statement") {
      const declaration = namedChildren(statement).find((node) => ["lexical_declaration", "variable_declaration", "function_declaration", "generator_function_declaration", "class_declaration"].includes(node.type));
      if (declaration) inspect(declaration);
    }
  }
  for (const statement of namedChildren(rootNode)) inspect(statement);
  return names;
}

function moduleScopeVarNames(rootNode, text) {
  const names = new Set();
  function visit(node) {
    if (!node || (node !== rootNode && MODULE_VAR_SCOPE_BOUNDARY_TYPES.has(node.type))) return;
    if (node.type === "variable_declaration") {
      for (const declarator of namedChildren(node).filter((child) => child.type === "variable_declarator")) {
        collectBindingIdentifiers(declarator.childForFieldName("name"), text, names);
      }
    }
    if (node.type === "for_in_statement" && children(node).some((child) => child.type === "var")) {
      collectBindingIdentifiers(node.childForFieldName("left"), text, names);
    }
    for (const child of namedChildren(node)) visit(child);
  }
  visit(rootNode);
  return names;
}

function candidatesFor(target, rootNode, text) {
  const { allLocals, supported } = importBindings(rootNode, text);
  const moduleDeclaredNames = topLevelDeclaredNames(rootNode, text);
  for (const name of moduleScopeVarNames(rootNode, text)) moduleDeclaredNames.add(name);
  const trustedBindings = new Set([...supported].filter(([name, count]) => count === 1 && allLocals.get(name) === 1 && !moduleDeclaredNames.has(name)).map(([name]) => name));
  const hasBindingConflict = [...supported].some(([name, count]) => count !== 1 || allLocals.get(name) !== 1 || moduleDeclaredNames.has(name));
  const candidates = [];
  for (const statement of namedChildren(rootNode)) {
    if (statement.type !== "expression_statement") continue;
    const call = namedChildren(statement)[0];
    if (call?.type !== "call_expression") continue;
    const callee = call.childForFieldName("function") ?? namedChildren(call)[0];
    const bindingName = callee?.type === "identifier" ? textForNode(text, callee) : null;
    if (!bindingName || !trustedBindings.has(bindingName)) continue;
    const argumentsNode = call.childForFieldName("arguments") ?? namedChildren(call).find((node) => node.type === "arguments");
    const title = namedChildren(argumentsNode)[0];
    const titleValue = stringLiteralValue(text, title);
    if (titleValue === null || titleValue !== target.name) continue;
    const span = spanFrom(call.startPosition.row + 1, call.endPosition.row + 1);
    if (span) candidates.push({ path: target.path, kind: target.kind, name: target.name, span });
  }
  return { candidates, hasBinding: supported.size > 0, hasBindingConflict };
}

function parseCandidates(target, sourceText) {
  if (!parserProvider.available) return { unavailable: true, reason: "JavaScript parser substrate was unavailable" };
  const parser = new Parser();
  let tree = null;
  try {
    parser.setLanguage(parserProvider.language);
    tree = parser.parse(sourceText);
    if (!tree || tree.rootNode.hasError) return { unavailable: true, reason: "source text could not be parsed as supported JavaScript" };
    return { unavailable: false, ...candidatesFor(target, tree.rootNode, sourceText) };
  } catch {
    return { unavailable: true, reason: "source text could not be parsed as supported JavaScript" };
  } finally {
    tree?.delete();
    parser.delete();
  }
}

export function resolveBoundedJavaScriptTestCaseTargetFromSourceText(value = {}) {
  const rawTargetInput = value.target ?? value;
  const target = targetFrom(rawTargetInput);
  const rawTargetPath =
    rawTargetInput && typeof rawTargetInput === "object" && !Array.isArray(rawTargetInput) ? rawTargetInput.path : undefined;
  const sourceText = typeof (value.source_text ?? value.sourceText) === "string" ? (value.source_text ?? value.sourceText).replace(/\r\n?/gu, "\n") : null;
  const options = {
    source_record_digest: value.source_record_digest ?? value.sourceRecordDigest,
    selected_unit: value.selected_unit ?? value.selectedUnit ?? value.unit,
    payload_bound_input_digest: value.payload_bound_input_digest ?? value.payloadBoundInputDigest ?? value.expected_payload_bound_input_digest
  };
  if (!target.operation) {
    return evidence(target, "provider_unavailable", "declared target operation was missing or unsupported", options);
  }
  if (!target.name) {
    return evidence(target, "provider_unavailable", "declared target name was missing or unsupported", options);
  }
  if (!target.path) return evidence(target, "missing_path", "declared target path was unavailable to the provider", options);
  if (!sourceText || sourceText.trim().length === 0) return evidence(target, "provider_unavailable", "no bounded source text supplied for expected_edit_targets entry", options);
  if (target.operation === "create") {

    if (!isSupportedRepositoryTestFilePath(rawTargetPath)) {
      return evidence(target, "provider_unavailable", "target path is not a supported repository JavaScript test file", options);
    }
    return evidence(target, "not_applicable", "create target; no pre-existing symbol expected", options);
  }
  if (!WORK_RECORD_TARGET_TEST_CASE_RESOLVER_SUPPORTED_KIND_VALUES.has(target.kind)) return evidence(target, "unsupported_kind", "provider does not support the declared target kind", options);
  if (!isSupportedRepositoryTestFilePath(rawTargetPath)) return evidence(target, "provider_unavailable", "target path is not a supported repository JavaScript test file", options);
  const parsed = parseCandidates(target, sourceText);
  if (parsed.unavailable) return evidence(target, "provider_unavailable", parsed.reason, options);
  if (parsed.hasBindingConflict) {
    return evidence(target, "provider_unavailable", "supported node:test binding conflicted with a module-scope declaration", options);
  }
  if (!parsed.hasBinding) return evidence(target, "provider_unavailable", "no supported explicit node:test binding was found", options);
  if (parsed.candidates.length === 0) return evidence(target, "unresolved", "no supported target matched the declared target", options);
  if (parsed.candidates.length > 1) {
    return evidence(target, "ambiguous", "multiple candidates matched and no deterministic winner was selected", {
      ...options,
      candidateCount: parsed.candidates.length,
      candidates: parsed.candidates,
      span: spanFrom(Math.min(...parsed.candidates.map((candidate) => candidate.span.start_line)), Math.max(...parsed.candidates.map((candidate) => candidate.span.end_line)))
    });
  }
  return evidence(target, "resolved", "exactly one target span or structural target was identified", { ...options, candidateCount: 1, span: parsed.candidates[0].span });
}
