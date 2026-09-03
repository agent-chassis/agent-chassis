import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

import {
  TEST_PROOF_CONTRACT_PROFILE_ID_V03,
  TEST_PROOF_CONTRACT_SCHEMA_V03,
  TEST_PROOF_CONTRACT_SCHEMA_VERSION_V03,
  TEST_PROOF_RUNTIME_EVIDENCE_SCHEMA_V1,
  TEST_PROOF_RUNTIME_EVIDENCE_VERSION_V1,
  TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
  TEST_PROOF_PROVIDER_CATALOG,
  TEST_PROOF_VERSION_V1,
  TEST_PROOF_VOCABULARY,
  TestProofContractError,
  canonicalTestProofContractJson,
  migrateControlledAcceptanceContractV02ToV03,
  validateTestProofContract,
  validateTestProofRuntimeEvidence
} from "../../lib/test-proof-contract.mjs";
import { validateAndResolveNativeContractV034 } from
  "../../lib/native-contract-carrier-v034.mjs";

const baseContract = JSON.parse(await readFile(new URL(
  "../../examples/minimal-controlled-acceptance-contract-v034.json", import.meta.url
)));
const clone = (value) => structuredClone(value);
const digest = (character) => `sha256:${character.repeat(64)}`;
const fixtureArtifact = (kind, character) => {
  const payload = { fixture: character };
  const valueDigest = `sha256:${createHash("sha256").update(
    `${JSON.stringify(payload)}\n`, "utf8"
  ).digest("hex")}`;
  return { artifact_id: `artifact-${valueDigest.slice(7)}`, kind,
    digest: valueDigest, owner: "launcher", payload };
};

function proof(overrides = {}) {
  return {
    test_proof_id: "test-proof-suite-covers-component",
    verification_claim_id: "claim-suite-covers-component",
    system_under_test_boundary: {
      boundary_id: "sut-boundary-example-component",
      kind: "module",
      runtime_module_path: "packages/controlled-contract/lib/test-proof-contract.mjs",
      subject_reference_ids: ["ref-component"]
    },
    observable_result: {
      observable_id: "observable-suite-result",
      kind: "return_value",
      proposition_id: "prop-suite-covers-component"
    },
    candidate_execution_provider: {
      provider_id: "launcher.node-test", provider_version: "1.0.0",
      capability: "candidate_execution"
    },
    falsifiers: [{
      falsifier_id: "falsifier-component-absent",
      strategy: "dependency_failure",
      proposition_id: "prop-component-absent",
      expected_outcome: "verification_fails",
      mutation: { mutation_id: "mutation-component-dependency", mechanism: "module_substitution",
        target_kind: "module", module_path: "packages/controlled-contract/lib/test-proof-contract.mjs" },
      execution_provider: { provider_id: "launcher.node-test-module-fault", provider_version: "1.0.0",
        capability: "falsifier_execution" }
    }],
    traversal_provider: { mode: "provider",
      provider_id: "launcher.node-test-v8-coverage", provider_version: "1.0.0",
      capability: "boundary_traversal", boundary_kind: "module",
      observation_mechanism: "node_test_v8_coverage",
      observation_seam: "node_test_structured_assertion", evidence_artifact_type: "boundary_trace" },
    coverage_disposition: {
      baseline_id: "coverage-baseline-example-suite",
      baseline_state: "complete_executed_inventory",
      items: [{ test_id: "test-component-exists", disposition: "preserved" }]
    },
    prohibited_shortcuts: ["coverage_percentage_only", "source_text_inspection"],
    ...overrides
  };
}

function migrate(testProofs = [proof()]) {
  return migrateControlledAcceptanceContractV02ToV03({
    contract: clone(baseContract), testProofs
  });
}

