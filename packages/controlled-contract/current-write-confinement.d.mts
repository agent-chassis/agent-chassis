export const WRITE_CONFINEMENT_CAPTURE_REFUSAL_CODES: Readonly<{
  MISSING_REQUIRED_INPUT: "controlled_contract.write_confinement_capture.missing_required_input.v1";
  MALFORMED_ENVELOPE: "controlled_contract.write_confinement_capture.malformed_envelope.v1";
  WRONG_LAUNCHER_ARTIFACT: "controlled_contract.write_confinement_capture.wrong_launcher_artifact.v1";
  EVIDENCE_SCHEMA_VERSION_UNSUPPORTED:
    "controlled_contract.write_confinement_capture.evidence_schema_version_unsupported.v1";
  UNPROJECTED_ENVELOPE: "controlled_contract.write_confinement_capture.unprojected_envelope.v1";
  MALFORMED_EVIDENCE: "controlled_contract.write_confinement_capture.malformed_evidence.v1";
  EVIDENCE_AUTHORITY_UNSUPPORTED:
    "controlled_contract.write_confinement_capture.evidence_authority_unsupported.v1";
  POPULATION_NONCANONICAL: "controlled_contract.write_confinement_capture.population_noncanonical.v1";
  POPULATION_INCONSISTENT: "controlled_contract.write_confinement_capture.population_inconsistent.v1";
  PACK_SNAPSHOT_UNRECOGNIZED:
    "controlled_contract.write_confinement_capture.pack_snapshot_unrecognized.v1";
  PROFILE_IDENTITY_MISMATCH:
    "controlled_contract.write_confinement_capture.profile_identity_mismatch.v1";
  PACK_STAGE_UNSUPPORTED: "controlled_contract.write_confinement_capture.pack_stage_unsupported.v1";
  PACK_ROLE_INCOMPATIBLE: "controlled_contract.write_confinement_capture.pack_role_incompatible.v1";
  EVALUATION_INPUT_INVALID:
    "controlled_contract.write_confinement_capture.evaluation_input_invalid.v1";
}>;
export type WriteConfinementCaptureRefusalCode =
  typeof WRITE_CONFINEMENT_CAPTURE_REFUSAL_CODES[
    keyof typeof WRITE_CONFINEMENT_CAPTURE_REFUSAL_CODES
  ];
export const WRITE_CONFINEMENT_CAPTURE_SCHEMA_VERSION:
  "controlled-contract-write-confinement-capture.v1";
export const WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION:
  "workspace-agent-write-confinement-evidence.v1";
export const WRITE_CONFINEMENT_PROFILE_ID: "proof.scope.write-confinement";
export const WRITE_CONFINEMENT_PROFILE_VERSION: "2.0.0";

/** A contract reference identity as the mapping emits it. */
export type WriteConfinementReferenceIdentity =
  | { readonly kind: "durable_id"; readonly domain: string; readonly value: string }
  | { readonly kind: "repository_path"; readonly repository: string; readonly path: string };
export interface WriteConfinementReference {
  readonly reference_id: string;
  readonly type_term: string;
  readonly identity: WriteConfinementReferenceIdentity;
}
export interface WriteConfinementReferenceBinding {
  readonly role: string;
  readonly reference_ids: readonly string[];
}
/** The evaluation input in the shape the admitted pack's template owns. */
export interface WriteConfinementEvaluationInput {
  readonly input_version: "controlled-contract-verification-profile-input.v1";
  readonly evaluation_stage: string;
  readonly reference_bindings: readonly WriteConfinementReferenceBinding[];
  readonly number_bindings: readonly never[];
  readonly claim_pattern_bindings: readonly never[];
  readonly resolver_facts: readonly never[];
  readonly delivered_evidence: readonly never[];
  readonly stable_evaluation: Readonly<Record<string, never>>;
}
/** The authenticated identities carried through from the launcher owner. */
export interface WriteConfinementCaptureSource {
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
  readonly evidence_digest: string;
}
export interface WriteConfinementCaptureRefusal {
  readonly code: WriteConfinementCaptureRefusalCode;
  readonly reason: string;
  readonly detail: Readonly<Record<string, unknown>> | null;
}
interface WriteConfinementCaptureBase {
  readonly schema_version: typeof WRITE_CONFINEMENT_CAPTURE_SCHEMA_VERSION;
  readonly profile_id: typeof WRITE_CONFINEMENT_PROFILE_ID;
  readonly profile_version: typeof WRITE_CONFINEMENT_PROFILE_VERSION;
  readonly evidence_schema_version: typeof WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION;
}
export interface WriteConfinementCaptureMapped extends WriteConfinementCaptureBase {
  readonly mapped: true;
  readonly source: WriteConfinementCaptureSource;
  readonly references: readonly WriteConfinementReference[];
  readonly evaluation_input: WriteConfinementEvaluationInput;
  readonly refusal: null;
}
export interface WriteConfinementCaptureRefused extends WriteConfinementCaptureBase {
  readonly mapped: false;
  readonly source: null;
  readonly references: null;
  readonly evaluation_input: null;
  readonly refusal: WriteConfinementCaptureRefusal;
}
export type WriteConfinementCaptureResult =
  WriteConfinementCaptureMapped | WriteConfinementCaptureRefused;

/**
 * Map one authenticated launcher write-confinement projection envelope into an
 * evaluation input for the admitted `proof.scope.write-confinement@2.0.0` pack.
 * Refusals are returned, never thrown, and carry no partial output.
 */
export function mapWriteConfinementCapture(request?: {
  readonly projection?: unknown;
  readonly pack?: unknown;
}): Promise<WriteConfinementCaptureResult>;

/** Canonical bytes for a mapped evaluation input. Throws for a refusal. */
export function canonicalWriteConfinementEvaluationInputJson(
  result: WriteConfinementCaptureResult
): Buffer;
