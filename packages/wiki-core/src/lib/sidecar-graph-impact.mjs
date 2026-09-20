import path from "node:path";

import { createSidecarResultEnvelope } from "./sidecar-schema.mjs";
import { loadCanonicalState, resolveContractContext } from "./wiki.mjs";
import {
  SidecarGraphIndexUnbuildableError
} from "./sidecar-graph-impact-artifact.mjs";
import { runSidecarGit } from "./sidecar-status.mjs";
import { joinSidecarPathsToCanonicalRecords } from "./sidecar-joins.mjs";
import {
  SIDECAR_GRAPH_IMPACT_DIFF_RAW_PATCH_LIMITS,
  asStringList,
  cloneJson,
  pageKindForPath,
  provenance,
  uniqueStrings,
  validateImpactPath
} from "./sidecar-graph-impact-shared.mjs";
import { SIDECAR_GRAPH_SCHEMA_VERSION } from "./sidecar-graph-schema.mjs";
import { resolveSidecarRepositoryIdentity } from "./sidecar-repository-identity.mjs";
import { ensureSidecarIndex, SidecarIndexEnsureError } from "./sidecar-ensure.mjs";
import {
  resolveCommittedSidecarSnapshot,
  sameGraphSnapshot
} from "./sidecar-committed-preparation.mjs";
import { readSidecarGraphSelection } from "./sidecar-store.mjs";
import { projectSelectedUnitGraphBearingPaths } from "./work-record-dispatch-graph-projection.mjs";
import { collectDirtyGraphOverlay, selectGraph } from "./sidecar-graph-impact-overlay.mjs";
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
  queryEvidence,
  statusHints
} from "./sidecar-graph-impact-hints.mjs";
import { createCompactGraphImpactSummary } from "./sidecar-graph-impact-summary.mjs";

export { SIDECAR_GRAPH_IMPACT_DIFF_RAW_PATCH_LIMITS } from "./sidecar-graph-impact-shared.mjs";

const GRAPH_REBUILD_MAX_PASSES = 3;
const COMMITTED_HEAD_QUERY_SCHEMA_VERSION = "committed-head-graph-impact.v1";
const canonicalRecordCache = new Map();

export async function loadCanonicalRecords(targetDir, { profile, extensionNamespaces, cacheKey = null } = {}) {
  const key = cacheKey === null ? null : JSON.stringify([
    targetDir, cacheKey, profile ?? null, extensionNamespaces ?? null
  ]);
  if (key && canonicalRecordCache.has(key)) return canonicalRecordCache.get(key);
  const context = await resolveContractContext(targetDir, { profile, extensionNamespaces });
  const state = await loadCanonicalState(targetDir, {
    extensionNamespaces: context.extensionNamespaces
  });
  const records = [
    ...state.docs,
    ...state.decisions,
    ...state.areas,
    ...state.issues,
    ...state.initiatives,
    ...state.sources,
    ...state.wikiPages,
    ...state.extensionPages
  ].map((page) => ({
    ...page,
    id: page.frontmatter?.id ?? null,
    pageKind: pageKindForPath(page.relativePath)
  }));
  if (key) {
    canonicalRecordCache.set(key, records);
    while (canonicalRecordCache.size > 8) {
      canonicalRecordCache.delete(canonicalRecordCache.keys().next().value);
    }
  }
  return records;
}

function committedUnitIdentity(value) {
  if (
    !value ||
    !["work_item", "slice"].includes(value.kind) ||
    typeof value.address !== "string" ||
    typeof value.record_id !== "string" ||
    (value.kind === "slice" && typeof value.slice_id !== "string")
  ) return null;
  return {
    kind: value.kind,
    address: value.address.slice(0, 128),
    record_id: value.record_id.slice(0, 64),
    slice_id: value.kind === "slice" ? value.slice_id.slice(0, 64) : null
  };
}

