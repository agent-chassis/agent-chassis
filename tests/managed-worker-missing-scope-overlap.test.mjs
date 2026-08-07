import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

import { registerDispatchTools } from "../packages/wiki-mcp/src/lib/dispatch-tools.mjs";
import { buildDispatchRuntime, consumeDispatchCodexTestSeamEvidence } from "../packages/wiki-mcp/src/lib/dispatch-launch-runtime.mjs";
import { validateWorkRecordDispatchById } from "@agent-chassis/wiki-core/src/lib/work-record-dispatch.mjs";

const execFileAsync = promisify(execFile);
const SUBJECT = "WK-1790#SLICE-006";
const MISSING_LEAF = "tests/generated/managed-worker-missing.mjs";
const MISSING_READ_ONLY_LEAF = "tests/generated/managed-worker-read-only.mjs";
const SIBLING = "tests/generated/managed-worker-sibling.mjs";
const GRAPH = Object.freeze({ graph_available: true, graph_state: "available", staleness: "fresh", dirty_state: "clean" });

function recordFor({ readScope, repoPaths, writeScope }) {
  return {
    schema_version: "work-record.v1", id: "WK-1790", repo: "agent-chassis/agent-chassis",
    title: "Honor exact missing write targets duplicated in managed worker read scope", record_kind: "work_item", work_kind: "implementation",
    status: "active", priority: "high", owner: "codex", initiative: "IN-0032", created: "2026-07-28", updated: "2026-07-29",
    read_scope: ["README.md"], repo_paths: [], write_scope: [], depends_on: [], blocks: [], related: [],
    dispatch_intent: { intended_agent_role: "worker", target_unit: "slice", requires_graph_impact: false, requires_escalation: false },
    acceptance: { criteria: ["Dispatch the managed implementation slice."], validation: ["node --test"] },
    sections: { summary: "", why_it_matters: "", scope: { items: [], out_of_scope: [] }, tasks: [], references: [], agent_notes: "", closure: null },
    children: [], escalations: [], projections: [], migration: null, derived_evidence: [],
    slices: [{
      id: "SLICE-006", title: "Registered exact missing overlap", work_kind: "implementation", status: "todo",
      priority: "high", owner: "codex", created: "2026-07-29", updated: "2026-07-29", depends_on: [],
      read_scope: readScope, repo_paths: repoPaths, write_scope: writeScope,
      dispatch_intent: { intended_agent_role: "worker", target_unit: "slice", requires_graph_impact: false, requires_escalation: false },
      acceptance: {
        criteria: ["Launch the exact managed worker namespace."],
        validation: ["node --test tests/managed-worker-missing-scope-overlap.test.mjs"]
      },
      sections: {
        summary: "Registered exact missing overlap fixture.",
        why_it_matters: "Proves an exact missing R-intersection-W leaf reaches the managed namespace.",
        scope: { items: ["registered managed dispatch"], out_of_scope: ["production changes"] },
        tasks: [{ text: "Launch the exact managed worker namespace.", status: "todo" }],
        references: ["AGENTS.md"],
        agent_notes: "",
        closure: null
      }
    }],
    escalations: []
  };
}

async function makeRepo(scopes) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "wk1790-registered-overlap-"));
  await mkdir(path.join(repo, "wiki", "work-records"), { recursive: true });
  await mkdir(path.join(repo, "tests", "generated"), { recursive: true });
  await mkdir(path.join(repo, "docs"), { recursive: true });
  await writeFile(path.join(repo, "README.md"), "fixture\n");
  await writeFile(path.join(repo, "docs", "fixture.md"), "fixture docs\n");
  await writeFile(path.join(repo, SIBLING), "export default 'sibling';\n");
  await writeFile(path.join(repo, ".gitignore"), ".cache/\n.agent-runs/\n.agent-launch/\n.env\n.agent-launch.local.env\n");
  await writeFile(path.join(repo, "agent-launch.toml"), "[roles.worker]\nmodel = \"gpt-5.5\"\n");
  await writeFile(path.join(repo, "wiki", "work-records", "WK-1790.json"), JSON.stringify(recordFor(scopes)) + "\n");
  await execFileAsync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  await execFileAsync("git", ["config", "user.email", "test@example.invalid"], { cwd: repo });
  await execFileAsync("git", ["config", "user.name", "test"], { cwd: repo });
  await execFileAsync("git", ["add", "."], { cwd: repo });
  await execFileAsync("git", ["commit", "-q", "-m", "fixture"], { cwd: repo });
  return repo;
}

