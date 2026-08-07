

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  resolveCommittedSliceReviewAdmission
} from "../packages/agent-launch-cli/src/lib/committed-slice-review-admission.mjs";
import {
  resolveFrozenSliceReviewReceiptContract
} from "../packages/agent-launch-cli/src/lib/backend-scope-authority.mjs";
import {
  MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES
} from "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-managed-identity.mjs";
import {
  readManagedRunProcessIdentity
} from "../packages/agent-launch-cli/src/lib/managed-run-process-identity.mjs";
import {
  assertTypedCorrectiveFailure,
  correctiveReceipt,
  git,
  OLD_TUPLE,
  readReservationRecord,
  SLICE_REF,
  SUBJECT
} from "./workspace-agent-corrective-continuation-fixture.mjs";
import {
  assertSurfaceByteIdentical,
  captureSurface,
  RECORD_RELATIVE_PATH,
  reissueCorrectiveDispatch,
  settledIntegratedScenario,
  WK_REF
} from "./workspace-agent-corrective-integrated-receipt-base-fixture.mjs";

test("WK-1723#SLICE-020 an integrated delivery whose WK tip IS the reviewed tip authenticates from the frozen receipt base", async (t) => {
  const { fx, warm, receipt, liveWkTip } = await settledIntegratedScenario(t);

  assert.throws(
    () => resolveCommittedSliceReviewAdmission({
      mainRepo: fx.repo,
      worktreeRoot: fx.worktreeRoot,
      subject: SUBJECT,
      reviewUnit: resolveFrozenSliceReviewReceiptContract(receipt)
    }),
    (error) => {
      assert.match(error.message, /committed_range_empty/u);
      assert.equal(error.detail.reason, "committed_range_empty");
      return true;
    },
    "the general admission helper must refuse this topology, or the regression proves nothing"
  );

  const before = captureSurface(fx);
  const receiptBytes = JSON.stringify(receipt);
  const frozenIdentityBytes = JSON.stringify(receipt.worktree_identity);
  const historicalIdentity = readManagedRunProcessIdentity({ mainRepo: fx.repo, tuple: OLD_TUPLE });
  assert.notEqual(historicalIdentity, null);

  const accepted = await reissueCorrectiveDispatch(fx, warm, "settled-frozen-base");
  assert.equal(accepted.accepted, true, JSON.stringify(accepted));
  assert.equal(warm.workerLaunches().length, 1, "exactly one corrective worker is admitted");

  const context = warm.workerLaunches().at(-1).readiness.trusted_corrective_findings_context;
  assert.notEqual(context, null, "the corrective worker starts with the reviewed delivery's findings");
  assert.equal(context.authority, "launcher_exact_review_receipt");
  assert.equal(context.diff_base_sha, receipt.diff_base_sha, "the frozen pre-integration base");
  assert.equal(context.reviewed_sha, receipt.reviewed_sha);
  assert.equal(context.findings.length, 2, "both receipts of the one elected group");
  assert.deepEqual(
    [...context.review_run_ids].sort(),
    fx.receipts.map((entry) => entry.review_run_id).sort()
  );

  assert.notEqual(accepted.run_id, OLD_TUPLE.run_id);
  assert.notEqual(accepted.monitor_handle, OLD_TUPLE.launch_ref);
  assert.equal(readReservationRecord(fx.repo).tuple?.run_id, accepted.run_id,
    "the subject reservation names the successor");
  const retiredHistorical = readManagedRunProcessIdentity({ mainRepo: fx.repo, tuple: OLD_TUPLE });
  assert.notEqual(retiredHistorical, null, "the superseded attempt is retired, never deleted");
  assert.deepEqual(retiredHistorical.tuple, historicalIdentity.tuple);
  assert.equal(retiredHistorical.state, "retired",
    "historical CCE authority cannot authorize the new corrective delivery");

  assert.equal(JSON.stringify(correctiveReceipt(fx)), receiptBytes,
    "the complete historical receipt serialization is unchanged");
  assert.equal(JSON.stringify(receipt.worktree_identity), frozenIdentityBytes,
    "the frozen worktree/repository identity is unchanged");
  for (const field of [
    "diff_base_sha", "reviewed_sha", "slice_ref", "committed_target_digest",
    "canonical_parent_wk_contract", "slice_review_contract", "worktree_path"
  ]) {
    assert.equal(receipt[field], JSON.parse(receiptBytes)[field], field);
  }
  assert.deepEqual(receipt.worktree_identity.commit_chain,
    JSON.parse(frozenIdentityBytes).commit_chain, "commit_chain");
  assert.equal(JSON.stringify(fx.receipts), before.receipts,
    "no receipt is rewritten, replaced, or synthesized");
  assert.equal(git(fx.repo, "rev-parse", SLICE_REF), receipt.reviewed_sha,
    "the exact slice ref is not rewritten by authentication");
  assert.equal(git(fx.worktree, "rev-parse", "HEAD"), before.head,
    "the delivered worktree is untouched");

  const wkTip = git(fx.repo, "rev-parse", WK_REF);
  if (wkTip !== liveWkTip) {
    assert.equal(git(fx.repo, "rev-list", "--parents", "-n", "1", wkTip), `${wkTip} ${liveWkTip}`,
      "the WK ref only advances on top of the integrated reviewed tip");
  }
  assert.equal(git(fx.repo, "merge-base", wkTip, liveWkTip), liveWkTip,
    "the reviewed delivery stays reachable from the WK ref");
});

