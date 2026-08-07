

import {
  cloneJson,
  computeNormalizedInputDigest,
  isNonEmptyString,
  isObject,
  normalizeStringEntry,
} from "./work-record-admission-shared.mjs";
import { SHA256_PATTERN } from "./work-record-schema-constants.mjs";

export const REVIEW_RESULT_EVIDENCE_SCHEMA_VERSION = "review-result-evidence.v1";
export const REVIEW_RESULT_EVIDENCE_AUTHORITY = "portfolio_coordination_only";
export const REVIEW_RESULT_TRUSTED_PROVENANCE_KIND = "structured_dispatch_run";

export const REVIEW_RESULT_REVIEWER_ROLE_CLASS_VALUES = Object.freeze(["reviewer", "redteam"]);
export const REVIEW_RESULT_EVIDENCE_CLASS_VALUES = Object.freeze([
  "changes_requested",
  "missing_result",
  "malformed_result",
  "invalid_result",
  "oversized_result",
  "duplicate_result",
  "multiple_result",
  "ordinary_json_result",
  "trailing_prose_result",
  "runtime_failure"
]);
export const REVIEW_RESULT_TERMINAL_SUCCESS_STATUS_VALUES = Object.freeze(["succeeded", "completed"]);
export const REVIEW_RESULT_RUNTIME_FAILURE_STATUS_VALUES = Object.freeze([
  "failed",
  "cancelled",
  "canceled",
  "timed_out",
  "timeout",
  "rejected",
  "inconclusive"
]);
export const REVIEW_RESULT_STRUCTURED_MISSING_STATUS_VALUES = Object.freeze([
  "missing",
  "absent",
  "malformed",
  "invalid",
  "oversized",
  "duplicate",
  "multiple",
  "ordinary_json",
  "trailing_prose"
]);

export const REVIEW_RESULT_STRUCTURED_STATUS_PRECEDENCE = Object.freeze([
  Object.freeze({
    status: "oversized",
    codes: Object.freeze(["response_oversized", "payload_oversized"])
  }),
  Object.freeze({ status: "multiple", codes: Object.freeze(["multiple_json_candidates"]) }),
  Object.freeze({ status: "duplicate", codes: Object.freeze(["duplicate_json_key"]) }),
  Object.freeze({ status: "ordinary_json", codes: Object.freeze(["ordinary_json_code_block"]) }),
  Object.freeze({ status: "trailing_prose", codes: Object.freeze(["trailing_prose_after_result"]) }),
  Object.freeze({ status: "malformed", codes: Object.freeze(["malformed_json"]) })
]);

const REVIEW_RESULT_STRUCTURED_STATUS_EVIDENCE_CLASS = Object.freeze({
  missing: "missing_result",
  absent: "missing_result",
  malformed: "malformed_result",
  invalid: "invalid_result",
  oversized: "oversized_result",
  duplicate: "duplicate_result",
  multiple: "multiple_result",
  ordinary_json: "ordinary_json_result",
  trailing_prose: "trailing_prose_result"
});

const REVIEW_RESULT_ROLE_OUTCOME_SET = new Set([
  "no_findings",
  "passed_no_blocking_or_medium_findings",
  "changes_requested",
  "blocked",
  "failed"
]);

const REVIEW_RESULT_REVIEWER_ROLE_CLASS_SET = new Set(REVIEW_RESULT_REVIEWER_ROLE_CLASS_VALUES);
const REVIEW_RESULT_EVIDENCE_CLASS_SET = new Set(REVIEW_RESULT_EVIDENCE_CLASS_VALUES);
const REVIEW_RESULT_TERMINAL_SUCCESS_STATUS_SET = new Set(REVIEW_RESULT_TERMINAL_SUCCESS_STATUS_VALUES);
const REVIEW_RESULT_RUNTIME_FAILURE_STATUS_SET = new Set(REVIEW_RESULT_RUNTIME_FAILURE_STATUS_VALUES);
const REVIEW_RESULT_STRUCTURED_MISSING_STATUS_SET = new Set(REVIEW_RESULT_STRUCTURED_MISSING_STATUS_VALUES);
const REVIEW_RESULT_FINDING_SEVERITY_SET = new Set(["critical", "high", "medium", "low", "info"]);
const REVIEW_RESULT_FINDING_COUNT_FIELDS = Object.freeze([
  "total",
  "blocking",
  "critical",
  "high",
  "medium",
  "low",
  "info"
]);
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;
const MAX_BOUNDED_STRING_LENGTH = 512;
const MAX_SUMMARY_LENGTH = 4000;
const MAX_DIAGNOSTIC_REF_LENGTH = 1024;
const MAX_FINDINGS = 100;
const MAX_DIAGNOSTICS = 20;
const STABLE_CODE_PATTERN = /^[a-z0-9][a-z0-9_.:-]{0,191}$/u;

