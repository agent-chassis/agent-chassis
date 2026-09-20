import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProspectiveProofPlan,
  completeProspectiveEvaluationInputs,
  completeProspectiveStableTestProofs
} from "../../packages/controlled-contract/lib/prospective-proof-plan.mjs";
import {
  buildForbiddenOperationNoninvocationFixture
} from "../../packages/controlled-contract/test/proof-packs/forbidden-operation-noninvocation-v1-fixture.mjs";
import { buildStableTestProofPopulation } from
  "../../packages/controlled-contract/test/support/stable-v1-proof-pack-runtime.mjs";

import { ProofPlanCompilerError, buildProofPlan } from
  "../../packages/controlled-contract/lib/proof-plan-compiler.mjs";

const PACK = Object.freeze({
  profile_id: "proof.operation.forbidden-noninvocation",
  profile_version: "4.0.0",
  evaluation_input_path: "synthetic-forbidden.evaluation-input.json"
});
const INTENT = "controlled-proof-intent.forbidden-operation-noninvocation";

function request() {
  return {
    schema_version: "controlled-contract-proof-plan-request.v1",
    requested_intents: [INTENT],
    selected_packs: [PACK]
  };
}

function preProofPlanFixture() {
  const fixture = buildForbiddenOperationNoninvocationFixture({
    verification_method: "inspection"
  });
  const missingRoles = new Set([
    "execution_context", "forbidden_operation_population"
  ]);
  const evaluationInput = structuredClone(fixture.input);
  evaluationInput.reference_bindings = evaluationInput.reference_bindings.filter(
    ({ role }) => !missingRoles.has(role));
  const missingReferenceIds = new Set(fixture.input.reference_bindings.filter(
    ({ role }) => missingRoles.has(role)).flatMap(({ reference_ids: ids }) => ids));
  const sourceContract = structuredClone(fixture.contract);
  sourceContract.references = sourceContract.references.filter(
    ({ reference_id: id }) => !missingReferenceIds.has(id));
  return { sourceContract, prospectiveContract: fixture.contract,
    evaluationInput, missingRoles };
}

test("prospective compilation repairs exactly two unique WK-2510-shaped bindings", async () => {
  const fixture = preProofPlanFixture();
  const result = await buildProspectiveProofPlan({
    sourceContract: fixture.sourceContract,
    prospectiveContract: fixture.prospectiveContract,
    request: request(),
    evaluationInputs: { [PACK.evaluation_input_path]: fixture.evaluationInput }
  });
  assert.equal(result.counts.generated_bindings, 2);
  assert.deepEqual(result.generated_bindings.map(({ role }) => role),
    [...fixture.missingRoles].sort());
  const completed = result.evaluation_inputs[PACK.evaluation_input_path];
  for (const role of fixture.missingRoles) assert.equal(
    completed.reference_bindings.filter((binding) => binding.role === role).length, 1);
  assert.equal(result.proof_plan.packs.length, 1);
  assert.equal(result.proof_plan.packs[0].profile_id, PACK.profile_id);
});

test("ambiguous prospective binding refuses before a proof plan exists", async () => {
  const fixture = preProofPlanFixture();
  fixture.prospectiveContract.references.push({
    reference_id: "ref-second-execution-context",
    type_term: "cc:scope",
    identity: { kind: "durable_id", domain: "synthetic:scope", value: "second" }
  });
  await assert.rejects(() => buildProspectiveProofPlan({
    sourceContract: fixture.sourceContract,
    prospectiveContract: fixture.prospectiveContract,
    request: request(),
    evaluationInputs: { [PACK.evaluation_input_path]: fixture.evaluationInput }
  }), (error) => error.code ===
    "controlled_contract_prospective_proof_semantics_underdetermined" &&
    error.details.role === "execution_context" &&
    error.details.compatible_candidate_count === 2);
});

