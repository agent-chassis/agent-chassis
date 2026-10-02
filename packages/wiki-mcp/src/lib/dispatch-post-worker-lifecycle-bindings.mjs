

import {
  INTEGRATED_RECORD_RECONCILIATION_STATES,
  observeIntegratedSliceDelivery,
  SLICE_INTEGRATION_DIAGNOSTIC_CODES,
  SliceIntegrationError
} from "../../../agent-launch-cli/src/lib/slice-integration.mjs";
import {
  resolveUniqueManagedLifecycleBindingPairForRecovery
} from "../../../agent-launch-cli/src/lib/worktree-substrate-identity.mjs";
import {
  deriveManagedRunIdentityTupleFromBindingPair
} from "../../../agent-launch-cli/src/lib/managed-run-process-identity.mjs";
import {
  COMMITTED_SLICE_INTEGRATION_RETRY_DECISIONS,
  resolveCommittedSliceIntegrationRetryFacts
} from "../../../agent-launch-cli/src/lib/workspace-agent-dispatch-backend-integration.mjs";
import {
  EXPLICIT_BASE_MERGE_TREE_CAPABILITY,
  EXPLICIT_BASE_MERGE_TREE_CORRECTION_CONDITION
} from "../../../agent-launch-cli/src/lib/explicit-base-merge-tree.mjs";
import {
  attributeIntegrationRefusal,
  attributeLifecycleRefusal,
  CLOSED_LIFECYCLE_REFUSAL_REASONS,
  closedFailureCause,
  summarizeLifecycleFailureEvidence
} from "./dispatch-lifecycle-failure-projection.mjs";

export const WORKER_SLICE_SUBJECT_RE = /^(WK-\d{4})#(SLICE-\d{3})$/u;
const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
export const POST_WORKER_LIFECYCLE_CHECKPOINT = Symbol("postWorkerLifecycleCheckpoint");

export const POST_WORKER_LIFECYCLE_PHASES = Object.freeze({
  PRE_INTEGRATION: "pre-integration",
  INTEGRATED: "integrated",
  FINALIZED: "finalized"
});

export const RUN_LIFECYCLE_RESOLUTION_SCHEMA_VERSION =
  "workspace-agent-run-lifecycle-resolution.v1";

export const LIFECYCLE_FAILURE_HISTORY_LIMIT = 5;

export const LIFECYCLE_RESOLUTION_NEXT_ACTIONS = Object.freeze({
  RESOLVE_FAILURE: "resolve_lifecycle_failure_then_retry_run_status",
  AWAIT_SLICE_COMMIT: "retry_run_status_after_exact_slice_commit",
  RETRY: "retry_wait_or_check_status",
  REPAIR_RETRY_ASSESSMENT: "repair_retry_assessment_then_check_status",
  ESCALATE_MISSING_RETRY_CAPABILITY: "escalate_missing_retry_capability",
  REQUIRES_NEW_GENERATION: "delivery_requires_new_generation_work",
  REPAIR_RESULT_PUBLICATION_IDENTITY: "launcher_repair_result_publication_identity"
});

export const LIFECYCLE_RETRY_DECISIONS = Object.freeze({

  UNCHANGED: COMMITTED_SLICE_INTEGRATION_RETRY_DECISIONS.UNCHANGED,
  CHANGED: COMMITTED_SLICE_INTEGRATION_RETRY_DECISIONS.CHANGED,
  COMPLETED: COMMITTED_SLICE_INTEGRATION_RETRY_DECISIONS.COMPLETED,
  PRODUCER_UNDECIDED: COMMITTED_SLICE_INTEGRATION_RETRY_DECISIONS.UNKNOWN,
  OUTSIDE_ALLOCATION: COMMITTED_SLICE_INTEGRATION_RETRY_DECISIONS.OUTSIDE_ALLOCATION,
  CURRENT_REFUSAL: COMMITTED_SLICE_INTEGRATION_RETRY_DECISIONS.CURRENT_REFUSAL,
  CORRECTION_UNESTABLISHED: COMMITTED_SLICE_INTEGRATION_RETRY_DECISIONS.CORRECTION_UNESTABLISHED,

  PENDING: "reassessed_on_a_later_explicit_request",
  NO_CORRECTION_CONDITION: "correction_condition_unavailable",
  COMPLETION_OBSERVATION_FAILED: "completion_observation_failed",
  ASSESSMENT_UNAVAILABLE: "correction_assessment_unavailable",
  ASSESSMENT_FAILED: "correction_assessment_failed",
  ASSESSMENT_MALFORMED: "correction_assessment_malformed",
  FAILURE_HISTORY_UNAVAILABLE: "failure_history_unavailable",

  POST_INTEGRATION_REENTRY: "post_integration_step_reentered_on_a_later_explicit_request"
});

