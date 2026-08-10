import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { canonicalJsonBytes, sha256 } from "../lib/exact-binding-common.mjs";
import {
  PinnedCaptureRoot,
  captureAndEvaluateExactBindingsV1
} from "../lib/exact-binding-capture.mjs";
import { evaluateExactBindingsV1, semanticDeclarationDiagnostics } from
  "../lib/exact-binding.mjs";
import { snapshotExactBindingAssessmentRequest } from
  "../lib/exact-binding-plain-data.mjs";
import {
  executeDeterministicProjection,
  runTransformerTwice
} from "../lib/deterministic-projection.mjs";

const d = (character) => character.repeat(64);
const context = Object.freeze({
  contract_digest: d("1"), profile_digest: d("2"),
  evaluation_input_digest: d("3"), vocabulary_version: "0.34.0",
  vocabulary_complete_digest: d("4"), admission_digest: d("5"),
  exact_binding_declaration_digest: d("6"),
  exact_binding_certification_digest: d("7")
});
const roles = Object.freeze([
  ["dag-source", "integration_dag", "ref-integration-dag"],
  ["execution-paths", "execution_paths", "ref-execution-paths"],
  ["integration-units", "integration_units", "ref-integration-units"],
  ["prefix-census", "prefix_census", "ref-prefix-census"]
]);
const declaration = Object.freeze({
  schema_version: "controlled-contract-exact-binding-declaration.v1",
  profile_id: "proof.integration.prefix-safety",
  profile_version: "1.0.0",
  profile_digest: d("2"),
  requirements: roles.map(([requirementId, role]) => ({
    requirement_id: requirementId,
    binding_kind: "artifact_bytes",
    role_coverage: [
      ...(requirementId === "prefix-census" ? [{
        role: "prefix_cases", coverage: "exact",
        projection: "projection_result_population", population_id: "cases"
      }] : []),
      { role, coverage: "exact", projection: "artifact_subject" }
    ]
  })),
  relations: [{
    relation_id: "complete-prefix-census",
    operator: "deterministic_projection",
    transformer_id: "integration-prefix-census.v1",
    source_requirement_ids: ["dag-source", "integration-units", "execution-paths"],
    result_requirement_id: "prefix-census"
  }]
});
const evaluationInput = Object.freeze({
  reference_bindings: [
    ...roles.map(([, role, referenceId]) => ({ role, reference_ids: [referenceId] })),
    {
      role: "prefix_cases",
      reference_ids: JSON.parse(executeDeterministicProjection(
        "integration-prefix-census.v1", sourceBytes()
      )).cases.map(({ case_id: id }) => `ref-${id}`)
    }
  ],
  delivered_evidence: []
});

function documents({ atomic = false } = {}) {
  return [{
    schema_version: "controlled-contract.integration-prefix-dag.v1",
    slices: [{ slice_id: "consumer" }, { slice_id: "producer" }],
    depends_on: [{ predecessor_slice_id: "producer", successor_slice_id: "consumer" }]
  }, {
    schema_version: "controlled-contract.integration-units.v1",
    integration_units: atomic
      ? [{ unit_id: "producer-consumer", slice_ids: ["consumer", "producer"] }]
      : [{ unit_id: "consumer", slice_ids: ["consumer"] },
        { unit_id: "producer", slice_ids: ["producer"] }]
  }, {
    schema_version: "controlled-contract.execution-path-requirements.v1",
    execution_paths: [{
      path_id: "managed-read",
      required_branches: ["target-absent", "target-present"]
    }]
  }];
}

function sourceBytes(options) {
  return documents(options).map((value) => canonicalJsonBytes(value, { file: true }));
}

