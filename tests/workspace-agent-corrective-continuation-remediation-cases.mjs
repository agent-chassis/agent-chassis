

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  discardManagedRunProcessIdentity,
  managedRunSubjectReservationFilePath
} from "../packages/agent-launch-cli/src/lib/managed-run-process-identity.mjs";
import {
  MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES
} from "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-managed-identity.mjs";
import {
  renderTrustedCorrectiveFindingsInstructions,
  validateTrustedCorrectiveFindingsContext
} from "../packages/agent-launch-cli/src/lib/workspace-agent-launch-adapter-contract.mjs";
import {
  managedRunSubjectSuccessorGuardFilePath
} from "../packages/agent-launch-cli/src/lib/managed-run-subject-reservation.mjs";
import {
  assertMutatedNothing,
  assertTypedCorrectiveFailure,
  captureDurableState,
  clearSubjectReservation,
  dispatchAdvisoryReviews,
  fixture,
  git,
  integrateCommittedSlice,
  OLD_TUPLE,
  readReservationRecord,
  reissueWorkerDispatch,
  SLICE_REF,
  SUBJECT
} from "./workspace-agent-corrective-continuation-fixture.mjs";
import {
  commitRemediationRound,
  killLiveAttempt,
  MULTI_ROUND_BASE,
  MULTI_ROUND_DELIVERIES,
  reopenParentForRemediation
} from "./workspace-agent-corrective-continuation-remediation-fixture.mjs";

test("WK-1723#SLICE-009 a corrective authentication failure after a fresh reservation releases it, keeps the typed error, and stays reissuable", async (t) => {
  const fx = await fixture(t);
  await dispatchAdvisoryReviews(fx);
  const deliveredTip = git(fx.repo, "rev-parse", SLICE_REF);
  integrateCommittedSlice(fx);
  clearSubjectReservation(fx);

  discardManagedRunProcessIdentity({ mainRepo: fx.repo, tuple: OLD_TUPLE });
  assert.equal(readReservationRecord(fx.repo), null);

  const recordPath = path.join(fx.repo, "wiki", "work-records", "WK-1712.json");
  const repaired = readFileSync(recordPath, "utf8");
  const edited = JSON.parse(repaired);
  edited.slices[0].acceptance.criteria = ["Deliver something else entirely."];
  writeFileSync(recordPath, `${JSON.stringify(edited, null, 2)}\n`);
  const before = captureDurableState(fx);

  const failed = await reissueWorkerDispatch(fx.newBackend(), "fresh-reservation-failure");
  assert.equal(failed.accepted, false, JSON.stringify(failed));

  assertTypedCorrectiveFailure(
    failed.refusal,
    MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES.INTEGRATED_STATE_UNRESOLVED
  );

  assert.equal(readReservationRecord(fx.repo), null,
    "the freshly minted reservation was released before the error propagated");
  assertMutatedNothing(fx, before);

  writeFileSync(recordPath, repaired);
  const accepted = await reissueWorkerDispatch(fx.newBackend(), "fresh-reservation-repaired");
  assert.equal(accepted.accepted, true, JSON.stringify(accepted));
  const workerInput = fx.launches.filter((entry) => entry.role === "worker").at(-1);
  assert.equal(workerInput.readiness.trusted_corrective_findings_context.reviewed_sha, deliveredTip);
  assert.equal(readReservationRecord(fx.repo).tuple?.run_id, accepted.run_id);
});

