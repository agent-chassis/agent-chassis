

import { STDIO_MCP_CLEANUP_BLOCKER_REASON } from "./stdio-mcp-conduit-contract.mjs";

export const REVIEW_VERDICT_ELIGIBILITY = Object.freeze({

  SUCCEEDED: "succeeded",

  CLEANUP_ONLY: "cleanup_only_terminal_failure"
});

function hasValidatedStructuredVerdict(record) {
  const evidence = record?.final_result?.structured_role_result;
  return !!evidence && typeof evidence === "object" && !Array.isArray(evidence) &&
    evidence.valid === true &&
    evidence.claims?.reported_role === record.role &&
    evidence.claims?.reported_subject === record.subject;
}

export function isCleanupOnlyReviewerVerdict(record) {
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
  return hasValidatedStructuredVerdict(record);
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

  if (classifyReviewVerdictEligibility(record) === null) return null;
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
  const hasCleanCounts =
    Number.isInteger(counts.total) &&
    Number.isInteger(counts.blocking) &&
    Number.isInteger(counts.critical) &&
    Number.isInteger(counts.high) &&
    Number.isInteger(counts.medium) &&
    counts.blocking === 0 &&
    counts.critical === 0 &&
    counts.high === 0 &&
    counts.medium === 0;
  if (!hasCleanCounts) return null;
  const outcome = claims.reported_outcome;
  if (outcome === "no_findings" && counts.total !== 0) return null;
  if (
    outcome === "passed_no_blocking_or_medium_findings" &&
    !(Number.isInteger(counts.low) && Number.isInteger(counts.info))
  ) {
    return null;
  }
  if (outcome !== "no_findings" && outcome !== "passed_no_blocking_or_medium_findings") {
    return null;
  }

  if (hasBlockingReviewedControlResult(structuredRoleResult)) return null;

  return Object.freeze({
    review_outcome: outcome,
    clean_review: true,
    no_findings: outcome === "no_findings",
    blocking_finding_count: counts.blocking,
    medium_finding_count: counts.medium,

    reviewed_controls: Object.freeze(deriveTrustedReviewedControls(structuredRoleResult))
  });
}
