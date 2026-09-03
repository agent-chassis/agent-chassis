import type {
  AdmittedProofPackSnapshot,
  PackageMintedExactBindingResult,
  PackageMintedVerificationProfileV1Result
} from "./current-admitted-proof-packs.mjs";

export type ObligationCoverageMechanismKind =
  | "code_symbol" | "schema" | "test" | "configuration"
  | "durable_record" | "tool_operation";
export type ObligationGuaranteeSelectorKind =
  | "reference_binding" | "claim" | "relation" | "collection"
  | "resolver_fact" | "evidence";
export type ObligationCoverageGapKind =
  | "catalog_gap" | "mechanism_gap" | "implementation_not_delivered"
  | "existing_mechanism_unextended" | "review_only" | "no_proof_required";
export type ObligationCoverageOutcome =
  | "stale" | "unmapped" | "explicit_gap" | "guarantee_incompatible"
  | "mapped_input_missing" | "mapped_pack_not_evaluated"
  | "profile_proven_exact_binding_missing" | "mechanically_proven";
export interface ObligationGuaranteeSelector {
  readonly kind: ObligationGuaranteeSelectorKind;
  readonly component_id: string;
}
export interface ObligationCoveragePackMapping {
  readonly kind: "pack_mapping";
  readonly pack_id: string;
  readonly requested_intent: string;
  readonly profile_id: string;
  readonly profile_version: string;
  readonly selector: ObligationGuaranteeSelector;
  readonly evaluation_stage: "pre_dispatch" | "post_delivery";
}
export interface ObligationCoverageExplicitGap {
  readonly kind: "explicit_gap";
  readonly gap_kind: ObligationCoverageGapKind;
  readonly reason: string;
}
export interface ObligationCoverageRow {
  readonly obligation_id: string;
  readonly source_locator: string;
  readonly source_locator_digest: `sha256:${string}`;
  readonly statement: string;
  readonly controlled_contract_node_ids: readonly string[];
  readonly mechanism: Readonly<{
    owner: string;
    kind: ObligationCoverageMechanismKind;
    selector: string;
  }>;
  readonly proof: ObligationCoveragePackMapping | ObligationCoverageExplicitGap;
}
export interface ObligationCoverageCarrier {
  readonly schema_version: "controlled-contract-obligation-coverage.v1";
  readonly wk_id: string;
  readonly focus?: string | null;
  readonly obligations: readonly ObligationCoverageRow[];
}
export interface ObligationCoverageCarrierValidationResult {
  readonly schema_valid: boolean;
  readonly schema_errors: readonly Readonly<Record<string, unknown>>[];
  readonly diagnostics: readonly Readonly<Record<string, unknown>>[];
  readonly valid: boolean;
  readonly carrier: ObligationCoverageCarrier | null;
}
export const OBLIGATION_COVERAGE_SCHEMA_VERSION: "controlled-contract-obligation-coverage.v1";
export const OBLIGATION_COVERAGE_SCHEMA: Readonly<Record<string, unknown>>;
export const OBLIGATION_COVERAGE_GAP_KINDS: readonly ObligationCoverageGapKind[];
export const OBLIGATION_COVERAGE_MECHANISM_KINDS: readonly ObligationCoverageMechanismKind[];
export const OBLIGATION_COVERAGE_OUTCOMES: readonly ObligationCoverageOutcome[];
export function validateObligationCoverageCarrier(
  carrier: Record<string, unknown>
): ObligationCoverageCarrierValidationResult;

export interface ObligationGuaranteeSelectorPackArtifacts {
  readonly pack_id: string;
  readonly requested_intents: readonly string[];
  readonly pack_snapshot: AdmittedProofPackSnapshot;
  readonly assessment: PackageMintedVerificationProfileV1Result | null;
  readonly evaluation_input_present: boolean;
  readonly profile_discrimination: "proven" | "not_proven" | "not_assessed";
  readonly exact_binding: PackageMintedExactBindingResult | null;
}

export interface ObligationGuaranteeSelectorComponent {
  readonly pack_id: string;
  readonly profile_id: string;
  readonly profile_version: string;
  readonly requested_intents: readonly string[];
  readonly selector: ObligationGuaranteeSelector;
  readonly evaluation_stage: "pre_dispatch" | "post_delivery";
  readonly assessed_evaluation_stage: "pre_dispatch" | "post_delivery" | null;
  readonly guarantee_applicability_proven: boolean;
  readonly applicable_exclusion: boolean | null;
  readonly matched_node_ids: readonly string[] | null;
  readonly satisfaction: string | null;
  readonly evaluation_input_present: boolean;
  readonly pack_evaluated: boolean;
  readonly profile_discrimination: "proven" | "not_proven" | "not_assessed";
  readonly exact_binding_required: boolean;
  readonly exact_binding: "proven" | "not_proven" | "not_assessed" | "not_applicable";
}
export interface ObligationGuaranteeSelectorIndex {
  readonly version: "obligation-guarantee-selector-index.v1";
  readonly pack_ids: readonly string[];
  readonly components: readonly ObligationGuaranteeSelectorComponent[];
}
export class ObligationGuaranteeSelectorError extends Error {
  code: string;
  details: Record<string, unknown>;
}
export const OBLIGATION_GUARANTEE_SELECTOR_INDEX_VERSION: "obligation-guarantee-selector-index.v1";
export const OBLIGATION_GUARANTEE_SELECTOR_KINDS: readonly ObligationGuaranteeSelectorKind[];
export const OBLIGATION_GUARANTEE_SELECTOR_RESOLUTION_STATUSES: readonly string[];
export function buildObligationGuaranteeSelectorIndex(input:
  | {
    assessment: Readonly<Record<string, unknown>>;
    packs?: never;
  }
  | {
    assessment?: never;
    packs: readonly ObligationGuaranteeSelectorPackArtifacts[];
  }
): ObligationGuaranteeSelectorIndex;
export function resolveObligationGuaranteeSelector(input: {
  index: ObligationGuaranteeSelectorIndex;
  mapping: ObligationCoveragePackMapping;
  nodeIds: readonly string[];
}): Readonly<{
  status: "compatible" | "incompatible" | "mapped_input_missing"
    | "mapped_pack_not_evaluated" | "profile_proven_exact_binding_missing";
  reason: string | null;
  component: ObligationGuaranteeSelectorComponent | null;
}>;
