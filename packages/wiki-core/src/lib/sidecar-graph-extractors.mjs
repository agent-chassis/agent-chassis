import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { Language, Parser } from "web-tree-sitter";

import {
  SIDECAR_ENVELOPE_REQUIRED_FIELDS,
  SIDECAR_RESULT_ITEM_REQUIRED_FIELDS
} from "./sidecar-schema.mjs";
import {
  SIDECAR_DIRTY_GRAPH_MODE_VALUES,
  SIDECAR_GRAPH_EDGE_KIND_VALUES,
  SIDECAR_GRAPH_EDGE_SOURCE_VALUES,
  SIDECAR_GRAPH_NODE_KIND_VALUES,
  SIDECAR_GRAPH_SCHEMA_VERSION,
  SIDECAR_GRAPH_STATE_REQUIRED_FIELDS,
  SIDECAR_MISSING_UPDATE_HINT_REQUIRED_FIELDS,
  SIDECAR_STRUCTURAL_IMPACT_REQUIRED_FIELDS,
  createSidecarGraphState
} from "./sidecar-graph-schema.mjs";
import { filterSidecarSourcePaths } from "./sidecar-paths.mjs";

const CODE_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".py",
  ".ts",
  ".tsx"
]);
const TEXT_EXTENSIONS = new Set([...CODE_EXTENSIONS, ".json", ".md"]);
const LOCAL_IMPORT_PREFIX = /^\.{1,2}\//;
const PYTHON_RELATIVE_IMPORT_PREFIX = /^\.+/;
const WASM_GRAMMAR_PACKAGE_NAME = "@vscode/tree-sitter-wasm";
const WORK_ITEM_PATH_PATTERN = /^wiki\/(?:issues|initiatives)\/(?:WK|IN)-\d{4}\.md$/;
const DOCS_CONTRACT_PATH_PATTERN = /^docs\/.+\.md$/;
const TEST_PATH_PATTERN = /(^tests\/|(?:^|\/)[^/]+(?:\.test|\.spec)\.[^.]+$)/;
const REPO_PATH_PATTERN = /\b(?:docs|packages|tests|wiki)\/[A-Za-z0-9._/-]+/g;
const TRAILING_PATH_PUNCTUATION = /[),.;:\]"'`]+$/;
const require = createRequire(import.meta.url);
const WEB_TREE_SITTER_ROOT = path.dirname(require.resolve("web-tree-sitter"));
const WASM_GRAMMAR_ROOT = path.dirname(require.resolve(`${WASM_GRAMMAR_PACKAGE_NAME}/package.json`));
const WEB_TREE_SITTER_VERSION = readPackageVersion(path.join(WEB_TREE_SITTER_ROOT, "package.json"));
const WASM_GRAMMAR_PACKAGE_VERSION = readPackageVersion(path.join(WASM_GRAMMAR_ROOT, "package.json"));

const LANGUAGE_SPECS = Object.freeze({
  javascript: {
    language: "javascript",
    grammar: "tree-sitter-javascript",
    grammarVersion: "0.25.0",
    wasmFile: "tree-sitter-javascript.wasm",
    constructs: ["import", "require", "re_export_from", "dynamic_import"]
  },
  python: {
    language: "python",
    grammar: "tree-sitter-python",
    grammarVersion: "0.25.0",
    wasmFile: "tree-sitter-python.wasm",
    constructs: ["import", "from_import"]
  },
  tsx: {
    language: "tsx",
    grammar: "tree-sitter-tsx",
    grammarVersion: "0.23.2",
    wasmFile: "tree-sitter-tsx.wasm",
    constructs: ["import", "require", "re_export_from", "dynamic_import"]
  },
  typescript: {
    language: "typescript",
    grammar: "tree-sitter-typescript",
    grammarVersion: "0.23.2",
    wasmFile: "tree-sitter-typescript.wasm",
    constructs: ["import", "require", "re_export_from", "dynamic_import"]
  }
});

let treeSitterProviderPromise = null;

const GRAPH_IMPACT_RESPONSE_FIELDS = Object.freeze([
  "query_kind",
  "input_paths",
  "validated_paths",
  "invalid_paths",
  "validation_hints",
  "graph_state",
  "graph_nodes",
  "graph_edges",
  "structural_impacts",
  "missing_update_hints",
  "canonical_refs",
  "derived_evidence"
]);

const SCHEMA_FIELD_NAMES = Object.freeze([
  ...new Set([
    ...SIDECAR_ENVELOPE_REQUIRED_FIELDS,
    ...SIDECAR_RESULT_ITEM_REQUIRED_FIELDS,
    ...SIDECAR_GRAPH_STATE_REQUIRED_FIELDS,
    ...SIDECAR_STRUCTURAL_IMPACT_REQUIRED_FIELDS,
    ...SIDECAR_MISSING_UPDATE_HINT_REQUIRED_FIELDS,
    ...GRAPH_IMPACT_RESPONSE_FIELDS,
    "graph",
    "graph_schema_version",
    "graph_nodes",
    "graph_edges",
    "graph_available",
    "edge_source",
    "dirty_graph_mode",
    "unavailable_paths",
    "overlay_state"
  ])
]);

