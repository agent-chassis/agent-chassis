import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST
} from "../../lib/test-proof-provider-registry.mjs";
import {
  TEST_PROOF_RUNTIME_EVIDENCE_SCHEMA_V2,
  TEST_PROOF_RUNTIME_EVIDENCE_VERSION_V2,
  validateTestProofRuntimeEvidenceV2
} from "../../lib/test-proof-runtime-evidence-v2.mjs";

const digest = (character) => `sha256:${character.repeat(64)}`;
const canonical = item => Array.isArray(item) ? item.map(canonical)
  : item && typeof item === "object" ? Object.fromEntries(Object.keys(item).sort()
    .map(key => [key, canonical(item[key])])) : item;
function artifact(kind, value) {
  const payload = canonical(value);
  const content = `sha256:${createHash("sha256").update(
    `${JSON.stringify(payload)}\n`, "utf8"
  ).digest("hex")}`;
  return { artifact_id: `artifact-${content.slice(7)}`, kind, digest: content,
    owner: "launcher", payload };
}

const structuredResult = () => ({ mechanism: "node_test_structured_events", exit_code: 0,
  summary: { passed: 1, failed: 0, skipped: 0, cancelled: 0, todo: 0, tests: 1 },
  pass_events: [{ type: "test:pass", test_id: `test-${"1".repeat(64)}`,
    name: "stable", file: "test/stable.test.mjs", nesting: 0, status: "passed" }],
  fail_events: [] });

function evidence() {

  const candidate = artifact("structured_test_result", structuredResult());

  const boundary = artifact("boundary_trace", { mechanism: "node_test_v8_coverage",
    boundary_kind: "module", module_path: "packages/controlled-contract/lib/example.mjs",
    observable_seam: "node_test_structured_assertion", target_test_id: "test-component-exists",
    target_pass_observed: true, observed: true,
    covered_module_paths: ["packages/controlled-contract/lib/example.mjs"],
    structured_event_digest: candidate.digest });
  const falsifier = artifact("falsifier_result", { mechanism: "module_substitution",
    strategy: "dependency_failure", mutation_id: "mutation-component-dependency",
    target_module_path: "packages/controlled-contract/lib/example.mjs",
    target_test_id: "test-component-exists", witness_identity: "f".repeat(64),
    structured_event_digest: candidate.digest,
    observation: { dependency_invocation_count: 1, reached_assertion: true,
      selected_test_only: true, observed: true } });
  return {
    schema_version: TEST_PROOF_RUNTIME_EVIDENCE_VERSION_V2,
    test_proof_version: "controlled-contract-test-proof.v1",
    authority: "advisory_execution_facts",
    evidence_identity: { evidence_id: "test-proof-evidence-stable-run",
      run_id: "run-stable", wk_id: "WK-2084", selected_unit: "WK-2084#SLICE-008",
      controlled_contract_generation: digest("b"),
      verification_id: "claim-suite-covers-component",
      source_snapshot_digest: digest("a"), command_id: "command-node-test",
      command_target: "test/stable.test.mjs", test_id: "test-component-exists",
      attempt: 1 },
    contract_binding: { contract_digest: digest("b"),
      contract_schema_version: "controlled-acceptance-contract.v1",
      verification_claim_id: "claim-suite-covers-component",
      test_proof_id: "test-proof-suite-covers-component" },
    execution_result: { status: "passed", exit_code: 0,
      attempt_id: `attempt-${"a".repeat(64)}`,
      structured_result: structuredResult(),
      evidence_artifact_ids: [candidate.artifact_id],
      provider: { provider_id: "launcher.node-test", provider_version: "1.0.0",
        capability: "candidate_execution",
        capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
        observation_mechanism: "node_test_structured_events",
        evidence_artifact_types: ["structured_test_result"] } },
    test_inventory: { selected_test_id: "test-component-exists",
      declared_test_ids: ["test-component-exists"],
      discovered_test_ids: ["test-component-exists"],
      executed_test_ids: ["test-component-exists"], skipped_test_ids: [] },
    boundary_traversals: [{ boundary_id: "sut-boundary-example-component",
      observable_id: "observable-suite-result", provider_support: "supported",
      provider: { provider_id: "launcher.node-test-v8-coverage", provider_version: "1.0.0",
        capability: "boundary_traversal",
        capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
        observation_mechanism: "node_test_v8_coverage",
        evidence_artifact_types: ["boundary_trace", "structured_test_result"] },
      authenticated: true, boundary_kind: "module",
      observation_mechanism: "node_test_v8_coverage",
      observation_seam: "node_test_structured_assertion", status: "proven", limitation: null,
      evidence_artifact_ids: [boundary.artifact_id] }],
    falsifier_executions: [{ falsifier_id: "falsifier-component-absent",
      attempt_id: `attempt-${"f".repeat(64)}`,
      target_verification_id: "claim-suite-covers-component",
      provider: { provider_id: "launcher.node-test-module-fault", provider_version: "2.0.0",
        capability: "falsifier_execution",
        capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
        observation_mechanism: "node_test_structured_events",
        evidence_artifact_types: ["falsifier_result", "structured_test_result"] },
      provider_support: "supported",
      isolated: true, candidate_status: "passed", falsified_status: "failed",
      failure_reason_code: "test_proof_fault.dependency_failure.v1",
      mutation: { mutation_id: "mutation-component-dependency",
        strategy: "dependency_failure", mechanism: "module_substitution",
        target_kind: "module", module_path: "packages/controlled-contract/lib/example.mjs",
        observed: true }, status: "detected", limitation: null,
      evidence_artifact_ids: [falsifier.artifact_id] }],
    capability_limitations: [],
    observed_shortcuts: [],
    artifacts: [candidate, boundary, falsifier].sort(
      (left, right) => left.artifact_id < right.artifact_id ? -1 : 1
    )
  };
}

