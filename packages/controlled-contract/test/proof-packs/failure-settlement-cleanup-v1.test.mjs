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
import { runProofPackAdequacyControls } from
  "./failure-settlement-cleanup-v1-adequacy.mjs";
import { buildFailureSettlementCleanupFixture } from
  "./failure-settlement-cleanup-v1-fixture.mjs";
import {
  executeFailureSettlementScenario,
  failureSettlementImplementationPassed
} from "./failure-settlement-cleanup-v1-harness.mjs";
import { evaluateStableProofPackFixtureV1 } from "../support/stable-v1-proof-pack-runtime.mjs";

const controlledContractRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), ".."
);
const packDirectory = path.join(
  controlledContractRoot,
  "certification/profiles/proof.failure.settlement-and-cleanup/2.0.0"
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

test("failure settlement pack passes its complete fixed corpus", async () => {
  const [profile, adequacy] = await Promise.all([
    readJson("profile.json"), readJson("adequacy.json")
  ]);
  assert.equal(adequacy.profile_digest, profileDigest(profile));
  assert.equal(adequacy.guarantee_digest, guaranteeDigest(adequacy.guarantee));
  assert.equal(adequacy.guarantee_critical_profile_surfaces.length, 150);
  assert.equal(adequacy.noncritical_profile_surfaces.length, 85);
  for (const variationMode of ["indexed", "full_census"]) {
    const result = await runProofPackAdequacy(packDirectory, { variationMode });
    assert.equal(result.passed, true);
    assert.equal(result.control_count, 40);
    assert.equal(result.negative_fixture_count, 15);
    assert.equal(result.coverage_witness_count, 150);
    assert.deepEqual(result.diagnostics, []);
    assert.equal(result.negative_fixture_results.every(
      ({ outcome }) => outcome === "rejected"
    ), true);
    assert.equal(result.coverage_witness_results.every(
      ({ outcome }) => outcome === "survived"
    ), true);
  }
});

test("semantic fixture evaluation is pure and detects a rebound weakening", async () => {
  const profile = await readJson("profile.json");
  const fixture = await readJson("negative-fixtures/semantic-claim-variations-base.json");
  const before = canonicalDigest({ profile, fixture });
  assert.equal(evaluateNegativeContractFixtures(profile, [fixture]).results[0].outcome,
    "rejected");
  assert.equal(canonicalDigest({ profile, fixture }), before);
  const variant = fixture.variations.find(({ variant_id: id }) =>
    id === "claim-attempt-performs-operation-modalities"
  );
  const weakened = structuredClone(profile);
  weakened.claim_patterns.find(({ pattern_id: id }) =>
    id === "attempt-performs-operation"
  ).allowed_modalities.push(variant.contract_patches[0].value);
  assert.equal(evaluateNegativeContractFixtures(
    weakened, [fixture]
  ).results[0].outcome, "survived");
});

test("three unrelated domains produce truthful satisfying graphs", async () => {
  const profile = await readJson("profile.json");
  for (const domain of ["file_upload", "job_dispatch", "schema_migration"]) {
    const fixture = buildFailureSettlementCleanupFixture({ domain });
    const result = evaluateStableProofPackFixtureV1({
      contract: fixture.contract, profile, evaluation_input: fixture.input
    });
    assert.equal(result.satisfaction, "satisfied", domain);
    assert.deepEqual(result.diagnostics, [], domain);
  }
});

test("executed mutants distinguish settlement cleanup and cause preservation", () => {
  const expected = new Map([
    ["cleanup_and_preserve_cause", true], ["no_failure", false],
    ["missing_cleanup", false], ["partial_cleanup", false],
    ["settlement_before_cleanup", false], ["cause_replaced", false],
    ["cause_dropped", false], ["cleanup_then_residue_reappears", false]
  ]);
  for (const [strategy, passed] of expected) assert.equal(
    failureSettlementImplementationPassed(executeFailureSettlementScenario({ strategy })),
    passed, strategy
  );
});

test("fixture construction and evaluation are deterministic", async () => {
  const profile = await readJson("profile.json");
  const first = buildFailureSettlementCleanupFixture({ domain: "schema_migration" });
  const second = buildFailureSettlementCleanupFixture({ domain: "schema_migration" });
  assert.equal(canonicalDigest(first), canonicalDigest(second));
  const evaluate = (fixture) => evaluateStableProofPackFixtureV1({
    contract: fixture.contract, profile, evaluation_input: fixture.input
  });
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
    const profile = structuredClone(original);
    mutate(profile);
    const observations = await runProofPackAdequacyControls({ profile });
    assert.equal(substantive(observations.controls), false);
  }
});
