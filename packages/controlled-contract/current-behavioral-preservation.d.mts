export const BEHAVIORAL_PRESERVATION_CAPTURE_REFUSAL_CODES: Readonly<{
  MISSING_REQUIRED_INPUT:
    "controlled_contract.behavioral_preservation_capture.missing_required_input.v1";
  MALFORMED_CAPTURE:
    "controlled_contract.behavioral_preservation_capture.malformed_capture.v1";
  CAPTURE_SCHEMA_VERSION_UNSUPPORTED:
    "controlled_contract.behavioral_preservation_capture.capture_schema_version_unsupported.v1";
  MALFORMED_PAIR_IDENTITY:
    "controlled_contract.behavioral_preservation_capture.malformed_pair_identity.v1";
  MALFORMED_SIDE:
    "controlled_contract.behavioral_preservation_capture.malformed_side.v1";
  MALFORMED_SOURCE_DESCRIPTOR:
    "controlled_contract.behavioral_preservation_capture.malformed_source_descriptor.v1";
  MALFORMED_REPORT:
    "controlled_contract.behavioral_preservation_capture.malformed_report.v1";
  REPORT_POPULATION_INCONSISTENT:
    "controlled_contract.behavioral_preservation_capture.report_population_inconsistent.v1";
  OBSERVABLE_DESCRIPTOR_UNSUPPORTED:
    "controlled_contract.behavioral_preservation_capture.observable_descriptor_unsupported.v1";
  CANONICAL_SELECTION_UNRESOLVED:
    "controlled_contract.behavioral_preservation_capture.canonical_selection_unresolved.v1";
  CANONICAL_SELECTION_AMBIGUOUS:
    "controlled_contract.behavioral_preservation_capture.canonical_selection_ambiguous.v1";
  MEMBER_COUNT_ROLE_UNFILLABLE:
    "controlled_contract.behavioral_preservation_capture.member_count_role_unfillable.v1";
  PACK_SNAPSHOT_UNRECOGNIZED:
    "controlled_contract.behavioral_preservation_capture.pack_snapshot_unrecognized.v1";
  PROFILE_IDENTITY_MISMATCH:
    "controlled_contract.behavioral_preservation_capture.profile_identity_mismatch.v1";
  PACK_STAGE_UNSUPPORTED:
    "controlled_contract.behavioral_preservation_capture.pack_stage_unsupported.v1";
  PACK_ROLE_INCOMPATIBLE:
    "controlled_contract.behavioral_preservation_capture.pack_role_incompatible.v1";
  EXACT_BINDING_DECLARATION_INCOMPATIBLE:
    "controlled_contract.behavioral_preservation_capture.exact_binding_declaration_incompatible.v1";
  EVALUATION_INPUT_INVALID:
    "controlled_contract.behavioral_preservation_capture.evaluation_input_invalid.v1";
}>;
export type BehavioralPreservationCaptureRefusalCode =
  typeof BEHAVIORAL_PRESERVATION_CAPTURE_REFUSAL_CODES[
    keyof typeof BEHAVIORAL_PRESERVATION_CAPTURE_REFUSAL_CODES
  ];
export const BEHAVIORAL_PRESERVATION_CAPTURE_SCHEMA_VERSION:
  "controlled-contract-behavioral-preservation-capture.v1";
export const BEHAVIORAL_PRESERVATION_CAPTURE_INPUT_SCHEMA_VERSION:
  "controlled-contract-behavioral-preservation-capture-input.v1";
export const BEHAVIORAL_PRESERVATION_REPORT_SCHEMA_VERSION:
  "controlled-contract-behavioral-preservation-report.v1";
export const BEHAVIORAL_PRESERVATION_PROFILE_ID:
  "proof.compatibility.behavioral-preservation";
export const BEHAVIORAL_PRESERVATION_PROFILE_VERSION: "2.0.0";
/** The ordered pair positions, in the order the profile's left/right roles take. */
export const BEHAVIORAL_PRESERVATION_SIDES: readonly ["baseline", "candidate"];
export type BehavioralPreservationSide =
  typeof BEHAVIORAL_PRESERVATION_SIDES[number];

/** One typed observable descriptor and its selected canonical value identity. */
export interface BehavioralPreservationObservable {
  readonly observable_id: string;
  readonly observable_type: string;
  readonly canonical_value: string;
}
/** One side's complete typed behavior report. */
export interface BehavioralPreservationReport {
  readonly schema_version: typeof BEHAVIORAL_PRESERVATION_REPORT_SCHEMA_VERSION;
  readonly observables: readonly BehavioralPreservationObservable[];
  readonly observable_count: number;
  readonly selected_observable_id: string;
}
/** The one exact source descriptor kind the exact-binding owner captures from. */
export interface BehavioralPreservationSourceDescriptor {
  readonly kind: "artifact_file";
  readonly relative_path: string;
}
/**
 * One ordered side. `evidence_id` and `evidence_digest` are OPAQUE WK-2106 pair
 * facts: they are carried through verbatim and never parsed or re-derived here.
 */
