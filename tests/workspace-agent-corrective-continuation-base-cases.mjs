

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  MANAGED_RUN_PROCESS_IDENTITY_STATES,
  managedRunSubjectReservationFilePath,
  readManagedRunProcessIdentity
} from "../packages/agent-launch-cli/src/lib/managed-run-process-identity.mjs";
import {
  MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES
} from "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-managed-identity.mjs";
import {
  CANONICAL_INTEGRATED_CONTRACT_CLASSIFICATIONS,
  classifyCanonicalIntegratedSliceContract
} from "../packages/agent-launch-cli/src/lib/backend-scope-authority.mjs";
import {
  canonicalizeWorkRecordJson,
  projectSliceReviewReceiptContracts
} from "@agent-chassis/wiki-core";
import {
  assertMutatedNothing,
  assertTypedCorrectiveFailure,
  captureDurableState,
  clearSubjectReservation,
  correctiveReceipt,
  dispatchAdvisoryReviews,
  fixture,
  git,
  INITIATIVE,
  integrateCommittedSlice,
  OLD_TUPLE,
  readReservationRecord,
  reissueWorkerDispatch,
  SLICE_REF,
  SUBJECT
} from "./workspace-agent-corrective-continuation-fixture.mjs";

test("WK-1712 production composition accepts corrective worker from the delivered tip after plural advisory reviews", async (t) => {
  const fx = await fixture(t);
  await dispatchAdvisoryReviews(fx);
  const deliveredTip = git(fx.repo, "rev-parse", SLICE_REF);
  const reservationBefore = JSON.parse(readFileSync(
    managedRunSubjectReservationFilePath(fx.repo, SUBJECT), "utf8"
  )).reservation_id;

  const corrective = await fx.backend.startLaunch({
    caller_session_id: "corrective-session",
    role: "worker",
    app: "codex",
    subject: SUBJECT,
    workspace_dir: fx.repo,
    readiness: { dispatchable: true, initiative: INITIATIVE }
  });

  assert.equal(corrective.accepted, true, JSON.stringify(corrective));
  const workerInput = fx.launches.find((entry) => entry.role === "worker");
  assert.ok(workerInput);
  assert.equal(workerInput.worktree_provisioning.slice_binding.base_sha, deliveredTip);
  assert.equal(workerInput.workspace_dir, fx.worktree);
  assert.equal(readFileSync(path.join(fx.worktree, "src", "canary.txt"), "utf8"), "delivered bytes\n");
  assert.equal(git(fx.repo, "rev-parse", SLICE_REF), deliveredTip);
  assert.equal(git(fx.worktree, "rev-parse", "HEAD"), deliveredTip);
  assert.equal(
    readManagedRunProcessIdentity({ mainRepo: fx.repo, tuple: OLD_TUPLE }).state,
    MANAGED_RUN_PROCESS_IDENTITY_STATES.RETIRED
  );
  assert.notEqual(JSON.parse(readFileSync(
    managedRunSubjectReservationFilePath(fx.repo, SUBJECT), "utf8"
  )).reservation_id, reservationBefore);
  assert.equal(workerInput.readiness.trusted_corrective_findings_context.findings.length, 1);
});

function assertObservesWinnerWithoutDeadWait(refusal, { winnerRunId }) {
  const detail = refusal.detail ?? {};
  assert.notEqual(
    refusal.reason,
    "managed_run_prior_attempt_proven_dead",
    `a loser must never be refused against a proven-dead attempt: ${JSON.stringify(detail)}`
  );
  assert.notEqual(detail.verdict, "proven_dead");
  assert.equal(/run_status|run_wait/u.test(detail.recovery_route ?? ""), false);

  const observedRunId = detail.continuation?.run_id ?? null;
  const holder = detail.reservation_holder ?? null;
  assert.equal(
    observedRunId === winnerRunId || holder !== null,
    true,
    `the loser must observe the current winner or holder: ${JSON.stringify(detail)}`
  );

  if (detail.continuation?.next_action === "reissue_subject_dispatch_when_current_attempt_settles") {
    assert.equal(
      detail.verdict,
      "live",
      `only a live attempt may be waited on: ${JSON.stringify(detail)}`
    );
    assert.equal(observedRunId, winnerRunId, "the live attempt waited on is the winner");
  }
}

