import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const PROOF_EVALUATOR_REGISTRY_ID = "controlled-contract-proof-evaluator-registry";
const PROOF_EVALUATOR_REGISTRY_VERSION = "2.0.0";
const entries = Object.freeze({
  "proof.verification.test-validity\u000010.0.0": Object.freeze({
    module_path: "profiles/proof.verification.test-validity/10.0.0/evaluator.mjs",
    export_name: "evaluateExecutionTestValidity",
    implementation_id: "proof.verification.test-validity.execution-evaluator",
    implementation_version: "8.0.0",
    implementation_digest: "sha256:8aff870dc00038e340e6e9bf889eb2c8f74b2f8b1fd70024fd54994b90cee90f"
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

function registryKey(profileId, profileVersion) {
  return `${profileId}\u0000${profileVersion}`;
}

async function resolveExactProofEvaluator(request) {
  const allowed = new Set(["proofPack", "expectedImplementationDigest", "expectedImplementationId"]);
  if (request === null || typeof request !== "object" || Array.isArray(request) ||
      Object.keys(request).some((key) => !allowed.has(key))) {
    throw new ProofEvaluatorRegistryError("verify_proof.evaluator_identity_invalid.v1",
      "evaluator selection accepts only the exact pack and expected implementation identity");
  }
  const { proofPack, expectedImplementationDigest = null,
    expectedImplementationId = null } = request;
  const profileId = proofPack?.profile?.profile_id;
  const profileVersion = proofPack?.profile?.profile_version;
  const entry = entries[registryKey(profileId, profileVersion)];
  if (entry === undefined) return Object.freeze({
    status: "not_executable",
    reason_code: "verify_proof.exact_evaluator_unavailable.v1",
    profile_id: profileId ?? null,
    profile_version: profileVersion ?? null,
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
  const moduleUrl = new URL(`../${entry.module_path}`, import.meta.url);
  const bytes = await readFile(moduleUrl);
  const actualDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (actualDigest !== entry.implementation_digest) throw new ProofEvaluatorRegistryError(
    "verify_proof.evaluator_digest_mismatch.v1",
    "resolved evaluator bytes do not reproduce the registry digest",
    { expected: entry.implementation_digest, actual: actualDigest }
  );
  const module = await import(moduleUrl.href);
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
    implementation_id: entry.implementation_id,
    implementation_version: entry.implementation_version,
    implementation_digest: entry.implementation_digest,
    evaluate
  });
}

function exactProofEvaluatorIdentities() {
  return Object.freeze(exactProofEvaluatorDescriptors().map(
    ({ profile_id, profile_version }) => Object.freeze({ profile_id, profile_version })
  ));
}

function exactProofEvaluatorDescriptors() {
  return Object.freeze(Object.entries(entries).map(([key, entry]) => {
    const [profile_id, profile_version] = key.split("\u0000");
    return Object.freeze({
      profile_id,
      profile_version,
      module_path: entry.module_path,
      export_name: entry.export_name,
      implementation_id: entry.implementation_id,
      implementation_version: entry.implementation_version,
      implementation_digest: entry.implementation_digest
    });
  }));
}

export {
  exactProofEvaluatorDescriptors,
  exactProofEvaluatorIdentities,
  PROOF_EVALUATOR_REGISTRY_ID,
  PROOF_EVALUATOR_REGISTRY_VERSION,
  ProofEvaluatorRegistryError,
  resolveExactProofEvaluator
};
