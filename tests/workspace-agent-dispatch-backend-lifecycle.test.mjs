

import test from "node:test";
import assert from "node:assert/strict";

import {
  BACKEND_ACCEPTED_ROLES,
  BACKEND_REFUSAL_CODES,
  BACKEND_RUN_STATUSES,
  BACKEND_SUPPORTED_APPS,
  WORKSPACE_AGENT_DISPATCH_BACKEND_SCHEMA_VERSION,
  WORKSPACE_AGENT_DISPATCH_RUN_STATUS_SCHEMA_VERSION
} from "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend.mjs";
import {
  RUNTIME_BLOCKER_CODES,
  isRuntimeBlockerCode
} from "../packages/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
import {
  assertNoForbiddenTokens,
  createTestDispatchBackend
} from "./workspace-agent-dispatch-backend-shared.mjs";

test("backend refusal codes are members of the WK-0529 runtime blocker taxonomy", () => {
  for (const code of Object.values(BACKEND_REFUSAL_CODES)) {
    assert.equal(
      isRuntimeBlockerCode(code),
      true,
      `backend refusal code ${code} must exist in the WK-0529 taxonomy`
    );
  }
  assert.equal(BACKEND_REFUSAL_CODES.BACKEND_UNAVAILABLE, RUNTIME_BLOCKER_CODES.BACKEND_UNAVAILABLE);
  assert.equal(BACKEND_REFUSAL_CODES.MONITOR_HANDLE_UNKNOWN, RUNTIME_BLOCKER_CODES.MONITOR_HANDLE_UNKNOWN);
});
test("accepted roles and statuses are stable", () => {
  assert.deepEqual([...BACKEND_ACCEPTED_ROLES], ["worker", "reviewer", "redteam"]);
  assert.equal(BACKEND_RUN_STATUSES.includes("launching"), true);
  assert.equal(BACKEND_RUN_STATUSES.includes("running"), true);
  assert.equal(BACKEND_RUN_STATUSES.includes("succeeded"), true);
  assert.equal(BACKEND_RUN_STATUSES.includes("failed"), true);

  assert.equal(BACKEND_RUN_STATUSES.includes("pending_launch"), false);
});

test("missing app refuses before executor selection", async () => {
  let executorCalls = 0;
  const backend = createTestDispatchBackend({
    launchExecutor: async () => {
      executorCalls += 1;
      return { accepted: true, status: "launching" };
    }
  });
  const result = await backend.startLaunch({
    caller_session_id: "session-A",
    role: "worker",
    subject: "WK-1076#SLICE-005",
    workspace_alias: "default",
    workspace_dir: "/tmp/repo"
  });
  assert.equal(result.accepted, false);
  assert.equal(result.refusal.code, BACKEND_REFUSAL_CODES.LAUNCH_REFUSED);
  assert.equal(result.refusal.reason, "app_required");
  assert.deepEqual(result.refusal.detail.supported_apps, [...BACKEND_SUPPORTED_APPS]);
  assert.equal(executorCalls, 0);
  assert.equal(result.schema_version, WORKSPACE_AGENT_DISPATCH_BACKEND_SCHEMA_VERSION);
});

test("backend_unavailable when no launchExecutor is configured for explicit app", async () => {
  const backend = createTestDispatchBackend();
  const result = await backend.startLaunch({
    caller_session_id: "session-A",
    role: "worker",
    app: "codex",
    subject: "WK-0553#backend-adapter",
    workspace_alias: "default",
    workspace_dir: "/tmp/repo"
  });
  assert.equal(result.accepted, false);
  assert.equal(result.refusal.code, BACKEND_REFUSAL_CODES.BACKEND_UNAVAILABLE);
  assert.equal(result.refusal.reason, "codex_launch_executor_not_configured");
  assert.equal(result.refusal.detail.missing_backend, "workspace_agent_dispatch_backend.launch_executor");
  assert.equal(result.schema_version, WORKSPACE_AGENT_DISPATCH_BACKEND_SCHEMA_VERSION);
});

test("accepted launch transaction is returned only when executor actually starts", async () => {
  let observedRunId = null;
  let observedMonitorHandle = null;
  const backend = createTestDispatchBackend({
    launchExecutor: async (req) => {
      observedRunId = req.run_id;
      observedMonitorHandle = req.monitor_handle;
      return {
        accepted: true,
        status: "launching",
        probe: async () => ({ status: "running" })
      };
    }
  });
  const result = await backend.startLaunch({
    caller_session_id: "session-A",
    role: "worker",
    app: "codex",
    subject: "WK-0553#backend-adapter",
    workspace_alias: "default",
    workspace_dir: "/tmp/repo",
    readiness: { dispatchable: true, decision_code: "dispatchable_ready" }
  });
  assert.equal(result.accepted, true);
  assert.equal(result.status, "launching");
  assert.equal(result.role, "worker");
  assert.equal(result.subject, "WK-0553#backend-adapter");
  assert.equal(result.caller_session_id, "session-A");
  assert.ok(result.run_id.startsWith("wkdb_"));
  assert.ok(result.monitor_handle.startsWith("wkmh_"));
  assert.equal(result.run_id, observedRunId);
  assert.equal(result.monitor_handle, observedMonitorHandle);
  assert.equal(result.terminal, false);
  assert.equal(result.schema_version, WORKSPACE_AGENT_DISPATCH_BACKEND_SCHEMA_VERSION);
  assertNoForbiddenTokens(result, "accepted-launch");
});

