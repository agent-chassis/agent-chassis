import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalDigest, guaranteeDigest, loadProofPack, profileDigest,
  runProofPackAdequacy } from "../support/proof-pack-adequacy.mjs";
import { runProofPackAdequacyControls
} from "./bounded-state-stability-v1-adequacy.mjs";
import { BOUNDED_STATE_STABILITY_V1_PROFILE
} from "./bounded-state-stability-v1-fixture.mjs";
import { DOMAINS, LEGITIMATE_VARIANTS, MUTATIONS, executeBoundedStateStability,
  boundedStateStabilityGuaranteeSatisfied
} from "./bounded-state-stability-v1-harness.mjs";
import { validateProfileSchemaV034, validateProfileSemanticsV034
} from "../../lib/verification-profile-v034.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryRoot = path.resolve(packageRoot, "../..");
const packDirectory = path.join(packageRoot,
  "test/certification/profiles/proof.lifecycle.bounded-state-stability/1.0.0");
const readJson = async (name) => JSON.parse(await readFile(
  path.join(packDirectory, name), "utf8"
));

test("bounded-state-stability profile is current, bounded, and digest bound", async () => {
  const adequacy = await readJson("adequacy.json");
  assert.equal(validateProfileSchemaV034(BOUNDED_STATE_STABILITY_V1_PROFILE), true,
    JSON.stringify(validateProfileSchemaV034.errors));
  assert.deepEqual(validateProfileSemanticsV034(BOUNDED_STATE_STABILITY_V1_PROFILE), []);
  assert.deepEqual(BOUNDED_STATE_STABILITY_V1_PROFILE.evaluation_stages, ["pre_dispatch"]);
  assert.equal(adequacy.profile_digest, profileDigest(BOUNDED_STATE_STABILITY_V1_PROFILE));
  assert.equal(adequacy.guarantee_digest, guaranteeDigest(adequacy.guarantee));
  assert.equal(adequacy.guarantee_critical_profile_surfaces.length, 76);
  assert.equal(adequacy.noncritical_profile_surfaces.length, 64);
  assert.equal(BOUNDED_STATE_STABILITY_V1_PROFILE.claim_patterns.some(
    ({ pattern_id }) => pattern_id.includes("terminal") || pattern_id.includes("reactivation")
  ), false);
});

test("three domains and distinctions pass while all regression mutants and P8-only fail", async () => {
  for (const domain of Object.keys(DOMAINS)) assert.equal(
    boundedStateStabilityGuaranteeSatisfied(executeBoundedStateStability({ domain })), true,
    domain
  );
  for (const variant of Object.keys(LEGITIMATE_VARIANTS)) assert.equal(
    boundedStateStabilityGuaranteeSatisfied(executeBoundedStateStability({
      domain: "cancellation-survivor-window", variant
    })), true, variant
  );
  for (const mutant of Object.keys(MUTATIONS)) assert.equal(
    boundedStateStabilityGuaranteeSatisfied(executeBoundedStateStability({
      domain: "cancellation-survivor-window", mutant
    })), false, mutant
  );
  const controls = (await runProofPackAdequacyControls({
    profile: BOUNDED_STATE_STABILITY_V1_PROFILE
  })).controls;
  for (const control of controls.filter(({ category }) => category === "positive")) {
    assert.equal(control.implementation_outcome, "passed", control.control_id);
    assert.equal(control.profile_satisfaction, "satisfied", control.control_id);
  }
  for (const control of controls.filter(({ category }) => category === "mutant")) {
    assert.equal(control.implementation_outcome, "killed", control.control_id);
    assert.notEqual(control.profile_satisfaction, "satisfied", control.control_id);
  }
  const p8 = controls.find(({ control_id }) =>
    control_id === "independent-p8-artifact-comparison-only");
  assert.ok(p8);
  assert.notEqual(p8.profile_satisfaction, "satisfied");
});

test("indexed and stored full-census certification pass with exact closure", async () => {
  const adequacy = await readJson("adequacy.json");
  const loaded = await loadProofPack(packDirectory, { repositoryRoot });
  assert.deepEqual(loaded.executable_snapshots.map(({ path: capturedPath }) => capturedPath)
    .filter((capturedPath) => capturedPath !== adequacy.executable_module).sort(),
  adequacy.executable_dependency_digests.map(({ path: declaredPath }) => declaredPath));
  let fullCensus;
  for (const variationMode of ["indexed", "full_census"]) {
    const result = await runProofPackAdequacy(packDirectory, {
      repositoryRoot, variationMode
    });
    assert.equal(result.passed, true, JSON.stringify(result.diagnostics));
    assert.deepEqual(result.diagnostics, []);
    assert.equal(result.control_count, 36);
    assert.equal(result.negative_fixture_count, 3);
    assert.equal(result.coverage_witness_count, 76);
    assert.equal(result.negative_fixture_results.every(
      ({ outcome }) => outcome === "rejected"
    ), true);
    if (variationMode === "full_census") fullCensus = result;
  }
  const [stored, admission] = await Promise.all([
    readJson("certification-result.full-census.json"), readJson("admission.json")
  ]);
  assert.deepEqual(fullCensus, stored);
  assert.equal(canonicalDigest(fullCensus), admission.certification.adequacy_result_digest);
});
