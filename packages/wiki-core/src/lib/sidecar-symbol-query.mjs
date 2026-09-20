import path from "node:path";

import { createSidecarResultEnvelope } from "./sidecar-schema.mjs";
import { assembleCallNavigationResult } from "./sidecar-call-query.mjs";
import {
  resolveCommittedSidecarSnapshot,
  sameGraphSnapshot,
  unavailableCommittedSnapshot
} from "./sidecar-committed-preparation.mjs";
import { readSidecarSymbolSelection } from "./sidecar-store.mjs";
import { normalizeSidecarNavigationInput } from "./sidecar-navigation-input.mjs";
import { projectNativeNavigation } from "./sidecar-navigation-projection.mjs";
import { resolveNativeNavigation } from "./sidecar-navigation-resolution.mjs";
import { assembleNativeNavigationResult } from "./sidecar-navigation-source-query.mjs";

const SCIP_STATUS_NOT_CONFIGURED = "scip_not_configured";
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
  const callGraphQuery = CALL_QUERY_KINDS.has(queryKind);
  if (
    result?.scip_state?.scip_available !== true ||
    result?.scip_state?.graph_available !== true ||
    (callGraphQuery && result?.scip_state?.call_graph_available === false)
  ) {
    return "Automatic committed-HEAD preparation runs every required SCIP provider before it " +
      "publishes, so an unavailable provider fails preparation instead of publishing incomplete " +
      "coverage; provision the provider and retry. When no SCIP provider applies to the committed " +
      "sources, symbol results stay unavailable. Status is read-only. Unsupported call " +
      "attribution is not repaired by provisioning; use definition or reference results.";
  }
  if (resolutionState === "unresolved") {
    return "Retry with an exact SCIP symbol or a repo-relative path, 1-based line, and optional character.";
  }
  return null;
}

export function projectSidecarSymbolQueryForMcp(result, { verbose = false } = {}) {
  if (verbose) {
    return { ...cloneJson(result), verbose: true };
  }

  const queryKind = result?.query_kind ?? null;
  const resultField = symbolResultField(queryKind);
  const allResults = resultField && Array.isArray(result?.[resultField]) ? result[resultField] : [];
  const returned = Math.min(allResults.length, MCP_SYMBOL_QUERY_RESULT_LIMIT);
  const resolutionState = result?.symbol_resolution?.state ?? "unresolved";
  return projectNativeNavigation(result, {
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
      returned,
      truncated: allResults.length > returned
    },
    next_action: compactSymbolNextAction(result, queryKind, resolutionState)
  });
}

function layerFromStore(selection) {
  const coverage = selection.publication.provider_coverage ?? {};
  return {
    scip_available: coverage.scip_available === true,
    graph_available: coverage.graph_available === true,
    call_graph_available: coverage.call_graph_available === true,
    status_reason: coverage.status_reason ?? SCIP_STATUS_NOT_CONFIGURED,
    ...(coverage.error_reason ? { error_reason: coverage.error_reason } : {}),
    coverage: cloneJson(coverage),
    provider_descriptors: selection.providers.map(({ descriptor }) => cloneJson(descriptor)),
    graph_edges: selection.symbol_edges.map(({ payload }) => cloneJson(payload))
  };
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
  scipStateOverride = null,
  navigation
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
    graph_snapshot: cloneJson(status.graph_snapshot),
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

async function selectCommittedSymbols({ dir, cacheDir, input }) {
  const prepared = await resolveCommittedSidecarSnapshot({
    dir: path.resolve(String(dir || ".")),
    cacheDir,
    dirtyState: true
  });
  if (!prepared.available) throw unavailableCommittedSnapshot(prepared.outcome, prepared.status);
  const selection = readSidecarSymbolSelection({ repoRoot: prepared.repoRoot, cacheDir,
    symbol: input.symbol, documentPath: input.path });
  if (!sameGraphSnapshot(selection.publication, prepared.graph_snapshot)) {
    throw unavailableCommittedSnapshot("repository_snapshot_changed", prepared.status);
  }
  return { status: prepared.status, selection, repoRoot: prepared.repoRoot };
}

async function buildNavigationQuery(options, queryKind) {
  const input = normalizeSidecarNavigationInput(options);
  const publicInput = { symbol: input.symbol ?? null, path: input.path ?? null,
    line: input.line ?? null, character: input.character ?? null };
  const { status, selection, repoRoot } = await selectCommittedSymbols({ dir: input.dir,
    cacheDir: input.cacheDir, input: publicInput });
  const layer = layerFromStore(selection);
  const callQuery = CALL_QUERY_KINDS.has(queryKind);
  if (layer.scip_available !== true || layer.graph_available === false) {
    const statusReason = layer.status_reason || "scip_indexer_unavailable";
    return createSymbolQueryEnvelope({ status, layer, queryKind, input: publicInput,
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
    return createSymbolQueryEnvelope({ status, layer, queryKind, input: publicInput,
      symbolResolution: { symbol: answer.symbol, resolution: answer.symbol_resolution },
      callers: answer.callers, callees: answer.callees, navigation: answer,
      scipStateOverride: availability.available ? null
        : createCallGraphUnavailableState(layer, availability.statusReason) });
  }
  const answer = await assembleNativeNavigationResult({ repoRoot, selection, queryKind, navigation });
  return createSymbolQueryEnvelope({
    status,
    layer,
    queryKind,
    input: publicInput,
    symbolResolution: { symbol: answer.symbol, resolution: answer.symbol_resolution },
    references: answer.references,
    definitions: answer.definitions,
    navigation: answer
  });
}

export async function getSidecarSymbolReferences(options = {}) {
  return buildNavigationQuery(options, "find_references");
}

export async function getSidecarSymbolDefinition(options = {}) {
  return buildNavigationQuery(options, "definition");
}

export async function getSidecarSymbolCallers(options = {}) {
  return buildNavigationQuery(options, "symbol_callers");
}

export async function getSidecarSymbolCallees(options = {}) {
  return buildNavigationQuery(options, "symbol_callees");
}
