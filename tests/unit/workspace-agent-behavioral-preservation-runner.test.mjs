

import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";

import { mintBehavioralPreservationPair } from
  "../helpers/workspace-agent-behavioral-preservation-fixture.mjs";
import {
  BEHAVIORAL_PRESERVATION_PAIR_REFUSAL_CODES,
  BehavioralPreservationPairError,
  buildBehavioralPreservationEvidencePair
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-behavioral-preservation-evidence.mjs";
import {
  extractPairedBehavioralPreservationEvidenceReceipt
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt.mjs";
import {
  DEFAULT_VALIDATION_TIMEOUT_MS,
  runManagedWorkerDeclaredTest,
  runWorkspaceAgentBehavioralPreservationPair,
  runWorkspaceAgentTestProofAttempt,
  runWorkspaceAgentValidation
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-validation-runner.mjs";
import { digestTestProofEvidence } from
  "../../packages/agent-launch-cli/src/lib/workspace-agent-test-proof-evidence.mjs";

test("returns exactly the composed core-plus-projection result", async (t) => {
  const { baseline, candidate } = await mintBehavioralPreservationPair(t);
  const composed = extractPairedBehavioralPreservationEvidenceReceipt(
    buildBehavioralPreservationEvidencePair({ baseline, candidate })
  );
  const produced = runWorkspaceAgentBehavioralPreservationPair({ baseline, candidate });
  assert.equal(produced.schema_version, composed.schema_version);
  assert.equal(produced.pair_id, composed.pair_id);
  assert.equal(produced.body_bytes, composed.body_bytes);
  assert.equal(produced.body_digest, composed.body_digest);
  assert.deepEqual(produced.pair_evidence, composed.pair_evidence);
  assert.equal(Object.isFrozen(produced), true);

  assert.match(produced.produced_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
  assert.equal(produced.produced_by, "launcher");
  assert.equal(produced.body_bytes.includes(produced.produced_at), false);
  assert.deepEqual(
    Object.keys(produced).sort(),
    Object.keys(composed).sort()
  );
});

test("executes neither side and reaches no worktree", async (t) => {
  const { root, baseline, candidate } = await mintBehavioralPreservationPair(t);

  const before = runWorkspaceAgentBehavioralPreservationPair({ baseline, candidate });
  await rm(root, { recursive: true, force: true });
  const after = runWorkspaceAgentBehavioralPreservationPair({ baseline, candidate });
  assert.equal(after.body_digest, before.body_digest);
  assert.equal(after.body_bytes, before.body_bytes);

  assert.equal(after instanceof Promise, false);
});

test("forwards core and projection refusals unchanged, with no partial result", async (t) => {
  const { baseline, candidate } = await mintBehavioralPreservationPair(t);
  const cases = [
    [{ baseline, candidate: baseline }, BEHAVIORAL_PRESERVATION_PAIR_REFUSAL_CODES.SIDE_DUPLICATE],
    [{ baseline }, BEHAVIORAL_PRESERVATION_PAIR_REFUSAL_CODES.INPUT_ONE_SIDED],
    [{ baseline, candidate: { context: baseline.context } },
      BEHAVIORAL_PRESERVATION_PAIR_REFUSAL_CODES.SIDE_MEMBER_MISSING],
    ["pair", BEHAVIORAL_PRESERVATION_PAIR_REFUSAL_CODES.INPUT_MALFORMED]
  ];
  for (const [input, code] of cases) {
    assert.throws(() => runWorkspaceAgentBehavioralPreservationPair(input),
      (error) => error instanceof BehavioralPreservationPairError && error.code === code, code);
  }

  assert.throws(() => runWorkspaceAgentBehavioralPreservationPair({
    baseline: { context: { ...baseline.context }, attempt: baseline.attempt }, candidate
  }), (error) => !(error instanceof BehavioralPreservationPairError) &&
    error.code === "test_proof_attempt_context_untrusted");

  assert.throws(() => runWorkspaceAgentBehavioralPreservationPair({
    baseline: { context: baseline.context, attempt: { evidence: baseline.attempt.evidence } },
    candidate
  }), (error) => error.code === "test_proof_receipt_projection_invalid");
  let refused = null;
  try {
    runWorkspaceAgentBehavioralPreservationPair({ baseline, candidate: baseline });
  } catch (error) {
    refused = error;
  }
  for (const key of ["body_bytes", "body_digest", "pair_evidence", "produced_at"]) {
    assert.equal(Object.hasOwn(refused, key), false, key);
  }
});

test("refuses caller reports, pair identities, timestamps, and authority substitutes", async (t) => {
  const { baseline, candidate } = await mintBehavioralPreservationPair(t);
  const overBound = (error) => error instanceof BehavioralPreservationPairError &&
    error.code === BEHAVIORAL_PRESERVATION_PAIR_REFUSAL_CODES.INPUT_OVER_BOUND;
  for (const extra of ["report", "pair_id", "produced_at", "authority", "preservation",
    "body_digest", "receipt"]) {
    assert.throws(() => runWorkspaceAgentBehavioralPreservationPair({
      baseline, candidate, [extra]: {}
    }), overBound, extra);
  }
  for (const extra of ["report", "produced_at", "authority"]) {
    assert.throws(() => runWorkspaceAgentBehavioralPreservationPair({
      baseline: { ...baseline, [extra]: {} }, candidate
    }), overBound, extra);
  }

  assert.throws(() => runWorkspaceAgentBehavioralPreservationPair(
    { baseline, candidate }, { produced_at: "2026-08-18T00:00:00.000Z" }
  ), overBound);
  assert.throws(() => runWorkspaceAgentBehavioralPreservationPair(),
    (error) => error instanceof BehavioralPreservationPairError);
});

test("leaves the existing validation-runner entry points unchanged", async () => {
  assert.equal(typeof runWorkspaceAgentValidation, "function");
  assert.equal(typeof runManagedWorkerDeclaredTest, "function");
  assert.equal(DEFAULT_VALIDATION_TIMEOUT_MS, 30000);

  await assert.rejects(() => runWorkspaceAgentTestProofAttempt({
    executeCandidate: async () => ({ status: "passed" })
  }), (error) => error.code === "test_proof_caller_executor_forbidden");
  await assert.rejects(() => runWorkspaceAgentTestProofAttempt({ evidenceIdentity: {} }),
    (error) => error.code === "test_proof_caller_identity_forbidden");
  await assert.rejects(() => runWorkspaceAgentTestProofAttempt({ context: {} }),
    (error) => error.code === "test_proof_attempt_context_untrusted");
  assert.equal(digestTestProofEvidence({ fixture: "c" }).startsWith("sha256:"), true);
});
