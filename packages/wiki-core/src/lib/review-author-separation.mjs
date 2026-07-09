

import { ACCEPTED_IDENTITY_TRUST_SOURCES } from "./agent-dispatch-identity.mjs";

export const REVIEW_AUTHOR_SEPARATION_SCHEMA_VERSION = "review-author-separation.v1";

export const REVIEW_AUTHOR_SEPARATION_DIAGNOSTIC_CODES = Object.freeze({
  INVALID_ARG: "wiki_core.review_author_separation.invalid_arg.v1",

  AUTHOR_LOOKUP_UNAVAILABLE: "wiki_core.review_author_separation.author_lookup_unavailable.v1",

  AUTHOR_IDENTITY_ABSENT: "wiki_core.review_author_separation.author_identity_absent.v1",

  AUTHOR_IDENTITY_UNVERIFIABLE: "wiki_core.review_author_separation.author_identity_unverifiable.v1",

  REVIEWER_PRINCIPAL_MISSING: "wiki_core.review_author_separation.reviewer_principal_missing.v1",

  REVIEWER_IS_AUTHOR: "wiki_core.review_author_separation.reviewer_is_author.v1"
});

export const REVIEW_AUTHOR_SEPARATION_REFUSAL_REASONS = Object.freeze({

  FAIL_CLOSED: "fail_closed",

  SELF_REVIEW: "self_review"
});

export class ReviewAuthorSeparationError extends Error {
  constructor(message, { code, reason, detail = null, cause = null } = {}) {
    super(message);
    this.name = "ReviewAuthorSeparationError";
    this.code = code ?? "wiki_core.review_author_separation.error.v1";
    this.reason = reason ?? REVIEW_AUTHOR_SEPARATION_REFUSAL_REASONS.FAIL_CLOSED;
    if (detail !== null) this.detail = detail;
    if (cause !== null) this.cause = cause;
  }
}

function refuse(code, reason, message, detail = null, cause = null) {
  throw new ReviewAuthorSeparationError(`wiki-core review-author-separation: ${message}`, {
    code,
    reason,
    detail,
    cause
  });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveUnitId(unit) {
  if (typeof unit === "string" && unit.length > 0) return unit;
  if (isPlainObject(unit) && typeof unit.id === "string" && unit.id.length > 0) return unit.id;
  refuse(
    REVIEW_AUTHOR_SEPARATION_DIAGNOSTIC_CODES.INVALID_ARG,
    REVIEW_AUTHOR_SEPARATION_REFUSAL_REASONS.FAIL_CLOSED,
    "unit must be a non-empty id string or a record with a non-empty string id"
  );
}

function coercePrincipal(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? value : null;
  }
  if (isPlainObject(value) && typeof value.principal === "string") {
    const trimmed = value.principal.trim();
    return trimmed.length > 0 ? value.principal : null;
  }
  return null;
}

function canonicalPrincipal(principal) {
  return principal.trim().toLowerCase();
}

function readVerifiedAuthorIdentity(authorIdentityLookup, unitId) {
  if (typeof authorIdentityLookup !== "function") {
    refuse(
      REVIEW_AUTHOR_SEPARATION_DIAGNOSTIC_CODES.AUTHOR_LOOKUP_UNAVAILABLE,
      REVIEW_AUTHOR_SEPARATION_REFUSAL_REASONS.FAIL_CLOSED,
      "an authorIdentityLookup dependency is required; refusing to dispatch a review whose author cannot be looked up"
    );
  }

  let recorded;
  try {
    recorded = authorIdentityLookup(unitId);
  } catch (err) {

    refuse(
      REVIEW_AUTHOR_SEPARATION_DIAGNOSTIC_CODES.AUTHOR_LOOKUP_UNAVAILABLE,
      REVIEW_AUTHOR_SEPARATION_REFUSAL_REASONS.FAIL_CLOSED,
      "authorIdentityLookup threw; cannot prove review independence",
      { unit: unitId },
      err
    );
  }

  if (recorded === null || recorded === undefined) {
    refuse(
      REVIEW_AUTHOR_SEPARATION_DIAGNOSTIC_CODES.AUTHOR_IDENTITY_ABSENT,
      REVIEW_AUTHOR_SEPARATION_REFUSAL_REASONS.FAIL_CLOSED,
      "no server-authenticated author identity was recorded for the unit at commit; cannot prove review independence",
      { unit: unitId }
    );
  }

  const principal = coercePrincipal(recorded);
  if (principal === null) {
    refuse(
      REVIEW_AUTHOR_SEPARATION_DIAGNOSTIC_CODES.AUTHOR_IDENTITY_UNVERIFIABLE,
      REVIEW_AUTHOR_SEPARATION_REFUSAL_REASONS.FAIL_CLOSED,
      "the recorded author identity carries no principal; cannot prove review independence",
      { unit: unitId }
    );
  }

  const trustSource = isPlainObject(recorded) ? recorded.trust_source : undefined;
  if (!ACCEPTED_IDENTITY_TRUST_SOURCES.has(trustSource)) {
    refuse(
      REVIEW_AUTHOR_SEPARATION_DIAGNOSTIC_CODES.AUTHOR_IDENTITY_UNVERIFIABLE,
      REVIEW_AUTHOR_SEPARATION_REFUSAL_REASONS.FAIL_CLOSED,
      "the recorded author identity is not proven server-authenticated (trust_source must be launcher/transport-minted); cannot prove review independence",
      { unit: unitId, trust_source: trustSource ?? null }
    );
  }

  return { principal, trust_source: trustSource };
}

export function assertReviewerNotAuthor({
  unit,
  candidateReviewerPrincipal,
  authorIdentityLookup
} = {}) {
  const unitId = resolveUnitId(unit);

  const reviewerPrincipal = coercePrincipal(candidateReviewerPrincipal);
  if (reviewerPrincipal === null) {
    refuse(
      REVIEW_AUTHOR_SEPARATION_DIAGNOSTIC_CODES.REVIEWER_PRINCIPAL_MISSING,
      REVIEW_AUTHOR_SEPARATION_REFUSAL_REASONS.FAIL_CLOSED,
      "candidateReviewerPrincipal must be a non-empty principal string (or an envelope carrying one); cannot prove review independence",
      { unit: unitId }
    );
  }

  const author = readVerifiedAuthorIdentity(authorIdentityLookup, unitId);

  if (canonicalPrincipal(reviewerPrincipal) === canonicalPrincipal(author.principal)) {
    refuse(
      REVIEW_AUTHOR_SEPARATION_DIAGNOSTIC_CODES.REVIEWER_IS_AUTHOR,
      REVIEW_AUTHOR_SEPARATION_REFUSAL_REASONS.SELF_REVIEW,
      "refusing to dispatch the findings-only review to the principal that authored the unit's commit (self-review collapses the sole correctness gate)",
      { unit: unitId, principal: author.principal }
    );
  }

  return Object.freeze({
    schema_version: REVIEW_AUTHOR_SEPARATION_SCHEMA_VERSION,
    allowed: true,
    unit: unitId,
    author_principal: author.principal,
    reviewer_principal: reviewerPrincipal
  });
}

export function checkReviewerNotAuthor(args) {
  try {
    return assertReviewerNotAuthor(args);
  } catch (err) {
    if (err instanceof ReviewAuthorSeparationError) {
      return Object.freeze({
        schema_version: REVIEW_AUTHOR_SEPARATION_SCHEMA_VERSION,
        allowed: false,
        code: err.code,
        reason: err.reason,
        message: err.message,
        detail: err.detail ?? null
      });
    }
    throw err;
  }
}
