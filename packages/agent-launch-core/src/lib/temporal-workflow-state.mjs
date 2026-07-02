

import { validateTemporalFinalStatus } from "./temporal-contracts.mjs";

export const TEMPORAL_WORKFLOW_STATE_SUPPORT_STATE = Object.freeze({
  state: "experimental_wip",
  supported: false,
  launch_surface: "not_supported",
  message:
    "Temporal workflow state is an experimental WIP launcher surface and is not a supported agent-launch launch surface."
});

export const TEMPORAL_WORKFLOW_STATES = Object.freeze([
  "input_validating",
  "ready_to_dispatch",
  "launch_ref_creating",
  "launch_ref_created",
  "dispatch_uncertain",
  "github_run_observing",
  "github_run_active",
  "artifact_collecting",
  "status_validating",
  "succeeded",
  "no_changes",
  "failed",
  "cancel_requested",
  "cancel_observing",
  "cancelled",
  "superseded",
  "inconclusive",
  "operator_reconciliation_required"
]);

export const TEMPORAL_TERMINAL_WORKFLOW_STATES = Object.freeze([
  "succeeded",
  "no_changes",
  "failed",
  "cancelled",
  "superseded",
  "inconclusive"
]);

export const TEMPORAL_RECONCILIATION_REASONS = Object.freeze([
  "launch_ref_unexpected_sha",
  "dispatch_uncertain",
  "github_run_missing",
  "github_run_ambiguous",
  "artifact_missing",
  "status_untrusted",
  "status_schema_invalid",
  "wrapper_digest_mismatch",
  "output_branch_unexpected_ref",
  "commit_unverifiable",
  "temporal_github_disagreement",
  "cancelled_but_output_completed",
  "superseded_but_output_completed",
  "operator_requested_review"
]);

const STATES = new Set(TEMPORAL_WORKFLOW_STATES);
const TERMINAL_STATES = new Set(TEMPORAL_TERMINAL_WORKFLOW_STATES);
const RECONCILIATION_REASONS = new Set(TEMPORAL_RECONCILIATION_REASONS);
const SUCCESS_TERMINAL_STATES = new Set(["succeeded", "no_changes"]);
const NON_SUCCESS_TERMINAL_STATES = new Set(["failed", "cancelled", "superseded", "inconclusive"]);
const VALIDATION_MODES = new Set(["live", "dry_run"]);
const GITHUB_RUN_ID_EVENTS = new Set([
  "github_run_one_active",
  "github_run_one_terminal",
  "github_run_terminal"
]);
const WRITE_ONCE_WRAPPER_BINDING_FIELDS = new Set([
  "expected_wrapper_source",
  "expected_wrapper_digest"
]);
const BINDING_LAUNCH_RECORD_FIELDS = Object.freeze([
  "initiative_id",
  "wk_id",
  "attempt_id",
  "dispatch_idempotency_key",
  "base_sha",
  "output_branch",
  "launch_ref",
  "launch_sha"
]);

