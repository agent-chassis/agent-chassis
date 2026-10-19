import type {
  ObligationCoverageDraft, ProofAuthoringPin
} from "../current-obligation-coverage.mjs";
import type { ProofObligationAccounting } from "./proof-contract.mjs";

export interface ProofExecutableMapRow {
  readonly obligation_id: string;
  readonly input_status: "valid" | "invalid";
  readonly construction_status: "complete" | "invalid" | "unresolved" | "unavailable";
  readonly definition: ProofAuthoringPin | Readonly<Record<string, unknown>> | null;
  readonly resolved_identity: string | null;
  readonly selected_proof_assessment: Readonly<Record<string, unknown>> | null;
  readonly diagnostics: readonly Readonly<Record<string, unknown>>[];
}

export interface ProofExecutableMap {
  readonly source_digest: string;
  readonly context_digest: string;
  readonly identity_digest: string;
  readonly definition_identities: readonly ProofAuthoringPin[];
  readonly rows: readonly ProofExecutableMapRow[];
  readonly dependencies: readonly Readonly<Record<string, unknown>>[];
}

export interface ProofExecutableMapEntry {
  readonly row: Readonly<Record<string, unknown>>;
  readonly semantic_diagnostics: readonly Readonly<Record<string, unknown>>[];
  readonly resolved: boolean;
  readonly accounting: ProofObligationAccounting;
}

export declare function resolveProofExecutableMap(
  source: ObligationCoverageDraft,
  context?: Readonly<Record<string, unknown>> & { readonly source_digest: string },
  owners?: Readonly<Record<string, unknown>>
): Promise<{
  readonly draft: ObligationCoverageDraft;
  readonly parameter_only: boolean;
  readonly entries: readonly ProofExecutableMapEntry[];
  readonly map: ProofExecutableMap;
}>;

export declare function resolveSelectedProofRequirements(
  selection: ProofAuthoringPin,
  owners?: Readonly<Record<string, unknown>>
): Promise<Readonly<Record<string, unknown>>>;

export declare function diagnosticCodes(
  entries: readonly { readonly code: string }[]
): string[];

export declare function typedBindingFailurePaths(
  diagnostic: Readonly<Record<string, unknown>>
): string[];

export type OccurrenceCorrectionClause = "component" | "association" | "case_content";

export interface OccurrenceCorrectionClauseDefinition {
  readonly field: string;
  readonly guidance: string;
}

export declare const OCCURRENCE_CORRECTION_CLAUSES: Readonly<
  Record<OccurrenceCorrectionClause, OccurrenceCorrectionClauseDefinition>>;

export interface OccurrenceFailedField {
  readonly keyword: string | null;
  readonly path: string;
}

export interface OccurrenceRecoveryFacts {
  readonly failed_fields: readonly OccurrenceFailedField[];
  readonly association_correction: boolean;
  readonly module_source_correction: boolean;
  readonly corrections: readonly OccurrenceCorrectionClause[];
  /** Present only when the occurrence's case names no verification. */
  readonly association?: OccurrenceCaseAssociation;
}

/** Selects one verification: `choose_one_of` lists the selectable verification identities. */
export interface CaseVerificationSelectionChoice {
  readonly field: 'obligations[].case.verification';
  readonly links_field: string;
  readonly choose_one_of: readonly string[];
}

/**
 * The conditional recovery of condition `verification_owned_by_another_case`,
 * where no verification is selectable. `field` is the case identity member to
 * author `when` the obligation means the saved test, and `choose_one_of` then
 * lists the saved case identities of the blocked entries (their
 * `saved_case_ids`), never verification identities. `otherwise` names the
 * member to author for a different test. Neither is selected.
 */
export interface CaseReuseChoice {
  readonly field: 'obligations[].case.id';
  readonly links_field: string;
  readonly choose_one_of: readonly string[];
  readonly when: string;
  readonly otherwise: { readonly when: string; readonly field: string };
  readonly correction: string;
}

/** What an author may select for a case that names no verification. */
export interface OccurrenceCaseAssociation {
  readonly condition: string;
  readonly case_id: string;
  readonly selected: false;
  readonly eligible_verification_ids: readonly string[];
  readonly candidate_verification_ids: readonly string[];
  readonly blocked: readonly Readonly<Record<string, unknown>>[];
  /** Current unbound competitors; these do not block individual selection. */
  readonly competitions?: readonly {
    readonly verification_id: string;
    readonly cases: readonly { readonly case_id: string;
      readonly uses: readonly { readonly unit: string; readonly obligation_id: string }[] }[];
  }[];
  readonly competition_recovery?: {
    readonly condition: 'competing_unbound_cases';
    readonly choices: readonly { readonly when: string; readonly field: string; readonly then?: string }[];
    readonly correction: string;
  };
  readonly required_choice: CaseVerificationSelectionChoice | CaseReuseChoice;
}

/** Null for every code other than obligation_coverage_native_binding_case_incomplete. */
export declare function occurrenceRecoveryFacts(
  diagnostic: Readonly<Record<string, unknown>> | null | undefined
): OccurrenceRecoveryFacts | null;

export declare function occurrenceRecoverySummary(
  diagnostic: Readonly<Record<string, unknown>>,
  recovery: Readonly<Record<string, unknown>> & { readonly summary: string },
  options?: { readonly failedFields?: "owner_diagnostics" | "public" }
): string;

export interface OccurrencePublicRecovery {
  readonly explanation: string | null;
  readonly instructions: string | null;
}

/** Null when the occurrence carries no route-assessment recovery. */
export declare function occurrencePublicRecovery(
  diagnostic: Readonly<Record<string, unknown>> | null | undefined
): OccurrencePublicRecovery | null;