test("prospective compilation refuses to derive stable proofs whose selector is underdetermined", () => {
  const fixture = buildForbiddenOperationNoninvocationFixture({
    verification_method: "test_execution"
  });
  const sourceContract = structuredClone(fixture.contract);
  sourceContract.test_proofs = buildStableTestProofPopulation(sourceContract);
  const prospectiveContract = structuredClone(sourceContract);
  const sourceVerification = sourceContract.claims.find((claim) =>
    claim.kind === "verification");
  const sourceRelation = sourceContract.relations.find((relation) =>
    relation.source_claim_id === sourceVerification.claim_id);
  const sourceBehavior = sourceContract.claims.find((claim) =>
    claim.claim_id === sourceRelation.target_claim_id);
  const verificationProposition = sourceContract.propositions.find((proposition) =>
    proposition.proposition_id === sourceVerification.proposition_id);
  const falsifyingProposition = sourceContract.propositions.find((proposition) =>
    proposition.proposition_id === sourceVerification.falsifying_proposition_id);
  const behaviorProposition = sourceContract.propositions.find((proposition) =>
    proposition.proposition_id === sourceBehavior.proposition_id);
  sourceContract.test_proofs[0].system_under_test_boundary.subject_reference_ids = [
    behaviorProposition.subject_reference_id
  ];
  for (let index = 1; index <= 13; index += 1) {
    const suffix = `prospective-${index}`;
    const behavior = { ...structuredClone(sourceBehavior),
      claim_id: `claim-behavior-${suffix}`,
      proposition_id: `prop-behavior-${suffix}` };
    const verification = { ...structuredClone(sourceVerification),
      claim_id: `claim-verify-${suffix}`,
      proposition_id: `prop-verification-${suffix}`,
      falsifying_proposition_id: `prop-falsifying-${suffix}` };
    prospectiveContract.propositions.push(
      { ...structuredClone(behaviorProposition),
        proposition_id: behavior.proposition_id },
      { ...structuredClone(verificationProposition),
        proposition_id: verification.proposition_id },
      { ...structuredClone(falsifyingProposition),
        proposition_id: verification.falsifying_proposition_id }
    );
    prospectiveContract.claims.push(behavior, verification);
    prospectiveContract.relations.push({ ...structuredClone(sourceRelation),
      relation_id: `rel-${suffix}`,
      source_claim_id: verification.claim_id,
      target_claim_id: behavior.claim_id });
  }
  const before = structuredClone({ sourceContract, prospectiveContract });
  assert.throws(() => completeProspectiveStableTestProofs({
    sourceContract, prospectiveContract
  }), (error) => {
    assert.equal(error.code,
      "controlled_contract_prospective_proof_semantics_underdetermined");
    assert.deepEqual(error.details.underdetermined_fields, ["test_selector"]);
    assert.deepEqual(error.details.missing_verification_claim_ids,
      Array.from({ length: 13 }, (_, index) => `claim-verify-prospective-${index + 1}`)
        .sort());
    return true;
  });
  assert.deepEqual({ sourceContract, prospectiveContract }, before);
});

const REFUSAL_PACK = {
  profile_id: "proof.authorization.refusal-before-effects", profile_version: "4.0.0"
};
const BOUNDED_PACK = {
  profile_id: "proof.state.bounded-interval-nonmutation", profile_version: "4.0.0"
};

for (const scenario of [
  { name: "unassigned intent", intents: [INTENT], packs: [REFUSAL_PACK],
    diagnostic: "proof_plan_request_intent_unassigned" },
  { name: "ambiguous intent", intents: ["controlled-proof-intent.protected-effect-nonmutation"],
    packs: [REFUSAL_PACK, BOUNDED_PACK], diagnostic: "proof_plan_request_intent_ambiguous" },
  { name: "unused selected pack", intents: [INTENT], packs: [PACK, REFUSAL_PACK],
    diagnostic: "proof_plan_request_pack_unassigned" },
  { name: "duplicate exact pack", intents: [INTENT], packs: [PACK, PACK],
    code: "proof_plan_request_duplicate_pack" },
  { name: "stale exact version", intents: [INTENT],
    packs: [{ ...PACK, profile_version: "1.0.0" }],
    code: "proof_plan_request_pack_version_stale" }
]) test(`prospective ${scenario.name} retains the normal compiler refusal`, async () => {
  const fixture = preProofPlanFixture();
  const selectedRequest = { ...request(), requested_intents: scenario.intents,
    selected_packs: scenario.packs };
  const evaluationInputs = { [PACK.evaluation_input_path]: fixture.evaluationInput };
  const before = structuredClone({ selectedRequest, evaluationInputs });
  let normalError;
  await assert.rejects(buildProofPlan({ contract: fixture.prospectiveContract,
    request: selectedRequest, evaluationInputs }), (error) => {
    normalError = error;
    assert.ok(error instanceof ProofPlanCompilerError);
    assert.equal(error.code, scenario.code ?? "proof_plan_request_selection_incomplete");
    if (scenario.diagnostic) assert.ok(error.details.diagnostics.some(
      ({ code }) => code === scenario.diagnostic));
    return true;
  });
  for (const compile of [
    () => completeProspectiveEvaluationInputs({ contract: fixture.prospectiveContract,
      request: selectedRequest, evaluationInputs }),
    () => buildProspectiveProofPlan({ sourceContract: fixture.sourceContract,
      prospectiveContract: fixture.prospectiveContract, request: selectedRequest,
      evaluationInputs })
  ]) await assert.rejects(compile(), (error) => {
    assert.ok(error instanceof ProofPlanCompilerError);
    assert.equal(error.code, normalError.code);
    assert.equal(error.message, normalError.message);
    assert.deepEqual(error.details, normalError.details);
    return true;
  });
  assert.deepEqual({ selectedRequest, evaluationInputs }, before);
});