const TRANSITIONS = Object.freeze([
  transition("input_validating", "input_valid", ["attempt_id", "dispatch_idempotency_key", "base_sha", "expected_launch_sha"], "ready_to_dispatch", {
    persist: ["attempt_id", "dispatch_idempotency_key", "base_sha", "expected_launch_sha"]
  }),
  transition("input_validating", "input_invalid", ["reason", "validation_errors"], "failed"),
  transition("ready_to_dispatch", "dispatch_requested", ["expected_launch_ref", "expected_launch_sha"], "launch_ref_creating", {
    persist: ["expected_launch_ref"]
  }),
  transition("launch_ref_creating", "launch_ref_created", ["observed_launch_sha"], "launch_ref_created", {
    requireObservedLaunchSha: true
  }),
  transition("launch_ref_creating", "launch_ref_exists_expected_sha", ["observed_launch_sha"], "launch_ref_created", {
    requireObservedLaunchSha: true
  }),
  transition(
    "launch_ref_creating",
    "launch_ref_exists_unexpected_sha",
    ["observed_launch_sha", "expected_launch_sha"],
    "operator_reconciliation_required",
    { reconciliationReason: "launch_ref_unexpected_sha" }
  ),
  transition(
    "launch_ref_creating",
    "launch_ref_outcome_unknown_unproven",
    ["last_error", "evidence_packet_id"],
    "operator_reconciliation_required",
    { reconciliationReason: "dispatch_uncertain" }
  ),
  transition("launch_ref_created", "observe_runs", ["launch_ref", "expected_run_name"], "github_run_observing", {
    persist: ["launch_ref", "expected_run_name"]
  }),
  transition(
    "github_run_observing",
    "github_run_zero_matches_timeout",
    ["launch_ref", "observation_window"],
    "operator_reconciliation_required",
    { reconciliationReason: "github_run_missing" }
  ),
  transition("github_run_observing", "github_run_one_active", ["github_run_id", "run_url"], "github_run_active", {
    persist: ["github_run_id", "run_url"]
  }),
  transition("github_run_observing", "github_run_one_terminal", ["github_run_id", "conclusion", "run_url"], "artifact_collecting", {
    persist: ["github_run_id", "run_url", "conclusion"]
  }),
  transition(
    "github_run_observing",
    "github_run_multiple_matches",
    ["matching_run_ids"],
    "operator_reconciliation_required",
    { reconciliationReason: "github_run_ambiguous" }
  ),
  transition("github_run_active", "github_run_terminal", ["github_run_id", "conclusion"], "artifact_collecting", {
    persist: ["github_run_id", "conclusion"]
  }),
  transition("artifact_collecting", "artifacts_collected", ["status_artifact_id", "response_artifact_id"], "status_validating", {
    persist: ["status_artifact_id", "response_artifact_id"]
  }),
  transition("artifact_collecting", "artifacts_missing", ["missing_artifacts"], "inconclusive", {
    reconciliationReason: "artifact_missing",
    emitOnly: true
  }),
  transition("status_validating", "trusted_status_succeeded", ["final_status"], "succeeded", {
    finalStatusResult: "succeeded"
  }),
  transition("status_validating", "trusted_status_no_changes", ["final_status"], "no_changes", {
    finalStatusResult: "no_changes"
  }),
  transition("status_validating", "trusted_status_failed", ["final_status"], "failed", {
    finalStatusResult: "failed"
  }),
  transition("status_validating", "status_invalid_or_untrusted", ["reason", "validation_errors"], "inconclusive"),
  transition("cancel_requested", "cancel_observed_no_trusted_output", ["cancellation_evidence"], "cancelled"),
  transition("cancel_requested", "late_trusted_output_observed", ["trusted_status_evidence"], "cancelled", {
    reconciliationReason: "cancelled_but_output_completed"
  }),
  transition("cancel_observing", "cancel_observed_no_trusted_output", ["cancellation_evidence"], "cancelled"),
  transition("cancel_observing", "late_trusted_output_observed", ["trusted_status_evidence"], "cancelled", {
    reconciliationReason: "cancelled_but_output_completed"
  })
]);

const TRANSITIONS_BY_KEY = new Map(
  TRANSITIONS.map((item) => [`${item.source}:${item.event}`, item])
);

const OPERATOR_DECISIONS = Object.freeze({
  retry_same_attempt_observe_only: {
    required: ["operator_id", "reason", "evidence_packet_id", "observed_launch_sha"]
  },
  retry_new_attempt: {
    required: ["new_attempt_id", "new_dispatch_idempotency_key", "new_launch_ref", "new_output_branch", "operator_id", "reason"]
  },
  mark_failed: {
    required: ["operator_id", "reason", "evidence_packet_id", "failure_code"]
  },
  mark_inconclusive: {
    required: ["operator_id", "reason", "evidence_packet_id", "conflict_code"]
  },
  accept_late_output: {
    required: [
      "operator_id",
      "risk_acceptance_reason",
      "trusted_status_artifact_id",
      "github_run_id",
      "output_branch",
      "replacement_or_supersession_target"
    ]
  },
  abandon: {
    required: ["operator_id", "reason", "evidence_packet_id", "terminal_disposition"]
  }
});

export class TemporalWorkflowStateError extends Error {
  constructor(errors) {
    super(errors.map((item) => `${item.path}: ${item.code}`).join(", "));
    this.name = "TemporalWorkflowStateError";
    this.errors = errors;
  }
}

export function createTemporalWorkflowState(overrides = {}) {
  return normalizeState({
    state: "input_validating",
    reconciliation_records: [],
    operator_decisions: [],
    emitted_records: [],
    ...overrides
  });
}

export function isTemporalTerminalWorkflowState(state) {
  return TERMINAL_STATES.has(getStateName(state));
}

