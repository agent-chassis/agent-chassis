import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  canonicalDigest,
  guaranteeDigest,
  profileDigest
} from "../support/proof-pack-adequacy.mjs";
import { canonicalJsonBytes } from "../../lib/exact-binding-common.mjs";
import { loadAdmittedProofPack } from "../../lib/admitted-proof-packs.mjs";
import {
  buildCrossRepresentationParityFixture
} from "./behavioral-preservation-v1-adequacy.mjs";
import {
  validateProfileSchemaV1,
  validateProfileSemanticsV1
} from "../support/stable-v1-proof-pack-runtime.mjs";
import { buildProofPlanFixture } from "../proof-plan-fixture.mjs";
import { readDefinitionDocument } from "../support/certification-artifact.mjs";

const packageRoot = path.resolve(import.meta.dirname, "../..");
const repositoryRoot = path.resolve(packageRoot, "../..");
const profileId = "proof.compatibility.behavioral-preservation";
import { spawnManagedTestProcess } from "../../../../tests/helpers/managed-test-process.mjs";
import { createTestResourceScope } from "../../../../tests/helpers/test-resource-scope.mjs";
const identity = { profile_id: profileId, profile_version: "4.0.0" };
const retainedAdequacy = await readDefinitionDocument(identity, "adequacy.json");
const runtimeDirectory = path.join(packageRoot, "profiles", profileId, "4.0.0");
const cli = path.join(packageRoot, "bin/assess-contract.mjs");
const readJson = async (directory, name) => JSON.parse(await readFile(
  path.join(directory, name), "utf8"
));

async function runCli(args, scope) {
  const child = await scope.acquire("assessment-cli", () => spawnManagedTestProcess({
    command: process.execPath, args: [cli, ...args], spawnOptions: { cwd: repositoryRoot }
  }, { label: "behavioral-preservation-assessment", stdoutTailBytes: 1024 * 1024 }),
  process => process.dispose());
  const timer = setTimeout(() => { void child.stop(); }, 30_000);
  try {
    const result = await child.waitForExit();
    if (result.error) throw result.error;
    assert.equal(result.signal, null, "CLI must complete before the timeout");
    return { code: result.code, signal: result.signal,
      stdout: result.stdoutTail, stderr: result.stderrTail };
  } finally { clearTimeout(timer); }
}

async function declarationFixture(t, { swapEvaluationRoles = false } = {}) {
  const scope = createTestResourceScope({ label: "behavioral-preservation-cli" });
  t.after(() => scope.dispose());
  const root = await scope.acquire("inputs",
    () => mkdtemp(path.join(os.tmpdir(), "behavioral-preservation-")),
    directory => rm(directory, { recursive: true, force: true }));
  const profile = await readJson(runtimeDirectory, "profile.json");
  const fixture = buildCrossRepresentationParityFixture({
    profile,
    domain: "http-api-regression",
    leftMembers: ["ref-member-status-number", "ref-member-body-object"],
    rightMembers: ["ref-member-status-number", "ref-member-body-object"]
  });
  if (swapEvaluationRoles) {
    const byRole = new Map(fixture.input.reference_bindings.map(
      (binding) => [binding.role, binding]
    ));
    const left = byRole.get("left_result").reference_ids;
    byRole.get("left_result").reference_ids = byRole.get("right_result").reference_ids;
    byRole.get("right_result").reference_ids = left;
  }
  await Promise.all([
    writeFile(path.join(root, "contract.json"), canonicalJsonBytes(fixture.contract)),
    writeFile(path.join(root, "evaluation.json"), canonicalJsonBytes(fixture.input))
  ]);
  return { root, fixture, scope };
}

async function runAssessment(subject) {
  const proofPlanPath = path.join(subject.root, "proof-plan.json");
  const proofPlan = await buildProofPlanFixture({
    contractPath: path.join(subject.root, "contract.json"),
    packs: [{
      profileId,
      requestedIntents: ["controlled-proof-intent.behavioral-preservation"],
      evaluationInputPath: path.join(subject.root, "evaluation.json")
    }]
  });
  await writeFile(proofPlanPath, canonicalJsonBytes(proofPlan));
  return runCli([
    "--input", path.join(subject.root, "contract.json"),
    "--proof-plan", proofPlanPath
  ], subject.scope);
}

test("behavioral-preservation profile, adequacy, and admission form one bound release", async () => {
  const [profile, adequacy, admission] = await Promise.all([
    readJson(runtimeDirectory, "profile.json"),
    readDefinitionDocument(identity, "adequacy.json"),
    readJson(runtimeDirectory, "admission.json")
  ]);
  assert.equal(validateProfileSchemaV1(profile), true,
    JSON.stringify(validateProfileSchemaV1.errors));
  assert.deepEqual(validateProfileSemanticsV1(profile), []);
  assert.equal(profileDigest(profile), adequacy.profile_digest);
  assert.equal(admission.profile_digest, adequacy.profile_digest);
  assert.equal(guaranteeDigest(admission.guarantee), admission.guarantee_digest);
  assert.equal(Object.hasOwn(admission, "exact_binding"), false);
  const loaded = await loadAdmittedProofPack(profileId);
  assert.equal(loaded.admission_version, 3);
  assert.equal(loaded.profile_digest, adequacy.profile_digest);
});

test("retained certification does not supply the missing capture binding", async () => {
  const pack = await loadAdmittedProofPack(profileId);
  assert.equal(pack.admission.certification.executable_control_count, 51);
  assert.equal(retainedAdequacy.negative_contract_fixtures.length, 87);
  assert.match(pack.admission.guarantee, /complete captured bytes have the same SHA-256/u);
});

test("the CLI retains the broad guarantee as unsupported for a well-formed declaration plan", async (t) => {
  const subject = await declarationFixture(t);
  const result = await runAssessment(subject);
  assert.equal(result.code, 2, result.stderr);
  const compact = JSON.parse(result.stdout);
  assert.equal(compact.structure, "proven");
  assert.equal(compact.profile_discrimination, "not_proven");
  assert.equal(compact.assessment_scope, "planning");
  assert.equal(Object.hasOwn(compact, "exact_binding"), false);
  assert.match(compact.overall_code, /^structure_proven__profile_not_proven$/u);
});

test("a substituted evaluation binding cannot borrow a passing profile evaluation", async (t) => {
  const subject = await declarationFixture(t, { swapEvaluationRoles: true });
  const result = await runAssessment(subject);
  assert.equal(result.code, 2, result.stderr);
  const compact = JSON.parse(result.stdout);
  assert.equal(compact.profile_discrimination, "not_proven");
});

test("admission digest is stable under an independent recomputation", async () => {
  const admission = await readJson(runtimeDirectory, "admission.json");
  const first = canonicalDigest(admission);
  const reordered = Object.fromEntries(Object.entries(admission).reverse());
  assert.equal(canonicalDigest(reordered), first);
});
