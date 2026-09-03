

import {
  TERMINAL_STATUSES,
  BACKEND_REFUSAL_CODES,
  BACKEND_MISSING_RESULT_CODES,
  WORKSPACE_AGENT_DISPATCH_BACKEND_SCHEMA_VERSION,
  WORKSPACE_AGENT_DISPATCH_RUN_STATUS_SCHEMA_VERSION,
  WORKSPACE_AGENT_DISPATCH_FINAL_RESULT_SCHEMA_VERSION
} from "@agent-chassis/agent-launch-core";
import { createHash } from "node:crypto";

import {
  dispatchRefusal,
  normalizeStatus
} from "./workspace-agent-dispatch-refusal.mjs";
import {
  normalizeFinalResultWithStructuredRoleResult,
  buildMissingResultEnvelopeWithStructuredRoleResult,
  attachDispatchProvenance,
  attachFormalReviewAttestationSettlement
} from "./workspace-agent-dispatch-final-result-evidence.mjs";
import { deriveBackendReviewResult } from "./workspace-agent-dispatch-review-result.mjs";
import { WRITE_SCOPE_VERIFICATION_SCHEMA_VERSION } from "./workspace-agent-write-scope-verification.mjs";
import {
  buildWorkspaceAgentResultModeEnvelope,
  classifyExactSliceReviewReceiptResultMode,
  readLauncherObservedTerminalResultMode,
  WORKSPACE_AGENT_RESULT_MODES
} from "./workspace-agent-dispatch-result-mode.mjs";
import {
  reviseExactSliceReviewReceipt
} from "./workspace-agent-dispatch-run-receipt-transitions.mjs";
import {
  LAUNCHER_DURABLE_STATE_CODES
} from "@agent-chassis/agent-launch-core/src/lib/durable-runtime-state.mjs";

import { readStdioMcpConduitTerminalFailure } from "./stdio-mcp-conduit-contract.mjs";

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const formalAttestationSettledRecords = new WeakSet();

async function settleRequestedFormalAttestation(
  record,
  reviewResult,
  settleFormalReviewAttestation
) {
  const formal = record?.final_result?.advisory_review?.formal_attestation;
  if (formal?.requested !== true || formalAttestationSettledRecords.has(record)) return;
  formalAttestationSettledRecords.add(record);
  if (formal.reason === "schema_non_adherent") return;
  let settlement;
  try {
    settlement = typeof settleFormalReviewAttestation === "function"
      ? await settleFormalReviewAttestation({ record, reviewResult })
      : { available: false, reason: "settlement_owner_unavailable" };
  } catch (error) {
    settlement = {
      available: false,
      reason: "settlement_failed",
      diagnostics: [error?.message ?? String(error)]
    };
  }
  record.final_result = attachFormalReviewAttestationSettlement(
    record.final_result,
    settlement
  );
}

export const ATTEMPT_LINEAGE_RESOLUTION_SCHEMA_VERSION =
  "workspace-agent-attempt-lineage-resolution.v1";
export const ATTEMPT_LINEAGE_RESOLUTION_STATES = Object.freeze({
  SELECTED: "selected",
  OPERATOR_RECOVERY_NEEDED: "operator_recovery_needed"
});
const ATTEMPT_LINEAGE_NEXT_ACTIONS = new Set([
  "poll_selected_attempt",
  "consume_selected_result",
  "no_supported_route",
  "retry_lineage_settlement",
  "retry_generation_tip_reassessment"
]);

export const ATTEMPT_LINEAGE_CONFLICT_CLASSES = Object.freeze([
  "none",
  "accumulated_tip_moved_during_reassessment",
  "attempt_identity_mismatch",
  "executor_spawn_bind_uncertain",
  "frozen_contract_moved",
  "generation_changed_during_reassessment",
  "generation_tip_reassessment_failed",
  "moved_accumulated_tip",
  "receipt_mutation_failed",
  "result_inapplicable",
  "semantic_applicability_refused",
  "selected_lineage_settlement_failed",
  "stale_contract_generation",
  "terminal_conflict_persistence_failed",
  "terminal_projection_mismatched",
  "terminal_projection_persistence_failed"
]);
const ATTEMPT_LINEAGE_CONFLICT_CLASS_SET = new Set(
  ATTEMPT_LINEAGE_CONFLICT_CLASSES
);

const ATTEMPT_LINEAGE_CONFLICT_DETAIL_SCHEMA_VERSION =
  "workspace-agent-review-applicability-conflict.v1";
