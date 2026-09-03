import {
  BACKEND_MISSING_RESULT_CODES,
  WORKSPACE_AGENT_DISPATCH_BACKEND_SCHEMA_VERSION,
  WORKSPACE_AGENT_DISPATCH_FINAL_RESULT_SCHEMA_VERSION,
  WORKSPACE_AGENT_DISPATCH_RUN_STATUS_SCHEMA_VERSION,
  normalizeFinalResult,
  TERMINAL_STATUSES
} from "@agent-chassis/agent-launch-core";
import {
  STRUCTURED_ROLE_RESULT_EVIDENCE_SCHEMA_VERSION,
  parseAgentRoleResult
} from "@agent-chassis/agent-launch-core/src/lib/agent-role-result.mjs";
import { normalizeStatus } from "./workspace-agent-dispatch-refusal.mjs";
import { WORKSPACE_AGENT_SELECTED_RESULT_CONTRACTS } from "./workspace-agent-dispatch-result-mode.mjs";

function boundedSchemaObservation(text, record) {
  if (typeof text !== "string" || text.length === 0) {
    return Object.freeze({
      schema_version: STRUCTURED_ROLE_RESULT_EVIDENCE_SCHEMA_VERSION,
      adherent: false,
      result: null,
      diagnostics: Object.freeze([Object.freeze({
        code: "full_response_text_unavailable",
        message: "reviewer text was not captured"
      })])
    });
  }
  const parsed = parseAgentRoleResult(text);
  const diagnostics = [...(Array.isArray(parsed?.diagnostics) ? parsed.diagnostics : [])];
  if (parsed?.valid === true && parsed.claims?.reported_role !== record.role) {
    diagnostics.push(Object.freeze({
      code: "reported_role_mismatch",
      message: "reported role differs from the canonical review role"
    }));
  }
  if (parsed?.valid === true && parsed.claims?.reported_subject !== record.subject) {
    diagnostics.push(Object.freeze({
      code: "reported_subject_mismatch",
      message: "reported subject differs from the canonical review subject"
    }));
  }
  return Object.freeze({
    schema_version: STRUCTURED_ROLE_RESULT_EVIDENCE_SCHEMA_VERSION,
    adherent: parsed?.valid === true && diagnostics.length === 0,
    result: parsed?.valid === true && diagnostics.length === 0 ? parsed.result : null,
    diagnostics: Object.freeze(diagnostics.slice(0, 20))
  });
}

function advisoryProjection(normalized, record) {
  const text = typeof normalized?.full_response?.text === "string" &&
      normalized.full_response.text.length > 0
    ? normalized.full_response.text
    : null;
  const schema = boundedSchemaObservation(text, record);
  const requested = record.terminal_structured_role_result_mode ===
    WORKSPACE_AGENT_SELECTED_RESULT_CONTRACTS.SCHEMA_CONSTRAINED;
  return Object.freeze({
    kind: "advisory_review",
    execution_status: record.status === "succeeded" ? "completed" : record.status,
    advisory_output: Object.freeze({
      available: text !== null,
      usable: text !== null,
      ...(text === null ? {} : { text })
    }),
    schema_observation: Object.freeze({
      adherent: schema.adherent,
      diagnostics: schema.diagnostics
    }),
    formal_attestation: Object.freeze({
      requested,
      available: false,
      reason: requested
        ? schema.adherent ? "settlement_pending" : "schema_non_adherent"
        : "not_requested"
    }),
    authority: "advisory_only"
  });
}

function normalizeAdvisoryFinalResult(raw, record, missing = null) {
  const normalized = normalizeFinalResult(raw) ?? normalizeFinalResult({
    kind: "missing_result",
    missing_result: missing ?? {
      code: BACKEND_MISSING_RESULT_CODES.FINAL_REPORT_NOT_CAPTURED,
      reason: "advisory_output_not_captured",
      detail: null
    }
  });
  return Object.freeze({
    ...normalized,
    advisory_review: advisoryProjection(normalized, record)
  });
}

const settledFormalAttestation = new WeakSet();

