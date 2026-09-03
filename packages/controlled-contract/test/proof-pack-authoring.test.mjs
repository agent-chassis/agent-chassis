import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

import { canonicalJson } from "../lib/contract-assessment.mjs";
import { readProofPackCatalog } from "../lib/admitted-proof-packs.mjs";
import {
  MAX_AUTHORING_PROJECTION_BYTES,
  ProofIntentSelectionError,
  describeProofPackAuthoring,
  selectProofPacks,
  validateProofPackAuthoringProjection
} from "../lib/proof-intent-selection.mjs";
import { buildRefusalBeforeEffectsFixture } from
  "./proof-packs/refusal-before-effects-fixture.mjs";
import { buildStableTestProofPopulation } from
  "./support/stable-v1-proof-pack-runtime.mjs";

const packageRoot = path.resolve(import.meta.dirname, "..");
const cli = path.join(packageRoot, "bin", "describe-proof-pack.mjs");
const refusalIntent = "controlled-proof-intent.refusal-before-effects";
const refusalPack = {
  profileId: "proof.authorization.refusal-before-effects",
  profileVersion: "2.0.0",
  requestedIntents: [refusalIntent]
};

test("every admitted pack has one bounded typed authoring projection", async () => {
  const catalog = await readProofPackCatalog();
  let largest = { bytes: 0, identity: null };
  for (const pack of catalog.packs) {
    const projection = describeProofPackAuthoring({
      profileId: pack.profile_id,
      profileVersion: pack.profile_version
    });
    const bytes = Buffer.byteLength(canonicalJson(projection), "utf8");
    if (bytes > largest.bytes) largest = {
      bytes,
      identity: `${pack.profile_id}@${pack.profile_version}`
    };
    assert.equal(validateProofPackAuthoringProjection(projection), true,
      `${pack.profile_id}@${pack.profile_version}`);
    assert(bytes <= MAX_AUTHORING_PROJECTION_BYTES,
      `${pack.profile_id}@${pack.profile_version}: ${bytes}`);
    assert.equal(projection.counts.reference_roles,
      projection.evaluation_input_skeleton.reference_bindings.length);
    assert.equal(projection.counts.number_roles,
      projection.evaluation_input_skeleton.number_bindings.length);
    assert.equal(projection.counts.binding_constraint_patterns,
      projection.role_constraints.binding_constraint_patterns.length);
    assert.equal(projection.counts.claim_patterns,
      projection.proof_obligations.claim_patterns.length);
    assert.equal(projection.counts.falsifier_occurrence_bindings,
      projection.proof_obligations.falsifier_occurrence_bindings.length);
    const serialized = JSON.stringify(projection);
    assert.doesNotMatch(serialized,
      /negative-fixtures|coverage_witness|adequacy\.json|executable_module/u);
    assert.equal(serialized.includes(`${packageRoot}/`), false);
  }
  assert.equal(catalog.packs.length, 38);
  assert(largest.bytes > 0);
});

test("the projection supplies the selected pack's authoring-critical meaning", () => {
  const projection = describeProofPackAuthoring(refusalPack);
  assert.deepEqual(projection.requested_intents, [refusalIntent]);
  assert.equal(projection.intent_definitions[0].intent_id, refusalIntent);
  assert(projection.intent_distinctions.some(
    ({ from_intent_id: id }) =>
      id === "controlled-proof-intent.failed-attempt-nonconsumption"
  ));
  assert(projection.explicit_exclusions.length > 0);
  assert(projection.evaluation_input_skeleton.reference_bindings.some(
    ({ role }) => role === "protected_effects"
  ));
  assert(projection.proof_obligations.claim_patterns.some((pattern) =>
    pattern.proposition.includes("reference:writes")
  ));
  assert(projection.proof_obligations.claim_patterns.some((pattern) =>
    pattern.falsifying_proposition?.includes("reference:writes")
  ));
  assert(projection.proof_obligations.collection_patterns.length > 0);
  assert.equal(projection.proof_obligations.verification_falsifier_policy,
    "controlled_complement_per_target");
  assert.equal(Object.isFrozen(projection), true);
  assert.throws(() => projection.explicit_exclusions.push("forged"), TypeError);
});

test("selector summaries bind to the exact full authoring projection", () => {
  const value = buildRefusalBeforeEffectsFixture();
  value.contract.test_proofs = buildStableTestProofPopulation(value.contract);
  const contract = value.contract;
  const selection = selectProofPacks({
    contract,
    requestedIntents: [refusalIntent]
  });
  const candidate = selection.candidates[0];
  const projection = describeProofPackAuthoring(refusalPack);
  assert.deepEqual(candidate.intent_definitions, projection.intent_definitions);
  assert.deepEqual(candidate.intent_distinctions, projection.intent_distinctions);
  assert.deepEqual(candidate.explicit_exclusions, projection.explicit_exclusions);
  assert.equal(candidate.authoring_projection.projection_digest,
    projection.projection_digest);
  assert.deepEqual(candidate.authoring_projection.counts, projection.counts);
  assert.equal(candidate.authoring_projection.maximum_bytes,
    MAX_AUTHORING_PROJECTION_BYTES);
});

test("exact identity and intent mismatches fail closed", () => {
  assert.throws(() => describeProofPackAuthoring({
    ...refusalPack,
    profileVersion: "9.9.9"
  }), (error) => error instanceof ProofIntentSelectionError &&
    error.code === "proof_pack_authoring_identity_unknown");
  assert.throws(() => describeProofPackAuthoring({
    ...refusalPack,
    requestedIntents: ["controlled-proof-intent.lossless-projection"]
  }), (error) => error.code === "proof_pack_authoring_intent_mismatch");
});

test("the CLI returns the same bounded projection and accepts no path input", () => {
  const args = [
    cli,
    "--profile-id", refusalPack.profileId,
    "--profile-version", refusalPack.profileVersion,
    "--intent", refusalIntent
  ];
  const output = execFileSync(process.execPath, args, { encoding: "utf8" });
  assert.deepEqual(JSON.parse(output), describeProofPackAuthoring(refusalPack));
  assert(Buffer.byteLength(output, "utf8") <= MAX_AUTHORING_PROJECTION_BYTES);
  const rejected = spawnSync(process.execPath, [
    cli,
    "--profile-id", refusalPack.profileId,
    "--profile-version", refusalPack.profileVersion,
    "--profile-path", "/tmp/forged/profile.json"
  ], { encoding: "utf8" });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /unknown argument/u);
});

test("authoring projection is byte-deterministic and isolated by intent", () => {
  const first = describeProofPackAuthoring(refusalPack);
  const second = describeProofPackAuthoring({
    requestedIntents: [...refusalPack.requestedIntents].reverse(),
    profileVersion: refusalPack.profileVersion,
    profileId: refusalPack.profileId
  });
  assert.equal(canonicalJson(first), canonicalJson(second));
  const broad = describeProofPackAuthoring({
    profileId: refusalPack.profileId,
    profileVersion: refusalPack.profileVersion
  });
  assert(broad.requested_intents.includes(
    "controlled-proof-intent.protected-effect-nonmutation"
  ));
  assert.notEqual(broad.projection_digest, first.projection_digest);
});
