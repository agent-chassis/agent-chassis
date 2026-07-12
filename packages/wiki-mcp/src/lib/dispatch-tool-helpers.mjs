

import { readWorkRecordById } from "@agent-chassis/wiki-core";

import { redactAbsolutePaths, projectNextActionScalar } from "./mcp-response.mjs";

import {
  classifyDispatchSubject
} from "./dispatch-subject-classifier.mjs";
import {
  AGENT_DISPATCH_MONITOR_HANDLE_PREFIX,
  AGENT_DISPATCH_SCHEMA_VERSION,
  AGENT_DISPATCH_SUBJECT_KIND_INITIATIVE,
  AGENT_DISPATCH_SUBJECT_KIND_WORK_RECORD,
  AGENT_DISPATCH_SUBJECT_KIND_WORK_RECORD_SLICE,
  AGENT_RUN_STATUS_SCHEMA_VERSION,
  AGENT_RUN_WAIT_SCHEMA_VERSION,
  BACKEND_REFUSAL_TO_DISPATCH_BLOCKER,
  DISPATCH_BLOCKER_CODES,
  DISPATCH_EXCEPTION_DIAGNOSTIC_MAX_CHARS,
  DISPATCH_SUBJECT_KIND_TO_ROUTE_KIND
} from "./dispatch-tool-constants.mjs";

import {
  RUNTIME_BLOCKER_DISPATCH_FACING_CATEGORIES
} from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";

export function mapBackendRefusalToDispatchCode(code) {
  if (typeof code !== "string") {
    return DISPATCH_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED;
  }
  return BACKEND_REFUSAL_TO_DISPATCH_BLOCKER[code] ?? DISPATCH_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED;
}

export function classifyAgentDispatchSubject(subject) {
  const classified = classifyDispatchSubject(subject);
  if (!classified) {
    return null;
  }
  return DISPATCH_SUBJECT_KIND_TO_ROUTE_KIND[classified.subject_kind] ?? null;
}

export function isAcceptedSubjectForRole(role, subjectKind) {
  if (!subjectKind) return false;
  if (role === "worker" || role === "reviewer") {
    return (
      subjectKind === AGENT_DISPATCH_SUBJECT_KIND_WORK_RECORD ||
      subjectKind === AGENT_DISPATCH_SUBJECT_KIND_WORK_RECORD_SLICE
    );
  }
  if (role === "redteam") {
    return (
      subjectKind === AGENT_DISPATCH_SUBJECT_KIND_WORK_RECORD ||
      subjectKind === AGENT_DISPATCH_SUBJECT_KIND_WORK_RECORD_SLICE ||
      subjectKind === AGENT_DISPATCH_SUBJECT_KIND_INITIATIVE
    );
  }
  return false;
}

export async function loadReviewerSubjectAdmissionContext({ dir, unitAddress }) {

  const parts = String(unitAddress).split("#");
  const recordId = parts[0];
  const sliceId = parts.length === 2 ? parts[1] : null;
  let loaded;
  try {
    loaded = await readWorkRecordById({ dir, id: recordId });
  } catch {
    return null;
  }
  if (!loaded || !loaded.record) return null;
  const record = loaded.record;
  const selectedSlice = sliceId && Array.isArray(record.slices)
    ? record.slices.find((entry) => entry && entry.id === sliceId) || null
    : null;
  const selectedUnit = selectedSlice ?? record;
  if (sliceId) {
    if (!selectedSlice) return null;
  }
  const writeScope = Array.isArray(selectedUnit.write_scope) ? selectedUnit.write_scope : [];
  return {
    record_id: recordId,
    slice_id: sliceId,
    title: typeof selectedUnit.title === "string" ? selectedUnit.title : record.title ?? null,
    work_kind: typeof selectedUnit.work_kind === "string" ? selectedUnit.work_kind : record.work_kind ?? null,
    write_scope: writeScope,
    repo_paths: Array.isArray(selectedUnit.repo_paths) ? selectedUnit.repo_paths : [],
    acceptance: selectedUnit.acceptance ?? null
  };
}

export function omitNullFields(obj) {

  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    out[key] = value;
  }
  return out;
}

