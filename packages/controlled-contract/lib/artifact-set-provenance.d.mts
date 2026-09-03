export const ARTIFACT_SET_PROVENANCE_SCHEMA_VERSION:
  "controlled-contract-artifact-set-provenance.v1";
export const ARTIFACT_SET_IDENTITY_DOMAIN:
  "controlled-contract-artifact-set-provenance.v1";
export const PACKAGE_POPULATION_ID: "ref-artifact-set-package-population";
export const PACKED_ARTIFACT_POPULATION_ID:
  "ref-artifact-set-packed-artifact-population";
export const ARTIFACT_SET_PROVENANCE_SCHEMA: Record<string, unknown>;
export const ARTIFACT_SET_PROVENANCE_REFUSAL_CODES: readonly string[];

export interface BoundedDiagnostic {
  readonly code: string;
  readonly pointer: string;
  readonly keyword: string;
  readonly reason_code: string;
  readonly reason: string;
  readonly message: string;
  readonly expected_identity: string | null;
  readonly actual_identity: string | null;
  readonly content_truncated: boolean;
}

export interface BoundedDiagnosticProjection {
  readonly diagnostic_projection_version: string;
  readonly total_count: number;
  readonly returned_count: number;
  readonly omitted_count: number;
  readonly truncated: boolean;
  readonly diagnostics: readonly BoundedDiagnostic[];
}

export class ArtifactSetProvenanceError extends Error {
  readonly name: "ArtifactSetProvenanceError";
  readonly code: string;
  readonly diagnostics: BoundedDiagnosticProjection;
}

/** The six exact witness byte sources of the authentication-provenance owner. */
export interface AuthenticationProvenanceWitnesses {
  readonly evidenceContentBytes: Buffer;
  readonly targetResolutionWitnessBytes: Buffer;
  readonly sourceAuthenticationWitnessBytes: Buffer;
  readonly sourceOfRecordAssignmentWitnessBytes: Buffer;
  readonly attemptBindingWitnessBytes: Buffer;
  readonly authenticationWitnessBytes: Buffer;
}

export interface PackageMemberInput {
  readonly member_id: string;
  readonly type_term: string;
  readonly declared_version: string;
  readonly declared_content_sha256: string;
}

export interface PackedArtifactMemberInput extends PackageMemberInput {
  readonly package_member_id: string;
}

export interface BoundPopulationInput<Member> {
  readonly complete_capture_source_set_sha256: string;
  readonly members: readonly Member[];
}

export interface ArtifactSetProvenanceInput {
  readonly authentication_provenance_witnesses: AuthenticationProvenanceWitnesses;
  readonly binding_set_sha256: string;
  readonly package_population: BoundPopulationInput<PackageMemberInput>;
  readonly artifact_population: BoundPopulationInput<PackedArtifactMemberInput>;
}

export interface BoundCompletePopulation<Member> {
  readonly population_version: "controlled-contract.complete-population.v1";
  readonly population_id: string;
  readonly completeness: "exact";
  readonly authenticated: true;
  readonly ordered: true;
  readonly cardinality: number;
  readonly complete_capture_source_set_sha256: string;
  readonly members: readonly Member[];
}

export interface ArtifactSetProvenanceCarrier {
  readonly schema_version: "controlled-contract-artifact-set-provenance.v1";
  readonly authentication_provenance_capture: Record<string, unknown>;
  readonly complete_capture_source_set_sha256: string;
  readonly binding_set_sha256: string;
  readonly package_population: BoundCompletePopulation<PackageMemberInput>;
  readonly artifact_population: BoundCompletePopulation<PackedArtifactMemberInput>;
  readonly artifact_set_sha256: string;
}

export interface ArtifactSetProvenanceValidation {
  readonly carrier: ArtifactSetProvenanceCarrier;
  readonly artifact_set_sha256: string;
}

export interface ArtifactSetProvenanceExpectation {
  readonly artifact_set_sha256?: string;
  readonly binding_set_sha256?: string;
  readonly complete_capture_source_set_sha256?: string;
}

export interface ArtifactSetProvenanceVerification {
  readonly verified: true;
  readonly schema_version: "controlled-contract-artifact-set-provenance.v1";
  readonly artifact_set_sha256: string;
  readonly complete_capture_source_set_sha256: string;
  readonly binding_set_sha256: string;
  readonly package_cardinality: number;
  readonly artifact_cardinality: number;
}

export function buildArtifactSetProvenance(
  input: ArtifactSetProvenanceInput
): ArtifactSetProvenanceCarrier;

export function validateArtifactSetProvenance(
  carrier: unknown
): ArtifactSetProvenanceValidation;

export function verifyArtifactSetProvenance(
  carrier: unknown,
  expected?: ArtifactSetProvenanceExpectation
): ArtifactSetProvenanceVerification;
