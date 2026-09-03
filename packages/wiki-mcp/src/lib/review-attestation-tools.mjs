

import { publishOriginalReviewAttestation } from
  "./review-attestation-settlement.mjs";

const FORMAL_ATTESTATION_TTL_MS = 24 * 60 * 60 * 1000;

function normalizeUnitReference(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const local = trimmed.includes(":") ? trimmed.slice(trimmed.lastIndexOf(":") + 1) : trimmed;
  return /^WK-[0-9]{4}(?:#SLICE-[0-9]{3})?$/u.test(local) ? local : null;
}

function selectedAttestationTarget(record) {
  return normalizeUnitReference(record?.advisory_review_input?.subject ?? record?.subject);
}

export async function settleFormalReviewAttestationForDispatch({
  record,
  formalResult,
  workspaceRepos,
  resolveWorkspaceRepo
} = {}) {
  const target = selectedAttestationTarget(record);
  if (!target) {
    return {
      available: false,
      reason: "canonical_attestation_target_ambiguous"
    };
  }
  const reviewedAt = new Date(record.updated_at).getTime();
  if (!Number.isFinite(reviewedAt)) {
    return { available: false, reason: "trusted_review_timestamp_unavailable" };
  }
  const workspace = resolveWorkspaceRepo(
    workspaceRepos,
    record.advisory_review_input?.repository ?? record.workspace_alias
  );
  const result = await publishOriginalReviewAttestation({
    workspace,
    subject: target,
    role: record.role,
    runId: record.run_id,
    reviewedAt: record.updated_at,
    expiresAt: new Date(reviewedAt + FORMAL_ATTESTATION_TTL_MS).toISOString(),
    formalResult
  });
  if (result?.recorded !== true) {
    return {
      available: false,
      reason: result?.reason ?? "attestation_publication_unavailable",
      diagnostics: Array.isArray(result?.diagnostics) ? result.diagnostics.slice(0, 20) : []
    };
  }
  const attestation = result.attestation;
  return {
    available: true,
    reason: "derived_and_published_during_original_settlement",
    attestation_id: attestation.attestation_id,
    attestation_digest: attestation.attestation_digest,
    reviewed_controls: attestation.reviewed_controls,
    reviewer_role_class: attestation.reviewer_role_class,
    review_outcome: attestation.review_outcome,
    reviewed_at: attestation.reviewed_at,
    expires_at: attestation.expires_at
  };
}
