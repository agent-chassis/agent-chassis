import {
  SIDECAR_GRAPH_EDGE_KIND_VALUES,
  SIDECAR_GRAPH_NODE_KIND_VALUES
} from "./sidecar-graph-schema.mjs";

export function createSidecarGraphProvenance({
  evidenceBasis = "parser_extract",
  path: relativePath = null,
  line = null
} = {}) {
  return {
    source_kind: "code_index",
    canonicality: "derived",
    evidence_basis: evidenceBasis,
    ...(relativePath ? { path: relativePath } : {}),
    ...(line ? { line } : {})
  };
}

export function sidecarGraphNodeId(kind, key) {
  return `${kind}:${key}`;
}

export function sidecarGraphEdgeId(kind, fromNodeId, toNodeId, discriminator = "") {
  return `edge:${kind}:${fromNodeId}->${toNodeId}${discriminator ? `:${discriminator}` : ""}`;
}

export function compareSidecarGraphRecordsById(left, right) {
  return left.id.localeCompare(right.id);
}

export function assertSidecarGraphControlledKind(kind, values, label) {
  if (!values.includes(kind)) {
    throw new Error(`unsupported sidecar graph ${label} kind: ${kind}`);
  }
}

export function createGraphBuilder() {
  const nodes = new Map();
  const edges = new Map();

  function addNode(kind, key, attributes = {}) {
    assertSidecarGraphControlledKind(kind, SIDECAR_GRAPH_NODE_KIND_VALUES, "node");
    const id = sidecarGraphNodeId(kind, key);
    const existing = nodes.get(id);
    const next = {
      id,
      kind,
      ...attributes,
      provenance: attributes.provenance || createSidecarGraphProvenance({
        path: attributes.path ?? null
      })
    };
    nodes.set(id, existing ? { ...existing, ...next } : next);
    return id;
  }

  function addEdge(kind, fromNodeId, toNodeId, attributes = {}) {
    assertSidecarGraphControlledKind(kind, SIDECAR_GRAPH_EDGE_KIND_VALUES, "edge");
    const id = sidecarGraphEdgeId(kind, fromNodeId, toNodeId, attributes.discriminator);
    const existing = edges.get(id);
    const next = {
      id,
      kind,
      from_node_id: fromNodeId,
      to_node_id: toNodeId,
      ...attributes,
      provenance: attributes.provenance || createSidecarGraphProvenance({
        path: attributes.path ?? null
      })
    };
    delete next.discriminator;
    edges.set(id, existing ? { ...existing, ...next } : next);
    return id;
  }

  return {
    addNode,
    addEdge,
    graphNodes() {
      return [...nodes.values()].sort(compareSidecarGraphRecordsById);
    },
    graphEdges() {
      return [...edges.values()].sort(compareSidecarGraphRecordsById);
    }
  };
}

export function createGraphContributionCollector() {
  const builder = createGraphBuilder();
  const nodeContributions = [];
  const edgeContributions = [];
  let ordinal = 0;
  return {
    addNode(kind, key, attributes = {}) {
      const id = builder.addNode(kind, key, attributes);
      nodeContributions.push({
        kind,
        key,
        ordinal: ordinal++,
        attributes: structuredClone(attributes)
      });
      return id;
    },
    addEdge(kind, fromNodeId, toNodeId, attributes = {}) {
      const id = builder.addEdge(kind, fromNodeId, toNodeId, attributes);
      const { discriminator = "", ...storedAttributes } = attributes;
      edgeContributions.push({
        kind,
        from_node_id: fromNodeId,
        to_node_id: toNodeId,
        discriminator,
        ordinal: ordinal++,
        attributes: structuredClone(storedAttributes)
      });
      return id;
    },
    graphNodes: builder.graphNodes,
    graphEdges: builder.graphEdges,
    contributions() {
      return {
        node_contributions: structuredClone(nodeContributions),
        edge_contributions: structuredClone(edgeContributions)
      };
    }
  };
}
