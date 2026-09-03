import { ExactBindingError } from "./deterministic-projection-primitives.mjs";

const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
const CAPTURED_RESULTS = new WeakSet();
const PROJECTED_EVALUATION_ENVELOPES = new WeakMap();

function projectedEvaluationEnvelopeFor(exactBindingResult) {
  return PROJECTED_EVALUATION_ENVELOPES.get(exactBindingResult) ?? null;
}

function registerProjectedEvaluationEnvelope(exactBindingResult, envelope) {
  PROJECTED_EVALUATION_ENVELOPES.set(exactBindingResult, envelope);
}

function registerCapturedExactBindingResult(result) {
  CAPTURED_RESULTS.add(result);
  return result;
}

function assertCapturedExactBindingResult(result) {
  if (!CAPTURED_RESULTS.has(result) || !Object.isFrozen(result)) {
    throw new ExactBindingError(
      "exact_binding_result_unrecognized",
      "aggregate proof requires the exact result returned by deterministic capture"
    );
  }
  return result;
}

export {
  MAX_ARTIFACT_BYTES,
  assertCapturedExactBindingResult,
  projectedEvaluationEnvelopeFor,
  registerCapturedExactBindingResult,
  registerProjectedEvaluationEnvelope
};
