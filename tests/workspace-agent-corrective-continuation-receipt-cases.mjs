

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  assessPriorManagedAttemptsForSubject,
  bindManagedRunSandboxProcessIdentity,
  deriveOuterSandboxKillShape,
  discardManagedRunProcessIdentity,
  MANAGED_RUN_PROCESS_IDENTITY_STATES,
  publishPendingManagedRunProcessIdentity,
  readManagedRunProcessIdentity
} from "../packages/agent-launch-cli/src/lib/managed-run-process-identity.mjs";
import {
  createBackendManagedIdentity,
  SUPERSEDED_ATTEMPT_RETIREMENT_RESULTS_SCHEMA_VERSION
} from "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-managed-identity.mjs";
import {
  validateTrustedCorrectiveFindingsContext
} from "../packages/agent-launch-cli/src/lib/workspace-agent-launch-adapter-contract.mjs";
import { defaultRunGit } from "../packages/agent-launch-cli/src/lib/worktree-substrate.mjs";
import {
  digestTrustedExactReviewEvidence
} from "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt.mjs";
import {
  clearSubjectReservation,
  correctiveReceipt,
  dispatchAdvisoryReviews,
  fixture,
  INITIATIVE,
  integrateCommittedSlice,
  livenessDeps,
  OLD_TUPLE,
  reissueWorkerDispatch,
  SUBJECT
} from "./workspace-agent-corrective-continuation-fixture.mjs";

test("WK-1723#SLICE-009 the warm route elects one frozen-contract group and never aggregates across rounds", async (t) => {
  const fx = await fixture(t, { alwaysChangesRequested: true });

  await dispatchAdvisoryReviews(fx);
  assert.equal(fx.receipts.length, 2);
  const current = fx.receipts.map((receipt) => receipt.review_run_id);

  const stale = fx.receipts.map((receipt, index) => {
    const parent = JSON.parse(receipt.canonical_parent_wk_contract);
    parent.sections = {
      ...(parent.sections ?? {}),
      agent_notes: "Coordinator disposition recorded at record scope, since superseded."
    };
    const canonicalParent = JSON.stringify(parent);
    return {
      ...receipt,
      review_run_id: `wkdb_superseded_review_${index}`,
      review_monitor_handle: `wkmh_superseded_review_${index}`,
      trusted_evidence_digest: `sha256:${String(index + 1).repeat(64)}`,
      canonical_parent_wk_contract: canonicalParent,
      canonical_parent_contract_digest: digestTrustedExactReviewEvidence(canonicalParent),
      structured_outcome: {
        ...receipt.structured_outcome,
        findings: receipt.structured_outcome.findings.map((finding) => ({
          ...finding,
          id: `SUPERSEDED-${index}`
        }))
      }
    };
  });
  fx.receipts.push(...stale);
  const superseded = stale.map((receipt) => receipt.review_run_id);

  assert.equal(fx.receipts.length, 4);
  assert.equal(new Set(fx.receipts.map((receipt) => receipt.committed_target_digest)).size, 1,
    "all four receipts share one committed_target_digest");
  assert.equal(new Set(fx.receipts.map((receipt) => receipt.canonical_parent_contract_digest)).size, 2,
    "the two rounds carry different frozen parent contracts");
  assert.equal(new Set(fx.receipts.map((receipt) => receipt.slice_review_contract_digest)).size, 1,
    "the slice review contract is identical, so only the parent contract separates them");

  assert.equal(current.includes(fx.receipts[0].review_run_id), true);

  const corrective = await fx.backend.startLaunch({
    caller_session_id: "warm-frozen-contract-election",
    role: "worker",
    app: "codex",
    subject: SUBJECT,
    workspace_dir: fx.repo,
    readiness: { dispatchable: true, initiative: INITIATIVE }
  });
  assert.equal(corrective.accepted, true, JSON.stringify(corrective));

  const workerInput = fx.launches.filter((entry) => entry.role === "worker").at(-1);
  const context = workerInput.readiness.trusted_corrective_findings_context;
  assert.notEqual(context, undefined, "the warm route produced the context");

  assert.equal(context.findings.length, 2,
    "only the elected group's findings are carried; four means the rounds were aggregated");
  assert.deepEqual([...context.review_run_ids].sort(), [...current].sort(),
    "the carried reviewer identities are the elected group's");
  for (const staleRunId of superseded) {
    assert.equal(context.review_run_ids.includes(staleRunId), false,
      "no receipt from an unauthenticated frozen contract contributes");
  }
  assert.equal(
    context.findings.some((finding) => finding.id.startsWith("SUPERSEDED-")), false,
    "no finding from an unauthenticated frozen contract reaches the adapter"
  );
  assert.equal(context.review_monitor_handles.length, 2);
  assert.equal(context.trusted_evidence_digests.length, 2);
  const elected = fx.receipts.filter((receipt) => current.includes(receipt.review_run_id));
  assert.deepEqual(
    [...context.trusted_evidence_digests].sort(),
    elected.map((receipt) => receipt.trusted_evidence_digest).sort()
  );

  const validated = validateTrustedCorrectiveFindingsContext(context, { subject: SUBJECT });
  assert.equal(validated.ok, true, JSON.stringify(validated));
  assert.equal(validated.finding_counts.total, 2);

  assert.equal(fx.receipts.length, 4);
});

