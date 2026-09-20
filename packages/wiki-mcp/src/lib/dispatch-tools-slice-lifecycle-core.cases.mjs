import assert from "node:assert/strict";
import test from "node:test";

import {
  RUNTIME_BLOCKER_CODES
} from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";

import {
  LIFECYCLE_RESOLUTION_NEXT_ACTIONS,
  runPostWorkerSliceLifecycle
} from "./dispatch-run-monitor-routes.mjs";
import * as lifecycleExports from "./dispatch-post-worker-lifecycle.mjs";
import * as lifecycleRunExports from "./dispatch-post-worker-lifecycle-run.mjs";
import * as lifecyclePolicyExports from "./dispatch-post-worker-lifecycle-policy.mjs";
import * as launchRuntimeExports from "./dispatch-launch-runtime.mjs";
import * as monitorRouteExports from "./dispatch-run-monitor-routes.mjs";
import * as terminalReviewEvidenceExports from "./dispatch-terminal-review-evidence.mjs";
import { POST_WORKER_LIFECYCLE_PHASES } from "./dispatch-post-worker-lifecycle-bindings.mjs";
import {
  composePostWorkerSliceLifecycle,
  resolveLauncherOwnedLifecycleDeps
} from "./dispatch-launch-runtime.mjs";
import {
  createDispatchToolRegistry,
  createResumableLifecycleHarness,
  parseStructuredTextResponse,
  RETIRED_POST_WORKER_REVIEW_SEAMS
} from "./dispatch-tools-test-helpers.mjs";
import {
  CLOSED_LIFECYCLE_FAILURE_CODES,
  CLOSED_LIFECYCLE_FAILURE_SEAMS,
  isClosedLifecycleFailure
} from "./dispatch-lifecycle-failure-projection.mjs";

const WORKSPACE = Object.freeze({ repo: "agent-chassis", dir: "/home/user/agent-chassis" });

function assertNoReviewFields(label, result) {
  for (const field of [
    "slice_review",
    "reviewer_dispatch",
    "terminal_review_materialization",
    "terminal_review_policy",
    "empty_delivery"
  ]) {
    assert.equal(Object.hasOwn(result, field), false, `${label}: ${field} must be absent`);
  }
}

test("WK-2672 production composition pins launcher-owned preparation without supplying validation", async () => {
  const coordinator = {
    prepareTerminalCandidate: async () => {}
  };
  const owned = resolveLauncherOwnedLifecycleDeps({
    worktreeProvisioning: { mainRepo: "/repo", worktreeRoot: "/worktrees" },
    terminalCandidateCoordinator: coordinator
  });
  assert.equal(owned.prepareTerminalCandidate, coordinator.prepareTerminalCandidate);
  assert.equal(Object.hasOwn(owned, "validateTerminalCandidate"), false);
  assert.equal(Object.hasOwn(owned, "hostSliceReviewPreparationAdapter"), false);
  assert.equal(Object.hasOwn(owned, "reviewEnforcementMode"), false);

  let observed;
  const composed = composePostWorkerSliceLifecycle({
    worktreeProvisioning: { mainRepo: "/repo", worktreeRoot: "/worktrees" },
    terminalCandidateCoordinator: coordinator,
    lifecycle: async ({ deps }) => { observed = deps; return "ok"; }
  });
  const result = await composed({
    workspace: { dir: "/repo" },
    status: {},
    deps: {
      prepareTerminalCandidate: async () => {}
    }
  });
  assert.equal(result, "ok");
  assert.equal(observed.prepareTerminalCandidate, coordinator.prepareTerminalCandidate);
});

test("the launcher-owned composition installs the direct integration adapter as the host integration route", () => {
  const directSliceIntegrationAdapter = async () => null;
  const owned = resolveLauncherOwnedLifecycleDeps({
    worktreeProvisioning: { mainRepo: "/repo" },
    directSliceIntegrationAdapter
  });
  assert.deepEqual(Object.keys(owned), ["hostSliceIntegrationAdapter"]);
  assert.equal(owned.hostSliceIntegrationAdapter, directSliceIntegrationAdapter);

  assert.deepEqual(resolveLauncherOwnedLifecycleDeps({
    worktreeProvisioning: null,
    directSliceIntegrationAdapter
  }), {});
});

