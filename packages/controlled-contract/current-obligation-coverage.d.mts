import type {
  AdmittedProofPackSnapshot,
  PackageMintedVerificationProfileV1Result
} from "./current-admitted-proof-packs.mjs";

export type ObligationCoverageMechanismKind =
  | "code_symbol" | "schema" | "test" | "configuration"
  | "durable_record" | "tool_operation";
export type ObligationGuaranteeSelectorKind =
  | "reference_binding" | "claim" | "relation" | "collection"
  | "resolver_fact" | "evidence";
export type ObligationCoverageOutcome = 'stale' | 'design_invalid' | 'selected';
export interface ObligationGuaranteeSelector {
  readonly kind: ObligationGuaranteeSelectorKind;
  readonly component_id: string;
}
export interface ObligationCoveragePackMapping {
  readonly kind: "pack_mapping";
  readonly pack_id: string;
  readonly requested_intent: string;
  readonly profile_id: string;
  readonly profile_version: string;
  readonly selector: ObligationGuaranteeSelector;
}
export interface ObligationCoverageRow extends ProofAuthoringObligation {
  readonly selection: ProofAuthoringSelection;
  readonly design_status: 'valid' | 'invalid';
  readonly resolved_identity: string;
  readonly selected_proof_assessment: SelectedProofPrerequisiteAssessment;
  readonly diagnostics: readonly ProofAuthoringDiagnostic[];
}
export interface ObligationCoverageCarrier {
  readonly schema_version: "resolved-obligation-coverage.v1";
  readonly wk_id: string;
  readonly focus: string | null;
  readonly selected_unit: string | null;
  readonly source_digest: `sha256:${string}`;
  readonly context_digest: `sha256:${string}`;
  readonly definition_identities: readonly ProofAuthoringPin[];
  readonly obligations: readonly ObligationCoverageRow[];
}
export interface ObligationCoverageCarrierValidationResult {
  readonly schema_valid: boolean;
  readonly schema_errors: readonly Readonly<Record<string, unknown>>[];
  readonly diagnostics: readonly Readonly<Record<string, unknown>>[];
  readonly valid: boolean;
  readonly carrier: ObligationCoverageCarrier | null;
}
export const OBLIGATION_COVERAGE_SCHEMA_VERSION: "resolved-obligation-coverage.v1";
export const OBLIGATION_COVERAGE_SCHEMA: Readonly<Record<string, unknown>>;
export const OBLIGATION_COVERAGE_GAP_KINDS: readonly never[];
export const OBLIGATION_COVERAGE_MECHANISM_KINDS: readonly ObligationCoverageMechanismKind[];
export const OBLIGATION_COVERAGE_OUTCOMES: readonly ObligationCoverageOutcome[];
export function validateObligationCoverageCarrier(
  carrier: Record<string, unknown>
): ObligationCoverageCarrierValidationResult;

export interface ObligationGuaranteeSelectorPackArtifacts {
  readonly pack_id: string;
  readonly requested_intents: readonly string[];
  readonly pack_snapshot: AdmittedProofPackSnapshot;
  readonly assessment: PackageMintedVerificationProfileV1Result | null;
  readonly evaluation_input_present: boolean;
  readonly profile_discrimination: "proven" | "not_proven" | "not_assessed";
}

export interface ObligationGuaranteeSelectorComponent {
  readonly pack_id: string;
  readonly profile_id: string;
  readonly profile_version: string;
  readonly requested_intents: readonly string[];
  readonly selector: ObligationGuaranteeSelector;
  readonly guarantee_applicability_proven: boolean;
  readonly applicable_exclusion: boolean | null;
  readonly matched_node_ids: readonly string[] | null;
  readonly satisfaction: string | null;
  readonly evaluation_input_present: boolean;
  readonly pack_evaluated: boolean;
  readonly profile_discrimination: "proven" | "not_proven" | "not_assessed";
}
export interface ObligationGuaranteeSelectorIndex {
  readonly version: "obligation-guarantee-selector-index.v2";
  readonly pack_ids: readonly string[];
  readonly components: readonly ObligationGuaranteeSelectorComponent[];
}
export class ObligationGuaranteeSelectorError extends Error {
  code: string;
  details: Record<string, unknown>;
}
export const OBLIGATION_GUARANTEE_SELECTOR_INDEX_VERSION: "obligation-guarantee-selector-index.v2";
export const OBLIGATION_GUARANTEE_SELECTOR_KINDS: readonly ObligationGuaranteeSelectorKind[];
export const OBLIGATION_GUARANTEE_SELECTOR_RESOLUTION_STATUSES: readonly string[];
export function buildObligationGuaranteeSelectorIndex(input:
  | {
    assessment: Readonly<Record<string, unknown>>;
    packs?: never;
  }
  | {
    assessment?: never;
    packs: readonly ObligationGuaranteeSelectorPackArtifacts[];
  }
): ObligationGuaranteeSelectorIndex;
export function resolveObligationGuaranteeSelector(input: {
  index: ObligationGuaranteeSelectorIndex;
  mapping: ObligationCoveragePackMapping;
  nodeIds: readonly string[];
}): Readonly<{
  status: "compatible" | "incompatible" | "mapped_input_missing"
    | "mapped_pack_not_evaluated";
  reason: string | null;
  component: ObligationGuaranteeSelectorComponent | null;
}>;

