import type { IntegrationPrefixCatalog } from "./current-integration-prefix.mjs";

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
  evaluation_stage: string;
  exclusion_ids: string[];
  applicable_exclusion_ids: string[];
}
export interface ComponentExclusionApplicability {
  schema_version: "controlled-contract-component-exclusion-applicability.v1";
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
  readonly admission_version: 1 | 2;
  readonly component_exclusion_applicability:
    Readonly<ComponentExclusionApplicability> | null;
  readonly component_exclusion_applicability_digest: string | null;
}
export function loadAdmittedProofPack(
  profileId: string
): Promise<AdmittedProofPackSnapshot>;
export function readProofPackCatalog():
  Promise<IntegrationPrefixCatalog>;

/**
 * The exact deeply frozen object returned by `evaluateVerificationProfileV1`.
 *
 * Runtime acceptance is package registry identity, not structural compatibility.
 * Copies, spreads, and caller-built values matching this interface are refused.
 */
export interface PackageMintedVerificationProfileV1Result {
  readonly result_version: "controlled-contract-verification-profile-result.v1";
  readonly profile: Readonly<{
    profile_id: string | null;
    profile_version: string | null;
  }>;
  readonly evaluation_stage: string | null;
  readonly admission: Readonly<{ profile_digest: string }>;
  readonly pattern_results: readonly Readonly<Record<string, unknown>>[];
}
/**
 * The exact result object minted by the package's deterministic capture owner.
 * Runtime acceptance is package registry identity; copies and caller-built
 * values matching this interface are refused.
 */
export interface PackageMintedExactBindingResult {
  readonly schema_version: "controlled-contract-exact-binding-result.v1";
  readonly provenance: Readonly<{
    capture_verified: boolean;
  }>;
  readonly context: Readonly<{
    profile_digest: string;
    admission_digest: string;
    exact_binding_declaration_digest: string;
    exact_binding_certification_digest: string;
  }>;
  readonly satisfaction: "satisfied" | "unsatisfied" | "indeterminate" | "invalid";
}

export interface AssessmentComponentExclusionApplicability {
  readonly projection_version:
    "controlled-contract-assessment-component-exclusion-applicability.v1";
  readonly assessment_cycle_digest: string;
  readonly profile_id: string;
  readonly profile_version: string;
  readonly profile_digest: string;
  readonly admission_digest: string;
  readonly component_exclusion_applicability_digest: string;
  readonly source_digests: Readonly<Record<string, string | null>>;
  readonly components: readonly ComponentExclusionApplicabilityComponent[];
}
