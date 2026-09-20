

import { projectBoundedDiagnostics } from "./bounded-diagnostic-projection.mjs";

const AUTHORED_EXECUTION_OBSERVATION_REFUSAL_CODE =
  "evaluation_input_execution_observation_authored";
const AUTHORED_EXECUTION_OBSERVATION_POINTER = "/stable_evaluation/test_validity";
const EXECUTION_OBSERVATION_OWNER = "workspace_verify_proof";
const STABLE_EVALUATION_ALIASES = Object.freeze(["stable_evaluation", "stableEvaluation"]);

class AuthoredExecutionObservationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "AuthoredExecutionObservationError";
    this.code = AUTHORED_EXECUTION_OBSERVATION_REFUSAL_CODE;
    this.details = structuredClone(details);
  }
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function authoredEvaluationInputDiagnostics(input, { pointerPrefix = "" } = {}) {
  if (!plainObject(input)) return [];
  const diagnostics = [];
  for (const alias of STABLE_EVALUATION_ALIASES) {
    const evaluation = input[alias];
    if (!plainObject(evaluation) || !Object.hasOwn(evaluation, "test_validity")) continue;
    const observations = evaluation.test_validity;
    diagnostics.push({
      code: AUTHORED_EXECUTION_OBSERVATION_REFUSAL_CODE,
      pointer: `${pointerPrefix}/${alias}/test_validity`,
      keyword: "executionObservation",
      reason_code: "execution_observation_owned_by_verify_proof",
      expected_identity: "no authored test-validity execution observations",
      actual_identity: Array.isArray(observations) ? observations.length : null,
      message: "test-validity execution observations are produced by workspace_verify_proof, never authored"
    });
  }
  return diagnostics;
}

function validateAuthoredEvaluationInput(input, options = {}) {
  const raw = authoredEvaluationInputDiagnostics(input, options);
  return Object.freeze({
    valid: raw.length === 0,
    execution_owner: EXECUTION_OBSERVATION_OWNER,
    diagnostics: projectBoundedDiagnostics(raw)
  });
}

function assertAuthoredEvaluationInputExecutionFree(input, options = {}) {
  const validation = validateAuthoredEvaluationInput(input, options);
  if (validation.valid) return validation;
  const primaryDiagnostic = validation.diagnostics.diagnostics?.[0];
  throw new AuthoredExecutionObservationError(
    "authored evaluation input carries test-validity execution observations",
    { pointer: typeof primaryDiagnostic?.pointer === "string"
      ? primaryDiagnostic.pointer
      : options.pointerPrefix
        ? `${options.pointerPrefix}${AUTHORED_EXECUTION_OBSERVATION_POINTER}`
        : AUTHORED_EXECUTION_OBSERVATION_POINTER,
    execution_owner: EXECUTION_OBSERVATION_OWNER,
    diagnostics: validation.diagnostics }
  );
}

export {
  AUTHORED_EXECUTION_OBSERVATION_POINTER,
  AUTHORED_EXECUTION_OBSERVATION_REFUSAL_CODE,
  AuthoredExecutionObservationError,
  EXECUTION_OBSERVATION_OWNER,
  assertAuthoredEvaluationInputExecutionFree,
  authoredEvaluationInputDiagnostics,
  validateAuthoredEvaluationInput
};
