

export const PROOF_EXECUTION_TEST_COMPOSITION_SCHEMA_VERSION =
  "proof-execution-test-composition.v1";
export const PROOF_EXECUTOR_TEST_UNAVAILABLE_CODE =
  "proof_execution_test_executor_unavailable";
export const PROOF_PROVIDER_TEST_UNAVAILABLE_CODE =
  "proof_execution_test_provider_unavailable";

const COMPOSITIONS = new WeakSet();

function unavailable(code, owner) {
  const error = new Error(`${owner} is deliberately unavailable in the closed test composition`);
  error.code = code;
  error.details = Object.freeze({ owner, availability: "unavailable",
    composition: PROOF_EXECUTION_TEST_COMPOSITION_SCHEMA_VERSION });
  throw error;
}

export function buildUnavailableProofExecutionTestComposition() {
  const composition = Object.freeze({
    schema_version: PROOF_EXECUTION_TEST_COMPOSITION_SCHEMA_VERSION,
    executor_availability: "unavailable",
    provider_availability: "unavailable"
  });
  COMPOSITIONS.add(composition);
  return composition;
}

export function assertProofExecutionTestComposition(composition) {
  if (composition === null) return null;
  if (!COMPOSITIONS.has(composition) || !Object.isFrozen(composition)) {
    throw new TypeError("proof execution test composition is unbranded or malformed");
  }
  return composition;
}

export function proofExecutionTestCompositionDeps(composition) {
  if (assertProofExecutionTestComposition(composition) === null) return Object.freeze({});
  return Object.freeze({
    withOrchestratorTestProofRuntime: async () => unavailable(
      PROOF_EXECUTOR_TEST_UNAVAILABLE_CODE, "orchestrator proof executor"),
    executeLauncherVerifyProofReceiptPopulation: async () => unavailable(
      PROOF_PROVIDER_TEST_UNAVAILABLE_CODE, "launcher proof provider")
  });
}
