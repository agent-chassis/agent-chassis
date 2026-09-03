import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { link, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  canonicalDigest,
  guaranteeDigest,
  profileDigest,
  runProofPackAdequacy
} from "../support/proof-pack-adequacy.mjs";
import {
  canonicalJsonBytes,
  sha256
} from "../../lib/exact-binding-common.mjs";
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

const packageRoot = path.resolve(import.meta.dirname, "../..");
const repositoryRoot = path.resolve(packageRoot, "../..");
const profileId = "proof.compatibility.behavioral-preservation";
const packDirectory = path.join(
  packageRoot, "test/certification/profiles", profileId, "2.0.0"
);
const runtimeDirectory = path.join(packageRoot, "profiles", profileId, "2.0.0");
const cli = path.join(packageRoot, "bin/assess-contract.mjs");
const readJson = async (directory, name) => JSON.parse(await readFile(
  path.join(directory, name), "utf8"
));

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: repositoryRoot,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

async function exactFixture({ candidateBytes = null, omit = null,
  swapEvaluationRoles = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "behavioral-preservation-"));
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
      evaluationInputPath: path.join(subject.root, "evaluation.json"),
      captureRoot: subject.root,
      exactBindingSources: subject.sources
    }]
  });
  await writeFile(proofPlanPath, canonicalJsonBytes(proofPlan));
  return runCli([
    "--input", path.join(subject.root, "contract.json"),
    "--proof-plan", proofPlanPath
  ]);
}

test("behavioral-preservation profile, adequacy, and v2 admission form one bound release", async () => {
  const [profile, adequacy, admission, declaration, certification, corpus] =
    await Promise.all([
      readJson(packDirectory, "profile.json"),
      readJson(packDirectory, "adequacy.json"),
      readJson(runtimeDirectory, "admission.json"),
      readJson(runtimeDirectory, "exact-binding.json"),
      readJson(runtimeDirectory, "exact-binding-certification.json"),
      readJson(packDirectory, "exact-binding-corpus.json")
    ]);
  assert.equal(validateProfileSchemaV1(profile), true,
    JSON.stringify(validateProfileSchemaV1.errors));
  assert.deepEqual(validateProfileSemanticsV1(profile), []);
  assert.equal(profileDigest(profile), adequacy.profile_digest);
  assert.equal(admission.profile_digest, adequacy.profile_digest);
  assert.equal(guaranteeDigest(admission.guarantee), admission.guarantee_digest);
  assert.equal(admission.exact_binding.declaration_digest,
    sha256(canonicalJsonBytes(declaration, { file: true })));
  assert.equal(admission.exact_binding.certification_result_digest,
    sha256(canonicalJsonBytes(certification, { file: true })));
  assert.equal(certification.corpus.corpus_digest,
    sha256(canonicalJsonBytes(corpus, { file: true })));
  assert.equal(certification.result.passed_control_ids.length, 12);
  const loaded = await loadAdmittedProofPack(profileId);
  assert.equal(loaded.admission_version, 2);
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
  const profile = await readJson(packDirectory, "profile.json");
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

test("real v2 CLI proves joined profile discrimination only for matching captured bytes", async () => {
  const subject = await exactFixture();
  try {
    const result = await runExact(subject);
    assert.equal(result.code, 0, result.stderr);
    const compact = JSON.parse(result.stdout);
    assert.equal(compact.structure, "proven");
    assert.equal(compact.profile_discrimination, "proven");
    assert.equal(compact.exact_binding, "proven");
    assert.equal(compact.assessment_scope, "planning");
    assert.match(compact.overall_code, /__exact_binding_proven$/u);
  } finally {
    await rm(subject.root, { recursive: true, force: true });
  }
});

test("changed candidate bytes and omitted captures are visible non-proofs", async () => {
  const changed = await exactFixture({
    candidateBytes: canonicalJsonBytes({ status: 200, body: { id: "p-1", total: 43 } })
  });
  const omitted = await exactFixture({ omit: "candidate-behavior-report" });
  try {
    for (const subject of [changed, omitted]) {
      const result = await runExact(subject);
      assert.equal(result.code, 2, result.stderr);
      const compact = JSON.parse(result.stdout);
      assert.equal(compact.exact_binding, "not_proven");
      assert.equal(compact.profile_discrimination, "not_proven");
    }
  } finally {
    await Promise.all([changed, omitted].map(({ root }) =>
      rm(root, { recursive: true, force: true })));
  }
});

test("one source descriptor cannot impersonate distinct baseline and candidate reports", async () => {
  const subject = await exactFixture();
  try {
    subject.sources["candidate-behavior-report"] = {
      kind: "artifact_file", relative_path: "baseline-report.json"
    };
    await writeFile(path.join(subject.root, "sources.json"),
      canonicalJsonBytes(subject.sources));
    const result = await runExact(subject);
    assert.equal(result.code, 2, result.stderr);
    const compact = JSON.parse(result.stdout);
    assert.equal(compact.exact_binding, "not_proven");
    assert.equal(compact.profile_discrimination, "not_proven");
  } finally {
    await rm(subject.root, { recursive: true, force: true });
  }
});

test("distinct descriptors intentionally do not claim distinct filesystem provenance", async () => {
  const subject = await exactFixture();
  try {
    await rm(path.join(subject.root, "candidate-report.json"));
    await link(
      path.join(subject.root, "baseline-report.json"),
      path.join(subject.root, "candidate-report.json")
    );
    const result = await runExact(subject);
    assert.equal(result.code, 0, result.stderr);
    const compact = JSON.parse(result.stdout);
    assert.equal(compact.exact_binding, "proven");
    assert.equal(compact.profile_discrimination, "proven");
  } finally {
    await rm(subject.root, { recursive: true, force: true });
  }
});

test("a substituted evaluation binding cannot borrow a passing exact capture", async () => {
  const subject = await exactFixture({ swapEvaluationRoles: true });
  try {
    const result = await runExact(subject);
    assert.equal(result.code, 2, result.stderr);
    const compact = JSON.parse(result.stdout);
    assert.equal(compact.profile_discrimination, "not_proven");
  } finally {
    await rm(subject.root, { recursive: true, force: true });
  }
});

test("exact-bound output is deterministic under source descriptor order", async () => {
  const subject = await exactFixture();
  try {
    const first = await runExact(subject);
    const reversed = Object.fromEntries(Object.entries(subject.sources).reverse());
    await writeFile(path.join(subject.root, "sources.json"), canonicalJsonBytes(reversed));
    const second = await runExact(subject);
    assert.equal(first.code, 0, first.stderr);
    assert.equal(second.code, 0, second.stderr);
    const left = JSON.parse(first.stdout);
    const right = JSON.parse(second.stdout);
    assert.equal(left.overall_code, right.overall_code);
    assert.equal(left.artifact, right.artifact);
  } finally {
    await rm(subject.root, { recursive: true, force: true });
  }
});

test("admission digest is stable under an independent recomputation", async () => {
  const admission = await readJson(runtimeDirectory, "admission.json");
  const first = canonicalDigest(admission);
  const reordered = Object.fromEntries(Object.entries(admission).reverse());
  assert.equal(canonicalDigest(reordered), first);
});
