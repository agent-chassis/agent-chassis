import assert from "node:assert/strict";
import test from "node:test";

import {
  assertLauncherVerifyProofRoleContext,
  executeLauncherVerifyProofReceiptPopulation
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-verify-proof-capability.mjs";

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

