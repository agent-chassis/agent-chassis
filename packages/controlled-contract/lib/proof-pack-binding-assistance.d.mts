export type ProofPackBindingStatus = "unbound" | "one_compatible_candidate" |
  "ambiguous" | "incompatible" | "validly_bound";

export interface ProofPackBindingAssistanceResult {
  schema_version: "controlled-contract-proof-pack-binding-assistance.v1";
  digest_algorithm: "sha256-canonical-json-v1";
  profile_id: string;
  profile_version: string;
  requested_intents: string[];
  contract_digest: string;
  evaluation_input_digest: string | null;
  reference_roles: Array<Record<string, unknown> & {
    role: string;
    status: ProofPackBindingStatus;
  }>;
  number_roles: Array<Record<string, unknown> & {
    role: string;
    status: ProofPackBindingStatus;
  }>;
  evaluation_input_diagnostics: Array<Record<string, unknown>>;
  summary: ProofPackBindingSummary;
  source_digests: Record<string, string>;
  result_digest: string;
  binding_selected: false;
  binding_written: false;
  semantic_truth_inferred: false;
  authority: "non_authoritative";
}

export interface ProofPackBindingSummary {
  reference_role_count: number;
  number_role_count: number;
  /**
   * Incompatible supplied roles plus named evaluation-input diagnostics. It is
   * greater than zero for every `invalid` summary, so `invalid` can never
   * coexist with zero explaining counts and no named identity.
   */
  incompatible_binding_count: number;
  status: "not_supplied" | "valid" | "invalid";
}

export interface ProofPackBindingPageResult {
  schema_version: "controlled-contract-proof-pack-binding-page.v1";
  profile_id: string;
  profile_version: string;
  requested_intents: string[];
  authority: "non_authoritative";
  summary: ProofPackBindingSummary;
  counts: Readonly<Record<
    "supplied" | "missing" | "ambiguous" | "incompatible", number
  >>;
  role_index: Array<{
    kind: "reference" | "number";
    role: string;
    status: ProofPackBindingStatus;
    compatible_candidate_count: number;
  }>;
  evaluation_input_diagnostics: Array<Record<string, unknown>>;
  proof_pack_authoring?: Record<string, unknown>;
  selection: {
    roles: string[];
    statuses: string[];
    unmatched_role_count: number;
    unmatched_status_count: number;
  };
  population: Readonly<Record<
    "total_count" | "matched_count" | "offset" | "returned_count" |
    "omitted_count" | "remaining_count", number
  >>;
  items: Array<Record<string, unknown>>;
  digests: Record<string, string>;
  binding_selected: false;
  binding_written: false;
  semantic_truth_inferred: false;
}

export class ProofPackBindingAssistanceError extends Error {
  code: string;
  details: Record<string, unknown>;
}

export const MAX_BINDING_ASSISTANCE_BYTES: 65536;
export function inspectProofPackBindings(input: {
  contract: Record<string, unknown>;
  profileId: string;
  profileVersion: string;
  requestedIntents?: string[] | null;
  evaluationInput?: Record<string, unknown> | null;
}): Promise<Readonly<ProofPackBindingAssistanceResult>>;
export function validateSuppliedProofPackBindings(input: {
  contract: Record<string, unknown>;
  profileId: string;
  profileVersion: string;
  evaluationInput?: Record<string, unknown> | null;
}): Promise<Readonly<{
  reference_roles: Array<{
    role: string;
    status: "unbound" | "incompatible" | "validly_bound";
    diagnostics: Array<Record<string, unknown>>;
  }>;
  number_roles: Array<{
    role: string;
    status: "unbound" | "incompatible" | "validly_bound";
    diagnostics: Array<Record<string, unknown>>;
  }>;
  evaluation_input_diagnostics: Array<Record<string, unknown>>;
  summary: ProofPackBindingSummary;
}>>;
export function inspectProofPackBindingsPage(input: {
  contract: Record<string, unknown>;
  profileId: string;
  profileVersion: string;
  requestedIntents?: string[] | null;
  evaluationInput?: Record<string, unknown> | null;
  roles?: string[];
  statuses?: string[];
  offset?: number;
  maximumItems?: number;
}): Promise<Readonly<ProofPackBindingPageResult>>;
export function validateProofPackBindingAssistance(
  result: unknown
): result is ProofPackBindingAssistanceResult;
export function canonicalProofPackBindingAssistanceJson(
  result: ProofPackBindingAssistanceResult
): string;
