import { isNativeDefinition, nativeOccurrenceIdentity } from "./sidecar-navigation-resolution.mjs";
import { assembleCommittedOccurrenceSource } from "./sidecar-occurrence-source.mjs";
import { parseScipSymbol } from "./sidecar-scip-normalize.mjs";

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

const callEdgeIdentity = (edge) => JSON.stringify(["call_edge", edge.provider_id, edge.edge_id]);

export function callSiteDocument(edge) {
  const value = edge.document_path ?? edge.payload?.provenance?.path ?? null;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function matchesCandidate(edge, candidate, endpoint) {
  return edge.kind === "calls_symbol" && candidate.provider_ids.includes(edge.provider_id) &&
    edge[endpoint] === candidate.symbol &&
    (!parseScipSymbol(candidate.symbol).local || callSiteDocument(edge) === candidate.path);
}

function anchorRows(candidate) {
  if (candidate.anchors.length > 0) return candidate.anchors;
  const definitions = candidate.rows.filter(isNativeDefinition);
  return (definitions.length > 0 ? definitions : candidate.rows).slice(0, 1);
}

function narrowedSelection(selection, candidates, anchors, matches) {
  const documents = new Set([...anchors.values()].map((row) => row.document_path));
  for (const candidate of candidates) {
    for (const documentPath of candidate.symbol_document_paths) documents.add(documentPath);
  }
  for (const { edge } of matches.values()) {
    const documentPath = callSiteDocument(edge);
    if (documentPath !== null) documents.add(documentPath);
  }
  return {
    publication: selection.publication,
    occurrences: [...anchors.values()],
    position_occurrences: [],
    source_files: selection.source_files.filter((file) => documents.has(file.path)),
    source_definition_occurrences: selection.source_definition_occurrences
      .filter((row) => documents.has(row.document_path))
  };
}

function callEntry({ edge, candidate }, hit, providers) {
  const payload = edge.payload ?? {};
  const provider = providers.get(edge.provider_id);
  return {
    hit_id: hit.hit_id,
    edge_id: edge.edge_id,
    provider_id: edge.provider_id,
    symbol_key: candidate.symbol_key,
    caller_symbol: edge.from_symbol,
    callee_symbol: edge.to_symbol,
    from_node_id: payload.from_node_id ?? null,
    to_node_id: payload.to_node_id ?? null,
    occurrence_count: Number.isSafeInteger(payload.occurrence_count) ? payload.occurrence_count : null,
    lines: Array.isArray(payload.lines) ? [...payload.lines] : [],
    document_path: callSiteDocument(edge),
    resolution: structuredClone(payload.resolution ?? { state: "unresolved" }),
    provider_descriptor: structuredClone(payload.provider_descriptor ?? provider?.descriptor ?? null),
    coverage: provider ? structuredClone(provider.coverage) : null,
    provenance: structuredClone(payload.provenance ??
      { source_kind: "scip", canonicality: "derived", evidence_basis: "scip" }),
    edge: structuredClone(edge),
    source: structuredClone(hit.source)
  };
}

function compareCallEntries(left, right) {
  const [leftPath, rightPath] = [left.document_path, right.document_path];
  return Number(leftPath === null) - Number(rightPath === null) ||
    compareText(leftPath ?? "", rightPath ?? "") ||
    (left.lines[0] ?? 0) - (right.lines[0] ?? 0) ||
    compareText(left.symbol_key, right.symbol_key) ||
    compareText(left.provider_id, right.provider_id) ||
    compareText(left.edge_id, right.edge_id);
}

function publicCandidate(candidate, { hits, order, results }) {
  const hitIds = anchorRows(candidate).map(nativeOccurrenceIdentity).filter((id) => hits.has(id))
    .sort((left, right) => order.get(left) - order.get(right));
  return {
    symbol_key: candidate.symbol_key,
    indexer: candidate.indexer,
    symbol: candidate.symbol,
    path: candidate.path,
    provider_ids: candidate.provider_ids,
    resolution_facts: candidate.resolution_facts,
    hit_ids: hitIds,
    region_ids: [...new Set(hitIds.map((id) => hits.get(id).source.region_id)
      .filter((id) => typeof id === "string"))].sort(compareText),
    result_hit_ids: results.filter((entry) => entry.symbol_key === candidate.symbol_key)
      .map((entry) => entry.hit_id),
    ...(hitIds.length === 0 ? { source: { state: "unavailable",
      reason: candidate.external ? "external_definition" : "source_location_unavailable" } } : {})
  };
}

export async function assembleCallNavigationResult({ repoRoot, selection, navigation, queryKind,
  callGraphAvailable }) {
  const endpoint = queryKind === "symbol_callers" ? "to_symbol" : "from_symbol";
  const matches = new Map();
  for (const candidate of callGraphAvailable ? navigation.candidates : []) {
    for (const edge of selection.symbol_edges) {
      if (matchesCandidate(edge, candidate, endpoint) && !matches.has(callEdgeIdentity(edge))) {
        matches.set(callEdgeIdentity(edge), { edge, candidate });
      }
    }
  }
  const anchors = new Map();
  for (const candidate of navigation.candidates) {
    for (const row of anchorRows(candidate)) anchors.set(nativeOccurrenceIdentity(row), row);
  }
  const source = await assembleCommittedOccurrenceSource({ repoRoot,
    selection: narrowedSelection(selection, navigation.candidates, anchors, matches),
    callEdges: [...matches.values()].map(({ edge, candidate }) => ({ provider_id: edge.provider_id,
      edge_id: edge.edge_id, document_path: callSiteDocument(edge),
      lines: Array.isArray(edge.payload?.lines) ? edge.payload.lines : [], symbol_key: candidate.symbol_key })) });
  const hits = new Map(source.source_hits.map((hit) => [hit.hit_id, hit]));
  const order = new Map(source.source_hits.map((hit, index) => [hit.hit_id, index]));
  const providers = new Map(selection.providers.map((provider) => [provider.provider_id, provider]));
  const results = [...matches.entries()]
    .map(([id, match]) => callEntry(match, hits.get(id), providers)).sort(compareCallEntries);
  return {
    symbol: navigation.symbol,
    symbol_resolution: { ...navigation.resolution,
      candidates: navigation.candidates.map((candidate) => publicCandidate(candidate, { hits, order, results })) },
    [queryKind === "symbol_callers" ? "callers" : "callees"]: results,
    call_attribution: { state: callGraphAvailable ? "available" : "unavailable" },
    symbol_facts: navigation.symbol_facts,
    source_hits: source.source_hits,
    context_regions: source.context_regions,
    complete_files: source.complete_files
  };
}
