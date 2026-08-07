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

import { withSliceReviewPreparation } from "./dispatch-tools-slice-lifecycle-test-support.mjs";

test("review findings remain evidence only and cause no automatic slice lifecycle mutation", async () => {
  let lifecycleCalls = 0;
  const tools = createDispatchToolRegistry({
    backend: {
      getRunStatus: async () => ({
        accepted: true,
        run_id: "run-reviewer",
        monitor_handle: "wkmh_reviewer",
        role: "reviewer",
        subject: "WK-1537#SLICE-003",
        status: "succeeded",
        terminal: true,
        started_at: "2026-07-12T00:02:00.000Z",
        updated_at: "2026-07-12T00:03:00.000Z",
        review_result: {
          review_outcome: "changes_requested",
          blocking_finding_count: 1,
          medium_finding_count: 0,
          clean_review: false
        }
      }),
      runPostWorkerSliceLifecycle: async () => { lifecycleCalls += 1; }
    }
  });

  const result = parseStructuredTextResponse(await tools.get("workspace_agent_run_status").handler({
    monitor_handle: "wkmh_reviewer",
    subject: "WK-1537#SLICE-003"
  }));
  assert.equal(result.review_result.review_outcome, "changes_requested");
  assert.equal("slice_lifecycle" in result, false);
  assert.equal(lifecycleCalls, 0, "findings do not trigger integration, cleanup, revert, or reissue");
});

test("WK-1555#SLICE-033 the post-worker lifecycle delegates integration to the host adapter and consumes its result", async () => {
  const harness = createResumableLifecycleHarness();
  const workspace = { repo: "agent-chassis", dir: "/home/user/agent-chassis" };
  const adapterCalls = [];

  const delegatedIntegration = { ...harness.integrationResult, tuple: {
    assigned_unit: harness.status.subject,
    launch_ref: harness.status.monitor_handle,
    run_id: harness.status.run_id,
    retry_id: 0
  } };
  const hostSliceIntegrationAdapter = async (request) => {
    adapterCalls.push(request);
    return { accepted: true, integration: delegatedIntegration };
  };
  const finalized = await runPostWorkerSliceLifecycle({
    workspace,
    status: { ...harness.status },
    deps: { ...withSliceReviewPreparation(harness.deps), hostSliceIntegrationAdapter }
  });

  assert.equal(harness.counts().integrationCalls, 0);

  assert.equal(adapterCalls.length, 1);
  assert.deepEqual(adapterCalls[0], {
    assigned_unit: harness.status.subject,
    launch_ref: harness.status.monitor_handle,
    run_id: harness.status.run_id,
    retry_id: 0
  });

  assert.equal(finalized.phase, "finalized");
  assert.equal(finalized.integrated, true);
  assert.deepEqual(finalized.reviewer_dispatch.context.frozen_review_target, harness.integrationResult.review_target);
});

test("WK-1555#SLICE-033 a host-delegated integration refusal fails the lifecycle closed", async () => {
  const harness = createResumableLifecycleHarness();
  const workspace = { repo: "agent-chassis", dir: "/home/user/agent-chassis" };
  const hostSliceIntegrationAdapter = async () => ({
    accepted: false,
    refusal: { code: "operator_recovery_needed", reason: "trusted_operation_refused", detail: null }
  });
  await assert.rejects(
    runPostWorkerSliceLifecycle({
      workspace,
      status: { ...harness.status },
      deps: { ...withSliceReviewPreparation(harness.deps), hostSliceIntegrationAdapter }
    }),
    /host-delegated slice-to-WK integration failed/
  );
  assert.equal(harness.counts().integrationCalls, 0);
});

test("WK-1587 a non-final slice integration leaves the WK dispatchable and dispatches no reviewer", async () => {
  const harness = createResumableLifecycleHarness();
  const workspace = { repo: "agent-chassis", dir: "/home/user/agent-chassis" };

  const nonFinalIntegration = {
    ...harness.integrationResult,
    review_target: null
  };
  let integrationCalls = 0;
  const finalized = await runPostWorkerSliceLifecycle({
    workspace,
    status: { ...harness.status, run_id: "run-worker-nonfinal" },
    deps: {
      ...withSliceReviewPreparation(harness.deps),
      hostSliceIntegrationAdapter: async () => {
        integrationCalls += 1;
        return { accepted: true, integration: nonFinalIntegration };
      }
    }
  });
  assert.equal(integrationCalls, 1);
  assert.equal(finalized.phase, "finalized");
  assert.equal(finalized.integrated, true);
  assert.equal(finalized.wk_transitioned_to_review, false);

  assert.equal(finalized.reviewer_dispatch, null, "a non-final slice dispatches no whole-WK reviewer");
  assert.deepEqual(finalized.integration, nonFinalIntegration);

  assert.equal(harness.counts().bindCalls, 0);

  assert.equal(harness.sliceBindCalls(), 1, "the per-slice reviewer context is bound before integration");
  assert.equal(harness.sliceStatus(), "review");
  assert.deepEqual(
    harness.statusWrites.filter((write) => write.unitAddress === "WK-1537"),
    [],
    "the parent WK is never transitioned by the slice-level review"
  );
});

