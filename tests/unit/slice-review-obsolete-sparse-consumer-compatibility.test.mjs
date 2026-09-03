import assert from "node:assert/strict";
import test from "node:test";

import {
  projectAuthenticatedSliceReviewMaterializationFailure,
  SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES as CODES,
  SLICE_REVIEW_MATERIALIZATION_FAILURE_PROJECTION_SCHEMA_VERSION as SCHEMA_VERSION,
  SLICE_REVIEW_MATERIALIZATION_FAILURE_PROJECTION_KIND as KIND,
  SLICE_REVIEW_MATERIALIZATION_PUBLIC_MESSAGE as MESSAGE,
  SLICE_REVIEW_MATERIALIZATION_PUBLIC_PREDICATES as PREDICATES,
  SliceReviewMaterializationError
} from "../../packages/agent-launch-cli/src/lib/slice-review-materialization.mjs";
import { buildLifecycleFailure } from
  "../../packages/wiki-mcp/src/lib/dispatch-lifecycle-failure-disclosure.mjs";

const reason = (predicate) =>
  new SliceReviewMaterializationError(`agent-launch slice-review materialization: ${predicate}`, {
    code: Object.values(CODES)[0], detail: { key: "index.sparse", scope: "--worktree" }
  });

test("sparse consumer keeps the v1 detail shape and null config fields", () => {
  const codes = Object.values(CODES);
  assert.ok(codes.length > 0);
  assert.ok(PREDICATES.length > 0);

  for (const [index, predicate] of PREDICATES.entries()) {
    const code = codes[index % codes.length];
    const projected = buildLifecycleFailure({ phase: "pre-integration" },
      Object.assign(reason(predicate), { code }));
    const detail = projected.materialization_failure.detail;
    assert.deepEqual(Object.keys(detail), [
      "predicate", "field", "pseudoref", "config_key", "config_scope",
      "suffix_depth", "traversal_bound", "git_exit_status"
    ]);
    assert.equal(detail.predicate, predicate);
    assert.equal(detail.config_key, null);
    assert.equal(detail.config_scope, null);
  }
});

test("live exported diagnostic vocabulary remains the projection envelope", () => {
  const projected = projectAuthenticatedSliceReviewMaterializationFailure(
    reason(PREDICATES[0]));
  assert.equal(projected.schema_version, SCHEMA_VERSION);
  assert.equal(projected.kind, KIND);
  assert.equal(projected.message, MESSAGE);
  assert.deepEqual(Object.keys(projected.detail), [
    "predicate", "field", "pseudoref", "config_key", "config_scope",
    "suffix_depth", "traversal_bound", "git_exit_status"
  ]);
});