export const REVIEW_RESULT_EVIDENCE_DECISION_CODES = Object.freeze({
  valid: "review_result_evidence.valid.v1",
  missing: "review_result_evidence.missing.v1",
  malformed: "review_result_evidence.malformed.v1",
  forbiddenAuthorityInput: "review_result_evidence.forbidden_authority_input.v1",
  untrustedProvenance: "review_result_evidence.untrusted_provenance.v1",
  wrongRole: "review_result_evidence.wrong_role.v1",
  wrongUnit: "review_result_evidence.wrong_unit.v1",
  wrongDigest: "review_result_evidence.wrong_digest.v1",
  nonTerminal: "review_result_evidence.non_terminal.v1",
  unsupportedOutcome: "review_result_evidence.unsupported_outcome.v1",
  missingStructuredResult: "review_result_evidence.missing_structured_result.v1",
  completionOutcome: "review_result_evidence.completion_outcome.v1",
  digestMismatch: "review_result_evidence.digest_mismatch.v1",
  missingExpectation: "review_result_evidence.missing_expectation.v1"
});
const CODES = REVIEW_RESULT_EVIDENCE_DECISION_CODES;

const COORDINATION_ONLY_EFFECTS = Object.freeze({
  coordination_only: true,
  satisfies_mandatory_review: false,
  grants_dispatch_authority: false,
  launch_authoritative: false,
  writes_accepted_authorities: false,
  contributes_accepted_authorities: false,
  creates_review_attestation: false,
  changes_status: false
});

const FORBIDDEN_AUTHORITY_KEY_NAMES = new Set([
  "accepted_authorities",
  "authority",
  "argv",
  "claimed_identity",
  "classification",
  "disposition",
  "env",
  "environment",
  "evidence_class",
  "final_result",
  "final_result_body",
  "final_response_text",
  "identity",
  "identity_claim",
  "notes",
  "outcome",
  "policy",
  "prompt",
  "prose",
  "raw_final_result",
  "raw_request",
  "reported_outcome",
  "request",
  "request_payload",
  "review_result",
  "review_outcome",
  "role_claim",
  "shell_output",
  "stderr",
  "status",
  "stdout",
  "summary",
  "subject_claim"
]);
const ALLOWED_STRUCTURED_RESULT_PATHS = new Set([
  "$.structured_role_result.authority",

  "$.structured_role_result.claims.reported_outcome",
  "$.structured_role_result.result.reported_outcome",
  "$.structured_role_result.result.summary"
]);

function isSha256(value) {
  return isNonEmptyString(value) && SHA256_PATTERN.test(value.trim());
}

function isoTimestampMs(value) {
  if (!isNonEmptyString(value) || !ISO_TIMESTAMP_PATTERN.test(value.trim())) return null;
  const ms = Date.parse(value.trim());
  return Number.isFinite(ms) ? ms : null;
}

function boundedString(value, maxLength = MAX_BOUNDED_STRING_LENGTH) {
  const normalized = normalizeStringEntry(value);
  if (!normalized || normalized.length > maxLength) return null;
  return normalized;
}

function boundedStableCode(value) {
  const normalized = boundedString(value, 192);
  return normalized && STABLE_CODE_PATTERN.test(normalized) ? normalized : null;
}

function refuse(decisionCode, reason) {
  return {
    ok: false,
    decision_code: decisionCode,
    reasons: [reason],
    ...COORDINATION_ONLY_EFFECTS
  };
}

function deny(decisionCode, reason) {
  return {
    valid: false,
    decision_code: decisionCode,
    reasons: [reason],
    ...COORDINATION_ONLY_EFFECTS
  };
}

function normalizeUnit(value) {
  if (!isObject(value)) return null;
  const address = boundedString(value.address);
  const recordId = boundedString(value.record_id);
  if (!address || !recordId) return null;
  const unit = { record_id: recordId, address };
  const sliceId = boundedString(value.slice_id);
  if (sliceId) unit.slice_id = sliceId;
  const kind = boundedString(value.kind);
  if (kind) unit.kind = kind;
  return unit;
}

function normalizeOptionalReviewUnit(value) {
  if (value === undefined || value === null) return null;
  return normalizeUnit(value);
}

function normalizeRunRef(value) {
  if (!isObject(value)) return null;
  const runId = boundedString(value.run_id);
  const monitorHandle = boundedString(value.monitor_handle);
  const roleClass = boundedString(value.role_class);
  const terminalStatus = boundedString(value.terminal_status);
  const subjectAddress = boundedString(value.subject_address);
  const provenanceKind = boundedString(value.provenance_kind);
  if ((!runId && !monitorHandle) || !roleClass || !terminalStatus || !subjectAddress || !provenanceKind) {
    return null;
  }
  const ref = {
    run_id: runId ?? null,
    monitor_handle: monitorHandle ?? null,
    role_class: roleClass,
    terminal_status: terminalStatus,
    subject_address: subjectAddress,
    provenance_kind: provenanceKind
  };

  const completedAt = boundedString(value.completed_at);
  if (completedAt) {
    if (isoTimestampMs(completedAt) === null) return null;
    ref.completed_at = completedAt;
  }

  const structuredResultStatus = boundedStableCode(
    value.structured_result_status ??
      value.structured_role_result_status ??
      value.role_result_status
  );
  if (structuredResultStatus) ref.structured_result_status = structuredResultStatus;

  const runtimeFailureCode = boundedStableCode(
    value.runtime_failure_code ??
      value.runtime_blocker_code ??
      value.blocker_code ??
      value.reason_code
  );
  if (runtimeFailureCode) ref.runtime_failure_code = runtimeFailureCode;

  const diagnosticRef = boundedString(
    value.diagnostic_ref ??
      value.content_ref ??
      value.artifact_ref ??
      value.final_result_ref,
    MAX_DIAGNOSTIC_REF_LENGTH
  );
  if (diagnosticRef) ref.diagnostic_ref = diagnosticRef;

  return ref;
}

