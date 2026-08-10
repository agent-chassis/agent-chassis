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
import {
  assertFixedNegativeCorpus
} from "../support/fixed-negative-corpus-test-helpers.mjs";

const controlledContractRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), ".."
);
const packDirectory = path.join(
  controlledContractRoot,
  "certification/profiles/proof.atomicity.failure-boundary/1.0.0"
);

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(packDirectory, relativePath), "utf8"));
}

test("atomicity 1.0 binds its canonical guarantee and executable controls", async () => {
  const [profile, adequacy] = await Promise.all([
    readJson("profile.json"),
    readJson("adequacy.json")
  ]);
  assert.equal(adequacy.profile_id, profile.profile_id);
  assert.equal(adequacy.profile_version, profile.profile_version);
  assert.equal(adequacy.profile_digest, profileDigest(profile));
  assert.equal(adequacy.guarantee_digest, guaranteeDigest(adequacy.guarantee));

  const result = await runProofPackAdequacy(packDirectory);
  assert.equal(result.passed, true);
  assert.equal(result.control_count, 46);
  assert.equal(result.negative_fixture_count, 66);
  assert.equal(result.coverage_witness_count, 297);
  assert.deepEqual(result.diagnostics, []);
});

function retargetAtomicityVerification(profile) {
  const relation = profile.relation_patterns[0];
  const originalTarget = profile.claim_patterns.find(
    ({ pattern_id: id }) => id === relation.target_claim_pattern_id
  );
  const replacement = profile.claim_patterns.find(
    ({ pattern_id: id }) => id === "fully-committed-state-allowed"
  );
  originalTarget.claim_kind = "evidence";
  replacement.claim_kind = "behavior";
  relation.target_claim_pattern_id = replacement.pattern_id;
  const verification = profile.claim_patterns.find(
    ({ pattern_id: id }) => id === relation.source_claim_pattern_id
  );
  verification.falsifying_proposition_template = {
    ...structuredClone(replacement.proposition_template),
    operator: "reference:not_member_of"
  };
  profile.falsifier_condition_bindings[0].applicability_context =
    structuredClone(replacement.proposition_template.applicability_context);
  return profile;
}

test("atomicity fixed negatives kill every fully rebound critical weakening", async () => {
  const matrix = await assertFixedNegativeCorpus({
    packDirectory,
    expectedFixtureCount: 66,
    expectedSurfaceCount: 201,
    relationMutation: retargetAtomicityVerification
  });
  assert.deepEqual(matrix, { fixture_count: 66, mutation_count: 58 });
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