function provenance({ evidenceBasis = "parser_extract", path: relativePath = null, line = null } = {}) {
  return {
    source_kind: "code_index",
    canonicality: "derived",
    evidence_basis: evidenceBasis,
    ...(relativePath ? { path: relativePath } : {}),
    ...(line ? { line } : {})
  };
}

function parserSymbolProvenance({ path: relativePath, line = null }) {
  return {
    source_kind: "parser_symbol",
    canonicality: "derived",
    evidence_basis: "parser_symbol",
    ...(relativePath ? { path: relativePath } : {}),
    ...(line ? { line } : {})
  };
}

function readPackageVersion(packageJsonPath) {
  const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  return parsed.version;
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value))];
}

function lineForOffset(text, offset) {
  return String(text).slice(0, offset).split("\n").length;
}

function isTextGraphSource(relativePath) {
  return TEXT_EXTENSIONS.has(path.posix.extname(relativePath));
}

function isCodePath(relativePath) {
  return CODE_EXTENSIONS.has(path.posix.extname(relativePath));
}

function isTestPath(relativePath) {
  return TEST_PATH_PATTERN.test(relativePath);
}

function isDocsContractPath(relativePath) {
  return DOCS_CONTRACT_PATH_PATTERN.test(relativePath);
}

function isWorkItemPath(relativePath) {
  return WORK_ITEM_PATH_PATTERN.test(relativePath);
}

function nodeId(kind, key) {
  return `${kind}:${key}`;
}

function edgeId(kind, fromNodeId, toNodeId, discriminator = "") {
  return `edge:${kind}:${fromNodeId}->${toNodeId}${discriminator ? `:${discriminator}` : ""}`;
}

function sortById(left, right) {
  return left.id.localeCompare(right.id);
}

function assertControlledKind(kind, values, label) {
  if (!values.includes(kind)) {
    throw new Error(`unsupported sidecar graph ${label} kind: ${kind}`);
  }
}

function escapeRegexLiteral(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createGraphBuilder() {
  const nodes = new Map();
  const edges = new Map();

  function addNode(kind, key, attributes = {}) {
    assertControlledKind(kind, SIDECAR_GRAPH_NODE_KIND_VALUES, "node");
    const id = nodeId(kind, key);
    const existing = nodes.get(id);
    const next = {
      id,
      kind,
      ...attributes,
      provenance: attributes.provenance || provenance({ path: attributes.path ?? null })
    };
    nodes.set(id, existing ? { ...existing, ...next } : next);
    return id;
  }

  function addEdge(kind, fromNodeId, toNodeId, attributes = {}) {
    assertControlledKind(kind, SIDECAR_GRAPH_EDGE_KIND_VALUES, "edge");
    const id = edgeId(kind, fromNodeId, toNodeId, attributes.discriminator);
    const existing = edges.get(id);
    const next = {
      id,
      kind,
      from_node_id: fromNodeId,
      to_node_id: toNodeId,
      ...attributes,
      provenance: attributes.provenance || provenance({ path: attributes.path ?? null })
    };
    delete next.discriminator;
    edges.set(id, existing ? { ...existing, ...next } : next);
    return id;
  }

  return {
    addNode,
    addEdge,
    graphNodes() {
      return [...nodes.values()].sort(sortById);
    },
    graphEdges() {
      return [...edges.values()].sort(sortById);
    }
  };
}

function stripYamlScalar(value) {
  const trimmed = String(value ?? "").trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseInlineList(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return null;
  }
  return trimmed
    .slice(1, -1)
    .split(",")
    .map(stripYamlScalar)
    .filter(Boolean);
}

function parseFrontmatter(markdown) {
  const text = String(markdown ?? "");
  if (!text.startsWith("---\n")) {
    return {};
  }
  const end = text.indexOf("\n---", 4);
  if (end === -1) {
    return {};
  }

  const frontmatter = {};
  let currentKey = null;
  for (const line of text.slice(4, end).split("\n")) {
    const listMatch = line.match(/^\s+-\s+(.+)$/);
    if (listMatch && currentKey) {
      if (!Array.isArray(frontmatter[currentKey])) {
        frontmatter[currentKey] = [];
      }
      frontmatter[currentKey].push(stripYamlScalar(listMatch[1]));
      continue;
    }

    const scalarMatch = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!scalarMatch) {
      currentKey = null;
      continue;
    }

    currentKey = scalarMatch[1];
    const rawValue = scalarMatch[2] ?? "";
    const inlineList = parseInlineList(rawValue);
    frontmatter[currentKey] = inlineList ?? stripYamlScalar(rawValue);
  }
  return frontmatter;
}