export function reduceTemporalWorkflowState(current, event) {
  const state = normalizeState(current);
  const payload = asObject(event?.payload) ?? {};
  const eventName = event?.type ?? event?.event;
  const baseErrors = [];

  if (!STATES.has(state.state)) {
    baseErrors.push(error("state", "unknown_state", "Unknown Temporal workflow state"));
  }
  if (typeof eventName !== "string" || eventName.trim() === "") {
    baseErrors.push(error("event.type", "expected_string", "Expected non-empty event type"));
  }
  if (baseErrors.length > 0) return rejected(state, baseErrors);

  if (eventName === "operator_decision") {
    return applyTemporalOperatorDecision(state, event?.decision ?? payload.decision, payload);
  }

  const postTerminal = reducePostTerminalEvent(state, eventName, payload);
  if (postTerminal) return postTerminal;

  if (TERMINAL_STATES.has(state.state)) {
    return rejected(state, [
      error("state", "terminal_state_immutable", "Terminal attempt states cannot transition")
    ]);
  }

  const cancellation = reduceCancellation(state, eventName, payload);
  if (cancellation) return cancellation;

  const supersession = reduceSupersession(state, eventName, payload);
  if (supersession) return supersession;

  const spec = TRANSITIONS_BY_KEY.get(`${state.state}:${eventName}`);
  if (!spec) {
    return rejected(state, [
      error("event.type", "illegal_transition", `Illegal transition from ${state.state} using ${eventName}`)
    ]);
  }

  const validationErrors = validateRequiredPayload(payload, spec.required);
  validateTransitionPayload(state, payload, spec, validationErrors);
  if (validationErrors.length > 0) return rejected(state, validationErrors);

  return accepted(state, eventName, payload, spec.next, {
    persist: spec.persist,
    reconciliationReason: spec.reconciliationReason,
    emitOnly: spec.emitOnly
  });
}

export function applyTemporalOperatorDecision(current, decision, payload = {}) {
  const state = normalizeState(current);
  const decisionName = decision ?? payload.decision;
  const spec = OPERATOR_DECISIONS[decisionName];

  if (!spec) {
    return rejected(state, [
      error("decision", "unsupported_operator_decision", "Unsupported operator decision")
    ]);
  }

  const validationErrors = validateRequiredPayload(payload, spec.required);
  validateOperatorDecisionPayload(state, decisionName, payload, validationErrors);
  if (validationErrors.length > 0) return rejected(state, validationErrors);

  const decisionRecord = {
    type: "operator_decision",
    decision: decisionName,
    source_state: state.state,
    operator_id: payload.operator_id,
    reason: payload.reason ?? payload.risk_acceptance_reason,
    evidence_packet_id: payload.evidence_packet_id ?? null,
    payload: clone(payload)
  };

  if (decisionName === "retry_same_attempt_observe_only") {
    return accepted(state, "operator_decision", payload, "github_run_observing", {
      operatorDecision: decisionRecord,
      persist: ["observed_launch_sha"]
    });
  }

  if (decisionName === "retry_new_attempt") {
    const next = TERMINAL_STATES.has(state.state)
      ? state.state
      : payload.superseded_attempt_id
        ? "superseded"
        : "failed";
    return accepted(state, "operator_decision", payload, next, {
      operatorDecision: decisionRecord,
      emittedRecord: {
        type: "new_attempt_requested",
        new_attempt_id: payload.new_attempt_id,
        new_dispatch_idempotency_key: payload.new_dispatch_idempotency_key,
        new_launch_ref: payload.new_launch_ref,
        new_output_branch: payload.new_output_branch,
        old_attempt_id: state.attempt_id ?? payload.superseded_attempt_id ?? payload.abandoned_attempt_id,
        disposition: next
      }
    });
  }

  if (decisionName === "mark_failed") {
    return accepted(state, "operator_decision", payload, "failed", {
      operatorDecision: decisionRecord
    });
  }

  if (decisionName === "mark_inconclusive") {
    return accepted(state, "operator_decision", payload, "inconclusive", {
      operatorDecision: decisionRecord
    });
  }

  if (decisionName === "accept_late_output") {
    return accepted(state, "operator_decision", payload, state.state, {
      operatorDecision: decisionRecord,
      emittedRecord: {
        type: "accepted_late_output_integration_candidate",
        source_state: state.state,
        github_run_id: payload.github_run_id,
        output_branch: payload.output_branch,
        commit_sha: payload.commit_sha ?? null,
        no_change_ref_evidence: payload.no_change_ref_evidence ?? null,
        replacement_or_supersession_target: payload.replacement_or_supersession_target
      }
    });
  }

  if (decisionName === "abandon") {
    if (state.state === "operator_reconciliation_required") {
      return accepted(state, "operator_decision", payload, payload.terminal_disposition, {
        operatorDecision: decisionRecord
      });
    }
    return accepted(state, "operator_decision", payload, state.state, {
      operatorDecision: decisionRecord,
      emittedRecord: {
        type: "late_output_abandoned",
        terminal_disposition: payload.terminal_disposition,
        evidence_packet_id: payload.evidence_packet_id
      }
    });
  }

  return rejected(state, [
    error("decision", "unsupported_operator_decision", "Unsupported operator decision")
  ]);
}

