

import {
  STRUCTURED_ROLE_RESULT_EVIDENCE_SCHEMA_VERSION,
  AGENT_ROLE_RESULT_COUNT_FIELDS
} from "./agent-role-result.mjs";

export const WORKSPACE_AGENT_DISPATCH_BACKEND_SCHEMA_VERSION =
  "workspace-agent-dispatch-backend.v1";
export const WORKSPACE_AGENT_DISPATCH_RUN_STATUS_SCHEMA_VERSION =
  "workspace-agent-dispatch-backend-run-status.v1";
export const WORKSPACE_AGENT_DISPATCH_RUN_WAIT_SCHEMA_VERSION =
  "workspace-agent-dispatch-backend-run-wait.v1";

export const WORKSPACE_AGENT_DISPATCH_PLAN_SCHEMA_VERSION =
  "workspace-agent-dispatch-plan.v1";

export const WORKSPACE_AGENT_DISPATCH_FINAL_RESULT_SCHEMA_VERSION =
  "workspace-agent-dispatch-final-result.v1";

export const WORKSPACE_AGENT_DISPATCH_STRUCTURED_ROLE_RESULT_SCHEMA_VERSION =
  "workspace-agent-dispatch-structured-role-result.v1";

export const BACKEND_ACCEPTED_ROLES = Object.freeze(["worker", "reviewer", "redteam"]);

export function validateLauncherFamilyRole(role) {
  if (typeof role !== "string" || role.length === 0) {
    return Object.freeze({ ok: false, kind: "missing", role: role ?? null });
  }
  if (!BACKEND_ACCEPTED_ROLES.includes(role)) {
    return Object.freeze({
      ok: false,
      kind: "unknown",
      role,
      allowed: [...BACKEND_ACCEPTED_ROLES]
    });
  }
  return Object.freeze({ ok: true, role });
}

export function normalizeDispatchModelHint(model) {
  return typeof model === "string" && model.length > 0 ? model : null;
}

export const BACKEND_SUPPORTED_APPS = Object.freeze(["codex", "claude"]);

export const BACKEND_FAMILY_UNAVAILABLE_REASONS = Object.freeze({
  codex: "codex_launch_executor_not_configured",
  claude: "claude_launch_executor_not_configured",
  agy: "agy_launch_executor_not_configured"
});

export const BACKEND_RUN_STATUSES = Object.freeze([
  "launching",
  "running",
  "succeeded",
  "failed",
  "cancelled"
]);
const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);

export const BACKEND_REFUSAL_CODES = Object.freeze({
  BACKEND_UNAVAILABLE: "backend_unavailable",
  LAUNCH_REFUSED: "validation_failure",
  LAUNCH_FAILED_BEFORE_START: "operator_recovery_needed",
  MONITOR_HANDLE_UNKNOWN: "monitor_handle_unknown",
  MONITOR_HANDLE_CALLER_MISMATCH: "monitor_handle_caller_mismatch",
  MONITOR_HANDLE_SUBJECT_MISMATCH: "monitor_handle_subject_mismatch"
});

export const BACKEND_MISSING_RESULT_CODES = Object.freeze({
  FINAL_REPORT_NOT_CAPTURED: "final_report_not_captured",
  FINAL_REPORT_CAPTURE_THREW: "final_report_capture_threw",
  FINAL_REPORT_INVALID_KIND: "final_report_invalid_kind",
  FINAL_REPORT_PROBE_FAILED: "final_report_probe_failed"
});

export const BACKEND_FINAL_RESULT_KINDS = Object.freeze([
  "findings",
  "no_findings",
  "missing_result"
]);

export const BACKEND_WRITEBACK_KINDS = Object.freeze([
  "wk_updated",
  "no_writeback_expected",
  "writeback_missing",
  "writeback_failed"
]);

function buildMissingResultEnvelope(code, reason, detail) {
  return Object.freeze({
    schema_version: WORKSPACE_AGENT_DISPATCH_FINAL_RESULT_SCHEMA_VERSION,
    kind: "missing_result",
    findings: null,
    no_findings: null,
    missing_result: Object.freeze({
      code,
      reason: reason ?? null,
      detail: detail ?? null
    }),
    full_response: null,
    writeback: null
  });
}

function normalizeWriteback(input) {
  if (!input || typeof input !== "object") return null;
  if (!BACKEND_WRITEBACK_KINDS.includes(input.kind)) return null;
  return Object.freeze({
    kind: input.kind,
    detail: input.detail ?? null
  });
}

function normalizeFullResponse(input) {
  if (!input || typeof input !== "object") return null;
  if (typeof input.text !== "string" || input.text.length === 0) return null;
  const format = typeof input.format === "string" && input.format.length > 0
    ? input.format
    : null;
  const source = input.source && typeof input.source === "object"
    ? Object.freeze({ ...input.source })
    : null;
  return Object.freeze({ format, text: input.text, source });
}