function runtimeEvidence(overrides = {}) {
  const candidateArtifact = fixtureArtifact("structured_test_result", "candidate");
  const boundaryArtifact = fixtureArtifact("boundary_trace", "boundary");
  const falsifierArtifact = fixtureArtifact("falsifier_result", "falsifier");
  const candidateArtifactId = candidateArtifact.artifact_id;
  const boundaryArtifactId = boundaryArtifact.artifact_id;
  const falsifierArtifactId = falsifierArtifact.artifact_id;
  const structuredResult = { mechanism: "node_test_structured_events", exit_code: 0,
    summary: { passed: 1, failed: 0, skipped: 0, cancelled: 0, todo: 0, tests: 1 },
    pass_events: [{ type: "test:pass", test_id: `test-${"1".repeat(64)}`,
      name: "component exists", file: "test/example.test.mjs", nesting: 0,
      status: "passed" }], fail_events: [] };
  return {
    schema_version: TEST_PROOF_RUNTIME_EVIDENCE_VERSION_V1,
    test_proof_version: TEST_PROOF_VERSION_V1,
    authority: "advisory_execution_facts",
    evidence_identity: {
      evidence_id: "test-proof-evidence-example-run",
      run_id: "run-example",
      wk_id: "WK-0001",
      selected_unit: "WK-0001#SLICE-001",
      controlled_contract_generation: digest("b"),
      verification_id: "claim-suite-covers-component",
      source_snapshot_digest: digest("a"),
      command_id: "command-node-test",
      command_target: "test/example.test.mjs",
      test_id: "test-component-exists",
      attempt: 1
    },
    contract_binding: {
      contract_digest: digest("b"),
      contract_schema_version: TEST_PROOF_CONTRACT_SCHEMA_VERSION_V03,
      verification_claim_id: "claim-suite-covers-component",
      test_proof_id: "test-proof-suite-covers-component"
    },
    execution_result: { status: "passed", exit_code: 0,
      attempt_id: `attempt-${"a".repeat(64)}`, structured_result: structuredResult,
      evidence_artifact_ids: [candidateArtifactId], provider: {
      provider_id: "launcher.node-test", provider_version: "1.0.0",
      capability: "candidate_execution",
      capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
      observation_mechanism: "node_test_structured_events",
      evidence_artifact_types: ["structured_test_result"]
    } },
    test_inventory: {
      baseline_id: "coverage-baseline-example-suite",
      declared_test_ids: ["test-component-exists"],
      discovered_test_ids: ["test-component-exists"],
      executed_test_ids: ["test-component-exists"],
      skipped_test_ids: [],
      removed_baseline_test_ids: [],
      renamed_baseline_tests: [],
      unexpected_test_ids: [],
      newly_skipped_test_ids: [],
      undispositioned_coverage_test_ids: []
    },
    boundary_traversals: [{
      boundary_id: "sut-boundary-example-component",
      observable_id: "observable-suite-result",
      provider_support: "supported",
      provider: { provider_id: "launcher.node-test-v8-coverage",
        provider_version: "1.0.0", capability: "boundary_traversal",
        capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
        observation_mechanism: "node_test_v8_coverage",
        evidence_artifact_types: ["boundary_trace", "structured_test_result"] },
      authenticated: true,
      boundary_kind: "module", observation_mechanism: "node_test_v8_coverage",
      observation_seam: "node_test_structured_assertion",
      status: "proven",
      evidence_artifact_ids: [boundaryArtifactId]
    }],
    falsifier_executions: [{
      falsifier_id: "falsifier-component-absent",
      attempt_id: `attempt-${"f".repeat(64)}`,
      target_verification_id: "claim-suite-covers-component",
      provider: { provider_id: "launcher.node-test-module-fault", provider_version: "1.0.0",
        capability: "falsifier_execution",
        capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
        observation_mechanism: "node_test_structured_events",
        evidence_artifact_types: ["falsifier_result", "structured_test_result"] },
      isolated: true,
      candidate_status: "passed",
      falsified_status: "failed",
      failure_reason_code: "test_proof_fault.dependency_failure.v1",
      mutation: { mutation_id: "mutation-component-dependency",
        strategy: "dependency_failure", mechanism: "module_substitution",
        target_kind: "module", module_path: "packages/controlled-contract/lib/test-proof-contract.mjs",
        observed: true },
      status: "detected",
      evidence_artifact_ids: [falsifierArtifactId]
    }],
    observed_shortcuts: [],
    artifacts: [boundaryArtifact, falsifierArtifact, candidateArtifact].sort(
      (left, right) => left.artifact_id.localeCompare(right.artifact_id)
    ),
    ...overrides
  };
}

test("publishes the v0.3 schemas and closed package-owned vocabulary", () => {
  assert.equal(TEST_PROOF_CONTRACT_SCHEMA_V03.title,
    TEST_PROOF_CONTRACT_SCHEMA_VERSION_V03);
  assert.equal(TEST_PROOF_CONTRACT_PROFILE_ID_V03,
    "acceptance-contract.standard.experimental.v0.3");
  assert.equal(TEST_PROOF_RUNTIME_EVIDENCE_SCHEMA_V1.title,
    TEST_PROOF_RUNTIME_EVIDENCE_VERSION_V1);
  assert.deepEqual(TEST_PROOF_VOCABULARY.mandatory_prohibited_shortcuts,
    ["source_text_inspection"]);
  assert.ok(TEST_PROOF_VOCABULARY.prohibited_shortcuts.includes(
    "source_text_inspection"));
  assert.equal(TEST_PROOF_VOCABULARY.semantic_authority, "coordinator_owned");
  assert.equal(TEST_PROOF_PROVIDER_CATALOG.providers.length, 3);
  assert.match(TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
    /^sha256:[a-f0-9]{64}$/u);
  assert.ok(Object.isFrozen(TEST_PROOF_VOCABULARY));
});

