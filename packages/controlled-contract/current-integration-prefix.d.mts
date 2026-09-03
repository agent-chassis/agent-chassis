export type IntegrationPrefixCompatibilityCode = "admission_unavailable" | "malformed_artifact" |
  "proof_pack_admission_binding_mismatch" | "proof_pack_source_mismatch" | "schema_owner_unavailable" |
  "source_changed" | "source_unavailable" | "unexpected_artifact";
type IntegrationPrefixErrorCode = IntegrationPrefixCompatibilityCode | "proof_pack_catalog_invalid" |
  "proof_pack_catalog_identity_ambiguous" | "proof_pack_not_found" | "proof_pack_admission_missing" |
  "proof_pack_admission_invalid" | "proof_pack_snapshot_unrecognized";
export class IntegrationPrefixCompatibilityError extends Error {
  code: IntegrationPrefixCompatibilityCode;
  details: Readonly<Record<string, unknown>>;
}
export const ARTIFACTS: readonly ["profile.json", "admission.json", "evaluation-input.template.json",
  "exact-binding.json", "exact-binding-certification.json"];
export interface IntegrationPrefixArtifactBinding { readonly path: string; readonly sha256: string; }
export interface IntegrationPrefixCompatibilitySources {
  readonly old: Readonly<Record<typeof ARTIFACTS[number], IntegrationPrefixArtifactBinding>>;
  readonly current: Readonly<Record<typeof ARTIFACTS[number], IntegrationPrefixArtifactBinding>>;
}
type IntegrationPrefixJson = null | boolean | number | string | readonly IntegrationPrefixJson[] |
  { readonly [key: string]: IntegrationPrefixJson };
