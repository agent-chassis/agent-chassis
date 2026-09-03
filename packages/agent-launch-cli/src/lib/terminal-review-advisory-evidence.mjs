const TERMINAL_REVIEW_ADVISORY_EVIDENCE_SCHEMA_VERSION =
  "workspace-agent-terminal-review-advisory-evidence.v1";

const ADVISORY_ONLY_AUTHORITY = "advisory_only";
const RESTART_RECOVERY_OBSERVATION =
  "review_history_not_required_for_restart_recovery";

function freezeRetainedReview({
  record,
  provenanceValid,
  structuredOutcome,
  reviewResult
}) {
  return Object.freeze({
    run_id: record.run_id,
    monitor_handle: record.monitor_handle ?? null,
    role: record.role ?? "reviewer",
    terminal: record.terminal === true,
    status: record.status ?? null,
    provenance_valid: provenanceValid,
    outcome: structuredOutcome?.outcome ?? null,
    review_result: structuredOutcome === null ? null : reviewResult
  });
}

export function createLiveTerminalReviewAdvisoryEvidence({
  candidateSha,
  baseSha,
  wkSha,
  retainedReviews
}) {
  const reviews = Object.freeze(retainedReviews.map(freezeRetainedReview));
  return Object.freeze({
    schema_version: TERMINAL_REVIEW_ADVISORY_EVIDENCE_SCHEMA_VERSION,
    authority: ADVISORY_ONLY_AUTHORITY,
    candidate_sha: candidateSha,
    base_sha: baseSha,
    wk_sha: wkSha,
    reviews
  });
}

export function createRestartTerminalReviewAdvisoryEvidence({
  candidateSha,
  baseSha,
  wkSha
}) {
  return Object.freeze({
    schema_version: TERMINAL_REVIEW_ADVISORY_EVIDENCE_SCHEMA_VERSION,
    authority: ADVISORY_ONLY_AUTHORITY,
    candidate_sha: candidateSha,
    base_sha: baseSha,
    wk_sha: wkSha,
    reviews: Object.freeze([]),
    observation: RESTART_RECOVERY_OBSERVATION
  });
}
