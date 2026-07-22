

import {
  reconcileIntegratedSliceRecord,
  SLICE_INTEGRATION_DIAGNOSTIC_CODES,
  SliceIntegrationError
} from "../../../agent-launch-cli/src/lib/slice-integration.mjs";
import { resolveWorktreeBinding } from "../../../agent-launch-cli/src/lib/worktree-substrate.mjs";

export const WORKER_SLICE_SUBJECT_RE = /^(WK-\d{4})#(SLICE-\d{3})$/u;
const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
export const POST_WORKER_LIFECYCLE_CHECKPOINT = Symbol("postWorkerLifecycleCheckpoint");

export const POST_WORKER_LIFECYCLE_PHASES = Object.freeze({
  PRE_INTEGRATION: "pre-integration",
  AWAITING_SLICE_REVIEW: "awaiting-slice-review",
  INTEGRATED: "integrated",
  FINALIZED: "finalized"
});

export function lifecycleError(code, message, detail = null, cause = null) {
  return new SliceIntegrationError(`workspace-agent post-worker lifecycle: ${message}`, {
    code,
    detail,
    cause
  });
}

function runGitOrThrow(runGit, repo, args, message, code) {
  const result = runGit({ repo, args });
  if (!result || result.ok !== true) {
    throw lifecycleError(code, message, {
      args,
      status: result?.status ?? null,
      stderr: result?.stderr ?? result?.error ?? null
    });
  }
  return result;
}

export function resolvedCommit(runGit, repo, value, message, code) {
  const sha = String(runGitOrThrow(
    runGit,
    repo,
    ["rev-parse", "--verify", `${value}^{commit}`],
    message,
    code
  ).stdout ?? "").trim();
  if (!OID_RE.test(sha) || /^0+$/u.test(sha)) {
    throw lifecycleError(code, message, { value, sha: sha || null });
  }
  return sha;
}

function resolveSliceBindingForRun({ workspaceDir, status }, deps) {
  const resolveBinding = deps.resolveWorktreeBinding ?? resolveWorktreeBinding;
  return resolveBinding({
    mainRepo: workspaceDir,
    launchRef: status.monitor_handle,
    runId: `${status.run_id}.slice`,
    retryId: 0
  });
}

export function resolveManagedLifecycleBindings({ workspaceDir, status }, deps) {
  if (typeof deps.resolveManagedRunBinding === "function") {
    const provisioning = deps.resolveManagedRunBinding(status);
    if (!provisioning?.slice_binding || !provisioning?.wk_binding ||
        provisioning.validation_worktree_path !== provisioning.wk_binding.worktree_path) {
      throw new Error("post-worker lifecycle requires the complete launcher-owned WK and slice provisioning binding");
    }
    return { provisioning, slice: provisioning.slice_binding, wk: provisioning.wk_binding };
  }
  const slice = resolveSliceBindingForRun({ workspaceDir, status }, deps);
  const resolveBinding = deps.resolveWorktreeBinding ?? resolveWorktreeBinding;
  const wk = resolveBinding({
    mainRepo: workspaceDir,
    launchRef: status.monitor_handle,
    runId: `${status.run_id}.wk`,
    retryId: 0
  });
  return {
    provisioning: {
      record_id: String(slice?.unit_address ?? "").split("/")[1],
      slice_id: String(slice?.unit_address ?? "").split("/")[2],
      slice_binding: slice,
      wk_binding: wk,
      validation_worktree_path: wk?.worktree_path
    },
    slice,
    wk
  };
}

export function createLifecycleCheckpoint() {
  return {
    phase: POST_WORKER_LIFECYCLE_PHASES.PRE_INTEGRATION,
    integration: null,
    slice_review: null,
    finalized: null,
    in_flight: null
  };
}

export function checkpointFromStatus(status) {
  const checkpoint = status?.[POST_WORKER_LIFECYCLE_CHECKPOINT];
  return checkpoint ?? createLifecycleCheckpoint();
}

export function recoverIntegratedSliceResult({ mainRepo, binding, sliceRef, wkRef, runGit, deps = {} }) {
  return (deps.reconcileIntegratedSliceRecord ?? reconcileIntegratedSliceRecord)({
    mainRepo,
    unitAddress: binding.unit_address,
    sliceRef,
    wkRef,
    deps: { runGit }
  });
}

export async function delegateSliceIntegrationToHost({ status, adapter }) {
  const delegated = await adapter({
    assigned_unit: status.subject,
    launch_ref: status.monitor_handle,
    run_id: status.run_id,
    retry_id: 0
  });
  if (!delegated || delegated.accepted !== true || !delegated.integration) {
    throw lifecycleError(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.GIT_FAILED,
      "host-delegated slice-to-WK integration failed",
      { broker_refusal: delegated?.refusal ?? null }
    );
  }
  return delegated.integration;
}
