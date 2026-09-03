import type {
  PackageMintedVerificationProfileV1Result
} from "./current-admitted-proof-packs.mjs";
import type {
  AcceptanceCoverageAxis, AcceptanceCoverageContractNode,
  AcceptanceCoverageCriterionIdentitySet, AcceptanceCoverageCriterionResult,
  AcceptanceCoverageIdentityComparison, AcceptanceCoverageMapping,
  AcceptanceCoverageMappingOutcome, AcceptanceCoverageState
} from "./current-acceptance-coverage.mjs";
import type {
  ObligationCoverageCarrier, ObligationCoverageOutcome, ObligationCoverageRow,
  ObligationGuaranteeSelectorIndex
} from "./current-obligation-coverage.mjs";

export interface TaskResultCollectionDescriptor {
  readonly collection: string;
  readonly stable_id: string;
  readonly fields: readonly string[];
  readonly selectors: readonly string[];
}

export const TASK_RESULT_PROJECTION_VOCABULARY: Readonly<{
  semantic_scope: "task_relevant_public";
  compact_omission: Readonly<{
    cause: "task_directed_projection";
    complete_path: "typed_query";
  }>;
  continuation: Readonly<{
    collection_rows: "typed_collection";
    structured_values: "typed_field_projection";
    scalar_values: "offset_length_total_range";
  }>;
  accounting: Readonly<{
    total: "total";
    returned: "returned";
    remaining: "remaining";
    continuation: "continuation";
  }>;
  authority: "non_authorizing";
}>;

export function defineTaskResultCollectionDescriptors(
  rows: readonly TaskResultCollectionDescriptor[]
): readonly TaskResultCollectionDescriptor[];

export interface TaskResultPageAccounting {
  readonly total: number;
  readonly returned: number;
  readonly remaining: number;
  readonly continuation: Readonly<{ kind: "cursor"; cursor: string }> | null;
  readonly complete: boolean;
}

export function taskResultPageAccounting(input: {
  total: number;
  offset?: number;
  returned: number;
  cursor?: string | null;
}): Readonly<TaskResultPageAccounting>;

export interface TaskResultScalarRangeAccounting {
  readonly total: number;
  readonly returned: number;
  readonly remaining: number;
  readonly continuation: Readonly<{ kind: "scalar_range"; next_offset: number }> | null;
  readonly complete: boolean;
}

export function taskResultScalarRangeAccounting(input: {
  total: number;
  offset: number;
  length: number;
}): Readonly<TaskResultScalarRangeAccounting>;

export const TASK_RESULT_SNAPSHOT_DEFAULTS: Readonly<{
  ttl_ms: number;
  capacity: number;
  identity_bits: number;
  maximum_items: number;
  maximum_bytes: number;
  maximum_scalar_range_bytes: number;
}>;

export class TaskResultSnapshotError extends Error {
  readonly code: "task_result_snapshot_unavailable" | "task_result_query_invalid";
  readonly kind: "unavailable" | "invalid";
  readonly details: Readonly<Record<string, unknown>>;
  constructor(
    kind: "unavailable" | "invalid",
    reason: string,
    recovery?: Readonly<Record<string, unknown>> | null,
    details?: Readonly<Record<string, unknown>>
  );
}

