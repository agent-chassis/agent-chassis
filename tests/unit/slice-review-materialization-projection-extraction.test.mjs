import assert from "node:assert/strict";
import test from "node:test";

import * as stable from "../../packages/agent-launch-cli/src/lib/slice-review-materialization.mjs";
import * as contract from
  "../../packages/agent-launch-cli/src/lib/slice-review-materialization-contract.mjs";
import * as staged from
  "../../packages/agent-launch-cli/src/lib/slice-review-materialization-failure-projection.mjs";

const CONSTANTS = [
  "SLICE_REVIEW_MATERIALIZATION_FAILURE_PROJECTION_SCHEMA_VERSION",
  "SLICE_REVIEW_MATERIALIZATION_FAILURE_PROJECTION_KIND",
  "SLICE_REVIEW_MATERIALIZATION_PUBLIC_MESSAGE",
  "SLICE_REVIEW_MATERIALIZATION_PROJECTION_KEYS",
  "SLICE_REVIEW_MATERIALIZATION_PUBLIC_DETAIL_KEYS",
  "SLICE_REVIEW_MATERIALIZATION_PUBLIC_PREDICATES"
];

test("staged projection constants match the stable module by value", () => {
  for (const name of CONSTANTS) assert.deepEqual(staged[name], stable[name], name);
  assert.deepEqual(
    Object.keys(staged).sort(),
    [
      ...CONSTANTS,
      "projectAuthenticatedSliceReviewMaterializationFailure"
    ].sort()
  );
});

const authentic = (code, reason, detail = null) =>
  new contract.SliceReviewMaterializationError(
    `${contract.MATERIALIZATION_MESSAGE_PREFIX}${reason}`,
    { code, detail }
  );

function compareProjection(label, code, reason, detail = null) {
  const error = authentic(code, reason, detail);
  assert.deepEqual(
    staged.projectAuthenticatedSliceReviewMaterializationFailure(error),
    stable.projectAuthenticatedSliceReviewMaterializationFailure(error),
    label
  );
}

test("genuine projections preserve bounded enums and integers", () => {
  compareProjection(
    "all bounded detail fields",
    stable.SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.POSTCHECK_FAILED,
    "trusted slice/worktree/ref state changed during review-surface preparation",
    {
      field: "baseTree",
      pseudoref: "MERGE_HEAD",
      key: "index.sparse",
      scope: "--worktree",
      depth: 3,
      bound: stable.HISTORICAL_DELIVERY_INDEX_RECOVERY.max_suffix_commits,
      status: 128
    }
  );
  compareProjection(
    "unknown predicate remains null",
    stable.SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.PREPARE_FAILED,
    "caller supplied refusal text",
    { status: 128 }
  );
});

test("config_key and config_scope are constant null in the v1 detail shape", () => {
  const detailKeys = ["predicate", "field", "pseudoref", "config_key", "config_scope",
    "suffix_depth", "traversal_bound", "git_exit_status"];
  assert.deepEqual([...staged.SLICE_REVIEW_MATERIALIZATION_PUBLIC_DETAIL_KEYS], detailKeys);
  assert.equal(staged.SLICE_REVIEW_MATERIALIZATION_FAILURE_PROJECTION_SCHEMA_VERSION,
    "agent_launch.slice_review_materialization_failure_projection.v1");

  for (const key of ["core.sparseCheckout", "core.sparseCheckoutCone", "index.sparse"]) {
    for (const scope of ["--local", "--worktree"]) {
      const projected = staged.projectAuthenticatedSliceReviewMaterializationFailure(
        authentic(
          stable.SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.POSTCHECK_FAILED,
          "could not resolve the post-preparation HEAD tree",
          { key, scope }
        )
      );
      assert.deepEqual(Object.keys(projected.detail), detailKeys);
      assert.equal(projected.detail.config_key, null, `${key} must not surface`);
      assert.equal(projected.detail.config_scope, null, `${scope} must not surface`);
    }
  }
});

test("the retired sparse predicates are absent from the public vocabulary", () => {
  const retired = [
    "could not verify full-checkout configuration",
    "retained slice worktree has sparse checkout enabled",
    "could not inspect the ordinary index shape",
    "ordinary index contains a sparse-directory entry",
    "could not inspect ordinary index flags",
    "ordinary index contains skip-worktree or assume-unchanged state"
  ];
  for (const predicate of retired) {
    assert.equal(staged.SLICE_REVIEW_MATERIALIZATION_PUBLIC_PREDICATES.includes(predicate), false,
      predicate);
    const projected = staged.projectAuthenticatedSliceReviewMaterializationFailure(
      authentic(stable.SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.PREPARE_FAILED, predicate)
    );
    assert.equal(projected.detail.predicate, null, predicate);
  }
  assert.equal(
    staged.SLICE_REVIEW_MATERIALIZATION_PUBLIC_PREDICATES.some((p) => p.includes("sparse")),
    false
  );
});

test("malformed and forged errors have identical rejection behavior", () => {
  const code = stable.SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.PREPARE_FAILED;
  const reason = "git read-tree could not align the ordinary index with the reviewed commit";
  const genuine = authentic(code, reason);
  const cases = [
    ["plain object", {}, {}],
    ["prototype forged", Object.create(contract.SliceReviewMaterializationError.prototype),
      Object.create(contract.SliceReviewMaterializationError.prototype)],
    ["malformed detail", authentic(code, reason, []), authentic(code, reason, [])],
    ["wrong name", genuine, genuine]
  ];
  cases[3][1].name = "OtherError";
  cases[3][2].name = "OtherError";
  for (const [label, left, right] of cases) {
    assert.equal(
      stable.projectAuthenticatedSliceReviewMaterializationFailure(left),
      staged.projectAuthenticatedSliceReviewMaterializationFailure(right),
      label
    );
  }
});