export function assertTemporalWorkflowReduction(result) {
  if (result?.ok) return result.state;
  throw new TemporalWorkflowStateError(result?.errors ?? [
    error("", "invalid_reduction_result", "Expected reducer result")
  ]);
}

function transition(source, event, required, next, options = {}) {
  return { source, event, required, next, ...options };
}

function reducePostTerminalEvent(state, eventName, payload) {
  if (!TERMINAL_STATES.has(state.state)) return null;

  if (
    eventName === "late_trusted_output_observed" &&
    (state.state === "cancelled" || state.state === "superseded")
  ) {
    const validationErrors = validateRequiredPayload(payload, ["trusted_status_evidence"]);
    if (validationErrors.length > 0) return rejected(state, validationErrors);
    return accepted(state, eventName, payload, state.state, {
      reconciliationReason: state.state === "cancelled"
        ? "cancelled_but_output_completed"
        : "superseded_but_output_completed"
    });
  }

  if (
    eventName === "post_terminal_evidence_conflict" &&
    (state.state === "succeeded" || state.state === "no_changes" || state.state === "failed" || state.state === "inconclusive")
  ) {
    const validationErrors = validateRequiredPayload(payload, ["conflict_evidence"]);
    if (validationErrors.length > 0) return rejected(state, validationErrors);
    return accepted(state, eventName, payload, state.state, {
      reconciliationReason: "temporal_github_disagreement"
    });
  }

  return null;
}

function reduceCancellation(state, eventName, payload) {
  if (eventName !== "cancel_requested") return null;
  const validationErrors = validateRequiredPayload(payload, ["operator_or_signal_id", "reason"]);
  if (validationErrors.length > 0) return rejected(state, validationErrors);

  if (state.state === "input_validating" || state.state === "ready_to_dispatch") {
    return accepted(state, eventName, payload, "cancelled");
  }

  if (state.state === "launch_ref_creating") {
    return accepted(state, eventName, payload, "cancel_requested", {
      persist: ["known_github_run_id"]
    });
  }

  if ([
    "launch_ref_created",
    "github_run_observing",
    "github_run_active",
    "artifact_collecting",
    "status_validating"
  ].includes(state.state)) {
    return accepted(state, eventName, payload, "cancel_observing", {
      persist: ["known_github_run_id"]
    });
  }

  return rejected(state, [
    error("event.type", "illegal_transition", `Illegal transition from ${state.state} using ${eventName}`)
  ]);
}

function reduceSupersession(state, eventName, payload) {
  if (eventName !== "supersede_requested") return null;
  const validationErrors = validateRequiredPayload(payload, [
    "new_attempt_id",
    "new_dispatch_idempotency_key",
    "new_launch_ref",
    "new_output_branch",
    "reason"
  ]);
  validateNewAttemptPayload(state, payload, validationErrors);
  if (validationErrors.length > 0) return rejected(state, validationErrors);

  return accepted(state, eventName, payload, "superseded", {
    emittedRecord: {
      type: "supersession_requested",
      superseded_attempt_id: state.attempt_id ?? null,
      current_launch_ref: state.expected_launch_ref ?? null,
      current_output_branch: state.output_branch ?? null,
      current_github_run_id: state.github_run_id ?? payload.known_github_run_id ?? null,
      new_attempt_id: payload.new_attempt_id,
      new_dispatch_idempotency_key: payload.new_dispatch_idempotency_key,
      new_launch_ref: payload.new_launch_ref,
      new_output_branch: payload.new_output_branch,
      reason: payload.reason
    }
  });
}

