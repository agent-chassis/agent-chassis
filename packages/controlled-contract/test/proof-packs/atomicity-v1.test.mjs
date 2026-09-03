import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  guaranteeDigest,
  profileDigest,
  runProofPackAdequacy
} from "../support/proof-pack-adequacy.mjs";

const controlledContractRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), ".."
);
const packDirectory = path.join(
  controlledContractRoot,
  "certification/profiles/proof.atomicity.failure-boundary/2.0.0"
);

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(packDirectory, relativePath), "utf8"));
}

test("atomicity 2.0 binds its canonical guarantee and executable controls", async () => {
  const [profile, adequacy] = await Promise.all([
    readJson("profile.json"),
    readJson("adequacy.json")
  ]);
  assert.equal(adequacy.profile_id, profile.profile_id);
  assert.equal(adequacy.profile_version, profile.profile_version);
  assert.equal(adequacy.profile_digest, profileDigest(profile));
  assert.equal(adequacy.guarantee_digest, guaranteeDigest(adequacy.guarantee));

  const result = await runProofPackAdequacy(packDirectory, {
    variationMode: "full_census"
  });
  assert.equal(result.passed, true);
  assert.equal(result.control_count, 46);
  assert.equal(result.negative_fixture_count, 66);
  assert.equal(result.coverage_witness_count, 297);
  assert.deepEqual(result.diagnostics, []);
});

test("atomicity full census preserves every negative and weakening refusal", async () => {
  const result = await runProofPackAdequacy(packDirectory, {
    variationMode: "full_census"
  });
  assert.equal(result.negative_fixture_results.length, 66);
  assert.equal(result.negative_fixture_results.every(
    ({ outcome }) => outcome === "rejected"
  ), true);
  assert.equal(result.observations.controls.filter(({ category }) =>
    category === "mutant" || category === "profile_rejection"
  ).every(({ profile_satisfaction: satisfaction }) => satisfaction !== "satisfied"), true);
});

test("atomicity executable sources are repository-relative and fully declared", async () => {
  const adequacy = await readJson("adequacy.json");
  const declaredPaths = [
    adequacy.executable_module,
    ...adequacy.executable_dependency_digests.map(({ path: dependencyPath }) =>
      dependencyPath
    )
  ];
  for (const requiredPath of [
    "packages/controlled-contract/test/proof-packs/atomicity-v1-adequacy.mjs",
    "packages/controlled-contract/test/proof-packs/atomicity-v1-fixture.mjs",
    "packages/controlled-contract/test/proof-packs/atomicity-v1-harness.mjs"
  ]) assert.ok(declaredPaths.includes(requiredPath));
  assert.deepEqual(
    adequacy.executable_dependency_digests.map(({ path: dependencyPath }) => dependencyPath),
    adequacy.executable_dependency_digests.map(
      ({ path: dependencyPath }) => dependencyPath
    ).sort()
  );
  assert.ok(adequacy.executable_dependency_digests.every(({ sha256 }) =>
    /^[a-f0-9]{64}$/u.test(sha256)
  ));
  for (const declaredPath of declaredPaths) {
    const source = await readFile(path.resolve(
      controlledContractRoot, "../../..", declaredPath
    ), "utf8");
    assert.doesNotMatch(source, /(?:\/home\/|\/tmp\/)/u);
  }
});
