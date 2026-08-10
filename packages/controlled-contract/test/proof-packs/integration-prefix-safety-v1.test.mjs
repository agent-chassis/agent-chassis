import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { assessExactBoundContractFiles } from "../../lib/contract-assessment.mjs";
import { canonicalJsonBytes, sha256 } from "../../lib/exact-binding-common.mjs";
import { evaluateVerificationProfileV034 } from "../../lib/verification-profile-v034.mjs";
import { runProofPackAdequacy } from "../support/proof-pack-adequacy.mjs";
import {
  buildPrefixSafetyFixture,
  executePrefixChecks
} from "./integration-prefix-safety-v1-adequacy.mjs";

const packageRoot = path.resolve(import.meta.dirname, "../..");
const packDirectory = path.join(packageRoot,
  "test/certification/profiles/proof.integration.prefix-safety/1.0.0");
const admittedDirectory = path.join(packageRoot,
  "profiles/proof.integration.prefix-safety/1.0.0");
const profile = JSON.parse(await readFile(path.join(packDirectory, "profile.json"), "utf8"));
const descriptors = Object.freeze({
  "dag-source": { kind: "artifact_file", relative_path: "dag.json" },
  "execution-paths": { kind: "artifact_file", relative_path: "paths.json" },
  "integration-units": { kind: "artifact_file", relative_path: "units.json" },
  "prefix-census": { kind: "artifact_file", relative_path: "census.json" }
});

async function captureFixture({ domain = "managed-repository-selection", atomic = false,
  inputMutation = null, sourceMutation = null } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cc-prefix-safety-"));
  const fixture = buildPrefixSafetyFixture({ profile, domain, atomic });
  const execution = executePrefixChecks({ domain, atomic });
  inputMutation?.(fixture.input, fixture);
  const sources = structuredClone(descriptors);
  sourceMutation?.(sources, execution);
  const files = {
    "contract.json": Buffer.from(`${JSON.stringify(fixture.contract, null, 2)}\n`),
    "evaluation.json": Buffer.from(`${JSON.stringify(fixture.input, null, 2)}\n`),
    "dag.json": execution.sourceBytes[0],
    "units.json": execution.sourceBytes[1],
    "paths.json": execution.sourceBytes[2],
    "census.json": execution.censusBytes
  };
  await Promise.all(Object.entries(files).map(([name, bytes]) =>
    writeFile(path.join(root, name), bytes)));
  return { root, fixture, execution, sources };
}

async function assessed(options = {}) {
  const subject = await captureFixture(options);
  try {
    const result = await assessExactBoundContractFiles({ captureRoot: subject.root,
      contractPath: "contract.json", profileId: "proof.integration.prefix-safety",
      evaluationInputPath: "evaluation.json", exactBindingSources: subject.sources });
    return { result, subject };
  } catch (error) {
    await rm(subject.root, { recursive: true, force: true });
    return { error, subject };
  }
}

async function cleanup({ subject }) {
  await rm(subject.root, { recursive: true, force: true });
}

test("ordinary and full-census adequacy are release clean", async () => {
  for (const variationMode of ["indexed", "full_census"]) {
    const result = await runProofPackAdequacy(packDirectory, { variationMode });
    assert.equal(result.passed, true);
    assert.equal(result.control_count, 18);
    assert.equal(result.negative_fixture_count, 44);
    assert.equal(result.coverage_witness_count, 44);
    assert.deepEqual(result.diagnostics, []);
  }
});

test("real aggregate assessment proves four cross-domain exact captures", async () => {
  for (const options of [
    { domain: "managed-repository-selection" },
    { domain: "api-schema-rollout" },
    { domain: "message-codec-rollout" },
    { domain: "message-codec-rollout", atomic: true }
  ]) {
    const observation = await assessed(options);
    try {
      assert.equal(observation.error, undefined);
      assert.equal(observation.result.assessment.structure, "proven");
      assert.equal(observation.result.assessment.profile_discrimination, "proven");
      assert.equal(observation.result.assessment.exact_binding, "proven");
      assert.equal(observation.result.assessment.assessment_scope, "planning");
    } finally { await cleanup(observation); }
  }
});