test("runtime-evidence v2 is stable-bound to the selected-test inventory", () => {
  assert.deepEqual(TEST_PROOF_RUNTIME_EVIDENCE_SCHEMA_V2.$defs.test_inventory.required, [
    "selected_test_id", "declared_test_ids", "discovered_test_ids",
    "executed_test_ids", "skipped_test_ids"
  ]);
  assert.equal(TEST_PROOF_RUNTIME_EVIDENCE_SCHEMA_V2.$defs.test_inventory
    .additionalProperties, false);
  assert.equal(TEST_PROOF_RUNTIME_EVIDENCE_SCHEMA_V2.title,
    TEST_PROOF_RUNTIME_EVIDENCE_VERSION_V2);
  assert.equal(TEST_PROOF_RUNTIME_EVIDENCE_SCHEMA_V2.$defs.contract_binding.properties
    .contract_schema_version.const, "controlled-acceptance-contract.v1");
});

test("runtime-evidence v2 validates identity-bound provider and artifact facts", () => {
  const valid = validateTestProofRuntimeEvidenceV2(evidence());
  assert.equal(valid.valid, true, JSON.stringify(valid));
  const substituted = evidence();
  substituted.contract_binding.contract_schema_version =
    "controlled-acceptance-contract.experimental.v0.3";
  assert.equal(validateTestProofRuntimeEvidenceV2(substituted).schema_valid, false);
  const tampered = evidence();
  tampered.artifacts.find(({ kind }) => kind === "falsifier_result").payload.fixture = "tampered";
  const invalid = validateTestProofRuntimeEvidenceV2(tampered);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.diagnostics.diagnostics.some(
    ({ code }) => code === "runtime_artifact_identity_digest_mismatch"
  ));
});

test("runtime-evidence v2 admits forced strategy and validates its closed observation artifact", () => {
  const value = evidence();
  const row = value.falsifier_executions[0];
  row.mutation.strategy = "forced_invocation";
  row.failure_reason_code = "test_proof_fault.forced_invocation.v1";
  const payload = {
    mechanism: "module_substitution", strategy: "forced_invocation",
    mutation_id: row.mutation.mutation_id, target_module_path: row.mutation.module_path,
    entry_export: "run", operation: { module_path: "operations.mjs", export_name: "forbidden" },
    invocation: "first_original_return_no_arguments", attempt_nonce: "a".repeat(64),
    fault_module_identity: "runtime-module-forced", observer_module_path: row.mutation.module_path,
    witness_identity: "b".repeat(64), target_test_id: "test-component-exists",
    structured_event_digest: digest("c"), observation: {
      original_entry_count: 1, operation_entry_count: 1, inspector_original_entry_count: 1,
      inspector_ordered_operation_count: 1, invalid_order_count: 0, inspection_failure_count: 0,
      reached_assertion: true, selected_test_only: true, observed: true
    }
  };

  function withPayload(changed) {
    const candidate = structuredClone(value);
    const old = candidate.artifacts.find(item => item.kind === "falsifier_result");
    old.payload = canonical(changed);
    old.digest = `sha256:${createHash("sha256").update(`${JSON.stringify(old.payload)}\n`).digest("hex")}`;
    old.artifact_id = `artifact-${old.digest.slice(7)}`;
    candidate.falsifier_executions[0].evidence_artifact_ids = [old.artifact_id];
    candidate.artifacts.sort((a, b) => a.artifact_id.localeCompare(b.artifact_id));
    return candidate;
  }
  assert.equal(validateTestProofRuntimeEvidenceV2(withPayload(payload)).valid, true);

  const reachedSelectedPass = structuredClone(payload);
  reachedSelectedPass.observation.reached_assertion = false;
  assert.equal(validateTestProofRuntimeEvidenceV2(withPayload(reachedSelectedPass)).valid, true);
  const unreached = structuredClone(payload);
  Object.assign(unreached.observation, { original_entry_count: 0, operation_entry_count: 0,
    inspector_original_entry_count: 0, inspector_ordered_operation_count: 0,
    reached_assertion: true, observed: false });

  const unreachedDetected = validateTestProofRuntimeEvidenceV2(withPayload(unreached));
  assert.equal(unreachedDetected.valid, false);
  assert.ok(unreachedDetected.diagnostics.diagnostics.some(
    ({ code }) => code === "runtime_falsifier_launcher_evidence_missing"));
  const unreachedNotDetected = withPayload(unreached);
  unreachedNotDetected.falsifier_executions[0].status = "not_detected";
  unreachedNotDetected.falsifier_executions[0].mutation.observed = false;
  assert.equal(validateTestProofRuntimeEvidenceV2(unreachedNotDetected).valid, true);
  for (const mutate of [
    item => { delete item.operation; },
    item => { item.invocation = "pre_entry"; },
    item => { item.operation.source = "untrusted"; },
    item => { item.observation.original_entry_count = 0; },
    item => { item.observation.operation_entry_count = 0; },
    item => { item.observation.inspector_original_entry_count = 0; },
    item => { item.observation.inspector_ordered_operation_count = 0; },
    item => { item.observation.invalid_order_count = 1; },
    item => { item.observation.inspection_failure_count = 1; },
    item => { item.observation.selected_test_only = false; },
    item => { item.observation.reached_assertion = false; item.observation.invalid_order_count = 1; },
    item => { item.observation.dependency_invocation_count = 1; }
  ]) {
    const changed = structuredClone(payload);
    mutate(changed);
    assert.equal(validateTestProofRuntimeEvidenceV2(withPayload(changed)).valid, false);
  }
});
