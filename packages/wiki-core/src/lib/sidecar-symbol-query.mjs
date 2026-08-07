import path from "node:path";

import { createSidecarResultEnvelope } from "./sidecar-schema.mjs";
import {
  discoverSidecarGitState,
  getSidecarIndexStatus,
  resolveSidecarArtifactPath
} from "./sidecar-status.mjs";
import { readSidecarArtifactBytes } from "./sidecar-artifact-bytes.mjs";

const SCIP_STATUS_NOT_CONFIGURED = "scip_not_configured";
const SCIP_CALL_GRAPH_UNAVAILABLE = "scip_call_graph_unavailable";
const SYMBOL_QUERY_POSITION_UNRESOLVED = "symbol_not_resolved_at_position";
const SYMBOL_QUERY_POSITION_AMBIGUOUS = "ambiguous_symbol_at_position";
const SYMBOL_QUERY_EXPLICIT_UNRESOLVED = "symbol_not_resolved";
export const MCP_SYMBOL_QUERY_RESULT_LIMIT = 20;
const POSITION_INDEX_EDGE_KINDS = new Set(["defines_symbol", "references_symbol"]);

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

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function symbolResultField(queryKind) {
  if (queryKind === "find_references") return "references";
  if (queryKind === "definition") return "definitions";
  if (queryKind === "symbol_callers") return "callers";
  if (queryKind === "symbol_callees") return "callees";
  return null;
}

