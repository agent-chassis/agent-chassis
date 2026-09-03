export type AcceptanceCoverageState =
  | "covered" | "uncovered" | "duplicate" | "unknown" | "stale"
  | "outside_pack" | "retained_residue" | "infeasible";

export type AcceptanceCoverageAxis =
  | "authored_contract_coverage" | "structural_verification"
  | "selected_pack_guarantee_coverage" | "implementation_ownership"
  | "verification_ownership" | "scope_feasibility";

export interface AcceptanceCoverageBindings {
  contractDigest: string;
  proofPlanDigest: string;
  selectedPackDigest: string;
  mappingDigest: string;
}

export interface AcceptanceCoverageCriterionIdentity {
  readonly position: number;
  readonly text: string;
  readonly identity: string;
  readonly source: "derived" | "typed";
}

export interface AcceptanceCoverageCriterionIdentitySet {
  readonly version: "acceptance-coverage-criterion-identity.v1";
  readonly identities: readonly AcceptanceCoverageCriterionIdentity[];
  readonly bindings: Readonly<AcceptanceCoverageBindings>;
  readonly provenance: Readonly<{ selectedUnitDigest: string }>;
  readonly digest: string;
}

export interface AcceptanceCoverageIdentityComparison {
  readonly current: boolean;
  readonly stale: boolean;
  readonly bindingChanges: readonly (keyof AcceptanceCoverageBindings)[];
  readonly staleCriteria: readonly Readonly<{
    identity: string;
    reason: "added" | "removed" | "changed" | "duplicate";
  }>[];
}

export class AcceptanceCoverageIdentityError extends Error {
  code: string;
  details: Record<string, unknown>;
}

export const BINDING_DIGESTS: readonly (keyof AcceptanceCoverageBindings)[];
export function criterionIdentityDigest(position: number, text: string): string;
export function deriveCriterionIdentitySet(input: {
  criteria: readonly (string | Readonly<{
    text: string;
    typed_identity?: string;
  }>)[];
  selectedUnitDigest: string;
  bindings?: AcceptanceCoverageBindings;
  contractDigest?: string;
  proofPlanDigest?: string;
  selectedPackDigest?: string;
  mappingDigest?: string;
}): AcceptanceCoverageCriterionIdentitySet;
export function compareCriterionIdentitySets(
  prior: AcceptanceCoverageCriterionIdentitySet,
  current: AcceptanceCoverageCriterionIdentitySet
): AcceptanceCoverageIdentityComparison;

export interface AcceptanceCoverageMapping {
  criterionIdentity: string;
  nodeIds?: readonly string[];
  residue?: true;
  infeasible?: true;
}

export interface AcceptanceCoverageContractNode {
  id: string;
  mandatory?: boolean;
}

export interface AcceptanceCoverageMappingOutcome {
  readonly index: number;
  readonly criterion_identity: string;
  readonly node_ids: readonly string[];
  readonly state: AcceptanceCoverageState;
}

export interface AcceptanceCoverageCriterionResult {
  readonly criterion_identity: string;
  readonly position: number;
  readonly state: AcceptanceCoverageState;
  readonly mapping_indexes: readonly number[];
}

export class AcceptanceCoverageError extends Error {
  code: string;
  details: Record<string, unknown>;
}

export const ACCEPTANCE_COVERAGE_STATES: readonly AcceptanceCoverageState[];

export type CoverageAuthoringSurface = "obligation" | "acceptance";
export interface CoverageAuthoringMutationInput {
  operation: string;
  stableArguments: Readonly<Record<string, unknown>>;
  receiptFedDigestFields: readonly string[];
}
export interface CoverageAuthoringObligationInput {
  mechanisms: readonly unknown[];
  gapAlternatives: readonly unknown[];
  packComponents: readonly unknown[];
  expectedAuthoringIdentity: string;
  sourceIdentity: Readonly<Record<string, unknown>>;
}
export interface CoverageAuthoringServerInput {
  unitAddress: string;
  selectedUnit: string | null;
  focus: string | null;
  selectedUnitDigest: string;
  criterionIdentities: readonly unknown[];
  contractContentDigest: string;
  contractNodes: readonly Readonly<Record<string, unknown>>[];
  proofPlanContentDigest: string | null;
  selectedPacks: readonly unknown[];
  carrierStatus: string;
  changedBindings: readonly unknown[];
  mutation: CoverageAuthoringMutationInput;
  obligation?: CoverageAuthoringObligationInput;
  authoredDecisions?: Readonly<Record<string, unknown>>;
}
export interface CoverageAuthoringSkeletonEntry {
  readonly reference_id: `ref-skeleton-entry-${string}`;
  readonly term: `wk-2439-${string}`;
  readonly authority: "server" | "caller_authored" | "evolving_cas"
    | "existing_transport" | "metric";
  readonly [key: string]: unknown;
}
export interface CoverageAuthoringSkeletonResult {
  readonly schema_version: "coverage-authoring-skeleton.v1";
  readonly surface: CoverageAuthoringSurface;
  readonly complete_population: readonly CoverageAuthoringSkeletonEntry[];
  readonly inline_projection: Readonly<{
    byte_limit: number; total: 39; returned: number; omitted: number;
    utf8_bytes: number; entries: readonly CoverageAuthoringSkeletonEntry[];
  }>;
  readonly mutation_handoff: Readonly<Record<string, unknown>>;
  readonly diagnostics: readonly Readonly<Record<string, unknown>>[];
  readonly facts: Readonly<{
    request_utf8_bytes: number; result_utf8_bytes: number;
    intended_entry_count: 39; returned_entry_count: number;
    omitted_entry_count: number; unresolved_slot_count: number;
  }>;
}
export function composeCoverageAuthoringSkeleton(input: {
  surface: CoverageAuthoringSurface;
  server: CoverageAuthoringServerInput;
  inlineByteLimit?: number;
}): CoverageAuthoringSkeletonResult;
