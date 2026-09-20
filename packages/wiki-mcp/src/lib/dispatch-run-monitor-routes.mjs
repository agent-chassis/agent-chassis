

import path from "node:path";
import { realpathSync } from "node:fs";
import { randomUUID } from "node:crypto";

import {
  ATTEMPT_LINEAGE_CONFLICT_CLASSES,
  ATTEMPT_LINEAGE_RESOLUTION_STATES
} from "@agent-chassis/agent-launch-cli/src/lib/workspace-agent-dispatch-run-lifecycle-settlement.mjs";
import {
  LAUNCHER_AGENT_SESSION_CONTRACT_FIELDS,
  LAUNCHER_AGENT_SESSION_CONTRACT_SCHEMA_VERSION,
  digestLauncherAgentSessionContract
} from "@agent-chassis/agent-launch-cli/src/lib/stdio-mcp-conduit-authority.mjs";

import { buildCloseoutWorkflowContinuation } from "./dispatch-closeout-continuation.mjs";
import {
  buildLifecycleFailure,
  publishableLifecycleFailure,
  RecordedLifecycleFailure
} from "./dispatch-lifecycle-failure-disclosure.mjs";
import { captureLifecycleFailureEvidence } from "./dispatch-lifecycle-failure-projection.mjs";
import {
  BACKEND_SETTLE_GRACE_MS,
  createCallDeadline,
  retainAbandonedWork,
  RUN_STATUS_CALL_BUDGET_MS,
  RUN_WAIT_TIMEOUT_MS_BOUNDS,
  settleWithinDeadline
} from "./dispatch-monitor-call-deadline.mjs";
import { projectRunFinalResultPublication } from "./dispatch-final-result-publication.mjs";
import { projectPublishedSliceLifecycle } from
  "./dispatch-run-status-authored-contract-projection.mjs";
import { projectPublishedIntegrationReceipt } from
  "./dispatch-run-status-integration-receipt-projection.mjs";
import { createAuthoredContractRetention } from
  "./dispatch-run-status-authored-contract-retention.mjs";
import { observeRunProofVerification, projectRunProofVerificationDetail } from
  "./dispatch-run-proof-verification.mjs";
import {
  createLifecycleCheckpoint,
  LIFECYCLE_RETRY_FACT_KINDS,
  lifecycleRetryFactsOf,
  LIFECYCLE_RESOLUTION_NEXT_ACTIONS,
  POST_WORKER_LIFECYCLE_CHECKPOINT,
  POST_WORKER_LIFECYCLE_PHASES,
  projectInFlightLifecycleResolution,
  projectLifecycleResolution,
  recordLifecycleFailure,
  WORKER_SLICE_SUBJECT_RE
} from "./dispatch-post-worker-lifecycle-bindings.mjs";
import { runPostWorkerSliceLifecycle } from "./dispatch-post-worker-lifecycle.mjs";
import {
  AGENT_RUN_STATUS_SCHEMA_VERSION,
  DISPATCH_BLOCKER_CODES
} from "./dispatch-tool-constants.mjs";
import {
  buildBlockedRunStatusResult,
  buildDispatchContinuation,
  buildDispatchMechanicalRefusal,
  withRecordedRequestSchemas,
  NO_SUPPORTED_ROUTE_RECOVERY,
  buildDispatchToolExceptionDetail,
  classifyAgentDispatchSubject,
  compactRunStatusReviewResult,
  mapBackendRefusalToDispatchCode,
  omitNullFields,
  resolveMonitorHandleAlwaysUnknown
} from "./dispatch-tool-helpers.mjs";

export {
  LIFECYCLE_FAILURE_HISTORY_LIMIT,
  LIFECYCLE_RESOLUTION_NEXT_ACTIONS,
  projectLifecycleResolution,
  RUN_LIFECYCLE_RESOLUTION_SCHEMA_VERSION
} from "./dispatch-post-worker-lifecycle-bindings.mjs";

export {
  BACKEND_SETTLE_GRACE_MS,
  MONITOR_CALL_DEFAULT_TIMEOUT_MS,
  RUN_STATUS_CALL_BUDGET_MS,
  RUN_WAIT_TIMEOUT_MS_BOUNDS
} from "./dispatch-monitor-call-deadline.mjs";

export { runPostWorkerSliceLifecycle } from "./dispatch-post-worker-lifecycle.mjs";

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const ATTEMPT_LINEAGE_PROJECTION_KEYS = Object.freeze([
  "schema_version", "state", "prior_run_id", "replacement_run_id", "monitor_handle",
  "prior_mode", "attempted_mode", "conflict_class", "conflict_detail", "next_action"
]);

export function projectLauncherAgentSessionContractForMonitoring(contract) {
  const keys = contract && typeof contract === "object" && !Array.isArray(contract)
    ? Object.keys(contract).sort()
    : [];
  const expected = [...LAUNCHER_AGENT_SESSION_CONTRACT_FIELDS].sort();
  if (contract?.schema_version !== LAUNCHER_AGENT_SESSION_CONTRACT_SCHEMA_VERSION ||
      keys.length !== expected.length || keys.some((key, index) => key !== expected[index]) ||
      digestLauncherAgentSessionContract(contract) !== contract.contract_digest) {
    throw new TypeError("monitoring requires an intact launcher agent session contract");
  }
  return Object.freeze({
    schema_version: "launcher-agent-session-contract-monitoring-projection.v1",
    contract_schema_version: contract.schema_version,
    contract_digest: contract.contract_digest,
    role: contract.role,
    assigned_unit: contract.assigned_unit.address,
    repository_id: contract.repository.repository_id,
    lifecycle_position: contract.lifecycle.position,
    completion_transport_id: contract.completion_transport.transport_id
  });
}

