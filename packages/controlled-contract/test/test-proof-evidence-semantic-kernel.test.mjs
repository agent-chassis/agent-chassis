import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST } from
  "../lib/test-proof-contract.mjs";
import {
  TestProofEvidenceSemanticKernelError,
  evaluateTestProofEvidenceSemantics
} from "../lib/test-proof-evidence-semantic-kernel.mjs";

const digest = (character) => `sha256:${character.repeat(64)}`;
const selectedTestId = `test-${"1".repeat(64)}`;

function artifact(kind, value) {
  const payload = { fixture: value };
  const content = `sha256:${createHash("sha256").update(
    `${JSON.stringify(payload)}\n`, "utf8"
  ).digest("hex")}`;
  return {
    artifact_id: `artifact-${content.slice(7)}`,
    kind,
    digest: content,
    owner: "launcher",
    payload
  };
}

function provider(providerId, capability, mechanism, artifactTypes) {
  return {
    provider_id: providerId,
    provider_version: "1.0.0",
    capability,
    capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
    observation_mechanism: mechanism,
    evidence_artifact_types: artifactTypes
  };
}

function receipt() {
  const candidate = artifact("structured_test_result", "candidate");
  const boundary = artifact("boundary_trace", "boundary");
  const falsifier = artifact("falsifier_result", "falsifier");
  return {
    schema_version: "controlled-contract-test-proof-runtime-evidence.v2",
    test_proof_version: "controlled-contract-test-proof.v1",
    authority: "advisory_execution_facts",
    evidence_identity: {
      evidence_id: "test-proof-evidence-post-delivery",
      run_id: "run-post-delivery",
      wk_id: "WK-2458",
      selected_unit: "WK-2458#SLICE-008",
      controlled_contract_generation: digest("a"),
      verification_id: "claim-suite-covers-component",
      source_snapshot_digest: digest("b"),
      command_id: "command-node-test",
      command_target: "test/example.test.mjs",
      test_id: selectedTestId,
      attempt: 1
    },
    contract_binding: {
      contract_digest: digest("c"),
      contract_schema_version: "controlled-acceptance-contract.v1",
      verification_claim_id: "claim-suite-covers-component",
      test_proof_id: "test-proof-component"
    },
    execution_result: {
      status: "passed",
      exit_code: 0,
      attempt_id: `attempt-${"a".repeat(64)}`,
      structured_result: {
        mechanism: "node_test_structured_events",
        exit_code: 0,
        summary: {
          passed: 1,
          failed: 0,
          skipped: 0,
          cancelled: 0,
          todo: 0,
          tests: 1
        },
        pass_events: [{
          type: "test:pass",
          test_id: selectedTestId,
          name: "example",
          file: "test/example.test.mjs",
          nesting: 0,
          status: "passed"
        }],
        fail_events: []
      },
      evidence_artifact_ids: [candidate.artifact_id],
      provider: provider("launcher.node-test", "candidate_execution",
        "node_test_structured_events", ["structured_test_result"])
    },
    test_inventory: {
      baseline_id: "coverage-baseline-component",
      declared_test_ids: [selectedTestId],
      discovered_test_ids: [selectedTestId],
      executed_test_ids: [selectedTestId],
      skipped_test_ids: [],
      removed_baseline_test_ids: [],
      renamed_baseline_tests: [],
      unexpected_test_ids: [],
      newly_skipped_test_ids: [],
      undispositioned_coverage_test_ids: []
    },
    boundary_traversals: [{
      boundary_id: "sut-boundary-component",
      observable_id: "observable-component",
      provider_support: "supported",
      provider: provider("launcher.node-test-v8-coverage", "boundary_traversal",
        "node_test_v8_coverage", ["boundary_trace", "structured_test_result"]),
      authenticated: true,
      boundary_kind: "module",
      observation_mechanism: "node_test_v8_coverage",
      observation_seam: "node_test_structured_assertion",
      status: "proven",
      evidence_artifact_ids: [boundary.artifact_id]
    }],
    falsifier_executions: [{
      falsifier_id: "falsifier-component",
      attempt_id: `attempt-${"f".repeat(64)}`,
      target_verification_id: "claim-suite-covers-component",
      provider: provider("launcher.node-test-module-fault", "falsifier_execution",
        "node_test_structured_events", ["falsifier_result", "structured_test_result"]),
      isolated: true,
      candidate_status: "passed",
      falsified_status: "failed",
      failure_reason_code: "test_proof_fault.dependency_failure.v1",
      mutation: {
        mutation_id: "mutation-component",
        strategy: "dependency_failure",
        mechanism: "module_substitution",
        target_kind: "module",
        module_path: "packages/example.mjs",
        observed: true
      },
      status: "detected",
      evidence_artifact_ids: [falsifier.artifact_id]
    }],
    observed_shortcuts: [],
    artifacts: [candidate, boundary, falsifier].sort((left, right) =>
      left.artifact_id.localeCompare(right.artifact_id))
  };
}

