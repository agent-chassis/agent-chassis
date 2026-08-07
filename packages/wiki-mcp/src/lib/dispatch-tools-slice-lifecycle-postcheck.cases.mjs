import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { z } from "zod";

import { registerDispatchTools } from "./dispatch-tools.mjs";
import { createWorkspaceAgentDispatchBackend } from "@agent-chassis/agent-launch-cli/src/lib/workspace-agent-dispatch-backend.mjs";

import {
  assessManagedRunProcessIdentity,
  bindManagedRunSandboxProcessIdentity,
  deriveOuterSandboxKillShape,
  publishPendingManagedRunProcessIdentity
} from "@agent-chassis/agent-launch-cli/src/lib/managed-run-process-identity.mjs";

import {
  RUNTIME_BLOCKER_CODES
} from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";

import {
  SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES,
  SLICE_REVIEW_POSTCHECK_STATE_BUDGET
} from "@agent-chassis/agent-launch-cli/src/lib/slice-review-materialization.mjs";
import {
  buildDispatchToolExceptionDetail,
  SAFE_POSTCHECK_MISMATCH_FIELDS,
  SLICE_REVIEW_POSTCHECK_FAILED_CODE
} from "./dispatch-tool-helpers.mjs";

import {
  LIFECYCLE_RESOLUTION_NEXT_ACTIONS,
  runPostWorkerSliceLifecycle,
  TERMINAL_REVIEW_EVIDENCE_MODES
} from "./dispatch-run-monitor-routes.mjs";
import * as lifecycleExports from "./dispatch-post-worker-lifecycle.mjs";
import * as monitorRouteExports from "./dispatch-run-monitor-routes.mjs";
import {
  composePostWorkerSliceLifecycle,
  resolveLauncherOwnedLifecycleDeps
} from "./dispatch-launch-runtime.mjs";
import {
  createDispatchToolRegistry,
  createResumableLifecycleHarness,
  parseStructuredTextResponse,
  terminalReviewAttestation
} from "./dispatch-tools-test-helpers.mjs";

import {
  assertClosedPostcheckLifecycle,
  assertNoPostcheckExceptionText,
  GENERIC_LIFECYCLE_FAILURE_CODE,
  GENERIC_LIFECYCLE_FAILURE_MESSAGE,
  postcheckError,
  withSliceReviewPreparation
} from "./dispatch-tools-slice-lifecycle-test-support.mjs";

test("WK-1691#SLICE-002 the discriminator survives the terminal-worker lifecycle reconstruction seam", async () => {

  const terminal = {
    accepted: true,
    run_id: "run-1691",
    monitor_handle: "wkmh_x",
    role: "worker",
    subject: "WK-1691#SLICE-002",
    status: "succeeded",
    terminal: true,
    started_at: "2026-07-22T00:00:00Z",
    updated_at: "2026-07-22T00:01:00Z"
  };
  const tools = createDispatchToolRegistry({
    backend: {
      getRunStatus: async () => terminal,
      waitForRunStatus: async () => ({ ...terminal, timed_out: false }),
      runPostWorkerSliceLifecycle: async () => {
        throw postcheckError({ field: "objectAlternates" });
      }
    }
  });

  const status = parseStructuredTextResponse(
    await tools.get("workspace_agent_run_status").handler({ monitor_handle: "wkmh_x" })
  );
  assert.equal(status.accepted, true);

  assertClosedPostcheckLifecycle(
    "run_status reconstruction seam", status.slice_lifecycle, "objectAlternates"
  );
  assertNoPostcheckExceptionText("run_status reconstruction seam", status);
});

function postcheckLifecycleRegistry(error, runId) {
  const terminal = {
    accepted: true,
    run_id: runId,
    monitor_handle: "wkmh_x",
    role: "worker",
    subject: "WK-1691#SLICE-002",
    status: "succeeded",
    terminal: true,
    started_at: "2026-07-22T00:00:00Z",
    updated_at: "2026-07-22T00:01:00Z"
  };
  return createDispatchToolRegistry({
    backend: {
      getRunStatus: async () => terminal,
      waitForRunStatus: async () => ({ ...terminal, timed_out: false }),
      runPostWorkerSliceLifecycle: async () => { throw error; }
    }
  });
}

async function waitTimeoutEnvelope(error, runId) {
  return parseStructuredTextResponse(
    await postcheckLifecycleRegistry(error, runId).get("workspace_agent_run_wait").handler({
      monitor_handle: "wkmh_x",
      timeout_ms: 1,
      poll_interval_ms: 500
    })
  );
}

