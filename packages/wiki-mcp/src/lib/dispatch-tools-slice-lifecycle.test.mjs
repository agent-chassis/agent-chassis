import assert from "node:assert/strict";
import test from "node:test";

import {
  RUNTIME_BLOCKER_CODES
} from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";

import {
  runPostWorkerSliceLifecycle,
  TERMINAL_REVIEW_EVIDENCE_MODES
} from "./dispatch-run-monitor-routes.mjs";
import * as lifecycleExports from "./dispatch-post-worker-lifecycle.mjs";
import * as monitorRouteExports from "./dispatch-run-monitor-routes.mjs";
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

test("WK-1603 restart recovery-only mode: a not-yet-integrated slice returns null without integrating; a missing binding refuses", async () => {
  const workspace = { repo: "agent-chassis", dir: "/home/user/agent-chassis" };

  const preIntegration = createResumableLifecycleHarness();
  assert.equal(await runPostWorkerSliceLifecycle({
    workspace,
    status: { ...preIntegration.status },
    deps: { ...preIntegration.deps, recoveryOnly: true }
  }), null);
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
      resolveSliceReviewAcceptanceBinding: () => ({
        schema_version: "workspace-agent-slice-review-binding.v1",
        unit_address: "WK-1537#SLICE-001",
        initiative: "IN-0021",
        slice_ref: `refs/heads/${sliceBinding.output_branch}`,
        reviewed_sha: commit,
        diff_base_sha: base,
        source_worker_run_id: "run-worker",
        review_run_id: "run-slice-reviewer"
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
    refusal: { code: "operator_recovery_needed", reason: "host_write_authority_broker_refused", detail: null }
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