function normalizeNoFindingsPayload(input) {
  const reason = typeof input?.reason === "string" ? input.reason : null;
  const format = typeof input?.format === "string" && input.format.length > 0
    ? input.format
    : null;
  const text = typeof input?.text === "string" && input.text.length > 0
    ? input.text
    : null;
  const source = input?.source && typeof input.source === "object"
    ? Object.freeze({ ...input.source })
    : null;
  return Object.freeze({ reason, format, text, source });
}

function isUsableNoFindingsPayload(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const hasReason = typeof input.reason === "string" && input.reason.length > 0;
  const hasText = typeof input.text === "string" && input.text.length > 0;
  return hasReason || hasText;
}

function normalizeFinalResultEnvelope(input) {
  if (!input || typeof input !== "object") return null;
  const writeback = normalizeWriteback(input.writeback);
  const kind = input.kind;
  if (kind === "findings") {
    if (!input.findings || typeof input.findings !== "object") {
      return buildMissingResultEnvelope(
        BACKEND_MISSING_RESULT_CODES.FINAL_REPORT_INVALID_KIND,
        "findings_payload_required",
        null
      );
    }
    const fullResponse =
      normalizeFullResponse(input.full_response) ??
      normalizeFullResponse(input.findings);
    return Object.freeze({
      schema_version: WORKSPACE_AGENT_DISPATCH_FINAL_RESULT_SCHEMA_VERSION,
      kind: "findings",
      findings: input.findings,
      no_findings: null,
      missing_result: null,
      full_response: fullResponse,
      writeback
    });
  }
  if (kind === "no_findings") {
    if (!isUsableNoFindingsPayload(input.no_findings)) {
      return buildMissingResultEnvelope(
        BACKEND_MISSING_RESULT_CODES.FINAL_REPORT_INVALID_KIND,
        "no_findings_payload_required",
        null
      );
    }
    const noFindings = normalizeNoFindingsPayload(input.no_findings);
    const fullResponse =
      normalizeFullResponse(input.full_response) ??
      normalizeFullResponse(input.no_findings);
    return Object.freeze({
      schema_version: WORKSPACE_AGENT_DISPATCH_FINAL_RESULT_SCHEMA_VERSION,
      kind: "no_findings",
      findings: null,
      no_findings: noFindings,
      missing_result: null,
      full_response: fullResponse,
      writeback
    });
  }
  if (kind === "missing_result") {
    const code = typeof input.missing_result?.code === "string" && input.missing_result.code.length > 0
      ? input.missing_result.code
      : BACKEND_MISSING_RESULT_CODES.FINAL_REPORT_NOT_CAPTURED;
    const envelope = buildMissingResultEnvelope(
      code,
      input.missing_result?.reason ?? null,
      input.missing_result?.detail ?? null
    );
    if (!writeback) return envelope;
    return Object.freeze({
      ...envelope,
      writeback
    });
  }
  return buildMissingResultEnvelope(
    BACKEND_MISSING_RESULT_CODES.FINAL_REPORT_INVALID_KIND,
    "final_result_kind_unrecognized",
    { received_kind: typeof kind === "string" ? kind : null }
  );
}

export function normalizeFinalResult(input) {
  const envelope = normalizeFinalResultEnvelope(input);
  if (!envelope) return envelope;
  const structuredRoleResult =
    input && typeof input === "object"
      ? normalizeStructuredRoleResult(input.structured_role_result ?? null)
      : null;
  if (structuredRoleResult === null) return envelope;
  return Object.freeze({ ...envelope, structured_role_result: structuredRoleResult });
}

const STRUCTURED_ROLE_RESULT_MAX_DIAGNOSTICS = 20;
const STRUCTURED_ROLE_RESULT_MAX_DETAIL_KEYS = 12;
const STRUCTURED_ROLE_RESULT_MAX_DETAIL_STRING = 256;

export function normalizeStructuredRoleResult(evidence) {
  if (evidence === null || evidence === undefined) return null;
  if (typeof evidence !== "object" || Array.isArray(evidence)) {
    return buildInvalidStructuredRoleResult([
      Object.freeze({
        code: "structured_role_result_input_unrecognized",
        message:
          "structured_role_result evidence must be a structured-role-result.evidence.v1 object"
      })
    ]);
  }
  if (evidence.schema_version !== STRUCTURED_ROLE_RESULT_EVIDENCE_SCHEMA_VERSION) {
    return buildInvalidStructuredRoleResult([
      Object.freeze({
        code: "structured_role_result_schema_unrecognized",
        message: "structured_role_result evidence has an unrecognized schema_version"
      })
    ]);
  }

  const valid = evidence.valid === true;
  const claims = normalizeStructuredRoleResultClaims(evidence.claims);
  const result =
    valid && evidence.result && typeof evidence.result === "object" && !Array.isArray(evidence.result)
      ? evidence.result
      : null;
  const findingCounts = result
    ? normalizeStructuredRoleResultCounts(result.recomputed_finding_counts ?? result.finding_counts)
    : null;
  const reviewedControls = result
    ? normalizeStructuredRoleResultControls(result.reviewed_controls)
    : Object.freeze([]);
  const diagnostics = normalizeStructuredRoleResultDiagnostics(evidence.diagnostics);

  return Object.freeze({
    schema_version: WORKSPACE_AGENT_DISPATCH_STRUCTURED_ROLE_RESULT_SCHEMA_VERSION,
    valid,
    claims,
    finding_counts: findingCounts,
    reviewed_controls: reviewedControls,
    diagnostics,
    authority: "child_evidence_only"
  });
}

