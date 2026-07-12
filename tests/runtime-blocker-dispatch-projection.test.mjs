

import { test } from "node:test";
import assert from "node:assert/strict";

import { compactRuntimeBlockerTaxonomy } from "../packages/wiki-mcp/src/lib/dispatch-tool-helpers.mjs";
import {
  loadRuntimeBlockerTaxonomy,
  RUNTIME_BLOCKER_DISPATCH_FACING_CATEGORIES
} from "../packages/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";

const READ_DISCLOSURE_NUDGE_CODES = [
  "compact_first_required",
  "compact_read_token_missing",
  "compact_read_token_malformed",
  "compact_read_token_wrong_schema",
  "compact_read_token_wrong_tool_family",
  "compact_read_token_wrong_scope",
  "compact_read_token_wrong_selector",
  "compact_read_token_stale_source_digest",
  "compact_read_token_expired",
  "selected_slice_compact_detail_required",
  "compact_read_selected_detail_required"
];

test("WK-1509 read_disclosure category is NOT in the dispatch-facing allowlist", () => {
  assert.ok(
    !RUNTIME_BLOCKER_DISPATCH_FACING_CATEGORIES.includes("read_disclosure"),
    "read_disclosure must be excluded from the dispatch-facing category allowlist"
  );
});

test("WK-1509 the registry actually registers the read_disclosure nudge labels", () => {

  const taxonomy = loadRuntimeBlockerTaxonomy();
  const byCode = new Map(taxonomy.codes.map((entry) => [entry.code, entry]));
  for (const code of READ_DISCLOSURE_NUDGE_CODES) {
    const entry = byCode.get(code);
    assert.ok(entry, `registry must register nudge label ${code}`);
    assert.equal(
      entry.category,
      "read_disclosure",
      `${code} must be category read_disclosure`
    );
    assert.equal(entry.actor_recovery, "caller_retry", `${code} must be caller_retry`);
    assert.equal(entry.blocking, false, `${code} must be non-blocking`);
  }
});

test("WK-1509 dispatch projection excludes read_disclosure nudge labels", () => {
  const taxonomy = loadRuntimeBlockerTaxonomy();
  const projection = compactRuntimeBlockerTaxonomy(taxonomy);

  const projectedCodes = new Set(projection.codes.map((entry) => entry.code));
  const projectedCategories = new Set(projection.codes.map((entry) => entry.category));

  assert.ok(
    !projectedCategories.has("read_disclosure"),
    "read_disclosure category must not appear in the dispatch-facing projection"
  );

  for (const code of READ_DISCLOSURE_NUDGE_CODES) {
    assert.ok(
      !projectedCodes.has(code),
      `nudge label ${code} must not appear in the dispatch blocker catalog`
    );
  }
});

test("WK-1509 nudge labels are not counted in the dispatch projection counts", () => {
  const taxonomy = loadRuntimeBlockerTaxonomy();
  const projection = compactRuntimeBlockerTaxonomy(taxonomy);

  const dispatchFacing = new Set(RUNTIME_BLOCKER_DISPATCH_FACING_CATEGORIES);
  const expectedDispatchFacingCodes = taxonomy.codes.filter((entry) =>
    dispatchFacing.has(entry.category)
  );
  const expectedBlocking = expectedDispatchFacingCodes.filter((entry) =>
    Boolean(entry.blocking)
  ).length;

  assert.equal(
    projection.code_count,
    expectedDispatchFacingCodes.length,
    "code_count must cover only dispatch-facing codes"
  );
  assert.equal(projection.codes.length, projection.code_count);
  assert.equal(
    projection.blocking_count + projection.nonblocking_count,
    projection.code_count,
    "blocking + nonblocking counts must cover every projected code"
  );
  assert.equal(projection.blocking_count, expectedBlocking);

  assert.ok(
    projection.code_count < taxonomy.codes.length,
    "projection must drop the registered read_disclosure nudge labels"
  );
});

test("WK-1509 dispatch projection still includes the dispatch-facing categories", () => {
  const taxonomy = loadRuntimeBlockerTaxonomy();
  const projection = compactRuntimeBlockerTaxonomy(taxonomy);

  const projectedCodes = new Set(projection.codes.map((entry) => entry.code));
  const projectedCategories = new Set(projection.codes.map((entry) => entry.category));

  assert.ok(
    projectedCodes.has("role_policy_violation"),
    "role_policy_violation must remain in the dispatch projection"
  );
  assert.ok(
    projectedCodes.has("backend_unavailable"),
    "backend_unavailable must remain in the dispatch projection"
  );

  const dispatchFacing = new Set(RUNTIME_BLOCKER_DISPATCH_FACING_CATEGORIES);
  for (const category of projectedCategories) {
    assert.ok(
      dispatchFacing.has(category),
      `projected category ${category} must be dispatch-facing`
    );
  }

  assert.ok(
    projectedCategories.has("role_policy"),
    "role_policy dispatch-facing category must be present"
  );
});