const RETRY_DECISION_NEXT_ACTIONS = new Map([
  [LIFECYCLE_RETRY_DECISIONS.PENDING, LIFECYCLE_RESOLUTION_NEXT_ACTIONS.RESOLVE_FAILURE],
  [LIFECYCLE_RETRY_DECISIONS.UNCHANGED, LIFECYCLE_RESOLUTION_NEXT_ACTIONS.RESOLVE_FAILURE],
  [LIFECYCLE_RETRY_DECISIONS.OUTSIDE_ALLOCATION,
    LIFECYCLE_RESOLUTION_NEXT_ACTIONS.REQUIRES_NEW_GENERATION],
  [LIFECYCLE_RETRY_DECISIONS.NO_CORRECTION_CONDITION,
    LIFECYCLE_RESOLUTION_NEXT_ACTIONS.ESCALATE_MISSING_RETRY_CAPABILITY],
  [LIFECYCLE_RETRY_DECISIONS.CURRENT_REFUSAL,
    LIFECYCLE_RESOLUTION_NEXT_ACTIONS.ESCALATE_MISSING_RETRY_CAPABILITY],
  [LIFECYCLE_RETRY_DECISIONS.CORRECTION_UNESTABLISHED,
    LIFECYCLE_RESOLUTION_NEXT_ACTIONS.ESCALATE_MISSING_RETRY_CAPABILITY],
  [LIFECYCLE_RETRY_DECISIONS.PRODUCER_UNDECIDED,
    LIFECYCLE_RESOLUTION_NEXT_ACTIONS.REPAIR_RETRY_ASSESSMENT],
  [LIFECYCLE_RETRY_DECISIONS.COMPLETION_OBSERVATION_FAILED,
    LIFECYCLE_RESOLUTION_NEXT_ACTIONS.REPAIR_RETRY_ASSESSMENT],
  [LIFECYCLE_RETRY_DECISIONS.ASSESSMENT_UNAVAILABLE,
    LIFECYCLE_RESOLUTION_NEXT_ACTIONS.REPAIR_RETRY_ASSESSMENT],
  [LIFECYCLE_RETRY_DECISIONS.ASSESSMENT_FAILED,
    LIFECYCLE_RESOLUTION_NEXT_ACTIONS.REPAIR_RETRY_ASSESSMENT],
  [LIFECYCLE_RETRY_DECISIONS.ASSESSMENT_MALFORMED,
    LIFECYCLE_RESOLUTION_NEXT_ACTIONS.REPAIR_RETRY_ASSESSMENT],
  [LIFECYCLE_RETRY_DECISIONS.FAILURE_HISTORY_UNAVAILABLE,
    LIFECYCLE_RESOLUTION_NEXT_ACTIONS.REPAIR_RETRY_ASSESSMENT]
]);

export function retryAssessmentNextAction(assessment) {
  return RETRY_DECISION_NEXT_ACTIONS.get(assessment?.decision) ?? null;
}

export const LIFECYCLE_REQUIRED_CORRECTION_SCHEMA_VERSION =
  "workspace-agent-lifecycle-required-correction.v1";
const PREREQUISITE_STANDS = new Set([
  LIFECYCLE_RETRY_DECISIONS.PENDING,
  LIFECYCLE_RETRY_DECISIONS.UNCHANGED
]);
const REQUIRED_CORRECTIONS = new Map([
  [EXPLICIT_BASE_MERGE_TREE_CORRECTION_CONDITION, Object.freeze({
    schema_version: LIFECYCLE_REQUIRED_CORRECTION_SCHEMA_VERSION,
    grants_authority: false,
    kind: "serving_runtime_prerequisite",
    prerequisite: EXPLICIT_BASE_MERGE_TREE_CAPABILITY,
    requirement: "the Git executable selected by the serving launcher runtime must " +
      "support `git merge-tree --write-tree --merge-base`",
    correction: "correct that runtime's Git installation or executable selection; " +
      "there is no fallback merge algorithm",
    then: "call workspace_agent_run_status again for the same retained run " +
      "(same subject and attempt_id); it rechecks the capability, and only a changed " +
      "capability permits another integration attempt of the same delivery",
    retry_alone_repairs: false
  })]
]);

