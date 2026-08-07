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
  postcheckError,
  provenDeathDeps,
  withSliceReviewPreparation
} from "./dispatch-tools-slice-lifecycle-test-support.mjs";

test("committed-slice worker recovery remains inactive without a durable identity store", async () => {
  const workspace = { repo: "agent-chassis", dir: "/home/user/agent-chassis" };
  const harness = createResumableLifecycleHarness();
  const result = await runPostWorkerSliceLifecycle({
    workspace,
    status: { ...harness.status },
    deps: { ...withSliceReviewPreparation(harness.deps), recoveryOnly: true }
  });
  assert.equal(result, null);
  assert.deepEqual(harness.counts(), { integrationCalls: 0, bindCalls: 0 });
});

test("WK-1694#SLICE-002 proven death never resumes a slice that produced no commit, and retires it instead", async () => {

  const workspace = { repo: "agent-chassis", dir: "/home/user/agent-chassis" };
  const harness = createResumableLifecycleHarness();
  const base = "a".repeat(40);
  const retirements = [];
  const { deps, seen } = provenDeathDeps(
    {
      ...harness.deps,
      runGit: (args) => (args.args[0] === "rev-parse" && String(args.args.at(-1)).includes("slice/")
        ? { ok: true, stdout: `${base}\n` }
        : harness.deps.runGit(args)),
      retireManagedWorkerIdentity: async (request) => {
        retirements.push(request);
        return { retired: true };
      }
    },
    () => ({ proven_dead: true, verdict: "proven_dead" })
  );
  const result = await runPostWorkerSliceLifecycle({
    workspace,
    status: { ...harness.status },
    deps: { ...deps, recoveryOnly: true }
  });
  assert.deepEqual(result, {
    invoked: true,
    phase: "finalized",
    integrated: false,
    integration: null,
    recovered_from_proven_death: true,
    retired: true,
    retirement_reason: "no_commit_base_equal"
  });
  assert.deepEqual(seen, [{
    assigned_unit: "WK-1537#SLICE-001",
    launch_ref: harness.status.monitor_handle,
    run_id: harness.status.run_id,
    retry_id: 0
  }]);
  assert.equal(retirements.length, 1);
  assert.equal(retirements[0].reason, "no_commit_base_equal");
  assert.equal(retirements[0].run_id, harness.status.run_id);

  assert.equal(retirements[0].evidence.slice_tip_sha, base);
  assert.equal(retirements[0].evidence.base_sha, base);
  assert.deepEqual(harness.counts(), { integrationCalls: 0, bindCalls: 0 });
  assert.deepEqual(harness.statusWrites, []);
});

test("WK-1694#SLICE-002 an attempt that is NOT proven dead is never retired, however empty its slice ref", async () => {

  const workspace = { repo: "agent-chassis", dir: "/home/user/agent-chassis" };
  const base = "a".repeat(40);
  for (const verdict of ["live", "partial", "unreadable", "ambiguous", "unresolved", "retired"]) {
    const harness = createResumableLifecycleHarness();
    const retirements = [];
    const { deps } = provenDeathDeps(
      {
        ...harness.deps,
        runGit: (args) => (args.args[0] === "rev-parse" && String(args.args.at(-1)).includes("slice/")
          ? { ok: true, stdout: `${base}\n` }
          : harness.deps.runGit(args)),
        retireManagedWorkerIdentity: async (request) => { retirements.push(request); return { retired: true }; }
      },
      () => ({ proven_dead: false, verdict })
    );
    const result = await runPostWorkerSliceLifecycle({
      workspace,
      status: { ...harness.status },
      deps: { ...deps, recoveryOnly: true }
    });
    assert.equal(result, null, verdict);
    assert.deepEqual(retirements, [], verdict);
  }
});

test("WK-1694#SLICE-002 a finalized integration retires the attempt with the exact worker tuple", async () => {

  const workspace = { repo: "agent-chassis", dir: "/home/user/agent-chassis" };
  const harness = createResumableLifecycleHarness({ sliceReviewAccepted: true });
  const retirements = [];
  const finalized = await runPostWorkerSliceLifecycle({
    workspace,
    status: { ...harness.status },
    deps: {
      ...harness.deps,
      retireManagedWorkerIdentity: async (request) => { retirements.push(request); return { retired: true }; }
    }
  });
  assert.equal(finalized.phase, "finalized");
  assert.equal(finalized.integrated, true);
  assert.equal(retirements.length, 1);
  assert.deepEqual(
    { ...retirements[0], evidence: null, reason: null },
    {
      assigned_unit: "WK-1537#SLICE-001",
      launch_ref: harness.status.monitor_handle,
      run_id: harness.status.run_id,
      retry_id: 0,
      evidence: null,
      reason: null
    }
  );
  assert.equal(retirements[0].reason, "finalized_integration");
});

