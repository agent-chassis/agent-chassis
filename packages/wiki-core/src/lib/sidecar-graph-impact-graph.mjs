import {
  SidecarPathValidationError,
  pathIsSameOrDescendant,
  validateVirtualSidecarPath
} from "./sidecar-paths.mjs";
import { graphProvenance, uniqueStrings } from "./sidecar-graph-impact-shared.mjs";

function graphEvidencePathState({ inputPath, error }) {
  return {
    kind: "sidecar_graph_path_state",
    input_path: inputPath,
    graph_available_for_path: false,
    reason: error.reason || error.message,
    code: error.code || "invalid_path",
    pattern: error.pattern ?? null,
    provenance: graphProvenance(inputPath)
  };
}

export function sanitizeGraphForbiddenPaths(graph) {
  if (!graph) {
    return {
      graph: null,
      evidence: []
    };
  }

  const invalidPaths = new Map();
  for (const node of graph.graph_nodes || []) {
    if (!node.path || invalidPaths.has(node.path)) {
      continue;
    }
    try {
      validateVirtualSidecarPath(node.path);
    } catch (error) {
      if (!(error instanceof SidecarPathValidationError)) {
        throw error;
      }
      invalidPaths.set(node.path, error);
    }
  }

  if (invalidPaths.size === 0) {
    return {
      graph,
      evidence: []
    };
  }

  const allowedNodes = (graph.graph_nodes || []).filter((node) => !invalidPaths.has(node.path));
  const allowedNodeIds = new Set(allowedNodes.map((node) => node.id));
  return {
    graph: {
      ...graph,
      graph_nodes: allowedNodes,
      graph_edges: (graph.graph_edges || []).filter(
        (edge) => allowedNodeIds.has(edge.from_node_id) && allowedNodeIds.has(edge.to_node_id)
      ),
      graph_metadata: {
        ...(graph.graph_metadata || {}),
        forbidden_path_count: invalidPaths.size,
        forbidden_paths: [...invalidPaths.keys()].sort((left, right) => left.localeCompare(right))
      }
    },
    evidence: [...invalidPaths.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([inputPath, error]) => graphEvidencePathState({ inputPath, error }))
  };
}

export function createGraphIndexes(graph) {
  const nodes = graph?.graph_nodes || [];
  const edges = graph?.graph_edges || [];
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const edgesById = new Map(edges.map((edge) => [edge.id, edge]));
  const nodeIdsByPath = new Map();
  for (const node of nodes) {
    if (!node.path) {
      continue;
    }
    const list = nodeIdsByPath.get(node.path) || [];
    list.push(node.id);
    nodeIdsByPath.set(node.path, list);
  }
  return { nodes, edges, nodesById, edgesById, nodeIdsByPath };
}

function addImpact(impacts, impact) {
  const key = [
    impact.kind,
    impact.input_path,
    impact.node_ids.join(","),
    impact.edge_ids.join(","),
    impact.reason
  ].join("|");
  if (!impacts.has(key)) {
    impacts.set(key, impact);
  }
}

function impactRecord({ kind, inputPath, nodeIds, edgeIds, severity, reason }) {
  return {
    kind,
    input_path: inputPath,
    node_ids: uniqueStrings(nodeIds).sort((left, right) => left.localeCompare(right)),
    edge_ids: uniqueStrings(edgeIds).sort((left, right) => left.localeCompare(right)),
    severity,
    reason,
    provenance: graphProvenance(inputPath)
  };
}

