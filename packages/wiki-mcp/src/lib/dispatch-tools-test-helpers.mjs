import assert from "node:assert/strict";

import { z } from "zod";

import { registerDispatchTools } from "./dispatch-tools.mjs";
import { runPostWorkerSliceLifecycle } from "./dispatch-run-monitor-routes.mjs";
import { resolveLauncherOwnedLifecycleDeps } from "./dispatch-launch-runtime.mjs";
import { errorContent, jsonContent } from "./mcp-response.mjs";

export function createDispatchToolRegistry({
  backend = {},

  runStatusCallBudgetMs = undefined,

  responseEnv = undefined
} = {}) {
  const tools = new Map();
  const registerTool = (name, config, handler) => {
    tools.set(name, { config, handler });
  };

  registerDispatchTools({
    registerTool,
    registeredToolNames: new Set([
      "workspace_agent_dispatch",
      "workspace_record_graph_impact_evidence",
      "workspace_validate_dispatch"
    ]),
    workspaceRepos: [{ repo: "agent-chassis", dir: "/home/user/agent-chassis" }],
    z,
    jsonContent,
    errorContent,
    resolveWorkspaceRepo: () => ({
      repo: "agent-chassis",
      dir: "/home/user/agent-chassis"
    }),
    dispatchBackend: {
      startLaunch: async () => {
        throw new Error("Cannot open /home/user/agent-chassis/wiki/work-records/WK-1160.json");
      },
      getRunStatus: async () => {
        throw new Error("Cannot open /home/user/agent-chassis/wiki/work-records/WK-1160.json");
      },
      waitForRunStatus: async () => {
        throw new Error("Cannot open /home/user/agent-chassis/wiki/work-records/WK-1160.json");
      },
      ...backend
    },
    dispatchSessionIdentity: "session-123",
    runStatusCallBudgetMs,
    responseEnv
  });

  return tools;
}

export function parseStructuredTextResponse(result) {
  assert.equal(result.isError, undefined);
  assert.equal(result.content[0].type, "text");
  assert.equal(typeof result.content[0].text, "string");
  const structured = JSON.parse(result.content[0].text);
  assert.deepEqual(result.structuredContent, structured);
  return structured;
}

export const RETIRED_POST_WORKER_REVIEW_SEAMS = Object.freeze([
  "resolveCanonicalReviewUnit",
  "bindFrozenReviewContext",
  "resolveCanonicalSliceReviewUnit",
  "bindFrozenSliceReviewContext",
  "hostSliceReviewPreparationAdapter",
  "materializeTerminalReviewWorktree",
  "setWorkRecordStatusByUnit"
]);

