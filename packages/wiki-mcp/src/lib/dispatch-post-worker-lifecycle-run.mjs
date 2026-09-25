

import { defaultRunGitAsync } from "../../../agent-launch-cli/src/lib/worktree-substrate.mjs";
import { AUTHENTICATED_INTEGRATION_CONTINUATION } from
  "../../../agent-launch-cli/src/lib/workspace-agent-dispatch-backend-integration.mjs";
import { SLICE_INTEGRATION_DIAGNOSTIC_CODES } from
  "../../../agent-launch-cli/src/lib/slice-integration.mjs";

import { INTEGRATED_SLICE_CLEANUP_STATES } from
  "../../../agent-launch-cli/src/lib/trusted-slice-integration.mjs";
import { verifyTerminalCandidateCycle } from "./dispatch-terminal-review-evidence.mjs";
import {
  checkpointFromStatus,
  delegateSliceIntegrationToHost,
  lifecycleError,
  POST_WORKER_LIFECYCLE_PHASES,
  recordReconciliationOutstanding,
  recoverIntegratedSliceResult,
  resolveManagedLifecycleBindings,
  resolvedCommit,
  resolveRetainedManagedWorkerTuple,
  transferLifecycleRetryFacts,
  WORKER_SLICE_SUBJECT_RE
} from "./dispatch-post-worker-lifecycle-bindings.mjs";
import {
  assertTerminalTargetOwnership,
  sameReviewTarget
} from "./dispatch-post-worker-lifecycle-policy.mjs";
import {
  captureLifecycleFailureEvidence,
  CLOSED_LIFECYCLE_FAILURE_SEAMS,
  CLOSED_LIFECYCLE_REFUSAL_REASONS,
  closeLifecycleSeamFailure,
  closeLifecycleSeamRefusal
} from "./dispatch-lifecycle-failure-projection.mjs";

function lifecycleFactError(message, detail) {
  return Object.assign(new Error(message), { detail });
}

async function resolveIntegrationContinuationSeam(deps, request) {
  if (typeof deps.resolveCommittedSliceIntegrationContinuation !== "function") return null;
  try {
    return await deps.resolveCommittedSliceIntegrationContinuation(request);
  } catch (error) {
    throw closeLifecycleSeamFailure(
      CLOSED_LIFECYCLE_FAILURE_SEAMS.COMMITTED_SLICE_INTEGRATION_CONTINUATION,
      error
    );
  }
}

async function atLifecycleSeam(seam, operation) {
  try {
    return await operation();
  } catch (error) {
    throw closeLifecycleSeamFailure(seam, error);
  }
}

function resolveLifecycleBindingSeam({ workspace, status, subject, deps }) {
  let bindings;
  try {
    bindings = resolveManagedLifecycleBindings({ workspaceDir: workspace.dir, status }, deps);
  } catch (error) {
    throw closeLifecycleSeamFailure(CLOSED_LIFECYCLE_FAILURE_SEAMS.LIFECYCLE_BINDING_RESOLUTION, error);
  }
  const binding = bindings.slice;
  const [initiative, wkId, sliceId] = String(binding?.unit_address ?? "").split("/");
  if (wkId !== subject[1] || sliceId !== subject[2]) {
    throw closeLifecycleSeamRefusal(
      CLOSED_LIFECYCLE_FAILURE_SEAMS.LIFECYCLE_BINDING_RESOLUTION,
      CLOSED_LIFECYCLE_REFUSAL_REASONS.WORKER_SUBJECT_BINDING_MISMATCH,
      {
        worker_subject: status.subject,
        bound_unit_address: binding?.unit_address ?? null,
        slice_binding: binding ?? null
      }
    );
  }
  const wkRef = `refs/heads/wk/${initiative}/${wkId}`;
  const boundWkRef = bindings.wk?.output_branch?.startsWith("refs/heads/")
    ? bindings.wk.output_branch
    : `refs/heads/${bindings.wk?.output_branch ?? ""}`;
  if (boundWkRef !== wkRef) {
    throw closeLifecycleSeamRefusal(
      CLOSED_LIFECYCLE_FAILURE_SEAMS.LIFECYCLE_BINDING_RESOLUTION,
      CLOSED_LIFECYCLE_REFUSAL_REASONS.WK_BINDING_MISMATCH,
      { expected_wk_ref: wkRef, bound_wk_ref: boundWkRef, wk_binding: bindings.wk ?? null }
    );
  }
  return { bindings, binding, initiative, wkId, sliceId, wkRef };
}