function capacityDocuments({ unitCount, branchCount }) {
  const slices = Array.from({ length: unitCount }, (_, index) =>
    `slice-${String(index).padStart(2, "0")}`);
  return [{
    schema_version: "controlled-contract.integration-prefix-dag.v1",
    slices: slices.map((slice_id) => ({ slice_id })),
    depends_on: slices.slice(1).map((successor, index) => ({
      predecessor_slice_id: slices[index], successor_slice_id: successor
    }))
  }, {
    schema_version: "controlled-contract.integration-units.v1",
    integration_units: slices.map((sliceId, index) => ({
      unit_id: `unit-${String(index).padStart(2, "0")}`, slice_ids: [sliceId]
    }))
  }, {
    schema_version: "controlled-contract.execution-path-requirements.v1",
    execution_paths: [{
      path_id: "bounded-path",
      required_branches: Array.from({ length: branchCount }, (_, index) =>
        `branch-${String(index).padStart(5, "0")}`)
    }]
  }];
}

function request() {
  return {
    contractPath: "contract.json",
    evaluationInputPath: "evaluation.json",
    profileId: "proof.integration.prefix-safety",
    exactBindingSources: Object.fromEntries(roles.map(([id]) => [
      id, { kind: "artifact_file", relative_path: `${id}.json` }
    ]))
  };
}

async function captured({ sources = sourceBytes(), resultBytes, omit = null } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "projection-rebased-"));
  const output = resultBytes ?? executeDeterministicProjection(
    "integration-prefix-census.v1", sources
  );
  const values = new Map([
    ["dag-source", sources[0]], ["integration-units", sources[1]],
    ["execution-paths", sources[2]], ["prefix-census", output]
  ]);
  await Promise.all([
    writeFile(path.join(root, "contract.json"), "{}\n"),
    writeFile(path.join(root, "evaluation.json"), "{}\n"),
    ...[...values].map(([id, bytes]) => writeFile(path.join(root, `${id}.json`), bytes))
  ]);
  const value = request();
  if (omit) delete value.exactBindingSources[omit];
  const boundInput = structuredClone(evaluationInput);
  boundInput.reference_bindings.find(({ role }) => role === "prefix_cases")
    .reference_ids = JSON.parse(output).cases.map(({ case_id: id }) => `ref-${id}`);
  const pinnedRoot = await PinnedCaptureRoot.open(root);
  try {
    return await captureAndEvaluateExactBindingsV1({
      request: snapshotExactBindingAssessmentRequest(value), declaration,
      evaluationInput: boundInput, context, expectedContext: context, pinnedRoot
    });
  } finally {
    await pinnedRoot.close();
  }
}

async function capturedWithCaseReferences(referenceIds) {
  const root = await mkdtemp(path.join(os.tmpdir(), "projection-population-"));
  const sources = sourceBytes();
  const output = executeDeterministicProjection("integration-prefix-census.v1", sources);
  for (const [name, bytes] of [
    ["dag-source", sources[0]], ["integration-units", sources[1]],
    ["execution-paths", sources[2]], ["prefix-census", output]
  ]) await writeFile(path.join(root, `${name}.json`), bytes);
  await writeFile(path.join(root, "contract.json"), "{}\n");
  await writeFile(path.join(root, "evaluation.json"), "{}\n");
  const input = structuredClone(evaluationInput);
  input.reference_bindings.find(({ role }) => role === "prefix_cases").reference_ids =
    referenceIds;
  const pinnedRoot = await PinnedCaptureRoot.open(root);
  try {
    return await captureAndEvaluateExactBindingsV1({
      request: snapshotExactBindingAssessmentRequest(request()), declaration,
      evaluationInput: input, context, expectedContext: context, pinnedRoot
    });
  } finally {
    await pinnedRoot.close();
  }
}

function fakeBinding([requirementId, role, referenceId], bytes) {
  return {
    binding_id: `binding-${requirementId}`, requirement_id: requirementId,
    capture_id: `capture-${requirementId}`, binding_kind: "artifact_bytes",
    media_type: "application/octet-stream", content_sha256: sha256(bytes),
    byte_length: bytes.byteLength,
    role_coverage: [{
      role, coverage: "exact", projection: "artifact_subject",
      reference_ids: [referenceId]
    }]
  };
}

