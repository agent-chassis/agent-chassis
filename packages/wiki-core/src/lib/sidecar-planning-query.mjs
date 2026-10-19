import { readSidecarSymbolSelection } from "./sidecar-store.mjs";
import { sameGraphSnapshot, unavailableCommittedSnapshot } from "./sidecar-committed-preparation.mjs";
import { nativeDefinitionSymbols, nativeSelectionCandidates, nativeMultiplicityRows,
  isNativeDefinition, nativeOccurrenceIdentity, compareNativeRows } from "./sidecar-navigation-resolution.mjs";
import { assembleNativeNavigationResult } from "./sidecar-navigation-source-query.mjs";
import { layerFromStore, createScipUnavailableState } from "./sidecar-query-layers.mjs";
import { sidecarDependencyLimitations } from "./sidecar-scip-projects.mjs";

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const provenance = { source_kind: "scip", canonicality: "derived", evidence_basis: "scip" };

export async function queryPlanningSemantics({ prepared, cacheDir, validPaths, includeOutgoing }) {
  const selection = readSidecarSymbolSelection({ repoRoot: prepared.repoRoot, cacheDir,
    documentPaths: validPaths, positionSymbols: nativeDefinitionSymbols, planning: true, includeOutgoing });
  if (!sameGraphSnapshot(selection.publication, prepared.graph_snapshot)) {
    throw unavailableCommittedSnapshot("repository_snapshot_changed", prepared.status);
  }
  const layer = layerFromStore(selection);
  const available = layer.scip_available && layer.graph_available;
  const navigation = available ? nativeSelectionCandidates(selection) : { candidates: [], symbol_facts: [] };
  const source = await assembleNativeNavigationResult({ repoRoot: prepared.repoRoot, selection,
    navigation: { ...navigation, symbol: null, resolution: { kind: "planning" } },
    queryKind: "find_references" });
  const candidates = navigation.candidates.map(candidate => ({ ...candidate,
    rows: nativeMultiplicityRows(candidate.rows).sort(compareNativeRows) }));
  const relationships = new Map();
  const resolutions = [];
  const ids = rows => rows.map(nativeOccurrenceIdentity);
  const inputSet = new Set(validPaths);
  for (const inputPath of validPaths) {
    const own = selection.position_occurrences.filter(row => row.document_path === inputPath);
    if (!available || own.length === 0) resolutions.push({ input_path: inputPath, state: "unavailable",
      status_reason: !selection.source_files.some(file => file.path === inputPath)
        ? "missing_file_descriptor" : layer.scip_available ? "native_document_unavailable" : layer.status_reason,
      candidates: [] });
    for (const candidate of candidates) {
      const definitions = candidate.rows.filter(isNativeDefinition);
      const references = candidate.rows.filter(row => !isNativeDefinition(row));
      const ownDefinitions = definitions.filter(row => row.document_path === inputPath);
      const ownReferences = references.filter(row => row.document_path === inputPath);
      const add = (direction, otherPath, defs, refs) => {
        if (otherPath === inputPath) return;
        const tuple = [inputPath, direction, candidate.symbol_key, otherPath];
        const id = JSON.stringify(tuple);
        relationships.set(id, { id, kind: "reference", direction, input_path: inputPath,
          path: otherPath, symbol: candidate.symbol, symbol_key: candidate.symbol_key,
          provider_ids: candidate.provider_ids, definition_hit_ids: ids(defs), reference_hit_ids: ids(refs),
          provenance: { ...provenance } });
      };
      if (ownDefinitions.length > 0) {
        for (const otherPath of [...new Set(references.map(row => row.document_path))].sort(compare)) {
          add("incoming", otherPath, ownDefinitions, references.filter(row => row.document_path === otherPath));
        }
      }
      if (!includeOutgoing || ownReferences.length === 0) continue;
      const paths = [...new Set(definitions.map(row => row.document_path))].sort(compare);
      const state = paths.length === 1 ? "resolved" : paths.length > 1 ? "ambiguous"
        : candidate.external ? "external" : "unresolved";
      resolutions.push({ id: JSON.stringify([inputPath, candidate.symbol_key, state]),
        input_path: inputPath, symbol: candidate.symbol, symbol_key: candidate.symbol_key,
        state, status_reason: state === "resolved" ? "symbol_resolved" : `symbol_${state}`,
        provider_ids: candidate.provider_ids, reference_hit_ids: ids(ownReferences),
        definition_hit_ids: ids(definitions), candidates: paths.map(path => ({ path,
          symbol: candidate.symbol, symbol_key: candidate.symbol_key,
          definition_hit_ids: ids(definitions.filter(row => row.document_path === path)) })),
        resolution_facts: candidate.resolution_facts });
      if (state === "resolved") add("outgoing", paths[0], definitions, ownReferences);
    }
  }
  return {
    semantic_relationships: [...relationships.values()].sort((a, b) =>
      compare(a.input_path, b.input_path) || compare(a.direction, b.direction) ||
      compare(a.symbol_key, b.symbol_key) || compare(a.path, b.path)),
    semantic_resolution: resolutions.sort((a, b) => compare(a.input_path, b.input_path) ||
      compare(a.symbol_key ?? "", b.symbol_key ?? "")),
    semantic_coverage: { ...createScipUnavailableState(layer), coverage: layer.coverage,
      dependency_limitations: validPaths.flatMap(path => sidecarDependencyLimitations(layer.coverage, path)),
      test_identity: { state: "unavailable", reason: "no_native_test_identity" },
      implementation_relations: { state: "unavailable", reason: "no_supported_implementation_facts" },
      cli_schema_attribution: { state: "unavailable", reason: "no_semantic_cli_schema_attribution" },
      impact_granularity: "file", impact_meaning: "potential_impact" },
    definitions: source.definitions.filter(row => inputSet.has(row.path)),
    source_hits: source.source_hits.map(hit => ({ ...hit, path: hit.occurrence.document_path,
      symbol: hit.occurrence.payload.symbol, symbol_key: hit.occurrence.payload.symbol_key,
      kind: isNativeDefinition(hit.occurrence) ? "definition" : "reference" })),
    context_regions: source.context_regions,
    complete_files: source.complete_files
  };
}

export function planningFields(composed) {
  return Object.fromEntries(["semantic_relationships", "semantic_resolution", "semantic_coverage",
    "definitions", "source_hits", "context_regions", "complete_files"].map(field => [field, composed[field]]));
}

export function planningCounts(composed) {
  return Object.fromEntries(["semantic_relationships", "semantic_resolution", "definitions", "source_hits",
    "context_regions", "complete_files"].map(field => [field, composed[field].length]));
}
