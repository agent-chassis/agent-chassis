

export const WORK_RECORD_DISPATCH_DECISION_CODES = Object.freeze([
  "dispatchable",
  "dispatchable_with_accepted_escalation",
  "tracker_not_dispatchable",
  "missing_slice",
  "not_implementation",
  "missing_write_scope",
  "invalid_write_scope",
  "stale_write_scope",
  "missing_validation",
  "missing_graph_impact",
  "zero_clusters",
  "multi_cluster",
  "migration_review_required",
  "critical_blast_radius_requires_escalation",
  "critical_blast_radius_escalation_expired",
  "critical_blast_radius_escalation_scope_mismatch",
  "blocked_dependency",
  "unknown_schema_version",
  "invalid_record",
  "unsupported_record_kind",
  "missing_json_record"
]);

const DECISION_PRECEDENCE = Object.freeze([
  "unknown_schema_version",
  "invalid_record",
  "unsupported_record_kind",
  "missing_json_record",
  "migration_review_required",
  "blocked_dependency",
  "invalid_write_scope",
  "stale_write_scope",
  "missing_write_scope",
  "tracker_not_dispatchable",
  "missing_slice",
  "not_implementation",
  "missing_validation",
  "missing_graph_impact",
  "zero_clusters",
  "multi_cluster",
  "critical_blast_radius_escalation_expired",
  "critical_blast_radius_escalation_scope_mismatch",
  "critical_blast_radius_requires_escalation",
  "dispatchable_with_accepted_escalation",
  "dispatchable"
]);

function precedenceIndex(code) {
  const index = DECISION_PRECEDENCE.indexOf(code);
  return index === -1 ? Number.POSITIVE_INFINITY : index;
}

export function chooseDecisionCode(blockers) {
  return [...blockers]
    .sort((left, right) => precedenceIndex(left.code) - precedenceIndex(right.code))
    .at(0)?.code ?? "dispatchable";
}