function validateTransitionPayload(state, payload, spec, errors) {
  if (GITHUB_RUN_ID_EVENTS.has(spec.event)) {
    validateGithubRunIdPayload(payload, errors);
  }

  if (spec.event === "dispatch_requested") {
    compareExpectedLaunchSha(state, payload.expected_launch_sha, errors);
  }

  if (spec.requireObservedLaunchSha) {
    compareExpectedLaunchSha(state, payload.observed_launch_sha, errors, "observed_launch_sha");
  }

  if (spec.event === "launch_ref_exists_unexpected_sha" && payload.observed_launch_sha === payload.expected_launch_sha) {
    errors.push(error("observed_launch_sha", "expected_unexpected_launch_sha", "Observed launch SHA must differ from expected SHA"));
  }

  if (
    spec.event === "github_run_terminal" &&
    state.github_run_id !== undefined &&
    (typeof state.github_run_id !== "string" || state.github_run_id.trim() === "")
  ) {
    errors.push(error("state.github_run_id", "expected_string", "Persisted GitHub run id must be a non-empty string"));
  }

  if (
    spec.event === "github_run_terminal" &&
    typeof state.github_run_id === "string" &&
    state.github_run_id.trim() !== "" &&
    typeof payload.github_run_id === "string" &&
    payload.github_run_id.trim() !== "" &&
    payload.github_run_id !== state.github_run_id
  ) {
    errors.push(error("github_run_id", "state_context_mismatch", "Terminal GitHub run id must match persisted github_run_id"));
  }

  if (spec.finalStatusResult) {
    const expectedContext = expectedContextFromPayload(payload);
    if (!expectedContext) {
      errors.push(error("expected_context", "required", "Trusted final status requires explicit expected context"));
      return;
    }
    if (Object.keys(expectedContext).length === 0) {
      errors.push(error("expected_context", "expected_non_empty_object", "Trusted final status requires non-empty expected context"));
      return;
    }
    validateBindingExpectedContext(state, expectedContext, spec.finalStatusResult, errors);
    if (errors.length > 0) return;
    const validation = validateTemporalFinalStatus(payload.final_status, expectedContext);
    if (!validation.valid) {
      for (const item of validation.errors) {
        errors.push({
          ...item,
          path: item.path ? `final_status.${item.path}` : "final_status"
        });
      }
      return;
    }
    if (payload.final_status.result !== spec.finalStatusResult) {
      errors.push(error("final_status.result", "final_status_result_mismatch", `Expected final status result ${spec.finalStatusResult}`));
    }
  }
}

function validateGithubRunIdPayload(payload, errors) {
  const value = payload.github_run_id;
  if (value === undefined || value === null || value === "") return;
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(error("github_run_id", "expected_string", "GitHub run id must be a non-empty string"));
  }
}

function validateOperatorDecisionPayload(state, decisionName, payload, errors) {
  if (TERMINAL_STATES.has(state.state) && !canApplyOperatorDecisionToTerminalState(state, decisionName)) {
    errors.push(error("state", "terminal_state_immutable", "Terminal attempt states cannot transition"));
    return;
  }

  if (decisionName === "retry_same_attempt_observe_only") {
    if (state.state !== "operator_reconciliation_required") {
      errors.push(error("state", "operator_reconciliation_required", "Decision requires operator_reconciliation_required"));
    }
    compareExpectedLaunchSha(state, payload.observed_launch_sha, errors, "observed_launch_sha");
  }

  if (decisionName === "retry_new_attempt") {
    if (state.state !== "operator_reconciliation_required" && !NON_SUCCESS_TERMINAL_STATES.has(state.state)) {
      errors.push(error("state", "invalid_operator_decision_state", "Decision requires operator reconciliation or non-success terminal state"));
    }
    if (SUCCESS_TERMINAL_STATES.has(state.state)) {
      errors.push(error("state", "success_terminal_immutable", "Successful terminal attempts cannot be retried"));
    }
    const dispositionFields = ["superseded_attempt_id", "abandoned_attempt_id"].filter((key) => payload[key] !== undefined);
    if (dispositionFields.length !== 1) {
      errors.push(error("superseded_attempt_id", "required_disposition_attempt", "Decision requires exactly one superseded or abandoned attempt id"));
    }
    validateNewAttemptPayload(state, payload, errors);
  }

  if (decisionName === "mark_failed") {
    if (
      state.state !== "operator_reconciliation_required" &&
      state.state !== "inconclusive" &&
      !isLateOutputReconciliationCase(state)
    ) {
      errors.push(
        error(
          "state",
          "invalid_operator_decision_state",
          "Decision requires operator reconciliation, inconclusive, or late-output reconciliation"
        )
      );
    }
  }

  if (decisionName === "mark_inconclusive") {
    if (state.state !== "operator_reconciliation_required" && !isLateOutputReconciliationCase(state)) {
      errors.push(
        error(
          "state",
          "invalid_operator_decision_state",
          "Decision requires operator reconciliation or late-output reconciliation"
        )
      );
    }
  }

  if (decisionName === "accept_late_output") {
    if (state.state !== "cancelled" && state.state !== "superseded") {
      errors.push(error("state", "late_output_terminal_required", "Late output acceptance requires cancelled or superseded terminal attempt"));
    }
    if (payload.commit_sha === undefined && payload.no_change_ref_evidence === undefined) {
      errors.push(error("commit_sha", "required_late_output_ref", "Late output acceptance requires commit or no-change ref evidence"));
    }
  }

  if (decisionName === "abandon") {
    if (!["operator_reconciliation_required", "cancelled", "superseded"].includes(state.state)) {
      errors.push(error("state", "invalid_operator_decision_state", "Abandon requires operator reconciliation or late-output terminal attempt"));
    }
    if (payload.terminal_disposition !== "failed" && payload.terminal_disposition !== "inconclusive") {
      errors.push(error("terminal_disposition", "unsupported_terminal_disposition", "Expected failed or inconclusive"));
    }
  }
}

