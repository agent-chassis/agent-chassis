

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
import { withSecondaryCleanupFailure } from "./launch-failure-cause.mjs";
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
  UNRESOLVED: "unresolved"
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
  reason,
  retainReleaseFailure = false
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

  const releaseFailure = await releaseSubjectReservation(
    reservationHolder,
    retainReleaseFailure ? { retainFailure: true } : undefined
  );
  if (releaseFailure !== null && releaseFailure !== undefined) {
    return dispatchRefusal(
      BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
      "managed_run_subject_reservation_release_failed",
      {
        subject,
        cleanup_after: reason,
        code: releaseFailure?.code ?? null,
        message: releaseFailure?.message ?? String(releaseFailure)
      }
    );
  }
  return null;
}

export function withManagedIdentityCleanupResidue(primary, cleanupRefusal, reservationHolder) {
  if (cleanupRefusal?.accepted !== false || !cleanupRefusal.refusal) return primary;
  return withSecondaryCleanupFailure(primary, "managed_identity_settlement_failure", Object.freeze({
    reason: cleanupRefusal.refusal.reason ?? null,
    detail: cleanupRefusal.refusal.detail ?? null,
    pending_identity_retained:
      cleanupRefusal.refusal.reason === "managed_run_identity_cleanup_failed",
    reservation_retained: reservationHolder?.reservation !== null &&
      reservationHolder?.reservation !== undefined
  }));
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
    ...(startReviewResult ? { review_result: startReviewResult } : {}),

    ...(workerAdmissionDiagnostic ? { worker_admission: workerAdmissionDiagnostic } : {})
  };
}

function readObservedChildTermination(executorResult) {
  if (typeof executorResult?.hasObservedChildTermination !== "function") return false;
  try {
    return executorResult.hasObservedChildTermination() === true;
  } catch {

    return false;
  }
}

