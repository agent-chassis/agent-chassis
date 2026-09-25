import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { assessContractFiles } from "../../lib/contract-assessment.mjs";
import { canonicalJsonBytes } from "../../lib/exact-binding-common.mjs";
import { evaluateStableProofPackFixtureV1 } from "../support/stable-v1-proof-pack-runtime.mjs";
import { runProofPackAdequacy } from "../support/proof-pack-adequacy.mjs";
import {
  buildPrefixSafetyFixture,
  executePrefixChecks
} from "./integration-prefix-safety-v1-adequacy.mjs";
import { certificationDirectory, readDefinitionDocument } from "../support/certification-artifact.mjs";

const packageRoot = path.resolve(import.meta.dirname, "../..");
const identity = { profile_id: "proof.integration.prefix-safety", profile_version: "4.0.0" };
const packDirectory = certificationDirectory(identity);
const admittedDirectory = path.join(packageRoot,
  "profiles/proof.integration.prefix-safety/4.0.0");
const profile = await readDefinitionDocument(identity, "profile.json");
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
    const result = await assessContractFiles({
      inputPath: path.join(subject.root, "contract.json"),
      profileId: "proof.integration.prefix-safety",
      evaluationInputPath: path.join(subject.root, "evaluation.json") });
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

test("real aggregate assessment proves four cross-domain profile evaluations", async () => {
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
      assert.equal(observation.result.assessment.assessment_scope, "planning");
    } finally { await cleanup(observation); }
  }
});





test("profile evaluation and projection populations are deterministic", () => {
  const fixture = buildPrefixSafetyFixture({ profile, domain: "api-schema-rollout" });
  const evaluate = (contract, input) => evaluateStableProofPackFixtureV1({
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

