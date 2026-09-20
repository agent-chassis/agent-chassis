export const WRITE_CONFINEMENT_VERIFICATION_REFUSAL_CODES: Readonly<{
  MISSING_REQUIRED_INPUT:
    "controlled_contract.write_confinement_verification.missing_required_input.v1";
  MALFORMED_ENVELOPE:
    "controlled_contract.write_confinement_verification.malformed_envelope.v1";
  WRONG_LAUNCHER_ARTIFACT:
    "controlled_contract.write_confinement_verification.wrong_launcher_artifact.v1";
  EVIDENCE_SCHEMA_VERSION_UNSUPPORTED:
    "controlled_contract.write_confinement_verification.evidence_schema_version_unsupported.v1";
  UNPROJECTED_ENVELOPE:
    "controlled_contract.write_confinement_verification.unprojected_envelope.v1";
  MALFORMED_EVIDENCE:
    "controlled_contract.write_confinement_verification.malformed_evidence.v1";
  EVIDENCE_AUTHORITY_UNSUPPORTED:
    "controlled_contract.write_confinement_verification.evidence_authority_unsupported.v1";
  POPULATION_NONCANONICAL:
    "controlled_contract.write_confinement_verification.population_noncanonical.v1";
  POPULATION_INCONSISTENT:
    "controlled_contract.write_confinement_verification.population_inconsistent.v1";
}>;
export type WriteConfinementVerificationRefusalCode =
  typeof WRITE_CONFINEMENT_VERIFICATION_REFUSAL_CODES[
    keyof typeof WRITE_CONFINEMENT_VERIFICATION_REFUSAL_CODES
  ];
export const WRITE_CONFINEMENT_VERIFICATION_SCHEMA_VERSION:
  "controlled-contract-write-confinement-verification.v1";
export const WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION:
  "workspace-agent-write-confinement-evidence.v1";
export const WRITE_CONFINEMENT_PROFILE_ID: "proof.scope.write-confinement";
export const WRITE_CONFINEMENT_PROFILE_VERSION: "2.0.0";

/** The inner launcher write-confinement evidence object, matched by its exact field set. */
export interface WriteConfinementEvidence {
  readonly schema_version: typeof WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION;
  readonly authority: "authenticated_observation_only";
  readonly observation_boundary: "base_to_delivery_tree_delta";
  readonly not_covered: readonly string[];
  readonly repository: string;
  readonly run_id: string;
  readonly attempt: number;
  readonly record_id: string;
  readonly unit_address: string;
  readonly selected_unit: Readonly<Record<string, unknown>>;
  readonly frozen_write_scope: readonly string[];
  readonly base_commit: string;
  readonly delivery_commit: string;
  readonly delivery_tree: string;
  readonly contained: boolean;
  readonly changed_paths: readonly string[];
  readonly outside_write_scope_paths: readonly string[];
  readonly inside_write_scope_paths: readonly string[];
  readonly changed_path_count: number;
  readonly outside_write_scope_path_count: number;
  readonly inside_write_scope_path_count: number;
  readonly populations_complete: true;
  readonly source_digest: string;
  readonly result_digest: string;
  readonly observed_at: string;
  readonly admission_effect: "none";
  readonly review_effect: "none";
  readonly integration_effect: "none";
  readonly publication_effect: "none";
  readonly closure_effect: "none";
  readonly proof_pack_applicability: "none";
  readonly cce_effect: "none";
  readonly semantic_judgment: "not_performed_coordinator_owned";
}
/** The launcher projection envelope that carries one evidence object. */
export interface WriteConfinementProjectionEnvelope {
  readonly schema_version: typeof WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION;
  readonly projected: boolean;
  readonly evidence: WriteConfinementEvidence | null;
  readonly evidence_digest: string;
  readonly state_changed: boolean;
  readonly authority: string;
  readonly refusal: Readonly<Record<string, unknown>> | null;
}
export interface WriteConfinementVerificationSource {
  readonly repository: string;
  readonly run_id: string;
  readonly attempt: number;
  readonly record_id: string;
  readonly unit_address: string;
  readonly base_commit: string;
  readonly delivery_commit: string;
  readonly delivery_tree: string;
  readonly source_digest: string;
  readonly result_digest: string;
  readonly evidence_digest: string | null;
}
export interface WriteConfinementVerificationPopulations {
  readonly contained: boolean;
  readonly frozen_write_scope: readonly string[];
  readonly changed_paths: readonly string[];
  readonly inside_write_scope_paths: readonly string[];
  readonly outside_write_scope_paths: readonly string[];
  readonly changed_path_count: number;
  readonly inside_write_scope_path_count: number;
  readonly outside_write_scope_path_count: number;
}
export interface WriteConfinementVerificationRefusal {
  readonly code: WriteConfinementVerificationRefusalCode;
  readonly reason: string;
  readonly detail: Readonly<Record<string, unknown>> | null;
}
interface WriteConfinementVerificationBase {
  readonly schema_version: typeof WRITE_CONFINEMENT_VERIFICATION_SCHEMA_VERSION;
  readonly profile_id: typeof WRITE_CONFINEMENT_PROFILE_ID;
  readonly profile_version: typeof WRITE_CONFINEMENT_PROFILE_VERSION;
  readonly evidence_schema_version: typeof WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION;
}
export interface WriteConfinementVerified extends WriteConfinementVerificationBase {
  readonly verified: true;
  readonly source: WriteConfinementVerificationSource;
  readonly populations: WriteConfinementVerificationPopulations;
  readonly refusal: null;
}
export interface WriteConfinementVerificationRefused extends WriteConfinementVerificationBase {
  readonly verified: false;
  readonly source: null;
  readonly populations: null;
  readonly refusal: WriteConfinementVerificationRefusal;
}
export type WriteConfinementVerificationResult =
  WriteConfinementVerified | WriteConfinementVerificationRefused;

/** Verify one inner write-confinement evidence object. Refusals are returned, never thrown. */
export function verifyWriteConfinementEvidence(
  evidence?: WriteConfinementEvidence | unknown
): WriteConfinementVerificationResult;
/** Verify one launcher projection envelope and the evidence it carries. */
export function verifyWriteConfinementProjection(
  projection?: WriteConfinementProjectionEnvelope | unknown
): WriteConfinementVerificationResult;
