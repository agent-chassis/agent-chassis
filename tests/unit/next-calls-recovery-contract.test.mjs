import assert from "node:assert/strict";
import test from "node:test";
import { buildNextCall, validateContinuationCalls } from "../../packages/wiki-core/src/lib/next-calls-descriptor.mjs";
const ORIGINATING_TOOL = "workspace_work_record_validate";
const INDEPENDENT_TOOL = "workspace_validate_dispatch";
const FACT = "wk.acceptance.criteria";
const REQUEST_SCHEMAS = Object.freeze({
  [ORIGINATING_TOOL]: Object.freeze({
    type: "object",
    properties: { id: { type: "string" } }, required: ["id"],
    additionalProperties: false
  }),
  [INDEPENDENT_TOOL]: Object.freeze({
    type: "object",
    properties: { unit: { type: "string" } }, required: ["unit"],
    additionalProperties: false
  })
});

function predicate(value = "present") {
  return { fact: FACT, operator: "equals", value };
}

function sameCall(overrides = {}) {
  return {
    tool: ORIGINATING_TOOL, arguments: { id: "WK-2428" },
    recommended: true,
    prerequisite_predicate: predicate(), success_predicate: predicate(),
    ...overrides
  };
}

function validate(entry, overrides = {}) {
  return validateContinuationCalls([entry], {
    originatingTool: ORIGINATING_TOOL,
    decidingFacts: [{ field: FACT, value: "absent" }],
    observedFacts: { [FACT]: "absent" }, requestSchemas: REQUEST_SCHEMAS,
    ...overrides
  });
}

function assertRejected(entry, expected, overrides = {}) {
  const result = validate(entry, overrides);
  assert.equal(result.valid, false, `unexpectedly accepted: ${JSON.stringify(result)}`);
  assert.ok(result.errors.some((error) => expected.test(error)),
    `expected ${expected}, received: ${result.errors.join("; ")}`);
}

test("same-call recovery accepts the exact published false predicate the callable action promises to make true", () => {
  const result = validate(sameCall());
  assert.deepEqual(result, { valid: true, errors: [] });
});

test("prerequisite_predicate uses the existing success-predicate grammar", () => {
  assert.throws(
    () => buildNextCall(sameCall({
      prerequisite_predicate: { fact: FACT, operator: "becomes_ready" }
    })),
    /existing success-predicate grammar/
  );
});

const missingPrerequisite = sameCall();
delete missingPrerequisite.prerequisite_predicate;

const REJECTION_CASES = [
  {
    name: "missing prerequisite", entry: missingPrerequisite,
    expected: /declares no prerequisite_predicate/
  },
  {
    name: "mismatched prerequisite", entry: sameCall({ prerequisite_predicate: predicate("dispatchable") }),
    expected: /must be byte-identical/
  },
  {
    name: "structurally equal but byte-nonidentical prerequisite", entry: sameCall({
      prerequisite_predicate: { operator: "equals", fact: FACT, value: "present" }
    }),
    expected: /must be byte-identical/
  },
  {
    name: "unobserved fact", entry: sameCall(),
    options: { observedFacts: {} },
    expected: /unobserved in the returned result/
  },
  {
    name: "already-true prerequisite",
    entry: sameCall(),
    options: {
      decidingFacts: [{ field: FACT, value: "present" }],
      observedFacts: { [FACT]: "absent" }
    },
    expected: /already true in the returned result/
  },
  {
    name: "unpublished deciding fact", entry: sameCall(),
    options: { decidingFacts: [{ field: "dispatch.role_capability", value: false }] },
    expected: /not a published deciding fact/
  },
  {
    name: "redacted deciding fact", entry: sameCall(),
    options: { decidingFacts: [{ field: FACT, redacted: true }] },
    expected: /names redacted deciding fact/
  },
  {
    name: "omitted deciding fact", entry: sameCall(),
    options: { decidingFacts: [{ field: FACT, omitted: true }] },
    expected: /names omitted deciding fact/
  },
  {
    name: "non-callable action arguments", entry: sameCall({ arguments: {} }),
    expected: /request schema for workspace_work_record_validate requires/
  }
];

for (const { name, entry, expected, options } of REJECTION_CASES) {
  test(`same-call recovery rejects ${name}`, () => {
    assertRejected(entry, expected, options);
  });
}

test("fresh independent actions retain their owner semantics and need no same-call prerequisite", () => {
  const result = validate({
    tool: INDEPENDENT_TOOL, arguments: { unit: "WK-2428#SLICE-003" },
    recommended: true,
    success_predicate: predicate()
  });
  assert.deepEqual(result, { valid: true, errors: [] });
});

test("prerequisite_predicate cannot create a parallel recovery contract for an independent action", () => {
  assertRejected({
    tool: INDEPENDENT_TOOL, arguments: { unit: "WK-2428#SLICE-003" },
    recommended: true,
    prerequisite_predicate: predicate(), success_predicate: predicate()
  }, /reserved for a next call that invokes the originating tool/);
});
