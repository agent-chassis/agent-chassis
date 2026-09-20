/**
 * The one owner of which authored contract claims an admitted proof pack's
 * evaluation actually recognized, and of how that evaluation is produced.
 *
 * Participation is exactly the claims consumed by patterns the evaluation
 * reports `satisfied`: the claim ids a claim pattern matched, and the
 * membership and cardinality claims a `complete_population` reference-binding
 * pattern selected. An ambiguous, missing, unsatisfied, invalid, or
 * downstream-conflicting pattern contributes nothing, even where its
 * `matched_ids` carries candidates.
 */
export interface SelectedPackCoveredClaim {
  claim_id: string;
  pattern_ids: readonly string[];
}

export interface SelectedPackClaimParticipation {
  profile_id: string;
  profile_version: string;
  profile_digest: string;
  satisfaction: string;
  covered_claims: readonly SelectedPackCoveredClaim[];
  claim_ids: readonly string[];
}

export class SelectedPackClaimParticipationError extends Error {
  code: string;
  details: Record<string, unknown>;
}

export function matchedProfileCoveredClaims(
  evaluation: Record<string, unknown> | null
): Array<{ claim_id: string; pattern_ids: string[] }>;

export function matchedProfileCoveredClaimIds(
  evaluation: Record<string, unknown> | null
): string[];

export function evaluateAdmittedPack(
  input: {
    contract: Record<string, unknown>;
    evaluationInput: Record<string, unknown> | null;
    proofPack: Record<string, unknown>;
  },
  options?: Record<string, unknown>
): Record<string, unknown>;

export function evaluateSelectedPackClaimParticipation(input: {
  contract: Record<string, unknown>;
  evaluationInput: Record<string, unknown> | null;
  profileId: string;
  profileVersion: string;
}): Promise<Readonly<SelectedPackClaimParticipation>>;
