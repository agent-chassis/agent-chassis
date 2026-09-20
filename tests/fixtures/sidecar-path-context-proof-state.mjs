import assert from "node:assert/strict";

const INPUT_MJS = "packages/app/src/widget.mjs";
const INPUT_JS = "packages/app/src/widget.js";
const INFERRED_TEST_PATHS = Object.freeze([
  "packages/app/src/widget.test.mjs",
  "packages/app/src/widget.spec.js",
  "tests/widget.test.mjs"
]);
const RELATED_PATHS = Object.freeze([
  "packages/app/src/related-01.mjs",
  "packages/app/src/related-02.mjs",
  "packages/app/src/related-03.mjs",
  "packages/app/src/related-04.mjs",
  "packages/app/src/related-05.mjs",
  "packages/app/src/related-06.mjs",
  "packages/app/src/related-07.mjs",
  "packages/app/src/related-08.mjs",
  "packages/app/src/related-09.mjs",
  "packages/app/src/related-10.mjs",
  "packages/app/src/related-11.mjs",
  "packages/app/src/related-12.mjs",
  "packages/app/src/related-13.mjs",
  "packages/app/src/related-14.mjs",
  "packages/app/src/related-15.mjs",
  "packages/app/src/related-16.mjs",
  "packages/app/src/related-17.mjs",
  "packages/app/src/related-18.mjs",
  "packages/app/src/related-19.mjs",
  "packages/app/src/related-20.mjs",
  "packages/app/src/related-21.mjs",
  "packages/app/src/related-22.mjs"
]);

function entry(path, inputPaths) {
  return Object.freeze({
    path,
    input_paths: Object.freeze([...inputPaths]),
    evidence_basis: "committed_path_inference"
  });
}

function expectedForOrder(firstInput, secondInput) {
  const sharedInputs = [firstInput, secondInput];
  const firstOther = firstInput === INPUT_MJS ? INPUT_JS : INPUT_MJS;
  const secondOther = secondInput === INPUT_MJS ? INPUT_JS : INPUT_MJS;
  return Object.freeze({
    inferred_tests: Object.freeze(
      INFERRED_TEST_PATHS.map((path) => entry(path, sharedInputs))
    ),
    related_paths: Object.freeze([
      ...RELATED_PATHS.map((path) => entry(path, sharedInputs)),
      entry(firstOther, [firstInput]),
      entry(secondOther, [secondInput])
    ])
  });
}

const EMPTY_EXPECTATION = Object.freeze({
  inferred_tests: Object.freeze([]),
  related_paths: Object.freeze([])
});
const COMPLETE_EXPECTATION = expectedForOrder(INPUT_MJS, INPUT_JS);
const PERMUTED_EXPECTATION = expectedForOrder(INPUT_JS, INPUT_MJS);
const EXPECTATIONS = Object.freeze({
  empty: EMPTY_EXPECTATION,
  complete: COMPLETE_EXPECTATION,
  input_order_permutation: PERMUTED_EXPECTATION
});

export function createPathContextExpectations() {
  return EXPECTATIONS;
}

export function assertPathContextContract({ expected, observed }) {
  assert.equal(Object.isFrozen(expected), true);
  assert.equal(Object.isFrozen(expected.complete.related_paths), true);
  assert.equal(Object.isFrozen(expected.complete.related_paths[20]), true);
  assert.deepEqual(observed.empty, expected.empty);
  assert.deepEqual(observed.complete, expected.complete);
  assert.deepEqual(observed.source_order_permutation, expected.complete);
  assert.deepEqual(observed.input_order_permutation, expected.input_order_permutation);
  assert.deepEqual(Object.keys(observed.complete), ["inferred_tests", "related_paths"]);
  assert.equal(observed.complete.related_paths.length, 24);
  assert.equal(
    observed.complete.related_paths[20].path,
    "packages/app/src/related-21.mjs"
  );
  assert.equal("dependencies" in observed.complete, false);
}
