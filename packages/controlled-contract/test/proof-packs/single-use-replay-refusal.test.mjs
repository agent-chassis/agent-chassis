import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  canonicalDigest,
  evaluateNegativeContractFixtures,
  guaranteeDigest,
  profileDigest,
  runProofPackAdequacy
} from "../support/proof-pack-adequacy.mjs";
import {
  runProofPackAdequacyControls
} from "./single-use-replay-refusal-adequacy.mjs";
import {
  buildSingleUseReplayRefusalFixture
} from "./single-use-replay-refusal-fixture.mjs";
import {
  executeSingleUseScenario,
  singleUseImplementationPassed
} from "./single-use-replay-refusal-harness.mjs";
import {
  evaluateVerificationProfileV034
} from "../../lib/verification-profile-v034.mjs";

const controlledContractRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), ".."
);
const packDirectory = path.join(
  controlledContractRoot,
  "certification/profiles/proof.single-use.replay-refusal/1.0.0"
);

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(packDirectory, relativePath), "utf8"));
}

function adequacySubstancePasses(controls) {
  return controls.every((control) => {
    if (control.category === "positive") return
      control.implementation_outcome === "passed" &&
      control.profile_satisfaction === "satisfied";
    if (control.category === "mutant") return
      control.implementation_outcome === "killed" &&
      control.profile_satisfaction !== "satisfied";
    if (control.category === "profile_rejection") return
      control.implementation_outcome === "not_applicable" &&
      control.profile_satisfaction !== "satisfied";
    return control.implementation_outcome === "boundary_demonstrated";
  });
}

test("single-use replay refusal binds and passes the complete release corpus", async () => {
  const [profile, adequacy] = await Promise.all([
    readJson("profile.json"),
    readJson("adequacy.json")
  ]);
  assert.equal(adequacy.profile_digest, profileDigest(profile));
  assert.equal(adequacy.guarantee_digest, guaranteeDigest(adequacy.guarantee));
  assert.equal(adequacy.guarantee_critical_profile_surfaces.length, 263);
  assert.equal(adequacy.noncritical_profile_surfaces.length, 183);

  const result = await runProofPackAdequacy(packDirectory, {
    variationMode: "full_census"
  });
  assert.equal(result.passed, true);
  assert.equal(result.control_count, 40);
  assert.equal(result.negative_fixture_count, 16);
  assert.equal(result.coverage_witness_count, 263);
  assert.equal(result.negative_fixture_results.every(
    ({ outcome }) => outcome === "rejected"
  ), true);
  assert.equal(result.coverage_witness_results.every(
    ({ outcome }) => outcome === "survived"
  ), true);
  assert.deepEqual(result.diagnostics, []);
});

test("fixed semantic variations are pure and detect a rebound modality", async () => {
  const profile = await readJson("profile.json");
  const fixture = await readJson(
    "negative-fixtures/semantic-claim-variations-base.json"
  );
  const inputDigest = canonicalDigest({ profile, fixture });
  const canonical = evaluateNegativeContractFixtures(profile, [fixture]);
  assert.deepEqual(canonical.diagnostics, []);
  assert.equal(canonical.results[0].outcome, "rejected");
  assert.equal(canonicalDigest({ profile, fixture }), inputDigest);

  const variation = fixture.variations.find(
    ({ variant_id: id }) => id === "claim-authority-authorizes-first-use-modalities"
  );
  const weakened = structuredClone(profile);
  weakened.claim_patterns.find(
    ({ pattern_id: id }) => id === "authority-authorizes-first-use"
  ).allowed_modalities.push(variation.contract_patches[0].value);
  assert.equal(
    evaluateNegativeContractFixtures(weakened, [fixture]).results[0].outcome,
    "survived"
  );
});

test("the canonical profile satisfies truthful graphs and rejects abstract operation grounding", async () => {
  const profile = await readJson("profile.json");
  for (const domain of ["password_reset", "queue_permit", "voucher_claim"]) {
    const fixture = buildSingleUseReplayRefusalFixture({ domain });
    const result = evaluateVerificationProfileV034({
      contract: fixture.contract, profile, evaluation_input: fixture.input
    });
    assert.equal(result.satisfaction, "satisfied", domain);
    assert.deepEqual(result.diagnostics, [], domain);
  }
  const ungrounded = buildSingleUseReplayRefusalFixture({
    identity_kind_overrides: { operation: "profile_term" }
  });
  assert.equal(evaluateVerificationProfileV034({
    contract: ungrounded.contract, profile, evaluation_input: ungrounded.input
  }).satisfaction, "invalid");
});

test("executed mutations distinguish the guarantee from observation-bounded exclusions", () => {
  const expected = new Map([
    ["correct", true],
    ["first_refused", false],
    ["first_no_effect", false],
    ["authority_remains_live", false],
    ["replay_accepted", false],
    ["manual_refusal_with_live_authority", false],
    ["duplicate_on_refused_replay", false],
    ["two_effects_on_first", false],
    ["duplicate_then_restore", false]
  ]);
  for (const [strategy, passed] of expected) assert.equal(
    singleUseImplementationPassed(executeSingleUseScenario({ strategy })),
    passed,
    strategy
  );
});

test("relation, collection, and distinct-role mechanisms independently matter", async () => {
  const original = await readJson("profile.json");
  const mutations = [
    (profile) => profile.relation_patterns.splice(0, 1),
    (profile) => profile.collection_patterns.splice(0, 1),
    (profile) => profile.distinct_reference_role_sets.splice(0, 1),
    (profile) => profile.falsifier_condition_bindings.splice(0, 1)
  ];
  for (const mutate of mutations) {
    const profile = structuredClone(original);
    mutate(profile);
    const observations = await runProofPackAdequacyControls({ profile });
    assert.equal(adequacySubstancePasses(observations.controls), false);
  }
});
