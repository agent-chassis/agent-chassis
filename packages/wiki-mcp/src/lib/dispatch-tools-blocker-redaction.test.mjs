import assert from "node:assert/strict";
import test from "node:test";

import {
  RUNTIME_BLOCKER_CODES
} from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
import {
  captureStructuredDiagnostic
} from "@agent-chassis/wiki-core/src/lib/diagnostic-projection.mjs";

import {
  createDispatchToolRegistry,
  parseStructuredTextResponse
} from "./dispatch-tools-test-helpers.mjs";

async function monitorFailure(method, tool, input, error) {
  const tools = createDispatchToolRegistry({
    backend: {
      startLaunch() { throw error; },
      getRunStatus() { throw error; },
      waitForRunStatus() { throw error; }
    }
  });
  return parseStructuredTextResponse(await tools.get(tool).handler(input));
}

test("short ordinary monitoring diagnostics are returned byte-for-byte", async () => {
  const message = "caller-controlled <script>!? /looks/like/a/path";
  const structured = await monitorFailure(
    "getRunStatus",
    "workspace_agent_run_status",
    { monitor_handle: "wkmh_test", subject: "WK-1160#SLICE-012" },
    new Error(message)
  );
  assert.equal(structured.accepted, false);
  assert.equal(structured.blocker.code, RUNTIME_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED);
  assert.equal(structured.blocker.reason, "run_status_tool_exception");
  assert.equal(structured.blocker.detail.error_message, message);
  assert.deepEqual(structured.blocker.detail.error_message_redactions, []);
  assert.equal(Object.hasOwn(structured.blocker.detail, "error_message_truncated"), false);
});

test("multiline Unicode diagnostics larger than the former cap remain complete", async () => {
  const message = `line one 🚀\n${"detail-!?.,[]{}".repeat(1_000)}`;
  const structured = await monitorFailure(
    "waitForRunStatus",
    "workspace_agent_run_wait",
    { monitor_handle: "wkmh_test", subject: "WK-1160#SLICE-012" },
    new Error(message)
  );
  assert.equal(structured.blocker.reason, "run_wait_tool_exception");
  assert.equal(structured.blocker.detail.error_message, message);
  assert.deepEqual(structured.blocker.detail.error_message_redactions, []);
});

test("an ordinary path remains value-identical", async () => {
  const internalPath = "/home/user/agent-chassis/wiki/work-records/WK-1160.json";
  const error = new Error(`Cannot open ${internalPath}; caller suffix remains /ordinary/text`);
  const structured = await monitorFailure(
    "getRunStatus",
    "workspace_agent_run_status",
    { monitor_handle: "wkmh_test", subject: "WK-1160#SLICE-012" },
    error
  );
  assert.equal(structured.blocker.detail.error_message, error.message);
  assert.deepEqual(structured.blocker.detail.error_message_redactions, []);
  assert.equal(JSON.stringify(structured).includes(internalPath), true);
});

test("a structured secret never enters refusal facts or recovery", async () => {
  const secret = "token-secret-value";
  const error = captureStructuredDiagnostic(
    `backend refused ${secret}; retry is not selected from this text`,
    { sensitiveValues: [{ field: "credential", value: secret, reason: "secret_material" }] }
  );
  const structured = await monitorFailure(
    "getRunStatus",
    "workspace_agent_run_status",
    { monitor_handle: "wkmh_test", subject: "WK-1160#SLICE-012" },
    error
  );
  assert.equal(structured.blocker.detail.error_message,
    "backend refused [redacted:secret_material]; retry is not selected from this text");
  assert.deepEqual(structured.blocker.detail.error_message_redactions, [
    {
      field: "workspace_agent_run_status.thrown_diagnostic.credential",
      reason: "secret_material"
    }
  ]);
  assert.equal(JSON.stringify(structured).includes(secret), false);
  assert.equal(structured.refusal.deciding_facts.some(
    (fact) => JSON.stringify(fact).includes(secret)), false);
  assert.equal(JSON.stringify(structured.refusal.recovery).includes(secret), false);
});
