

import {
  validateTemporalFinalStatus,
  validateTemporalHandoffEnvelope,
  validateTemporalLaunchRecord
} from "./temporal-contracts.mjs";
import {
  applyTemporalOperatorDecision,
  createTemporalWorkflowState,
  isTemporalTerminalWorkflowState,
  reduceTemporalWorkflowState
} from "./temporal-workflow-state.mjs";

export const TEMPORAL_WORKFLOW_RUNNER_SUPPORT_STATE = Object.freeze({
  state: "experimental_wip",
  supported: false,
  launch_surface: "not_supported",
  message:
    "The Temporal workflow runner is an experimental WIP launcher surface and is not a supported agent-launch launch surface."
});

const SUCCESS_STATES = new Set(["succeeded", "no_changes"]);
const FINAL_STATUS_EVENTS = Object.freeze({
  succeeded: "trusted_status_succeeded",
  no_changes: "trusted_status_no_changes",
  failed: "trusted_status_failed"
});
const SUCCESSFUL_GITHUB_CONCLUSION = "success";

export class TemporalWorkflowRunnerError extends Error {
  constructor(message, { code, errors = [], activity = null, state = null } = {}) {
    super(message);
    this.name = "TemporalWorkflowRunnerError";
    this.code = code;
    this.errors = errors;
    this.activity = activity;
    this.state = state;
  }
}

export async function runTemporalWorkflowAttempt({
  handoff,
  launchRecord,
  activities = {},
  state = createTemporalWorkflowState()
} = {}) {
  const context = {
    handoff,
    launchRecord,
    activities,
    state,
    steps: [],
    errors: []
  };

  const inputErrors = validateRunnerInput(handoff, launchRecord);
  if (inputErrors.length > 0) {
    reduceIntoContext(context, "input_invalid", {
      reason: "runner_input_invalid",
      validation_errors: inputErrors
    });
    context.errors = inputErrors;
    return runnerResult(context);
  }

  reduceIntoContext(context, "input_valid", {
    attempt_id: handoff.attempt_id,
    dispatch_idempotency_key: handoff.dispatch_idempotency_key,
    base_sha: handoff.base_sha,
    expected_launch_sha: launchRecord.launch_sha,
    output_branch: handoff.output_branch,
    launchRecord
  });
  if (shouldStop(context.state)) return runnerResult(context);

  reduceIntoContext(context, "dispatch_requested", {
    expected_launch_ref: launchRecord.launch_ref,
    expected_launch_sha: launchRecord.launch_sha
  });
  if (shouldStop(context.state)) return runnerResult(context);

  const launchOutcome = await callActivity(context, "createOrObserveLaunchRef", {
    handoff,
    launchRecord,
    state: context.state
  });
  applyLaunchOutcome(context, launchOutcome);
  if (shouldStop(context.state)) return runnerResult(context);

  reduceIntoContext(context, "observe_runs", {
    launch_ref: launchRecord.launch_ref,
    expected_run_name: launchRecord.github.run_name
  });
  if (shouldStop(context.state)) return runnerResult(context);

  const observation = await callActivity(context, "observeGitHubRun", {
    handoff,
    launchRecord,
    state: context.state
  });
  applyGitHubObservation(context, observation, launchRecord);
  if (shouldStop(context.state)) return runnerResult(context);

  if (context.state.state === "github_run_active") {
    const terminalRun = await callActivity(context, "awaitGitHubRunTerminal", {
      handoff,
      launchRecord,
      state: context.state
    });
    validateTerminalGitHubRunBinding(context, terminalRun);
    reduceIntoContext(context, "github_run_terminal", {
      github_run_id: terminalRun.github_run_id ?? context.state.github_run_id,
      conclusion: terminalRun.conclusion
    }, { activity: "awaitGitHubRunTerminal" });
  }
  if (shouldStop(context.state)) return runnerResult(context);

  const artifacts = await callActivity(context, "collectRunArtifacts", {
    handoff,
    launchRecord,
    state: context.state
  });
  applyArtifactCollection(context, artifacts);
  if (shouldStop(context.state)) return runnerResult(context);

  const finalStatusResult = await callActivity(context, "loadFinalStatus", {
    handoff,
    launchRecord,
    state: context.state,
    status_artifact_id: context.state.status_artifact_id
  });
  applyFinalStatus(context, finalStatusResult);

  return runnerResult(context);
}