function expectedContextFromPayload(payload) {
  const expectedContext = payload.expected_context ?? payload.expectedContext;
  return asObject(expectedContext);
}

function validateBindingExpectedContext(state, expectedContext, finalStatusResult, errors) {
  if (typeof state.expected_wrapper_source !== "string" || state.expected_wrapper_source.trim() === "") {
    errors.push(
      error(
        "state.expected_wrapper_source",
        "required_authoritative_wrapper_binding",
        "Trusted final status requires persisted expected wrapper source from the input boundary"
      )
    );
  }

  if (typeof state.expected_wrapper_digest !== "string" || state.expected_wrapper_digest.trim() === "") {
    errors.push(
      error(
        "state.expected_wrapper_digest",
        "required_authoritative_wrapper_binding",
        "Trusted final status requires persisted expected wrapper digest from the input boundary"
      )
    );
  }

  if (!VALIDATION_MODES.has(expectedContext.validation_mode)) {
    errors.push(
      error(
        "expected_context.validation_mode",
        expectedContext.validation_mode === undefined ? "required_binding_context" : "unsupported_binding_context",
        "Trusted final status requires explicit live or dry_run validation mode"
      )
    );
  }

  if (expectedContext.validation_mode !== "live") {
    errors.push(error("expected_context.validation_mode", "required_live_validation", "Trusted terminal status requires live validation mode"));
  }

  const launchRecord = asObject(expectedContext.launchRecord ?? expectedContext.launch_record);
  if (!launchRecord) {
    errors.push(error("expected_context.launchRecord", "required_binding_context", "Trusted final status requires expected launch record context"));
    return;
  }

  for (const field of BINDING_LAUNCH_RECORD_FIELDS) {
    requireBindingString(launchRecord[field], `expected_context.launchRecord.${field}`, errors);
  }

  const expectedGithub = asObject(launchRecord.github);
  if (!expectedGithub) {
    errors.push(error("expected_context.launchRecord.github", "required_binding_context", "Trusted final status requires expected GitHub context"));
  } else {
    requireBindingString(expectedGithub.run_name, "expected_context.launchRecord.github.run_name", errors);
    compareBindingField(state.expected_run_name, expectedGithub.run_name, "expected_context.launchRecord.github.run_name", errors);
    if (
      typeof state.dispatch_idempotency_key === "string" &&
      typeof expectedGithub.run_name === "string" &&
      expectedGithub.run_name !== `agent-worker/${state.dispatch_idempotency_key}`
    ) {
      errors.push(error("expected_context.launchRecord.github.run_name", "state_context_mismatch", "Expected run name must match current attempt state"));
    }
  }

  if (!hasBindingWrapper(expectedContext.wrapper) && !hasBindingWrapper(launchRecord.wrapper)) {
    errors.push(error("expected_context.wrapper", "required_binding_context", "Trusted final status requires expected wrapper source and digest"));
  }

  if (expectedContext.validation_mode === "live" && expectedContext.github_run_id === undefined) {
    errors.push(error("expected_context.github_run_id", "required_binding_context", "Live trusted final status requires expected GitHub run id"));
  }

  compareBindingField(state.attempt_id, launchRecord.attempt_id, "expected_context.launchRecord.attempt_id", errors);
  compareBindingField(state.dispatch_idempotency_key, launchRecord.dispatch_idempotency_key, "expected_context.launchRecord.dispatch_idempotency_key", errors);
  compareBindingField(state.base_sha, launchRecord.base_sha, "expected_context.launchRecord.base_sha", errors);
  compareBindingField(state.output_branch, launchRecord.output_branch, "expected_context.launchRecord.output_branch", errors);
  compareBindingField(state.expected_launch_ref, launchRecord.launch_ref, "expected_context.launchRecord.launch_ref", errors);
  compareBindingField(state.expected_launch_sha, launchRecord.launch_sha, "expected_context.launchRecord.launch_sha", errors);
  compareBindingField(state.github_run_id, expectedContext.github_run_id, "expected_context.github_run_id", errors);

  const stateIdentity = identityFromDispatchKey(state.dispatch_idempotency_key);
  if (stateIdentity) {
    compareBindingField(stateIdentity.initiative_id, launchRecord.initiative_id, "expected_context.launchRecord.initiative_id", errors);
    compareBindingField(stateIdentity.wk_id, launchRecord.wk_id, "expected_context.launchRecord.wk_id", errors);
  }

  const contextWrapper = asObject(expectedContext.wrapper);
  const launchWrapper = asObject(launchRecord.wrapper);
  compareBindingField(state.expected_wrapper_source, contextWrapper?.source ?? launchWrapper?.source, "expected_context.wrapper.source", errors);
  compareBindingField(state.expected_wrapper_digest, contextWrapper?.digest ?? launchWrapper?.digest, "expected_context.wrapper.digest", errors);
}

