

import { AGENT_ROLE_RESULT_REVIEWED_CONTROLS } from "@agent-chassis/agent-launch-core/src/lib/agent-role-result.mjs";

function deriveTrustedReviewedControls(structuredRoleResult) {
  const controls = structuredRoleResult?.reviewed_controls;
  if (!Array.isArray(controls)) return [];
  const seen = new Set();
  for (const entry of controls) {
    if (!entry || typeof entry !== "object") continue;
    const controlId = entry.control_id;
    if (!AGENT_ROLE_RESULT_REVIEWED_CONTROLS.includes(controlId)) continue;

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
    if (!AGENT_ROLE_RESULT_REVIEWED_CONTROLS.includes(entry.control_id)) continue;
    if (entry.result !== "pass") return true;
  }
  return false;
}

export function deriveBackendReviewResult(record) {
  if (!record || typeof record !== "object") return null;
  if (record.role !== "reviewer" && record.role !== "redteam") return null;
  if (record.terminal !== true || record.status !== "succeeded") return null;
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
