export interface ProofIntentDiscoveryPack {
  profile_id: string;
  profile_version: string;
}

export interface ProofIntentDiscoveryDistinction {
  from_intent_id: string;
  explanation: string;
}

export interface ProofIntentDiscoveryMatchReason {
  source: "intent_id" | "definition" | "discovery_term";
  source_value: string;
  matched_terms: string[];
}

export interface ProofIntentDiscoverySummary {
  intent_id: string;
  definition: string;
  discovery_terms: string[];
  capable_packs: ProofIntentDiscoveryPack[];
  distinctions: ProofIntentDiscoveryDistinction[];
  match_kind: "catalog_entry" | "exact_match" | "partial_match";
  matched_terms: string[];
  unmatched_terms: string[];
  match_reasons: ProofIntentDiscoveryMatchReason[];
}

export interface ProofIntentDiscoveryResult {
  schema_version: "controlled-contract-proof-intent-discovery.v1";
  mode: "list" | "search";
  query: null | { normalized_text: string; terms: string[] };
  status: "match" | "partial_match" | "no_match";
  catalog_intent_count: number;
  evaluated_intent_count: number;
  total_match_count: number;
  returned_count: number;
  omitted_count: number;
  truncated: boolean;
  result_limit: number | null;
  guidance: {
    code: "inspect_catalog" | "inspect_exact_candidates" |
      "inspect_partial_candidates_and_refine_query" |
      "refine_query_or_list_catalog";
    message: string;
  };
  intents: ProofIntentDiscoverySummary[];
  catalog_digest: string;
  selection_performed: false;
  pack_invocation_performed: false;
  pack_admission_performed: false;
  authority: "non_authoritative";
}

export class ProofIntentDiscoveryError extends Error {
  code: string;
  details: Record<string, unknown>;
}

export const MAX_DISCOVERY_QUERY_BYTES: 1024;
export const MAX_DISCOVERY_RESULT_BYTES: 65536;
export const MAX_DISCOVERY_RETURNED_INTENTS: 256;
export const PROOF_INTENT_DISCOVERY_CATALOG:
  Readonly<Record<string, unknown>>;
export const PROOF_INTENT_DISCOVERY_CATALOG_DIGEST: string;
export function discoverProofIntents(options?: {
  query?: string;
  limit?: number;
}): Readonly<ProofIntentDiscoveryResult>;
export function canonicalProofIntentDiscoveryJson(
  result: ProofIntentDiscoveryResult
): string;
