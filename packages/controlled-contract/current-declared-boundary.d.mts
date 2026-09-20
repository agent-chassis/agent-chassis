export const DECLARED_BOUNDARY_VERIFICATION_REFUSAL_CODES: Readonly<{
  MISSING_REQUIRED_INPUT:
    "controlled_contract.declared_boundary_verification.missing_required_input.v1";
  MALFORMED_INPUT:
    "controlled_contract.declared_boundary_verification.malformed_input.v1";
  POLICY_DOCUMENT_UNRESOLVED:
    "controlled_contract.declared_boundary_verification.policy_document_unresolved.v1";
  SUBJECTS_DOCUMENT_UNRESOLVED:
    "controlled_contract.declared_boundary_verification.subjects_document_unresolved.v1";
  OBSERVATION_DOCUMENT_UNRESOLVED:
    "controlled_contract.declared_boundary_verification.observation_document_unresolved.v1";
  POLICY_NOT_CLOSED: "controlled_contract.declared_boundary_verification.policy_not_closed.v1";
  POLICY_AMBIGUOUS: "controlled_contract.declared_boundary_verification.policy_ambiguous.v1";
  MEASUREMENT_UNIT_UNSUPPORTED:
    "controlled_contract.declared_boundary_verification.measurement_unit_unsupported.v1";
  SUBJECT_IDENTITY_DUPLICATE:
    "controlled_contract.declared_boundary_verification.subject_identity_duplicate.v1";
  SUBJECT_POPULATION_MALFORMED:
    "controlled_contract.declared_boundary_verification.subject_population_malformed.v1";
  SUBJECT_POPULATION_INCOMPLETE:
    "controlled_contract.declared_boundary_verification.subject_population_incomplete.v1";
  OBSERVATION_RECORD_MALFORMED:
    "controlled_contract.declared_boundary_verification.observation_record_malformed.v1";
  OBSERVATION_PROVENANCE_UNSUPPORTED:
    "controlled_contract.declared_boundary_verification.observation_provenance_unsupported.v1";
  BOUNDARY_CENSUS_INCOMPLETE:
    "controlled_contract.declared_boundary_verification.boundary_census_incomplete.v1";
  BOUNDARY_CENSUS_DUPLICATE:
    "controlled_contract.declared_boundary_verification.boundary_census_duplicate.v1";
  BOUNDARY_CENSUS_REFERENCE_UNKNOWN:
    "controlled_contract.declared_boundary_verification.boundary_census_reference_unknown.v1";
  BOUNDARY_ARITHMETIC_MISMATCH:
    "controlled_contract.declared_boundary_verification.boundary_arithmetic_mismatch.v1";
  BOUNDARY_DISPOSITION_MISMATCH:
    "controlled_contract.declared_boundary_verification.boundary_disposition_mismatch.v1";
  DERIVATION_REFUSED:
    "controlled_contract.declared_boundary_verification.derivation_refused.v1";
  REPORT_INVALID: "controlled_contract.declared_boundary_verification.report_invalid.v1";
}>;
export type DeclaredBoundaryVerificationRefusalCode =
  typeof DECLARED_BOUNDARY_VERIFICATION_REFUSAL_CODES[
    keyof typeof DECLARED_BOUNDARY_VERIFICATION_REFUSAL_CODES
  ];
export const DECLARED_BOUNDARY_VERIFICATION_SCHEMA_VERSION:
  "controlled-contract-declared-boundary-verification.v1";
export const DECLARED_BOUNDARY_PROFILE_ID: "proof.policy.declared-boundary-record-consistency";
export const DECLARED_BOUNDARY_PROFILE_VERSION: "2.0.0";
export const DECLARED_BOUNDARY_OBSERVATION_PROVENANCE: "caller_asserted";
export const DECLARED_BOUNDARY_NOT_ESTABLISHED: readonly [
  "execution-provenance",
  "policy-to-production-correspondence",
  "production-truth",
  "runtime-enforcement"
];