function resolution() {
  return {
    status: "executable",
    obligation_id: "AC-001",
    contract_generation: digest("a"),
    contract_digest: digest("c"),
    verification_id: "claim-suite-covers-component",
    declared_target: { target: "test/example.test.mjs" },
    test_proof: {
      test_proof_id: "test-proof-component",
      falsifiers: [{ falsifier_id: "falsifier-component" }],
      prohibited_shortcuts: ["source_text_inspection"]
    }
  };
}

function evaluate(receipts) {
  return evaluateTestProofEvidenceSemantics({
    resolution: resolution(),
    receipts,
    expected: {
      wk_id: "WK-2458",
      selected_unit: "WK-2458#SLICE-008",
      source_snapshot_digest: digest("b"),
      test_id: selectedTestId,
      candidate: {
        kind: "reviewer_frozen_candidate",
        commit: "d".repeat(40),
        source_snapshot_digest: digest("b")
      }
    }
  });
}

test("normalizes complete authenticated positive facts without deciding satisfaction", () => {
  const result = evaluate([receipt()]);
  assert.equal(result.status, "facts");
  assert.equal(result.facts.candidate.passed, true);
  assert.deepEqual(result.facts.inventory.declared_test_ids, [selectedTestId]);
  assert.equal(result.facts.falsifiers.all_detected, true);
  assert.equal(result.facts.traversal.all_proven, true);
  assert.equal(result.receipt_population.count, 1);
  assert.equal(Object.hasOwn(result, "satisfaction"), false);
});

test("preserves complete valid negative facts for the exact evaluator", () => {
  const negative = receipt();
  negative.observed_shortcuts = ["source_text_inspection"];
  const result = evaluate([negative]);
  assert.equal(result.status, "facts");
  assert.deepEqual(result.facts.prohibited_shortcuts.violated,
    ["source_text_inspection"]);
});

test("distinguishes unavailable evidence from corrupt or cross-bound evidence", () => {
  assert.equal(evaluate([]).reason_code,
    "verify_proof.complete_receipts_unavailable.v1");

  const crossBound = receipt();
  crossBound.evidence_identity.source_snapshot_digest = digest("9");
  assert.throws(() => evaluate([crossBound]),
    (error) => error instanceof TestProofEvidenceSemanticKernelError &&
      error.code === "verify_proof.evidence_cross_bound.v1");

  const corrupt = receipt();
  corrupt.artifacts[0].payload.fixture = "corrupt";
  assert.throws(() => evaluate([corrupt]),
    (error) => error.code === "verify_proof.evidence_invalid.v1");
});

test("refuses duplicate and contradictory authenticated populations", () => {
  const duplicate = receipt();
  assert.throws(() => evaluate([duplicate, structuredClone(duplicate)]),
    (error) => error.code === "verify_proof.evidence_population_duplicate.v1");

  const second = receipt();
  second.evidence_identity.evidence_id = "test-proof-evidence-post-delivery-second";
  second.evidence_identity.run_id = "run-post-delivery-second";
  assert.throws(() => evaluate([receipt(), second]),
    (error) => error.code === "verify_proof.evidence_population_contradictory.v1");
});
