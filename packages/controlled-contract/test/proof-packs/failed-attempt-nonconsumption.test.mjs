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
} from "./failed-attempt-nonconsumption-adequacy.mjs";
import {
  buildFailedAttemptNonconsumptionFixture
} from "./failed-attempt-nonconsumption-fixture.mjs";
import {
  executeScenario,
  implementationPassed
} from "./failed-attempt-nonconsumption-harness.mjs";
import {
  evaluateVerificationProfileV034,
  validateProfileSemanticsV034
} from "../../lib/verification-profile-v034.mjs";

const controlledContractRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), ".."
);
const packDirectory = path.join(
  controlledContractRoot,
  "certification/profiles/proof.authorization.failed-attempt-nonconsumption/1.0.0"
);

async function readJson(name) {
  return JSON.parse(await readFile(path.join(packDirectory, name), "utf8"));
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

function removeSatisfactionPattern(profile, patternId) {
  profile.satisfaction_expression.all_of =
    profile.satisfaction_expression.all_of.filter(
      ({ pattern }) => pattern !== patternId
    );
}

function removeClaimPattern(profile, patternId) {
  profile.claim_patterns = profile.claim_patterns.filter(
    ({ pattern_id: candidate }) => candidate !== patternId
  );
  removeSatisfactionPattern(profile, patternId);
  for (const collection of profile.collection_patterns) {
    collection.member_claim_pattern_ids = collection.member_claim_pattern_ids.filter(
      (candidate) => candidate !== patternId
    );
  }
  const removedRelations = profile.relation_patterns.filter(
    ({ source_claim_pattern_id: source, target_claim_pattern_id: target }) =>
      source === patternId || target === patternId
  ).map(({ pattern_id: relationId }) => relationId);
  profile.relation_patterns = profile.relation_patterns.filter(
    ({ pattern_id: relationId }) => !removedRelations.includes(relationId)
  );
  profile.falsifier_condition_bindings =
    profile.falsifier_condition_bindings.filter(
      ({ relation_pattern_id: relationId }) => !removedRelations.includes(relationId)
    );
  for (const relationId of removedRelations) {
    removeSatisfactionPattern(profile, relationId);
  }
}

test("failed-attempt nonconsumption binds and passes all executable controls", async () => {
  const [profile, adequacy] = await Promise.all([
    readJson("profile.json"),
    readJson("adequacy.json")
  ]);
  assert.equal(adequacy.profile_digest, profileDigest(profile));
  assert.equal(adequacy.guarantee_digest, guaranteeDigest(adequacy.guarantee));

  const result = await runProofPackAdequacy(packDirectory);
  assert.equal(result.passed, true);
  assert.equal(result.control_count, 59);
  assert.equal(result.negative_fixture_count, 87);
  assert.equal(result.coverage_witness_count, 200);
  assert.equal(result.negative_fixture_results.every(
    ({ outcome }) => outcome === "rejected"
  ), true);
  assert.deepEqual(result.diagnostics, []);
});

test("fixed negative fixture evaluation is pure and detects a rebound weakening", async () => {
  const profile = await readJson("profile.json");
  const fixture = await readJson(
    "negative-fixtures/reject-weakened-modality-failed-attempt-uses-authority.json"
  );
  const inputDigest = canonicalDigest({ profile, fixture });
  const canonical = evaluateNegativeContractFixtures(profile, [fixture]);
  assert.deepEqual(canonical.diagnostics, []);
  assert.equal(canonical.results[0].outcome, "rejected");
  assert.equal(canonicalDigest({ profile, fixture }), inputDigest);

  const weakened = structuredClone(profile);
  weakened.claim_patterns.find(({ pattern_id: patternId }) =>
    patternId === "failed-attempt-uses-authority"
  ).allowed_modalities.push("SHOULD");
  assert.equal(
    evaluateNegativeContractFixtures(weakened, [fixture]).results[0].outcome,
    "survived"
  );
});

test("aggregate role expansion rejects an operator-cardinality broadening", async () => {
  const profile = await readJson("profile.json");
  profile.reference_roles.find(({ role }) =>
    role === "authority_state_before"
  ).cardinality = "one_or_more";
  assert.ok(validateProfileSemanticsV034(profile).some(
    ({ code, pattern_id: patternId, position }) =>
      code === "profile_operator_position_cardinality_incompatible" &&
      patternId === "authority-state-before-failed-attempt" &&
      position === "operands"
  ));
});

test("failed-attempt nonconsumption is satisfied across three authority domains", () => {
  for (const domain of ["capability_channel", "tenant_lease", "queue_permit"]) {
    const fixture = buildFailedAttemptNonconsumptionFixture({ domain });
    const result = evaluateVerificationProfileV034({
      contract: fixture.contract,
      profile: fixture.profile,
      evaluation_input: fixture.input
    });
    assert.equal(result.satisfaction, "satisfied", domain);
    assert.deepEqual(result.diagnostics, [], domain);
  }
});

test("executed mutations discriminate nonconsumption from later usability", () => {
  const expected = new Map([
    ["preserve", true],
    ["consume_on_failure", false],
    ["replenish_after_observation", false],
    ["later_valid_fails", false],
    ["wrong_authority_later", false],
    ["missing_refusal", false],
    ["consume_then_restore", true]
  ]);
  for (const [strategy, passed] of expected) {
    assert.equal(
      implementationPassed(executeScenario({ strategy })),
      passed,
      strategy
    );
  }
});

test("every remaining profile mechanism has independent adequacy discrimination", async () => {
  const original = await readJson("profile.json");
  const mutations = [
    (profile) => removeClaimPattern(profile, "authority-state-preserved"),
    (profile) => removeClaimPattern(profile, "valid-result-matches-expected-success"),
    (profile) => {
      profile.collection_patterns = [];
      removeSatisfactionPattern(profile, "proof-population");
    },
    ...original.distinct_reference_role_sets.map((_, index) => (profile) => {
      profile.distinct_reference_role_sets.splice(index, 1);
    })
  ];
  for (const mutate of mutations) {
    const profile = structuredClone(original);
    mutate(profile);
    const observations = await runProofPackAdequacyControls({ profile });
    assert.equal(adequacySubstancePasses(observations.controls), false);
  }
});
