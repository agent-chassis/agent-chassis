

import { defaultRunGit } from "../../../agent-launch-cli/src/lib/worktree-substrate.mjs";
import { AUTHENTICATED_INTEGRATION_CONTINUATION } from
  "../../../agent-launch-cli/src/lib/workspace-agent-dispatch-backend-integration.mjs";
import { SLICE_INTEGRATION_DIAGNOSTIC_CODES } from
  "../../../agent-launch-cli/src/lib/slice-integration.mjs";

import { INTEGRATED_SLICE_CLEANUP_STATES } from
  "../../../agent-launch-cli/src/lib/trusted-slice-integration.mjs";
import {
  classifyTerminalReviewPolicyRefusal,
  createTerminalCandidateReviewTarget,
  resolveTerminalReviewEvidence,
  verifyTerminalCandidateCycle
} from "./dispatch-terminal-review-evidence.mjs";
import {
  checkpointFromStatus,
  delegateSliceIntegrationToHost,
  lifecycleError,
  POST_WORKER_LIFECYCLE_PHASES,
  recoverIntegratedSliceResult,
  resolveManagedLifecycleBindings,
  resolvedCommit,
  resolveRetainedManagedWorkerTuple,
  WORKER_SLICE_SUBJECT_RE
} from "./dispatch-post-worker-lifecycle-bindings.mjs";
import {
  assertCanonicalReviewIdentity,
  assertTerminalTargetOwnership,
  finalizePolicyOnlyWithoutReviewer,
  policyLifecycleError,
  POLICY_LIFECYCLE_CODES,
  reconstructPolicyReviewTarget,
  restartMissingEvidenceCause,
  reviewEnforcementMode,
  REVIEW_ENFORCEMENT_MODES,
  sameReviewTarget
} from "./dispatch-post-worker-lifecycle-policy.mjs";
import {
  awaitingSliceReviewResult,
  POST_WORKER_MISSING_DELIVERY_CODE,
  prepareFreshTerminalSliceReviewSurface
} from "./dispatch-post-worker-lifecycle-review.mjs";
import {
  closeTerminalCandidatePreparationFailure
} from "./dispatch-lifecycle-failure-projection.mjs";

const TERMINAL_CANDIDATE_VALIDATION_PROTOCOL_VIOLATION_CODE =
  "agent_launch.terminal_candidate_validation.evidence_protocol_violation.v1";

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

function consumeAuthenticatedIntegrationContinuation(continuation, {
  wkId,
  sliceId,
  sliceRef,
  wkRef,
  reviewedSha,
  recovered = null
}) {
  if (continuation?.[AUTHENTICATED_INTEGRATION_CONTINUATION] !== true ||
      continuation.completed !== true || continuation.integration == null) {
    return null;
  }
  const integration = continuation.integration;
  const mismatches = [
    ["integrated", integration.integrated, true],
    ["continuation_reviewed_sha", continuation.reviewed_sha, reviewedSha],
    ["delivery_sha", integration.delivery_sha, reviewedSha],
    ["slice_ref", integration.slice_ref, sliceRef],
    ["wk_ref", integration.wk_ref, wkRef],
    ...(recovered === null ? [] : [
      ["recovered_delivery_sha", integration.delivery_sha, recovered.delivery_sha],
      ["recovered_slice_sha", integration.slice_sha, recovered.slice_sha],
      ["recovered_wk_sha", integration.wk_sha, recovered.wk_sha],
      ["recovered_integrated_state", integration.integrated_state, recovered.integrated_state]
    ])
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
        mismatched_fields: mismatches.map(([field]) => field)
      }
    );
  }
  return integration;
}