function attachSessionContractProjection(target, status) {
  if (status?.session_contract === null || status?.session_contract === undefined) {
    if (status?.session_contract_required === true) {
      throw new TypeError("production monitoring status omitted its required session contract");
    }
    return;
  }
  target.session_contract = projectLauncherAgentSessionContractForMonitoring(
    status.session_contract
  );
}

const ATTEMPT_LINEAGE_CONFLICT_CLASS_SET = new Set(
  ATTEMPT_LINEAGE_CONFLICT_CLASSES
);
const ATTEMPT_LINEAGE_PUBLIC_SCHEMA_VERSION =
  "workspace-agent-attempt-lineage-resolution.v2";
const ATTEMPT_LINEAGE_PUBLIC_KEYS = Object.freeze([
  "schema_version", "state", "root_cause", "replacement_run_id", "continuation"
]);
const ATTEMPT_LINEAGE_CONTINUATION_TOOLS = new Set([
  "workspace_agent_run_status"
]);

const ATTEMPT_LINEAGE_PUBLIC_STATES = new Set(
  Object.values(ATTEMPT_LINEAGE_RESOLUTION_STATES)
);

function publishAttemptLineageResolution(status, continuationTool) {
  try {
    const projection = status?.attempt_lineage_resolution ?? null;
    if (projection === null) return null;
    if (!ATTEMPT_LINEAGE_CONTINUATION_TOOLS.has(continuationTool) ||
        projection?.schema_version !== "workspace-agent-attempt-lineage-resolution.v1" ||
        Reflect.ownKeys(projection).sort().join("\0") !==
          [...ATTEMPT_LINEAGE_PROJECTION_KEYS].sort().join("\0") ||
        !ATTEMPT_LINEAGE_PUBLIC_STATES.has(projection.state) ||
        !ATTEMPT_LINEAGE_CONFLICT_CLASS_SET.has(projection.conflict_class) ||
        ((projection.state === "selected") !== (projection.conflict_class === "none")) ||
        projection.replacement_run_id !== status.run_id ||
        projection.monitor_handle !== status.monitor_handle ||
        typeof status.subject !== "string" || status.subject.length === 0) {
      throw new TypeError();
    }
    const continuation = projection.state === "selected" &&
        projection.next_action === "consume_selected_result"
      ? null
      : Object.freeze({
          tool: continuationTool,
          arguments: Object.freeze({
            subject: status.subject,
            attempt_id: status.run_id
          })
        });
    const publicProjection = Object.freeze({
      schema_version: ATTEMPT_LINEAGE_PUBLIC_SCHEMA_VERSION,
      state: projection.state,
      root_cause: projection.conflict_class === "none"
        ? null
        : projection.conflict_class,
      replacement_run_id: projection.replacement_run_id,
      continuation
    });
    if (Reflect.ownKeys(publicProjection).join("\0") !==
        ATTEMPT_LINEAGE_PUBLIC_KEYS.join("\0")) throw new TypeError();
    return publicProjection;
  } catch {

    throw new TypeError("launcher attempt-lineage projection is not publishable");
  }
}

export {
  buildCloseoutWorkflowContinuation,
  CLOSEOUT_WORKFLOW_CONTINUATION_SCHEMA_VERSION
} from "./dispatch-closeout-continuation.mjs";

