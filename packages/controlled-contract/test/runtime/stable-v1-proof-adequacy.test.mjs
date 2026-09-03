import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import { runProofPackAdequacy } from "../support/proof-pack-adequacy.mjs";
import {
  canonicalDigest,
  canonicalValue,
  sha256
} from "../../lib/exact-binding-common.mjs";

const packageRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const profilesRoot = path.join(packageRoot, "profiles");
const certificationRoot = path.join(packageRoot, "test/certification/profiles");
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const IMPLEMENTATION_READINESS_ID = "proof.design.implementation-readiness";
const TEST_VALIDITY_ID = "proof.verification.test-validity";
const VERIFICATION_RUNTIME =
  "packages/controlled-contract/lib/verification-profile-v1.mjs";

test("all 37 generic stable-v1 packs execute their complete adequacy populations",
  async () => {
    const catalog = await readJson(path.join(profilesRoot, "catalog.json"));
    const generic = catalog.packs.filter(
      ({ profile_id: id }) => id !== TEST_VALIDITY_ID
    );
    assert.equal(generic.length, 37);
    assert.equal(generic.filter(
      ({ profile_id: id }) => id !== IMPLEMENTATION_READINESS_ID
    ).length, 36);
    const currentRuntimeDigest = sha256(await readFile(path.join(
      packageRoot, "lib/verification-profile-v1.mjs"
    )));
    const totals = {
      controls: 0,
      positives: 0,
      satisfiedPositiveObservations: 0,
      mutants: 0,
      rejections: 0,
      negativeFixtures: 0,
      witnesses: 0
    };
    for (const pack of generic) {
      const directory = path.join(
        certificationRoot, pack.profile_id, pack.profile_version
      );
      const [actual, certified, declaration] = await Promise.all([
        runProofPackAdequacy(directory, { variationMode: "full_census" }),
        readJson(path.join(directory, "certification-result.full-census.json")),
        readJson(path.join(directory, "adequacy.json"))
      ]);
      assert.equal(declaration.executable_dependency_digests.find(
        ({ path: dependency }) => dependency === VERIFICATION_RUNTIME
      )?.sha256, currentRuntimeDigest, `${pack.profile_id} executable closure drift`);
      assert.equal(actual.passed, true,
        `${pack.profile_id}: ${JSON.stringify(actual.diagnostics)}`);
      assert.deepEqual(actual, certified,
        `${pack.profile_id} certification behavior drift`);
      totals.controls += actual.control_count;
      totals.positives += declaration.required_positive_cases.length;
      totals.satisfiedPositiveObservations += actual.observations.controls.filter(
        ({ category, profile_satisfaction: satisfaction }) =>
          category === "positive" && satisfaction === "satisfied"
      ).length;
      totals.mutants += declaration.required_mutant_kills.length;
      totals.rejections += declaration.required_profile_rejections.length;
      totals.negativeFixtures += actual.negative_fixture_count;
      totals.witnesses += actual.coverage_witness_count;
    }
    assert.deepEqual(totals, {
      controls: 1584,
      positives: 229,
      satisfiedPositiveObservations: 229,
      mutants: 445,
      rejections: 624,
      negativeFixtures: 2148,
      witnesses: 4309
    });
  });

test("implementation-readiness 2.0.0 remains pinned after 2.1.0 catalog advancement",
  async () => {
    const legacyDirectory = path.join(profilesRoot,
      "proof.design.implementation-readiness", "2.0.0");
    const certificationDirectory = path.join(certificationRoot,
      "proof.design.implementation-readiness", "2.0.0");
    const currentDirectory = path.join(profilesRoot,
      "proof.design.implementation-readiness", "2.1.0");
    const catalog = await readJson(path.join(profilesRoot, "catalog.json"));
    const [profile, admission, currentAdmission, certified, actual] = await Promise.all([
      readJson(path.join(legacyDirectory, "profile.json")),
      readJson(path.join(legacyDirectory, "admission.json")),
      readJson(path.join(currentDirectory, "admission.json")),
      readJson(path.join(certificationDirectory,
        "certification-result.full-census.json")),
      runProofPackAdequacy(certificationDirectory, { variationMode: "full_census" })
    ]);
    const current = catalog.packs.find(
      ({ profile_id: id }) => id === "proof.design.implementation-readiness"
    );
    assert.equal(current.profile_version, "2.1.0");
    assert.equal(profile.profile_version, "2.0.0");
    assert.equal(admission.profile_version, "2.0.0");
    assert.equal(certified.passed, true);
    assert.equal(actual.passed, true, JSON.stringify(actual.diagnostics));
    assert.deepEqual(actual, certified);
    assert.equal(currentAdmission.guarantee, admission.guarantee);
    assert.deepEqual(currentAdmission.explicit_exclusions,
      admission.explicit_exclusions);
    assert.equal(currentAdmission.guarantee_digest, admission.guarantee_digest);
  });