export function applyTemporalWorkflowRunnerEvent(state, event) {
  const result = reduceTemporalWorkflowState(state, event);
  if (!result.ok) {
    throw new TemporalWorkflowRunnerError("Temporal workflow runner event was rejected", {
      code: "reducer_event_rejected",
      errors: result.errors,
      state: result.state
    });
  }
  return result;
}

export async function recordTemporalWorkflowOperatorDecision({
  state,
  decision,
  payload,
  activities = {}
}) {
  const result = applyTemporalOperatorDecision(state, decision, payload);
  if (!result.ok) {
    throw new TemporalWorkflowRunnerError("Temporal workflow operator decision was rejected", {
      code: "operator_decision_rejected",
      errors: result.errors,
      state: result.state
    });
  }

  if (typeof activities.recordOperatorDecision === "function") {
    await activities.recordOperatorDecision({ state, decision, payload });
  }

  return result;
}

export function buildTemporalRunnerExpectedContext({ launchRecord, state }) {
  return {
    validation_mode: "live",
    launchRecord,
    wrapper: launchRecord.wrapper,
    github_run_id: state.github_run_id
  };
}

function validateRunnerInput(handoff, launchRecord) {
  const errors = [];
  appendValidationErrors(errors, "handoff", validateTemporalHandoffEnvelope(handoff));
  appendValidationErrors(errors, "launchRecord", validateTemporalLaunchRecord(launchRecord));

  const handoffObject = asObject(handoff);
  const launchObject = asObject(launchRecord);
  if (!handoffObject || !launchObject) return errors;

  for (const key of [
    "initiative_id",
    "wk_id",
    "attempt_id",
    "dispatch_idempotency_key",
    "base_sha",
    "launch_ref",
    "output_branch"
  ]) {
    compareRunnerField(handoffObject[key], launchObject[key], `launchRecord.${key}`, errors);
  }
  compareRunnerField(handoffObject.github?.run_name, launchObject.github?.run_name, "launchRecord.github.run_name", errors);
  compareRunnerField(handoffObject.github?.workflow_ref, launchObject.github?.workflow_ref, "launchRecord.github.workflow_ref", errors);

  if (!asObject(launchObject.wrapper)) {
    errors.push(runnerError("launchRecord.wrapper", "required_binding_context", "Runner requires launch-record wrapper binding"));
  }
  if (!asObject(launchObject.github)) {
    errors.push(runnerError("launchRecord.github", "required_binding_context", "Runner requires launch-record GitHub binding"));
  }

  return errors;
}

function appendValidationErrors(errors, prefix, validation) {
  if (validation.valid) return;
  for (const item of validation.errors) {
    errors.push({
      ...item,
      path: item.path ? `${prefix}.${item.path}` : prefix
    });
  }
}

function compareRunnerField(actual, expected, path, errors) {
  if (actual === undefined || expected === undefined) {
    errors.push(runnerError(path, "required_binding_context", "Runner requires matching handoff and launch-record context"));
    return;
  }
  if (actual !== expected) {
    errors.push(runnerError(path, "handoff_launch_mismatch", "Launch record must match handoff context"));
  }
}

function applyLaunchOutcome(context, outcome) {
  const type = outcome?.type ?? outcome?.outcome;
  if (type === "created") {
    reduceIntoContext(context, "launch_ref_created", {
      observed_launch_sha: outcome.observed_launch_sha ?? context.launchRecord.launch_sha
    }, { activity: "createOrObserveLaunchRef" });
    return;
  }
  if (type === "exists_expected_sha") {
    reduceIntoContext(context, "launch_ref_exists_expected_sha", {
      observed_launch_sha: outcome.observed_launch_sha ?? context.launchRecord.launch_sha
    }, { activity: "createOrObserveLaunchRef" });
    return;
  }
  if (type === "exists_unexpected_sha") {
    reduceIntoContext(context, "launch_ref_exists_unexpected_sha", {
      observed_launch_sha: outcome.observed_launch_sha,
      expected_launch_sha: outcome.expected_launch_sha ?? context.launchRecord.launch_sha,
      evidence_packet_id: outcome.evidence_packet_id ?? null
    }, { activity: "createOrObserveLaunchRef" });
    return;
  }
  if (type === "unknown_unproven") {
    reduceIntoContext(context, "launch_ref_outcome_unknown_unproven", {
      last_error: outcome.last_error ?? "launch ref outcome could not be proven",
      evidence_packet_id: outcome.evidence_packet_id
    }, { activity: "createOrObserveLaunchRef" });
    return;
  }
  throw new TemporalWorkflowRunnerError("Unsupported launch-ref activity outcome", {
    code: "unsupported_launch_ref_outcome",
    activity: "createOrObserveLaunchRef"
  });
}

