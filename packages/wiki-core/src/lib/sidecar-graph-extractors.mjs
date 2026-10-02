import path from "node:path";

import {
  SIDECAR_ENVELOPE_REQUIRED_FIELDS,
  SIDECAR_RESULT_ITEM_REQUIRED_FIELDS
} from "./sidecar-schema.mjs";
import {
  SIDECAR_DIRTY_GRAPH_MODE_VALUES,
  SIDECAR_GRAPH_EDGE_SOURCE_VALUES,
  SIDECAR_GRAPH_SCHEMA_VERSION,
  SIDECAR_GRAPH_STATE_REQUIRED_FIELDS,
  SIDECAR_MISSING_UPDATE_HINT_REQUIRED_FIELDS,
  SIDECAR_STRUCTURAL_IMPACT_REQUIRED_FIELDS,
  createSidecarGraphState
} from "./sidecar-graph-schema.mjs";
import {
  createGraphContributionCollector,
  createGraphBuilder,
  createSidecarGraphProvenance as provenance
} from "./sidecar-graph-contributions.mjs";
import {
  coverageForLanguage,
  loadTreeSitterProvider,
  parseImportFacts,
  providerDescriptorForLanguage
} from "./sidecar-graph-import-facts.mjs";
import {
  importFactResolutionDependencies,
  resolveImportFacts
} from "./sidecar-graph-import-resolution.mjs";
import { SIDECAR_CODE_EXTENSIONS } from "./sidecar-language-descriptions.mjs";
import { filterSidecarSourcePaths, isSidecarRepoPath, normalizeSidecarRepoPath } from
  "./sidecar-paths.mjs";

const CODE_EXTENSIONS = new Set(SIDECAR_CODE_EXTENSIONS);
const TEXT_EXTENSIONS = new Set([...CODE_EXTENSIONS, ".json", ".md"]);
const WORK_ITEM_PATH_PATTERN = /^wiki\/(?:issues|initiatives)\/(?:WK|IN)-\d{4}\.md$/;
const DOCS_CONTRACT_PATH_PATTERN = /^docs\/.+\.md$/;
const TEST_PATH_PATTERN = /(^tests\/|(?:^|\/)[^/]+(?:\.test|\.spec)\.[^.]+$)/;
const REPO_PATH_PATTERN = /\b(?:docs|packages|tests|wiki)\/[A-Za-z0-9._/-]+/g;
const TRAILING_PATH_PUNCTUATION = /[),.;:\]"'`]+$/;
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

