

import path from "node:path";
import { realpathSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { proofAuthoringFocusInputSchema, proofAuthoringUnitInputSchema }
  from "./proof-authoring-input-schema.mjs";

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
  publishableLifecycleResolution,
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
import { buildFindingsMaterialContinuation } from "./dispatch-findings-material-continuation.mjs";
import {
  projectPublishedControlledGeneration,
  projectCompactSliceLifecycle,
  projectPublishedSliceLifecycle
} from "./dispatch-run-status-authored-contract-projection.mjs";
import { projectPublishedIntegrationReceipt } from
  "./dispatch-run-status-integration-receipt-projection.mjs";
import {
  AUTHORED_DOCUMENTS_QUERY_IDENTITY,
  createAuthoredContractRetention,
  readRunStatusRetainedSource
} from "./dispatch-run-status-authored-contract-retention.mjs";
import {
  authoredDocumentCall,
  authoredDocumentDetailSchema,
  presentAuthoredDocument,
  RUN_STATUS_AUTHORED_DOCUMENT_DETAIL_KIND
} from "./dispatch-run-status-retained-document-retrieval.mjs";
import {
  activeMcpInlineByteLimit,
  describeRetentionFailure,
  measureMcpInlineResultBytes
} from "./mcp-response.mjs";
import {
  retainSelectedResponseSource,
  SELECTED_RESPONSE_QUERY_INVALID_CODE,
  selectedResponseDeliveryBound,
  selectedResponseQueryInvalidError
} from "./selected-response-snapshot.mjs";
import { observeRunProofVerification, projectCompactRunProofVerification,
  projectRunProofVerificationDetail, RUN_PROOF_VERIFICATION_SELECTION_UNKNOWN_CODE } from
  "./dispatch-run-proof-verification.mjs";
import { terminalCandidateVerifyProofCall } from "./verify-proof-candidate-call.mjs";
import { parseToolProfile } from "./tool-profile.mjs";
import { AUTHENTICATED_INTEGRATION_CONTINUATION } from
  "@agent-chassis/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-integration.mjs";
import {
  adoptDurableLifecycleFailures,
  createLifecycleCheckpoint,
  LIFECYCLE_RETRY_DECISIONS,
  LIFECYCLE_RETRY_FACT_KINDS,
  lifecycleRetryFactsOf,
  LIFECYCLE_RESOLUTION_NEXT_ACTIONS,
  POST_WORKER_LIFECYCLE_CHECKPOINT,
  POST_WORKER_LIFECYCLE_PHASES,
  projectInFlightLifecycleResolution,
  projectLifecycleResolution,
  recordLifecycleFailure,
  retryAssessmentNextAction,
  retryAssessmentRequiredCorrection,
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
  DISPATCH_FAILURE_ORIGINALS,
  dispatchRepoResolutionRefusal,
  dispatchRequestSchemaAuthority,
  mapBackendRefusalToDispatchCode,
  omitNullFields,
  projectDispatchFailureDetail,
  projectRecordedFailureDetail,
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

const RETRY_ASSESSMENT_DETAIL_KIND = "retry_assessment";
const RETRY_ASSESSMENT_QUERY_IDENTITY = "retry_assessment";
const RETRY_ASSESSMENT_DETAIL_SCHEMA_VERSION = "workspace-agent-run-status-retry-assessment-detail.v1";

const COMPACT_RETRY_ASSESSMENT_FACTS = new Set(["decision", "failure_class", "reason", "code",
  "boundary", "attempt_withheld", "attempt_permitted_by", "grants_authority"]);

const HOT_PRODUCER_DECISIONS = new Set([
  LIFECYCLE_RETRY_DECISIONS.UNCHANGED,
  LIFECYCLE_RETRY_DECISIONS.CHANGED,
  LIFECYCLE_RETRY_DECISIONS.COMPLETED,
  LIFECYCLE_RETRY_DECISIONS.OUTSIDE_ALLOCATION,
  LIFECYCLE_RETRY_DECISIONS.PRODUCER_UNDECIDED
]);
const RESTART_PRODUCER_DECISIONS = new Set([
  LIFECYCLE_RETRY_DECISIONS.CURRENT_REFUSAL,
  LIFECYCLE_RETRY_DECISIONS.CORRECTION_UNESTABLISHED,
  LIFECYCLE_RETRY_DECISIONS.PRODUCER_UNDECIDED
]);
const WITHHELD_PRODUCER_MEANINGS = Object.freeze({
  [LIFECYCLE_RETRY_DECISIONS.UNCHANGED]: "the inputs this refusal was decided on are " +
    "unchanged, so no integration attempt was made and no failure event was recorded",
  [LIFECYCLE_RETRY_DECISIONS.OUTSIDE_ALLOCATION]: "the canonical scope changed, but the " +
    "delivery touches paths outside the scope its attempt was allocated; a revised " +
    "contract is new-generation work and never authorizes integrating this delivery",
  [LIFECYCLE_RETRY_DECISIONS.PRODUCER_UNDECIDED]: "the producing owner could not decide " +
    "whether the refusal was corrected; that is not a correction, so no integration " +
    "attempt was made",
  [LIFECYCLE_RETRY_DECISIONS.CURRENT_REFUSAL]: "after a restart the producer re-derived " +
    "a current refusal read-only; the retained failure's correction facts did not " +
    "survive the restart, so no integration attempt was made",
  [LIFECYCLE_RETRY_DECISIONS.CORRECTION_UNESTABLISHED]: "after a restart the retained " +
    "failure's correction facts are gone; a current admission pass does not prove the " +
    "historical failure was corrected, so no integration attempt was made"
});

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

function compactLifecycleResolution(resolution, status, { assessmentSource = null } = {}) {
  if (!Array.isArray(resolution?.retained_failures)) return resolution;
  const { retained_failures: retained, required_correction: mirrored, ...facts } = resolution;
  const omitted = ["retained_failures"];
  if (mirrored !== undefined) omitted.push("required_correction");
  if (facts.retry_assessment !== null && typeof facts.retry_assessment === "object" &&
      Object.hasOwn(facts.retry_assessment, "assessment_evidence")) {
    const { assessment_evidence: _evidence, ...assessment } = facts.retry_assessment;
    omitted.push("retry_assessment.assessment_evidence");
    if (assessmentSource?.state === "retained") {

      const kept = {};
      for (const [member, value] of Object.entries(assessment)) {
        if (COMPACT_RETRY_ASSESSMENT_FACTS.has(member)) kept[member] = value;
        else omitted.push(`retry_assessment.${member}`);
      }
      facts.retry_assessment = Object.freeze(kept);
    } else {
      facts.retry_assessment = Object.freeze(assessment);
      if (assessmentSource !== null) facts.retry_assessment_detail = assessmentSource;
    }
  }
  let historyCall = null;
  try {
    historyCall = buildDispatchContinuation({
      tool: "workspace_agent_run_status",
      arguments: { subject: status.subject,
        ...(typeof status.run_id === "string" ? { attempt_id: status.run_id } : {}),
        detail: { kind: "failure_history" } },
      successPredicate: { fact: "monitor.failure_history_detail_read", operator: "is_true" }
    });
  } catch {
    historyCall = null;
  }
  return Object.freeze({
    ...facts,
    retained_failure_count: retained.length,
    ...(historyCall === null ? {} : { failure_history_call: historyCall }),
    omitted_members: Object.freeze(omitted)
  });
}

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

    runStatusCallBudgetMs = RUN_STATUS_CALL_BUDGET_MS,

    requestContracts = null
  } = ctx;

  const registerTool = withRecordedRequestSchemas(registerToolInput);

  const authoredContractRetention = createAuthoredContractRetention({ env: responseEnv });

  const sessionRole = (() => {
    try {
      return parseToolProfile(responseEnv);
    } catch {
      return null;
    }
  })();

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

  const runDetailUnavailableRefusal = (route, code, causeCode) => monitorRefusal({
    code,
    decidingFacts: [{ field: "monitor.run_detail_available", value: false }],
    observedFacts: { "monitor.run_detail_available": false },
    carried: { cause: { code: typeof causeCode === "string" ? causeCode : null } },
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

        detail: projectRecordedFailureDetail(refusal.detail ?? null,
          { original: DISPATCH_FAILURE_ORIGINALS.READ_OBSERVATION }),

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

        recovery_failure: projectDispatchFailureDetail(failure, { env: responseEnv, nested: true }),

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

  const retryAssessmentSources = new WeakMap();
  const retryAssessmentSourceMemo = new Map();
  const RETRY_ASSESSMENT_SOURCE_MEMO_CAPACITY = 64;

  const retryAssessmentCall = ({ repository, subject, attemptId, source }) => {
    try {
      return buildDispatchContinuation({
        tool: "workspace_agent_run_status",
        arguments: { repo: repository, subject, attempt_id: attemptId,
          detail: { kind: RETRY_ASSESSMENT_DETAIL_KIND,
            source: { ref_id: source.ref_id, sha256: source.sha256 } } },
        successPredicate: { fact: "monitor.retry_assessment_detail_read", operator: "is_true" }
      });
    } catch {
      return null;
    }
  };

  function retainRetryAssessment({ assessment, workspace, status, checkpoint }) {
    if (!Object.hasOwn(assessment, "assessment_evidence")) return;
    const failure = checkpoint.retained_failure;
    const carrier = {
      retry_assessment: assessment,

      retained_failure: failure === null || typeof failure !== "object" ? null : {
        phase: failure.phase ?? null,
        error_code: failure.error_code ?? null,
        failure_cause: failure.failure_cause ?? null
      },
      next_action: retryAssessmentNextAction(assessment),
      required_correction: retryAssessmentRequiredCorrection(assessment)
    };
    const identity = { attempt_id: status.run_id ?? null, monitor_handle: status.monitor_handle ?? null,
      subject: status.subject ?? null };
    let memoKey = null;
    try {
      memoKey = createHash("sha256").update(JSON.stringify({ repository: workspace.repo, identity,
        carrier })).digest("hex");
    } catch {
      memoKey = null;
    }
    const memoized = memoKey === null ? undefined : retryAssessmentSourceMemo.get(memoKey);
    if (memoized !== undefined) {
      retryAssessmentSources.set(assessment, memoized);
      return;
    }
    let fact;
    try {
      const requestSchema = dispatchRequestSchemaAuthority("workspace_agent_run_status");
      if (requestSchema === undefined) throw new TypeError("the run-status request schema is not registered");
      const locator = retainSelectedResponseSource({
        binding: { route: "workspace_agent_run_status", repository: workspace.repo, unit: status.subject,
          query_identity: RETRY_ASSESSMENT_QUERY_IDENTITY, observation_identity: identity },
        carrier,
        ownerCall: (source) => {
          const call = retryAssessmentCall({ repository: workspace.repo, subject: status.subject,
            attemptId: status.run_id, source });
          if (call === null) throw new TypeError("the retry-assessment read is not a checkable call");
          return { tool: call.tool, arguments: call.arguments };
        },
        ownerRequestSchema: requestSchema
      }, { env: responseEnv });
      fact = Object.freeze({ state: "retained", repository: workspace.repo, subject: status.subject,
        attempt_id: status.run_id, locator });
      if (memoKey !== null) {
        if (retryAssessmentSourceMemo.size >= RETRY_ASSESSMENT_SOURCE_MEMO_CAPACITY) {
          retryAssessmentSourceMemo.delete(retryAssessmentSourceMemo.keys().next().value);
        }
        retryAssessmentSourceMemo.set(memoKey, fact);
      }
    } catch (error) {
      fact = Object.freeze({
        state: "unavailable",
        code: typeof error?.envelope?.code === "string" ? error.envelope.code
          : "retry_assessment_source_not_retained",
        retention_failure: describeRetentionFailure(error, {
          operation: "retain_retry_assessment_source",
          subject: { subject: status.subject, attempt_id: status.run_id }
        })
      });
    }
    retryAssessmentSources.set(assessment, fact);
  }

  const retryAssessmentDetailCall = (assessment) => {
    const fact = assessment !== null && typeof assessment === "object"
      ? retryAssessmentSources.get(assessment) : undefined;
    if (fact?.state !== "retained") return null;
    return retryAssessmentCall({ repository: fact.repository, subject: fact.subject,
      attemptId: fact.attempt_id, source: fact.locator });
  };

  function presentRetryAssessment(envelope, detail, fits) {
    const { carrier } = envelope;
    const assessment = carrier?.retry_assessment;
    if (assessment === null || typeof assessment !== "object" || Array.isArray(assessment)) {
      throw selectedResponseQueryInvalidError("workspace_agent_run_status", "source_not_retry_assessment",
        { carrier_members: Object.keys(carrier ?? {}) });
    }
    const projected = Object.hasOwn(assessment, "assessment_evidence") &&
        assessment.assessment_evidence !== null && typeof assessment.assessment_evidence === "object"
      ? { ...assessment, assessment_evidence: projectRecordedFailureDetail(assessment.assessment_evidence, {
        original: DISPATCH_FAILURE_ORIGINALS.RUN_STATUS_RETAINED_SOURCE,
        at: "retry_assessment.assessment_evidence", nested: true }) }
      : assessment;
    const frame = { detail: {
      schema_version: RETRY_ASSESSMENT_DETAIL_SCHEMA_VERSION,
      kind: RETRY_ASSESSMENT_DETAIL_KIND,
      grants_authority: false,
      source: { ref_id: detail.source.ref_id, sha256: detail.source.sha256 },
      retained_source: {
        route: envelope.binding.route,
        repository: envelope.binding.repository,
        unit: envelope.binding.unit,
        observation_identity: envelope.binding.observation_identity
      },
      retry_assessment: projected,
      retained_failure: carrier.retained_failure ?? null,
      next_action: carrier.next_action ?? null,
      ...(carrier.required_correction === null || carrier.required_correction === undefined
        ? {} : { required_correction: carrier.required_correction })
    } };
    if (!fits(frame)) {
      throw selectedResponseQueryInvalidError("workspace_agent_run_status",
        "selected_value_exceeds_delivery_bound", { kind: RETRY_ASSESSMENT_DETAIL_KIND,
          utf8_bytes: Buffer.byteLength(JSON.stringify(projected), "utf8") });
    }
    return frame;
  }

  function readRetainedStatusDetail(workspace, args) {
    const route = "workspace_agent_run_status";
    const { detail } = args;
    if (typeof args.attempt_id !== "string") {
      return buildBlockedRunStatusResult({
        blockerCode: DISPATCH_BLOCKER_CODES.VALIDATION_FAILURE,
        reason: "retained_detail_requires_attempt_id",
        detail: null,
        refusal: invalidArgumentRefusal(route, "request.retained_detail_attempt_id_present", false)
      });
    }
    const bound = selectedResponseDeliveryBound(responseEnv);
    const answer = (frame) => ({
      schema_version: AGENT_RUN_STATUS_SCHEMA_VERSION,
      accepted: true,
      subject: args.subject,
      attempt_id: args.attempt_id,
      ...frame
    });
    const fits = (frame) => measureMcpInlineResultBytes(answer(frame)) <= bound;
    try {
      const envelope = readRunStatusRetainedSource({
        source: detail.source,
        repository: workspace.repo,
        subject: args.subject,
        attemptId: args.attempt_id,
        queryIdentity: detail.kind === RETRY_ASSESSMENT_DETAIL_KIND
          ? RETRY_ASSESSMENT_QUERY_IDENTITY : AUTHORED_DOCUMENTS_QUERY_IDENTITY,
        env: responseEnv
      });
      if (detail.kind === RETRY_ASSESSMENT_DETAIL_KIND) {
        return answer(presentRetryAssessment(envelope, detail, fits));
      }
      return answer(presentAuthoredDocument({
        envelope,
        detail,
        fits,
        call: (selection, recommended) => authoredDocumentCall({ repository: workspace.repo,
          subject: args.subject, attemptId: args.attempt_id, source: detail.source,
          document: detail.document, selection, recommended })
      }));
    } catch (error) {
      const refusal = error?.envelope;
      if (refusal === null || typeof refusal !== "object" || typeof refusal.code !== "string") throw error;
      const observed = refusal.observed_facts ?? {};
      return buildBlockedRunStatusResult({
        blockerCode: refusal.code === SELECTED_RESPONSE_QUERY_INVALID_CODE
          ? DISPATCH_BLOCKER_CODES.VALIDATION_FAILURE
          : DISPATCH_BLOCKER_CODES.MONITOR_RUN_DETAIL_UNAVAILABLE,
        reason: observed["selected_response.invalid_reason"] ??
          observed["content_reference.failed_step"] ?? refusal.code,
        detail: { kind: detail.kind, source: detail.source,
          ...(detail.document === undefined ? {} : { document: detail.document }) },
        refusal
      });
    }
  }

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
      const failure = status.final_result_publication_failure ?? null;
      const repair = failure?.repair_required?.retryable === false ? failure.repair_required : null;
      return settledAdvance({
        phase: checkpoint.phase,
        ...(repair === null
          ? { publication_retry_required: true }
          : { publication_repair_required: repair }),
        publication_failure: failure
      });
    }
    if (checkpoint.phase === POST_WORKER_LIFECYCLE_PHASES.FINALIZED) {
      return settledAdvance(checkpoint.finalized);
    }

    const run = () => Object.freeze({
      subject: status.subject,
      monitor_handle: status.monitor_handle,
      run_id: status.run_id
    });
    const retainedClass = () => checkpoint.retained_failure_origin === "durable_journal"
      ? { failure_class: LIFECYCLE_RETRY_FACT_KINDS.RETAINED_BEFORE_RESTART,
          correction_condition: "not_retained_after_restart" }
      : checkpoint.retry_facts?.kind === LIFECYCLE_RETRY_FACT_KINDS.DETERMINISTIC
        ? { failure_class: LIFECYCLE_RETRY_FACT_KINDS.DETERMINISTIC,
            correction_condition: checkpoint.retry_facts.producer_facts.correction_condition }
        : { failure_class: LIFECYCLE_RETRY_FACT_KINDS.NO_CORRECTION_CONDITION,
            correction_condition: "none_supplied" };

    const assess = (fields) => {
      const assessment = retryAssessment(fields);
      retainRetryAssessment({ assessment, workspace, status, checkpoint });
      return assessment;
    };
    const withhold = (fields) => {
      checkpoint.retry_decision = null;
      checkpoint.retry_assessment = assess({
        ...retainedClass(),
        ...fields,
        attempt_withheld: true,
        automatic_retry: "stopped_within_this_request",
        retained_failure_returned: true
      });
      return false;
    };
    const permit = (decision) => {
      checkpoint.retry_decision = Object.freeze(decision);
      return true;
    };
    const boundaryFailure = (decision, operation, owner, error) => withhold({
      decision,
      boundary: Object.freeze({ operation, owner }),
      ...(error === undefined ? {} : {
        assessment_evidence: captureLifecycleFailureEvidence(error, { operation })
      }),
      meaning: "the retry assessment boundary named here did not produce a " +
        "decision this runtime can act on; that is not a correction, so no " +
        "integration attempt was made"
    });

    const producerAnswer = (value, accepted) => value !== null && typeof value === "object" &&
      value.grants_authority === false && accepted.has(value.decision) &&
      (value.decision !== LIFECYCLE_RETRY_DECISIONS.CHANGED ||
        (Array.isArray(value.changed_inputs) && value.changed_inputs.length > 0 &&
          value.changed_inputs.every((entry) => typeof entry === "string")));
    const producerFields = (value) => ({
      decision: value.decision,
      ...(value.reason === undefined ? {} : { reason: value.reason }),
      ...(value.changed_inputs === undefined ? {} : { changed_inputs: value.changed_inputs }),
      ...(value.offending_paths === undefined ? {} : { offending_paths: value.offending_paths }),
      ...(value.allocated_write_scope === undefined
        ? {} : { allocated_write_scope: value.allocated_write_scope }),
      ...(value.code === undefined ? {} : { code: value.code }),
      ...(value.missing_evidence === undefined ? {} : { missing_evidence: value.missing_evidence }),
      ...(value.owner === undefined ? {} : { owner: value.owner }),
      ...(value.current_admission === undefined
        ? {} : { current_admission: value.current_admission }),
      ...(value.evidence === undefined ? {} : { assessment_evidence: value.evidence })
    });
    const PRODUCER_ASSESSMENT_OWNER = "dispatch_backend.assessManagedLifecycleRetry";
    const RESTART_REDERIVATION_OWNER = "dispatch_backend.rederiveManagedLifecycleRefusal";
    const COMPLETION_OWNER = "dispatch_backend.resolveCommittedSliceIntegrationContinuation";

    const assessRetainedFailure = async (completion) => {

      if (checkpoint.phase !== POST_WORKER_LIFECYCLE_PHASES.PRE_INTEGRATION) {
        return permit({ decision: LIFECYCLE_RETRY_DECISIONS.POST_INTEGRATION_REENTRY });
      }
      if (completion?.completed === true) {
        return permit({ decision: LIFECYCLE_RETRY_DECISIONS.COMPLETED });
      }

      if (completion?.error !== null && completion?.error !== undefined) {
        return boundaryFailure(LIFECYCLE_RETRY_DECISIONS.COMPLETION_OBSERVATION_FAILED,
          "integration_completion_observation", COMPLETION_OWNER, completion.error);
      }
      if (checkpoint.retained_failure_origin === "durable_journal") {
        return rederiveAfterRestart();
      }
      const facts = checkpoint.retry_facts ?? null;
      if (facts === null || facts.kind !== LIFECYCLE_RETRY_FACT_KINDS.DETERMINISTIC) {
        return withhold({
          decision: LIFECYCLE_RETRY_DECISIONS.NO_CORRECTION_CONDITION,
          missing_evidence: "a producer-owned correction condition for this failure",
          owner: "the producer of the retained failure named in latest_failure",
          meaning: "this failure's producer supplied no correction condition, so no " +
            "owner can establish that it was corrected; its cause and evidence are " +
            "in latest_failure and slice_lifecycle, and no integration attempt was made"
        });
      }
      if (typeof dispatchBackend?.assessManagedLifecycleRetry !== "function") {
        return boundaryFailure(LIFECYCLE_RETRY_DECISIONS.ASSESSMENT_UNAVAILABLE,
          "lifecycle_retry_correction_assessment", PRODUCER_ASSESSMENT_OWNER);
      }
      let assessed;
      try {
        assessed = await dispatchBackend.assessManagedLifecycleRetry({
          run: run(),
          facts: facts.producer_facts
        });
      } catch (error) {
        return boundaryFailure(LIFECYCLE_RETRY_DECISIONS.ASSESSMENT_FAILED,
          "lifecycle_retry_correction_assessment", PRODUCER_ASSESSMENT_OWNER, error);
      }
      if (!producerAnswer(assessed, HOT_PRODUCER_DECISIONS)) {
        return boundaryFailure(LIFECYCLE_RETRY_DECISIONS.ASSESSMENT_MALFORMED,
          "lifecycle_retry_correction_assessment", PRODUCER_ASSESSMENT_OWNER, assessed);
      }
      if (assessed.decision === LIFECYCLE_RETRY_DECISIONS.CHANGED ||
          assessed.decision === LIFECYCLE_RETRY_DECISIONS.COMPLETED) {
        return permit(producerFields(assessed));
      }
      return withhold({
        ...producerFields(assessed),
        ...(assessed.decision === LIFECYCLE_RETRY_DECISIONS.PRODUCER_UNDECIDED
          ? { boundary: Object.freeze({
              operation: "lifecycle_retry_correction_assessment",
              owner: PRODUCER_ASSESSMENT_OWNER
            }) }
          : {}),
        meaning: WITHHELD_PRODUCER_MEANINGS[assessed.decision]
      });
    };

    const rederiveAfterRestart = async () => {
      if (typeof dispatchBackend?.rederiveManagedLifecycleRefusal !== "function") {
        return boundaryFailure(LIFECYCLE_RETRY_DECISIONS.ASSESSMENT_UNAVAILABLE,
          "lifecycle_retry_restart_rederivation", RESTART_REDERIVATION_OWNER);
      }
      let rederived;
      try {
        rederived = await dispatchBackend.rederiveManagedLifecycleRefusal({ run: run() });
      } catch (error) {
        return boundaryFailure(LIFECYCLE_RETRY_DECISIONS.ASSESSMENT_FAILED,
          "lifecycle_retry_restart_rederivation", RESTART_REDERIVATION_OWNER, error);
      }
      if (!producerAnswer(rederived, RESTART_PRODUCER_DECISIONS)) {
        return boundaryFailure(LIFECYCLE_RETRY_DECISIONS.ASSESSMENT_MALFORMED,
          "lifecycle_retry_restart_rederivation", RESTART_REDERIVATION_OWNER, rederived);
      }
      return withhold({
        ...producerFields(rederived),
        ...(rederived.decision === LIFECYCLE_RETRY_DECISIONS.PRODUCER_UNDECIDED
          ? { boundary: Object.freeze({
              operation: "lifecycle_retry_restart_rederivation",
              owner: RESTART_REDERIVATION_OWNER
            }) }
          : {}),
        meaning: WITHHELD_PRODUCER_MEANINGS[rederived.decision]
      });
    };

    const adoptDurableFailureHistory = async () => {
      if (checkpoint.durable_history_read === null) {
        const read = Promise.resolve().then(() => dispatchBackend.readManagedRunObservation({
          caller_session_id: dispatchSessionIdentity,
          subject: status.subject,
          attemptId: status.run_id
        })).then((observed) => {
          const tuple = observed?.selected?.dispatch_tuple;
          if (observed?.ok !== true || tuple?.assigned_unit !== status.subject ||
              tuple?.launch_ref !== status.monitor_handle || tuple?.run_id !== status.run_id) {
            return { unavailable: observed ?? { ok: false, code: "failure_history_read_empty" } };
          }
          if (checkpoint.retained_failure === null && checkpoint.in_flight === null) {
            adoptDurableLifecycleFailures(checkpoint, observed.selected.failures);
          }
          return { unavailable: null };
        }, (error) => ({
          unavailable: captureLifecycleFailureEvidence(error, {
            operation: "durable_failure_history_read"
          })
        }));
        checkpoint.durable_history_read = read;
        retainAbandonedWork(read);
      }
      return checkpoint.durable_history_read;
    };

    const observeCompletion = () => {
      if (checkpoint.completion_observation === null) {
        const observation = Promise.resolve()
          .then(() => dispatchBackend.resolveCommittedSliceIntegrationContinuation({
            subject: status.subject,
            status
          }))
          .then((continuation) => ({
            completed: continuation?.[AUTHENTICATED_INTEGRATION_CONTINUATION] === true &&
              continuation.completed === true,
            error: null
          }), (error) => ({ completed: false, error }));
        checkpoint.completion_observation = observation;
        retainAbandonedWork(observation);
        observation.then(() => {
          if (checkpoint.completion_observation === observation) {
            checkpoint.completion_observation = null;
          }
        });
      }
      return checkpoint.completion_observation;
    };

    const startLifecycleAttempt = () => {
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
          checkpoint.retained_failure_origin = null;
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
          checkpoint.retained_failure_origin = "this_process";
          const facts = lifecycleRetryFactsOf(error);
          const tuple = facts?.execution_tuple;
          checkpoint.retry_facts = tuple?.assigned_unit === status.subject &&
            tuple?.launch_ref === status.monitor_handle && tuple?.run_id === status.run_id
            ? facts
            : null;
          const permitted = checkpoint.retry_decision ?? null;
          checkpoint.retry_decision = null;
          checkpoint.retry_assessment = assess({
            ...(checkpoint.phase !== POST_WORKER_LIFECYCLE_PHASES.PRE_INTEGRATION
              ? {
                  failure_class: LIFECYCLE_RETRY_FACT_KINDS.POST_INTEGRATION,
                  correction_condition: "not_applicable",
                  decision: LIFECYCLE_RETRY_DECISIONS.POST_INTEGRATION_REENTRY,
                  meaning: "the delivery is already integrated; a later explicit request " +
                    "re-enters only the failed post-integration step and never integrates"
                }
              : checkpoint.retry_facts === null
              ? {
                  failure_class: LIFECYCLE_RETRY_FACT_KINDS.NO_CORRECTION_CONDITION,
                  correction_condition: "none_supplied",
                  decision: LIFECYCLE_RETRY_DECISIONS.NO_CORRECTION_CONDITION,
                  missing_evidence: "a producer-owned correction condition for this failure",
                  owner: "the producer of the retained failure named in latest_failure",
                  meaning: "this failure's producer supplied no correction condition, so " +
                    "no owner can establish that it was corrected and later requests " +
                    "withhold another attempt; its cause and evidence are in " +
                    "latest_failure and slice_lifecycle"
                }
              : {
                  failure_class: LIFECYCLE_RETRY_FACT_KINDS.DETERMINISTIC,
                  correction_condition: checkpoint.retry_facts.producer_facts.correction_condition,
                  decision: LIFECYCLE_RETRY_DECISIONS.PENDING
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
      return attempt;
    };

    if (checkpoint.in_flight === null) {

      if (request.bound === true) {
        return checkpoint.retained_failure === null
          ? { lifecycle: null, advance_in_flight: false }
          : failedAdvance(checkpoint.retained_failure);
      }
      let completion = null;
      if (checkpoint.phase === POST_WORKER_LIFECYCLE_PHASES.PRE_INTEGRATION &&
          typeof dispatchBackend?.resolveCommittedSliceIntegrationContinuation === "function" &&
          (checkpoint.retained_failure !== null ||
            typeof dispatchBackend?.readManagedRunObservation === "function")) {
        const completionOutcome = await settleWithinDeadline(observeCompletion(), deadline);
        if (!completionOutcome.settled) return { lifecycle: null, advance_in_flight: true };
        completion = completionOutcome.value;
      }
      const completed = completion?.completed === true;
      if (checkpoint.retained_failure === null &&
          typeof dispatchBackend?.readManagedRunObservation === "function") {
        const historyRead = adoptDurableFailureHistory();
        const historyOutcome = await settleWithinDeadline(historyRead, deadline);
        if (!historyOutcome.settled) return { lifecycle: null, advance_in_flight: true };
        const unavailable = historyOutcome.value?.unavailable ?? null;
        if (unavailable !== null && checkpoint.durable_history_read === historyRead) {
          checkpoint.durable_history_read = null;
        }
        if (unavailable !== null && completed) {

          checkpoint.failure_history_durability = Object.freeze({
            state: "unavailable",
            code: "failure_history_read_failed",
            boundary: Object.freeze({
              operation: "durable_failure_history_read",
              owner: "dispatch_backend.readManagedRunObservation"
            }),
            read_result: unavailable
          });
        } else if (unavailable !== null) {

          checkpoint.retry_decision = null;
          checkpoint.retry_assessment = assess({
            failure_class: LIFECYCLE_RETRY_FACT_KINDS.RETAINED_BEFORE_RESTART,
            correction_condition: "not_observable",
            decision: LIFECYCLE_RETRY_DECISIONS.FAILURE_HISTORY_UNAVAILABLE,
            boundary: Object.freeze({
              operation: "durable_failure_history_read",
              owner: "dispatch_backend.readManagedRunObservation"
            }),
            assessment_evidence: unavailable,
            attempt_withheld: true,
            automatic_retry: "stopped_within_this_request",
            meaning: "this attempt's durable failure history could not be read, so " +
              "whether it already failed is unknown and no integration attempt was made"
          });
          request.bound = true;
          return failedAdvance(Object.freeze({
            invoked: false,
            phase: checkpoint.phase,
            integrated: false
          }));
        }
      }
      if (completed) {
        permit({ decision: LIFECYCLE_RETRY_DECISIONS.COMPLETED });
      } else if (checkpoint.retained_failure !== null) {
        if (checkpoint.retry_start_in_flight === null) {
          const start = Promise.resolve().then(() => assessRetainedFailure(completion));
          checkpoint.retry_start_in_flight = start;
          retainAbandonedWork(start);
        }
        const retryStart = checkpoint.retry_start_in_flight;
        const retryStartOutcome = await settleWithinDeadline(retryStart, deadline);
        if (!retryStartOutcome.settled) {
          return { lifecycle: null, advance_in_flight: true };
        }
        if (checkpoint.retry_start_in_flight === retryStart) {
          checkpoint.retry_start_in_flight = null;
        }
        if (!retryStartOutcome.value) {
          request.bound = true;
          return failedAdvance(checkpoint.retained_failure);
        }
      }
      if (checkpoint.in_flight === null) startLifecycleAttempt();
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

  function boundCompleteStatus(published, { status, assessmentSource, assessmentCall,
    omitsAssessmentEvidence }) {
    const limit = activeMcpInlineByteLimit(responseEnv);
    if (measureMcpInlineResultBytes(published) <= limit) return published;
    const bounded = { ...published };
    const omitted = [];
    const calls = [];

    const frame = (fits) => {
      const rootCalls = [...calls, ...(published.next_calls ?? [])];
      return {
        ...bounded,
        bounded_complete: {
          inline_byte_limit: limit,
          fits,
          omitted_members: [...omitted],
          meaning: "the complete result exceeds the inline limit; each omitted member is " +
            "published by the read its `read_by` names"
        },
        ...(rootCalls.length === 0 ? {} : { next_calls: rootCalls })
      };
    };
    const fitting = () => {
      const candidate = frame(true);
      return measureMcpInlineResultBytes(candidate) <= limit ? candidate : null;
    };

    const READ_BY = Object.freeze({
      retained_failures: "lifecycle_resolution.failure_history_call",
      required_correction: "required_correction",
      "retry_assessment.assessment_evidence": "next_calls"
    });
    const resolution = bounded.lifecycle_resolution;
    if (Array.isArray(resolution?.retained_failures)) {
      const compact = compactLifecycleResolution(resolution, status, { assessmentSource });
      bounded.lifecycle_resolution = compact;
      omitted.push(...compact.omitted_members.map((member) => ({
        member: `lifecycle_resolution.${member}`,
        read_by: READ_BY[member] ?? (member.startsWith("retry_assessment.") ? "next_calls" : null) })));
      if (assessmentCall !== null && omitsAssessmentEvidence(compact)) calls.push(assessmentCall);
      const fitted = fitting();
      if (fitted !== null) return fitted;
    }
    const lifecycle = bounded.slice_lifecycle;
    if (lifecycle !== null && typeof lifecycle === "object" && Object.hasOwn(lifecycle, "evidence") &&
        typeof lifecycle.error_code === "string" &&
        bounded.lifecycle_resolution?.latest_failure?.error_code === lifecycle.error_code &&
        bounded.lifecycle_resolution?.failure_history_call !== undefined) {
      const { evidence: _evidence, ...rest } = lifecycle;
      bounded.slice_lifecycle = rest;
      omitted.push({ member: "slice_lifecycle.evidence",
        read_by: "lifecycle_resolution.failure_history_call" });
      const fitted = fitting();
      if (fitted !== null) return fitted;
    }
    return frame(false);
  }

  registerTool(
    "workspace_agent_run_status",
    {
      description:
        "Observe one canonical dispatch subject immediately or for a bounded timeout. attempt_id only disambiguates retained runs; detail pages are read-only. Managed-worker observation advances lifecycle; terminal means finalized, child_terminal does not. Follow next_action. Retained review text is usable advisory evidence; required formal attestation settles in the same result. A managed worker's proof_verification reports its recorded workspace_verify_proof calls apart from lifecycle, with the last call's compact recorded outcome and a detail call listing each call with its exact outcome read; adding proof_subject (a test_proof_id or obligation_id) returns that proof's recorded error, location and call trace; adding source {unit, focus?} with invocation_id instead inspects one exact tuple of a retained source ambiguity and returns its original execution call without executing it. Default status is a compact answer that names what it omits; include_final_result:true returns the complete result, naming in bounded_complete any member it serves through a selected read. detail.kind retry_assessment reads the captured retry assessment from the source compact status publishes in next_calls; detail.kind authored_document reads a retained authored document by unit, section, criterion, entry, carrier, focus or obligation through its published document_calls.",
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
            invocation_id: z.string().min(1).max(128).optional(),
            proof_subject: z.string().min(1).max(512).optional(),
            source: z.object({ unit: proofAuthoringUnitInputSchema(z),
              focus: proofAuthoringFocusInputSchema(z).optional() }).strict().optional() }).strict(),
          z.object({ kind: z.literal(RETRY_ASSESSMENT_DETAIL_KIND),
            source: z.object({ ref_id: z.string().regex(/^[A-Za-z0-9._-]{1,200}$/u),
              sha256: z.string().regex(/^[a-f0-9]{64}$/u) }).strict() }).strict(),
          authoredDocumentDetailSchema(z)
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
          if (args.detail.kind === RETRY_ASSESSMENT_DETAIL_KIND ||
              args.detail.kind === RUN_STATUS_AUTHORED_DOCUMENT_DETAIL_KIND) {
            return jsonContent(readRetainedStatusDetail(workspace, args));
          }
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
          if (args.detail.proof_subject !== undefined && args.detail.invocation_id === undefined) {
            return jsonContent(buildBlockedRunStatusResult({
              blockerCode: DISPATCH_BLOCKER_CODES.VALIDATION_FAILURE,
              reason: "detail_proof_subject_requires_invocation",
              detail: null,
              refusal: invalidArgumentRefusal(
                "workspace_agent_run_status",
                "request.detail_proof_subject_without_invocation",
                true
              )
            }));
          }
          if (args.detail.source !== undefined &&
              (args.detail.invocation_id === undefined || args.detail.proof_subject !== undefined)) {
            return jsonContent(buildBlockedRunStatusResult({
              blockerCode: DISPATCH_BLOCKER_CODES.VALIDATION_FAILURE,
              reason: "detail_source_requires_invocation_without_proof_subject",
              detail: null,
              refusal: invalidArgumentRefusal("workspace_agent_run_status",
                "request.detail_source_binding_invalid", true)
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

          const { proof_subject: proofSubject = null, source: selectedSource = null,
            ...observedDetail } = args.detail;
          const detail = await dispatchBackend.readManagedRunObservation({
            caller_session_id: dispatchSessionIdentity,
            subject: args.subject,
            attemptId: args.attempt_id ?? null,
            detail: observedDetail
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
            const unavailableReason = detail?.code ?? detail?.refusal?.reason ?? "run_detail_unavailable";
            return jsonContent(buildBlockedRunStatusResult({
              blockerCode: DISPATCH_BLOCKER_CODES.MONITOR_RUN_DETAIL_UNAVAILABLE,
              reason: unavailableReason,
              detail: projectRecordedFailureDetail(detail?.refusal ?? null,
                { original: DISPATCH_FAILURE_ORIGINALS.READ_OBSERVATION }),
              refusal: runDetailUnavailableRefusal("workspace_agent_run_status",
                DISPATCH_BLOCKER_CODES.MONITOR_RUN_DETAIL_UNAVAILABLE, unavailableReason)
            }));
          }
          let projectedDetail = detail;
          if (args.detail.kind === "failure_history" && Array.isArray(detail.items)) {

            projectedDetail = Object.freeze({
              ...detail,
              items: Object.freeze(detail.items.map((item) => Object.freeze({
                ...item,
                failure: publishableLifecycleFailure(item.failure,
                  { original: DISPATCH_FAILURE_ORIGINALS.ATTEMPT_JOURNAL })
              })))
            });
          }
          if (args.detail.kind === "proof_verification") {
            try {
              projectedDetail = projectRunProofVerificationDetail({
                subject: args.subject,
                detail,
                proofSubject,
                source: selectedSource,
                workspaceDir: realpathSync(path.resolve(workspace.dir)),
                responseEnv
              });
            } catch (error) {
              if (error?.code === RUN_PROOF_VERIFICATION_SELECTION_UNKNOWN_CODE) {

                return jsonContent(buildBlockedRunStatusResult({
                  blockerCode: DISPATCH_BLOCKER_CODES.VALIDATION_FAILURE,
                  reason: error.code,
                  detail: error.details,
                  refusal: invalidArgumentRefusal(
                    "workspace_agent_run_status",
                    "request.detail_proof_subject_in_invocation",
                    false
                  )
                }));
              }

              const blockerCode = projectProofVerificationDetailFailure(error);
              const unavailableReason = typeof error?.code === "string" ? error.code
                : "proof_verification_evidence_unavailable";
              return jsonContent(buildBlockedRunStatusResult({
                blockerCode,
                reason: unavailableReason,
                detail: {
                  invocation_id: args.detail.invocation_id ?? null,

                  ...buildDispatchToolExceptionDetail("workspace_agent_run_status", error,
                    { original: DISPATCH_FAILURE_ORIGINALS.READ_OBSERVATION })
                },
                refusal: runDetailUnavailableRefusal("workspace_agent_run_status", blockerCode,
                  unavailableReason)
              }));
            }
          }
          const { next_calls: nextCalls, ...responseDetail } =
            args.detail.kind === "proof_verification" && Array.isArray(projectedDetail.next_calls)
              ? projectedDetail : { ...projectedDetail, next_calls: null };
          return jsonContent({
            schema_version: AGENT_RUN_STATUS_SCHEMA_VERSION,
            accepted: true,
            subject: args.subject,
            attempt_id: projectedDetail.attempt_id ?? null,
            detail: responseDetail,
            ...(nextCalls === null ? {} : { next_calls: nextCalls })
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
               lifecycle?.publication_repair_required === undefined &&
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

        const publishedAssessment = terminality.lifecycle_resolution?.retry_assessment ?? null;
        const assessmentSource = publishedAssessment === null
          ? null : retryAssessmentSources.get(publishedAssessment) ?? null;
        const assessmentCall = retryAssessmentDetailCall(publishedAssessment);
        if (terminality.lifecycle_resolution) {
          const resolution = publishableLifecycleResolution(terminality.lifecycle_resolution);
          accepted.lifecycle_resolution = includeFullFinalResult
            ? resolution
            : compactLifecycleResolution(resolution, status, { assessmentSource });
        }
        if (!terminality.terminal) {

          const repairRequired = terminality.lifecycle_resolution?.next_action ===
            LIFECYCLE_RESOLUTION_NEXT_ACTIONS.REPAIR_RESULT_PUBLICATION_IDENTITY;
          accepted.next_action = !repairRequired && retryAssessmentNextAction(
            terminality.lifecycle_resolution?.retry_assessment
          ) === null
            ? LIFECYCLE_RESOLUTION_NEXT_ACTIONS.RETRY
            : terminality.lifecycle_resolution.next_action;

          if (terminality.lifecycle_resolution?.required_correction !== undefined) {
            accepted.required_correction = terminality.lifecycle_resolution.required_correction;
          }
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
          accepted.proof_verification = !proofOutcome.settled
            ? Object.freeze({ state: "unavailable", code: "run_status_call_bound_elapsed", grants_authority: false })
            : includeFullFinalResult
              ? proofOutcome.value
              : projectCompactRunProofVerification(proofOutcome.value);
        }

        let candidateVerifyCall = null;

        if (lifecycle) {
          const published = publishableLifecycleFailure(lifecycle);
          if (terminality.terminal) {
            candidateVerifyCall = terminalCandidateVerifyProofCall({ sessionRole,
              repository: workspace.repo, subject: status.subject, lifecycle: published });
          }

          const retention = authoredContractRetention.retain({
            repository: workspace.repo,
            status,
            lifecycle: published
          });
          const complete = projectPublishedIntegrationReceipt(
            projectPublishedControlledGeneration(
              projectPublishedSliceLifecycle(published, { retention }),
              { retention }
            ),
            { retention }
          );

          accepted.slice_lifecycle = includeFullFinalResult
            ? complete
            : projectCompactSliceLifecycle(complete, {
              subject: status.subject,
              attemptId: status.run_id ?? null
            });
        }
        Object.assign(accepted, projectRunFinalResultPublication(
          finalResult,
          { includeFullFinalResult }
        ));
        const omitsAssessmentEvidence = (resolution) =>
          Array.isArray(resolution?.omitted_members) &&
          resolution.omitted_members.includes("retry_assessment.assessment_evidence");
        const rootCalls = [];
        if (!includeFullFinalResult && assessmentCall !== null &&
            omitsAssessmentEvidence(accepted.lifecycle_resolution)) {
          rootCalls.push(assessmentCall);
        }
        if (candidateVerifyCall !== null) rootCalls.push(candidateVerifyCall);

        const findingsCapture = await buildFindingsMaterialContinuation({
          status,
          workspace,
          resolveFindingsSource: dispatchBackend.resolveRetainedFindingsSource?.bind(dispatchBackend),
          callerSessionId: dispatchSessionIdentity,
          requestContracts,
          deadline
        });
        if (findingsCapture !== null) {
          accepted.findings_capture = findingsCapture.fact;
          if (findingsCapture.call !== null) rootCalls.push(findingsCapture.call);
        }
        if (rootCalls.length > 0) accepted.next_calls = rootCalls;
        const published = omitNullFields(accepted);
        return jsonContent(includeFullFinalResult
          ? boundCompleteStatus(published, { status, assessmentSource, assessmentCall,
            omitsAssessmentEvidence })
          : published);
      } catch (error) {

        const repoRefusal = dispatchRepoResolutionRefusal("workspace_agent_run_status", error);
        if (repoRefusal !== null) return jsonContent(buildBlockedRunStatusResult(repoRefusal));
        return jsonContent(
          buildBlockedRunStatusResult({
            blockerCode: DISPATCH_BLOCKER_CODES.HANDLER_EXCEPTION,
            reason: "run_status_tool_exception",

            detail: buildDispatchToolExceptionDetail("workspace_agent_run_status", error,
              { original: DISPATCH_FAILURE_ORIGINALS.READ_OBSERVATION }),

            refusal: routeExceptionRefusal("workspace_agent_run_status")
          })
        );
      }
    }
  );

}
