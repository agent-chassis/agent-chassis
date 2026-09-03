export const DECLARED_BOUNDARY_CAPTURE_REFUSAL_CODES: Readonly<{
  MISSING_REQUIRED_INPUT:
    "controlled_contract.declared_boundary_capture.missing_required_input.v1";
  MALFORMED_CAPTURE:
    "controlled_contract.declared_boundary_capture.malformed_capture.v1";
  CAPTURE_SCHEMA_VERSION_UNSUPPORTED:
    "controlled_contract.declared_boundary_capture.capture_schema_version_unsupported.v1";
  POLICY_BYTES_UNRESOLVED:
    "controlled_contract.declared_boundary_capture.policy_bytes_unresolved.v1";
  SUBJECT_BYTES_UNRESOLVED:
    "controlled_contract.declared_boundary_capture.subject_bytes_unresolved.v1";
  OBSERVATION_RECORD_UNRESOLVED:
    "controlled_contract.declared_boundary_capture.observation_record_unresolved.v1";
  POLICY_NOT_CLOSED: "controlled_contract.declared_boundary_capture.policy_not_closed.v1";
  POLICY_AMBIGUOUS: "controlled_contract.declared_boundary_capture.policy_ambiguous.v1";
  MEASUREMENT_UNIT_UNSUPPORTED:
    "controlled_contract.declared_boundary_capture.measurement_unit_unsupported.v1";
  SUBJECT_IDENTITY_DUPLICATE:
    "controlled_contract.declared_boundary_capture.subject_identity_duplicate.v1";
  SUBJECT_POPULATION_MALFORMED:
    "controlled_contract.declared_boundary_capture.subject_population_malformed.v1";
  SUBJECT_POPULATION_INCOMPLETE:
    "controlled_contract.declared_boundary_capture.subject_population_incomplete.v1";
  OBSERVATION_RECORD_MALFORMED:
    "controlled_contract.declared_boundary_capture.observation_record_malformed.v1";
  OBSERVATION_PROVENANCE_UNSUPPORTED:
    "controlled_contract.declared_boundary_capture.observation_provenance_unsupported.v1";
  BOUNDARY_CENSUS_INCOMPLETE:
    "controlled_contract.declared_boundary_capture.boundary_census_incomplete.v1";
  BOUNDARY_CENSUS_DUPLICATE:
    "controlled_contract.declared_boundary_capture.boundary_census_duplicate.v1";
  BOUNDARY_CENSUS_REFERENCE_UNKNOWN:
    "controlled_contract.declared_boundary_capture.boundary_census_reference_unknown.v1";
  BOUNDARY_ARITHMETIC_MISMATCH:
    "controlled_contract.declared_boundary_capture.boundary_arithmetic_mismatch.v1";
  BOUNDARY_DISPOSITION_MISMATCH:
    "controlled_contract.declared_boundary_capture.boundary_disposition_mismatch.v1";
  DERIVATION_REFUSED: "controlled_contract.declared_boundary_capture.derivation_refused.v1";
  REPORT_INVALID: "controlled_contract.declared_boundary_capture.report_invalid.v1";
  CONTRACT_GRAPH_INCOMPLETE:
    "controlled_contract.declared_boundary_capture.contract_graph_incomplete.v1";
  PACK_SNAPSHOT_UNRECOGNIZED:
    "controlled_contract.declared_boundary_capture.pack_snapshot_unrecognized.v1";
  PROFILE_IDENTITY_MISMATCH:
    "controlled_contract.declared_boundary_capture.profile_identity_mismatch.v1";
  PACK_STAGE_UNSUPPORTED:
    "controlled_contract.declared_boundary_capture.pack_stage_unsupported.v1";
  PACK_ROLE_INCOMPATIBLE:
    "controlled_contract.declared_boundary_capture.pack_role_incompatible.v1";
  EXACT_BINDING_DECLARATION_INCOMPATIBLE:
    "controlled_contract.declared_boundary_capture.exact_binding_declaration_incompatible.v1";
  EVALUATION_INPUT_INVALID:
    "controlled_contract.declared_boundary_capture.evaluation_input_invalid.v1";
}>;
export type DeclaredBoundaryCaptureRefusalCode =
  typeof DECLARED_BOUNDARY_CAPTURE_REFUSAL_CODES[
    keyof typeof DECLARED_BOUNDARY_CAPTURE_REFUSAL_CODES
  ];