test("runtime evidence schema compiles under the package strict AJV posture", () => {
  assert.doesNotThrow(() => new Ajv2020({ strict: true, allErrors: true })
    .compile(TEST_PROOF_RUNTIME_EVIDENCE_SCHEMA_V1));
});

test("preserves valid v0.2 carriers under unchanged v0.2 semantics", () => {
  const before = validateAndResolveNativeContractV034(baseContract);
  const throughFamilyValidator = validateTestProofContract(baseContract);
  assert.equal(before.schema_valid, true);
  assert.deepEqual(before.diagnostics, []);
  assert.equal(throughFamilyValidator.contract_family, "v0.2");
  assert.equal(throughFamilyValidator.valid, true);
  assert.equal(throughFamilyValidator.semantic_judgment,
    "not_performed_coordinator_owned");
});

test("migrates deterministically while preserving every v0.2 identity", () => {
  const source = clone(baseContract);
  const first = migrate();
  const second = migrate();
  assert.deepEqual(first, second);
  assert.deepEqual(source, baseContract);
  for (const field of [
    "references", "propositions", "claims", "relations", "collections", "residue", "annotations"
  ]) assert.deepEqual(first[field], source[field]);
  assert.equal(first.schema_version, TEST_PROOF_CONTRACT_SCHEMA_VERSION_V03);
  assert.equal(first.profile_id, TEST_PROOF_CONTRACT_PROFILE_ID_V03);
  assert.equal(first.test_proof_version, TEST_PROOF_VERSION_V1);
  assert.equal(validateTestProofContract(first).valid, true);
  assert.equal(canonicalTestProofContractJson(first), canonicalTestProofContractJson(second));
});

test("migration requires coordinator-authored providers and never invents them", () => {
  const incomplete = proof();
  delete incomplete.candidate_execution_provider;
  assert.throws(() => migrate([incomplete]),
    (error) => error.code === "migration_provider_bindings_required");
  assert.equal(Object.hasOwn(baseContract, "test_proofs"), false);
});

test("runtime test selection is additive and migration never invents it", () => {
  const compatible = migrate();
  assert.equal(validateTestProofContract(compatible).valid, true);
  assert.equal(Object.hasOwn(compatible.test_proofs[0], "runtime_test_selection"), false);

  const selectedTestId = `test-${"1".repeat(64)}`;
  const selected = migrate([proof({
    coverage_disposition: {
      baseline_id: "coverage-baseline-example-suite",
      baseline_state: "complete_executed_inventory",
      items: [{ test_id: selectedTestId, disposition: "preserved" }]
    },
    runtime_test_selection: {
      schema_version: "controlled-contract-runtime-test-selection.v1",
      test_id: selectedTestId
    }
  })]);
  assert.equal(validateTestProofContract(selected).valid, true);
  assert.equal(selected.test_proofs[0].runtime_test_selection.test_id,
    selectedTestId);

  const invalid = clone(selected);
  invalid.test_proofs[0].runtime_test_selection.test_id = `test-${"2".repeat(64)}`;
  assert.equal(validateTestProofContract(invalid).valid, false);
  assert.ok(validateTestProofContract(invalid).diagnostics.some(
    ({ code }) => code === "runtime_test_selection_not_declared"
  ));
});

