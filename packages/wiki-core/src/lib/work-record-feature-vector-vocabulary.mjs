

const WORK_UNIT_FEATURE_VECTOR_SCHEMA_VERSION = "work-unit-feature-vector.v1";
const WORK_UNIT_FEATURE_VECTOR_VOCABULARY_VERSION = "wk-ontology.v1";

const WORK_UNIT_ACTIVITY_KIND_VALUES = Object.freeze(
  [
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
  ].sort()
);

const WORK_UNIT_ARTIFACT_KIND_VALUES = Object.freeze(
  [
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
  ].sort()
);

const WORK_UNIT_OPERATION_VALUES = Object.freeze(["create", "modify", "delete", "inspect"]);

const WORK_UNIT_GRANULARITY_VALUES = Object.freeze(
  ["file", "module", "function", "method", "class", "export", "test_case", "schema_field", "docs_section", "config_key", "record"].sort()
);

const WORK_UNIT_SCENARIO_KIND_VALUES = Object.freeze(
  [
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
  ].sort()
);

const WORK_UNIT_VERIFICATION_METHOD_VALUES = Object.freeze(
  ["inspection", "analysis", "demonstration", "test_execution", "audit", "proof"].sort()
);

const WORK_UNIT_DEGRADATION_EFFECT_VALUES = Object.freeze([
  "annotates_only",
  "requires_review",
  "denies",
  "blocks_vector_construction"
]);

const WORK_UNIT_PROVENANCE_VALUES = Object.freeze(
  [
    "authored_record",
    "derived_normalizer",
    "derived_code_graph",
    "derived_diff",
    "derived_policy_pack",
    "unavailable",
    "not_applicable"
  ].sort()
);

export {
  WORK_UNIT_FEATURE_VECTOR_SCHEMA_VERSION,
  WORK_UNIT_FEATURE_VECTOR_VOCABULARY_VERSION,
  WORK_UNIT_ACTIVITY_KIND_VALUES,
  WORK_UNIT_ARTIFACT_KIND_VALUES,
  WORK_UNIT_OPERATION_VALUES,
  WORK_UNIT_GRANULARITY_VALUES,
  WORK_UNIT_SCENARIO_KIND_VALUES,
  WORK_UNIT_VERIFICATION_METHOD_VALUES,
  WORK_UNIT_DEGRADATION_EFFECT_VALUES,
  WORK_UNIT_PROVENANCE_VALUES
};
