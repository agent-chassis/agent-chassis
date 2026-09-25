import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";

import {
  assessManagedRunProcessIdentity,
  bindManagedRunSandboxProcessIdentity,
  deriveOuterSandboxKillShape,
  publishPendingManagedRunProcessIdentity
} from "@agent-chassis/agent-launch-cli/src/lib/managed-run-process-identity.mjs";
import { AUTHENTICATED_INTEGRATION_CONTINUATION } from
  "@agent-chassis/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-integration.mjs";

import {
  SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES,
  SLICE_REVIEW_POSTCHECK_STATE_BUDGET
} from "@agent-chassis/agent-launch-cli/src/lib/slice-review-materialization.mjs";
import {
  buildDispatchToolExceptionDetail,
  DISPATCH_TOOL_EXCEPTION_EVIDENCE_SCHEMA_VERSION,
  SAFE_POSTCHECK_MISMATCH_FIELDS,
  SLICE_REVIEW_POSTCHECK_FAILED_CODE
} from "./dispatch-tool-helpers.mjs";

import { runPostWorkerSliceLifecycle } from "./dispatch-run-monitor-routes.mjs";
import { POST_WORKER_MISSING_DELIVERY_CODE } from "./dispatch-post-worker-lifecycle-run.mjs";
import {
  createLifecycleCheckpoint,
  POST_WORKER_LIFECYCLE_CHECKPOINT
} from "./dispatch-post-worker-lifecycle-bindings.mjs";
import {
  createDispatchToolRegistry,
  createResumableLifecycleHarness,
  readStructuredResult
} from "./dispatch-tools-test-helpers.mjs";

import {
  postcheckError,
  provenDeathDeps
} from "./dispatch-tools-slice-lifecycle-test-support.mjs";

const WORKSPACE = Object.freeze({ repo: "agent-chassis", dir: "/home/user/agent-chassis" });
const NO_CALLS = Object.freeze({ integrationCalls: 0, reviewSeamCalls: 0 });

function unadvancedSliceGit(harness) {
  const base = "a".repeat(40);
  return (args) => (args.args[0] === "rev-parse" && String(args.args.at(-1)).includes("slice/")
    ? { ok: true, stdout: `${base}\n` }
    : harness.deps.runGit(args));
}

test("committed-slice worker recovery remains inactive without a durable identity store", async () => {
  const harness = createResumableLifecycleHarness();
  const result = await runPostWorkerSliceLifecycle({
    workspace: WORKSPACE,
    status: { ...harness.status },
    deps: { ...harness.deps, recoveryOnly: true }
  });
  assert.equal(result, null);
  assert.deepEqual(harness.counts(), NO_CALLS);
});

