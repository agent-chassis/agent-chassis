import {
  AGENT_ROLE_RESULT_COUNT_FIELDS,
  parseAgentRoleResult
} from "@agent-chassis/agent-launch-core/src/lib/agent-role-result.mjs";
import {
  classifyReviewVerdictEligibility,
  deriveBackendReviewResult
} from "./workspace-agent-dispatch-review-result.mjs";
import { deepFreezeCanonicalSnapshot } from "./backend-scope-authority.mjs";
import { isPlainObject } from "./backend-review-identity.mjs";
import { WORKSPACE_AGENT_RESULT_MODES } from
  "./workspace-agent-dispatch-result-mode.mjs";

export function structuredReviewOutcome(record) {
  if (record?.final_result?.result_mode?.mode !==
      WORKSPACE_AGENT_RESULT_MODES.STRUCTURED_RESULT) return null;
  const evidence = record?.final_result?.structured_role_result;
  if (evidence?.valid !== true || evidence?.claims?.reported_role !== record.role ||
      !new Set(["reviewer", "redteam"]).has(record.role) ||
      evidence?.claims?.reported_subject !== record.subject ||
      classifyReviewVerdictEligibility(record) === null) return null;

  const clean = deriveBackendReviewResult(record);
  if (clean?.clean_review === true) {
    return Object.freeze({
      outcome: "clean",
      clean_review: true,
      review_result: deepFreezeCanonicalSnapshot({
        review_outcome: clean.review_outcome,
        clean_review: true,
        no_findings: clean.no_findings,
        blocking_finding_count: clean.blocking_finding_count,
        medium_finding_count: clean.medium_finding_count,
        reviewed_controls: clean.reviewed_controls
      })
    });
  }
  if (evidence.claims.reported_outcome !== "changes_requested") return null;
  const parsed = parseAgentRoleResult(record?.final_result?.full_response?.text);
  if (parsed?.valid !== true || !isPlainObject(parsed.result)) return null;
  const result = parsed.result;
  if (result.reported_role !== record.role || result.reported_subject !== record.subject ||
      result.reported_outcome !== "changes_requested" ||
      !Array.isArray(result.findings) || result.findings.length === 0) return null;
  const counts = result.recomputed_finding_counts;
  const projected = evidence.finding_counts;
  if (!isPlainObject(counts) || !isPlainObject(projected) ||
      counts.total !== result.findings.length) return null;
  for (const field of AGENT_ROLE_RESULT_COUNT_FIELDS) {
    if (!Number.isInteger(counts[field]) || counts[field] !== projected[field]) return null;
  }
  return Object.freeze({
    outcome: "changes_requested",
    clean_review: false,
    findings: deepFreezeCanonicalSnapshot(result.findings),
    finding_counts: deepFreezeCanonicalSnapshot(counts)
  });
}