export function deriveDirectImportAdjacencyFromGraph(graph, bearingPaths) {
  const bearing = new Set(Array.isArray(bearingPaths) ? bearingPaths : []);
  if (bearing.size === 0 || !graph || typeof graph !== "object") {
    return [];
  }

  const moduleNodePathById = new Map();
  for (const node of Array.isArray(graph.graph_nodes) ? graph.graph_nodes : []) {
    if (
      node &&
      typeof node === "object" &&
      node.kind === "module" &&
      typeof node.path === "string"
    ) {
      moduleNodePathById.set(node.id, node.path);
    }
  }

  const pairKeys = new Set();
  for (const edge of Array.isArray(graph.graph_edges) ? graph.graph_edges : []) {
    if (!edge || typeof edge !== "object" || edge.kind !== "imports_module") {
      continue;
    }
    const fromPath = moduleNodePathById.get(edge.from_node_id);
    const toPath = moduleNodePathById.get(edge.to_node_id);
    if (!fromPath || !toPath || fromPath === toPath) {
      continue;
    }
    if (!bearing.has(fromPath) || !bearing.has(toPath)) {
      continue;
    }
    const [a, b] = [fromPath, toPath].sort((left, right) => left.localeCompare(right));
    pairKeys.add(`${a}\t${b}`);
  }

  return [...pairKeys]
    .sort((left, right) => left.localeCompare(right))
    .map((key) => key.split("\t"));
}

function committedHeadFailure({ outcome, status, selectedUnit, cause = null }) {
  return {
    schema_version: COMMITTED_HEAD_QUERY_SCHEMA_VERSION,
    outcome,
    available: false,
    query_kind: "graph_impact_paths",
    repository_commit: status?.index_head ?? null,
    graph_schema_version: status?.graph_state?.graph_schema_version ?? null,
    generator_identity: null,
    selected_unit: cloneJson(selectedUnit ?? null),
    graph_state: {
      graph_available: false,
      edge_source: "unavailable",
      dirty_graph_mode: "unavailable",
      graph_schema_version: status?.graph_state?.graph_schema_version ?? null,
      unavailable_paths: []
    },
    ...(cause === null ? {} : { failure: {
      code: cause?.code ?? "committed_code_index_unavailable",
      message: cause?.message ?? String(cause),
      cause: structuredClone(cause?.envelope ?? null),
      recovery: cause?.envelope?.recovery ?? {
        action: "correct_the_reported_index_failure_then_retry_this_operation",
        automatic_rebuild_on_retry: true
      }
    } })
  };
}

function statusFailureOutcome(status) {
  if (status?.status_reason === "artifact_unreadable") return "base_artifact_corrupt";
  if (status?.status_reason === "artifact_missing") return "base_artifact_unavailable";
  if (
    status?.status_reason?.includes("incompatible") ||
    status?.status_reason?.includes("schema") ||
    status?.status_reason?.startsWith("generator_identity_")
  ) {
    return "base_artifact_incompatible";
  }
  return "base_artifact_unavailable";
}