test("wiki-MCP exposes no retained-slice cleanup helper", () => {
  assert.equal(Object.hasOwn(lifecycleExports, "runRetainedSliceCleanupDisposition"), false);
  assert.equal(Object.hasOwn(monitorRouteExports, "runRetainedSliceCleanupDisposition"), false);
});

test("WK-2510 the post-worker lifecycle exposes no built-in review vocabulary or seam", async () => {
  assert.deepEqual(Object.values(POST_WORKER_LIFECYCLE_PHASES).sort(),
    ["finalized", "integrated", "pre-integration"]);
  assert.equal(Object.hasOwn(LIFECYCLE_RESOLUTION_NEXT_ACTIONS, "REQUEST_SLICE_INTEGRATION"), false);
  assert.equal(Object.hasOwn(CLOSED_LIFECYCLE_FAILURE_SEAMS, "FROZEN_REVIEW_CONTEXT_BINDING"), false);
  assert.equal(Object.hasOwn(CLOSED_LIFECYCLE_FAILURE_CODES, "FROZEN_REVIEW_CONTEXT_BINDING_FAILED"), false);
  for (const name of ["planReviewerClosure", "planTerminalWholeWkClosure"]) {
    assert.equal(Object.hasOwn(lifecycleRunExports, name), false, name);
  }
  assert.equal(typeof lifecycleRunExports.POST_WORKER_MISSING_DELIVERY_CODE, "string");
  for (const name of ["reconstructPolicyReviewTarget", "assertCanonicalReviewIdentity",
    "policyLifecycleError", "OID_RE"]) {
    assert.equal(Object.hasOwn(lifecyclePolicyExports, name), false, name);
  }
  assert.equal(Object.hasOwn(lifecyclePolicyExports.POLICY_LIFECYCLE_CODES, "CANONICAL_STATE_INVALID"), false);
  assert.deepEqual(Object.keys(terminalReviewEvidenceExports), ["verifyTerminalCandidateCycle"]);
  for (const name of ["resolveTerminalReviewEvidence", "TERMINAL_REVIEW_EVIDENCE_MODES",
    "LIFECYCLE_EXTERNAL_ACTION_NEXT_ACTIONS", "lifecycleResolutionRequiresExternalAction"]) {
    assert.equal(Object.hasOwn(monitorRouteExports, name), false, name);
  }
  for (const name of ["createDirectSliceReviewPreparationAdapter", "validateSliceReviewPreparationResult"]) {
    assert.equal(Object.hasOwn(launchRuntimeExports, name), false, name);
  }
  await assert.rejects(import("./dispatch-post-worker-lifecycle-review.mjs"), { code: "ERR_MODULE_NOT_FOUND" });
});