/** One declared-boundary document: the plain document object or its canonical JSON bytes. */
export type DeclaredBoundaryDocument = Readonly<Record<string, unknown>> | Uint8Array;

export interface DeclaredBoundaryVerificationInput {
  readonly policy: DeclaredBoundaryDocument;
  readonly observation: DeclaredBoundaryDocument;
  readonly subjects: DeclaredBoundaryDocument;
}

export interface DeclaredBoundaryCensusCase {
  readonly boundary_position: string;
  readonly case_id: string;
  readonly subject_id: string;
  readonly measured_value: number;
  readonly observed_disposition: string;
}
export interface DeclaredBoundaryCensusLimit {
  readonly limit_key: string;
  readonly limit_value: number;
  readonly bound_direction: string;
  readonly bound_inclusivity: string;
  readonly overflow_disposition: string;
  readonly normalization: string;
  readonly unit: string;
  readonly measurement_class: string;
  readonly zero_maximum: boolean;
  readonly boundary_positions: readonly string[];
  readonly cases: readonly DeclaredBoundaryCensusCase[];
}
export interface DeclaredBoundaryCensus {
  readonly provenance: typeof DECLARED_BOUNDARY_OBSERVATION_PROVENANCE;
  readonly authority: "caller_declaration_only";
  readonly not_established: readonly string[];
  readonly boundary_case_count: number;
  readonly measured_subject_count: number;
  readonly limits: readonly DeclaredBoundaryCensusLimit[];
}
export interface DeclaredBoundaryVerificationSource {
  readonly observation_provenance: typeof DECLARED_BOUNDARY_OBSERVATION_PROVENANCE;
  readonly source_set_sha256: string;
  readonly source_content_sha256: Readonly<Record<string, string>>;
  readonly report_bytes_sha256: string;
  readonly declared_limit_count: number;
  readonly measurement_unit_count: number;
  readonly boundary_case_count: number;
  readonly measured_subject_count: number;
}
export interface DeclaredBoundaryVerificationRefusal {
  readonly code: DeclaredBoundaryVerificationRefusalCode;
  readonly reason: string;
  readonly detail: Readonly<Record<string, unknown>> | null;
}
interface DeclaredBoundaryVerificationBase {
  readonly schema_version: typeof DECLARED_BOUNDARY_VERIFICATION_SCHEMA_VERSION;
  readonly profile_id: typeof DECLARED_BOUNDARY_PROFILE_ID;
  readonly profile_version: typeof DECLARED_BOUNDARY_PROFILE_VERSION;
  readonly transformer_id: string;
}
export interface DeclaredBoundaryVerified extends DeclaredBoundaryVerificationBase {
  readonly verified: true;
  readonly source: DeclaredBoundaryVerificationSource;
  readonly report: Readonly<Record<string, unknown>>;
  readonly census: DeclaredBoundaryCensus;
  readonly refusal: null;
}
export interface DeclaredBoundaryVerificationRefused extends DeclaredBoundaryVerificationBase {
  readonly verified: false;
  readonly source: null;
  readonly report: null;
  readonly census: null;
  readonly refusal: DeclaredBoundaryVerificationRefusal;
}
export type DeclaredBoundaryVerificationResult =
  DeclaredBoundaryVerified | DeclaredBoundaryVerificationRefused;

/**
 * Verify one declared-boundary record against its closed declared policy and
 * measured subject population. Refusals are returned, never thrown.
 */
export function verifyDeclaredBoundaryRecordConsistency(
  input?: DeclaredBoundaryVerificationInput | unknown
): DeclaredBoundaryVerificationResult;
/** Canonical bytes for the derived report a verified result carries. Throws for a refusal. */
export function canonicalDeclaredBoundaryReportJson(
  result: DeclaredBoundaryVerificationResult
): Buffer;
