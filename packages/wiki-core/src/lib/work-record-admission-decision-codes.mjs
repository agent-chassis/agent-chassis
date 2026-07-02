

import { isNonEmptyString } from "./work-record-admission-shared.mjs";

export const WORK_RECORD_ADMISSION_SCHEMA_VERSION = "worker-admission.v1";
export const WORK_RECORD_ADMISSION_DECISION_SCHEMA_VERSION = "worker-admission-decision.v1";
export const WORK_RECORD_ADMISSION_DECISION_LOCAL_SCHEMA_VERSION =
  "worker-admission-decision-local.v1";
export const WORK_RECORD_ADMISSION_LOCAL_AUTHORITY = "portfolio_local_reference";
export const WORK_RECORD_ADMISSION_LOCAL_POLICY_BACKEND = "portfolio-local";
export const WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_SCHEMA_VERSION =
  "worker-admission-derived-evidence.v1";
export const WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_DECISION_KIND = "work_unit_atomicity";
export const WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_GENERATOR = Object.freeze({
  name: "agent-chassis",
  version: "0.2.0"
});

export const WORK_UNIT_ATOMICITY_METRIC_SOURCE_PROVENANCE_ISSUE_CODES = Object.freeze({
  source_kind_missing: "worker_admission.work_unit_atomicity.metric_source_provenance_source_kind_missing.v1",
  canonicality_missing: "worker_admission.work_unit_atomicity.metric_source_provenance_canonicality_missing.v1",
  evidence_basis_missing: "worker_admission.work_unit_atomicity.metric_source_provenance_evidence_basis_missing.v1",
  policy_backend_missing: "worker_admission.work_unit_atomicity.metric_source_provenance_policy_backend_missing.v1",
  policy_version_missing: "worker_admission.work_unit_atomicity.metric_source_provenance_policy_version_missing.v1"
});

export const WORK_UNIT_ATOMICITY_MISSING_SUPPORTING_EVIDENCE_SPECS = [
  {
    key: "file_stats",
    field_path: "file_stats",
    reason_code: "worker_admission.work_unit_atomicity.file_stats_missing.v1",
    reason: "file_stats evidence is required to replay write-scope LOC and file breadth decisions"
  },
  {
    key: "validation_command_metadata",
    field_path: "validation_command_metadata",
    reason_code: "worker_admission.work_unit_atomicity.validation_command_metadata_missing.v1",
    reason: "validation_command_metadata evidence is required to replay validation command breadth decisions"
  },
  {
    key: "runtime_mode_metadata",
    field_path: "runtime_mode_metadata",
    reason_code: "worker_admission.work_unit_atomicity.runtime_mode_metadata_missing.v1",
    reason: "runtime_mode_metadata evidence is required to replay declared runtime-mode breadth decisions"
  },
  {
    key: "artifact_kind_metadata",
    field_path: "artifact_kind_metadata",
    reason_code: "worker_admission.work_unit_atomicity.artifact_kind_metadata_missing.v1",
    reason: "artifact_kind_metadata evidence is required to replay artifact-kind breadth decisions"
  }
];

export const WORK_UNIT_ATOMICITY_ABSENT_OPTIONAL_EVIDENCE_SPECS = [
  {
    key: "runtime_mode_metadata",
    field_path: "runtime_mode_metadata",
    reason_code: "worker_admission.work_unit_atomicity.runtime_mode_metadata_absent_optional.v1",
    reason: "runtime_mode_metadata is absent; operational v1 treats it as optional when file stats and validation command metadata are present"
  },
  {
    key: "artifact_kind_metadata",
    field_path: "artifact_kind_metadata",
    reason_code: "worker_admission.work_unit_atomicity.artifact_kind_metadata_absent_optional.v1",
    reason: "artifact_kind_metadata is absent; operational v1 treats it as optional when file stats and validation command metadata are present"
  }
];

export const WORK_UNIT_ATOMICITY_FILE_STATS_ISSUE_CODES = Object.freeze({
  invalid_entry: "worker_admission.work_unit_atomicity.file_stats_entry_invalid.v1",
  missing_existing_file: "worker_admission.work_unit_atomicity.file_stats_existing_file_missing.v1",
  missing_is_directory: "worker_admission.work_unit_atomicity.file_stats_is_directory_missing.v1",
  invalid_existing_file: "worker_admission.work_unit_atomicity.file_stats_existing_file_invalid.v1",
  invalid_is_directory: "worker_admission.work_unit_atomicity.file_stats_is_directory_invalid.v1",
  invalid_file_state: "worker_admission.work_unit_atomicity.file_stats_file_state_invalid.v1"
});

export const WORK_UNIT_ATOMICITY_FILE_STATES = new Set(["existing_file", "new_file", "directory"]);

