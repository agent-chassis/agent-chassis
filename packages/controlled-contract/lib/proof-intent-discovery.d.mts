export interface ProofDiscoveryCandidate {
  id: string;
  proof_name: string;
  profile_version: string;
  assertion: string;
  matching_assertion: string;
  essential_limitation: string | null;
  exclusions: string[];
  constraints: Array<{ ref: string; reading?: string; constraint: Record<string, unknown> }>;
  refinements: Array<Record<string, unknown>>;
  observations: string[];
  capabilities: Array<Record<string, unknown>>;
  provenance: Record<string, string>;
  associations: string[];
  ranking: {
    match_kind: 'catalog_entry' | 'assertion_match' | 'partial_assertion_match' | 'navigation_or_exclusion_match';
    relevance_score: number;
    matched_terms: string[];
    unmatched_terms: string[];
    provider_terms: string[];
    semantic_terms: string[];
    match_reasons: Array<{ source: string; source_value: string; matched_terms: string[] }>;
  };
}
export interface ProofIntentDiscoveryResult {
  schema_version: 'controlled-contract-proof-intent-discovery.v1';
  mode: 'list' | 'search' | 'detail';
  query: null | { normalized_text: string; terms: string[] };
  status: 'match' | 'no_match';
  catalog_intent_count: number;
  evaluated_intent_count: number;
  candidate_count: number;
  total_match_count: number;
  returned_count: number;
  omitted_count: number;
  truncated: boolean;
  result_limit: number | null;
  provider_context: {
    status: 'unspecified' | 'identified' | 'ambiguous' | 'conflicting';
    provider_terms: string[];
    families: string[];
  };
  candidates: ProofDiscoveryCandidate[];
  source_identity: { discovery: string };
  catalog_digest: string;
  selection_performed: false;
  pack_invocation_performed: false;
  pack_admission_performed: false;
  authority: 'non_authoritative';
}
export class ProofIntentDiscoveryError extends Error {
  code: string;
  details: Record<string, unknown>;
}
export const MAX_DISCOVERY_QUERY_BYTES: 1024;
export const MAX_DISCOVERY_RESULT_BYTES: null;
export const MAX_DISCOVERY_RETURNED_INTENTS: 256;
export const PROOF_INTENT_DISCOVERY_CATALOG: Readonly<Record<string, unknown>>;
export const PROOF_INTENT_DISCOVERY_CATALOG_DIGEST: string;
export const PROOF_VERIFICATION_CAPABILITIES: Readonly<Record<string, string>>;
export function proofVerificationCapability(proofName: string): string | null;
export function discoverProofIntents(options?: { query?: string; limit?: number } |
  { proof_name: string }): Readonly<ProofIntentDiscoveryResult>;
export function discoverCompleteProofIntents(options?: { query?: string }):
  Readonly<ProofIntentDiscoveryResult>;
export function rankProofIntentCandidates(
  population: ReadonlyArray<Record<string, unknown>>,
  options: {
    queryTerms: string[];
    providerTerms?: string[];
    limit?: number | null;
  }
): ProofDiscoveryCandidate[];
export function canonicalProofIntentDiscoveryJson(result: ProofIntentDiscoveryResult): string;
