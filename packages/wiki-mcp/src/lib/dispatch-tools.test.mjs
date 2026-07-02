import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

import {
  RUNTIME_BLOCKER_CODES
} from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";

import { registerDispatchTools } from "./dispatch-tools.mjs";
import { errorContent, jsonContent } from "./mcp-response.mjs";

function createDispatchToolRegistry({
  backend = {}
} = {}) {
  const tools = new Map();
  const registerTool = (name, config, handler) => {
    tools.set(name, { config, handler });
  };

  registerDispatchTools({
    registerTool,
    registeredToolNames: new Set([
      "workspace_agent_dispatch",
      "workspace_record_graph_impact_evidence",
      "workspace_validate_dispatch"
    ]),
    workspaceRepos: [{ repo: "agent-chassis", dir: "/home/user/agent-chassis" }],
    z,
    jsonContent,
    errorContent,
    resolveWorkspaceRepo: () => ({
      repo: "agent-chassis",
      dir: "/home/user/agent-chassis"
    }),
    dispatchBackend: {
      startLaunch: async () => {
        throw new Error("Cannot open /home/user/agent-chassis/wiki/work-records/WK-1160.json");
      },
      getRunStatus: async () => {
        throw new Error("Cannot open /home/user/agent-chassis/wiki/work-records/WK-1160.json");
      },
      waitForRunStatus: async () => {
        throw new Error("Cannot open /home/user/agent-chassis/wiki/work-records/WK-1160.json");
      },
      ...backend
    },
    dispatchSessionIdentity: "session-123"
  });

  return tools;
}

function parseStructuredTextResponse(result) {
  assert.equal(result.isError, undefined);
  assert.equal(result.content[0].type, "text");
  assert.equal(typeof result.content[0].text, "string");
  const structured = JSON.parse(result.content[0].text);
  assert.deepEqual(result.structuredContent, structured);
  return structured;
}

test("workspace_agent_dispatch returns a structured blocker when the handler throws", async () => {
  const tools = createDispatchToolRegistry();
  const response = await tools.get("workspace_agent_dispatch").handler({
    role: "worker",
    subject: "WK-1160#SLICE-012",
    app: "codex"
  });

  const structured = parseStructuredTextResponse(response);
  assert.equal(structured.accepted, false);
  assert.equal(structured.blocker.code, RUNTIME_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED);
  assert.equal(structured.blocker.reason, "dispatch_tool_exception");
  assert.equal(structured.blocker.detail.tool, "workspace_agent_dispatch");
  assert.equal(structured.blocker.detail.error_name, "Error");
  assert.equal(
    structured.blocker.detail.error_message,
    "Cannot open [redacted absolute path]"
  );
});

test("workspace_agent_run_status returns a structured blocker when the handler throws", async () => {
  const tools = createDispatchToolRegistry();
  const response = await tools.get("workspace_agent_run_status").handler({
    monitor_handle: "wkmh_test",
    subject: "WK-1160#SLICE-012"
  });

  const structured = parseStructuredTextResponse(response);
  assert.equal(structured.accepted, false);
  assert.equal(structured.blocker.code, RUNTIME_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED);
  assert.equal(structured.blocker.reason, "run_status_tool_exception");
  assert.equal(structured.blocker.detail.tool, "workspace_agent_run_status");
  assert.equal(
    structured.blocker.detail.error_message,
    "Cannot open [redacted absolute path]"
  );
});

test("workspace_agent_run_wait returns a structured blocker when the handler throws", async () => {
  const tools = createDispatchToolRegistry();
  const response = await tools.get("workspace_agent_run_wait").handler({
    monitor_handle: "wkmh_test",
    subject: "WK-1160#SLICE-012"
  });

  const structured = parseStructuredTextResponse(response);
  assert.equal(structured.accepted, false);
  assert.equal(structured.blocker.code, RUNTIME_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED);
  assert.equal(structured.blocker.reason, "run_wait_tool_exception");
  assert.equal(structured.blocker.detail.tool, "workspace_agent_run_wait");
  assert.equal(
    structured.blocker.detail.error_message,
    "Cannot open [redacted absolute path]"
  );
});