test("executor refusal is translated to a stable backend refusal envelope", async () => {
  const backend = createTestDispatchBackend({
    launchExecutor: async () => ({
      accepted: false,
      refusal: {
        code: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
        reason: "role_plan_missing_capability",
        detail: { capability: "filesystem_mcp" }
      }
    })
  });
  const result = await backend.startLaunch({
    caller_session_id: "session-B",
    role: "reviewer",
    app: "codex",
    subject: "WK-0553#backend-adapter",
    workspace_alias: "default",
    workspace_dir: "/tmp/repo"
  });
  assert.equal(result.accepted, false);
  assert.equal(result.refusal.code, BACKEND_REFUSAL_CODES.LAUNCH_REFUSED);
  assert.equal(result.refusal.reason, "role_plan_missing_capability");
  assert.deepEqual(result.refusal.detail, { capability: "filesystem_mcp" });

  assert.deepEqual(backend.__snapshotRuns(), []);
});

test("executor throwing during start emits launch_failed_before_start refusal", async () => {
  const backend = createTestDispatchBackend({
    launchExecutor: async () => {
      throw new Error("spawn refused by sandbox");
    }
  });
  const result = await backend.startLaunch({
    caller_session_id: "session-C",
    role: "redteam",
    app: "codex",
    subject: "WK-0553#backend-adapter",
    workspace_alias: "default",
    workspace_dir: "/tmp/repo"
  });
  assert.equal(result.accepted, false);
  assert.equal(result.refusal.code, BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START);
  assert.equal(result.refusal.reason, "launch_executor_threw");
  assert.equal(result.refusal.detail.message, "spawn refused by sandbox");
});

test("input validation rejects missing caller_session_id, role, and subject", async () => {
  const backend = createTestDispatchBackend({
    launchExecutor: async () => ({ accepted: true, status: "launching" })
  });

  const missingCaller = await backend.startLaunch({
    role: "worker",
    app: "codex",
    subject: "WK-0553#backend-adapter"
  });
  assert.equal(missingCaller.accepted, false);
  assert.equal(missingCaller.refusal.reason, "caller_session_id_required");

  const badRole = await backend.startLaunch({
    caller_session_id: "session-X",
    role: "operator",
    app: "codex",
    subject: "WK-0553#backend-adapter"
  });
  assert.equal(badRole.accepted, false);
  assert.equal(badRole.refusal.reason, "unsupported_role");

  const missingSubject = await backend.startLaunch({
    caller_session_id: "session-X",
    role: "worker",
    app: "codex"
  });
  assert.equal(missingSubject.accepted, false);
  assert.equal(missingSubject.refusal.reason, "subject_required");
});

test("run_status reports terminal transition via probe and stops probing once terminal", async () => {
  let probeCalls = 0;
  const phases = ["running", "succeeded"];
  const backend = createTestDispatchBackend({
    launchExecutor: async () => ({
      accepted: true,
      status: "launching",
      probe: async () => {
        const phase = phases[Math.min(probeCalls, phases.length - 1)];
        probeCalls += 1;
        if (phase === "succeeded") {
          return { status: "succeeded", exit: { code: 0, signal: null } };
        }
        return { status: phase };
      }
    })
  });
  const launch = await backend.startLaunch({
    caller_session_id: "session-D",
    role: "worker",
    app: "codex",
    subject: "WK-0553#backend-adapter",
    workspace_alias: "default",
    workspace_dir: "/tmp/repo"
  });
  assert.equal(launch.accepted, true);

  const first = await backend.getRunStatus({
    caller_session_id: "session-D",
    monitor_handle: launch.monitor_handle
  });
  assert.equal(first.accepted, true);
  assert.equal(first.status, "running");
  assert.equal(first.terminal, false);
  assert.equal(probeCalls, 1);

  const second = await backend.getRunStatus({
    caller_session_id: "session-D",
    monitor_handle: launch.monitor_handle
  });
  assert.equal(second.accepted, true);
  assert.equal(second.status, "succeeded");
  assert.equal(second.terminal, true);
  assert.deepEqual(second.exit, { code: 0, signal: null });
  assert.equal(probeCalls, 2);

  const third = await backend.getRunStatus({
    caller_session_id: "session-D",
    run_id: launch.run_id
  });
  assert.equal(third.status, "succeeded");
  assert.equal(probeCalls, 2);
  assert.equal(third.schema_version, WORKSPACE_AGENT_DISPATCH_RUN_STATUS_SCHEMA_VERSION);
  assertNoForbiddenTokens(third, "run-status");
});

test("probe error transitions the run to failed without crashing the backend", async () => {
  const backend = createTestDispatchBackend({
    launchExecutor: async () => ({
      accepted: true,
      status: "launching",
      probe: async () => {
        throw new Error("backend probe failure");
      }
    })
  });
  const launch = await backend.startLaunch({
    caller_session_id: "session-E",
    role: "worker",
    app: "codex",
    subject: "WK-0553#backend-adapter"
  });
  const status = await backend.getRunStatus({
    caller_session_id: "session-E",
    monitor_handle: launch.monitor_handle
  });
  assert.equal(status.accepted, true);
  assert.equal(status.status, "failed");
  assert.equal(status.terminal, true);
  assert.equal(status.exit.error, "backend probe failure");
});

test("backend module source has no shell/spawn/registration call sites", async () => {

  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
  const modulePath = path.resolve(
    THIS_DIR,
    "..",
    "packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend.mjs"
  );
  const source = await readFile(modulePath, "utf8");
  const forbiddenCallSites = [
    "child_process",
    "spawn(",
    "execSync(",
    "execFile(",
    "execFileSync(",
    "/bin/sh",
    "/bin/bash",
    "createConnectionRegistry",
    "agent-dispatch-connection-registry",
    "buildAgentRolePlan(",
    "process.env"
  ];
  for (const token of forbiddenCallSites) {
    assert.equal(
      source.includes(token),
      false,
      `backend module must not reference ${token}`
    );
  }
});
