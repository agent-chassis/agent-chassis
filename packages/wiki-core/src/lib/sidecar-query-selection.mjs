import path from "node:path";

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
  createMissingUpdateHints,
  graphPathEvidence,
  pathsForCanonicalJoin,
  statusHints
} from "./sidecar-graph-impact-hints.mjs";
import { provenance, uniqueStrings } from "./sidecar-graph-impact-shared.mjs";
import { SIDECAR_GRAPH_SCHEMA_VERSION } from "./sidecar-graph-schema.mjs";
import { collectDirtyWorktreeOverlay } from "./sidecar-impact.mjs";
import { joinSidecarPathsToCanonicalRecords } from "./sidecar-joins.mjs";
import { deriveSidecarPathContext } from "./sidecar-path-context.mjs";
import { filterSidecarSourcePaths } from "./sidecar-paths.mjs";
import { readSidecarGraphSelection } from "./sidecar-store.mjs";

const TEST_DIRECTORIES = ["tests/unit", "tests/integration"];
const NO_GRAPH_OVERLAY = Object.freeze({ dirtyPathStates: new Map(), unavailable: [] });
const byText = (left, right) => left.localeCompare(right);

export async function prepareCommittedQuery({ dir, cacheDir }) {
  const prepared = await resolveCommittedSidecarSnapshot({ dir, cacheDir, dirtyState: true });
  if (!prepared.available) throw unavailableCommittedSnapshot(prepared.outcome, prepared.status);
  return prepared;
}

export function committedEnvelopeFields(status) {
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
    status_reason: status.status_reason,
    scip_state: structuredClone(status.scip_state ?? null)
  };
}

function inferredByPath(inferred, field) {
  return Object.fromEntries(Object.entries(inferred).map(([inputPath, context]) =>
    [inputPath, context[field].map((entry) => entry.path)]));
}

export async function composeCommittedPaths({ prepared, cacheDir, targetDir, validPaths,
  includeSuppressed = false }) {
  const { status, repoRoot } = prepared;
  const selection = readSidecarGraphSelection({ repoRoot, cacheDir, paths: validPaths,
    directories: uniqueStrings([...validPaths.map((value) => path.posix.dirname(value))
      .filter((value) => value !== "."), ...TEST_DIRECTORIES]) });
  if (!sameGraphSnapshot(selection.publication, prepared.graph_snapshot)) {
    throw unavailableCommittedSnapshot("repository_snapshot_changed", status);
  }
  const knownPaths = uniqueStrings([...selection.files, ...selection.directory_membership]
    .map(({ path: value }) => value)).sort(byText);
  const sourceFilter = filterSidecarSourcePaths(knownPaths);
  const sanitized = sanitizeGraphForbiddenPaths(selection.graph);
  const indexes = createGraphIndexes(sanitized.graph);
  const impacts = validPaths.flatMap((inputPath) => connectedGraphImpact({ inputPath, indexes }));
  const impacted = nodesAndEdgesForImpacts({ impacts, indexes });
  const hints = createMissingUpdateHints({ validPaths, impacts, indexes });
  const pathStates = graphPathEvidence({ graphSelection: { graph: sanitized.graph },
    overlay: NO_GRAPH_OVERLAY, validPaths, graphNodes: indexes.nodes });
  const inferred = Object.fromEntries(validPaths.map((inputPath) => [inputPath,
    deriveSidecarPathContext({ inputPaths: [inputPath], sourcePaths: sourceFilter.included })]));
  const likelyTestsByPath = inferredByPath(inferred, "inferred_tests");
  const joinPaths = validPaths.length === 0 ? []
    : pathsForCanonicalJoin({ validPaths, graphNodes: impacted.graph_nodes, hints });
  const joined = joinPaths.length === 0 ? { canonical_refs: [], derived_evidence: [] }
    : joinSidecarPathsToCanonicalRecords({ paths: joinPaths,
      canonicalRecords: await loadCanonicalRecords(targetDir,
        { cacheKey: status.dirty_state === "clean" ? status.index_tree : null }),
      knownExistingPaths: sourceFilter.included, testAdjacency: likelyTestsByPath, includeSuppressed,
      envelope: { index_head: status.index_head, index_tree: status.index_tree,
        dirty_state: status.dirty_state, dirty_details: status.dirty_details, staleness: status.staleness } });
  const overlay = await collectDirtyWorktreeOverlay({ repoRoot, status });
  return {
    selection,
    impacts,
    graph_nodes: impacted.graph_nodes,
    graph_edges: impacted.graph_edges,
    hints,
    overlay,
    inferred,
    likely_tests_by_path: likelyTestsByPath,
    related_code_paths_by_path: inferredByPath(inferred, "related_paths"),
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
        selected_directory_member_count: selection.directory_membership.length,
        selected_node_count: selection.graph.graph_nodes.length,
        selected_edge_count: selection.graph.graph_edges.length,
        provenance: provenance({ evidenceBasis: "git_tree" }) },
      ...(sourceFilter.rejected.length > 0 ? [{ kind: "sidecar_filtered_cached_source_paths",
        rejected_source_count: sourceFilter.rejected.length,
        rejected_source_paths: sourceFilter.rejected.slice(0, 100).map((entry) => ({
          input_path: entry.inputPath, relative_path: entry.relativePath ?? null, code: entry.code,
          pattern: entry.pattern ?? null, reason: entry.reason ?? null })),
        provenance: provenance({ evidenceBasis: "git_blob" }) }] : []),
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
  for (const impact of composed.impacts) {
    for (const nodeId of impact.node_ids) {
      const nodePath = nodes.get(nodeId)?.path;
      if (nodePath === impact.input_path) continue;
      addRelationship(files, nodePath, { basis: "graph", kind: impact.kind,
        input_path: impact.input_path, severity: impact.severity, reason: impact.reason });
    }
  }
  for (const [inputPath, context] of Object.entries(composed.inferred)) {
    for (const [field, kind] of [["inferred_tests", "inferred_test"], ["related_paths", "related_code"]]) {
      for (const entry of context[field]) {
        addRelationship(files, entry.path, { basis: "inferred_adjacency", kind, input_path: inputPath,
          evidence_basis: entry.evidence_basis });
      }
    }
  }
  for (const ref of composed.canonical_refs) {
    addRelationship(files, ref.path, { basis: "canonical_record", kind: "canonical_reference",
      id: ref.id ?? null, match_types: [...(ref.match_types ?? [])] });
  }
  for (const hint of composed.hints) {
    for (const suggested of hint.suggested_paths) {
      addRelationship(files, suggested, { basis: "suggested_update", kind: hint.kind,
        input_path: hint.input_path, missing_surface: hint.missing_surface });
    }
  }
  return [...files.values()].sort((left, right) => byText(left.path, right.path))
    .map((entry) => ({ path: entry.path, relationships: [...entry.relationships.keys()].sort(byText)
      .map((key) => entry.relationships.get(key)) }));
}
