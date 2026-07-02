import test from "node:test";
import assert from "node:assert/strict";

import { createGraphImpactToolResponse } from "../packages/wiki-mcp/src/lib/code-index-tools.mjs";
import {
  compactGraphImpactSummaryAffectedSurfaces,
  createBoundedGraphImpactResponse,
  mergeCompactGraphImpactEvidence,
  normalizeGraphImpactSummaryRefInput
} from "../packages/wiki-mcp/src/lib/graph-impact-response-boundary.mjs";

const SOURCE_RECORD_DIGEST = `sha256:${"a".repeat(64)}`;
const SURFACE_KINDS = ["test", "docs", "cli", "mcp"];

function buildSurface(prefix, index, kind) {
  return {
    path: `${prefix}-${String(index).padStart(2, "0")}.mjs`,
    name: `${kind}-${index}`,
    kind,
    reason: `${kind} surface ${index}`,
    input_path: `${prefix}-${String(index).padStart(2, "0")}.mjs`,
    targeting: {
      granularity: "file",
      command: `run ${kind} ${index}`,
      tool: kind === "cli" ? "npm" : "mcp"
    }
  };
}

function buildSurfaceRange(prefix, kind, count) {
  return Array.from({ length: count }, (_, index) => buildSurface(prefix, index + 1, kind));
}

function buildRawGraphImpact() {
  return {
    schema_version: "code-index-sidecar.v1",
    query_kind: "graph_impact_paths",
    record_id: "WK-0732",
    unit: {
      kind: "slice",
      address: "WK-0732#ergonomics-graph-impact-derived-evidence",
      record_id: "WK-0732",
      slice_id: "ergonomics-graph-impact-derived-evidence"
    },
    source_record_digest: SOURCE_RECORD_DIGEST,
    input_paths: ["packages/wiki-mcp/src/lib/code-index-tools.mjs"],
    validated_paths: ["packages/wiki-mcp/src/lib/code-index-tools.mjs"],
    invalid_paths: [],
    graph_state: {
      dirty_state: "dirty_worktree",
      staleness: "stale",
      graph_available: true,
      edge_source: "dirty_overlay",
      dirty_graph_mode: "overlay_parsed",
      graph_schema_version: "repo-code-graph.v1",
      unavailable_paths: [
        "packages/wiki-core/src/lib/unavailable-01.mjs",
        "packages/wiki-core/src/lib/unavailable-02.mjs"
      ]
    },
    warning_counts: {
      total: 3,
      status: 1,
      invalid_paths: 0,
      invalid_diff_records: 0,
      unavailable_graph_paths: 2
    },
    missing_update_hints: [
      {
        kind: "missing_docs_contract_check",
        input_path: "packages/wiki-mcp/src/lib/code-index-tools.mjs",
        missing_surface: "docs/mcp-integration.md",
        reason: "docs contract not updated alongside the tool change",
        action: "update docs/mcp-integration.md",
        suggested_paths: ["docs/mcp-integration.md"]
      }
    ],
    summary: {
      kind: "graph_impact_agent_summary",
      query_kind: "graph_impact_paths",
      derived_evidence: {
        likely_tests: buildSurfaceRange("tests/code-index-tools-target", "test", 4),
        docs_contracts: buildSurfaceRange("docs/mcp-integration-target", "docs", 3),
        affected_surfaces: {
          cli: buildSurfaceRange("packages/wiki-cli/src/commands/code-index-target", "cli", 4),
          mcp: buildSurfaceRange("packages/wiki-mcp/src/lib/code-index-target", "mcp", 5)
        }
      }
    }
  };
}

function assertNoFullSurfaceObjects(affectedSurfaces, label) {
  for (const kind of SURFACE_KINDS) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(affectedSurfaces, kind),
      false,
      `${label} must not expose the full ${kind} surface array`
    );
  }
}