export interface TaskResultSnapshotRegistry {
  put(input: {
    domain: string;
    result: Record<string, unknown>;
    sourceIdentity: Record<string, unknown>;
    recovery: Record<string, unknown>;
    resolveCurrentSourceIdentity?: (() => unknown | Promise<unknown>) | null;
  }): string;
  query(input: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>;
  metadata(identity: string): Readonly<{
    identity: string;
    domain: string;
    current: true;
    created_at: number;
    expires_at: number;
  }> | null;
  size(): number;
}

export function createTaskResultSnapshotRegistry(options?: Readonly<{
  now?: () => number;
  random?: (size: number) => { toString(encoding: "base64url"): string };
  capacity?: number;
  ttlMs?: number;
  maximumItems?: number;
  maximumBytes?: number;
  maximumScalarRangeBytes?: number;
  collectionDescriptor?: (domain: string, collection: string | null) =>
    TaskResultCollectionDescriptor | null | undefined;
  projectPage?: (input: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>>;
  projectPageContext?: (input: Readonly<Record<string, unknown>>) =>
    Readonly<Record<string, unknown>> | null;
  projectRow?: (...args: unknown[]) => Readonly<Record<string, unknown>>;
  measureProjectionBytes?: (value: unknown) => number;
  assertProjectionBound?: <T>(value: T, maximumBytes: number, context?: unknown) => T;
  queryOperationForDomain?: (domain: string) => string;
  unavailableError?: (...args: unknown[]) => Error;
  invalidError?: (...args: unknown[]) => Error;
  accountingMode?: "fields" | "nested";
  schemaVersions?: Readonly<{ field?: string; row?: string }>;
}>): Readonly<TaskResultSnapshotRegistry>;

export {
  CONTROLLED_CONTRACT_ASSESSMENT_COLLECTION_DESCRIPTORS,
  CONTROLLED_CONTRACT_ASSESSMENT_PROJECTION_VOCABULARY,
  CONTROLLED_CONTRACT_INTEGRATION_ASSESSMENT_COLLECTIONS,
  CONTROLLED_CONTRACT_PROOF_ASSESSMENT_COLLECTIONS,
  assessmentCollectionDescriptor
} from "./lib/assessment-collection-descriptors.mjs";
export type {
  ControlledContractAssessmentCollectionDescriptor,
  ControlledContractAssessmentFamily,
  ControlledContractAssessmentProjectionVocabulary
} from "./lib/assessment-collection-descriptors.mjs";

export {
  INTEGRATION_TEST_DESIGN_ASSESSMENT_AXES,
  INTEGRATION_TEST_DESIGN_ASSESSMENT_INPUT_SCHEMA_VERSION,
  INTEGRATION_TEST_DESIGN_ASSESSMENT_RESULT_SCHEMA_VERSION,
  INTEGRATION_TEST_DESIGN_ASSESSMENT_STATES,
  assessIntegrationTestDesign,
  canonicalJson as canonicalIntegrationTestDesignAssessmentJson
} from "./current-integration-test-design-assessment.d.mts";
export type {
  IntegrationTestDesignAssessmentAxis,
  IntegrationTestDesignAssessmentDiagnostic,
  IntegrationTestDesignAssessmentResult,
  IntegrationTestDesignAssessmentState,
  IntegrationTestDesignAssessmentSubject,
  IntegrationTestDesignPopulationRef,
  IntegrationTestDesignResolvedInput
} from "./current-integration-test-design-assessment.d.mts";

export {
  IntegrationPrefixCompatibilityError, ARTIFACTS,
  compareIntegrationPrefixCaptureCompatibility, compareIntegrationPrefixCompatibility
} from "./current-integration-prefix.mjs";
export type {
  IntegrationPrefixCompatibilityCode, IntegrationPrefixArtifactBinding,
  IntegrationPrefixCompatibilitySources, IntegrationPrefixCatalogEntry,
  IntegrationPrefixCatalog, IntegrationPrefixAdmission,
  IntegrationPrefixCompatibilityDifference, IntegrationPrefixCompatibilityResult,
  IntegrationPrefixCompatibilityOptions
} from "./current-integration-prefix.mjs";

export {
  assessContractFiles,
  assessExactBoundContractFiles,
  assessStructuralContractFile,
  compactAssessmentOutput
} from "./lib/contract-assessment.mjs";

export {
  ProofPlanError,
  assessProofPlan,
  assessProofPlanFiles,
  compactMultiPackAssessment,
  writeMultiPackAssessmentBundle
} from "./lib/multi-pack-assessment.mjs";

export {
  ControlledContractAssessmentRecoveryError,
  buildControlledContractAssessmentRecovery
} from "./lib/assessment-recovery.mjs";

export {
  MAX_DISCOVERY_QUERY_BYTES,
  MAX_DISCOVERY_RESULT_BYTES,
  MAX_DISCOVERY_RETURNED_INTENTS,
  PROOF_INTENT_DISCOVERY_CATALOG,
  PROOF_INTENT_DISCOVERY_CATALOG_DIGEST,
  ProofIntentDiscoveryError,
  canonicalProofIntentDiscoveryJson,
  discoverProofIntents
} from "./lib/proof-intent-discovery.mjs";

export {
  MAX_BINDING_ASSISTANCE_BYTES,
  ProofPackBindingAssistanceError,
  canonicalProofPackBindingAssistanceJson,
  inspectProofPackBindings
} from "./lib/proof-pack-binding-assistance.mjs";

export function inspectProofPackBindingsPage(input: {
  contract: Record<string, unknown>; profileId: string; profileVersion: string;
  requestedIntents?: string[] | null;
  evaluationInput?: Record<string, unknown> | null;
  roles?: string[]; statuses?: string[];
  offset?: number; maximumItems?: number;
}): Promise<Readonly<Record<string, unknown>>>;

export {
  assertSoundNegativeObservationCapture, assertCallerInputAuthorityConfinementCapture,
  deriveDeterministicLexicographicConformance,
  assertAuthenticationProvenanceOccurrenceCapture,
  deriveAuthenticationProvenanceOccurrenceCapture,
  deriveDeclaredBoundaryRecordConsistency, deriveDeclaredLimitGuidancePropagation
} from "./current-deterministic-derivations.mjs";

export {
  MAX_PROOF_PLAN_BYTES,
  ProofPlanCompilerError,
  buildProofPlan,
  buildProofPlanFiles,
  canonicalProofPlanJson
} from "./lib/proof-plan-compiler.mjs";

export class ProofAuthoringSkeletonError extends Error {
  code: string;
  details: Record<string, unknown>;
}
export const PACKAGE_VERSION: string;
export function buildIntegrationPrefixSourceMap(input: Record<string, unknown>):
  Readonly<Record<string, unknown>>;
export function buildProofAuthoringSkeleton(input: Record<string, unknown>):
  Promise<Readonly<Record<string, unknown>>>;
export const continueProofAuthoring: typeof buildProofAuthoringSkeleton;
export function canonicalProofAuthoringSkeletonJson(
  result: Record<string, unknown>
): string;

export const INTEGRATION_PREFIX_INTENT: string;
export const INTEGRATION_PREFIX_PROFILE: Readonly<{
  profile_id: string;
  profile_version: string;
}>;

export {
  PROOF_INTENT_ARTIFACT,
  PROOF_INTENT_DIGESTS,
  MAX_AUTHORING_PROJECTION_BYTES,
  ProofIntentSelectionError,
  compactProofIntentSelection,
  describeProofPackAuthoring,
  selectProofPacks
} from "./lib/proof-intent-selection.mjs";

export const NATIVE_CONTRACT_SCHEMA_V1: Readonly<Record<string, unknown>>;
export const PROFILE_ID_V1: "acceptance-contract.standard.v1";
export const SCHEMA_VERSION_V1: "controlled-acceptance-contract.v1";
export const TEST_PROOF_VERSION_V1: "controlled-contract-test-proof.v1";
export const VOCABULARY_VERSION_V1: "controlled-contract-vocabulary.v1";
export function buildNativeContractSchemaV1(...args: unknown[]): unknown;
export function validateAndResolveNativeContractV1(...args: unknown[]): unknown;

export const STABLE_RESOURCE_LIMITS: Readonly<Record<string, number>>;
export class StableVerificationError extends Error {
  code: string;
  details: Record<string, unknown>;
}
export function assertStableResourceUsage(...args: unknown[]): boolean;
export function evaluateVerificationProfileV1(
  ...args: unknown[]
): PackageMintedVerificationProfileV1Result;
export function profileDigest(...args: unknown[]): string;
export function validateProfileSemanticsV1(...args: unknown[]): unknown;

export const CONTROLLED_VOCABULARY: Readonly<Record<string, unknown>>;
export const VOCABULARY_DIGESTS: Readonly<Record<string, string>>;
export function buildAdvisoryVocabularyView(...args: unknown[]): unknown;
export function describeVocabularyTerms(...args: unknown[]): unknown;
export function searchVocabulary(...args: unknown[]): unknown;
export function validateVocabulary(...args: unknown[]): unknown;

export {
  AdmittedProofPackError, assertComponentExclusionApplicability, loadAdmittedProofPack,
  readProofPackCatalog
} from "./current-admitted-proof-packs.mjs";
export type {
  ComponentExclusionApplicabilitySelectorKind, ComponentExclusionApplicabilityComponent,
  ComponentExclusionApplicability, ComponentExclusionApplicabilityValidationResult,
  AdmittedProofPackSnapshot, PackageMintedVerificationProfileV1Result,
  PackageMintedExactBindingResult, AssessmentComponentExclusionApplicability
} from "./current-admitted-proof-packs.mjs";

export {
  TEST_PROOF_PROVIDER_REGISTRY_ID, TEST_PROOF_PROVIDER_REGISTRY_VERSION,
  TEST_PROOF_PROVIDER_CATALOG, TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
  TEST_PROOF_RUNTIME_EVIDENCE_VERSION_V2, TEST_PROOF_RUNTIME_EVIDENCE_SCHEMA_V2,
  STABLE_TEST_PROOF_AUTHORING_LIMITS, PROVIDER_REFUSAL_PRECEDENCE,
  StableTestProofContractError, validateStableTestProofContract,
  canonicalStableTestProofContractJson, validateTestProofRuntimeEvidenceV2,
  describeStableTestProofAuthoring, VERIFICATION_BUNDLE_SCHEMA_VERSION,
  VERIFICATION_BUNDLE_FIELDS, VERIFICATION_BUNDLE_VOCABULARY,
  buildStableTestProofBindingTemplate, buildVerificationBundleTemplate,
  queryStableTestProofBindings, resolveStableTestProofBindingPopulation,
  resolveStableTestProofProviderBindings,
  replaceStableTestProofBindings, resolveTestProofProviderCompatibility,
  ASSESSMENT_SCHEMA_V2, MAX_TEST_PROOF_ASSESSMENT_INDEX_BYTES,
  TEST_PROOF_SEMANTIC_JUDGMENT, assessTestProofContract, evaluateAdmittedTestValidity,
  validateTestProofAssessmentSchema
} from "./current-test-proof.mjs";

export interface StableRuntimeTestIdentityV1 {
  readonly test_id: string;
}

export type StableTestProofRuntimeReadinessReason =
  | "missing_inventory"
  | "missing_selection"
  | "invalid_selection"
  | "ready";

export interface StableTestProofRuntimeReadiness {
  readonly schema_version: "controlled-contract-test-proof-runtime-readiness.v1";
  readonly status: "ready" | "not_ready";
  readonly reason: StableTestProofRuntimeReadinessReason;
  readonly candidate_total: number;
  readonly current_test_ids: readonly string[];
  readonly selected_test_id: string | null;
  readonly runtime_test_identity: StableRuntimeTestIdentityV1 | null;
  readonly authority: "diagnostic";
  readonly admissibility_effect: "none";
}

export const STABLE_TEST_PROOF_RUNTIME_READINESS_SCHEMA_VERSION:
  "controlled-contract-test-proof-runtime-readiness.v1";
export const STABLE_TEST_PROOF_RUNTIME_READINESS_REASONS: Readonly<{
  MISSING_INVENTORY: "missing_inventory";
  MISSING_SELECTION: "missing_selection";
  INVALID_SELECTION: "invalid_selection";
  READY: "ready";
}>;
export function projectStableTestProofCurrentPopulation(
  binding: Readonly<Record<string, unknown>>
): readonly string[];
export function classifyStableTestProofRuntimeReadiness(
  binding: Readonly<Record<string, unknown>>
): StableTestProofRuntimeReadiness;
export type {
  ControlledContractVerificationBundle, ControlledContractVerificationBundleOperation,
  TestProofValidationResult, RuntimeAssessmentStatus, RuntimeAssessmentReceiptKind,
  RuntimeAssessmentVerification, RuntimeAssessmentIdentity, RuntimeAssessmentReceipt,
  ControlledContractAssessmentV3
} from "./current-test-proof.mjs";

/** The canonical four-field acceptance-coverage gap warning payload. */
export interface AcceptanceCoverageGapWarning {
  code: "acceptance_coverage_incomplete";
  severity: "advisory";
  message: "Acceptance coverage has unresolved gaps.";
  payload: "acceptance-coverage-gap-warning.v1";
}

export {
  AcceptanceCoverageIdentityError, BINDING_DIGESTS, criterionIdentityDigest,
  deriveCriterionIdentitySet, compareCriterionIdentitySets, AcceptanceCoverageError,
  ACCEPTANCE_COVERAGE_STATES
} from "./current-acceptance-coverage.mjs";
export type {
  AcceptanceCoverageState, AcceptanceCoverageAxis, AcceptanceCoverageBindings,
  AcceptanceCoverageCriterionIdentity, AcceptanceCoverageCriterionIdentitySet,
  AcceptanceCoverageIdentityComparison, AcceptanceCoverageMapping,
  AcceptanceCoverageContractNode, AcceptanceCoverageMappingOutcome,
  AcceptanceCoverageCriterionResult
} from "./current-acceptance-coverage.mjs";

export interface AcceptanceCoverageEvaluationResult {
  readonly states: readonly AcceptanceCoverageCriterionResult[];
  readonly mapping_outcomes: readonly AcceptanceCoverageMappingOutcome[];
  readonly unknown_mappings: readonly AcceptanceCoverageMappingOutcome[];
  readonly unmapped_mandatory_node_ids: readonly string[];
  readonly stale: boolean;
  readonly identity_comparison: AcceptanceCoverageIdentityComparison | null;
  readonly merge_precedence: readonly AcceptanceCoverageState[];
  readonly warnings: readonly AcceptanceCoverageGapWarning[];
  readonly complete: boolean;
}

export const GAP_WARNING: Readonly<AcceptanceCoverageGapWarning>;
export function evaluateAcceptanceCoverage(input: {
  criteria: AcceptanceCoverageCriterionIdentitySet;
  mappings: readonly AcceptanceCoverageMapping[];
  contractNodes: readonly AcceptanceCoverageContractNode[];
  selectedPackNodeIds: readonly string[];
  priorCriterionIdentities?: AcceptanceCoverageCriterionIdentitySet;
}): AcceptanceCoverageEvaluationResult;
export function isAcceptanceCoverageComplete(
  result: AcceptanceCoverageEvaluationResult | ObligationCoverageEvaluationResult
): boolean;

export {
  OBLIGATION_COVERAGE_SCHEMA_VERSION, OBLIGATION_COVERAGE_SCHEMA,
  OBLIGATION_COVERAGE_GAP_KINDS, OBLIGATION_COVERAGE_MECHANISM_KINDS,
  OBLIGATION_COVERAGE_OUTCOMES, validateObligationCoverageCarrier,
  ObligationGuaranteeSelectorError, OBLIGATION_GUARANTEE_SELECTOR_INDEX_VERSION,
  OBLIGATION_GUARANTEE_SELECTOR_KINDS,
  OBLIGATION_GUARANTEE_SELECTOR_RESOLUTION_STATUSES,
  buildObligationGuaranteeSelectorIndex, resolveObligationGuaranteeSelector
} from "./current-obligation-coverage.mjs";
export type {
  ObligationCoverageMechanismKind, ObligationGuaranteeSelectorKind,
  ObligationCoverageGapKind, ObligationCoverageOutcome, ObligationGuaranteeSelector,
  ObligationCoveragePackMapping, ObligationCoverageExplicitGap, ObligationCoverageRow,
  ObligationCoverageCarrier, ObligationCoverageCarrierValidationResult,
  ObligationGuaranteeSelectorPackArtifacts, ObligationGuaranteeSelectorComponent,
  ObligationGuaranteeSelectorIndex
} from "./current-obligation-coverage.mjs";

export interface ObligationCoverageEvaluationResult {
  readonly mode: "obligation_coverage";
  readonly schema_version: "controlled-contract-obligation-coverage.v1";
  readonly wk_id: string;
  readonly focus: string | null;
  readonly obligation_outcomes: readonly Readonly<{
    obligation_id: string;
    position: number;
    source_locator: string;
    controlled_contract_node_ids: readonly string[];
    mechanism: ObligationCoverageRow["mechanism"];
    proof: ObligationCoverageRow["proof"];
    outcome: ObligationCoverageOutcome;
    reason: string | null;
  }>[];
  readonly outcome_precedence: readonly ObligationCoverageOutcome[];
  readonly diagnostics: readonly Readonly<Record<string, unknown>>[];
  readonly orphan_selected_pack_ids: readonly string[];
  readonly warnings: readonly AcceptanceCoverageGapWarning[];
  readonly complete: boolean;
}
export function evaluateAcceptanceCoverage(input: {
  obligationCoverage: ObligationCoverageCarrier;
  guaranteeSelectorIndex: ObligationGuaranteeSelectorIndex;
  selectedPackIds: readonly string[];
  staleObligationIds?: readonly string[];
}): ObligationCoverageEvaluationResult;

export interface AcceptanceCoverageCriterionAxesInput {
  criterionIdentity: string;
  structuralVerification: AcceptanceCoverageState;
  implementationOwnership: AcceptanceCoverageState;
  verificationOwnership: AcceptanceCoverageState;
  scopeFeasibility: AcceptanceCoverageState;
}

export type AcceptanceCoverageSelector =
  | Readonly<{ criterionIdentity: string }>
  | Readonly<{ nodeId: string }>;

export interface AcceptanceCoverageAxisSummary {
  readonly axis: AcceptanceCoverageAxis;
  readonly state: AcceptanceCoverageState;
  readonly totals_by_state: Readonly<Record<AcceptanceCoverageState, number>>;
}

export interface AcceptanceCoverageProjectionResult {
  readonly version: "acceptance-coverage-projection.v1";
  readonly criterion_identity_digest: string;
  readonly projection_digest: string;
  readonly axes: readonly AcceptanceCoverageAxisSummary[];
  readonly selector: Readonly<{
    criterion_identity?: string;
    node_id?: string;
  }> | null;
  readonly totals: Readonly<{
    criteria: number;
    nodes: number;
    gaps: number;
    fully_covered_criteria: number;
    selected_items: number;
  }>;
  readonly page: Readonly<{
    offset: number;
    returned: number;
    total: number;
    items: readonly Readonly<Record<string, unknown>>[];
    continuation: string | null;
  }>;
  readonly covered_detail: Readonly<{
    total: number;
    retrieval: Readonly<{
      function: "projectAcceptanceCoverage";
      selectors: readonly ["criterionIdentity", "nodeId"];
      continuation: "cursor";
    }>;
  }>;
}

export type ObligationCoverageProjectionSelector =
  | Readonly<{ obligationId: string }>
  | Readonly<{ sourceLocator: string }>
  | Readonly<{ controlledContractNodeId: string }>
  | Readonly<{ mechanism: Readonly<{ owner: string; kind: string; selector: string }> }>
  | Readonly<{ packId: string }>
  | Readonly<{ guaranteeSelector: Readonly<{ kind: string; componentId: string }> }>
  | Readonly<{ outcome: ObligationCoverageOutcome }>;
export interface ObligationCoverageProjectionResult {
  readonly version: "acceptance-obligation-coverage-projection.v1";
  readonly mode: "obligation_coverage";
  readonly wk_id: string;
  readonly focus: string | null;
  readonly complete: boolean;
  readonly diagnostics: readonly Readonly<Record<string, unknown>>[];
  readonly selector: Readonly<Record<string, unknown>> | null;
  readonly totals: Readonly<{
    total: number;
    outcomes: Readonly<Record<ObligationCoverageOutcome, number>>;
    invalid_mapping: number;
  }>;
  readonly items: readonly ObligationCoverageEvaluationResult["obligation_outcomes"][number][];
}

export class AcceptanceCoverageProjectionError extends Error {
  code: string;
  details: Record<string, unknown>;
}

export const ACCEPTANCE_COVERAGE_AXES: readonly AcceptanceCoverageAxis[];
export const DEFAULT_ACCEPTANCE_COVERAGE_PAGE_SIZE: number;
export const MAX_ACCEPTANCE_COVERAGE_PAGE_SIZE: number;
export function projectAcceptanceCoverage(input: {
  evaluation: AcceptanceCoverageEvaluationResult;
  criterionIdentities: AcceptanceCoverageCriterionIdentitySet;
  criterionAxes: readonly AcceptanceCoverageCriterionAxesInput[];
  selector?: AcceptanceCoverageSelector | null;
  cursor?: string;
  pageSize?: number;
}): AcceptanceCoverageProjectionResult;
export function projectAcceptanceCoverage(input: {
  evaluation: ObligationCoverageEvaluationResult;
  selector?: ObligationCoverageProjectionSelector | null;
}): ObligationCoverageProjectionResult;

export {
  CONTROLLED_CONTRACT_CARRIER_PATCH_LIMITS, CONTROLLED_CONTRACT_CARRIER_TARGETS,
  carrierValueId, carrierPatchRequestProjection, applyControlledContractCarrierPatch
} from "./current-carrier-patch.mjs";
export type {
  ControlledContractCarrierKind, ControlledContractCarrierPatchOperation
} from "./current-carrier-patch.mjs";

export {
  PROOF_GRAPH_PROPOSAL_SCHEMA_VERSION, PROOF_GRAPH_PROPOSAL_FIELDS,
  PROOF_GRAPH_PROPOSAL_LIMITS, PROOF_GRAPH_CARRIER_KINDS, PROOF_GRAPH_OPERATION_KINDS,
  ProofGraphProposalError, projectProofGraphProposal, measureProofGraphProposalBytes,
  validateProofGraphProposal, PROOF_GRAPH_COMPOSITION_SCHEMA_VERSION,
  PROOF_GRAPH_CARRIER_ORDER, PROOF_GRAPH_PERMITTED_CROSS_CARRIER_JOIN,
  PROOF_GRAPH_FORBIDDEN_CROSS_CARRIER_JOIN_TARGETS, ProofGraphCompositionError,
  composeProofGraphCarrierSet
} from "./current-proof-graph.mjs";
export type {
  ProofGraphCarrierOperation, ProofGraphExpectedSource, ControlledProofGraphProposal,
  AdmittedControlledProofGraphProposal, ProofGraphProspectiveCarrier,
  ProofGraphCrossCarrierBinding, ProofGraphUnresolvedPointer,
  ControlledProofGraphCompositionResult
} from "./current-proof-graph.mjs";
export {
  ControlledContractRefactorError,
  REFACTOR_GRAPH_LIMITS,
  REFACTOR_GRAPH_SCHEMA_VERSION,
  REFACTOR_MODES,
  buildControlledContractRefactorClosure,
  planControlledContractRefactor
} from "./lib/refactor-graph-v1.mjs";
export type {
  ControlledContractRefactorCarrier,
  ControlledContractRefactorMode
} from "./lib/refactor-graph-v1.mjs";

export {
  ARTIFACT_SET_IDENTITY_DOMAIN,
  ARTIFACT_SET_PROVENANCE_REFUSAL_CODES,
  ARTIFACT_SET_PROVENANCE_SCHEMA,
  ARTIFACT_SET_PROVENANCE_SCHEMA_VERSION,
  ArtifactSetProvenanceError,
  PACKAGE_POPULATION_ID as ARTIFACT_SET_PACKAGE_POPULATION_ID,
  PACKED_ARTIFACT_POPULATION_ID as ARTIFACT_SET_PACKED_ARTIFACT_POPULATION_ID,
  buildArtifactSetProvenance,
  validateArtifactSetProvenance,
  verifyArtifactSetProvenance
} from "./lib/artifact-set-provenance.mjs";
export type {
  ArtifactSetProvenanceCarrier,
  ArtifactSetProvenanceExpectation,
  ArtifactSetProvenanceInput,
  ArtifactSetProvenanceValidation,
  ArtifactSetProvenanceVerification,
  AuthenticationProvenanceWitnesses,
  BoundCompletePopulation,
  BoundPopulationInput,
  PackageMemberInput,
  PackedArtifactMemberInput
} from "./lib/artifact-set-provenance.mjs";

export {
  WRITE_CONFINEMENT_CAPTURE_REFUSAL_CODES, WRITE_CONFINEMENT_CAPTURE_SCHEMA_VERSION,
  WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION, WRITE_CONFINEMENT_PROFILE_ID,
  WRITE_CONFINEMENT_PROFILE_VERSION, mapWriteConfinementCapture,
  canonicalWriteConfinementEvaluationInputJson
} from "./current-write-confinement.mjs";
export type {
  WriteConfinementCaptureRefusalCode, WriteConfinementReferenceIdentity,
  WriteConfinementReference, WriteConfinementReferenceBinding,
  WriteConfinementEvaluationInput, WriteConfinementCaptureSource,
  WriteConfinementCaptureRefusal, WriteConfinementCaptureMapped,
  WriteConfinementCaptureRefused, WriteConfinementCaptureResult
} from "./current-write-confinement.mjs";

export {
  BEHAVIORAL_PRESERVATION_CAPTURE_REFUSAL_CODES,
  BEHAVIORAL_PRESERVATION_CAPTURE_SCHEMA_VERSION,
  BEHAVIORAL_PRESERVATION_CAPTURE_INPUT_SCHEMA_VERSION,
  BEHAVIORAL_PRESERVATION_REPORT_SCHEMA_VERSION, BEHAVIORAL_PRESERVATION_PROFILE_ID,
  BEHAVIORAL_PRESERVATION_PROFILE_VERSION, BEHAVIORAL_PRESERVATION_SIDES,
  mapBehavioralPreservationCapture, canonicalBehavioralPreservationEvaluationInputJson
} from "./current-behavioral-preservation.mjs";
export type {
  BehavioralPreservationCaptureRefusalCode, BehavioralPreservationSide,
  BehavioralPreservationObservable, BehavioralPreservationReport,
  BehavioralPreservationSourceDescriptor, BehavioralPreservationCaptureSide,
  BehavioralPreservationCaptureInput, BehavioralPreservationReferenceIdentity,
  BehavioralPreservationReference, BehavioralPreservationReferenceBinding,
  BehavioralPreservationNumberBinding, BehavioralPreservationEvaluationInput,
  BehavioralPreservationCaptureSourceSide, BehavioralPreservationCaptureSource,
  BehavioralPreservationCaptureRefusal, BehavioralPreservationCaptureMapped,
  BehavioralPreservationCaptureRefused, BehavioralPreservationCaptureResult
} from "./current-behavioral-preservation.mjs";

export {
  DECLARED_BOUNDARY_CAPTURE_REFUSAL_CODES, DECLARED_BOUNDARY_CAPTURE_SCHEMA_VERSION,
  DECLARED_BOUNDARY_CAPTURE_INPUT_SCHEMA_VERSION, DECLARED_BOUNDARY_PROFILE_ID,
  DECLARED_BOUNDARY_PROFILE_VERSION, DECLARED_BOUNDARY_OBSERVATION_PROVENANCE,
  DECLARED_BOUNDARY_NOT_ESTABLISHED, mapDeclaredBoundaryCapture,
  canonicalDeclaredBoundaryEvaluationInputJson, canonicalDeclaredBoundaryReportJson
} from "./current-declared-boundary.mjs";
export type {
  DeclaredBoundaryCaptureRefusalCode, DeclaredBoundaryArtifactSource,
  DeclaredBoundaryCaptureInput, DeclaredBoundaryReferenceIdentity,
  DeclaredBoundaryReference, DeclaredBoundaryReferenceBinding,
  DeclaredBoundaryNumberBinding, DeclaredBoundaryEvaluationInput,
  DeclaredBoundaryCensusCase, DeclaredBoundaryCensusLimit, DeclaredBoundaryCensus,
  DeclaredBoundaryCaptureSource, DeclaredBoundaryCaptureRefusal,
  DeclaredBoundaryCaptureMapped, DeclaredBoundaryCaptureRefused,
  DeclaredBoundaryCaptureResult
} from "./current-declared-boundary.mjs";

export {
  COMPILED_VALIDATOR_CACHE_FORMAT_VERSION, CompiledValidatorCacheError,
  compiledValidatorCacheRoot, compiledValidatorCacheStatus, loadCompiledValidatorCache,
  prepareCompiledValidatorCache
} from "./current-compiled-validator-cache.mjs";
export type {
  CompiledValidatorCacheGroupStatus, CompiledValidatorCacheStatus
} from "./current-compiled-validator-cache.mjs";
