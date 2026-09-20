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
import { createHash, timingSafeEqual } from "node:crypto";
import { readStdioMcpConduitTerminalFailure } from "./stdio-mcp-conduit-contract.mjs";
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

const FINDINGS_SOURCE_REFERENCE_PREFIX = "managed-findings.v1.";

function findingsTextDigest(text) {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

function encodeFindingsSourceReference(record, text) {
  const payload = Object.freeze({ v: 1, p: "managed_findings", run: record.run_id,
    monitor: record.monitor_handle, caller: record.caller_session_id,
    subject: record.subject, repository: record.workspace_alias,
    value_digest: findingsTextDigest(text), utf8_bytes: Buffer.byteLength(text, "utf8") });
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const checksum = createHash("sha256").update(encoded).digest("hex");
  return `${FINDINGS_SOURCE_REFERENCE_PREFIX}${encoded}.${checksum}`;
}

export function decodeManagedFindingsSourceReference(reference) {
  if (typeof reference !== "string" || !reference.startsWith(FINDINGS_SOURCE_REFERENCE_PREFIX)) {
    return null;
  }
  try {
    const framed = reference.slice(FINDINGS_SOURCE_REFERENCE_PREFIX.length);
    const split = framed.lastIndexOf(".");
    if (split <= 0) return { invalid: true };
    const encoded = framed.slice(0, split);
    const supplied = framed.slice(split + 1);
    const expected = createHash("sha256").update(encoded).digest("hex");
    if (!/^[a-f0-9]{64}$/u.test(supplied) ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return { invalid: true };
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.toString("base64url") !== encoded) return { invalid: true };
    const value = JSON.parse(bytes.toString("utf8"));
    const keys = Object.keys(value).sort().join("\0");
    if (keys !== ["caller", "monitor", "p", "repository", "run", "subject", "utf8_bytes",
      "v", "value_digest"].sort().join("\0") || value.v !== 1 || value.p !== "managed_findings" ||
      !["run", "monitor", "caller", "subject", "repository"].every((key) =>
        typeof value[key] === "string" && value[key].length > 0) ||
      !/^sha256:[a-f0-9]{64}$/u.test(value.value_digest) ||
      !Number.isSafeInteger(value.utf8_bytes) || value.utf8_bytes < 0) return { invalid: true };
    return value;
  } catch {
    return { invalid: true };
  }
}

export function resolveManagedFindingsSourceFromRecord(record, reference, {
  callerSessionId,
  repository
} = {}) {
  const decoded = decodeManagedFindingsSourceReference(reference);
  if (decoded === null || decoded.invalid) return Object.freeze({ ok: false, state: "corrupt" });
  if (decoded.caller !== callerSessionId || record?.caller_session_id !== callerSessionId ||
      decoded.repository !== repository || record?.workspace_alias !== repository) {
    return Object.freeze({ ok: false, state: "denied" });
  }
  if (record.run_id !== decoded.run || record.monitor_handle !== decoded.monitor ||
      record.subject !== decoded.subject) return Object.freeze({ ok: false, state: "changed" });
  const text = record.final_result?.advisory_review?.advisory_output?.text;
  if (record.terminal !== true || typeof text !== "string") {
    return Object.freeze({ ok: false, state: record.terminal === true ? "expired" : "unavailable" });
  }
  if (findingsTextDigest(text) !== decoded.value_digest ||
      Buffer.byteLength(text, "utf8") !== decoded.utf8_bytes) {
    return Object.freeze({ ok: false, state: "changed" });
  }
  return Object.freeze({ ok: true, state: "available", text,
    provenance: Object.freeze({ source_kind: "original_managed_findings",
      run_id: decoded.run, monitor_handle: decoded.monitor, subject: decoded.subject,
      repository: decoded.repository, value_digest: decoded.value_digest,
      utf8_bytes: decoded.utf8_bytes, authority: "advisory_only", attestation: false }) });
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
      ...(text === null ? {} : {
        text,
        source_reference: Object.freeze({
          ref: encodeFindingsSourceReference(record, text),
          source_kind: "original_managed_findings",
          utf8_bytes: Buffer.byteLength(text, "utf8"),
          value_digest: findingsTextDigest(text),
          authority: "advisory_only",
          attestation: false
        })
      })
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

function captureAdvisoryTerminalObservation(record, observed) {
  const conduitFailure = readStdioMcpConduitTerminalFailure(observed);
  if (conduitFailure !== null) {
    const exit = record.exit;
    record.exit = Object.freeze({
      ...(exit !== null && typeof exit === "object" && !Array.isArray(exit)
        ? exit
        : { code: null, signal: null }),
      conduit_failure: conduitFailure
    });
  }
  record.final_result = normalizeAdvisoryFinalResult(observed?.final_result, record);
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
    captureAdvisoryTerminalObservation(record, executorResult);
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
        if (record.terminal) captureAdvisoryTerminalObservation(record, observation);
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
  const envelope = {
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
  };

  const input = record.advisory_review_input;
  if (typeof input?.reviewed_sha === "string" && typeof input?.base_sha === "string") {
    Object.defineProperty(envelope, "advisory_review_target", {
      value: Object.freeze({ base_sha: input.base_sha, reviewed_sha: input.reviewed_sha }),
      enumerable: false,
      writable: false,
      configurable: false
    });
  }
  return Object.freeze(envelope);
}
