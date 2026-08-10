import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

import {
  runExactBindingEvaluationV034,
  validateExactBindingRunnerEnvelopeV034
} from
  "./exact-binding-runner-v034.mjs";

const schema = JSON.parse(await readFile(new URL(
  "../../schema/controlled-contract-exact-binding.experimental.v0.1.schema.json",
  import.meta.url
), "utf8"));

const profile = {
  exact_binding_requirements: [{
    requirement_id: "candidate-artifact",
    binding_kind: "artifact_bytes",
    role_coverage: [{
      role: "candidate",
      coverage: "exact",
      projection: "artifact_subject"
    }]
  }]
};

const contract = {
  references: [{ reference_id: "ref-candidate" }]
};

const evaluationInput = {
  reference_bindings: [{
    role: "candidate",
    reference_ids: ["ref-candidate"]
  }]
};

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
}

test("exact-binding schema compiles strictly and validates every public carrier", async () => {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  ajv.addSchema(schema);
  const schemaId = schema.$id;
  const validateBindingSet = ajv.getSchema(schemaId);
  const validateProfileExtension = ajv.compile({
    $ref: `${schemaId}#/$defs/profile_extension`
  });
  const validateEvaluationInputExtension = ajv.compile({
    $ref: `${schemaId}#/$defs/evaluation_input_extension`
  });
  const validateBindingResult = ajv.compile({
    $ref: `${schemaId}#/$defs/binding_result`
  });
  const validateRunnerEnvelope = ajv.compile({
    $ref: `${schemaId}#/$defs/runner_envelope`
  });

  assert.equal(validateProfileExtension(profile), true,
    JSON.stringify(validateProfileExtension.errors));
  assert.equal(validateEvaluationInputExtension(evaluationInput), true,
    JSON.stringify(validateEvaluationInputExtension.errors));

  const root = await mkdtemp(path.join(os.tmpdir(), "exact-binding-schema-"));
  const source = path.join(root, "candidate.bin");
  await writeFile(source, "candidate bytes");
  const result = await runExactBindingEvaluationV034({
    contract_bytes: jsonBytes(contract),
    profile_bytes: jsonBytes(profile),
    evaluation_input_bytes: jsonBytes(evaluationInput),
    capture_requests: [{
      requirement_id: "candidate-artifact",
      binding_kind: "artifact_bytes",
      role_coverage: [{
        role: "candidate",
        projection: "artifact_subject",
        reference_ids: ["ref-candidate"]
      }],
      source_path: source,
      capture_root: root
    }]
  });
  const bindingSet = {
    binding_set_version:
      "controlled-contract-exact-binding-set.experimental.v0.1",
    context: result.inputs,
    bindings: result.bindings
  };

  assert.equal(validateBindingSet(bindingSet), true,
    JSON.stringify(validateBindingSet.errors));
  assert.equal(validateBindingResult(result.evaluation), true,
    JSON.stringify(validateBindingResult.errors));
  assert.equal(validateRunnerEnvelope(result), true,
    JSON.stringify(validateRunnerEnvelope.errors));

  const spliced = structuredClone(result);
  spliced.evaluation.binding_set_sha256 = "f".repeat(64);
  assert.equal(validateRunnerEnvelope(spliced), true,
    JSON.stringify(validateRunnerEnvelope.errors));
  assert.ok(validateExactBindingRunnerEnvelopeV034(spliced).some(
    ({ code }) => code === "runner_evaluation_binding_set_digest_mismatch"
  ));
});

test("schema and runner envelopes admit only empty snapshot-population coverage", async () => {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  ajv.addSchema(schema);
  const validateBindingSet = ajv.getSchema(schema.$id);
  const validateEvaluationInput = ajv.compile({
    $ref: `${schema.$id}#/$defs/evaluation_input_extension`
  });
  const validateBindingResult = ajv.compile({
    $ref: `${schema.$id}#/$defs/binding_result`
  });
  const validateRunnerEnvelope = ajv.compile({
    $ref: `${schema.$id}#/$defs/runner_envelope`
  });
  const cases = [
    {
      requirement_id: "empty-reachability",
      binding_kind: "complete_reachability_snapshot",
      subject_role: "production_graph",
      population_role: "graph_nodes",
      subject_reference_id: "ref-graph",
      snapshot: {
        snapshot_id: "empty-graph", snapshot_reference_id: "ref-graph",
        complete: true, nodes: [], edges: []
      }
    },
    {
      requirement_id: "empty-mutations",
      binding_kind: "observed_execution_mutation_snapshot",
      subject_role: "observed_execution",
      population_role: "observed_mutations",
      subject_reference_id: "ref-run",
      snapshot: {
        execution_id: "empty-run", execution_reference_id: "ref-run",
        complete: true, mutations: []
      }
    }
  ];
  for (const item of cases) {
    const itemProfile = {
      exact_binding_requirements: [{
        requirement_id: item.requirement_id,
        binding_kind: item.binding_kind,
        role_coverage: [
          { role: item.subject_role, coverage: "exact", projection: "snapshot_subject" },
          { role: item.population_role, coverage: "exact", projection: "snapshot_population" }
        ]
      }]
    };
    const itemInput = { reference_bindings: [
      { role: item.subject_role, reference_ids: [item.subject_reference_id] },
      { role: item.population_role, reference_ids: [] }
    ] };
    const result = await runExactBindingEvaluationV034({
      contract_bytes: jsonBytes({
        references: [{ reference_id: item.subject_reference_id }]
      }),
      profile_bytes: jsonBytes(itemProfile),
      evaluation_input_bytes: jsonBytes(itemInput),
      capture_requests: [{
        requirement_id: item.requirement_id,
        binding_kind: item.binding_kind,
        role_projections: [
          { role: item.subject_role, projection: "snapshot_subject" },
          { role: item.population_role, projection: "snapshot_population" }
        ],
        snapshot: item.snapshot
      }]
    });
    const bindingSet = {
      binding_set_version: "controlled-contract-exact-binding-set.experimental.v0.1",
      context: result.inputs,
      bindings: result.bindings
    };
    assert.equal(result.satisfaction, "satisfied");
    assert.equal(validateEvaluationInput(itemInput), true,
      JSON.stringify(validateEvaluationInput.errors));
    assert.equal(validateBindingSet(bindingSet), true,
      JSON.stringify(validateBindingSet.errors));
    assert.equal(validateBindingResult(result.evaluation), true,
      JSON.stringify(validateBindingResult.errors));
    assert.equal(validateRunnerEnvelope(result), true,
      JSON.stringify(validateRunnerEnvelope.errors));
    assert.deepEqual(validateExactBindingRunnerEnvelopeV034(result), []);

    const emptySubject = structuredClone(bindingSet);
    const subjectCoverage = emptySubject.bindings[0].role_coverage.find(
      ({ projection }) => projection === "snapshot_subject"
    );
    subjectCoverage.reference_ids = [];
    assert.equal(validateBindingSet(emptySubject), false);
    subjectCoverage.reference_ids = [item.subject_reference_id, "ref-decoy"];
    assert.equal(validateBindingSet(emptySubject), false);
  }
});

test("exact-binding profile extension rejects caller-invented fields", () => {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  ajv.addSchema(schema);
  const validate = ajv.compile({
    $ref: `${schema.$id}#/$defs/profile_extension`
  });
  const injected = structuredClone(profile);
  injected.exact_binding_requirements[0].caller_digest_is_evidence = true;
  assert.equal(validate(injected), false);
  assert.equal(validate({ ...profile, caller_invented: true }), false);
});
