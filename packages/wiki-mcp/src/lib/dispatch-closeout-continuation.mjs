

import {
  POST_WORKER_LIFECYCLE_PHASES
} from "./dispatch-post-worker-lifecycle-bindings.mjs";

export const CLOSEOUT_WORKFLOW_CONTINUATION_SCHEMA_VERSION =
  "workspace-agent-closeout-workflow-continuation.v1";

function closeoutStep(order, action, state) {
  return Object.freeze({ order, action, state });
}

function currentSafeCall(tool, callArguments, source) {
  return Object.freeze({
    tool,
    arguments: Object.freeze({ ...callArguments }),
    source
  });
}

function closeoutContinuation({ stage, decisionRequired, orderedSteps, call = null }) {
  return Object.freeze({
    schema_version: CLOSEOUT_WORKFLOW_CONTINUATION_SCHEMA_VERSION,
    advisory: true,
    authority: "none",
    grants_authority: false,
    stage,
    decision_required: decisionRequired === true,
    ...(decisionRequired === true
      ? { decision_reason: "canonical_review_changes_requested" }
      : {}),
    ordered_steps: Object.freeze(orderedSteps),
    ...(call === null ? {} : { current_safe_call: call })
  });
}

function trustedLifecycleDispatchCall(dispatch, { role, subject }) {
  if (dispatch?.tool !== "workspace_agent_dispatch" ||
      dispatch?.args?.role !== role || dispatch?.args?.subject !== subject) {
    return null;
  }
  return currentSafeCall(
    "workspace_agent_dispatch",
    { role, subject },
    "trusted_lifecycle"
  );
}

const TRUSTED_WHOLE_WK_FINDINGS_ROLES = Object.freeze(["reviewer", "redteam"]);

function trustedWholeWkFindingsRole(dispatch) {
  const role = dispatch?.args?.role;
  if (!TRUSTED_WHOLE_WK_FINDINGS_ROLES.includes(role) ||
      dispatch?.closure_plan?.role !== role ||
      dispatch?.closure_plan?.subject !== dispatch?.args?.subject) {
    return null;
  }
  return role;
}

function sliceReviewEvidenceState(evidence, sliceReview) {
  if (evidence?.schema_version !== "workspace-agent-slice-review-advisory-evidence.v1" ||
      evidence.authority !== "advisory_only" ||
      evidence.unit_address !== sliceReview?.review_subject ||
      evidence.slice_ref !== sliceReview?.slice_ref ||
      evidence.reviewed_sha !== sliceReview?.reviewed_sha ||
      evidence.diff_base_sha !== sliceReview?.diff_base_sha ||
      !Array.isArray(evidence.clean_review_run_ids) ||
      !Array.isArray(evidence.findings_review_run_ids)) {
    return Object.freeze({ review_complete: false, decision_required: false });
  }

  const changesRequested = evidence.findings_review_run_ids.length > 0;
  return Object.freeze({
    review_complete: changesRequested || evidence.clean_review_run_ids.length > 0,
    decision_required: changesRequested
  });
}

const CANONICAL_CLEAN_REVIEW_RESULT_FIELDS = Object.freeze([
  "blocking_finding_count",
  "clean_review",
  "medium_finding_count",
  "no_findings",
  "review_outcome",
  "reviewed_controls"
]);
const CANONICAL_CLEAN_REVIEW_OUTCOMES = Object.freeze([
  "no_findings",
  "passed_no_blocking_or_medium_findings"
]);

function isCanonicalCleanReviewResult(reviewResult) {
  if (reviewResult === null || typeof reviewResult !== "object" || Array.isArray(reviewResult) ||
      Object.keys(reviewResult).sort().join("|") !== CANONICAL_CLEAN_REVIEW_RESULT_FIELDS.join("|")) {
    return false;
  }
  return reviewResult.clean_review === true &&
    CANONICAL_CLEAN_REVIEW_OUTCOMES.includes(reviewResult.review_outcome) &&
    reviewResult.no_findings === (reviewResult.review_outcome === "no_findings") &&
    reviewResult.blocking_finding_count === 0 &&
    reviewResult.medium_finding_count === 0 &&
    Array.isArray(reviewResult.reviewed_controls) &&
    reviewResult.reviewed_controls.every((controlId) =>
      typeof controlId === "string" && controlId.length > 0) &&
    reviewResult.reviewed_controls.every((controlId, index) =>
      index === 0 || reviewResult.reviewed_controls[index - 1] < controlId);
}

