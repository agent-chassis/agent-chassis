import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as staged from "../../packages/agent-launch-cli/src/lib/slice-review-materialization-contract.mjs";

const stableSource = await readFile(
  new URL("../../packages/agent-launch-cli/src/lib/slice-review-materialization.mjs", import.meta.url),
  "utf8"
);
let stable = null;
try {
  stable = await import("../../packages/agent-launch-cli/src/lib/slice-review-materialization.mjs");
} catch (error) {

  assert.equal(error?.code, "ERR_MODULE_NOT_FOUND");
}

test("staged contract exports only the base contract surface", () => {
  assert.deepEqual(Object.keys(staged).sort(), [
    "HISTORICAL_DELIVERY_INDEX_RECOVERY",
    "MATERIALIZATION_MESSAGE_PREFIX",
    "SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES",
    "SLICE_REVIEW_MATERIALIZATION_ERROR_NAME",
    "SLICE_REVIEW_POSTCHECK_STATE_BUDGET",
    "SliceReviewMaterializationError",
    "failSliceReviewMaterialization",
    "isSliceReviewMaterializationError"
  ].sort());
  assert.equal(staged.MATERIALIZATION_MESSAGE_PREFIX,
    "agent-launch slice-review materialization: ");
});

test("the diagnostic-code set no longer carries the sparse refusal", () => {
  const codes = staged.SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES;
  assert.equal(Object.hasOwn(codes, "SPARSE_OR_HIDDEN_INDEX"), false);
  assert.equal(
    Object.values(codes).some((code) => code.includes("sparse")),
    false,
    "no diagnostic code may still name a sparse condition"
  );
  assert.deepEqual(Object.keys(codes), [
    "INVALID_ARGUMENT",
    "BINDING_MISMATCH",
    "WORKTREE_MISMATCH",
    "OBJECT_MISMATCH",
    "INDEX_LOCKED",
    "INDEX_STATE_REFUSED",
    "PHYSICAL_TREE_REFUSED",
    "PREPARE_FAILED",
    "POSTCHECK_FAILED"
  ]);
});

test("staged values and frozen shapes match the stable module", () => {
  if (stable !== null) {
    for (const name of [
      "SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES",
      "SLICE_REVIEW_POSTCHECK_STATE_BUDGET",
      "HISTORICAL_DELIVERY_INDEX_RECOVERY"
    ]) {
      assert.deepEqual(staged[name], stable[name], name);
    }
    assert.equal(staged.SliceReviewMaterializationError, stable.SliceReviewMaterializationError);
    assert.equal(staged.isSliceReviewMaterializationError, stable.isSliceReviewMaterializationError);
  }
  assert.equal(stableSource.includes(
    'from "./slice-review-materialization-contract.mjs"'
  ), true);
  assert.match(stableSource, /SLICE_REVIEW_POSTCHECK_STATE_BUDGET[,\n]/u);
  assert.doesNotMatch(stableSource, /literal_object_read_options\s*:/u);

  assert.equal(Object.hasOwn(staged, "FULL_INDEX_CONFIG_KEYS"), false);
  assert.equal(Object.hasOwn(staged, "FULL_INDEX_CONFIG_SCOPES"), false);
  if (stable !== null) {
    assert.equal(Object.hasOwn(stable, "FULL_INDEX_CONFIG_KEYS"), false);
    assert.equal(Object.hasOwn(stable, "FULL_INDEX_CONFIG_SCOPES"), false);
  }
  assert.equal(staged.SLICE_REVIEW_MATERIALIZATION_ERROR_NAME,
    "SliceReviewMaterializationError");
  assert.equal(staged.MATERIALIZATION_MESSAGE_PREFIX,
    "agent-launch slice-review materialization: ");
  assert.equal(Object.isFrozen(staged.SLICE_REVIEW_POSTCHECK_STATE_BUDGET), true);
  assert.equal(Object.isFrozen(staged.SLICE_REVIEW_POSTCHECK_STATE_BUDGET.bound_fields), true);
  assert.equal(Object.isFrozen(staged.HISTORICAL_DELIVERY_INDEX_RECOVERY.literal_object_read_options), true);
});

test("staged error minting preserves observable defaults and details", () => {
  const code = staged.SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.POSTCHECK_FAILED;
  const cause = new Error("cause");
  assert.throws(
    () => staged.failSliceReviewMaterialization(code, "refused", { field: "headSha" }, cause),
    (error) => {
      assert.equal(error.name, "SliceReviewMaterializationError");
      assert.equal(error.message, "agent-launch slice-review materialization: refused");
      assert.equal(error.code, code);
      assert.deepEqual(error.detail, { field: "headSha" });
      assert.equal(error.cause, cause);
      assert.equal(staged.isSliceReviewMaterializationError(error), true);
      if (stable !== null) assert.equal(stable.isSliceReviewMaterializationError(error), true);
      return true;
    }
  );
  const defaultError = new staged.SliceReviewMaterializationError("plain");
  assert.equal(defaultError.code, staged.SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.PREPARE_FAILED);
  assert.equal(Object.hasOwn(defaultError, "detail"), false);
  assert.equal(Object.hasOwn(defaultError, "cause"), false);
  assert.equal(staged.isSliceReviewMaterializationError(defaultError), true);
  if (stable !== null) assert.equal(stable.isSliceReviewMaterializationError(defaultError), true);
});

test("genuine and hostile lookalike brands are distinguished", () => {
  const genuine = new staged.SliceReviewMaterializationError("genuine");
  assert.equal(staged.isSliceReviewMaterializationError(genuine), true);
  assert.equal(staged.isSliceReviewMaterializationError(null), false);
  assert.equal(staged.isSliceReviewMaterializationError("genuine"), false);

  const forged = Object.create(staged.SliceReviewMaterializationError.prototype);
  Object.defineProperties(forged, {
    name: { value: staged.SLICE_REVIEW_MATERIALIZATION_ERROR_NAME },
    message: { value: "agent-launch slice-review materialization: forged" },
    code: { value: staged.SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.PREPARE_FAILED }
  });
  assert.equal(forged instanceof staged.SliceReviewMaterializationError, true);
  assert.equal(staged.isSliceReviewMaterializationError(forged), false);
});