function applyGitHubObservation(context, observation, launchRecord) {
  const type = observation?.type ?? observation?.outcome;
  if (type === "zero_matches_timeout") {
    reduceIntoContext(context, "github_run_zero_matches_timeout", {
      launch_ref: observation.launch_ref ?? launchRecord.launch_ref,
      observation_window: observation.observation_window
    }, { activity: "observeGitHubRun" });
    return;
  }
  if (type === "one_active") {
    reduceIntoContext(context, "github_run_one_active", {
      github_run_id: observation.github_run_id,
      run_url: observation.run_url
    }, { activity: "observeGitHubRun" });
    return;
  }
  if (type === "one_terminal") {
    reduceIntoContext(context, "github_run_one_terminal", {
      github_run_id: observation.github_run_id,
      conclusion: observation.conclusion,
      run_url: observation.run_url
    }, { activity: "observeGitHubRun" });
    return;
  }
  if (type === "multiple_matches") {
    reduceIntoContext(context, "github_run_multiple_matches", {
      matching_run_ids: observation.matching_run_ids,
      evidence_packet_id: observation.evidence_packet_id ?? null
    }, { activity: "observeGitHubRun" });
    return;
  }
  throw new TemporalWorkflowRunnerError("Unsupported GitHub observation outcome", {
    code: "unsupported_github_observation_outcome",
    activity: "observeGitHubRun"
  });
}

function validateTerminalGitHubRunBinding(context, terminalRun) {
  if (context.state.github_run_id === undefined || context.state.github_run_id === null) return;
  if (terminalRun?.github_run_id === context.state.github_run_id) return;

  throw new TemporalWorkflowRunnerError("Temporal workflow runner activity payload was rejected", {
    code: "invalid_activity_payload",
    activity: "awaitGitHubRunTerminal",
    errors: [
      runnerError(
        "awaitGitHubRunTerminal.github_run_id",
        "github_run_id_mismatch",
        "Terminal GitHub run id must match the previously observed active run id"
      )
    ],
    state: context.state
  });
}

function applyArtifactCollection(context, artifacts) {
  const type = artifacts?.type ?? artifacts?.outcome;
  if (type === "collected") {
    reduceIntoContext(context, "artifacts_collected", {
      status_artifact_id: artifacts.status_artifact_id,
      response_artifact_id: artifacts.response_artifact_id
    }, { activity: "collectRunArtifacts" });
    return;
  }
  if (type === "missing") {
    reduceIntoContext(context, "artifacts_missing", {
      missing_artifacts: artifacts.missing_artifacts
    }, { activity: "collectRunArtifacts" });
    return;
  }
  throw new TemporalWorkflowRunnerError("Unsupported artifact collection outcome", {
    code: "unsupported_artifact_collection_outcome",
    activity: "collectRunArtifacts"
  });
}

function applyFinalStatus(context, finalStatusResult) {
  const finalStatus = finalStatusResult?.final_status ?? finalStatusResult?.status ?? finalStatusResult;
  const trustedOriginErrors = validateTrustedWrapperOriginProof(context, finalStatusResult);
  if (trustedOriginErrors.length > 0) {
    reduceIntoContext(context, "status_invalid_or_untrusted", {
      reason: finalStatusResult?.reason ?? "status_untrusted",
      validation_errors: [
        ...validationErrorsFromFinalStatusResult(finalStatusResult),
        ...trustedOriginErrors
      ]
    });
    return;
  }

  const expectedContext = buildTemporalRunnerExpectedContext({
    launchRecord: context.launchRecord,
    state: context.state
  });
  const validation = validateTemporalFinalStatus(finalStatus, expectedContext);
  if (!validation.valid) {
    reduceIntoContext(context, "status_invalid_or_untrusted", {
      reason: "status_schema_invalid",
      validation_errors: validation.errors
    });
    return;
  }

  const eventName = FINAL_STATUS_EVENTS[finalStatus.result];
  if (!eventName) {
    reduceIntoContext(context, "status_invalid_or_untrusted", {
      reason: "unsupported_final_status_result",
      validation_errors: [
        runnerError("final_status.result", "unsupported_result", "Runner cannot close attempt with this final status result")
      ]
    });
    return;
  }

  if (
    (finalStatus.result === "succeeded" || finalStatus.result === "no_changes") &&
    context.state.conclusion !== SUCCESSFUL_GITHUB_CONCLUSION
  ) {
    reduceIntoContext(context, "status_invalid_or_untrusted", {
      reason: "github_run_conclusion_not_success",
      validation_errors: [
        runnerError(
          "github_run.conclusion",
          "github_run_conclusion_not_success",
          "Trusted succeeded or no_changes status requires observed successful GitHub run conclusion"
        )
      ]
    });
    return;
  }

  reduceIntoContext(context, eventName, {
    final_status: finalStatus,
    expected_context: expectedContext
  }, { activity: "loadFinalStatus" });
}

