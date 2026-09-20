import assert from "node:assert/strict";

import { buildStableTestProofPopulation } from "../support/stable-v1-proof-pack-runtime.mjs";
import { TEST_PROOF_VERSION_V1 } from "../../lib/native-contract-carrier-v1.mjs";
import test from "node:test";

import {
  describeProofPackAuthoring,
  discoverProofIntents,
  inspectProofPackBindingsPage,
  selectProofPacks
} from "../../current.mjs";
import { loadAdmittedProofPack } from "../../lib/admitted-proof-packs.mjs";
import {
  buildCallerInputAuthorityConfinementSources
} from "./caller-input-authority-confinement-v1-fixture.mjs";
import {
  buildCallerInputAuthorityConfinementEvaluationInput
} from "./caller-input-authority-confinement-v1-profile.mjs";

const intentId = "controlled-proof-intent.caller-input-authority-confinement";
const profileId = "proof.input.caller-authority-confinement";
const profileVersion = "4.0.0";

function fixture() {
  const captured = buildCallerInputAuthorityConfinementSources();
  const projected = captured.projection.contract;

  return {
    contract: {
      ...projected,
      test_proof_version: TEST_PROOF_VERSION_V1,
      test_proofs: buildStableTestProofPopulation(projected)
    },
    evaluationInput: buildCallerInputAuthorityConfinementEvaluationInput(captured.projection)
  };
}

test("caller-input authority intent is discoverable and selects its exact pack", () => {
  const discovery = discoverProofIntents({ query: "caller input authority confinement" });
  const candidate = discovery.candidates.find(({ proof_name: name }) => name === profileId);
  assert.ok(candidate);
  assert.equal(candidate.profile_version, profileVersion);
  assert.ok(candidate.associations.includes(intentId));
  const selection = selectProofPacks({
    contract: fixture().contract,
    requestedIntents: [intentId]
  });
  assert.deepEqual(selection.selected_packs.map(
    ({ profile_id: profile, profile_version: version }) => [profile, version]
  ), [[profileId, profileVersion]]);
  assert.equal(selection.selected_packs[0].selection_status, "requires_bindings");
});

test("authoring description preserves the one-graph association-bound profile", () => {
  const description = describeProofPackAuthoring({
    profileId, profileVersion, requestedIntents: [intentId]
  });
  assert.deepEqual(description.requested_intents, [intentId]);
  assert.equal(description.compatibility.admission_schema_version,
    "controlled-contract-admitted-proof-pack.v3");
  assert.ok(Array.isArray(description.proof_obligations.satisfaction_expression.all_of));
  const associatedClaims = description.proof_obligations.claim_patterns.filter(
    ({ for_each: forEach }) => (forEach?.association_bindings?.length ?? 0) > 0
  );
  assert.ok(associatedClaims.length > 0);
  assert.equal(description.proof_obligations.relation_patterns.length, 3);
  const claims = new Map(description.proof_obligations.claim_patterns.map((claim) =>
    [claim.pattern_id, claim]));
  for (const relation of description.proof_obligations.relation_patterns) {
    const sourceIteration = claims.get(relation.source_claim_pattern_id).for_each;
    const targetIteration = claims.get(relation.target_claim_pattern_id).for_each;
    assert.deepEqual(sourceIteration, targetIteration);
    assert.ok(sourceIteration.association_bindings.length > 0);
  }
});

test("binding assistance accepts the projection-authored exact role set", async () => {
  const { contract, evaluationInput } = fixture();
  const assistance = await inspectProofPackBindingsPage({
    contract,
    profileId,
    profileVersion,
    requestedIntents: [intentId],
    evaluationInput,
    roles: [
      "accepted_request", "forbidden_request", "forbidden_members",
      "resolution_coordinates", "resolver_operations", "protected_effects"
    ],
    maximumItems: 64
  });
  assert.equal(assistance.summary.status, "valid");
  assert.equal(assistance.summary.incompatible_binding_count, 0);
});

test("published admission binds the remediated adequacy", async () => {
  const pack = await loadAdmittedProofPack(profileId);
  assert.equal(pack.admission.certification.method, "executable_semantic_adequacy");
  assert.equal(pack.admission.certification.executable_control_count, 85);
  assert.equal(pack.admission.profile_digest,
    "3fd1bb644c2ef19e3326e5ce09b1a20eee221c16a1e75736ecdaef95533bfaf6");
});