test("WK-1723 an integrated committed delivery with a proven-dead attempt and no reservation holder converges to exactly one remediation worker across repeated cold reissues", async (t) => {
  const fx = await fixture(t);

  await dispatchAdvisoryReviews(fx);
  const deliveredTip = git(fx.repo, "rev-parse", SLICE_REF);

  integrateCommittedSlice(fx);
  clearSubjectReservation(fx);

  assert.equal(fx.receipts.some((receipt) =>
    receipt.structured_outcome?.outcome === "changes_requested"), true,
  "a trusted changes_requested receipt exists");
  assert.equal(
    readManagedRunProcessIdentity({ mainRepo: fx.repo, tuple: OLD_TUPLE }).state,
    MANAGED_RUN_PROCESS_IDENTITY_STATES.BOUND,
    "the prior attempt is still a bound (unsettled) record"
  );
  assert.equal(readReservationRecord(fx.repo), null, "the reservation holder is null");
  assert.equal(
    JSON.parse(readFileSync(path.join(fx.repo, "wiki", "work-records", "WK-1712.json"), "utf8"))
      .slices[0].status,
    "done",
    "the delivery is integrated, so the slice is no longer under slice-level review"
  );

  const workerLaunches = () => fx.launches.filter((entry) => entry.role === "worker");

  const outcomes = [];
  for (let reissue = 0; reissue < 3; reissue += 1) {
    outcomes.push(await reissueWorkerDispatch(fx.newBackend(), `cold-reissue-${reissue}`));
  }

  const accepted = outcomes.filter((outcome) => outcome.accepted === true);
  assert.equal(accepted.length, 1, `exactly one reissue is accepted: ${JSON.stringify(outcomes)}`);
  assert.equal(outcomes[0].accepted, true, "the FIRST eligible reissue converges");
  assert.equal(workerLaunches().length, 1, "exactly one remediation worker launches");

  const settled = readManagedRunProcessIdentity({ mainRepo: fx.repo, tuple: OLD_TUPLE });
  assert.equal(settled.state, MANAGED_RUN_PROCESS_IDENTITY_STATES.RETIRED);
  assert.equal(settled.retirement.reason, "corrective_supersession");
  assert.equal(settled.retirement.evidence.delivered_tip_sha, deliveredTip);

  const reservation = readReservationRecord(fx.repo);
  assert.notEqual(reservation, null, "a successor reservation owns the subject");
  assert.equal(reservation.subject, SUBJECT);
  assert.equal(reservation.tuple?.run_id, accepted[0].run_id);

  const workerInput = workerLaunches()[0];
  assert.equal(workerInput.worktree_provisioning.slice_binding.base_sha, deliveredTip);
  assert.equal(readFileSync(path.join(fx.worktree, "src", "canary.txt"), "utf8"), "delivered bytes\n");

  const findings = workerInput.readiness.trusted_corrective_findings_context;
  assert.notEqual(findings, null, "the remediation worker receives trusted findings");
  assert.equal(findings.authority, "launcher_exact_review_receipt");
  assert.equal(findings.unit_address, SUBJECT);
  assert.equal(findings.reviewed_sha, deliveredTip);
  assert.equal(findings.findings.length, 1);

  for (const outcome of outcomes.slice(1)) {
    assert.equal(outcome.accepted, false);
    assertObservesWinnerWithoutDeadWait(outcome.refusal, { winnerRunId: accepted[0].run_id });
  }
});

test("WK-1712 production twin refuses an unauthenticated ahead sibling without mutation", async (t) => {
  const fx = await fixture(t, { unauthenticatedSibling: true });
  const before = {
    slice: git(fx.repo, "rev-parse", SLICE_REF),
    wk: git(fx.repo, "rev-parse", `refs/heads/wk/${INITIATIVE}/WK-1712`),
    head: git(fx.worktree, "rev-parse", "HEAD"),
    reservation: readFileSync(managedRunSubjectReservationFilePath(fx.repo, SUBJECT), "utf8"),
    identity: readManagedRunProcessIdentity({ mainRepo: fx.repo, tuple: OLD_TUPLE })
  };

  const corrective = await fx.backend.startLaunch({
    caller_session_id: "unauthenticated-corrective-session",
    role: "worker",
    app: "codex",
    subject: SUBJECT,
    workspace_dir: fx.repo,
    readiness: { dispatchable: true, initiative: INITIATIVE }
  });

  assert.equal(corrective.accepted, false);
  assert.equal(corrective.refusal.reason, "managed_run_prior_attempt_proven_dead");
  assert.equal(fx.launches.some((entry) => entry.role === "worker"), false);
  assert.equal(git(fx.repo, "rev-parse", SLICE_REF), before.slice);
  assert.equal(git(fx.repo, "rev-parse", `refs/heads/wk/${INITIATIVE}/WK-1712`), before.wk);
  assert.equal(git(fx.worktree, "rev-parse", "HEAD"), before.head);
  assert.equal(readFileSync(managedRunSubjectReservationFilePath(fx.repo, SUBJECT), "utf8"), before.reservation);
  assert.deepEqual(readManagedRunProcessIdentity({ mainRepo: fx.repo, tuple: OLD_TUPLE }), before.identity);
});

