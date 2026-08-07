import { access } from "node:fs/promises";
import path from "node:path";

import {
  SIDECAR_ARTIFACT_SCHEMA_VERSION,
  createSidecarResultEnvelope
} from "./sidecar-schema.mjs";
import {
  discoverSidecarGitState,
  getSidecarIndexStatus,
  resolveSidecarArtifactPath,
  runSidecarGit
} from "./sidecar-status.mjs";
import { joinSidecarPathsToCanonicalRecords } from "./sidecar-joins.mjs";
import {
  SIDECAR_GRAPH_IMPACT_DIFF_RAW_PATCH_LIMITS,
  asStringList,
  cloneJson,
  provenance,
  uniqueStrings,
  validateImpactPath
} from "./sidecar-graph-impact-shared.mjs";
import {
  artifactIdentityMatches,
  classifyReadSidecarGraphArtifact,
  loadCanonicalRecords,
  readArtifact,
  rebuildGraphIndexAtHead,
  SidecarGraphIndexUnbuildableError,
  sourcePathsFromArtifact
} from "./sidecar-graph-impact-artifact.mjs";
import { SIDECAR_GRAPH_SCHEMA_VERSION } from "./sidecar-graph-schema.mjs";
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
import {
  diffPathStates,
  emptyGraphImpactResult,
  normalizeGraphImpactDiffInput,
  pathsForDiffImpact
} from "./sidecar-graph-impact-diff.mjs";

export { SIDECAR_GRAPH_IMPACT_DIFF_RAW_PATCH_LIMITS } from "./sidecar-graph-impact-shared.mjs";

const GRAPH_REBUILD_MAX_PASSES = 3;
const COMMITTED_HEAD_QUERY_SCHEMA_VERSION = "committed-head-graph-impact.v1";

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