export function producerConditionRequiredCorrection(condition) {
  return REQUIRED_CORRECTIONS.get(condition) ?? null;
}

export function retryAssessmentRequiredCorrection(assessment) {
  if (assessment?.failure_class !== LIFECYCLE_RETRY_FACT_KINDS.DETERMINISTIC ||
      !PREREQUISITE_STANDS.has(assessment?.decision)) return null;
  return REQUIRED_CORRECTIONS.get(assessment.correction_condition) ?? null;
}

const FINALIZED_LIFECYCLE_RESOLUTION = Object.freeze({
  schema_version: RUN_LIFECYCLE_RESOLUTION_SCHEMA_VERSION,
  resolved: true,
  phase: POST_WORKER_LIFECYCLE_PHASES.FINALIZED
});

export const LIFECYCLE_RETRY_FACT_KINDS = Object.freeze({
  DETERMINISTIC: "deterministic",
  NO_CORRECTION_CONDITION: "no_producer_correction_condition",
  RETAINED_BEFORE_RESTART: "retained_before_restart",
  POST_INTEGRATION: "post_integration"
});
const LIFECYCLE_RETRY_FACTS = new WeakMap();

function retainLifecycleRetryFacts(target, facts) {
  if (facts !== null && ((typeof target === "object" && target !== null) ||
      typeof target === "function")) {
    LIFECYCLE_RETRY_FACTS.set(target, facts);
  }
  return target;
}

export function lifecycleRetryFactsOf(value) {
  return LIFECYCLE_RETRY_FACTS.get(value) ?? null;
}

export function transferLifecycleRetryFacts(source, carrier) {
  return retainLifecycleRetryFacts(carrier, lifecycleRetryFactsOf(source));
}

export function lifecycleError(code, message, detail = null, cause = null) {
  return new SliceIntegrationError(`workspace-agent post-worker lifecycle: ${message}`, {
    code,
    detail,
    cause
  });
}

async function runGitOrThrow(runGit, repo, args, message, code) {
  const result = await runGit({ repo, args });
  if (!result || result.ok !== true) {
    throw attributeLifecycleRefusal(lifecycleError(code, message, {
      args,
      status: result?.status ?? null,
      stderr: result?.stderr ?? result?.error ?? null
    }), CLOSED_LIFECYCLE_REFUSAL_REASONS.GIT_COMMAND_FAILED);
  }
  return result;
}

export function isResolvedGitOid(value) {
  return typeof value === "string" && OID_RE.test(value) && !/^0+$/u.test(value);
}

export async function resolvedCommit(runGit, repo, value, message, code) {
  const sha = String((await runGitOrThrow(
    runGit,
    repo,
    ["rev-parse", "--verify", `${value}^{commit}`],
    message,
    code
  )).stdout ?? "").trim();
  if (!isResolvedGitOid(sha)) {
    throw attributeLifecycleRefusal(
      lifecycleError(code, message, { value, sha: sha || null }),
      CLOSED_LIFECYCLE_REFUSAL_REASONS.GIT_OBJECT_UNRESOLVED
    );
  }
  return sha;
}

export async function resolvedTree(runGit, repo, value, message, code) {
  const sha = String((await runGitOrThrow(
    runGit,
    repo,
    ["rev-parse", "--verify", `${value}^{tree}`],
    message,
    code
  )).stdout ?? "").trim();
  if (!isResolvedGitOid(sha)) {
    throw attributeLifecycleRefusal(
      lifecycleError(code, message, { value, sha: sha || null }),
      CLOSED_LIFECYCLE_REFUSAL_REASONS.GIT_OBJECT_UNRESOLVED
    );
  }
  return sha;
}

