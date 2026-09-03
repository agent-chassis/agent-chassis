import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { assessExactBoundContractFiles } from "../../lib/contract-assessment.mjs";
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
  "test/certification/profiles/proof.ordering.lexicographic-conformance/2.0.0");
const admittedDirectory = path.join(packageRoot,
  "profiles/proof.ordering.lexicographic-conformance/2.0.0");
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
    const result = await assessExactBoundContractFiles({
      captureRoot: subject.root,
      contractPath: "contract.json",
      profileId: "proof.ordering.lexicographic-conformance",
      evaluationInputPath: "evaluation.json",
      exactBindingSources: subject.sources
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
  return Boolean(observation.error) || observation.result.assessment.exact_binding === "not_proven";
}

test("indexed and full-census adequacy prove all controls and weakening witnesses", async () => {
  for (const variationMode of ["indexed", "full_census"]) {
    const result = await runProofPackAdequacy(packDirectory, { variationMode });
    assert.equal(result.passed, true);
    assert.equal(result.control_count, 95);
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

test("four broad exact captures prove profile discrimination and exact binding", async () => {
  for (const caseId of [
    "numeric-unicode", "timestamp-integer", "boolean-numeric-unicode",
    "tie-normalized-unicode"
  ]) {
    const observation = await assessed({ caseId });
    try {
      assert.equal(observation.error, undefined);
      assert.equal(observation.result.assessment.structure, "proven");
      assert.equal(observation.result.assessment.profile_discrimination, "proven");
      assert.equal(observation.result.assessment.exact_binding, "proven");
      assert.equal(observation.result.assessment.assessment_scope, "planning");
    } finally { await cleanup(observation); }
  }
});

test("each exact population refuses omission substitution and duplication", async () => {
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

test("missing and aliased exact sources fail closed", async () => {
  for (const requirementId of [
    "comparator-evidence", "input-snapshot", "ordering-policy", "result-snapshot"
  ]) {
    const observation = await assessed({ sourceMutation(sources) {
      delete sources[requirementId];
    } });
    try { assert.equal(refused(observation), true, requirementId); }
    finally { await cleanup(observation); }
  }
  const aliased = await assessed({ sourceMutation(sources) {
    sources["input-snapshot"] = structuredClone(sources["ordering-policy"]);
  } });
  try { assert.equal(refused(aliased), true); }
  finally { await cleanup(aliased); }
});

test("fabricated, stale, rebound, and caller-asserted conformance cannot pass", async () => {
  const rivals = buildLexicographicDocuments("timestamp-integer");
  const cases = [
    { reportMutation(report) { report.facts[0].fact_key = "fabricated-pass"; } },
    { reportBytes: derive(rivals) },
    { reportMutation(report) {
      report.source_content_sha256.input_snapshot = "0".repeat(64);
      report.source_set_sha256 = sha256(canonicalJsonBytes({
        transformer_id: report.transformer_id,
        source_content_sha256: report.source_content_sha256
      }));
      for (const fact of report.facts) fact.source_set_sha256 = report.source_set_sha256;
    } },
    { inputMutation(input) {
      input.resolver_facts = [
        "policy-well-formed", "item-key-matrix-complete",
        "distinguishable-items-non-equal", "full-result-correct",
        "input-permutation-invariant", "declaration-order-invariant",
        "serialization-order-invariant"
      ].map((factKey) => ({ resolver_kind: "deterministic-lexicographic-ordering",
        fact_key: factKey, argument_reference_ids: [], satisfied: true }));
    }, reportMutation(report) { report.facts[0].satisfied = false; } }
  ];
  for (const options of cases) {
    const observation = await assessed(options);
    try { assert.equal(refused(observation), true); }
    finally { await cleanup(observation); }
  }
});

test("all twenty exact controls reproduce the declared corpus and certification", async () => {
  const passed = [];
  const executeControl = async (controlId, options, expectedProven) => {
    const observation = await assessed(options);
    try {
      const proven = !observation.error &&
        observation.result.assessment.exact_binding === "proven" &&
        observation.result.assessment.profile_discrimination === "proven";
      if (proven === expectedProven) passed.push(controlId);
    } finally { await cleanup(observation); }
  };
  for (const [controlId, caseId] of [
    ["numeric-unicode-positive", "numeric-unicode"],
    ["timestamp-integer-positive", "timestamp-integer"],
    ["boolean-numeric-unicode-positive", "boolean-numeric-unicode"]
  ]) await executeControl(controlId, { caseId }, true);
  for (const [controlId, role, mode] of [
    ["declared-population-omission-refused", "declared_items", "omit"],
    ["declared-population-substitution-refused", "declared_items", "substitute"],
    ["declared-population-duplicate-refused", "declared_items", "duplicate"],
    ["policy-population-omission-refused", "policy_keys", "omit"],
    ["policy-population-substitution-refused", "policy_keys", "substitute"],
    ["policy-population-duplicate-refused", "policy_keys", "duplicate"],
    ["result-population-omission-refused", "result_items", "omit"],
    ["result-population-substitution-refused", "result_items", "substitute"],
    ["result-population-duplicate-refused", "result_items", "duplicate"]
  ]) await executeControl(controlId, { inputMutation(input) {
    const ids = input.reference_bindings.find((entry) => entry.role === role).reference_ids;
    if (mode === "omit") ids.pop();
    if (mode === "substitute") ids[0] = "ref-exact-control-substitution";
    if (mode === "duplicate") ids.push(ids[0]);
  } }, false);
  for (const [controlId, requirementId] of [
    ["comparator-evidence-missing-refused", "comparator-evidence"],
    ["input-snapshot-missing-refused", "input-snapshot"],
    ["ordering-policy-missing-refused", "ordering-policy"],
    ["result-snapshot-missing-refused", "result-snapshot"]
  ]) await executeControl(controlId, { sourceMutation(sources) {
    delete sources[requirementId];
  } }, false);
  await executeControl("distinct-source-descriptor-alias-refused", {
    sourceMutation(sources) {
      sources["input-snapshot"] = structuredClone(sources["ordering-policy"]);
    }
  }, false);
  await executeControl("conformance-report-fabrication-refused", {
    reportMutation(report) { report.facts[0].fact_key = "fabricated-pass"; }
  }, false);
  await executeControl("conformance-report-rebinding-refused", {
    reportBytes: derive(buildLexicographicDocuments("timestamp-integer"))
  }, false);
  await executeControl("source-result-shape-swap-refused", {
    sourceMutation(sources) {
      sources["comparator-evidence"].relative_path = "result.json";
      sources["result-snapshot"].relative_path = "evidence.json";
    }
  }, false);
  const [corpus, certification] = await Promise.all([
    readFile(path.join(packDirectory, "exact-binding-corpus.json"), "utf8").then(JSON.parse),
    readFile(path.join(admittedDirectory, "exact-binding-certification.json"), "utf8")
      .then(JSON.parse)
  ]);
  const expected = corpus.controls.map(({ control_id: id }) => id).sort();
  assert.deepEqual(passed.sort(), expected);
  assert.deepEqual(passed, certification.result.passed_control_ids);
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

test("admitted exact carriers are canonical and publish the complete certification", async () => {
  const [declaration, certification, admission] = await Promise.all([
    readFile(path.join(admittedDirectory, "exact-binding.json")),
    readFile(path.join(admittedDirectory, "exact-binding-certification.json")),
    readFile(path.join(admittedDirectory, "admission.json"), "utf8").then(JSON.parse)
  ]);
  assert.deepEqual(declaration, canonicalJsonBytes(JSON.parse(declaration), { file: true }));
  assert.deepEqual(certification, canonicalJsonBytes(JSON.parse(certification), { file: true }));
  assert.equal(admission.certification.executable_control_count, 95);
  assert.equal(admission.certification.negative_fixture_count, 136);
  assert.equal(admission.certification.coverage_witness_count, 136);
  assert.equal(admission.exact_binding.executable_control_count, 20);
  assert.equal(admission.exact_binding.declaration_digest, sha256(declaration));
});