interface IntegrationPrefixArtifact { readonly path: string; readonly digest: string; readonly bytes: Buffer; readonly value: IntegrationPrefixJson & { readonly [key: string]: IntegrationPrefixJson }; }
type IntegrationPrefixSourceMap = Readonly<Record<typeof ARTIFACTS[number], IntegrationPrefixArtifact>>;
export interface IntegrationPrefixCatalogEntry { readonly profile_id: string; readonly profile_version: string; readonly path: string; }
export interface IntegrationPrefixCatalog { readonly packs: readonly IntegrationPrefixCatalogEntry[]; }
export interface IntegrationPrefixAdmission {
  readonly profile: IntegrationPrefixJson & { readonly profile_id: string; readonly profile_version: string; readonly [key: string]: IntegrationPrefixJson };
  readonly admission: IntegrationPrefixJson & { readonly profile_id: string; readonly profile_version: string; readonly [key: string]: IntegrationPrefixJson };
  readonly profile_digest: string; readonly admission_digest: string; readonly catalog_entry: IntegrationPrefixCatalogEntry;
  readonly admission_version: 1 | 2;
}
export interface IntegrationPrefixCompatibilityDifference {
  readonly pointer: string; readonly old_value?: unknown; readonly new_value?: unknown; readonly classification?: string;
}
interface IntegrationPrefixComparison { readonly equal: boolean; readonly differences: readonly IntegrationPrefixCompatibilityDifference[]; }
interface IntegrationPrefixIdentity {
  readonly schema_version: string | null; readonly profile_id: string | null; readonly profile_version: string | null;
  readonly profile_digest: string | null; readonly exact_binding_declaration_digest: string | null;
}
interface IntegrationPrefixCorpusIdentity {
  readonly admission: IntegrationPrefixJson; readonly certification: IntegrationPrefixJson;
}
interface IntegrationPrefixComparisonComponents {
  readonly guarantee: IntegrationPrefixComparison; readonly claims: IntegrationPrefixComparison; readonly relations: IntegrationPrefixComparison;
  readonly roles: IntegrationPrefixComparison; readonly counts: IntegrationPrefixComparison; readonly binding_patterns: IntegrationPrefixComparison;
  readonly reference_role_count_bindings: IntegrationPrefixComparison; readonly exact_binding_requirements: IntegrationPrefixComparison;
  readonly exact_binding_relations: IntegrationPrefixComparison; readonly exact_binding_roles: IntegrationPrefixComparison;
  readonly relation_patterns: IntegrationPrefixComparison;
  readonly exclusions: IntegrationPrefixComparison; readonly carrier_schema: { readonly old: string; readonly current: string };
  readonly input_schema: { readonly old: string; readonly current: string }; readonly vocabulary: { readonly old: string; readonly current: string };
  readonly stable_evaluation: { readonly old: IntegrationPrefixJson; readonly current: IntegrationPrefixJson };
  readonly certification_identity: { readonly old: IntegrationPrefixJson; readonly current: IntegrationPrefixJson };
  readonly declaration_identity: { readonly old: IntegrationPrefixIdentity; readonly current: IntegrationPrefixIdentity };
  readonly certification_result_identity: { readonly old: IntegrationPrefixIdentity; readonly current: IntegrationPrefixIdentity };
  readonly corpus_identity: { readonly old: IntegrationPrefixCorpusIdentity; readonly current: IntegrationPrefixCorpusIdentity };
}
interface IntegrationPrefixCompatibilityBase { readonly schema_version: "controlled-contract-integration-prefix-compatibility.v1"; }
interface IntegrationPrefixUnavailable extends IntegrationPrefixCompatibilityBase {
  readonly outcome: "source_unavailable"; readonly sources?: IntegrationPrefixCompatibilitySources; readonly differences?: readonly IntegrationPrefixCompatibilityDifference[];
  readonly error: Readonly<{ code: IntegrationPrefixErrorCode; details: Readonly<{ readonly [key: string]: unknown }> }>;
}
interface IntegrationPrefixIncompatible extends IntegrationPrefixCompatibilityBase {
  readonly outcome: "incompatible"; readonly sources: IntegrationPrefixCompatibilitySources; readonly differences: readonly IntegrationPrefixCompatibilityDifference[];
  readonly source_profile?: never;
  readonly error: Readonly<{ code: IntegrationPrefixErrorCode; details: Readonly<{ readonly [key: string]: unknown }> }>;
}
interface IntegrationPrefixComparisonPayload {
  readonly sources: IntegrationPrefixCompatibilitySources; readonly source_profile: Readonly<{ profile_id: string; profile_version: string }>;
  readonly target_profile: Readonly<{ profile_id: string; profile_version: string }>; readonly differences: readonly IntegrationPrefixCompatibilityDifference[];
  readonly comparison: IntegrationPrefixComparisonComponents; readonly migration: Readonly<{ total: number; explicit: readonly IntegrationPrefixCompatibilityDifference[]; complete: boolean }>;
  readonly catalog: Readonly<{ admitted: boolean; entry: IntegrationPrefixCatalogEntry | null }>;
  readonly admission: Readonly<{ observed: true; profile_digest: string; version: number }>;
  readonly profile_digests: Readonly<{ old: string; current: string }>; readonly canonical_result_digest: string;
  readonly authoritative: false; readonly route_compatible: false; readonly proof_credit: false;
}
interface IntegrationPrefixSuccess extends IntegrationPrefixCompatibilityBase, IntegrationPrefixComparisonPayload {
  readonly outcome: "lossless_with_migration";
}
interface IntegrationPrefixSemanticIncompatible extends IntegrationPrefixCompatibilityBase, IntegrationPrefixComparisonPayload {
  readonly outcome: "incompatible";
  readonly error?: never;
}
export type IntegrationPrefixCompatibilityResult = Readonly<IntegrationPrefixSuccess | IntegrationPrefixSemanticIncompatible |
  IntegrationPrefixIncompatible | IntegrationPrefixUnavailable>;
type IntegrationPrefixObserved = Readonly<{ catalog: IntegrationPrefixCatalog; admission: IntegrationPrefixAdmission; canonicalSources: IntegrationPrefixSourceMap }>;
type IntegrationPrefixCallback<T> = () => Promise<T>;
export interface IntegrationPrefixCompatibilityOptions {
  readonly oldDirectory?: string; readonly currentDirectory?: string;
  readonly readProofPackCatalog?: IntegrationPrefixCallback<IntegrationPrefixCatalog>;
  readonly loadAdmittedProofPack?: (profileId: string) => Promise<IntegrationPrefixAdmission>;
  readonly readCanonicalSources?: IntegrationPrefixCallback<IntegrationPrefixSourceMap>;
  readonly beforeFinalObservation?: (observation: IntegrationPrefixObserved) => void | Promise<void>;
}
export function compareIntegrationPrefixCaptureCompatibility(options?: IntegrationPrefixCompatibilityOptions):
  Promise<IntegrationPrefixCompatibilityResult>;
export const compareIntegrationPrefixCompatibility: typeof compareIntegrationPrefixCaptureCompatibility;
