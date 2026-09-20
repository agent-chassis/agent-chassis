

import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { registerRunMonitorRoutes } from
  "../../packages/wiki-mcp/src/lib/dispatch-run-monitor-routes.mjs";
import { AGENT_RUN_STATUS_SCHEMA_VERSION } from
  "../../packages/wiki-mcp/src/lib/dispatch-tool-constants.mjs";

function createHarness(dispatchBackend) {
  const tools = new Map();
  registerRunMonitorRoutes({
    registerTool: (name, spec, handler) => tools.set(name, { spec, handler }),
    workspaceRepos: [],
    z,
    jsonContent: (value) => ({ value }),
    resolveWorkspaceRepo: () => ({ dir: "/tmp/repo", repo: "fixture" }),
    dispatchBackend,
    dispatchSessionIdentity: "trusted-session"
  });
  return tools;
}

test("WK-2586 retires public wait and global run-list registration", () => {
  const tools = createHarness({});
  assert.equal(tools.has("workspace_agent_run_wait"), false);
  assert.equal(tools.has("workspace_agent_runs_list"), false);
  assert.equal(tools.has("workspace_agent_run_status"), true);
});

test("WK-2586 status accepts only the closed subject observation request", () => {
  const schema = createHarness({}).get("workspace_agent_run_status").spec.inputSchema;
  assert.deepEqual(schema.parse({ subject: "WK-2586" }), { subject: "WK-2586" });
  assert.deepEqual(schema.parse({
    repo: "fixture",
    subject: "WK-2586#SLICE-002",
    attempt_id: "wkdb-1",
    timeout_ms: 300000,
    include_final_result: true,
    detail: { kind: "failure_history", limit: 100 }
  }), {
    repo: "fixture",
    subject: "WK-2586#SLICE-002",
    attempt_id: "wkdb-1",
    timeout_ms: 300000,
    include_final_result: true,
    detail: { kind: "failure_history", limit: 100 }
  });
  for (const rejected of [
    { subject: "WK-2586", monitor_handle: "retired" },
    { subject: "WK-2586", poll_interval_ms: 1 },
    { subject: "WK-2586", verbose: true },
    { subject: "WK-2586", timeout_ms: 0 },
    { subject: "WK-2586", timeout_ms: 300001 },
    { subject: "WK-2586", detail: { kind: "attempts", limit: 101 } }
  ]) assert.throws(() => schema.parse(rejected));
});

test("WK-2586 omitted and explicit timeout select immediate and bounded backend observation", async () => {
  const calls = [];
  const status = {
    accepted: true,
    run_id: "wkdb-1",
    monitor_handle: "wkmh-1",
    app: "codex",
    role: "reviewer",
    subject: "WK-2586",
    status: "running",
    terminal: false,
    started_at: null,
    updated_at: null,
    final_result: null
  };
  const tools = createHarness({
    getRunStatus: async (input) => { calls.push(["immediate", input]); return status; },
    waitForRunStatus: async (input) => { calls.push(["bounded", input]); return { ...status, timed_out: true }; }
  });
  const route = tools.get("workspace_agent_run_status");
  const immediate = await route.handler({ subject: "WK-2586" });
  const bounded = await route.handler({ subject: "WK-2586", timeout_ms: 1 });
  assert.equal(immediate.value.schema_version, AGENT_RUN_STATUS_SCHEMA_VERSION);
  assert.equal(immediate.value.settled, true);
  assert.equal(bounded.value.settled, false);
  assert.deepEqual(calls[0], ["immediate", {
    caller_session_id: "trusted-session",
    subject: "WK-2586",
    attempt_id: null
  }]);
  assert.equal(calls[1][0], "bounded");
  assert.equal(calls[1][1].timeout_ms, 1);
});