test("derives every independently integrable prefix and required branch", () => {
  const census = JSON.parse(executeDeterministicProjection(
    "integration-prefix-census.v1", sourceBytes()
  ));
  assert.deepEqual(census.prefixes.map(({ slice_ids: ids }) => ids.join(",")).sort(),
    ["", "consumer,producer", "producer"]);
  assert.equal(census.cases.length, 6);
});

test("captured exact sources and exact census satisfy", async () => {
  const result = await captured();
  assert.equal(result.satisfaction, "satisfied");
  assert.equal(result.provenance.capture_verified, true);
  assert.equal(result.relation_results[0].status, "satisfied");
  const censusBinding = result.bindings.find(({ requirement_id: id }) =>
    id === "prefix-census");
  assert.deepEqual(
    censusBinding.role_coverage.find(({ role }) => role === "prefix_cases").reference_ids,
    evaluationInput.reference_bindings.find(({ role }) => role === "prefix_cases").reference_ids
  );
});

test("derived population coverage refuses omitted, substituted, and duplicate case mappings", async () => {
  const complete = evaluationInput.reference_bindings.find(
    ({ role }) => role === "prefix_cases"
  ).reference_ids;
  for (const mapped of [
    complete.slice(1),
    [...complete.slice(0, -1), "ref-case-not-derived"].sort(),
    [...complete, complete[0]].sort()
  ]) {
    const result = await capturedWithCaseReferences(mapped);
    assert.equal(result.satisfaction, "unsatisfied");
    assert.ok(result.diagnostics.some(({ code }) =>
      code === "binding_role_coverage_mismatch"));
  }
});

test("unknown projection populations are rejected semantically", () => {
  const candidate = structuredClone(declaration);
  candidate.requirements.find(({ requirement_id: id }) => id === "prefix-census")
    .role_coverage[0].population_id = "invented";
  assert.ok(semanticDeclarationDiagnostics(candidate).some(({ code }) =>
    code === "projection_population_unknown"));
});

test("an omitted producer-only prefix cannot be canonically re-digested away", async () => {
  const sources = sourceBytes();
  const census = JSON.parse(executeDeterministicProjection(
    "integration-prefix-census.v1", sources
  ));
  const id = census.prefixes.find(({ slice_ids: ids }) =>
    ids.length === 1 && ids[0] === "producer").prefix_id;
  census.prefixes = census.prefixes.filter(({ prefix_id: prefixId }) => prefixId !== id);
  census.cases = census.cases.filter(({ prefix_id: prefixId }) => prefixId !== id);
  const result = await captured({
    sources, resultBytes: canonicalJsonBytes(census, { file: true })
  });
  assert.equal(result.satisfaction, "unsatisfied");
});

test("an atomic census spliced onto independent units is unsatisfied", async () => {
  assert.equal((await captured({
    sources: sourceBytes(),
    resultBytes: executeDeterministicProjection(
      "integration-prefix-census.v1", sourceBytes({ atomic: true })
    )
  })).satisfaction, "unsatisfied");
});

test("a genuinely indivisible integration unit has no producer-only prefix", async () => {
  const sources = sourceBytes({ atomic: true });
  assert.equal((await captured({ sources })).satisfaction, "satisfied");
  const census = JSON.parse(executeDeterministicProjection(
    "integration-prefix-census.v1", sources
  ));
  assert.equal(census.prefixes.length, 2);
});

test("direct digest-only result fabrication is invalid", () => {
  const sources = sourceBytes();
  const bytes = [...sources, executeDeterministicProjection(
    "integration-prefix-census.v1", sources
  )];
  const byId = new Map([
    ["dag-source", bytes[0]], ["integration-units", bytes[1]],
    ["execution-paths", bytes[2]], ["prefix-census", bytes[3]]
  ]);
  const result = evaluateExactBindingsV1({
    declaration, evaluationInput, context, expectedContext: context,
    bindings: roles.map((role) => fakeBinding(role, byId.get(role[0])))
  });
  assert.equal(result.satisfaction, "invalid");
  assert.ok(result.diagnostics.some(({ code }) =>
    code === "projection_direct_result_fabrication_refused"));
});

