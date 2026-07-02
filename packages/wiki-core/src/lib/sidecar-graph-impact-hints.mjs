import {
  graphProvenance,
  isGraphTextSource,
  isParsedGraphPath,
  provenance,
  uniqueStrings
} from "./sidecar-graph-impact-shared.mjs";

function suggestedTestPath(inputPath) {
  const parsed = inputPath.match(/^(?<dir>.*\/)?(?<base>[^/.]+)\.[^.]+$/);
  if (!parsed?.groups?.base) {
    return null;
  }
  return `${parsed.groups.dir || ""}${parsed.groups.base}.test.mjs`;
}

function addHint(hints, hint) {
  const key = [
    hint.kind,
    hint.input_path,
    hint.missing_surface,
    hint.suggested_paths.join(",")
  ].join("|");
  if (!hints.has(key)) {
    hints.set(key, hint);
  }
}

function hintRecord({ kind, inputPath, missingSurface, reason, suggestedPaths }) {
  return {
    kind,
    input_path: inputPath,
    missing_surface: missingSurface,
    reason,
    suggested_paths: uniqueStrings(suggestedPaths).sort((left, right) => left.localeCompare(right)),
    provenance: graphProvenance(inputPath)
  };
}

function docsContractSuggestionsForInputPath(inputPath) {
  if (
    inputPath.startsWith("packages/agent-launch-") ||
    inputPath.includes("/handoff.") ||
    inputPath.includes("/review.")
  ) {
    return ["docs/agent-blackboard-protocol.md"];
  }
  if (inputPath === "packages/wiki-mcp/src/server.mjs") {
    return ["docs/mcp-integration.md"];
  }
  return ["docs/mcp-integration.md"];
}

function isProtocolAuthorityInputPath(inputPath) {
  return (
    inputPath.startsWith("packages/agent-launch-") ||
    inputPath.includes("/handoff.") ||
    inputPath.includes("/review.")
  );
}

export function createMissingUpdateHints({ validPaths, impacts, indexes }) {
  const hints = new Map();
  const nodesById = indexes.nodesById;
  for (const inputPath of validPaths) {
    const pathImpacts = impacts.filter((impact) => impact.input_path === inputPath);
    const kinds = new Set(pathImpacts.map((impact) => impact.kind));
    const surfaceKinds = new Set(["downstream_cli_command", "downstream_mcp_tool"]);

    if (!kinds.has("docs_contract") && isProtocolAuthorityInputPath(inputPath)) {
      addHint(
        hints,
        hintRecord({
          kind: "protocol_docs_check",
          inputPath,
          missingSurface: "docs_contract",
          reason: "launcher or handoff checkpoint path should be checked against the blackboard protocol",
          suggestedPaths: ["docs/agent-blackboard-protocol.md"]
        })
      );
    }

    for (const impact of pathImpacts) {
      if (!surfaceKinds.has(impact.kind)) {
        continue;
      }
      const surfacePaths = impact.node_ids
        .map((nodeId) => nodesById.get(nodeId)?.path)
        .filter((surfacePath) => surfacePath && surfacePath !== inputPath);
      if (surfacePaths.length === 0) {
        continue;
      }
      addHint(
        hints,
        hintRecord({
          kind: "check_downstream_surface",
          inputPath,
          missingSurface:
            impact.kind === "downstream_cli_command" ? "cli_command" : "mcp_tool",
          reason: impact.reason,
          suggestedPaths: surfacePaths
        })
      );
    }

    if (!kinds.has("covering_test")) {
      const suggested = suggestedTestPath(inputPath);
      if (suggested) {
        addHint(
          hints,
          hintRecord({
            kind: "missing_structural_test_coverage",
            inputPath,
            missingSurface: "test",
            reason: "graph has no covering test edge for the changed path",
            suggestedPaths: [suggested]
          })
        );
      }
    }

    if (
      (kinds.has("downstream_cli_command") ||
        kinds.has("downstream_mcp_tool") ||
        kinds.has("schema_field_contract")) &&
      !kinds.has("docs_contract") &&
      !isProtocolAuthorityInputPath(inputPath)
    ) {
      addHint(
        hints,
        hintRecord({
          kind: "missing_docs_contract_check",
          inputPath,
          missingSurface: "docs_contract",
          reason: "surface or schema impact has no docs-contract edge for the changed path",
          suggestedPaths: docsContractSuggestionsForInputPath(inputPath)
        })
      );
    }
  }
  return [...hints.values()].sort((left, right) =>
    `${left.input_path}:${left.kind}:${left.missing_surface}`.localeCompare(
      `${right.input_path}:${right.kind}:${right.missing_surface}`
    )
  );
}

export function graphPathEvidence({ graphSelection, overlay, validPaths, graphNodes }) {
  const nodePathSet = new Set(graphNodes.map((node) => node.path).filter(Boolean));
  const evidence = [];
  for (const inputPath of validPaths) {
    if (nodePathSet.has(inputPath)) {
      continue;
    }
    let reason = "graph_node_absent";
    if (!graphSelection.graph) {
      reason = graphSelection.reason || "graph_unavailable";
    } else if (overlay.dirtyPathStates.get(inputPath) === "deleted") {
      reason = "deleted";
    } else if (!isGraphTextSource(inputPath)) {
      reason = "unsupported";
    } else if (!isParsedGraphPath(inputPath)) {
      reason = "unparsed";
    }
    evidence.push({
      kind: "sidecar_graph_path_state",
      input_path: inputPath,
      graph_available_for_path: false,
      reason,
      provenance: graphProvenance(inputPath)
    });
  }
  for (const entry of overlay.unavailable) {
    if (!validPaths.includes(entry.path)) {
      continue;
    }
    evidence.push({
      kind: "sidecar_graph_path_state",
      input_path: entry.path,
      graph_available_for_path: false,
      reason: entry.reason,
      ...(entry.detail ? { detail: entry.detail } : {}),
      provenance: entry.provenance
    });
  }
  return evidence;
}

export function pathsForCanonicalJoin({ validPaths, graphNodes, hints }) {
  return uniqueStrings([
    ...validPaths,
    ...graphNodes.map((node) => node.path).filter(Boolean),
    ...hints.flatMap((hint) => hint.suggested_paths)
  ]).sort((left, right) => left.localeCompare(right));
}

export function queryEvidence({ inputPaths, includeSuppressed }) {
  return {
    kind: "sidecar_graph_impact_query",
    query_kind: "graph_impact_paths",
    input_paths: inputPaths,
    include_suppressed: includeSuppressed,
    provenance: provenance({ evidenceBasis: "path_match" })
  };
}

export function statusHints(status) {
  const hints = [];
  if (status.staleness !== "fresh") {
    hints.push({
      kind: "sidecar_status_hint",
      dimension: "staleness",
      state: status.staleness,
      message: `sidecar index staleness is ${status.staleness}`,
      provenance: provenance({ evidenceBasis: status.index_tree ? "git_tree" : "unknown" })
    });
  }
  if (status.dirty_state !== "clean") {
    hints.push({
      kind: "sidecar_status_hint",
      dimension: "dirty_state",
      state: status.dirty_state,
      message: `repository dirty state is ${status.dirty_state}`,
      provenance: provenance({ evidenceBasis: status.index_tree ? "git_tree" : "unknown" })
    });
  }
  return hints;
}
