import assert from "node:assert/strict";
import test from "node:test";

import {
  RUNTIME_BLOCKER_CODES
} from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";

import {
  createDispatchToolRegistry,
  parseStructuredTextResponse
} from "./dispatch-tools-test-helpers.mjs";

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
