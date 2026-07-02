import { cloneJson } from "./sidecar-graph-impact-shared.mjs";
import {
  actionForHint,
  compactNodeSurface,
  createActionBuckets,
  createImpactGroups,
  firstNodeByKind,
  rankGraphCanonicalRefs,
  sortFocusedSurfaces,
  summaryFocusTokens,
  uniqueSurfaceEntries
} from "./sidecar-graph-impact-surfaces-actions.mjs";

function compactWarningCounts(result) {
  const derived = result.derived_evidence || [];
  const statusWarnings = derived.filter((entry) => entry.kind === "sidecar_status_hint");
  const invalidPathWarnings = (result.validation_hints || []).filter(
    (entry) => entry.kind === "sidecar_path_validation" && entry.valid === false
  );
  const invalidDiffWarnings = result.invalid_diff_records || [];
  const graphPathWarnings = derived.filter((entry) => entry.kind === "sidecar_graph_path_state");
  return {
    total:
      statusWarnings.length +
      invalidPathWarnings.length +
      invalidDiffWarnings.length +
      graphPathWarnings.length,
    status: statusWarnings.length,
    invalid_paths: invalidPathWarnings.length,
    invalid_diff_records: invalidDiffWarnings.length,
    unavailable_graph_paths: graphPathWarnings.length
  };
}

export function createCompactGraphImpactSummary(result) {
  const nodesById = new Map((result.graph_nodes || []).map((node) => [node.id, node]));
  const cliSurfaces = [];
  const mcpSurfaces = [];
  const codeSurfaces = [];
  const likelyTests = [];
  const docsContracts = [];

  for (const impact of result.structural_impacts || []) {
    if (impact.kind === "downstream_cli_command") {
      cliSurfaces.push(
        compactNodeSurface({
          impact,
          node: firstNodeByKind(impact, nodesById, new Set(["cli_command"])),
          surfaceKind: "cli_command"
        })
      );
    } else if (impact.kind === "downstream_mcp_tool") {
      mcpSurfaces.push(
        compactNodeSurface({
          impact,
          node: firstNodeByKind(impact, nodesById, new Set(["mcp_tool"])),
          surfaceKind: "mcp_tool"
        })
      );
    } else if (impact.kind === "reverse_import") {
      const node = firstNodeByKind(impact, nodesById, new Set(["module", "file"]));
      if (node?.path && node.path !== impact.input_path) {
        codeSurfaces.push(
          compactNodeSurface({
            impact,
            node,
            surfaceKind: "code_path"
          })
        );
      }
    } else if (impact.kind === "covering_test") {
      const node = firstNodeByKind(impact, nodesById, new Set(["test"]));
      if (node?.path) {
        likelyTests.push(
          compactNodeSurface({
            impact,
            node,
            surfaceKind: "test"
          })
        );
      }
    } else if (impact.kind === "docs_contract") {
      const node = firstNodeByKind(impact, nodesById, new Set(["docs_contract"]));
      if (node?.path) {
        docsContracts.push(
          compactNodeSurface({
            impact,
            node,
            surfaceKind: "docs_contract"
          })
        );
      }
    }
  }

  for (const hint of result.missing_update_hints || []) {
    if (hint.missing_surface === "test") {
      for (const suggestedPath of hint.suggested_paths || []) {
        likelyTests.push({
          kind: "test",
          name: null,
          path: suggestedPath,
          input_path: hint.input_path,
          severity: "medium",
          reason: hint.reason,
          provenance: hint.provenance
        });
      }
    }
    if (hint.missing_surface === "docs_contract") {
      for (const suggestedPath of hint.suggested_paths || []) {
        docsContracts.push({
          kind: "docs_contract",
          name: null,
          path: suggestedPath,
          input_path: hint.input_path,
          severity: "medium",
          reason: hint.reason,
          provenance: hint.provenance
        });
      }
    }
  }

  const focusTokens = summaryFocusTokens(result);
  const compactSurfaces = {
    cli: uniqueSurfaceEntries(
      sortFocusedSurfaces(cliSurfaces, focusTokens),
      (entry) => `${entry.path}:${entry.name}`
    ),
    mcp: uniqueSurfaceEntries(
      sortFocusedSurfaces(mcpSurfaces, focusTokens),
      (entry) => `${entry.path}:${entry.name}`
    ),
    code: uniqueSurfaceEntries(codeSurfaces, (entry) => entry.path),
    likelyTests: uniqueSurfaceEntries(likelyTests, (entry) => entry.path),
    docsContracts: uniqueSurfaceEntries(docsContracts, (entry) => entry.path)
  };
  const rankedCanonicalRefs = rankGraphCanonicalRefs(result.canonical_refs || [], result);
  const actionBuckets = createActionBuckets({
    surfaces: compactSurfaces,
    missingUpdateHints: result.missing_update_hints || [],
    focusTokens,
    validPaths: new Set(result.validated_paths || result.input_paths || [])
  });

  return {
    kind: "graph_impact_agent_summary",
    query_kind: result.query_kind,
    canonical_refs: rankedCanonicalRefs.slice(0, 5).map((ref) => ({
      id: ref.id ?? null,
      title: ref.title ?? null,
      path: ref.path ?? null,
      source_kind: ref.source_kind ?? null,
      status: ref.status ?? null,
      rank: ref.rank ?? null,
      graph_summary_rank: ref.graph_summary_rank,
      graph_summary_priority: ref.graph_summary_priority,
      graph_summary_focus_score: ref.graph_summary_focus_score,
      score: ref.score ?? null,
      match_types: ref.match_types || [],
      provenance: ref.provenance
    })),
    derived_evidence: {
      affected_surfaces: {
        cli: compactSurfaces.cli,
        mcp: compactSurfaces.mcp,
        code: compactSurfaces.code
      },
      likely_tests: compactSurfaces.likelyTests,
      docs_contracts: compactSurfaces.docsContracts,
      impact_groups: createImpactGroups(result.structural_impacts || [], nodesById),
      action_items: actionBuckets,
      missing_update_hints: (result.missing_update_hints || [])
        .filter(
          (hint) =>
            !(
              hint.kind === "check_downstream_surface" &&
              Array.isArray(hint.suggested_paths) &&
              hint.suggested_paths.length === 0
            )
        )
        .slice(0, 10)
        .map((hint) => ({
          ...cloneJson(hint),
          action: actionForHint(hint)
        }))
    },
    state: {
      dirty_state: result.dirty_state,
      dirty_details: result.dirty_details,
      staleness: result.staleness,
      graph_state: {
        graph_available: Boolean(result.graph_state?.graph_available),
        graph_schema_version: result.graph_state?.graph_schema_version ?? null,
        edge_source: result.graph_state?.edge_source ?? "unavailable",
        dirty_graph_mode: result.graph_state?.dirty_graph_mode ?? "unavailable",
        unavailable_paths: result.graph_state?.unavailable_paths || [],
        diff_path_state_count: result.graph_state?.diff_path_states?.length || 0
      }
    },
    counts: {
      canonical_refs: result.canonical_refs?.length || 0,
      graph_nodes: result.graph_nodes?.length || 0,
      graph_edges: result.graph_edges?.length || 0,
      structural_impacts: result.structural_impacts?.length || 0,
      missing_update_hints: result.missing_update_hints?.length || 0
    },
    warning_counts: compactWarningCounts(result)
  };
}