function collectForbiddenAuthorityPaths(value, path = "$", paths = []) {
  if (!isObject(value) && !Array.isArray(value)) return paths;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectForbiddenAuthorityPaths(entry, `${path}[${index}]`, paths));
    return paths;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (FORBIDDEN_AUTHORITY_KEY_NAMES.has(key) && !ALLOWED_STRUCTURED_RESULT_PATHS.has(childPath)) {
      paths.push(childPath);
    }
    collectForbiddenAuthorityPaths(child, childPath, paths);
  }
  return paths;
}

function normalizeFindingCounts(value) {
  if (!isObject(value)) return null;
  const counts = {};
  for (const field of REVIEW_RESULT_FINDING_COUNT_FIELDS) {
    if (!Number.isInteger(value[field]) || value[field] < 0) return null;
    counts[field] = value[field];
  }
  if (Object.keys(value).some((key) => !REVIEW_RESULT_FINDING_COUNT_FIELDS.includes(key))) return null;
  if (counts.blocking > counts.total) return null;
  if (counts.critical + counts.high + counts.medium + counts.low + counts.info !== counts.total) return null;
  return counts;
}

function normalizeAffectedPaths(value) {
  if (!Array.isArray(value)) return null;
  const paths = [];
  for (const entry of value) {
    if (!isObject(entry)) return null;
    const repoPath = boundedString(entry.path, MAX_DIAGNOSTIC_REF_LENGTH);
    if (!repoPath || !isRepoRelativePath(repoPath)) return null;
    if (entry.line !== null && (!Number.isInteger(entry.line) || entry.line < 1)) return null;
    paths.push({ path: repoPath, line: entry.line });
  }
  return paths;
}

function normalizeFindings(value) {
  if (!Array.isArray(value) || value.length > MAX_FINDINGS) return null;
  const seen = new Set();
  const findings = [];
  for (const entry of value) {
    if (!isObject(entry)) return null;
    const id = boundedString(entry.id);
    const title = boundedString(entry.title, MAX_DIAGNOSTIC_REF_LENGTH);
    const severity = boundedString(entry.severity);
    const affectedPaths = normalizeAffectedPaths(entry.affected_paths);
    if (
      !id ||
      seen.has(id) ||
      !title ||
      !REVIEW_RESULT_FINDING_SEVERITY_SET.has(severity) ||
      typeof entry.blocking !== "boolean" ||
      !affectedPaths
    ) {
      return null;
    }
    seen.add(id);
    const finding = {
      id,
      title,
      severity,
      blocking: entry.blocking,
      affected_paths: affectedPaths
    };
    if (Object.prototype.hasOwnProperty.call(entry, "control_id")) {

      const controlId = boundedString(entry.control_id);
      if (!controlId) return null;
      finding.control_id = controlId;
    }
    findings.push(finding);
  }
  return findings;
}

function recomputeFindingCounts(findings) {
  const counts = {
    total: findings.length,
    blocking: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0
  };
  for (const finding of findings) {
    if (finding.blocking === true) counts.blocking += 1;
    counts[finding.severity] += 1;
  }
  return counts;
}

function countsEqual(left, right) {
  return REVIEW_RESULT_FINDING_COUNT_FIELDS.every((field) => left[field] === right[field]);
}

function normalizeReviewedControls(value) {
  if (!Array.isArray(value)) return null;
  const controls = [];
  const seen = new Set();
  for (const entry of value) {
    if (!isObject(entry)) return null;
    const controlId = boundedString(entry.control_id);
    const result = boundedString(entry.result);

    if (
      !controlId ||
      seen.has(controlId) ||
      (result !== "pass" && result !== "fail")
    ) {
      return null;
    }
    seen.add(controlId);
    controls.push({ control_id: controlId, result });
  }
  return controls.sort((left, right) => left.control_id.localeCompare(right.control_id));
}

export function deriveStructuredResultStatusFromDiagnostics(diagnostics) {
  const codes = new Set();
  for (const entry of Array.isArray(diagnostics) ? diagnostics : []) {
    if (!isObject(entry)) continue;
    const code = normalizeStringEntry(entry.code);
    if (code) codes.add(code);
  }
  for (const tier of REVIEW_RESULT_STRUCTURED_STATUS_PRECEDENCE) {
    if (tier.codes.some((code) => codes.has(code))) return tier.status;
  }
  return "invalid";
}