function inspectSliceDelivery(runGit, repo, sliceRef, message) {
  return atLifecycleSeam(CLOSED_LIFECYCLE_FAILURE_SEAMS.SLICE_DELIVERY_INSPECTION, () =>
    resolvedCommit(runGit, repo, sliceRef, message, SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH));
}

function reconcileIntegratedSlice(input) {
  return atLifecycleSeam(CLOSED_LIFECYCLE_FAILURE_SEAMS.INTEGRATED_SLICE_RECONCILIATION, () =>
    recoverIntegratedSliceResult(input));
}

async function integrateThroughHost(input) {
  try {
    return await delegateSliceIntegrationToHost(input);
  } catch (error) {
    throw transferLifecycleRetryFacts(
      error,
      closeLifecycleSeamFailure(CLOSED_LIFECYCLE_FAILURE_SEAMS.COMMITTED_SLICE_INTEGRATION, error)
    );
  }
}

export const POST_WORKER_MISSING_DELIVERY_CODE =
  "agent_launch.post_worker_slice_lifecycle.missing_closed_input_delivery.v1";

const INTEGRATED_CLEANUP_ONLY_STATES = new Set(Object.values(INTEGRATED_SLICE_CLEANUP_STATES));
const RECOVERED_INTEGRATION_REPLAYED_CODE =
  "agent_launch.slice_lifecycle.recovered_integration_replayed.v1";
const INTEGRATION_CONTINUATION_MISMATCH_CODE =
  "agent_launch.slice_lifecycle.integration_continuation_mismatch.v1";

const RECOVERED_INTEGRATED_STATES = Object.freeze({
  FINAL: "final",
  NON_FINAL: "non_final"
});
const RECOVERED_INTEGRATED_STATE_INVALID_CODE =
  "agent_launch.slice_lifecycle.recovered_integrated_state_invalid.v1";

async function withDeliveryFinalization(result, { status, bindings, deps }) {
  const integrationCleanup = result?.integration?.cleanup ?? null;
  let managedIdentityRetirement;
  if (typeof deps.retireManagedWorkerIdentity !== "function") {
    managedIdentityRetirement = Object.freeze({
      state: "pending",
      retired: false,
      code: "managed_worker_identity_retirement_unavailable"
    });
  } else {
    try {
      const workerTuple = resolveRetainedManagedWorkerTuple({ status, bindings });
      const retirement = await deps.retireManagedWorkerIdentity({
        ...workerTuple,
        reason: "finalized_integration",
        evidence: {
          slice_ref: result.integration?.slice_ref ?? bindings.slice?.output_branch ?? null,
          integrated_sha: result.integration?.wk_sha ?? result.integration?.slice_sha ?? null
        }
      });
      managedIdentityRetirement = Object.freeze({
        state: retirement?.retired === true ? "complete" : "pending",
        retired: retirement?.retired === true,
        code: typeof retirement?.code === "string" ? retirement.code : null
      });
    } catch (error) {
      managedIdentityRetirement = Object.freeze({
        state: "pending",
        retired: false,
        code: typeof error?.code === "string" ? error.code : null,
        evidence: captureLifecycleFailureEvidence(error, {
          operation: "delivery_finalization:managed_worker_identity_retirement"
        })
      });
    }
  }
  const cleanupPending = integrationCleanup?.state === "failed" ||
    managedIdentityRetirement.state !== "complete";
  return Object.freeze({
    ...result,
    delivery_state: "delivery_finalized",
    cleanup_pending: cleanupPending,
    cleanup: Object.freeze({
      state: cleanupPending ? "pending" : "complete",
      integration_cleanup_state: typeof integrationCleanup?.state === "string"
        ? integrationCleanup.state
        : null,
      managed_identity_retirement: managedIdentityRetirement
    })
  });
}