test("exact case population refuses omission substitution and duplication", async () => {
  const mutations = [
    (input) => input.reference_bindings.find(({ role }) => role === "prefix_cases")
      .reference_ids.pop(),
    (input) => { input.reference_bindings.find(({ role }) => role === "prefix_cases")
      .reference_ids[0] = "ref-case-substituted"; },
    (input) => { const binding = input.reference_bindings.find(
      ({ role }) => role === "prefix_cases"); binding.reference_ids.push(binding.reference_ids[0]); }
  ];
  for (const inputMutation of mutations) {
    const observation = await assessed({ inputMutation });
    try {
      assert.ok(observation.error ||
        observation.result.assessment.exact_binding === "not_proven");
    } finally { await cleanup(observation); }
  }
});

test("missing exact sources and descriptor splice fail closed", async () => {
  for (const requirement of ["dag-source", "integration-units", "execution-paths"]) {
    const observation = await assessed({ sourceMutation(sources) { delete sources[requirement]; } });
    try {
      assert.ok(observation.error ||
        observation.result.assessment.exact_binding === "not_proven");
    } finally { await cleanup(observation); }
  }
  const spliced = await assessed({ sourceMutation(sources) {
    sources["dag-source"] = { kind: "artifact_file", relative_path: "units.json" };
  } });
  try {
    assert.ok(spliced.error || spliced.result.assessment.exact_binding === "not_proven");
  } finally { await cleanup(spliced); }
});

test("a different canonical census cannot be spliced into the admitted capture", async () => {
  const subject = await captureFixture();
  const rival = executePrefixChecks({ domain: "api-schema-rollout" });
  await writeFile(path.join(subject.root, "census.json"), rival.censusBytes);
  try {
    const result = await assessExactBoundContractFiles({ captureRoot: subject.root,
      contractPath: "contract.json", profileId: "proof.integration.prefix-safety",
      evaluationInputPath: "evaluation.json", exactBindingSources: subject.sources });
    assert.equal(result.assessment.exact_binding, "not_proven");
  } finally { await rm(subject.root, { recursive: true, force: true }); }
});

test("exact admission carriers remain canonical and bound", async () => {
  const [declaration, certification, corpus] = await Promise.all([
    readFile(path.join(admittedDirectory, "exact-binding.json")),
    readFile(path.join(admittedDirectory, "exact-binding-certification.json")),
    readFile(path.join(packDirectory, "exact-binding-corpus.json"))
  ]);
  assert.deepEqual(declaration, canonicalJsonBytes(JSON.parse(declaration), { file: true }));
  assert.deepEqual(certification,
    canonicalJsonBytes(JSON.parse(certification), { file: true }));
  const certificationValue = JSON.parse(certification);
  assert.equal(certificationValue.result.passed_control_ids.length, 12);
  assert.equal(certificationValue.corpus.corpus_digest, sha256(corpus));
});

test("profile evaluation and projection populations are deterministic", () => {
  const fixture = buildPrefixSafetyFixture({ profile, domain: "api-schema-rollout" });
  const evaluate = (contract, input) => evaluateVerificationProfileV034({
    contract, profile, evaluation_input: input
  });
  const baseline = canonicalJsonBytes(evaluate(fixture.contract, fixture.input));
  for (let iteration = 0; iteration < 25; iteration += 1) {
    assert.deepEqual(canonicalJsonBytes(evaluate(
      { ...structuredClone(fixture.contract),
        references: [...fixture.contract.references].reverse(),
        propositions: [...fixture.contract.propositions].reverse(),
        claims: [...fixture.contract.claims].reverse() },
      { ...structuredClone(fixture.input),
        reference_bindings: [...fixture.input.reference_bindings].reverse() }
    )), baseline);
  }
  const ordinary = executePrefixChecks({ domain: "managed-repository-selection" });
  const atomic = executePrefixChecks({ domain: "managed-repository-selection", atomic: true });
  assert.equal(ordinary.census.cases.some(({ branch, prefix_id: prefixId }) => {
    const prefix = ordinary.census.prefixes.find(({ prefix_id: id }) => id === prefixId);
    return branch === "target-present" && prefix.slice_ids.length === 1;
  }), true);
  assert.ok(atomic.census.prefixes.length < ordinary.census.prefixes.length);
});

