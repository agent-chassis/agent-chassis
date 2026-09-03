export const TEST_PROOF_PROVIDER_REGISTRY_ID: "launcher.test-proof-provider-registry";
export const TEST_PROOF_PROVIDER_REGISTRY_VERSION: "1.0.0";
export const TEST_PROOF_PROVIDER_CATALOG: Readonly<Record<string, unknown>>;
export const TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST: `sha256:${string}`;
export const TEST_PROOF_RUNTIME_EVIDENCE_VERSION_V2:
  "controlled-contract-test-proof-runtime-evidence.v2";
export const TEST_PROOF_RUNTIME_EVIDENCE_SCHEMA_V2:
  Readonly<Record<string, unknown>>;
export const STABLE_TEST_PROOF_AUTHORING_LIMITS: Readonly<Record<string, number>>;
export interface ControlledContractVerificationBundle {
  readonly schema_version: "controlled-contract-verification-bundle.v1";
  readonly verification_id: string;
  readonly references: readonly Record<string, unknown>[];
  readonly propositions: readonly Record<string, unknown>[];
  readonly claims: readonly Record<string, unknown>[];
  readonly relations: readonly Record<string, unknown>[];
  readonly collections: readonly Record<string, unknown>[];
  readonly residue: readonly Record<string, unknown>[];
  readonly annotations: readonly Record<string, unknown>[];
  readonly test_proof: Readonly<Record<string, unknown>>;
}
export interface ControlledContractVerificationBundleOperation {
  readonly op: "upsert" | "remove";
  readonly verification_id: string;
  readonly bundle: ControlledContractVerificationBundle;
}
export const PROVIDER_REFUSAL_PRECEDENCE: readonly string[];

export interface TestProofValidationResult {
  readonly schema_valid: boolean;
  readonly schema_errors: readonly unknown[];
  readonly diagnostics: Readonly<{
    readonly diagnostic_projection_version: string;
    readonly total_count: number;
    readonly returned_count: number;
    readonly omitted_count: number;
    readonly truncated: boolean;
    readonly diagnostics: readonly Readonly<Record<string, unknown>>[];
  }>;
  readonly valid: boolean;
  readonly semantic_judgment: "not_performed_coordinator_owned";
  readonly family?: "stable_v1" | "experimental" | "partial" | "mixed" | "unknown";
  readonly facts?: Readonly<Record<string, unknown>> | null;
}

export class StableTestProofContractError extends Error {
  code: string;
  details: Record<string, unknown>;
}
export function validateStableTestProofContract(
  contract: Record<string, unknown>
): TestProofValidationResult;
export function canonicalStableTestProofContractJson(
  contract: Record<string, unknown>
): string;
export function validateTestProofRuntimeEvidenceV2(
  evidence: Record<string, unknown>
): TestProofValidationResult;
export function describeStableTestProofAuthoring(): Readonly<Record<string, unknown>>;

export const VERIFICATION_BUNDLE_SCHEMA_VERSION:
  "controlled-contract-verification-bundle.v1";
