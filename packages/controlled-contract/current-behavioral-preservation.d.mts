export const BEHAVIORAL_PRESERVATION_VERIFICATION_REFUSAL_CODES: Readonly<{
  MISSING_REQUIRED_INPUT:
    "controlled_contract.behavioral_preservation_verification.missing_required_input.v1";
  MALFORMED_INPUT:
    "controlled_contract.behavioral_preservation_verification.malformed_input.v1";
  MALFORMED_REPORT:
    "controlled_contract.behavioral_preservation_verification.malformed_report.v1";
  REPORT_POPULATION_INCONSISTENT:
    "controlled_contract.behavioral_preservation_verification.report_population_inconsistent.v1";
  CANONICAL_SELECTION_UNRESOLVED:
    "controlled_contract.behavioral_preservation_verification.canonical_selection_unresolved.v1";
  CANONICAL_SELECTION_AMBIGUOUS:
    "controlled_contract.behavioral_preservation_verification.canonical_selection_ambiguous.v1";
}>;
export type BehavioralPreservationVerificationRefusalCode =
  typeof BEHAVIORAL_PRESERVATION_VERIFICATION_REFUSAL_CODES[
    keyof typeof BEHAVIORAL_PRESERVATION_VERIFICATION_REFUSAL_CODES
  ];
export const BEHAVIORAL_PRESERVATION_VERIFICATION_SCHEMA_VERSION:
  "controlled-contract-behavioral-preservation-verification.v1";
export const BEHAVIORAL_PRESERVATION_REPORT_SCHEMA_VERSION:
  "controlled-contract-behavioral-preservation-report.v1";
export const BEHAVIORAL_PRESERVATION_PROFILE_ID: "proof.compatibility.behavioral-preservation";
export const BEHAVIORAL_PRESERVATION_PROFILE_VERSION: "2.0.0";
export const BEHAVIORAL_PRESERVATION_SIDES: readonly ["baseline", "candidate"];
export type BehavioralPreservationSide = typeof BEHAVIORAL_PRESERVATION_SIDES[number];

export interface BehavioralPreservationObservable {
  readonly observable_id: string;
  readonly observable_type: string;
  readonly canonical_value: string;
}
export interface BehavioralPreservationReport {
  readonly schema_version: typeof BEHAVIORAL_PRESERVATION_REPORT_SCHEMA_VERSION;
  readonly observables: readonly BehavioralPreservationObservable[];
  readonly observable_count: number;
  readonly selected_observable_id: string;
}
export interface BehavioralPreservationReportPair {
  readonly baseline: BehavioralPreservationReport;
  readonly candidate: BehavioralPreservationReport;
}
export interface BehavioralPreservationMemberDescriptor {
  readonly observable_id: string;
  readonly observable_type: string;
}
export interface BehavioralPreservationDifferences {
  readonly baseline_population_not_subset: boolean;
  readonly candidate_population_not_subset: boolean;
  readonly only_in_baseline: readonly BehavioralPreservationMemberDescriptor[];
  readonly only_in_candidate: readonly BehavioralPreservationMemberDescriptor[];
  readonly count_mismatch: boolean;
  readonly selection_mismatch: boolean;
  readonly canonical_value_mismatch: boolean;
}
export interface BehavioralPreservationVerificationSource {
  readonly sides: readonly Readonly<{
    position: BehavioralPreservationSide;
    observable_count: number;
    selected_observable_id: string;
    selected_canonical_value: string;
  }>[];
}
export interface BehavioralPreservationVerificationRefusal {
  readonly code: BehavioralPreservationVerificationRefusalCode;
  readonly reason: string;
  readonly detail: Readonly<Record<string, unknown>> | null;
}
interface BehavioralPreservationVerificationBase {
  readonly schema_version: typeof BEHAVIORAL_PRESERVATION_VERIFICATION_SCHEMA_VERSION;
  readonly profile_id: typeof BEHAVIORAL_PRESERVATION_PROFILE_ID;
  readonly profile_version: typeof BEHAVIORAL_PRESERVATION_PROFILE_VERSION;
  readonly report_schema_version: typeof BEHAVIORAL_PRESERVATION_REPORT_SCHEMA_VERSION;
}
export interface BehavioralPreservationVerified extends BehavioralPreservationVerificationBase {
  readonly verified: true;
  /** True exactly when populations, counts, selection, and the selected canonical value are equal. */
  readonly preserved: boolean;
  readonly source: BehavioralPreservationVerificationSource;
  readonly members: Readonly<Record<BehavioralPreservationSide,
    readonly BehavioralPreservationMemberDescriptor[]>>;
  readonly differences: BehavioralPreservationDifferences;
  readonly refusal: null;
}
export interface BehavioralPreservationVerificationRefused
  extends BehavioralPreservationVerificationBase {
  readonly verified: false;
  readonly preserved: null;
  readonly source: null;
  readonly members: null;
  readonly differences: null;
  readonly refusal: BehavioralPreservationVerificationRefusal;
}
export type BehavioralPreservationVerificationResult =
  BehavioralPreservationVerified | BehavioralPreservationVerificationRefused;

/**
 * Verify one ordered pair of typed behavior reports. Refusals are returned,
 * never thrown; a readable pair whose sides differ is a verified result with
 * `preserved: false` and its differences named.
 */
export function verifyBehavioralPreservationReports(
  input?: BehavioralPreservationReportPair | unknown
): BehavioralPreservationVerificationResult;