export const DECLARED_BOUNDARY_CAPTURE_SCHEMA_VERSION:
  "controlled-contract-declared-boundary-capture.v1";
export const DECLARED_BOUNDARY_CAPTURE_INPUT_SCHEMA_VERSION:
  "controlled-contract-declared-boundary-capture-input.v1";
export const DECLARED_BOUNDARY_PROFILE_ID:
  "proof.policy.declared-boundary-record-consistency";
export const DECLARED_BOUNDARY_PROFILE_VERSION: "2.0.0";
/**
 * The one observation provenance a coordinator-authored record may carry. A record
 * claiming captured execution provenance is refused, never upgraded.
 */
export const DECLARED_BOUNDARY_OBSERVATION_PROVENANCE: "caller_asserted";
/** What a mapped result explicitly does not establish. */
export const DECLARED_BOUNDARY_NOT_ESTABLISHED: readonly [
  "execution-provenance",
  "policy-to-production-correspondence",
  "production-truth",
  "runtime-enforcement"
];

/** Where one exactly-bound artifact's bytes are published. */
export interface DeclaredBoundaryArtifactSource {
  readonly kind: "artifact_file";
  readonly relative_path: string;
}
/**
 * One bounded declared-boundary capture: the exact resolved bytes for the closed
 * declared policy, the coordinator-authored observation record and its identity,
 * and the complete canonical subject population, plus the descriptor naming where
 * the derived report bytes are published. Nothing here is opened or persisted.
 */
export interface DeclaredBoundaryCaptureInput {
  readonly schema_version: typeof DECLARED_BOUNDARY_CAPTURE_INPUT_SCHEMA_VERSION;
  readonly policy: {
    readonly bytes: Uint8Array;
    readonly source: DeclaredBoundaryArtifactSource;
  };
  readonly observation: {
    readonly record_id: string;
    readonly bytes: Uint8Array;
    readonly source: DeclaredBoundaryArtifactSource;
  };
  readonly subjects: {
    readonly bytes: Uint8Array;
    readonly source: DeclaredBoundaryArtifactSource;
  };
  readonly report: { readonly source: DeclaredBoundaryArtifactSource };
}
/** A contract reference identity as the mapping emits it. */
export interface DeclaredBoundaryReferenceIdentity {
  readonly kind: "durable_id";
  readonly domain: string;
  readonly value: string;
}
export interface DeclaredBoundaryReference {
  readonly reference_id: string;
  readonly type_term: string;
  readonly identity: DeclaredBoundaryReferenceIdentity;
}
export interface DeclaredBoundaryReferenceBinding {
  readonly role: string;
  readonly reference_ids: readonly string[];
}
export interface DeclaredBoundaryNumberBinding {
  readonly role: string;
  readonly value: number;
}
/** The evaluation input in the shape the admitted pack's template owns. */
export interface DeclaredBoundaryEvaluationInput {
  readonly input_version: "controlled-contract-verification-profile-input.v1";
  readonly evaluation_stage: string;
  readonly reference_bindings: readonly DeclaredBoundaryReferenceBinding[];
  readonly number_bindings: readonly DeclaredBoundaryNumberBinding[];
  readonly claim_pattern_bindings: readonly never[];
  readonly resolver_facts: readonly never[];
  readonly delivered_evidence: readonly never[];
  readonly stable_evaluation: Readonly<Record<string, never>>;
}
/** One validated row of the derived boundary census. */
export interface DeclaredBoundaryCensusCase {
  readonly boundary_position: "above" | "at" | "below";
  readonly case_id: string;
  readonly subject_id: string;
  readonly measured_value: number;
  readonly observed_disposition: "accepted" | "refused" | "truncated";
}
/** One declared limit and its complete derived boundary census. */
export interface DeclaredBoundaryCensusLimit {
  readonly limit_key: string;
  readonly limit_value: number;
  readonly bound_direction: "maximum" | "minimum";
  readonly bound_inclusivity: "exclusive" | "inclusive";
  readonly overflow_disposition: "refuse" | "truncate";
  readonly normalization: "nfc" | "nfd" | "none";
  readonly unit: string;
  readonly measurement_class: string;
  /** True when the limit is a zero maximum, whose census is exactly N and N+1. */
  readonly zero_maximum: boolean;
  readonly boundary_positions: readonly ("above" | "at" | "below")[];
  readonly cases: readonly DeclaredBoundaryCensusCase[];
}
/**
 * The complete derived census. It is a caller declaration: it establishes no
 * execution provenance, no runtime enforcement, no correspondence between the
 * declared policy and any production limit, and no production truth.
 */