const ATTEMPT_LINEAGE_ORIGINATING_FAILURE_SCHEMA_VERSION =
  "workspace-agent-findings-originating-failure.v1";
export const FINDINGS_SETTLEMENT_INVARIANT_CODE =
  "launcher_findings_settlement_invariant_violation";
export const FINDINGS_TERMINAL_EVIDENCE_MISSING_CODE =
  "agent_launch.review_result_mode.current_evidence_missing.v1";
export const FINDINGS_TERMINAL_EVIDENCE_INVALID_CODE =
  "agent_launch.review_result_mode.current_evidence_invalid.v1";
export const FINDINGS_ATTEMPT_OBSERVATION_CLASSES = Object.freeze({
  HOT_ACTIVE: "hot_active",
  COLD_TERMINAL: "cold_terminal",
  COLD_NONTERMINAL_UNOBSERVABLE: "cold_nonterminal_unobservable",
  IDENTITY_CONFLICT: "identity_conflict",
  ABSENT_NEW_ATTEMPT: "absent_new_attempt"
});

const FINDINGS_SETTLEMENT_FAILURE_PHASES = new Set([
  "pre_spawn_receipt_settlement",
  "retained_duplicate_reconciliation"
]);

function normalizeAttemptLineageConflictDetail(detail) {
  if (detail === null || detail === undefined) return null;
  const fields = [
    "schema_version", "reason", "frozen_reviewed_sha", "observed_target_sha",
    "frozen_generation_digest", "observed_generation_digest",
    "frozen_manifest_digest", "observed_manifest_digest"
  ];
  if (!isPlainObject(detail) || Object.keys(detail).sort().join("\0") !==
      [...fields].sort().join("\0") ||
      detail.schema_version !== ATTEMPT_LINEAGE_CONFLICT_DETAIL_SCHEMA_VERSION ||
      typeof detail.reason !== "string" || !/^[a-z][a-z0-9_]*$/u.test(detail.reason)) {
    throw new TypeError("launcher attempt-lineage conflict detail is malformed");
  }
  for (const field of ["frozen_reviewed_sha", "observed_target_sha"]) {
    if (!(detail[field] === null ||
        (typeof detail[field] === "string" && /^[0-9a-f]{40,64}$/u.test(detail[field])))) {
      throw new TypeError("launcher attempt-lineage conflict SHA detail is malformed");
    }
  }
  for (const field of [
    "frozen_generation_digest", "observed_generation_digest",
    "frozen_manifest_digest", "observed_manifest_digest"
  ]) {
    if (!(detail[field] === null || (typeof detail[field] === "string" &&
        /^(?:controlled-contract-generation:none|sha256:[0-9a-f]{64})$/u.test(detail[field])))) {
      throw new TypeError("launcher attempt-lineage conflict digest detail is malformed");
    }
  }
  return Object.freeze(Object.fromEntries(fields.map((field) => [field, detail[field]])));
}

export function buildAttemptLineageResolutionProjection({
  state,
  prior_run_id = null,
  replacement_run_id,
  monitor_handle = null,
  prior_mode = null,
  attempted_mode = null,
  conflict_class = "none",
  conflict_detail = null,
  originating_failure = null,
  next_action
}) {
  const normalizedConflictDetail = normalizeAttemptLineageConflictDetail(conflict_detail);
  const normalizedOriginatingFailure = normalizeAttemptLineageOriginatingFailure(
    originating_failure
  );
  if (!Object.values(ATTEMPT_LINEAGE_RESOLUTION_STATES).includes(state) ||
      !(prior_run_id === null || typeof prior_run_id === "string") ||
      typeof replacement_run_id !== "string" || replacement_run_id.length === 0 ||
      !(monitor_handle === null || typeof monitor_handle === "string") ||
      !(prior_mode === null || typeof prior_mode === "string") ||
      !(attempted_mode === null || typeof attempted_mode === "string") ||
      !ATTEMPT_LINEAGE_CONFLICT_CLASS_SET.has(conflict_class) ||
      !ATTEMPT_LINEAGE_NEXT_ACTIONS.has(next_action)) {
    throw new TypeError("launcher attempt-lineage resolution projection is malformed");
  }
  if ((state === ATTEMPT_LINEAGE_RESOLUTION_STATES.SELECTED) !==
      (conflict_class === "none")) {
    throw new TypeError("launcher attempt-lineage resolution state conflicts with its class");
  }
  if (state === ATTEMPT_LINEAGE_RESOLUTION_STATES.SELECTED &&
      (normalizedConflictDetail !== null || normalizedOriginatingFailure !== null)) {
    throw new TypeError("selected attempt-lineage resolution cannot carry conflict evidence");
  }
  return Object.freeze({
    schema_version: ATTEMPT_LINEAGE_RESOLUTION_SCHEMA_VERSION,
    state,
    prior_run_id,
    replacement_run_id,
    monitor_handle,
    prior_mode,
    attempted_mode,
    conflict_class,
    conflict_detail: normalizedConflictDetail,
    ...(normalizedOriginatingFailure === null
      ? {}
      : { originating_failure: normalizedOriginatingFailure }),
    next_action
  });
}

