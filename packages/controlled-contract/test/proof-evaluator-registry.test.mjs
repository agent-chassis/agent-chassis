import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

async function loadRegistry() {
  return import("../lib/proof-evaluator-registry.mjs");
}

async function loadExecutionPack() {
  const { loadExactAdmittedProofPack } = await import("../lib/admitted-proof-packs.mjs");
  return loadExactAdmittedProofPack({
    profileId: "proof.verification.test-validity",
    profileVersion: "8.0.0"
  });
}

test("resolves only the exact profile ID and version", async () => {
  const [{ exactProofEvaluatorDescriptors, exactProofEvaluatorIdentities,
    resolveExactProofEvaluator }, executionPack] = await Promise.all([
    loadRegistry(), loadExecutionPack()
  ]);
  const descriptors = exactProofEvaluatorDescriptors();
  assert.ok(descriptors.length > 0);
  assert.deepEqual(descriptors.map(({ profile_id, profile_version }) => ({
    profile_id, profile_version
  })), exactProofEvaluatorIdentities());
  for (const descriptor of descriptors) {
    assert.match(descriptor.module_path, /^profiles\/.+\/evaluator\.mjs$/u);
    assert.match(descriptor.implementation_digest, /^sha256:[a-f0-9]{64}$/u);
    assert.ok(descriptor.export_name.length > 0);
  }
  const execution = await resolveExactProofEvaluator({
    proofPack: executionPack,

    expectedImplementationId:
      "proof.verification.test-validity.execution-evaluator",
    expectedImplementationDigest:
      "sha256:8aff870dc00038e340e6e9bf889eb2c8f74b2f8b1fd70024fd54994b90cee90f"
  });
  assert.equal(execution.status, "resolved");
  assert.equal(execution.implementation_version, "8.0.0");

  const unavailable = await resolveExactProofEvaluator({
    proofPack: { profile: {
      profile_id: "proof.verification.test-validity",
      profile_version: "9.9.9"
    } },

  });
  assert.equal(unavailable.status, "not_executable");
  assert.equal(unavailable.reason_code, "verify_proof.exact_evaluator_unavailable.v1");
});

test("refuses bound evaluator identity or digest substitution", async () => {
  const [{ ProofEvaluatorRegistryError, resolveExactProofEvaluator }, pack] =
    await Promise.all([loadRegistry(), loadExecutionPack()]);
  await assert.rejects(resolveExactProofEvaluator({
    proofPack: pack,

    expectedImplementationId: "proof.verification.test-validity.latest"
  }), (error) => error instanceof ProofEvaluatorRegistryError &&
    error.code === "verify_proof.evaluator_identity_mismatch.v1");
  await assert.rejects(resolveExactProofEvaluator({
    proofPack: pack,

    expectedImplementationDigest: `sha256:${"0".repeat(64)}`
  }), (error) => error.code === "verify_proof.evaluator_digest_mismatch.v1");
});

async function copiedRegistry({ evaluatorSource, registryTransform = (source) => source,
  writeEvaluator = true }) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "wk2568-evaluator-"));
  const registrySource = await readFile(new URL(
    "../lib/proof-evaluator-registry.mjs", import.meta.url), "utf8");
  const evaluatorPath = path.join(temporary,
    "profiles/proof.verification.test-validity/8.0.0/evaluator.mjs");
  await mkdir(path.dirname(evaluatorPath), { recursive: true });
  await mkdir(path.join(temporary, "lib"));
  if (writeEvaluator) await writeFile(evaluatorPath, evaluatorSource);
  const registryPath = path.join(temporary, "lib/proof-evaluator-registry.mjs");
  await writeFile(registryPath, registryTransform(registrySource));
  const registryUrl = pathToFileURL(registryPath);
  registryUrl.searchParams.set("case", `${Date.now()}-${Math.random()}`);
  return { registry: await import(registryUrl), temporary };
}

const proofPack = { profile: {
  profile_id: "proof.verification.test-validity",
  profile_version: "8.0.0"
} };

test("exact evaluator resolution rejects comment-only and semantic byte drift", async (t) => {
  const { resolveExactProofEvaluator } = await loadRegistry();
  const evaluatorSource = await readFile(new URL(
    "../profiles/proof.verification.test-validity/8.0.0/evaluator.mjs",
    import.meta.url), "utf8");

  const loadCopied = async (options) => {
    const copied = await copiedRegistry(options);
    t.after(() => rm(copied.temporary, { recursive: true, force: true }));
    return copied.registry;
  };
  const commentMutation = await loadCopied({
    evaluatorSource: `${evaluatorSource}\n// comment-only byte drift\n`
  });
  await assert.rejects(commentMutation.resolveExactProofEvaluator({ proofPack }),
    { code: "verify_proof.evaluator_digest_mismatch.v1" });

  const semanticMutation = await loadCopied({
    evaluatorSource: evaluatorSource.replace(
      'satisfaction: diagnostics.length === 0 ? "satisfied" : "unsatisfied"',
      'satisfaction: "satisfied"'
    )
  });
  await assert.rejects(semanticMutation.resolveExactProofEvaluator({ proofPack }),
    { code: "verify_proof.evaluator_digest_mismatch.v1" });

  const missing = await loadCopied({ evaluatorSource, writeEvaluator: false });
  await assert.rejects(missing.resolveExactProofEvaluator({ proofPack }),
    { code: "ENOENT" });

  const missingExport = await loadCopied({
    evaluatorSource,
    registryTransform: (source) => source.replace(
      'export_name: "evaluateExecutionTestValidity"',
      'export_name: "missingEvaluatorExport"'
    )
  });
  await assert.rejects(missingExport.resolveExactProofEvaluator({ proofPack }),
    { code: "verify_proof.evaluator_export_mismatch.v1" });

  await assert.rejects(resolveExactProofEvaluator({
    proofPack,
    expectedImplementationDigest: `sha256:${"0".repeat(64)}`
  }), { code: "verify_proof.evaluator_digest_mismatch.v1" });
});

test("registry requests cannot carry an obsolete proof classification", async () => {
  const { resolveExactProofEvaluator } = await loadRegistry();
  await assert.rejects(resolveExactProofEvaluator({
    proofPack: { profile: { profile_id: "proof.verification.test-validity",
      profile_version: "5.0.0" } }, evaluationStage: "pre_dispatch"
  }), { code: "verify_proof.evaluator_identity_invalid.v1" });
});
