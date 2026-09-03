export interface ProofIntentDigests {
  algorithm: "sha256-canonical-json-v1";
  catalog: string;
  vocabulary: string;
  profiles: string;
  intent_artifact: string;
}

export interface ProofPackSelectionResult {
  schema_version: "controlled-contract-proof-pack-selection.v1";
  requested_intents: string[];
  selected_packs: Array<{
    profile_id: string;
    profile_version: string;
    requested_intents: string[];
    selection_status: "ready" | "requires_bindings";
  }>;
  ambiguous_intents: Array<Record<string, unknown>>;
  uncovered_intents: Array<Record<string, unknown>>;
  packs_requiring_bindings: Array<{ profile_id: string; profile_version: string }>;
  hard_incompatibilities: Array<Record<string, unknown>>;
  candidates: Array<Record<string, unknown>>;
  digests: ProofIntentDigests;
  authority: "non_authoritative";
}

export type ProofPackSelectionStatus =
  | "hard_incompatibility_present"
  | "requested_intents_uncovered"
  | "compatible_candidates_require_bindings"
  | "compatible_candidates_ready_for_authoring";

export interface ProofPackSelectionResultV2 {
  schema_version: "controlled-contract-proof-pack-selection.v2";
  decision: {
    selection_scope: "requested_intents_only";
    selection_status: ProofPackSelectionStatus;
    requested_intent_count: number;
    compatible_candidate_count: number;
    uncovered_requested_intent_count: number;
    hard_incompatibility_count: number;
    missing_authoring_binding_count: number;
    unrequested_intent_applicability: "not_evaluated";
    runtime_evidence_applicability: "not_evaluated";
  };
  requested_intents: string[];
  per_intent_outcomes: Array<Record<string, unknown>>;
  compatible_candidates: Array<{
    profile_id: string;
    profile_version: string;
    requested_intents: string[];
    authoring_state: "ready_for_authoring" | "requires_bindings";
    missing_authoring_binding_count: number;
  }>;
  hard_incompatibilities: Array<Record<string, unknown>>;
  candidates: Array<Record<string, unknown>>;
  digests: ProofIntentDigests;
  authority: "non_authoritative";
}

export interface ProofPackAuthoringProjection {
  schema_version: "controlled-contract-proof-pack-authoring.v1";
  digest_algorithm: "sha256-canonical-json-v1";
  profile_id: string;
  profile_version: string;
  requested_intents: string[];
  intent_definitions: Array<{ intent_id: string; definition: string }>;
  intent_distinctions: Array<{
    intent_id: string;
    from_intent_id: string;
    explanation: string;
  }>;
  guarantee: string;
  explicit_exclusions: string[];
  compatibility: Record<string, string>;
  evaluation_input_skeleton: Record<string, unknown>;
  role_constraints: Record<string, unknown>;
  proof_obligations: Record<string, unknown>;
  counts: Record<string, number>;
  source_digests: Record<string, string>;
  authority: "non_authoritative";
  projection_digest: string;
}

export class ProofIntentSelectionError extends Error {
  code: string;
  details: Record<string, unknown>;
}

export const PROOF_INTENT_ARTIFACT: Readonly<Record<string, unknown>>;
export const PROOF_INTENT_DIGESTS: Readonly<ProofIntentDigests>;
export const MAX_AUTHORING_PROJECTION_BYTES: 65536;
export function selectProofPacks(input: {
  contract: Record<string, unknown>;
  requestedIntents: string[];
  expectedDigests?: ProofIntentDigests | null;
}): Readonly<ProofPackSelectionResult>;
export function selectProofPacksV2(input: {
  contract: Record<string, unknown>;
  requestedIntents: string[];
  expectedDigests?: ProofIntentDigests | null;
}): Readonly<ProofPackSelectionResultV2>;
export function compactProofIntentSelection(
  result: ProofPackSelectionResult
): Readonly<Record<string, unknown>>;
export function describeProofPackAuthoring(input: {
  profileId: string;
  profileVersion: string;
  requestedIntents?: string[] | null;
}): Readonly<ProofPackAuthoringProjection>;