test("managed lifecycle refuses before review freeze when the preparation adapter is absent", async () => {
  const harness = createResumableLifecycleHarness();
  await assert.rejects(
    runPostWorkerSliceLifecycle({
      workspace: { repo: "agent-chassis", dir: "/home/user/agent-chassis" },
      status: { ...harness.status },
      deps: { ...harness.deps, hostSliceReviewPreparationAdapter: undefined }
    }),
    /requires the trusted slice-review preparation adapter/u
  );
  assert.equal(harness.counts().integrationCalls, 0);
  assert.equal(harness.sliceStatus(), "in_progress");
  assert.equal(harness.sliceBindCalls(), 0);
});

function restartReplayLifecycleArgs({ enforcementMode, withMaterializer }) {
  const commit = "b".repeat(40);
  const base = "a".repeat(40);
  const mainSha = "e".repeat(40);
  const wkRef = "refs/heads/wk/IN-0021/WK-1537";
  const sliceRef = "refs/heads/slice/IN-0021/WK-1537/SLICE-001";
  const sliceBinding = {
    unit_address: "IN-0021/WK-1537/SLICE-001",
    output_branch: "slice/IN-0021/WK-1537/SLICE-001",
    worktree_path: "/tmp/slice-IN-0021-WK-1537-SLICE-001",
    base_sha: base,
    retry_id: 0
  };
  const wkBinding = {
    unit_address: "IN-0021/WK-1537",
    output_branch: "wk/IN-0021/WK-1537",
    worktree_path: "/tmp/wk-IN-0021-WK-1537",
    base_sha: base
  };

  const recoveredMarker = {
    integrated: true,
    slice_ref: sliceRef,
    slice_sha: commit,
    wk_ref: wkRef,
    wk_sha: commit,
    review_target: null,
    integrated_state: "final"
  };
  const deps = {
    reviewEnforcementMode: enforcementMode,
    resolveManagedRunBinding: () => ({
      record_id: "WK-1537",
      slice_id: "SLICE-001",
      slice_binding: sliceBinding,
      wk_binding: wkBinding,
      validation_worktree_path: wkBinding.worktree_path
    }),
    reconcileIntegratedSliceRecord: () => ({ ...recoveredMarker }),
    hostSliceIntegrationAdapter: async () => ({
      accepted: true,
      integration: { ...recoveredMarker }
    }),
    resolveCanonicalReviewUnit: () => ({
      record_id: "WK-1537",
      initiative: "IN-0021",
      slice_id: "SLICE-001",
      subject: "WK-1537#SLICE-001",
      parent_status: "done",
      canonical_parent_wk_contract: JSON.stringify({
        id: "WK-1537",
        initiative: "IN-0021",
        status: "done"
      })
    }),
    bindFrozenReviewContext: () => ({
      schema_version: "workspace-agent-frozen-wk-review-context.v1"
    }),
    runGit: ({ args }) => {
      if (args[0] === "merge-base") return { ok: true, stdout: `${base}\n` };
      if (args[0] === "rev-parse" && args.includes("refs/heads/main")) {
        return { ok: true, stdout: `${mainSha}\n` };
      }
      return { ok: true, stdout: `${commit}\n` };
    },

    ...(withMaterializer
      ? {
          terminalReviewEvidenceMode: TERMINAL_REVIEW_EVIDENCE_MODES.LIVE_MATERIALIZER,
          materializeTerminalReviewWorktree: terminalReviewAttestation
        }
      : {})
  };
  return {
    workspace: { repo: "agent-chassis", dir: "/home/user/agent-chassis" },
    status: {
      run_id: "run-worker",
      monitor_handle: "wkmh_worker",
      role: "worker",
      subject: "WK-1537#SLICE-001",
      status: "succeeded",
      terminal: true
    },
    deps
  };
}

test("WK-1678: an enforced-CCE already-done restart replay fails closed on missing terminal-review evidence", async () => {
  await assert.rejects(
    () => runPostWorkerSliceLifecycle(restartReplayLifecycleArgs({
      enforcementMode: "configured_policy",
      withMaterializer: false
    })),
    (error) => {

      assert.equal(
        error.code,
        "agent_launch.terminal_review_materialization.evidence_mode_unavailable.v1"
      );
      return true;
    },
    "enforced CCE must refuse a replay whose terminal-review evidence cannot be produced"
  );
});