test("compactGraphImpactSummaryAffectedSurfaces collapses surface objects to counts + top_paths", () => {
  const bounded = createBoundedGraphImpactResponse(buildRawGraphImpact());
  const fullSummary = bounded.graph_impact_summary;

  assert.ok(fullSummary.derived_evidence.affected_surfaces.test.length > 0);
  assert.ok(fullSummary.derived_evidence.affected_surfaces.mcp[0].targeting);

  const compact = compactGraphImpactSummaryAffectedSurfaces(fullSummary);
  const compactSurfaces = compact.derived_evidence.affected_surfaces;

  assertNoFullSurfaceObjects(compactSurfaces, "compact affected_surfaces");
  assert.deepEqual(compactSurfaces.counts, {
    test: 4,
    docs: 3,
    cli: 4,
    mcp: 5,
    total: 16
  });
  assert.ok(Array.isArray(compactSurfaces.top_paths));
  assert.ok(compactSurfaces.top_paths.length <= 5, "top_paths must be bounded to a daily-use sample");
  assert.ok(compactSurfaces.top_paths.length > 0);
  assert.equal(new Set(compactSurfaces.top_paths).size, compactSurfaces.top_paths.length, "top_paths deduped");

  assert.deepEqual(
    compact.derived_evidence.unavailable_paths,
    fullSummary.derived_evidence.unavailable_paths
  );
  assert.deepEqual(
    compact.derived_evidence.missing_update_hints,
    fullSummary.derived_evidence.missing_update_hints
  );
  assert.ok(compact.derived_evidence.missing_update_hints.length > 0);

  assert.ok(Array.isArray(fullSummary.derived_evidence.affected_surfaces.test));
  assert.equal(
    Object.prototype.hasOwnProperty.call(fullSummary.derived_evidence.affected_surfaces, "counts"),
    false,
    "the source bounded summary must remain unmodified"
  );

  assert.equal(compact.source_record_digest, SOURCE_RECORD_DIGEST);
  assert.ok(compact.graph_quality);
  assert.ok(compact.counts);
});

