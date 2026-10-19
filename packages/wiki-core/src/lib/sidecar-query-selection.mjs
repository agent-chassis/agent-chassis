
import {
  resolveCommittedSidecarSnapshot,
  sameGraphSnapshot,
  unavailableCommittedSnapshot
} from "./sidecar-committed-preparation.mjs";
import { loadCanonicalRecords } from "./sidecar-graph-impact.mjs";
import {
  connectedGraphImpact,
  createGraphIndexes,
  nodesAndEdgesForImpacts,
  sanitizeGraphForbiddenPaths
} from "./sidecar-graph-impact-graph.mjs";
import {
  graphPathEvidence,
  pathsForCanonicalJoin,
  statusHints
} from "./sidecar-graph-impact-hints.mjs";
import { provenance, uniqueStrings } from "./sidecar-graph-impact-shared.mjs";
import { SIDECAR_GRAPH_SCHEMA_VERSION } from "./sidecar-graph-schema.mjs";
import { collectDirtyWorktreeOverlay } from "./sidecar-impact.mjs";
import { joinSidecarPathsToCanonicalRecords, declaredAncestorPrefixes } from "./sidecar-joins.mjs";
import { queryPlanningSemantics } from "./sidecar-planning-query.mjs";
import { filterSidecarSourcePaths } from "./sidecar-paths.mjs";
import { readSidecarGraphSelection, readSidecarPathExistence } from "./sidecar-store.mjs";

const NO_GRAPH_OVERLAY = Object.freeze({ dirtyPathStates: new Map(), unavailable: [] });
const byText = (left, right) => left.localeCompare(right);

export async function prepareCommittedQuery({ dir, cacheDir }, context = null) {
  const prepared = typeof context?.prepare === "function"
    ? await context.prepare({ dir, cacheDir })
    : await resolveCommittedSidecarSnapshot({ dir, cacheDir, dirtyState: true });
  if (!prepared.available) throw unavailableCommittedSnapshot(prepared.outcome, prepared.status);
  return prepared;
}

const SNAPSHOT_QUERY_MAX_PASSES = 3;

export async function runSnapshotQuery(context, evaluate) {
  for (let pass = 1; ; pass += 1) {
    try {
      return await evaluate();
    } catch (error) {
      if (error?.code !== "repository_snapshot_changed" || context?.repeatOnPublication !== true ||
          pass >= SNAPSHOT_QUERY_MAX_PASSES) throw error;
    }
  }
}

export function indexedCommitLabels(snapshot) {
  const commit = snapshot?.repository_commit ?? null;
  return { indexed_commit: commit, indexed_commit_short: commit === null ? null : commit.slice(0, 12) };
}

export function committedEnvelopeFields(prepared) {
  const { status } = prepared;
  return {
    index_head: status.index_head,
    index_tree: status.index_tree,
    dirty_state: status.dirty_state,
    dirty_details: status.dirty_details,
    staleness: status.staleness,
    cache_path: status.cache_path,
    artifact_path: status.artifact_path,
    artifact_exists: status.artifact_exists,
    artifact_schema_version: status.artifact_schema_version,
    expected_artifact_schema_version: status.expected_artifact_schema_version,
    graph_snapshot: structuredClone(status.graph_snapshot ?? null),
    ...indexedCommitLabels(status.graph_snapshot),
    current_head: status.index_head ?? null,
    preparation: {
      action: prepared.action ?? null,
      publication_outcome: prepared.publication_outcome ?? null,
      changed: prepared.changed ?? null,
      refresh: structuredClone(prepared.refresh ?? null)
    },
    status_reason: status.status_reason,
    scip_state: structuredClone(status.scip_state ?? null)
  };
}