test("WK-1691#SLICE-002 the discriminator survives the run_wait timeout projection", async () => {

  const wait = await waitTimeoutEnvelope(
    postcheckError({ field: "objectAlternates" }), "run-1691-wait-safe"
  );

  assert.equal(wait.lifecycle_resolution.resolved, false);

  assert.deepEqual(wait.lifecycle_resolution.latest_failure, {
    phase: "pre-integration",
    error_code: GENERIC_LIFECYCLE_FAILURE_CODE,
    error_message: GENERIC_LIFECYCLE_FAILURE_MESSAGE,
    error_message_truncated: false
  });

  assertClosedPostcheckLifecycle(
    "run_wait timeout projection", wait.slice_lifecycle, "objectAlternates"
  );
  assertNoPostcheckExceptionText("run_wait timeout projection", wait);

  assert.equal(wait.accepted, true);
  assert.equal(wait.timed_out, true);
  assert.equal(wait.terminal, false);
  assert.equal(wait.child_terminal, true);
  assert.equal(wait.next_action, LIFECYCLE_RESOLUTION_NEXT_ACTIONS.RETRY);
  assert.equal(wait.monitor_handle, "wkmh_x");
  assert.equal(wait.run_id, "run-1691-wait-safe");

  assert.equal(wait.lifecycle_resolution.phase, "pre-integration");
  assert.equal(wait.lifecycle_resolution.integration_complete, false);
  assert.equal(wait.slice_lifecycle.integrated, false);
});

test("WK-1691#SLICE-002 both public routes expose the identical discriminator for one refusal", async () => {

  for (const field of SLICE_REVIEW_POSTCHECK_STATE_BUDGET.bound_fields) {
    const tools = postcheckLifecycleRegistry(postcheckError({ field }), `run-parity-${field}`);
    const status = parseStructuredTextResponse(
      await tools.get("workspace_agent_run_status").handler({ monitor_handle: "wkmh_x" })
    );
    const wait = await waitTimeoutEnvelope(postcheckError({ field }), `run-parity-w-${field}`);

    assert.equal(status.slice_lifecycle.postcheck_mismatch_field, field);
    assert.equal(wait.slice_lifecycle.postcheck_mismatch_field, field);
    assert.equal(
      status.slice_lifecycle.postcheck_mismatch_field,
      wait.slice_lifecycle.postcheck_mismatch_field,
      `run_status and run_wait must agree for ${field}`
    );

    assert.equal(status.terminal, false);
    assert.equal(wait.terminal, false);
  }
});

test("WK-1691#SLICE-002 the run_wait timeout path rejects every unsafe detail shape", async () => {

  const nullProto = Object.create(null);
  nullProto.field = "sliceRef";
  class DetailBag { constructor() { this.field = "sliceRef"; } }
  const getterDetail = {};
  let getterInvoked = false;
  Object.defineProperty(getterDetail, "field", {
    enumerable: true,
    configurable: true,
    get() { getterInvoked = true; return "sliceRef"; }
  });
  const nonEnumerable = {};
  Object.defineProperty(nonEnumerable, "field", { value: "sliceRef", enumerable: false });

  const rejected = [
    ["array detail", ["sliceRef"], undefined],
    ["array with field", Object.assign(["sliceRef"], { field: "sliceRef" }), undefined],
    ["null prototype", nullProto, undefined],
    ["class instance", new DetailBag(), undefined],
    ["accessor property", getterDetail, undefined],
    ["non-enumerable property", nonEnumerable, undefined],
    ["extra string key", { field: "sliceRef", stderr: "/abs/path exploded" }, undefined],
    ["extra symbol key", { field: "sliceRef", [Symbol("x")]: "leak" }, undefined],
    ["nested value", { field: { name: "sliceRef" } }, undefined],
    ["non-string value", { field: 7 }, undefined],
    ["unknown discriminator", { field: "refsSnapshot" }, undefined],
    ["unbound classified state", { field: "ORIG_HEAD" }, undefined],
    ["wrong key name", { status: " M packages/secret.mjs" }, undefined],
    ["git invocation detail", { args: ["status"], status: 128, stderr: "fatal: /abs/path" }, undefined],
    ["empty detail", {}, undefined],
    ["null detail", null, undefined],
    ["absent detail", undefined, undefined],

    ["unrelated error code", { field: "sliceRef" }, "agent_launch.slice_lifecycle.failed.v1"],
    ["sparse-index code", { field: "sliceRef" },
      SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.SPARSE_OR_HIDDEN_INDEX]
  ];

  for (const [label, detail, code] of rejected) {
    const error = code === undefined
      ? postcheckError(detail)
      : postcheckError(detail, { code });
    const wait = await waitTimeoutEnvelope(error, `run-reject-${label.replace(/\W+/gu, "-")}`);
    assert.equal(
      Object.hasOwn(wait.slice_lifecycle, "postcheck_mismatch_field"), false,
      `run_wait timeout must omit the discriminator for ${label}`
    );

    assert.equal(wait.timed_out, true);
    assert.equal(wait.terminal, false);
    assert.equal(typeof wait.slice_lifecycle.error_code, "string");

    const serialized = JSON.stringify(wait);
    assert.equal(serialized.includes("secret.mjs"), false, label);
    assert.equal(serialized.includes("/abs/path"), false, label);
    assert.equal(serialized.includes("exploded"), false, label);
  }

  assert.equal(getterInvoked, false);
});

