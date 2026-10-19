import { layerFromStore, providerDescriptorsForLayer, createScipUnavailableState } from "./sidecar-query-layers.mjs";
import path from "node:path";
import { Parser } from "web-tree-sitter";
import { loadTreeSitterProvider, providerDescriptorForLanguage } from "./sidecar-graph-import-facts.mjs";
import { sidecarLanguageForPath } from "./sidecar-language-descriptions.mjs";

import { createSidecarResultEnvelope } from "./sidecar-schema.mjs";
import { assembleCallNavigationResult } from "./sidecar-call-query.mjs";
import { sameGraphSnapshot, unavailableCommittedSnapshot } from "./sidecar-committed-preparation.mjs";
import { committedEnvelopeFields, prepareCommittedQuery, runSnapshotQuery } from
  "./sidecar-query-selection.mjs";
import { readSidecarSymbolSelection } from "./sidecar-store.mjs";
import { sidecarDependencyLimitations } from "./sidecar-scip-projects.mjs";
import { normalizeSidecarNavigationInput } from "./sidecar-navigation-input.mjs";
import { compactNavigationFreshness } from "./sidecar-query-projection.mjs";
import { fitNavigationSummary, projectNativeNavigation } from "./sidecar-navigation-projection.mjs";
import { nativePositionSymbols, resolveNativeNavigation } from "./sidecar-navigation-resolution.mjs";
import { assembleNativeNavigationResult } from "./sidecar-navigation-source-query.mjs";

const SCIP_CALL_GRAPH_UNAVAILABLE = "scip_call_graph_unavailable";
const SYMBOL_QUERY_EXPLICIT_UNRESOLVED = "symbol_not_resolved";
export const MCP_SYMBOL_QUERY_RESULT_LIMIT = 20;
const CALL_QUERY_KINDS = new Set(["symbol_callers", "symbol_callees"]);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function provenance({ evidenceBasis = "scip", sourceKind = "scip" } = {}) {
  return {
    source_kind: sourceKind,
    canonicality: "derived",
    evidence_basis: evidenceBasis
  };
}

function compactSymbolStatusReason(result, resolutionState) {
  const resolutionReason = result?.symbol_resolution?.status_reason;
  if (typeof resolutionReason === "string" && resolutionReason.length > 0) {
    return resolutionReason;
  }
  if (resolutionState === "unresolved") {
    return SYMBOL_QUERY_EXPLICIT_UNRESOLVED;
  }
  const scipReason = result?.scip_state?.status_reason;
  return typeof scipReason === "string" && scipReason.length > 0
    ? scipReason
    : result?.status_reason ?? "unknown";
}

function compactSymbolNextAction(result, queryKind, resolutionState) {
  const limited = Array.isArray(result?.dependency_limitations) ? result.dependency_limitations.length : 0;
  const action = [unresolvedNextAction(result, queryKind, resolutionState), limited === 0 ? null
    : `Dependency resolution was incomplete for ${limited} provider project${limited === 1 ? "" : "s"} this ` +
      "answer may depend on (dependency_limitations): an absent or unresolved result there is not an " +
      "authoritative no-match. Make the reported dependencies available offline; an explicit code-index " +
      "build attempts those projects again, as does automatic preparation once their inputs change."]
    .filter(Boolean).join(" ") || null;

  return action !== null && result?.staleness === "stale"
    ? `${action} This answer describes the selected graph_snapshot checkout inputs and publication; ` +
      "a symbol added since then appears after the refresh publishes."
    : action;
}

function unresolvedNextAction(result, queryKind, resolutionState) {
  const callGraphQuery = CALL_QUERY_KINDS.has(queryKind);
  if (
    result?.scip_state?.scip_available !== true ||
    result?.scip_state?.graph_available !== true ||
    (callGraphQuery && result?.scip_state?.call_graph_available === false)
  ) {
    return "Committed preparation attempts every applicable SCIP provider project and publishes what " +
      "they produce; a project whose provider is not installed, or that could not be indexed while its " +
      "dependencies were missing, is listed with its reason in " +
      "graph_snapshot.provider_coverage.inactive_projects. Provision the provider or make the " +
      "dependencies available, then prepare again. When no SCIP provider applies to the checkout " +
      "sources, symbol results stay unavailable. Status is read-only. Unsupported call " +
      "attribution is not repaired by provisioning; use definition or reference results.";
  }
  if (resolutionState === "unresolved") {
    return "Retry with an exact SCIP symbol or a repo-relative path, 1-based line, and optional character.";
  }
  return null;
}

