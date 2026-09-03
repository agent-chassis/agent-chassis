import assert from "node:assert/strict";
import test from "node:test";

import { loadExactAdmittedProofPack } from
  "../../packages/controlled-contract/lib/admitted-proof-packs.mjs";
import { resolveExactProofEvaluator } from
  "../../packages/controlled-contract/lib/proof-evaluator-registry.mjs";

test("historical 3.0.0 and corrected 4.0.0 resolve only by exact identity", async () => {
  await assert.rejects(loadExactAdmittedProofPack({
    profileId: "proof.verification.test-validity",
    profileVersion: "2.0.0",
    evaluationStage: "post_delivery"
  }));
  const pack = await loadExactAdmittedProofPack({
    profileId: "proof.verification.test-validity",
    profileVersion: "3.0.0",
    evaluationStage: "post_delivery"
  });
  assert.equal(pack.profile.profile_version, "3.0.0");
  assert.equal(pack.test_validity_evaluator.status, "resolved");
  const corrected = await loadExactAdmittedProofPack({
    profileId: "proof.verification.test-validity",
    profileVersion: "4.0.0",
    evaluationStage: "post_delivery"
  });
  assert.equal(corrected.profile.profile_version, "4.0.0");
  assert.equal(corrected.test_validity_evaluator.implementation_version, "4.0.0");
  const absent = await resolveExactProofEvaluator({
    proofPack: { profile: { profile_id: "proof.verification.test-validity",
      profile_version: "5.0.0" } },
    evaluationStage: "post_delivery"
  });
  assert.equal(absent.status, "not_executable");
  assert.equal(Object.hasOwn(absent, "fallback"), false);
});