function assertIntegratedCleanupOnlyDelegation(trustedIntegration, { wkId, sliceId }) {
  const cleanup = trustedIntegration?.cleanup ?? null;
  if (cleanup === null || cleanup === undefined) return trustedIntegration;
  if (typeof cleanup === "object" && !Array.isArray(cleanup) &&
      cleanup.cleanup_only === true && cleanup.reaped !== true &&
      INTEGRATED_CLEANUP_ONLY_STATES.has(cleanup.state)) {
    return trustedIntegration;
  }
  throw lifecycleError(
    RECOVERED_INTEGRATION_REPLAYED_CODE,
    "already-integrated restart recovery requires a cleanup-only trusted confirmation, not a fresh integration replay",
    {
      assigned_unit: `${wkId}#${sliceId}`,
      cleanup_state: typeof cleanup?.state === "string" ? cleanup.state : null
    }
  );
}

function refuseRecoveredIntegratedState(integration, { wkId, sliceId }, reason) {
  throw lifecycleError(
    RECOVERED_INTEGRATED_STATE_INVALID_CODE,
    "recovered integration carries no authenticated integrated_state discriminator for the already-integrated restart decision",
    {
      assigned_unit: `${wkId}#${sliceId}`,
      reason,
      integrated_state: typeof integration?.integrated_state === "string"
        ? integration.integrated_state
        : null,
      owns_current_wk_tip: integration?.slice_sha === integration?.wk_sha,
      carries_review_target: integration?.review_target != null
    }
  );
}

function authenticateRecoveredIntegratedState(integration, unit) {
  const state = integration?.integrated_state;
  if (state === undefined || state === null) return null;
  if (state !== RECOVERED_INTEGRATED_STATES.FINAL &&
      state !== RECOVERED_INTEGRATED_STATES.NON_FINAL) {
    refuseRecoveredIntegratedState(integration, unit, "unrecognized_integrated_state");
  }
  if (state === RECOVERED_INTEGRATED_STATES.FINAL &&
      integration.slice_sha !== integration.wk_sha) {
    refuseRecoveredIntegratedState(integration, unit, "final_without_current_wk_tip_ownership");
  }
  if (state === RECOVERED_INTEGRATED_STATES.NON_FINAL &&
      integration.review_target != null) {
    refuseRecoveredIntegratedState(integration, unit, "non_final_with_whole_wk_review_target");
  }
  return state;
}

