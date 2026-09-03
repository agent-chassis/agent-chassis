import assert from "node:assert/strict";
import test from "node:test";

import {
  VERIFY_PROOF_EXECUTION_FAILURE_CODES,
  VerifyProofExecutionError,
  executeVerifyProofReceiptPopulation
} from "../../packages/agent-launch-core/src/lib/workspace-agent-verify-proof-capability.mjs";

const TARGET = "tests/example.test.mjs";
const VERIFICATION = "claim-example-verification";

function harness(overrides = {}) {
  const calls = [];
  const evidence = {
    evidence_identity: {
      verification_id: VERIFICATION,
      command_target: TARGET
    },
    execution_population: {
      candidate: 1,
      falsifiers: 2,
      traversals: 1
    }
  };
  const receipt = {
    evidence_identity: {
      verification_id: VERIFICATION,
      command_target: TARGET
    }
  };
  return {
    calls,
    input: {
      proofAuthority: Object.freeze({
        wk_id: "WK-2458",
        worktree_path: "/tmp/wk-2458-candidate",
        candidate_identity: "candidate-one"
      }),
      targets: [TARGET],
      validationBindings: { [TARGET]: [VERIFICATION] },
      resolveBindings: async (args) => {
        calls.push(["resolve", args]);
        return Object.freeze({ status: "complete", bindings: [VERIFICATION] });
      },
      mintAttemptContext: (args) => {
        calls.push(["mint", args]);
        return Object.freeze({ verification_id: args.verificationId });
      },
      runAttempt: async ({ context }) => {
        calls.push(["run", context]);
        return Object.freeze({ evidence });
      },
      extractReceipt: (attempt) => {
        calls.push(["receipt", attempt]);
        return Object.freeze(receipt);
      },
      assertCurrentIdentity: async () => {
        calls.push(["current"]);
      },
      ...overrides
    }
  };
}

test("owns the complete candidate, falsifier, traversal, and receipt population sequence", async () => {
  const { input, calls } = harness();
  const result = await executeVerifyProofReceiptPopulation(input);
  assert.deepEqual(calls.map(([name]) => name),
    ["resolve", "mint", "current", "run", "receipt", "current"]);
  assert.deepEqual(result.evidence_by_target[TARGET][0].execution_population, {
    candidate: 1, falsifiers: 2, traversals: 1
  });
  assert.equal(result.receipts_by_target[TARGET].length, 1);
  assert.equal(result.advisory, true);
  assert.equal(result.admission_effect, "none");
  assert.equal(result.review_effect, "none");
  assert.equal(result.lifecycle_effect, "none");
  assert.equal(Object.isFrozen(result), true);
});

test("refuses caller-selected process and identity inputs before execution", async () => {
  const { input, calls } = harness();
  input.command = "node --test arbitrary.test.mjs";
  await assert.rejects(executeVerifyProofReceiptPopulation(input),
    (error) => error instanceof VerifyProofExecutionError &&
      error.code === VERIFY_PROOF_EXECUTION_FAILURE_CODES.INPUT_INVALID);
  assert.deepEqual(calls, []);

  const duplicate = harness({
    targets: [TARGET, TARGET]
  });
  await assert.rejects(executeVerifyProofReceiptPopulation(duplicate.input),
    (error) => error.code === VERIFY_PROOF_EXECUTION_FAILURE_CODES.INPUT_INVALID);
});

test("uses stable failure codes for binding, context, execution, and receipt boundaries", async () => {
  const cases = [
    ["resolveBindings", async () => { throw new Error("binding"); },
      VERIFY_PROOF_EXECUTION_FAILURE_CODES.BINDING_RESOLUTION],
    ["mintAttemptContext", () => { throw new Error("context"); },
      VERIFY_PROOF_EXECUTION_FAILURE_CODES.ATTEMPT_CONTEXT],
    ["runAttempt", async () => { throw new Error("execution"); },
      VERIFY_PROOF_EXECUTION_FAILURE_CODES.ATTEMPT_EXECUTION],
    ["extractReceipt", () => { throw new Error("receipt"); },
      VERIFY_PROOF_EXECUTION_FAILURE_CODES.RECEIPT_INCOMPLETE]
  ];
  for (const [field, replacement, code] of cases) {
    const { input } = harness({ [field]: replacement });
    await assert.rejects(executeVerifyProofReceiptPopulation(input),
      (error) => error.code === code, field);
  }
});

test("refuses cross-bound evidence and propagates candidate movement unchanged", async () => {
  const crossBound = harness({
    extractReceipt: () => ({ evidence_identity: {
      verification_id: "claim-other",
      command_target: TARGET
    } })
  });
  await assert.rejects(executeVerifyProofReceiptPopulation(crossBound.input),
    (error) => error.code === VERIFY_PROOF_EXECUTION_FAILURE_CODES.RECEIPT_CROSS_BOUND);

  const moved = Object.assign(new Error("candidate moved"), {
    code: "agent_launch.verify_proof.candidate_moved.v1"
  });
  let checks = 0;
  const stale = harness({
    assertCurrentIdentity: async () => {
      checks += 1;
      if (checks === 2) throw moved;
    }
  });
  await assert.rejects(executeVerifyProofReceiptPopulation(stale.input),
    (error) => error === moved);
});
