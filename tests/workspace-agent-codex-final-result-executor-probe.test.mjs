

import assert from "node:assert/strict";
import test from "node:test";

import {
  BACKEND_FINAL_RESULT_KINDS,
  BACKEND_MISSING_RESULT_CODES,
  WORKSPACE_AGENT_DISPATCH_FINAL_RESULT_SCHEMA_VERSION
} from "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend.mjs";
import {
  CODEX_FAMILY_SOURCE_READ_MODE
} from "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-codex-launch-support.mjs";
import {
  FakeChild,
  SAMPLE_INPUT,
  buildHarness,
  createCodexTestBackend,
  fakePlanForRole
} from "./workspace-agent-codex-final-result-harness.mjs";

test("default capture returns missing_result when the plan exposes no finalPath", async () => {
  const child = new FakeChild();
  const { executor } = buildHarness({
    planResult: fakePlanForRole("worker"),
    spawnImpl: () => child
  });
  const result = await executor(SAMPLE_INPUT);
  child.emit("exit", 0, null);
  const probed = await result.probe();
  assert.equal(probed.status, "succeeded");
  assert.ok(probed.final_result);
  assert.equal(probed.final_result.schema_version, WORKSPACE_AGENT_DISPATCH_FINAL_RESULT_SCHEMA_VERSION);
  assert.equal(probed.final_result.kind, "missing_result");
  assert.equal(
    probed.final_result.missing_result.code,
    BACKEND_MISSING_RESULT_CODES.FINAL_REPORT_NOT_CAPTURED
  );
  assert.equal(probed.final_result.missing_result.reason, "final_message_path_unavailable");
});

test("non-terminal probe returns final_result: null without invoking the capturer", async () => {
  const child = new FakeChild();
  const { executor, calls } = buildHarness({
    planResult: fakePlanForRole("worker"),
    spawnImpl: () => child,
    captureFinalResult: () => ({ kind: "findings", findings: { x: 1 } })
  });
  const result = await executor(SAMPLE_INPUT);
  const probed = await result.probe();
  assert.equal(probed.status, "running");
  assert.equal(probed.final_result, null);
  assert.equal(calls.captureFinalResult.length, 0);
});

test("injected capturer surfaces findings through the probe and caches the envelope", async () => {
  const child = new FakeChild();
  const findingsBody = { schema_version: "reviewer-findings.v1", items: [] };
  const { executor, calls } = buildHarness({
    planResult: fakePlanForRole("worker"),
    spawnImpl: () => child,
    captureFinalResult: ({ status, exit, role, codexRole }) => {
      assert.equal(role, "worker");
      assert.equal(codexRole, "worker");
      assert.equal(status, "succeeded");
      assert.equal(exit.code, 0);
      return {
        kind: "findings",
        findings: findingsBody,
        writeback: { kind: "wk_updated", detail: { wk: "WK-0556" } }
      };
    }
  });
  const result = await executor(SAMPLE_INPUT);
  child.emit("exit", 0, null);
  const first = await result.probe();
  assert.equal(first.final_result.kind, "findings");
  assert.deepEqual(first.final_result.findings, findingsBody);
  assert.equal(first.final_result.writeback.kind, "wk_updated");

  const second = await result.probe();
  assert.deepEqual(second.final_result, first.final_result);
  assert.equal(calls.captureFinalResult.length, 1);
});

test("injected capturer can report explicit no_findings", async () => {
  const child = new FakeChild();
  const { executor } = buildHarness({
    planResult: fakePlanForRole("worker"),
    spawnImpl: () => child,
    captureFinalResult: () => ({
      kind: "no_findings",
      no_findings: { reason: "redteam_found_no_issues" },
      writeback: { kind: "no_writeback_expected" }
    })
  });
  const result = await executor(SAMPLE_INPUT);
  child.emit("exit", 0, null);
  const probed = await result.probe();
  assert.equal(probed.final_result.kind, "no_findings");
  assert.equal(probed.final_result.no_findings.reason, "redteam_found_no_issues");
  assert.equal(probed.final_result.writeback.kind, "no_writeback_expected");
});

test("capturer throw is contained as a missing_result with capture_threw code", async () => {
  const child = new FakeChild();
  const { executor } = buildHarness({
    planResult: fakePlanForRole("worker"),
    spawnImpl: () => child,
    captureFinalResult: () => { throw new Error("parser exploded"); }
  });
  const result = await executor(SAMPLE_INPUT);
  child.emit("exit", 0, null);
  const probed = await result.probe();
  assert.equal(probed.status, "succeeded");
  assert.equal(probed.final_result.kind, "missing_result");
  assert.equal(
    probed.final_result.missing_result.code,
    BACKEND_MISSING_RESULT_CODES.FINAL_REPORT_CAPTURE_THREW
  );
  assert.equal(probed.final_result.missing_result.detail.message, "parser exploded");
});

test("capturer returning an unrecognized kind degrades to invalid_kind", async () => {
  const child = new FakeChild();
  const { executor } = buildHarness({
    planResult: fakePlanForRole("worker"),
    spawnImpl: () => child,
    captureFinalResult: () => ({ kind: "wat" })
  });
  const result = await executor(SAMPLE_INPUT);
  child.emit("exit", 0, null);
  const probed = await result.probe();
  assert.equal(probed.final_result.kind, "missing_result");
  assert.equal(
    probed.final_result.missing_result.code,
    BACKEND_MISSING_RESULT_CODES.FINAL_REPORT_INVALID_KIND
  );
  assert.equal(probed.final_result.missing_result.detail.received_kind, "wat");
});

test("executor-level final_result kinds match the backend contract", () => {

  for (const kind of ["findings", "no_findings", "missing_result"]) {
    assert.equal(BACKEND_FINAL_RESULT_KINDS.includes(kind), true);
  }
});

test("executor plugged into backend surfaces missing_result on default codex exit", async () => {

  const child = new FakeChild({ pid: 4321 });
  const { executor } = buildHarness({
    planResult: fakePlanForRole("worker"),
    spawnImpl: () => child
  });
  const backend = createCodexTestBackend({
    launchExecutors: {
      codex: {
        executor,
        sourceReadMode: CODEX_FAMILY_SOURCE_READ_MODE,
        nativeReadCapability: null
      }
    },
    proveAssignedSourceReadable: async () => ({ ok: true })
  });
  const launch = await backend.startLaunch(SAMPLE_INPUT);
  assert.equal(launch.accepted, true);
  child.emit("exit", 0, null);
  const status = await backend.getRunStatus({
    caller_session_id: SAMPLE_INPUT.caller_session_id,
    run_id: launch.run_id
  });
  assert.equal(status.status, "succeeded");
  assert.equal(status.terminal, true);
  assert.equal(status.final_result.kind, "missing_result");
  assert.equal(
    status.final_result.missing_result.code,
    BACKEND_MISSING_RESULT_CODES.FINAL_REPORT_NOT_CAPTURED
  );
});