export function createResumableLifecycleHarness({
  integrationFailures = 0,
  integrationGate = null,
  declaredTerminalReviewUnit = null
} = {}) {
  const base = "a".repeat(40);
  const commit = "b".repeat(40);
  const sliceRef = "refs/heads/slice/IN-0021/WK-1537/SLICE-001";
  const wkRef = "refs/heads/wk/IN-0021/WK-1537";
  const sliceWorktree = "/tmp/slice-IN-0021-WK-1537-SLICE-001";
  const wkWorktree = "/tmp/wk-IN-0021-WK-1537";
  const status = {
    accepted: true,
    timed_out: false,
    run_id: "run-worker-resumable",
    monitor_handle: "wkmh_worker_resumable",
    role: "worker",
    subject: "WK-1537#SLICE-001",
    status: "succeeded",
    terminal: true,
    started_at: "2026-07-12T00:00:00.000Z",
    updated_at: "2026-07-12T00:01:00.000Z"
  };
  const reviewTarget = Object.freeze({
    schema_version: "slice-integration.v1",
    unit_address: "IN-0021/WK-1537",
    ref: wkRef,
    sha: commit,
    diff_base_sha: base,
    diff_head_sha: commit,
    diff_range: `${base}..${commit}`,
    complete_parent_wk_contract: true,
    accumulated_wk_diff: true
  });
  const integrationResult = Object.freeze({
    schema_version: "slice-integration.v1",
    integrated: true,
    rebased: false,
    previous_wk_sha: base,
    slice_ref: sliceRef,
    slice_sha: commit,
    wk_ref: wkRef,
    wk_sha: commit,
    review_target: reviewTarget,
    transition: Object.freeze({ valid: true, written: true }),
    tuple: Object.freeze({
      assigned_unit: status.subject,
      launch_ref: status.monitor_handle,
      run_id: status.run_id,
      retry_id: 0
    })
  });
  let canonicalStatus = "in_progress";
  let integrationCalls = 0;
  let declaredUnitCalls = 0;
  const reviewSeamCalls = [];

  const provisioningFor = (observed = status) => ({
    record_id: "WK-1537",
    slice_id: "SLICE-001",
    slice_binding: {
      launch_ref: observed.monitor_handle ?? status.monitor_handle,
      run_id: `${observed.run_id ?? status.run_id}.slice`,
      retry_id: 0,
      unit_address: "IN-0021/WK-1537/SLICE-001",
      output_branch: sliceRef,
      worktree_path: sliceWorktree,
      base_sha: base
    },
    wk_binding: {
      launch_ref: observed.monitor_handle ?? status.monitor_handle,
      run_id: `${observed.run_id ?? status.run_id}.wk`,
      retry_id: 0,
      unit_address: "IN-0021/WK-1537",
      output_branch: wkRef,
      worktree_path: wkWorktree,
      base_sha: base
    },
    validation_worktree_path: wkWorktree
  });
  const provisioning = provisioningFor();
  const deps = {
    resolveManagedRunBinding: (observed) => provisioningFor(observed ?? status),
    runGit: ({ repo, args }) => {
      if (args[0] === "rev-parse") {
        const value = args.at(-1);
        if (repo === sliceWorktree || String(value).includes("slice/")) {
          return { ok: true, stdout: `${commit}\n` };
        }
        if (repo === wkWorktree || String(value).includes("wk/")) {
          return { ok: true, stdout: `${canonicalStatus === "review" ? commit : base}\n` };
        }
      }
      return { ok: false, status: 128, stderr: `unexpected git call: ${args.join(" ")}` };
    },

    reconcileIntegratedSliceRecord: () =>
      canonicalStatus === "review"
        ? { ...integrationResult, recovered: true, integrated_state: "final", review_target: null }
        : null,
    resolveCommittedSliceIntegrationContinuation: () => null,

    verifyDeliveredProofs: async () => Object.freeze({ verified: [] }),
    resolveDeclaredTerminalReviewUnit: () => {
      declaredUnitCalls += 1;
      return declaredTerminalReviewUnit;
    },
    ...Object.fromEntries(RETIRED_POST_WORKER_REVIEW_SEAMS.map((name) => [name, (...args) => {
      reviewSeamCalls.push({ name, args });
      throw new Error(`retired post-worker review seam ${name} was called`);
    }]))
  };

  const launcherOwned = resolveLauncherOwnedLifecycleDeps({
    worktreeProvisioning: { mainRepo: "/tmp/main-repo-IN-0021-WK-1537" },
    directSliceIntegrationAdapter: async () => {
      integrationCalls += 1;
      if (integrationGate) await integrationGate;
      if (integrationCalls <= integrationFailures) {
        return { accepted: false, refusal: { code: "injected_integration_refusal" } };
      }
      canonicalStatus = "review";
      return { accepted: true, integration: integrationResult };
    }
  });
  Object.assign(deps, launcherOwned);
  const invoke = ({ workspace, status: lifecycleStatus }) =>
    runPostWorkerSliceLifecycle({ workspace, status: lifecycleStatus, deps });
  return {
    status,
    deps,
    invoke,
    integrationResult,
    wkWorktree,
    wkRef,
    reviewedSha: commit,
    sliceRef,
    sliceWorktree,
    counts: () => ({ integrationCalls, declaredUnitCalls, reviewSeamCalls: reviewSeamCalls.length }),
    reviewSeamCalls: () => [...reviewSeamCalls],
    setCanonicalStatus(value) { canonicalStatus = value; }
  };
}
