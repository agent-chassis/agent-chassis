import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import HISTORICAL_SCHEMA_V1 from
  "../../schema/controlled-contract-test-proof-runtime-evidence.v1.schema.json" with { type: "json" };
import {
  TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST
} from "../../lib/test-proof-contract.mjs";
import {
  TEST_PROOF_RUNTIME_EVIDENCE_SCHEMA_V2,
  TEST_PROOF_RUNTIME_EVIDENCE_VERSION_V2,
  validateTestProofRuntimeEvidenceV2
} from "../../lib/test-proof-runtime-evidence-v2.mjs";

const digest = (character) => `sha256:${character.repeat(64)}`;
function artifact(kind, value) {
  const payload = { fixture: value };
  const content = `sha256:${createHash("sha256").update(
    `${JSON.stringify(payload)}\n`, "utf8"
  ).digest("hex")}`;
  return { artifact_id: `artifact-${content.slice(7)}`, kind, digest: content,
    owner: "launcher", payload };
}

function evidence() {
  const candidate = artifact("structured_test_result", "candidate");
  const boundary = artifact("boundary_trace", "boundary");
  const falsifier = artifact("falsifier_result", "falsifier");
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
      structured_result: { mechanism: "node_test_structured_events", exit_code: 0,
        summary: { passed: 1, failed: 0, skipped: 0, cancelled: 0, todo: 0, tests: 1 },
        pass_events: [{ type: "test:pass", test_id: `test-${"1".repeat(64)}`,
          name: "stable", file: "test/stable.test.mjs", nesting: 0, status: "passed" }],
        fail_events: [] },
      evidence_artifact_ids: [candidate.artifact_id],
      provider: { provider_id: "launcher.node-test", provider_version: "1.0.0",
        capability: "candidate_execution",
        capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
        observation_mechanism: "node_test_structured_events",
        evidence_artifact_types: ["structured_test_result"] } },
    test_inventory: { baseline_id: "coverage-baseline-stable",
      declared_test_ids: ["test-component-exists"],
      discovered_test_ids: ["test-component-exists"],
      executed_test_ids: ["test-component-exists"], skipped_test_ids: [],
      removed_baseline_test_ids: [], renamed_baseline_tests: [], unexpected_test_ids: [],
      newly_skipped_test_ids: [], undispositioned_coverage_test_ids: [] },
    boundary_traversals: [{ boundary_id: "sut-boundary-example-component",
      observable_id: "observable-suite-result", provider_support: "supported",
      provider: { provider_id: "launcher.node-test-v8-coverage", provider_version: "1.0.0",
        capability: "boundary_traversal",
        capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
        observation_mechanism: "node_test_v8_coverage",
        evidence_artifact_types: ["boundary_trace", "structured_test_result"] },
      authenticated: true, boundary_kind: "module",
      observation_mechanism: "node_test_v8_coverage",
      observation_seam: "node_test_structured_assertion", status: "proven",
      evidence_artifact_ids: [boundary.artifact_id] }],
    falsifier_executions: [{ falsifier_id: "falsifier-component-absent",
      attempt_id: `attempt-${"f".repeat(64)}`,
      target_verification_id: "claim-suite-covers-component",
      provider: { provider_id: "launcher.node-test-module-fault", provider_version: "1.0.0",
        capability: "falsifier_execution",
        capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
        observation_mechanism: "node_test_structured_events",
        evidence_artifact_types: ["falsifier_result", "structured_test_result"] },
      isolated: true, candidate_status: "passed", falsified_status: "failed",
      failure_reason_code: "test_proof_fault.dependency_failure.v1",
      mutation: { mutation_id: "mutation-component-dependency",
        strategy: "dependency_failure", mechanism: "module_substitution",
        target_kind: "module", module_path: "packages/controlled-contract/lib/example.mjs",
        observed: true }, status: "detected",
      evidence_artifact_ids: [falsifier.artifact_id] }],
    observed_shortcuts: [],
    artifacts: [candidate, boundary, falsifier].sort(
      (left, right) => left.artifact_id < right.artifact_id ? -1 : 1
    )
  };
}

test("runtime-evidence v2 is stable-bound while historical v1 bytes are unchanged", async () => {
  const historicalBytes = await readFile(new URL(
    "../../schema/controlled-contract-test-proof-runtime-evidence.v1.schema.json",
    import.meta.url
  ));
  assert.equal(createHash("sha256").update(historicalBytes).digest("hex"),
    "241e270387b78903b6777cad0e03167682f0ec3e739c64f459978476571ec087");
  assert.equal(HISTORICAL_SCHEMA_V1.title,
    "controlled-contract-test-proof-runtime-evidence.v1");
  assert.equal(HISTORICAL_SCHEMA_V1.$defs.contract_binding.properties
    .contract_schema_version.const,
  "controlled-acceptance-contract.experimental.v0.3");
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
  tampered.artifacts[0].payload.fixture = "tampered";
  const invalid = validateTestProofRuntimeEvidenceV2(tampered);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.diagnostics.diagnostics.some(
    ({ code }) => code === "runtime_artifact_identity_digest_mismatch"
  ));
});
