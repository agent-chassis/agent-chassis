import { ExactBindingError } from "./deterministic-projection-primitives.mjs";

const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
const CAPTURED_RESULTS = new WeakSet();

function registerCapturedExactBindingResult(result) {
  CAPTURED_RESULTS.add(result);
  return result;
}

function assertCapturedExactBindingResult(result) {
  if (!CAPTURED_RESULTS.has(result) || !Object.isFrozen(result)) {
    throw new ExactBindingError(
      "exact_binding_result_unrecognized",
      "stable occurrence authority requires the in-process acquisition artifact its producer registered"
    );
  }
  return result;
}

export {
  MAX_ARTIFACT_BYTES,
  assertCapturedExactBindingResult,
  registerCapturedExactBindingResult
};