test("WK-1723#SLICE-009 a second and third remediation round each converge, electing the current delivery's receipt group and deleting no history", async (t) => {
  const fx = await fixture(t, {
    alwaysChangesRequested: true,
    canaryBase: MULTI_ROUND_BASE,
    deliveredBytes: MULTI_ROUND_DELIVERIES[0]
  });
  const workerLaunches = () => fx.launches.filter((entry) => entry.role === "worker");

  await dispatchAdvisoryReviews(fx);
  const tip1 = git(fx.repo, "rev-parse", SLICE_REF);
  assert.equal(fx.receipts.length, 2, "round 1 leaves a two-receipt group");
  integrateCommittedSlice(fx, MULTI_ROUND_DELIVERIES[0]);
  clearSubjectReservation(fx);

  const round1 = await reissueWorkerDispatch(fx.newBackend(), "remediation-round-1");
  assert.equal(round1.accepted, true, JSON.stringify(round1));
  const findings1 = workerLaunches().at(-1).readiness.trusted_corrective_findings_context;
  assert.equal(findings1.reviewed_sha, tip1);
  assert.equal(findings1.findings.length, 2, "every trusted receipt in the elected group is carried");

  reopenParentForRemediation(fx);
  const tip2 = await commitRemediationRound(fx, workerLaunches().at(-1), MULTI_ROUND_DELIVERIES[1]);
  assert.notEqual(tip2, tip1);
  await dispatchAdvisoryReviews(fx);
  assert.equal(fx.receipts.length, 4, "the append-only store retains round 1 and adds round 2");
  integrateCommittedSlice(fx, MULTI_ROUND_DELIVERIES[1]);
  clearSubjectReservation(fx);
  killLiveAttempt(fx, 2);

  const round2 = await reissueWorkerDispatch(fx.newBackend(), "remediation-round-2");
  assert.equal(round2.accepted, true, JSON.stringify(round2));
  const findings2 = workerLaunches().at(-1).readiness.trusted_corrective_findings_context;
  assert.equal(findings2.reviewed_sha, tip2, "the CURRENT delivery's group is elected, not the first");
  assert.equal(findings2.findings.length, 2);
  assert.equal(fx.receipts.length, 4, "no historical receipt is deleted to converge");
  assert.equal(
    fx.receipts.filter((receipt) => receipt.reviewed_sha === tip1).length, 2,
    "the superseded round-1 receipts are preserved verbatim"
  );

  reopenParentForRemediation(fx);
  const tip3 = await commitRemediationRound(fx, workerLaunches().at(-1), MULTI_ROUND_DELIVERIES[2]);
  assert.notEqual(tip3, tip2);
  await dispatchAdvisoryReviews(fx);
  assert.equal(fx.receipts.length, 6);
  integrateCommittedSlice(fx, MULTI_ROUND_DELIVERIES[2]);
  clearSubjectReservation(fx);
  killLiveAttempt(fx, 3);

  const round3 = await reissueWorkerDispatch(fx.newBackend(), "remediation-round-3");
  assert.equal(round3.accepted, true, JSON.stringify(round3));
  const findings3 = workerLaunches().at(-1).readiness.trusted_corrective_findings_context;
  assert.equal(findings3.reviewed_sha, tip3);
  assert.equal(findings3.findings.length, 2);
  assert.equal(fx.receipts.length, 6, "three rounds of history survive intact");
  assert.equal(new Set(fx.receipts.map((receipt) => receipt.reviewed_sha)).size, 3);

  assert.equal(workerLaunches().at(-1).worktree_provisioning.slice_binding.base_sha, tip3);
  assert.equal(workerLaunches().length, 3, "exactly one remediation worker per converged round");
});