export function projectSidecarSymbolQueryForMcp(result, { verbose = false, fits = null,
  limit = MCP_SYMBOL_QUERY_RESULT_LIMIT } = {}) {
  if (verbose) {
    return { ...cloneJson(result), verbose: true };
  }
  if (typeof fits === "function") {
    return fitNavigationSummary((bound) => projectSidecarSymbolQueryForMcp(result, { limit: bound }), fits);
  }

  const queryKind = result?.query_kind ?? null;
  const resolutionState = result?.symbol_resolution?.state ?? "unresolved";
  return projectNativeNavigation(result, {
    query_kind: queryKind,
    verbose: false,
    symbol: result?.symbol ?? null,

    freshness: compactNavigationFreshness(result),
    resolution: {
      state: resolutionState,
      status_reason: compactSymbolStatusReason(result, resolutionState)
    },
    next_action: compactSymbolNextAction(result, queryKind, resolutionState)
  }, { limit });
}

function createCallGraphUnavailableState(layer, statusReason = SCIP_CALL_GRAPH_UNAVAILABLE) {
  return {
    ...createScipUnavailableState(layer, statusReason),
    status_reason: statusReason,
    call_graph_available: false,
    call_graph_status_reason: layer?.call_graph_status_reason ||
      layer?.coverage?.call_graph_status_reason ||
      statusReason,
    ...(layer?.call_graph_unavailable_reason || layer?.coverage?.call_graph_unavailable_reason
      ? {
          call_graph_unavailable_reason:
            layer?.call_graph_unavailable_reason || layer?.coverage?.call_graph_unavailable_reason
        }
      : {})
  };
}

function createSymbolQueryEnvelope({
  prepared,
  layer,
  queryKind,
  input,
  symbolResolution,
  references = [],
  definitions = [],
  callers = [],
  callees = [],
  scipStateOverride = null,
  navigation
}) {
  const { status } = prepared;
  const scipState = scipStateOverride || createScipUnavailableState(layer);

  const dependencyLimitations = sidecarDependencyLimitations(layer?.coverage, input.path);
  return createSidecarResultEnvelope({
    source_kind: "scip",
    canonicality: "derived",
    evidence_basis: "scip",

    ...committedEnvelopeFields(prepared),
    derived_evidence: [
      ...status.derived_evidence.map(cloneJson),
      {
        kind: "sidecar_symbol_query",
        query_kind: queryKind,
        input: cloneJson(input),
        symbol: symbolResolution.symbol,
        symbol_resolution: cloneJson(symbolResolution.resolution),
        scip_state: scipState,
        provenance: provenance({ evidenceBasis: "explicit_metadata" })
      }
    ],
    query_kind: queryKind,
    input,
    symbol: symbolResolution.symbol,
    symbol_resolution: symbolResolution.resolution,
    scip_state: scipState,
    provider_descriptors: providerDescriptorsForLayer(layer),
    coverage: layer?.coverage ? cloneJson(layer.coverage) : null,
    references,
    definitions,
    callers,
    callees,
    ...(dependencyLimitations.length > 0 ? { dependency_limitations: dependencyLimitations } : {}),
    ...(navigation.call_attribution ? { call_attribution: navigation.call_attribution } : {}),
    symbol_facts: navigation.symbol_facts,
    source_hits: navigation.source_hits,
    context_regions: navigation.context_regions,
    complete_files: navigation.complete_files,
    summary: {
      kind: "sidecar_symbol_query_summary",
      query_kind: queryKind,
      symbol: symbolResolution.symbol,
      scip_state: scipState,
      counts: {
        references: references.length,
        definitions: definitions.length,
        callers: callers.length,
        callees: callees.length,
        candidates: symbolResolution.resolution.candidates.length,
        source_hits: navigation.source_hits.length,
        context_regions: navigation.context_regions.length,
        complete_files: navigation.complete_files.length
      },
      state: {
        dirty_state: status.dirty_state,
        dirty_details: status.dirty_details,
        staleness: status.staleness
      }
    }
  });
}

