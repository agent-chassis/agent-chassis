import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import Ajv2020Module from "ajv/dist/2020.js";

const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));

const V2_FILE = "schema/controlled-contract-assessment.v2.schema.json";
const V3_FILE = "schema/controlled-contract-assessment.v3.schema.json";
const PROOF_SELECTION_STATUS_FILE = "lib/proof-intent-selection-status.mjs";
const PROOF_SELECTION_V2_FILE =
  "schema/controlled-contract-proof-pack-selection.v2.schema.json";

const v3Schema = JSON.parse(await readFile(new URL(`../${V3_FILE}`, import.meta.url)));

test("the runtime assessment v3 schema is published in the files population", () => {
  assert.ok(Array.isArray(manifest.files), "package files must be an array");
  assert.ok(manifest.files.includes(V3_FILE),
    `package files must publish ${V3_FILE}`);
  assert.equal(manifest.files.filter((entry) => entry === V3_FILE).length, 1);
  assert.ok(manifest.files.includes(V2_FILE),
    `package files must still publish ${V2_FILE}`);
  assert.equal(manifest.files.filter((entry) => entry === V2_FILE).length, 1);
});

test("proof-pack selection publishes each v2 runtime dependency exactly once", () => {
  assert.ok(Array.isArray(manifest.files), "package files must be an array");
  for (const file of [PROOF_SELECTION_STATUS_FILE, PROOF_SELECTION_V2_FILE]) {
    assert.equal(manifest.files.filter((entry) => entry === file).length, 1,
      `package files must publish ${file} exactly once`);
  }
});

test("the runtime assessment v3 schema has the exact v2-shaped exports mapping", () => {
  const exports = manifest.exports;
  assert.equal(typeof exports, "object");
  assert.equal(exports[`./${V3_FILE}`], `./${V3_FILE}`);
  assert.equal(exports[`./${V2_FILE}`], `./${V2_FILE}`);
});

test("the published v3 schema resolves through its exports subpath", async () => {
  const subpath = manifest.exports[`./${V3_FILE}`];
  const schema = JSON.parse(await readFile(
    new URL(`../${subpath.slice("./".length)}`, import.meta.url)
  ));
  assert.equal(schema.title, "controlled-contract-assessment.v3");
  assert.equal(schema.$id,
    "https://agent-chassis.invalid/controlled-contract-assessment.v3.schema.json");
});

const SHA256 = `sha256:${"a".repeat(64)}`;

function compileV3() {
  const Ajv2020 = Ajv2020Module.default ?? Ajv2020Module;
  return new Ajv2020({ strict: true, allErrors: true }).compile(v3Schema);
}

function receipt(kind, status, capability) {
  return {
    receipt_id: `receipt-${"b".repeat(64)}`,
    verification_id: "claim-runtime-proof",
    kind,
    status,
    provider: { provider_id: "launcher.node-test", provider_version: "1.0.0", capability },
    authenticated_identity: {
      run_id: "run-integrated-1", source_snapshot_digest: SHA256, receipt_digest: SHA256
    },
    evidence_artifact_ids: ["artifact-1"]
  };
}

const PROVEN_POPULATION = Object.freeze([
  receipt("candidate", "passed", "candidate_execution"),
  receipt("falsifier", "detected", "falsifier_execution"),
  receipt("traversal", "proven", "boundary_traversal")
]);

function provenAssessment(overrides = {}) {
  return {
    schema_version: "controlled-contract-assessment.v3",
    assessment_scope: "runtime",
    authority: "non_authoritative",
    assessment_status: "proven",
    assessment_identity: {
      run_id: "run-integrated-1",
      wk_id: "WK-2160",
      selected_unit: "WK-2160#SLICE-003",
      attempt: 1,
      verifications: [{ verification_id: "claim-runtime-proof", test_id: "test-1" }],
      contract_digest: SHA256,
      source_snapshot_digest: SHA256,
      generation_digest: SHA256
    },
    runtime_truth: "proven",
    profile_discrimination: "proven",
    population: {
      candidate_count: 1, falsifier_count: 1, traversal_count: 1, complete: true
    },
    receipts: [...PROVEN_POPULATION],
    diagnostics: [],
    ...overrides
  };
}