function realStoreDeps(repo, { procs, bootId = REAL_STORE_BOOT_ID }) {
  return {
    procAvailable: () => true,
    readBootId: () => bootId,
    readUptime: () => 1000,
    readProcStat: (pid) => {
      const starttime = procs[pid];
      if (starttime === undefined) return null;
      const tail = Array.from({ length: 30 }, (_, i) => String(i + 3));
      tail[0] = "S";
      tail[19] = String(starttime);
      return `${pid} (bwrap (managed) worker) ${tail.join(" ")}`;
    },
    sendSignal: () => assert.fail("recovery is observation-only and must never signal"),
    repo
  };
}

const REAL_STORE_BOOT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

test("a real retained worker identity is not consulted for a committed-slice recovery", async () => {
  const repo = mkdtempSync(path.join(tmpdir(), "wk1694-real-identity-"));
  const workspace = { repo: "agent-chassis", dir: "/home/user/agent-chassis" };
  const harness = createResumableLifecycleHarness();
  const sandboxPid = 424242;

  const publishDeps = realStoreDeps(repo, { procs: { [process.pid]: "555", [sandboxPid]: "777" } });
  const pending = publishPendingManagedRunProcessIdentity({
    mainRepo: repo,
    tuple: {
      assigned_unit: harness.status.subject,
      launch_ref: harness.status.monitor_handle,
      run_id: harness.status.run_id,
      retry_id: 0
    },
    role: "worker",
    deps: publishDeps
  });
  bindManagedRunSandboxProcessIdentity(pending, {
    pid: sandboxPid,
    killShape: deriveOuterSandboxKillShape({ pid: sandboxPid }),
    deps: publishDeps
  });

  const deadDeps = realStoreDeps(repo, { procs: {} });

  const lookups = [];
  const resolveManagedWorkerProvenDeath = (tuple) => {
    lookups.push(tuple);
    const assessed = assessManagedRunProcessIdentity({ mainRepo: repo, tuple, deps: deadDeps });
    return { ...assessed, proven_dead: assessed.verdict === "proven_dead" };
  };

  const recovered = await runPostWorkerSliceLifecycle({
    workspace,
    status: { ...harness.status, final_result: null },
    deps: { ...withSliceReviewPreparation(harness.deps), resolveManagedWorkerProvenDeath, recoveryOnly: true }
  });

  assert.equal(lookups.length, 0);
  assert.equal(recovered, null);
  assert.deepEqual(harness.counts(), { integrationCalls: 0, bindCalls: 0 });
  assert.deepEqual(harness.statusWrites, []);

  const mutated = assessManagedRunProcessIdentity({
    mainRepo: repo,
    tuple: {
      assigned_unit: harness.status.subject,
      launch_ref: harness.status.monitor_handle,
      run_id: `${harness.status.run_id}.slice`,
      retry_id: 0
    },
    deps: deadDeps
  });
  assert.equal(mutated.verdict, "absent");
  assert.notEqual(mutated.verdict, "proven_dead");

  rmSync(repo, { recursive: true, force: true });
});

test("WK-1694#SLICE-002 a lifecycle that has NOT finalized retires nothing", async () => {

  const workspace = { repo: "agent-chassis", dir: "/home/user/agent-chassis" };
  const harness = createResumableLifecycleHarness({ sliceReviewAccepted: false });
  const retirements = [];
  const parked = await runPostWorkerSliceLifecycle({
    workspace,
    status: { ...harness.status },
    deps: {
      ...harness.deps,
      retireManagedWorkerIdentity: async (request) => { retirements.push(request); return { retired: true }; }
    }
  });
  assert.equal(parked.phase, "awaiting-slice-review");
  assert.equal(parked.integrated, false);
  assert.deepEqual(retirements, []);
});

test("final_result:null cannot turn committed worker recovery into review authority", async () => {
  const workspace = { repo: "agent-chassis", dir: "/home/user/agent-chassis" };
  const harness = createResumableLifecycleHarness({ sliceReviewAccepted: false });
  const status = { ...harness.status, recovered: true, final_result: null, exit: null };

  const recovered = await runPostWorkerSliceLifecycle({
    workspace,
    status,
    deps: { ...harness.deps, recoveryOnly: true }
  });
  assert.equal(recovered, null);
  assert.deepEqual(harness.counts(), { integrationCalls: 0, bindCalls: 0 });
});

async function runStatusEnvelope(error) {
  const tools = createDispatchToolRegistry({
    backend: { getRunStatus: async () => { throw error; } }
  });
  return parseStructuredTextResponse(
    await tools.get("workspace_agent_run_status").handler({ monitor_handle: "wkmh_x" })
  );
}

async function runWaitEnvelope(error) {
  const tools = createDispatchToolRegistry({
    backend: { waitForRunStatus: async () => { throw error; } }
  });
  return parseStructuredTextResponse(
    await tools.get("workspace_agent_run_wait").handler({ monitor_handle: "wkmh_x" })
  );
}