function compactSymbolResult(queryKind, entry) {
  if (queryKind === "find_references" || queryKind === "definition") {
    return {
      symbol: entry?.symbol ?? null,
      path: entry?.path ?? null,
      line: entry?.line ?? null
    };
  }
  return {
    caller_symbol: entry?.caller_symbol ?? null,
    callee_symbol: entry?.callee_symbol ?? null,
    occurrence_count: entry?.occurrence_count ?? null,
    lines: Array.isArray(entry?.lines) ? [...entry.lines] : []
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

function compactSymbolNextAction(result, queryKind, resolutionState, truncated) {
  const callGraphQuery = queryKind === "symbol_callers" || queryKind === "symbol_callees";
  if (
    result?.scip_state?.scip_available !== true ||
    result?.scip_state?.graph_available !== true ||
    (callGraphQuery && result?.scip_state?.call_graph_available === false)
  ) {
    return "Build or rebuild the workspace code index with SCIP enabled, then retry this query.";
  }
  if (resolutionState === "unresolved") {
    return "Retry with an exact SCIP symbol or a repo-relative path, 1-based line, and optional character.";
  }
  if (truncated) {
    return "Re-call with verbose:true to retrieve the full uncapped result envelope.";
  }
  return "Re-call with verbose:true for provider, coverage, canonical-ref, and derived-evidence detail.";
}

export function projectSidecarSymbolQueryForMcp(result, { verbose = false } = {}) {
  if (verbose) {
    return { ...cloneJson(result), verbose: true };
  }

  const queryKind = result?.query_kind ?? null;
  const resultField = symbolResultField(queryKind);
  const allResults = resultField && Array.isArray(result?.[resultField]) ? result[resultField] : [];
  const boundedResults = allResults
    .slice(0, MCP_SYMBOL_QUERY_RESULT_LIMIT)
    .map((entry) => compactSymbolResult(queryKind, entry));
  const truncated = allResults.length > boundedResults.length;
  const resolutionState = result?.symbol_resolution?.state ?? "unresolved";
  const projection = {
    query_kind: queryKind,
    verbose: false,
    symbol: result?.symbol ?? null,
    freshness: {
      state: result?.staleness ?? "unknown"
    },
    resolution: {
      state: resolutionState,
      status_reason: compactSymbolStatusReason(result, resolutionState)
    },
    result_count: {
      total: allResults.length,
      returned: boundedResults.length,
      truncated
    },
    next_action: compactSymbolNextAction(result, queryKind, resolutionState, truncated)
  };
  if (resultField) {
    projection[resultField] = boundedResults;
  }
  return projection;
}

function normalizeLine(value) {
  if (value == null || value === "") {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) {
    throw new Error("symbol query line must be a positive 1-based integer");
  }
  return numeric;
}

function normalizeCharacter(value) {
  if (value == null || value === "") {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) {
    throw new Error("symbol query character must be a non-negative integer");
  }
  return numeric;
}

function normalizePath(value) {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  return value.split(path.sep).join("/");
}

function normalizeSymbolQueryInput({ symbol = null, path: inputPath = null, line = null, character = null } = {}) {
  const normalizedSymbol = typeof symbol === "string" && symbol.length > 0 ? symbol : null;
  const normalizedPath = normalizePath(inputPath);
  const normalizedLine = normalizeLine(line);
  const normalizedCharacter = normalizeCharacter(character);
  if (!normalizedSymbol && (!normalizedPath || normalizedLine == null)) {
    throw new Error("symbol query requires either --symbol <symbol> or --path <path> --line <line>");
  }
  return {
    symbol: normalizedSymbol,
    path: normalizedPath,
    line: normalizedLine,
    character: normalizedCharacter
  };
}

async function readArtifactFromStatus({ repoRoot, status, cacheDir }) {
  if (!status.artifact_exists || status.staleness === "missing") {
    return null;
  }
  const artifactPaths = resolveSidecarArtifactPath({
    repoRoot,
    cacheDir: cacheDir || status.cache_path,
    artifactFile: path.posix.basename(status.artifact_path || "index.json")
  });
  try {
    return (await readSidecarArtifactBytes(artifactPaths.artifactPath)).artifact;
  } catch {
    return null;
  }
}

function providerDescriptorsForLayer(layer) {
  if (Array.isArray(layer?.provider_descriptors)) {
    return layer.provider_descriptors.map(cloneJson);
  }
  if (isPlainObject(layer?.provider_descriptor)) {
    return [cloneJson(layer.provider_descriptor)];
  }
  return [];
}

function createScipUnavailableState(layer, statusReason = SCIP_STATUS_NOT_CONFIGURED) {
  const scipAvailable = layer?.scip_available === true;
  const callGraphAvailable = layer?.call_graph_available ?? layer?.coverage?.call_graph_available;
  const callGraphStatusReason =
    layer?.call_graph_status_reason ?? layer?.coverage?.call_graph_status_reason;
  const callGraphUnavailableReason =
    layer?.call_graph_unavailable_reason ?? layer?.coverage?.call_graph_unavailable_reason;
  const state = {
    scip_available: scipAvailable,
    graph_available: scipAvailable && layer?.graph_available !== false,
    status_reason: layer?.status_reason || statusReason,
    ...(layer?.error_reason ? { error_reason: layer.error_reason } : {})
  };
  if (typeof callGraphAvailable === "boolean") {
    state.call_graph_available = callGraphAvailable;
  }
  if (typeof callGraphStatusReason === "string" && callGraphStatusReason.length > 0) {
    state.call_graph_status_reason = callGraphStatusReason;
  }
  if (typeof callGraphUnavailableReason === "string" && callGraphUnavailableReason.length > 0) {
    state.call_graph_unavailable_reason = callGraphUnavailableReason;
  }
  return state;
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

function callsSymbolTarget(edge) {
  return typeof edge?.to_node_id === "string" && edge.to_node_id.startsWith("symbol:")
    ? edge.to_node_id.slice("symbol:".length)
    : null;
}

function callsSymbolSource(edge) {
  return typeof edge?.from_node_id === "string" && edge.from_node_id.startsWith("symbol:")
    ? edge.from_node_id.slice("symbol:".length)
    : null;
}

function pushMapArray(map, key, value) {
  if (!map.has(key)) {
    map.set(key, []);
  }
  map.get(key).push(value);
}

function buildSymbolIndexes(layer) {
  const nodesById = new Map();
  for (const node of Array.isArray(layer?.graph_nodes) ? layer.graph_nodes : []) {
    if (typeof node?.id === "string") {
      nodesById.set(node.id, node);
    }
  }

  const definesBySymbol = new Map();
  const referencesBySymbol = new Map();
  const callsByCalleeSymbol = new Map();
  const callsByCallerSymbol = new Map();
  const edgesByPosition = [];
  for (const edge of Array.isArray(layer?.graph_edges) ? layer.graph_edges : []) {
    if (!isPlainObject(edge)) {
      continue;
    }

    if (edge.kind === "calls_symbol") {
      const callerSymbol = callsSymbolSource(edge);
      const calleeSymbol = callsSymbolTarget(edge);
      if (callerSymbol && calleeSymbol) {
        pushMapArray(callsByCallerSymbol, callerSymbol, edge);
        pushMapArray(callsByCalleeSymbol, calleeSymbol, edge);
      }
      continue;
    }

    if (!POSITION_INDEX_EDGE_KINDS.has(edge.kind)) {
      continue;
    }

    const symbol = callsSymbolTarget(edge);
    if (!symbol) {
      continue;
    }

    if (edge.kind === "defines_symbol") {
      pushMapArray(definesBySymbol, symbol, edge);
    }
    if (edge.kind === "references_symbol") {
      pushMapArray(referencesBySymbol, symbol, edge);
    }
    if (typeof edge.path === "string" && typeof edge.line === "number") {
      edgesByPosition.push({ symbol, edge });
    }
  }

  return {
    nodesById,
    definesBySymbol,
    referencesBySymbol,
    callsByCalleeSymbol,
    callsByCallerSymbol,
    edgesByPosition
  };
}

function numberValue(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function edgeStartCharacter(edge) {
  return numberValue(edge.character) ?? numberValue(edge.start_character) ?? numberValue(edge.startCharacter);
}

function edgeEndCharacter(edge) {
  return numberValue(edge.end_character) ?? numberValue(edge.endCharacter);
}

function edgeMatchesCharacter(edge, character) {
  const start = edgeStartCharacter(edge);
  if (start == null) {
    return false;
  }
  const end = edgeEndCharacter(edge);
  if (end == null || end < start) {
    return start === character;
  }
  return start <= character && character < end;
}

function positionCandidate(entry) {
  const start = edgeStartCharacter(entry.edge);
  const end = edgeEndCharacter(entry.edge);
  return {
    symbol: entry.symbol,
    edge_id: entry.edge.id ?? null,
    path: entry.edge.path,
    line: entry.edge.line,
    ...(start != null ? { character: start } : {}),
    ...(end != null ? { end_character: end } : {})
  };
}

function uniqueCandidatesBySymbol(candidates) {
  const bySymbol = new Map();
  for (const candidate of candidates) {
    if (!bySymbol.has(candidate.symbol)) {
      bySymbol.set(candidate.symbol, candidate);
    }
  }
  return [...bySymbol.values()];
}

function unresolvedPositionResolution(input, statusReason, candidates = []) {
  return {
    symbol: null,
    resolution: {
      kind: "path_position",
      state: "unresolved",
      status_reason: statusReason,
      path: input.path,
      line: input.line,
      character: input.character,
      ...(candidates.length > 0 ? { candidates } : {})
    }
  };
}

function resolvedPosition(candidate, input, positionGranularity) {
  return {
    symbol: candidate.symbol,
    resolution: {
      kind: "path_position",
      state: "resolved",
      path: input.path,
      line: input.line,
      character: input.character,
      edge_id: candidate.edge.id,
      position_granularity: positionGranularity
    }
  };
}

function resolveSymbolFromInput(input, indexes) {
  if (input.symbol) {
    const node = indexes.nodesById.get(`symbol:${input.symbol}`) || null;
    return {
      symbol: input.symbol,
      resolution: {
        kind: "explicit_symbol",
        state: node?.resolution?.state || "unresolved"
      }
    };
  }

  const lineCandidates = indexes.edgesByPosition.filter(
    (entry) => entry.edge.path === input.path && entry.edge.line === input.line
  );
  if (lineCandidates.length === 0) {
    return unresolvedPositionResolution(input, SYMBOL_QUERY_POSITION_UNRESOLVED);
  }

  if (input.character != null) {
    const characterMatches = lineCandidates.filter((entry) =>
      edgeMatchesCharacter(entry.edge, input.character)
    );
    const uniqueCharacterMatches = uniqueCandidatesBySymbol(characterMatches);
    if (uniqueCharacterMatches.length === 1) {
      return resolvedPosition(characterMatches[0], input, "character");
    }
    if (uniqueCharacterMatches.length > 1) {
      return unresolvedPositionResolution(
        input,
        SYMBOL_QUERY_POSITION_AMBIGUOUS,
        uniqueCharacterMatches.map(positionCandidate)
      );
    }
  }

  const uniqueLineCandidates = uniqueCandidatesBySymbol(lineCandidates);
  if (uniqueLineCandidates.length === 1) {
    return resolvedPosition(lineCandidates[0], input, "line");
  }

  return unresolvedPositionResolution(
    input,
    SYMBOL_QUERY_POSITION_AMBIGUOUS,
    uniqueLineCandidates.map(positionCandidate)
  );
}

function resultEntryForEdge(edge, { symbol, node, layer }) {
  const providerDescriptor =
    edge.provider_descriptor || node?.provider_descriptor || providerDescriptorsForLayer(layer)[0] || null;
  const resolution = edge.resolution || node?.resolution || { state: "unresolved" };
  const coverage = edge.coverage || node?.coverage || layer.coverage || null;
  return {
    symbol,
    edge_id: edge.id ?? null,
    path: edge.path ?? null,
    line: typeof edge.line === "number" ? edge.line : null,
    resolution: cloneJson(resolution),
    provider_descriptor: providerDescriptor ? cloneJson(providerDescriptor) : null,
    coverage: coverage ? cloneJson(coverage) : null,
    provenance: edge.provenance ? cloneJson(edge.provenance) : provenance()
  };
}

function resultEntryForCallEdge(edge, { layer }) {
  const callerSymbol = callsSymbolSource(edge);
  const calleeSymbol = callsSymbolTarget(edge);
  const graphNodes = Array.isArray(layer?.graph_nodes) ? layer.graph_nodes : [];
  const callerNode = callerSymbol
    ? graphNodes.find((node) => node?.id === `symbol:${callerSymbol}`)
    : null;
  const calleeNode = calleeSymbol
    ? graphNodes.find((node) => node?.id === `symbol:${calleeSymbol}`)
    : null;
  const providerDescriptor =
    edge.provider_descriptor ||
    callerNode?.provider_descriptor ||
    calleeNode?.provider_descriptor ||
    providerDescriptorsForLayer(layer)[0] ||
    null;
  const resolution = edge.resolution || calleeNode?.resolution || callerNode?.resolution || { state: "unresolved" };
  const coverage = edge.coverage || calleeNode?.coverage || callerNode?.coverage || layer?.coverage || null;
  return {
    edge_id: edge.id ?? null,
    caller_symbol: callerSymbol,
    callee_symbol: calleeSymbol,
    from_node_id: edge.from_node_id ?? null,
    to_node_id: edge.to_node_id ?? null,
    occurrence_count: typeof edge.occurrence_count === "number" ? edge.occurrence_count : null,
    lines: Array.isArray(edge.lines) ? [...edge.lines] : [],
    resolution: cloneJson(resolution),
    provider_descriptor: providerDescriptor ? cloneJson(providerDescriptor) : null,
    coverage: coverage ? cloneJson(coverage) : null,
    provenance: edge.provenance ? cloneJson(edge.provenance) : provenance()
  };
}

function createSymbolQueryEnvelope({
  status,
  layer,
  queryKind,
  input,
  symbolResolution,
  references = [],
  definitions = [],
  callers = [],
  callees = [],
  scipStateOverride = null
}) {
  const scipState = scipStateOverride || createScipUnavailableState(layer);
  return createSidecarResultEnvelope({
    source_kind: "scip",
    canonicality: "derived",
    evidence_basis: "scip",
    index_head: status.index_head,
    index_tree: status.index_tree,
    dirty_state: status.dirty_state,
    dirty_details: status.dirty_details,
    staleness: status.staleness,
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
    cache_path: status.cache_path,
    artifact_path: status.artifact_path,
    artifact_exists: status.artifact_exists,
    artifact_schema_version: status.artifact_schema_version,
    expected_artifact_schema_version: status.expected_artifact_schema_version,
    status_reason: status.status_reason,
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
    summary: {
      kind: "sidecar_symbol_query_summary",
      query_kind: queryKind,
      symbol: symbolResolution.symbol,
      scip_state: scipState,
      counts: {
        references: references.length,
        definitions: definitions.length,
        callers: callers.length,
        callees: callees.length
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
  if (!layer) {
    return { available: false, statusReason: SCIP_STATUS_NOT_CONFIGURED };
  }
  if (layer.scip_available !== true || layer.graph_available === false) {
    return {
      available: false,
      statusReason: layer.status_reason || "scip_indexer_unavailable"
    };
  }
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
  const hasCallsSymbolEdges = (Array.isArray(layer.graph_edges) ? layer.graph_edges : []).some(
    (edge) => edge?.kind === "calls_symbol"
  );
  if (hasCallsSymbolEdges) {
    return { available: true, statusReason: layer.status_reason || "scip_extracted" };
  }
  return { available: false, statusReason: SCIP_CALL_GRAPH_UNAVAILABLE };
}

function unavailableEnvelope({ status, layer = null, queryKind, input, statusReason }) {
  return createSymbolQueryEnvelope({
    status,
    layer: layer || {
      scip_available: false,
      graph_available: false,
      status_reason: statusReason,
      graph_nodes: [],
      graph_edges: [],
      coverage: null
    },
    queryKind,
    input,
    symbolResolution: {
      symbol: input.symbol,
      resolution: {
        kind: input.symbol ? "explicit_symbol" : "path_position",
        state: "unresolved",
        status_reason: statusReason
      }
    }
  });
}

async function buildSymbolQuery({
  dir = ".",
  cacheDir = undefined,
  queryKind,
  symbol = null,
  path: inputPath = null,
  line = null,
  character = null
} = {}) {
  const input = normalizeSymbolQueryInput({ symbol, path: inputPath, line, character });
  const targetDir = path.resolve(String(dir || "."));
  const status = await getSidecarIndexStatus({ dir: targetDir, cacheDir });
  const gitState = await discoverSidecarGitState(targetDir);
  const artifact = await readArtifactFromStatus({ repoRoot: gitState.repoRoot, status, cacheDir });
  const layer = artifact?.scip_overlay ?? null;

  if (!layer) {
    return unavailableEnvelope({
      status,
      queryKind,
      input,
      statusReason: SCIP_STATUS_NOT_CONFIGURED
    });
  }
  if (layer.scip_available !== true || layer.graph_available === false) {
    return unavailableEnvelope({
      status,
      layer,
      queryKind,
      input,
      statusReason: layer.status_reason || "scip_indexer_unavailable"
    });
  }

  const indexes = buildSymbolIndexes(layer);
  const symbolResolution = resolveSymbolFromInput(input, indexes);
  if (!symbolResolution.symbol) {
    return createSymbolQueryEnvelope({
      status,
      layer,
      queryKind,
      input,
      symbolResolution
    });
  }

  const node = indexes.nodesById.get(`symbol:${symbolResolution.symbol}`) || null;
  const definitions = (indexes.definesBySymbol.get(symbolResolution.symbol) || [])
    .map((edge) => resultEntryForEdge(edge, { symbol: symbolResolution.symbol, node, layer }))
    .sort((left, right) => `${left.path}:${left.line}`.localeCompare(`${right.path}:${right.line}`));
  const references = (indexes.referencesBySymbol.get(symbolResolution.symbol) || [])
    .map((edge) => resultEntryForEdge(edge, { symbol: symbolResolution.symbol, node, layer }))
    .sort((left, right) => `${left.path}:${left.line}`.localeCompare(`${right.path}:${right.line}`));

  return createSymbolQueryEnvelope({
    status,
    layer,
    queryKind,
    input,
    symbolResolution,
    references: queryKind === "find_references" ? references : [],
    definitions
  });
}

async function buildSymbolCallQuery({
  dir = ".",
  cacheDir = undefined,
  queryKind,
  symbol = null,
  path: inputPath = null,
  line = null,
  character = null
} = {}) {
  const input = normalizeSymbolQueryInput({ symbol, path: inputPath, line, character });
  const targetDir = path.resolve(String(dir || "."));
  const status = await getSidecarIndexStatus({ dir: targetDir, cacheDir });
  const gitState = await discoverSidecarGitState(targetDir);
  const artifact = await readArtifactFromStatus({ repoRoot: gitState.repoRoot, status, cacheDir });
  const layer = artifact?.scip_overlay ?? null;

  if (!layer) {
    return createSymbolQueryEnvelope({
      status,
      layer: {
        scip_available: false,
        graph_available: false,
        status_reason: SCIP_STATUS_NOT_CONFIGURED,
        graph_nodes: [],
        graph_edges: [],
        coverage: null
      },
      queryKind,
      input,
      symbolResolution: {
        symbol: input.symbol,
        resolution: {
          kind: input.symbol ? "explicit_symbol" : "path_position",
          state: "unresolved",
          status_reason: SCIP_STATUS_NOT_CONFIGURED
        }
      },
      scipStateOverride: createCallGraphUnavailableState(null, SCIP_STATUS_NOT_CONFIGURED)
    });
  }

  const indexes = buildSymbolIndexes(layer);
  const symbolResolution =
    layer.scip_available === true && layer.graph_available !== false
      ? resolveSymbolFromInput(input, indexes)
      : {
          symbol: input.symbol,
          resolution: {
            kind: input.symbol ? "explicit_symbol" : "path_position",
            state: "unresolved",
            status_reason: layer.status_reason || "scip_indexer_unavailable"
          }
        };
  const availability = callGraphAvailability(layer);
  if (!availability.available) {
    return createSymbolQueryEnvelope({
      status,
      layer,
      queryKind,
      input,
      symbolResolution: {
        ...symbolResolution,
        resolution: {
          ...symbolResolution.resolution,
          status_reason: availability.statusReason
        }
      },
      scipStateOverride: createCallGraphUnavailableState(layer, availability.statusReason)
    });
  }
  if (!symbolResolution.symbol) {
    return createSymbolQueryEnvelope({
      status,
      layer,
      queryKind,
      input,
      symbolResolution
    });
  }

  const edges =
    queryKind === "symbol_callers"
      ? indexes.callsByCalleeSymbol.get(symbolResolution.symbol) || []
      : indexes.callsByCallerSymbol.get(symbolResolution.symbol) || [];
  const results = edges
    .map((edge) => resultEntryForCallEdge(edge, { layer }))
    .sort((left, right) =>
      `${left.caller_symbol}->${left.callee_symbol}:${left.edge_id}`.localeCompare(
        `${right.caller_symbol}->${right.callee_symbol}:${right.edge_id}`
      )
    );

  return createSymbolQueryEnvelope({
    status,
    layer,
    queryKind,
    input,
    symbolResolution,
    callers: queryKind === "symbol_callers" ? results : [],
    callees: queryKind === "symbol_callees" ? results : []
  });
}

function normalizeOptions(options) {
  return typeof options === "string" ? { symbol: options } : options;
}

export async function getSidecarSymbolReferences(options = {}) {
  return buildSymbolQuery({ ...options, queryKind: "find_references" });
}

export async function getSidecarSymbolDefinition(options = {}) {
  return buildSymbolQuery({ ...options, queryKind: "definition" });
}

export async function getSidecarSymbolCallers(options = {}) {
  return buildSymbolCallQuery({ ...normalizeOptions(options), queryKind: "symbol_callers" });
}

export async function getSidecarSymbolCallees(options = {}) {
  return buildSymbolCallQuery({ ...normalizeOptions(options), queryKind: "symbol_callees" });
}