test("canonicalizes every identity-bearing test-proof population during migration", () => {
  const migrated = migrate([proof({
    system_under_test_boundary: {
      boundary_id: "sut-boundary-example-component", kind: "module",
      runtime_module_path: "packages/controlled-contract/lib/test-proof-contract.mjs",
      subject_reference_ids: ["ref-suite", "ref-component"]
    },
    falsifiers: [
      { falsifier_id: "falsifier-z", strategy: "dependency_failure",
        proposition_id: "prop-component-absent", expected_outcome: "verification_fails",
        mutation: { mutation_id: "mutation-z", mechanism: "module_substitution", target_kind: "module",
          module_path: "packages/controlled-contract/lib/test-proof-contract.mjs" },
        execution_provider: { provider_id: "launcher.node-test-module-fault", provider_version: "1.0.0",
          capability: "falsifier_execution" } },
      { falsifier_id: "falsifier-a", strategy: "dependency_failure",
        proposition_id: "prop-component-absent", expected_outcome: "verification_fails",
        mutation: { mutation_id: "mutation-a", mechanism: "module_substitution", target_kind: "module",
          module_path: "packages/controlled-contract/lib/test-proof-contract.mjs" },
        execution_provider: { provider_id: "launcher.node-test-module-fault", provider_version: "1.0.0",
          capability: "falsifier_execution" } }
    ],
    coverage_disposition: {
      baseline_id: "coverage-baseline-example-suite",
      baseline_state: "complete_executed_inventory",
      items: [
        { test_id: "test-z", disposition: "replaced",
          replacement_test_ids: ["test-z-two", "test-z-one"] },
        { test_id: "test-a", disposition: "retired", reason: "invalid_test" }
      ]
    },
    prohibited_shortcuts: ["source_text_inspection", "coverage_percentage_only"]
  })]);
  const binding = migrated.test_proofs[0];
  assert.deepEqual(binding.system_under_test_boundary.subject_reference_ids,
    ["ref-component", "ref-suite"]);
  assert.deepEqual(binding.falsifiers.map(({ falsifier_id: id }) => id),
    ["falsifier-a", "falsifier-z"]);
  assert.deepEqual(binding.coverage_disposition.items.map(({ test_id: id }) => id),
    ["test-a", "test-z"]);
  assert.deepEqual(binding.coverage_disposition.items[1].replacement_test_ids,
    ["test-z-one", "test-z-two"]);
});

test("requires one complete binding for every and only test_execution claim", () => {
  const missing = migrate();
  missing.test_proofs = [];
  assert.ok(validateTestProofContract(missing).diagnostics.some(
    ({ code }) => code === "missing_test_proof_binding"
  ));

  const nonTest = migrate();
  nonTest.claims.push({
    claim_id: "claim-inspection", kind: "verification", modality: "MUST",
    proposition_id: "prop-suite-covers-component", verification_method: "inspection",
    falsifying_proposition_id: "prop-component-absent"
  });
  nonTest.test_proofs.push({ ...proof(), test_proof_id: "test-proof-inspection",
    verification_claim_id: "claim-inspection" });
  assert.ok(validateTestProofContract(nonTest).diagnostics.some(
    ({ code }) => code === "non_test_execution_binding"
  ));
});

test("rejects incomplete boundary, observable, falsifier, coverage, and shortcut state", () => {
  const cases = [
    (binding) => { delete binding.system_under_test_boundary; },
    (binding) => { delete binding.observable_result; },
    (binding) => { binding.falsifiers = []; },
    (binding) => { delete binding.coverage_disposition; },
    (binding) => { binding.prohibited_shortcuts = ["test_count_only"]; },
    (binding) => { binding.system_under_test_boundary.kind = "invented"; }
  ];
  for (const mutate of cases) {
    const contract = migrate();
    mutate(contract.test_proofs[0]);
    assert.equal(validateTestProofContract(contract).schema_valid, false);
  }
});

test("provider bindings are closed data and reject executable authority", () => {
  for (const [field, value] of [["path", "/tmp/provider.mjs"],
    ["command", "node provider.mjs"], ["argv", ["node"]],
    ["callback", "execute"]]) {
    const contract = migrate();
    contract.test_proofs[0].candidate_execution_provider[field] = value;
    assert.equal(validateTestProofContract(contract).schema_valid, false, field);
  }
  const unknown = migrate();
  unknown.test_proofs[0].candidate_execution_provider.provider_id = "launcher.unknown";
  assert.ok(validateTestProofContract(unknown).diagnostics.some(
    ({code}) => code === "test_proof_provider_unknown"));
});

test("rejects dangling identities and mixed or partially migrated carriers", () => {
  const dangling = migrate();
  dangling.test_proofs[0].observable_result.proposition_id = "prop-missing";
  assert.ok(validateTestProofContract(dangling).diagnostics.some(
    ({ code }) => code === "dangling_observable_proposition"
  ));

  const v02Mixed = { ...clone(baseContract), test_proofs: [] };
  assert.deepEqual(validateTestProofContract(v02Mixed).diagnostics,
    [{ code: "partial_test_proof_migration" }]);
  const v03Partial = migrate();
  delete v03Partial.test_proof_version;
  assert.deepEqual(validateTestProofContract(v03Partial).diagnostics,
    [{ code: "partial_test_proof_migration" }]);
  assert.throws(
    () => migrateControlledAcceptanceContractV02ToV03({ contract: v02Mixed, testProofs: [] }),
    (error) => error instanceof TestProofContractError &&
      error.code === "partial_test_proof_migration"
  );
});