function attachManagedIdentitySettlementFailure(
  record,
  cleanupRefusal,
  { pendingRetained, reservationHolder }
) {
  if (cleanupRefusal?.accepted !== false || !cleanupRefusal.refusal) return;
  const residue = Object.freeze({
    reason: cleanupRefusal.refusal.reason ?? null,
    detail: cleanupRefusal.refusal.detail ?? null,
    pending_identity_retained: pendingRetained === true,
    reservation_retained: reservationHolder?.reservation !== null &&
      reservationHolder?.reservation !== undefined
  });
  record.exit = {
    ...(isPlainObject(record.exit) ? record.exit : { code: null, signal: null }),
    managed_identity_settlement_failure: residue
  };
  if (record.final_result?.kind !== "missing_result") return;
  const missing = record.final_result.missing_result ?? {};
  record.final_result = Object.freeze({
    ...record.final_result,
    missing_result: Object.freeze({
      ...missing,
      detail: Object.freeze({
        ...(isPlainObject(missing.detail) ? missing.detail : {}),
        managed_identity_settlement_failure: residue
      })
    })
  });
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
    reviewerLaunchIdentity,
    workerAdmissionDiagnostic,
    sessionContract = null,
    findingsLifecycle = false
  } = params;
  const publishManagedRunResult = params.publishManagedRunResult ?? null;

  let pendingManagedRunIdentity = params.pendingManagedRunIdentity ?? null;

  const managedExecutionTuple = pendingManagedRunIdentity?.tuple ?? null;

  const childTerminationObserved = readObservedChildTermination(executorResult);

  const discardPendingIdentity = async (reason, retainReleaseFailure = false) => {
    const pending = pendingManagedRunIdentity;
    pendingManagedRunIdentity = null;
    return discardPendingManagedRunIdentity({
      pending,
      reservationHolder,
      releaseSubjectReservation,
      subject,
      reason,
      retainReleaseFailure
    });
  };

  if (!executorResult || typeof executorResult !== "object") {
    return withManagedIdentityCleanupResidue(dispatchRefusal(
      BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
      "launch_executor_no_result",
      null
    ), await discardPendingIdentity("launch_executor_no_result"), reservationHolder);
  }
  if (executorResult.accepted === false) {
    const refusal = executorResult.refusal ?? {};
    return withManagedIdentityCleanupResidue(dispatchRefusal(
      refusal.code ?? BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
      refusal.reason ?? "launch_executor_refused",
      refusal.detail ?? null
    ), await discardPendingIdentity("launch_executor_refused"), reservationHolder);
  }
  const initialStatus = normalizeStatus(executorResult.status ?? "launching");
  if (!initialStatus) {
    return withManagedIdentityCleanupResidue(dispatchRefusal(
      BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
      "launch_executor_invalid_status",
      { status: executorResult.status ?? null }
    ), await discardPendingIdentity("launch_executor_invalid_status"), reservationHolder);
  }

  let startupObservation = executorResult;
  let startupProbeError = null;
  if (childTerminationObserved && typeof executorResult.probe === "function") {
    try {
      startupObservation = await executorResult.probe();
    } catch (error) {
      startupProbeError = error;
    }
  }

  let identitySettlementRefusal = null;
  let pendingIdentityRetained = false;
  if (pendingManagedRunIdentity !== null) {
    if (childTerminationObserved) {
      identitySettlementRefusal = await discardPendingIdentity(
        "observed_child_terminal_at_start",
        true
      );
      pendingIdentityRetained = identitySettlementRefusal?.refusal?.reason ===
        "managed_run_identity_cleanup_failed";
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
  Object.defineProperty(record, "managed_execution_tuple", {
    value: managedExecutionTuple === null ? null : Object.freeze({ ...managedExecutionTuple }),
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
  if (reviewerLaunchIdentity !== null) {

    Object.defineProperty(record, "reviewer_launch_identity", {
      value: reviewerLaunchIdentity,
      enumerable: true,
      configurable: false,
      writable: false
    });
  }
  if (childTerminationObserved) {
    if (startupProbeError !== null) {
      applyProbeThrow(record, startupProbeError, () => new Date(startedAt).getTime());
    } else if (startupObservation !== null && startupObservation !== undefined) {
      applyProbeObservation(record, startupObservation, () => new Date(startedAt).getTime());
    } else {
      applyProbeObservation(record, {}, () => new Date(startedAt).getTime());
    }
  } else {

    captureTerminalObservation(record, executorResult);
  }
  attachManagedIdentitySettlementFailure(record, identitySettlementRefusal, {
    pendingRetained: pendingIdentityRetained,
    reservationHolder
  });
  await publishCapturedManagedRunResult(record, publishManagedRunResult);
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

function captureTerminalObservation(record, observed) {
  if (!record.terminal || record.final_result) return;
  const conduitFailure = readStdioMcpConduitTerminalFailure(observed);
  if (conduitFailure !== null) {
    record.launcher_conduit_terminal_failure = conduitFailure;
  }
  const captured = normalizeFinalResultWithStructuredRoleResult(
    observed?.final_result,
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
        attachDispatchProvenance(captured, observed.final_result, record),
        observed.final_result
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

async function publishCapturedManagedRunResult(record, publisher) {
  if (record.role !== "worker" || !record.terminal || record.final_result === null ||
      typeof publisher !== "function" || record.final_result_durability === "durable") return;
  const dispatchTuple = record.managed_execution_tuple ?? null;
  if (dispatchTuple === null || dispatchTuple.assigned_unit !== record.subject ||
      dispatchTuple.launch_ref !== record.monitor_handle ||
      dispatchTuple.run_id !== record.run_id) {
    record.final_result_durability = "unavailable";
    record.final_result_publication_failure = Object.freeze({
      code: "managed_run_execution_identity_unavailable",
      reason: null
    });
    return;
  }
  try {
    const publication = await publisher({
      subject: record.subject,
      dispatchTuple,
      result: record.final_result
    });
    if (publication?.ok !== true) {
      record.final_result_durability = "unavailable";
      record.final_result_publication_failure = Object.freeze({
        code: publication?.code ?? publication?.refusal?.code ?? "managed_run_result_publication_failed",
        reason: publication?.refusal?.reason ?? null
      });
      return;
    }
    record.final_result_durability = "durable";
    delete record.final_result_publication_failure;
  } catch (error) {
    record.final_result_durability = "unavailable";
    record.final_result_publication_failure = Object.freeze({
      code: error?.code ?? "managed_run_result_publication_failed",
      reason: error?.message ?? String(error)
    });
  }
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
  captureTerminalObservation(record, probed);
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
  {
    clock,
    captureSliceReviewTerminalResult,
    settleFormalReviewAttestation,
    publishManagedRunResult = null
  } = {}
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

  await publishCapturedManagedRunResult(record, publishManagedRunResult);

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
  return attachAdvisoryReviewTarget(record, {
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
    ...(record.final_result_durability === undefined
      ? {}
      : {
          final_result_durability: record.final_result_durability,
          ...(record.final_result_publication_failure
            ? { final_result_publication_failure: record.final_result_publication_failure }
            : {})
        }),
    ...(record.session_contract === undefined
      ? {}
      : {
          session_contract_required: true,
          session_contract: record.session_contract
        }),
    ...(reviewResult ? { review_result: reviewResult } : {})
  });
}

export function attachAdvisoryReviewTarget(source, envelope) {
  const input = source?.advisory_review_input ?? null;
  const target = source?.advisory_review_target ?? (
    input !== null && typeof input.reviewed_sha === "string" && typeof input.base_sha === "string"
      ? Object.freeze({ base_sha: input.base_sha, reviewed_sha: input.reviewed_sha })
      : null
  );
  if (target !== null) {
    Object.defineProperty(envelope, "advisory_review_target", {
      value: target,
      enumerable: false,
      writable: false,
      configurable: false
    });
  }
  return envelope;
}