test("WK-1723#SLICE-020 a moved or deleted exact slice ref refuses with no launch and no mutation", async (t) => {
  for (const [label, move] of [
    ["moved", (fx, receipt) => git(fx.repo, "update-ref", receipt.slice_ref, fx.base)],
    ["deleted", (fx, receipt) => git(fx.repo, "update-ref", "-d", receipt.slice_ref)]
  ]) {
    const { fx, warm, receipt } = await settledIntegratedScenario(t);

    git(fx.worktree, "checkout", "--detach", receipt.reviewed_sha);
    move(fx, receipt);
    const before = captureSurface(fx);

    const refused = await reissueCorrectiveDispatch(fx, warm, `slice-ref-${label}`);
    assert.equal(refused.accepted, false, `${label}: ${JSON.stringify(refused)}`);
    assertTypedCorrectiveFailure(
      refused.refusal,
      MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES.INTEGRATED_STATE_UNRESOLVED
    );
    assert.equal(warm.workerLaunches().length, 0, `${label} launches no worker`);
    assertSurfaceByteIdentical(fx, before);
  }
});

test("WK-1723#SLICE-020 mismatched frozen evidence refuses with no launch and no mutation", async (t) => {
  const bogus = `${"a".repeat(39)}1`;
  const cases = [

    ["mismatched-frozen-base", (receipt) => ({
      ...receipt,
      diff_base_sha: bogus,
      worktree_identity: { ...receipt.worktree_identity, diff_base_sha: bogus }
    }), MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES.REVIEWED_TARGET_MISMATCH],

    ["mismatched-reviewed-sha", (receipt) => ({
      ...receipt,
      reviewed_sha: bogus,
      worktree_identity: { ...receipt.worktree_identity, reviewed_sha: bogus }
    }), MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES.REVIEWED_TARGET_MISMATCH],

    ["mismatched-committed-target-digest", (receipt) => ({
      ...receipt,
      worktree_identity: {
        ...receipt.worktree_identity,
        committed_target_digest: `sha256:${"d".repeat(64)}`
      }
    }), MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES.REVIEWED_TARGET_MISMATCH],

    ["mismatched-commit-chain", (receipt) => ({
      ...receipt,
      worktree_identity: { ...receipt.worktree_identity, commit_chain: [] }
    }), MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES.REVIEWED_TARGET_MISMATCH],

    ["frozen-wk-identity-replaced-with-current-tip", (receipt) => ({
      ...receipt,
      worktree_identity: { ...receipt.worktree_identity, wk_sha: receipt.reviewed_sha }
    }), MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES.INTEGRATED_STATE_UNRESOLVED]
  ];

  for (const [label, tamper, code] of cases) {
    const { fx, warm, receipt } = await settledIntegratedScenario(t);
    const receiptBytes = JSON.stringify(receipt);

    fx.receipts.splice(0, fx.receipts.length, ...fx.receipts.map(tamper));
    const before = captureSurface(fx);

    const refused = await reissueCorrectiveDispatch(fx, warm, label);
    assert.equal(refused.accepted, false, `${label}: ${JSON.stringify(refused)}`);
    assertTypedCorrectiveFailure(refused.refusal, code);
    assert.equal(warm.workerLaunches().length, 0, `${label} launches no worker`);
    assertSurfaceByteIdentical(fx, before);
    assert.equal(JSON.stringify(receipt), receiptBytes,
      `${label}: the authentic historical receipt object is never rewritten`);
  }
});

test("WK-1723#SLICE-020 two groups that both claim the settled delivery still refuse and reopen nothing", async (t) => {
  const { fx, warm, receipt } = await settledIntegratedScenario(t);

  fx.receipts.push({
    ...receipt,
    review_run_id: "wkdb_contradictory_review",
    committed_target_digest: `sha256:${"c".repeat(64)}`
  });
  const before = captureSurface(fx);

  const refused = await reissueCorrectiveDispatch(fx, warm, "settled-contradictory-groups");
  assert.equal(refused.accepted, false, JSON.stringify(refused));
  assertTypedCorrectiveFailure(
    refused.refusal,
    MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES.RECEIPTS_CONTRADICTORY
  );
  assert.equal(warm.workerLaunches().length, 0);
  assertSurfaceByteIdentical(fx, before);
});

test("WK-1723#SLICE-020 a changed corrective contract on the settled delivery still takes the current contract and a fresh identity", async (t) => {
  const { fx, warm, receipt } = await settledIntegratedScenario(t);
  const receiptBytes = JSON.stringify(receipt);

  const recordPath = path.join(fx.repo, RECORD_RELATIVE_PATH);
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  const slice = record.slices.find((entry) => entry.id === "SLICE-001");
  slice.acceptance.criteria = [...slice.acceptance.criteria, "Apply the current corrective contract."];
  slice.read_scope = ["README.md", "src/canary.txt"];
  slice.repo_paths = ["README.md", "src/canary.txt"];
  slice.write_scope = ["README.md", "src/canary.txt"];
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);

  const accepted = await reissueCorrectiveDispatch(fx, warm, "settled-changed-contract");
  assert.equal(accepted.accepted, true, JSON.stringify(accepted));
  assert.equal(warm.workerLaunches().length, 1);
  const workerInput = warm.workerLaunches().at(-1);
  assert.deepEqual(workerInput.worktree_provisioning.slice_binding.write_scope,
    ["README.md", "src/canary.txt"],
    "the successor is provisioned from the CURRENT contract, not the receipt's frozen one");
  assert.notEqual(accepted.run_id, OLD_TUPLE.run_id, "a fresh managed-run identity is minted");
  assert.equal(JSON.stringify(receipt), receiptBytes,
    "the historical receipt is byte-unchanged and authorizes only the settled delivery");
});
