import assert from "node:assert/strict";

import { z } from "zod";

import {
  TERMINAL_REVIEW_MATERIALIZATION_SCHEMA_VERSION,
  TERMINAL_REVIEW_VERIFY_PARTS
} from "../../../agent-launch-cli/src/lib/host-write-authority-substrate/terminal-review-materialization.mjs";
import { registerDispatchTools } from "./dispatch-tools.mjs";
import {
  runPostWorkerSliceLifecycle,
  TERMINAL_REVIEW_EVIDENCE_MODES
} from "./dispatch-run-monitor-routes.mjs";
import { resolveLauncherOwnedLifecycleDeps } from "./dispatch-launch-runtime.mjs";
import { errorContent, jsonContent } from "./mcp-response.mjs";

export function terminalReviewAttestation(args) {
  return Object.freeze({
    schema_version: TERMINAL_REVIEW_MATERIALIZATION_SCHEMA_VERSION,
    worktree_path: args.worktreePath,
    wk_ref: args.wkRef,
    reviewed_sha: args.frozenSha,
    reviewed_tree: "e".repeat(40),
    verified: true,
    verified_parts: TERMINAL_REVIEW_VERIFY_PARTS
  });
}

export function createDispatchToolRegistry({
  backend = {}
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
    dispatchSessionIdentity: "session-123"
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

export function createResumableLifecycleHarness({
  bindFailures = 0,
  integrationGate = null,
  materialize,
  sliceReviewAccepted = true,
  acceptedSha = null
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
  let bindCalls = 0;

  let sliceCanonicalStatus = "in_progress";
  let sliceBindCalls = 0;
  const frozenSliceTargets = [];
  const statusWrites = [];
  const materializeCalls = [];
  const provisioning = {
    record_id: "WK-1537",
    slice_id: "SLICE-001",
    slice_binding: {
      launch_ref: status.monitor_handle,
      run_id: `${status.run_id}.slice`,
      retry_id: 0,
      unit_address: "IN-0021/WK-1537/SLICE-001",
      output_branch: sliceRef,
      worktree_path: sliceWorktree,
      base_sha: base
    },
    wk_binding: {
      unit_address: "IN-0021/WK-1537",
      output_branch: wkRef,
      worktree_path: wkWorktree,
      base_sha: base
    },
    validation_worktree_path: wkWorktree
  };
  const deps = {
    resolveManagedRunBinding: () => provisioning,

    hostSliceReviewPreparationAdapter: async (request) => {
      const retained = deps.resolveManagedRunBinding().slice_binding;
      const normalizedSliceRef = retained.output_branch.startsWith("refs/heads/")
        ? retained.output_branch
        : `refs/heads/${retained.output_branch}`;
      const boundRunId = retained.run_id.endsWith(".slice")
        ? retained.run_id.slice(0, -".slice".length)
        : null;
      const expectedRequest = {
        assigned_unit: status.subject,
        launch_ref: retained.launch_ref,
        run_id: boundRunId,
        retry_id: retained.retry_id
      };
      assert.deepEqual(request, expectedRequest);
      const reviewedShaResult = deps.runGit({
        repo: retained.worktree_path,
        args: ["rev-parse", "--verify", `${normalizedSliceRef}^{commit}`]
      });
      assert.equal(reviewedShaResult.ok, true);
      const reviewedSha = String(reviewedShaResult.stdout ?? "").trim();
      const reviewedTreeResult = deps.runGit({
        repo: retained.worktree_path,
        args: ["rev-parse", "--verify", `${reviewedSha}^{tree}`]
      });
      assert.equal(reviewedTreeResult.ok, true);
      const reviewedTree = String(reviewedTreeResult.stdout ?? "").trim();
      return {
        accepted: true,
        preparation: {
          ...expectedRequest,
          worktree_path: retained.worktree_path,
          slice_ref: normalizedSliceRef,
          base_sha: retained.base_sha,
          reviewed_sha: reviewedSha,
          reviewed_tree: reviewedTree
        }
      };
    },
    resolveCanonicalReviewUnit: () => ({
      record_id: "WK-1537",
      slice_id: "SLICE-003",
      subject: "WK-1537#SLICE-003",
      unit_contract: "canonical-review",
      parent_status: canonicalStatus
    }),
    runGit: ({ repo, args }) => {
      if (args[0] === "symbolic-ref") {
        return { ok: true, stdout: `${repo === sliceWorktree ? sliceRef : wkRef}\n` };
      }
      if (args[0] === "status") return { ok: true, stdout: "" };
      if (args[0] === "rev-list") return { ok: true, stdout: `${commit} ${base}\n` };
      if (args[0] === "merge-base" && args[1] === "--is-ancestor") return { ok: true, stdout: "" };
      if (args[0] === "merge-base") return { ok: true, stdout: `${base}\n` };
      if (args[0] === "rev-parse") {
        const value = args.at(-1);
        if (repo === sliceWorktree || String(value).includes("slice/")) {
          return { ok: true, stdout: `${commit}\n` };
        }
        if (repo === wkWorktree || String(value).includes("wk/")) {
          return { ok: true, stdout: `${canonicalStatus === "review" ? commit : base}\n` };
        }
        if (String(value).includes("main")) return { ok: true, stdout: `${base}\n` };
      }
      return { ok: false, status: 128, stderr: `unexpected git call: ${args.join(" ")}` };
    },

    reconcileIntegratedSliceRecord: () =>
      canonicalStatus === "review" ? { ...integrationResult, recovered: true } : null,
    setWorkRecordStatusByUnit: async ({ unitAddress, status: nextStatus }) => {
      statusWrites.push({ unitAddress, status: nextStatus });
      if (unitAddress === "WK-1537#SLICE-001" && nextStatus === "review") {
        sliceCanonicalStatus = "review";
      }
      return { valid: true, written: true };
    },

    resolveCanonicalSliceReviewUnit: ({ subject }) => {
      if (sliceCanonicalStatus !== "review") {
        throw new Error(`canonical slice ${subject} is not an implementation slice under slice-level review`);
      }
      return {
        record_id: "WK-1537",
        slice_id: "SLICE-001",
        subject: "WK-1537#SLICE-001",
        initiative: "IN-0021",
        parent_status: canonicalStatus,
        canonical_parent_wk_contract: "canonical-parent",
        review_unit_contract: "canonical-slice"
      };
    },
    bindFrozenSliceReviewContext: ({ sliceTarget }) => {
      sliceBindCalls += 1;
      frozenSliceTargets.push(sliceTarget);
      return Object.freeze({
        schema_version: "workspace-agent-frozen-slice-review-context.v1",
        worktree_path: sliceWorktree
      });
    },

    resolveSliceReviewAcceptanceBinding: () => sliceReviewAccepted
      ? {
          schema_version: "workspace-agent-slice-review-binding.v1",
          unit_address: "WK-1537#SLICE-001",
          initiative: "IN-0021",
          slice_ref: sliceRef,
          reviewed_sha: acceptedSha ?? commit,
          diff_base_sha: base,
          source_worker_run_id: status.run_id,
          review_run_id: "run-slice-reviewer"
        }
      : null,
    bindFrozenReviewContext: () => {
      bindCalls += 1;
      if (bindCalls <= bindFailures) throw new Error("injected post-integration context failure");
      return { schema_version: "workspace-agent-frozen-wk-review-context.v1" };
    },
  };

  const launcherOwned = resolveLauncherOwnedLifecycleDeps({

    worktreeProvisioning: { mainRepo: "/tmp/main-repo-IN-0021-WK-1537" },
    directSliceIntegrationAdapter: async () => {
      integrationCalls += 1;
      if (integrationGate) await integrationGate;
      canonicalStatus = "review";
      return { accepted: true, integration: integrationResult };
    },

    hostSliceReviewPreparationAdapter: deps.hostSliceReviewPreparationAdapter
  });
  assert.equal(
    launcherOwned.terminalReviewEvidenceMode,
    TERMINAL_REVIEW_EVIDENCE_MODES.LIVE_MATERIALIZER,
    "the direct composition must resolve to the live materializer branch"
  );
  Object.assign(deps, launcherOwned);

  if (materialize === null) delete deps.materializeTerminalReviewWorktree;
  else {
    deps.materializeTerminalReviewWorktree = (args) => {
      materializeCalls.push(args);
      return (materialize ?? terminalReviewAttestation)(args);
    };
  }
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
    materializeCalls,
    frozenSliceTargets,
    statusWrites,
    sliceRef,
    sliceWorktree,

    counts: () => ({ integrationCalls, bindCalls }),
    sliceBindCalls: () => sliceBindCalls,
    sliceStatus: () => sliceCanonicalStatus,
    setCanonicalStatus(value) { canonicalStatus = value; }
  };
}