export interface BehavioralPreservationCaptureSide {
  readonly evidence_id: string;
  readonly evidence_digest: string;
  readonly source: BehavioralPreservationSourceDescriptor;
  readonly report: BehavioralPreservationReport;
}
/** The bounded package input this mapping accepts. */
export interface BehavioralPreservationCaptureInput {
  readonly schema_version: typeof BEHAVIORAL_PRESERVATION_CAPTURE_INPUT_SCHEMA_VERSION;
  readonly pair: { readonly pair_id: string; readonly pair_digest: string };
  readonly baseline: BehavioralPreservationCaptureSide;
  readonly candidate: BehavioralPreservationCaptureSide;
}

/** A contract reference identity as the mapping emits it. */
export interface BehavioralPreservationReferenceIdentity {
  readonly kind: "durable_id";
  readonly domain: string;
  readonly value: string;
}
export interface BehavioralPreservationReference {
  readonly reference_id: string;
  readonly type_term: string;
  readonly identity: BehavioralPreservationReferenceIdentity;
}
export interface BehavioralPreservationReferenceBinding {
  readonly role: string;
  readonly reference_ids: readonly string[];
}
export interface BehavioralPreservationNumberBinding {
  readonly role: "member_count";
  readonly value: number;
}
/** The evaluation input in the shape the admitted pack's template owns. */
export interface BehavioralPreservationEvaluationInput {
  readonly input_version: "controlled-contract-verification-profile-input.v1";
  readonly evaluation_stage: string;
  readonly reference_bindings: readonly BehavioralPreservationReferenceBinding[];
  readonly number_bindings: readonly BehavioralPreservationNumberBinding[];
  readonly claim_pattern_bindings: readonly never[];
  readonly resolver_facts: readonly never[];
  readonly delivered_evidence: readonly never[];
  readonly stable_evaluation: Readonly<Record<string, never>>;
}
/** The ordered side identities carried through from the launcher pair owner. */
export interface BehavioralPreservationCaptureSourceSide {
  readonly position: BehavioralPreservationSide;
  readonly evidence_id: string;
  readonly evidence_digest: string;
  readonly exact_binding_requirement_id: string;
  readonly relative_path: string;
}
export interface BehavioralPreservationCaptureSource {
  readonly pair_id: string;
  readonly pair_digest: string;
  readonly member_count: number;
  readonly selected_observable_id: string;
  readonly sides: readonly BehavioralPreservationCaptureSourceSide[];
}
export interface BehavioralPreservationCaptureRefusal {
  readonly code: BehavioralPreservationCaptureRefusalCode;
  readonly reason: string;
  readonly detail: Readonly<Record<string, unknown>> | null;
}
interface BehavioralPreservationCaptureBase {
  readonly schema_version: typeof BEHAVIORAL_PRESERVATION_CAPTURE_SCHEMA_VERSION;
  readonly profile_id: typeof BEHAVIORAL_PRESERVATION_PROFILE_ID;
  readonly profile_version: typeof BEHAVIORAL_PRESERVATION_PROFILE_VERSION;
  readonly capture_input_schema_version:
    typeof BEHAVIORAL_PRESERVATION_CAPTURE_INPUT_SCHEMA_VERSION;
  readonly report_schema_version: typeof BEHAVIORAL_PRESERVATION_REPORT_SCHEMA_VERSION;
}
export interface BehavioralPreservationCaptureMapped
  extends BehavioralPreservationCaptureBase {
  readonly mapped: true;
  readonly source: BehavioralPreservationCaptureSource;
  readonly references: readonly BehavioralPreservationReference[];
  readonly evaluation_input: BehavioralPreservationEvaluationInput;
  /**
   * The two exact source declarations, keyed by the admitted pack's own
   * exact-binding requirement ids. Report bytes, their equality, and descriptor
   * distinctness all belong to the exact-binding owner.
   */
  readonly exact_binding_sources: Readonly<
    Record<string, BehavioralPreservationSourceDescriptor>
  >;
  readonly refusal: null;
}
export interface BehavioralPreservationCaptureRefused
  extends BehavioralPreservationCaptureBase {
  readonly mapped: false;
  readonly source: null;
  readonly references: null;
  readonly evaluation_input: null;
  readonly exact_binding_sources: null;
  readonly refusal: BehavioralPreservationCaptureRefusal;
}
export type BehavioralPreservationCaptureResult =
  BehavioralPreservationCaptureMapped | BehavioralPreservationCaptureRefused;

/**
 * Map one bounded paired behavioral capture into an evaluation input for the
 * admitted `proof.compatibility.behavioral-preservation@2.0.0` pack. Refusals are
 * returned, never thrown, and carry no partial output. No report file is opened.
 */
export function mapBehavioralPreservationCapture(request?: {
  readonly capture?: unknown;
  readonly pack?: unknown;
}): Promise<BehavioralPreservationCaptureResult>;

/** Canonical bytes for a mapped evaluation input. Throws for a refusal. */
export function canonicalBehavioralPreservationEvaluationInputJson(
  result: BehavioralPreservationCaptureResult
): Buffer;
