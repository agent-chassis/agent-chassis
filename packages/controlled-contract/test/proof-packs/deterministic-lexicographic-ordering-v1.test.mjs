import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { assessContractFiles } from "../../lib/contract-assessment.mjs";
import { deriveDeterministicLexicographicConformance } from
  "../../lib/deterministic-lexicographic-ordering.mjs";
import { canonicalJsonBytes, sha256 } from
  "../../lib/deterministic-projection-primitives.mjs";
import { evaluateStableProofPackFixtureV1 } from
  "../support/stable-v1-proof-pack-runtime.mjs";
import { runProofPackAdequacy } from "../support/proof-pack-adequacy.mjs";
import {
  MUTANT_IDS,
  buildLexicographicProfileFixture
} from "./deterministic-lexicographic-ordering-v1-adequacy.mjs";
import { buildLexicographicDocuments } from
  "./deterministic-lexicographic-ordering-v1-fixture.mjs";
import { executeMutant } from
  "./deterministic-lexicographic-ordering-v1-harness.mjs";

const packageRoot = path.resolve(import.meta.dirname, "../..");
const execFileAsync = promisify(execFile);
const packDirectory = path.join(packageRoot,
  "test/certification/profiles/proof.ordering.lexicographic-conformance/3.0.0");
const admittedDirectory = path.join(packageRoot,
  "profiles/proof.ordering.lexicographic-conformance/3.0.0");
const profile = JSON.parse(await readFile(path.join(packDirectory, "profile.json"), "utf8"));
const descriptors = Object.freeze({
  "comparator-evidence": { kind: "artifact_file", relative_path: "evidence.json" },
  "conformance-report": { kind: "artifact_file", relative_path: "conformance.json" },
  "input-snapshot": { kind: "artifact_file", relative_path: "input.json" },
  "ordering-policy": { kind: "artifact_file", relative_path: "policy.json" },
  "result-snapshot": { kind: "artifact_file", relative_path: "result.json" }
});

function derive(documents) {
  return deriveDeterministicLexicographicConformance({
    comparatorEvidenceBytes: documents.sourceBytes[0],
    inputSnapshotBytes: documents.sourceBytes[1],
    orderingPolicyBytes: documents.sourceBytes[2],
    resultSnapshotBytes: documents.sourceBytes[3]
  });
}

async function captureFixture({ caseId = "numeric-unicode", inputMutation = null,
  sourceMutation = null, reportBytes = null, reportMutation = null } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cc-lexicographic-"));
  const fixture = buildLexicographicProfileFixture({ profile, caseId });
  inputMutation?.(fixture.input, fixture);
  let conformance = reportBytes ?? derive(fixture.documents);
  if (reportMutation) {
    const value = JSON.parse(conformance);
    reportMutation(value, fixture);
    conformance = canonicalJsonBytes(value, { file: true });
  }
  const sources = structuredClone(descriptors);
  sourceMutation?.(sources, fixture);
  const files = {
    "contract.json": Buffer.from(`${JSON.stringify(fixture.contract, null, 2)}\n`),
    "evaluation.json": Buffer.from(`${JSON.stringify(fixture.input, null, 2)}\n`),
    "evidence.json": fixture.documents.sourceBytes[0],
    "input.json": fixture.documents.sourceBytes[1],
    "policy.json": fixture.documents.sourceBytes[2],
    "result.json": fixture.documents.sourceBytes[3],
    "conformance.json": conformance
  };
  await Promise.all(Object.entries(files).map(([name, bytes]) =>
    writeFile(path.join(root, name), bytes)));
  return { root, fixture, sources };
}

async function assessed(options = {}) {
  const subject = await captureFixture(options);
  try {
    const result = await assessContractFiles({
      inputPath: path.join(subject.root, "contract.json"),
      profileId: "proof.ordering.lexicographic-conformance",
      evaluationInputPath: path.join(subject.root, "evaluation.json")
    });
    return { result, subject };
  } catch (error) {
    return { error, subject };
  }
}

async function cleanup(observation) {
  await rm(observation.subject.root, { recursive: true, force: true });
}

function refused(observation) {
  return Boolean(observation.error) ||
    observation.result.assessment.profile_discrimination === "not_proven";
}