test("the exact certification result is reproduced by all twelve executed controls", async () => {
  const passed = [];
  for (const [controlId, options] of [
    ["cross-domain-managed-repository-positive", { domain: "managed-repository-selection" }],
    ["cross-domain-api-schema-positive", { domain: "api-schema-rollout" }],
    ["cross-domain-message-codec-positive", { domain: "message-codec-rollout" }],
    ["atomic-codeployment-positive", { domain: "message-codec-rollout", atomic: true }]
  ]) {
    const observation = await assessed(options);
    try {
      if (!observation.error && observation.result.assessment.exact_binding === "proven" &&
          observation.result.assessment.profile_discrimination === "proven") passed.push(controlId);
    } finally { await cleanup(observation); }
  }
  for (const [controlId, inputMutation] of [
    ["case-population-omission-refused", (input) => input.reference_bindings.find(
      ({ role }) => role === "prefix_cases").reference_ids.pop()],
    ["case-population-substitution-refused", (input) => {
      input.reference_bindings.find(({ role }) => role === "prefix_cases")
        .reference_ids[0] = "ref-case-substituted";
    }],
    ["case-population-duplicate-refused", (input) => {
      const ids = input.reference_bindings.find(({ role }) => role === "prefix_cases")
        .reference_ids; ids.push(ids[0]);
    }]
  ]) {
    const observation = await assessed({ inputMutation });
    try {
      if (observation.error || observation.result.assessment.exact_binding === "not_proven") {
        passed.push(controlId);
      }
    } finally { await cleanup(observation); }
  }
  for (const [controlId, requirement] of [
    ["missing-dag-source-refused", "dag-source"],
    ["missing-unit-source-refused", "integration-units"],
    ["missing-path-source-refused", "execution-paths"]
  ]) {
    const observation = await assessed({ sourceMutation(sources) { delete sources[requirement]; } });
    try {
      if (observation.error || observation.result.assessment.exact_binding === "not_proven") {
        passed.push(controlId);
      }
    } finally { await cleanup(observation); }
  }
  {
    const observation = await assessed({ sourceMutation(sources) {
      sources["dag-source"] = { kind: "artifact_file", relative_path: "units.json" };
    } });
    try {
      if (observation.error || observation.result.assessment.exact_binding === "not_proven") {
        passed.push("source-descriptor-splice-refused");
      }
    } finally { await cleanup(observation); }
  }
  {
    const subject = await captureFixture();
    await writeFile(path.join(subject.root, "census.json"),
      executePrefixChecks({ domain: "api-schema-rollout" }).censusBytes);
    try {
      const result = await assessExactBoundContractFiles({ captureRoot: subject.root,
        contractPath: "contract.json", profileId: "proof.integration.prefix-safety",
        evaluationInputPath: "evaluation.json", exactBindingSources: subject.sources });
      if (result.assessment.exact_binding === "not_proven") {
        passed.push("projection-result-splice-refused");
      }
    } finally { await rm(subject.root, { recursive: true, force: true }); }
  }
  const certification = JSON.parse(await readFile(
    path.join(admittedDirectory, "exact-binding-certification.json"), "utf8"
  ));
  assert.deepEqual(passed.sort(), certification.result.passed_control_ids);
});
