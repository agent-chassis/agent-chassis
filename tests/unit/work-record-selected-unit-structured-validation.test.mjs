import test from "node:test";
import assert from "node:assert/strict";

import { projectSelectedWorkRecordUnit } from "../../packages/wiki-core/src/lib/work-record-selected-unit-projection.mjs";

const MIXED_VALIDATION = [
  {
    verification_ids: ["claim-third", "claim-first", "claim-second"],
    operation: "node_test",
    target: "tests/structured.test.mjs"
  },
  "git diff --check"
];

const PROJECTED_VALIDATION = [
  {
    operation: "node_test",
    target: "tests/structured.test.mjs",
    verification_ids: ["claim-first", "claim-second", "claim-third"]
  },
  "git diff --check"
];

test("selected-unit projection is closed over mixed structured validation", () => {
  const source = {
    id: "SLICE-005",
    acceptance: {
      criteria: ["Preserve the immutable acceptance snapshot"],
      validation: MIXED_VALIDATION
    }
  };

  const first = projectSelectedWorkRecordUnit(source);
  const second = projectSelectedWorkRecordUnit(first);

  assert.notEqual(first, null);
  assert.notEqual(second, null);
  assert.deepEqual(first.acceptance.validation, PROJECTED_VALIDATION);
  assert.deepEqual(second, first);
  assert.deepEqual(Object.keys(first.acceptance.validation[0]), [
    "operation",
    "target",
    "verification_ids"
  ]);
  assert.notEqual(first.acceptance.validation, source.acceptance.validation);
  assert.notEqual(first.acceptance.validation[0], MIXED_VALIDATION[0]);
  assert.notEqual(second.acceptance.validation, first.acceptance.validation);

  second.acceptance.validation[0].verification_ids.reverse();
  assert.deepEqual(first.acceptance.validation, PROJECTED_VALIDATION);
});

test("obsolete top-level validation is not projected", () => {
  const projected = projectSelectedWorkRecordUnit({
    id: "SLICE-005",
    validation: MIXED_VALIDATION
  });

  assert.deepEqual(projected, { id: "SLICE-005" });
});

test("undefined-valued unsupported validation fields fail closed on both entry paths", () => {
  const malformedValidation = () => [{
    operation: "node_test",
    target: "tests/example.test.mjs",
    verification_ids: ["claim-a"],
    extra: undefined
  }];
  const units = [
    {
      id: "SLICE-005",
      acceptance: { criteria: [], validation: malformedValidation() }
    },
    { id: "SLICE-005", acceptance: { criteria: [], validation: malformedValidation() } }
  ];

  for (const unit of units) {
    assert.equal(projectSelectedWorkRecordUnit(unit), null);
  }

  const unrelated = projectSelectedWorkRecordUnit({
    id: "SLICE-005",
    dispatch_intent: { retained: true, omitted: undefined }
  });
  assert.deepEqual(unrelated.dispatch_intent, { retained: true });
});
