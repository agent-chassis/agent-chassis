export type IntegrationTestDesignAssessmentAxis =
  | "registered_routes" | "selector_partitions"
  | "authority_producer_consumer_edges" | "role_tool_profiles"
  | "failure_phases" | "result_schema_population"
  | "persistent_refs_and_state" | "concurrency_and_interleavings"
  | "declared_mutants" | "prohibited_stubs";

export type IntegrationTestDesignAssessmentState =
  | "pass" | "fail" | "incomplete" | "unevaluable" | "review_only";

export interface IntegrationTestDesignAssessmentSubject {
  readonly repository_id: string;
  readonly wk_id: string;
  readonly selected_unit_address: string;
  readonly work_record_digest: `sha256:${string}`;
  readonly contract_generation_id: string;
  readonly contract_manifest_digest: `sha256:${string}`;
  readonly contract_digest: `sha256:${string}`;
  readonly proof_plan_generation_id: string;
  readonly proof_plan_digest: `sha256:${string}`;
  readonly selected_pack_digest: `sha256:${string}`;
  readonly obligation_source_digest: `sha256:${string}`;
  readonly obligation_source_current: boolean;
  readonly acceptance_coverage_digest: `sha256:${string}`;
  readonly acceptance_coverage_current: boolean;
}

export interface IntegrationTestDesignPopulationRef {
  readonly census_id: string;
  readonly member_id: string;
}

export interface IntegrationTestDesignResolvedInput {
  readonly schema_version: "integration-test-design-assessment-input.experimental.v0.1";
  readonly subject: IntegrationTestDesignAssessmentSubject;
  readonly declaration_completeness: Readonly<{
    requirement_obligation_bindings: "complete" | "unavailable";
    integration_scenario_bindings: "complete" | "partial";
    axis_applicability: "complete" | "partial";
  }>;
  readonly axis_applicability: readonly Readonly<{
    axis: IntegrationTestDesignAssessmentAxis;
    status: "required" | "not_applicable" | "review_only" | "unevaluable" | "undetermined";
    census_id?: string;
    rationale: string;
  }>[];
  readonly requirements: readonly Readonly<{
    requirement_id: string; source_pointer: string;
    text_digest: `sha256:${string}`; text?: string;
  }>[];
  readonly population_censuses: readonly Readonly<{
    census_id: string; axis: IntegrationTestDesignAssessmentAxis;
    source_kind: "server_derived" | "repository_registry_derived"
      | "schema_derived" | "canonical_closed_set"
      | "contract_declared_open" | "test_authored";
    provider_id: string; owner_id: string; generation_id: string;
    content_digest: `sha256:${string}`; member_count: number;
    completeness: "complete" | "partial" | "unsupported" | "ambiguous";
    omissions: readonly string[];
    currentness: "current" | "stale" | "non_current" | "unsupported";
    members: readonly Readonly<{
      member_id: string; source_test_proof_id?: string;
      required_before?: "absent" | "present" | "any";
    }>[];
  }>[];
  readonly obligations: readonly Readonly<{
    obligation_id: string; source_requirement_ids: readonly string[];
    verification_claim_ids: readonly string[];
    proof_rigor: "standard" | "critical_semantic" | "unspecified";
    integration_required: boolean | null;
    required_population_members: readonly IntegrationTestDesignPopulationRef[];
  }>[];
  readonly declared_integration_tests: readonly Readonly<{
    test_id: string; repository_path: string; classification_source?: string;
  }>[];
  readonly integration_scenarios: readonly Readonly<Record<string, unknown>>[];
  readonly interaction_requirements: readonly Readonly<Record<string, unknown>>[];
  readonly review_questions: readonly Readonly<Record<string, unknown>>[];
}

export interface IntegrationTestDesignAssessmentDiagnostic {
  readonly code: string;
  readonly state: Exclude<IntegrationTestDesignAssessmentState, "pass">;
  readonly finding_kind:
    | "omission" | "contradiction" | "absence" | "unsupported" | "semantic_residue";
  readonly message: string;
  readonly subject: Readonly<{ kind: string; id: string }> | null;
  readonly axis: IntegrationTestDesignAssessmentAxis | null;
  readonly missing: readonly string[];
  readonly related_ids: readonly string[];
  readonly supported_next_action: string;
}

export interface IntegrationTestDesignAssessmentResult {
  readonly schema_version: "integration-test-design-assessment-result.experimental.v0.1";
  readonly assessment_kind: "design_time_declared_integration_sufficiency";
  readonly state: IntegrationTestDesignAssessmentState;
  readonly guarantee: string;
  readonly non_guarantees: readonly string[];
  readonly subject: IntegrationTestDesignAssessmentSubject;
  readonly input_digest: `sha256:${string}`;
  readonly denominators: Readonly<Record<string, number>>;
  readonly coverage: Readonly<Record<string, number>>;
  readonly axis_results: readonly Readonly<Record<string, unknown>>[];
  readonly lossless_denominators: Readonly<Record<string, readonly unknown[]> & {
    readonly review_question_ids: readonly string[];
  }>;
  readonly lossless_joins: Readonly<Record<string, readonly unknown[]>>;
  readonly diagnostic_summary: Readonly<
    Record<Exclude<IntegrationTestDesignAssessmentState, "pass">, number>
  >;
  readonly diagnostics: readonly IntegrationTestDesignAssessmentDiagnostic[];
}

export const INTEGRATION_TEST_DESIGN_ASSESSMENT_INPUT_SCHEMA_VERSION:
  "integration-test-design-assessment-input.experimental.v0.1";
export const INTEGRATION_TEST_DESIGN_ASSESSMENT_RESULT_SCHEMA_VERSION:
  "integration-test-design-assessment-result.experimental.v0.1";
export const INTEGRATION_TEST_DESIGN_ASSESSMENT_STATES:
  readonly IntegrationTestDesignAssessmentState[];
export const INTEGRATION_TEST_DESIGN_ASSESSMENT_AXES:
  readonly IntegrationTestDesignAssessmentAxis[];
export function canonicalJson(value: unknown): string;
export function assessIntegrationTestDesign(
  input: IntegrationTestDesignResolvedInput
): IntegrationTestDesignAssessmentResult;