export function resolveManagedLifecycleBindings({ workspaceDir, status }, deps) {
  if (typeof deps.resolveManagedRunBinding === "function") {
    const provisioning = deps.resolveManagedRunBinding(status);
    if (!provisioning?.slice_binding || !provisioning?.wk_binding ||
        provisioning.validation_worktree_path !== provisioning.wk_binding.worktree_path) {
      throw attributeLifecycleRefusal(
        Object.assign(
          new Error("post-worker lifecycle requires the complete launcher-owned WK and slice provisioning binding"),
          {
            detail: {
              provisioning,
              has_slice_binding: Boolean(provisioning?.slice_binding),
              has_wk_binding: Boolean(provisioning?.wk_binding),
              validation_worktree_path: provisioning?.validation_worktree_path,
              wk_worktree_path: provisioning?.wk_binding?.worktree_path
            }
          }
        ),
        CLOSED_LIFECYCLE_REFUSAL_REASONS.PROVISIONING_BINDING_INCOMPLETE
      );
    }
    return { provisioning, slice: provisioning.slice_binding, wk: provisioning.wk_binding };
  }

  const pair = resolveUniqueManagedLifecycleBindingPairForRecovery({
    mainRepo: workspaceDir,
    launchRef: status.monitor_handle,
    expectedSubject: status.subject,
    allowMissingSliceWorktree: true
  });
  if (!pair || pair.run_id !== status.run_id) {
    throw attributeLifecycleRefusal(
      new Error("post-worker lifecycle found no retained launcher binding pair for this exact attempt"),
      CLOSED_LIFECYCLE_REFUSAL_REASONS.PROVISIONING_BINDING_INCOMPLETE
    );
  }
  const { provisioning } = pair;
  return { provisioning, slice: provisioning.slice_binding, wk: provisioning.wk_binding };
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
  const checkpoint = {
    phase: POST_WORKER_LIFECYCLE_PHASES.PRE_INTEGRATION,
    integration: null,
    finalized: null,
    in_flight: null,
    failure_attempts: 0,
    failure_history: []
  };

  for (const field of ["pending_failure_publications", "retained_failure", "retry_facts",
    "retry_assessment", "retry_decision", "retry_start_in_flight", "durable_history_read",
    "retained_failure_origin", "completion_observation"]) {
    Object.defineProperty(checkpoint, field, {
      value: field === "pending_failure_publications" ? [] : null,
      enumerable: false,
      writable: true
    });
  }
  return checkpoint;
}

export function recordLifecycleFailure(checkpoint, failure) {
  if (!checkpoint || !Array.isArray(checkpoint.failure_history)) return failure;
  checkpoint.failure_attempts =
    (Number.isInteger(checkpoint.failure_attempts) ? checkpoint.failure_attempts : 0) + 1;
  checkpoint.failure_history.push(retainedFailureEntry(failure));
  while (checkpoint.failure_history.length > LIFECYCLE_FAILURE_HISTORY_LIMIT) {
    checkpoint.failure_history.shift();
  }
  return failure;
}

function retainedFailureEntry(failure) {
  const failureCause = closedFailureCause(failure?.failure_cause);
  const evidenceSummary = summarizeLifecycleFailureEvidence(failure?.evidence);
  return Object.freeze({
    phase: typeof failure?.phase === "string" ? failure.phase : null,
    error_code: typeof failure?.error_code === "string" ? failure.error_code : null,
    error_message: typeof failure?.error_message === "string" ? failure.error_message : null,
    error_message_truncated: failure?.error_message_truncated === true,
    ...(failureCause === null ? {} : { failure_cause: failureCause }),
    ...(evidenceSummary === null ? {} : { evidence_summary: evidenceSummary })
  });
}

export function adoptDurableLifecycleFailures(checkpoint, failures) {
  const recorded = Array.isArray(failures) ? failures : [];
  if (!checkpoint || !Array.isArray(checkpoint.failure_history) || recorded.length === 0) {
    return false;
  }
  checkpoint.failure_attempts = recorded.length;
  checkpoint.failure_history.splice(0, checkpoint.failure_history.length,
    ...recorded.slice(-LIFECYCLE_FAILURE_HISTORY_LIMIT).map((item) => retainedFailureEntry(item.failure)));
  checkpoint.retained_failure = recorded.at(-1).failure;
  checkpoint.retained_failure_origin = "durable_journal";
  checkpoint.failure_history_durability = Object.freeze({ state: "durable" });
  return true;
}

function publicationRepairCorrection(lifecycle) {
  const repair = lifecycle?.publication_repair_required;
  if (repair === null || typeof repair !== "object" || repair.retryable !== false) return null;
  const { schema_version: _schema, retryable: _retryable, ...facts } = repair;
  return Object.freeze({
    schema_version: LIFECYCLE_REQUIRED_CORRECTION_SCHEMA_VERSION,
    grants_authority: false,
    kind: "result_publication_execution_identity",
    ...facts,
    retry_alone_repairs: false
  });
}

