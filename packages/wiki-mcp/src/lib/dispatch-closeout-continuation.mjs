

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

function closeoutContinuation({ stage, decisionReason = null, orderedSteps, call = null }) {
  return Object.freeze({
    schema_version: CLOSEOUT_WORKFLOW_CONTINUATION_SCHEMA_VERSION,
    advisory: true,
    authority: "none",
    grants_authority: false,
    stage,
    decision_required: decisionReason !== null,
    ...(decisionReason === null ? {} : { decision_reason: decisionReason }),
    ordered_steps: Object.freeze(orderedSteps),
    ...(call === null ? {} : { current_safe_call: call })
  });
}

const TRUSTED_WHOLE_WK_FINDINGS_ROLES = Object.freeze(["reviewer", "redteam"]);

export async function buildCloseoutWorkflowContinuation({ dispatchBackend, status } = {}) {

  const terminalReviewSubject = typeof status?.subject === "string"
    ? status.subject.match(/^(WK-\d{4})#SLICE-\d{3}$/u)
    : null;
  if (!TRUSTED_WHOLE_WK_FINDINGS_ROLES.includes(status?.role) || status?.terminal !== true ||
      terminalReviewSubject === null ||
      typeof dispatchBackend?.resolveTerminalReviewPublicationState !== "function") {
    return null;
  }
  let publicationState = null;
  try {
    publicationState = await dispatchBackend.resolveTerminalReviewPublicationState(status.subject);
  } catch {
    return null;
  }
  if (publicationState?.version_decision?.state !== "selected" ||
      publicationState.binding?.canonical_wk_id !== terminalReviewSubject[1]) {
    return null;
  }

  const observedTarget = status.advisory_review_target ?? null;
  const reviewedCurrentCandidate = observedTarget !== null &&
    observedTarget.reviewed_sha === publicationState.binding.candidate &&
    observedTarget.base_sha === publicationState.binding.base &&
    status.final_result?.advisory_review?.advisory_output?.usable === true;
  return closeoutContinuation({
    stage: "forge_handoff_ready",
    decisionReason: "terminal_review_disposition_outstanding",
    orderedSteps: [
      closeoutStep(1, "terminal_whole_wk_review",
        reviewedCurrentCandidate ? "complete" : "not_established"),
      closeoutStep(2, "coordinator_disposition", "required"),
      closeoutStep(3, "workspace_wk_forge_handoff", "current")
    ],
    call: currentSafeCall(
      "workspace_wk_forge_handoff",
      { assigned_unit: terminalReviewSubject[1] },
      "trusted_terminal_candidate_state"
    )
  });
}
