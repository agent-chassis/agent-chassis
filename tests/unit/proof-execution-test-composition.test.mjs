import test from "node:test";
import assert from "node:assert/strict";

import {
  assertProofExecutionTestComposition,
  buildProviderUnavailableProofExecutionTestComposition,
  buildUnavailableProofExecutionTestComposition,
  PROOF_EXECUTOR_TEST_UNAVAILABLE_CODE,
  PROOF_PROVIDER_TEST_UNAVAILABLE_CODE,
  proofExecutionTestCompositionDeps
} from "../../packages/wiki-mcp/src/lib/proof-execution-test-composition.mjs";
import { isRuntimeBlockerCode } from "../../packages/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
import { errorContent } from "../../packages/wiki-mcp/src/lib/mcp-response.mjs";

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

test("provider-only calibration composition keeps the executor real and disables the provider", async () => {
  const composition = buildProviderUnavailableProofExecutionTestComposition();
  assert.equal(assertProofExecutionTestComposition(composition), composition);
  assert.deepEqual({ executor: composition.executor_availability,
    provider: composition.provider_availability }, {
    executor: "available", provider: "unavailable"
  });
  const deps = proofExecutionTestCompositionDeps(composition);
  assert.equal(Object.hasOwn(deps, "withOrchestratorTestProofRuntime"), false,
    "the ordinary orchestrator runtime is not replaced");
  await assert.rejects(deps.executeLauncherVerifyProofReceiptPopulation(), {
    code: PROOF_PROVIDER_TEST_UNAVAILABLE_CODE
  });
  assert.throws(() => assertProofExecutionTestComposition(Object.freeze({ ...composition })), TypeError);
});

test("exactly the two unavailable-dependency codes are registered and survive the response boundary", async () => {
  const deps = proofExecutionTestCompositionDeps(buildUnavailableProofExecutionTestComposition());
  for (const [code, invoke] of [
    [PROOF_EXECUTOR_TEST_UNAVAILABLE_CODE, deps.withOrchestratorTestProofRuntime],
    [PROOF_PROVIDER_TEST_UNAVAILABLE_CODE, deps.executeLauncherVerifyProofReceiptPopulation]
  ]) {
    assert.equal(isRuntimeBlockerCode(code), true, code);
    const thrown = await invoke().then(() => null, (error) => error);
    const envelope = errorContent(thrown).structuredContent;
    assert.equal(envelope.code, code);
    assert.equal(envelope.refusal.code, code);
  }

  const unregistered = Object.assign(new Error("unregistered"),
    { code: "proof_execution_test_other_unavailable" });
  assert.equal(isRuntimeBlockerCode(unregistered.code), false);
  assert.equal(errorContent(unregistered).structuredContent.code, "mcp_response.handler_exception.v1");
});