export async function composeCommittedPaths({ prepared, cacheDir, targetDir, validPaths,
  includeSuppressed = false, includeOutgoing = false }) {
  const { status, repoRoot } = prepared;
  const selection = readSidecarGraphSelection({ repoRoot, cacheDir, paths: validPaths });
  const assertPublication = publication => {
    if (!sameGraphSnapshot(publication, prepared.graph_snapshot)) {
      throw unavailableCommittedSnapshot("repository_snapshot_changed", status);
    }
  };
  assertPublication(selection.publication);
  const semantic = await queryPlanningSemantics({ prepared, cacheDir, validPaths, includeOutgoing });
  const sanitized = sanitizeGraphForbiddenPaths(selection.graph);
  const indexes = createGraphIndexes(sanitized.graph);
  const allowed = new Set(["reverse_import", "docs_contract", "work_scope_owner", "downstream_mcp_tool"]);
  const impacts = validPaths.flatMap(inputPath => connectedGraphImpact({ inputPath, indexes }))
    .filter(impact => allowed.has(impact.kind)).map(impact => impact.kind === "downstream_mcp_tool"
      ? { ...impact, qualification: "lexical_registration_pattern", reason: "literal registerTool pattern in an import-reachable source" }
      : impact);
  const impacted = nodesAndEdgesForImpacts({ impacts, indexes });
  const pathStates = graphPathEvidence({ graphSelection: { graph: sanitized.graph },
    overlay: NO_GRAPH_OVERLAY, validPaths, graphNodes: indexes.nodes });
  const joinPaths = validPaths.length === 0 ? [] : pathsForCanonicalJoin({ validPaths,
    graphNodes: [...impacted.graph_nodes, ...semantic.semantic_relationships.map(row => ({ path: row.path }))], hints: [] });
  const canonicalRecords = joinPaths.length === 0 ? [] : await loadCanonicalRecords(targetDir,
    { cacheKey: status.dirty_state === "clean" ? status.index_tree : null });
  const existence = readSidecarPathExistence({ repoRoot, cacheDir, paths: joinPaths,
    prefixes: declaredAncestorPrefixes(canonicalRecords, joinPaths) });
  assertPublication(existence.publication);
  const sourceFilter = filterSidecarSourcePaths(existence.files.map(file => file.path));
  const joined = joinPaths.length === 0 ? { canonical_refs: [], derived_evidence: [] }
    : joinSidecarPathsToCanonicalRecords({ paths: joinPaths, canonicalRecords,
      knownExistingPaths: [...sourceFilter.included, ...existence.prefixes], includeSuppressed,
      envelope: { index_head: status.index_head, index_tree: status.index_tree,
        dirty_state: status.dirty_state, dirty_details: status.dirty_details, staleness: status.staleness } });
  const overlay = await collectDirtyWorktreeOverlay({ repoRoot, status });
  return {
    selection,
    impacts,
    graph_nodes: impacted.graph_nodes,
    graph_edges: impacted.graph_edges,
    ...semantic,
    overlay,
    canonical_refs: joined.canonical_refs,
    path_states: pathStates,
    graph_state: {
      graph_available: true,
      edge_source: "base_index",
      dirty_graph_mode: "base_index_only",
      graph_schema_version: SIDECAR_GRAPH_SCHEMA_VERSION,
      unavailable_paths: uniqueStrings([...pathStates, ...sanitized.evidence]
        .map(({ input_path: value }) => value)).sort(byText),
      dirty_state: status.dirty_state,
      staleness: status.staleness
    },
    derived_evidence: [
      ...status.derived_evidence.map((entry) => structuredClone(entry)),
      { kind: "sidecar_sqlite_selection", graph_snapshot: structuredClone(status.graph_snapshot),
        selected_file_count: selection.files.length,
        selected_node_count: selection.graph.graph_nodes.length,
        selected_edge_count: selection.graph.graph_edges.length,
        provenance: provenance({ evidenceBasis: "working_checkout" }) },
      ...(sourceFilter.rejected.length > 0 ? [{ kind: "sidecar_filtered_cached_source_paths",
        rejected_source_count: sourceFilter.rejected.length,
        rejected_source_paths: sourceFilter.rejected.slice(0, 100).map((entry) => ({
          input_path: entry.inputPath, relative_path: entry.relativePath ?? null, code: entry.code,
          pattern: entry.pattern ?? null, reason: entry.reason ?? null })),
        provenance: provenance({ evidenceBasis: "working_checkout" }) }] : []),
      ...(overlay.evidence ? [overlay.evidence] : []),
      ...joined.derived_evidence.map((entry) => structuredClone(entry)),
      ...statusHints(status),
      ...sanitized.evidence,
      ...pathStates
    ]
  };
}

function addRelationship(files, filePath, relationship) {
  if (typeof filePath !== "string" || filePath.length === 0) return;
  const entry = files.get(filePath) ?? { path: filePath, relationships: new Map() };
  entry.relationships.set(JSON.stringify(relationship), relationship);
  files.set(filePath, entry);
}

export function attributeAffectedFiles(composed) {
  const files = new Map();
  const nodes = new Map(composed.graph_nodes.map((node) => [node.id, node]));
  const edges = new Map(composed.graph_edges.map(edge => [edge.id, edge]));
  for (const impact of composed.impacts) {
    if (impact.kind === "reverse_import") {
      for (const edgeId of impact.edge_ids) {
        const edge = edges.get(edgeId);
        const importer = nodes.get(edge.from_node_id)?.path;
        if (importer === impact.input_path) continue;
        addRelationship(files, importer, { basis: "graph", kind: "reverse_import",
          input_path: impact.input_path, edge_id: edge.id, from_node_id: edge.from_node_id,
          to_node_id: edge.to_node_id, from_path: importer, to_path: nodes.get(edge.to_node_id)?.path,
          direct: edge.to_node_id === `module:${impact.input_path}`, reason: impact.reason,
          provenance: structuredClone(edge.provenance ?? impact.provenance) });
      }
      continue;
    }
    for (const nodeId of impact.node_ids) {
      const nodePath = nodes.get(nodeId)?.path;
      if (nodePath === impact.input_path) continue;
      addRelationship(files, nodePath, { basis: "graph", kind: impact.kind,
        input_path: impact.input_path, severity: impact.severity, reason: impact.reason,
        ...(impact.qualification ? { qualification: impact.qualification } : {}) });
    }
  }
  for (const row of composed.semantic_relationships) {
    if (row.path === row.input_path) continue;
    addRelationship(files, row.path, { basis: "scip", kind: "reference", direction: row.direction,
      input_path: row.input_path, symbol: row.symbol, symbol_key: row.symbol_key, relationship_id: row.id });
  }
  for (const ref of composed.canonical_refs) {
    addRelationship(files, ref.path, { basis: "canonical_record", kind: "canonical_reference",
      id: ref.id ?? null, match_types: [...(ref.match_types ?? [])] });
  }
  return [...files.values()].sort((left, right) => byText(left.path, right.path))
    .map((entry) => ({ path: entry.path, relationships: [...entry.relationships.keys()].sort(byText)
      .map((key) => entry.relationships.get(key)) }));
}