function buildInvalidStructuredRoleResult(diagnostics) {
  return Object.freeze({
    schema_version: WORKSPACE_AGENT_DISPATCH_STRUCTURED_ROLE_RESULT_SCHEMA_VERSION,
    valid: false,
    claims: null,
    finding_counts: null,
    reviewed_controls: Object.freeze([]),
    diagnostics: Object.freeze(diagnostics),
    authority: "child_evidence_only"
  });
}

function normalizeStructuredRoleResultClaims(claims) {
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) return null;
  const reportedRole = typeof claims.reported_role === "string" ? claims.reported_role : null;
  const reportedSubject =
    typeof claims.reported_subject === "string" ? claims.reported_subject : null;
  const reportedOutcome =
    typeof claims.reported_outcome === "string" ? claims.reported_outcome : null;
  if (reportedRole === null && reportedSubject === null && reportedOutcome === null) return null;
  return Object.freeze({
    reported_role: reportedRole,
    reported_subject: reportedSubject,
    reported_outcome: reportedOutcome
  });
}

function normalizeStructuredRoleResultCounts(counts) {
  if (!counts || typeof counts !== "object" || Array.isArray(counts)) return null;
  const normalized = {};
  for (const field of AGENT_ROLE_RESULT_COUNT_FIELDS) {
    normalized[field] =
      Number.isInteger(counts[field]) && counts[field] >= 0 ? counts[field] : 0;
  }
  return Object.freeze(normalized);
}

function normalizeStructuredRoleResultControls(controls) {
  if (!Array.isArray(controls)) return Object.freeze([]);
  const normalized = [];
  const seen = new Set();
  for (const entry of controls) {
    if (!entry || typeof entry !== "object") continue;
    const controlId = entry.control_id;
    if (typeof controlId !== "string" || controlId.trim().length === 0) continue;
    if (entry.result !== "pass" && entry.result !== "fail") continue;
    if (seen.has(controlId)) continue;
    seen.add(controlId);
    normalized.push(Object.freeze({ control_id: controlId, result: entry.result }));
  }
  return Object.freeze(normalized);
}

function normalizeStructuredRoleResultDiagnostics(diagnostics) {
  if (!Array.isArray(diagnostics)) return Object.freeze([]);
  const normalized = [];
  for (const diagnostic of diagnostics) {
    if (normalized.length >= STRUCTURED_ROLE_RESULT_MAX_DIAGNOSTICS) break;
    const entry = normalizeStructuredRoleResultDiagnostic(diagnostic);
    if (entry !== null) normalized.push(entry);
  }
  return Object.freeze(normalized);
}

function normalizeStructuredRoleResultDiagnostic(diagnostic) {
  if (!diagnostic || typeof diagnostic !== "object" || Array.isArray(diagnostic)) return null;
  const normalized = {
    code: typeof diagnostic.code === "string" ? diagnostic.code : "unknown_diagnostic",
    message: typeof diagnostic.message === "string" ? diagnostic.message : ""
  };
  if (typeof diagnostic.path === "string") normalized.path = diagnostic.path;
  const detail = normalizeStructuredRoleResultDetail(diagnostic.detail);
  if (detail !== null) normalized.detail = detail;
  return Object.freeze(normalized);
}

function normalizeStructuredRoleResultDetail(detail) {
  if (detail === null || detail === undefined) return null;
  if (typeof detail === "number" || typeof detail === "boolean") return detail;
  if (typeof detail === "string") return truncateStructuredRoleResultString(detail);
  if (typeof detail !== "object" || Array.isArray(detail)) return null;
  const normalized = {};
  let keptKeys = 0;
  for (const [key, value] of Object.entries(detail)) {
    if (keptKeys >= STRUCTURED_ROLE_RESULT_MAX_DETAIL_KEYS) break;
    if (typeof value === "string") {
      normalized[key] = truncateStructuredRoleResultString(value);
    } else if (typeof value === "number" || typeof value === "boolean") {
      normalized[key] = value;
    } else {
      continue;
    }
    keptKeys += 1;
  }
  return Object.freeze(normalized);
}

function truncateStructuredRoleResultString(value) {
  return value.length > STRUCTURED_ROLE_RESULT_MAX_DETAIL_STRING
    ? `${value.slice(0, STRUCTURED_ROLE_RESULT_MAX_DETAIL_STRING)}…`
    : value;
}

export { TERMINAL_STATUSES };