export function attachWriteScopeVerification(envelope, rawFinalResult) {
  if (!envelope || typeof envelope !== "object") return envelope;
  const candidate = rawFinalResult?.write_scope_verification;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return envelope;
  }
  if (candidate.schema_version !== WRITE_SCOPE_VERIFICATION_SCHEMA_VERSION) {
    return envelope;
  }
  return Object.freeze({ ...envelope, write_scope_verification: candidate });
}

export async function discardPendingManagedRunIdentity({
  pending,
  reservationHolder,
  releaseSubjectReservation,
  subject,
  reason
}) {
  if (pending === null || pending === undefined) return null;
  try {
    await pending.discard();
  } catch (error) {

    reservationHolder.retain = true;
    return dispatchRefusal(
      BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
      "managed_run_identity_cleanup_failed",
      {
        subject,
        cleanup_after: reason,
        code: error?.code ?? null,
        message: error?.message ?? String(error)
      }
    );
  }

  await releaseSubjectReservation(reservationHolder);
  return null;
}

export function buildAcceptedLaunchEnvelope(record, startReviewResult, workerAdmissionDiagnostic) {
  return {
    schema_version: WORKSPACE_AGENT_DISPATCH_BACKEND_SCHEMA_VERSION,
    accepted: true,
    run_id: record.run_id,
    monitor_handle: record.monitor_handle,
    app: record.app,
    model: record.model,
    backend: record.backend,
    role: record.role,
    subject: record.subject,
    workspace_alias: record.workspace_alias,
    caller_session_id: record.caller_session_id,
    status: record.status,
    terminal: record.terminal,
    started_at: record.started_at,
    updated_at: record.updated_at,
    exit: record.exit,
    final_result: record.final_result,
    ...(record.attempt_lineage_resolution
      ? { attempt_lineage_resolution: record.attempt_lineage_resolution }
      : {}),
    ...(record.validation_evidence ? { validation_evidence: record.validation_evidence } : {}),
    ...(startReviewResult ? { review_result: startReviewResult } : {}),

    ...(workerAdmissionDiagnostic ? { worker_admission: workerAdmissionDiagnostic } : {})
  };
}