export const WORK_UNIT_ATOMICITY_REVIEW_DECISION_CODES = Object.freeze({
  required_metric_missing: "worker_admission.work_unit_atomicity.required_metric_missing.v1",
  contradictory_metric_evidence: "worker_admission.work_unit_atomicity.contradictory_metric_evidence.v1",
  target_plan_missing: "worker_admission.work_unit_atomicity.target_plan_missing_requires_review.v1",
  backend_identity_contradiction:
    "worker_admission.work_unit_atomicity.backend_identity_contradiction.v1",
  schema_version_unsupported:
    "worker_admission.work_unit_atomicity.schema_version_unsupported.v1"
});

export const WORK_UNIT_ATOMICITY_NODE_ENGINE_THRESHOLD_DECISION_CODES = Object.freeze({
  excessive_breadth: "worker_admission.work_unit_atomicity.excessive_breadth.v1",
  large_file_requires_review: "worker_admission.work_unit_atomicity.large_file_requires_review.v1",
  write_scope_count: "worker_admission.work_unit_atomicity.write_scope_count_denied.v1",
  write_scope_total_loc: "worker_admission.work_unit_atomicity.write_scope_total_loc_denied.v1",
  max_write_file_loc: "worker_admission.work_unit_atomicity.max_write_file_loc_denied.v1",
  acceptance_criteria_count: "worker_admission.work_unit_atomicity.acceptance_criteria_count_denied.v1",
  large_file_pressure_annotated:
    "worker_admission.work_unit_atomicity.large_file_pressure_annotated.v1"
});

export const WORK_UNIT_ATOMICITY_DENY_DECISION_CODES = Object.freeze({});
export const WORK_UNIT_ATOMICITY_ADVISORY_DECISION_CODES = Object.freeze({});

export const WORK_RECORD_ADMISSION_DECISION_VALUES = Object.freeze([
  "allow",
  "deny",
  "review_required"
]);

export const WORK_RECORD_ADMISSION_DECISION_CODES = Object.freeze([
  "admission_allowed",
  "dispatch_readiness_denied",
  "atomicity_multi_cluster_denied",
  "atomicity_downstream_fanout_requires_review",
  "atomicity_critical_surface_requires_escalation",
  "atomicity_graph_unavailable_requires_review",
  "atomicity_write_scope_overlap_requires_review",
  WORK_UNIT_ATOMICITY_REVIEW_DECISION_CODES.required_metric_missing,
  WORK_UNIT_ATOMICITY_REVIEW_DECISION_CODES.contradictory_metric_evidence,
  WORK_UNIT_ATOMICITY_REVIEW_DECISION_CODES.target_plan_missing,
  WORK_UNIT_ATOMICITY_REVIEW_DECISION_CODES.backend_identity_contradiction,
  WORK_UNIT_ATOMICITY_REVIEW_DECISION_CODES.schema_version_unsupported,
  "node_engine_allowed",
  "node_engine_denied",
  "node_engine_review_required",
  "node_engine_unrecognized_decision_code",
  "node_engine_autoapproved_missing_api_key",
  "node_engine_autoapproved_invalid_api_key",
  "node_engine_unavailable_fail_open",
  "profile_policy_denied",
  "operator_policy_requires_review"
]);

export function sortAdmissionCodes(codes) {
  const precedence = [
    "dispatch_readiness_denied",
    "atomicity_multi_cluster_denied",
    "atomicity_critical_surface_requires_escalation",
    "atomicity_graph_unavailable_requires_review",
    "atomicity_write_scope_overlap_requires_review",
    "atomicity_downstream_fanout_requires_review",
    WORK_UNIT_ATOMICITY_REVIEW_DECISION_CODES.contradictory_metric_evidence,
    WORK_UNIT_ATOMICITY_REVIEW_DECISION_CODES.backend_identity_contradiction,
    WORK_UNIT_ATOMICITY_REVIEW_DECISION_CODES.schema_version_unsupported,
    WORK_UNIT_ATOMICITY_REVIEW_DECISION_CODES.required_metric_missing,
    WORK_UNIT_ATOMICITY_REVIEW_DECISION_CODES.target_plan_missing,
    "node_engine_denied",
    "node_engine_review_required",
    "node_engine_autoapproved_missing_api_key",
    "node_engine_autoapproved_invalid_api_key",
    "node_engine_allowed",
    "node_engine_unavailable_fail_open",
    "profile_policy_denied",
    "operator_policy_requires_review",
    "admission_allowed"
  ];

  return [...new Set(codes.filter(isNonEmptyString))]
    .sort((left, right) => {
      const leftIndex = precedence.indexOf(left);
      const rightIndex = precedence.indexOf(right);
      return (
        (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) -
        (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex) ||
        left.localeCompare(right)
      );
    });
}
