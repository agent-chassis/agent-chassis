import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  canonicalDigest,
  loadProofPack,
  profileDigest,
  runProofPackAdequacy
} from "../support/proof-pack-adequacy.mjs";
import {
  EXCLUSIONS,
  runProofPackAdequacyControls
} from "./forbidden-operation-noninvocation-v1-adequacy.mjs";
import { FORBIDDEN_OPERATION_NONINVOCATION_V1_PROFILE }
  from "./forbidden-operation-noninvocation-v1-fixture.mjs";
import {
  DOMAINS,
  MUTATIONS,
  executeForbiddenOperationNoninvocation,
  forbiddenOperationNoninvocationGuaranteeSatisfied
} from "./forbidden-operation-noninvocation-v1-harness.mjs";
import {
  validateProfileSchemaV1,
  validateProfileSemanticsV1
} from "../support/stable-v1-proof-pack-runtime.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryRoot = path.resolve(packageRoot, "../..");
const packDirectory = path.join(packageRoot,
  "test/certification/profiles/proof.operation.forbidden-noninvocation/2.0.0");
const readJson = async (name) => JSON.parse(await readFile(path.join(packDirectory, name), "utf8"));

test("forbidden-operation noninvocation profile is valid and bounded to one declared context", async () => {
  assert.equal(validateProfileSchemaV1(FORBIDDEN_OPERATION_NONINVOCATION_V1_PROFILE), true,
    JSON.stringify(validateProfileSchemaV1.errors));
  assert.deepEqual(validateProfileSemanticsV1(FORBIDDEN_OPERATION_NONINVOCATION_V1_PROFILE), []);
  assert.deepEqual(FORBIDDEN_OPERATION_NONINVOCATION_V1_PROFILE.evaluation_stages,
    ["pre_dispatch"]);
  assert.equal(profileDigest(FORBIDDEN_OPERATION_NONINVOCATION_V1_PROFILE),
    "2bd239cbe18bbbb63db76d21b645713e1cd9de89226438668de654f452be2a07");
  assert.equal((await readJson("evaluation-input.template.json")).reference_bindings.length, 5);
});

test("three unrelated domains pass and restoration of every forbidden operation is killed", async () => {
  for (const domain of Object.keys(DOMAINS)) assert.equal(
    forbiddenOperationNoninvocationGuaranteeSatisfied(
      executeForbiddenOperationNoninvocation({ domain })
    ), true, domain);
  for (const mutant of Object.keys(MUTATIONS)) assert.equal(
    forbiddenOperationNoninvocationGuaranteeSatisfied(
      executeForbiddenOperationNoninvocation({ mutant })
    ), false, mutant);
  const controls = (await runProofPackAdequacyControls({
    profile: FORBIDDEN_OPERATION_NONINVOCATION_V1_PROFILE
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

test("every declared plan rejection is substantive and every exclusion stays explicit", async () => {
  const controls = (await runProofPackAdequacyControls({
    profile: FORBIDDEN_OPERATION_NONINVOCATION_V1_PROFILE
  })).controls;
  const rejections = controls.filter(({ category }) => category === "profile_rejection");
  assert.equal(rejections.length, 13);
  for (const control of rejections) assert.notEqual(
    control.profile_satisfaction, "satisfied", control.control_id
  );
  const exclusions = controls.filter(({ category }) => category === "exclusion");
  assert.deepEqual(exclusions.map(({ control_id: controlId }) => controlId), [...EXCLUSIONS]);
  assert.equal(exclusions.every(({ profile_satisfaction: result }) => result === "satisfied"), true);
});

test("full-census certification is closed, digest-bound, and published", async () => {
  const loaded = await loadProofPack(packDirectory, { repositoryRoot });
  const result = await runProofPackAdequacy(packDirectory, {
    repositoryRoot, variationMode: "full_census"
  });
  assert.equal(result.passed, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.control_count, 35);
  assert.equal(result.negative_fixture_count, 1);
  assert.equal(result.coverage_witness_count, 28);
  assert.equal(result.negative_fixture_results[0].outcome, "rejected");
  assert.equal(result.coverage_witness_results.every(({ outcome }) => outcome === "survived"), true);
  const [stored, admission] = await Promise.all([
    readJson("certification-result.full-census.json"), readJson("admission.json")
  ]);
  assert.deepEqual(result, stored);
  assert.equal(canonicalDigest(result), admission.certification.adequacy_result_digest);
  assert.equal(loaded.profile_digest, admission.profile_digest);
});
