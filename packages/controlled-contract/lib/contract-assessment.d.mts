export type StructureAssessment = "proven" | "not_proven" | "invalid";
export type ProfileDiscriminationAssessment =
  | "proven"
  | "not_proven"
  | "not_assessed";
export type ExactBindingAssessment = "proven" | "not_proven" | "not_applicable";
export type ResidueAssessment =
  | "none"
  | "review_required"
  | "resolution_required"
  | "review_and_resolution_required";
export type AssessmentAuthority = "non_authoritative";

export interface SourceDigests {
  contract: string;
  evaluation_input: string | null;
  profile: string | null;
  admission: string | null;
  guarantee: string | null;
  adequacy_declaration: string | null;
  adequacy_result: string | null;
  exact_binding_sources?: string;
  exact_binding_declaration?: string;
  exact_binding_certification?: string;
  structural_schema: string;
  assessment_schema: string;
  assessment_format: string;
}

export interface MandatoryClaimProjection {
  claim_id: string;
  kind: "behavior" | "evidence" | "verification";
  modality: "MUST" | "MUST_NOT";
  proposition_id: string;
  profile_pattern_ids: string[];
  structural_verification_edge_ids: string[];
}

export interface ContractAssessment {
  schema_version: "controlled-contract-assessment.v1";
  assessment_identity: string;
  structure: StructureAssessment;
  profile_discrimination: ProfileDiscriminationAssessment;
  exact_binding?: Exclude<ExactBindingAssessment, "not_applicable">;
  assessment_scope: "planning";
  residue_status: ResidueAssessment;
  authority: AssessmentAuthority;
  overall_code: string;
  verification_scope: {
    graph_edge_coverage: "assessed" | "not_assessed";
    proof_plan_discrimination:
      | "assessed_by_admitted_profile"
      | "not_assessed";
    exact_binding_capture?: "assessed_by_deterministic_capture";
  };
  categorical_limits: {
    omitted_obligations: string;
    repository_grounding: string;
    runtime_behavior: string;
    implementation_readiness: string;
  };
  profile_guarantee: null | {
    profile_id: string;
    profile_version: string;
    guarantee: string;
    scope_statement: string;
  };
  matched_profile_covered_claims: Array<{
    claim_id: string;
    pattern_ids: string[];
  }>;
  structurally_verified_claim_edges: Array<{
    relation_id: string;
    source_verification_claim_id: string;
    target_claim_id: string;
    scope_statement: string;
  }>;
  mandatory_claim_categories: {
    matched_profile_covered: MandatoryClaimProjection[];
    structurally_verified_outside_profile: MandatoryClaimProjection[];
    outside_selected_profile: MandatoryClaimProjection[];
  };
  repository_grounding: {
    status: "all" | "some" | "none";
    scope_statement: string;
    grounded_mandatory_behavior_claim_ids: string[];
    ungrounded_mandatory_behavior_claim_ids: string[];
    grounded_count: number;
    total_mandatory_behavior_count: number;
    claims: Array<{
      claim_id: string;
      proposition_id: string;
      repository_reference_ids: string[];
    }>;
  };
  proof_exclusions: Array<{
    exclusion_id: string;
    adequacy_control_outcome: string | null;
  }>;
  diagnostics: Array<{
    source:
      | "structural_schema"
      | "structural_validation"
      | "structural_decomposition"
      | "admitted_profile_evaluation"
      | "assessment_binding";
    detail: Record<string, unknown>;
  }>;
  residue: Array<{
    residue_id: string;
    reason: string;
    text: string;
    candidate_concept?: string;
  }>;
  review_signals: Array<{
    code: "shared_falsifier_scope_review";
    collection_id: string;
    member_claim_ids: string[];
    shared_verification_claim_ids: string[];
    shared_falsifying_proposition_ids: string[];
    scope_statement: string;
  }>;
  review_actions: AssessmentAction[];
  required_next_evidence: AssessmentAction[];
  digests: {
    algorithm: "sha256-canonical-json-v1";
    source: SourceDigests;
    results: {
      structural: string;
      admitted_profile: string | null;
      proof_pack_admission: string | null;
      exact_binding?: string;
    };
  };
  lossless_report: {
    content_reference: string;
    files: [
      "assessment.json",
      "assessment.md",
      "structural.full.json",
      "admitted-proof.full.json",
      "proof-pack-admission.full.json",
      "manifest.json"
    ] | [
      "assessment.json",
      "assessment.md",
      "structural.full.json",
      "admitted-proof.full.json",
      "proof-pack-admission.full.json",
      "exact-binding.full.json",
      "manifest.json"
    ];
  };
}