export interface DeclaredBoundaryCensus {
  readonly provenance: typeof DECLARED_BOUNDARY_OBSERVATION_PROVENANCE;
  readonly authority: "caller_declaration_only";
  readonly not_established: readonly string[];
  readonly boundary_case_count: number;
  readonly measured_subject_count: number;
  readonly limits: readonly DeclaredBoundaryCensusLimit[];
}
/** The exact identities the derivation bound this capture to. */
export interface DeclaredBoundaryCaptureSource {
  readonly observation_record_id: string;
  readonly observation_provenance: typeof DECLARED_BOUNDARY_OBSERVATION_PROVENANCE;
  readonly source_set_sha256: string;
  readonly source_content_sha256: Readonly<{
    boundary_observations: string;
    declared_policy: string;
    measured_subjects: string;
  }>;
  readonly report_bytes_sha256: string;
  readonly declared_limit_count: number;
  readonly measurement_unit_count: number;
  readonly boundary_case_count: number;
  readonly measured_subject_count: number;
  readonly exact_binding_requirement_ids: Readonly<{
    report: string;
    policy: string;
    observation: string;
    subjects: string;
  }>;
}
export interface DeclaredBoundaryCaptureRefusal {
  readonly code: DeclaredBoundaryCaptureRefusalCode;
  readonly reason: string;
  readonly detail: Readonly<Record<string, unknown>> | null;
}
interface DeclaredBoundaryCaptureBase {
  readonly schema_version: typeof DECLARED_BOUNDARY_CAPTURE_SCHEMA_VERSION;
  readonly profile_id: typeof DECLARED_BOUNDARY_PROFILE_ID;
  readonly profile_version: typeof DECLARED_BOUNDARY_PROFILE_VERSION;
  readonly capture_input_schema_version:
    typeof DECLARED_BOUNDARY_CAPTURE_INPUT_SCHEMA_VERSION;
  readonly transformer_id: string;
}
export interface DeclaredBoundaryCaptureMapped extends DeclaredBoundaryCaptureBase {
  readonly mapped: true;
  readonly source: DeclaredBoundaryCaptureSource;
  readonly references: readonly DeclaredBoundaryReference[];
  readonly evaluation_input: DeclaredBoundaryEvaluationInput;
  /** Keyed by the pack's own exact-binding requirement ids. */
  readonly exact_binding_sources: Readonly<Record<string, DeclaredBoundaryArtifactSource>>;
  /** The owning transformer's derived report, exactly as it validated it. */
  readonly report: Readonly<Record<string, unknown>>;
  readonly census: DeclaredBoundaryCensus;
  readonly refusal: null;
}
export interface DeclaredBoundaryCaptureRefused extends DeclaredBoundaryCaptureBase {
  readonly mapped: false;
  readonly source: null;
  readonly references: null;
  readonly evaluation_input: null;
  readonly exact_binding_sources: null;
  readonly report: null;
  readonly census: null;
  readonly refusal: DeclaredBoundaryCaptureRefusal;
}
export type DeclaredBoundaryCaptureResult =
  DeclaredBoundaryCaptureMapped | DeclaredBoundaryCaptureRefused;

/**
 * Map one bounded declared-boundary capture into an evaluation input for the
 * admitted `proof.policy.declared-boundary-record-consistency@2.0.0` pack. The
 * complete subject population is measured under the declared unit and
 * measurement-class lexicon with no cap or sampling; the complete N-1/N/N+1
 * census is derived for every nonzero limit and exactly N/N+1 for a zero maximum;
 * and the selected observation record is validated against it. Refusals are
 * returned, never thrown, and carry no partial output.
 */
export function mapDeclaredBoundaryCapture(request?: {
  readonly capture?: unknown;
  readonly pack?: unknown;
}): Promise<DeclaredBoundaryCaptureResult>;

/** Canonical bytes for a mapped evaluation input. Throws for a refusal. */
export function canonicalDeclaredBoundaryEvaluationInputJson(
  result: DeclaredBoundaryCaptureResult
): Buffer;

/**
 * Canonical bytes for the derived report a mapped result carries. These are the
 * exact bytes the pack's report requirement binds. Throws for a refusal.
 */
export function canonicalDeclaredBoundaryReportJson(
  result: DeclaredBoundaryCaptureResult
): Buffer;
