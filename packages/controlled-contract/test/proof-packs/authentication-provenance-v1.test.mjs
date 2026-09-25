import assert from "node:assert/strict";

import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { evaluateStableProofPackFixtureV1, profileDigest } from
  "../support/stable-v1-proof-pack-runtime.mjs";
import { runProofPackAdequacy } from "../support/proof-pack-adequacy.mjs";
import {
  buildAuthenticationProvenanceFixture,
  buildAuthenticationProvenanceSources
} from "./authentication-provenance-v1-fixture.mjs";
import {
  buildProfileWeakeningControls,
  rejectionFixtures
} from "./authentication-provenance-v1-adequacy.mjs";
import { certificationDirectory as certificationDirectoryOf, readDefinitionDocument } from "../support/certification-artifact.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const identity = { profile_id: "proof.authentication.direct-source-provenance", profile_version: "4.0.0" };
const certificationDirectory = certificationDirectoryOf(identity);
test("direct-source authentication/provenance pack passes indexed and full-census gates", async () => {
  for (const variationMode of ["indexed", "full_census"]) {
    const result = await runProofPackAdequacy(certificationDirectory, { variationMode });
    assert.equal(result.passed, true, JSON.stringify(result.diagnostics));
    assert.deepEqual(result.diagnostics, []);
    assert.equal(result.control_count, 75);
    assert.equal(result.negative_fixture_count, 1);
    assert.equal(result.coverage_witness_count, 74);
  }
});





test("profile weakenings are re-digested yet the canonical controls still reject them", () => {
  const canonical = buildAuthenticationProvenanceFixture();
  const exhaustive = buildProfileWeakeningControls(canonical.profile);
  assert.equal(exhaustive.length, 13);
  assert.ok(exhaustive.every(({ result }) => result.passed));
  assert.ok(exhaustive.every(({ result }) =>
    result.weakened_digest !== profileDigest(canonical.profile)));
  const canonicalDigestValue = profileDigest(canonical.profile);
  const cases = [
    ["authenticates", "missing-authenticates-relation",
      "evidence-authenticates-target"],
    ["origin", "missing-originates-from-relation",
      "evidence-originates-from-source"],
    ["source-record", "missing-source-of-record-relation",
      "target-has-source-of-record"],
    ["observed", "missing-observed-in-relation",
      "evidence-observed-in-attempt"]
  ];
  for (const [label, fixtureId, behaviorPatternId] of cases) {
    const fixture = rejectionFixtures[fixtureId]();
    const verificationClaimId = `claim-verify-${behaviorPatternId}`;
    const verificationClaim = fixture.contract.claims.find(
      ({ claim_id: id }) => id === verificationClaimId
    );
    const verificationPropositionIds = new Set([
      verificationClaim?.proposition_id,
      verificationClaim?.falsifying_proposition_id
    ].filter(Boolean));
    fixture.contract.claims = fixture.contract.claims.filter(
      ({ claim_id: id }) => id !== verificationClaimId
    );
    fixture.contract.propositions = fixture.contract.propositions.filter(
      ({ proposition_id: id }) => !verificationPropositionIds.has(id)
    );
    const weakened = structuredClone(fixture.profile);
    const verificationPatternId = `verify-${behaviorPatternId}`;
    const relationPatternId = `verification-targets-${behaviorPatternId}`;
    weakened.claim_patterns = weakened.claim_patterns.filter(({ pattern_id: id }) =>
      ![behaviorPatternId, verificationPatternId].includes(id));
    weakened.relation_patterns = weakened.relation_patterns.filter(
      ({ pattern_id: id }) => id !== relationPatternId);
    weakened.falsifier_condition_bindings = weakened.falsifier_condition_bindings.filter(
      ({ relation_pattern_id: id }) => id !== relationPatternId);
    const removed = new Set([behaviorPatternId, verificationPatternId, relationPatternId]);
    weakened.satisfaction_expression.all_of =
      weakened.satisfaction_expression.all_of.filter(({ pattern }) =>
        !removed.has(pattern));
    const weakenedDigest = profileDigest(weakened);
    assert.notEqual(weakenedDigest, canonicalDigestValue, label);
    assert.equal(evaluateStableProofPackFixtureV1({
      profile: weakened, contract: fixture.contract, evaluation_input: fixture.input
    }).satisfaction, "satisfied", label);
    assert.notEqual(evaluateStableProofPackFixtureV1({
      profile: canonical.profile, contract: fixture.contract, evaluation_input: fixture.input
    }).satisfaction, "satisfied", label);
  }
});

