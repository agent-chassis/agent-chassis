import assert from "node:assert/strict";
import test from "node:test";

import {
  describeProofPackAuthoring,
  discoverProofIntents,
  inspectProofPackBindingsPage,
  selectProofPacks
} from "../../current.mjs";
import {
  loadAdmittedProofPack
} from "../../lib/admitted-proof-packs.mjs";
import {
  buildSoundNegativeObservationSources
} from "./sound-negative-observation-v1-fixture.mjs";
import {
  buildSoundNegativeObservationEvaluationInput
} from "./sound-negative-observation-v1-profile.mjs";

const intentId = "controlled-proof-intent.sound-negative-observation";
const profileId = "proof.observation.sound-negative";
const profileVersion = "2.0.0";

function fixture() {
  const source = buildSoundNegativeObservationSources({
    conclusion: "absent", sourceCount: 2, observationCount: 2,
    domain: "sound-negative-publication"
  });
  const contract = JSON.parse(source.projectionBytes.toString("utf8"));
  return {
    contract,
    evaluationInput: buildSoundNegativeObservationEvaluationInput(contract)
  };
}

test("sound-negative intent is discoverable and selects only its admitted pack", () => {
  const discovery = discoverProofIntents({
    query: "complete captured source absence"
  });
  assert.deepEqual(discovery.intents.map(({ intent_id: id }) => id), [intentId]);
  const selection = selectProofPacks({
    contract: fixture().contract,
    requestedIntents: [intentId]
  });
  assert.deepEqual(selection.selected_packs.map(
    ({ profile_id: id, profile_version: version }) => [id, version]
  ), [[profileId, profileVersion]]);
  assert.equal(selection.selected_packs[0].selection_status, "requires_bindings");
});

test("description preserves association binding semantics", () => {
  const description = describeProofPackAuthoring({
    profileId, profileVersion, requestedIntents: [intentId]
  });
  assert.deepEqual(description.requested_intents, [intentId]);
  const associated = description.proof_obligations.claim_patterns.filter(
    (pattern) => (pattern.for_each?.association_bindings?.length ?? 0) > 0
  );
  assert.equal(associated.length, 14);
  assert.ok(associated.some(({ for_each: iteration }) =>
    iteration.association_bindings.some(
      ({ associated_role: role }) => role === "observation_positions"
    )));
});

test("paged binding assistance validates projection-authored exact roles", async () => {
  const { contract, evaluationInput } = fixture();
  const assistance = await inspectProofPackBindingsPage({
    contract, profileId, profileVersion, requestedIntents: [intentId],
    evaluationInput,
    roles: ["target", "observation_positions", "invalidating_conditions"],
    maximumItems: 20
  });
  assert.equal(assistance.summary.status, "valid");
  assert.equal(assistance.summary.incompatible_binding_count, 0);
  assert.equal(assistance.summary.reference_role_count, 33);
  assert.equal(assistance.summary.number_role_count, 2);
  assert.ok(assistance.items.length > 0);
});

test("published admission binds semantic adequacy and exact certification", async () => {
  const pack = await loadAdmittedProofPack(profileId);
  assert.equal(pack.admission.certification.method,
    "executable_semantic_adequacy");
  assert.equal(pack.admission.certification.executable_control_count, 34);
  assert.equal(pack.admission.certification.negative_fixture_count, 0);
  assert.equal(pack.admission.certification.coverage_witness_count, 0);
  assert.equal(pack.admission.exact_binding.executable_control_count, 15);
});
