

import { STDIO_MCP_CLEANUP_BLOCKER_REASON } from "./stdio-mcp-conduit-contract.mjs";

export const REVIEW_VERDICT_ELIGIBILITY = Object.freeze({

  SUCCEEDED: "succeeded",

  CLEANUP_ONLY: "cleanup_only_terminal_failure"
});

function hasValidatedStructuredVerdict(record, structuredRoleResult = null) {
  const evidence = structuredRoleResult ?? record?.final_result?.structured_role_result;
  return !!evidence && typeof evidence === "object" && !Array.isArray(evidence) &&
    evidence.valid === true &&
    evidence.claims?.reported_role === record.role &&
    evidence.claims?.reported_subject === record.subject;
}

export function isCleanupOnlyReviewerVerdict(record, structuredRoleResult = null) {
  if (!record || typeof record !== "object") return false;

  if (record.role !== "reviewer") return false;
  if (record.terminal !== true || record.status !== "failed") return false;

  const failure = record.launcher_conduit_terminal_failure;
  if (!failure || typeof failure !== "object" || Array.isArray(failure)) return false;
  if (failure.cleanup_only !== true) return false;

  if (failure.reason !== STDIO_MCP_CLEANUP_BLOCKER_REASON) return false;

  const exit = record.exit;
  if (!exit || typeof exit !== "object" || Array.isArray(exit)) return false;
  if (exit.code !== 0) return false;
  if (exit.signal !== null && exit.signal !== undefined) return false;
  return hasValidatedStructuredVerdict(record, structuredRoleResult);
}

export function classifyReviewVerdictEligibility(record) {
  if (!record || typeof record !== "object") return null;
  if (record.role !== "reviewer" && record.role !== "redteam") return null;
  if (record.terminal !== true) return null;
  if (record.status === "succeeded") return REVIEW_VERDICT_ELIGIBILITY.SUCCEEDED;
  return isCleanupOnlyReviewerVerdict(record)
    ? REVIEW_VERDICT_ELIGIBILITY.CLEANUP_ONLY
    : null;
}

function deriveTrustedReviewedControls(structuredRoleResult) {
  const controls = structuredRoleResult?.reviewed_controls;
  if (!Array.isArray(controls)) return [];
  const seen = new Set();
  for (const entry of controls) {
    if (!entry || typeof entry !== "object") continue;
    const controlId = entry.control_id;
    if (typeof controlId !== "string" || controlId.trim().length === 0) continue;

    if (entry.result !== "pass") continue;
    seen.add(controlId);
  }
  return [...seen].sort((left, right) => left.localeCompare(right));
}

const TRUSTED_FINDING_COUNT_FIELDS = Object.freeze([
  "total", "blocking", "critical", "high", "medium", "low", "info"
]);
const TRUSTED_REVIEWED_CONTROL_RESULTS = new Set(["pass", "fail"]);

function deriveTrustedReviewedControlResults(structuredRoleResult) {
  const controls = structuredRoleResult?.reviewed_controls;
  if (!Array.isArray(controls)) return null;
  const seen = new Set();
  const projected = [];
  for (const entry of controls) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
        Object.keys(entry).sort().join("|") !== "control_id|result" ||
        typeof entry.control_id !== "string" || entry.control_id.trim().length === 0 ||
        entry.control_id !== entry.control_id.trim() ||
        !TRUSTED_REVIEWED_CONTROL_RESULTS.has(entry.result) || seen.has(entry.control_id)) {
      return null;
    }
    seen.add(entry.control_id);
    projected.push(Object.freeze({ control_id: entry.control_id, result: entry.result }));
  }
  projected.sort((left, right) => left.control_id.localeCompare(right.control_id));
  return Object.freeze(projected);
}

function hasBlockingReviewedControlResult(structuredRoleResult) {
  const controls = structuredRoleResult?.reviewed_controls;
  if (!Array.isArray(controls)) return false;
  for (const entry of controls) {
    if (!entry || typeof entry !== "object") continue;
    if (typeof entry.control_id !== "string" || entry.control_id.trim().length === 0) continue;
    if (entry.result !== "pass") return true;
  }
  return false;
}

export function deriveBackendReviewResult(record) {
  if (!record || typeof record !== "object") return null;
  if (record.role !== "reviewer" && record.role !== "redteam") return null;

  const verdictEligibility = classifyReviewVerdictEligibility(record);
  if (verdictEligibility === null) return null;
  const finalResult = record.final_result;
  if (!finalResult || typeof finalResult !== "object") return null;
  const structuredRoleResult = finalResult.structured_role_result;
  if (!structuredRoleResult || typeof structuredRoleResult !== "object") return null;
  if (structuredRoleResult.valid !== true) return null;
  const claims = structuredRoleResult.claims;
  if (!claims || claims.reported_role !== record.role || claims.reported_subject !== record.subject) {
    return null;
  }
  const counts = structuredRoleResult.finding_counts;
  if (!counts || typeof counts !== "object") return null;
  if (TRUSTED_FINDING_COUNT_FIELDS.some((field) =>
    !Number.isInteger(counts[field]) || counts[field] < 0
  )) return null;
  const hasCleanCounts =
    counts.blocking === 0 &&
    counts.critical === 0 &&
    counts.high === 0 &&
    counts.medium === 0;
  const outcome = claims.reported_outcome;
  if (outcome === "no_findings" && counts.total !== 0) return null;
  if (
    outcome === "passed_no_blocking_or_medium_findings" &&
    !(Number.isInteger(counts.low) && Number.isInteger(counts.info))
  ) {
    return null;
  }
  if (!new Set([
    "no_findings", "passed_no_blocking_or_medium_findings", "changes_requested"
  ]).has(outcome)) {
    return null;
  }

  const reviewedControlResults = deriveTrustedReviewedControlResults(structuredRoleResult);
  if (reviewedControlResults === null) return null;

  const cleanReview = hasCleanCounts &&
    (outcome === "no_findings" || outcome === "passed_no_blocking_or_medium_findings") &&
    !hasBlockingReviewedControlResult(structuredRoleResult);

  return Object.freeze({
    review_outcome: outcome,
    clean_review: cleanReview,
    no_findings: outcome === "no_findings",
    blocking_finding_count: counts.blocking,
    medium_finding_count: counts.medium,

    reviewed_controls: Object.freeze(deriveTrustedReviewedControls(structuredRoleResult)),
    reviewed_control_results: reviewedControlResults,
    finding_counts: Object.freeze(Object.fromEntries(
      TRUSTED_FINDING_COUNT_FIELDS.map((field) => [field, counts[field]])
    )),
    verdict_eligibility: verdictEligibility
  });
}