export function connectedGraphImpact({ inputPath, indexes }) {
  const { edges, nodesById, nodeIdsByPath } = indexes;
  const impacts = new Map();
  const inputNodeIds = new Set(nodeIdsByPath.get(inputPath) || []);
  inputNodeIds.add(`file:${inputPath}`);
  inputNodeIds.add(`module:${inputPath}`);
  const inputModuleId = `module:${inputPath}`;
  const impactedModuleIds = new Set([inputModuleId]);
  const reverseImportEdgesByTarget = new Map();

  for (const edge of edges) {
    if (edge.kind === "imports_module") {
      const list = reverseImportEdgesByTarget.get(edge.to_node_id) || [];
      list.push(edge);
      reverseImportEdgesByTarget.set(edge.to_node_id, list);
    }
  }

  const queue = [inputModuleId];
  while (queue.length > 0) {
    const currentModuleId = queue.shift();
    for (const edge of reverseImportEdgesByTarget.get(currentModuleId) || []) {
      if (!impactedModuleIds.has(edge.from_node_id)) {
        impactedModuleIds.add(edge.from_node_id);
        queue.push(edge.from_node_id);
      }
      addImpact(
        impacts,
        impactRecord({
          kind: "reverse_import",
          inputPath,
          nodeIds: [inputModuleId, currentModuleId, edge.from_node_id],
          edgeIds: [edge.id],
          severity: currentModuleId === inputModuleId ? "high" : "medium",
          reason: currentModuleId === inputModuleId
            ? "module imports the changed module"
            : "module depends on the changed module through the import graph"
        })
      );
    }
  }

  for (const edge of edges) {
    if (edge.kind === "imports_module" && edge.to_node_id === inputModuleId) {
      continue;
    }
    if (edge.kind === "covers_test" && edge.to_node_id === inputModuleId) {
      addImpact(
        impacts,
        impactRecord({
          kind: "covering_test",
          inputPath,
          nodeIds: [inputModuleId, edge.from_node_id],
          edgeIds: [edge.id],
          severity: "medium",
          reason: "test graph covers the changed module"
        })
      );
    }
    if (edge.kind === "documents_contract" && edge.to_node_id === `file:${inputPath}`) {
      addImpact(
        impacts,
        impactRecord({
          kind: "docs_contract",
          inputPath,
          nodeIds: [`file:${inputPath}`, edge.from_node_id],
          edgeIds: [edge.id],
          severity: "medium",
          reason: "docs contract mentions the changed path"
        })
      );
    }
    if (edge.kind === "owns_write_scope") {
      const target = nodesById.get(edge.to_node_id);
      if (
        target?.path === inputPath ||
        (target?.path?.endsWith("/") && pathIsSameOrDescendant(target.path, inputPath))
      ) {
        addImpact(
          impacts,
          impactRecord({
            kind: "work_scope_owner",
            inputPath,
            nodeIds: [edge.from_node_id, edge.to_node_id],
            edgeIds: [edge.id],
            severity: "medium",
            reason: "canonical work record owns the changed path scope"
          })
        );
      }
    }
  }

  for (const edge of edges) {
    if (!impactedModuleIds.has(edge.from_node_id)) {
      continue;
    }
    if (edge.kind === "registers_cli_command") {
      addImpact(
        impacts,
        impactRecord({
          kind: "downstream_cli_command",
          inputPath,
          nodeIds: [edge.from_node_id, edge.to_node_id],
          edgeIds: [edge.id],
          severity: "high",
          reason: "changed module is connected to a CLI command surface"
        })
      );
    }
    if (edge.kind === "registers_mcp_tool") {
      addImpact(
        impacts,
        impactRecord({
          kind: "downstream_mcp_tool",
          inputPath,
          nodeIds: [edge.from_node_id, edge.to_node_id],
          edgeIds: [edge.id],
          severity: "high",
          reason: "changed module is connected to an MCP tool surface"
        })
      );
    }
    if (edge.kind === "mentions_schema_field") {
      addImpact(
        impacts,
        impactRecord({
          kind: "schema_field_contract",
          inputPath,
          nodeIds: [edge.from_node_id, edge.to_node_id],
          edgeIds: [edge.id],
          severity: "medium",
          reason: "changed module mentions a result-envelope or graph schema field"
        })
      );
    }
  }

  return [...impacts.values()].sort((left, right) =>
    `${left.input_path}:${left.kind}:${left.reason}`.localeCompare(
      `${right.input_path}:${right.kind}:${right.reason}`
    )
  );
}

export function nodesAndEdgesForImpacts({ impacts, indexes }) {
  const nodeIds = new Set();
  const edgeIds = new Set();
  for (const impact of impacts) {
    for (const nodeId of impact.node_ids) {
      nodeIds.add(nodeId);
    }
    for (const edgeId of impact.edge_ids) {
      edgeIds.add(edgeId);
      const edge = indexes.edgesById.get(edgeId);
      if (edge) {
        nodeIds.add(edge.from_node_id);
        nodeIds.add(edge.to_node_id);
      }
    }
  }
  return {
    graph_nodes: [...nodeIds]
      .map((nodeId) => indexes.nodesById.get(nodeId))
      .filter(Boolean)
      .sort((left, right) => left.id.localeCompare(right.id)),
    graph_edges: [...edgeIds]
      .map((edgeId) => indexes.edgesById.get(edgeId))
      .filter(Boolean)
      .sort((left, right) => left.id.localeCompare(right.id))
  };
}
