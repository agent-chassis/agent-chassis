import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  canonicalDigest,
  guaranteeDigest,
  profileDigest,
  runProofPackAdequacy
} from "../support/proof-pack-adequacy.mjs";
import {
  evaluateFixture,
  profileRejectionFixtures,
  runProofPackAdequacyControls
} from "./result-shape-conformance-v1-adequacy.mjs";
import {
  RESULT_SHAPE_CONFORMANCE_V1_PROFILE,
  buildResultShapeConformanceFixture
} from "./result-shape-conformance-v1-fixture.mjs";
import {
  MUTATIONS,
  executeResultShape,
  resultShapeGuaranteeSatisfied
} from "./result-shape-conformance-v1-harness.mjs";
import {
  evaluateVerificationProfileV034,
  validateProfileSchemaV034,
  validateProfileSemanticsV034
} from "../../lib/verification-profile-v034.mjs";

const controlledContractRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), ".."
);
const repositoryRoot = path.resolve(controlledContractRoot, "../../..");
const packDirectory = path.join(
  controlledContractRoot,
  "certification/profiles/proof.result-shape.conformance/1.0.0"
);

async function readJson(name) {
  return JSON.parse(await readFile(path.join(packDirectory, name), "utf8"));
}

function applyReplacementPatches(document, patches) {
  const result = structuredClone(document);
  for (const patch of patches) {
    assert.equal(patch.op, "replace");
    const tokens = patch.path.slice(1).split("/").map(
      (token) => token.replaceAll("~1", "/").replaceAll("~0", "~")
    );
    let owner = result;
    for (const token of tokens.slice(0, -1)) {
      owner = owner[Array.isArray(owner) ? Number(token) : token];
    }
    const token = tokens.at(-1);
    owner[Array.isArray(owner) ? Number(token) : token] = structuredClone(patch.value);
  }
  return result;
}

function expandVariant(fixture, variant) {
  return {
    contract: applyReplacementPatches(fixture.contract, variant.contract_patches),
    evaluation_input: applyReplacementPatches(
      fixture.evaluation_input, variant.evaluation_input_patches
    )
  };
}

test("result-shape 1.0 admits indexed and full-census proof corpora", async () => {
  const [profile, adequacy] = await Promise.all([
    readJson("profile.json"),
    readJson("adequacy.json")
  ]);
  assert.equal(adequacy.profile_digest, profileDigest(profile));
  assert.equal(adequacy.guarantee_digest, guaranteeDigest(adequacy.guarantee));
  assert.equal(adequacy.guarantee_critical_profile_surfaces.length, 140);
  assert.equal(adequacy.noncritical_profile_surfaces.length, 130);

  for (const variationMode of ["indexed", "full_census"]) {
    const result = await runProofPackAdequacy(packDirectory, { variationMode });
    assert.equal(result.passed, true, variationMode);
    assert.equal(result.control_count, 36);
    assert.equal(result.negative_fixture_count, 3);
    assert.equal(result.coverage_witness_count, 140);
    assert.equal(result.negative_fixture_results.every(
      ({ outcome }) => outcome === "rejected"
    ), true);
    assert.deepEqual(result.diagnostics, []);
  }
});