export function compactRuntimeBlockerTaxonomy(taxonomy) {

  const dispatchFacing = new Set(RUNTIME_BLOCKER_DISPATCH_FACING_CATEGORIES);
  const allCodes = Array.isArray(taxonomy.codes) ? taxonomy.codes : [];
  const codes = allCodes.filter((entry) => dispatchFacing.has(entry.category));
  const blockingCount = codes.filter((entry) => Boolean(entry.blocking)).length;
  const allCategories = Array.isArray(taxonomy.code_categories) ? taxonomy.code_categories : [];
  const categories = allCategories.filter((category) => dispatchFacing.has(category));
  return {
    schema_version: taxonomy.schema_version,
    verbose: false,
    code_count: codes.length,
    category_count: categories.length,
    blocking_count: blockingCount,
    nonblocking_count: codes.length - blockingCount,
    codes: codes.map((entry) => ({
      code: entry.code,
      category: entry.category,
      blocking: Boolean(entry.blocking),
      summary: entry.summary,
      actor_recovery: entry.actor_recovery ?? null
    }))
  };
}

export function summarizeRunStatusFinalResult(finalResult) {

  const fullResponse =
    finalResult.full_response && typeof finalResult.full_response === "object"
      ? finalResult.full_response
      : null;
  const text = typeof fullResponse?.text === "string" ? fullResponse.text : null;
  const structuredRoleResult = summarizeStructuredRoleResultEvidence(
    finalResult.structured_role_result
  );
  return {
    kind: finalResult.kind ?? null,
    schema_version: finalResult.schema_version ?? null,
    writeback_kind: finalResult.writeback?.kind ?? null,
    missing_result_code: finalResult.missing_result?.code ?? null,
    full_response_present: Boolean(text),
    full_response_chars: text ? text.length : 0,
    ...(structuredRoleResult ? { structured_role_result: structuredRoleResult } : {})
  };
}

function summarizeStructuredRoleResultEvidence(structuredRoleResult) {
  if (!structuredRoleResult || typeof structuredRoleResult !== "object" || Array.isArray(structuredRoleResult)) {
    return null;
  }
  const diagnostics = Array.isArray(structuredRoleResult.diagnostics)
    ? structuredRoleResult.diagnostics
    : [];
  const diagnosticCodes = diagnostics
    .map((diagnostic) => diagnostic?.code)
    .filter((code) => typeof code === "string" && code.length > 0)
    .slice(0, 20);
  const candidate =
    structuredRoleResult.candidate &&
    typeof structuredRoleResult.candidate === "object" &&
    !Array.isArray(structuredRoleResult.candidate)
      ? structuredRoleResult.candidate
      : null;
  const claims =
    structuredRoleResult.claims &&
    typeof structuredRoleResult.claims === "object" &&
    !Array.isArray(structuredRoleResult.claims)
      ? structuredRoleResult.claims
      : null;
  const findingCounts =
    structuredRoleResult.finding_counts &&
    typeof structuredRoleResult.finding_counts === "object" &&
    !Array.isArray(structuredRoleResult.finding_counts)
      ? structuredRoleResult.finding_counts
      : null;

  return omitNullFields({
    valid: structuredRoleResult.valid === true,
    status: structuredRoleResult.valid === true ? "valid" : "invalid",
    reported_role: typeof claims?.reported_role === "string" ? claims.reported_role : null,
    reported_subject: typeof claims?.reported_subject === "string" ? claims.reported_subject : null,
    reported_outcome: typeof claims?.reported_outcome === "string" ? claims.reported_outcome : null,
    total_finding_count: Number.isInteger(findingCounts?.total) ? findingCounts.total : null,
    blocking_finding_count: Number.isInteger(findingCounts?.blocking)
      ? findingCounts.blocking
      : null,
    medium_finding_count: Number.isInteger(findingCounts?.medium) ? findingCounts.medium : null,
    reviewed_control_count: Array.isArray(structuredRoleResult.reviewed_controls)
      ? structuredRoleResult.reviewed_controls.length
      : null,
    diagnostic_count: diagnostics.length,
    diagnostic_codes: diagnosticCodes,
    candidate_kind: typeof candidate?.kind === "string" ? candidate.kind : null,
    candidate_payload_bytes: Number.isInteger(candidate?.payload_bytes)
      ? candidate.payload_bytes
      : null
  });
}