test("WK-1691#SLICE-002 the publication re-gate strips a discriminator outside the closed vocabulary", async () => {

  const terminal = {
    accepted: true,
    run_id: "run-1691-widened",
    monitor_handle: "wkmh_x",
    role: "worker",
    subject: "WK-1691#SLICE-002",
    status: "succeeded",
    terminal: true,
    started_at: "2026-07-22T00:00:00Z",
    updated_at: "2026-07-22T00:01:00Z"
  };
  const widenedValues = ["refsSnapshot", "ORIG_HEAD", "", 7, null, { name: "sliceRef" }];
  for (const widened of widenedValues) {
    const tools = createDispatchToolRegistry({
      backend: {
        getRunStatus: async () => terminal,
        runPostWorkerSliceLifecycle: async () => ({
          phase: "finalized",
          integrated: true,
          postcheck_mismatch_field: widened
        })
      }
    });
    const status = parseStructuredTextResponse(
      await tools.get("workspace_agent_run_status").handler({ monitor_handle: "wkmh_x" })
    );
    assert.equal(
      Object.hasOwn(status.slice_lifecycle, "postcheck_mismatch_field"), false,
      `a widened producer value ${JSON.stringify(widened)} must never be published`
    );

    assert.equal(status.slice_lifecycle.phase, "finalized");
    assert.equal(status.slice_lifecycle.integrated, true);
  }

  const tools = createDispatchToolRegistry({
    backend: {
      getRunStatus: async () => terminal,
      runPostWorkerSliceLifecycle: async () => ({
        phase: "finalized",
        integrated: true,
        postcheck_mismatch_field: "reviewedTree"
      })
    }
  });
  const passed = parseStructuredTextResponse(
    await tools.get("workspace_agent_run_status").handler({ monitor_handle: "wkmh_x" })
  );
  assert.equal(passed.slice_lifecycle.postcheck_mismatch_field, "reviewedTree");
});

test("WK-1691#SLICE-002 the reconstruction seam omits unsafe detail just like the catch seams", async () => {
  const terminal = {
    accepted: true,
    run_id: "run-1691-b",
    monitor_handle: "wkmh_x",
    role: "worker",
    subject: "WK-1691#SLICE-002",
    status: "succeeded",
    terminal: true,
    started_at: "2026-07-22T00:00:00Z",
    updated_at: "2026-07-22T00:01:00Z"
  };
  const tools = createDispatchToolRegistry({
    backend: {
      getRunStatus: async () => terminal,
      runPostWorkerSliceLifecycle: async () => {
        throw postcheckError({ status: " M packages/wiki-mcp/src/secret.mjs" });
      }
    }
  });
  const status = parseStructuredTextResponse(
    await tools.get("workspace_agent_run_status").handler({ monitor_handle: "wkmh_x" })
  );
  assert.equal(Object.hasOwn(status.slice_lifecycle, "postcheck_mismatch_field"), false);
  assert.equal(JSON.stringify(status).includes("secret.mjs"), false);
});