test("every result-shape coverage binding has a canonical kill and weakened-profile survivor",
  async () => {
    const [profile, adequacy, witnessIndex] = await Promise.all([
      readJson("profile.json"),
      readJson("adequacy.json"),
      readJson("witness-profile-weakenings.json")
    ]);
    assert.equal(witnessIndex.profile_digest, profileDigest(profile));
    const fixtures = new Map(await Promise.all(
      adequacy.negative_contract_fixtures.map(async ({ fixture_id: fixtureId, path: fixturePath }) => [
        fixtureId,
        JSON.parse(await readFile(path.join(repositoryRoot, fixturePath), "utf8"))
      ])
    ));
    const witnesses = new Map(witnessIndex.witnesses.map((witness) => [
      `${witness.surface_id}\0${witness.weakening_class}\0${witness.fixture_id}`,
      witness
    ]));
    let bindingCount = 0;
    for (const surface of adequacy.guarantee_critical_profile_surfaces) {
      for (const coverage of surface.coverage) {
        for (const fixtureId of coverage.negative_fixture_ids) {
          bindingCount += 1;
          const key = `${surface.surface_id}\0${coverage.weakening_class}\0${fixtureId}`;
          const witness = witnesses.get(key);
          assert.ok(witness, key);
          const fixture = fixtures.get(fixtureId);
          const variant = fixture.variations.find(
            ({ variant_id: variantId }) => variantId === witness.variant_id
          );
          assert.deepEqual(variant.covers, [{
            surface_id: surface.surface_id,
            weakening_class: coverage.weakening_class
          }], key);
          const expanded = expandVariant(fixture, variant);
          const canonical = evaluateVerificationProfileV034({
            contract: expanded.contract,
            profile,
            evaluation_input: expanded.evaluation_input
          });
          assert.equal(canonical.contract_valid, true, key);
          assert.equal(canonical.input_valid, true, key);
          assert.ok(["unsatisfied", "invalid"].includes(canonical.satisfaction), key);

          const weakened = applyReplacementPatches(profile, witness.profile_patches);
          assert.equal(canonicalDigest(weakened), witness.weakened_profile_digest, key);
          assert.equal(validateProfileSchemaV034(weakened), true,
            `${key}: ${JSON.stringify(validateProfileSchemaV034.errors)}`);
          assert.deepEqual(validateProfileSemanticsV034(weakened), [], key);
          const rebound = evaluateVerificationProfileV034({
            contract: expanded.contract,
            profile: weakened,
            evaluation_input: expanded.evaluation_input
          });
          assert.equal(rebound.contract_valid, true, key);
          assert.equal(rebound.input_valid, true, key);
          assert.equal(rebound.satisfaction, "satisfied", key);
        }
      }
    }
    assert.equal(bindingCount, 140);
    assert.equal(witnesses.size, bindingCount);

    const reviewerExample = witnessIndex.witnesses.find(
      ({ surface_id: surfaceId }) =>
        surfaceId === "claim-operation-returns-result-proposition-operator"
    );
    const reviewerFixture = fixtures.get(reviewerExample.fixture_id);
    const reviewerVariant = reviewerFixture.variations.find(
      ({ variant_id: variantId }) => variantId === reviewerExample.variant_id
    );
    const reviewerExpanded = expandVariant(reviewerFixture, reviewerVariant);
    assert.equal(
      reviewerExpanded.contract.propositions.find(
        ({ proposition_id: propositionId }) =>
          propositionId === "prop-operation-returns-result"
      ).operator,
      "reference:creates"
    );
    const reviewerProfile = applyReplacementPatches(profile, reviewerExample.profile_patches);
    assert.equal(
      reviewerProfile.claim_patterns.find(
        ({ pattern_id: patternId }) => patternId === "operation-returns-result"
      ).proposition_template.operator,
      "reference:creates"
    );
  });

test("three unrelated result domains pass and every executed mutant is killed", () => {
  for (const domain of ["invoice", "telemetry", "command"]) {
    assert.equal(resultShapeGuaranteeSatisfied(executeResultShape({ domain })), true);
  }
  for (const mutant of Object.keys(MUTATIONS)) {
    assert.equal(
      resultShapeGuaranteeSatisfied(
        executeResultShape({ domain: "invoice", mutant })
      ),
      false,
      mutant
    );
  }
});

test("optional members may be absent while required typed descriptors remain exact",
  () => {
    const execution = executeResultShape({ domain: "invoice" });
    execution.members = execution.members.filter(
      (member) => !execution.optional.includes(member)
    );
    execution.reported_count = execution.members.length;
    assert.equal(resultShapeGuaranteeSatisfied(execution), true);
    const fixture = buildResultShapeConformanceFixture({
      profile: RESULT_SHAPE_CONFORMANCE_V1_PROFILE,
      role_id_overrides: {
        result_members: [
          "ref-member-id-string",
          "ref-member-total-number"
        ]
      },
      number_value_overrides: { result_count: 2 },
      proposition_overrides: {
        "result-count-complete": {
          operands: [{ kind: "number", value: 2 }]
        }
      }
    });
    assert.equal(evaluateFixture(fixture), "satisfied");
  });