async function registeredFixture(scopes) {
  const repo = await makeRepo(scopes);
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_"))),
    WIKI_MCP_WORKSPACE_DIR: repo,
    WIKI_MCP_DISPATCH_WORKTREE_ROOT: path.join(path.dirname(repo), ".agent-worktrees", path.basename(repo)),
    WIKI_MCP_DISPATCH_CODEX_EXECUTOR_SEAMS: "accept_succeed_test_seams"
  };
  const runtime = buildDispatchRuntime(env);
  const tools = new Map();
  const readiness = async (options) => validateWorkRecordDispatchById({ ...options, graph_state: GRAPH, graph_import_adjacency: [] });
  registerDispatchTools({
    registerTool: (name, config, handler) => tools.set(name, { config, handler }),
    registeredToolNames: new Set([
      "workspace_agent_dispatch",
      "workspace_agent_run_status"
    ]),
    workspaceRepos: [{ repo: "agent-chassis", dir: repo }],
    z, jsonContent: (value) => value, errorContent: (value) => value,
    resolveWorkspaceRepo: () => ({ repo: "agent-chassis", dir: repo }),
    validateDispatch: readiness,
    validateLaunchIntent: async (options) => ({
      readiness: {
        ...(await readiness(options)),
        recovery: { graph_impact: "not_required", admission_metrics: "fresh", target_resolution: "fresh" }
      },
      private_handoff: {
        authored_source_digest: "fixture-authored",
        full_persistence_snapshot_digest: "fixture-persistence",
        reviewed_unit_digest: "fixture-reviewed"
      }
    }),
    refreshAdmissionEvidence: async () => ({ written: true }),
    revalidatePrivateHandoff: async () => ({ valid: true }),
    dispatchBackend: runtime.dispatchBackend,
    dispatchSessionIdentity: runtime.dispatchSessionIdentity
  });
  return {
    repo,
    dispatch: () => tools.get("workspace_agent_dispatch").handler({ role: "worker", subject: SUBJECT }),
    status: (monitor_handle) => tools.get("workspace_agent_run_status").handler({ monitor_handle })
  };
}

test.afterEach(() => { consumeDispatchCodexTestSeamEvidence(); });

test("registered managed dispatch launches one exact missing R∩W leaf", async () => {
  const fixture = await registeredFixture({ readScope: [MISSING_LEAF], repoPaths: [MISSING_LEAF], writeScope: [MISSING_LEAF] });
  try {
    assert.equal(existsSync(path.join(fixture.repo, MISSING_LEAF)), false, "the source leaf must genuinely be absent");
    const result = await fixture.dispatch();
    const evidence = consumeDispatchCodexTestSeamEvidence();
    let status;
    let terminals;
    let statusAttempted = false;
    try {

      for (const entry of evidence) entry.close_stdin();
      terminals = await Promise.all(evidence.map((entry) => entry.terminal));
      statusAttempted = true;
      status = await fixture.status(result.monitor_handle);
    } finally {
      for (const entry of evidence) entry.close_stdin();
      if (!terminals) terminals = await Promise.all(evidence.map((entry) => entry.terminal));
      if (!statusAttempted && result?.monitor_handle) {
        statusAttempted = true;
        status = await fixture.status(result.monitor_handle);
      }
    }
    assert.equal(result.accepted, true, JSON.stringify(result));
    assert.equal(evidence.length, 1, "the public registered seam must reach exactly one executor");
    assert.deepEqual(terminals[0], { code: 0, signal: null });
    assert.equal(status.accepted, true, JSON.stringify(status));
    assert.equal(status.child_terminal, true, JSON.stringify(status));
    assert.deepEqual(status.exit, { code: 0, signal: null, error: null });
    assert.equal(status.terminal, false, "the no-model seam must not fabricate post-worker settlement");
    {
      const provisioned = evidence[0].repo;
      assert.equal(provisioned, evidence[0].cwd);
      const namespace = evidence[0].sparse_worker_namespace;
      assert.ok(namespace, "the production launch must carry the frozen sparse namespace");
      assert.deepEqual(namespace.authority.read_scope, [MISSING_LEAF]);
      assert.deepEqual(namespace.authority.repo_paths, [MISSING_LEAF]);
      assert.deepEqual(namespace.authority.write_scope, [MISSING_LEAF]);
      const leaf = path.join(provisioned, MISSING_LEAF);
      const parent = path.dirname(leaf);
      assert.equal(existsSync(leaf), true, "production planning must materialize the exact W leaf");
      assert.deepEqual(evidence[0].writable_files, [{ real: leaf, precreated: false }],
        "the final plan sees the exact leaf after the first plan materialized it");
      const argv = evidence[0].bwrap_args.join("\0");
      assert.notEqual(argv.indexOf(["--bind", leaf, leaf].join("\0")), -1,
        "the actual production plan must bind the exact leaf");
      assert.equal(evidence[0].writable_roots.includes(parent), false,
        "the actual production plan must not widen the parent");
      assert.equal(argv.includes(["--bind", parent, parent].join("\0")), false,
        "the actual production plan must not bind the parent");
      const visible = [...namespace.readable, ...namespace.writable];
      assert.equal(visible.includes(path.join(provisioned, SIBLING)), false,
        "undeclared tracked sibling must not receive namespace authority");
      assert.equal(namespace.writable.includes(path.join(provisioned, SIBLING)), false,
        "undeclared tracked sibling must not receive writable authority");
    }
  } finally { await rm(fixture.repo, { recursive: true, force: true }); }
});

test("registered managed dispatch refuses a missing R-only leaf before executor", async () => {
  const fixture = await registeredFixture({ readScope: [MISSING_READ_ONLY_LEAF], repoPaths: [], writeScope: ["README.md"] });
  try {
    const result = await fixture.dispatch();
    assert.equal(result.accepted, false, JSON.stringify(result));
    assert.equal(result.blocker.detail.backend_refusal?.reason ?? result.blocker.detail.reason, "canonical_scope_resolution_failed");
    assert.equal(consumeDispatchCodexTestSeamEvidence().length, 0);
  } finally { await rm(fixture.repo, { recursive: true, force: true }); }
});