async function callActivity(context, name, input) {
  const activity = context.activities[name];
  if (typeof activity !== "function") {
    throw new TemporalWorkflowRunnerError(`Missing Temporal workflow runner activity: ${name}`, {
      code: "missing_activity",
      activity: name,
      state: context.state
    });
  }
  const result = await activity(input);
  context.steps.push({
    type: "activity",
    name,
    result: clone(result)
  });
  return result;
}

function reduceIntoContext(context, event, payload, { activity = null } = {}) {
  const result = reduceTemporalWorkflowState(context.state, {
    type: event,
    payload
  });
  context.steps.push({
    type: "reducer",
    event,
    ok: result.ok,
    transition: clone(result.transition),
    reconciliation_record: clone(result.reconciliation_record),
    emitted_record: clone(result.emitted_record),
    errors: clone(result.errors)
  });
  if (!result.ok) {
    if (activity) {
      throw new TemporalWorkflowRunnerError("Temporal workflow runner activity payload was rejected", {
        code: "invalid_activity_payload",
        activity,
        errors: result.errors,
        state: result.state
      });
    }
    throw new TemporalWorkflowRunnerError("Temporal workflow runner reducer transition was rejected", {
      code: "reducer_transition_rejected",
      errors: result.errors,
      state: result.state
    });
  }
  context.state = result.state;
  return result;
}

function validateTrustedWrapperOriginProof(context, finalStatusResult) {
  const errors = [];
  const result = asObject(finalStatusResult);
  if (!result) {
    return [
      runnerError("loadFinalStatus", "required_trusted_wrapper_origin", "Final status must be returned in a trusted wrapper envelope")
    ];
  }
  if (result.trusted !== true) {
    errors.push(runnerError("loadFinalStatus.trusted", "required_trusted_wrapper_origin", "Final status requires positive trusted-wrapper proof"));
  }

  const proof = asObject(result.trusted_wrapper_origin ?? result.trustedWrapperOrigin);
  if (!proof) {
    errors.push(runnerError("loadFinalStatus.trusted_wrapper_origin", "required_trusted_wrapper_origin", "Final status requires trusted-wrapper origin proof"));
    return errors;
  }

  compareProofField(proof.source, context.launchRecord.wrapper?.source, "loadFinalStatus.trusted_wrapper_origin.source", errors);
  compareProofField(proof.digest, context.launchRecord.wrapper?.digest, "loadFinalStatus.trusted_wrapper_origin.digest", errors);
  compareProofField(proof.github_run_id, context.state.github_run_id, "loadFinalStatus.trusted_wrapper_origin.github_run_id", errors);
  compareProofField(proof.status_artifact_id, context.state.status_artifact_id, "loadFinalStatus.trusted_wrapper_origin.status_artifact_id", errors);
  return errors;
}

function compareProofField(actual, expected, path, errors) {
  if (typeof actual !== "string" || actual.trim() === "") {
    errors.push(runnerError(path, "required_trusted_wrapper_origin", "Trusted-wrapper origin proof requires binding field"));
    return;
  }
  if (expected !== undefined && actual !== expected) {
    errors.push(runnerError(path, "trusted_wrapper_origin_mismatch", "Trusted-wrapper origin proof must match current attempt context"));
  }
}

function validationErrorsFromFinalStatusResult(finalStatusResult) {
  return Array.isArray(finalStatusResult?.validation_errors)
    ? finalStatusResult.validation_errors
    : [];
}

function runnerResult(context) {
  return {
    ok: SUCCESS_STATES.has(context.state.state),
    completed: isTemporalTerminalWorkflowState(context.state) || context.state.state === "operator_reconciliation_required",
    state: context.state,
    steps: context.steps,
    errors: context.errors
  };
}

function shouldStop(state) {
  return isTemporalTerminalWorkflowState(state) || state.state === "operator_reconciliation_required";
}

function runnerError(path, code, message) {
  return { path, code, message };
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}
