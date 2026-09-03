

import { defaultRunGitAsync } from "../../../agent-launch-cli/src/lib/worktree-substrate.mjs";
import { AUTHENTICATED_INTEGRATION_CONTINUATION } from
  "../../../agent-launch-cli/src/lib/workspace-agent-dispatch-backend-integration.mjs";
import { SLICE_INTEGRATION_DIAGNOSTIC_CODES } from
  "../../../agent-launch-cli/src/lib/slice-integration.mjs";
import { createTerminalCandidateReviewTarget } from
  "../../../agent-launch-cli/src/lib/backend-terminal-review-target-authority.mjs";

import { INTEGRATED_SLICE_CLEANUP_STATES } from
  "../../../agent-launch-cli/src/lib/trusted-slice-integration.mjs";
import {
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
  reconstructPolicyReviewTarget,
  sameReviewTarget
} from "./dispatch-post-worker-lifecycle-policy.mjs";
import {
  awaitingSliceReviewResult,
  POST_WORKER_MISSING_DELIVERY_CODE,
  prepareFreshTerminalSliceReviewSurface
} from "./dispatch-post-worker-lifecycle-review.mjs";
import {
  CLOSED_LIFECYCLE_FAILURE_SEAMS,
  closeLifecycleSeamFailure
} from "./dispatch-lifecycle-failure-projection.mjs";

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

const TERMINAL_CANDIDATE_VALIDATION_PROTOCOL_VIOLATION_CODE =
  "agent_launch.terminal_candidate_validation.evidence_protocol_violation.v1";

const INTEGRATED_CLEANUP_ONLY_STATES = new Set(Object.values(INTEGRATED_SLICE_CLEANUP_STATES));
const RECOVERED_INTEGRATION_REPLAYED_CODE =
  "agent_launch.slice_lifecycle.recovered_integration_replayed.v1";
const INTEGRATION_CONTINUATION_MISMATCH_CODE =
  "agent_launch.slice_lifecycle.integration_continuation_mismatch.v1";

export const REVIEWER_CLOSURE_TRANSPORTS = Object.freeze({
  MANAGED_TERMINAL_RESULT: "managed_terminal_result",
  STANDALONE_SUBMIT_FOR_REVIEW: "standalone_submit_for_review"
});
export const REVIEWER_CLOSURE_PLAN_SCHEMA_VERSION =
  "workspace-agent-reviewer-closure-plan.v1";
export const REVIEWER_CLOSURE_PLAN_INCOMPLETE_CODE =
  "agent_launch.reviewer_closure_plan.incomplete.v1";

const MANAGED_TERMINAL_RESULT_CLOSURE_FIELDS = Object.freeze([
  "repository", "role", "purpose", "subject", "reviewed_sha", "diff_base_sha",
  "controlled_generation"
]);
const STANDALONE_SUBMIT_CLOSURE_FIELDS = Object.freeze([
  "repository", "role", "purpose", "subject"
]);

export function planReviewerClosure(facts = {}) {
  const transport = facts.transport ?? null;
  if (!Object.values(REVIEWER_CLOSURE_TRANSPORTS).includes(transport)) {
    throw lifecycleError(
      REVIEWER_CLOSURE_PLAN_INCOMPLETE_CODE,
      "reviewer closure planning requires one supported completion transport",
      { correctable_field: "transport" }
    );
  }
  const managed = transport === REVIEWER_CLOSURE_TRANSPORTS.MANAGED_TERMINAL_RESULT;
  const required = managed
    ? MANAGED_TERMINAL_RESULT_CLOSURE_FIELDS
    : STANDALONE_SUBMIT_CLOSURE_FIELDS;
  const missing = required.find((field) =>
    facts[field] === undefined || facts[field] === null || facts[field] === "");
  if (missing !== undefined) {
    throw lifecycleError(
      REVIEWER_CLOSURE_PLAN_INCOMPLETE_CODE,
      "reviewer closure plan is structurally impossible for its completion transport",
      { transport, correctable_field: missing });
  }
  const unowned = managed
    ? []
    : ["controlled_generation"]
        .filter((field) => facts[field] !== undefined && facts[field] !== null);
  if (unowned.length > 0) {
    throw lifecycleError(
      REVIEWER_CLOSURE_PLAN_INCOMPLETE_CODE,
      "reviewer closure plan mints a fact its completion transport does not own",
      { transport, correctable_field: unowned[0] });
  }
  return Object.freeze({
    schema_version: REVIEWER_CLOSURE_PLAN_SCHEMA_VERSION,
    transport,
    repository: facts.repository,
    role: facts.role,
    purpose: facts.purpose,
    subject: facts.subject,
    ...(managed
      ? {
          reviewed_sha: facts.reviewed_sha,
          diff_base_sha: facts.diff_base_sha,
          controlled_generation: facts.controlled_generation,
          supported_continuation: "workspace_agent_run_status"
        }
      : {
          supported_continuation: "workspace_submit_for_review"
        })
  });
}

function findingsOnlyClosureIdentity(reviewUnit) {
  let redteam = false;
  try {
    redteam = JSON.parse(reviewUnit.review_unit_contract)?.work_kind === "redteam";
  } catch {
    redteam = false;
  }
  return redteam
    ? { role: "redteam", purpose: "technical_redteam" }
    : { role: "reviewer", purpose: "whole_wk_findings" };
}