test("WK-1694#SLICE-002 proven death never resumes a slice that produced no commit, and retires it instead", async () => {

  const harness = createResumableLifecycleHarness();
  const base = "a".repeat(40);
  const retirements = [];
  const { deps, seen } = provenDeathDeps(
    {
      ...harness.deps,
      runGit: unadvancedSliceGit(harness),
      retireManagedWorkerIdentity: async (request) => {
        retirements.push(request);
        return { retired: true };
      }
    },
    () => ({ proven_dead: true, verdict: "proven_dead" })
  );
  const result = await runPostWorkerSliceLifecycle({
    workspace: WORKSPACE,
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
  assert.deepEqual(harness.counts(), NO_CALLS);
});

test("WK-1694#SLICE-002 an attempt that is NOT proven dead is never retired, however empty its slice ref", async () => {

  for (const verdict of ["live", "partial", "unreadable", "ambiguous", "unresolved", "retired"]) {
    const harness = createResumableLifecycleHarness();
    const retirements = [];
    const { deps } = provenDeathDeps(
      {
        ...harness.deps,
        runGit: unadvancedSliceGit(harness),
        retireManagedWorkerIdentity: async (request) => { retirements.push(request); return { retired: true }; }
      },
      () => ({ proven_dead: false, verdict })
    );
    const result = await runPostWorkerSliceLifecycle({
      workspace: WORKSPACE,
      status: { ...harness.status },
      deps: { ...deps, recoveryOnly: true }
    });
    assert.equal(result, null, verdict);
    assert.deepEqual(retirements, [], verdict);
  }
});

test("WK-1713#SLICE-001 a fresh terminal worker without a committed delivery fails closed with the retryable missing-delivery code", async () => {
  const harness = createResumableLifecycleHarness();
  const retirements = [];
  const { deps } = provenDeathDeps(
    {
      ...harness.deps,
      runGit: unadvancedSliceGit(harness),
      retireManagedWorkerIdentity: async (request) => { retirements.push(request); return { retired: true }; }
    },
    () => ({ proven_dead: false, verdict: "live" })
  );
  await assert.rejects(
    runPostWorkerSliceLifecycle({ workspace: WORKSPACE, status: { ...harness.status }, deps }),
    (error) => {
      assert.equal(error.code, POST_WORKER_MISSING_DELIVERY_CODE);
      assert.deepEqual(error.detail, {
        subject: "WK-1537#SLICE-001",
        slice_ref: harness.sliceRef,
        base_sha: "a".repeat(40),
        slice_tip_sha: "a".repeat(40),

        retirement_unavailable: {
          worker_tuple: {
            assigned_unit: "WK-1537#SLICE-001",
            launch_ref: harness.status.monitor_handle,
            run_id: harness.status.run_id,
            retry_id: 0
          },
          death_resolver_composed: true,
          death_verdict: { proven_dead: false, verdict: "live" },
          retirement_composed: true
        }
      });
      return true;
    }
  );
  assert.deepEqual(retirements, []);
  assert.deepEqual(harness.counts(), NO_CALLS);
});

test("WK-1713#SLICE-001 a fresh proven-dead terminal worker without a committed delivery is retired, not integrated", async () => {
  const harness = createResumableLifecycleHarness();
  const retirements = [];
  const { deps } = provenDeathDeps(
    {
      ...harness.deps,
      runGit: unadvancedSliceGit(harness),
      retireManagedWorkerIdentity: async (request) => { retirements.push(request); return { retired: true }; }
    },
    () => ({ proven_dead: true, verdict: "proven_dead" })
  );
  const result = await runPostWorkerSliceLifecycle({
    workspace: WORKSPACE,
    status: { ...harness.status },
    deps
  });
  assert.equal(result.phase, "finalized");
  assert.equal(result.integrated, false);
  assert.equal(result.retired, true);
  assert.equal(result.retirement_reason, "no_commit_base_equal");
  assert.equal(retirements.length, 1);
  assert.deepEqual(harness.counts(), NO_CALLS);

  const refusing = createResumableLifecycleHarness();
  const { deps: refusingDeps } = provenDeathDeps(
    {
      ...refusing.deps,
      runGit: unadvancedSliceGit(refusing),
      retireManagedWorkerIdentity: async () => ({ retired: false, code: "injected_refusal" })
    },
    () => ({ proven_dead: true, verdict: "proven_dead" })
  );
  await assert.rejects(
    runPostWorkerSliceLifecycle({ workspace: WORKSPACE, status: { ...refusing.status }, deps: refusingDeps }),
    { code: "agent_launch.managed_run_process_identity.recovery_retirement_refused.v1" }
  );
  assert.deepEqual(refusing.counts(), NO_CALLS);
});

test("WK-1694#SLICE-002 a finalized integration retires the attempt with the exact worker tuple", async () => {

  const harness = createResumableLifecycleHarness();
  const retirements = [];
  const finalized = await runPostWorkerSliceLifecycle({
    workspace: WORKSPACE,
    status: { ...harness.status },
    deps: {
      ...harness.deps,
      retireManagedWorkerIdentity: async (request) => { retirements.push(request); return { retired: true }; }
    }
  });
  assert.equal(finalized.phase, "finalized");
  assert.equal(finalized.integrated, true);
  assert.equal(finalized.cleanup_pending, false);
  assert.deepEqual(finalized.cleanup, {
    state: "complete",
    integration_cleanup_state: null,
    managed_identity_retirement: { state: "complete", retired: true, code: null }
  });
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
  assert.deepEqual(retirements[0].evidence, {
    slice_ref: harness.integrationResult.slice_ref,
    integrated_sha: harness.integrationResult.wk_sha
  });
  assert.deepEqual(harness.counts(), { integrationCalls: 1, reviewSeamCalls: 0 });
});

test("a finalized integration whose identity retirement is pending finishes cleanup on a later poll without reintegration", async () => {
  const harness = createResumableLifecycleHarness();
  const checkpoint = createLifecycleCheckpoint();
  const status = { ...harness.status, [POST_WORKER_LIFECYCLE_CHECKPOINT]: checkpoint };
  let retire = async () => { throw Object.assign(new Error("store busy"), { code: "injected_store_busy" }); };
  const deps = { ...harness.deps, retireManagedWorkerIdentity: (request) => retire(request) };

  const pending = await runPostWorkerSliceLifecycle({ workspace: WORKSPACE, status, deps });
  assert.equal(pending.phase, "finalized");
  assert.equal(pending.cleanup_pending, true);
  const { evidence, ...retirement } = pending.cleanup.managed_identity_retirement;
  assert.deepEqual(retirement, { state: "pending", retired: false, code: "injected_store_busy" });

  assert.equal(evidence.operation, "delivery_finalization:managed_worker_identity_retirement");
  assert.equal(evidence.thrown.value.message, "store busy");
  assert.equal(evidence.thrown.value.properties.code, "injected_store_busy");

  retire = async () => ({ retired: true });
  const completed = await runPostWorkerSliceLifecycle({ workspace: WORKSPACE, status, deps });
  assert.equal(completed.phase, "finalized");
  assert.equal(completed.cleanup_pending, false);
  assert.equal(completed.cleanup.state, "complete");
  assert.deepEqual(completed.integration, pending.integration);
  assert.deepEqual(harness.counts(), { integrationCalls: 1, reviewSeamCalls: 0 });

  const replay = await runPostWorkerSliceLifecycle({ workspace: WORKSPACE, status, deps });
  assert.equal(replay, completed, "a completed finalization replays the recorded result");
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
    deps: { ...harness.deps, resolveManagedWorkerProvenDeath, recoveryOnly: true }
  });

  assert.equal(lookups.length, 0);
  assert.equal(recovered, null);
  assert.deepEqual(harness.counts(), NO_CALLS);

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

  const harness = createResumableLifecycleHarness({ integrationFailures: 1 });
  const retirements = [];
  const checkpoint = createLifecycleCheckpoint();
  const status = { ...harness.status, [POST_WORKER_LIFECYCLE_CHECKPOINT]: checkpoint };
  const deps = {
    ...harness.deps,
    retireManagedWorkerIdentity: async (request) => { retirements.push(request); return { retired: true }; }
  };
  await assert.rejects(
    runPostWorkerSliceLifecycle({ workspace: WORKSPACE, status, deps }),
    { code: "agent_launch.slice_lifecycle.committed_slice_integration_failed.v1" }
  );
  assert.equal(checkpoint.phase, "pre-integration");
  assert.equal(checkpoint.integration, null);
  assert.deepEqual(retirements, []);
  assert.deepEqual(harness.counts(), { integrationCalls: 1, reviewSeamCalls: 0 });
});

