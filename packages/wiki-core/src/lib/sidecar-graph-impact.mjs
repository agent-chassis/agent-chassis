import path from "node:path";

import { createSidecarResultEnvelope } from "./sidecar-schema.mjs";
import {
  discoverSidecarGitState,
  getSidecarIndexStatus,
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
  loadCanonicalRecords,
  readArtifact,
  rebuildGraphIndexAtHead,
  SidecarGraphIndexUnbuildableError,
  sourcePathsFromArtifact
} from "./sidecar-graph-impact-artifact.mjs";
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

function statusRequiresRebuild(status) {
  return status?.index_action === "rebuild";
}

export async function resolveCurrentGraphForImpact({
  targetDir,
  cacheDir,
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
    const artifactRead = await readArtifact({ repoRoot: gitState.repoRoot, status });
    const overlay = await collectDirtyGraphOverlay({ repoRoot: gitState.repoRoot, status });
    const graphSelection = selectGraph({ status, artifact: artifactRead.artifact, overlay });

    lastResolution = { gitState, status, artifactRead, overlay, graphSelection, rebuild };

    const afterHead = await headReader();
    if (isFinalPass || afterHead === pinnedHead) {
      return lastResolution;
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