export async function getCommittedHeadGraphImpactPaths({
  dir = ".",
  selectedUnit,
  subject,
  cacheDir = undefined,
  headReader = null,
  ensureIndex = ensureSidecarIndex
} = {}) {
  const unitIdentity = committedUnitIdentity(selectedUnit);
  if (!unitIdentity) {
    return committedHeadFailure({
      outcome: "selected_unit_invalid",
      status: null,
      selectedUnit: null
    });
  }
  let status = null;
  try {
    const prepared = await resolveCommittedSidecarSnapshot({ dir, cacheDir, ensureIndex });
    status = prepared.status;
    if (!prepared.available) {
      return committedHeadFailure({
        outcome: prepared.outcome,
        status,
        selectedUnit: unitIdentity
      });
    }
    const subjectPaths = [
      ...(Array.isArray(subject?.write_scope) ? subject.write_scope : []),
      ...(Array.isArray(subject?.repo_paths) ? subject.repo_paths : [])
    ].map(validateImpactPath).filter(({ ok }) => ok).map(({ relative_path }) => relative_path);
    const selection = readSidecarGraphSelection({
      repoRoot: prepared.repoRoot,
      cacheDir,
      paths: subjectPaths
    });
    if (!sameGraphSnapshot(selection.publication, prepared.graph_snapshot)) {
      return committedHeadFailure({
        outcome: "repository_snapshot_changed",
        status,
        selectedUnit: unitIdentity
      });
    }
    const [afterHead, afterTree] = await Promise.all([
      headReader ? headReader() : runSidecarGit(prepared.repoRoot,
        ["--no-replace-objects", "rev-parse", "HEAD"]),
      runSidecarGit(prepared.repoRoot, ["--no-replace-objects", "rev-parse", "HEAD^{tree}"])
    ]);
    if (afterHead !== prepared.graph_snapshot.repository_commit ||
        afterTree !== prepared.graph_snapshot.repository_tree) {
      return committedHeadFailure({ outcome: "repository_head_unstable", status,
        selectedUnit: unitIdentity });
    }
    const projection = projectSelectedUnitGraphBearingPaths({
      selectedUnit: unitIdentity,
      subject,
      committedSourcePaths: selection.files.map(({ path: value }) => value)
    });
    const sanitized = sanitizeGraphForbiddenPaths(selection.graph);
    const indexes = createGraphIndexes(sanitized.graph);

    const absentFromCommitted = new Set(projection.excluded_paths
      .filter(({ reason }) => reason === "absent_from_committed_artifact")
      .map(({ path: value }) => value));
    const unavailablePaths = uniqueStrings([
      ...selection.unavailable_paths.filter((value) => !absentFromCommitted.has(value)),
      ...sanitized.evidence.map(({ input_path }) => input_path)
    ]);
    const impacts = projection.graph_bearing_paths.flatMap((inputPath) =>
      connectedGraphImpact({ inputPath, indexes })
    );
    const impactedGraph = nodesAndEdgesForImpacts({ impacts, indexes });
    const graphState = {
      graph_available: true,
      edge_source: "base_index",
      dirty_graph_mode: "base_index_only",
      graph_schema_version: SIDECAR_GRAPH_SCHEMA_VERSION,
      unavailable_paths: unavailablePaths,
      dirty_state: "unknown",
      staleness: "fresh"
    };

    return {
      schema_version: COMMITTED_HEAD_QUERY_SCHEMA_VERSION,
      outcome: "available",
      available: true,
      query_kind: "graph_impact_paths",
      repository_commit: selection.publication.repository_commit,
      graph_schema_version: SIDECAR_GRAPH_SCHEMA_VERSION,
      generator_identity: selection.publication.generator_identity,
      graph_snapshot: prepared.graph_snapshot,
      selected_unit: unitIdentity,
      projection,
      input_paths: projection.subject_paths,
      validated_paths: projection.graph_bearing_paths,
      invalid_paths: [],
      graph_state: graphState,
      graph_import_adjacency: deriveDirectImportAdjacencyFromGraph(
        sanitized.graph,
        projection.graph_bearing_paths
      ),
      graph_nodes: impactedGraph.graph_nodes,
      graph_edges: impactedGraph.graph_edges,
      structural_impacts: impacts
    };
  } catch (cause) {
    return committedHeadFailure({
      outcome: cause?.envelope?.status_reason
        ? statusFailureOutcome({ status_reason: cause.envelope.status_reason })
        : "base_artifact_unavailable",
      status,
      selectedUnit: unitIdentity,
      cause
    });
  }
}

