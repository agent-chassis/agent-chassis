import test from "node:test";
import assert from "node:assert/strict";
import { FROZEN_REVIEW_CONTRACT_QUERY_LIMITS, queryFrozenReviewContract } from
  "../../packages/wiki-core/src/lib/frozen-review-contract-query.mjs";
import { encodeCursor } from
  "../../packages/wiki-core/src/lib/controlled-contract-authoring-projections.mjs";

const artifact = { artifact_digest: "sha256:frozen-contract-1",
  canonical_parent_wk_contract: { acceptance: { criteria: ["parent criterion"], validation: ["parent validation"] } },
  review_unit_contract: { acceptance: { criteria: ["selected criterion"], validation: ["selected validation"] } } };

test("returns a bounded index and ordered pages", () => {
  const index = queryFrozenReviewContract({ artifact });
  assert.equal(index.projection, "index");
  assert.ok(Buffer.byteLength(JSON.stringify(index)) <= FROZEN_REVIEW_CONTRACT_QUERY_LIMITS.index);
  const page = queryFrozenReviewContract({ artifact, request: { target: "acceptance_criteria" } });
  assert.deepEqual(page.items.map((item) => [item.source, item.value]), [["parent", "parent criterion"], ["selected_unit", "selected criterion"]]);
  assert.equal(page.returned + page.omitted, page.total);
  assert.equal(page.next_cursor, null);
});
test("binds cursors and rejects unknown controls", () => {
  const page = queryFrozenReviewContract({ artifact, request: { target: "acceptance_validation" } });
  assert.equal(queryFrozenReviewContract({ artifact, request: { target: "acceptance_criteria", cursor: page.next_cursor } }).status, "refused");
  assert.equal(queryFrozenReviewContract({ artifact, request: { target: "acceptance_criteria", extra: true } }).reason_code, "request_shape_invalid");
});

test("rejects padded, standard-base64, malformed, and noncanonical cursors", () => {
  const paginated = {
    artifact_digest: "sha256:strict-cursor",
    canonical_parent_wk_contract: { acceptance: {
      criteria: ["x".repeat(9000), "y".repeat(9000)], validation: []
    } },
    review_unit_contract: { acceptance: { criteria: [], validation: [] } }
  };
  const first = queryFrozenReviewContract({
    artifact: paginated,
    request: { target: "acceptance_criteria" }
  });
  assert.equal(typeof first.next_cursor, "string");
  const decoded = JSON.parse(Buffer.from(first.next_cursor, "base64url").toString("utf8"));
  const variants = [
    `${first.next_cursor}=`,
    "abc+def",
    "a",
    Buffer.from(JSON.stringify(decoded, null, 2)).toString("base64url"),
    encodeCursor({ ...decoded, extra: true })
  ];
  for (const cursor of variants) {
    const result = queryFrozenReviewContract({
      artifact: paginated,
      request: { target: "acceptance_criteria", cursor }
    });
    assert.equal(result.status, "refused");
    assert.equal(result.reason_code, "cursor_mismatched_or_malformed");
  }
});