test("WK-1691#SLICE-002 the public allowlist is pinned to the launcher's canonical bound-state budget", () => {

  assert.deepEqual(
    [...SAFE_POSTCHECK_MISMATCH_FIELDS].sort(),
    [...SLICE_REVIEW_POSTCHECK_STATE_BUDGET.bound_fields].sort()
  );
  assert.equal(
    SLICE_REVIEW_POSTCHECK_FAILED_CODE,
    SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.POSTCHECK_FAILED
  );
  assert.ok(Object.isFrozen(SAFE_POSTCHECK_MISMATCH_FIELDS));
});

test("WK-1691#SLICE-002 every enumerated bound field survives both public monitor routes", async () => {
  for (const field of SLICE_REVIEW_POSTCHECK_STATE_BUDGET.bound_fields) {
    const status = await runStatusEnvelope(postcheckError({ field }));
    assert.equal(status.accepted, false);
    assert.equal(status.blocker.reason, "run_status_tool_exception");
    assert.equal(status.blocker.detail.postcheck_mismatch_field, field);

    const wait = await runWaitEnvelope(postcheckError({ field }));
    assert.equal(wait.accepted, false);
    assert.equal(wait.blocker.reason, "run_wait_tool_exception");
    assert.equal(wait.blocker.detail.postcheck_mismatch_field, field);
  }
});

test("WK-1691#SLICE-002 unsafe detail shapes omit the discriminator entirely", async () => {
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
    ["array detail", ["sliceRef"]],
    ["array with field", Object.assign(["sliceRef"], { field: "sliceRef" })],
    ["null prototype", nullProto],
    ["class instance", new DetailBag()],
    ["accessor property", getterDetail],
    ["non-enumerable property", nonEnumerable],
    ["extra string key", { field: "sliceRef", stderr: "/abs/path exploded" }],
    ["extra symbol key", { field: "sliceRef", [Symbol("x")]: "leak" }],
    ["nested value", { field: { name: "sliceRef" } }],
    ["non-string value", { field: 7 }],
    ["unknown enum value", { field: "refsSnapshot" }],
    ["unbound classified state", { field: "ORIG_HEAD" }],
    ["wrong key name", { status: " M packages/secret.mjs" }],
    ["git invocation detail", { args: ["status"], status: 128, stderr: "fatal: /abs/path" }],
    ["empty detail", {}],
    ["null detail", null],
    ["string detail", "sliceRef"],
    ["absent detail", undefined]
  ];

  for (const [label, detail] of rejected) {
    const status = await runStatusEnvelope(postcheckError(detail));
    assert.equal(
      Object.hasOwn(status.blocker.detail, "postcheck_mismatch_field"), false,
      `run_status must omit the discriminator for ${label}`
    );
    const wait = await runWaitEnvelope(postcheckError(detail));
    assert.equal(
      Object.hasOwn(wait.blocker.detail, "postcheck_mismatch_field"), false,
      `run_wait must omit the discriminator for ${label}`
    );
  }

  assert.equal(getterInvoked, false);
});

test("WK-1691#SLICE-002 every unrelated error code omits the discriminator", async () => {
  const unrelated = Object.values(SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES)
    .filter((code) => code !== SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.POSTCHECK_FAILED);
  assert.ok(unrelated.length >= 8);
  for (const code of [...unrelated, "agent_launch.slice_lifecycle.failed.v1", undefined, null, 42]) {
    const envelope = await runStatusEnvelope(postcheckError({ field: "sliceRef" }, { code }));
    assert.equal(
      Object.hasOwn(envelope.blocker.detail, "postcheck_mismatch_field"), false,
      `code ${String(code)} must omit the discriminator`
    );
  }
});

test("WK-1691#SLICE-002 existing diagnostic envelopes stay byte-identical apart from the additive field", async () => {

  const ordinary = buildDispatchToolExceptionDetail("t", new Error("boom"));
  assert.deepEqual(Object.keys(ordinary), [
    "tool", "error_name", "error_message", "error_message_truncated"
  ]);

  const safe = buildDispatchToolExceptionDetail("t", postcheckError({ field: "baseTree" }));
  assert.deepEqual(Object.keys(safe), [
    "tool", "error_name", "error_message", "error_message_truncated", "postcheck_mismatch_field"
  ]);
  assert.equal(safe.postcheck_mismatch_field, "baseTree");

  const long = postcheckError({ field: "gitDir" });
  long.message = "x".repeat(5000);
  const bounded = buildDispatchToolExceptionDetail("t", long);
  assert.equal(bounded.error_message_truncated, true);
  assert.equal(bounded.error_message.length, 512);
  assert.equal(bounded.postcheck_mismatch_field, "gitDir");

  const pathy = postcheckError({ field: "canonicalWorktreePath" });
  pathy.message = "/home/user/agent-chassis/wiki/secret.json is bad";
  const redacted = buildDispatchToolExceptionDetail("t", pathy);
  assert.equal(redacted.error_message.includes("/home/user"), false);
  assert.equal(redacted.error_message.includes("secret.json"), false);
  assert.equal(redacted.postcheck_mismatch_field, "canonicalWorktreePath");
});