test("WK-1723#SLICE-009 supersession returns bounded per-attempt retirement results and never reads them as launch authority", async (t) => {
  const fx = await fixture(t);
  await dispatchAdvisoryReviews(fx);
  integrateCommittedSlice(fx);
  clearSubjectReservation(fx);

  const secondTuple = Object.freeze({
    assigned_unit: SUBJECT,
    launch_ref: "wkmh_zz_second_worker",
    run_id: "wkdb_zz_second_worker",
    retry_id: 0
  });
  const seedDeps = livenessDeps({ [process.pid]: "999", 7777: "424" });
  bindManagedRunSandboxProcessIdentity(
    publishPendingManagedRunProcessIdentity({
      mainRepo: fx.repo, tuple: secondTuple, role: "worker", deps: seedDeps
    }),
    { pid: 7777, killShape: deriveOuterSandboxKillShape({ pid: 7777 }), deps: seedDeps }
  );

  const priorAttempt = assessPriorManagedAttemptsForSubject({
    mainRepo: fx.repo,
    subject: SUBJECT,
    currentTuple: null,
    deps: fx.managedRunProcessIdentityDeps
  });
  assert.equal(priorAttempt.verdict, "proven_dead");
  assert.equal(priorAttempt.tuple, null, "a plural dead set elects no representative");
  assert.equal(priorAttempt.proven_dead_tuples.length, 2);

  discardManagedRunProcessIdentity({ mainRepo: fx.repo, tuple: secondTuple });
  publishPendingManagedRunProcessIdentity({
    mainRepo: fx.repo, tuple: secondTuple, role: "worker", deps: seedDeps
  });

  const identity = createBackendManagedIdentity({
    worktreeProvisioningConfig: { mainRepo: fx.repo, worktreeRoot: fx.worktreeRoot },
    reviewContextRunGit: defaultRunGit,
    correctiveContinuationProofs: new Map(),
    managedRunIdentityRoot: fx.repo,
    managedRunIdentityDeps: fx.managedRunProcessIdentityDeps,
    exactSliceReviewReceiptStore: fx.exactSliceReviewReceiptStore
  });
  const successor = await identity.supersedeProvenDeadAttemptForCorrectiveWorker({
    subject: SUBJECT,
    priorAttempt
  });

  assert.equal(successor.may_launch, true, JSON.stringify(successor));
  assert.notEqual(successor.reservation, null);

  const retirements = successor.superseded_attempt_retirements;
  assert.notEqual(retirements, undefined, "per-attempt retirement results are returned");
  assert.equal(retirements.schema_version, SUPERSEDED_ATTEMPT_RETIREMENT_RESULTS_SCHEMA_VERSION);
  assert.equal(retirements.attempted, 2);
  assert.equal(retirements.settled, 1);
  assert.equal(retirements.unsettled, 1);
  assert.equal(retirements.omitted_count, 0);
  assert.equal(retirements.results.length, 2);

  const byRunId = new Map(retirements.results.map((entry) => [entry.tuple.run_id, entry]));
  assert.equal(byRunId.get(OLD_TUPLE.run_id).retired, true);
  assert.equal(byRunId.get(secondTuple.run_id).retired, false,
    "an attempt that could not settle is reported, not silently dropped");
  for (const entry of retirements.results) {
    assert.deepEqual(Object.keys(entry).sort(), ["code", "reason", "retired", "tuple", "verdict"]);
    assert.equal(entry.reason === null || entry.reason.length <= 200, true, "the reason is bounded");
  }

  assert.equal(
    readManagedRunProcessIdentity({ mainRepo: fx.repo, tuple: OLD_TUPLE }).state,
    MANAGED_RUN_PROCESS_IDENTITY_STATES.RETIRED
  );
  assert.equal(
    readManagedRunProcessIdentity({ mainRepo: fx.repo, tuple: secondTuple }).state,
    MANAGED_RUN_PROCESS_IDENTITY_STATES.PENDING
  );
});