function normalizeCompleteDiagnosticCount(value) {
  const suppliedCount = Array.isArray(value.diagnostics) ? value.diagnostics.length : 0;
  const stated = value.diagnostic_count;
  if (stated === undefined || stated === null) return suppliedCount;
  if (!Number.isInteger(stated) || stated < 0) return null;
  if (stated < suppliedCount) return null;
  return stated;
}

function normalizeStructuredRoleResult(value) {
  if (!isObject(value)) return null;
  if (value.valid !== true) {
    const diagnostics = normalizeDiagnostics(value.diagnostics);
    const diagnosticCount = normalizeCompleteDiagnosticCount(value);
    if (diagnosticCount === null) return null;

    const explicitStatus = boundedStableCode(value.structured_result_status);
    if (value.structured_result_status !== undefined && value.structured_result_status !== null) {
      if (!REVIEW_RESULT_STRUCTURED_MISSING_STATUS_SET.has(explicitStatus)) return null;
    }
    return {
      valid: false,
      diagnostics,
      diagnostic_count: diagnosticCount,
      status: explicitStatus ?? deriveStructuredResultStatusFromDiagnostics(value.diagnostics),
      candidate: normalizeCandidate(value.candidate)
    };
  }

  const legacyResult = value.result;
  if (legacyResult !== undefined && !isObject(legacyResult)) return null;
  const legacyFindings = legacyResult?.findings;
  if (legacyFindings !== undefined && !Array.isArray(legacyFindings)) return null;
  if (!Array.isArray(legacyFindings)) {
    return normalizeNarrowedStructuredRoleResult(value);
  }
  const result = legacyResult;
  const reportedRole = boundedString(result.reported_role);
  const reportedSubject = boundedString(result.reported_subject);
  const reportedOutcome = boundedString(result.reported_outcome);
  const summary = result.summary === null || result.summary === undefined
    ? null
    : boundedString(result.summary, MAX_SUMMARY_LENGTH);
  const findings = normalizeFindings(result.findings);
  const findingCounts = normalizeFindingCounts(result.finding_counts);
  const reviewedControls = normalizeReviewedControls(result.reviewed_controls);

  if (
    !reportedRole ||
    !reportedSubject ||
    !reportedOutcome ||
    !isConsistentReviewerOutcome(reportedOutcome, findings, findingCounts) ||
    (result.summary !== null && result.summary !== undefined && summary === null) ||
    !findings ||
    !findingCounts ||
    !reviewedControls ||
    !countsEqual(findingCounts, recomputeFindingCounts(findings))
  ) {
    return null;
  }

  return {
    valid: true,
    projection: "full",
    result: {
      reported_role: reportedRole,
      reported_subject: reportedSubject,
      reported_outcome: reportedOutcome,
      summary,
      findings,
      finding_counts: findingCounts,
      reviewed_controls: reviewedControls
    },
    candidate: normalizeCandidate(value.candidate)
  };
}

function normalizeNarrowedStructuredRoleResult(value) {
  const claims = isObject(value.claims) ? value.claims : null;
  const result = isObject(value.result) ? value.result : null;
  const reportedRole = boundedString(claims?.reported_role ?? result?.reported_role);
  const reportedSubject = boundedString(claims?.reported_subject ?? result?.reported_subject);
  const reportedOutcome = boundedString(claims?.reported_outcome ?? result?.reported_outcome);
  if (!reportedRole || !reportedSubject || !reportedOutcome) return null;
  if (!REVIEW_RESULT_ROLE_OUTCOME_SET.has(reportedOutcome)) return null;

  const rawCounts = result?.finding_counts ?? value.finding_counts;
  let findingCounts = null;
  if (rawCounts !== undefined && rawCounts !== null) {
    findingCounts = normalizeFindingCounts(rawCounts);
    if (!findingCounts) return null;
    if (!isConsistentNarrowedOutcome(reportedOutcome, findingCounts)) return null;
  }

  const reviewedControlCount = normalizeReviewedControlCount(value, result);
  if (reviewedControlCount === null) return null;

  return {
    valid: true,
    projection: "narrowed",
    result: {
      reported_role: reportedRole,
      reported_subject: reportedSubject,
      reported_outcome: reportedOutcome,
      finding_counts: findingCounts,
      reviewed_control_count: reviewedControlCount
    },
    candidate: normalizeCandidate(value.candidate)
  };
}

function normalizeReviewedControlCount(value, result) {
  const controls = result?.reviewed_controls ?? value.reviewed_controls;
  if (Array.isArray(controls)) return controls.length;
  if (controls !== undefined && controls !== null) return null;
  const count = result?.reviewed_control_count ?? value.reviewed_control_count;
  if (count === undefined || count === null) return undefined;
  if (!Number.isInteger(count) || count < 0) return null;
  return count;
}

function isConsistentNarrowedOutcome(outcome, counts) {
  if (outcome === "no_findings") return counts.total === 0;
  if (outcome === "changes_requested") return counts.total > 0;
  if (outcome === "passed_no_blocking_or_medium_findings") {
    return counts.blocking === 0 && counts.critical === 0 && counts.high === 0 && counts.medium === 0;
  }
  return true;
}