test("every shipped admission carrier is processed without a cap", async () => {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  const schemas = await Promise.all([1, 2].map((version) => readJson(path.join(
    packageRoot, "schema", `controlled-contract-admitted-proof-pack.v${version}.schema.json`
  ))));
  const validators = new Map(schemas.map((schema) => [
    schema.properties.schema_version.const, ajv.compile(schema)
  ]));
  const names = await readdir(profilesRoot, { recursive: true });
  const discovered = names.filter((name) =>
    name.split(path.sep).length === 3 && name.endsWith(`${path.sep}admission.json`)
  ).sort();
  const admissions = [];
  let processed = 0;
  for (const name of discovered) {
    const admissionPath = path.join(profilesRoot, name);
    const [admission, profile] = await Promise.all([
      readJson(admissionPath),
      readJson(path.join(path.dirname(admissionPath), "profile.json"))
    ]);
    const validate = validators.get(admission.schema_version);
    assert(validate, `${name}: unsupported admission schema`);
    assert.equal(validate(admission), true,
      `${name}: ${JSON.stringify(validate.errors)}`);
    assert.equal(admission.profile_id, profile.profile_id, name);
    assert.equal(admission.profile_version, profile.profile_version, name);
    const expectedProfileDigest = profile.schema_version ===
      "controlled-contract-test-validity-profile.v1"
      ? sha256(Buffer.from(`${JSON.stringify(canonicalValue(profile), null, 2)}\n`))
      : canonicalDigest(profile);
    assert.equal(admission.profile_digest, expectedProfileDigest, name);
    assert.equal(admission.guarantee_digest,
      sha256(Buffer.from(admission.guarantee)), name);
    admissions.push(admission);
    processed += 1;
  }
  const byVersion = Object.groupBy(admissions,
    ({ schema_version: version }) => version);
  assert.equal(processed, discovered.length);
  assert.equal(admissions.length, 77);
  assert.equal(byVersion["controlled-contract-admitted-proof-pack.v1"].length, 51);
  assert.equal(byVersion["controlled-contract-admitted-proof-pack.v2"].length, 26);
  assert(admissions.some(({ profile_id: id, profile_version: version }) =>
    id === "proof.design.implementation-readiness" && version === "2.0.0"));
  assert(admissions.some(({ profile_id: id, profile_version: version }) =>
    id === "proof.design.implementation-readiness" && version === "2.1.0"));
});

test("stable test-validity certification preserves one positive and 37 weakenings", async () => {
  const directory = path.join(certificationRoot,
    "proof.verification.test-validity", "2.0.0");
  const [corpus, result, adequacy, admission, runtimeAdmission] = await Promise.all([
    readJson(path.join(directory, "corpus.json")),
    readJson(path.join(directory, "result.json")),
    readJson(path.join(directory, "certification-result.full-census.json")),
    readJson(path.join(directory, "admission.json")),
    readJson(path.join(profilesRoot,
      "proof.verification.test-validity/2.0.0/admission.json"))
  ]);
  assert.equal(corpus.positive_cases.length, 1);
  assert.equal(corpus.single_axis_weakenings.length, 37);
  assert.equal(result.passed_positive_cases.length, 1);
  assert.equal(result.passed_single_axis_weakenings.length, 37);
  assert.deepEqual([
    adequacy.control_count,
    adequacy.negative_fixture_count,
    adequacy.coverage_witness_count
  ], [38, 37, 37]);
  assert.deepEqual(admission, runtimeAdmission);
  assert.deepEqual([
    admission.certification.executable_control_count,
    admission.certification.negative_fixture_count,
    admission.certification.coverage_witness_count
  ], [38, 37, 37]);
});
