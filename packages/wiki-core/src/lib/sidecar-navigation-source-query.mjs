import { assembleCommittedOccurrenceSource } from "./sidecar-occurrence-source.mjs";
import { isNativeDefinition, nativeOccurrenceIdentity } from "./sidecar-navigation-resolution.mjs";

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function narrowedRows(candidates, includeReferences) {
  const results = new Map();
  const selected = new Map();
  for (const candidate of candidates) {
    const own = candidate.rows.filter((row) => includeReferences || isNativeDefinition(row));
    for (const row of own) results.set(nativeOccurrenceIdentity(row), row);
    const anchors = candidate.anchors.length > 0 ? candidate.anchors
      : own.length === 0 ? candidate.rows.slice(0, 1) : [];
    for (const row of [...own, ...anchors]) selected.set(nativeOccurrenceIdentity(row), row);
  }
  return { results, selected };
}

function narrowedSelection(selection, candidates, selected) {
  const documents = new Set([...selected.values()].map((row) => row.document_path));
  for (const candidate of candidates) {
    for (const documentPath of candidate.symbol_document_paths) documents.add(documentPath);
  }
  return {
    publication: selection.publication,
    occurrences: [...selected.values()],
    position_occurrences: [],
    source_files: selection.source_files.filter((file) => documents.has(file.path)),
    source_definition_occurrences: selection.source_definition_occurrences
      .filter((row) => documents.has(row.document_path))
  };
}

function resultEntry(row, hit, providers) {
  const provider = providers.get(row.provider_id);
  return {
    ...structuredClone(row.payload),
    line: row.payload.range?.start_line ?? null,
    provider_id: row.provider_id,
    hit_id: hit.hit_id,
    source: structuredClone(hit.source),
    occurrence: structuredClone(row),
    provider_descriptor: provider ? structuredClone(provider.descriptor) : null,
    coverage: provider ? structuredClone(provider.coverage) : null,
    provenance: { source_kind: "scip", canonicality: "derived", evidence_basis: "scip",
      path: row.document_path }
  };
}

function publicCandidate(candidate, hits, order) {
  const hitIds = candidate.rows.map(nativeOccurrenceIdentity).filter((id) => hits.has(id))
    .sort((left, right) => order.get(left) - order.get(right));
  const regionIds = [...new Set(hitIds.map((id) => hits.get(id).source.region_id)
    .filter((id) => typeof id === "string"))].sort(compareText);
  return {
    symbol_key: candidate.symbol_key,
    indexer: candidate.indexer,
    symbol: candidate.symbol,
    path: candidate.path,
    provider_ids: candidate.provider_ids,
    resolution_facts: candidate.resolution_facts,
    hit_ids: hitIds,
    region_ids: regionIds,
    ...(hitIds.length === 0 ? { source: { state: "unavailable",
      reason: candidate.external ? "external_definition" : "source_location_unavailable" } } : {})
  };
}

export async function assembleNativeNavigationResult({ repoRoot, selection, navigation, queryKind }) {
  const includeReferences = queryKind === "find_references";
  const { results, selected } = narrowedRows(navigation.candidates, includeReferences);
  const source = await assembleCommittedOccurrenceSource({ repoRoot,
    selection: narrowedSelection(selection, navigation.candidates, selected) });
  const hits = new Map(source.source_hits.map((hit) => [hit.hit_id, hit]));
  const order = new Map(source.source_hits.map((hit, index) => [hit.hit_id, index]));
  const providers = new Map(selection.providers.map((provider) => [provider.provider_id, provider]));
  const entries = [...results.entries()]
    .sort(([left], [right]) => order.get(left) - order.get(right))
    .map(([id, row]) => [row, resultEntry(row, hits.get(id), providers)]);
  const candidates = navigation.candidates.map((candidate) => publicCandidate(candidate, hits, order));
  return {
    symbol: navigation.symbol,
    symbol_resolution: { ...navigation.resolution, candidates },
    definitions: entries.filter(([row]) => isNativeDefinition(row)).map(([, entry]) => entry),
    references: entries.filter(([row]) => !isNativeDefinition(row)).map(([, entry]) => entry),
    symbol_facts: navigation.symbol_facts,
    source_hits: source.source_hits,
    context_regions: source.context_regions,
    complete_files: source.complete_files
  };
}
