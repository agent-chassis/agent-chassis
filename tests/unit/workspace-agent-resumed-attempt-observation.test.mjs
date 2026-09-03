import assert from "node:assert/strict";
import test from "node:test";

import { createMonitor } from
  "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-lifecycle-monitor.mjs";

function record(overrides = {}) {
  return {
    run_id: "findings-run-1",
    monitor_handle: "findings-monitor-1",
    app: "codex",
    model: "gpt-5.6-terra",
    backend: "codex",
    role: "reviewer",
    subject: "WK-2405#SLICE-014",
    workspace_alias: "agent-chassis",
    caller_session_id: "session-independent",
    status: "launching",
    terminal: false,
    started_at: "2026-08-28T00:00:00.000Z",
    updated_at: "2026-08-28T00:00:00.000Z",
    exit: null,
    final_result: null,
    probe: async () => ({ status: "running" }),
    ...overrides
  };
}

function monitor(runs) {
  let now = 0;
  return createMonitor({
    runs,
    clock: () => 1_777_777_777_777,
    monotonicNow: () => now++,
    sleep: async () => {}
  });
}

test("WK-2405 immediate status observes the owning process-local findings run", async () => {
  const current = record();
  const owner = monitor(new Map([[current.run_id, current]]));
  const status = await owner.getRunStatus({
    caller_session_id: current.caller_session_id,
    monitor_handle: current.monitor_handle,
    subject: current.subject
  });
  assert.equal(status.accepted, true);
  assert.equal(status.run_id, current.run_id);
  assert.equal(status.status, "running");
});

test("WK-2405 wait observes a terminal findings outcome in the same process", async () => {
  const finalResult = Object.freeze({ kind: "no_findings" });
  const current = record({
    probe: async () => ({
      status: "succeeded",
      exit: { code: 0, signal: null },
      final_result: finalResult
    })
  });
  const owner = monitor(new Map([[current.run_id, current]]));
  const waited = await owner.waitForRunStatus({
    caller_session_id: current.caller_session_id,
    monitor_handle: current.monitor_handle,
    subject: current.subject,
    timeout_ms: 10,
    poll_interval_ms: 1
  });
  assert.equal(waited.accepted, true);
  assert.equal(waited.timed_out, false);
  assert.equal(waited.terminal, true);
  assert.equal(waited.final_result.kind, "missing_result");
});

test("WK-2405 restart does not reconstruct an old findings handle", async () => {
  const current = record();
  const oldOwner = monitor(new Map([[current.run_id, current]]));
  assert.equal((await oldOwner.getRunStatus({
    monitor_handle: current.monitor_handle,
    subject: current.subject
  })).accepted, true);

  const restarted = monitor(new Map());
  const unknown = await restarted.getRunStatus({
    monitor_handle: current.monitor_handle,
    subject: current.subject
  });
  assert.equal(unknown.accepted, false);
  assert.equal(unknown.refusal.reason, "unknown_run_or_handle");
  assert.equal(Object.hasOwn(unknown, "resumed"), false);
});
