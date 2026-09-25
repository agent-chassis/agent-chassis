import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  AUTHORED_EXECUTION_OBSERVATION_POINTER,
  AUTHORED_EXECUTION_OBSERVATION_REFUSAL_CODE,
  AuthoredExecutionObservationError,
  EXECUTION_OBSERVATION_OWNER,
  ProofAuthoringSkeletonError,
  assertAuthoredEvaluationInputExecutionFree,
  authoredEvaluationInputDiagnostics,
  buildProofAuthoringSkeleton,
  validateAuthoredEvaluationInput
} from "../current.mjs";

const packageRoot = path.resolve(import.meta.dirname, "..");

async function witnessBearingInput() {
  return JSON.parse(await readFile(path.join(packageRoot,
    "profiles/proof.verification.test-validity/11.0.0/evaluation-input.template.json"), "utf8"));
}

function declarativeInput() {
  return {
    input_version: "controlled-contract-verification-profile-input.v2",

    reference_bindings: [{ role: "component", reference_ids: ["ref-component"] }],
    number_bindings: [{ role: "limit", value: 3 }],
    claim_pattern_bindings: [],
    resolver_facts: [],
    delivered_evidence: [],
    stable_evaluation: {
      partitions: [{ source_population: { population_id: "p", completeness: "exact",
        authenticated: true, ordered: false, members: [] }, parts: [] }]
    }
  };
}

test("declarative planning inputs are execution-free", () => {
  const validation = validateAuthoredEvaluationInput(declarativeInput());
  assert.equal(validation.valid, true);
  assert.equal(validation.execution_owner, EXECUTION_OBSERVATION_OWNER);
  assert.equal(validation.diagnostics.total_count, 0);
  assert.deepEqual(authoredEvaluationInputDiagnostics(declarativeInput()), []);
  assert.deepEqual(authoredEvaluationInputDiagnostics(null), []);
  assert.equal(assertAuthoredEvaluationInputExecutionFree({ stable_evaluation: {} }).valid, true);
});

test("an authored test-validity observation is refused with one typed code", async () => {
  const input = await witnessBearingInput();
  const validation = validateAuthoredEvaluationInput(input);
  assert.equal(validation.valid, false);
  assert.equal(validation.diagnostics.total_count, 1);
  const [diagnostic] = validation.diagnostics.diagnostics;
  assert.equal(diagnostic.code, AUTHORED_EXECUTION_OBSERVATION_REFUSAL_CODE);
  assert.equal(diagnostic.pointer, AUTHORED_EXECUTION_OBSERVATION_POINTER);

  assert.equal(diagnostic.actual_identity, String(input.stable_evaluation.test_validity.length));
  assert.throws(() => assertAuthoredEvaluationInputExecutionFree(input, {
    pointerPrefix: "/evaluation_input" }), (error) => {
    assert.ok(error instanceof AuthoredExecutionObservationError);
    assert.equal(error.code, AUTHORED_EXECUTION_OBSERVATION_REFUSAL_CODE);
    assert.equal(error.details.pointer, `/evaluation_input${AUTHORED_EXECUTION_OBSERVATION_POINTER}`);
    assert.equal(error.details.execution_owner, EXECUTION_OBSERVATION_OWNER);
    return true;
  });

  const aliased = { stableEvaluation: { test_validity: [] } };
  assert.equal(validateAuthoredEvaluationInput(aliased).valid, false);
  assert.equal(validateAuthoredEvaluationInput(aliased).diagnostics.diagnostics[0].pointer,
    "/stableEvaluation/test_validity");
  assert.throws(() => assertAuthoredEvaluationInputExecutionFree(aliased, {
    pointerPrefix: "/bindings" }), (error) => {
    assert.equal(error.details.pointer, "/bindings/stableEvaluation/test_validity");
    return true;
  });
});

test("skeleton authoring refuses authored observations on both semantic-input routes", async () => {
  const contract = JSON.parse(await readFile(path.join(packageRoot,
    "examples/minimal-controlled-acceptance-contract.v1.json"), "utf8"));
  const witness = await witnessBearingInput();
  const shared = { contract, requestedIntents: ["controlled-proof-intent.test-verification-validity"],
    selectedPack: { profile_id: "proof.verification.test-validity", profile_version: "2.0.0" } };
  for (const [route, pointer] of [
    [{ evaluationInput: witness }, "/evaluation_input/stable_evaluation/test_validity"],
    [{ evaluation_input: witness }, "/evaluation_input/stable_evaluation/test_validity"],
    [{ bindings: { stable_evaluation: {
      test_validity: witness.stable_evaluation.test_validity } } },
    "/bindings/stable_evaluation/test_validity"],
    [{ bindings: { stableEvaluation: { test_validity: [] } } },
    "/bindings/stableEvaluation/test_validity"]
  ]) {
    await assert.rejects(buildProofAuthoringSkeleton({ ...shared, ...route }), (error) => {
      assert.ok(error instanceof ProofAuthoringSkeletonError, error?.stack);
      assert.equal(error.code, AUTHORED_EXECUTION_OBSERVATION_REFUSAL_CODE);
      assert.equal(error.details.execution_owner, EXECUTION_OBSERVATION_OWNER);
      assert.equal(error.details.pointer, pointer);
      assert.equal(error.details.diagnostics.total_count, 1);
      return true;
    });
  }
});