test("WK-1723 two receipt groups that both claim the current reviewed delivery refuse precisely and reopen nothing", async (t) => {
  const fx = await fixture(t);
  await dispatchAdvisoryReviews(fx);
  integrateCommittedSlice(fx);
  clearSubjectReservation(fx);

  const witness = correctiveReceipt(fx);
  fx.receipts.push({
    ...witness,
    review_run_id: "wkdb_contradictory_review",
    committed_target_digest: `sha256:${"c".repeat(64)}`
  });
  const before = captureDurableState(fx);

  const reissue = await reissueWorkerDispatch(fx.newBackend(), "contradictory-receipts");
  assert.equal(reissue.accepted, false, JSON.stringify(reissue));
  assertTypedCorrectiveFailure(
    reissue.refusal,
    MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES.RECEIPTS_CONTRADICTORY
  );
  assertMutatedNothing(fx, before);
});

test("WK-1723 a reviewed delivery that is not the authenticated delivery refuses as a reviewed-target mismatch", async (t) => {
  const fx = await fixture(t);
  await dispatchAdvisoryReviews(fx);
  integrateCommittedSlice(fx);
  clearSubjectReservation(fx);

  const witness = correctiveReceipt(fx);
  const index = fx.receipts.indexOf(witness);
  fx.receipts[index] = { ...witness, reviewed_sha: `${"b".repeat(39)}2` };
  const before = captureDurableState(fx);

  const reissue = await reissueWorkerDispatch(fx.newBackend(), "reviewed-target-mismatch");
  assert.equal(reissue.accepted, false, JSON.stringify(reissue));
  assertTypedCorrectiveFailure(
    reissue.refusal,
    MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES.REVIEWED_TARGET_MISMATCH
  );
  assertMutatedNothing(fx, before);
});

test("WK-1723 a legitimate changed corrective contract receives an exact fresh current projection", async (t) => {
  const fx = await fixture(t);
  await dispatchAdvisoryReviews(fx);
  integrateCommittedSlice(fx);
  clearSubjectReservation(fx);

  const recordPath = path.join(fx.repo, "wiki", "work-records", "WK-1712.json");
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  record.status = "active";
  record.acceptance.criteria = ["Preserve the amended corrective delivery."];
  record.acceptance.validation = ["Inspect the amended corrective projection."];
  record.open_extension = { source: "corrective-continuation-regression" };
  record.slices[0].status = "todo";
  record.slices[0].expected_edit_targets = [{
    path: "src/canary.txt",
    name: "amended canary delivery",
    kind: "function",
    operation: "modify"
  }];
  record.slices[0].read_scope = ["src/canary.txt", "README.md"];
  record.slices[0].repo_paths = ["src/canary.txt", "README.md"];
  record.slices[0].write_scope = ["src/canary.txt", "README.md"];
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);

  const witness = correctiveReceipt(fx);
  const expectedCurrentContract = canonicalizeWorkRecordJson(
    projectSliceReviewReceiptContracts(record, "SLICE-001").parent
  );
  const classify = () => classifyCanonicalIntegratedSliceContract(
    fx.repo,
    SUBJECT,
    witness
  );
  const classification = classify();

  assert.equal(
    classification.classification,
    CANONICAL_INTEGRATED_CONTRACT_CLASSIFICATIONS.CORRECTIVE_CURRENT_CONTRACT_REQUIRES_FRESH_IDENTITY
  );
  assert.equal(classification.current_contract, expectedCurrentContract);
  assert.equal(classification.parent_status, "active");
  assert.equal(classification.slice_status, "todo");
  assert.equal(classification.current_contract.includes("agent_launch.integrated_lifecycle_neutralized"), false);
  assert.equal(JSON.parse(classification.current_contract).status, "active");
  assert.equal(JSON.parse(classification.current_contract).slices[0].status, "todo");
  assert.deepEqual(
    JSON.parse(classification.current_contract).open_extension,
    { source: "corrective-continuation-regression" }
  );

  assert.equal(classify().current_contract, classification.current_contract);

  const reissue = await reissueWorkerDispatch(fx.newBackend(), "changed-contract");
  assert.equal(reissue.accepted, true, JSON.stringify(reissue));
  const workerInput = fx.launches.find((entry) => entry.role === "worker");
  assert.ok(workerInput, "the public dispatch seam launches the fresh corrective worker");
  assert.deepEqual(workerInput.worktree_provisioning.slice_binding.read_scope, [
    "README.md",
    "src/canary.txt"
  ]);
  assert.deepEqual(workerInput.worktree_provisioning.slice_binding.repo_paths, [
    "README.md",
    "src/canary.txt"
  ]);
  assert.deepEqual(workerInput.worktree_provisioning.slice_binding.write_scope, [
    "README.md",
    "src/canary.txt"
  ]);
});

