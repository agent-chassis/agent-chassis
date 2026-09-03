import assert from "node:assert/strict";
import test from "node:test";

import { authenticateTerminalReviewProvenance } from "../../packages/agent-launch-cli/src/lib/wk-forge-terminal-closeout-authentication.mjs";

const C = "a".repeat(40);
const B = "b".repeat(40);
const RECEIPT = `sha256:${"c".repeat(64)}`;

function entry(overrides = {}) {
  return {
    schema_version: "review-provenance.v1",
    repository: "agent-chassis/agent-chassis",
    review_unit: "WK-9004#SLICE-099",
    reviewed_unit: "WK-9004",
    purpose: "terminal_whole_wk",
    role: "reviewer",
    run_id: "run-terminal",
    target_kind: "git_commit_range",
    reviewed_sha: C,
    diff_base_sha: B,
    receipt_digest: RECEIPT,
    terminal_disposition: "succeeded",
    ...overrides
  };
}

function trusted(overrides = {}) {
  return {
    review_run_id: "run-terminal",
    review_unit: "WK-9004#SLICE-099",
    reviewer_role: "reviewer",
    terminal_disposition: "succeeded",
    reviewed_sha: C,
    diff_base_sha: B,
    receipt_digest: RECEIPT,
    ...overrides
  };
}

function authenticate(recordEntry, trustedEntry = trusted(), options = {}) {
  return authenticateTerminalReviewProvenance({
    liveRecord: {
      id: "WK-9004",
      repo: "agent-chassis/agent-chassis",
      slices: [{ id: "SLICE-099", review_purpose: "terminal_whole_wk" }],
      review_provenance: recordEntry === null ? [] : [recordEntry]
    },
    candidateSha: options.candidateSha ?? C,
    baseSha: options.baseSha ?? B,
    reviewSubject: "WK-9004#SLICE-099",
    trustedReviewProvenance: trustedEntry === null ? [] : [trustedEntry]
  });
}

test("forge closeout authenticates exact terminal provenance against immutable receipt identity", () => {
  const result = authenticate(entry());
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.entries.length, 1);
});

test("historical terminal provenance remains append-only without displacing exact C/B", () => {
  const oldEntry = entry({
    run_id: "run-old-candidate",
    reviewed_sha: "d".repeat(40),
    receipt_digest: `sha256:${"d".repeat(64)}`
  });
  const result = authenticateTerminalReviewProvenance({
    liveRecord: {
      id: "WK-9004",
      repo: "agent-chassis/agent-chassis",
      slices: [{ id: "SLICE-099", review_purpose: "terminal_whole_wk" }],
      review_provenance: [oldEntry, entry()]
    },
    candidateSha: C,
    baseSha: B,
    reviewSubject: "WK-9004#SLICE-099",
    trustedReviewProvenance: [trusted()]
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.entries, [entry()]);
});

for (const [name, recordEntry, trustedEntry, options, reason] of [
  ["moved C", entry(), trusted(), { candidateSha: "d".repeat(40) }, "terminal_review_provenance_target_mismatch"],
  ["mismatched B", entry(), trusted(), { baseSha: "d".repeat(40) }, "terminal_review_provenance_target_mismatch"],
  ["foreign run", entry({ run_id: "foreign" }), trusted(), {}, "terminal_review_provenance_receipt_untrusted"],
  ["conflicting receipt", entry(), trusted({ receipt_digest: `sha256:${"e".repeat(64)}` }), {}, "terminal_review_provenance_receipt_untrusted"],
  ["absent trusted publication", entry(), null, {}, "terminal_review_provenance_receipt_untrusted"],
  ["absent ledger publication", null, trusted(), {}, "terminal_review_provenance_absent"]
]) {
  test(`forge closeout refuses ${name} before review-state publication`, () => {
    const result = authenticate(recordEntry, trustedEntry, options);
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
  });
}

test("legacy records without the generated ledger remain compatible", () => {
  const result = authenticateTerminalReviewProvenance({
    liveRecord: {
      id: "WK-1000",
      repo: "agent-chassis/agent-chassis",
      slices: [{ id: "SLICE-099", review_purpose: "terminal_whole_wk" }]
    },
    candidateSha: C,
    baseSha: B,
    reviewSubject: "WK-1000#SLICE-099",
    trustedReviewProvenance: [trusted({
      review_unit: "WK-1000#SLICE-099",
      reviewed_sha: "d".repeat(40)
    })]
  });
  assert.deepEqual(result, { ok: true, legacy: true, entries: [] });
});

test("a missing ledger refuses legacy classification when exact trusted terminal provenance exists", () => {
  const result = authenticateTerminalReviewProvenance({
    liveRecord: {
      id: "WK-9004",
      repo: "agent-chassis/agent-chassis",
      slices: [{ id: "SLICE-099", review_purpose: "terminal_whole_wk" }]
    },
    candidateSha: C,
    baseSha: B,
    reviewSubject: "WK-9004#SLICE-099",
    trustedReviewProvenance: [trusted()]
  });
  assert.deepEqual(result, { ok: false, reason: "terminal_review_provenance_absent" });
});
