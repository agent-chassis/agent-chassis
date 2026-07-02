

import test from "node:test";
import assert from "node:assert/strict";

import {
  BACKEND_REFUSAL_CODES,
  WORKSPACE_AGENT_DISPATCH_RUN_STATUS_SCHEMA_VERSION
} from "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend.mjs";
import {
  createTestDispatchBackend
} from "./workspace-agent-dispatch-backend-shared.mjs";

test("unknown monitor_handle and run_id both refuse with monitor_handle_unknown", async () => {
  const backend = createTestDispatchBackend({
    launchExecutor: async () => ({ accepted: true, status: "launching" })
  });
  const byHandle = await backend.getRunStatus({
    caller_session_id: "session-F",
    monitor_handle: "wkmh_does_not_exist"
  });
  assert.equal(byHandle.accepted, false);
  assert.equal(byHandle.refusal.code, BACKEND_REFUSAL_CODES.MONITOR_HANDLE_UNKNOWN);
  assert.equal(byHandle.schema_version, WORKSPACE_AGENT_DISPATCH_RUN_STATUS_SCHEMA_VERSION);

  const byRunId = await backend.getRunStatus({
    caller_session_id: "session-F",
    run_id: "wkdb_missing"
  });
  assert.equal(byRunId.accepted, false);
  assert.equal(byRunId.refusal.code, BACKEND_REFUSAL_CODES.MONITOR_HANDLE_UNKNOWN);

  const noHandle = await backend.getRunStatus({ caller_session_id: "session-F" });
  assert.equal(noHandle.accepted, false);
  assert.equal(noHandle.refusal.code, BACKEND_REFUSAL_CODES.MONITOR_HANDLE_UNKNOWN);
});

test("caller_session_id and subject mismatch refuse with WK-0529 monitor_handle codes", async () => {
  const backend = createTestDispatchBackend({
    launchExecutor: async () => ({ accepted: true, status: "launching" })
  });
  const launch = await backend.startLaunch({
    caller_session_id: "session-G",
    role: "worker",
    app: "codex",
    subject: "WK-0553#backend-adapter"
  });

  const callerMismatch = await backend.getRunStatus({
    caller_session_id: "session-OTHER",
    monitor_handle: launch.monitor_handle
  });
  assert.equal(callerMismatch.accepted, false);
  assert.equal(callerMismatch.refusal.code, BACKEND_REFUSAL_CODES.MONITOR_HANDLE_CALLER_MISMATCH);

  const subjectMismatch = await backend.getRunStatus({
    caller_session_id: "session-G",
    monitor_handle: launch.monitor_handle,
    subject: "WK-0000#wrong"
  });
  assert.equal(subjectMismatch.accepted, false);
  assert.equal(subjectMismatch.refusal.code, BACKEND_REFUSAL_CODES.MONITOR_HANDLE_SUBJECT_MISMATCH);

  const emptySubjectMismatch = await backend.getRunStatus({
    caller_session_id: "session-G",
    monitor_handle: launch.monitor_handle,
    subject: ""
  });
  assert.equal(emptySubjectMismatch.accepted, false);
  assert.equal(
    emptySubjectMismatch.refusal.code,
    BACKEND_REFUSAL_CODES.MONITOR_HANDLE_SUBJECT_MISMATCH
  );
});