test("final_result:null cannot turn committed worker recovery into integration authority", async () => {
  const harness = createResumableLifecycleHarness();
  const status = { ...harness.status, recovered: true, final_result: null, exit: null };

  const recovered = await runPostWorkerSliceLifecycle({
    workspace: WORKSPACE,
    status,
    deps: { ...harness.deps, recoveryOnly: true }
  });
  assert.equal(recovered, null);
  assert.deepEqual(harness.counts(), NO_CALLS);
});

function retriedContinuationFixture(integrationOverrides = {}, continuationOverrides = {}) {
  const harness = createResumableLifecycleHarness();
  const checkpoint = createLifecycleCheckpoint();
  checkpoint.failure_attempts = 1;
  const status = { ...harness.status, [POST_WORKER_LIFECYCLE_CHECKPOINT]: checkpoint };
  const requests = [];
  const continuation = {
    [AUTHENTICATED_INTEGRATION_CONTINUATION]: true,
    completed: true,
    reviewed_sha: harness.reviewedSha,
    integration: {
      ...harness.integrationResult,
      delivery_sha: harness.reviewedSha,
      integrated_state: "final",
      ...integrationOverrides
    },
    ...continuationOverrides
  };
  const deps = {
    ...harness.deps,
    resolveCommittedSliceIntegrationContinuation: (request) => {
      requests.push(request);
      return continuation;
    }
  };

  harness.setCanonicalStatus("review");
  return { harness, checkpoint, status, deps, requests, continuation };
}

