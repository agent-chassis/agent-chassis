

import {
  TERMINAL_STATUSES,
  BACKEND_REFUSAL_CODES,
  BACKEND_MISSING_RESULT_CODES,
  WORKSPACE_AGENT_DISPATCH_BACKEND_SCHEMA_VERSION,
  WORKSPACE_AGENT_DISPATCH_RUN_STATUS_SCHEMA_VERSION
} from "@agent-chassis/agent-launch-core";

import {
  dispatchRefusal,
  normalizeStatus
} from "./workspace-agent-dispatch-refusal.mjs";
import {
  normalizeFinalResultWithStructuredRoleResult,
  buildMissingResultEnvelopeWithStructuredRoleResult,
  attachDispatchProvenance
} from "./workspace-agent-dispatch-final-result-evidence.mjs";
import { deriveBackendReviewResult } from "./workspace-agent-dispatch-review-result.mjs";
import { WRITE_SCOPE_VERIFICATION_SCHEMA_VERSION } from "./workspace-agent-write-scope-verification.mjs";

import { readStdioMcpConduitTerminalFailure } from "./stdio-mcp-conduit-contract.mjs";

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
    workerAdmissionDiagnostic
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
    final_result: null
  };
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
          { status: initialStatus }
        );
  }
  runs.set(run_id, record);
  if (record.terminal && typeof captureSliceReviewTerminalResult === "function") {
    await captureSliceReviewTerminalResult({ record });
  }

  const startReviewResult = deriveBackendReviewResult(record);
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
      }
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
    const captured = normalizeFinalResultWithStructuredRoleResult(
      probed.final_result,
      record
    );

    const conduitFailure = readStdioMcpConduitTerminalFailure(probed);

    if (captured && conduitFailure !== null) {
      record.exit = {
        ...(isPlainObject(record.exit) ? record.exit : { code: null, signal: null }),
        conduit_failure: conduitFailure
      };
    }

    if (conduitFailure !== null) {
      record.launcher_conduit_terminal_failure = conduitFailure;
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
            : { status: record.status, ...(conduitFailure.detail ?? {}) }
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
    { message: error?.message ?? String(error) }
  );
  record.updated_at = new Date(clock()).toISOString();
}

export async function settleAndProjectRunStatus(
  record,
  { clock, captureSliceReviewTerminalResult } = {}
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
  if (record.terminal && typeof captureSliceReviewTerminalResult === "function") {
    await captureSliceReviewTerminalResult({ record });
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
    ...(record.validation_evidence ? { validation_evidence: record.validation_evidence } : {}),
    ...(reviewResult ? { review_result: reviewResult } : {})
  };
}