const CLEAN_STRUCTURED_OUTCOME = Object.freeze({
  outcome: "clean",
  clean_review: true,
  review_result: Object.freeze({
    review_outcome: "no_findings",
    clean_review: true,
    no_findings: true,
    blocking_finding_count: 0,
    medium_finding_count: 0,
    reviewed_controls: Object.freeze([])
  })
});

test("WK-1860 reviewer outcome selects findings, never admission, on a settled delivery", async (t) => {

  const variations = [
    { label: "changes-requested", outcome: "retain", findings: true },
    { label: "clean", outcome: CLEAN_STRUCTURED_OUTCOME, findings: false },
    { label: "prose-only", outcome: null, findings: false }
  ];

  for (const variation of variations) {
    const fx = await fixture(t);
    await dispatchAdvisoryReviews(fx);
    const witness = correctiveReceipt(fx);
    if (variation.outcome !== "retain") {
      fx.receipts[fx.receipts.indexOf(witness)] =
        { ...witness, structured_outcome: variation.outcome };
    }
    integrateCommittedSlice(fx);
    clearSubjectReservation(fx);

    const outcome = await reissueWorkerDispatch(fx.newBackend(), `outcome-${variation.label}`);
    assert.equal(outcome.accepted, true,
      `${variation.label} must not decide admission: ${JSON.stringify(outcome)}`);

    const workerLaunches = fx.launches.filter((entry) => entry.role === "worker");
    assert.equal(workerLaunches.length, 1, "exactly one remediation worker launches");
    const context = workerLaunches[0].readiness.trusted_corrective_findings_context;
    if (variation.findings) {
      assert.notEqual(context, undefined,
        "a findings-bearing receipt supplies the remediation worker's instructions");
      assert.equal(context.findings.length, 1);
    } else {
      assert.equal(context, undefined,
        `${variation.label} carries no findings, so no context is carried at all`);
    }
  }
});

const CORRECTIVE_STORE_SHAPES = Object.freeze([
  { label: "no-receipt-at-all", shape: (receipts) => { receipts.length = 0; } },
  { label: "clean", shape: (receipts) => {
    for (let index = 0; index < receipts.length; index += 1) {
      receipts[index] = { ...receipts[index], structured_outcome: CLEAN_STRUCTURED_OUTCOME };
    }
  } },
  { label: "prose-only", shape: (receipts) => {
    for (let index = 0; index < receipts.length; index += 1) {
      receipts[index] = { ...receipts[index], structured_outcome: null };
    }
  } },
  { label: "changes-requested", shape: () => {} }
]);

test("WK-1860 receipt presence and outcome are not inputs to corrective admission", async (t) => {
  for (const store of CORRECTIVE_STORE_SHAPES) {
    const fx = await fixture(t);
    await dispatchAdvisoryReviews(fx);
    store.shape(fx.receipts);

    const outcome = await reissueWorkerDispatch(fx.newBackend(), `store-${store.label}`);
    assert.equal(outcome.accepted, true,
      `${store.label} must admit exactly as an empty store does: ${JSON.stringify(outcome)}`);
    assert.equal(fx.launches.filter((entry) => entry.role === "worker").length, 1);
  }
});