async function settleFormalAttestation(record, settleFormalReviewAttestation) {
  const formal = record.final_result?.advisory_review?.formal_attestation;
  if (formal?.requested !== true || settledFormalAttestation.has(record)) return;
  settledFormalAttestation.add(record);
  if (formal.reason === "schema_non_adherent") return;
  const text = record.final_result?.full_response?.text ?? null;
  const schema = boundedSchemaObservation(text, record);
  let settlement;
  try {
    settlement = typeof settleFormalReviewAttestation === "function"
      ? await settleFormalReviewAttestation({ record, formalResult: schema.result })
      : { available: false, reason: "settlement_owner_unavailable" };
  } catch (error) {
    settlement = Object.freeze({
      available: false,
      reason: "settlement_failed",
      diagnostics: Object.freeze([error?.message ?? String(error)])
    });
  }
  record.final_result = Object.freeze({
    ...record.final_result,
    advisory_review: Object.freeze({
      ...record.final_result.advisory_review,
      formal_attestation: Object.freeze({ requested: true, ...settlement })
    })
  });
}

function launchEnvelope(record) {
  return Object.freeze({
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
    final_result: record.final_result
  });
}

export async function finalizeAdvisoryProcessLaunch({
  executorResult,
  runs,
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
  advisoryReviewInput,
  sessionContract = null,
  cleanup = null
}) {
  if (!executorResult || typeof executorResult !== "object" ||
      executorResult.accepted === false) {
    return executorResult?.accepted === false
      ? executorResult
      : Object.freeze({ accepted: false, refusal: Object.freeze({
          code: "launch_failed_before_start",
          reason: "advisory_process_no_result",
          detail: null
        }) });
  }
  const status = normalizeStatus(executorResult.status ?? "launching");
  if (status === null) {
    return Object.freeze({ accepted: false, refusal: Object.freeze({
      code: "launch_failed_before_start",
      reason: "advisory_process_status_invalid",
      detail: null
    }) });
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
    status,
    started_at: startedAt,
    updated_at: startedAt,
    terminal: TERMINAL_STATUSES.has(status),
    exit: executorResult.exit ?? null,
    probe: typeof executorResult.probe === "function" ? executorResult.probe : null,
    terminal_structured_role_result_mode:
      advisoryReviewInput?.formal_result_contract?.mode === "schema_constrained"
        ? WORKSPACE_AGENT_SELECTED_RESULT_CONTRACTS.SCHEMA_CONSTRAINED
        : null,
    final_result: null
  };
  if (typeof cleanup === "function") {
    Object.defineProperty(record, "cleanup", {
      value: cleanup,
      enumerable: false,
      writable: false,
      configurable: false
    });
  }
  Object.defineProperty(record, "advisory_process", {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false
  });
  Object.defineProperty(record, "advisory_review_input", {
    value: advisoryReviewInput,
    enumerable: false,
    writable: false,
    configurable: false
  });
  if (sessionContract !== null) {
    Object.defineProperty(record, "session_contract", {
      value: sessionContract,
      enumerable: true,
      writable: false,
      configurable: false
    });
  }
  if (record.terminal) {
    record.final_result = normalizeAdvisoryFinalResult(executorResult.final_result, record);
    await settleFormalAttestation(record, settleFormalReviewAttestation);
    record.cleanup?.();
  }
  runs.set(run_id, record);
  return launchEnvelope(record);
}

export async function settleAndProjectAdvisoryProcess(record, {
  clock,
  settleFormalReviewAttestation
} = {}) {
  if (!record.terminal && typeof record.probe === "function") {
    try {
      const observation = await record.probe();
      if (observation !== null && observation !== undefined) {
        const status = normalizeStatus(observation?.status);
        if (status === null) throw new Error("advisory_process_probe_status_invalid");
        record.status = status;
        record.terminal = TERMINAL_STATUSES.has(status);
        record.exit = observation.exit ?? record.exit;
        if (record.terminal) {
          record.final_result = normalizeAdvisoryFinalResult(observation.final_result, record);
        }
      }
    } catch (error) {
      record.status = "failed";
      record.terminal = true;
      record.exit = Object.freeze({ code: null, signal: null, error: error?.message ?? String(error) });
      record.final_result = normalizeAdvisoryFinalResult(null, record, {
        code: BACKEND_MISSING_RESULT_CODES.FINAL_REPORT_PROBE_FAILED,
        reason: "advisory_process_probe_failed",
        detail: null
      });
    }
    record.updated_at = new Date(clock()).toISOString();
  }
  if (record.terminal) {
    await settleFormalAttestation(record, settleFormalReviewAttestation);
    record.cleanup?.();
  }
  return Object.freeze({
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
    ...(record.session_contract === undefined ? {} : {
      session_contract_required: true,
      session_contract: record.session_contract
    })
  });
}