test("WK-1723#SLICE-009 the produced corrective context crosses the launch adapter unchanged, plural and with repeated finding ids", async (t) => {
  const fx = await fixture(t, { alwaysChangesRequested: true });
  await dispatchAdvisoryReviews(fx);
  const deliveredTip = git(fx.repo, "rev-parse", SLICE_REF);
  integrateCommittedSlice(fx);
  clearSubjectReservation(fx);

  const recordPath = path.join(fx.repo, "wiki", "work-records", "WK-1712.json");
  const reopened = JSON.parse(readFileSync(recordPath, "utf8"));
  reopened.status = "active";
  const targetSlice = reopened.slices.find((slice) => slice.id === "SLICE-001");
  targetSlice.status = "todo";
  targetSlice.sections = {
    agent_notes: "Findings-only review returned changes_requested: F-001 (high, blocking)."
  };
  writeFileSync(recordPath, `${JSON.stringify(reopened, null, 2)}\n`);

  const accepted = await reissueWorkerDispatch(fx.newBackend(), "cross-boundary-adapter");

  assert.equal(accepted.accepted, true, JSON.stringify(accepted));
  const workerLaunches = fx.launches.filter((entry) => entry.role === "worker");
  assert.equal(workerLaunches.length, 1, "exactly one corrective successor launched");

  assert.equal(existsSync(managedRunSubjectReservationFilePath(fx.repo, SUBJECT)), true);
  assert.equal(existsSync(managedRunSubjectSuccessorGuardFilePath(fx.repo, SUBJECT)), false);

  const readiness = workerLaunches.at(-1).readiness;
  const context = readiness.trusted_corrective_findings_context;

  assert.deepEqual(Object.keys(context).sort(), [
    "authority", "diff_base_sha", "findings", "review_monitor_handles", "review_run_ids",
    "reviewed_sha", "schema_version", "source_worker_monitor_handle",
    "source_worker_run_id", "trusted_evidence_digests", "unit_address"
  ]);

  assert.equal(context.review_run_ids.length, 2);
  assert.equal(context.review_monitor_handles.length, 2);
  assert.equal(context.trusted_evidence_digests.length, 2);
  assert.equal(new Set(context.review_run_ids).size, 2, "both reviewers are carried");
  assert.equal(context.reviewed_sha, deliveredTip);
  const carriedReceipts = fx.receipts.filter((receipt) =>
    receipt.structured_outcome?.outcome === "changes_requested" &&
    receipt.reviewed_sha === deliveredTip);
  assert.equal(carriedReceipts.length, 2);
  assert.deepEqual(
    [...context.review_run_ids].sort(),
    carriedReceipts.map((receipt) => receipt.review_run_id).sort(),
    "the carried review identities are the durable receipts', not a synthesized set"
  );

  assert.equal(context.findings.length, 2);
  assert.deepEqual(context.findings.map((finding) => finding.id), ["F-001", "F-001"]);

  const validated = validateTrustedCorrectiveFindingsContext(context, { subject: SUBJECT });
  assert.equal(validated.ok, true, JSON.stringify(validated));
  assert.equal(validated.context, context, "the accepted context is the produced object itself");
  assert.deepEqual({ ...validated.finding_counts }, {
    total: 2, blocking: 2, critical: 0, high: 2, medium: 0, low: 0, info: 0
  }, "every occurrence is counted, including the repeated id");

  const rendered = renderTrustedCorrectiveFindingsInstructions(
    readiness.trusted_corrective_findings_context ?? null,
    { subject: SUBJECT }
  );
  assert.match(rendered, /^Review receipts \(2\):$/mu);
  for (let index = 0; index < 2; index += 1) {
    assert.ok(
      rendered.includes(`[${index + 1}] reviewer ${context.review_run_ids[index]} `),
      `review identity ${index + 1} is rendered in producer order`
    );
    assert.ok(rendered.includes(context.trusted_evidence_digests[index]));
  }
  assert.match(rendered, /^Finding occurrences \(2\): blocking=2 critical=0 high=2 /mu);
  assert.equal(rendered.match(/^ {2}\[\d+\] F-001 severity=high blocking=true /gmu)?.length, 2,
    "both occurrences of the repeated id are rendered, never deduplicated");
  assert.equal(rendered.includes(`${context.diff_base_sha}..${deliveredTip}`), true);

  const misaddressed = validateTrustedCorrectiveFindingsContext(context, {
    subject: "WK-1712#SLICE-002"
  });
  assert.equal(misaddressed.ok, false);
  assert.equal(misaddressed.reason, "trusted_corrective_findings_context_invalid");
});
