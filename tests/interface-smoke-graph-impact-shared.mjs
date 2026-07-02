

import os from "node:os";
import path from "node:path";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createMcpSession as createBoundedMcpSession } from "./fixtures/mcp-stdio-session.mjs";

export const REPO_ROOT = process.cwd();
export const INITIALIZE_PARAMS = {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: {
    name: "agent-chassis-test",
    version: "1.0.0"
  }
};

export async function withTempDir(fn) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-chassis-interface-"));
  try {
    await fn(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function cleanupInterfaceSmokeArtifacts() {
  const testsDir = path.join(REPO_ROOT, "tests");
  const entries = await readdir(testsDir, { withFileTypes: true });
  const targets = entries
    .filter(
      (entry) =>
        entry.name === ".probe-interface-smoke.json" ||
        entry.name.startsWith("tmp-interface-smoke-")
    )
    .map((entry) => path.join(testsDir, entry.name));

  await Promise.all(targets.map((target) => rm(target, { recursive: true, force: true })));
}

function attachDefaultWorkspaceRepo(env) {
  if (
    !env.WIKI_MCP_DEFAULT_REPO ||
    env.WIKI_MCP_WORKSPACE_ALIAS ||
    env.WIKI_MCP_WORKSPACE_DIR
  ) {
    return env;
  }

  let repos;
  try {
    repos = JSON.parse(env.WIKI_MCP_REPOS || "{}");
  } catch {
    return env;
  }

  const workspaceDir = repos?.[env.WIKI_MCP_DEFAULT_REPO];
  if (typeof workspaceDir !== "string" || workspaceDir.length === 0) {
    return env;
  }

  return {
    ...env,
    WIKI_MCP_WORKSPACE_ALIAS: env.WIKI_MCP_DEFAULT_REPO,
    WIKI_MCP_WORKSPACE_DIR: workspaceDir
  };
}

export function createMcpSession({ env = {}, prelude = "" } = {}) {
  return createBoundedMcpSession({
    env: attachDefaultWorkspaceRepo(env),
    prelude,
    repoRoot: REPO_ROOT
  });
}

export function createGraphImpactBoundaryFixture({
  recordId,
  sourceRecordDigest,
  unit = {
    kind: "work_item",
    address: recordId,
    record_id: recordId,
    slice_id: null
  }
} = {}) {
  return {
    query_kind: "graph_impact_paths",
    input_paths: [
      "packages/wiki-core/src/lib/work-record-dispatch.mjs",
      "packages/wiki-core/src/lib/work-record-feature-vector.mjs",
      "tests/interface-smoke.test.mjs"
    ],
    validated_paths: [
      "packages/wiki-core/src/lib/work-record-dispatch.mjs",
      "packages/wiki-core/src/lib/work-record-feature-vector.mjs"
    ],
    invalid_paths: ["tests/graph-impact-unavailable.mjs"],
    record_id: recordId,
    unit,
    source_record_digest: sourceRecordDigest,
    dirty_state: "dirty_worktree",
    staleness: "fresh",
    graph_state: {
      dirty_state: "dirty_worktree",
      staleness: "fresh",
      graph_available: true,
      edge_source: "dirty_overlay",
      dirty_graph_mode: "overlay_parsed",
      graph_schema_version: "repo-code-graph.v1",
      unavailable_paths: [
        "docs/mcp-integration.md",
        "packages/wiki-core/src/lib/work-record-dispatch.mjs",
        "tests/interface-smoke.test.mjs"
      ]
    },
    warning_counts: {
      total: 6,
      status: 1,
      invalid_paths: 1,
      invalid_diff_records: 1,
      unavailable_graph_paths: 3
    },
    graph_nodes: ["node-1", "node-2", "node-3", "node-4"],
    graph_edges: ["edge-1", "edge-2", "edge-3", "edge-4", "edge-5"],
    structural_impacts: ["impact-1", "impact-2", "impact-3"],
    missing_update_hints: ["hint-1", "hint-2", "hint-3"],
    canonical_refs: ["ref-1", "ref-2", "ref-3", "ref-4"],
    summary: {
      kind: "graph_impact_agent_summary",
      query_kind: "graph_impact_paths",
      canonical_refs: ["summary-ref-1", "summary-ref-2"]
    }
  };
}
