import {
  EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION,
  EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V2,
  EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V3,
  EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V4,
  IMMUTABLE_COMMON_RECEIPT_FIELDS,
  OPTIONAL_RECEIPT_FIELDS,
  RECEIPT_FIELDS,
  RECEIPT_FIELDS_V3,
  RECEIPT_FIELDS_V4,
  RECEIPT_CLEANUP_ONLY_FIELD,
  RECEIPT_RESULT_MODE_FIELD,
  RECEIPT_VERDICT_EVIDENCE_FIELD,
  RECEIPT_VERDICT_EVIDENCE_STATES,
  REVIEWER_LINEAGE_RECEIPT_FIELDS,
  TERMINAL_STATUSES,
  V1_RECEIPT_IDENTITY_FIELDS,
  V2_RECEIPT_IDENTITY_FIELDS,
  VERDICT_EVIDENCE_RANK
} from "./workspace-agent-dispatch-run-receipt-schema.mjs";
import {
  canonicalJson,
  canonicalize,
  digestTrustedExactReviewEvidence,
  normalizedEvidenceFromReceipt,
  validateExactSliceReviewReceipt,
  validateAttemptLineageIdentity,
  validateRecoveryTransitionIdentity,
  validateReviewDispatchIdentity
} from "./workspace-agent-dispatch-run-receipt-validation.mjs";

export function createExactSliceReviewReceipt(fields) {
  const schemaVersion = fields?.review_dispatch_identity !== undefined ||
    fields?.attempt_lineage_identity !== undefined
    ? EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V4
    : fields?.review_admission_kind === "canonical_committed_slice" ||
    Object.prototype.hasOwnProperty.call(fields ?? {}, "committed_target_digest")
    ? EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V3
    : EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION;
  const allowedFields = schemaVersion === EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V4
    ? RECEIPT_FIELDS_V4
    : schemaVersion === EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V3
      ? RECEIPT_FIELDS_V3
    : RECEIPT_FIELDS;
  const unknown = Object.keys(fields ?? {}).find((field) =>
    (!allowedFields.includes(field) && !OPTIONAL_RECEIPT_FIELDS.includes(field)) ||
    field === "schema_version" ||
    field === "trusted_evidence_digest" || field === "receipt_digest");
  if (unknown !== undefined) {
    throw new Error(`exact slice review receipt carries forbidden field: ${unknown}`);
  }
  const bodyWithoutEvidence = canonicalize({
    schema_version: schemaVersion,
    ...fields
  });
  const body = canonicalize({
    ...bodyWithoutEvidence,
    trusted_evidence_digest: digestTrustedExactReviewEvidence(
      normalizedEvidenceFromReceipt(bodyWithoutEvidence)
    )
  });
  return validateExactSliceReviewReceipt(Object.freeze({
    ...body,
    receipt_digest: digestTrustedExactReviewEvidence(body)
  }));
}

export function reviseExactSliceReviewReceipt(receipt, patch) {
  validateExactSliceReviewReceipt(receipt);
  const allowed = new Set([
    "terminal_run_status", "structured_outcome",
    ...OPTIONAL_RECEIPT_FIELDS
  ]);
  const forbidden = Object.keys(patch ?? {}).find((field) => !allowed.has(field));
  if (forbidden !== undefined) {
    throw new Error(`exact slice review receipt revision cannot change immutable field: ${forbidden}`);
  }
  const {
    schema_version: _schemaVersion,
    receipt_digest: _receiptDigest,
    trusted_evidence_digest: _evidenceDigest,
    ...fields
  } = receipt;
  return createExactSliceReviewReceipt({ ...fields, ...patch });
}

function immutableIdentity(receipt) {
  const identityFields = [EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V2,
    EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V3,
    EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V4].includes(receipt.schema_version)
    ? V2_RECEIPT_IDENTITY_FIELDS
    : V1_RECEIPT_IDENTITY_FIELDS;
  const fields = [...IMMUTABLE_COMMON_RECEIPT_FIELDS, ...identityFields,
    ...(receipt.schema_version === EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V4

      ? REVIEWER_LINEAGE_RECEIPT_FIELDS.filter((field) =>
          field !== "recovery_transition_identity")
      : [])];
  return Object.fromEntries(fields.map((field) => [field, receipt[field]]));
}

export function identityDigest(receipt) {
  return digestTrustedExactReviewEvidence(immutableIdentity(receipt)).slice("sha256:".length);
}

