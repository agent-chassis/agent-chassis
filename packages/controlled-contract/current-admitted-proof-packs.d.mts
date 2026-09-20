export class AdmittedProofPackError extends Error {
  code: string;
  details: Record<string, unknown>;
}
export type ComponentExclusionApplicabilitySelectorKind =
  | "reference_binding"
  | "claim"
  | "relation"
  | "collection"
  | "resolver_fact"
  | "evidence";
export interface ComponentExclusionApplicabilityComponent {
  selector: {
    kind: ComponentExclusionApplicabilitySelectorKind;
    component_id: string;
  };
  exclusion_ids: string[];
  applicable_exclusion_ids: string[];
}
export interface ComponentExclusionApplicability {
  schema_version: "controlled-contract-component-exclusion-applicability.v2";
  profile_id: string;
  profile_version: string;
  profile_digest: string;
  admission_digest: string;
  components: ComponentExclusionApplicabilityComponent[];
}
export interface ComponentExclusionApplicabilityValidationResult {
  component_exclusion_applicability: ComponentExclusionApplicability | null;
  component_exclusion_applicability_digest: string | null;
}
export function assertComponentExclusionApplicability(
  companion: ComponentExclusionApplicability | null,
  profile: Record<string, unknown>,
  admission: Record<string, unknown>
): ComponentExclusionApplicabilityValidationResult;
/**
 * The exact immutable pack snapshot minted by `loadAdmittedProofPack`.
 *
 * Runtime identity is registry membership, not shape: an object that merely
 * matches this declaration is refused by every capability that authenticates a
 * snapshot. Obtain one only from `loadAdmittedProofPack`.
 */
export interface AdmittedProofPackSnapshot {
  readonly profile: Readonly<Record<string, unknown>>;
  readonly admission: Readonly<Record<string, unknown>>;
  readonly profile_digest: string;
  readonly admission_digest: string;
  readonly catalog_entry: Readonly<Record<string, unknown>>;
  readonly admission_version: 3;
  readonly parameter_contract: import("./lib/pack-parameter-contract.d.mts").PackParameterContract;
  readonly parameter_contract_digest: string;
  readonly component_exclusion_applicability:
    Readonly<ComponentExclusionApplicability> | null;
  readonly component_exclusion_applicability_digest: string | null;
}
export function loadAdmittedProofPack(
  profileId: string
): Promise<AdmittedProofPackSnapshot>;
export interface AdmittedProofPackCatalogEntry {
  readonly profile_id: string;
  readonly profile_version: string;
  readonly path: string;
}
export interface AdmittedProofPackCatalog {
  readonly schema_version: "controlled-contract-proof-pack-catalog.v1";
  readonly packs: readonly AdmittedProofPackCatalogEntry[];
}
export function readProofPackCatalog():
  Promise<AdmittedProofPackCatalog>;

/**
 * The exact deeply frozen object returned by `evaluateVerificationProfileV1`.
 *
 * Runtime acceptance is package registry identity, not structural compatibility.
 * Copies, spreads, and caller-built values matching this interface are refused.
 */
export interface PackageMintedVerificationProfileV1Result {
  readonly result_version: "controlled-contract-verification-profile-result.v2";
  readonly profile: Readonly<{
    profile_id: string | null;
    profile_version: string | null;
  }>;
  readonly admission: Readonly<{ profile_digest: string }>;
  readonly pattern_results: readonly Readonly<Record<string, unknown>>[];
}
export interface AssessmentComponentExclusionApplicability {
  readonly projection_version:
    "controlled-contract-assessment-component-exclusion-applicability.v2";
  readonly assessment_cycle_digest: string;
  readonly profile_id: string;
  readonly profile_version: string;
  readonly profile_digest: string;
  readonly admission_digest: string;
  readonly component_exclusion_applicability_digest: string;
  readonly source_digests: Readonly<Record<string, string | null>>;
  readonly components: readonly ComponentExclusionApplicabilityComponent[];
}
