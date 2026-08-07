

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const MANAGED_IDENTITY_RECEIPTS_PATH =
  "packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-managed-identity-receipts.mjs";
const MANAGED_IDENTITY_SUPERSESSION_PATH =
  "packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-managed-identity-supersession.mjs";
const INTEGRATION_CONTINUATION_PATH =
  "packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-integration-continuation.mjs";

test("WK-1712 structural mutation witnesses pin mechanical authorization and exclude review authority", () => {
  const backend = readFileSync(
    path.resolve(MANAGED_IDENTITY_SUPERSESSION_PATH),
    "utf8"
  );
  const supersedeStart = backend.indexOf("async function supersedeProvenDeadAttemptForCorrectiveWorker");
  const supersedeEnd = backend.indexOf("function resolveNoDeliveryRetirementEvidence", supersedeStart);
  const supersede = backend.slice(supersedeStart, supersedeEnd);
  assert.ok(supersedeStart >= 0 && supersedeEnd > supersedeStart);
  for (const proofField of [
    "slice_ref", "frozen_base_sha", "delivered_tip_sha", "commit_chain",
    "committed_target_digest"
  ]) {
    assert.match(supersede, new RegExp(`proof\\.${proofField}`, "u"), proofField);
  }
  assert.match(supersede, /retireManagedRunAndReserveCorrectiveSuccessor/u);
  assert.doesNotMatch(
    supersede,
    /review_outcome|changes_requested|clean_review|reviewer_count|reviewer_agreement/u
  );

  const identity = readFileSync(
    path.resolve("packages/agent-launch-cli/src/lib/managed-run-subject-reservation.mjs"),
    "utf8"
  );

  const correctiveStart = identity.indexOf("export function retireManagedRunAndReserveCorrectiveSuccessor");
  const correctiveEnd = identity.indexOf("export function retireNoCommitAndReserveSuccessor", correctiveStart);
  const corrective = identity.slice(correctiveStart, correctiveEnd);
  assert.ok(correctiveStart >= 0 && correctiveEnd > correctiveStart);
  assert.match(corrective, /retireProvenDeadAndReserveSuccessor\(/u);
  assert.match(corrective, /RETIREMENT_REASONS\.CORRECTIVE_SUPERSESSION/u);

  const successorStart = identity.indexOf("export function retireProvenDeadAndReserveSuccessor");
  const successorEnd = identity.indexOf(
    "export function retireManagedRunAndReserveCorrectiveSuccessor",
    successorStart
  );
  const successor = identity.slice(successorStart, successorEnd);
  assert.ok(successorStart >= 0 && successorEnd > successorStart);
  for (const guard of [
    "retireManagedRunProcessIdentity", "current.reservation_id !== held.reservation_id",
    "sameTuple(current.tuple, normalized)", "replaceAtomically(filePath"
  ]) {
    assert.match(successor, new RegExp(guard.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"), guard);
  }
});

test("WK-1723 SLICE-008 structural witnesses pin holder-less supersession and receipt-gated integrated authentication", () => {
  const receipts = readFileSync(path.resolve(MANAGED_IDENTITY_RECEIPTS_PATH), "utf8");
  const supersession = readFileSync(path.resolve(MANAGED_IDENTITY_SUPERSESSION_PATH), "utf8");
  const slice = (source, startNeedle, endNeedle) => {
    const start = source.indexOf(startNeedle);
    const end = source.indexOf(endNeedle, start);
    assert.ok(start >= 0 && end > start, `${startNeedle} .. ${endNeedle}`);
    return source.slice(start, end);
  };

  const supersede = slice(
    supersession,
    "async function supersedeProvenDeadAttemptForCorrectiveWorker",
    "function resolveNoDeliveryRetirementEvidence"
  );
  for (const mechanism of [
    "retireManagedRunAndReserveCorrectiveSuccessor",
    "retireProvenDeadAndReserveSuccessor",
    "provenDeadSet",
    "priorAttempt.proven_dead_tuples"
  ]) {
    assert.match(supersede, new RegExp(mechanism.replace(/\./gu, "\\."), "u"), mechanism);
  }

  assert.doesNotMatch(
    supersede,
    /review_outcome|changes_requested|clean_review|reviewer_count|reviewer_agreement/u
  );

  assert.doesNotMatch(supersede, /unlinkSync|readReservation|managedRunSubjectReservationFilePath/u);

  assert.doesNotMatch(supersede, /setTimeout|setInterval|while\s*\(|for\s*\(\s*let\s+attempt/u);

  const evidence = slice(
    receipts,
    "async function resolveTrustedCorrectiveReviewEvidence",
    "  // WK-1723#SLICE-008: the INTEGRATED corrective-continuation route."
  );
  assert.match(evidence, /receiptCarriesUsableReviewVerdict/u);

  const evidenceCode = evidence.split("\n")
    .filter((line) => !/^\s*\/\//u.test(line)).join("\n");
  assert.doesNotMatch(
    evidenceCode,
    /CORRECTIVE_REVIEW_OUTCOME|changes_requested|clean_review|review_outcome|no_findings/u,
    "reviewer outcome is not a selector on the receipt authentication path"
  );

  assert.match(evidence, /groupTrustedReviewReceiptsByReviewedIdentity\(corrective\)/u);

  assert.doesNotMatch(evidence, /\.sort\(|corrective\[0\]|RECEIPTS_CONTRADICTORY/u);

  assert.doesNotMatch(evidence, /\.persist\(/u);

  const authenticate = slice(
    receipts,
    "function authenticateCorrectiveReceiptGroup",
    "async function resolveIntegratedCorrectiveContinuationAdmission"
  );
  for (const mechanism of [
    "resolveFrozenSliceReviewReceiptContract",
    "resolveCanonicalIntegratedSliceState",
    "resolveCommittedSliceReviewAdmission",
    "REVIEWED_TARGET_MISMATCH"
  ]) {
    assert.match(authenticate, new RegExp(mechanism, "u"), mechanism);
  }

  for (const bound of ["slice_ref", "reviewed_sha", "diff_base_sha"]) {
    assert.match(authenticate, new RegExp(`identity\\.${bound} !== witness\\.${bound}`, "u"), bound);
  }

  const election = slice(
    receipts,
    "async function resolveIntegratedCorrectiveContinuationAdmission",
    "async function resolveMechanicallyAuthenticatedCorrectiveContinuation"
  );
  assert.match(election, /authenticateCorrectiveReceiptGroup/u);
  assert.match(election, /matched\.length === 1/u, "exactly one matching group is selected");
  assert.match(election, /matched\.length > 1/u, "more than one matching group refuses");
  assert.match(election, /RECEIPTS_CONTRADICTORY/u);
  assert.match(election, /REVIEWED_TARGET_MISMATCH/u, "zero matching groups refuses");
  assert.match(election, /matched\[0\]\.group\.receipts/u,
    "every trusted receipt in the selected group is carried");
  assert.doesNotMatch(election, /\.persist\(|unlinkSync|rmSync|\.sort\(/u);

  const resolver = slice(
    receipts,
    "async function resolveMechanicallyAuthenticatedCorrectiveContinuation",
    "function buildTrustedCorrectiveFindingsContext"
  );
  assert.ok(
    resolver.indexOf("resolveCanonicalSliceReviewUnit") <
      resolver.indexOf("resolveIntegratedCorrectiveContinuationAdmission"),
    "the pre-integration canonical route is attempted before the integrated route"
  );

  const retire = slice(
    supersession,
    "function retireSupersededCorrectiveAttempt",
    "function bindAuthenticatedCorrectiveFindings"
  );
  assert.match(retire, /retireManagedRunProcessIdentity/u);
  assert.match(retire, /RETIREMENT_REASONS\.CORRECTIVE_SUPERSESSION/u);
  assert.doesNotMatch(retire, /unlinkSync|rmSync/u);

  for (const seam of [
    slice(supersession, "const acceptFreshlyReservedSubject", "const first = acquire();"),
    slice(supersession, "const accept = (successor, sourceTuple) =>", "// 1. The exact prior attempt")
  ]) {
    assert.match(seam, /withFreshlyMintedReservation\(/u, "the whole accept body is guarded");

    assert.doesNotMatch(seam, /catch\s*\(/u, "no hand-rolled positional catch remains");
  }
  const guard = slice(
    supersession,
    "const releaseFreshlyMintedReservation",
    "// A proven-dead prior attempt"
  );
  assert.match(guard, /reservationId: reservation\.reservation_id/u,
    "release names the exact reservation this launcher minted");
  assert.doesNotMatch(guard, /tuple/u, "release never matches by tuple, so no winner is touched");
  assert.match(guard, /throw error;/u, "the original authority-bearing error propagates");
  assert.doesNotMatch(guard, /setTimeout|setInterval|while\s*\(/u);
});

test("WK-1723 SLICE-009 structural witnesses pin one shared receipt-grouping definition for both producers", () => {
  const read = (relative) => readFileSync(path.resolve(relative), "utf8");
  const region = (source, startNeedle, endNeedle) => {
    const start = source.indexOf(startNeedle);
    const end = source.indexOf(endNeedle, start);
    assert.ok(start >= 0 && end > start, `${startNeedle} .. ${endNeedle}`);
    return source.slice(start, end);
  };

  const authority = read(
    "packages/agent-launch-cli/src/lib/backend-integrated-scope-authority.mjs"
  );
  const key = region(
    authority,
    "const TRUSTED_REVIEW_RECEIPT_GROUP_KEY_FIELDS",
    "export function groupTrustedReviewReceiptsByReviewedIdentity"
  );
  for (const field of [
    "record_id", "slice_id", "initiative", "slice_ref",
    "reviewed_sha", "diff_base_sha", "committed_target_digest",
    "canonical_parent_contract_digest", "slice_review_contract_digest",
    "canonical_parent_wk_contract", "slice_review_contract"
  ]) {
    assert.match(key, new RegExp(`"${field}"`, "u"), field);
  }

  const grouping = region(
    authority,
    "export function groupTrustedReviewReceiptsByReviewedIdentity",
    "// WK-1723#SLICE-009: the CLOSED canonical normalization"
  );
  assert.doesNotMatch(grouping, /\.sort\(|\.filter\(|new Set\(|slice\(0/u);

  const managed = read(MANAGED_IDENTITY_RECEIPTS_PATH);
  const integration = read(INTEGRATION_CONTINUATION_PATH);
  for (const [label, source] of [["managed", managed], ["integration", integration]]) {
    assert.match(source, /groupTrustedReviewReceiptsByReviewedIdentity/u, label);
    assert.doesNotMatch(source, /canonical_parent_wk_contract,\s*receipt\.slice_review_contract/u,
      `${label} re-derives no grouping key of its own`);
  }

  const warm = region(integration, "async function resolveCorrectiveFindingsContext", "\n  return {");
  assert.match(warm, /groupTrustedReviewReceiptsByReviewedIdentity\(findingsReceipts\)/u);
  assert.match(warm, /matched\.length !== 1/u, "zero or many matching groups is inapplicable");
  assert.match(warm, /elected\.receipts\.flatMap/u, "findings come from the elected group only");
  assert.match(warm, /elected\.receipts\.map/u);

  const warmCode = warm.split("\n").filter((line) => !/^\s*\/\//u.test(line)).join("\n");
  assert.doesNotMatch(warmCode, /findingsReceipts\[0\]|findingsReceipts\.map|findingsReceipts\.flatMap/u,
    "no receipt is elected by position and nothing aggregates across groups");
  assert.doesNotMatch(warmCode, /\.sort\(|\.persist\(/u);
});

test("WK-1723 SLICE-020 structural witnesses pin the reopened-target bootstrap gate", () => {
  const integration = readFileSync(path.resolve(INTEGRATION_CONTINUATION_PATH), "utf8");
  const region = (startNeedle, endNeedle) => {
    const start = integration.indexOf(startNeedle);
    const end = integration.indexOf(endNeedle, start);
    assert.ok(start >= 0 && end > start, `${startNeedle} .. ${endNeedle}`);
    return integration.slice(start, end);
  };

  const code = (source) => source.split("\n").filter((line) => !/^\s*\/\//u.test(line)).join("\n");

  const gate = code(region(
    "function isCanonicalCorrectiveContinuationTuple",
    "\n  async function resolveCorrectiveFindingsContext"
  ));
  assert.match(gate, /resolveCanonicalSliceIntegrationUnit\(/u,
    "the current state is resolved through the canonical lifecycle-neutral authority");
  assert.match(gate, /parent_status === "active"/u);
  assert.match(gate, /status === "todo"/u);

  assert.doesNotMatch(gate, /catch\s*\(|try\s*\{|\.message|\.stack|RegExp|\.match\(|\?\?/u,
    "no catch-all, no message parsing, and no malformed-record fallback");

  assert.doesNotMatch(
    gate,
    /receipt|slice_ref|reviewed_sha|diff_base_sha|runGit|reservation|committed_target_digest|resolveCommittedSliceReviewAdmission/u,
    "the gate consults no receipt, ref, object, identity, reservation, or admission fact"
  );

  const warm = code(region(
    "async function resolveCorrectiveFindingsContext",
    "\n  return {"
  ));
  assert.match(warm, /if \(isCanonicalCorrectiveContinuationTuple\(subject\)\) return null;/u,
    "a reopened corrective target is inapplicable, not a throw and not a review unit");
  assert.ok(
    warm.indexOf("isCanonicalCorrectiveContinuationTuple") <
      warm.indexOf("resolveCanonicalSliceReviewUnit"),
    "the gate is evaluated before the review-only resolver, not after its throw"
  );
  assert.match(warm, /resolveCanonicalSliceReviewUnit\(worktreeProvisioningConfig\.mainRepo, subject\)/u,
    "the review-only resolution is preserved verbatim for a genuine slice-review contract");
  assert.doesNotMatch(warm, /catch\s*\(|try\s*\{/u,
    "no arbitrary error is caught or suppressed on this route");

  assert.doesNotMatch(warm, /resolveCommittedSliceReviewAdmission/u);
});