async function retireNoCommitAttempt({ status, bindings, binding, sliceRef, sliceTipSha, deps }) {
  const workerTuple = resolveRetainedManagedWorkerTuple({ status, bindings }) ?? null;
  const death = workerTuple !== null && typeof deps.resolveManagedWorkerProvenDeath === "function"
    ? deps.resolveManagedWorkerProvenDeath({ ...workerTuple })
    : null;

  if (death?.proven_dead !== true || typeof deps.retireManagedWorkerIdentity !== "function") {
    return null;
  }
  const retirement = await deps.retireManagedWorkerIdentity({
    ...workerTuple,
    reason: "no_commit_base_equal",
    evidence: {
      slice_ref: sliceRef,
      base_sha: binding.base_sha,
      slice_tip_sha: sliceTipSha
    }
  });
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
      retirement_reason: retirement?.reason ?? null
    }
  );
}

export async function runPostWorkerSliceLifecycleBody({ workspace, status, deps = {} } = {}) {
  const subject = typeof status?.subject === "string" ? status.subject.match(WORKER_SLICE_SUBJECT_RE) : null;
  if (status?.role !== "worker" || status?.terminal !== true || status?.status !== "succeeded" || !subject) {
    return null;
  }
  const bindings = resolveManagedLifecycleBindings({ workspaceDir: workspace.dir, status }, deps);
  const binding = bindings.slice;
  const [initiative, wkId, sliceId] = String(binding?.unit_address ?? "").split("/");
  if (wkId !== subject[1] || sliceId !== subject[2]) {
    throw new Error("post-worker lifecycle binding does not match the terminal worker subject");
  }
  const sliceBranch = binding.output_branch;
  const sliceRef = sliceBranch?.startsWith("refs/heads/") ? sliceBranch : `refs/heads/${sliceBranch}`;
  const wkRef = `refs/heads/wk/${initiative}/${wkId}`;
  const boundWkRef = bindings.wk?.output_branch?.startsWith("refs/heads/")
    ? bindings.wk.output_branch
    : `refs/heads/${bindings.wk?.output_branch ?? ""}`;
  if (boundWkRef !== wkRef) {
    throw new Error("post-worker lifecycle WK binding does not match the exact slice identity");
  }
  if (typeof deps.resolveCanonicalReviewUnit !== "function" ||
      typeof deps.bindFrozenReviewContext !== "function") {
    throw new Error("post-worker lifecycle requires backend-owned canonical review context composition");
  }

  let reviewUnit = null;
  const runGit = deps.runGit ?? defaultRunGit;
  const enforcementMode = reviewEnforcementMode(deps);
  const checkpoint = checkpointFromStatus(status);
  if (!Object.values(POST_WORKER_LIFECYCLE_PHASES).includes(checkpoint.phase)) {
    throw new Error("post-worker lifecycle checkpoint carries an invalid phase");
  }

  if (checkpoint.phase === POST_WORKER_LIFECYCLE_PHASES.PRE_INTEGRATION) {

    const recovered = recoverIntegratedSliceResult({
      mainRepo: workspace.dir,
      binding,
      sliceRef,
      wkRef,
      runGit,
      deps
    });
    if (recovered) {
      const continuation = typeof deps.resolveCommittedSliceIntegrationContinuation === "function"
        ? await deps.resolveCommittedSliceIntegrationContinuation({
            subject: `${wkId}#${sliceId}`,
            status
          })
        : null;
      const continuedIntegration = consumeAuthenticatedIntegrationContinuation(continuation, {
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
      } else {

      if (typeof deps.hostSliceIntegrationAdapter !== "function") {
        throw new Error("managed post-worker lifecycle requires the writable host slice integration adapter");
      }
      let trustedIntegration;
      try {
        trustedIntegration = assertIntegratedCleanupOnlyDelegation(
          await delegateSliceIntegrationToHost({
            status,
            adapter: deps.hostSliceIntegrationAdapter
          }),
          { wkId, sliceId }
        );
      } catch (error) {
        if (enforcementMode !== REVIEW_ENFORCEMENT_MODES.POLICY_ONLY) throw error;
        const cause = classifyTerminalReviewPolicyRefusal(error);
        if (cause === null) throw error;

        const independentlyRecovered = recoverIntegratedSliceResult({
          mainRepo: workspace.dir,
          binding,
          sliceRef,
          wkRef,
          runGit,
          deps
        });
        if (!independentlyRecovered) {
          throw policyLifecycleError(
            POLICY_LIFECYCLE_CODES.RECONCILIATION_FAILED,
            "known upstream terminal-review refusal could not reconcile the integrated slice",
            { cause_code: cause.code },
            error
          );
        }
        checkpoint.terminal_review_policy_cause = cause;
        trustedIntegration = independentlyRecovered;
      }
      if (trustedIntegration.slice_ref !== recovered.slice_ref ||
          trustedIntegration.slice_sha !== recovered.slice_sha ||
          trustedIntegration.wk_ref !== recovered.wk_ref ||
          trustedIntegration.wk_sha !== recovered.wk_sha ||
          (recovered.slice_sha !== recovered.wk_sha && trustedIntegration.review_target !== null) ||
          (trustedIntegration.review_target !== null && recovered.review_target !== null &&
            !sameReviewTarget(trustedIntegration.review_target, recovered.review_target))) {
        throw new Error("trusted runtime recovery result does not match the exact recovered integration marker");
      }
      checkpoint.integration = Object.freeze({
        ...trustedIntegration,
        recovered: true,
        integrated_state: recovered.integrated_state
      });
      checkpoint.phase = POST_WORKER_LIFECYCLE_PHASES.INTEGRATED;
      }
    } else if (deps.recoveryOnly === true) {

      const recoveryCommit = resolvedCommit(
        runGit,
        workspace.dir,
        sliceRef,
        "post-worker recovery could not resolve the retained slice tip",
        SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH
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

      const commit = resolvedCommit(
        runGit,
        workspace.dir,
        sliceRef,
        "post-worker lifecycle could not resolve the committed slice tip",
        SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH
      );
      if (commit === binding.base_sha) {

        const retired = await retireNoCommitAttempt({
          status,
          bindings,
          binding,
          sliceRef,
          sliceTipSha: commit,
          deps
        });
        if (retired !== null) return retired;

        throw lifecycleError(
          POST_WORKER_MISSING_DELIVERY_CODE,
          "managed worker terminated without an authenticated closed-input delivery and the exact proven-dead retirement could not be established; the launcher-bound slice ref is unchanged and any in-scope worktree delta is preserved for retry",
          {
            subject: `${wkId}#${sliceId}`,
            slice_ref: sliceRef,
            base_sha: binding.base_sha,
            slice_tip_sha: commit
          }
        );
      }

      checkpoint.slice_review = await prepareFreshTerminalSliceReviewSurface({
        workspaceDir: workspace.dir,
        status,
        bindings,
        binding,
        sliceRef,
        wkId,
        sliceId,
        runGit,
        deps
      });
      checkpoint.phase = POST_WORKER_LIFECYCLE_PHASES.AWAITING_SLICE_REVIEW;
    }
  }

  if (checkpoint.phase === POST_WORKER_LIFECYCLE_PHASES.AWAITING_SLICE_REVIEW) {
    const sliceReview = checkpoint.slice_review;
    const continuation = typeof deps.resolveCommittedSliceIntegrationContinuation === "function"
      ? await deps.resolveCommittedSliceIntegrationContinuation({
          subject: sliceReview.review_subject,
          status
        })
      : null;
    if (continuation?.completed !== true) {
      return awaitingSliceReviewResult(sliceReview, {
        reason: "coordinator_integration_request_required"
      });
    }
    if (continuation.reviewed_sha !== sliceReview.reviewed_sha) {
      return awaitingSliceReviewResult(sliceReview, {
        reason: "coordinator_integration_target_moved",
        accepted_sha: continuation.reviewed_sha
      });
    }
    const continuedIntegration = consumeAuthenticatedIntegrationContinuation(continuation, {
      wkId,
      sliceId,
      sliceRef,
      wkRef,
      reviewedSha: sliceReview.reviewed_sha
    });
    if (continuedIntegration !== null) {
      checkpoint.integration = continuedIntegration;
      checkpoint.phase = POST_WORKER_LIFECYCLE_PHASES.INTEGRATED;
    } else {

    if (typeof deps.hostSliceIntegrationAdapter !== "function") {
      throw new Error("managed post-worker lifecycle requires the writable host slice integration adapter");
    }
    let integration;
    try {
      integration = await delegateSliceIntegrationToHost({
        status,
        adapter: deps.hostSliceIntegrationAdapter
      });
    } catch (error) {
      if (enforcementMode !== REVIEW_ENFORCEMENT_MODES.POLICY_ONLY) throw error;
      const cause = classifyTerminalReviewPolicyRefusal(error);
      if (cause === null) throw error;
      integration = recoverIntegratedSliceResult({
        mainRepo: workspace.dir,
        binding,
        sliceRef,
        wkRef,
        runGit,
        deps
      });
      if (!integration) {
        throw policyLifecycleError(
          POLICY_LIFECYCLE_CODES.RECONCILIATION_FAILED,
          "known upstream terminal-review refusal could not reconcile the integrated slice",
          { cause_code: cause.code },
          error
        );
      }
      checkpoint.terminal_review_policy_cause = cause;
    }
    checkpoint.integration = integration;
    checkpoint.phase = POST_WORKER_LIFECYCLE_PHASES.INTEGRATED;
    }
  }

  if (checkpoint.phase === POST_WORKER_LIFECYCLE_PHASES.FINALIZED) {
    return checkpoint.finalized;
  }

  let integration = checkpoint.integration;

  const recoveredIntegratedState = integration?.recovered === true
    ? authenticateRecoveredIntegratedState(integration, { wkId, sliceId })
    : null;
  if (integration?.recovered === true && integration.review_target == null &&
      integration.slice_sha === integration.wk_sha) {

    if (recoveredIntegratedState === null) {
      refuseRecoveredIntegratedState(integration, { wkId, sliceId }, "absent_integrated_state");
    }
    if (recoveredIntegratedState === RECOVERED_INTEGRATED_STATES.FINAL) {
      const recoveredReviewUnit = assertCanonicalReviewIdentity(
        deps.resolveCanonicalReviewUnit({ mainRepo: workspace.dir, wkId }),
        { wkId, initiative }
      );
      if (recoveredReviewUnit.parent_status === "done") {
        const reviewTarget = reconstructPolicyReviewTarget({
          runGit,
          workspaceDir: workspace.dir,
          initiative,
          wkId,
          wkRef,
          wkSha: integration.wk_sha
        });
        integration = Object.freeze({ ...integration, review_target: reviewTarget });
        checkpoint.integration = integration;
        if (enforcementMode === REVIEW_ENFORCEMENT_MODES.POLICY_ONLY) {
          checkpoint.terminal_review_policy_cause ??= restartMissingEvidenceCause(integration);
        }
      }
    }
  }

  if (integration && integration.review_target == null) {
    const dispatchable = Object.freeze({
      invoked: true,
      phase: POST_WORKER_LIFECYCLE_PHASES.FINALIZED,
      integrated: true,
      wk_transitioned_to_review: false,
      integration,
      reviewer_dispatch: null
    });
    checkpoint.finalized = dispatchable;
    checkpoint.phase = POST_WORKER_LIFECYCLE_PHASES.FINALIZED;
    return dispatchable;
  }

  assertTerminalTargetOwnership(integration);

  reviewUnit = deps.resolveCanonicalReviewUnit({ mainRepo: workspace.dir, wkId });
  if (reviewUnit?.record_id !== wkId ||
      (reviewUnit?.initiative !== undefined && reviewUnit.initiative !== initiative)) {
    throw new Error("canonical review unit does not match the exact launcher WK identity");
  }
  let terminalCandidate = null;
  let terminalCandidateValidations = null;
  if (typeof deps.prepareTerminalCandidate === "function") {

    try {
      terminalCandidate = await deps.prepareTerminalCandidate({
        integration,
        reviewUnit,
        initiative,
        wkId,
        wkRef,
        baseSha: bindings.wk?.base_sha,
        baseRef: bindings.wk?.base_ref ?? "main"
      });
    } catch (error) {
      throw closeTerminalCandidatePreparationFailure(error);
    }
    verifyTerminalCandidateCycle({ terminalCandidate, runGit });

    if (typeof deps.validateTerminalCandidate === "function") {
      const validated = await deps.validateTerminalCandidate({ terminalCandidate, reviewUnit });
      if (!Array.isArray(validated)) {
        throw lifecycleError(
          TERMINAL_CANDIDATE_VALIDATION_PROTOCOL_VIOLATION_CODE,
          "composed terminal candidate validation returned a non-array advisory evidence result",
          {
            assigned_unit: `${wkId}#${sliceId}`,
            candidate_sha: terminalCandidate?.binding?.candidate ?? null,
            result_type: validated === null ? "null" : typeof validated
          }
        );
      }
      terminalCandidateValidations = validated;
    } else {
      terminalCandidateValidations = [];
    }
    verifyTerminalCandidateCycle({ terminalCandidate, runGit });
    integration = Object.freeze({
      ...integration,
      accumulated_wk_review_target: integration.review_target,
      review_target: createTerminalCandidateReviewTarget(terminalCandidate)
    });
    checkpoint.integration = integration;
  }

  let materialization = terminalCandidate?.materialization ?? null;

  let policyCause = terminalCandidate === null && enforcementMode === REVIEW_ENFORCEMENT_MODES.POLICY_ONLY
    ? checkpoint.terminal_review_policy_cause ?? null
    : null;
  if (policyCause === null && terminalCandidate === null) {
    try {
      materialization = resolveTerminalReviewEvidence({
        deps,
        integration,
        bindings,
        status,
        wkRef,
        runGit,
        workspaceDir: workspace.dir
      });
    } catch (error) {
      if (enforcementMode !== REVIEW_ENFORCEMENT_MODES.POLICY_ONLY) throw error;
      policyCause = classifyTerminalReviewPolicyRefusal(error);
      if (policyCause === null) throw error;
    }
  }
  if (policyCause !== null) {
    const finalized = await finalizePolicyOnlyWithoutReviewer({
      workspaceDir: workspace.dir,
      deps,
      binding,
      sliceRef,
      wkRef,
      runGit,
      integration,
      initiative,
      wkId,
      cause: policyCause
    });
    checkpoint.finalized = finalized;
    checkpoint.phase = POST_WORKER_LIFECYCLE_PHASES.FINALIZED;
    return finalized;
  }
  if (terminalCandidate !== null) {
    verifyTerminalCandidateCycle({ terminalCandidate, runGit });
  }
  const reviewContext = await deps.bindFrozenReviewContext({
    status,
    provisioning: bindings.provisioning,
    integration,
    reviewUnit,
    terminalCandidate,
    terminalCandidateValidations
  });
  deps.markCommitAuthorityExercised?.();
  const finalized = Object.freeze({
    invoked: true,
    phase: POST_WORKER_LIFECYCLE_PHASES.FINALIZED,
    integrated: true,
    wk_transitioned_to_review: true,
    integration,
    terminal_review_materialization: materialization,
    ...(terminalCandidate === null ? {} : {
      terminal_candidate: terminalCandidate,
      terminal_candidate_validations: terminalCandidateValidations
    }),
    reviewer_dispatch: Object.freeze({
      tool: "workspace_agent_dispatch",
      args: Object.freeze({ role: "reviewer", subject: reviewUnit.subject }),
      context: Object.freeze({
        frozen_review_target: integration.review_target,
        terminal_review_materialization: materialization,
        complete_parent_wk_contract: true,
        accumulated_wk_diff: true,
        review_context_schema_version: reviewContext.schema_version
      })
    }),
    review_result_evidence: Object.freeze({
      status_tool: "workspace_agent_run_status",
      wait_tool: "workspace_agent_run_wait"
    })
  });
  checkpoint.finalized = finalized;
  checkpoint.phase = POST_WORKER_LIFECYCLE_PHASES.FINALIZED;
  return finalized;
}