export async function finalizeLaunchOutcome(params) {
  const {
    executorResult,
    reservationHolder,
    releaseSubjectReservation,
    bindManagedRunOuterIdentity,
    runs,
    captureSliceReviewTerminalResult,
    settleFormalReviewAttestation,
    run_id,
    monitor_handle,
    app,
    resolvedModel,
    resolvedBackend,
    role,
    subject,
    workspace_alias,
    caller_session_id,
    startedAt,
    reviewerValidationEvidence,
    reviewerLaunchIdentity,
    workerAdmissionDiagnostic,
    sessionContract = null,
    findingsLifecycle = false
  } = params;

  let pendingManagedRunIdentity = params.pendingManagedRunIdentity ?? null;

  const discardPendingIdentity = async (reason) => {
    const pending = pendingManagedRunIdentity;
    pendingManagedRunIdentity = null;
    return discardPendingManagedRunIdentity({
      pending,
      reservationHolder,
      releaseSubjectReservation,
      subject,
      reason
    });
  };

  if (!executorResult || typeof executorResult !== "object") {
    return (await discardPendingIdentity("launch_executor_no_result")) ?? dispatchRefusal(
      BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
      "launch_executor_no_result",
      null
    );
  }
  if (executorResult.accepted === false) {
    const refusal = executorResult.refusal ?? {};
    return (await discardPendingIdentity("launch_executor_refused")) ?? dispatchRefusal(
      refusal.code ?? BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
      refusal.reason ?? "launch_executor_refused",
      refusal.detail ?? null
    );
  }
  const initialStatus = normalizeStatus(executorResult.status ?? "launching");
  if (!initialStatus) {
    return (await discardPendingIdentity("launch_executor_invalid_status")) ?? dispatchRefusal(
      BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
      "launch_executor_invalid_status",
      { status: executorResult.status ?? null }
    );
  }

  if (pendingManagedRunIdentity !== null) {
    if (TERMINAL_STATUSES.has(initialStatus)) {
      const cleanupRefusal = await discardPendingIdentity("executor_terminal_at_start");
      if (cleanupRefusal) return cleanupRefusal;
    } else {
      const pending = pendingManagedRunIdentity;
      pendingManagedRunIdentity = null;
      try {

        const bindOuter = typeof bindManagedRunOuterIdentity === "function"
          ? bindManagedRunOuterIdentity
          : (handle, args) => handle.bind(args);
        await bindOuter(pending, {
          pid: executorResult.pid ?? null,
          enforcement: executorResult.enforcement
        });
      } catch (error) {

        reservationHolder.retain = true;
        return dispatchRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          "managed_run_identity_binding_failed",
          {
            subject,
            run_id,
            code: error?.code ?? null,
            message: error?.message ?? String(error)
          }
        );
      }
    }
  }

  const record = {
    run_id,
    monitor_handle,
    app,
    model: resolvedModel,
    backend: resolvedBackend,
    role,
    subject,
    workspace_alias: workspace_alias ?? null,
    caller_session_id,
    status: initialStatus,
    started_at: startedAt,
    updated_at: startedAt,
    terminal: TERMINAL_STATUSES.has(initialStatus),
    exit: executorResult.exit ?? null,
    probe: typeof executorResult.probe === "function" ? executorResult.probe : null,

    terminal_structured_role_result_mode:
      readLauncherObservedTerminalResultMode(executorResult),
    final_result: null
  };
  Object.defineProperty(record, "findings_lifecycle", {
    value: findingsLifecycle === true,
    enumerable: false,
    configurable: false,
    writable: false
  });
  if (sessionContract !== null) {
    Object.defineProperty(record, "session_contract", {
      value: sessionContract,
      enumerable: true,
      configurable: false,
      writable: false
    });
  }
  if (reviewerValidationEvidence !== null) {
    Object.defineProperty(record, "validation_evidence", {
      value: reviewerValidationEvidence,
      enumerable: true,
      configurable: false,
      writable: false
    });
  }
  if (reviewerLaunchIdentity !== null) {

    Object.defineProperty(record, "reviewer_launch_identity", {
      value: reviewerLaunchIdentity,
      enumerable: true,
      configurable: false,
      writable: false
    });
  }

  if (record.terminal) {
    const capturedFinalResult = normalizeFinalResultWithStructuredRoleResult(
      executorResult.final_result,
      record
    );
    record.final_result = capturedFinalResult
      ? attachWriteScopeVerification(
          attachDispatchProvenance(capturedFinalResult, executorResult.final_result, record),
          executorResult.final_result
        )
      : buildMissingResultEnvelopeWithStructuredRoleResult(
          BACKEND_MISSING_RESULT_CODES.FINAL_REPORT_NOT_CAPTURED,
          "executor_terminal_without_final_result",
          { status: initialStatus },
          record
        );
  }
  const startReviewResult = deriveBackendReviewResult(record);
  if (record.terminal) {
    await settleRequestedFormalAttestation(
      record,
      startReviewResult,
      settleFormalReviewAttestation
    );
  }
  runs.set(run_id, record);
  if (record.terminal && findingsLifecycle === true &&
      typeof captureSliceReviewTerminalResult === "function") {
    try {
      await captureSliceReviewTerminalResult({ record, reassess: null });
      record.findings_audit_posture = "recorded";
    } catch {
      record.findings_audit_posture = "unavailable";
    }
  }

  return buildAcceptedLaunchEnvelope(record, startReviewResult, workerAdmissionDiagnostic);
}