function requireBindingString(value, path, errors) {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(error(path, "required_binding_context", "Trusted final status requires binding expected context"));
  }
}

function hasBindingWrapper(value) {
  const wrapper = asObject(value);
  return typeof wrapper?.source === "string" && wrapper.source.trim() !== "" &&
    typeof wrapper.digest === "string" && wrapper.digest.trim() !== "";
}

function compareBindingField(expected, actual, path, errors) {
  if (expected === undefined || actual === undefined) return;
  if (expected !== actual) {
    errors.push(error(path, "state_context_mismatch", "Expected context must match current attempt state"));
  }
}

function identityFromDispatchKey(value) {
  if (typeof value !== "string") return null;
  const [initiativeId, wkId, attemptId, ...extra] = value.split("/");
  if (!initiativeId || !wkId || !attemptId || extra.length > 0) return null;
  return {
    initiative_id: initiativeId,
    wk_id: wkId,
    attempt_id: attemptId
  };
}

function canApplyOperatorDecisionToTerminalState(state, decisionName) {
  if (decisionName === "retry_new_attempt") {
    return true;
  }
  if (decisionName === "accept_late_output" || decisionName === "abandon") {
    return isLateOutputReconciliationCase(state);
  }
  if (decisionName === "mark_failed") {
    return state.state === "inconclusive" || isLateOutputReconciliationCase(state);
  }
  if (decisionName === "mark_inconclusive") {
    return isLateOutputReconciliationCase(state);
  }
  return false;
}

function isLateOutputReconciliationCase(state) {
  if (state.state !== "cancelled" && state.state !== "superseded") return false;
  const expectedReason = state.state === "cancelled"
    ? "cancelled_but_output_completed"
    : "superseded_but_output_completed";
  return state.reconciliation_records.some((record) => record?.reason === expectedReason);
}

function validateNewAttemptPayload(state, payload, errors) {
  if (payload.new_attempt_id !== undefined && payload.new_attempt_id === state.attempt_id) {
    errors.push(error("new_attempt_id", "attempt_id_reuse", "New attempt id must differ from current attempt"));
  }
  if (
    payload.new_dispatch_idempotency_key !== undefined &&
    payload.new_dispatch_idempotency_key === state.dispatch_idempotency_key
  ) {
    errors.push(error("new_dispatch_idempotency_key", "dispatch_key_reuse", "New dispatch key must differ from current attempt"));
  }
  if (payload.new_launch_ref !== undefined && payload.new_launch_ref === state.expected_launch_ref) {
    errors.push(error("new_launch_ref", "launch_ref_reuse", "New launch ref must differ from current attempt"));
  }
  if (payload.new_output_branch !== undefined && payload.new_output_branch === state.output_branch) {
    errors.push(error("new_output_branch", "output_branch_reuse", "New output branch must differ from current attempt"));
  }
}