test("terminal worker monitoring invokes the trusted post-worker slice lifecycle once and exposes the integrated WK target", async () => {
  const calls = [];
  const frozen = {
    ref: "refs/heads/wk/IN-0021/WK-1537",
    sha: "b".repeat(40),
    diff_base_sha: "a".repeat(40),
    diff_head_sha: "b".repeat(40),
    complete_parent_wk_contract: true,
    accumulated_wk_diff: true
  };
  const terminal = {
    accepted: true,
    run_id: "run-worker",
    monitor_handle: "wkmh_worker",
    role: "worker",
    subject: "WK-1537#SLICE-001",
    status: "succeeded",
    terminal: true,
    started_at: "2026-07-12T00:00:00.000Z",
    updated_at: "2026-07-12T00:01:00.000Z"
  };
  const tools = createDispatchToolRegistry({
    backend: {
      getRunStatus: async () => ({ ...terminal }),
      runPostWorkerSliceLifecycle: async ({ workspace, status }) => {
        calls.push({ workspace, status });
        return {
          invoked: true,
          phase: "finalized",
          integrated: true,
          wk_transitioned_to_review: true,
          integration: { review_target: frozen }
        };
      },
      waitForRunStatus: async () => ({ ...terminal, timed_out: false })
    }
  });

  const first = parseStructuredTextResponse(await tools.get("workspace_agent_run_status").handler({
    subject: "WK-1537#SLICE-001"
  }));
  const second = parseStructuredTextResponse(await tools.get("workspace_agent_run_status").handler({
    subject: "WK-1537#SLICE-001",
    timeout_ms: 1000
  }));

  assert.equal(calls.length, 1, "one terminal worker run is integrated once per monitor lifecycle");
  assert.equal(calls[0].workspace.dir, "/home/user/agent-chassis");
  assert.deepEqual(first.slice_lifecycle.integration.review_target, frozen);
  assert.equal(first.slice_lifecycle.wk_transitioned_to_review, true);
  assertNoReviewFields("first", first.slice_lifecycle);
  assert.equal(first.terminal, true);
  assert.deepEqual(second.slice_lifecycle, first.slice_lifecycle);
});

test("a post-integration candidate preparation failure re-enters the same seam across immediate and bounded status without reintegration", async () => {
  const harness = createResumableLifecycleHarness({
    declaredTerminalReviewUnit: { record_id: "WK-1537", initiative: "IN-0021", subject: "WK-1537#SLICE-099" }
  });
  let prepareCalls = 0;
  harness.deps.prepareTerminalCandidate = async () => {
    prepareCalls += 1;
    throw new Error("injected terminal candidate preparation failure /secret/path");
  };
  const tools = createDispatchToolRegistry({
    backend: {
      getRunStatus: async () => harness.status,
      waitForRunStatus: async () => harness.status,
      runPostWorkerSliceLifecycle: harness.invoke
    }
  });

  const failed = parseStructuredTextResponse(await tools.get("workspace_agent_run_status").handler({
    subject: harness.status.subject
  }));
  assert.equal(failed.terminal, false);
  assert.equal(failed.slice_lifecycle.phase, "integrated");
  assert.equal(failed.slice_lifecycle.integrated, true);
  assert.equal(
    failed.slice_lifecycle.error_code,
    CLOSED_LIFECYCLE_FAILURE_CODES.TERMINAL_CANDIDATE_PREPARATION_FAILED
  );
  assert.deepEqual(failed.slice_lifecycle.integration, harness.integrationResult);

  assert.equal(failed.slice_lifecycle.evidence.thrown.value.message,
    "injected terminal candidate preparation failure /secret/path");
  assert.deepEqual(harness.counts(), { integrationCalls: 1, declaredUnitCalls: 1, reviewSeamCalls: 0 });
  assert.equal(prepareCalls, 1);

  const retried = parseStructuredTextResponse(await tools.get("workspace_agent_run_status").handler({
    subject: harness.status.subject
  }));
  assert.equal(retried.terminal, false);
  assert.equal(retried.lifecycle_resolution.phase, "integrated");
  assert.equal(retried.lifecycle_resolution.failure_attempts, 2);
  assert.equal(prepareCalls, 2);

  const bounded = parseStructuredTextResponse(await tools.get("workspace_agent_run_status").handler({
    subject: harness.status.subject,
    timeout_ms: 300
  }));
  assert.equal(bounded.terminal, false);
  assert.equal(bounded.child_terminal, true);
  assert.equal(bounded.lifecycle_resolution.phase, "integrated");
  assert.equal(bounded.lifecycle_resolution.failure_attempts, prepareCalls);
  assert.equal(bounded.next_action, "retry_wait_or_check_status");
  assert.equal(harness.counts().integrationCalls, 1, "the integrated phase is never re-integrated");
  assert.equal(harness.counts().reviewSeamCalls, 0);
});