function normalizeGraphSources(inputSources) {
  const sourcePaths = inputSources
    .map((source) => source?.path)
    .filter((sourcePath) => typeof sourcePath === "string");
  const sourceFilter = filterSidecarSourcePaths(sourcePaths);
  const included = new Set(sourceFilter.included);
  const sources = [];
  const unsupported = [];

  for (const source of inputSources) {
    if (!source || !included.has(source.path)) {
      continue;
    }
    if (!isTextGraphSource(source.path) || typeof source.content !== "string") {
      unsupported.push(source.path);
      continue;
    }
    sources.push({
      path: source.path,
      content: source.content,
      worktree_overlay: Boolean(source.worktree_overlay),
      dirty_state: source.dirty_state ?? null
    });
  }

  return {
    sources: sources.sort((left, right) => left.path.localeCompare(right.path)),
    rejected: sourceFilter.rejected,
    unsupported: uniqueStrings(unsupported).sort((left, right) => left.localeCompare(right))
  };
}

function localImportCandidates(basePath, languageKey) {
  if (path.posix.extname(basePath)) {
    return [basePath];
  }

  if (languageKey === "python") {
    return [
      `${basePath}.py`,
      path.posix.join(basePath, "__init__.py")
    ];
  }

  return [
    `${basePath}.mjs`,
    `${basePath}.js`,
    `${basePath}.ts`,
    `${basePath}.cjs`,
    `${basePath}.mts`,
    `${basePath}.cts`,
    `${basePath}.jsx`,
    `${basePath}.tsx`,
    `${basePath}.py`,
    path.posix.join(basePath, "index.mjs"),
    path.posix.join(basePath, "index.js"),
    path.posix.join(basePath, "index.ts"),
    path.posix.join(basePath, "__init__.py")
  ];
}

function resolveLocalImport(fromPath, specifier, sourcePathSet, { languageKey = null } = {}) {
  if (!LOCAL_IMPORT_PREFIX.test(specifier)) {
    return {
      targetPath: null,
      moduleKey: null,
      external: true,
      resolved: false,
      unresolvedReason: "external_or_unresolved"
    };
  }

  const basePath = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), specifier));
  const candidates = localImportCandidates(basePath, languageKey);
  const matchedCandidates = candidates.filter((candidate) => sourcePathSet.has(candidate));
  if (matchedCandidates.length > 1) {
    return {
      targetPath: null,
      moduleKey: null,
      external: false,
      resolved: false,
      unresolvedReason: "ambiguous_local_path",
      candidatePaths: matchedCandidates
    };
  }
  const targetPath = matchedCandidates[0] ?? null;
  const resolutionBasis =
    targetPath && targetPath === basePath ? "exact_path" : targetPath ? "extension_guess" : null;
  return {
    targetPath,
    moduleKey: targetPath,
    external: false,
    resolved: Boolean(targetPath),
    unresolvedReason: targetPath ? null : "local_path_unresolved",
    resolutionBasis
  };
}

function addFileNode(builder, relativePath, attributes = {}) {
  return builder.addNode("file", relativePath, {
    path: relativePath,
    ...attributes,
    provenance: provenance({
      evidenceBasis: attributes.worktree_overlay ? "git_tree" : "git_blob",
      path: relativePath
    })
  });
}

function addSchemaFieldMentions(builder, { sourceNodeId, relativePath, text }) {
  for (const fieldName of SCHEMA_FIELD_NAMES) {
    const pattern = new RegExp(`\\b${escapeRegexLiteral(fieldName)}\\b`, "g");
    let match;
    while ((match = pattern.exec(text)) != null) {
      const line = lineForOffset(text, match.index);
      const fieldNodeId = builder.addNode("schema_field", fieldName, {
        name: fieldName,
        provenance: provenance({ evidenceBasis: "parser_extract", path: relativePath, line })
      });
      builder.addEdge("mentions_schema_field", sourceNodeId, fieldNodeId, {
        path: relativePath,
        line,
        discriminator: `${relativePath}:${fieldName}:${line}`,
        provenance: provenance({ path: relativePath, line })
      });
      break;
    }
  }
}

function addFunctions(builder, { moduleNodeId, relativePath, text }) {
  const seen = new Set();
  const patterns = [
    /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
    /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\b/g
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) != null) {
      const name = match[1];
      if (seen.has(name)) {
        continue;
      }
      seen.add(name);
      const line = lineForOffset(text, match.index);
      const functionNodeId = builder.addNode("function", `${relativePath}:${name}`, {
        path: relativePath,
        name,
        line,
        provenance: provenance({ path: relativePath, line })
      });
      builder.addEdge("contains", moduleNodeId, functionNodeId, {
        path: relativePath,
        line,
        discriminator: name,
        provenance: provenance({ path: relativePath, line })
      });
    }
  }
}

function exportedNamesFromList(listText) {
  return listText
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.split(/\s+as\s+/).pop().trim())
    .filter((entry) => /^[A-Za-z_$][\w$]*$/.test(entry));
}