function retainedTerminalReviewState(retainedReview) {
  if (retainedReview?.outcome === "changes_requested" &&
      retainedReview.review_result === null) {
    return Object.freeze({ decision_required: true, eligible_for_handoff: true });
  }
  if (retainedReview?.outcome === "clean" &&
      isCanonicalCleanReviewResult(retainedReview.review_result)) {
    return Object.freeze({ decision_required: false, eligible_for_handoff: true });
  }
  return null;
}

export async function buildCloseoutWorkflowContinuation({ dispatchBackend, status, lifecycle } = {}) {
  if (lifecycle?.phase === POST_WORKER_LIFECYCLE_PHASES.AWAITING_SLICE_REVIEW &&
      lifecycle?.slice_review?.review_subject === status?.subject) {
    const sliceReview = lifecycle.slice_review;

    const call = trustedLifecycleDispatchCall(lifecycle.reviewer_dispatch, {
      role: "reviewer",
      subject: sliceReview.review_subject
    });
    return closeoutContinuation({
      stage: "slice_review_required",
      decisionRequired: false,
      orderedSteps: [
        closeoutStep(1, "findings_only_slice_review", "current"),
        closeoutStep(2, "coordinator_disposition", "conditional"),
        closeoutStep(3, "workspace_integrate_committed_slice", "pending"),
        closeoutStep(4, "resume_original_worker_monitor", "pending")
      ],
      call
    });
  }

  if (lifecycle?.phase === POST_WORKER_LIFECYCLE_PHASES.FINALIZED &&
      lifecycle?.wk_transitioned_to_review === true &&
      lifecycle?.reviewer_dispatch?.args?.subject) {
    const reviewSubject = lifecycle.reviewer_dispatch.args.subject;

    const trustedRole = trustedWholeWkFindingsRole(lifecycle.reviewer_dispatch);
    const call = trustedRole === null
      ? null
      : trustedLifecycleDispatchCall(lifecycle.reviewer_dispatch, {
          role: trustedRole,
          subject: reviewSubject
        });
    if (call !== null) {
      return closeoutContinuation({
        stage: "terminal_whole_wk_review_required",
        decisionRequired: false,
        orderedSteps: [
          closeoutStep(1, "terminal_whole_wk_review", "current"),
          closeoutStep(2, "coordinator_disposition", "conditional"),
          closeoutStep(3, "workspace_wk_forge_handoff", "pending")
        ],
        call
      });
    }
  }

  const terminalReviewSubject = typeof status?.subject === "string"
    ? status.subject.match(/^(WK-\d{4})#SLICE-\d{3}$/u)
    : null;
  if (status?.role !== "reviewer" || status?.terminal !== true ||
      terminalReviewSubject === null ||
      typeof dispatchBackend?.resolveTerminalCandidatePublicationState !== "function") {
    return null;
  }
  let publicationState = null;
  try {
    publicationState = await dispatchBackend.resolveTerminalCandidatePublicationState(
      terminalReviewSubject[1]
    );
  } catch {
    return null;
  }
  const retainedReview = publicationState?.advisory_review_evidence?.reviews?.find((review) =>
    review?.run_id === status.run_id && review?.monitor_handle === status.monitor_handle &&
    review?.terminal === true && review?.provenance_valid === true);
  if (!retainedReview) return null;
  const findings = retainedTerminalReviewState(retainedReview);
  if (findings === null ||
      (findings.decision_required !== true && findings.eligible_for_handoff !== true)) {
    return null;
  }
  const decisionRequired = findings.decision_required === true;
  return closeoutContinuation({
    stage: "forge_handoff_ready",
    decisionRequired,
    orderedSteps: [
      closeoutStep(1, "terminal_whole_wk_review", "complete"),
      closeoutStep(2, "coordinator_disposition", decisionRequired ? "required" : "not_required"),
      closeoutStep(3, "workspace_wk_forge_handoff", "current")
    ],
    call: currentSafeCall(
      "workspace_wk_forge_handoff",
      { assigned_unit: terminalReviewSubject[1] },
      "trusted_terminal_review_state"
    )
  });
}