test("indexed and full-census adequacy prove all controls and weakening witnesses", async () => {
  for (const variationMode of ["indexed", "full_census"]) {
    const result = await runProofPackAdequacy(packDirectory, { variationMode });
    assert.equal(result.passed, true);

    assert.equal(result.control_count, 93);
    assert.equal(result.negative_fixture_count, 136);
    assert.equal(result.coverage_witness_count, 136);
    assert.deepEqual(result.diagnostics, []);
  }
});

test("all independently expected semantic mutants are killed mechanically", () => {
  for (const mutantId of MUTANT_IDS.filter((id) => ![
    "fabricated-resolver-facts", "resolver-facts-bound-to-different-artifacts"
  ].includes(id))) assert.equal(executeMutant(mutantId).killed, true, mutantId);
});

test("four broad cases prove profile discrimination", async () => {
  for (const caseId of [
    "numeric-unicode", "timestamp-integer", "boolean-numeric-unicode",
    "tie-normalized-unicode"
  ]) {
    const observation = await assessed({ caseId });
    try {
      assert.equal(observation.error, undefined);
      assert.equal(observation.result.assessment.structure, "proven");
      assert.equal(observation.result.assessment.profile_discrimination, "proven");
      assert.equal(observation.result.assessment.assessment_scope, "planning");
    } finally { await cleanup(observation); }
  }
});

test("each declared population refuses omission substitution and duplication", async () => {
  for (const role of ["declared_items", "policy_keys", "result_items"]) {
    for (const mode of ["omit", "substitute", "duplicate"]) {
      const observation = await assessed({ inputMutation(input) {
        const binding = input.reference_bindings.find((entry) => entry.role === role);
        if (mode === "omit") binding.reference_ids.pop();
        if (mode === "substitute") binding.reference_ids[0] = `ref-${role.replaceAll("_", "-")}-forged`;
        if (mode === "duplicate") binding.reference_ids.push(binding.reference_ids[0]);
      } });
      try { assert.equal(refused(observation), true, `${role}:${mode}`); }
      finally { await cleanup(observation); }
    }
  }
});

test("derivation is canonical, pure, and refuses noncanonical exact source bytes", () => {
  const documents = buildLexicographicDocuments("boolean-numeric-unicode");
  const first = derive(documents);
  const second = derive(documents);
  assert.deepEqual(first, second);
  assert.deepEqual(first, canonicalJsonBytes(JSON.parse(first), { file: true }));
  assert.throws(() => deriveDeterministicLexicographicConformance({
    comparatorEvidenceBytes: Buffer.from(JSON.stringify(documents.evidence)),
    inputSnapshotBytes: documents.sourceBytes[1],
    orderingPolicyBytes: documents.sourceBytes[2],
    resultSnapshotBytes: documents.sourceBytes[3]
  }), (error) => error?.code === "projection_input_noncanonical");
});

test("the public derivation CLI emits the same canonical digest-bound report", async () => {
  const subject = await captureFixture({ caseId: "timestamp-integer" });
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      path.join(packageRoot, "bin/derive-lexicographic-conformance.mjs"),
      "--comparator-evidence", path.join(subject.root, "evidence.json"),
      "--input", path.join(subject.root, "input.json"),
      "--policy", path.join(subject.root, "policy.json"),
      "--result", path.join(subject.root, "result.json")
    ]);
    assert.equal(stderr, "");
    assert.deepEqual(Buffer.from(stdout), derive(subject.fixture.documents));
  } finally { await rm(subject.root, { recursive: true, force: true }); }
});

test("profile evaluation is invariant to harmless carrier and binding permutations", () => {
  const fixture = buildLexicographicProfileFixture({
    profile, caseId: "boolean-numeric-unicode"
  });
  const evaluate = (contract, input) => canonicalJsonBytes(evaluateStableProofPackFixtureV1({
    contract, profile, evaluation_input: input
  }));
  const baseline = evaluate(fixture.contract, fixture.input);
  for (let iteration = 0; iteration < 20; iteration += 1) assert.deepEqual(evaluate({
    ...structuredClone(fixture.contract),
    references: [...fixture.contract.references].reverse(),
    propositions: [...fixture.contract.propositions].reverse(),
    claims: [...fixture.contract.claims].reverse(),
    relations: [...fixture.contract.relations].reverse()
  }, {
    ...structuredClone(fixture.input),
    reference_bindings: [...fixture.input.reference_bindings].reverse(),
    number_bindings: [...fixture.input.number_bindings].reverse()
  }), baseline);
});

