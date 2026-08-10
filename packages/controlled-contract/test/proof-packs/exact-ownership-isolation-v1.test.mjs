import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalDigest, evaluateNegativeContractFixtures, guaranteeDigest,
  profileDigest, runProofPackAdequacy } from "../support/proof-pack-adequacy.mjs";
import { runProofPackAdequacyControls } from "./exact-ownership-isolation-v1-adequacy.mjs";
import { buildExactOwnershipIsolationFixture } from "./exact-ownership-isolation-v1-fixture.mjs";
import { executeExactOwnershipScenario, exactOwnershipImplementationPassed } from
  "./exact-ownership-isolation-v1-harness.mjs";
import { evaluateVerificationProfileV034 } from "../../lib/verification-profile-v034.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packDirectory = path.join(
  root, "certification/profiles/proof.ownership.exact-isolation/1.0.0"
);
async function readJson(relative) {
  return JSON.parse(await readFile(path.join(packDirectory, relative), "utf8"));
}
function substantive(controls) {
  return controls.every((control) => {
    if (control.category === "positive") return control.implementation_outcome === "passed" &&
      control.profile_satisfaction === "satisfied";
    if (control.category === "mutant") return control.implementation_outcome === "killed" &&
      control.profile_satisfaction !== "satisfied";
    if (control.category === "profile_rejection") return
      control.implementation_outcome === "not_applicable" &&
      control.profile_satisfaction !== "satisfied";
    return control.implementation_outcome === "boundary_demonstrated";
  });
}

test("exact ownership isolation passes its exhaustive release corpus", async () => {
  const [profile, adequacy] = await Promise.all([
    readJson("profile.json"), readJson("adequacy.json")
  ]);
  assert.equal(adequacy.profile_digest, profileDigest(profile));
  assert.equal(adequacy.guarantee_digest, guaranteeDigest(adequacy.guarantee));
  assert.equal(adequacy.guarantee_critical_profile_surfaces.length, 222);
  assert.equal(adequacy.noncritical_profile_surfaces.length, 146);
  const result = await runProofPackAdequacy(packDirectory, {
    variationMode: "full_census"
  });
  assert.equal(result.passed, true);
  assert.equal(result.control_count, 38);
  assert.equal(result.negative_fixture_count, 15);
  assert.equal(result.coverage_witness_count, 222);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.negative_fixture_results.every(
    ({ outcome }) => outcome === "rejected"), true);
  assert.equal(result.coverage_witness_results.every(
    ({ outcome }) => outcome === "survived"), true);
});

test("fixed semantic evaluation is pure and detects rebound modality", async () => {
  const profile = await readJson("profile.json");
  const fixture = await readJson("negative-fixtures/semantic-claim-variations-base.json");
  const before = canonicalDigest({ profile, fixture });
  assert.equal(evaluateNegativeContractFixtures(profile, [fixture]).results[0].outcome,
    "rejected");
  assert.equal(canonicalDigest({ profile, fixture }), before);
  const variant = fixture.variations.find(({ variant_id: id }) =>
    id === "claim-resource-owned-by-legitimate-owner-modalities");
  const weakened = structuredClone(profile);
  weakened.claim_patterns.find(({ pattern_id: id }) =>
    id === "resource-owned-by-legitimate-owner"
  ).allowed_modalities.push(variant.contract_patches[0].value);
  assert.equal(evaluateNegativeContractFixtures(weakened, [fixture]).results[0].outcome,
    "survived");
});

test("three unrelated ownership domains satisfy the truthful profile", async () => {
  const profile = await readJson("profile.json");
  for (const domain of ["tenant_document", "cloud_bucket", "payment_account"]) {
    const fixture = buildExactOwnershipIsolationFixture({ domain });
    const result = evaluateVerificationProfileV034({ contract: fixture.contract, profile,
      evaluation_input: fixture.input });
    assert.equal(result.satisfaction, "satisfied", domain);
    assert.deepEqual(result.diagnostics, [], domain);
  }
});

test("executed ownership mutants are killed independently", () => {
  const expected = new Map([
    ["refuse_foreign_preserve_authority", true], ["cross_owner_accepted", false],
    ["alias_bypass", false], ["wrong_resource", false], ["refusal_after_effect", false],
    ["legitimate_authority_consumed", false], ["later_valid_fails", false]
  ]);
  for (const [strategy, passed] of expected) assert.equal(
    exactOwnershipImplementationPassed(executeExactOwnershipScenario({ strategy })),
    passed, strategy);
});

test("fixture construction and evaluation are deterministic", async () => {
  const profile = await readJson("profile.json");
  const first = buildExactOwnershipIsolationFixture({ domain: "payment_account" });
  const second = buildExactOwnershipIsolationFixture({ domain: "payment_account" });
  assert.equal(canonicalDigest(first), canonicalDigest(second));
  const evaluate = (fixture) => evaluateVerificationProfileV034({
    contract: fixture.contract, profile, evaluation_input: fixture.input });
  assert.equal(canonicalDigest(evaluate(first)), canonicalDigest(evaluate(second)));
});

test("relations, collections, distinctness, and falsifier bindings matter independently", async () => {
  const original = await readJson("profile.json");
  const mutations = [
    (profile) => profile.relation_patterns.splice(0, 1),
    (profile) => profile.collection_patterns.splice(0, 1),
    (profile) => profile.distinct_reference_role_sets.splice(0, 1),
    (profile) => profile.falsifier_condition_bindings.splice(0, 1)
  ];
  for (const mutate of mutations) {
    const profile = structuredClone(original); mutate(profile);
    const observations = await runProofPackAdequacyControls({ profile });
    assert.equal(substantive(observations.controls), false);
  }
});