async function consumeAuthenticatedIntegrationContinuation(continuation, {
  wkId,
  sliceId,
  sliceRef,
  wkRef,
  reviewedSha,
  recovered = null,
  reconcile = null
}) {
  if (continuation?.[AUTHENTICATED_INTEGRATION_CONTINUATION] !== true ||
      continuation.completed !== true || continuation.integration == null) {
    return null;
  }
  const integration = continuation.integration;
  const state = integration.integrated_state;
  const authenticated = recovered ?? (typeof reconcile === "function" ? await reconcile() : null);

  const outstanding = recordReconciliationOutstanding(integration);
  const mismatches = [
    ["integrated", integration.integrated, true],
    ["continuation_reviewed_sha", continuation.reviewed_sha, reviewedSha],
    ["delivery_sha", integration.delivery_sha, reviewedSha],
    ["slice_ref", integration.slice_ref, sliceRef],
    ["wk_ref", integration.wk_ref, wkRef],
    ...(outstanding ? [
      ["outstanding_integrated_state", state, null],
      ["outstanding_review_target", integration.review_target ?? null, null]
    ] : [
      ["integrated_state",
        state === RECOVERED_INTEGRATED_STATES.FINAL || state === RECOVERED_INTEGRATED_STATES.NON_FINAL,
        true],
      ["final_without_current_wk_tip_ownership",
        state === RECOVERED_INTEGRATED_STATES.FINAL && integration.slice_sha !== integration.wk_sha,
        false],
      ["non_final_with_whole_wk_review_target",
        state === RECOVERED_INTEGRATED_STATES.NON_FINAL && integration.review_target != null,
        false]
    ]),
    ...(recovered === null ? [] : [
      ["recovered_delivery_sha", integration.delivery_sha, recovered.delivery_sha],
      ["recovered_slice_sha", integration.slice_sha, recovered.slice_sha],
      ["recovered_wk_sha", integration.wk_sha, recovered.wk_sha]
    ]),
    ...(outstanding
      ? (authenticated === null ? [] : [
          ["authenticated_integrated", authenticated.integrated, true],
          ["authenticated_slice_sha", authenticated.slice_sha, integration.slice_sha],
          ["authenticated_delivery_sha", authenticated.delivery_sha, integration.delivery_sha]
        ])
      : authenticated === null
        ? (integration.empty_delivery === true ? [] : [["recovered_integrated_state", state, null]])
        : [["recovered_integrated_state", state, authenticated.integrated_state]])
  ].filter(([, actual, expected]) => actual !== expected);
  if (mismatches.length > 0) {
    throw lifecycleError(
      INTEGRATION_CONTINUATION_MISMATCH_CODE,
      "authenticated integration continuation does not match the exact lifecycle target",
      {
        assigned_unit: `${wkId}#${sliceId}`,
        expected_reviewed_sha: reviewedSha,
        continuation_reviewed_sha: continuation.reviewed_sha ?? null,
        integration_delivery_sha: integration?.delivery_sha ?? null,
        mismatched_fields: mismatches.map(([field]) => field),
        mismatches: mismatches.map(([field, actual, expected]) => ({ field, actual, expected })),
        continuation,
        authenticated_reconciliation: authenticated
      }
    );
  }
  return integration;
}

async function retireNoCommitAttempt({
  status, bindings, binding, sliceRef, sliceTipSha, deps, onUnavailable = () => {}
}) {
  const workerTuple = resolveRetainedManagedWorkerTuple({ status, bindings }) ?? null;
  const death = workerTuple !== null && typeof deps.resolveManagedWorkerProvenDeath === "function"
    ? deps.resolveManagedWorkerProvenDeath({ ...workerTuple })
    : null;

  if (death?.proven_dead !== true || typeof deps.retireManagedWorkerIdentity !== "function") {

    onUnavailable({
      worker_tuple: workerTuple,
      death_resolver_composed: typeof deps.resolveManagedWorkerProvenDeath === "function",
      death_verdict: death,
      retirement_composed: typeof deps.retireManagedWorkerIdentity === "function"
    });
    return null;
  }

  let retirement;
  try {
    retirement = await deps.retireManagedWorkerIdentity({
      ...workerTuple,
      reason: "no_commit_base_equal",
      evidence: {
        slice_ref: sliceRef,
        base_sha: binding.base_sha,
        slice_tip_sha: sliceTipSha
      }
    });
  } catch (error) {
    throw closeLifecycleSeamFailure(
      CLOSED_LIFECYCLE_FAILURE_SEAMS.MANAGED_WORKER_IDENTITY_RETIREMENT,
      error
    );
  }
  if (retirement?.retired === true) {
    return Object.freeze({
      invoked: true,
      phase: POST_WORKER_LIFECYCLE_PHASES.FINALIZED,
      integrated: false,
      integration: null,
      recovered_from_proven_death: true,
      retired: true,
      retirement_reason: "no_commit_base_equal"
    });
  }
  throw lifecycleError(
    "agent_launch.managed_run_process_identity.recovery_retirement_refused.v1",
    "proven-dead no-commit recovery could not retire the exact managed attempt",
    {
      assigned_unit: status.subject,
      launch_ref: status.monitor_handle,
      run_id: workerTuple.run_id,
      retry_id: workerTuple.retry_id,
      retirement_code: retirement?.code ?? null,
      retirement_reason: retirement?.reason ?? null,
      retirement_result: retirement ?? null
    }
  );
}

