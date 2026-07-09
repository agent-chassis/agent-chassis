

import test from "node:test";
import assert from "node:assert/strict";

import {
  REVIEW_AUTHOR_SEPARATION_DIAGNOSTIC_CODES as CODES,
  REVIEW_AUTHOR_SEPARATION_REFUSAL_REASONS as REASONS,
  REVIEW_AUTHOR_SEPARATION_SCHEMA_VERSION,
  ReviewAuthorSeparationError,
  assertReviewerNotAuthor,
  checkReviewerNotAuthor
} from "../packages/wiki-core/src/lib/review-author-separation.mjs";

const UNIT_ID = "WK-1434";
const AUTHOR = "launcher:worker/wk-1434/run-001";
const REVIEWER = "transport:reviewer/wk-1434/run-002";

function identity(principal = AUTHOR, trustSource = "launcher_minted") {
  return {
    principal,
    trust_source: trustSource
  };
}

function makeLookup(records = { [UNIT_ID]: identity() }) {
  const calls = [];
  const authorIdentityLookup = (unitId) => {
    calls.push(unitId);
    return records[unitId] ?? null;
  };
  return { authorIdentityLookup, calls };
}

function expectSeparationError(fn, { code, reason, detail = undefined } = {}) {
  assert.throws(fn, (err) => {
    assert.ok(
      err instanceof ReviewAuthorSeparationError,
      `expected ReviewAuthorSeparationError, got ${err?.name}: ${err?.message}`
    );
    assert.equal(err.code, code);
    if (reason !== undefined) {
      assert.equal(err.reason, reason);
    }
    if (detail !== undefined) {
      assert.deepEqual(err.detail, detail);
    }
    return true;
  });
}

test("assertReviewerNotAuthor allows review dispatch when reviewer principal differs from recorded author", () => {
  const { authorIdentityLookup, calls } = makeLookup();

  const result = assertReviewerNotAuthor({
    unit: { id: UNIT_ID },
    candidateReviewerPrincipal: { principal: REVIEWER },
    authorIdentityLookup
  });

  assert.deepEqual(calls, [UNIT_ID]);
  assert.equal(result.schema_version, REVIEW_AUTHOR_SEPARATION_SCHEMA_VERSION);
  assert.equal(result.allowed, true);
  assert.equal(result.unit, UNIT_ID);
  assert.equal(result.author_principal, AUTHOR);
  assert.equal(result.reviewer_principal, REVIEWER);
  assert.ok(Object.isFrozen(result), "allowed verdict must be frozen");
});

test("assertReviewerNotAuthor refuses self-review with canonicalized principal comparison", () => {
  const { authorIdentityLookup } = makeLookup({
    [UNIT_ID]: identity(" Launcher:Worker/WK-1434/Run-001 ")
  });

  expectSeparationError(
    () =>
      assertReviewerNotAuthor({
        unit: UNIT_ID,
        candidateReviewerPrincipal: "launcher:worker/wk-1434/run-001",
        authorIdentityLookup
      }),
    {
      code: CODES.REVIEWER_IS_AUTHOR,
      reason: REASONS.SELF_REVIEW,
      detail: { unit: UNIT_ID, principal: " Launcher:Worker/WK-1434/Run-001 " }
    }
  );
});

test("assertReviewerNotAuthor fails closed when recorded author identity is absent", () => {
  const { authorIdentityLookup } = makeLookup({});

  expectSeparationError(
    () =>
      assertReviewerNotAuthor({
        unit: UNIT_ID,
        candidateReviewerPrincipal: REVIEWER,
        authorIdentityLookup
      }),
    {
      code: CODES.AUTHOR_IDENTITY_ABSENT,
      reason: REASONS.FAIL_CLOSED,
      detail: { unit: UNIT_ID }
    }
  );
});

test("assertReviewerNotAuthor fails closed when recorded author identity is not server-authenticated", () => {
  const rejectedTrustSources = [
    "caller_supplied",
    "ambient_env",
    "request_payload",
    "prompt_text",
    "unknown"
  ];

  for (const trustSource of rejectedTrustSources) {
    const { authorIdentityLookup } = makeLookup({
      [UNIT_ID]: identity(AUTHOR, trustSource)
    });

    expectSeparationError(
      () =>
        assertReviewerNotAuthor({
          unit: UNIT_ID,
          candidateReviewerPrincipal: REVIEWER,
          authorIdentityLookup
        }),
      {
        code: CODES.AUTHOR_IDENTITY_UNVERIFIABLE,
        reason: REASONS.FAIL_CLOSED,
        detail: { unit: UNIT_ID, trust_source: trustSource }
      }
    );
  }
});

test("assertReviewerNotAuthor fails closed when lookup is missing or throws", () => {
  expectSeparationError(
    () =>
      assertReviewerNotAuthor({
        unit: UNIT_ID,
        candidateReviewerPrincipal: REVIEWER
      }),
    {
      code: CODES.AUTHOR_LOOKUP_UNAVAILABLE,
      reason: REASONS.FAIL_CLOSED
    }
  );

  const cause = new Error("lookup store unavailable");
  expectSeparationError(
    () =>
      assertReviewerNotAuthor({
        unit: UNIT_ID,
        candidateReviewerPrincipal: REVIEWER,
        authorIdentityLookup() {
          throw cause;
        }
      }),
    {
      code: CODES.AUTHOR_LOOKUP_UNAVAILABLE,
      reason: REASONS.FAIL_CLOSED,
      detail: { unit: UNIT_ID }
    }
  );
});

test("assertReviewerNotAuthor fails closed when reviewer principal is missing", () => {
  const { authorIdentityLookup, calls } = makeLookup();

  expectSeparationError(
    () =>
      assertReviewerNotAuthor({
        unit: UNIT_ID,
        candidateReviewerPrincipal: "   ",
        authorIdentityLookup
      }),
    {
      code: CODES.REVIEWER_PRINCIPAL_MISSING,
      reason: REASONS.FAIL_CLOSED,
      detail: { unit: UNIT_ID }
    }
  );

  assert.deepEqual(calls, [], "reviewer identity refusal happens before author lookup");
});

test("checkReviewerNotAuthor returns structured refusal verdict instead of throwing", () => {
  const verdict = checkReviewerNotAuthor({
    unit: UNIT_ID,
    candidateReviewerPrincipal: AUTHOR,
    authorIdentityLookup: () => identity(AUTHOR, "transport_minted")
  });

  assert.equal(verdict.schema_version, REVIEW_AUTHOR_SEPARATION_SCHEMA_VERSION);
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.code, CODES.REVIEWER_IS_AUTHOR);
  assert.equal(verdict.reason, REASONS.SELF_REVIEW);
  assert.deepEqual(verdict.detail, { unit: UNIT_ID, principal: AUTHOR });
  assert.ok(Object.isFrozen(verdict), "refusal verdict must be frozen");
});

test("checkReviewerNotAuthor returns the allowed verdict when independence is proven", () => {
  const verdict = checkReviewerNotAuthor({
    unit: UNIT_ID,
    candidateReviewerPrincipal: REVIEWER,
    authorIdentityLookup: () => identity(AUTHOR, "transport_minted")
  });

  assert.equal(verdict.allowed, true);
  assert.equal(verdict.author_principal, AUTHOR);
  assert.equal(verdict.reviewer_principal, REVIEWER);
});
