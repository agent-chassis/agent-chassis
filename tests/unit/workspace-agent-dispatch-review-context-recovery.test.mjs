import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const backendPath = new URL(
  "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend.mjs",
  import.meta.url
);
import {
  EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V3
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt.mjs";

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
  assert.match(source, /Public advisory evidence projection and separate coordinator continuation/);
});

test("review completion cannot mint admission or call integration", () => {
  const backend = readFileSync(backendPath, "utf8");
  assert.equal(backend.includes("mintSliceReviewAcceptance"), false);
  assert.equal(backend.includes("slice_review_acceptance_mint"), false);
  assert.match(backend, /resolveSliceReviewEvidenceSet: backendContext\.resolveSliceReviewEvidenceSet/);
  assert.match(backend, /requestCommittedSliceIntegration: backendContext\.requestCommittedSliceIntegration/);
});

test("the public exact-review receipt surface publishes the v3 schema identity", () => {
  assert.equal(
    EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V3,
    "workspace-agent-exact-slice-review-receipt.v3"
  );
});