test("createGraphImpactToolResponse default omits full affected_surfaces and keeps a lightweight ref", () => {
  const result = buildRawGraphImpact();
  const response = createGraphImpactToolResponse({
    workspaceRepo: "demo",
    result,
    verbose: false,
    compactFields: {
      dirty_state: result.graph_state.dirty_state,
      staleness: result.graph_state.staleness
    }
  });

  assert.equal(response.verbose, false);
  assert.equal(response.query_kind, "graph_impact_paths");

  const surfaces = response.graph_impact_summary.derived_evidence.affected_surfaces;
  assertNoFullSurfaceObjects(surfaces, "default graph_impact_summary affected_surfaces");
  assert.deepEqual(surfaces.counts, { test: 4, docs: 3, cli: 4, mcp: 5, total: 16 });
  assert.ok(surfaces.top_paths.length > 0 && surfaces.top_paths.length <= 5);

  assert.ok(response.graph_impact_summary.derived_evidence.missing_update_hints.length > 0);
  assert.equal(response.graph_impact_summary.graph_quality.degraded_state.kind, "stale_index");
  assert.ok(response.graph_impact_summary.counts.input_paths >= 1);

  assert.equal(Object.prototype.hasOwnProperty.call(response, "graph_impact"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(response, "graph_impact_raw"), false);

  assert.ok(response.graph_impact_summary_ref);
  assert.equal(
    Object.prototype.hasOwnProperty.call(response.graph_impact_summary_ref, "summary"),
    false,
    "default ref must not duplicate graph_impact_summary"
  );
  assert.ok(/^sha256:[0-9a-f]{64}$/.test(response.graph_impact_summary_ref.raw_evidence_digest ?? ""));
});

test("createGraphImpactToolResponse compact keeps dirty_state/staleness only inside graph_impact_summary", () => {
  const result = buildRawGraphImpact();
  const response = createGraphImpactToolResponse({
    workspaceRepo: "demo",
    result,
    verbose: false
  });

  assert.equal(response.verbose, false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(response, "dirty_state"),
    false,
    "compact response must not mirror dirty_state at the top level"
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(response, "staleness"),
    false,
    "compact response must not mirror staleness at the top level"
  );

  assert.equal(response.graph_impact_summary.graph_state.dirty_state, "dirty_worktree");
  assert.equal(response.graph_impact_summary.graph_state.staleness, "stale");
  assert.equal(response.graph_impact_summary.graph_quality.dirty_state, "dirty_worktree");
  assert.equal(response.graph_impact_summary.graph_quality.staleness, "stale");
});

test("createGraphImpactToolResponse verbose:true restores full affected surface objects", () => {
  const result = buildRawGraphImpact();
  const verbose = createGraphImpactToolResponse({
    workspaceRepo: "demo",
    result,
    verbose: true,
    verboseFields: {
      input_paths: result.input_paths,
      validated_paths: result.validated_paths,
      invalid_paths: result.invalid_paths,
      graph_state: result.graph_state
    }
  });

  assert.equal(verbose.verbose, true);

  const summarySurfaces = verbose.graph_impact_summary.derived_evidence.affected_surfaces;
  assert.equal(summarySurfaces.mcp.length, 5);
  assert.equal(summarySurfaces.test.length, 4);
  assert.ok(summarySurfaces.cli[0].targeting.command, "verbose surfaces retain targeting detail");
  assert.equal(
    Object.prototype.hasOwnProperty.call(summarySurfaces, "counts"),
    false,
    "verbose summary must expose full surfaces, not the compact counts shape"
  );

  assert.ok(verbose.graph_impact, "verbose response must include the expanded graph_impact alias");
  assert.deepEqual(verbose.graph_impact, verbose.graph_impact_summary);
  assert.ok(verbose.graph_impact_raw, "verbose response must include the raw envelope");
  assert.deepEqual(verbose.graph_impact_raw, result);

  assert.deepEqual(verbose.validated_paths, result.validated_paths);
  assert.equal(verbose.graph_state.graph_available, true);
});

test("compactGraphImpactSummaryAffectedSurfaces is a no-op when affected_surfaces is absent", () => {
  const noDerived = { schema_version: "x", graph_quality: {} };
  assert.equal(compactGraphImpactSummaryAffectedSurfaces(noDerived), noDerived);

  const noSurfaces = {
    schema_version: "x",
    derived_evidence: { unavailable_paths: ["a.mjs"], missing_update_hints: [] }
  };
  assert.equal(compactGraphImpactSummaryAffectedSurfaces(noSurfaces), noSurfaces);

  const emptySurfaces = {
    schema_version: "x",
    derived_evidence: {
      unavailable_paths: [],
      missing_update_hints: [],
      affected_surfaces: { test: [], docs: [], cli: [], mcp: [] }
    }
  };
  const compacted = compactGraphImpactSummaryAffectedSurfaces(emptySurfaces);
  assert.deepEqual(compacted.derived_evidence.affected_surfaces.counts, {
    test: 0,
    docs: 0,
    cli: 0,
    mcp: 0,
    total: 0
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(compacted.derived_evidence.affected_surfaces, "top_paths"),
    false,
    "no top_paths key when there are no affected surface paths"
  );
});

test("WK-0751 compact graph-impact tool response produces lightweight ref persistable without verbose:true", () => {
  const result = buildRawGraphImpact();
  const response = createGraphImpactToolResponse({
    workspaceRepo: "demo",
    result,
    verbose: false,
    compactFields: {
      dirty_state: result.graph_state.dirty_state,
      staleness: result.graph_state.staleness
    }
  });

  assert.ok(response.graph_impact_summary, "compact response must include graph_impact_summary");
  assert.ok(response.graph_impact_summary_ref, "compact response must include graph_impact_summary_ref");

  assert.equal(
    Object.prototype.hasOwnProperty.call(response.graph_impact_summary_ref, "summary"),
    false,
    "WK-0751: compact ref must be lightweight (no embedded summary duplicate)"
  );
  assert.ok(
    /^sha256:[0-9a-f]{64}$/.test(response.graph_impact_summary_ref.raw_evidence_digest ?? ""),
    "WK-0751: compact ref must carry a content-addressed raw_evidence_digest for binding"
  );
  assert.ok(
    Array.isArray(response.graph_impact_summary_ref.input_paths),
    "WK-0751: compact ref must carry input_paths for path-binding"
  );
  assert.ok(
    Array.isArray(response.graph_impact_summary_ref.validated_paths),
    "WK-0751: compact ref must carry validated_paths for path-binding"
  );

  const refWithBoundSummary = {
    ...response.graph_impact_summary_ref,
    summary: response.graph_impact_summary
  };
  const normalized = normalizeGraphImpactSummaryRefInput(refWithBoundSummary);
  assert.ok(
    normalized,
    "WK-0751: compact summary + lightweight ref must normalize successfully without verbose:true"
  );
  assert.ok(normalized.summary, "normalized ref must contain the bound compact summary");
  assert.ok(
    normalized.raw_evidence_digest,
    "normalized ref must preserve the content-addressed binding token"
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(normalized, "graph_nodes"),
    false,
    "WK-0751: normalized ref must not expose raw graph_nodes payloads"
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(normalized, "graph_edges"),
    false,
    "WK-0751: normalized ref must not expose raw graph_edges payloads"
  );

  const merged = mergeCompactGraphImpactEvidence(response.graph_impact_summary, normalized);
  assert.ok(
    merged,
    "WK-0751: mergeCompactGraphImpactEvidence must succeed for compact tool output"
  );
  assert.deepEqual(
    merged.input_paths,
    normalized.input_paths,
    "WK-0751: merged result must carry input_paths from the ref"
  );
  assert.deepEqual(
    merged.validated_paths,
    normalized.validated_paths,
    "WK-0751: merged result must carry validated_paths from the ref"
  );
});