function callGraphAvailability(layer) {
  const explicitAvailable = layer.call_graph_available ?? layer.coverage?.call_graph_available;
  if (explicitAvailable === true) {
    return { available: true, statusReason: layer.status_reason || "scip_extracted" };
  }
  if (explicitAvailable === false) {
    return {
      available: false,
      statusReason:
        layer.call_graph_status_reason ||
        layer.coverage?.call_graph_status_reason ||
        SCIP_CALL_GRAPH_UNAVAILABLE
    };
  }
  const hasCallsSymbolEdges = layer.graph_edges.some((edge) => edge?.kind === "calls_symbol");
  return hasCallsSymbolEdges
    ? { available: true, statusReason: layer.status_reason || "scip_extracted" }
    : { available: false, statusReason: SCIP_CALL_GRAPH_UNAVAILABLE };
}

async function selectCommittedSymbols({ dir, cacheDir, input, context }) {
  const prepared = await prepareCommittedQuery({ dir: path.resolve(String(dir || ".")), cacheDir },
    context);
  const selection = readSidecarSymbolSelection({ repoRoot: prepared.repoRoot, cacheDir,
    symbol: input.symbol ?? null, documentPath: input.path ?? null,
    positionSymbols: Object.hasOwn(input, "symbol") ? null
      : (rows) => nativePositionSymbols(rows, input) });
  if (!sameGraphSnapshot(selection.publication, prepared.graph_snapshot)) {
    throw unavailableCommittedSnapshot("repository_snapshot_changed", prepared.status);
  }
  return { prepared, selection, repoRoot: prepared.repoRoot };
}

async function buildNavigationQuery(options, queryKind, context) {
  const input = normalizeSidecarNavigationInput(options);
  return runSnapshotQuery(context, () => evaluateNavigationQuery(input, queryKind, context));
}

async function evaluateNavigationQuery(input, queryKind, context) {
  const publicInput = { symbol: input.symbol ?? null, path: input.path ?? null,
    line: input.line ?? null, character: input.character ?? null };
  const { prepared, selection, repoRoot } = await selectCommittedSymbols({ dir: input.dir,
    cacheDir: input.cacheDir, input, context });
  const layer = layerFromStore(selection);
  const callQuery = CALL_QUERY_KINDS.has(queryKind);
  if (layer.scip_available !== true || layer.graph_available === false) {
    const statusReason = layer.status_reason || "scip_indexer_unavailable";
    return createSymbolQueryEnvelope({ prepared, layer, queryKind, input: publicInput,
      symbolResolution: { symbol: publicInput.symbol, resolution: {
        kind: publicInput.symbol ? "explicit_symbol" : "path_position", state: "unresolved",
        status_reason: statusReason, candidates: [] } },
      navigation: { symbol_facts: [], source_hits: [], context_regions: [], complete_files: [] },
      scipStateOverride: callQuery ? createCallGraphUnavailableState(layer, statusReason) : null });
  }
  const navigation = resolveNativeNavigation({ input, selection });
  if (callQuery) {
    const availability = callGraphAvailability(layer);
    const answer = await assembleCallNavigationResult({ repoRoot, selection, navigation, queryKind,
      callGraphAvailable: availability.available });
    return createSymbolQueryEnvelope({ prepared, layer, queryKind, input: publicInput,
      symbolResolution: { symbol: answer.symbol, resolution: answer.symbol_resolution },
      callers: answer.callers, callees: answer.callees, navigation: answer,
      scipStateOverride: availability.available ? null
        : createCallGraphUnavailableState(layer, availability.statusReason) });
  }
  const answer = await assembleNativeNavigationResult({ repoRoot, selection, queryKind, navigation });
  return createSymbolQueryEnvelope({
    prepared,
    layer,
    queryKind,
    input: publicInput,
    symbolResolution: { symbol: answer.symbol, resolution: answer.symbol_resolution },
    references: answer.references,
    definitions: answer.definitions,
    navigation: answer
  });
}

export async function getSidecarSymbolReferences(options = {}, context = null) {
  return buildNavigationQuery(options, "find_references", context);
}

export async function getSidecarSymbolDefinition(options = {}, context = null) {
  return buildNavigationQuery(options, "definition", context);
}

export async function getSidecarSymbolCallers(options = {}, context = null) {
  return buildNavigationQuery(options, "symbol_callers", context);
}

