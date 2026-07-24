

import { defaultRunGit } from "../../../agent-launch-cli/src/lib/worktree-substrate.mjs";
import { SLICE_INTEGRATION_DIAGNOSTIC_CODES } from
  "../../../agent-launch-cli/src/lib/slice-integration.mjs";
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

async function retireNoCommitAttempt({ status, bindings, binding, sliceRef, sliceTipSha, deps }) {
  let workerTuple = null;
  try {
    workerTuple = resolveRetainedManagedWorkerTuple({ status, bindings });
  } catch {
    return null;
  }
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

      if (typeof deps.hostSliceIntegrationAdapter !== "function") {
        throw new Error("managed post-worker lifecycle requires the writable host slice integration adapter");
      }
      let trustedIntegration;
      try {
        trustedIntegration = await delegateSliceIntegrationToHost({
          status,
          adapter: deps.hostSliceIntegrationAdapter
        });
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
          subject: sliceReview.review_subject
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

  if (checkpoint.phase === POST_WORKER_LIFECYCLE_PHASES.FINALIZED) {
    return checkpoint.finalized;
  }

  let integration = checkpoint.integration;

  if (integration?.recovered === true && integration.review_target == null &&
      integration.slice_sha === integration.wk_sha) {
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

    terminalCandidate = await deps.prepareTerminalCandidate({
      integration,
      reviewUnit,
      initiative,
      wkId,
      wkRef,
      baseSha: bindings.wk?.base_sha,
      baseRef: bindings.wk?.base_ref ?? "main"
    });
    verifyTerminalCandidateCycle({ terminalCandidate, runGit });
    if (typeof deps.validateTerminalCandidate !== "function") {
      throw new Error("terminal candidate lifecycle requires launcher-owned whole-WK validation");
    }
    terminalCandidateValidations = await deps.validateTerminalCandidate({
      terminalCandidate,
      reviewUnit
    });
    if (!Array.isArray(terminalCandidateValidations)) {
      throw new Error("terminal candidate lifecycle did not return advisory whole-WK validation evidence");
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
