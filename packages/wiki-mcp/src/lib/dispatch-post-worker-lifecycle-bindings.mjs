

import {
  reconcileIntegratedSliceRecord,
  SLICE_INTEGRATION_DIAGNOSTIC_CODES,
  SliceIntegrationError
} from "../../../agent-launch-cli/src/lib/slice-integration.mjs";
import { resolveWorktreeBinding } from "../../../agent-launch-cli/src/lib/worktree-substrate.mjs";
import {
  deriveManagedRunIdentityTupleFromBindingPair
} from "../../../agent-launch-cli/src/lib/managed-run-process-identity.mjs";

export const WORKER_SLICE_SUBJECT_RE = /^(WK-\d{4})#(SLICE-\d{3})$/u;
const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
export const POST_WORKER_LIFECYCLE_CHECKPOINT = Symbol("postWorkerLifecycleCheckpoint");

export const POST_WORKER_LIFECYCLE_PHASES = Object.freeze({
  PRE_INTEGRATION: "pre-integration",
  AWAITING_SLICE_REVIEW: "awaiting-slice-review",
  INTEGRATED: "integrated",
  FINALIZED: "finalized"
});

export const RUN_LIFECYCLE_RESOLUTION_SCHEMA_VERSION =
  "workspace-agent-run-lifecycle-resolution.v1";

export const LIFECYCLE_FAILURE_HISTORY_LIMIT = 5;

export const LIFECYCLE_RESOLUTION_NEXT_ACTIONS = Object.freeze({
  COMPLETE_SLICE_REVIEW: "complete_slice_review_then_retry_run_status",
  RESOLVE_FAILURE: "resolve_lifecycle_failure_then_retry_run_status",
  AWAIT_SLICE_COMMIT: "retry_run_status_after_exact_slice_commit",
  RETRY: "retry_wait_or_check_status"
});

export const LIFECYCLE_EXTERNAL_ACTION_NEXT_ACTIONS = Object.freeze([
  LIFECYCLE_RESOLUTION_NEXT_ACTIONS.COMPLETE_SLICE_REVIEW
]);

export function lifecycleResolutionRequiresExternalAction(resolution) {
  return resolution !== null &&
    resolution !== undefined &&
    resolution.resolved !== true &&
    LIFECYCLE_EXTERNAL_ACTION_NEXT_ACTIONS.includes(resolution.next_action);
}

const FINALIZED_LIFECYCLE_RESOLUTION = Object.freeze({
  schema_version: RUN_LIFECYCLE_RESOLUTION_SCHEMA_VERSION,
  resolved: true,
  phase: POST_WORKER_LIFECYCLE_PHASES.FINALIZED
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

export function resolveRetainedManagedWorkerTuple({ status, bindings }) {
  return deriveManagedRunIdentityTupleFromBindingPair({
    assignedUnit: status?.subject,
    launchRef: status?.monitor_handle,
    wkBinding: bindings?.wk,
    sliceBinding: bindings?.slice,
    expectedRunId: typeof status?.run_id === "string" ? status.run_id : null
  });
}

export function createLifecycleCheckpoint() {
  return {
    phase: POST_WORKER_LIFECYCLE_PHASES.PRE_INTEGRATION,
    integration: null,
    slice_review: null,
    finalized: null,
    in_flight: null,
    failure_attempts: 0,
    failure_history: []
  };
}

export function recordLifecycleFailure(checkpoint, failure) {
  if (!checkpoint || !Array.isArray(checkpoint.failure_history)) return failure;
  checkpoint.failure_attempts =
    (Number.isInteger(checkpoint.failure_attempts) ? checkpoint.failure_attempts : 0) + 1;
  checkpoint.failure_history.push(Object.freeze({
    phase: typeof failure?.phase === "string" ? failure.phase : null,
    error_code: typeof failure?.error_code === "string" ? failure.error_code : null,
    error_message: typeof failure?.error_message === "string" ? failure.error_message : null,
    error_message_truncated: failure?.error_message_truncated === true
  }));
  while (checkpoint.failure_history.length > LIFECYCLE_FAILURE_HISTORY_LIMIT) {
    checkpoint.failure_history.shift();
  }
  return failure;
}

function resolveLifecycleNextAction(phase, latestFailure) {
  if (phase === POST_WORKER_LIFECYCLE_PHASES.AWAITING_SLICE_REVIEW) {
    return LIFECYCLE_RESOLUTION_NEXT_ACTIONS.COMPLETE_SLICE_REVIEW;
  }
  if (latestFailure !== null) return LIFECYCLE_RESOLUTION_NEXT_ACTIONS.RESOLVE_FAILURE;
  if (phase === POST_WORKER_LIFECYCLE_PHASES.PRE_INTEGRATION) {
    return LIFECYCLE_RESOLUTION_NEXT_ACTIONS.AWAIT_SLICE_COMMIT;
  }
  return LIFECYCLE_RESOLUTION_NEXT_ACTIONS.RETRY;
}

export function projectLifecycleResolution({ lifecycle, checkpoint = null } = {}) {
  if (lifecycle === null || lifecycle === undefined) return null;
  const finalized = checkpoint !== null && typeof checkpoint.phase === "string"
    ? checkpoint.phase === POST_WORKER_LIFECYCLE_PHASES.FINALIZED
    : lifecycle.phase === POST_WORKER_LIFECYCLE_PHASES.FINALIZED;
  if (finalized) return FINALIZED_LIFECYCLE_RESOLUTION;
  const history = Array.isArray(checkpoint?.failure_history) ? checkpoint.failure_history : [];
  const rawAttempts = Number.isInteger(checkpoint?.failure_attempts)
    ? checkpoint.failure_attempts
    : 0;
  const latestFailure = history.length > 0 ? history[history.length - 1] : null;
  const phase = typeof lifecycle.phase === "string" ? lifecycle.phase : null;
  return Object.freeze({
    schema_version: RUN_LIFECYCLE_RESOLUTION_SCHEMA_VERSION,
    resolved: false,
    phase,

    integration_complete: false,
    failure_attempts: Math.min(rawAttempts, LIFECYCLE_FAILURE_HISTORY_LIMIT),
    failure_attempts_saturated: rawAttempts > LIFECYCLE_FAILURE_HISTORY_LIMIT,
    failure_history_limit: LIFECYCLE_FAILURE_HISTORY_LIMIT,
    failure_history_truncated: rawAttempts > history.length,
    retained_failures: Object.freeze([...history]),
    latest_failure: latestFailure,
    next_action: resolveLifecycleNextAction(phase, latestFailure)
  });
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
      { integration_refusal: delegated?.refusal ?? null }
    );
  }
  return delegated.integration;
}