export async function getSidecarSymbolCallees(options = {}, context = null) {
  return buildNavigationQuery(options, "symbol_callees", context);
}

export async function resolveCommittedSourceSymbol({ path: sourcePath, symbol, source_text }) {
  const provider = await loadTreeSitterProvider();
  const languageKey = sidecarLanguageForPath(sourcePath);
  const language = provider.languages?.get(languageKey);
  if (!provider.available || !language) return { state: 'unavailable', code: 'description_symbol_parser_unavailable',
    reason: provider.reason ?? 'unsupported_language' };
  const parser = new Parser();
  let tree;
  try {
    parser.setLanguage(language);
    tree = parser.parse(source_text);
    if (!tree || tree.rootNode.hasError) return { state: 'unavailable', code: 'description_source_parse_error' };
    const candidates = [];
    const unsupportedBindings = [];
    const declarationTypes = new Set(['function_declaration', 'generator_function_declaration', 'class_declaration',
      'variable_declarator', 'method_definition', 'field_definition', 'function_definition', 'class_definition', 'assignment',
      'method_declaration', 'type_spec', 'var_spec', 'const_spec', 'function_item', 'struct_item', 'enum_item',
      'const_item', 'static_item', 'type_item', 'mod_item']);
    const staticValue = node => {
      if (!node) return false;
      if (['number', 'integer', 'float', 'string', 'true', 'false', 'null', 'none', 'boolean_literal',
        'integer_literal', 'float_literal', 'string_literal'].includes(node.type)) return true;
      if (['array', 'list', 'tuple', 'object', 'dictionary', 'pair', 'parenthesized_expression'].includes(node.type))
        return node.namedChildren.every(child => child.type === 'property_identifier' || staticValue(child));
      if (node.type === 'unary_expression') return /^[-+]\s*\d/u.test(node.text) && node.namedChildren.every(staticValue);
      return false;
    };
    const visit = (node, owners = []) => {
      const nameNode = declarationTypes.has(node.type) ? node.childForFieldName('name') ?? node.childForFieldName('left') : null;
      const name = nameNode && ['identifier', 'type_identifier', 'property_identifier', 'field_identifier'].includes(nameNode.type) ? nameNode.text : null;
      const qualified = name === null ? owners : [...owners, name];
      if (['object_pattern', 'array_pattern', 'import_specifier', 'namespace_import', 'export_specifier'].includes(node.type) &&
        node.namedChildren.some(child => child.text === symbol)) unsupportedBindings.push(node.text);
      if (name !== null && (symbol === name || symbol === qualified.join('.') || symbol === qualified.join('::'))) {
        const value = node.childForFieldName('value') ?? node.childForFieldName('right');
        let statement = node.type === 'variable_declarator' ? node.parent : node;
        if (statement.parent?.type === 'export_statement') statement = statement.parent;
        const callable = ['function_declaration', 'generator_function_declaration', 'function_definition', 'function_item',
          'method_definition', 'method_declaration'].includes(node.type) || ['arrow_function', 'function_expression'].includes(value?.type);
        const meanings = ['subject', 'object'];
        if (callable) meanings.push('behavior');
        if (staticValue(value)) meanings.push('value', 'structure');
        if (staticValue(value) && ['array', 'list', 'tuple'].includes(value.type)) meanings.push('population');
        candidates.push({ path: sourcePath, symbol: qualified.join('.'), declaration_kind: node.type,
          name_line: nameNode.startPosition.row + 1,
          start_line: statement.startPosition.row + 1, end_line: statement.endPosition.row + 1,
          source_text: statement.text, defined_meanings: meanings });
      }
      for (const child of node.namedChildren) visit(child, qualified);
    };
    visit(tree.rootNode);
    const provenance = providerDescriptorForLanguage(languageKey);
    if (!candidates.length && unsupportedBindings.length) return { state: 'unavailable', code: 'description_symbol_binding_unsupported',
      bindings: unsupportedBindings, provider: provenance };
    return candidates.length === 1 ? { state: 'resolved', definition: candidates[0], provider: provenance }
      : { state: candidates.length ? 'ambiguous' : 'missing',
        code: candidates.length ? 'description_symbol_ambiguous' : 'description_symbol_missing', candidates, provider: provenance };
  } finally {
    tree?.delete();
    parser.delete();
  }
}
