import type {
  ObligationCoverageDraft, ProofAuthoringPin
} from "../current-obligation-coverage.mjs";

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

export declare function occurrenceRecoverySummary(
  diagnostic: Readonly<Record<string, unknown>>,
  recovery: Readonly<Record<string, unknown>> & { readonly summary: string }
): string;