function resolveLifecycleNextAction(phase, latestFailure, lifecycle = null, retryAssessment = null) {
  if (publicationRepairCorrection(lifecycle) !== null) {
    return LIFECYCLE_RESOLUTION_NEXT_ACTIONS.REPAIR_RESULT_PUBLICATION_IDENTITY;
  }
  if (lifecycle?.publication_retry_required === true) {
    return LIFECYCLE_RESOLUTION_NEXT_ACTIONS.RETRY;
  }
  const assessed = retryAssessmentNextAction(retryAssessment);
  if (latestFailure !== null) return assessed ?? LIFECYCLE_RESOLUTION_NEXT_ACTIONS.RESOLVE_FAILURE;

  if (retryAssessment?.attempt_withheld === true && assessed !== null) return assessed;
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
  const nextAction = resolveLifecycleNextAction(phase, latestFailure, lifecycle,
    checkpoint?.retry_assessment ?? null);
  const requiredCorrection = nextAction ===
      LIFECYCLE_RESOLUTION_NEXT_ACTIONS.REPAIR_RESULT_PUBLICATION_IDENTITY
    ? publicationRepairCorrection(lifecycle)
    : latestFailure !== null && nextAction === LIFECYCLE_RESOLUTION_NEXT_ACTIONS.RESOLVE_FAILURE
      ? retryAssessmentRequiredCorrection(checkpoint?.retry_assessment)
      : null;
  return Object.freeze({
    schema_version: RUN_LIFECYCLE_RESOLUTION_SCHEMA_VERSION,
    resolved: false,
    phase,

    integration_complete: false,
    failure_attempts: rawAttempts,
    failure_history_truncated: rawAttempts > history.length,
    retained_failures: Object.freeze([...history]),
    ...(checkpoint?.failure_history_durability
      ? { failure_history_durability: checkpoint.failure_history_durability }
      : {}),
    latest_failure: latestFailure,

    ...(checkpoint?.retry_assessment ? { retry_assessment: checkpoint.retry_assessment } : {}),

    ...(requiredCorrection === null ? {} : { required_correction: requiredCorrection }),
    next_action: nextAction
  });
}

export function projectInFlightLifecycleResolution(checkpoint = null) {

  if (checkpoint?.phase === POST_WORKER_LIFECYCLE_PHASES.FINALIZED) {
    return FINALIZED_LIFECYCLE_RESOLUTION;
  }

  const { required_correction: _superseded, ...projected } = projectLifecycleResolution({
    lifecycle: { phase: checkpoint?.phase ?? POST_WORKER_LIFECYCLE_PHASES.PRE_INTEGRATION },
    checkpoint
  });
  return Object.freeze({
    ...projected,
    advance_in_flight: true,
    next_action: LIFECYCLE_RESOLUTION_NEXT_ACTIONS.RETRY
  });
}

export function checkpointFromStatus(status) {
  const checkpoint = status?.[POST_WORKER_LIFECYCLE_CHECKPOINT];
  return checkpoint ?? createLifecycleCheckpoint();
}

export async function recoverIntegratedSliceResult({ mainRepo, binding, sliceRef, wkRef, runGit, deps = {} }) {
  return await (deps.reconcileIntegratedSliceRecord ?? observeIntegratedSliceDelivery)({
    mainRepo,
    unitAddress: binding.unit_address,
    sliceRef,
    wkRef,
    deps: { runGit }
  });
}

export function recordReconciliationOutstanding(integration) {
  const state = integration?.record_reconciliation?.state;
  return state === INTEGRATED_RECORD_RECONCILIATION_STATES.PENDING ||
    state === INTEGRATED_RECORD_RECONCILIATION_STATES.BLOCKED;
}

export async function delegateSliceIntegrationToHost({ status, bindings, adapter }) {

  const tuple = resolveRetainedManagedWorkerTuple({ status, bindings });
  const delegated = await adapter({ ...tuple });
  if (!delegated || delegated.accepted !== true || !delegated.integration) {

    const producerFacts = resolveCommittedSliceIntegrationRetryFacts(delegated?.refusal ?? null);
    throw retainLifecycleRetryFacts(attributeIntegrationRefusal(lifecycleError(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.GIT_FAILED,
      "host-delegated slice-to-WK integration failed",
      {
        integration_refusal: delegated?.refusal ?? null,
        accepted: delegated?.accepted ?? null,
        integration_present: Boolean(delegated?.integration)
      }
    ), delegated?.refusal ?? null), producerFacts === null ? null : Object.freeze({
      kind: LIFECYCLE_RETRY_FACT_KINDS.DETERMINISTIC,
      execution_tuple: tuple,
      producer_facts: producerFacts
    }));
  }
  return delegated.integration;
}