function statusRequiresRebuild(status) {
  return status?.index_action === "rebuild";
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

function committedHeadFailure({ outcome, status, selectedUnit }) {
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
    }
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

async function getCommittedHeadArtifactStatus({ dir, cacheDir }) {
  const repoRoot = await runSidecarGit(dir, ["rev-parse", "--show-toplevel"]);
  const [indexHead, indexTree] = await Promise.all([
    runSidecarGit(repoRoot, ["rev-parse", "HEAD"]),
    runSidecarGit(repoRoot, ["rev-parse", "HEAD^{tree}"])
  ]);
  const artifactPaths = resolveSidecarArtifactPath({ repoRoot, cacheDir });
  let artifactExists = true;
  try {
    await access(artifactPaths.artifactPath);
  } catch {
    artifactExists = false;
  }
  return {
    repo_root: repoRoot,
    artifact_exists: artifactExists,
    artifact_path: artifactPaths.artifactRelativePath,
    artifact_schema_version: SIDECAR_ARTIFACT_SCHEMA_VERSION,
    staleness: artifactExists ? "fresh" : "missing",
    index_action: artifactExists ? "use" : "rebuild",
    status_reason: artifactExists ? "source_identity_match" : "artifact_missing",
    index_head: indexHead,
    index_tree: indexTree,
    graph_state: {
      graph_available: artifactExists,
      graph_schema_version: artifactExists ? SIDECAR_GRAPH_SCHEMA_VERSION : null
    }
  };
}

function artifactMatchesCommittedIdentity({ artifact, identity, indexHead, indexTree }) {
  return Boolean(
    artifact?.schema_version === SIDECAR_ARTIFACT_SCHEMA_VERSION &&
    artifact.index_head === indexHead &&
    artifact.index_tree === indexTree &&
    artifact.cache_metadata?.artifact_schema_version === SIDECAR_ARTIFACT_SCHEMA_VERSION &&
    artifact.cache_metadata?.index_head === indexHead &&
    artifact.cache_metadata?.index_tree === indexTree &&
    identity?.index_head === indexHead
  );
}

export async function getCommittedHeadGraphImpactPaths({
  dir = ".",
  selectedUnit,
  subject,
  cacheDir = undefined,
  statusReader = getCommittedHeadArtifactStatus,
  artifactReader = readArtifact,
  headReader = null
} = {}) {
  const unitIdentity = committedUnitIdentity(selectedUnit);
  if (!unitIdentity) {
    return committedHeadFailure({
      outcome: "selected_unit_invalid",
      status: null,
      selectedUnit: null
    });
  }
  const targetDir = path.resolve(String(dir || "."));
  let status = null;
  try {
    status = await statusReader({ dir: targetDir, cacheDir });
    if (status.index_action !== "use" || status.staleness !== "fresh") {
      return committedHeadFailure({
        outcome: statusFailureOutcome(status),
        status,
        selectedUnit: unitIdentity
      });
    }

    const repoRoot = status.repo_root ??
      await runSidecarGit(targetDir, ["rev-parse", "--show-toplevel"]);
    const artifactRead = await artifactReader({ repoRoot, status });
    if (!artifactRead.artifact || !artifactRead.identity) {
      const reason = artifactRead.evidence?.reason ?? "artifact_unavailable";
      return committedHeadFailure({
        outcome: reason === "artifact_unreadable"
          ? "base_artifact_corrupt"
          : reason.includes("incompatible") || reason.includes("format") ||
              reason.startsWith("generator_identity_")
            ? "base_artifact_incompatible"
            : "base_artifact_unavailable",
        status,
        selectedUnit: unitIdentity
      });
    }

    const verifiedArtifactRead = await artifactReader({ repoRoot, status });
    if (
      !verifiedArtifactRead.artifact ||
      !verifiedArtifactRead.identity ||
      !artifactIdentityMatches(artifactRead.identity, verifiedArtifactRead.identity)
    ) {
      return committedHeadFailure({
        outcome: "base_artifact_incompatible",
        status,
        selectedUnit: unitIdentity
      });
    }

    const [currentHead, currentTree] = await Promise.all([
      headReader ? headReader() : runSidecarGit(repoRoot, ["rev-parse", "HEAD"]),
      runSidecarGit(repoRoot, ["rev-parse", "HEAD^{tree}"])
    ]);
    const identity = artifactRead.identity;
    const classified = classifyReadSidecarGraphArtifact(artifactRead.artifact);
    if (currentHead !== status.index_head || currentTree !== status.index_tree) {
      return committedHeadFailure({
        outcome: "repository_head_unstable",
        status,
        selectedUnit: unitIdentity
      });
    }
    if (
      !artifactMatchesCommittedIdentity({
        artifact: artifactRead.artifact,
        identity,
        indexHead: currentHead,
        indexTree: currentTree
      }) ||
      identity.graph_schema_version !== SIDECAR_GRAPH_SCHEMA_VERSION ||
      !classified.compatible ||
      classified.graph_state.graph_available !== true
    ) {
      return committedHeadFailure({
        outcome: "base_artifact_incompatible",
        status,
        selectedUnit: unitIdentity
      });
    }

    const projection = projectSelectedUnitGraphBearingPaths({
      selectedUnit: unitIdentity,
      subject,
      committedSourcePaths: sourcePathsFromArtifact(artifactRead.artifact)
    });
    const sanitized = sanitizeGraphForbiddenPaths(artifactRead.artifact.graph);
    const indexes = createGraphIndexes(sanitized.graph);
    const unavailablePaths = projection.graph_bearing_paths.filter(
      (relativePath) => !indexes.nodeIdsByPath.has(relativePath)
    );
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
      repository_commit: identity.index_head,
      graph_schema_version: identity.graph_schema_version,
      generator_identity: identity.generator_identity,
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
  } catch {
    return committedHeadFailure({
      outcome: "base_artifact_unavailable",
      status,
      selectedUnit: unitIdentity
    });
  }
}

export async function resolveCurrentGraphForImpact({
  targetDir,
  cacheDir,
  artifactReader = readArtifact,
  headReader = async () => {
    try {
      const repoRoot = await runSidecarGit(targetDir, ["rev-parse", "--show-toplevel"]);
      return await runSidecarGit(repoRoot, ["rev-parse", "HEAD"]);
    } catch {
      return null;
    }
  }
} = {}) {
  let lastResolution = null;
  for (let pass = 0; pass < GRAPH_REBUILD_MAX_PASSES; pass += 1) {
    const isFinalPass = pass === GRAPH_REBUILD_MAX_PASSES - 1;
    const pinnedHead = await headReader();

    let status = await getSidecarIndexStatus({ dir: targetDir, cacheDir });
    let rebuild = null;
    if (statusRequiresRebuild(status)) {
      rebuild = await rebuildGraphIndexAtHead({ targetDir, cacheDir });

      status = await getSidecarIndexStatus({ dir: targetDir, cacheDir });
      if (statusRequiresRebuild(status)) {

        throw new SidecarGraphIndexUnbuildableError(
          "repo code index was rebuilt at HEAD but still does not yield a usable base graph",
          { status }
        );
      }
    }

    const gitState = await discoverSidecarGitState(targetDir);
    const artifactRead = await artifactReader({ repoRoot: gitState.repoRoot, status });
    const artifactMatchesPinnedHead =
      Boolean(artifactRead.artifact) &&
      artifactRead.identity?.index_head === pinnedHead &&
      artifactRead.identity.index_head === status.index_head;
    const overlay = await collectDirtyGraphOverlay({ repoRoot: gitState.repoRoot, status });
    const graphSelection = selectGraph({ status, artifact: artifactRead.artifact, overlay });

    const verifiedArtifactRead = await artifactReader({ repoRoot: gitState.repoRoot, status });
    const artifactIdentityStable =
      artifactMatchesPinnedHead &&
      verifiedArtifactRead.identity?.index_head === pinnedHead &&
      artifactIdentityMatches(artifactRead.identity, verifiedArtifactRead.identity);

    lastResolution = { gitState, status, artifactRead, overlay, graphSelection, rebuild };

    const afterHead = await headReader();
    if (afterHead === pinnedHead && artifactIdentityStable) {

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
  headReader = undefined
} = {}) {
  const inputPaths = asStringList(paths);
  if (inputPaths.length === 0) {
    throw new Error("graph_impact_paths requires at least one path");
  }

  const targetDir = path.resolve(String(dir || "."));
  const { gitState, status, artifactRead, overlay, graphSelection, rebuild } =
    await resolveCurrentGraphForImpact({ targetDir, cacheDir, headReader });
  const sanitizedSelection = sanitizeGraphForbiddenPaths(graphSelection.graph);

  const validations = inputPaths.map(validateImpactPath);
  const validPaths = uniqueStrings(
    validations.filter((entry) => entry.ok).map((entry) => entry.relative_path)
  );
  const validationHints = validations.map((entry) => entry.hint);
  const invalidPaths = validations.filter((entry) => !entry.ok).map((entry) => entry.input_path);

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
      extensionNamespaces
    });
    const knownExistingPaths =
      overlay.overlayState === "included"
        ? overlay.sourcePaths
        : status.staleness === "fresh"
          ? sourcePathsFromArtifact(artifactRead.artifact)
          : null;
    joined = joinSidecarPathsToCanonicalRecords({
      paths: joinPaths,
      canonicalRecords,
      knownExistingPaths,
      includeSuppressed,
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
      artifactRead.evidence,
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

export async function getSidecarGraphImpactDiff({
  dir = ".",
  patchText = null,
  diffRecords = null,
  liveGit = false,
  cacheDir = undefined,
  includeSuppressed = false,
  profile = null,
  extensionNamespaces = null
} = {}) {
  const targetDir = path.resolve(String(dir || "."));
  const normalized = await normalizeGraphImpactDiffInput({
    repoRoot: targetDir,
    patchText,
    diffRecords,
    liveGit
  });

  const impactPaths = pathsForDiffImpact(normalized.validatedDiffRecords);
  const graphResult =
    impactPaths.length > 0
      ? await getSidecarGraphImpactPaths({
          dir: targetDir,
          paths: impactPaths,
          cacheDir,
          includeSuppressed,
          profile,
          extensionNamespaces
        })
      : emptyGraphImpactResult({
          status: await getSidecarIndexStatus({ dir: targetDir, cacheDir }),
          inputPaths: impactPaths
        });
  const states = diffPathStates({
    records: normalized.validatedDiffRecords,
    graphResult
  });
  const oldPaths = uniqueStrings(
    normalized.validatedDiffRecords.map((record) => record.oldPath).filter(Boolean)
  ).sort((left, right) => left.localeCompare(right));
  const newPaths = uniqueStrings(
    normalized.validatedDiffRecords.map((record) => record.newPath).filter(Boolean)
  ).sort((left, right) => left.localeCompare(right));
  const affectedPaths = uniqueStrings([...oldPaths, ...newPaths]).sort((left, right) =>
    left.localeCompare(right)
  );
  const diffQueryEvidence = {
    kind: "sidecar_graph_impact_diff_query",
    query_kind: "graph_impact_diff",
    input_diff_sources: normalized.inputSources.map((entry) => entry.source),
    affected_paths: affectedPaths,
    provenance: provenance({ evidenceBasis: "explicit_metadata" })
  };

  const result = createSidecarResultEnvelope({
    ...graphResult,
    query_kind: "graph_impact_diff",
    input_diff_sources: normalized.inputSources,
    input_paths: impactPaths,
    parsed_diff_records: normalized.parsedDiffRecords,
    validated_diff_records: normalized.validatedDiffRecords,
    invalid_diff_records: normalized.invalidDiffRecords,
    affected_paths: affectedPaths,
    old_paths: oldPaths,
    new_paths: newPaths,
    validation_hints: [
      ...normalized.validationHints,
      ...(graphResult.validation_hints || [])
    ],
    graph_state: {
      ...graphResult.graph_state,
      diff_path_states: states
    },
    derived_evidence: [
      ...(graphResult.derived_evidence || []).map(cloneJson),
      diffQueryEvidence,
      ...normalized.validationHints.map(cloneJson)
    ]
  });
  return {
    ...result,
    summary: createCompactGraphImpactSummary(result)
  };
}
