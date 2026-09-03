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
} from "./visibility-after-durable-settlement-v1-adequacy.mjs";
import {
  VISIBILITY_AFTER_DURABLE_SETTLEMENT_V1_PROFILE
} from "./visibility-after-durable-settlement-v1-fixture.mjs";
import {
  DOMAINS,
  MUTATIONS,
  executeVisibilityAfterDurableSettlement,
  visibilityAfterDurableSettlementGuaranteeSatisfied
} from "./visibility-after-durable-settlement-v1-harness.mjs";
import {
  validateProfileSchemaV1,
  validateProfileSemanticsV1
} from "../support/stable-v1-proof-pack-runtime.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryRoot = path.resolve(packageRoot, "../..");
const packDirectory = path.join(
  packageRoot,
  "test/certification/profiles/proof.ordering.visibility-after-durable-settlement/2.0.0"
);
const readJson = async (name) => JSON.parse(await readFile(
  path.join(packDirectory, name), "utf8"
));

test("visibility-after-durable-settlement profile is current, pre-dispatch, and digest bound", async () => {
  const adequacy = await readJson("adequacy.json");
  assert.equal(validateProfileSchemaV1(VISIBILITY_AFTER_DURABLE_SETTLEMENT_V1_PROFILE), true,
    JSON.stringify(validateProfileSchemaV1.errors));
  assert.deepEqual(validateProfileSemanticsV1(VISIBILITY_AFTER_DURABLE_SETTLEMENT_V1_PROFILE), []);
  assert.deepEqual(VISIBILITY_AFTER_DURABLE_SETTLEMENT_V1_PROFILE.evaluation_stages, ["pre_dispatch"]);
  assert.equal(adequacy.profile_digest, profileDigest(VISIBILITY_AFTER_DURABLE_SETTLEMENT_V1_PROFILE));
  assert.equal(adequacy.guarantee_digest, guaranteeDigest(adequacy.guarantee));
  assert.equal(adequacy.guarantee_critical_profile_surfaces.length, 132);
  assert.equal(adequacy.noncritical_profile_surfaces.length, 149);
  assert.deepEqual(adequacy.explicit_exclusions, [
    "dishonest-grounding-or-self-authored-evidence",
    "eventual-visibility-liveness",
    "heterogeneous-arbitrary-effect-to-state-pairing",
    "runtime-clock-or-event-order-truth",
    "runtime-identity-or-population-truth",
    "runtime-state-or-observation-truth"
  ]);
});

test("three domain oracles pass and every named mutant is killed", async () => {
  for (const domain of Object.keys(DOMAINS)) assert.equal(
    visibilityAfterDurableSettlementGuaranteeSatisfied(executeVisibilityAfterDurableSettlement({ domain })),
    true,
    domain
  );
  for (const mutant of Object.keys(MUTATIONS)) assert.equal(
    visibilityAfterDurableSettlementGuaranteeSatisfied(executeVisibilityAfterDurableSettlement({
      domain: "workflow-ack",
      mutant
    })),
    false,
    mutant
  );
  const controls = (await runProofPackAdequacyControls({
    profile: VISIBILITY_AFTER_DURABLE_SETTLEMENT_V1_PROFILE
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
    assert.equal(result.control_count, 32);
    assert.equal(result.negative_fixture_count, 3);
    assert.equal(result.coverage_witness_count, 132);
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