function addExports(builder, { moduleNodeId, relativePath, text }) {
  const exportMatches = [
    ...text.matchAll(/\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g),
    ...text.matchAll(/\bexport\s+(?:class|const|let|var)\s+([A-Za-z_$][\w$]*)\b/g)
  ].map((match) => ({ name: match[1], index: match.index ?? 0 }));

  for (const match of text.matchAll(/\bexport\s*\{([^}]+)\}/g)) {
    for (const name of exportedNamesFromList(match[1])) {
      exportMatches.push({ name, index: match.index ?? 0 });
    }
  }

  if (/\bexport\s+default\b/.test(text)) {
    const match = text.match(/\bexport\s+default\b/);
    exportMatches.push({ name: "default", index: match?.index ?? 0 });
  }

  for (const { name, index } of exportMatches) {
    const line = lineForOffset(text, index);
    const exportNodeId = builder.addNode("export", `${relativePath}:${name}`, {
      path: relativePath,
      name,
      line,
      provenance: provenance({ path: relativePath, line })
    });
    builder.addEdge("defines_export", moduleNodeId, exportNodeId, {
      path: relativePath,
      line,
      discriminator: name,
      provenance: provenance({ path: relativePath, line })
    });
  }
}

function languageKeyForPath(relativePath) {
  const extension = path.posix.extname(relativePath);
  if (extension === ".py") {
    return "python";
  }
  if (extension === ".tsx") {
    return "tsx";
  }
  if ([".ts", ".mts", ".cts"].includes(extension)) {
    return "typescript";
  }
  if ([".cjs", ".js", ".jsx", ".mjs"].includes(extension)) {
    return "javascript";
  }
  return null;
}

function wasmGrammarPath(wasmFile) {
  return path.join(WASM_GRAMMAR_ROOT, "wasm", wasmFile);
}

async function loadTreeSitterProvider() {
  if (!treeSitterProviderPromise) {
    treeSitterProviderPromise = loadTreeSitterProviderUncached();
  }
  return treeSitterProviderPromise;
}

