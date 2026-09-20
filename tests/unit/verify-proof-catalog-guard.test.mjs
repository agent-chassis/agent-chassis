import assert from "node:assert/strict";
import test from "node:test";

import { loadExactAdmittedProofPack } from
  "../../packages/controlled-contract/lib/admitted-proof-packs.mjs";
import { resolveExactProofEvaluator } from
  "../../packages/controlled-contract/lib/proof-evaluator-registry.mjs";

test("current test-validity definitions resolve only by exact identity", async () => {
  for (const profileVersion of ["2.0.0", "4.0.0", "6.0.0", "7.0.0", "8.0.0", "9.0.0"]) {
    await assert.rejects(loadExactAdmittedProofPack({
      profileId: "proof.verification.test-validity", profileVersion
    }), { code: "proof_pack_exact_version_not_current" });
  }
  const pack = await loadExactAdmittedProofPack({
    profileId: "proof.verification.test-validity", profileVersion: "10.0.0"
  });
  assert.equal(pack.profile.profile_version, "10.0.0");
  assert.deepEqual({
    status: pack.test_validity_evaluator.status,
    profile_id: pack.test_validity_evaluator.profile_id,
    profile_version: pack.test_validity_evaluator.profile_version,
    implementation_id: pack.test_validity_evaluator.implementation_id,
    implementation_version: pack.test_validity_evaluator.implementation_version
  }, {
    status: "resolved",
    profile_id: "proof.verification.test-validity",
    profile_version: "10.0.0",
    implementation_id: "proof.verification.test-validity.execution-evaluator",
    implementation_version: "8.0.0"
  });
  const absent = await resolveExactProofEvaluator({
    proofPack: { profile: { profile_id: "proof.verification.test-validity",
      profile_version: "999.0.0" } }
  });
  assert.equal(absent.status, "not_executable");
  assert.equal(Object.hasOwn(absent, "fallback"), false);
});