function compareExpectedLaunchSha(state, observedOrExpected, errors, path = "expected_launch_sha") {
  if (state.expected_launch_sha === undefined) return;
  if (observedOrExpected !== state.expected_launch_sha) {
    errors.push(error(path, "expected_launch_sha_mismatch", "Launch SHA must match persisted expected_launch_sha"));
  }
}

function validateRequiredPayload(payload, required) {
  const errors = [];
  for (const key of required) {
    if (payload[key] === undefined || payload[key] === null || payload[key] === "") {
      errors.push(error(key, "required", "Required payload field is missing"));
    }
  }
  return errors;
}

function accepted(previous, eventName, payload, nextState, options = {}) {
  const state = {
    ...previous,
    state: nextState,
    last_event: eventName
  };

  for (const key of options.persist ?? []) {
    if (WRITE_ONCE_WRAPPER_BINDING_FIELDS.has(key)) continue;
    if (payload[key] !== undefined) state[key] = payload[key];
  }

  if (eventName === "input_valid") {
    state.output_branch = payload.output_branch ?? state.output_branch;
    persistExpectedWrapperBindingFromInput(state, previous, payload);
  }

  const reconciliationRecord = options.reconciliationReason
    ? reconciliationRecordFor(previous, eventName, payload, options.reconciliationReason)
    : null;
  const emittedRecord = options.emittedRecord ?? null;
  const operatorDecision = options.operatorDecision ?? null;

  if (reconciliationRecord && !options.emitOnly) {
    state.reconciliation_reason = reconciliationRecord.reason;
    state.evidence_packet_id = payload.evidence_packet_id ?? state.evidence_packet_id ?? null;
  }

  state.reconciliation_records = append(previous.reconciliation_records, reconciliationRecord);
  state.operator_decisions = append(previous.operator_decisions, operatorDecision);
  state.emitted_records = append(previous.emitted_records, emittedRecord);

  return {
    ok: true,
    state,
    transition: {
      from: previous.state,
      event: eventName,
      to: nextState
    },
    reconciliation_record: reconciliationRecord,
    emitted_record: emittedRecord,
    operator_decision: operatorDecision
  };
}

function reconciliationRecordFor(state, eventName, payload, reason) {
  if (!RECONCILIATION_REASONS.has(reason)) {
    throw new Error(`Unknown reconciliation reason: ${reason}`);
  }
  return {
    type: "operator_reconciliation",
    reason,
    source_state: state.state,
    event: eventName,
    evidence_packet_id: payload.evidence_packet_id ?? null,
    payload: clone(payload)
  };
}

function rejected(state, errors) {
  return {
    ok: false,
    state,
    errors
  };
}

function normalizeState(value) {
  const state = asObject(value) ?? {};
  return {
    ...state,
    state: state.state ?? "input_validating",
    reconciliation_records: Array.isArray(state.reconciliation_records)
      ? state.reconciliation_records
      : [],
    operator_decisions: Array.isArray(state.operator_decisions)
      ? state.operator_decisions
      : [],
    emitted_records: Array.isArray(state.emitted_records)
      ? state.emitted_records
      : []
  };
}

function getStateName(value) {
  if (typeof value === "string") return value;
  return asObject(value)?.state;
}

function append(items, item) {
  if (!item) return items;
  return [...items, item];
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function persistExpectedWrapperBindingFromInput(state, previous, payload) {
  const launchRecord = asObject(payload.launchRecord ?? payload.launch_record);
  const wrapper = asObject(payload.wrapper) ?? asObject(launchRecord?.wrapper);

  if (
    previous.expected_wrapper_source === undefined &&
    typeof wrapper?.source === "string" &&
    wrapper.source.trim() !== ""
  ) {
    state.expected_wrapper_source = wrapper.source;
  }
  if (
    previous.expected_wrapper_digest === undefined &&
    typeof wrapper?.digest === "string" &&
    wrapper.digest.trim() !== ""
  ) {
    state.expected_wrapper_digest = wrapper.digest;
  }
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function error(path, code, message) {
  return { path, code, message };
}