function registerStandaloneRedteamDispatchFixture(t, { slice, slices, recordId = "WK-9733", subjectSliceId = "SLICE-001" } = {}) {
  const repo = mkdtempSync(path.join(tmpdir(), "wk1725-registered-"));
  const worktrees = mkdtempSync(path.join(tmpdir(), "wk1725-registered-wt-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  t.after(() => rmSync(worktrees, { recursive: true, force: true }));
  mkdirSync(path.join(repo, "wiki", "work-records"), { recursive: true });
  const subject = `${recordId}#${subjectSliceId}`;
  writeFileSync(path.join(repo, "wiki", "work-records", `${recordId}.json`), JSON.stringify({
    id: recordId,
    initiative: "IN-0030",
    status: "todo",
    acceptance: {
      criteria: ["Adversarially review the standalone unit."],
      validation: ["node --test packages/wiki-mcp/src/lib/dispatch-tools-slice-lifecycle.test.mjs"]
    },
    slices: slices ?? [slice ?? {
      id: "SLICE-001",
      title: "Standalone findings-only redteam",
      work_kind: "redteam",
      status: "todo",
      write_scope: [],
      dispatch_intent: { intended_agent_role: "redteam", target_unit: "slice" },
      acceptance: { criteria: ["Report adversarial findings; modify nothing."] }
    }]
  }));

  const executorInputs = [];
  let recoveryCalls = 0;
  const backend = createWorkspaceAgentDispatchBackend({
    launchExecutor: async (input) => {
      executorInputs.push({ role: input.role, subject: input.subject, workspace_dir: input.workspace_dir });
      return { accepted: true, status: "launching" };
    },
    worktreeProvisioning: { mainRepo: repo, worktreeRoot: worktrees },

    recoverTerminalCandidate: async () => { recoveryCalls += 1; return null; }
  });

  const tools = new Map();
  registerDispatchTools({
    registerTool: (name, config, handler) => tools.set(name, { config, handler }),
    registeredToolNames: new Set(["workspace_agent_dispatch"]),
    workspaceRepos: [{ repo: "agent-chassis", dir: repo }],
    z,
    jsonContent: (value) => value,
    errorContent: (value) => value,
    resolveWorkspaceRepo: () => ({ repo: "agent-chassis", dir: repo }),
    validateDispatch: async () => ({
      schema_version: "dispatch-readiness.v1",
      record_id: recordId,
      unit: { kind: "slice", address: subject, record_id: recordId, slice_id: "SLICE-001" },
      dispatch_role: "read_only",
      dispatchable: true,
      decision_code: "dispatchable",
      reasons: [],
      recovery: { graph_impact: "not_required", admission_metrics: "fresh", target_resolution: "fresh" },
      state: { graph_state: {}, graph_auto_recoverable: false },
      validation_hints: []
    }),
    dispatchBackend: backend,
    dispatchSessionIdentity: "session-wk1725-registered"
  });

  return {
    repo,
    subject,
    executorInputs,
    recoveryCalls: () => recoveryCalls,
    dispatch: (role = "redteam") =>
      tools.get("workspace_agent_dispatch").handler({ role, subject, app: "codex" })
  };
}

test("WK-1725#SLICE-001 the registered dispatch handler launches a standalone redteam through the generic route with zero terminal recovery", async (t) => {
  const fixture = registerStandaloneRedteamDispatchFixture(t);
  const result = await fixture.dispatch("redteam");
  assert.equal(result.accepted, true, JSON.stringify(result));
  assert.equal(result.role, "redteam");
  assert.equal(result.subject, fixture.subject);
  assert.equal(fixture.executorInputs.length, 1, "the registered handler reaches the family executor exactly once");
  assert.equal(fixture.executorInputs[0].role, "redteam");
  assert.equal(fixture.executorInputs[0].workspace_dir, fixture.repo);
  assert.equal(fixture.recoveryCalls(), 0, "a registered standalone redteam must never invoke terminal-candidate recovery");
});

test("WK-1725#SLICE-001 registered dispatch readiness and backend admission agree: repeated standalone redteam attempts are never singleton-blocked", async (t) => {
  const fixture = registerStandaloneRedteamDispatchFixture(t);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await fixture.dispatch("redteam");
    assert.equal(result.accepted, true, `attempt ${attempt}: ${JSON.stringify(result)}`);
  }
  assert.equal(fixture.executorInputs.length, 3, "every registered standalone redteam attempt reaches the executor");
  assert.equal(fixture.recoveryCalls(), 0);
});

test("WK-1725#SLICE-001 the registered seam routes a standalone redteam generically even when a terminal unit exists elsewhere", async (t) => {

  const fixture = registerStandaloneRedteamDispatchFixture(t, {
    recordId: "WK-9744",
    subjectSliceId: "SLICE-001",
    slices: [
      {
        id: "SLICE-001",
        title: "Standalone findings-only redteam",
        work_kind: "redteam",
        status: "todo",
        write_scope: [],
        dispatch_intent: { intended_agent_role: "redteam", target_unit: "slice" },
        acceptance: { criteria: ["Report adversarial findings; modify nothing."] }
      },
      {
        id: "SLICE-050",
        title: "implementation",
        work_kind: "implementation",
        status: "review",
        write_scope: ["feature.txt"]
      },
      {
        id: "SLICE-099",
        title: "Terminal whole-WK review",
        work_kind: "review",
        review_purpose: "terminal_whole_wk",
        status: "todo",
        write_scope: [],
        dispatch_intent: { intended_agent_role: "reviewer", target_unit: "slice" },
        acceptance: { criteria: ["Findings-only review of C against L."] }
      }
    ]
  });
  const result = await fixture.dispatch("redteam");
  assert.equal(result.accepted, true, JSON.stringify(result));
  assert.equal(result.role, "redteam");
  assert.equal(result.subject, fixture.subject);
  assert.equal(fixture.executorInputs.length, 1, "the standalone redteam reaches the family executor exactly once");
  assert.equal(fixture.executorInputs[0].workspace_dir, fixture.repo);
  assert.equal(
    fixture.recoveryCalls(),
    0,
    "a terminal unit elsewhere must not drag the registered standalone redteam into terminal recovery"
  );
});