const DISPATCH_EXCEPTION_DIAGNOSTIC_MAX_CHARS = 512;

const OVERLONG_THROWN_MESSAGE =
  "Cannot open /home/user/agent-chassis/wiki/work-records/WK-1160.json\n" +
  "detail-".repeat(300);

function createOverlongThrowingRegistry() {
  const overlong = () => {
    throw new Error(OVERLONG_THROWN_MESSAGE);
  };
  return createDispatchToolRegistry({
    backend: {
      startLaunch: overlong,
      getRunStatus: overlong,
      waitForRunStatus: overlong
    }
  });
}

function assertBoundedRedactedBlocker(structured, { reason, tool }) {

  assert.equal(structured.accepted, false);
  assert.equal(structured.blocker.code, RUNTIME_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED);
  assert.equal(structured.blocker.reason, reason);
  assert.equal(structured.blocker.detail.tool, tool);
  assert.equal(structured.blocker.detail.error_name, "Error");

  const message = structured.blocker.detail.error_message;

  assert.ok(message.includes("[redacted absolute path]"));
  assert.ok(!message.includes("/home/user/agent-chassis/wiki/work-records/WK-1160.json"));

  assert.equal(message.length, DISPATCH_EXCEPTION_DIAGNOSTIC_MAX_CHARS);
  assert.ok(message.length <= DISPATCH_EXCEPTION_DIAGNOSTIC_MAX_CHARS);

  assert.equal(structured.blocker.detail.error_message_truncated, true);
}

test("workspace_agent_dispatch caps an overlong redacted thrown diagnostic", async () => {
  const tools = createOverlongThrowingRegistry();
  const response = await tools.get("workspace_agent_dispatch").handler({
    role: "worker",
    subject: "WK-1160#SLICE-012",
    app: "codex"
  });

  const structured = parseStructuredTextResponse(response);
  assertBoundedRedactedBlocker(structured, {
    reason: "dispatch_tool_exception",
    tool: "workspace_agent_dispatch"
  });
});

test("workspace_agent_run_status caps an overlong redacted thrown diagnostic", async () => {
  const tools = createOverlongThrowingRegistry();
  const response = await tools.get("workspace_agent_run_status").handler({
    monitor_handle: "wkmh_test",
    subject: "WK-1160#SLICE-012"
  });

  const structured = parseStructuredTextResponse(response);
  assertBoundedRedactedBlocker(structured, {
    reason: "run_status_tool_exception",
    tool: "workspace_agent_run_status"
  });
});

test("workspace_agent_run_wait caps an overlong redacted thrown diagnostic", async () => {
  const tools = createOverlongThrowingRegistry();
  const response = await tools.get("workspace_agent_run_wait").handler({
    monitor_handle: "wkmh_test",
    subject: "WK-1160#SLICE-012"
  });

  const structured = parseStructuredTextResponse(response);
  assertBoundedRedactedBlocker(structured, {
    reason: "run_wait_tool_exception",
    tool: "workspace_agent_run_wait"
  });
});

test("short thrown dispatch diagnostics are not marked truncated", async () => {
  const tools = createDispatchToolRegistry();
  const response = await tools.get("workspace_agent_dispatch").handler({
    role: "worker",
    subject: "WK-1160#SLICE-012",
    app: "codex"
  });

  const structured = parseStructuredTextResponse(response);
  assert.equal(structured.blocker.detail.error_message, "Cannot open [redacted absolute path]");
  assert.ok(
    structured.blocker.detail.error_message.length <= DISPATCH_EXCEPTION_DIAGNOSTIC_MAX_CHARS
  );
  assert.equal(structured.blocker.detail.error_message_truncated, false);
});