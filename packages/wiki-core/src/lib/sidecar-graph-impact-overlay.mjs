import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  SIDECAR_GRAPH_SCHEMA_VERSION,
  classifySidecarGraphArtifactSchema,
  createSidecarGraphState
} from "./sidecar-graph-schema.mjs";
import { extractSidecarGraph } from "./sidecar-graph-extractors.mjs";
import { filterSidecarSourcePaths } from "./sidecar-paths.mjs";
import { runSidecarGit } from "./sidecar-status.mjs";
import {
  graphProvenance,
  isGraphOverlaySourcePath,
  isGraphTextSource,
  isParsedGraphPath,
  provenance,
  uniqueStrings
} from "./sidecar-graph-impact-shared.mjs";

function splitNulList(text) {
  return String(text || "")
    .split("\0")
    .filter(Boolean);
}

function parseDirtyStatusPath(line) {
  if (line.startsWith("?? ")) {
    return { path: line.slice(3), state: "untracked" };
  }
  const stagedCode = line[0];
  const unstagedCode = line[1];
  const rawPath = line.slice(3).split(" -> ").pop();
  if (!rawPath) {
    return null;
  }
  if (stagedCode === "D" || unstagedCode === "D") {
    return { path: rawPath, state: "deleted" };
  }
  if (stagedCode !== " " && unstagedCode !== " ") {
    return { path: rawPath, state: "staged_and_unstaged" };
  }
  if (stagedCode !== " ") {
    return { path: rawPath, state: "staged" };
  }
  if (unstagedCode !== " ") {
    return { path: rawPath, state: "unstaged" };
  }
  return { path: rawPath, state: "dirty" };
}

function mapDirtyStatusPaths(statusText) {
  const states = new Map();
  for (const line of String(statusText || "").split("\n").filter(Boolean)) {
    const parsed = parseDirtyStatusPath(line);
    if (parsed) {
      states.set(parsed.path, parsed.state);
    }
  }
  return states;
}