export const VERIFICATION_BUNDLE_FIELDS: readonly string[];
export const VERIFICATION_BUNDLE_VOCABULARY: Readonly<Record<string, unknown>>;
export function buildStableTestProofBindingTemplate(input: {
  contract?: Readonly<Record<string, unknown>> | null;
  verificationId: string;
}): {
  binding: Record<string, unknown>;
  author_semantics: Array<Record<string, unknown>>;
};
export function buildVerificationBundleTemplate(input: {
  contract?: Readonly<Record<string, unknown>> | null;
  verificationId: string;
}): Readonly<{
  schema_version: "controlled-contract-verification-bundle-template.v1";
  verification_id: string;
  bundle: Readonly<Record<string, unknown>>;
  author_semantics: ReadonlyArray<Readonly<Record<string, unknown>>>;
  bound_field_count: number;
  open_semantic_count: number;
}>;
export function queryStableTestProofBindings(input: {
  contract: Record<string, unknown>;
  verificationIds: readonly string[];
}): Readonly<Record<string, unknown>>;
export function resolveStableTestProofBindingPopulation(input: {
  contract: Record<string, unknown>;
  verificationIds: readonly string[];
}): Readonly<Record<string, unknown>>;
export function resolveStableTestProofProviderBindings(
  binding: Record<string, unknown>
): Readonly<Record<string, unknown>>;
export function replaceStableTestProofBindings(input: {
  contract: Record<string, unknown>;
  replacements: readonly Record<string, unknown>[];
}): Readonly<{
  contract: Record<string, unknown>;
  changed_verification_ids: readonly string[];
  semantic_judgment: "not_performed_coordinator_owned";
}>;
export function resolveTestProofProviderCompatibility(
  input: Record<string, unknown>
): Readonly<Record<string, unknown>>;
export const ASSESSMENT_SCHEMA_V2: Readonly<Record<string, unknown>>;
export const MAX_TEST_PROOF_ASSESSMENT_INDEX_BYTES: number;
export const TEST_PROOF_SEMANTIC_JUDGMENT: "not_performed_coordinator_owned";
/**
 * Without `options` (or with `options.runtime` absent) this is the planning
 * assessment, `controlled-contract-assessment.v2`. Supplying an authenticated
 * `controlled-contract-test-proof-runtime-evidence.v2` receipt population selects
 * the runtime assessment instead, which returns
 * `ControlledContractAssessmentV3`; a runtime failure throws a typed refusal
 * rather than falling back to the planning result.
 */
export function assessTestProofContract(
  contract: Record<string, unknown>,
  options?: { readonly runtime?: { readonly receipts: readonly Record<string, unknown>[] } }
): Readonly<Record<string, unknown>> | ControlledContractAssessmentV3;
export function evaluateAdmittedTestValidity(input: {
  contract: Record<string, unknown>;
  evaluationInput: Record<string, unknown>;
  proofPack: Record<string, unknown>;
}): Readonly<Record<string, unknown>>;
export function validateTestProofAssessmentSchema(value: Record<string, unknown>): boolean;

export type RuntimeAssessmentStatus = "proven" | "not_proven";
export type RuntimeAssessmentReceiptKind = "candidate" | "falsifier" | "traversal";
export interface RuntimeAssessmentVerification {
  readonly verification_id: string;
  readonly test_id: string;
}
export interface RuntimeAssessmentIdentity {
  readonly run_id: string;
  readonly wk_id: string;
  readonly selected_unit: string;
  readonly attempt: number;
  /** Every assessed test-execution verification, in the contract's order. */
  readonly verifications: readonly RuntimeAssessmentVerification[];
  readonly contract_digest: `sha256:${string}`;
  readonly source_snapshot_digest: `sha256:${string}`;
  readonly generation_digest: `sha256:${string}`;
}
export interface RuntimeAssessmentReceipt {
  readonly receipt_id: `receipt-${string}`;
  readonly verification_id: string;
  readonly kind: RuntimeAssessmentReceiptKind;
  readonly status: "passed" | "detected" | "proven" | "failed" | "inert" | "unproven" | "refused";
  readonly provider: Readonly<{
    readonly provider_id: string;
    readonly provider_version: string;
    readonly capability: "candidate_execution" | "falsifier_execution" | "boundary_traversal";
  }>;
  readonly authenticated_identity: Readonly<{
    readonly run_id: string;
    readonly source_snapshot_digest: `sha256:${string}`;
    readonly receipt_digest: `sha256:${string}`;
  }>;
  readonly evidence_artifact_ids: readonly string[];
}
export interface ControlledContractAssessmentV3 {
  readonly schema_version: "controlled-contract-assessment.v3";
  readonly assessment_scope: "runtime";
  readonly authority: "non_authoritative";
  readonly assessment_status: RuntimeAssessmentStatus;
  readonly assessment_identity: RuntimeAssessmentIdentity;
  readonly runtime_truth: RuntimeAssessmentStatus;
  readonly profile_discrimination: RuntimeAssessmentStatus;
  readonly population: Readonly<{
    readonly candidate_count: number;
    readonly falsifier_count: number;
    readonly traversal_count: number;
    readonly complete: boolean;
  }>;
  readonly receipts: readonly RuntimeAssessmentReceipt[];
  readonly diagnostics: readonly Readonly<{
    readonly code: `runtime_${string}`;
    readonly pointer: string;
    readonly severity: "error" | "warning" | "info";
    readonly message?: string;
  }>[];
}