export type ProofAuthoringJson = null | boolean | number | string | readonly ProofAuthoringJson[] | { readonly [key: string]: ProofAuthoringJson };
export interface ProofAuthoringPin {
  readonly proof_name: string | null;
  readonly proof_version: string | null;
  readonly profile_digest: string | null;
  readonly parameter_contract_digest: string | null;
  readonly admission_digest: string | null;
}
export interface ProofAuthoringSelection extends ProofAuthoringPin {
  readonly parameters: Readonly<Record<string, ProofAuthoringJson>>;
}
export type SelectedProofDiagnosticEffect = 'blocking' | 'nonblocking' | 'unresolved';
export type SelectedProofDiagnosticStage = 'authored_inputs' | 'canonical_sources'
  | 'system_capability' | 'unclassified';
export interface SelectedProofDiagnosticRecovery {
  readonly status: 'operator_action' | 'unavailable' | 'not_required';
  readonly supported_next_call: Readonly<Record<string, unknown>> | null;
  readonly operator_action: string | null;
  readonly explanation: string;
}
export interface SelectedProofDiagnosticRouteAssessment {
  readonly schema_version: 'selected-proof-diagnostic-route-assessment.v1';
  readonly effect: SelectedProofDiagnosticEffect;
  readonly stage: SelectedProofDiagnosticStage;
  readonly selected_route: 'provider_bound_test_validity' | 'definition_evaluation';
  readonly owner_code: string;
  readonly reason: string;
  readonly unavailable_operation: Readonly<{
    kind: string; id: string; identity: string | null; state: string; description: string;
  }> | null;
  readonly responsible_owner: string | null;
  readonly recovery: SelectedProofDiagnosticRecovery;
}
export interface ProofAuthoringDiagnostic {
  readonly code: string;
  readonly path: string;
  readonly reason: string;
  readonly owner: string;
  readonly problem: Readonly<Record<string, unknown>> & {
    readonly category: ProofAuthoringDiagnosticCategory;
    readonly severity: string;
    readonly cause: Readonly<Record<string, unknown>>;
    readonly route_assessment: SelectedProofDiagnosticRouteAssessment;
  };
  readonly [key: string]: unknown;
}
export interface SelectedProofDiagnosticStageAssessment {
  readonly status: string;
  readonly diagnostic_codes: readonly string[];
  readonly blocking_diagnostic_codes: readonly string[];
  readonly nonblocking_diagnostic_codes: readonly string[];
  readonly unresolved_diagnostic_codes: readonly string[];
}
export interface SelectedProofPrerequisiteAssessment {
  readonly schema_version: 'selected-proof-prerequisite-assessment.v1';
  readonly definition: ProofAuthoringPin;
  readonly assessment_status: 'resolved' | 'unresolved';
  readonly execution_family: 'provider_bound_test_validity' | 'definition_evaluation';
  readonly semantic_inputs: readonly unknown[];
  readonly canonical_inputs: readonly unknown[];
  readonly required_observations: readonly unknown[];
  readonly requirements: Readonly<Record<'authored_case' | 'native_test_binding'
    | 'declared_test_target' | 'test_execution_evidence', 'required' | 'not_applicable'>>;
  readonly authored_case: Readonly<{ status: 'complete' | 'missing' | 'not_applicable'; case_id: string | null }>;
  readonly native_test_binding: Readonly<{ status: 'complete' | 'missing' | 'ambiguous' | 'invalid' | 'not_applicable'; binding_count: number; verification_id: string | null; test_proof_id: string | null; problem: Readonly<Record<string, unknown>> | null }>;
  readonly declared_test_target: Readonly<{ status: 'complete' | 'missing' | 'ambiguous' | 'invalid' | 'not_applicable'; binding_count: number; verification_id: string | null }>;
  readonly capability_contract: Readonly<Record<string, unknown>>;
  readonly unresolved_diagnostic_codes: readonly string[];
  readonly stages: Readonly<{
    authored_inputs: SelectedProofDiagnosticStageAssessment;
    canonical_sources: SelectedProofDiagnosticStageAssessment;
    system_capability: SelectedProofDiagnosticStageAssessment & Readonly<{
      satisfied_by: string | null;
      blockers: readonly SelectedProofDiagnosticRouteAssessment[];
    }>;
    execution_evidence: Readonly<{ status: 'not_started'; credit_granted: 0;
      required_observations: readonly unknown[] }>;
  }>;
  readonly prevents_selected_route: boolean;
  readonly readiness_status: 'complete' | 'incomplete';
}
export interface ProofAuthoringObligation {
  readonly case_id?: string;
  readonly obligation_id: string;
  readonly statement?: string;
  readonly controlled_contract_node_ids?: readonly string[];
  readonly mechanism?: Readonly<{ owner: string; kind: ObligationCoverageMechanismKind; selector: string }>;
  readonly selection?: ProofAuthoringSelection;
}
export interface ObligationCoverageDraft {
  readonly cases?: readonly AuthoredTestCaseDefinition[];
  readonly schema_version: 'controlled-contract-obligation-coverage.v3';
  readonly wk_id: string;
  readonly selected_unit: string | null;
  readonly focus: string | null;
  readonly obligations: readonly ProofAuthoringObligation[];
}
export interface ProofAuthoringAmendment {
  readonly statement?: string;
  readonly controlled_contract_node_ids?: readonly string[];
  readonly mechanism?: Readonly<{ owner: string; kind: ObligationCoverageMechanismKind; selector: string }> | null;
  readonly proof_name?: string;
  readonly parameters?: Readonly<Record<string, ProofAuthoringJson>>;
  readonly clear_parameters?: readonly string[];
  readonly refresh_proof_version?: true;
}
export const OBLIGATION_DRAFT_SCHEMA_VERSION: 'controlled-contract-obligation-coverage.v3';
export const OBLIGATION_DRAFT_SCHEMA: Readonly<Record<string, unknown>>;
export const OBLIGATION_COVERAGE_MAX_ROWS: 4096;
export const OBLIGATION_COVERAGE_MAX_BYTES: 1048576;
export const PROOF_AUTHORING_FIELDS: readonly (keyof ProofAuthoringAmendment)[];
export const PROOF_AUTHORING_FIELD_SCHEMAS: Readonly<Record<string, unknown>>;
export function validateObligationCoverageDraft(source: unknown): Omit<ObligationCoverageCarrierValidationResult, 'carrier'> & { readonly carrier: ObligationCoverageDraft | null };
export function upsertProofAuthoringSelection(source: ObligationCoverageDraft, obligations: readonly (ProofAuthoringAmendment & { readonly obligation_id: string })[]): Promise<ObligationCoverageDraft>;
export function removeProofAuthoringSelection(source: ObligationCoverageDraft, obligationId: string): ObligationCoverageDraft;
export function pinProofSelection(name: string): Promise<ProofAuthoringPin>;
export function loadPinnedProofSelection(selection: ProofAuthoringPin): Promise<AdmittedProofPackSnapshot>;
export type ProofAuthoringDiagnosticCategory = 'author_input' | 'canonical_source' | 'system_capability' | 'unclassified';
export interface ProofAuthoringDiagnosticOccurrence {
  readonly occurrence_index: number;
  readonly obligation_id: string | null;
  readonly semantic_key: string;
  readonly category: ProofAuthoringDiagnosticCategory;
  readonly route_effect: SelectedProofDiagnosticEffect;
  readonly route_assessment: SelectedProofDiagnosticRouteAssessment;
  readonly severity: string;
  readonly diagnostic: Readonly<Record<string, unknown>>;
}
export interface ProofAuthoringDiagnosticGroup {
  readonly semantic_key: string;
  readonly category: ProofAuthoringDiagnosticCategory;
  readonly owner: string | null;
  readonly code: string | null;
  readonly severity: string;
  readonly actionable_meaning: string | null;
  readonly route_effect: SelectedProofDiagnosticEffect;
  readonly route_assessment: SelectedProofDiagnosticRouteAssessment;
  readonly occurrences: readonly ProofAuthoringDiagnosticOccurrence[];
  readonly occurrence_count: number;
  readonly affected_obligation_count: number;
  readonly global_occurrence_count: number;
  readonly affected_obligation_ids: readonly string[];
}
export const PROOF_AUTHORING_DIAGNOSTIC_GROUPS_VERSION: 'proof-authoring-diagnostic-groups.v2';
export function groupProofAuthoringDiagnostics(resolved: Readonly<{
  readonly identity_digest: string;
  readonly diagnostics: readonly Readonly<Record<string, unknown>>[];
  readonly rows: readonly Readonly<{ readonly obligation_id: string; readonly definition?: ProofAuthoringPin | null;
    readonly diagnostics: readonly Readonly<Record<string, unknown>>[] }>[];
}>): Readonly<{
  readonly version: typeof PROOF_AUTHORING_DIAGNOSTIC_GROUPS_VERSION;
  readonly identity_digest: string;
  readonly counts: Readonly<{ diagnostic_occurrences: number; diagnostic_groups: number;
    affected_obligations: number; global_occurrences: number;
    blocking_occurrences: number; blocking_affected_obligations: number;
    nonblocking_occurrences: number; nonblocking_affected_obligations: number;
    unresolved_occurrences: number; unresolved_affected_obligations: number }>;
  readonly categories: readonly Readonly<{ category: ProofAuthoringDiagnosticCategory;
    group_count: number; occurrence_count: number; affected_obligation_count: number;
    global_occurrence_count: number; blocking_group_count: number;
    blocking_occurrence_count: number; nonblocking_group_count: number;
    nonblocking_occurrence_count: number; unresolved_group_count: number;
    unresolved_occurrence_count: number }>[];
  readonly groups: readonly ProofAuthoringDiagnosticGroup[];
}>;

