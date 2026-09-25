

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { z } from "zod";

import {
  STDIO_MCP_CLIENT_READINESS_BLOCKER_REASON,
  STDIO_MCP_CONDUIT_ERROR_CODES,
  attachStdioMcpConduitLaunchOutcome,
  buildStdioMcpConduitTerminalProbe,
  describeStdioMcpConduitLaunchFailure,
  readStdioMcpConduitTerminalFailure
} from "../../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-contract.mjs";
import { finalizeAdvisoryProcessLaunch } from
  "../../packages/agent-launch-cli/src/lib/workspace-agent-advisory-result-settlement.mjs";
import { createMonitor } from
  "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-lifecycle-monitor.mjs";
import { registerRunMonitorRoutes } from
  "../../packages/wiki-mcp/src/lib/dispatch-run-monitor-routes.mjs";
import { jsonContent } from "../../packages/wiki-mcp/src/lib/mcp-response.mjs";
import { parseWorkspaceRepos, resolveWorkspaceRepo } from
  "../../packages/wiki-mcp/src/lib/workspace-repo-resolution.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SESSION = "session-advisory-conduit-status";
const SUBJECT = "WK-2405";
const CLOCK = () => Date.parse("2026-09-01T00:00:05.000Z");

async function composeRegisteredStatus() {
  const runs = new Map();
  const monitor = createMonitor({ runs, clock: CLOCK, sleep: async () => {}, monotonicNow: () => 0 });
  const workspaceRepos = await parseWorkspaceRepos({
    WIKI_MCP_WORKSPACE_DIR: REPOSITORY_ROOT,
    WIKI_MCP_WORKSPACE_ALIAS: "agent-chassis"
  });
  const tools = new Map();
  registerRunMonitorRoutes({
    registerTool: (name, config, handler) => tools.set(name, { config, handler }),
    workspaceRepos,
    z,
    jsonContent,
    resolveWorkspaceRepo,
    dispatchBackend: monitor,
    dispatchSessionIdentity: SESSION
  });
  let runIds = 0;
  return {
    async launch(executorResult) {
      runIds += 1;
      return await finalizeAdvisoryProcessLaunch({
        executorResult,
        runs,
        run_id: `wkdb_advisory_conduit_${runIds}`,
        monitor_handle: `wkmh_advisory_conduit_${runIds}`,
        app: "claude",
        resolvedModel: "opus",
        resolvedBackend: "claude",
        role: "reviewer",
        subject: SUBJECT,
        workspace_alias: "agent-chassis",
        caller_session_id: SESSION,
        startedAt: "2026-09-01T00:00:00.000Z",
        advisoryReviewInput: { formal_result_contract: null }
      });
    },
    async status(run, args = {}) {
      const response = await tools.get("workspace_agent_run_status").handler({
        subject: SUBJECT,
        attempt_id: run.run_id,
        ...args
      });
      return response.structuredContent;
    }
  };
}

function scriptedChild(observations) {
  const queue = [...observations];
  return {
    accepted: true,
    status: "launching",
    probe: async () => (queue.length > 1 ? queue.shift() : queue[0])
  };
}

function readinessTimeout() {
  return Object.assign(new Error("confined client did not become ready"), {
    code: STDIO_MCP_CONDUIT_ERROR_CODES.CLIENT_READINESS_TIMEOUT,
    detail: { timeout_ms: 180_000, initialized: false }
  });
}

function expectedCarrier(conduit, observed) {
  return readStdioMcpConduitTerminalFailure(
    buildStdioMcpConduitTerminalProbe(describeStdioMcpConduitLaunchFailure(conduit), observed));
}

const RUNNING = Object.freeze({ status: "running", exit: null, final_result: null });

test("registered advisory run status publishes the same conduit carrier in compact, full, repeated, and bounded observations", async () => {
  const registered = await composeRegisteredStatus();
  const killed = Object.freeze({
    status: "failed",
    exit: Object.freeze({ code: null, signal: "SIGKILL" }),
    final_result: null
  });
  const conduit = { runId: "stdio-mcp-advisory-status", readinessFailure: null, cleanupFailure: null };
  const run = await registered.launch(
    attachStdioMcpConduitLaunchOutcome(scriptedChild([RUNNING, killed]), conduit));

  const running = await registered.status(run);
  assert.equal(running.accepted, true, JSON.stringify(running));
  assert.equal(running.terminal, false);
  assert.equal(Object.hasOwn(running, "exit"), false);

  conduit.readinessFailure = readinessTimeout();
  const compact = await registered.status(run);
  const expected = {
    code: null,
    signal: "SIGKILL",
    conduit_failure: expectedCarrier(conduit, killed)
  };
  assert.equal(compact.status, "failed");
  assert.equal(compact.terminal, true);
  assert.deepEqual(compact.exit, expected);
  assert.equal(compact.exit.conduit_failure.reason, STDIO_MCP_CLIENT_READINESS_BLOCKER_REASON);
  assert.equal(compact.exit.conduit_failure.detail.conduit_error_code,
    STDIO_MCP_CONDUIT_ERROR_CODES.CLIENT_READINESS_TIMEOUT);
  assert.equal(compact.exit.conduit_failure.cleanup_only, false);
  assert.ok(compact.final_result_summary, "compact status keeps the bounded summary");

  const full = await registered.status(run, { include_final_result: true });
  assert.deepEqual(full.exit, expected);
  assert.equal(full.final_result.missing_result.reason, "advisory_output_not_captured");

  const repeated = await registered.status(run);
  assert.deepEqual(repeated.exit, expected);
  const bounded = await registered.status(run, { timeout_ms: 1_000 });
  assert.deepEqual(bounded.exit, expected);
});

test("registered advisory run status keeps captured text beside the cause and fabricates nothing for a healthy run", async () => {
  const registered = await composeRegisteredStatus();
  const text = "Medium: captured before the conduit failed.";
  const failedWithText = Object.freeze({
    status: "failed",
    exit: Object.freeze({ code: 1, signal: null }),
    final_result: {
      kind: "no_findings",
      no_findings: { reason: "captured" },
      full_response: { format: "markdown", text }
    }
  });
  const failing = { runId: "stdio-mcp-advisory-text", readinessFailure: readinessTimeout(), cleanupFailure: null };
  const failedRun = await registered.launch(
    attachStdioMcpConduitLaunchOutcome(scriptedChild([failedWithText]), failing));
  const failed = await registered.status(failedRun, { include_final_result: true });
  assert.deepEqual(failed.exit, {
    code: 1,
    signal: null,
    conduit_failure: expectedCarrier(failing, failedWithText)
  });
  assert.equal(failed.final_result.full_response.text, text);
  assert.equal(failed.final_result.advisory_review.advisory_output.usable, true);

  const succeeded = Object.freeze({
    status: "succeeded",
    exit: Object.freeze({ code: 0, signal: null }),
    final_result: {
      kind: "no_findings",
      no_findings: { reason: "clean" },
      full_response: { format: "markdown", text: "No findings." }
    }
  });
  const healthy = { runId: "stdio-mcp-advisory-healthy", readinessFailure: null, cleanupFailure: null };
  const healthyRun = await registered.launch(
    attachStdioMcpConduitLaunchOutcome(scriptedChild([succeeded]), healthy));
  const compact = await registered.status(healthyRun);
  const full = await registered.status(healthyRun, { include_final_result: true });
  for (const observed of [compact, full]) {
    assert.equal(observed.status, "succeeded");
    assert.deepEqual(observed.exit, { code: 0, signal: null });
  }
});