export async function collectDirtyGraphOverlay({
  repoRoot,
  status,

  readOverlaySource = (absolutePath) => readFile(absolutePath, "utf8"),
  extractGraph = extractSidecarGraph
} = {}) {
  if (status.dirty_state !== "dirty_worktree") {
    return {
      overlayState: "not_applicable",
      graph: null,
      sourcePaths: [],
      dirtyPathStates: new Map(),
      unavailable: [],
      evidence: null
    };
  }

  try {
    const [candidateText, deletedText, statusText] = await Promise.all([
      runSidecarGit(repoRoot, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]),
      runSidecarGit(repoRoot, ["ls-files", "-z", "--deleted"]),
      runSidecarGit(repoRoot, [
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
        "--ignore-submodules=none"
      ])
    ]);
    const deletedPaths = new Set(splitNulList(deletedText));
    const dirtyPathStates = mapDirtyStatusPaths(statusText);
    for (const deletedPath of deletedPaths) {
      dirtyPathStates.set(deletedPath, "deleted");
    }

    const candidates = splitNulList(candidateText).filter((candidate) => !deletedPaths.has(candidate));
    const sourceFilter = filterSidecarSourcePaths(candidates);
    const sourcePaths = uniqueStrings(sourceFilter.included.filter(isGraphOverlaySourcePath)).sort(
      (left, right) => left.localeCompare(right)
    );
    const sources = [];
    const unavailable = [];
    const dirtyPaths = uniqueStrings([...dirtyPathStates.keys()]).sort((left, right) =>
      left.localeCompare(right)
    );
    const overlayDirtyPaths = dirtyPaths.filter(isGraphOverlaySourcePath);
    const overlayDeletedPaths = uniqueStrings([...deletedPaths].filter(isGraphOverlaySourcePath)).sort(
      (left, right) => left.localeCompare(right)
    );

    if (overlayDirtyPaths.length === 0) {
      return {
        overlayState: "not_included",
        graph: null,
        sourcePaths: [],
        dirtyPathStates,
        unavailable: [],
        evidence: {
          kind: "sidecar_dirty_worktree_overlay",
          overlay_state: "not_included",
          dirty_graph_mode: "base_index_only",
          source_path_count: 0,
          dirty_path_count: dirtyPaths.length,
          dirty_source_path_count: 0,
          dirty_paths: dirtyPaths.slice(0, 100),
          dirty_source_paths: [],
          rejected_source_count: sourceFilter.rejected.length,
          provenance: provenance({ evidenceBasis: "git_tree" })
        }
      };
    }

    if (sourcePaths.length === 0) {
      const unavailableDirtyPaths = overlayDirtyPaths.map((dirtyPath) =>
        unavailablePath(dirtyPath, dirtyPathStates.get(dirtyPath) === "deleted" ? "deleted" : "unsupported")
      );
      return {
        overlayState: "unavailable",
        graph: null,
        sourcePaths,
        dirtyPathStates,
        unavailable: dedupeUnavailable(unavailableDirtyPaths),
        evidence: {
          kind: "sidecar_dirty_worktree_overlay",
          overlay_state: "unavailable",
          dirty_graph_mode: "unavailable",
          source_path_count: 0,
          dirty_path_count: dirtyPaths.length,
          dirty_source_path_count: 0,
          dirty_paths: dirtyPaths.slice(0, 100),
          dirty_source_paths: [],
          rejected_source_count: sourceFilter.rejected.length,
          provenance: provenance({ evidenceBasis: "git_tree" })
        }
      };
    }

    const readFailures = [];
    for (const sourcePath of sourcePaths) {
      if (!isGraphTextSource(sourcePath)) {
        unavailable.push(unavailablePath(sourcePath, "unsupported"));
        continue;
      }
      try {
        sources.push({
          path: sourcePath,
          content: await readOverlaySource(path.join(repoRoot, sourcePath), sourcePath),
          worktree_overlay: true,
          dirty_state: dirtyPathStates.get(sourcePath) || "unchanged_worktree"
        });
      } catch (error) {
        readFailures.push(sourcePath);
        unavailable.push(
          unavailablePath(
            sourcePath,
            "unread",
            error instanceof Error ? error.message : String(error)
          )
        );
      }
    }

    const graph = await extractGraph({
      edgeSource: "dirty_overlay",
      dirtyGraphMode: "overlay_parsed",
      sources
    });
    for (const sourcePath of graph.graph_metadata.unsupported_sources || []) {
      unavailable.push(unavailablePath(sourcePath, "unsupported"));
    }
    for (const sourcePath of graph.graph_metadata.unavailable_paths || []) {
      unavailable.push(unavailablePath(sourcePath, "unparsed"));
    }
    for (const deletedPath of overlayDeletedPaths) {
      unavailable.push(unavailablePath(deletedPath, "deleted"));
    }

    const parseFailures = uniqueStrings(graph.graph_metadata.unavailable_paths || []).filter(
      isParsedGraphPath
    );
    if (readFailures.length > 0 || parseFailures.length > 0) {
      return {
        overlayState: "unavailable",
        graph: null,
        sourcePaths: [],
        dirtyPathStates,
        unavailable: dedupeUnavailable(unavailable),
        evidence: {
          kind: "sidecar_dirty_worktree_overlay",
          overlay_state: "unavailable",
          dirty_graph_mode: "unavailable",
          overlay_failure: "partial_overlay_discarded",
          unread_source_count: readFailures.length,
          unparsed_source_count: parseFailures.length,
          source_path_count: sourcePaths.length,
          dirty_path_count: dirtyPaths.length,
          dirty_source_path_count: 0,
          dirty_paths: dirtyPaths.slice(0, 100),
          dirty_source_paths: [],
          rejected_source_count: sourceFilter.rejected.length,
          provenance: provenance({ evidenceBasis: "git_tree" })
        }
      };
    }

    const sourcePathSet = new Set(sourcePaths);
    const dirtySourcePaths = dirtyPaths.filter((dirtyPath) => sourcePathSet.has(dirtyPath));

    return {
      overlayState: "included",
      graph,
      sourcePaths,
      dirtyPathStates,
      unavailable: dedupeUnavailable(unavailable),
      evidence: {
        kind: "sidecar_dirty_worktree_overlay",
        overlay_state: "included",
        dirty_graph_mode: "overlay_parsed",
        source_path_count: sourcePaths.length,
        dirty_path_count: dirtyPaths.length,
        dirty_source_path_count: dirtySourcePaths.length,
        dirty_paths: dirtyPaths.slice(0, 100),
        dirty_source_paths: dirtySourcePaths.slice(0, 100),
        rejected_source_count: sourceFilter.rejected.length,
        provenance: provenance({ evidenceBasis: "git_tree" })
      }
    };
  } catch (error) {
    return {
      overlayState: "unavailable",
      graph: null,
      sourcePaths: [],
      dirtyPathStates: new Map(),
      unavailable: [],
      evidence: {
        kind: "sidecar_dirty_worktree_overlay",
        overlay_state: "unavailable",
        dirty_graph_mode: "unavailable",
        reason: error instanceof Error ? error.message : String(error),
        provenance: provenance({ evidenceBasis: "unknown" })
      }
    };
  }
}

function unavailablePath(relativePath, reason, detail = null) {
  return {
    path: relativePath,
    reason,
    ...(detail ? { detail } : {}),
    provenance: graphProvenance(relativePath)
  };
}

function dedupeUnavailable(entries) {
  const byKey = new Map();
  for (const entry of entries) {
    byKey.set(`${entry.path}:${entry.reason}`, entry);
  }
  return [...byKey.values()].sort((left, right) =>
    `${left.path}:${left.reason}`.localeCompare(`${right.path}:${right.reason}`)
  );
}