function isConsistentReviewerOutcome(outcome, findings, counts) {
  if (!Array.isArray(findings) || !counts) return false;
  if (outcome === "no_findings") return counts.total === 0 && findings.length === 0;
  if (outcome === "passed_no_blocking_or_medium_findings") {
    return counts.blocking === 0 && counts.critical === 0 && counts.high === 0 && counts.medium === 0;
  }
  if (outcome === "changes_requested") return findings.length > 0;
  return false;
}

function normalizeCandidate(value) {
  if (!isObject(value)) return null;
  const candidate = {};
  const kind = boundedString(value.kind);
  if (kind) candidate.kind = kind;
  if (Number.isInteger(value.payload_bytes) && value.payload_bytes >= 0) {
    candidate.payload_bytes = value.payload_bytes;
  }
  return Object.keys(candidate).length > 0 ? candidate : null;
}

function normalizeDiagnostics(value) {
  if (!Array.isArray(value)) return [];
  const diagnostics = [];
  for (const entry of value.slice(0, MAX_DIAGNOSTICS)) {
    if (!isObject(entry)) continue;
    const code = boundedStableCode(entry.code);
    if (!code) continue;
    const diagnostic = { code };
    const path = boundedString(entry.path, MAX_DIAGNOSTIC_REF_LENGTH);
    if (path) diagnostic.path = path;
    diagnostics.push(diagnostic);
  }
  return diagnostics;
}

function resolveStructuredResultStatus(runRef, structuredRoleResult) {
  if (structuredRoleResult?.valid === false) return structuredRoleResult.status;
  return runRef.structured_result_status ?? null;
}

function deriveNonCompletionClass(runRef, structuredResultStatus, structuredRoleResult) {
  if (structuredRoleResult?.valid === true) {
    return structuredRoleResult.result.reported_outcome === "changes_requested"
      ? "changes_requested"
      : null;
  }
  if (REVIEW_RESULT_RUNTIME_FAILURE_STATUS_SET.has(runRef.terminal_status)) {
    return "runtime_failure";
  }
  if (
    REVIEW_RESULT_TERMINAL_SUCCESS_STATUS_SET.has(runRef.terminal_status) &&
    REVIEW_RESULT_STRUCTURED_MISSING_STATUS_SET.has(structuredResultStatus)
  ) {
    return REVIEW_RESULT_STRUCTURED_STATUS_EVIDENCE_CLASS[structuredResultStatus];
  }
  return null;
}

function validateUnitBinding(unit, reviewUnit, runRef) {
  if (reviewUnit) {
    if (reviewUnit.address === unit.address) return "review_unit must be a separate unit from the selected unit";
    if (runRef.subject_address !== reviewUnit.address) {
      return "review_run subject_address must match the separate review unit";
    }
    return null;
  }
  return runRef.subject_address === unit.address
    ? null
    : "review_run subject_address does not match the selected unit";
}

function reviewResultEvidenceBoundedFacts(evidence) {
  const facts = {
    schema_version: evidence.schema_version,
    authority: evidence.authority,
    evidence_id: evidence.evidence_id,
    evidence_class: evidence.evidence_class,
    repo: evidence.repo,
    unit: evidence.unit,
    source_digest: evidence.source_digest,
    reviewer_role_class: evidence.reviewer_role_class,
    review_run_ref: evidence.review_run_ref,
    recorded_at: evidence.recorded_at,
    effects: evidence.effects
  };
  if (evidence.review_unit) facts.review_unit = evidence.review_unit;
  if (evidence.role_result) facts.role_result = evidence.role_result;
  if (evidence.runtime_result) facts.runtime_result = evidence.runtime_result;
  return facts;
}

export function computeReviewResultEvidenceDigest(evidence) {
  return computeNormalizedInputDigest(reviewResultEvidenceBoundedFacts(evidence));
}

function roleResultDigestFacts(roleResult) {
  const facts = {
    reported_role: roleResult.reported_role,
    reported_subject: roleResult.reported_subject,
    reported_outcome: roleResult.reported_outcome
  };
  if (roleResult.findings !== undefined) facts.findings = roleResult.findings;
  if (roleResult.finding_counts !== undefined) facts.finding_counts = roleResult.finding_counts;
  if (roleResult.reviewed_controls !== undefined) {
    facts.reviewed_controls = roleResult.reviewed_controls;
  }
  if (roleResult.reviewed_control_count !== undefined) {
    facts.reviewed_control_count = roleResult.reviewed_control_count;
  }
  return facts;
}

function buildRoleResultFacts(structuredRoleResult) {
  const result = structuredRoleResult.result;
  const facts = {
    reported_role: result.reported_role,
    reported_subject: result.reported_subject,
    reported_outcome: result.reported_outcome
  };
  if (structuredRoleResult.projection === "full") {
    facts.findings = result.findings;
    facts.finding_counts = result.finding_counts;
    facts.reviewed_controls = result.reviewed_controls;
    if (result.summary) facts.summary = result.summary;
  } else {
    if (result.finding_counts) facts.finding_counts = result.finding_counts;
    if (result.reviewed_control_count !== undefined) {
      facts.reviewed_control_count = result.reviewed_control_count;
    }
  }
  if (structuredRoleResult.candidate) facts.candidate = structuredRoleResult.candidate;

  return { result_digest: computeRoleResultDigest(roleResultDigestFacts(facts)), ...facts };
}

