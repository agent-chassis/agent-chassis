// The shared proof contract: types both proof authoring and proof execution
// consume. Nothing declared here depends on either workflow's runtime.

export declare class ProofAuthoringError extends Error {
  readonly name: "ProofAuthoringError";
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;
  constructor(code: string, message: string, details?: Record<string, unknown>);
}

export declare const PROOF_AUTHORING_FIELDS: readonly string[];
export declare const PROOF_AUTHORING_FIELD_SCHEMAS:
  Readonly<Record<string, Readonly<Record<string, unknown>>>>;

export declare const PROOF_AUTHORING_SEMANTIC_ASSESSMENT_VERSION:
  "proof-authoring-semantic-assessment.v1";

export interface ProofProblem {
  readonly category: string;
  readonly severity: string;
  readonly cause: Readonly<Record<string, unknown>>;
  readonly definition_sensitive?: true;
}

export interface ProofDiagnostic {
  readonly code: string;
  readonly path: string;
  readonly reason: string;
  readonly owner: string;
  readonly problem: ProofProblem;
  readonly [detail: string]: unknown;
}

export interface ProofAuthoringSemanticRow {
  readonly obligation_id: string;
  readonly path: string;
  readonly status: "complete" | "incomplete";
  readonly diagnostics: readonly ProofDiagnostic[];
}

export interface ProofAuthoringSemanticAssessment {
  readonly schema_version: "proof-authoring-semantic-assessment.v1";
  readonly status: "complete" | "incomplete";
  readonly total: number;
  readonly diagnostics: readonly ProofDiagnostic[];
  readonly rows: readonly ProofAuthoringSemanticRow[];
}

export interface ProofAuthoringSemanticContext {
  readonly contract_nodes?: readonly string[];
  readonly contract_claims?: readonly ProofVerificationClaimFact[];
  readonly contract_proposition_ids?: readonly string[];
  readonly contract_relations?: readonly Readonly<Record<string, unknown>>[];
  readonly case_definitions?: readonly Readonly<Record<string, unknown>>[];
  readonly obligation_id?: string;
  readonly obligation_ids?: readonly string[];
}

export declare function assertProofAuthoringDraft(
  source: unknown
): Readonly<Record<string, unknown>>;

export declare function proofProblem(
  category: string, kind: string,
  facts?: Record<string, unknown>,
  options?: { severity?: string; definitionSensitive?: boolean }
): ProofProblem;

export declare function proofDiagnostic(
  code: string, path: string, reason: string,
  details?: Record<string, unknown>, problem?: ProofProblem
): ProofDiagnostic;

export declare function proofOwnerDiagnostic(
  error: { code: string; message: string; details?: unknown },
  path: string, problem?: ProofProblem
): ProofDiagnostic;

export declare function selectProofAuthoringRows(
  draft: Readonly<Record<string, unknown>>,
  context?: ProofAuthoringSemanticContext
): {
  readonly rowIndices: Map<string, number>;
  readonly selected: readonly Readonly<Record<string, unknown>>[];
};

export interface ProofVerificationClaimFact {
  readonly claim_id: string;
  readonly kind: string;
  readonly verification_method?: string;
  readonly proposition_id?: string;
  readonly falsifying_proposition_id?: string;
}

export declare function assessProofAuthoringRowSemantics(
  row: Readonly<Record<string, unknown>>, path: string,
  context?: ProofAuthoringSemanticContext
): ProofDiagnostic[];

export declare function proofAuthoringPopulationDiagnostics(
  selectedCount: number
): readonly ProofDiagnostic[];

export declare function assessProofAuthoringSemantics(
  source: unknown, context?: ProofAuthoringSemanticContext
): ProofAuthoringSemanticAssessment;

// The registered diagnostic codes. A registry is package-local: this package is
// a strict leaf that cannot read the wiki-core taxonomy descriptor, so each
// package owns its entries and consumes them through the one raise function.
// One code means one thing and carries one actor_recovery and one recovery.

export declare class ProofDiagnosticCodeError extends Error {
  readonly name: "ProofDiagnosticCodeError";
}

export interface DiagnosticCodeRecovery {
  readonly kind: string;
  readonly success_condition: string;
  readonly summary?: string;
  readonly route?: string;
  readonly target?: string;
  readonly argument?: string;
  readonly prerequisite?: string;
  readonly accepted_values?: readonly string[];
  readonly arguments?: Readonly<Record<string, unknown>>;
  readonly argument_bindings?: Readonly<Record<string, string>>;
}

export interface DiagnosticCodeEntry {
  readonly code: string;
  readonly family: string;
  /** The exact condition observed, which is what selects the code. */
  readonly condition: string;
  readonly category: "controlled_contract";
  readonly actor_recovery: string;
  readonly blocking: boolean;
  readonly problem_category: "author_input" | "canonical_source" | "system_capability";
  readonly cause_kind: string;
  readonly summary: string;
  readonly required_facts: readonly string[];
  readonly detail_facts: readonly string[];
  readonly recovery: DiagnosticCodeRecovery | null;
}

export interface DiagnosticCodeRegistry {
  readonly owner: string;
  readonly codes: readonly string[];
  readonly byCode: ReadonlyMap<string, DiagnosticCodeEntry>;
  readonly byCondition: ReadonlyMap<string, DiagnosticCodeEntry>;
}

export declare const OBLIGATION_COVERAGE_UPSERT_TOOL:
  "workspace_controlled_contract_obligation_coverage_upsert";
export declare const WORK_RECORD_EDIT_TOOL: "workspace_work_record_edit";
export declare const AUTHORED_BINDING_OWNER_CODES: readonly string[];
export declare const PROOF_PREREQUISITE_CODES: DiagnosticCodeRegistry;

export declare function createDiagnosticCodeRegistry(descriptor: {
  owner: string;
  entries: readonly DiagnosticCodeEntry[];
}): DiagnosticCodeRegistry;

/** Returns the diagnostic; THROWS on misuse. */
export declare function raiseErrorCode(
  registry: DiagnosticCodeRegistry,
  selector: string | { family: string; condition: string },
  occurrence: { path: string; facts: Record<string, unknown> }
): ProofDiagnostic;

export declare function registeredRecoveryTemplate(
  registry: DiagnosticCodeRegistry, code: string
): DiagnosticCodeRecovery | null;