test("a retried attempt installs a matching authenticated integration continuation without another request", async () => {
  const { harness, status, deps, requests, continuation } = retriedContinuationFixture();
  const finalized = await runPostWorkerSliceLifecycle({ workspace: WORKSPACE, status, deps });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].subject, "WK-1537#SLICE-001");
  assert.equal(requests[0].live_completion_only, true);
  assert.equal(finalized.phase, "finalized");
  assert.equal(finalized.integrated, true);
  assert.equal(finalized.wk_transitioned_to_review, true);
  assert.equal(finalized.integration, continuation.integration);
  assert.equal(Object.hasOwn(finalized, "reviewer_dispatch"), false);
  assert.deepEqual(harness.counts(), NO_CALLS);
});

test("a retried attempt refuses an authenticated integration continuation for a different target", async () => {
  for (const [integrationOverrides, continuationOverrides, field] of [
    [{}, { reviewed_sha: "c".repeat(40) }, "continuation_reviewed_sha"],
    [{ delivery_sha: "c".repeat(40) }, {}, "delivery_sha"],
    [{ slice_ref: "refs/heads/slice/IN-0021/WK-1537/SLICE-002" }, {}, "slice_ref"],
    [{ wk_ref: "refs/heads/wk/IN-0021/WK-9999" }, {}, "wk_ref"],
    [{ integrated_state: "non_final" }, {}, "non_final_with_whole_wk_review_target"],
    [{ integrated_state: undefined }, {}, "integrated_state"]
  ]) {
    const { harness, checkpoint, status, deps } =
      retriedContinuationFixture(integrationOverrides, continuationOverrides);
    await assert.rejects(
      runPostWorkerSliceLifecycle({ workspace: WORKSPACE, status, deps }),
      (error) => {
        assert.equal(error.code, "agent_launch.slice_lifecycle.integration_continuation_mismatch.v1", field);
        assert.ok(error.detail.mismatched_fields.includes(field), `${field}: ${error.detail.mismatched_fields}`);
        return true;
      }
    );
    assert.equal(checkpoint.phase, "pre-integration", field);
    assert.equal(checkpoint.integration, null, field);
    assert.deepEqual(harness.counts(), NO_CALLS, field);
  }
});

