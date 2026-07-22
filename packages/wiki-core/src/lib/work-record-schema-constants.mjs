

export const WORK_RECORD_SCHEMA_VERSION = "work-record.v1";
export const WORK_RECORD_CLOSURE_FIELD_NAMES = Object.freeze([
  "summary",
  "validation",
  "follow_ups"
]);
export const WORK_RECORD_RENDER_SCHEMA_VERSION = "work-record-render.v1";
export const WORK_RECORD_PROJECTION_AUTHORITY = "generated_projection";
export const WORK_RECORD_DERIVED_EVIDENCE_SCHEMA_VERSION = "worker-admission-derived-evidence.v1";
export const WORK_UNIT_FEATURE_VECTOR_SCHEMA_VERSION = "work-unit-feature-vector.v1";
export const WORK_UNIT_ONTOLOGY_SCHEMA_VERSION = "wk-ontology.v1";
export const WORK_RECORD_DERIVED_EVIDENCE_DECISION_KIND_VALUES = Object.freeze([
  "work_unit_atomicity"
]);
export const WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_REQUIRED_METRIC_FIELD_SPECS = Object.freeze([
  { field: "write_scope_count", kind: "integer" },
  { field: "write_scope_existing_file_count", kind: "integer" },
  { field: "write_scope_directory_count", kind: "integer" },
  { field: "write_scope_total_loc", kind: "integer" },
  { field: "max_write_file_loc", kind: "integer" },
  { field: "acceptance_criteria_count", kind: "integer" },
  { field: "validation_command_count", kind: "integer" },
  { field: "declared_runtime_mode_count", kind: "integer" },
  { field: "artifact_kind_count", kind: "integer" },
  { field: "expected_changed_line_budget", kind: "integer" },
  { field: "unknown_metric_count", kind: "integer" },
  { field: "missing_metrics", kind: "object" },
  { field: "missing_evidence", kind: "object" },
  { field: "missing_supporting_evidence", kind: "object" },
  { field: "evidence_issues", kind: "object" }
]);

export const WORK_RECORD_RECORD_KIND_VALUES = Object.freeze([
  "work_item",
  "initiative",
  "decision",
  "source",
  "area"
]);

export const WORK_RECORD_WORK_KIND_VALUES = Object.freeze([
  "tracker",
  "design",
  "implementation",
  "review",
  "redteam",
  "decision",
  "migration"
]);

export const WORK_RECORD_REVIEW_PURPOSE_VALUES = Object.freeze([
  "standalone",
  "terminal_whole_wk"
]);

export const WORK_RECORD_STATUS_VALUES = Object.freeze([
  "inbox",
  "todo",
  "active",
  "review",
  "done",
  "blocked",
  "parked",
  "cancelled"
]);

export const WORK_RECORD_TARGET_UNIT_VALUES = Object.freeze(["none", "record", "slice"]);

export const WORK_RECORD_AGENT_ROLE_VALUES = Object.freeze([
  "worker",
  "reviewer",
  "redteam",
  "decision_worker",
  "orchestrator",
  null
]);

export const WORK_RECORD_ESCALATION_KIND_VALUES = Object.freeze(["critical_blast_radius"]);
export const WORK_RECORD_ESCALATION_STATUS_VALUES = Object.freeze([
  "proposed",
  "accepted",
  "rejected",
  "expired",
  "superseded"
]);

export const WORK_RECORD_PROJECTION_KIND_VALUES = Object.freeze([
  "markdown",
  "agent_brief",
  "catalog_summary"
]);

export const WORK_UNIT_FEATURE_VECTOR_ACTIVITY_KIND_VALUES = Object.freeze([
  "requirements_analysis",
  "design_contract",
  "implementation_new",
  "implementation_modify",
  "implementation_remove",
  "verification_test_authoring",
  "verification_test_modification",
  "validation_runtime_check",
  "documentation",
  "migration_contract",
  "coordination_record",
  "configuration"
]);

export const WORK_UNIT_FEATURE_VECTOR_ARTIFACT_KIND_VALUES = Object.freeze([
  "production_code_module",
  "production_code_export",
  "unit_test",
  "integration_test",
  "operational_test",
  "property_test",
  "regression_test",
  "fixture_corpus",
  "cli_entrypoint",
  "launcher_wrapper",
  "mcp_tool_surface",
  "schema_contract",
  "policy_rule",
  "protocol_doc",
  "reference_doc",
  "wiki_record_canonical",
  "wiki_projection_generated",
  "build_or_config"
]);

export const WORK_UNIT_FEATURE_VECTOR_OPERATION_VALUES = Object.freeze([
  "create",
  "modify",
  "delete",
  "inspect"
]);

export const WORK_UNIT_FEATURE_VECTOR_GRANULARITY_VALUES = Object.freeze([
  "file",
  "module",
  "function",
  "method",
  "class",
  "export",
  "test_case",
  "schema_field",
  "docs_section",
  "config_key",
  "record"
]);

export const WORK_UNIT_FEATURE_VECTOR_VERIFICATION_METHOD_VALUES = Object.freeze([
  "inspection",
  "analysis",
  "demonstration",
  "test_execution",
  "audit",
  "proof"
]);