test("concurrent immediate and bounded status polling share one phased post-worker lifecycle", async () => {
  let releaseIntegration;
  const integrationGate = new Promise((resolve) => { releaseIntegration = resolve; });
  const harness = createResumableLifecycleHarness({ integrationGate });
  const tools = createDispatchToolRegistry({
    backend: {
      getRunStatus: async () => ({ ...harness.status }),
      waitForRunStatus: async () => ({ ...harness.status }),
      runPostWorkerSliceLifecycle: ({ workspace, status }) =>
        runPostWorkerSliceLifecycle({ workspace, status, deps: harness.deps })
    }
  });

  const statusPromise = tools.get("workspace_agent_run_status").handler({
    subject: harness.status.subject
  });
  const waitPromise = tools.get("workspace_agent_run_status").handler({
    subject: harness.status.subject,
    timeout_ms: 1000
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.counts().integrationCalls, 1);
  releaseIntegration();
  const [statusResult, waitResult] = await Promise.all([statusPromise, waitPromise]);
  const first = parseStructuredTextResponse(statusResult);
  const second = parseStructuredTextResponse(waitResult);
  assert.equal(first.slice_lifecycle.phase, "finalized");
  assertNoReviewFields("concurrent", first.slice_lifecycle);
  assert.deepEqual(second.slice_lifecycle, first.slice_lifecycle);
  assert.deepEqual(harness.counts(), { integrationCalls: 1, declaredUnitCalls: 0, reviewSeamCalls: 0 });
});

test("process-local checkpoint loss after a lost integration response recovers only from canonical review and the exact marker", async () => {
  const harness = createResumableLifecycleHarness();
  const trustedAdapter = harness.deps.hostSliceIntegrationAdapter;
  let adapterCalls = 0;

  const deps = {
    ...harness.deps,
    hostSliceIntegrationAdapter: async (request) => {
      adapterCalls += 1;
      const answer = await trustedAdapter(request);
      return adapterCalls === 1
        ? { accepted: false, refusal: { code: "injected_lost_response" } }
        : answer;
    }
  };
  await assert.rejects(
    runPostWorkerSliceLifecycle({ workspace: WORKSPACE, status: { ...harness.status }, deps }),
    (error) => {

      assert.equal(isClosedLifecycleFailure(error), true);
      assert.equal(error.code, CLOSED_LIFECYCLE_FAILURE_CODES.COMMITTED_SLICE_INTEGRATION_FAILED);
      assert.equal(error.failure_cause.kind, "integration_refusal");
      assert.equal(error.failure_cause.diagnostic_code, null);

      assert.equal(error.evidence.thrown.value.properties.detail.integration_refusal.code,
        "injected_lost_response");
      return true;
    }
  );
  assert.equal(harness.counts().integrationCalls, 1);

  const recovered = await runPostWorkerSliceLifecycle({
    workspace: WORKSPACE,
    status: { ...harness.status },
    deps
  });
  assert.equal(recovered.phase, "finalized");
  assert.equal(recovered.integrated, true);
  assert.equal(recovered.integration.recovered, true);
  assert.equal(recovered.integration.integrated_state, "final");
  assert.equal(recovered.integration.previous_wk_sha, "a".repeat(40));
  assert.deepEqual(recovered.integration.review_target, harness.integrationResult.review_target);
  assert.equal(recovered.wk_transitioned_to_review, true);
  assertNoReviewFields("recovered", recovered);
  assert.deepEqual(harness.counts(), { integrationCalls: 2, declaredUnitCalls: 0, reviewSeamCalls: 0 });
});

test("WK-1603 restart recovery-only mode: an advanced slice without terminal authority refuses; a missing binding refuses", async () => {

  const preIntegration = createResumableLifecycleHarness();
  const skipped = await runPostWorkerSliceLifecycle({
    workspace: WORKSPACE,
    status: { ...preIntegration.status },
    deps: { ...preIntegration.deps, recoveryOnly: true }
  });
  assert.equal(skipped, null);
  assert.deepEqual(preIntegration.counts(), { integrationCalls: 0, declaredUnitCalls: 0, reviewSeamCalls: 0 });

  const missing = createResumableLifecycleHarness();
  await assert.rejects(
    runPostWorkerSliceLifecycle({
      workspace: WORKSPACE,
      status: { ...missing.status },
      deps: { ...missing.deps, recoveryOnly: true, resolveManagedRunBinding: () => null }
    }),
    (error) => {
      assert.equal(isClosedLifecycleFailure(error), true);
      assert.equal(error.code, CLOSED_LIFECYCLE_FAILURE_CODES.LIFECYCLE_BINDING_RESOLUTION_FAILED);
      assert.equal(error.failure_cause.reason, "provisioning_binding_incomplete");
      return true;
    }
  );
  assert.deepEqual(missing.counts(), { integrationCalls: 0, declaredUnitCalls: 0, reviewSeamCalls: 0 });

  const integrated = createResumableLifecycleHarness();
  integrated.setCanonicalStatus("review");
  let recoveryAdapterCalls = 0;
  const recovered = await runPostWorkerSliceLifecycle({
    workspace: WORKSPACE,
    status: { ...integrated.status },
    deps: {
      ...integrated.deps,
      recoveryOnly: true,
      hostSliceIntegrationAdapter: async () => {
        recoveryAdapterCalls += 1;
        return {
          accepted: true,
          integration: { ...integrated.integrationResult, recovered: true }
        };
      }
    }
  });
  assert.equal(recovered.phase, "finalized");
  assert.equal(recovered.integration.recovered, true);
  assert.equal(recovered.wk_transitioned_to_review, true);
  assert.equal(recoveryAdapterCalls, 1);
  assertNoReviewFields("recovery-only", recovered);
  assert.deepEqual(integrated.counts(), { integrationCalls: 0, declaredUnitCalls: 0, reviewSeamCalls: 0 });
});

test("monitor restart recovery is attempted only after normal unknown-handle lookup", async () => {
  let recoveryCalls = 0;
  const tools = createDispatchToolRegistry({
    backend: {
      getRunStatus: async () => ({
        accepted: false,
        refusal: { code: "monitor_handle_subject_mismatch", reason: "subject_mismatch", detail: null }
      }),
      recoverManagedWorkerRun: async () => { recoveryCalls += 1; return null; }
    }
  });
  const mismatch = parseStructuredTextResponse(await tools.get("workspace_agent_run_status").handler({
    subject: "WK-1537#SLICE-011",
    attempt_id: "wkdb_restart_selector"
  }));
  assert.equal(mismatch.accepted, false);
  assert.equal(mismatch.blocker.code, RUNTIME_BLOCKER_CODES.MONITOR_HANDLE_SUBJECT_MISMATCH);
  assert.equal(recoveryCalls, 0);

  const unknownTools = createDispatchToolRegistry({
    backend: {
      getRunStatus: async () => ({
        accepted: false,
        refusal: { code: "monitor_handle_unknown", reason: "unknown_run_or_handle", detail: null }
      }),
      recoverManagedWorkerRun: async () => { recoveryCalls += 1; return null; }
    }
  });
  const unknown = parseStructuredTextResponse(await unknownTools.get("workspace_agent_run_status").handler({
    subject: "WK-1537#SLICE-011",
    attempt_id: "wkdb_restart_selector"
  }));
  assert.equal(unknown.accepted, false);
  assert.equal(unknown.blocker.code, RUNTIME_BLOCKER_CODES.MONITOR_HANDLE_UNKNOWN);
  assert.equal(recoveryCalls, 1);
});

test("run monitoring never invokes slice integration before confirmed worker termination", async () => {
  let lifecycleCalls = 0;
  const tools = createDispatchToolRegistry({
    backend: {
      getRunStatus: async () => ({
        accepted: true,
        run_id: "run-worker-live",
        monitor_handle: "wkmh_worker_live",
        role: "worker",
        subject: "WK-1537#SLICE-001",
        status: "running",
        terminal: false,
        started_at: "2026-07-12T00:00:00.000Z",
        updated_at: "2026-07-12T00:00:30.000Z"
      }),
      runPostWorkerSliceLifecycle: async () => { lifecycleCalls += 1; }
    }
  });

  const result = parseStructuredTextResponse(await tools.get("workspace_agent_run_status").handler({
    subject: "WK-1537#SLICE-001"
  }));
  assert.equal(result.terminal, false);
  assert.equal("slice_lifecycle" in result, false);
  assert.equal(lifecycleCalls, 0);
});

test("the production post-worker helper delegates a committed delivery straight to integration and ends at the WK review handoff", async () => {
  const calls = { integration: [], reviewSeams: [] };
  const commit = "b".repeat(40);
  const base = "a".repeat(40);
  const wkRef = "refs/heads/wk/IN-0021/WK-1537";
  const reviewTarget = {
    ref: wkRef,
    sha: commit,
    diff_base_sha: base,
    diff_head_sha: commit,
    diff_range: `${base}..${commit}`,
    complete_parent_wk_contract: true,
    accumulated_wk_diff: true
  };

  const sliceBinding = {
    launch_ref: "wkmh_worker",
    run_id: "run-worker.slice",
    unit_address: "IN-0021/WK-1537/SLICE-001",
    output_branch: "slice/IN-0021/WK-1537/SLICE-001",
    worktree_path: "/tmp/slice-IN-0021-WK-1537-SLICE-001",
    base_sha: base,
    retry_id: 0
  };
  const wkBinding = {
    launch_ref: "wkmh_worker",
    run_id: "run-worker.wk",
    retry_id: 0,
    unit_address: "IN-0021/WK-1537",
    output_branch: "wk/IN-0021/WK-1537",
    worktree_path: "/tmp/wk-IN-0021-WK-1537",
    base_sha: base
  };
  const result = await runPostWorkerSliceLifecycle({
    workspace: WORKSPACE,
    status: {
      run_id: "run-worker",
      monitor_handle: "wkmh_worker",
      role: "worker",
      subject: "WK-1537#SLICE-001",
      status: "succeeded",
      terminal: true
    },
    deps: {
      ...Object.fromEntries(RETIRED_POST_WORKER_REVIEW_SEAMS.map((name) => [name, () => {
        calls.reviewSeams.push(name);
        throw new Error(`retired seam ${name} called`);
      }])),
      resolveManagedRunBinding: () => ({
        record_id: "WK-1537",
        slice_id: "SLICE-001",
        slice_binding: sliceBinding,
        wk_binding: wkBinding,
        validation_worktree_path: wkBinding.worktree_path
      }),
      resolveCommittedSliceIntegrationContinuation: () => {
        throw new Error("a fresh first attempt consults no continuation");
      },
      runGit: () => ({ ok: true, stdout: `${commit}\n` }),

      reconcileIntegratedSliceRecord: () => null,
      hostSliceIntegrationAdapter: async (input) => {
        calls.integration.push(input);
        return {
          accepted: true,
          integration: {
            review_target: reviewTarget,
            wk_ref: wkRef,
            wk_sha: commit,
            slice_sha: commit,
            tuple: {
              assigned_unit: "WK-1537#SLICE-001",
              launch_ref: "wkmh_worker",
              run_id: "run-worker",
              retry_id: 0
            }
          }
        };
      }
    }
  });
  assert.deepEqual(calls.integration, [{
    assigned_unit: "WK-1537#SLICE-001",
    launch_ref: "wkmh_worker",
    run_id: "run-worker",
    retry_id: 0
  }]);
  assert.deepEqual(calls.reviewSeams, []);
  assert.equal(result.phase, "finalized");
  assert.equal(result.integrated, true);
  assert.equal(result.wk_transitioned_to_review, true);
  assert.deepEqual(result.integration.review_target, reviewTarget);
  assert.equal(result.delivery_state, "delivery_finalized");
  assert.equal(Object.hasOwn(result, "terminal_candidate"), false);
  assertNoReviewFields("production helper", result);
});