test("WK-1860 an integrated delivery with an empty store refuses on the slice-tip fact, not on an outcome", async (t) => {
  const fx = await fixture(t);
  await dispatchAdvisoryReviews(fx);
  integrateCommittedSlice(fx);
  clearSubjectReservation(fx);
  discardManagedRunProcessIdentity({ mainRepo: fx.repo, tuple: OLD_TUPLE });
  fx.receipts.length = 0;

  const outcome = await reissueWorkerDispatch(fx.newBackend(), "integrated-empty-store");
  assert.equal(outcome.accepted, false, JSON.stringify(outcome));
  assert.equal(outcome.refusal.reason, "managed_slice_tip_reconcile_required");
  assert.equal(outcome.refusal.detail.reconcile_state, "orphaned");
  assert.equal(outcome.refusal.detail.source_code,
    "agent_launch.worktree_substrate.slice_tip_reconcile_required.v1");

  assert.equal(typeof outcome.refusal.detail.slice_tip, "string");
  assert.equal(typeof outcome.refusal.detail.wk_base_sha, "string");
  assert.equal(
    /changes_requested|clean_review|no_findings|review_outcome/u.test(JSON.stringify(outcome)),
    false,
    "the refusal rests on the slice-tip fact and names no reviewer verdict"
  );
  assert.equal(fx.launches.some((entry) => entry.role === "worker"), false);
});

test("WK-1723#SLICE-017 changed corrective contracts require fresh identity and preserve historical authority", async (t) => {
  const fx = await fixture(t);
  await dispatchAdvisoryReviews(fx);
  integrateCommittedSlice(fx);
  clearSubjectReservation(fx);

  const historicalReceipt = correctiveReceipt(fx);
  const historicalReceiptBytes = JSON.stringify(historicalReceipt);
  const historicalIdentity = readManagedRunProcessIdentity({ mainRepo: fx.repo, tuple: OLD_TUPLE });
  const historicalContract = JSON.parse(historicalReceipt.canonical_parent_wk_contract);

  const recordPath = path.join(fx.repo, "wiki", "work-records", "WK-1712.json");
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  record.status = "active";
  const slice = record.slices.find((entry) => entry.id === "SLICE-001");
  slice.status = "todo";
  slice.acceptance.criteria = [...slice.acceptance.criteria, "Apply the current corrective contract."];
  const currentAcceptance = [...slice.acceptance.criteria];
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);

  assert.equal(historicalContract.slices.find((entry) => entry.id === "SLICE-001")
    .acceptance.criteria.includes("Apply the current corrective contract."), false,
    "the historical receipt freezes the old acceptance contract");
  assert.equal(currentAcceptance.includes("Apply the current corrective contract."), true,
    "the canonical corrective record carries the changed acceptance contract");

  const reopened = await reissueWorkerDispatch(fx.newBackend(), "changed-contract-cold-restart");
  assert.equal(reopened.accepted, true, JSON.stringify(reopened));

  const workerInput = fx.launches.filter((entry) => entry.role === "worker").at(-1);
  assert.notEqual(workerInput.run_id, OLD_TUPLE.run_id, "the new delivery has a fresh run identity");
  assert.notEqual(workerInput.monitor_handle, OLD_TUPLE.launch_ref,
    "the new delivery has a fresh monitor identity");
  assert.notDeepEqual(
    { assigned_unit: SUBJECT, launch_ref: workerInput.monitor_handle, run_id: workerInput.run_id, retry_id: 0 },
    OLD_TUPLE,
    "the changed current contract cannot reuse the historical managed identity"
  );
  assert.deepEqual(
    readManagedRunProcessIdentity({ mainRepo: fx.repo, tuple: {
      assigned_unit: SUBJECT,
      launch_ref: workerInput.monitor_handle,
      run_id: workerInput.run_id,
      retry_id: 0
    } }).tuple,
    {
      assigned_unit: SUBJECT,
      launch_ref: workerInput.monitor_handle,
      run_id: workerInput.run_id,
      retry_id: 0
    },
    "the new managed identity is bound to the current corrective attempt"
  );

  assert.equal(JSON.stringify(correctiveReceipt(fx)), historicalReceiptBytes,
    "the historical receipt remains byte-unchanged");
  const retiredHistoricalIdentity = readManagedRunProcessIdentity({
    mainRepo: fx.repo,
    tuple: OLD_TUPLE
  });
  assert.deepEqual(retiredHistoricalIdentity.tuple, historicalIdentity.tuple,
    "every field of the historical identity tuple remains unchanged");
  assert.equal(retiredHistoricalIdentity.state, "retired",
    "the historical identity is retired and cannot authorize the new delivery");
});