test("WK-1723 a canonical-diagnostic invalid changed contract refuses while schema-valid open fields remain accepted", async (t) => {
  const fx = await fixture(t);
  await dispatchAdvisoryReviews(fx);
  integrateCommittedSlice(fx);
  clearSubjectReservation(fx);

  const recordPath = path.join(fx.repo, "wiki", "work-records", "WK-1712.json");
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  record.status = "active";
  record.slices[0].status = "todo";
  record.title = 42;
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);

  const before = captureDurableState(fx);
  const reissue = await reissueWorkerDispatch(fx.newBackend(), "canonical-diagnostic-invalid");
  assert.equal(reissue.accepted, false, JSON.stringify(reissue));
  assertTypedCorrectiveFailure(
    reissue.refusal,
    MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES.INTEGRATED_STATE_UNRESOLVED
  );
  assertMutatedNothing(fx, before);
});

test("WK-1723 an unauthenticated ahead sibling on an integrated delivery refuses without mutation", async (t) => {
  const fx = await fixture(t);
  await dispatchAdvisoryReviews(fx);
  integrateCommittedSlice(fx);
  clearSubjectReservation(fx);

  writeFileSync(path.join(fx.worktree, "src", "canary.txt"), "caller-authored sibling\n");
  git(fx.worktree, "add", "src/canary.txt");
  git(fx.worktree, "commit", "-m", "caller-authored sibling");
  const before = captureDurableState(fx);

  const reissue = await reissueWorkerDispatch(fx.newBackend(), "ahead-sibling-integrated");
  assert.equal(reissue.accepted, false, JSON.stringify(reissue));
  assertTypedCorrectiveFailure(
    reissue.refusal,
    MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES.INTEGRATED_STATE_UNRESOLVED
  );
  assertMutatedNothing(fx, before);
});

test("WK-1723 an integrated delivery with no review receipts at all is never reopened", async (t) => {
  const fx = await fixture(t);

  integrateCommittedSlice(fx);
  clearSubjectReservation(fx);
  const before = captureDurableState(fx);

  for (let reissue = 0; reissue < 2; reissue += 1) {
    const outcome = await reissueWorkerDispatch(fx.newBackend(), `settled-${reissue}`);
    assert.equal(outcome.accepted, false, JSON.stringify(outcome));
    assert.equal(outcome.refusal.reason, "managed_run_prior_attempt_proven_dead");
  }
  assertMutatedNothing(fx, before);
});

