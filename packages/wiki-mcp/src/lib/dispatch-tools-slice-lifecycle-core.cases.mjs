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

test("WK-1634 production composition pins launcher-owned candidate prepare/validate functions over caller deps", async () => {
  const calls = [];
  const coordinator = {
    prepareTerminalCandidate: async () => { calls.push("launcher-prepare"); },
    validateTerminalCandidate: async () => { calls.push("launcher-validate"); }
  };
  const owned = resolveLauncherOwnedLifecycleDeps({
    worktreeProvisioning: { mainRepo: "/repo", worktreeRoot: "/worktrees" },
    hostSliceReviewPreparationAdapter: async () => null,
    terminalCandidateCoordinator: coordinator
  });
  assert.equal(owned.prepareTerminalCandidate, coordinator.prepareTerminalCandidate);
  assert.equal(owned.validateTerminalCandidate, coordinator.validateTerminalCandidate);

  let observed;
  const composed = composePostWorkerSliceLifecycle({
    worktreeProvisioning: { mainRepo: "/repo", worktreeRoot: "/worktrees" },
    hostSliceReviewPreparationAdapter: async () => null,
    terminalCandidateCoordinator: coordinator,
    lifecycle: async ({ deps }) => { observed = deps; return "ok"; }
  });
  const result = await composed({
    workspace: { dir: "/repo" },
    status: {},
    deps: {
      prepareTerminalCandidate: async () => calls.push("caller-prepare"),
      validateTerminalCandidate: async () => calls.push("caller-validate")
    }
  });
  assert.equal(result, "ok");
  assert.equal(observed.prepareTerminalCandidate, coordinator.prepareTerminalCandidate);
  assert.equal(observed.validateTerminalCandidate, coordinator.validateTerminalCandidate);
});
test("wiki-MCP exposes no retained-slice cleanup helper", () => {
  assert.equal(Object.hasOwn(lifecycleExports, "runRetainedSliceCleanupDisposition"), false);
  assert.equal(Object.hasOwn(monitorRouteExports, "runRetainedSliceCleanupDisposition"), false);
});

test("terminal worker monitoring invokes the trusted post-worker slice lifecycle and exposes the frozen WK target", async () => {
  const calls = [];
  const frozen = {
    ref: "refs/heads/wk/IN-0021/WK-1537",
    sha: "b".repeat(40),
    diff_base_sha: "a".repeat(40),
    diff_head_sha: "b".repeat(40),
    complete_parent_wk_contract: true,
    accumulated_wk_diff: true
  };
  const tools = createDispatchToolRegistry({
    backend: {
      getRunStatus: async () => ({
        accepted: true,
        run_id: "run-worker",
        monitor_handle: "wkmh_worker",
        role: "worker",
        subject: "WK-1537#SLICE-001",
        status: "succeeded",
        terminal: true,
        started_at: "2026-07-12T00:00:00.000Z",
        updated_at: "2026-07-12T00:01:00.000Z"
      }),
      runPostWorkerSliceLifecycle: async ({ workspace, status }) => {
        calls.push({ workspace, status });
        return {
          invoked: true,
          integrated: true,
          integration: { review_target: frozen },
          reviewer_dispatch: {
            tool: "workspace_agent_dispatch",
            args: { role: "reviewer", subject: "WK-1537#SLICE-003" },
            context: { frozen_review_target: frozen, complete_parent_wk_contract: true }
          }
        };
      },
      waitForRunStatus: async () => ({
        accepted: true,
        timed_out: false,
        run_id: "run-worker",
        monitor_handle: "wkmh_worker",
        role: "worker",
        subject: "WK-1537#SLICE-001",
        status: "succeeded",
        terminal: true,
        started_at: "2026-07-12T00:00:00.000Z",
        updated_at: "2026-07-12T00:01:00.000Z"
      })
    }
  });

  const first = parseStructuredTextResponse(await tools.get("workspace_agent_run_status").handler({
    monitor_handle: "wkmh_worker",
    subject: "WK-1537#SLICE-001"
  }));
  const second = parseStructuredTextResponse(await tools.get("workspace_agent_run_wait").handler({
    monitor_handle: "wkmh_worker",
    subject: "WK-1537#SLICE-001",
    timeout_ms: 1000,
    poll_interval_ms: 500
  }));

  assert.equal(calls.length, 1, "one terminal worker run is integrated once per monitor lifecycle");
  assert.equal(calls[0].workspace.dir, "/home/user/agent-chassis");
  assert.deepEqual(first.slice_lifecycle.reviewer_dispatch.context.frozen_review_target, frozen);
  assert.equal(first.slice_lifecycle.reviewer_dispatch.args.subject, "WK-1537#SLICE-003");
  assert.deepEqual(second.slice_lifecycle, first.slice_lifecycle);
});