function notProvenAssessment(receipts) {
  return provenAssessment({
    assessment_status: "not_proven",
    runtime_truth: "not_proven",
    profile_discrimination: "not_proven",
    population: {
      candidate_count: 1, falsifier_count: 1, traversal_count: 1, complete: false
    },
    receipts
  });
}

test("the published v3 schema compiles under Ajv2020 strict with allErrors", () => {
  const validate = compileV3();
  assert.equal(typeof validate, "function");
  assert.equal(validate(provenAssessment()), true, JSON.stringify(validate.errors));
});

test("a proven v3 assessment cannot represent a failed, inert, or unproven member", () => {
  const validate = compileV3();
  for (const [label, receipts] of [
    ["failed candidate", [receipt("candidate", "failed", "candidate_execution"),
      ...PROVEN_POPULATION.slice(1)]],
    ["inert falsifier", [PROVEN_POPULATION[0],
      receipt("falsifier", "inert", "falsifier_execution"), PROVEN_POPULATION[2]]],
    ["unproven traversal", [...PROVEN_POPULATION.slice(0, 2),
      receipt("traversal", "unproven", "boundary_traversal")]],
    ["refused candidate", [receipt("candidate", "refused", "candidate_execution"),
      ...PROVEN_POPULATION.slice(1)]],
    ["absent falsifier", [PROVEN_POPULATION[0], PROVEN_POPULATION[2]]],
    ["absent traversal", PROVEN_POPULATION.slice(0, 2)]
  ]) {
    assert.equal(validate(provenAssessment({ receipts })), false,
      `a proven assessment must not represent a ${label}`);
  }

  for (const overrides of [
    { runtime_truth: "not_proven" },
    { profile_discrimination: "not_proven" },
    { population: {
      candidate_count: 1, falsifier_count: 1, traversal_count: 1, complete: false } }
  ]) assert.equal(validate(provenAssessment(overrides)), false,
    `a proven assessment must not carry ${JSON.stringify(overrides)}`);
});

test("v3 receipts discriminate kind, capability, and status together", () => {
  const validate = compileV3();
  for (const [label, member] of [
    ["candidate with a falsifier capability",
      receipt("candidate", "passed", "falsifier_execution")],
    ["falsifier with a traversal capability",
      receipt("falsifier", "detected", "boundary_traversal")],
    ["traversal with a candidate capability",
      receipt("traversal", "proven", "candidate_execution")],
    ["candidate with a falsifier status",
      receipt("candidate", "detected", "candidate_execution")],
    ["falsifier with a candidate status",
      receipt("falsifier", "passed", "falsifier_execution")],
    ["traversal with a falsifier status",
      receipt("traversal", "detected", "boundary_traversal")]
  ]) {
    assert.equal(validate(notProvenAssessment([member])), false,
      `a v3 receipt must not be a ${label}`);
  }
});

test("v3 cannot encode an assessment-level refusal as an assessment", () => {
  const validate = compileV3();

  for (const status of ["refused", "not_assessed", "proven_with_findings", "unknown"]) {
    assert.equal(validate(provenAssessment({ assessment_status: status })), false,
      `assessment_status must not admit '${status}'`);
  }

  for (const overrides of [
    { schema_version: "controlled-contract-assessment.v2" },
    { assessment_scope: "planning" },
    { authority: "authoritative" },
    { results: [] }
  ]) assert.equal(validate(provenAssessment(overrides)), false,
    `v3 must reject ${JSON.stringify(overrides)}`);
});

test("v3 retains receipt-level provider refusal on a not-proven assessment", () => {
  const validate = compileV3();

  for (const member of [
    receipt("candidate", "refused", "candidate_execution"),
    receipt("falsifier", "refused", "falsifier_execution"),
    receipt("traversal", "refused", "boundary_traversal")
  ]) {
    assert.equal(validate(notProvenAssessment([member])), true,
      `${member.kind} provider refusal must stay representable: ${JSON.stringify(
        validate.errors)}`);
  }

  assert.equal(validate(notProvenAssessment([])), false);
});
