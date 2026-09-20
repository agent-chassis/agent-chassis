import assert from "node:assert/strict";
import test from "node:test";

import {
  assertLauncherVerifyProofRoleContext,
  executeLauncherVerifyProofReceiptPopulation
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-verify-proof-capability.mjs";
import {
  buildWorkerDeclaredTestSuccess,
  projectWorkerProofBindingPopulation
} from "../../packages/wiki-mcp/src/lib/worker-declared-test-tool.mjs";

const TARGET = "tests/worker-proof.test.mjs";
const VERIFICATION = "claim-worker-proof";
const CANDIDATE = "run-worker-proof";

function execution(overrides = {}) {
  return {
    roleContext: { managed: true, role: "worker", candidate_identity: CANDIDATE },
    proofAuthority: {
      run_id: CANDIDATE,
      wk_id: "WK-2458",
      worktree_path: "/tmp/worker-proof"
    },
    targets: [TARGET],
    validationBindings: { [TARGET]: [VERIFICATION] },
    resolveBindings: async () => ({ status: "complete" }),
    mintAttemptContext: ({ target, verificationId }) => ({ target, verificationId }),
    runAttempt: async ({ context }) => ({ evidence: { evidence_identity: {
      verification_id: context.verificationId,
      command_target: context.target
    } } }),
    extractReceipt: ({ evidence }) => ({ evidence_identity: {
      verification_id: evidence.evidence_identity.verification_id,
      command_target: evidence.evidence_identity.command_target
    } }),
    ...overrides
  };
}

test("worker adapter is limited to launcher-managed eligible roles", () => {
  assert.equal(assertLauncherVerifyProofRoleContext({
    managed: true, role: "worker", candidate_identity: CANDIDATE
  }).role, "worker");
  for (const context of [
    { managed: false, role: "worker", candidate_identity: CANDIDATE },
    { managed: true, role: "operator", candidate_identity: CANDIDATE },
    { managed: true, role: "worker", candidate_identity: CANDIDATE, command: "node" }
  ]) {
    assert.throws(() => assertLauncherVerifyProofRoleContext(context),
      (error) => error.code === "agent_launch.verify_proof.role_context_ineligible.v1");
  }
});

test("worker adapter binds execution to its exact launcher candidate", async () => {
  const result = await executeLauncherVerifyProofReceiptPopulation(execution());
  assert.equal(result.role, "worker");
  assert.equal(result.candidate_identity, CANDIDATE);
  assert.equal(result.independent_execution, false);
  assert.equal(result.receipts_by_target[TARGET].length, 1);

  await assert.rejects(executeLauncherVerifyProofReceiptPopulation(execution({
    proofAuthority: {
      run_id: "run-other",
      wk_id: "WK-2458",
      worktree_path: "/tmp/worker-proof"
    }
  })), (error) => error.code === "agent_launch.verify_proof.candidate_binding_mismatch.v1");
});

test("worker adapter inherits target confinement and arbitrary-process refusal", async () => {
  await assert.rejects(executeLauncherVerifyProofReceiptPopulation(execution({
    validationBindings: { "tests/other.test.mjs": [VERIFICATION] }
  })), (error) => error.code === "agent_launch.verify_proof.input_invalid.v1");
  await assert.rejects(executeLauncherVerifyProofReceiptPopulation({
    ...execution(),
    command: "node --test arbitrary.test.mjs"
  }), (error) => error.code === "agent_launch.verify_proof.input_invalid.v1");
});

test("worker projects the declarative selector of every bound proof and nothing executed", () => {
  const binding = {
    test_proof_id: "test-proof-worker",
    verification_claim_id: VERIFICATION,
    test_selector: { name: "worker proof passes", nesting: 1 }
  };
  const population = projectWorkerProofBindingPopulation({
    verificationIds: [VERIFICATION],
    selection: { bindings: [binding] }
  });
  assert.deepEqual(population, { status: "complete", bindings: [{
    verification_id: VERIFICATION,
    test_proof_id: "test-proof-worker",
    test_selector: { name: "worker proof passes", nesting: 1 }
  }] });
  assert.equal(Object.isFrozen(population.bindings[0]), true);
  assert.equal(JSON.stringify(population).includes("test_id"), false);

  assert.equal(projectWorkerProofBindingPopulation({
    verificationIds: [VERIFICATION], selection: { bindings: [] }
  }), null);
  assert.equal(projectWorkerProofBindingPopulation({
    verificationIds: [VERIFICATION], selection: { bindings: [binding, binding] }
  }), null);
  assert.equal(projectWorkerProofBindingPopulation({
    verificationIds: [VERIFICATION, "claim-other"], selection: { bindings: [binding] }
  }), null);

  const result = buildWorkerDeclaredTestSuccess({
    workspaceRepo: "agent-chassis/agent-chassis",
    assignedUnit: "WK-2458#SLICE-003",
    authorizedTargets: [TARGET],
    verificationIds: [VERIFICATION],
    result: { ran: true, ok: true },
    target: TARGET
  });
  assert.equal(result.ran, true);
  assert.equal(result.ok, true);
  assert.equal(Object.hasOwn(result, "test_proof_runtime_evidence"), false);
  assert.equal(Object.hasOwn(result, "proof_execution_readiness"), false);
  const withEvidence = buildWorkerDeclaredTestSuccess({
    workspaceRepo: "agent-chassis/agent-chassis",
    assignedUnit: "WK-2458#SLICE-003",
    authorizedTargets: [TARGET],
    verificationIds: [VERIFICATION],
    testProofRuntimeEvidence: [],
    result: { ran: true, ok: true },
    target: TARGET
  });
  assert.deepEqual(withEvidence.test_proof_runtime_evidence, []);
});