function parserSymbolProvenance({ path: relativePath, line = null }) {
  return {
    source_kind: "parser_symbol",
    canonicality: "derived",
    evidence_basis: "parser_symbol",
    ...(relativePath ? { path: relativePath } : {}),
    ...(line ? { line } : {})
  };
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

export function isSidecarGraphExtractionSourcePath(relativePath) {
  const sourceFilter = filterSidecarSourcePaths([relativePath]);
  return sourceFilter.included.length === 1 && isTextGraphSource(relativePath);
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

function escapeRegexLiteral(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    if (fact.resolutionBasis === "go_package_directory") {
      return { value: 0.9, basis: "literal_ast_import_path_resolved_by_committed_go_module" };
    }
    if (fact.resolutionBasis === "rust_module_file") {
      return { value: 0.9, basis: "literal_ast_module_path_resolved_by_committed_rust_module_file" };
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

function addImports(builder, { moduleNodeId, relativePath, text, importFacts }) {
  importFacts.forEach((fact, importIndex) => {
    const line = fact.line ?? lineForOffset(text, fact.index);
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

    if (fact.resolutionState !== "resolved") return;

    const targets = fact.targetPaths ?? (fact.targetPath ? [fact.targetPath] : []);
    for (const targetPath of targets) {
      const targetModuleNodeId = builder.addNode("module", fact.targetPaths ? targetPath : fact.moduleKey, {
        path: targetPath,
        specifier: fact.specifier,
        external: fact.external,
        ...metadata
      });
      builder.addEdge("imports_module", moduleNodeId, targetModuleNodeId, {
        path: relativePath,
        specifier: fact.specifier,
        target_path: targetPath,
        external: fact.external,
        line,
        discriminator: fact.targetPaths ? `${specifier}:${importIndex}:${targetPath}` : `${specifier}:${importIndex}`,
        ...metadata
      });
    }
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

function addCodeGraph(builder, source, sourcePathSet, parserProvider, goModules, rustCrates) {
  addCodeLocalGraph(builder, source);
  const parsedImports = parseImportFacts({
    provider: parserProvider,
    relativePath: source.path,
    text: source.content
  });
  const importFacts = resolveImportFacts({
    facts: parsedImports.facts,
    relativePath: source.path,
    sourcePathSet,
    goModules,
    rustCrates
  });
  addImports(builder, {
    moduleNodeId: `module:${source.path}`,
    relativePath: source.path,
    text: source.content,
    importFacts
  });
  addResolvedTestCoverage(builder, {
    relativePath: source.path,
    importFacts,
    text: source.content
  });

  return parsedImports.unavailable ? source.path : null;
}

function cleanMentionedRepoPath(value) {
  const cleaned = String(value ?? "").replace(TRAILING_PATH_PUNCTUATION, "");
  return cleaned.includes("..") ? null : cleaned;
}

function addDocsContractGraph(builder, source, sourcePathSet) {
  addDocsLocalGraph(builder, source);
  for (const match of source.content.matchAll(REPO_PATH_PATTERN)) {
    const mentionedPath = cleanMentionedRepoPath(match[0]);
    if (!mentionedPath || !sourcePathSet.has(mentionedPath)) {
      continue;
    }
    const targetFileNodeId = addFileNode(builder, mentionedPath);
    builder.addEdge("documents_contract", `docs_contract:${source.path}`, targetFileNodeId, {
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

function addCodeLocalGraph(builder, source) {
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
  }
}

function addDocsLocalGraph(builder, source) {
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
}

function replayContributions(builder, facts) {
  for (const contribution of facts.base_node_contributions ?? []) {
    builder.addNode(contribution.kind, contribution.key, contribution.attributes);
  }
  for (const contribution of facts.base_edge_contributions ?? []) {
    builder.addEdge(
      contribution.kind,
      contribution.from_node_id,
      contribution.to_node_id,
      { ...contribution.attributes, discriminator: contribution.discriminator }
    );
  }
}

function addResolvedTestCoverage(builder, { relativePath, importFacts, text = "" }) {
  if (!isTestPath(relativePath)) return;
  const testNodeId = `test:${relativePath}`;
  for (const fact of importFacts) {
    if (fact.resolutionState !== "resolved" || !fact.targetPath) continue;
    const line = fact.line ?? lineForOffset(text, fact.index);
    const metadata = parserMetadata({ fact, relativePath, line });
    const targetModuleNodeId = builder.addNode("module", fact.targetPath, {
      path: fact.targetPath,
      ...metadata
    });
    builder.addEdge("covers_test", testNodeId, targetModuleNodeId, {
      path: relativePath,
      target_path: fact.targetPath,
      specifier: fact.specifier,
      line,
      discriminator: `${fact.specifier}:${fact.index}`,
      ...metadata
    });
  }
}

export async function collectSidecarGraphFileFacts({ source, parserProvider = null } = {}) {
  const normalized = normalizeGraphSources([source]);
  if (normalized.sources.length !== 1) {
    throw new Error("incremental graph source must be one supported repository path");
  }
  const normalizedSource = normalized.sources[0];
  const builder = createGraphContributionCollector();
  let sourceKind = "file";
  let importFacts = [];
  let docsMentions = [];
  let parseCount = 0;
  if (isCodePath(normalizedSource.path)) {
    const provider = parserProvider || (await loadTreeSitterProvider());
    if (!provider.available) {
      throw new Error(`parser provider unavailable: ${provider.reason}`);
    }
    const parsed = parseImportFacts({
      provider,
      relativePath: normalizedSource.path,
      text: normalizedSource.content
    });
    if (parsed.unavailable) throw new Error(`parser unavailable for ${normalizedSource.path}`);
    parseCount = 1;
    importFacts = parsed.facts.map((fact) => ({
      ...fact,
      line: lineForOffset(normalizedSource.content, fact.index)
    }));
    sourceKind = "code";
    addCodeLocalGraph(builder, normalizedSource);
  } else if (isDocsContractPath(normalizedSource.path)) {
    sourceKind = "docs_contract";
    addDocsLocalGraph(builder, normalizedSource);
    docsMentions = [...normalizedSource.content.matchAll(REPO_PATH_PATTERN)]
      .map((match) => ({
        candidate_path: cleanMentionedRepoPath(match[0]),
        line: lineForOffset(normalizedSource.content, match.index ?? 0)
      }))

      .filter((mention) => mention.candidate_path !== null &&
        isSidecarRepoPath(mention.candidate_path));
  } else if (isWorkItemPath(normalizedSource.path)) {
    sourceKind = "work_item";
    addWorkItemGraph(builder, normalizedSource);
  } else {
    addFileNode(builder, normalizedSource.path);
  }
  const base = builder.contributions();
  return {
    source_kind: sourceKind,
    source_path: normalizedSource.path,
    import_facts: importFacts,
    docs_mentions: docsMentions,
    base_node_contributions: base.node_contributions,
    base_edge_contributions: base.edge_contributions,
    parse_count: parseCount
  };
}

export function materializeSidecarGraphUnit({ facts, sourcePaths, goModules = [], rustCrates = [] }) {
  if (!facts || typeof facts !== "object" || Array.isArray(facts)) {
    throw new TypeError("stored graph facts must be an object");
  }
  normalizeSidecarRepoPath(facts.source_path);
  const sourcePathSet = sourcePaths instanceof Set ? sourcePaths : new Set(sourcePaths ?? []);
  const builder = createGraphContributionCollector();
  replayContributions(builder, facts);
  const dependencies = [];
  if (facts.source_kind === "code") {
    const resolved = resolveImportFacts({
      facts: facts.import_facts ?? [],
      relativePath: facts.source_path,
      sourcePathSet,
      goModules,
      rustCrates
    });
    const moduleNodeId = `module:${facts.source_path}`;
    addImports(builder, {
      moduleNodeId,
      relativePath: facts.source_path,
      text: "",
      importFacts: resolved
    });
    addResolvedTestCoverage(builder, {
      relativePath: facts.source_path,
      importFacts: resolved
    });
    dependencies.push(...importFactResolutionDependencies({
      facts: facts.import_facts ?? [],
      relativePath: facts.source_path,
      sourcePathSet,
      goModules,
      rustCrates
    }));
  } else if (facts.source_kind === "docs_contract") {
    const docsNodeId = `docs_contract:${facts.source_path}`;
    for (const mention of facts.docs_mentions ?? []) {
      if (!Number.isSafeInteger(mention.line) || mention.line < 1) {
        throw new Error("stored docs mention is invalid");
      }
      try {
        normalizeSidecarRepoPath(mention.candidate_path);
      } catch (cause) {
        const error = new Error(`stored docs mention in ${facts.source_path} is not a repository path: ${
          JSON.stringify(String(mention.candidate_path).slice(0, 200))}`, { cause });
        error.code = cause?.code ?? "sidecar_stored_docs_mention_invalid";
        throw error;
      }
      const present = sourcePathSet.has(mention.candidate_path);
      dependencies.push({
        candidate_path: mention.candidate_path,
        candidate_ordinal: dependencies.length,
        resolution_state: present ? "present" : "absent"
      });
      if (!present) continue;
      const target = addFileNode(builder, mention.candidate_path);
      builder.addEdge("documents_contract", docsNodeId, target, {
        path: facts.source_path,
        target_path: mention.candidate_path,
        line: mention.line,
        discriminator: mention.candidate_path,
        provenance: provenance({
          evidenceBasis: "docs_backlink",
          path: facts.source_path,
          line: mention.line
        })
      });
    }
  }
  const contributions = builder.contributions();
  return {
    node_contributions: contributions.node_contributions,
    edge_contributions: contributions.edge_contributions,
    resolution_dependencies: dependencies
  };
}

export async function extractSidecarGraph({
  sources = [],
  edgeSource = "base_index",
  dirtyGraphMode = "base_index_only",
  parserProvider = null,
  goModules = [],
  rustCrates = []
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
      const unavailablePath = addCodeGraph(builder, source, sourcePathSet, treeSitterProvider, goModules,
        rustCrates);
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
