

import test from "node:test";
import assert from "node:assert/strict";

import { z } from "zod";
import {
  BACKEND_REFUSAL_CODES
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend.mjs";
import {
  registerRunMonitorRoutes
} from "../../packages/wiki-mcp/src/lib/dispatch-run-monitor-routes.mjs";
import {
  AGENT_RUNS_LIST_SCHEMA_VERSION,
  AGENT_RUN_STATUS_SCHEMA_VERSION,
  AGENT_RUN_WAIT_SCHEMA_VERSION,
  DISPATCH_BLOCKER_CODES
} from "../../packages/wiki-mcp/src/lib/dispatch-tool-constants.mjs";

function createHarness({
  dispatchBackend = null,
  dispatchSessionIdentity = "trusted-session",
  resolveWorkspaceRepo = () => {
    throw new Error("run-list route must not resolve a workspace");
  }
} = {}) {
  const tools = new Map();
  const jsonInputs = [];
  registerRunMonitorRoutes({
    registerTool(name, spec, handler) {
      tools.set(name, { spec, handler });
    },
    workspaceRepos: [],
    z,
    jsonContent(value) {
      jsonInputs.push(value);
      return { common_json_content: true, value };
    },
    resolveWorkspaceRepo,
    dispatchBackend,
    dispatchSessionIdentity
  });
  return { tools, jsonInputs };
}

test("workspace_agent_runs_list has a strict canonical subject/state-only request", () => {
  const { tools } = createHarness();
  const schema = tools.get("workspace_agent_runs_list").spec.inputSchema;

  assert.deepEqual(schema.parse({}), {});
  assert.deepEqual(schema.parse({ state: "active" }), { state: "active" });
  assert.deepEqual(schema.parse({ state: "terminal", subject: "WK-1668" }), {
    state: "terminal",
    subject: "WK-1668"
  });
  assert.deepEqual(schema.parse({ state: "all", subject: "WK-1668#SLICE-002" }), {
    state: "all",
    subject: "WK-1668#SLICE-002"
  });
  assert.deepEqual(schema.parse({ subject: "IN-0018" }), { subject: "IN-0018" });

  for (const state of ["", "running", "done", "ACTIVE", 1, null]) {
    assert.throws(() => schema.parse({ state }));
  }
  for (const subject of ["", "WK-1668 ", "wk-1668", "WK-1668#INVALID SPACE", "subject"]) {
    assert.throws(() => schema.parse({ subject }), subject);
  }
  for (const field of [
    "caller_session_id", "identity", "limit", "cursor", "snapshot", "paths",
    "prompt", "environment", "env", "argv", "result", "mutation", "authority"
  ]) {
    assert.throws(() => schema.parse({ [field]: "forbidden" }), field);
  }
});

test("workspace_agent_runs_list defaults active and delegates injected identity and normalized filters", async () => {
  const calls = [];
  const fixtureRows = [{
    run_id: "run-fixture",
    monitor_handle: "handle-fixture",
    role: "worker",
    subject: "WK-1668#SLICE-002",
    status: "running",
    terminal: false,
    started_at: "2026-08-14T10:00:00.000Z",
    updated_at: "2026-08-14T10:00:00.000Z",
    route_must_not_reproject: { preserved: true }
  }];
  const { tools, jsonInputs } = createHarness({
    dispatchSessionIdentity: "server-injected-session",
    dispatchBackend: {
      async listRuns(input) {
        calls.push(input);
        return { accepted: true, runs: fixtureRows };
      },
      getRunStatus() {
        throw new Error("list route must not call getRunStatus");
      },
      waitForRunStatus() {
        throw new Error("list route must not call waitForRunStatus");
      },
      recoverIntegratedWorkerRun() {
        throw new Error("list route must not run recovery");
      }
    }
  });
  const route = tools.get("workspace_agent_runs_list");

  const first = await route.handler(route.spec.inputSchema.parse({}));
  assert.equal(first.common_json_content, true);
  assert.deepEqual(calls[0], {
    caller_session_id: "server-injected-session",
    subject: null,
    state: "active"
  });
  assert.deepEqual(first.value, {
    schema_version: AGENT_RUNS_LIST_SCHEMA_VERSION,
    accepted: true,
    availability: "current_process",
    retention_state: "unknown",
    state: "active",
    total_count: 1,
    returned_count: 1,
    has_more: false,
    runs: fixtureRows
  });
  assert.strictEqual(first.value.runs, fixtureRows, "backend rows must be forwarded unchanged");

  const second = await route.handler(route.spec.inputSchema.parse({
    subject: "WK-1668#SLICE-002",
    state: "all"
  }));
  assert.deepEqual(calls[1], {
    caller_session_id: "server-injected-session",
    subject: "WK-1668#SLICE-002",
    state: "all"
  });
  assert.equal(second.value.subject, "WK-1668#SLICE-002");
  assert.equal(jsonInputs.length, 2, "every response must use the common jsonContent path once");
});

test("findings listing and unknown handles remain current-process-only", async () => {
  const calls = [];
  const unknown = {
    accepted: false,
    refusal: {
      code: BACKEND_REFUSAL_CODES.MONITOR_HANDLE_UNKNOWN,
      reason: "monitor_handle_unknown_to_server"
    }
  };
  const { tools } = createHarness({
    dispatchSessionIdentity: "findings-session",
    resolveWorkspaceRepo: () => ({ dir: "/tmp/repo", repo: "fixture" }),
    dispatchBackend: {
      listRuns: async (input) => {
        calls.push(["list", input]);
        return { accepted: true, runs: [] };
      },
      getRunStatus: async (input) => {
        calls.push(["status", input]);
        return unknown;
      },
      waitForRunStatus: async (input) => {
        calls.push(["wait", input]);
        return unknown;
      }
    }
  });

  const listed = await tools.get("workspace_agent_runs_list").handler({ state: "all" });
  const status = await tools.get("workspace_agent_run_status").handler({
    monitor_handle: "unknown-findings-handle"
  });
  const wait = await tools.get("workspace_agent_run_wait").handler({
    monitor_handle: "unknown-findings-handle",
    timeout_ms: 1000,
    poll_interval_ms: 500
  });

  assert.equal(listed.value.availability, "current_process");
  assert.deepEqual(listed.value.runs, []);
  assert.equal(status.value.accepted, false);
  assert.equal(status.value.blocker.code, DISPATCH_BLOCKER_CODES.MONITOR_HANDLE_UNKNOWN);
  assert.equal(wait.value.accepted, false);
  assert.equal(wait.value.blocker.code, DISPATCH_BLOCKER_CODES.MONITOR_HANDLE_UNKNOWN);
  assert.deepEqual(calls, [
    ["list", {
      caller_session_id: "findings-session",
      subject: null,
      state: "all"
    }],
    ["status", {
      caller_session_id: "findings-session",
      monitor_handle: "unknown-findings-handle",
      subject: null
    }],
    ["wait", {
      caller_session_id: "findings-session",
      monitor_handle: "unknown-findings-handle",
      subject: null,
      timeout_ms: 1000,
      poll_interval_ms: 500
    }]
  ]);
});

test("workspace_agent_runs_list maps backend identity refusal distinctly from unavailability and empty success", async () => {
  const unavailable = createHarness({ dispatchBackend: {} });
  const unavailableResult = await unavailable.tools.get("workspace_agent_runs_list").handler({});
  assert.equal(unavailableResult.value.accepted, false);
  assert.equal(unavailableResult.value.blocker.code, DISPATCH_BLOCKER_CODES.BACKEND_UNAVAILABLE);
  assert.equal(unavailableResult.value.blocker.reason, "run_list_backend_unavailable");

  const identityRefusalCalls = [];
  const refused = createHarness({
    dispatchSessionIdentity: null,
    dispatchBackend: {
      listRuns: async (input) => {
        identityRefusalCalls.push(input);
        return {
          accepted: false,
          refusal: {
            code: BACKEND_REFUSAL_CODES.MONITOR_HANDLE_CALLER_MISMATCH,
            reason: "caller_session_id_required",
            detail: null
          }
        };
      }
    }
  });
  const refusedResult = await refused.tools.get("workspace_agent_runs_list").handler({});
  assert.deepEqual(identityRefusalCalls, [{
    caller_session_id: null,
    subject: null,
    state: "active"
  }]);
  assert.equal(refusedResult.value.accepted, false);
  assert.equal(
    refusedResult.value.blocker.code,
    DISPATCH_BLOCKER_CODES.MONITOR_HANDLE_CALLER_MISMATCH
  );
  assert.equal(refusedResult.value.blocker.reason, "caller_session_id_required");

  const empty = createHarness({
    dispatchBackend: { listRuns: async () => ({ accepted: true, runs: [] }) }
  });
  const emptyResult = await empty.tools.get("workspace_agent_runs_list").handler({});
  assert.deepEqual(emptyResult.value, {
    schema_version: AGENT_RUNS_LIST_SCHEMA_VERSION,
    accepted: true,
    availability: "current_process",
    retention_state: "unknown",
    state: "active",
    total_count: 0,
    returned_count: 0,
    has_more: false,
    runs: []
  });
});

test("run-monitor registrar preserves status/wait registration and behavior", async () => {
  const calls = [];
  const common = {
    accepted: true,
    run_id: "run-1",
    monitor_handle: "handle-1",
    app: "codex",
    role: "reviewer",
    subject: "WK-1668#SLICE-005",
    status: "succeeded",
    terminal: true,
    started_at: "2026-08-14T10:00:00.000Z",
    updated_at: "2026-08-14T10:01:00.000Z",
    exit: { code: 0, signal: null },
    final_result: null
  };
  const { tools } = createHarness({
    dispatchBackend: {
      listRuns: async () => ({ accepted: true, runs: [] }),
      getRunStatus: async (input) => {
        calls.push(["status", input]);
        return common;
      },
      waitForRunStatus: async (input) => {
        calls.push(["wait", input]);
        return { ...common, timed_out: false };
      }
    }
  });
  assert.ok(tools.has("workspace_agent_runs_list"));
  assert.ok(tools.has("workspace_agent_run_status"));
  assert.ok(tools.has("workspace_agent_run_wait"));

  const monitored = new Map();
  registerRunMonitorRoutes({
    registerTool: (name, spec, handler) => monitored.set(name, { spec, handler }),
    workspaceRepos: [],
    z,
    jsonContent: (value) => ({ value }),
    resolveWorkspaceRepo: () => ({ dir: "/tmp/repo", repo: "fixture" }),
    dispatchBackend: {
      listRuns: async () => ({ accepted: true, runs: [] }),
      getRunStatus: async (input) => {
        calls.push(["status", input]);
        return common;
      },
      waitForRunStatus: async (input) => {
        calls.push(["wait", input]);
        return { ...common, timed_out: false };
      }
    },
    dispatchSessionIdentity: "trusted-session"
  });
  const status = await monitored.get("workspace_agent_run_status").handler({
    monitor_handle: "handle-1"
  });
  const wait = await monitored.get("workspace_agent_run_wait").handler({
    monitor_handle: "handle-1",
    timeout_ms: 1000,
    poll_interval_ms: 500
  });
  assert.equal(status.value.schema_version, AGENT_RUN_STATUS_SCHEMA_VERSION);
  assert.equal(status.value.accepted, true);
  assert.equal(wait.value.schema_version, AGENT_RUN_WAIT_SCHEMA_VERSION);
  assert.equal(wait.value.accepted, true);
  assert.deepEqual(calls, [
    ["status", {
      caller_session_id: "trusted-session",
      monitor_handle: "handle-1",
      subject: null
    }],
    ["wait", {
      caller_session_id: "trusted-session",
      monitor_handle: "handle-1",
      subject: null,
      timeout_ms: 1000,
      poll_interval_ms: 500
    }],
    ["status", {
      caller_session_id: "trusted-session",
      monitor_handle: "handle-1",
      subject: null
    }]
  ]);
});