function outstandingRecordFailure(integration, { wkId, sliceId }) {
  const blocked = integration?.record_reconciliation?.state === "blocked";
  return closeLifecycleSeamRefusal(
    CLOSED_LIFECYCLE_FAILURE_SEAMS.COMMITTED_SLICE_INTEGRATION,
    blocked
      ? CLOSED_LIFECYCLE_REFUSAL_REASONS.RECORD_RECONCILIATION_BLOCKED
      : CLOSED_LIFECYCLE_REFUSAL_REASONS.RECORD_RECONCILIATION_PENDING,
    {
      assigned_unit: `${wkId}#${sliceId}`,
      integrated: true,
      record_reconciliation: integration?.record_reconciliation ?? null,
      integration
    }
  );
}

async function reconcileIntegratedRecord({
  checkpoint, hostRequested, status, bindings, binding, workspace, sliceRef, wkRef, runGit, deps,
  wkId, sliceId
}) {
  const observed = checkpoint.integration;
  if (hostRequested) throw outstandingRecordFailure(observed, { wkId, sliceId });
  if (typeof deps.hostSliceIntegrationAdapter !== "function") {
    throw new Error("managed post-worker lifecycle requires the writable host slice integration adapter");
  }
  const repaired = await integrateThroughHost({
    status,
    bindings,
    adapter: deps.hostSliceIntegrationAdapter
  });
  if (repaired?.integrated !== true || repaired.slice_ref !== observed.slice_ref ||
      repaired.slice_sha !== observed.slice_sha || repaired.delivery_sha !== observed.delivery_sha ||
      repaired.wk_ref !== observed.wk_ref || repaired.empty_delivery !== observed.empty_delivery) {
    throw lifecycleFactError(
      "record reconciliation result does not match the exact integrated delivery",
      { integration: observed, record_reconciliation_result: repaired ?? null }
    );
  }
  if (recordReconciliationOutstanding(repaired)) {

    checkpoint.integration = Object.freeze({
      ...observed,
      record_reconciliation: repaired.record_reconciliation
    });
    throw outstandingRecordFailure(checkpoint.integration, { wkId, sliceId });
  }
  const reobserved = await reconcileIntegratedSlice({
    mainRepo: workspace.dir, binding, sliceRef, wkRef, runGit, deps
  });
  if (reobserved?.integrated !== true || recordReconciliationOutstanding(reobserved) ||
      reobserved.slice_sha !== observed.slice_sha ||
      reobserved.delivery_sha !== observed.delivery_sha ||
      reobserved.integrated_state !== repaired.integrated_state) {
    throw lifecycleFactError(
      "re-observation does not confirm the reconciled record of the exact integrated delivery",
      { integration: observed, record_reconciliation_result: repaired, reobserved: reobserved ?? null }
    );
  }
  checkpoint.integration = Object.freeze({ ...repaired, recovered: true });
}

