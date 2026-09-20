

import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCapabilityLimitation,
  projectBoundaryTraversal,
  projectCapabilityLimitations,
  projectFalsifierExecution
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-test-proof-evidence.mjs";
import {
  authenticateUnsupportedTestProofFalsification,
  authenticateUnsupportedTestProofTraversal
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-test-proof-provider-registry.mjs";
import { falsifierResult, proofCapabilityLimitation } from
  "../../packages/agent-launch-cli/src/lib/test-execution/proof-providers/execution.mjs";
import { TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST } from
  "../../packages/controlled-contract/current.mjs";

const REGISTRY = Object.freeze({ mode: "registry_unsupported",
  registry_id: "launcher.test-proof-provider-registry", registry_version: "1.3.0" });

const falsifierProvider = Object.freeze({
  provider_id: "launcher.go-test-scalar-return", provider_version: "1.0.0",
  capability: "falsifier_execution",
  capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
  observation_mechanism: "scalar_return_substitution",
  evidence_artifact_types: ["falsifier_result"]
});

const declaredMutation = Object.freeze({ mutation_id: "mutation-answer",
  strategy: "result_inversion", mechanism: "scalar_return_substitution",
  target_kind: "function", module_path: "calc/answer.go" });

const run = (observation) => ({ ran: false, disposition: "not_run",
  test_proof_observation: observation });

test("a provider refusal of a declared shape is a limitation; an execution failure is not", () => {

  assert.deepEqual(proofCapabilityLimitation(run({ valid: false,
    code: "test_proof_native_instrumentation_unsupported",
    detail: { reason: "body_not_single_scalar_return", path: "/operator/checkout/calc/answer.go" } })),
  { reason_code: "test_proof_native_instrumentation_unsupported",
    detail: { reason: "body_not_single_scalar_return" } });

  for (const code of ["test_runtime_runner_not_prepared", "test_proof_native_runtime_inputs_stale",
    "test_proof_execution_timed_out", "test_proof_selected_identity_not_observed"]) {
    assert.equal(proofCapabilityLimitation(run({ valid: false, code })), null, code);
  }

  assert.equal(proofCapabilityLimitation(run({ valid: true, status: "skipped" })), null);
  assert.equal(proofCapabilityLimitation(undefined), null);
});

test("a malformed replacement is proof data to correct, not a capability gap", () => {
  const refusal = (detail) => run({ valid: false,
    code: "test_proof_native_instrumentation_unsupported", detail });

  for (const detail of [{ reason: "replacement_not_scalar" },
    { reason: "replacement_kind_incompatible", original_kind: "integer", replacement_kind: "string" },
    { reason: "replacement_not_distinct" }]) {
    assert.equal(proofCapabilityLimitation(refusal(detail)), null, detail.reason);
    const projected = falsifierResult({ observation: refusal(detail).test_proof_observation,
      run: refusal(detail), artifacts: [], provider: falsifierProvider });

    assert.equal(projected.limitation, null, detail.reason);
    assert.equal(projected.status, "skipped", detail.reason);
    assert.equal(projected.mutation_observed, false, detail.reason);
  }

  for (const reason of ["function_absent", "function_not_unique", "source_unparsable"]) {
    assert.deepEqual(proofCapabilityLimitation(refusal({ reason })),
      { reason_code: "test_proof_native_instrumentation_unsupported", detail: { reason } }, reason);
  }
});

test("a refused falsifier records its declaration and earns no detection credit", () => {
  const limitation = { reason_code: "test_proof_native_instrumentation_unsupported",
    detail: { reason: "body_not_single_scalar_return" } };
  const projected = projectFalsifierExecution({
    falsifierId: "falsifier-answer", attemptId: `attempt-${"a".repeat(64)}`,
    targetVerificationId: "claim-answer", candidateStatus: "passed",
    mutation: declaredMutation, provider: falsifierProvider, limitation
  });
  assert.equal(projected.status, "review_only");
  assert.equal(projected.provider_support, "unsupported");
  assert.equal(projected.falsified_status, "not_run");
  assert.equal(projected.isolated, false);
  assert.equal(projected.failure_reason_code, null);
  assert.equal(projected.mutation.observed, false);
  assert.deepEqual(projected.evidence_artifact_ids, []);

  assert.equal(projected.mutation.module_path, "calc/answer.go");
  assert.deepEqual(projected.limitation, limitation);
});

test("a supported falsifier keeps its incumbent detection semantics", () => {
  const detected = projectFalsifierExecution({
    falsifierId: "falsifier-answer", attemptId: `attempt-${"a".repeat(64)}`,
    targetVerificationId: "claim-answer", expectedFailureReasonCode: "test_proof_fault.result_inversion.v1",
    observedFailureReasonCode: "test_proof_fault.result_inversion.v1",
    isolated: true, candidateStatus: "passed", falsifiedStatus: "failed", mutationObserved: true,
    mutation: declaredMutation, provider: falsifierProvider
  });
  assert.equal(detected.status, "detected");
  assert.equal(detected.provider_support, "supported");
  assert.equal(detected.limitation, null);
});

test("the two unsupported-traversal origins stay distinguishable", () => {
  const attestation = authenticateUnsupportedTestProofTraversal(REGISTRY);
  const declared = projectBoundaryTraversal({ boundaryId: "sut-boundary-answer",
    observableId: "observable-answer", providerSupport: "unsupported",
    providerAttestation: attestation });
  assert.equal(declared.observation_mechanism, "registry_unsupported");
  assert.equal(declared.authenticated, true);
  assert.equal(declared.limitation, null);

  const limitation = { reason_code: "test_proof_native_selection_unsupported", detail: null };
  const refused = projectBoundaryTraversal({ boundaryId: "sut-boundary-answer",
    observableId: "observable-answer", providerSupport: "unsupported",
    boundaryKind: "module", observationMechanism: "function_entry_probe",
    observationSeam: "go_selected_test_function", limitation,
    provider: { ...falsifierProvider, capability: "boundary_traversal" } });
  assert.equal(refused.status, "review_only");

  assert.equal(refused.authenticated, false);
  assert.equal(refused.observation_seam, null);
  assert.deepEqual(refused.limitation, limitation);
  assert.deepEqual(refused.evidence_artifact_ids, []);

  assert.throws(() => projectBoundaryTraversal({ boundaryId: "sut-boundary-answer",
    observableId: "observable-answer", providerSupport: "unsupported" }),
  (error) => error.code === "test_proof_provider_registry.execution_untrusted.v1");
});

test("a limitation carries a provider-owned or registry-owned reason and nothing else", () => {
  assert.deepEqual(
    assertCapabilityLimitation(authenticateUnsupportedTestProofFalsification(REGISTRY)),
    { reason_code: "test_proof_registry_falsification_unsupported", detail: null });
  assert.throws(() => authenticateUnsupportedTestProofFalsification({ ...REGISTRY,
    registry_version: "9.9.9" }),
  (error) => error.code === "test_proof_provider_registry.binding_invalid.v1");
  for (const invalid of [null, {}, { reason_code: "test_proof_execution_timed_out" },
    { reason_code: "test_proof_native_runner_unsupported", detail: { reason: "/an/operator/path" } }]) {
    assert.throws(() => assertCapabilityLimitation(invalid),
      (error) => error.code === "test_proof_capability_limitation_invalid",
      JSON.stringify(invalid));
  }
});

test("the limitation population is ordered and each member names its check", () => {
  const projected = projectCapabilityLimitations([
    { check_kind: "traversal", check_id: "sut-boundary-answer",
      reason_code: "test_proof_native_selection_unsupported", detail: null },
    { check_kind: "falsifier", check_id: null,
      reason_code: "test_proof_registry_falsification_unsupported", detail: null }
  ]);
  assert.deepEqual(projected.map(({ check_kind: kind }) => kind), ["falsifier", "traversal"]);
  assert.deepEqual(projectCapabilityLimitations([]), []);
});