test("status-only verification and invented result/schema terms are rejected", () => {
  const rejections =
    profileRejectionFixtures(RESULT_SHAPE_CONFORMANCE_V1_PROFILE);
  assert.notEqual(
    evaluateFixture(rejections["status-only-verification"]()),
    "satisfied"
  );
  for (const role of ["result", "schema"]) {
    const fixture = buildResultShapeConformanceFixture({
      profile: RESULT_SHAPE_CONFORMANCE_V1_PROFILE,
      identity_overrides: {
        [role]: { kind: "profile_term", term: `invented-${role}` }
      }
    });
    const result = evaluateVerificationProfileV034({
      contract: fixture.contract,
      profile: fixture.profile,
      evaluation_input: fixture.input
    });
    assert.equal(result.contract_valid, true);
    assert.equal(result.input_valid, true);
    assert.equal(result.satisfaction, "invalid");
    assert.ok(result.diagnostics.some(
      ({ code }) => code === "reference_role_binding_identity_kind_mismatch"
    ));
  }
});

test("control and profile evaluation are deterministic and declaration-order invariant",
  async () => {
    const first = await runProofPackAdequacyControls({
      profile: RESULT_SHAPE_CONFORMANCE_V1_PROFILE
    });
    const second = await runProofPackAdequacyControls({
      profile: RESULT_SHAPE_CONFORMANCE_V1_PROFILE
    });
    assert.deepEqual(second, first);

    const fixture = buildResultShapeConformanceFixture({
      profile: RESULT_SHAPE_CONFORMANCE_V1_PROFILE
    });
    const before = canonicalDigest(fixture);
    const canonical = evaluateVerificationProfileV034({
      contract: fixture.contract,
      profile: fixture.profile,
      evaluation_input: fixture.input
    });
    assert.equal(canonical.satisfaction, "satisfied");
    assert.equal(canonicalDigest(fixture), before);

    const reordered = structuredClone(fixture);
    for (const key of ["references", "propositions", "claims", "relations"]) {
      reordered.contract[key].reverse();
    }
    for (const key of [
      "reference_bindings",
      "number_bindings",
      "claim_pattern_bindings",
      "resolver_facts",
      "delivered_evidence"
    ]) reordered.input[key].reverse();
    const reorderedResult = evaluateVerificationProfileV034({
      contract: reordered.contract,
      profile: reordered.profile,
      evaluation_input: reordered.input
    });
    assert.equal(reorderedResult.satisfaction, "satisfied");
  });

test("adequacy executable closure is repository-relative and fully declared",
  async () => {
    const adequacy = await readJson("adequacy.json");
    const declaredPaths = [
      adequacy.executable_module,
      ...adequacy.executable_dependency_digests.map(({ path: dependencyPath }) =>
        dependencyPath
      )
    ];
    for (const requiredPath of [
      "packages/controlled-contract/test/proof-packs/result-shape-conformance-v1-adequacy.mjs",
      "packages/controlled-contract/test/proof-packs/result-shape-conformance-v1-fixture.mjs",
      "packages/controlled-contract/test/proof-packs/result-shape-conformance-v1-harness.mjs"
    ]) assert.ok(declaredPaths.includes(requiredPath));
    assert.deepEqual(
      adequacy.executable_dependency_digests.map(({ path: dependencyPath }) =>
        dependencyPath
      ),
      adequacy.executable_dependency_digests.map(({ path: dependencyPath }) =>
        dependencyPath
      ).sort()
    );
    for (const { path: declaredPath, sha256 } of
      adequacy.executable_dependency_digests) {
      assert.match(sha256, /^[a-f0-9]{64}$/u);
      const source = await readFile(path.join(repositoryRoot, declaredPath), "utf8");
      assert.doesNotMatch(source, /(?:\/home\/|\/tmp\/)/u);
    }
  });
