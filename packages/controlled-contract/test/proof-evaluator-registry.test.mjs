import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadExactAdmittedProofPack } from "../lib/admitted-proof-packs.mjs";
import {
  ProofEvaluatorRegistryError,
  resolveExactProofEvaluator
} from "../lib/proof-evaluator-registry.mjs";

test("resolves only the exact profile version and stage", async () => {
  const pack = await loadExactAdmittedProofPack({
    profileId: "proof.verification.test-validity",
    profileVersion: "3.0.0",
    evaluationStage: "post_delivery"
  });
  const resolved = await resolveExactProofEvaluator({
    proofPack: pack,
    evaluationStage: "post_delivery",
    expectedImplementationId:
      "proof.verification.test-validity.post-delivery-evaluator",
    expectedImplementationDigest:
      "sha256:c7920b44a165d830e8853c3e37be7a4ad7d76db64102d1e431e51c630403d606"
  });
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.implementation_version, "3.0.0");

  const correctedPack = await loadExactAdmittedProofPack({
    profileId: "proof.verification.test-validity",
    profileVersion: "4.0.0",
    evaluationStage: "post_delivery"
  });
  const corrected = await resolveExactProofEvaluator({
    proofPack: correctedPack,
    evaluationStage: "post_delivery",
    expectedImplementationDigest:
      "sha256:a752973888681a204273f4d3537bfe38100371d74aa3d149ded946fb56ce483f"
  });
  assert.equal(corrected.status, "resolved");
  assert.equal(corrected.implementation_version, "4.0.0");

  const unavailable = await resolveExactProofEvaluator({
    proofPack: { profile: {
      profile_id: "proof.verification.test-validity",
      profile_version: "9.9.9"
    } },
    evaluationStage: "post_delivery"
  });
  assert.equal(unavailable.status, "not_executable");
  assert.equal(unavailable.reason_code, "verify_proof.exact_evaluator_unavailable.v1");
});

test("refuses bound evaluator identity or digest substitution", async () => {
  const pack = await loadExactAdmittedProofPack({
    profileId: "proof.verification.test-validity",
    profileVersion: "3.0.0",
    evaluationStage: "post_delivery"
  });
  await assert.rejects(resolveExactProofEvaluator({
    proofPack: pack,
    evaluationStage: "post_delivery",
    expectedImplementationId: "proof.verification.test-validity.latest"
  }), (error) => error instanceof ProofEvaluatorRegistryError &&
    error.code === "verify_proof.evaluator_identity_mismatch.v1");
  await assert.rejects(resolveExactProofEvaluator({
    proofPack: pack,
    evaluationStage: "post_delivery",
    expectedImplementationDigest: `sha256:${"0".repeat(64)}`
  }), (error) => error.code === "verify_proof.evaluator_digest_mismatch.v1");
});

test("refuses evaluator bytes that no longer reproduce the registry identity", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "wk2458-evaluator-"));
  const registrySource = await readFile(new URL(
    "../lib/proof-evaluator-registry.mjs", import.meta.url), "utf8");
  const evaluatorSource = await readFile(new URL(
    "../profiles/proof.verification.test-validity/3.0.0/evaluator.mjs",
    import.meta.url), "utf8");
  await writeFile(path.join(temporary, "evaluator.mjs"),
    `${evaluatorSource}\n// substituted\n`);
  await writeFile(path.join(temporary, "registry.mjs"), registrySource.replace(
    '"../profiles/proof.verification.test-validity/3.0.0/evaluator.mjs", import.meta.url',
    '"./evaluator.mjs", import.meta.url'
  ));
  const copied = await import(new URL(`file://${path.join(temporary, "registry.mjs")}`));
  await assert.rejects(copied.resolveExactProofEvaluator({
    proofPack: { profile: {
      profile_id: "proof.verification.test-validity",
      profile_version: "3.0.0"
    } },
    evaluationStage: "post_delivery"
  }), (error) => error.code === "verify_proof.evaluator_digest_mismatch.v1");
});