function applyProbeObservation(record, probed, clock) {

  const nextStatus = typeof probed === "object" && !Array.isArray(probed)
    ? normalizeStatus(probed.status)
    : null;
  if (!nextStatus) {
    record.status = "failed";
    record.terminal = true;
    record.exit = {
      code: null,
      signal: null,
      error: "lifecycle probe returned a result without a normalized run status"
    };
    record.final_result = buildMissingResultEnvelopeWithStructuredRoleResult(
      BACKEND_MISSING_RESULT_CODES.FINAL_REPORT_PROBE_FAILED,
      "probe_result_status_invalid",
      {

        probe_result_type: Array.isArray(probed) ? "array" : typeof probed,
        observed_status: typeof probed === "object" && !Array.isArray(probed) &&
            typeof probed?.status === "string"
          ? probed.status
          : null
      },
      record
    );
    record.updated_at = new Date(clock()).toISOString();
    return;
  }
  record.status = nextStatus;
  record.terminal = TERMINAL_STATUSES.has(nextStatus);
  if (probed.exit !== undefined) {
    record.exit = probed.exit;
  }

  if (record.terminal && !record.final_result) {

    const conduitFailure = readStdioMcpConduitTerminalFailure(probed);
    if (conduitFailure !== null) {
      record.launcher_conduit_terminal_failure = conduitFailure;
    }
    const captured = normalizeFinalResultWithStructuredRoleResult(
      probed.final_result,
      record
    );

    if (captured && conduitFailure !== null) {
      record.exit = {
        ...(isPlainObject(record.exit) ? record.exit : { code: null, signal: null }),
        conduit_failure: conduitFailure
      };
    }

    record.final_result = captured
      ? attachWriteScopeVerification(
          attachDispatchProvenance(captured, probed.final_result, record),
          probed.final_result
        )
      : buildMissingResultEnvelopeWithStructuredRoleResult(
          BACKEND_MISSING_RESULT_CODES.FINAL_REPORT_NOT_CAPTURED,
          conduitFailure === null
            ? "probe_terminal_without_final_result"
            : conduitFailure.reason,
          conduitFailure === null
            ? { status: record.status }
            : { status: record.status, ...(conduitFailure.detail ?? {}) },
          record
        );
  }
  record.updated_at = new Date(clock()).toISOString();
}

function applyProbeThrow(record, error, clock) {
  record.status = "failed";
  record.terminal = true;
  record.exit = {
    code: null,
    signal: null,
    error: error?.message ?? String(error)
  };
  record.final_result = buildMissingResultEnvelopeWithStructuredRoleResult(
    BACKEND_MISSING_RESULT_CODES.FINAL_REPORT_PROBE_FAILED,
    "probe_threw_before_terminal_capture",
    { message: error?.message ?? String(error) },
    record
  );
  record.updated_at = new Date(clock()).toISOString();
}

export async function settleAndProjectRunStatus(
  record,
  { clock, captureSliceReviewTerminalResult, settleFormalReviewAttestation } = {}
) {
  if (!record.terminal && typeof record.probe === "function") {
    try {
      const probed = await record.probe();
      if (probed !== null && probed !== undefined) {
        applyProbeObservation(record, probed, clock);
      }
    } catch (error) {
      applyProbeThrow(record, error, clock);
    }
  }

  const reviewResult = deriveBackendReviewResult(record);
  if (record.terminal) {
    await settleRequestedFormalAttestation(
      record,
      reviewResult,
      settleFormalReviewAttestation
    );
  }
  if (record.terminal && record.findings_lifecycle === true &&
      typeof captureSliceReviewTerminalResult === "function" &&
      record.findings_audit_posture === undefined) {
    try {
      await captureSliceReviewTerminalResult({ record, reassess: null });
      record.findings_audit_posture = "recorded";
    } catch {
      record.findings_audit_posture = "unavailable";
    }
  }
  return buildRunStatusEnvelope(record, reviewResult);
}

export function buildRunStatusEnvelope(record, reviewResult) {
  return {
    schema_version: WORKSPACE_AGENT_DISPATCH_RUN_STATUS_SCHEMA_VERSION,
    accepted: true,
    run_id: record.run_id,
    monitor_handle: record.monitor_handle,
    app: record.app,
    role: record.role,
    subject: record.subject,
    workspace_alias: record.workspace_alias,
    caller_session_id: record.caller_session_id,
    status: record.status,
    terminal: record.terminal,
    started_at: record.started_at,
    updated_at: record.updated_at,
    exit: record.exit ?? null,
    final_result: record.final_result ?? null,
    ...(record.session_contract === undefined
      ? {}
      : {
          session_contract_required: true,
          session_contract: record.session_contract
        }),
    ...(record.validation_evidence ? { validation_evidence: record.validation_evidence } : {}),
    ...(reviewResult ? { review_result: reviewResult } : {})
  };
}