export function selectGraph({ status, artifact, overlay }) {
  if (overlay.graph) {
    return mergeBaseAndOverlayGraph({ artifact, overlay });
  }

  return classifyBaseGraphSelection({ artifact });
}

function mergeBaseAndOverlayGraph({ artifact, overlay }) {
  const overlayGraph = overlay.graph;
  const classified = artifact ? classifySidecarGraphArtifactSchema(artifact) : null;
  const baseGraph =
    classified?.compatible && classified.graph_state.graph_available ? artifact.graph : null;

  const graphState = createSidecarGraphState({
    graph_schema_version: SIDECAR_GRAPH_SCHEMA_VERSION,
    graph_available: true,
    edge_source: "dirty_overlay",
    dirty_graph_mode: "overlay_parsed",
    unavailable_paths: overlay.unavailable.map((entry) => entry.path),
    status_reason: baseGraph ? "dirty_overlay_graph_merged" : "dirty_overlay_graph_extracted"
  });

  if (!baseGraph) {
    return {
      graph: overlayGraph,
      graphState,
      reason: "dirty_overlay_graph_extracted"
    };
  }

  return {
    graph: mergeGraphByFilePrecedence({ baseGraph, overlayGraph, overlay }),
    graphState,
    reason: "dirty_overlay_graph_merged"
  };
}

function mergeGraphByFilePrecedence({ baseGraph, overlayGraph, overlay }) {
  const overlayFiles = new Set(overlay.sourcePaths);
  const deletedFiles = new Set(
    [...overlay.dirtyPathStates.entries()]
      .filter(([, state]) => state === "deleted")
      .map(([filePath]) => filePath)
  );

  const baseNodes = baseGraph.graph_nodes || [];
  const baseEdges = baseGraph.graph_edges || [];
  const overlayNodes = overlayGraph.graph_nodes || [];
  const overlayEdges = overlayGraph.graph_edges || [];

  const deletedNodeIds = new Set();
  for (const node of [...baseNodes, ...overlayNodes]) {
    if (node.path && deletedFiles.has(node.path)) {
      deletedNodeIds.add(node.id);
    }
  }

  const edgesById = new Map();
  for (const edge of baseEdges) {
    const author = edge.provenance?.path;
    if (author && (overlayFiles.has(author) || deletedFiles.has(author))) {
      continue;
    }
    edgesById.set(edge.id, edge);
  }
  for (const edge of overlayEdges) {
    edgesById.set(edge.id, edge);
  }
  const mergedEdges = [...edgesById.values()]
    .filter(
      (edge) => !deletedNodeIds.has(edge.from_node_id) && !deletedNodeIds.has(edge.to_node_id)
    )
    .sort((left, right) => left.id.localeCompare(right.id));

  const nodesById = new Map();
  for (const node of baseNodes) {
    nodesById.set(node.id, node);
  }
  for (const node of overlayNodes) {
    const existing = nodesById.get(node.id);
    nodesById.set(node.id, existing ? { ...existing, ...node } : node);
  }
  for (const id of deletedNodeIds) {
    nodesById.delete(id);
  }

  const referenced = new Set();
  for (const edge of mergedEdges) {
    referenced.add(edge.from_node_id);
    referenced.add(edge.to_node_id);
  }
  const mergedNodes = [...nodesById.values()]
    .filter(
      (node) =>
        referenced.has(node.id) ||
        (node.kind === "file" && node.path && !deletedFiles.has(node.path))
    )
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    graph_schema_version: SIDECAR_GRAPH_SCHEMA_VERSION,
    graph_nodes: mergedNodes,
    graph_edges: mergedEdges,
    graph_metadata: {
      ...(baseGraph.graph_metadata || {}),
      graph_edge_source: "dirty_overlay",
      dirty_graph_mode: "overlay_parsed",
      node_count: mergedNodes.length,
      edge_count: mergedEdges.length,
      merge: {
        overlay_file_count: overlayFiles.size,
        deleted_file_count: deletedFiles.size,
        base_node_count: baseNodes.length,
        overlay_node_count: overlayNodes.length,
        merged_node_count: mergedNodes.length,
        merged_edge_count: mergedEdges.length
      }
    }
  };
}

function classifyBaseGraphSelection({ artifact }) {
  const classified = artifact ? classifySidecarGraphArtifactSchema(artifact) : null;

  if (!classified?.compatible || !classified.graph_state.graph_available) {
    return {
      graph: null,
      graphState: classified?.graph_state || createSidecarGraphState({}),
      reason: classified?.graph_state?.status_reason || "graph_unavailable"
    };
  }

  return {
    graph: artifact.graph,
    graphState: {
      ...classified.graph_state,
      edge_source: "base_index",
      dirty_graph_mode: "base_index_only",
      unavailable_paths: classified.graph_state.unavailable_paths || []
    },
    reason: "base_graph_available"
  };
}
