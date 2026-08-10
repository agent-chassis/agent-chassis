import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalDigest, guaranteeDigest, loadProofPack, profileDigest, runProofPackAdequacy }
  from "../support/proof-pack-adequacy.mjs";
import { EXCLUSIONS, runProofPackAdequacyControls } from "./bounded-interval-nonmutation-v1-adequacy.mjs";
import { BOUNDED_INTERVAL_NONMUTATION_V1_PROFILE } from "./bounded-interval-nonmutation-v1-fixture.mjs";
import { DOMAINS, MUTATIONS, executeBoundedIntervalNonmutation, boundedIntervalNonmutationGuaranteeSatisfied }
  from "./bounded-interval-nonmutation-v1-harness.mjs";
import { validateProfileSchemaV034, validateProfileSemanticsV034 }
  from "../../lib/verification-profile-v034.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryRoot = path.resolve(packageRoot, "../..");
const packDirectory = path.join(packageRoot,
  "test/certification/profiles/proof.state.bounded-interval-nonmutation/1.0.0");
const readJson = async (name) => JSON.parse(await readFile(path.join(packDirectory, name), "utf8"));

test("bounded-interval-nonmutation profile is valid, pre-dispatch, digest-bound, and explicitly bounded", async () => {
  const adequacy = await readJson("adequacy.json");
  assert.equal(validateProfileSchemaV034(BOUNDED_INTERVAL_NONMUTATION_V1_PROFILE), true,
    JSON.stringify(validateProfileSchemaV034.errors));
  assert.deepEqual(validateProfileSemanticsV034(BOUNDED_INTERVAL_NONMUTATION_V1_PROFILE), []);
  assert.deepEqual(BOUNDED_INTERVAL_NONMUTATION_V1_PROFILE.evaluation_stages, ["pre_dispatch"]);
  assert.equal(adequacy.profile_digest, profileDigest(BOUNDED_INTERVAL_NONMUTATION_V1_PROFILE));
  assert.equal(adequacy.guarantee_digest, guaranteeDigest(adequacy.guarantee));
  assert.equal(adequacy.guarantee_critical_profile_surfaces.length, 58);
  assert.equal(adequacy.noncritical_profile_surfaces.length, 58);
  assert.deepEqual(adequacy.explicit_exclusions, [...EXCLUSIONS].sort());
});

test("three bounded domain histories pass and all seven mutants are killed", async () => {
  for (const domain of Object.keys(DOMAINS)) assert.equal(
    boundedIntervalNonmutationGuaranteeSatisfied(executeBoundedIntervalNonmutation({ domain })), true, domain);
  for (const mutant of Object.keys(MUTATIONS)) assert.equal(
    boundedIntervalNonmutationGuaranteeSatisfied(executeBoundedIntervalNonmutation({ mutant })), false, mutant);
  const controls = (await runProofPackAdequacyControls({ profile: BOUNDED_INTERVAL_NONMUTATION_V1_PROFILE })).controls;
  for (const control of controls.filter(({ category }) => category === "positive")) {
    assert.equal(control.implementation_outcome, "passed", control.control_id);
    assert.equal(control.profile_satisfaction, "satisfied", control.control_id);
  }
  for (const control of controls.filter(({ category }) => category === "mutant")) {
    assert.equal(control.implementation_outcome, "killed", control.control_id);
    assert.notEqual(control.profile_satisfaction, "satisfied", control.control_id);
  }
});

test("full-census certification passes with exact closure and stored result", async () => {
  const adequacy = await readJson("adequacy.json");
  const loaded = await loadProofPack(packDirectory, { repositoryRoot });
  assert.deepEqual(loaded.executable_snapshots.map(({ path: capturedPath }) => capturedPath)
    .filter((capturedPath) => capturedPath !== adequacy.executable_module).sort(),
  adequacy.executable_dependency_digests.map(({ path: declaredPath }) => declaredPath));
  const fullCensus = await runProofPackAdequacy(packDirectory, {
    repositoryRoot, variationMode: "full_census" });
  assert.equal(fullCensus.passed, true, JSON.stringify(fullCensus.diagnostics));
  assert.deepEqual(fullCensus.diagnostics, []);
  assert.equal(fullCensus.control_count, 29);
  assert.equal(fullCensus.negative_fixture_count, 3);
  assert.equal(fullCensus.coverage_witness_count, 58);
  assert.equal(fullCensus.negative_fixture_results.every(({ outcome }) => outcome === "rejected"), true);
  assert.equal(fullCensus.coverage_witness_results.every(({ outcome }) => outcome === "survived"), true);
  const [stored, admission] = await Promise.all([
    readJson("certification-result.full-census.json"), readJson("admission.json")]);
  assert.deepEqual(fullCensus, stored);
  assert.equal(canonicalDigest(fullCensus), admission.certification.adequacy_result_digest);
});
