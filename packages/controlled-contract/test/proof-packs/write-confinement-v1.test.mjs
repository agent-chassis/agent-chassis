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
} from "./write-confinement-v1-adequacy.mjs";
import {
  WRITE_CONFINEMENT_V1_PROFILE
} from "./write-confinement-v1-fixture.mjs";
import {
  DOMAINS,
  MUTATIONS,
  executeWriteConfinement,
  writeConfinementGuaranteeSatisfied
} from "./write-confinement-v1-harness.mjs";
import {
  validateProfileSchemaV1,
  validateProfileSemanticsV1
} from "../support/stable-v1-proof-pack-runtime.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryRoot = path.resolve(packageRoot, "../..");
const packDirectory = path.join(
  packageRoot,
  "test/certification/profiles/proof.scope.write-confinement/2.0.0"
);
const readJson = async (name) => JSON.parse(await readFile(
  path.join(packDirectory, name), "utf8"
));

test("write-confinement profile is current, pre-dispatch, and digest bound", async () => {
  const adequacy = await readJson("adequacy.json");
  assert.equal(validateProfileSchemaV1(WRITE_CONFINEMENT_V1_PROFILE), true,
    JSON.stringify(validateProfileSchemaV1.errors));
  assert.deepEqual(validateProfileSemanticsV1(WRITE_CONFINEMENT_V1_PROFILE), []);
  assert.deepEqual(WRITE_CONFINEMENT_V1_PROFILE.evaluation_stages, ["pre_dispatch"]);
  assert.equal(adequacy.profile_digest, profileDigest(WRITE_CONFINEMENT_V1_PROFILE));
  assert.equal(adequacy.guarantee_digest, guaranteeDigest(adequacy.guarantee));
  assert.equal(adequacy.guarantee_critical_profile_surfaces.length, 36);
  assert.equal(adequacy.noncritical_profile_surfaces.length, 40);
});

test("three domains and both explicit-empty cases pass; every mutant is killed", async () => {
  for (const domain of Object.keys(DOMAINS)) assert.equal(
    writeConfinementGuaranteeSatisfied(executeWriteConfinement({ domain })),
    true,
    domain
  );
  for (const mutant of Object.keys(MUTATIONS)) assert.equal(
    writeConfinementGuaranteeSatisfied(executeWriteConfinement({
      domain: mutant.includes("authorized") ? "database" : "filesystem",
      mutant
    })),
    false,
    mutant
  );
  const controls = (await runProofPackAdequacyControls({
    profile: WRITE_CONFINEMENT_V1_PROFILE
  })).controls;
  for (const controlId of ["empty-observed-population", "both-populations-empty"]) {
    const control = controls.find(({ control_id: id }) => id === controlId);
    assert.equal(control.implementation_outcome, "passed");
    assert.equal(control.profile_satisfaction, "satisfied");
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
  for (const variationMode of ["indexed", "full_census"]) {
    const result = await runProofPackAdequacy(packDirectory, {
      repositoryRoot,
      variationMode
    });
    assert.equal(result.passed, true, JSON.stringify(result.diagnostics));
    assert.deepEqual(result.diagnostics, []);
    assert.equal(result.control_count, 38);
    assert.equal(result.negative_fixture_count, 3);
    assert.equal(result.coverage_witness_count, 36);
    assert.equal(result.negative_fixture_results.every(
      ({ outcome }) => outcome === "rejected"
    ), true);
  }
});

test("full-census replay and the stored release result are deterministic", async () => {
  const [forward, reverse, stored, admission] = await Promise.all([
    runProofPackAdequacy(packDirectory, { repositoryRoot, variationMode: "full_census" }),
    runProofPackAdequacy(packDirectory, { repositoryRoot, variationMode: "full_census" }),
    readJson("certification-result.full-census.json"),
    readJson("admission.json")
  ]);
  assert.deepEqual(forward, reverse);
  assert.deepEqual(forward, stored);
  assert.equal(canonicalDigest(forward), admission.certification.adequacy_result_digest);
});

test("release exclusions forbid runtime, provenance, causality, completeness, and exact-binding claims",
  async () => {
    const adequacy = await readJson("adequacy.json");
    assert.deepEqual(adequacy.explicit_exclusions, [
      "authorized-population-authenticity-and-completeness",
      "causal-attribution-of-mutations-to-execution",
      "exact-binding-or-launcher-owned-observation",
      "observation-completeness-beyond-caller-declaration",
      "prevention-or-rollback-of-unauthorized-mutation",
      "runtime-target-existence-or-truth",
      "snapshot-producer-provenance",
      "undiscovered-transient-reverted-or-concurrent-mutations"
    ]);
  });
