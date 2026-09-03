

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  mintBehavioralPreservationPair,
  pairRefusal
} from "../helpers/workspace-agent-behavioral-preservation-fixture.mjs";
import {
  BEHAVIORAL_PRESERVATION_PAIR_REFUSAL_CODES,
  buildBehavioralPreservationEvidencePair
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-behavioral-preservation-evidence.mjs";
import {
  EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION,
  EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V2,
  EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V3,
  PAIRED_BEHAVIORAL_PRESERVATION_RECEIPT_REFUSAL_CODES,
  PAIRED_BEHAVIORAL_PRESERVATION_RECEIPT_SCHEMA_VERSION,
  createExactSliceReviewReceipt,
  createExactSliceReviewReceiptStore,
  extractPairedBehavioralPreservationEvidenceReceipt,
  extractTestProofRuntimeEvidenceReceipt,
  validateExactSliceReviewReceipt
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt.mjs";
import { digestTestProofEvidence } from
  "../../packages/agent-launch-cli/src/lib/workspace-agent-test-proof-evidence.mjs";
import {
  compareStableDeliveryEquivalence,
  deliveryEquivalenceDigest,
  digestTrustedExactReviewEvidence,
  projectStableDeliveryEquivalence
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt-validation.mjs";
import {
  reviseExactSliceReviewReceipt
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt-transitions.mjs";
import {
  buildWorkspaceAgentResultModeEnvelope
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-result-mode.mjs";

function nextProductionInstant(previous) {
  const deadline = Date.now() + 250;
  while (new Date().toISOString() === previous && Date.now() < deadline) {   }
}

test("projects a validated pair into a timed advisory envelope", async (t) => {
  const { baseline, candidate } = await mintBehavioralPreservationPair(t);
  const pair = buildBehavioralPreservationEvidencePair({ baseline, candidate });
  const envelope = extractPairedBehavioralPreservationEvidenceReceipt(pair);
  assert.equal(envelope.schema_version, PAIRED_BEHAVIORAL_PRESERVATION_RECEIPT_SCHEMA_VERSION);
  assert.equal(Object.isFrozen(envelope), true);

  assert.equal(envelope.body_bytes, pair.body_bytes);
  assert.equal(envelope.body_digest, pair.body_digest);
  assert.equal(envelope.body_digest, digestTestProofEvidence(pair.pair_evidence));
  assert.equal(envelope.pair_evidence, pair.pair_evidence);
  assert.equal(envelope.pair_id, pair.pair_id);
  assert.deepEqual(JSON.parse(envelope.body_bytes), pair.pair_evidence);

  assert.match(envelope.produced_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
  assert.equal(envelope.produced_by, "launcher");
  assert.equal(envelope.body_bytes.includes(envelope.produced_at), false);
  assert.equal(Object.hasOwn(JSON.parse(envelope.body_bytes), "produced_at"), false);

  assert.equal(envelope.advisory, true);
  assert.equal(envelope.semantic_judgment, pair.semantic_judgment);
  for (const effect of ["admission_effect", "review_effect", "integration_effect",
    "publication_effect", "proof_credit_effect", "applicability_effect",
    "behavioral_equivalence_effect", "business_semantic_effect", "policy_effect",
    "authority_effect"]) {
    assert.equal(envelope[effect], "none", effect);
  }
});

test("carries one stable body identity across different production times", async (t) => {
  const { baseline, candidate } = await mintBehavioralPreservationPair(t);
  const first = extractPairedBehavioralPreservationEvidenceReceipt(
    buildBehavioralPreservationEvidencePair({ baseline, candidate })
  );
  nextProductionInstant(first.produced_at);
  const second = extractPairedBehavioralPreservationEvidenceReceipt(
    buildBehavioralPreservationEvidencePair({ baseline, candidate })
  );
  assert.notEqual(second.produced_at, first.produced_at);
  assert.equal(second.body_bytes, first.body_bytes);
  assert.equal(second.body_digest, first.body_digest);
  assert.equal(second.pair_id, first.pair_id);
});

test("keeps a changed or reordered core pair distinguishable", async (t) => {
  const { baseline, candidate } = await mintBehavioralPreservationPair(t);
  const forward = extractPairedBehavioralPreservationEvidenceReceipt(
    buildBehavioralPreservationEvidencePair({ baseline, candidate })
  );
  const reversed = extractPairedBehavioralPreservationEvidenceReceipt(
    buildBehavioralPreservationEvidencePair({ baseline: candidate, candidate: baseline })
  );
  assert.notEqual(reversed.body_digest, forward.body_digest);
  assert.notEqual(reversed.body_bytes, forward.body_bytes);
  assert.notEqual(reversed.pair_id, forward.pair_id);
});

test("forwards the core refusal for anything that is not an assembled pair", async (t) => {
  const { baseline, candidate } = await mintBehavioralPreservationPair(t);
  const pair = buildBehavioralPreservationEvidencePair({ baseline, candidate });
  const untrusted = pairRefusal(BEHAVIORAL_PRESERVATION_PAIR_REFUSAL_CODES.EVIDENCE_UNTRUSTED);
  for (const input of [undefined, null, "pair", 7, [pair],

    { ...pair },
    Object.freeze({ ...pair }),
    structuredClone(pair),
    Object.freeze({ ...pair, produced_at: "2026-08-18T00:00:00.000Z" }),
    Object.freeze({ ...pair, body_bytes: "{}\n" }),
    { pair },
    { baseline, candidate },
    pair.pair_evidence]) {
    assert.throws(() => extractPairedBehavioralPreservationEvidenceReceipt(input), untrusted);
  }
});

test("refuses an over-bound call and emits no partial envelope", async (t) => {
  const { baseline, candidate } = await mintBehavioralPreservationPair(t);
  const pair = buildBehavioralPreservationEvidencePair({ baseline, candidate });
  let refused = null;
  try {
    extractPairedBehavioralPreservationEvidenceReceipt(pair,
      { produced_at: "2026-08-18T00:00:00.000Z" });
  } catch (error) {
    refused = error;
  }
  assert.equal(refused?.code,
    PAIRED_BEHAVIORAL_PRESERVATION_RECEIPT_REFUSAL_CODES.INPUT_OVER_BOUND);
  for (const key of ["body_bytes", "body_digest", "pair_evidence", "produced_at"]) {
    assert.equal(Object.hasOwn(refused, key), false, key);
  }
  assert.equal(typeof PAIRED_BEHAVIORAL_PRESERVATION_RECEIPT_REFUSAL_CODES.PROJECTION_FAILED,
    "string");

  const envelope = extractPairedBehavioralPreservationEvidenceReceipt(pair);
  assert.equal(envelope.body_digest, pair.body_digest);
});

test("leaves the exact-slice review receipt schema, validator, and store untouched", async (t) => {
  const { baseline, candidate } = await mintBehavioralPreservationPair(t);
  const envelope = extractPairedBehavioralPreservationEvidenceReceipt(
    buildBehavioralPreservationEvidencePair({ baseline, candidate })
  );
  assert.equal(EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION,
    "workspace-agent-exact-slice-review-receipt.v1");
  assert.equal(EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V2,
    "workspace-agent-exact-slice-review-receipt.v2");
  assert.equal(EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V3,
    "workspace-agent-exact-slice-review-receipt.v3");
  for (const owner of [createExactSliceReviewReceipt, createExactSliceReviewReceiptStore,
    validateExactSliceReviewReceipt]) {
    assert.equal(typeof owner, "function");
  }

  assert.throws(() => validateExactSliceReviewReceipt(envelope),
    /malformed or has an unsupported schema/u);
  for (const field of ["unit_address", "record_id", "slice_id", "receipt_digest",
    "review_run_id", "trusted_evidence_digest", "proof_state"]) {
    assert.equal(Object.hasOwn(envelope, field), false, field);
  }

  const sideReceipt = extractTestProofRuntimeEvidenceReceipt(baseline.attempt);
  assert.equal(sideReceipt.schema_version, "workspace-agent-test-proof-evidence-receipt.v1");
  assert.equal(sideReceipt.evidence_digest, baseline.attempt.evidence_digest);
  assert.equal(Object.hasOwn(sideReceipt, "produced_at"), false);
  assert.equal(Object.hasOwn(sideReceipt, "pair_id"), false);
});

const DELIVERY_UNIT = "WK-2356#SLICE-001";
const DELIVERY_REVIEWED = "a".repeat(40);
const DELIVERY_BASE = "b".repeat(40);

function deliveryReceipt({
  wkSha = DELIVERY_BASE,
  sourceDigest = `sha256:${"4".repeat(64)}`,
  reviewedSha = DELIVERY_REVIEWED,
  changedPaths = ["packages/agent-launch-cli/src/lib/backend-constants.mjs"],
  commitChain = null,
  runId = "delivery-run",
  monitorHandle = "delivery-monitor"
} = {}) {
  const initiative = "IN-0042";
  const recordId = "WK-2356";
  const sliceId = "SLICE-001";
  const worktreePath = "/tmp/wk-2356-slice-001";
  const parentContract = JSON.stringify({ id: recordId, initiative, wk_sha: wkSha });
  const reviewContract = JSON.stringify({ id: sliceId, work_kind: "review" });
  const identityBody = {
    schema_version: "canonical-committed-slice-review-binding.v1",
    unit_address: DELIVERY_UNIT,
    initiative,
    record_id: recordId,
    slice_id: sliceId,
    slice_ref: `refs/heads/slice/${initiative}/${recordId}/${sliceId}`,
    wk_ref: `refs/heads/wk/${initiative}/${recordId}`,
    wk_sha: wkSha,
    reviewed_sha: reviewedSha,
    diff_base_sha: DELIVERY_BASE,
    worktree_path: worktreePath,
    changed_paths: changedPaths,
    write_scope: ["packages/agent-launch-cli/src/lib/backend-constants.mjs"],
    source_digest: sourceDigest,
    commit_chain: commitChain ?? [reviewedSha]
  };
  const committedTargetDigest = digestTrustedExactReviewEvidence(identityBody);
  const identity = { ...identityBody, committed_target_digest: committedTargetDigest };
  return createExactSliceReviewReceipt({
    unit_address: DELIVERY_UNIT,
    record_id: recordId,
    slice_id: sliceId,
    initiative,
    canonical_parent_wk_contract: parentContract,
    canonical_parent_contract_digest: digestTrustedExactReviewEvidence(parentContract),
    slice_review_contract: reviewContract,
    slice_review_contract_digest: digestTrustedExactReviewEvidence(reviewContract),
    review_admission_kind: "canonical_committed_slice",
    committed_target_digest: committedTargetDigest,
    review_run_id: runId,
    review_monitor_handle: monitorHandle,
    reviewer_role: "reviewer",
    slice_ref: identityBody.slice_ref,
    worktree_path: worktreePath,
    worktree_identity: identity,
    worktree_identity_digest: digestTrustedExactReviewEvidence(identity),
    reviewed_sha: reviewedSha,
    diff_base_sha: DELIVERY_BASE,
    terminal_run_status: "launching",
    structured_outcome: null,
    verdict_evidence: "pending"
  });
}

test("parent-WK generation and sibling bookkeeping movement moves the digest, not the delivery", async () => {
  const settled = deliveryReceipt();

  const afterSibling = deliveryReceipt({ wkSha: "c".repeat(40) });
  const afterGeneration = deliveryReceipt({ sourceDigest: `sha256:${"5".repeat(64)}` });

  for (const moved of [afterSibling, afterGeneration]) {

    assert.notEqual(moved.committed_target_digest, settled.committed_target_digest);

    const comparison = compareStableDeliveryEquivalence(settled, moved);
    assert.equal(comparison.equivalent, true);
    assert.deepEqual(comparison.moved_fields, []);
    assert.equal(comparison.left_digest, comparison.right_digest);
  }

  const projection = projectStableDeliveryEquivalence(settled);
  assert.deepEqual(Object.keys(projection).sort(), [
    "changed_paths", "commit_chain", "diff_base_sha", "repository_path",
    "reviewed_sha", "schema_version", "slice_ref", "worktree_binding"
  ]);
  assert.equal(JSON.stringify(projection).includes(settled.committed_target_digest), false);
  assert.equal(JSON.stringify(projection).includes(`sha256:${"4".repeat(64)}`), false,
    "the parent source digest is bookkeeping, not delivery");
});

test("equivalent delivery reuses the one settled result instead of electing a second reviewer", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wk2356-delivery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createExactSliceReviewReceiptStore({
    ensureRuntimeStateDir: async () => ({ ok: true, dir: root })
  });
  const original = deliveryReceipt();
  await store.persist(original);

  const afterSibling = deliveryReceipt({
    wkSha: "c".repeat(40), runId: "delivery-run-2", monitorHandle: "delivery-monitor-2"
  });
  const decision = await store.assessDeliveryEquivalence({
    prior_receipt: original, replacement_receipt: afterSibling
  });
  assert.equal(decision.kind, "supersedable",
    "an unused pre-spawn context whose bytes are unchanged may be superseded");
  assert.deepEqual(decision.moved_fields, []);
  assert.equal(decision.supported_continuation, "consume_selected_result");
});

test("genuine delivery movement returns a closed refusal naming the moved field", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wk2356-delivery-moved-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createExactSliceReviewReceiptStore({
    ensureRuntimeStateDir: async () => ({ ok: true, dir: root })
  });
  const original = deliveryReceipt();
  await store.persist(original);

  const moved = {
    reviewed_sha: deliveryReceipt({
      reviewedSha: "d".repeat(40), runId: "moved-run", monitorHandle: "moved-monitor"
    }),
    changed_paths: deliveryReceipt({
      changedPaths: ["packages/agent-launch-cli/src/lib/backend-constants.mjs",
        "packages/agent-launch-cli/src/lib/backend-routing.mjs"],
      runId: "moved-run-2", monitorHandle: "moved-monitor-2"
    }),
    commit_chain: deliveryReceipt({
      commitChain: [DELIVERY_REVIEWED, "e".repeat(40)],
      runId: "moved-run-3", monitorHandle: "moved-monitor-3"
    })
  };
  for (const [field, replacement] of Object.entries(moved)) {
    const decision = await store.assessDeliveryEquivalence({
      prior_receipt: original, replacement_receipt: replacement
    });
    assert.equal(decision.kind, "refused", field);
    assert.equal(decision.code, "review_delivery_moved", field);
    assert.equal(decision.moved_fields.includes(field), true,
      `${field} must be named: got ${JSON.stringify(decision.moved_fields)}`);
    assert.equal(decision.supported_continuation, "elect_replacement_for_moved_delivery", field);
  }
});

test("a used pre-spawn context is never superseded, however equivalent the delivery", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wk2356-delivery-used-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createExactSliceReviewReceiptStore({
    ensureRuntimeStateDir: async () => ({ ok: true, dir: root })
  });
  const original = deliveryReceipt();
  await store.persist(original);
  await store.persist(reviseExactSliceReviewReceipt(original, {
    terminal_run_status: "failed",
    verdict_evidence: "no_verdict_child_terminal",
    result_mode: buildWorkspaceAgentResultModeEnvelope({ mode: "runtime_failure" })
  }));
  const decision = await store.assessDeliveryEquivalence({
    prior_receipt: original,
    replacement_receipt: deliveryReceipt({
      wkSha: "c".repeat(40), runId: "used-run", monitorHandle: "used-monitor"
    })
  });
  assert.equal(decision.kind, "equivalent_delivery",
    "the bytes match, but a context that already ran is not a pre-spawn context");
});

test("mutation witness: folding the versioned digest into the projection reports false movement", () => {
  const settled = deliveryReceipt();
  const afterSibling = deliveryReceipt({ wkSha: "c".repeat(40) });
  assert.equal(compareStableDeliveryEquivalence(settled, afterSibling).equivalent, true);

  const contaminated = (receipt) => ({
    ...projectStableDeliveryEquivalence(receipt),
    committed_target_digest: receipt.committed_target_digest
  });
  assert.notDeepEqual(contaminated(settled), contaminated(afterSibling));
  assert.equal(
    deliveryEquivalenceDigest(contaminated(settled)) ===
      deliveryEquivalenceDigest(contaminated(afterSibling)),
    false,
    "the contaminated projection is what would elect a second reviewer"
  );
});