/**
 * One repeated definition, stated once for a batched refusal. Each occurrence
 * that used it carries `{ constraint: constraint_id }` where the value stood.
 */
export interface ProofAuthoringSharedConstraint {
  readonly constraint_id: string;
  readonly digest: string;
  readonly occurrence_count: number;
  readonly value: unknown;
}
export const PROOF_AUTHORING_SHARED_CONSTRAINTS_VERSION: 'proof-authoring-shared-constraints.v1';
export function shareRepeatedProofConstraints(
  causes: readonly Readonly<Record<string, unknown>>[]
): Readonly<{
  readonly shared_constraints: readonly ProofAuthoringSharedConstraint[];
  readonly causes: readonly Readonly<Record<string, unknown>>[];
}>;

export class ProofAuthoringError extends Error {
  constructor(code: string, message: string, details?: Record<string, unknown>);
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;
}
export function assertProofAuthoringDraft(source: unknown): ObligationCoverageDraft;

export interface NativeTestCaseInput {
  readonly case_id?: string;
  readonly verification_id?: string;
  readonly component?: Readonly<{ type_term: string; identity: Readonly<Record<string, unknown>> }> | Readonly<{ reference_id: string }>;
  readonly target?: Readonly<{ path?: string; selector?: Readonly<{ name?: string; nesting?: number }> }>;
  readonly observation?: Readonly<{ kind?: string }>;
  readonly falsification?: Readonly<{ strategy?: 'dependency_failure' | 'forced_invocation'; module_path?: string;
    entry_export?: string; operation?: Readonly<{ module_path?: string; export_name?: string }> }>;
}
export interface NativeTestCaseAmendment extends Omit<NativeTestCaseInput, 'falsification'> {
  readonly falsification?: Readonly<{
    strategy?: 'dependency_failure' | 'forced_invocation' | null;
    module_path?: string | null;
    entry_export?: string | null;
    operation?: Readonly<{ module_path?: string | null; export_name?: string | null }> | null;
  }> | null;
}
export interface AuthoredTestCaseDefinition {
  readonly case_id: string;
  readonly verification_id?: string;
  readonly component?: NativeTestCaseInput['component'];
  readonly target?: Readonly<{ owner_unit?: string; selector?: Readonly<{ name?: string; nesting?: number }> }>;
  readonly observation?: NativeTestCaseInput['observation'];
  readonly falsification?: NativeTestCaseInput['falsification'];
}
export interface UnifiedProofAuthoringRequest {
  readonly unit: string;
  readonly repo?: string;
  readonly focus?: string;
  readonly expected_content_digest: string | null;
  readonly obligations: readonly (ProofAuthoringAmendment & { readonly obligation_id: string; readonly case?: NativeTestCaseAmendment })[];
}
export interface UnifiedProofAuthoringReceipt {
  readonly unit: string;
  readonly saved: number;
  readonly unchanged: number;
  readonly content_digest: string;
}