export const WORK_UNIT_FEATURE_VECTOR_SCENARIO_KIND_VALUES = Object.freeze([
  "success_case",
  "refusal_case",
  "failure_recovery_case",
  "launch_mode_variant",
  "runtime_env_var_contract",
  "process_boundary_crossing",
  "external_tool_stub",
  "artifact_contract",
  "stateful_runtime_object",
  "fixture_surface_variant"
]);

export const WORK_UNIT_FEATURE_VECTOR_RUNTIME_MODE_VALUES = Object.freeze([
  "local",
  "advisory",
  "enforced"
]);

export const WORK_UNIT_FACET_PROVENANCE_VALUES = Object.freeze([
  "authored_record",
  "derived_normalizer",
  "derived_code_graph",
  "derived_diff",
  "derived_policy_pack",
  "unavailable",
  "not_applicable"
]);

export const WORK_RECORD_MIGRATION_REVIEW_STATE_VALUES = Object.freeze([
  "review_pending",
  "reviewed"
]);

export const WORK_REPORT_SCHEMA_VERSION = "work-report.v1";
export const WORK_REPORT_STATUS_VALUES = Object.freeze([
  "completed",
  "blocked",
  "failed",
  "partial"
]);
export const WORK_REPORT_VALIDATION_STATUS_VALUES = Object.freeze([
  "passed",
  "failed",
  "skipped",
  "not_run"
]);

export const WORK_RECORD_ESCALATION_PROVENANCE_SOURCE_KIND_VALUES = Object.freeze([
  "canonical_docs",
  "canonical_wiki",
  "issue",
  "decision",
  "area",
  "code_index",
  "git_history",
  "parser_symbol",
  "test_adjacency"
]);

export const WORK_RECORD_ESCALATION_PROVENANCE_CANONICALITY_VALUES = Object.freeze([
  "canonical",
  "derived",
  "generated",
  "external",
  "unknown"
]);

export const WORK_RECORD_ESCALATION_PROVENANCE_EVIDENCE_BASIS_VALUES = Object.freeze([
  "explicit_metadata",
  "path_match",
  "docs_backlink",
  "git_blob",
  "git_tree",
  "cochange",
  "lexical_match",
  "parser_extract",
  "inferred_test_adjacency",
  "unknown"
]);

export const WORK_RECORD_DIAGNOSTIC_CODES = Object.freeze([
  "unknown_schema_version",
  "invalid_json",
  "invalid_record",
  "unsupported_record_kind",
  "path_id_mismatch",
  "duplicate_record_id",
  "missing_json_record",
  "stale_projection"
]);

const REQUIRED_TOP_LEVEL_FIELDS = Object.freeze([
  "schema_version",
  "id",
  "repo",
  "title",
  "record_kind",
  "work_kind",
  "status",
  "priority",
  "owner",
  "created",
  "updated",
  "repo_paths",
  "write_scope",
  "depends_on",
  "blocks",
  "related",
  "dispatch_intent",
  "acceptance",
  "sections",
  "children",
  "slices",
  "escalations",
  "projections"
]);

const REQUIRED_STRING_TOP_LEVEL_FIELDS = Object.freeze([
  "id",
  "repo",
  "title",
  "priority",
  "owner",
  "created",
  "updated"
]);

const OPTIONAL_STRING_TOP_LEVEL_FIELDS = Object.freeze([
  "initiative",
  "area",
  "resolution",
  "severity",
  "target",
  "started",
  "completed"
]);

const REQUIRED_ARRAY_OF_STRING_TOP_LEVEL_FIELDS = Object.freeze([
  "repo_paths",
  "write_scope",
  "depends_on",
  "blocks",
  "related"
]);

const OPTIONAL_ARRAY_OF_STRING_TOP_LEVEL_FIELDS = Object.freeze([
  "tags"
]);

const OPTIONAL_NON_NEGATIVE_INTEGER_TOP_LEVEL_FIELDS = Object.freeze([
  "expected_changed_line_budget"
]);

const OBJECT_TOP_LEVEL_FIELDS = Object.freeze([
  "dispatch_intent",
  "acceptance",
  "sections",
  "migration"
]);

const SLICE_ID_PATTERN = /^(?:SLICE-[0-9]{3}|[a-z0-9][a-z0-9-]*)$/;
const ESCALATION_ID_PATTERN = /^ESC-[0-9]{4}$/;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

export {
  REQUIRED_TOP_LEVEL_FIELDS,
  REQUIRED_STRING_TOP_LEVEL_FIELDS,
  OPTIONAL_STRING_TOP_LEVEL_FIELDS,
  REQUIRED_ARRAY_OF_STRING_TOP_LEVEL_FIELDS,
  OPTIONAL_ARRAY_OF_STRING_TOP_LEVEL_FIELDS,
  OPTIONAL_NON_NEGATIVE_INTEGER_TOP_LEVEL_FIELDS,
  OBJECT_TOP_LEVEL_FIELDS,
  SLICE_ID_PATTERN,
  ESCALATION_ID_PATTERN,
  SHA256_PATTERN
};
