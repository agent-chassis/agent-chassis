import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  canonicalDigest,
  guaranteeDigest,
  loadProofPack,
  profileDigest,
  runProofPackAdequacy
} from "../support/proof-pack-adequacy.mjs";
import {
  runProofPackAdequacyControls
} from "./single-winner-effect-v1-adequacy.mjs";
import {
  SINGLE_WINNER_EFFECT_V1_PROFILE
} from "./single-winner-effect-v1-fixture.mjs";
import {
  DOMAINS,
  MUTATIONS,
  executeSingleWinnerEffect,
  singleWinnerEffectGuaranteeSatisfied
} from "./single-winner-effect-v1-harness.mjs";
import {
  validateProfileSchemaV1,
  validateProfileSemanticsV1
} from "../support/stable-v1-proof-pack-runtime.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryRoot = path.resolve(packageRoot, "../..");
const packDirectory = path.join(
  packageRoot,
  "test/certification/profiles/proof.concurrency.single-winner-effect/2.0.0"
);
const readJson = async (name) => JSON.parse(await readFile(
  path.join(packDirectory, name), "utf8"
));

test("single-winner-effect profile is current, pre-dispatch, and digest bound", async () => {
  const adequacy = await readJson("adequacy.json");
  assert.equal(validateProfileSchemaV1(SINGLE_WINNER_EFFECT_V1_PROFILE), true,
    JSON.stringify(validateProfileSchemaV1.errors));
  assert.deepEqual(validateProfileSemanticsV1(SINGLE_WINNER_EFFECT_V1_PROFILE), []);
  assert.deepEqual(SINGLE_WINNER_EFFECT_V1_PROFILE.evaluation_stages, ["pre_dispatch"]);
  assert.equal(adequacy.profile_digest, profileDigest(SINGLE_WINNER_EFFECT_V1_PROFILE));
  assert.equal(adequacy.guarantee_digest, guaranteeDigest(adequacy.guarantee));
  assert.equal(adequacy.guarantee_critical_profile_surfaces.length, 178);
  assert.equal(adequacy.noncritical_profile_surfaces.length, 182);
  assert.deepEqual(adequacy.explicit_exclusions, [
    "arbitrary-histories-beyond-two-attempts",
    "hidden-or-out-of-population-effects",
    "runtime-clock-or-event-order-truth",
    "runtime-grounding-or-trace-truth",
    "transient-duplicate-and-restore"
  ]);
});

test("three domain oracles pass and every named mutant is killed", async () => {
  for (const domain of Object.keys(DOMAINS)) assert.equal(
    singleWinnerEffectGuaranteeSatisfied(executeSingleWinnerEffect({ domain })),
    true,
    domain
  );
  for (const mutant of Object.keys(MUTATIONS)) assert.equal(
    singleWinnerEffectGuaranteeSatisfied(executeSingleWinnerEffect({
      domain: "database-unique-insert",
      mutant
    })),
    false,
    mutant
  );
  const controls = (await runProofPackAdequacyControls({
    profile: SINGLE_WINNER_EFFECT_V1_PROFILE
  })).controls;
  for (const control of controls.filter(({ category }) => category === "positive")) {
    assert.equal(control.implementation_outcome, "passed", control.control_id);
    assert.equal(control.profile_satisfaction, "satisfied", control.control_id);
  }
  for (const control of controls.filter(({ category }) => category === "mutant")) {
    assert.equal(control.implementation_outcome, "killed", control.control_id);
    assert.notEqual(control.profile_satisfaction, "satisfied", control.control_id);
  }
});

test("indexed and full-census certification pass with exact dependency closure", async () => {
  const adequacy = await readJson("adequacy.json");
  const loaded = await loadProofPack(packDirectory, { repositoryRoot });
  const capturedDependencies = loaded.executable_snapshots
    .map(({ path: capturedPath }) => capturedPath)
    .filter((capturedPath) => capturedPath !== adequacy.executable_module)
    .sort();
  assert.deepEqual(
    capturedDependencies,
    adequacy.executable_dependency_digests.map(({ path: declaredPath }) => declaredPath)
  );
  let fullCensus;
  for (const variationMode of ["indexed", "full_census"]) {
    const result = await runProofPackAdequacy(packDirectory, {
      repositoryRoot,
      variationMode
    });
    assert.equal(result.passed, true, JSON.stringify(result.diagnostics));
    assert.deepEqual(result.diagnostics, []);
    assert.equal(result.control_count, 36);
    assert.equal(result.negative_fixture_count, 3);
    assert.equal(result.coverage_witness_count, 178);
    assert.equal(result.negative_fixture_results.every(
      ({ outcome }) => outcome === "rejected"
    ), true);
    if (variationMode === "full_census") fullCensus = result;
  }
  const [stored, admission] = await Promise.all([
    readJson("certification-result.full-census.json"),
    readJson("admission.json")
  ]);
  assert.deepEqual(fullCensus, stored);
  assert.equal(canonicalDigest(fullCensus), admission.certification.adequacy_result_digest);
});
