import test from "node:test";
import assert from "node:assert/strict";

import {
  assertProofExecutionTestComposition,
  buildUnavailableProofExecutionTestComposition,
  PROOF_EXECUTOR_TEST_UNAVAILABLE_CODE,
  PROOF_PROVIDER_TEST_UNAVAILABLE_CODE,
  proofExecutionTestCompositionDeps
} from "../../packages/wiki-mcp/src/lib/proof-execution-test-composition.mjs";

test("closed proof-execution test composition disables executor and provider", async () => {
  const composition = buildUnavailableProofExecutionTestComposition();
  assert.equal(assertProofExecutionTestComposition(composition), composition);
  assert.deepEqual({ executor: composition.executor_availability,
    provider: composition.provider_availability }, {
    executor: "unavailable", provider: "unavailable"
  });

  const deps = proofExecutionTestCompositionDeps(composition);
  await assert.rejects(deps.withOrchestratorTestProofRuntime(), {
    code: PROOF_EXECUTOR_TEST_UNAVAILABLE_CODE
  });
  await assert.rejects(deps.executeLauncherVerifyProofReceiptPopulation(), {
    code: PROOF_PROVIDER_TEST_UNAVAILABLE_CODE
  });
  assert.throws(() => assertProofExecutionTestComposition(Object.freeze({
    schema_version: composition.schema_version,
    executor_availability: "unavailable",
    provider_availability: "unavailable"
  })), TypeError);
});