export async function runPostWorkerSliceLifecycleBody({ workspace, status, deps = {} } = {}) {
  const subject = typeof status?.subject === "string" ? status.subject.match(WORKER_SLICE_SUBJECT_RE) : null;
  if (status?.role !== "worker" || status?.terminal !== true || status?.status !== "succeeded" || !subject) {
    return null;
  }
  const { bindings, binding, initiative, wkId, sliceId, wkRef } =
    resolveLifecycleBindingSeam({ workspace, status, subject, deps });
  const sliceBranch = binding.output_branch;
  const sliceRef = sliceBranch?.startsWith("refs/heads/") ? sliceBranch : `refs/heads/${sliceBranch}`;
  const runGit = deps.runGit ?? defaultRunGitAsync;
  const checkpoint = checkpointFromStatus(status);
  if (!Object.values(POST_WORKER_LIFECYCLE_PHASES).includes(checkpoint.phase)) {
    throw lifecycleFactError("post-worker lifecycle checkpoint carries an invalid phase",
      { phase: checkpoint.phase });
  }

  let hostRequested = false;

  if (checkpoint.phase === POST_WORKER_LIFECYCLE_PHASES.PRE_INTEGRATION &&
      checkpoint.failure_attempts > 0) {

    const liveContinuation = await resolveIntegrationContinuationSeam(deps, {
      subject: `${wkId}#${sliceId}`,
      status,
      live_completion_only: true
    });
    if (liveContinuation?.completed === true) {
      const deliverySha = await inspectSliceDelivery(
        runGit,
        workspace.dir,
        sliceRef,
        "post-worker lifecycle could not resolve the completed slice delivery"
      );
      const continuedIntegration = await consumeAuthenticatedIntegrationContinuation(
        liveContinuation,
        {
          wkId, sliceId, sliceRef, wkRef, reviewedSha: deliverySha,
          reconcile: () => reconcileIntegratedSlice({
            mainRepo: workspace.dir, binding, sliceRef, wkRef, runGit, deps
          })
        }
      );
      if (continuedIntegration !== null) {
        checkpoint.integration = continuedIntegration;
        checkpoint.phase = POST_WORKER_LIFECYCLE_PHASES.INTEGRATED;
      }
    }
  }

  if (checkpoint.phase === POST_WORKER_LIFECYCLE_PHASES.PRE_INTEGRATION) {

    const recovered = await reconcileIntegratedSlice({
      mainRepo: workspace.dir,
      binding,
      sliceRef,
      wkRef,
      runGit,
      deps
    });
    if (recovered) {
      const continuation = await resolveIntegrationContinuationSeam(deps, {
        subject: `${wkId}#${sliceId}`,
        status
      });
      const continuedIntegration = await consumeAuthenticatedIntegrationContinuation(continuation, {
        wkId,
        sliceId,
        sliceRef,
        wkRef,
        reviewedSha: recovered.delivery_sha,
        recovered
      });
      if (continuedIntegration !== null) {

        checkpoint.integration = continuedIntegration;
        checkpoint.phase = POST_WORKER_LIFECYCLE_PHASES.INTEGRATED;
      } else if (recordReconciliationOutstanding(recovered)) {

        checkpoint.integration = recovered;
        checkpoint.phase = POST_WORKER_LIFECYCLE_PHASES.INTEGRATED;
      } else {

      if (typeof deps.hostSliceIntegrationAdapter !== "function") {
        throw new Error("managed post-worker lifecycle requires the writable host slice integration adapter");
      }
      hostRequested = true;
      const trustedIntegration = assertIntegratedCleanupOnlyDelegation(
        await integrateThroughHost({
          status,
          bindings,
          adapter: deps.hostSliceIntegrationAdapter
        }),
        { wkId, sliceId }
      );
      if (trustedIntegration.slice_ref !== recovered.slice_ref ||
          trustedIntegration.slice_sha !== recovered.slice_sha ||
          trustedIntegration.wk_ref !== recovered.wk_ref ||
          trustedIntegration.wk_sha !== recovered.wk_sha ||
          (recovered.slice_sha !== recovered.wk_sha && trustedIntegration.review_target !== null) ||
          (trustedIntegration.review_target !== null && recovered.review_target !== null &&
            !sameReviewTarget(trustedIntegration.review_target, recovered.review_target))) {
        throw lifecycleFactError(
          "trusted runtime recovery result does not match the exact recovered integration marker",
          { trusted_integration: trustedIntegration, recovered }
        );
      }
      checkpoint.integration = Object.freeze({
        ...trustedIntegration,
        recovered: true,
        integrated_state: recovered.integrated_state
      });
      checkpoint.phase = POST_WORKER_LIFECYCLE_PHASES.INTEGRATED;
      }
    } else if (deps.recoveryOnly === true) {

      const recoveryCommit = await inspectSliceDelivery(
        runGit,
        workspace.dir,
        sliceRef,
        "post-worker recovery could not resolve the retained slice tip"
      );
      if (recoveryCommit !== binding.base_sha) return null;

      return await retireNoCommitAttempt({
        status,
        bindings,
        binding,
        sliceRef,
        sliceTipSha: recoveryCommit,
        deps
      });
    } else {

      const commit = await inspectSliceDelivery(
        runGit,
        workspace.dir,
        sliceRef,
        "post-worker lifecycle could not resolve the committed slice tip"
      );
      if (commit === binding.base_sha) {

        let retirementUnavailable = null;
        const retired = await retireNoCommitAttempt({
          status,
          bindings,
          binding,
          sliceRef,
          sliceTipSha: commit,
          deps,
          onUnavailable: (facts) => { retirementUnavailable = facts; }
        });
        if (retired !== null) return retired;

        throw lifecycleError(
          POST_WORKER_MISSING_DELIVERY_CODE,
          "managed worker terminated without an authenticated closed-input delivery and the exact proven-dead retirement could not be established; the launcher-bound slice ref is unchanged and any in-scope worktree delta is preserved for retry",
          {
            subject: `${wkId}#${sliceId}`,
            slice_ref: sliceRef,
            base_sha: binding.base_sha,
            slice_tip_sha: commit,
            retirement_unavailable: retirementUnavailable
          }
        );
      }

      if (typeof deps.hostSliceIntegrationAdapter !== "function") {
        throw new Error("managed post-worker lifecycle requires the writable host slice integration adapter");
      }
      hostRequested = true;
      checkpoint.integration = await integrateThroughHost({
        status,
        bindings,
        adapter: deps.hostSliceIntegrationAdapter
      });
      checkpoint.phase = POST_WORKER_LIFECYCLE_PHASES.INTEGRATED;
    }
  }

  if (checkpoint.phase === POST_WORKER_LIFECYCLE_PHASES.INTEGRATED &&
      recordReconciliationOutstanding(checkpoint.integration)) {
    await reconcileIntegratedRecord({
      checkpoint, hostRequested, status, bindings, binding, workspace, sliceRef, wkRef,
      runGit, deps, wkId, sliceId
    });
  }

  if (checkpoint.phase === POST_WORKER_LIFECYCLE_PHASES.FINALIZED) {
    if (checkpoint.finalized?.cleanup_pending === true) {
      checkpoint.finalized = await withDeliveryFinalization(checkpoint.finalized, {
        status,
        bindings,
        deps
      });
    }
    return checkpoint.finalized;
  }

  let integration = checkpoint.integration;

  const recoveredIntegratedState = integration?.recovered === true
    ? authenticateRecoveredIntegratedState(integration, { wkId, sliceId })
    : null;
  if (integration?.recovered === true && integration.review_target == null &&
      integration.slice_sha === integration.wk_sha && recoveredIntegratedState === null) {
    refuseRecoveredIntegratedState(integration, { wkId, sliceId }, "absent_integrated_state");
  }

  const finalIntegration = integration?.review_target != null ||
    recoveredIntegratedState === RECOVERED_INTEGRATED_STATES.FINAL;

  assertTerminalTargetOwnership(integration);

  let terminalCandidate = null;
  if (finalIntegration && integration.review_target != null &&
      typeof deps.prepareTerminalCandidate === "function") {

    try {
      terminalCandidate = await deps.prepareTerminalCandidate({
        integration,
        initiative,
        wkId,
        wkRef,
        baseSha: bindings.wk?.base_sha,
        baseRef: bindings.wk?.base_ref
      });
    } catch (error) {
      throw closeLifecycleSeamFailure(
        CLOSED_LIFECYCLE_FAILURE_SEAMS.TERMINAL_CANDIDATE_PREPARATION,
        error
      );
    }
    await verifyTerminalCandidateCycle({ terminalCandidate, runGit });
  }

  const finalized = await withDeliveryFinalization({
    invoked: true,
    phase: POST_WORKER_LIFECYCLE_PHASES.FINALIZED,
    integrated: true,
    wk_transitioned_to_review: finalIntegration,
    integration,
    ...(terminalCandidate === null ? {} : { terminal_candidate: terminalCandidate })
  }, { status, bindings, deps });
  checkpoint.finalized = finalized;
  checkpoint.phase = POST_WORKER_LIFECYCLE_PHASES.FINALIZED;
  return finalized;
}
