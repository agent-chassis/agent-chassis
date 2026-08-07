

import test from "node:test";
import assert from "node:assert/strict";

import { registerDispatchTools } from "../packages/wiki-mcp/src/lib/dispatch-tools/register.mjs";
import { RUNTIME_BLOCKER_CODES } from "../packages/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";

const RECORD_ID = "WK-1793";
const SLICE_ID = "SLICE-019";
const SUBJECT = `${RECORD_ID}#${SLICE_ID}`;

const schemaStub = new Proxy({}, {
  get: () => () => schemaStub
});
const z = schemaStub;

const PRIVATE_HANDOFF = Object.freeze({
  authored_source_digest: "authored",
  full_persistence_snapshot_digest: "persistence",
  reviewed_unit_digest: "reviewed"
});

function dispatchableReadiness(options = {}) {
  return {
    schema_version: "dispatch-readiness.v1",
    record_id: RECORD_ID,
    unit: { kind: "slice", address: SUBJECT, record_id: RECORD_ID, slice_id: SLICE_ID },
    dispatch_role: "implementation",
    dispatchable: true,
    decision_code: "dispatchable",
    reasons: [],
    recovery: {
      graph_impact: "not_required",
      admission_metrics: "fresh",
      target_resolution: "fresh"
    },
    state: { graph_state: {}, graph_auto_recoverable: false },
    ...(options.node_engine_admissibility
      ? { admissibility: { status: "admit", authority: "node_engine" } }
      : {})
  };
}

function correctiveRefusal(overrides = {}) {
  return {
    code: "managed_run_identity_check_threw",
    reason: "managed_run_identity_check_threw",
    detail: {
      code: "agent_launch.managed_run.corrective_integrated_state_unresolved.v1",
      cause_code: "agent_launch.canonical_integrated_lifecycle_state.impossible.v1",
      observed_canonical_status: {
        record_id: RECORD_ID,
        slice_id: SLICE_ID,
        parent_status: "todo",
        slice_status: "todo"
      },
      recovery: {
        recovery_kind: "agent_launch.managed_run.corrective_status_reconciliation.v1",
        responsible_actor: "coordinator",
        next_action: "reissue_subject_dispatch_after_canonical_status_reconciliation",
        slice_unit: SUBJECT,
        unit: RECORD_ID,
        observed: { parent_status: "todo", slice_status: "todo" },
        expected: { parent_status: "active", slice_status: "todo" }
      },
      ...overrides
    }
  };
}

function createRegisteredFixture({ refusal = correctiveRefusal(), args = {} } = {}) {
  const tools = new Map();
  let startLaunchCalls = 0;
  let workerExecutorCalls = 0;
  const backend = {
    startLaunch: async () => {
      startLaunchCalls += 1;
      if (refusal) return { accepted: false, refusal };
      workerExecutorCalls += 1;
      return { accepted: true, run_id: "run", monitor_handle: "handle" };
    },
    getRunStatus: async () => ({ accepted: true }),
    waitForRunStatus: async () => ({ accepted: true })
  };

  registerDispatchTools({
    registerTool: (name, config, handler) => tools.set(name, { config, handler }),
    registeredToolNames: new Set(["workspace_agent_dispatch"]),
    workspaceRepos: [{ repo: "agent-chassis", dir: "/workspace" }],
    z,
    jsonContent: (value) => value,
    errorContent: (value) => value,
    resolveWorkspaceRepo: () => ({ repo: "agent-chassis", dir: "/workspace" }),
    validateDispatch: async (options) => dispatchableReadiness(options),
    validateLaunchIntent: async () => ({
      readiness: dispatchableReadiness(),
      private_handoff: PRIVATE_HANDOFF
    }),
    revalidatePrivateHandoff: async () => ({ valid: true }),
    dispatchBackend: backend,
    dispatchSessionIdentity: "session-wk1793"
  });

  return {
    dispatch: () => tools.get("workspace_agent_dispatch").handler({
      role: "worker", subject: SUBJECT, ...args
    }),
    startLaunchCalls: () => startLaunchCalls,
    workerExecutorCalls: () => workerExecutorCalls
  };
}

test("WK-1793#SLICE-019 registered route projects exact corrective status recovery", async () => {
  const fixture = createRegisteredFixture();
  const result = await fixture.dispatch();

  assert.equal(result.accepted, false);
  assert.equal(
    result.blocker.code,
    RUNTIME_BLOCKER_CODES.MANAGED_CORRECTIVE_STATUS_RECONCILIATION_REQUIRED
  );
  assert.equal(result.blocker.reason, "corrective_status_reconciliation_required");
  assert.deepEqual(result.blocker.detail.observed, {
    parent_status: "todo",
    slice_status: "todo"
  });
  assert.deepEqual(result.blocker.detail.expected, {
    parent_status: "active",
    slice_status: "todo"
  });
  assert.equal(result.blocker.detail.unit, RECORD_ID);
  assert.equal(result.blocker.detail.slice_unit, SUBJECT);
  assert.deepEqual(result.blocker.detail.next_call, {
    route: "workspace_agent_dispatch",
    arguments: { role: "worker", subject: SUBJECT }
  });
  assert.equal(
    result.next_action,
    "workspace_work_record_set_status(unit=WK-1793, status=active)"
  );
  assert.equal(fixture.startLaunchCalls(), 1);
  assert.equal(fixture.workerExecutorCalls(), 0);
});

test("WK-1793#SLICE-019 loss of launcher detail remains generic operator recovery", async () => {
  const fixture = createRegisteredFixture({
    refusal: { reason: "managed_run_identity_check_threw", detail: { message: "caller lookalike" } }
  });
  const result = await fixture.dispatch();

  assert.equal(result.accepted, false);
  assert.equal(result.blocker.code, RUNTIME_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED);
  assert.equal(result.blocker.reason, "managed_run_identity_check_threw");
  assert.equal(result.blocker.detail.backend_refusal.message, "caller lookalike");
  assert.equal(Object.hasOwn(result, "next_action"), false);
});

test("WK-1793#SLICE-019 blanket launch-failure mapping cannot replace corrective projection", async () => {
  const fixture = createRegisteredFixture({
    refusal: { code: "launch_executor_threw", reason: "launch_executor_threw", detail: {} }
  });
  const result = await fixture.dispatch();

  assert.equal(result.accepted, false);
  assert.equal(result.blocker.code, RUNTIME_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED);
  assert.equal(result.blocker.reason, "launch_executor_threw");
  assert.equal(Object.hasOwn(result, "next_action"), false);
});

test("WK-1793#SLICE-019 caller lookalikes refuse before backend launch", async () => {
  const callers = [
    { env: { AGENT_ROLE: "coordinator" } },
    { request: { role: "coordinator" } },
    { prompt: { role: "coordinator" } },
    { argv: { role: "coordinator" } },
    { claimed_identity: { role: "coordinator" } }
  ];
  for (const args of callers) {
    const fixture = createRegisteredFixture({ args });
    const result = await fixture.dispatch();
    assert.equal(result.accepted, false);
    assert.equal(result.blocker.code, RUNTIME_BLOCKER_CODES.CALLER_SUPPLIED_IDENTITY);
    assert.equal(result.blocker.reason, "caller_supplied_identity_carrier");
    assert.equal(Object.hasOwn(result, "next_action"), false);
    assert.equal(fixture.startLaunchCalls(), 0);
    assert.equal(fixture.workerExecutorCalls(), 0);
  }
});
