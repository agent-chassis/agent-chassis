import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const backendPath = new URL(
  "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend.mjs",
  import.meta.url
);
const receiptPath = new URL(
  "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt.mjs",
  import.meta.url
);
const lifecyclePath = new URL(
  "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-lifecycle.mjs",
  import.meta.url
);

test("exact-target reviewer admission has no consumed-context recovery protocol", () => {
  const source = readFileSync(backendPath, "utf8");
  for (const forbidden of [
    "applicable_slice_review_already_active_or_terminal",
    "frozen_slice_review_context_already_consumed",
    "consumed_frozen_slice_review_run_produced_a_verdict",
    "receiptProvesNoReviewVerdict",
    "recoveredSliceReviewRunIds",
    "sliceReviewRecoveryInFlight"
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
  assert.match(source, /sliceReviewRunContexts/);
  assert.match(source, /resolveSliceReviewEvidenceSet/);
  assert.match(source, /review_evidence_semantics: "append_only_advisory"/);
});

test("review completion cannot mint admission or call integration", () => {
  const backend = readFileSync(backendPath, "utf8");
  const lifecycle = readFileSync(lifecyclePath, "utf8");
  for (const source of [backend, lifecycle]) {
    assert.equal(source.includes("mintSliceReviewAcceptance"), false);
    assert.equal(source.includes("slice_review_acceptance_mint"), false);
  }
  const captureStart = backend.indexOf("async function captureSliceReviewTerminalResult");
  const captureEnd = backend.indexOf("async function requestCommittedSliceIntegration", captureStart);
  assert.ok(captureStart >= 0 && captureEnd > captureStart);
  const capture = backend.slice(captureStart, captureEnd);
  assert.equal(capture.includes("canonicalCommittedSliceIntegration("), false);
});

test("new exact-review receipts omit subject-level admission lifecycle fields", () => {
  const source = readFileSync(receiptPath, "utf8");
  assert.match(source, /workspace-agent-exact-slice-review-receipt\.v3/);
  assert.match(source, /field !== "frozen_context_state" && field !== "proof_state"/);
  assert.match(source, /loadAll/);
  assert.match(source, /Append-only evidence enumeration/);
});