test("mechanical validity never claims semantic correctness", () => {
  const mechanicallyValid = migrate([proof({
    system_under_test_boundary: {
      boundary_id: "sut-boundary-example-component", kind: "module",
      runtime_module_path: "packages/controlled-contract/lib/test-proof-contract.mjs",
      subject_reference_ids: ["ref-suite"]
    },
    observable_result: {
      observable_id: "observable-suite-result", kind: "return_value",
      proposition_id: "prop-component-exists"
    }
  })]);
  const result = validateTestProofContract(mechanicallyValid);
  assert.equal(result.valid, true);
  assert.equal(result.semantic_judgment, "not_performed_coordinator_owned");
});

test("validates deterministic advisory runtime evidence without collecting it", () => {
  const evidence = runtimeEvidence();
  const validation = validateTestProofRuntimeEvidence(evidence);
  assert.equal(validation.valid, true, JSON.stringify(validation));
  assert.equal(Object.hasOwn(evidence.evidence_identity, "timestamp"), false);

  const dangling = runtimeEvidence();
  dangling.boundary_traversals[0].evidence_artifact_ids = ["artifact-missing"];
  assert.ok(validateTestProofRuntimeEvidence(dangling).diagnostics.some(
    ({ code }) => code === "dangling_runtime_evidence_artifact"
  ));
  const nondeterministic = runtimeEvidence();
  nondeterministic.evidence_identity.timestamp = "2026-08-14T00:00:00Z";
  assert.equal(validateTestProofRuntimeEvidence(nondeterministic).schema_valid, false);
  const sourceInspection = runtimeEvidence({ observed_shortcuts: ["source_text_inspection"] });
  assert.equal(validateTestProofRuntimeEvidence(sourceInspection).valid, true);
  assert.deepEqual(sourceInspection.observed_shortcuts, ["source_text_inspection"]);
  const wrongProviderSnapshot = runtimeEvidence();
  wrongProviderSnapshot.execution_result.provider.capability_snapshot_digest = digest("0");
  assert.ok(validateTestProofRuntimeEvidence(wrongProviderSnapshot).diagnostics.some(
    ({code, field}) => code === "runtime_provider_snapshot_digest_mismatch" &&
      field === "/execution_result/provider"
  ));
  const forgedArtifact = runtimeEvidence();
  forgedArtifact.artifacts[0].artifact_id = `artifact-${"f".repeat(64)}`;
  assert.ok(validateTestProofRuntimeEvidence(forgedArtifact).diagnostics.some(
    ({code}) => code === "runtime_artifact_identity_digest_mismatch"
  ));
  const testAuthoredArtifact = runtimeEvidence();
  testAuthoredArtifact.artifacts[0].owner = "test_target";
  assert.equal(validateTestProofRuntimeEvidence(testAuthoredArtifact).schema_valid, false);
});

test("requires runtime evidence identity and selected-unit bindings", () => {
  for (const mutate of [
    (value) => { value.evidence_identity.verification_id = "claim-other"; },
    (value) => { value.evidence_identity.selected_unit = "WK-0002#SLICE-001"; },
    (value) => { value.falsifier_executions[0].target_verification_id = "claim-other"; }
  ]) {
    const value = runtimeEvidence();
    mutate(value);
    const result = validateTestProofRuntimeEvidence(value);
    assert.equal(result.valid, false, JSON.stringify(result));
  }
});

test("requires evidence artifact references to match provider artifact kinds", () => {
  const value = runtimeEvidence();
  value.execution_result.evidence_artifact_ids = [value.artifacts.find(
    ({ kind }) => kind === "boundary_trace").artifact_id];
  const result = validateTestProofRuntimeEvidence(value);
  assert.ok(result.diagnostics.some(({ code, field }) =>
    code === "runtime_evidence_artifact_kind_mismatch" &&
    field === "/execution_result/evidence_artifact_ids"));
});

test("requires mechanically coherent execution status, exit code, and event counts", () => {
  const cases = [
    (value) => { value.execution_result.structured_result.exit_code = 1; },
    (value) => { value.execution_result.structured_result.summary.passed = 2; },
    (value) => { value.execution_result.status = "failed"; },
    (value) => { value.execution_result.structured_result.pass_events[0].status = "failed"; }
  ];
  for (const mutate of cases) {
    const value = runtimeEvidence();
    mutate(value);
    const result = validateTestProofRuntimeEvidence(value);
    assert.equal(result.valid, false, JSON.stringify(result));
  }
});