test("post-integration finalization failure resumes across repeated status and wait without reintegration", async () => {
  const harness = createResumableLifecycleHarness({ bindFailures: 1 });
  const tools = createDispatchToolRegistry({
    backend: {
      getRunStatus: async () => ({ ...harness.status }),
      waitForRunStatus: async () => ({ ...harness.status }),
      runPostWorkerSliceLifecycle: ({ workspace, status }) =>
        runPostWorkerSliceLifecycle({
          workspace,
          status,
          deps: withSliceReviewPreparation(harness.deps)
        })
    }
  });

  const failed = parseStructuredTextResponse(await tools.get("workspace_agent_run_status").handler({
    monitor_handle: harness.status.monitor_handle,
    subject: harness.status.subject
  }));
  assert.equal(failed.slice_lifecycle.phase, "integrated");
  assert.equal(failed.slice_lifecycle.integrated, true);
  assert.deepEqual(failed.slice_lifecycle.integration, harness.integrationResult);
  assert.deepEqual(harness.counts(), { integrationCalls: 1, bindCalls: 1 });

  const resumed = parseStructuredTextResponse(await tools.get("workspace_agent_run_wait").handler({
    monitor_handle: harness.status.monitor_handle,
    subject: harness.status.subject,
    timeout_ms: 1000,
    poll_interval_ms: 500
  }));
  assert.equal(resumed.slice_lifecycle.phase, "finalized");
  assert.deepEqual(resumed.slice_lifecycle.integration, harness.integrationResult);
  assert.deepEqual(harness.counts(), { integrationCalls: 1, bindCalls: 2 });

  const repeated = parseStructuredTextResponse(await tools.get("workspace_agent_run_status").handler({
    monitor_handle: harness.status.monitor_handle,
    subject: harness.status.subject
  }));
  assert.deepEqual(repeated.slice_lifecycle, resumed.slice_lifecycle);
  assert.deepEqual(harness.counts(), { integrationCalls: 1, bindCalls: 2 });
});

