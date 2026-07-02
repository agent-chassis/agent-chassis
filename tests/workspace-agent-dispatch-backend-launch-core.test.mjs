

import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import {
  BACKEND_MISSING_RESULT_CODES
} from "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend.mjs";
import {
  superviseChildLaunch
} from "../packages/agent-launch-cli/src/lib/workspace-agent-launch-core.mjs";
import {
  assertNoForbiddenTokens,
  createTestDispatchBackend
} from "./workspace-agent-dispatch-backend-shared.mjs";

function makeFakeChild({ pid = 5150 } = {}) {
  const child = new EventEmitter();
  child.pid = pid;
  child.exitCode = null;
  child.signalCode = null;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.emitStdout = (chunk) => child.stdout.emit("data", chunk);
  child.emitStderr = (chunk) => child.stderr.emit("data", chunk);
  child.finish = (code, signal = null) => {
    child.exitCode = code;
    child.signalCode = signal;
    child.emit("exit", code, signal);
  };
  return child;
}

function fakeCoreParser({ stdout, role, subject }) {
  if (typeof stdout !== "string" || stdout.trim().length === 0) {
    return {
      kind: "missing_result",
      missing_result: {
        code: BACKEND_MISSING_RESULT_CODES.FINAL_REPORT_NOT_CAPTURED,
        reason: "claude_stdout_empty",
        detail: null
      }
    };
  }
  return {
    kind: "findings",
    findings: {
      schema_version: "claude-final-message.v1",
      format: "text",
      role: role ?? null,
      subject: subject ?? null,
      source: { kind: "claude_stdout", bytes: stdout.length },
      text: stdout
    }
  };
}

test("WK-0626 backend surfaces shared launch core findings final_result with full_response", async () => {
  const reportText = "## Findings\n- packages/y.mjs:9 — example\n";
  const backend = createTestDispatchBackend({
    launchExecutor: async (req) => {
      const child = makeFakeChild();
      const handle = superviseChildLaunch({
        child,
        parseFinalResult: fakeCoreParser,
        role: req.role,
        subject: req.subject,
        family: "claude"
      });
      child.emitStdout(reportText);
      child.finish(0);
      return handle;
    }
  });
  const launch = await backend.startLaunch({
    caller_session_id: "session-LC-A",
    role: "reviewer",
    app: "codex",
    subject: "WK-0626#shared-launch-core"
  });
  const status = await backend.getRunStatus({
    caller_session_id: "session-LC-A",
    monitor_handle: launch.monitor_handle
  });
  assert.equal(status.status, "succeeded");
  assert.equal(status.final_result.kind, "findings");
  assert.equal(status.final_result.findings.text, reportText);
  assert.ok(status.final_result.full_response, "full_response must survive the backend boundary");
  assert.equal(status.final_result.full_response.text, reportText);
});

test("WK-0626 backend preserves bounded stderr detail for shared launch core failed terminal", async () => {
  const backend = createTestDispatchBackend({
    launchExecutor: async (req) => {
      const child = makeFakeChild();
      const handle = superviseChildLaunch({
        child,
        parseFinalResult: fakeCoreParser,
        role: req.role,
        subject: req.subject,
        family: "claude"
      });
      child.emitStderr("Error: ANTHROPIC_API_KEY is not set\n");
      child.finish(1);
      return handle;
    }
  });
  const launch = await backend.startLaunch({
    caller_session_id: "session-LC-B",
    role: "worker",
    app: "codex",
    subject: "WK-0626#shared-launch-core"
  });
  const status = await backend.getRunStatus({
    caller_session_id: "session-LC-B",
    monitor_handle: launch.monitor_handle
  });
  assert.equal(status.status, "failed");
  assert.equal(status.final_result.kind, "missing_result");

  const detail = status.final_result.missing_result.detail;
  assert.ok(detail.stderr_bytes > 0, "stderr_bytes must be non-zero");
  assert.match(detail.stderr_tail, /ANTHROPIC_API_KEY is not set/);
  assert.equal(detail.exit_code, 1);
  assert.equal(status.final_result.full_response, null);
  assertNoForbiddenTokens(status, "shared-launch-core-stderr-missing-result");
});

test("WK-0755 exit-without-close child terminates the flush gate instead of hanging", async () => {
  const child = makeFakeChild();
  const handle = superviseChildLaunch({
    child,
    parseFinalResult: fakeCoreParser,
    role: "reviewer",
    subject: "WK-0755#shared-core-flush-gate-test-hang",
    family: "claude"
  });
  child.emitStdout("## Findings\n- packages/z.mjs:1 — example\n");

  child.finish(0);

  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("probe() hung on the flush gate (regression)")),
      4000
    );
  });
  let probe;
  try {
    probe = await Promise.race([handle.probe(), timeout]);
  } finally {
    clearTimeout(timer);
  }

  assert.equal(probe.status, "succeeded");
  assert.equal(probe.final_result.kind, "findings");
  assert.match(probe.final_result.findings.text, /packages\/z\.mjs:1/);
});