test("page sizing includes its continuation cursor and shrinks before refusing", () => {
  const digest = "sha256:cursor-inclusive-sizing";
  const target = "acceptance_criteria";
  const pageBytes = (value) => Buffer.byteLength(JSON.stringify(value), "utf8");
  let large;
  for (let length = 14000; length < FROZEN_REVIEW_CONTRACT_QUERY_LIMITS.page; length += 1) {
    const first = { source: "parent", source_index: 0, value: "x".repeat(length) };
    const second = { source: "parent", source_index: 1, value: "tail" };
    const base = {
      schema_version: "frozen-review-contract-query.v1",
      projection: "page",
      artifact_digest: digest,
      target,
      total: 3,
      returned: 2,
      omitted: 1,
      items: [first, second]
    };
    const withoutCursor = { ...base, next_cursor: null };
    const withCursor = {
      ...base,
      next_cursor: encodeCursor({ v: 1, digest, target, offset: 2 })
    };
    const oneWithCursor = {
      ...base,
      returned: 1,
      omitted: 2,
      items: [first],
      next_cursor: encodeCursor({ v: 1, digest, target, offset: 1 })
    };
    if (pageBytes(withoutCursor) <= FROZEN_REVIEW_CONTRACT_QUERY_LIMITS.page &&
        pageBytes(withCursor) > FROZEN_REVIEW_CONTRACT_QUERY_LIMITS.page &&
        pageBytes(oneWithCursor) <= FROZEN_REVIEW_CONTRACT_QUERY_LIMITS.page) {
      large = first.value;
      break;
    }
  }
  assert.equal(typeof large, "string", "fixture must straddle the cursor-inclusive bound");
  const sizedArtifact = {
    artifact_digest: digest,
    canonical_parent_wk_contract: { acceptance: {
      criteria: [large, "tail", "remaining"], validation: []
    } },
    review_unit_contract: { acceptance: { criteria: [], validation: [] } }
  };
  const page = queryFrozenReviewContract({
    artifact: sizedArtifact,
    request: { target }
  });
  assert.equal(page.status, undefined);
  assert.equal(page.returned, 1);
  assert.equal(page.omitted, 2);
  assert.equal(typeof page.next_cursor, "string");
  assert.ok(pageBytes(page) <= FROZEN_REVIEW_CONTRACT_QUERY_LIMITS.page);

  const unrepresentable = queryFrozenReviewContract({
    artifact: {
      ...sizedArtifact,
      canonical_parent_wk_contract: { acceptance: {
        criteria: ["z".repeat(FROZEN_REVIEW_CONTRACT_QUERY_LIMITS.page)],
        validation: []
      } }
    },
    request: { target }
  });
  assert.equal(unrepresentable.reason_code, "page_oversized");
  assert.equal(unrepresentable.payload.target_offset, 0);
  assert.ok(unrepresentable.payload.item_utf8_bytes > FROZEN_REVIEW_CONTRACT_QUERY_LIMITS.page);
});
test("uses the typed refusal envelope", () => {
  const result = queryFrozenReviewContract({ artifact: {}, request: {} });
  assert.equal(result.code, "frozen_review_contract_query_refused");
  assert.equal(result.severity, "blocking");
  assert.equal(result.payload.schema_version, "frozen-review-contract-query-refusal.v1");
  assert.match(result.message, /^frozen review contract query refused: /);
});

test("bounded pages retrieve every ordered item until omitted is zero", () => {
  const parent = Array.from({ length: 24 }, (_, index) =>
    `parent-${index}-${"p".repeat(900)}`);
  const selected = Array.from({ length: 24 }, (_, index) =>
    `selected-${index}-${"s".repeat(900)}`);
  const paginatedArtifact = {
    artifact_digest: "sha256:paginated",
    canonical_parent_wk_contract: { acceptance: { criteria: parent, validation: [] } },
    review_unit_contract: { acceptance: { criteria: selected, validation: [] } }
  };
  const values = [];
  let cursor;
  for (;;) {
    const request = {
      target: "acceptance_criteria",
      ...(cursor === undefined ? {} : { cursor })
    };
    const page = queryFrozenReviewContract({ artifact: paginatedArtifact, request });
    assert.equal(page.projection, "page");
    assert.ok(Buffer.byteLength(JSON.stringify(page), "utf8") <=
      FROZEN_REVIEW_CONTRACT_QUERY_LIMITS.page);
    values.push(...page.items.map((item) => item.value));
    if (page.omitted === 0) {
      assert.equal(page.next_cursor, null);
      break;
    }
    assert.equal(typeof page.next_cursor, "string");
    cursor = page.next_cursor;
  }
  assert.deepEqual(values, [...parent, ...selected]);
});