export function compactRunStatusReviewResult(reviewResult) {
  if (!reviewResult || typeof reviewResult !== "object" || Array.isArray(reviewResult)) {
    return null;
  }
  const compact = omitNullFields({
    review_outcome: reviewResult.review_outcome ?? null,
    clean_review: typeof reviewResult.clean_review === "boolean" ? reviewResult.clean_review : null,
    no_findings: typeof reviewResult.no_findings === "boolean" ? reviewResult.no_findings : null,
    blocking_finding_count: Number.isInteger(reviewResult.blocking_finding_count)
      ? reviewResult.blocking_finding_count
      : null,
    medium_finding_count: Number.isInteger(reviewResult.medium_finding_count)
      ? reviewResult.medium_finding_count
      : null
  });
  return Object.keys(compact).length > 0 ? compact : null;
}

function resolveRefusalNextAction({ nextAction = null, nextCalls = null } = {}) {

  if (Array.isArray(nextCalls)) {
    return projectNextActionScalar(nextCalls);
  }
  return nextAction ?? null;
}

function refusalNextActionSlot(nextAction) {

  return nextAction === null || nextAction === undefined ? {} : { next_action: nextAction };
}

export function buildBlockedDispatchResult({ blockerCode, reason, detail = null, nextAction = null, nextCalls = null }) {
  return {
    schema_version: AGENT_DISPATCH_SCHEMA_VERSION,
    accepted: false,
    blocker: {
      code: blockerCode,
      reason: reason ?? null,
      detail: detail ?? null
    },
    transport: "mcp",
    run_id: null,
    monitor_handle: null,
    readiness: null,
    ...refusalNextActionSlot(resolveRefusalNextAction({ nextAction, nextCalls }))
  };
}

export function buildBlockedRunStatusResult({ blockerCode, reason, detail = null, nextAction = null, nextCalls = null }) {
  return {
    schema_version: AGENT_RUN_STATUS_SCHEMA_VERSION,
    accepted: false,
    blocker: {
      code: blockerCode,
      reason: reason ?? null,
      detail: detail ?? null
    },
    run_id: null,
    status: null,
    ...refusalNextActionSlot(resolveRefusalNextAction({ nextAction, nextCalls }))
  };
}

export function buildBlockedRunWaitResult({ blockerCode, reason, detail = null, nextAction = null, nextCalls = null }) {
  return {
    schema_version: AGENT_RUN_WAIT_SCHEMA_VERSION,
    accepted: false,
    blocker: {
      code: blockerCode,
      reason: reason ?? null,
      detail: detail ?? null
    },
    run_id: null,
    status: null,
    timed_out: null,
    ...refusalNextActionSlot(resolveRefusalNextAction({ nextAction, nextCalls }))
  };
}

export function buildDispatchToolExceptionDetail(toolName, error) {
  const message = error instanceof Error ? error.message : String(error);

  const redacted = redactAbsolutePaths(message);
  const truncated = redacted.length > DISPATCH_EXCEPTION_DIAGNOSTIC_MAX_CHARS;
  return {
    tool: toolName,
    error_name: error instanceof Error ? error.name : null,
    error_message: truncated
      ? redacted.slice(0, DISPATCH_EXCEPTION_DIAGNOSTIC_MAX_CHARS)
      : redacted,
    error_message_truncated: truncated
  };
}

export function resolveMonitorHandleAlwaysUnknown(token) {

  if (typeof token !== "string" || !token.startsWith(AGENT_DISPATCH_MONITOR_HANDLE_PREFIX)) {
    return {
      blocker_code: DISPATCH_BLOCKER_CODES.MONITOR_HANDLE_UNKNOWN,
      reason: "monitor_handle_not_minted_by_server"
    };
  }
  return {
    blocker_code: DISPATCH_BLOCKER_CODES.MONITOR_HANDLE_UNKNOWN,
    reason: "monitor_handle_unknown_to_server"
  };
}