test("unknown transformer and incomplete source declarations are invalid", () => {
  const unknown = structuredClone(declaration);
  unknown.relations[0].transformer_id = "caller-transformer.v1";
  assert.ok(semanticDeclarationDiagnostics(unknown).some(({ code }) =>
    code === "projection_transformer_unknown"));
  const incomplete = structuredClone(declaration);
  incomplete.relations[0].source_requirement_ids.pop();
  assert.ok(semanticDeclarationDiagnostics(incomplete).some(({ code }) =>
    code === "projection_source_set_incomplete"));
});

test("missing captured source is a typed non-pass", async () => {
  assert.equal((await captured({ omit: "execution-paths" })).satisfaction, "indeterminate");
});

test("noncanonical source and result bytes are invalid", async () => {
  const sources = sourceBytes();
  sources[0] = Buffer.from(`${JSON.stringify(documents()[0], null, 2)}\n`);
  assert.equal((await captured({
    sources,
    resultBytes: executeDeterministicProjection("integration-prefix-census.v1", sourceBytes())
  })).satisfaction, "invalid");
  const canonicalSources = sourceBytes();
  const output = JSON.parse(executeDeterministicProjection(
    "integration-prefix-census.v1", canonicalSources
  ));
  assert.equal((await captured({
    sources: canonicalSources,
    resultBytes: Buffer.from(`${JSON.stringify(output, null, 2)}\n`)
  })).satisfaction, "invalid");
});

test("incomplete unit partition and DAG cycles are invalid", async () => {
  const missing = documents();
  missing[1].integration_units.pop();
  assert.equal((await captured({
    sources: missing.map((value) => canonicalJsonBytes(value, { file: true })),
    resultBytes: executeDeterministicProjection("integration-prefix-census.v1", sourceBytes())
  })).satisfaction, "invalid");
  const cyclic = documents();
  cyclic[0].depends_on.unshift({
    predecessor_slice_id: "consumer", successor_slice_id: "producer"
  });
  assert.equal((await captured({
    sources: cyclic.map((value) => canonicalJsonBytes(value, { file: true })),
    resultBytes: executeDeterministicProjection("integration-prefix-census.v1", sourceBytes())
  })).satisfaction, "invalid");
});

test("nondeterministic package transformers are mechanically refused", () => {
  let count = 0;
  assert.throws(() => runTransformerTwice(() => ({ count: ++count }), [], []), {
    code: "projection_transformer_nondeterministic"
  });
});

test("exact capacity bounds succeed without truncation", () => {
  const units = capacityDocuments({ unitCount: 20, branchCount: 1 })
    .map((value) => canonicalJsonBytes(value, { file: true }));
  assert.equal(JSON.parse(executeDeterministicProjection(
    "integration-prefix-census.v1", units
  )).cases.length, 21);
  const cases = capacityDocuments({ unitCount: 9, branchCount: 10000 })
    .map((value) => canonicalJsonBytes(value, { file: true }));
  assert.equal(JSON.parse(executeDeterministicProjection(
    "integration-prefix-census.v1", cases
  )).cases.length, 100000);
});

test("over-limit populations return the stable typed diagnostic", () => {
  for (const values of [
    capacityDocuments({ unitCount: 21, branchCount: 1 }),
    capacityDocuments({ unitCount: 9, branchCount: 10001 })
  ]) assert.throws(() => executeDeterministicProjection(
    "integration-prefix-census.v1",
    values.map((value) => canonicalJsonBytes(value, { file: true }))
  ), { code: "projection_population_limit_exceeded" });
});

test("repeated derivation and capture remain deterministic", async () => {
  const sources = sourceBytes();
  assert.equal(new Set(Array.from({ length: 25 }, () => sha256(
    executeDeterministicProjection("integration-prefix-census.v1", sources)
  ))).size, 1);
  assert.deepEqual(await captured({ sources }), await captured({ sources }));
});