test("concurrent status and wait polling share one phased post-worker lifecycle", async () => {
  let releaseIntegration;
  const integrationGate = new Promise((resolve) => { releaseIntegration = resolve; });
  const harness = createResumableLifecycleHarness({ integrationGate });
  const tools = createDispatchToolRegistry({
    backend: {
      getRunStatus: async () => ({ ...harness.status }),
      waitForRunStatus: async () => ({ ...harness.status }),
      runPostWorkerSliceLifecycle: ({ workspace, status }) =>
        runPostWorkerSliceLifecycle({
          workspace,
          status,
          deps: withSliceReviewPreparation(harness.deps)
        })
    }
  });

  const statusPromise = tools.get("workspace_agent_run_status").handler({
    monitor_handle: harness.status.monitor_handle,
    subject: harness.status.subject
  });
  const waitPromise = tools.get("workspace_agent_run_wait").handler({
    monitor_handle: harness.status.monitor_handle,
    subject: harness.status.subject,
    timeout_ms: 1000,
    poll_interval_ms: 500
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.counts().integrationCalls, 1);
  releaseIntegration();
  const [statusResult, waitResult] = await Promise.all([statusPromise, waitPromise]);
  const first = parseStructuredTextResponse(statusResult);
  const second = parseStructuredTextResponse(waitResult);
  assert.equal(first.slice_lifecycle.phase, "finalized");
  assert.deepEqual(second.slice_lifecycle, first.slice_lifecycle);
  assert.deepEqual(harness.counts(), { integrationCalls: 1, bindCalls: 1 });
});

test("process-local checkpoint loss recovers integrated phase only from canonical review and exact matching bindings and refs", async () => {
  const harness = createResumableLifecycleHarness({ bindFailures: 1 });
  const workspace = { repo: "agent-chassis", dir: "/home/user/agent-chassis" };
  await assert.rejects(
    runPostWorkerSliceLifecycle({ workspace, status: { ...harness.status }, deps: withSliceReviewPreparation(harness.deps) }),
    /injected post-integration context failure/
  );
  assert.deepEqual(harness.counts(), { integrationCalls: 1, bindCalls: 1 });

  const recovered = await runPostWorkerSliceLifecycle({
    workspace,
    status: { ...harness.status },
    deps: withSliceReviewPreparation(harness.deps)
  });
  assert.equal(recovered.phase, "finalized");
  assert.equal(recovered.integration.recovered, true);
  assert.equal(recovered.integration.previous_wk_sha, "a".repeat(40));
  assert.deepEqual(recovered.integration.review_target, harness.integrationResult.review_target);
  assert.deepEqual(harness.counts(), { integrationCalls: 2, bindCalls: 2 });
});

test("WK-1603 restart recovery-only mode: an advanced slice without terminal authority refuses; a missing binding refuses", async () => {
  const workspace = { repo: "agent-chassis", dir: "/home/user/agent-chassis" };

  const preIntegration = createResumableLifecycleHarness();
  const skipped = await runPostWorkerSliceLifecycle({
    workspace,
    status: { ...preIntegration.status },
    deps: { ...preIntegration.deps, recoveryOnly: true }
  });
  assert.equal(skipped, null);
  assert.deepEqual(preIntegration.counts(), { integrationCalls: 0, bindCalls: 0 });

  const missing = createResumableLifecycleHarness();
  await assert.rejects(
    runPostWorkerSliceLifecycle({
      workspace,
      status: { ...missing.status },
      deps: { ...missing.deps, recoveryOnly: true, resolveManagedRunBinding: () => null }
    }),
    /complete launcher-owned WK and slice provisioning binding/
  );
  assert.deepEqual(missing.counts(), { integrationCalls: 0, bindCalls: 0 });

  const integrated = createResumableLifecycleHarness();
  integrated.setCanonicalStatus("review");
  let recoveryAdapterCalls = 0;
  const recovered = await runPostWorkerSliceLifecycle({
    workspace,
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
  assert.equal(recoveryAdapterCalls, 1);
  assert.deepEqual(integrated.counts(), { integrationCalls: 0, bindCalls: 1 });
});

test("monitor restart recovery is attempted only after normal unknown-handle lookup", async () => {
  let recoveryCalls = 0;
  const tools = createDispatchToolRegistry({
    backend: {
      getRunStatus: async () => ({
        accepted: false,
        refusal: { code: "monitor_handle_subject_mismatch", reason: "subject_mismatch", detail: null }
      }),
      recoverIntegratedWorkerRun: async () => { recoveryCalls += 1; return null; }
    }
  });
  const mismatch = parseStructuredTextResponse(await tools.get("workspace_agent_run_status").handler({
    monitor_handle: "wkmh_restart_selector",
    subject: "WK-1537#SLICE-011"
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
      recoverIntegratedWorkerRun: async () => { recoveryCalls += 1; return null; }
    }
  });
  const unknown = parseStructuredTextResponse(await unknownTools.get("workspace_agent_run_status").handler({
    monitor_handle: "wkmh_restart_selector",
    subject: "WK-1537#SLICE-011"
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
    monitor_handle: "wkmh_worker_live",
    subject: "WK-1537#SLICE-001"
  }));
  assert.equal(result.terminal, false);
  assert.equal("slice_lifecycle" in result, false);
  assert.equal(lifecycleCalls, 0);
});

test("the production post-worker helper delegates terminal integration and freezes canonical WK review state", async () => {
  const calls = { integration: [], transition: [], bind: [], commitExercised: 0 };
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
  const result = await runPostWorkerSliceLifecycle({
    workspace: { repo: "agent-chassis", dir: "/home/user/agent-chassis" },
    status: {
      run_id: "run-worker",
      monitor_handle: "wkmh_worker",
      role: "worker",
      subject: "WK-1537#SLICE-001",
      status: "succeeded",
      terminal: true
    },
    deps: {
      hostSliceReviewPreparationAdapter: async (request) => ({
        accepted: true,
        preparation: {
          ...request,
          worktree_path: sliceBinding.worktree_path,
          slice_ref: `refs/heads/${sliceBinding.output_branch}`,
          base_sha: base,
          reviewed_sha: commit,
          reviewed_tree: commit
        }
      }),
      resolveManagedRunBinding: () => ({
        record_id: "WK-1537",
        slice_id: "SLICE-001",
        slice_binding: sliceBinding,
        wk_binding: wkBinding,
        validation_worktree_path: wkBinding.worktree_path
      }),
      resolveCanonicalReviewUnit: () => ({
        record_id: "WK-1537",
        slice_id: "SLICE-003",
        subject: "WK-1537#SLICE-003",
        unit_contract: "canonical-review"
      }),

      resolveCanonicalSliceReviewUnit: () => ({
        record_id: "WK-1537",
        slice_id: "SLICE-001",
        subject: "WK-1537#SLICE-001",
        initiative: "IN-0021",
        canonical_parent_wk_contract: "canonical-parent",
        review_unit_contract: "canonical-slice"
      }),
      bindFrozenSliceReviewContext: () => ({
        schema_version: "workspace-agent-frozen-slice-review-context.v1",
        worktree_path: sliceBinding.worktree_path
      }),
      resolveCommittedSliceIntegrationContinuation: () => ({
        schema_version: "workspace-agent-committed-slice-integration-continuation.v1",
        requested: true,
        completed: true,
        reviewed_sha: commit,
      }),
      runGit: ({ repo, args }) => {
        if (args[0] === "symbolic-ref") return { ok: true, stdout: `${wkRef}\n` };
        if (args[0] === "status" || args[0] === "reset") return { ok: true, stdout: "" };
        if (args[0] === "rev-parse" && repo.endsWith("WK-1537")) return { ok: true, stdout: `${commit}\n` };
        return { ok: true, stdout: `${commit}\n` };
      },

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
      },
      bindFrozenReviewContext: (input) => {
        calls.bind.push(input);
        return { schema_version: "workspace-agent-frozen-wk-review-context.v1" };
      },

      terminalReviewEvidenceMode: TERMINAL_REVIEW_EVIDENCE_MODES.LIVE_MATERIALIZER,
      materializeTerminalReviewWorktree: terminalReviewAttestation,
      markCommitAuthorityExercised: () => { calls.commitExercised += 1; }
    }
  });
  assert.equal(calls.integration.length, 1);
  assert.deepEqual(calls.integration[0], {
    assigned_unit: "WK-1537#SLICE-001",
    launch_ref: "wkmh_worker",
    run_id: "run-worker",
    retry_id: 0
  });
  assert.deepEqual(calls.transition, []);
  assert.equal(calls.bind.length, 1);
  assert.equal(calls.bind[0].provisioning.validation_worktree_path, wkBinding.worktree_path);
  assert.equal(calls.commitExercised, 1);
  assert.deepEqual(result.reviewer_dispatch.args, { role: "reviewer", subject: "WK-1537#SLICE-003" });
  assert.deepEqual(result.reviewer_dispatch.context.frozen_review_target, reviewTarget);
});