function buildRuntimeResultFacts(
  evidenceClass,
  runRef,
  structuredResultStatus,
  structuredRoleResult
) {
  const facts = { evidence_class: evidenceClass };
  if (structuredResultStatus) facts.structured_result_status = structuredResultStatus;
  if (runRef.runtime_failure_code) facts.runtime_failure_code = runRef.runtime_failure_code;
  if (runRef.diagnostic_ref) facts.diagnostic_ref = runRef.diagnostic_ref;
  if (structuredRoleResult?.valid === false) {
    facts.structured_role_result = {
      valid: false,
      diagnostics: structuredRoleResult.diagnostics,

      diagnostic_count: structuredRoleResult.diagnostic_count,
      candidate: structuredRoleResult.candidate
    };
  }
  return facts;
}

export function buildReviewResultEvidence(input) {
  if (!isObject(input)) return refuse(CODES.malformed, "input is not an object");

  const forbiddenPaths = collectForbiddenAuthorityPaths(input);
  if (forbiddenPaths.length > 0) {
    return refuse(
      CODES.forbiddenAuthorityInput,
      `caller-supplied authority/prose fields are not accepted: ${forbiddenPaths.join(", ")}`
    );
  }

  const evidenceId = boundedString(input.evidence_id);
  const repo = boundedString(input.repo);
  const unit = normalizeUnit(input.unit);
  const reviewUnitSupplied = input.review_unit !== undefined && input.review_unit !== null;
  const reviewUnit = normalizeOptionalReviewUnit(input.review_unit);
  const sourceDigest = normalizeStringEntry(input.source_digest);
  const recordedAt = boundedString(input.recorded_at);
  const runRef = normalizeRunRef(input.review_run);
  const structuredRoleResult = input.structured_role_result === undefined || input.structured_role_result === null
    ? null
    : normalizeStructuredRoleResult(input.structured_role_result);

  if (!evidenceId || !repo || !unit || !runRef || !recordedAt) {
    return refuse(CODES.malformed, "missing required bounded fields");
  }
  if (reviewUnitSupplied && !reviewUnit) {
    return refuse(CODES.malformed, "review_unit, when present, must be a bounded {record_id, address} unit");
  }
  if (!isSha256(sourceDigest)) return refuse(CODES.malformed, "source_digest must be a sha256 digest");
  if (isoTimestampMs(recordedAt) === null) return refuse(CODES.malformed, "recorded_at must be ISO-8601 UTC");
  if (runRef.provenance_kind !== REVIEW_RESULT_TRUSTED_PROVENANCE_KIND) {
    return refuse(CODES.untrustedProvenance, "review_run provenance is not a trusted structured run");
  }
  if (!REVIEW_RESULT_REVIEWER_ROLE_CLASS_SET.has(runRef.role_class)) {
    return refuse(CODES.wrongRole, "review_run role_class must be reviewer or redteam");
  }
  const unitBindingError = validateUnitBinding(unit, reviewUnit, runRef);
  if (unitBindingError) return refuse(CODES.wrongUnit, unitBindingError);
  if (input.structured_role_result !== undefined && input.structured_role_result !== null && !structuredRoleResult) {
    return refuse(CODES.malformed, "structured_role_result is malformed or unbounded");
  }

  const structuredResultStatus = resolveStructuredResultStatus(runRef, structuredRoleResult);
  const evidenceClass = deriveNonCompletionClass(runRef, structuredResultStatus, structuredRoleResult);
  if (!evidenceClass) {
    if (structuredRoleResult?.valid === true) {
      const reportedOutcome = structuredRoleResult.result.reported_outcome;
      if (reportedOutcome === "no_findings" || reportedOutcome === "passed_no_blocking_or_medium_findings") {
        return refuse(CODES.completionOutcome, "clean reviewer/redteam role results belong to review attestation, not review-result evidence");
      }
      if (reportedOutcome === "blocked" || reportedOutcome === "failed") {
        return refuse(CODES.unsupportedOutcome, "reviewer/redteam blocked/failed role-result outcomes are not supported");
      }
      return refuse(CODES.unsupportedOutcome, "structured role-result outcome is not supported for review-result evidence");
    }
    return refuse(CODES.missingStructuredResult, "trusted run metadata does not prove a supported non-completion review-result class");
  }

  if (evidenceClass === "changes_requested") {
    if (!REVIEW_RESULT_TERMINAL_SUCCESS_STATUS_SET.has(runRef.terminal_status)) {
      return refuse(CODES.nonTerminal, "changes_requested evidence requires a terminal-success review run");
    }
    const result = structuredRoleResult.result;
    if (!REVIEW_RESULT_REVIEWER_ROLE_CLASS_SET.has(result.reported_role)) {
      return refuse(CODES.wrongRole, "structured role-result reported_role must be reviewer or redteam");
    }
    if (result.reported_role !== runRef.role_class) {
      return refuse(CODES.wrongRole, "structured role-result reported_role disagrees with trusted run role");
    }
    if (result.reported_subject !== runRef.subject_address) {
      return refuse(CODES.wrongUnit, "structured role-result reported_subject disagrees with trusted run subject");
    }
    if (result.reported_outcome !== "changes_requested") {
      return refuse(CODES.unsupportedOutcome, "only changes_requested is supported as a non-completion role-result outcome");
    }
  }

  const evidence = {
    schema_version: REVIEW_RESULT_EVIDENCE_SCHEMA_VERSION,
    authority: REVIEW_RESULT_EVIDENCE_AUTHORITY,
    evidence_id: evidenceId,
    evidence_digest: null,
    evidence_class: evidenceClass,
    repo,
    unit,
    source_digest: sourceDigest,
    reviewer_role_class: runRef.role_class,
    review_run_ref: runRef,
    recorded_at: recordedAt,
    effects: { ...COORDINATION_ONLY_EFFECTS }
  };
  if (reviewUnit) evidence.review_unit = reviewUnit;
  if (evidenceClass === "changes_requested") {
    evidence.role_result = buildRoleResultFacts(structuredRoleResult);
  } else {
    evidence.runtime_result = buildRuntimeResultFacts(
      evidenceClass,
      runRef,
      structuredResultStatus,
      structuredRoleResult
    );
  }
  evidence.evidence_digest = computeReviewResultEvidenceDigest(evidence);
  return { ok: true, evidence: cloneJson(evidence), ...COORDINATION_ONLY_EFFECTS };
}