export interface AssessmentAction {
    code: string;
    remediation_code: string;
    description: string;
    subject_ids: string[];
    claim_ids: string[];
    population_reference_ids: string[];
    collection_ids: string[];
    applicability_contexts: Array<{
      mode: string;
      operand_reference_ids: string[];
    }>;
    required_bindings: string[];
    accepted_membership_operators?: [
      "reference:contains", "reference:member_of"
    ];
    declared_member_reference_ids?: string[];
    membership_claim_ids?: string[];
    declared_cardinality?: number | null;
    declared_cardinality_values?: number[];
    observed_member_count?: number;
}

export interface ProjectedAssessment {
  assessment: Readonly<ContractAssessment>;
  reports: Readonly<{
    structural: Record<string, unknown>;
    admittedProof: Record<string, unknown>;
    proofPackAdmission: Record<string, unknown>;
    exactBinding: Record<string, unknown>;
  }>;
}

export interface AssessmentProjectionInput {
  mode: "structural_only" | "admitted_profile" | "exact_bound_profile";
  contract: Record<string, unknown>;
  structuralResult: Record<string, unknown>;
  structuralInputSource: string;
  evaluationInput?: Record<string, unknown> | null;
  proofPack?: Record<string, unknown> | null;
  exactBindingResult?: Record<string, unknown> | null;
  exactBindingSources?: Record<string, unknown> | null;
}

export class AssessmentArtifactError extends Error {
  code: string;
  details: Record<string, unknown>;
}

export const ASSESSMENT_SCHEMA_VERSION:
  "controlled-contract-assessment.v1";
export const ASSESSMENT_TOOL_VERSION: string;
export const ASSESSMENT_FORMAT_VERSION: string;
export const ASSESSMENT_IMPLEMENTATION_DIGEST: string;
export const ASSESSMENT_REPORT_VERSION: string;
export const ASSESSMENT_MANIFEST_VERSION: string;
export const ASSESSMENT_FORMAT: Readonly<Record<string, unknown>>;
export const ARTIFACT_RELATIVE_ROOT: string;
export const LOSSLESS_FILES: readonly string[];
export const EXACT_BOUND_LOSSLESS_FILES: readonly string[];
export const ASSESSMENT_SCHEMA: Readonly<Record<string, unknown>>;

export function projectContractAssessment(
  input: AssessmentProjectionInput
): ProjectedAssessment;
export function assessContractFiles(input: {
  inputPath: string;
  profileId: string;
  evaluationInputPath: string;
}): Promise<ProjectedAssessment>;
export function assessExactBoundContractFiles(input: {
  captureRoot: string;
  contractPath: string;
  profileId: string;
  evaluationInputPath: string;
  exactBindingSources: Record<string, unknown>;
}): Promise<ProjectedAssessment>;
export function assessStructuralContractFile(input: {
  inputPath: string;
}): Promise<ProjectedAssessment>;
export function writeAssessmentBundle(
  projected: ProjectedAssessment,
  options: { repositoryRoot: string }
): Promise<Readonly<{
  reused: boolean;
  directory: string;
  content_reference: string;
}>>;
export function compactAssessmentOutput(
  assessment: ContractAssessment
): Record<string, string | number | string[]>;
export function markdownAssessment(assessment: ContractAssessment): string;
export function bundleBytes(projected: ProjectedAssessment): Map<string, string>;
export function canonicalJson(value: unknown): string;
export function canonicalDigest(value: unknown): string;
export function normalizeContractForIdentity(value: unknown): unknown;
export function normalizeEvaluationInputForIdentity(value: unknown): unknown;
export function validateAssessmentSchema(value: unknown): boolean;