test("WK-1678: the enforced tier never completes an already-done replay through the policy-only finalizer", async () => {

  const transitions = [];
  const args = restartReplayLifecycleArgs({
    enforcementMode: "configured_policy",
    withMaterializer: false
  });
  args.deps.setWorkRecordStatusByUnit = async (input) => {
    transitions.push(input);
    return { valid: true, written: true };
  };
  args.deps.markCommitAuthorityExercised = () => {
    throw new Error("enforced CCE must not exercise commit authority without verified evidence");
  };

  await assert.rejects(
    () => runPostWorkerSliceLifecycle(args),
    (error) => {
      assert.equal(
        error.code,
        "agent_launch.terminal_review_materialization.evidence_mode_unavailable.v1",
        "the enforced refusal must be the evidence gate, not a policy-only finalizer failure"
      );
      return true;
    }
  );
  assert.deepEqual(
    transitions,
    [],
    "a refused enforced replay must write no canonical status transition"
  );
});

test("WK-1678: an enforced-CCE already-done replay WITH live materialization proceeds to a reviewer", async () => {

  const result = await runPostWorkerSliceLifecycle(restartReplayLifecycleArgs({
    enforcementMode: "configured_policy",
    withMaterializer: true
  }));

  assert.equal(result.integrated, true);
  assert.equal(result.wk_transitioned_to_review, true);
  assert.equal(result.terminal_review_policy, undefined,
    "an enforced completion carries no policy-only disposition");
  assert.ok(result.terminal_review_materialization,
    "an enforced completion carries the verified seven-part attestation");
  assert.deepEqual(result.reviewer_dispatch.args, {
    role: "reviewer",
    subject: "WK-1537#SLICE-001"
  });

  assert.equal(result.integration.review_target.ref, "refs/heads/wk/IN-0021/WK-1537");
  assert.equal(result.integration.review_target.complete_parent_wk_contract, true);
  assert.equal(result.integration.review_target.accumulated_wk_diff, true);
});

test("WK-1678: the policy-only tier keeps its explicit no-reviewer completion for the same replay", async () => {

  const result = await runPostWorkerSliceLifecycle(restartReplayLifecycleArgs({
    enforcementMode: "policy_only",
    withMaterializer: false
  }));

  assert.equal(result.integrated, true);
  assert.equal(result.reviewer_dispatch, null);
  assert.equal(result.terminal_review_policy.enforcement_mode, "policy_only");
  assert.equal(result.terminal_review_policy.reviewer_launched, false);
  assert.equal(result.terminal_review_policy.evidence_enforced, false);
  assert.equal(result.terminal_review_policy.audit_disposition, "non_audit");
  assert.equal(
    result.terminal_review_policy.cause.code,
    "agent_launch.terminal_review_materialization.evidence_mode_unavailable.v1"
  );
});

test("committed-slice recovery is disjoint from worker liveness and performs no review transition", async () => {
  const workspace = { repo: "agent-chassis", dir: "/home/user/agent-chassis" };
  const harness = createResumableLifecycleHarness();
  let livenessConsults = 0;

  const recovered = await runPostWorkerSliceLifecycle({
    workspace,
    status: { ...harness.status },
    deps: {
      ...withSliceReviewPreparation(harness.deps),
      recoveryOnly: true,
      resolveManagedWorkerProvenDeath: () => {
        livenessConsults += 1;
        throw new Error("committed review must not consult worker liveness");
      }
    }
  });
  assert.equal(recovered, null);
  assert.equal(livenessConsults, 0);
  assert.equal(harness.sliceStatus(), "in_progress");
  assert.deepEqual(harness.counts(), { integrationCalls: 0, bindCalls: 0 });
  assert.deepEqual(harness.statusWrites, []);
});

test("committed-slice recovery does not branch on any worker-liveness verdict", async () => {
  const workspace = { repo: "agent-chassis", dir: "/home/user/agent-chassis" };
  const harness = createResumableLifecycleHarness();
  const result = await runPostWorkerSliceLifecycle({
    workspace,
    status: { ...harness.status },
    deps: { ...withSliceReviewPreparation(harness.deps), recoveryOnly: true }
  });
  assert.equal(result, null);
  assert.deepEqual(harness.counts(), { integrationCalls: 0, bindCalls: 0 });
  assert.equal(harness.sliceStatus(), "in_progress");
  assert.deepEqual(harness.statusWrites, []);
  assert.deepEqual(harness.frozenSliceTargets, []);
});