test("a retried attempt without a completed continuation re-requests integration and finalizes", async () => {
  const harness = createResumableLifecycleHarness({ integrationFailures: 1 });
  const checkpoint = createLifecycleCheckpoint();
  const status = { ...harness.status, [POST_WORKER_LIFECYCLE_CHECKPOINT]: checkpoint };
  await assert.rejects(runPostWorkerSliceLifecycle({ workspace: WORKSPACE, status, deps: harness.deps }));

  checkpoint.failure_attempts = 1;
  const finalized = await runPostWorkerSliceLifecycle({ workspace: WORKSPACE, status, deps: harness.deps });
  assert.equal(finalized.phase, "finalized");
  assert.equal(finalized.integrated, true);
  assert.deepEqual(finalized.integration, harness.integrationResult);
  assert.deepEqual(harness.counts(), { integrationCalls: 2, reviewSeamCalls: 0 });
});

async function runStatusEnvelope(error) {
  const tools = createDispatchToolRegistry({
    backend: { getRunStatus: async () => { throw error; } }
  });
  return readStructuredResult(
    await tools.get("workspace_agent_run_status").handler({ subject: "WK-1691#SLICE-002" })
  );
}

async function runWaitEnvelope(error) {
  const tools = createDispatchToolRegistry({
    backend: { waitForRunStatus: async () => { throw error; } }
  });
  return readStructuredResult(
    await tools.get("workspace_agent_run_status").handler({
      subject: "WK-1691#SLICE-002",
      timeout_ms: 1
    })
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
    assert.equal(wait.blocker.reason, "run_status_tool_exception");
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
      `bounded run_status must omit the discriminator for ${label}`
    );
  }

  assert.equal(getterInvoked, true);
  const captured = await runStatusEnvelope(postcheckError(getterDetail));
  assert.equal(Object.hasOwn(captured.blocker.detail, "postcheck_mismatch_field"), false);
  assert.equal(captured.blocker.detail.evidence.thrown.value.properties.detail.field, "sliceRef");
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
    "tool", "error_name", "error_message", "error_message_redactions", "evidence"
  ]);
  assert.equal(ordinary.evidence.schema_version, DISPATCH_TOOL_EXCEPTION_EVIDENCE_SCHEMA_VERSION);
  assert.equal(ordinary.evidence.operation, "t");
  assert.equal(ordinary.evidence.thrown.value.name, "Error");
  assert.equal(ordinary.evidence.thrown.value.message, "boom");

  const safeError = postcheckError({ field: "baseTree" });
  const safe = buildDispatchToolExceptionDetail("t", safeError);
  assert.deepEqual(Object.keys(safe), [
    "tool", "error_name", "error_message", "error_message_redactions",
    "cause_code", "postcheck_mismatch_field", "evidence"
  ]);
  assert.equal(safe.cause_code, SLICE_REVIEW_POSTCHECK_FAILED_CODE);
  assert.equal(safe.postcheck_mismatch_field, "baseTree");
  assert.equal(safe.evidence.thrown.value.message, safeError.message);
  assert.equal(safe.evidence.thrown.value.properties.code, SLICE_REVIEW_POSTCHECK_FAILED_CODE);
  assert.equal(safe.evidence.thrown.value.properties.detail.field, "baseTree");

  const long = postcheckError({ field: "gitDir" });
  long.message = "x".repeat(5000);
  const complete = buildDispatchToolExceptionDetail("t", long);
  assert.equal(complete.error_message, long.message);
  assert.deepEqual(complete.error_message_redactions, []);
  assert.equal(Object.hasOwn(complete, "error_message_truncated"), false);
  assert.equal(complete.postcheck_mismatch_field, "gitDir");

  const pathy = postcheckError({ field: "canonicalWorktreePath" });
  pathy.message = "/home/user/agent-chassis/wiki/secret.json is bad";
  const plain = new Error(pathy.message);
  assert.equal(buildDispatchToolExceptionDetail("t", pathy).error_message,
    buildDispatchToolExceptionDetail("t", plain).error_message);
  assert.equal(buildDispatchToolExceptionDetail("t", pathy).postcheck_mismatch_field, "canonicalWorktreePath");
});