test("WK-1860 an integrated delivery whose trusted reviews are all CLEAN admits continuation and carries no findings context", async (t) => {
  const fx = await fixture(t, { cleanReviewsOnly: true });
  await dispatchAdvisoryReviews(fx);
  assert.equal(fx.receipts.length, 2, "trusted review receipts exist");
  assert.equal(
    fx.receipts.some((receipt) => receipt.structured_outcome?.outcome === "changes_requested"),
    false,
    "no receipt requests changes"
  );
  const deliveredTip = git(fx.repo, "rev-parse", SLICE_REF);

  integrateCommittedSlice(fx);
  clearSubjectReservation(fx);

  const outcomes = [];
  for (let reissue = 0; reissue < 3; reissue += 1) {
    outcomes.push(await reissueWorkerDispatch(fx.newBackend(), `clean-settled-${reissue}`));
  }

  const accepted = outcomes.filter((outcome) => outcome.accepted === true);
  assert.equal(accepted.length, 1, `exactly one reissue is accepted: ${JSON.stringify(outcomes)}`);
  assert.equal(outcomes[0].accepted, true, "the FIRST eligible reissue converges");

  const workerLaunches = fx.launches.filter((entry) => entry.role === "worker");
  assert.equal(workerLaunches.length, 1, "exactly one remediation worker launches");
  const workerInput = workerLaunches[0];

  assert.equal(workerInput.worktree_provisioning.slice_binding.base_sha, deliveredTip);
  assert.equal(readFileSync(path.join(fx.worktree, "src", "canary.txt"), "utf8"), "delivered bytes\n");

  assert.equal(
    workerInput.readiness.trusted_corrective_findings_context, undefined,
    "a clean review history projects no findings, so no context is carried at all"
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      workerInput.readiness, "trusted_corrective_findings_context"
    ),
    false,
    "the key is absent rather than null or an empty array"
  );

  const settled = readManagedRunProcessIdentity({ mainRepo: fx.repo, tuple: OLD_TUPLE });
  assert.equal(settled.state, MANAGED_RUN_PROCESS_IDENTITY_STATES.RETIRED);
  assert.equal(settled.retirement.reason, "corrective_supersession");
  assert.equal(readReservationRecord(fx.repo)?.tuple?.run_id, accepted[0].run_id);
});

test("WK-1860 a terminal receipt carrying no structured outcome admits and is never dereferenced", async (t) => {
  const fx = await fixture(t, { cleanReviewsOnly: true });
  await dispatchAdvisoryReviews(fx);
  assert.equal(fx.receipts.length, 2);

  const proseOnly = { ...fx.receipts[0], review_run_id: "wkdb_prose_only_review",
    review_monitor_handle: "wkmh_prose_only_review", structured_outcome: null };
  fx.receipts.push(proseOnly);
  assert.equal(fx.receipts.length, 3);
  assert.equal(fx.receipts.filter((receipt) => receipt.structured_outcome === null).length, 1);

  integrateCommittedSlice(fx);
  clearSubjectReservation(fx);

  const reissue = await reissueWorkerDispatch(fx.newBackend(), "prose-only-receipt");
  assert.equal(reissue.accepted, true, JSON.stringify(reissue));
  const workerInput = fx.launches.filter((entry) => entry.role === "worker").at(-1);
  assert.equal(workerInput.readiness.trusted_corrective_findings_context, undefined);

  assert.equal(fx.receipts.includes(proseOnly), true);
});

test("WK-1860 no corrective path retires a prior attempt and then fails", async (t) => {
  const configurations = [
    { label: "clean-only", cleanReviewsOnly: true, mutate: () => {} },
    { label: "no-structured-outcome", cleanReviewsOnly: true, mutate: (fx) => {
      for (let index = 0; index < fx.receipts.length; index += 1) {
        fx.receipts[index] = { ...fx.receipts[index], structured_outcome: null };
      }
    } },
    { label: "changes-requested", cleanReviewsOnly: false, mutate: () => {} },
    { label: "self-contradictory", cleanReviewsOnly: false, mutate: (fx) => {
      const witness = correctiveReceipt(fx);
      fx.receipts[fx.receipts.indexOf(witness)] =
        { ...witness, reviewed_sha: `${"b".repeat(39)}2` };
    } }
  ];
  for (const configuration of configurations) {
    const fx = await fixture(t, { cleanReviewsOnly: configuration.cleanReviewsOnly });
    await dispatchAdvisoryReviews(fx);
    configuration.mutate(fx);
    integrateCommittedSlice(fx);
    clearSubjectReservation(fx);
    const before = captureDurableState(fx);

    for (let reissue = 0; reissue < 2; reissue += 1) {
      const outcome = await reissueWorkerDispatch(
        fx.newBackend(), `${configuration.label}-atomicity-${reissue}`
      );
      const identity = readManagedRunProcessIdentity({ mainRepo: fx.repo, tuple: OLD_TUPLE });
      if (outcome.accepted === true) {
        assert.equal(
          identity.state, MANAGED_RUN_PROCESS_IDENTITY_STATES.RETIRED,
          `${configuration.label}: an accepted continuation settles the attempt it superseded`
        );
        break;
      }
      assert.notEqual(
        identity.state, MANAGED_RUN_PROCESS_IDENTITY_STATES.RETIRED,
        `${configuration.label}: a refused continuation must not leave a retired attempt behind`
      );

      assertMutatedNothing(fx, before);
    }
  }
});