function isWellFormedReviewResultEvidence(evidence) {
  if (!isObject(evidence)) return false;
  if (evidence.schema_version !== REVIEW_RESULT_EVIDENCE_SCHEMA_VERSION) return false;
  if (evidence.authority !== REVIEW_RESULT_EVIDENCE_AUTHORITY) return false;
  if (!boundedString(evidence.evidence_id)) return false;
  if (!isSha256(evidence.evidence_digest)) return false;
  if (!REVIEW_RESULT_EVIDENCE_CLASS_SET.has(evidence.evidence_class)) return false;
  if (!boundedString(evidence.repo)) return false;
  if (!normalizeUnit(evidence.unit)) return false;
  if (!isSha256(evidence.source_digest)) return false;
  if (!REVIEW_RESULT_REVIEWER_ROLE_CLASS_SET.has(evidence.reviewer_role_class)) return false;
  if (!normalizeRunRef(evidence.review_run_ref)) return false;
  if (isoTimestampMs(evidence.recorded_at) === null) return false;
  if (!hasCoordinationOnlyEffects(evidence.effects)) return false;
  const reviewUnit = normalizeOptionalReviewUnit(evidence.review_unit);
  if (evidence.review_unit !== undefined && evidence.review_unit !== null && !reviewUnit) return false;
  if (reviewUnit && reviewUnit.address === evidence.unit.address) return false;
  if (evidence.evidence_class === "changes_requested") {
    return isWellFormedChangesRequestedEvidence(evidence);
  }
  return isWellFormedRuntimeEvidence(evidence);
}

function hasCoordinationOnlyEffects(value) {
  if (!isObject(value)) return false;
  return Object.entries(COORDINATION_ONLY_EFFECTS).every(([key, expected]) => value[key] === expected);
}

function isWellFormedChangesRequestedEvidence(evidence) {
  if (!isObject(evidence.role_result) || evidence.runtime_result !== undefined) return false;
  const runRef = normalizeRunRef(evidence.review_run_ref);
  if (!REVIEW_RESULT_TERMINAL_SUCCESS_STATUS_SET.has(runRef.terminal_status)) return false;
  const roleResult = evidence.role_result;
  if (roleResult.reported_role !== evidence.reviewer_role_class) return false;
  if (roleResult.reported_subject !== runRef.subject_address) return false;
  if (roleResult.reported_outcome !== "changes_requested") return false;
  if (!isSha256(roleResult.result_digest)) return false;
  if (computeRoleResultDigest(roleResultDigestFacts(roleResult)) !== roleResult.result_digest) {
    return false;
  }
  const summary = roleResult.summary;
  if (summary !== undefined && summary !== null && !boundedString(summary, MAX_SUMMARY_LENGTH)) {
    return false;
  }

  if (roleResult.findings !== undefined) {
    const findings = normalizeFindings(roleResult.findings);
    const counts = normalizeFindingCounts(roleResult.finding_counts);
    const controls = normalizeReviewedControls(roleResult.reviewed_controls);
    if (!findings || !counts || !controls) return false;
    if (!countsEqual(counts, recomputeFindingCounts(findings))) return false;
    return true;
  }
  if (roleResult.reviewed_controls !== undefined) return false;
  if (roleResult.finding_counts !== undefined && roleResult.finding_counts !== null) {
    const counts = normalizeFindingCounts(roleResult.finding_counts);
    if (!counts || !isConsistentNarrowedOutcome("changes_requested", counts)) return false;
  }
  const reviewedControlCount = roleResult.reviewed_control_count;
  if (
    reviewedControlCount !== undefined &&
    (!Number.isInteger(reviewedControlCount) || reviewedControlCount < 0)
  ) {
    return false;
  }
  return true;
}