export function registerRunMonitorRoutes(ctx) {
  const {
    registerTool: registerToolInput,
    workspaceRepos,
    z,
    jsonContent,
    resolveWorkspaceRepo,
    dispatchBackend,
    dispatchSessionIdentity,
    responseEnv = process.env,

    runStatusCallBudgetMs = RUN_STATUS_CALL_BUDGET_MS
  } = ctx;

  const registerTool = withRecordedRequestSchemas(registerToolInput);

  const authoredContractRetention = createAuthoredContractRetention({ env: responseEnv });

  const monitorRefusal = ({ code, decidingFacts, observedFacts, continuation = null, carried = null, route }) => {
    const common = { code, decidingFacts, observedFacts, route, carried };
    if (continuation === null) {
      return buildDispatchMechanicalRefusal({
        ...common,
        noSupportedRoute: true,
        recovery: NO_SUPPORTED_ROUTE_RECOVERY
      });
    }
    const projectedContinuation = continuation.call.tool === route
      ? Object.freeze({
          ...continuation.call,
          prerequisite_predicate: continuation.call.success_predicate
        })
      : continuation.call;
    return buildDispatchMechanicalRefusal({
      ...common,
      nextCalls: [projectedContinuation],
      recovery: {
        state: "callable",
        prerequisite: continuation.prerequisite,
        operation: projectedContinuation.tool,
        success_condition: continuation.successCondition,
        success_predicate: projectedContinuation.success_predicate
      }
    });
  };

  const unknownHandleRefusal = (code, route) => monitorRefusal({
    code,
    decidingFacts: [
      { field: "monitor.handle_minted_by_server", value: false },
      { field: "monitor.known_runs_enumerated", value: false }
    ],
    observedFacts: {
      "monitor.handle_minted_by_server": false,
      "monitor.known_runs_enumerated": false
    },
    continuation: null,
    route
  });

  const unsettledCallContinuation = (route, subject, attemptId = null) => {
    const call = buildDispatchContinuation({
      tool: route,
      arguments: { subject, ...(attemptId === null ? {} : { attempt_id: attemptId }) },
      successPredicate: { fact: "monitor.call_settled_within_bound", operator: "is_true" }
    });
    return call === null ? null : {
      call,
      prerequisite: "this monitor call's server-owned bound elapsed before the backend answered",
      successCondition: `${route} returns a settled run status for the same subject and attempt`
    };
  };

  const backendAbsentRefusal = (route, missingBackend) => monitorRefusal({
    code: DISPATCH_BLOCKER_CODES.BACKEND_UNAVAILABLE,
    decidingFacts: [
      { field: "monitor.backend_registered", value: false },
      { field: "monitor.missing_backend", value: missingBackend }
    ],
    observedFacts: {
      "monitor.backend_registered": false,
      "monitor.missing_backend": missingBackend
    },

    continuation: null,
    route
  });

  const routeExceptionRefusal = (route) => monitorRefusal({
    code: DISPATCH_BLOCKER_CODES.HANDLER_EXCEPTION,
    decidingFacts: [{ field: "monitor.call_completed", value: false }],
    observedFacts: { "monitor.call_completed": false },
    continuation: null,
    route
  });

  const invalidArgumentRefusal = (route, field, value, code = DISPATCH_BLOCKER_CODES.VALIDATION_FAILURE) => monitorRefusal({
    code,
    decidingFacts: [{ field, value }],
    observedFacts: { [field]: value },

    continuation: null,
    route
  });

  const postWorkerLifecycleByRun = new Map();

  function attemptSelectionRefusal({ subject, attempts, detail = null, route }) {
    const candidates = Array.isArray(attempts) ? attempts : [];
    const nextCalls = candidates
      .filter((candidate) => typeof candidate?.attempt_id === "string")
      .map((candidate) => {
        const call = buildDispatchContinuation({
          tool: route,
          arguments: {
            subject,
            attempt_id: candidate.attempt_id,
            ...(detail === null ? {} : { detail })
          },
          successPredicate: { fact: "monitor.attempt_selected", operator: "is_true" }
        });
        return Object.freeze({
          ...call,
          prerequisite_predicate: call.success_predicate
        });
      });
    return buildDispatchMechanicalRefusal({
      code: DISPATCH_BLOCKER_CODES.VALIDATION_FAILURE,
      decidingFacts: [
        { field: "monitor.attempt_selection_ambiguous", value: true },
        { field: "monitor.attempt_selected", value: false }
      ],
      observedFacts: {
        "monitor.attempt_selection_ambiguous": true,
        "monitor.attempt_selected": false
      },
      nextCalls,
      recovery: nextCalls.length === 0
        ? NO_SUPPORTED_ROUTE_RECOVERY
        : {
            state: "callable",
            prerequisite: "select one retained attempt",
            operation: route,
            success_condition: "the exact retained attempt is observed",
            success_predicate: { fact: "monitor.attempt_selected", operator: "is_true" }
          },
      route
    });
  }

  async function attemptUnknownHandleRecovery(workspace, args, refusal) {
    if (mapBackendRefusalToDispatchCode(refusal?.code) !== DISPATCH_BLOCKER_CODES.MONITOR_HANDLE_UNKNOWN ||
        typeof args?.subject !== "string" || !WORKER_SLICE_SUBJECT_RE.test(args.subject)) {
      return null;
    }
    if (typeof dispatchBackend?.recoverManagedWorkerRun !== "function") return null;
    return dispatchBackend.recoverManagedWorkerRun({
      workspace,
      subject: args.subject,
      attempt_id: args.attempt_id ?? null
    });
  }

  const UNOWNED_IDENTITY_PROJECTIONS = new Set([
    "launcher_transition.backend_refusal_identity_missing.v1",
    "launcher_transition.backend_refusal_identity_unknown.v1"
  ]);
  function projectProofVerificationDetailFailure(error) {
    if (typeof error?.code !== "string") {
      return DISPATCH_BLOCKER_CODES.MONITOR_PROOF_VERIFICATION_EVIDENCE_UNAVAILABLE;
    }
    const projected = mapBackendRefusalToDispatchCode(error.code);
    return UNOWNED_IDENTITY_PROJECTIONS.has(projected)
      ? DISPATCH_BLOCKER_CODES.MONITOR_PROOF_VERIFICATION_EVIDENCE_UNAVAILABLE
      : projected;
  }

  function subjectObservationUnavailable(subject, code, route) {
    return {
      blockerCode: DISPATCH_BLOCKER_CODES.MONITOR_SUBJECT_OBSERVATION_UNAVAILABLE,
      reason: code,
      detail: { code, subject },
      refusal: monitorRefusal({
        code: DISPATCH_BLOCKER_CODES.MONITOR_SUBJECT_OBSERVATION_UNAVAILABLE,
        decidingFacts: [{ field: "monitor.observation_available", value: false }],
        observedFacts: { "monitor.observation_available": false },
        carried: { cause: { code } },
        continuation: null,
        route
      })
    };
  }

  function unavailableSubjectRecovery(args, refusal, route) {
    if (refusal?.reason !== "attempt_observation_unavailable") return null;
    if (WORKER_SLICE_SUBJECT_RE.test(args.subject)) return null;
    const kind = classifyAgentDispatchSubject(args.subject);
    const code = kind === "work_record"
      ? "findings_observation_unavailable"
      : "recovery_unsupported_for_subject";
    return subjectObservationUnavailable(args.subject, code, route);
  }

  function unresponsiveBackendRefusal(reason, budgetMs, { route, subject, attemptId } = {}) {
    return {
      blockerCode: DISPATCH_BLOCKER_CODES.BACKEND_UNAVAILABLE,
      reason,
      detail: {
        call_budget_ms: budgetMs,
        message: "the dispatch backend did not answer inside this monitor call's bound; the run is unaffected"
      },
      nextAction: "retry status for the same subject and attempt; do not relaunch",
      refusal: monitorRefusal({
        code: DISPATCH_BLOCKER_CODES.BACKEND_UNAVAILABLE,
        decidingFacts: [
          { field: "monitor.call_settled_within_bound", value: false },
          { field: "monitor.call_budget_ms", value: budgetMs ?? null }
        ],
        observedFacts: {
          "monitor.call_settled_within_bound": false,
          "monitor.call_budget_ms": budgetMs ?? null
        },
        continuation: route ? unsettledCallContinuation(route, subject, attemptId) : null,
        route: route ?? null
      })
    };
  }

  function unresponsiveRecoveryRefusal(refusal, budgetMs, { route, subject, attemptId } = {}) {
    return {
      blockerCode: DISPATCH_BLOCKER_CODES.POST_WORKER_LIFECYCLE_RECOVERY_UNRESPONSIVE,
      reason: "post_worker_lifecycle_recovery_unresponsive",
      refusal: monitorRefusal({
        code: DISPATCH_BLOCKER_CODES.POST_WORKER_LIFECYCLE_RECOVERY_UNRESPONSIVE,
        decidingFacts: [
          { field: "monitor.recovery_settled_within_bound", value: false },
          { field: "monitor.call_settled_within_bound", value: false }
        ],
        observedFacts: {
          "monitor.recovery_settled_within_bound": false,
          "monitor.call_settled_within_bound": false
        },
        carried: { backend_refusal: { code: refusal?.code ?? null, reason: refusal?.reason ?? null } },
        continuation: route ? unsettledCallContinuation(route, subject, attemptId) : null,
        route: route ?? null
      }),
      detail: {
        call_budget_ms: budgetMs,

        backend_refusal: { code: refusal?.code ?? null, reason: refusal?.reason ?? null }
      },
      nextAction: "retry status for the same subject and attempt; do not relaunch"
    };
  }

  function resolveRecoveryRefusal(recovered, refusal, fallbackReason, { route } = {}) {
    const failure = recovered?.recovery_failure ?? null;
    if (failure === null) {
      const code = mapBackendRefusalToDispatchCode(refusal.code);
      return {
        blockerCode: code,
        reason: refusal.reason ?? fallbackReason,
        detail: refusal.detail ?? null,

        refusal: unknownHandleRefusal(code, route ?? null)
      };
    }
    return {
      blockerCode: DISPATCH_BLOCKER_CODES.POST_WORKER_LIFECYCLE_RECOVERY_FAILED,

      refusal: monitorRefusal({
        code: DISPATCH_BLOCKER_CODES.POST_WORKER_LIFECYCLE_RECOVERY_FAILED,
        decidingFacts: [{ field: "monitor.post_worker_lifecycle_recovered", value: false }],
        observedFacts: { "monitor.post_worker_lifecycle_recovered": false },
        carried: { backend_refusal: { code: refusal.code ?? null, reason: refusal.reason ?? null } },
        continuation: null,
        route: route ?? null
      }),
      reason: typeof failure.reason === "string" && failure.reason.length > 0
        ? failure.reason
        : "post_worker_lifecycle_recovery_failed",
      detail: {
        recovery_failure: failure,

        backend_refusal: { code: refusal.code ?? null, reason: refusal.reason ?? null }
      }
    };
  }

  const NO_MANAGED_LIFECYCLE = Object.freeze({ lifecycle: null, advance_in_flight: false });
  const settledAdvance = (lifecycle) => ({ lifecycle, advance_in_flight: false });

  const failedAdvance = (lifecycle) => ({
    lifecycle, advance_in_flight: false, attempt_failed: true
  });

  const createMonitorRequest = () => ({ bound: false, attempt: null });

  const RETRY_ASSESSMENT_SCHEMA_VERSION = "workspace-agent-lifecycle-retry-assessment.v1";

  const retryAssessment = (fields) => Object.freeze({
    schema_version: RETRY_ASSESSMENT_SCHEMA_VERSION,
    grants_authority: false,
    ...fields
  });

  async function advanceManagedSliceLifecycle(workspace, status, deadline, request) {
    if (status?.role !== "worker" || status?.terminal !== true || !WORKER_SLICE_SUBJECT_RE.test(status?.subject ?? "")) {
      return NO_MANAGED_LIFECYCLE;
    }
    if (!postWorkerLifecycleByRun.has(status.run_id)) {
      postWorkerLifecycleByRun.set(status.run_id, createLifecycleCheckpoint());
    }
    const checkpoint = postWorkerLifecycleByRun.get(status.run_id);

    const retryPendingFailurePublications = async () => {
      const pending = Array.isArray(checkpoint.pending_failure_publications)
        ? checkpoint.pending_failure_publications
        : [];
      if (pending.length === 0 ||
          typeof dispatchBackend?.recordManagedLifecycleFailure !== "function") return;
      const remaining = [];
      let failureCode = null;
      let failureEvidence = null;
      for (const item of pending) {
        let publication;
        try {
          publication = await dispatchBackend.recordManagedLifecycleFailure(item);
        } catch (error) {
          publication = {
            ok: false,
            code: typeof error?.code === "string"
              ? error.code
              : "lifecycle_failure_publication_failed",
            evidence: captureLifecycleFailureEvidence(error, {
              operation: "failure_history_publication"
            })
          };
        }
        if (publication?.ok !== true) {
          remaining.push(item);
          failureCode ??= publication?.code ?? publication?.refusal?.code ??
            "lifecycle_failure_publication_failed";

          failureEvidence ??= publication ?? null;
        }
      }
      checkpoint.pending_failure_publications = remaining;
      if (remaining.length > 0) {
        checkpoint.failure_history_durability = Object.freeze({
          state: "unavailable",
          code: failureCode,
          pending_count: remaining.length,
          publication_result: failureEvidence
        });
        return;
      }
      checkpoint.failure_history_durability = Object.freeze({ state: "durable" });
      const detail = dispatchBackend.readManagedRunObservation?.({
        subject: status.subject,
        attemptId: status.run_id,
        detail: { kind: "failure_history", limit: 1 }
      });
      if (detail?.ok === true) checkpoint.failure_attempts = detail.total_count;
    };

    await retryPendingFailurePublications();

    if (status.final_result_durability === "unavailable") {
      return settledAdvance({
        phase: checkpoint.phase,
        publication_retry_required: true,
        publication_failure: status.final_result_publication_failure ?? null
      });
    }
    if (checkpoint.phase === POST_WORKER_LIFECYCLE_PHASES.FINALIZED) {
      return settledAdvance(checkpoint.finalized);
    }

    const assessRetainedFailure = async () => {
      const facts = checkpoint.retry_facts ?? null;
      if (facts === null || facts.kind !== LIFECYCLE_RETRY_FACT_KINDS.DETERMINISTIC) {
        checkpoint.retry_decision = Object.freeze({
          decision: "fresh_authenticated_attempt",
          reason: "cause_and_correction_condition_unknown"
        });
        return true;
      }
      if (typeof dispatchBackend?.assessManagedLifecycleRetry !== "function") {
        checkpoint.retry_decision = Object.freeze({
          decision: "correction_unknown",
          reason: "correction_assessment_unavailable"
        });
        return true;
      }
      let assessed;
      try {
        assessed = await dispatchBackend.assessManagedLifecycleRetry({
          run: Object.freeze({
            subject: status.subject,
            monitor_handle: status.monitor_handle,
            run_id: status.run_id
          }),
          facts: facts.producer_facts
        });
      } catch (error) {
        assessed = {
          decision: "correction_unknown",
          reason: "correction_assessment_failed",
          evidence: captureLifecycleFailureEvidence(error, {
            operation: "lifecycle_retry_correction_assessment"
          })
        };
      }
      const unchanged = assessed?.decision === "relevant_inputs_unchanged";
      const decision = Object.freeze({
        decision: typeof assessed?.decision === "string" ? assessed.decision : "correction_unknown",
        ...(assessed?.changed_inputs === undefined ? {} : { changed_inputs: assessed.changed_inputs }),
        ...(assessed?.reason === undefined ? {} : { reason: assessed.reason }),
        ...(assessed?.evidence === undefined ? {} : { assessment_evidence: assessed.evidence })
      });
      if (unchanged) {
        checkpoint.retry_decision = null;
        checkpoint.retry_assessment = retryAssessment({
          failure_class: LIFECYCLE_RETRY_FACT_KINDS.DETERMINISTIC,
          correction_condition: facts.producer_facts.correction_condition,
          ...decision,
          automatic_retry: "stopped_within_this_request",
          retained_failure_returned: true,
          meaning: "the inputs this refusal was decided on are unchanged, so no " +
            "integration attempt was made and no failure event was recorded"
        });
        return false;
      }
      checkpoint.retry_decision = decision;
      return true;
    };

    if (checkpoint.in_flight === null) {

      if (request.bound === true) {
        return checkpoint.retained_failure === null
          ? { lifecycle: null, advance_in_flight: false }
          : failedAdvance(checkpoint.retained_failure);
      }
      if (checkpoint.retained_failure !== null && !(await assessRetainedFailure())) {
        request.bound = true;
        return failedAdvance(checkpoint.retained_failure);
      }
      const invocationId = randomUUID();
      const invoke = dispatchBackend?.runPostWorkerSliceLifecycle ?? runPostWorkerSliceLifecycle;
      const statusWithCheckpoint = { ...status };
      Object.defineProperty(statusWithCheckpoint, POST_WORKER_LIFECYCLE_CHECKPOINT, {
        value: checkpoint,
        enumerable: false
      });
      // eslint-disable-next-line prefer-const -- the settlement seam below closes over

      let attempt;
      attempt = Promise.resolve()
        .then(() => invoke({ workspace, status: statusWithCheckpoint }))
        .then((result) => {

          checkpoint.retained_failure = null;
          checkpoint.retry_facts = null;

          if (checkpoint.phase === POST_WORKER_LIFECYCLE_PHASES.PRE_INTEGRATION) {
            checkpoint.integration = result?.integration ?? null;
            checkpoint.finalized = result;
            checkpoint.phase = POST_WORKER_LIFECYCLE_PHASES.FINALIZED;
          }
          return result;
        })

        .catch(async (error) => {
          const failure = recordLifecycleFailure(
            checkpoint,
            buildLifecycleFailure(checkpoint, error)
          );
          checkpoint.retained_failure = failure;

          const facts = lifecycleRetryFactsOf(error);
          const tuple = facts?.execution_tuple;
          checkpoint.retry_facts = tuple?.assigned_unit === status.subject &&
            tuple?.launch_ref === status.monitor_handle && tuple?.run_id === status.run_id
            ? facts
            : null;

          const permitted = checkpoint.retry_decision ?? null;
          checkpoint.retry_decision = null;
          checkpoint.retry_assessment = retryAssessment({
            ...(checkpoint.retry_facts === null
              ? {
                  failure_class: LIFECYCLE_RETRY_FACT_KINDS.UNKNOWN,
                  correction_condition: "unknown",
                  decision: "fresh_authenticated_attempt_on_a_later_explicit_request",
                  meaning: "the cause and its correction condition are unknown to this " +
                    "runtime; automatic retries stop, and a later explicit run_status " +
                    "request makes one fresh authenticated attempt"
                }
              : {
                  failure_class: LIFECYCLE_RETRY_FACT_KINDS.DETERMINISTIC,
                  correction_condition: checkpoint.retry_facts.producer_facts.correction_condition,
                  decision: "reassessed_on_a_later_explicit_request"
                }),
            automatic_retry: "stopped_within_this_request",
            ...(permitted === null ? {} : { attempt_permitted_by: permitted })
          });
          if (typeof dispatchBackend?.recordManagedLifecycleFailure === "function") {

            const pendingPublication = Object.freeze({
              subject: status.subject,
              run: Object.freeze({
                subject: status.subject,
                monitor_handle: status.monitor_handle,
                run_id: status.run_id,
                recovered: status.recovered === true
              }),
              invocationId,
              failure
            });
            checkpoint.pending_failure_publications.push(pendingPublication);
            await retryPendingFailurePublications();
          }
          throw new RecordedLifecycleFailure(failure);
        })

        .finally(() => {
          if (checkpoint.in_flight === attempt) checkpoint.in_flight = null;
        });
      checkpoint.in_flight = attempt;

      retainAbandonedWork(attempt);
    } else if (request.bound === true && request.attempt !== checkpoint.in_flight) {

      return checkpoint.retained_failure === null
        ? { lifecycle: null, advance_in_flight: false }
        : failedAdvance(checkpoint.retained_failure);
    }
    const invocation = checkpoint.in_flight;

    request.bound = true;
    request.attempt = invocation;
    let outcome;
    try {
      outcome = await settleWithinDeadline(invocation, deadline);
    } catch (error) {

      if (error instanceof RecordedLifecycleFailure) return failedAdvance(error.failure);

      return failedAdvance(
        recordLifecycleFailure(checkpoint, buildLifecycleFailure(checkpoint, error))
      );
    }
    if (outcome.settled) return settledAdvance(outcome.value);

    if (checkpoint.phase === POST_WORKER_LIFECYCLE_PHASES.FINALIZED) {
      return settledAdvance(checkpoint.finalized);
    }
    return { lifecycle: null, advance_in_flight: true };
  }

  function projectManagedTerminality({ runId, lifecycle, childTerminal, advanceInFlight = false }) {
    const checkpoint = postWorkerLifecycleByRun.get(runId) ?? null;

    const resolution = advanceInFlight
      ? projectInFlightLifecycleResolution(checkpoint)
      : projectLifecycleResolution({ lifecycle, checkpoint });
    return {
      child_terminal: childTerminal === true,
      terminal: childTerminal === true && (resolution === null || resolution.resolved === true),
      lifecycle_resolution: resolution
    };
  }

  registerTool(
    "workspace_agent_run_status",
    {
      description:
        "Observe one canonical dispatch subject immediately or for a bounded timeout. attempt_id only disambiguates retained runs; detail pages are read-only. Managed-worker observation advances lifecycle; terminal means finalized, child_terminal does not. Follow next_action. Retained review text is usable advisory evidence; required formal attestation settles in the same result.",
      inputSchema: z.object({
        repo: z.string().optional(),
        subject: z.string().refine(
          (value) => classifyAgentDispatchSubject(value) !== null,
          { message: "subject must be a canonical WK, WK slice, or IN address" }
        ),
        attempt_id: z.string().min(1).optional(),
        timeout_ms: z.number().int().min(RUN_WAIT_TIMEOUT_MS_BOUNDS.min)
          .max(RUN_WAIT_TIMEOUT_MS_BOUNDS.max).optional(),
        include_final_result: z.boolean().optional(),
        detail: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("failure_history"), cursor: z.string().min(1).optional(), limit: z.number().int().min(1).max(100).optional() }).strict(),
          z.object({ kind: z.literal("attempts"), cursor: z.string().min(1).optional(), limit: z.number().int().min(1).max(100).optional() }).strict(),
          z.object({ kind: z.literal("proof_verification"), cursor: z.string().min(1).optional(), limit: z.number().int().min(1).max(100).optional(),
            invocation_id: z.string().min(1).max(128).optional() }).strict()
        ]).optional()
      }).strict()
    },
    async (args) => {
      try {
        if (args.detail !== undefined && args.timeout_ms !== undefined) {
          return jsonContent(
            buildBlockedRunStatusResult({
              blockerCode: DISPATCH_BLOCKER_CODES.VALIDATION_FAILURE,
              reason: "detail_and_timeout_are_mutually_exclusive",
              detail: null,
              refusal: invalidArgumentRefusal(
                "workspace_agent_run_status",
                "request.detail_and_timeout_combined",
                true
              )
            })
          );
        }
        if (args.timeout_ms !== undefined &&
            (!Number.isInteger(args.timeout_ms) ||
              args.timeout_ms < RUN_WAIT_TIMEOUT_MS_BOUNDS.min ||
              args.timeout_ms > RUN_WAIT_TIMEOUT_MS_BOUNDS.max)) {
          return jsonContent(buildBlockedRunStatusResult({
            blockerCode: DISPATCH_BLOCKER_CODES.VALIDATION_FAILURE,
            reason: "timeout_ms_out_of_range",
            detail: {
              timeout_ms: args.timeout_ms,
              valid_range: [RUN_WAIT_TIMEOUT_MS_BOUNDS.min, RUN_WAIT_TIMEOUT_MS_BOUNDS.max],
              message: `timeout_ms must be an integer in [${RUN_WAIT_TIMEOUT_MS_BOUNDS.min}, ${RUN_WAIT_TIMEOUT_MS_BOUNDS.max}]`
            },
            refusal: invalidArgumentRefusal(
              "workspace_agent_run_status",
              "request.timeout_ms_within_range",
              false
            )
          }));
        }

        const workspace = resolveWorkspaceRepo(workspaceRepos, args?.repo);

        if (args.detail !== undefined) {
          if (args.detail.invocation_id !== undefined &&
              (args.detail.cursor !== undefined || args.detail.limit !== undefined)) {
            return jsonContent(buildBlockedRunStatusResult({
              blockerCode: DISPATCH_BLOCKER_CODES.VALIDATION_FAILURE,
              reason: "detail_invocation_and_paging_are_mutually_exclusive",
              detail: null,
              refusal: invalidArgumentRefusal(
                "workspace_agent_run_status",
                "request.detail_invocation_and_paging_combined",
                true
              )
            }));
          }
          if (typeof dispatchBackend?.readManagedRunObservation !== "function") {
            return jsonContent(buildBlockedRunStatusResult({
              blockerCode: DISPATCH_BLOCKER_CODES.BACKEND_UNAVAILABLE,
              reason: "run_detail_backend_unavailable",
              detail: null,
              refusal: backendAbsentRefusal("workspace_agent_run_status", "workspace_agent_dispatch_backend.readManagedRunObservation")
            }));
          }
          const detail = await dispatchBackend.readManagedRunObservation({
            caller_session_id: dispatchSessionIdentity,
            subject: args.subject,
            attemptId: args.attempt_id ?? null,
            detail: args.detail
          });
          if (detail?.ok !== true) {
            const ambiguityAttempts = detail?.candidates ?? detail?.attempts;
            if (detail?.code === "attempt_selection_ambiguous") {
              return jsonContent(buildBlockedRunStatusResult({
                blockerCode: DISPATCH_BLOCKER_CODES.VALIDATION_FAILURE,
                reason: detail.code,
                detail: { attempts: ambiguityAttempts ?? [] },
                refusal: attemptSelectionRefusal({
                  subject: args.subject,
                  attempts: ambiguityAttempts,
                  detail: args.detail,
                  route: "workspace_agent_run_status"
                })
              }));
            }
            if (detail?.code === "proof_verification_invocation_unknown" ||
                detail?.code === "attempt_detail_cursor_invalid") {
              return jsonContent(buildBlockedRunStatusResult({
                blockerCode: DISPATCH_BLOCKER_CODES.VALIDATION_FAILURE,
                reason: detail.code,
                detail: null,
                refusal: invalidArgumentRefusal("workspace_agent_run_status", `request.${detail.code}`, true)
              }));
            }
            return jsonContent(buildBlockedRunStatusResult({
              blockerCode: DISPATCH_BLOCKER_CODES.MONITOR_RUN_DETAIL_UNAVAILABLE,
              reason: detail?.code ?? detail?.refusal?.reason ?? "run_detail_unavailable",
              detail: detail?.refusal ?? null,
              refusal: routeExceptionRefusal("workspace_agent_run_status")
            }));
          }
          let projectedDetail = detail;
          if (args.detail.kind === "proof_verification") {
            try {
              projectedDetail = projectRunProofVerificationDetail({
                subject: args.subject,
                detail,
                workspaceDir: realpathSync(path.resolve(workspace.dir)),
                responseEnv
              });
            } catch (error) {

              return jsonContent(buildBlockedRunStatusResult({
                blockerCode: projectProofVerificationDetailFailure(error),
                reason: typeof error?.code === "string" ? error.code : "proof_verification_evidence_unavailable",
                detail: {
                  invocation_id: args.detail.invocation_id ?? null,
                  ...buildDispatchToolExceptionDetail("workspace_agent_run_status", error)
                },
                refusal: routeExceptionRefusal("workspace_agent_run_status")
              }));
            }
          }
          return jsonContent({
            schema_version: AGENT_RUN_STATUS_SCHEMA_VERSION,
            accepted: true,
            subject: args.subject,
            attempt_id: projectedDetail.attempt_id ?? null,
            detail: projectedDetail
          });
        }

        if (!dispatchBackend) {
          const lookup = resolveMonitorHandleAlwaysUnknown(args.attempt_id ?? args.subject);
          return jsonContent(
            buildBlockedRunStatusResult({
              blockerCode: lookup.blocker_code,
              reason: lookup.reason,
              detail: null,
              refusal: unknownHandleRefusal(lookup.blocker_code, "workspace_agent_run_status")
            })
          );
        }

        const callBudgetMs = args.timeout_ms ?? runStatusCallBudgetMs;
        const deadline = createCallDeadline(callBudgetMs);
        const observe = args.timeout_ms === undefined
          ? dispatchBackend.getRunStatus.bind(dispatchBackend)
          : dispatchBackend.waitForRunStatus.bind(dispatchBackend);
        const statusOutcome = await settleWithinDeadline(observe({
          caller_session_id: dispatchSessionIdentity,
          subject: args.subject,
          attempt_id: args.attempt_id ?? null,
          ...(args.timeout_ms === undefined
            ? {}
            : { timeout_ms: args.timeout_ms, poll_interval_ms: Math.min(5000, args.timeout_ms) })
        }), deadline, args.timeout_ms === undefined ? {} : { graceMs: BACKEND_SETTLE_GRACE_MS });
        if (!statusOutcome.settled) {
          return jsonContent(buildBlockedRunStatusResult(
            unresponsiveBackendRefusal("run_status_backend_unresponsive", callBudgetMs, {
              route: "workspace_agent_run_status",
              subject: args.subject,
              attemptId: args.attempt_id ?? null
            })
          ));
        }
        let status = statusOutcome.value;
        let recoveredLifecycle;
        if (!status || status.accepted !== true) {
          const refusal = status?.refusal ?? {};
          if (refusal.reason === "attempt_selection_ambiguous") {
            return jsonContent(buildBlockedRunStatusResult({
              blockerCode: DISPATCH_BLOCKER_CODES.VALIDATION_FAILURE,
              reason: refusal.reason,
              detail: refusal.detail,
              refusal: attemptSelectionRefusal({
                subject: args.subject,
                attempts: refusal.detail?.attempts,
                route: "workspace_agent_run_status"
              })
            }));
          }
          const unavailable = unavailableSubjectRecovery(
            args, refusal, "workspace_agent_run_status"
          );
          if (unavailable !== null) {
            return jsonContent(buildBlockedRunStatusResult(unavailable));
          }
          const recoveryOutcome = await settleWithinDeadline(
            attemptUnknownHandleRecovery(workspace, args, refusal), deadline
          );
          if (!recoveryOutcome.settled) {
            return jsonContent(buildBlockedRunStatusResult(
              unresponsiveRecoveryRefusal(refusal, callBudgetMs, {
                route: "workspace_agent_run_status",
                subject: args.subject,
                attemptId: args.attempt_id ?? null
            })
            ));
          }
          const recovered = recoveryOutcome.value;
          if (recovered?.status?.accepted === true &&
              Object.prototype.hasOwnProperty.call(recovered, "lifecycle")) {
            status = recovered.status;
            recoveredLifecycle = recovered.lifecycle;
          } else if (recovered?.recovery_failure?.code === "findings_observation_unavailable") {
            return jsonContent(buildBlockedRunStatusResult(subjectObservationUnavailable(
              args.subject, recovered.recovery_failure.code, "workspace_agent_run_status"
            )));
          } else {
            return jsonContent(
              buildBlockedRunStatusResult(
                resolveRecoveryRefusal(recovered, refusal, "run_status_backend_refused", {
                  route: "workspace_agent_run_status"
                })
              )
            );
          }
        }

        const request = createMonitorRequest();
        let advance;
        if (recoveredLifecycle === undefined) {
          advance = await advanceManagedSliceLifecycle(workspace, status, deadline, request);
        } else {
          request.bound = true;
          advance = settledAdvance(recoveredLifecycle);
        }
        let lifecycle = advance.lifecycle;

        const includeFullFinalResult = args?.include_final_result === true;
        const finalResult = status.final_result ?? null;
        const reviewResult = compactRunStatusReviewResult(status.review_result);
        let terminality = projectManagedTerminality({
          runId: status.run_id,
          lifecycle,
          childTerminal: status.terminal === true,
          advanceInFlight: advance.advance_in_flight
        });
        let boundedObservationExpired = status.timed_out === true;

        while (args.timeout_ms !== undefined && !boundedObservationExpired &&
               advance.attempt_failed !== true &&
               !terminality.terminal && terminality.lifecycle_resolution !== null) {
          const remainingMs = deadline.remainingMs();
          if (remainingMs <= 0) {
            boundedObservationExpired = true;
            break;
          }
          const sleepMs = Math.min(5000, remainingMs);
          await sleep(sleepMs);
          if (sleepMs === remainingMs) {
            boundedObservationExpired = true;
            break;
          }
          advance = await advanceManagedSliceLifecycle(workspace, status, deadline, request);
          if (advance.lifecycle !== null) lifecycle = advance.lifecycle;
          terminality = projectManagedTerminality({
            runId: status.run_id,
            lifecycle,
            childTerminal: status.terminal === true,
            advanceInFlight: advance.advance_in_flight
          });
        }
        const accepted = {
          schema_version: AGENT_RUN_STATUS_SCHEMA_VERSION,
          accepted: true,

          settled: !boundedObservationExpired && advance.advance_in_flight !== true &&
            !(args.timeout_ms !== undefined && advance.attempt_failed === true),
          attempt_id: status.run_id,
          run_id: status.run_id,
          monitor_handle: status.monitor_handle,
          app: status.app ?? null,
          role: status.role,
          subject: status.subject,

          status: status.status,
          terminal: terminality.terminal,
          child_terminal: terminality.child_terminal,
          started_at: status.started_at,

          updated_at: status.updated_at,
          exit: status.exit ?? null,
          review_result: reviewResult
        };
        if (status.final_result_durability !== undefined) {
          accepted.final_result_durability = status.final_result_durability;
        }
        if (status.final_result_publication_failure !== undefined) {
          accepted.final_result_publication_failure = status.final_result_publication_failure;
        }
        attachSessionContractProjection(accepted, status);
        const attemptLineageResolution = publishAttemptLineageResolution(
          status,
          "workspace_agent_run_status"
        );
        if (attemptLineageResolution !== null) {
          accepted.attempt_lineage_resolution = attemptLineageResolution;
        }
        if (terminality.lifecycle_resolution) {
          accepted.lifecycle_resolution = terminality.lifecycle_resolution;
        }
        if (!terminality.terminal) {
          accepted.next_action = LIFECYCLE_RESOLUTION_NEXT_ACTIONS.RETRY;
        }

        const closeoutOutcome = await settleWithinDeadline(buildCloseoutWorkflowContinuation({
          dispatchBackend,
          status
        }), deadline);
        if (closeoutOutcome.settled && closeoutOutcome.value !== null) {
          accepted.closeout_continuation = closeoutOutcome.value;
        }

        if (status.role === "worker" && WORKER_SLICE_SUBJECT_RE.test(status.subject ?? "")) {
          const proofOutcome = await settleWithinDeadline(observeRunProofVerification({
            dispatchBackend,
            callerSessionId: dispatchSessionIdentity,
            status
          }), deadline);
          accepted.proof_verification = proofOutcome.settled
            ? proofOutcome.value
            : Object.freeze({ state: "unavailable", code: "run_status_call_bound_elapsed", grants_authority: false });
        }

        if (lifecycle) {
          const published = publishableLifecycleFailure(lifecycle);

          const retention = authoredContractRetention.retain({
            repository: workspace.repo,
            status,
            lifecycle: published
          });
          accepted.slice_lifecycle = projectPublishedIntegrationReceipt(
            projectPublishedSliceLifecycle(published, { retention }),
            { retention }
          );
        }
        Object.assign(accepted, projectRunFinalResultPublication(
          finalResult,
          { includeFullFinalResult }
        ));
        return jsonContent(omitNullFields(accepted));
      } catch (error) {
        return jsonContent(
          buildBlockedRunStatusResult({
            blockerCode: DISPATCH_BLOCKER_CODES.HANDLER_EXCEPTION,
            reason: "run_status_tool_exception",

            detail: {
              ...buildDispatchToolExceptionDetail("workspace_agent_run_status", error),
              evidence: captureLifecycleFailureEvidence(error, {
                operation: "workspace_agent_run_status"
              })
            },

            refusal: routeExceptionRefusal("workspace_agent_run_status")
          })
        );
      }
    }
  );

}