export function planTerminalWholeWkClosure({
  repository,
  reviewUnit,
  reviewTarget,
  reviewContext,
  terminalCandidate
}) {
  if (terminalCandidate === null || terminalCandidate === undefined) {
    return planReviewerClosure({
      transport: REVIEWER_CLOSURE_TRANSPORTS.STANDALONE_SUBMIT_FOR_REVIEW,
      repository,

      ...findingsOnlyClosureIdentity(reviewUnit),
      subject: reviewUnit.subject
    });
  }
  return planReviewerClosure({
    transport: REVIEWER_CLOSURE_TRANSPORTS.MANAGED_TERMINAL_RESULT,
    repository,
    role: "reviewer",
    purpose: "terminal_whole_wk_candidate",
    subject: reviewUnit.subject,
    reviewed_sha: reviewTarget.candidate_sha ?? reviewTarget.sha,
    diff_base_sha: reviewTarget.diff_base_sha,
    controlled_generation:
      reviewContext?.terminal_candidate_version_decision?.controlled_generation ?? null
  });
}

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
        code: typeof error?.code === "string" ? error.code : null
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
  const runGit = deps.runGit ?? defaultRunGitAsync;
  const checkpoint = checkpointFromStatus(status);
  if (!Object.values(POST_WORKER_LIFECYCLE_PHASES).includes(checkpoint.phase)) {
    throw new Error("post-worker lifecycle checkpoint carries an invalid phase");
  }

  if (checkpoint.phase === POST_WORKER_LIFECYCLE_PHASES.PRE_INTEGRATION) {

    const recovered = await recoverIntegratedSliceResult({
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
      const trustedIntegration = assertIntegratedCleanupOnlyDelegation(
        await delegateSliceIntegrationToHost({
          status,
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

      const recoveryCommit = await resolvedCommit(
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

      const commit = await resolvedCommit(
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
        commit,
        runGit,

        planReviewerClosure,
        deps
      });
      checkpoint.phase = POST_WORKER_LIFECYCLE_PHASES.AWAITING_SLICE_REVIEW;
    }
  }

  if (checkpoint.phase === POST_WORKER_LIFECYCLE_PHASES.AWAITING_SLICE_REVIEW) {
    const sliceReview = checkpoint.slice_review;
    const continuation = await resolveIntegrationContinuationSeam(deps, {
      subject: sliceReview.review_subject,
      status
    });
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
    const integration = await delegateSliceIntegrationToHost({
      status,
      adapter: deps.hostSliceIntegrationAdapter
    });
    checkpoint.integration = integration;
    checkpoint.phase = POST_WORKER_LIFECYCLE_PHASES.INTEGRATED;
    }
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
        const reviewTarget = await reconstructPolicyReviewTarget({
          runGit,
          workspaceDir: workspace.dir,
          initiative,
          wkId,
          wkRef,
          wkSha: integration.wk_sha
        });
        integration = Object.freeze({ ...integration, review_target: reviewTarget });
        checkpoint.integration = integration;
      }
    }
  }

  if (integration && integration.review_target == null) {
    const dispatchable = await withDeliveryFinalization({
      invoked: true,
      phase: POST_WORKER_LIFECYCLE_PHASES.FINALIZED,
      integrated: true,
      wk_transitioned_to_review: false,
      integration,
      reviewer_dispatch: null
    }, { status, bindings, deps });
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
      throw closeLifecycleSeamFailure(
        CLOSED_LIFECYCLE_FAILURE_SEAMS.TERMINAL_CANDIDATE_PREPARATION,
        error
      );
    }
    await verifyTerminalCandidateCycle({ terminalCandidate, runGit });

    if (typeof deps.validateTerminalCandidate === "function") {
      let validated;
      try {
        validated = await deps.validateTerminalCandidate({ terminalCandidate, reviewUnit });
      } catch (error) {
        throw closeLifecycleSeamFailure(
          CLOSED_LIFECYCLE_FAILURE_SEAMS.TERMINAL_CANDIDATE_VALIDATION,
          error
        );
      }
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
    await verifyTerminalCandidateCycle({ terminalCandidate, runGit });
    integration = Object.freeze({
      ...integration,
      accumulated_wk_review_target: integration.review_target,
      review_target: await createTerminalCandidateReviewTarget({
        binding: terminalCandidate.binding,
        materialization: terminalCandidate.materialization,
        runGit
      })
    });
    checkpoint.integration = integration;
  }

  let materialization = terminalCandidate?.materialization ?? null;

  if (terminalCandidate === null) {
    materialization = await resolveTerminalReviewEvidence({
      deps,
      integration,
      bindings,
      status,
      wkRef,
      runGit,
      workspaceDir: workspace.dir
    });
  }
  if (terminalCandidate !== null) {
    await verifyTerminalCandidateCycle({ terminalCandidate, runGit });
  }

  let reviewContext;
  try {
    reviewContext = await deps.bindFrozenReviewContext({
      status,
      provisioning: bindings.provisioning,
      integration,
      reviewUnit,
      terminalCandidate,
      terminalCandidateValidations,
      runGit
    });
  } catch (error) {
    throw closeLifecycleSeamFailure(
      CLOSED_LIFECYCLE_FAILURE_SEAMS.FROZEN_REVIEW_CONTEXT_BINDING,
      error
    );
  }
  deps.markCommitAuthorityExercised?.();

  const closurePlan = planTerminalWholeWkClosure({
    repository: workspace.dir,
    reviewUnit,
    reviewTarget: integration.review_target,
    reviewContext,
    terminalCandidate
  });
  const finalized = await withDeliveryFinalization({
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
      args: Object.freeze({ role: closurePlan.role, subject: reviewUnit.subject }),

      closure_plan: closurePlan,
      context: Object.freeze({
        frozen_review_target: integration.review_target,
        terminal_review_materialization: materialization,
        complete_parent_wk_contract: true,
        accumulated_wk_diff: true,
        review_context_schema_version: reviewContext.schema_version
      })
    })
  }, { status, bindings, deps });
  checkpoint.finalized = finalized;
  checkpoint.phase = POST_WORKER_LIFECYCLE_PHASES.FINALIZED;
  return finalized;
}
