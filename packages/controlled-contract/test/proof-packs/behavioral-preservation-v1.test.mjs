import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  canonicalDigest,
  guaranteeDigest,
  profileDigest,
  runProofPackAdequacy
} from "../support/proof-pack-adequacy.mjs";
import { canonicalJsonBytes } from "../../lib/exact-binding-common.mjs";
import { loadAdmittedProofPack } from "../../lib/admitted-proof-packs.mjs";
import {
  buildCrossRepresentationParityFixture,
  runProofPackAdequacyControls
} from "./behavioral-preservation-v1-adequacy.mjs";
import {
  validateProfileSchemaV1,
  validateProfileSemanticsV1
} from "../support/stable-v1-proof-pack-runtime.mjs";
import { buildProofPlanFixture } from "../proof-plan-fixture.mjs";
import { certificationDirectory, readDefinitionDocument } from "../support/certification-artifact.mjs";

const packageRoot = path.resolve(import.meta.dirname, "../..");
const repositoryRoot = path.resolve(packageRoot, "../..");
const profileId = "proof.compatibility.behavioral-preservation";
const execFileAsync = promisify(execFile);
const identity = { profile_id: profileId, profile_version: "4.0.0" };
const packDirectory = certificationDirectory(identity);
const runtimeDirectory = path.join(packageRoot, "profiles", profileId, "4.0.0");
const cli = path.join(packageRoot, "bin/assess-contract.mjs");
const readJson = async (directory, name) => JSON.parse(await readFile(
  path.join(directory, name), "utf8"
));

async function runCli(args) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [cli, ...args], {
      cwd: repositoryRoot, timeout: 30_000, maxBuffer: 1024 * 1024
    });
    return { code: 0, signal: null, stdout, stderr };
  } catch (error) {
    if (error.killed || !Number.isInteger(error.code)) throw error;
    return { code: error.code, signal: error.signal ?? null,
      stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

async function exactFixture(t, { candidateBytes = null, omit = null,
  swapEvaluationRoles = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "behavioral-preservation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
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
  const baseline = canonicalJsonBytes({ status: 200, body: { id: "p-1", total: 42 } });
  const candidate = candidateBytes ?? baseline;
  const sources = {
    "baseline-behavior-report": {
      kind: "artifact_file", relative_path: "baseline-report.json"
    },
    "candidate-behavior-report": {
      kind: "artifact_file", relative_path: "candidate-report.json"
    }
  };
  if (omit) delete sources[omit];
  await Promise.all([
    writeFile(path.join(root, "contract.json"), canonicalJsonBytes(fixture.contract)),
    writeFile(path.join(root, "evaluation.json"), canonicalJsonBytes(fixture.input)),
    writeFile(path.join(root, "baseline-report.json"), baseline),
    writeFile(path.join(root, "candidate-report.json"), candidate),
    writeFile(path.join(root, "sources.json"), canonicalJsonBytes(sources))
  ]);
  return { root, fixture, sources };
}

async function runExact(subject) {
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
  ]);
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

test("ordinary adequacy and the fixed negative/rebound corpus pass in full-census mode", async () => {
  const result = await runProofPackAdequacy(packDirectory, {
    repositoryRoot, variationMode: "full_census"
  });
  assert.equal(result.passed, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.control_count, 41);
  assert.equal(result.negative_fixture_count, 87);
  assert.equal(result.coverage_witness_count, 87);
  assert.equal(result.negative_fixture_results.every(
    ({ outcome }) => outcome === "rejected"
  ), true);
  assert.equal(result.coverage_witness_results.every(
    ({ outcome }) => outcome === "survived"
  ), true);
});

test("ordinary plan controls admit breadth and reject every inadequate plan", async () => {
  const profile = await readJson(runtimeDirectory, "profile.json");
  const run = await runProofPackAdequacyControls({
    profile, profile_digest: profileDigest(profile)
  });
  const positives = run.controls.filter(({ category }) => category === "positive");
  const mutants = run.controls.filter(({ category }) => category === "mutant");
  const rejections = run.controls.filter(
    ({ category }) => category === "profile_rejection"
  );
  assert.equal(positives.length, 3);
  assert.equal(mutants.length, 11);
  assert.equal(rejections.length, 14);
  assert.equal(positives.every(
    ({ implementation_outcome: implementation, profile_satisfaction: satisfaction }) =>
      implementation === "passed" && satisfaction === "satisfied"
  ), true);
  assert.equal([...mutants, ...rejections].every(
    ({ profile_satisfaction: satisfaction }) => satisfaction !== "satisfied"
  ), true);
});

test("the CLI proves profile discrimination for a well-formed plan", async (t) => {
  const subject = await exactFixture(t);
  const result = await runExact(subject);
  assert.equal(result.code, 0, result.stderr);
  const compact = JSON.parse(result.stdout);
  assert.equal(compact.structure, "proven");
  assert.equal(compact.profile_discrimination, "proven");
  assert.equal(compact.assessment_scope, "planning");
  assert.equal(Object.hasOwn(compact, "exact_binding"), false);
  assert.match(compact.overall_code, /^structure_proven__profile_proven$/u);
});

test("a substituted evaluation binding cannot borrow a passing profile evaluation", async (t) => {
  const subject = await exactFixture(t, { swapEvaluationRoles: true });
  const result = await runExact(subject);
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
