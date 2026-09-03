import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const PROOF_EVALUATOR_REGISTRY_ID = "controlled-contract-proof-evaluator-registry";
const PROOF_EVALUATOR_REGISTRY_VERSION = "1.0.0";
const entries = Object.freeze({
  "proof.verification.test-validity\u00002.0.0\u0000pre_dispatch": Object.freeze({
    module_url: new URL(
      "../profiles/proof.verification.test-validity/2.0.0/evaluator.mjs", import.meta.url
    ),
    export_name: "evaluateTestValidity",
    implementation_id: "proof.verification.test-validity.pre-dispatch-evaluator",
    implementation_version: "2.0.0",
    implementation_digest:
      "sha256:a3f43fc9bd60b2ed0a2e3faef4a6f007149f8919a7d69b485c3c8eb4581a70ac"
  }),
  "proof.verification.test-validity\u00003.0.0\u0000post_delivery": Object.freeze({
    module_url: new URL(
      "../profiles/proof.verification.test-validity/3.0.0/evaluator.mjs", import.meta.url
    ),
    export_name: "evaluatePostDeliveryTestValidity",
    implementation_id: "proof.verification.test-validity.post-delivery-evaluator",
    implementation_version: "3.0.0",
    implementation_digest:
      "sha256:c7920b44a165d830e8853c3e37be7a4ad7d76db64102d1e431e51c630403d606"
  }),
  "proof.verification.test-validity\u00004.0.0\u0000post_delivery": Object.freeze({
    module_url: new URL(
      "../profiles/proof.verification.test-validity/4.0.0/evaluator.mjs", import.meta.url
    ),
    export_name: "evaluatePostDeliveryTestValidity",
    implementation_id: "proof.verification.test-validity.post-delivery-evaluator",
    implementation_version: "4.0.0",
    implementation_digest:
      "sha256:a752973888681a204273f4d3537bfe38100371d74aa3d149ded946fb56ce483f"
  })
});

class ProofEvaluatorRegistryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProofEvaluatorRegistryError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

function registryKey(profileId, profileVersion, evaluationStage) {
  return `${profileId}\u0000${profileVersion}\u0000${evaluationStage}`;
}

async function resolveExactProofEvaluator({
  proofPack,
  evaluationStage,
  expectedImplementationDigest = null,
  expectedImplementationId = null
}) {
  const profileId = proofPack?.profile?.profile_id;
  const profileVersion = proofPack?.profile?.profile_version;
  const entry = entries[registryKey(profileId, profileVersion, evaluationStage)];
  if (entry === undefined) return Object.freeze({
    status: "not_executable",
    reason_code: "verify_proof.exact_evaluator_unavailable.v1",
    profile_id: profileId ?? null,
    profile_version: profileVersion ?? null,
    evaluation_stage: evaluationStage
  });
  if (expectedImplementationId !== null &&
      expectedImplementationId !== entry.implementation_id) {
    throw new ProofEvaluatorRegistryError(
      "verify_proof.evaluator_identity_mismatch.v1",
      "resolved evaluator identity differs from the bound identity",
      { expected: expectedImplementationId, actual: entry.implementation_id }
    );
  }
  if (expectedImplementationDigest !== null &&
      expectedImplementationDigest !== entry.implementation_digest) {
    throw new ProofEvaluatorRegistryError(
      "verify_proof.evaluator_digest_mismatch.v1",
      "registry evaluator digest differs from the bound digest",
      { expected: expectedImplementationDigest, actual: entry.implementation_digest }
    );
  }
  const bytes = await readFile(entry.module_url);
  const actualDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (actualDigest !== entry.implementation_digest) throw new ProofEvaluatorRegistryError(
    "verify_proof.evaluator_digest_mismatch.v1",
    "resolved evaluator bytes do not reproduce the registry digest",
    { expected: entry.implementation_digest, actual: actualDigest }
  );
  const module = await import(entry.module_url.href);
  const evaluate = module[entry.export_name];
  if (typeof evaluate !== "function") throw new ProofEvaluatorRegistryError(
    "verify_proof.evaluator_export_mismatch.v1",
    "resolved evaluator module does not export the exact registered implementation",
    { export_name: entry.export_name }
  );
  return Object.freeze({
    status: "resolved",
    registry_id: PROOF_EVALUATOR_REGISTRY_ID,
    registry_version: PROOF_EVALUATOR_REGISTRY_VERSION,
    profile_id: profileId,
    profile_version: profileVersion,
    evaluation_stage: evaluationStage,
    implementation_id: entry.implementation_id,
    implementation_version: entry.implementation_version,
    implementation_digest: entry.implementation_digest,
    evaluate
  });
}

export {
  PROOF_EVALUATOR_REGISTRY_ID,
  PROOF_EVALUATOR_REGISTRY_VERSION,
  ProofEvaluatorRegistryError,
  resolveExactProofEvaluator
};