function computeRoleResultDigest(digestFacts) {
  return computeNormalizedInputDigest(digestFacts);
}

function isWellFormedRuntimeEvidence(evidence) {
  if (!isObject(evidence.runtime_result) || evidence.role_result !== undefined) return false;
  const runRef = normalizeRunRef(evidence.review_run_ref);
  const runtimeResult = evidence.runtime_result;
  if (runtimeResult.evidence_class !== evidence.evidence_class) return false;
  if (evidence.evidence_class === "runtime_failure") {
    return REVIEW_RESULT_RUNTIME_FAILURE_STATUS_SET.has(runRef.terminal_status);
  }

  const expectedClass = REVIEW_RESULT_STRUCTURED_STATUS_EVIDENCE_CLASS[
    runtimeResult.structured_result_status
  ];
  if (expectedClass !== evidence.evidence_class) return false;
  if (!REVIEW_RESULT_TERMINAL_SUCCESS_STATUS_SET.has(runRef.terminal_status)) return false;
  const structured = runtimeResult.structured_role_result;
  if (structured === undefined) return true;
  if (!isObject(structured) || structured.valid !== false) return false;
  if (!Array.isArray(structured.diagnostics)) return false;
  if (
    !Number.isInteger(structured.diagnostic_count) ||
    structured.diagnostic_count < structured.diagnostics.length
  ) {
    return false;
  }
  return true;
}

export function validateReviewResultEvidence(evidence, expectation = {}) {
  if (evidence === null || evidence === undefined) return deny(CODES.missing, "no review-result evidence supplied");
  if (!isWellFormedReviewResultEvidence(evidence)) {
    return deny(CODES.malformed, "review-result evidence is malformed");
  }
  if (computeReviewResultEvidenceDigest(evidence) !== evidence.evidence_digest) {
    return deny(CODES.digestMismatch, "evidence_digest does not match bounded facts");
  }
  if (!isObject(expectation)) return deny(CODES.missingExpectation, "expectation binding context is required");
  const expectedRepo = boundedString(expectation.repo);
  const expectedUnit = boundedString(expectation.unit_address);
  const expectedDigest = normalizeStringEntry(expectation.source_digest);
  const expectedRole = boundedString(expectation.required_role_class);
  if (!expectedRepo) return deny(CODES.missingExpectation, "expectation.repo is required");
  if (!expectedUnit) return deny(CODES.missingExpectation, "expectation.unit_address is required");
  if (!isSha256(expectedDigest)) return deny(CODES.missingExpectation, "expectation.source_digest must be a sha256 digest");
  if (expectedRole && !REVIEW_RESULT_REVIEWER_ROLE_CLASS_SET.has(expectedRole)) {
    return deny(CODES.wrongRole, "expectation.required_role_class must be reviewer or redteam when supplied");
  }
  if (expectedRepo !== evidence.repo) return deny(CODES.wrongUnit, "repo does not match expectation");
  if (expectedUnit !== evidence.unit.address) return deny(CODES.wrongUnit, "unit address does not match expectation");
  if (expectedDigest !== evidence.source_digest) {
    return deny(CODES.wrongDigest, "source digest does not match the current selected unit");
  }
  if (expectedRole && expectedRole !== evidence.reviewer_role_class) {
    return deny(CODES.wrongRole, "reviewer role class does not match expectation");
  }
  const runRef = normalizeRunRef(evidence.review_run_ref);
  if (runRef.provenance_kind !== REVIEW_RESULT_TRUSTED_PROVENANCE_KIND) {
    return deny(CODES.untrustedProvenance, "review run provenance is not a trusted structured run");
  }
  if (runRef.role_class !== evidence.reviewer_role_class) {
    return deny(CODES.wrongRole, "review run role class does not match evidence reviewer role");
  }
  const reviewUnit = normalizeOptionalReviewUnit(evidence.review_unit);
  const bindingError = validateUnitBinding(evidence.unit, reviewUnit, runRef);
  if (bindingError) return deny(CODES.wrongUnit, bindingError);

  return {
    valid: true,
    decision_code: CODES.valid,
    reasons: [],
    ...COORDINATION_ONLY_EFFECTS
  };
}

export function reviewResultEvidenceAuthorityEffects() {
  return { ...COORDINATION_ONLY_EFFECTS };
}

export function isReviewResultEvidenceCompletionSatisfying() {
  return false;
}

export function projectReviewResultEvidenceForWorkerAdmission() {
  return {
    review_attestations: [],
    accepted_authorities: [],
    ...COORDINATION_ONLY_EFFECTS
  };
}

function isRepoRelativePath(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(value)) return false;
  if (value.includes("\0") || value.startsWith("~")) return false;
  return value.split(/[\\/]/u).every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}