export async function resolveCurrentGraphForImpact({
  targetDir,
  cacheDir,
  paths = [],
  headReader = async () => {
    try {
      const repoRoot = await resolveSidecarRepositoryIdentity({ dir: targetDir });
      return await runSidecarGit(repoRoot, ["rev-parse", "HEAD"]);
    } catch (error) {

      if (error?.code === 128) return null;
      throw error;
    }
  }
} = {}) {
  let lastResolution = null;
  for (let pass = 0; pass < GRAPH_REBUILD_MAX_PASSES; pass += 1) {
    const isFinalPass = pass === GRAPH_REBUILD_MAX_PASSES - 1;
    let prepared;
    try {

      prepared = await resolveCommittedSidecarSnapshot({
        dir: targetDir,
        cacheDir,
        dirtyState: true
      });
    } catch (error) {
      if (!(error instanceof SidecarIndexEnsureError)) throw error;
      const headMoved = error.code === "sidecar_index_head_unstable";
      throw new SidecarGraphIndexUnbuildableError(
        headMoved
          ? "repository HEAD moved throughout committed graph-index recovery"
          : `repo code index could not be built for graph impact: ${error.message}`,
        { code: headMoved ? "graph_head_moved_unstable" : "graph_index_unbuildable",
          cause: error, status: error.envelope?.status ?? null }
      );
    }
    if (!prepared.available) {
      if (isFinalPass) {
        throw new SidecarGraphIndexUnbuildableError(
          `repo code index snapshot is unavailable: ${prepared.outcome}`,
          { code: "graph_index_unbuildable", status: prepared.status }
        );
      }
      continue;
    }
    const pinnedHead = prepared.graph_snapshot.repository_commit;
    const status = prepared.status;
    const rebuild = prepared.build;
    const gitState = {
      repoRoot: prepared.repoRoot,
      index_head: status.index_head,
      index_tree: status.index_tree,
      dirty_state: status.dirty_state,
      dirty_details: status.dirty_details
    };
    const storeSelection = readSidecarGraphSelection({
      repoRoot: gitState.repoRoot,
      cacheDir,
      paths,
      directories: paths.map((value) => path.posix.dirname(value)).filter((value) => value !== ".")
    });
    const snapshotStable = sameGraphSnapshot(storeSelection.publication, prepared.graph_snapshot);
    const overlay = await collectDirtyGraphOverlay({ repoRoot: gitState.repoRoot, status });
    const graphSelection = selectGraph({ baseGraph: storeSelection.graph, overlay });
    lastResolution = { gitState, status, storeSelection, overlay, graphSelection, rebuild };

    const afterHead = await headReader();
    if (afterHead === pinnedHead && snapshotStable) {

      return lastResolution;
    }

    if (isFinalPass) {
      throw new SidecarGraphIndexUnbuildableError(
        "repo HEAD moved or graph artifact identity changed during graph derivation and did not stabilize within the bounded retry; refusing to return a graph not proven to match current HEAD",
        { code: "graph_head_moved_unstable" }
      );
    }

  }
  return lastResolution;
}

