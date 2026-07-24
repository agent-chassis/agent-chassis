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

function withSliceReviewPreparation(deps) {
  const resolveManagedRunBinding = () => {
    const provisioning = deps.resolveManagedRunBinding();
    return {
      ...provisioning,
      slice_binding: {
        ...provisioning.slice_binding,
        retry_id: provisioning.slice_binding.retry_id ?? 0
      }
    };
  };
  return {
    ...deps,
    resolveManagedRunBinding,
    hostSliceReviewPreparationAdapter: async (request) => {
      const provisioning = resolveManagedRunBinding();
      const binding = provisioning.slice_binding;
      const sliceRef = binding.output_branch.startsWith("refs/heads/")
        ? binding.output_branch
        : `refs/heads/${binding.output_branch}`;
      const reviewed = deps.runGit({
        repo: binding.worktree_path,
        args: ["rev-parse", "--verify", `${sliceRef}^{commit}`]
      }).stdout.trim();
      const tree = deps.runGit({
        repo: binding.worktree_path,
        args: ["rev-parse", "--verify", `${reviewed}^{tree}`]
      }).stdout.trim();
      return {
        accepted: true,
        preparation: {
          ...request,
          worktree_path: binding.worktree_path,
          slice_ref: sliceRef,
          base_sha: binding.base_sha,
          reviewed_sha: reviewed,
          reviewed_tree: tree
        }
      };
    }
  };
}

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
    integrated_state: "already_integrated"
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

function provenDeathDeps(deps, verdictFor) {
  const seen = [];
  return {
    deps: {
      ...withSliceReviewPreparation(deps),
      resolveManagedWorkerProvenDeath: (tuple) => {
        seen.push(tuple);
        return verdictFor(tuple);
      }
    },
    seen
  };
}

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

function postcheckError(detail, options = {}) {
  const error = new Error("agent-launch slice-review materialization: trusted state changed");
  error.name = "SliceReviewMaterializationError";

  error.code = Object.hasOwn(options, "code") ? options.code : SLICE_REVIEW_POSTCHECK_FAILED_CODE;
  if (detail !== undefined) error.detail = detail;
  return error;
}

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
  assert.equal(status.slice_lifecycle.error_code, SLICE_REVIEW_POSTCHECK_FAILED_CODE);
  assert.equal(status.slice_lifecycle.postcheck_mismatch_field, "objectAlternates");
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
  assert.equal(
    wait.lifecycle_resolution.latest_failure.error_code, SLICE_REVIEW_POSTCHECK_FAILED_CODE
  );

  assert.equal(wait.slice_lifecycle.error_code, SLICE_REVIEW_POSTCHECK_FAILED_CODE);
  assert.equal(wait.slice_lifecycle.postcheck_mismatch_field, "objectAlternates");

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