async function loadTreeSitterProviderUncached() {
  try {
    await Parser.init({
      locateFile(file) {
        return path.join(WEB_TREE_SITTER_ROOT, file);
      }
    });

    const languages = new Map();
    for (const [key, spec] of Object.entries(LANGUAGE_SPECS)) {
      languages.set(key, await Language.load(wasmGrammarPath(spec.wasmFile)));
    }

    return { available: true, languages };
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

function providerDescriptorForLanguage(languageKey) {
  const spec = LANGUAGE_SPECS[languageKey];
  return {
    name: "web-tree-sitter",
    runtime: "wasm",
    runtime_version: WEB_TREE_SITTER_VERSION,
    grammar: spec.grammar,
    grammar_version: spec.grammarVersion,
    cache_key: `web-tree-sitter@${WEB_TREE_SITTER_VERSION}:${WASM_GRAMMAR_PACKAGE_NAME}@${WASM_GRAMMAR_PACKAGE_VERSION}:${spec.grammar}@${spec.grammarVersion}`
  };
}

function coverageForLanguage(languageKey) {
  const spec = LANGUAGE_SPECS[languageKey];
  return {
    language: spec.language,
    status: "parsed",
    constructs: spec.constructs
  };
}

function confidenceForImportFact(fact) {
  if (fact.dynamic) {
    return { value: 0.5, basis: "non_literal_dynamic_boundary" };
  }
  if (fact.unresolvedReason === "ambiguous_local_path") {
    return { value: 0.25, basis: "literal_ast_specifier_ambiguous_extension_guess" };
  }
  if (fact.resolutionState === "resolved") {
    if (fact.resolutionBasis === "extension_guess") {
      return { value: 0.85, basis: "literal_ast_specifier_resolved_by_extension_guess" };
    }
    return { value: 0.95, basis: "literal_ast_specifier_resolved_exact_path" };
  }
  return { value: 0.25, basis: "literal_ast_specifier_unresolved" };
}

function uncertaintyForImportFact(fact) {
  if (fact.dynamic) {
    return { level: "medium", reasons: ["non_literal_specifier"] };
  }
  if (fact.unresolvedReason === "ambiguous_local_path") {
    return { level: "high", reasons: ["ambiguous_local_path"] };
  }
  if (fact.resolutionBasis === "extension_guess") {
    return { level: "low", reasons: ["extensionless_local_path_guess"] };
  }
  if (fact.resolutionState === "unresolved") {
    return { level: "medium", reasons: [fact.unresolvedReason || "unresolved_specifier"] };
  }
  return { level: "low", reasons: [] };
}

function parserMetadata({ fact, relativePath, line }) {
  return {
    provider_descriptor: providerDescriptorForLanguage(fact.languageKey),
    coverage: coverageForLanguage(fact.languageKey),
    confidence: confidenceForImportFact(fact),
    uncertainty: uncertaintyForImportFact(fact),
    resolution: {
      state: fact.resolutionState,
      dynamic_boundary: Boolean(fact.dynamic),
      ...(fact.resolutionBasis ? { basis: fact.resolutionBasis } : {}),
      ...(fact.unresolvedReason ? { unresolved_reason: fact.unresolvedReason } : {})
    },
    provenance: parserSymbolProvenance({ path: relativePath, line })
  };
}

function textForNode(text, node) {
  return text.slice(node.startIndex, node.endIndex);
}

function namedChildren(node) {
  return Array.from({ length: node.namedChildCount }, (_, index) => node.namedChild(index));
}

function firstNamedChildOfType(node, type) {
  return namedChildren(node).find((child) => child?.type === type) ?? null;
}

function firstArgumentNode(callNode) {
  const argumentsNode = firstNamedChildOfType(callNode, "arguments");
  return argumentsNode ? namedChildren(argumentsNode)[0] ?? null : null;
}

function stringLiteralValue(text, node) {
  if (!node || node.type !== "string") {
    return null;
  }
  const raw = textForNode(text, node);
  if (raw.length < 2) {
    return null;
  }
  const quote = raw[0];
  if ((quote !== "\"" && quote !== "'") || raw.at(-1) !== quote) {
    return null;
  }
  return raw.slice(1, -1);
}

function collectJavaScriptImportFacts({ rootNode, text, languageKey }) {
  const facts = [];

  function addLiteralFact({ node, sourceNode, construct }) {
    const specifier = stringLiteralValue(text, sourceNode);
    if (specifier == null) {
      return;
    }
    facts.push({
      construct,
      dynamic: false,
      index: node.startIndex,
      languageKey,
      specifier
    });
  }

  function addDynamicFact({ node, argumentNode, construct }) {
    const specifier = stringLiteralValue(text, argumentNode);
    facts.push({
      construct,
      dynamic: specifier == null,
      index: node.startIndex,
      languageKey,
      raw_specifier: argumentNode ? textForNode(text, argumentNode) : null,
      specifier
    });
  }

  function visit(node) {
    if (node.type === "import_statement") {
      const sourceNode = node.childForFieldName("source") || firstNamedChildOfType(node, "string");
      addLiteralFact({ node, sourceNode, construct: "import" });
    } else if (node.type === "export_statement") {
      const sourceNode = firstNamedChildOfType(node, "string");
      if (sourceNode) {
        addLiteralFact({ node, sourceNode, construct: "re_export_from" });
      }
    } else if (node.type === "call_expression") {
      const functionNode = node.childForFieldName("function") || namedChildren(node)[0];
      const functionText = functionNode ? textForNode(text, functionNode) : "";
      if (functionNode?.type === "import") {
        addDynamicFact({
          node,
          argumentNode: firstArgumentNode(node),
          construct: "dynamic_import"
        });
      } else if (functionText === "require") {
        addDynamicFact({
          node,
          argumentNode: firstArgumentNode(node),
          construct: "require"
        });
      }
    }

    for (const child of namedChildren(node)) {
      visit(child);
    }
  }

  visit(rootNode);
  return facts.sort((left, right) => left.index - right.index);
}

function pythonRelativeImportToLocalSpecifier(value) {
  const prefix = value.match(PYTHON_RELATIVE_IMPORT_PREFIX)?.[0] ?? "";
  if (!prefix) {
    return null;
  }
  const remainder = value.slice(prefix.length);
  const directoryPrefix =
    prefix.length === 1 ? "." : Array.from({ length: prefix.length - 1 }, () => "..").join("/");
  return `${directoryPrefix}/${remainder.replaceAll(".", "/")}`.replace(/\/$/, "");
}

function firstPythonImportName(node, text) {
  const named = namedChildren(node);
  const aliased = named.find((child) => child.type === "aliased_import");
  if (aliased) {
    const dotted = firstNamedChildOfType(aliased, "dotted_name");
    return dotted ? textForNode(text, dotted) : null;
  }
  const dotted = named.find((child) => child.type === "dotted_name");
  return dotted ? textForNode(text, dotted) : null;
}

function collectPythonImportFacts({ rootNode, text, languageKey }) {
  const facts = [];

  function visit(node) {
    if (node.type === "import_statement") {
      for (const child of namedChildren(node)) {
        const specifier = child.type === "aliased_import" ? firstPythonImportName(child, text) : textForNode(text, child);
        if (specifier) {
          facts.push({
            construct: "import",
            dynamic: false,
            index: child.startIndex,
            languageKey,
            specifier
          });
        }
      }
    } else if (node.type === "import_from_statement") {
      const importRoot = namedChildren(node).find((child) =>
        ["relative_import", "dotted_name"].includes(child.type)
      );
      if (importRoot) {
        const rawSpecifier = textForNode(text, importRoot);
        facts.push({
          construct: "from_import",
          dynamic: false,
          index: node.startIndex,
          languageKey,
          raw_specifier: rawSpecifier,
          specifier:
            importRoot.type === "relative_import"
              ? pythonRelativeImportToLocalSpecifier(rawSpecifier)
              : rawSpecifier
        });
      }
    }

    for (const child of namedChildren(node)) {
      visit(child);
    }
  }

  visit(rootNode);
  return facts.sort((left, right) => left.index - right.index);
}

function parseImportFacts({ provider, relativePath, text }) {
  const languageKey = languageKeyForPath(relativePath);
  const language = provider.languages.get(languageKey);
  if (!languageKey || !language) {
    return { facts: [], unavailable: true, reason: "unsupported_language" };
  }

  const parser = new Parser();
  let tree = null;
  try {
    parser.setLanguage(language);
    tree = parser.parse(text);
    const facts =
      languageKey === "python"
        ? collectPythonImportFacts({ rootNode: tree.rootNode, text, languageKey })
        : collectJavaScriptImportFacts({ rootNode: tree.rootNode, text, languageKey });
    return { facts, unavailable: false };
  } catch (error) {
    return {
      facts: [],
      unavailable: true,
      reason: error instanceof Error ? error.message : String(error)
    };
  } finally {
    tree?.delete();
    parser.delete();
  }
}

function resolveImportFacts({ facts, relativePath, sourcePathSet }) {
  return facts.map((fact) => {
    if (fact.dynamic || !fact.specifier) {
      return {
        ...fact,
        resolutionState: "dynamic",
        unresolvedReason: "non_literal_specifier"
      };
    }
    const target = resolveLocalImport(relativePath, fact.specifier, sourcePathSet, {
      languageKey: fact.languageKey
    });
    if (!target.resolved) {
      return {
        ...fact,
        external: target.external,
        resolutionState: "unresolved",
        targetPath: null,
        unresolvedReason: target.unresolvedReason,
        candidatePaths: target.candidatePaths ?? []
      };
    }
    return {
      ...fact,
      external: target.external,
      resolutionState: "resolved",
      targetPath: target.targetPath,
      moduleKey: target.moduleKey,
      resolutionBasis: target.resolutionBasis
    };
  });
}

function addImports(builder, { moduleNodeId, relativePath, text, importFacts }) {
  importFacts.forEach((fact, importIndex) => {
    const line = lineForOffset(text, fact.index);
    const metadata = parserMetadata({ fact, relativePath, line });
    const specifier = fact.specifier ?? fact.raw_specifier ?? "<dynamic>";
    const importNodeId = builder.addNode("import", `${relativePath}:${importIndex}:${specifier}`, {
      path: relativePath,
      specifier: fact.specifier ?? null,
      raw_specifier: fact.raw_specifier ?? null,
      construct: fact.construct,
      line,
      ...metadata
    });
    builder.addEdge("contains", moduleNodeId, importNodeId, {
      path: relativePath,
      line,
      discriminator: `${specifier}:${importIndex}`,
      provenance: provenance({ path: relativePath, line })
    });

    if (fact.resolutionState !== "resolved" || !fact.targetPath) {
      return;
    }

    const targetModuleNodeId = builder.addNode("module", fact.moduleKey, {
      path: fact.targetPath,
      specifier: fact.specifier,
      external: fact.external,
      ...metadata
    });
    builder.addEdge("imports_module", moduleNodeId, targetModuleNodeId, {
      path: relativePath,
      specifier: fact.specifier,
      target_path: fact.targetPath,
      external: fact.external,
      line,
      discriminator: `${specifier}:${importIndex}`,
      ...metadata
    });
  });
}

function addCliCommands(builder, { moduleNodeId, relativePath, text }) {
  if (!relativePath.includes("-cli/") && !relativePath.endsWith("/run.mjs")) {
    return;
  }

  for (const match of text.matchAll(/\bcase\s+["']([A-Za-z0-9:_-]+)["']\s*:/g)) {
    const command = match[1];
    const line = lineForOffset(text, match.index ?? 0);
    const commandNodeId = builder.addNode("cli_command", `${relativePath}:${command}`, {
      path: relativePath,
      name: command,
      line,
      provenance: provenance({ path: relativePath, line })
    });
    builder.addEdge("registers_cli_command", moduleNodeId, commandNodeId, {
      path: relativePath,
      line,
      discriminator: command,
      provenance: provenance({ path: relativePath, line })
    });
  }
}

function addMcpTools(builder, { moduleNodeId, relativePath, text }) {
  for (const match of text.matchAll(/\b(?:server\.)?registerTool\s*\(\s*["']([^"']+)["']/g)) {
    const toolName = match[1];
    const line = lineForOffset(text, match.index ?? 0);
    const toolNodeId = builder.addNode("mcp_tool", `${relativePath}:${toolName}`, {
      path: relativePath,
      name: toolName,
      line,
      provenance: provenance({ path: relativePath, line })
    });
    builder.addEdge("registers_mcp_tool", moduleNodeId, toolNodeId, {
      path: relativePath,
      line,
      discriminator: toolName,
      provenance: provenance({ path: relativePath, line })
    });
  }
}

function addCodeGraph(builder, source, sourcePathSet, parserProvider) {
  const fileNodeId = addFileNode(builder, source.path, {
    worktree_overlay: source.worktree_overlay,
    dirty_state: source.dirty_state
  });
  const moduleNodeId = builder.addNode("module", source.path, {
    path: source.path,
    provenance: provenance({
      evidenceBasis: source.worktree_overlay ? "git_tree" : "git_blob",
      path: source.path
    })
  });
  builder.addEdge("contains", fileNodeId, moduleNodeId, {
    path: source.path,
    provenance: provenance({ evidenceBasis: "path_match", path: source.path })
  });

  const parsedImports = parseImportFacts({
    provider: parserProvider,
    relativePath: source.path,
    text: source.content
  });
  const importFacts = resolveImportFacts({
    facts: parsedImports.facts,
    relativePath: source.path,
    sourcePathSet
  });
  addImports(builder, {
    moduleNodeId,
    relativePath: source.path,
    text: source.content,
    importFacts
  });
  addExports(builder, { moduleNodeId, relativePath: source.path, text: source.content });
  addFunctions(builder, { moduleNodeId, relativePath: source.path, text: source.content });
  addCliCommands(builder, { moduleNodeId, relativePath: source.path, text: source.content });
  addMcpTools(builder, { moduleNodeId, relativePath: source.path, text: source.content });
  addSchemaFieldMentions(builder, {
    sourceNodeId: moduleNodeId,
    relativePath: source.path,
    text: source.content
  });

  if (isTestPath(source.path)) {
    const testNodeId = builder.addNode("test", source.path, {
      path: source.path,
      provenance: provenance({ evidenceBasis: "path_match", path: source.path })
    });
    builder.addEdge("contains", fileNodeId, testNodeId, {
      path: source.path,
      provenance: provenance({ evidenceBasis: "path_match", path: source.path })
    });
    for (const fact of importFacts) {
      if (fact.resolutionState !== "resolved" || !fact.targetPath || !sourcePathSet.has(fact.targetPath)) {
        continue;
      }
      const line = lineForOffset(source.content, fact.index);
      const metadata = parserMetadata({ fact, relativePath: source.path, line });
      const targetModuleNodeId = builder.addNode("module", fact.targetPath, {
        path: fact.targetPath,
        ...metadata
      });
      builder.addEdge("covers_test", testNodeId, targetModuleNodeId, {
        path: source.path,
        target_path: fact.targetPath,
        specifier: fact.specifier,
        line,
        discriminator: `${fact.specifier}:${fact.index}`,
        ...metadata
      });
    }
  }

  return parsedImports.unavailable ? source.path : null;
}

function cleanMentionedRepoPath(value) {
  const cleaned = String(value ?? "").replace(TRAILING_PATH_PUNCTUATION, "");
  return cleaned.includes("..") ? null : cleaned;
}

function addDocsContractGraph(builder, source, sourcePathSet) {
  const fileNodeId = addFileNode(builder, source.path, {
    worktree_overlay: source.worktree_overlay,
    dirty_state: source.dirty_state
  });
  const docsNodeId = builder.addNode("docs_contract", source.path, {
    path: source.path,
    provenance: provenance({ evidenceBasis: "docs_backlink", path: source.path })
  });
  builder.addEdge("contains", fileNodeId, docsNodeId, {
    path: source.path,
    provenance: provenance({ evidenceBasis: "path_match", path: source.path })
  });
  addSchemaFieldMentions(builder, {
    sourceNodeId: docsNodeId,
    relativePath: source.path,
    text: source.content
  });

  for (const match of source.content.matchAll(REPO_PATH_PATTERN)) {
    const mentionedPath = cleanMentionedRepoPath(match[0]);
    if (!mentionedPath || !sourcePathSet.has(mentionedPath)) {
      continue;
    }
    const targetFileNodeId = addFileNode(builder, mentionedPath);
    builder.addEdge("documents_contract", docsNodeId, targetFileNodeId, {
      path: source.path,
      target_path: mentionedPath,
      line: lineForOffset(source.content, match.index ?? 0),
      discriminator: mentionedPath,
      provenance: provenance({
        evidenceBasis: "docs_backlink",
        path: source.path,
        line: lineForOffset(source.content, match.index ?? 0)
      })
    });
  }
}

function listFrontmatterValues(frontmatter, key) {
  const value = frontmatter[key];
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function workItemIdFromPath(relativePath) {
  return path.posix.basename(relativePath, ".md");
}

function addWorkItemGraph(builder, source) {
  const frontmatter = parseFrontmatter(source.content);
  const workId = frontmatter.id || workItemIdFromPath(source.path);
  const fileNodeId = addFileNode(builder, source.path, {
    worktree_overlay: source.worktree_overlay,
    dirty_state: source.dirty_state
  });
  const workNodeId = builder.addNode("work_item", workId, {
    path: source.path,
    work_id: workId,
    work_item_kind: workId.startsWith("IN-") ? "initiative" : "issue",
    provenance: provenance({ evidenceBasis: "explicit_metadata", path: source.path })
  });
  builder.addEdge("contains", fileNodeId, workNodeId, {
    path: source.path,
    provenance: provenance({ evidenceBasis: "path_match", path: source.path })
  });
  addSchemaFieldMentions(builder, {
    sourceNodeId: workNodeId,
    relativePath: source.path,
    text: source.content
  });

  for (const scopePath of listFrontmatterValues(frontmatter, "write_scope")) {
    const targetFileNodeId = addFileNode(builder, scopePath, {
      path_type: scopePath.endsWith("/") ? "directory" : "file"
    });
    builder.addEdge("owns_write_scope", workNodeId, targetFileNodeId, {
      path: source.path,
      target_path: scopePath,
      discriminator: scopePath,
      provenance: provenance({ evidenceBasis: "explicit_metadata", path: source.path })
    });
  }
}

export async function extractSidecarGraph({
  sources = [],
  edgeSource = "base_index",
  dirtyGraphMode = "base_index_only",
  parserProvider = null
} = {}) {
  if (!SIDECAR_GRAPH_EDGE_SOURCE_VALUES.includes(edgeSource)) {
    throw new Error(`unsupported sidecar graph edge source: ${edgeSource}`);
  }
  if (!SIDECAR_DIRTY_GRAPH_MODE_VALUES.includes(dirtyGraphMode)) {
    throw new Error(`unsupported sidecar dirty graph mode: ${dirtyGraphMode}`);
  }

  const normalized = normalizeGraphSources(sources);
  const builder = createGraphBuilder();
  const sourcePathSet = new Set(normalized.sources.map((source) => source.path));
  const unavailablePaths = [];
  const treeSitterProvider = parserProvider || (await loadTreeSitterProvider());

  if (!treeSitterProvider.available) {
    return createUnavailableParserGraph({
      normalized,
      edgeSource,
      dirtyGraphMode,
      reason: treeSitterProvider.reason
    });
  }

  for (const source of normalized.sources) {
    if (isCodePath(source.path)) {
      const unavailablePath = addCodeGraph(builder, source, sourcePathSet, treeSitterProvider);
      if (unavailablePath) {
        unavailablePaths.push(unavailablePath);
      }
      continue;
    }
    if (isDocsContractPath(source.path)) {
      addDocsContractGraph(builder, source, sourcePathSet);
      continue;
    }
    if (isWorkItemPath(source.path)) {
      addWorkItemGraph(builder, source);
      continue;
    }
    unavailablePaths.push(source.path);
    addFileNode(builder, source.path, {
      worktree_overlay: source.worktree_overlay,
      dirty_state: source.dirty_state
    });
  }

  const graphNodes = builder.graphNodes();
  const graphEdges = builder.graphEdges();
  const graphState = createSidecarGraphState({
    graph_schema_version: SIDECAR_GRAPH_SCHEMA_VERSION,
    graph_available: true,
    edge_source: edgeSource,
    dirty_graph_mode: dirtyGraphMode,
    unavailable_paths: unavailablePaths,
    status_reason: "graph_extracted"
  });

  return {
    graph_schema_version: SIDECAR_GRAPH_SCHEMA_VERSION,
    graph_nodes: graphNodes,
    graph_edges: graphEdges,
    graph_metadata: {
      graph_edge_source: edgeSource,
      dirty_graph_mode: dirtyGraphMode,
      source_count: sources.length,
      parsed_source_count: normalized.sources.length - unavailablePaths.length,
      rejected_source_count: normalized.rejected.length,
      unsupported_source_count: normalized.unsupported.length,
      node_count: graphNodes.length,
      edge_count: graphEdges.length,
      unavailable_paths: unavailablePaths,
      rejected_sources: normalized.rejected,
      unsupported_sources: normalized.unsupported
    },
    graph_state: graphState
  };
}

function createUnavailableParserGraph({ normalized, edgeSource, dirtyGraphMode, reason }) {
  const unavailablePaths = normalized.sources.map((source) => source.path);
  return {
    graph_schema_version: SIDECAR_GRAPH_SCHEMA_VERSION,
    graph_nodes: [],
    graph_edges: [],
    graph_metadata: {
      graph_edge_source: edgeSource,
      dirty_graph_mode: dirtyGraphMode,
      source_count: normalized.sources.length,
      parsed_source_count: 0,
      rejected_source_count: normalized.rejected.length,
      unsupported_source_count: normalized.unsupported.length + unavailablePaths.length,
      node_count: 0,
      edge_count: 0,
      unavailable_paths: unavailablePaths,
      rejected_sources: normalized.rejected,
      unsupported_sources: [...normalized.unsupported, ...unavailablePaths],
      parser_provider_unavailable_reason: reason
    },
    graph_state: createSidecarGraphState({
      graph_schema_version: SIDECAR_GRAPH_SCHEMA_VERSION,
      graph_available: false,
      edge_source: "unavailable",
      dirty_graph_mode: "unavailable",
      unavailable_paths: unavailablePaths,
      status_reason: "parser_symbol_provider_unavailable"
    })
  };
}