export async function getSidecarGraphImpactPaths({
  dir = ".",
  paths = [],
  cacheDir = undefined,
  includeSuppressed = false,
  profile = null,
  extensionNamespaces = null,
  headReader = undefined,
  joinOperationObserver = null
} = {}) {
  const inputPaths = asStringList(paths);
  if (inputPaths.length === 0) {
    throw new Error("graph_impact_paths requires at least one path");
  }

  const targetDir = path.resolve(String(dir || "."));
  const validations = inputPaths.map(validateImpactPath);
  const validPaths = uniqueStrings(
    validations.filter((entry) => entry.ok).map((entry) => entry.relative_path)
  );
  const validationHints = validations.map((entry) => entry.hint);
  const invalidPaths = validations.filter((entry) => !entry.ok).map((entry) => entry.input_path);
  const { gitState, status, storeSelection, overlay, graphSelection, rebuild } =
    await resolveCurrentGraphForImpact({ targetDir, cacheDir, headReader, paths: validPaths });
  const sanitizedSelection = sanitizeGraphForbiddenPaths(graphSelection.graph);

  const graphImportAdjacency = deriveDirectImportAdjacencyFromGraph(graphSelection.graph, validPaths);

  const indexes = createGraphIndexes(sanitizedSelection.graph);
  const impacts = sanitizedSelection.graph
    ? validPaths.flatMap((inputPath) => connectedGraphImpact({ inputPath, indexes }))
    : [];
  const impactedGraph = nodesAndEdgesForImpacts({ impacts, indexes });
  const hints = sanitizedSelection.graph
    ? createMissingUpdateHints({
        validPaths,
        impacts,
        indexes
      })
    : [];
  const graphPathStates = graphPathEvidence({
    graphSelection,
    overlay,
    validPaths,
    graphNodes: indexes.nodes
  });
  const graphState = {
    ...graphSelection.graphState,
    unavailable_paths: uniqueStrings([
      ...graphPathStates.map((entry) => entry.input_path),
      ...sanitizedSelection.evidence.map((entry) => entry.input_path)
    ]).sort((left, right) => left.localeCompare(right))
  };

  let joined = createSidecarResultEnvelope({
    source_kind: "code_index",
    canonicality: "derived",
    evidence_basis: "path_match",
    index_head: status.index_head,
    index_tree: status.index_tree,
    dirty_state: status.dirty_state,
    dirty_details: status.dirty_details,
    staleness: status.staleness
  });

  const joinPaths = pathsForCanonicalJoin({
    validPaths,
    graphNodes: impactedGraph.graph_nodes,
    hints
  });
  if (joinPaths.length > 0) {
    const canonicalRecords = await loadCanonicalRecords(targetDir, {
      profile,
      extensionNamespaces,
      cacheKey: status.dirty_state === "clean" ? status.index_tree : null
    });
    const knownExistingPaths = uniqueStrings([
      ...storeSelection.files.map(({ path: value }) => value),
      ...storeSelection.directory_membership.map(({ path: value }) => value),
      ...(overlay.overlayState === "included" ? overlay.sourcePaths : [])
    ]);
    joined = joinSidecarPathsToCanonicalRecords({
      paths: joinPaths,
      canonicalRecords,
      knownExistingPaths,
      includeSuppressed,
      operationObserver: joinOperationObserver,
      envelope: {
        index_head: status.index_head,
        index_tree: status.index_tree,
        dirty_state: status.dirty_state,
        dirty_details: status.dirty_details,
        staleness: status.staleness
      }
    });
  }

  const result = createSidecarResultEnvelope({
    ...joined,
    index_head: status.index_head,
    index_tree: status.index_tree,
    dirty_state: status.dirty_state,
    dirty_details: status.dirty_details,
    staleness: status.staleness,
    derived_evidence: [
      ...status.derived_evidence.map(cloneJson),
      ...(rebuild
        ? [
            {
              kind: "sidecar_graph_index_rebuilt_on_use",
              build_action: rebuild.build_action ?? null,
              status_reason: rebuild.status_reason ?? null,
              index_head: rebuild.index_head ?? null,
              provenance: provenance({ evidenceBasis: "git_tree" })
            }
          ]
        : []),
      {
        kind: "sidecar_sqlite_selection",
        graph_snapshot: status.graph_snapshot,
        selected_file_count: storeSelection.files.length,
        selected_directory_member_count: storeSelection.directory_membership.length,
        selected_node_count: storeSelection.graph.graph_nodes.length,
        selected_edge_count: storeSelection.graph.graph_edges.length,
        provenance: provenance({ evidenceBasis: "git_tree" })
      },
      ...(overlay.evidence ? [overlay.evidence] : []),
      queryEvidence({ inputPaths: validPaths, includeSuppressed }),
      ...joined.derived_evidence.map(cloneJson),
      ...statusHints(status),
      ...validationHints,
      ...sanitizedSelection.evidence,
      ...graphPathStates
    ],
    cache_path: status.cache_path,
    artifact_path: status.artifact_path,
    artifact_exists: status.artifact_exists,
    artifact_schema_version: status.artifact_schema_version,
    expected_artifact_schema_version: status.expected_artifact_schema_version,
    graph_snapshot: cloneJson(status.graph_snapshot),
    status_reason: status.status_reason,
    query_kind: "graph_impact_paths",
    input_paths: inputPaths,
    validated_paths: validPaths,
    invalid_paths: invalidPaths,
    validation_hints: validationHints,
    graph_state: graphState,
    graph_import_adjacency: graphImportAdjacency,
    graph_nodes: impactedGraph.graph_nodes,
    graph_edges: impactedGraph.graph_edges,
    structural_impacts: impacts,
    missing_update_hints: hints
  });
  return {
    ...result,
    summary: createCompactGraphImpactSummary(result)
  };
}