export function canonicalIdentityDigest(identity) {
  if (identity?.kind === "review_dispatch") validateReviewDispatchIdentity(identity);
  else if (identity?.kind === "attempt_lineage") validateAttemptLineageIdentity(identity);
  else if (identity?.kind === "recovery_transition") validateRecoveryTransitionIdentity(identity);
  else throw new Error("review identity kind is unsupported");
  return digestTrustedExactReviewEvidence({ identity_kind: identity.kind, identity });
}

export function assertMonotonicIdentityTransition(prior, next, transition) {
  validateAttemptLineageIdentity(prior);
  validateAttemptLineageIdentity(next);
  validateRecoveryTransitionIdentity(transition);
  if (prior.review_dispatch_id !== next.review_dispatch_id ||
      transition.review_dispatch_id !== prior.review_dispatch_id ||
      transition.prior_attempt_id !== prior.attempt_id ||
      transition.next_attempt_id !== next.attempt_id ||
      canonicalJson(prior.target) !== canonicalJson(next.target) ||
      canonicalJson(prior.current_generation) !== canonicalJson(next.current_generation) ||
      canonicalJson(transition.prior_generation) !== canonicalJson(prior.current_generation) ||
      canonicalJson(transition.next_generation) !== canonicalJson(next.current_generation)) {
    throw new Error("review identity transition crosses dispatch or stale generation");
  }
  if (transition.transition_type !== "replacement" && prior.attempt_id !== next.attempt_id) {
    throw new Error("retry or recovery must retain its attempt identity");
  }
  if (transition.transition_type === "replacement" && prior.attempt_id === next.attempt_id) {
    throw new Error("replacement must mint a distinct attempt identity");
  }
  return Object.freeze({ prior, next, transition });
}

function sameImmutableIdentity(left, right) {
  return canonicalJson(immutableIdentity(left)) === canonicalJson(immutableIdentity(right));
}

export function assertMonotonicTransition(prior, next) {
  if (!sameImmutableIdentity(prior, next)) {
    throw new Error("exact slice review receipt transition changes immutable identity");
  }
  if (prior.schema_version === EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V4) {
    const priorTransition = prior.recovery_transition_identity;
    const nextTransition = next.recovery_transition_identity;
    if (priorTransition === null && nextTransition !== null) {
      assertMonotonicIdentityTransition(
        prior.attempt_lineage_identity,
        next.attempt_lineage_identity,
        nextTransition
      );
    } else if (priorTransition !== null &&
        canonicalJson(priorTransition) !== canonicalJson(nextTransition)) {
      throw new Error("exact slice review receipt transition identity is non-monotonic");
    }
  }
  const runRank = { launching: 0, running: 1, succeeded: 2, failed: 2, cancelled: 2 };
  if (runRank[next.terminal_run_status] < runRank[prior.terminal_run_status] ||
      (TERMINAL_STATUSES.has(prior.terminal_run_status) &&
       prior.terminal_run_status !== next.terminal_run_status) ||
      (prior.structured_outcome !== null &&
       canonicalJson(prior.structured_outcome) !== canonicalJson(next.structured_outcome))) {
    throw new Error("exact slice review receipt transition is non-monotonic or conflicts with terminal state");
  }

  const priorEvidence = prior[RECEIPT_VERDICT_EVIDENCE_FIELD] ?? null;
  const nextEvidence = next[RECEIPT_VERDICT_EVIDENCE_FIELD] ?? null;
  if (priorEvidence !== null && nextEvidence !== null &&
      (VERDICT_EVIDENCE_RANK[nextEvidence] < VERDICT_EVIDENCE_RANK[priorEvidence] ||
       (priorEvidence !== RECEIPT_VERDICT_EVIDENCE_STATES.PENDING &&
        priorEvidence !== nextEvidence))) {
    throw new Error("exact slice review receipt verdict evidence transition is non-monotonic");
  }

  if (prior[RECEIPT_CLEANUP_ONLY_FIELD] === true && next[RECEIPT_CLEANUP_ONLY_FIELD] !== true) {
    throw new Error("exact slice review receipt cannot withdraw its cleanup-only disposition");
  }
  const priorResultMode = prior[RECEIPT_RESULT_MODE_FIELD] ?? null;
  const nextResultMode = next[RECEIPT_RESULT_MODE_FIELD] ?? null;
  if (priorResultMode !== null && nextResultMode !== null &&
      priorResultMode !== nextResultMode) {
    throw new Error("exact slice review receipt cannot rewrite its settled result mode");
  }
}
