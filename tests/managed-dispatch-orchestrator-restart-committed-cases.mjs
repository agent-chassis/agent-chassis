

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  bindManagedRunSandboxProcessIdentity,
  deriveOuterSandboxKillShape,
  MANAGED_RUN_PROCESS_IDENTITY_STATES,
  publishPendingManagedRunProcessIdentity,
  readManagedRunProcessIdentity
} from "../packages/agent-launch-cli/src/lib/managed-run-process-identity.mjs";

import {
  managedRunSubjectSuccessorGuardFilePath,
  MANAGED_RUN_SUBJECT_SUCCESSOR_GUARD_SCHEMA_VERSION
} from "../packages/agent-launch-cli/src/lib/managed-run-subject-reservation.mjs";
import {
  ALIVE,
  assertConvergentLoser,
  assertNoOldHandleStatusRoute,
  bareFixture,
  BOOT_ID,
  clearSubjectReservation,
  committedFixture,
  DEAD,
  dispatchWorker,
  git,
  idMint,
  INITIATIVE,
  inMemoryReceiptStore,
  livenessDeps,
  readSubjectReservation,
  reconstructBackend,
  SANDBOX_PID,
  SLICE_REF,
  SUBJECT,
  WK
} from "./managed-dispatch-orchestrator-restart-fixture.mjs";

test("WK-1723 a committed delivery continues from canonical exact-slice state across restarts, never bricked or duplicated", async (t) => {
  const fx = await committedFixture(t);
  const ids = idMint();
  const { store } = inMemoryReceiptStore();
  const launches = [];
  const workerLaunches = () => launches.filter((entry) => entry.role === "worker").length;
  const deliveredTip = git(fx.repo, "rev-parse", SLICE_REF);

  const first = reconstructBackend(fx, { procs: DEAD(), ids, launches, receiptStore: store });
  const corrective = await dispatchWorker(first, "restart-0");
  assert.equal(corrective.accepted, true, JSON.stringify(corrective));
  assert.equal(workerLaunches(), 1);
  const correctiveInput = launches.find((entry) => entry.role === "worker");
  assert.equal(correctiveInput.worktree_provisioning.slice_binding.base_sha, deliveredTip);
  assert.equal(readManagedRunProcessIdentity({ mainRepo: fx.repo, tuple: fx.tuple }).state,
    MANAGED_RUN_PROCESS_IDENTITY_STATES.RETIRED);
  assert.equal(readManagedRunProcessIdentity({ mainRepo: fx.repo, tuple: fx.tuple }).retirement.reason,
    "corrective_supersession");

  const second = reconstructBackend(fx, { procs: DEAD(), ids, launches, receiptStore: store });
  const reissue = await dispatchWorker(second, "restart-1");
  assert.equal(reissue.accepted, false, JSON.stringify(reissue));
  assert.equal(reissue.refusal.reason, "managed_run_prior_attempt_live");
  assert.equal(reissue.refusal.detail.continuation.run_id, corrective.run_id);
  assert.equal(workerLaunches(), 1, "the committed delivery is never duplicated across restarts");
});

test("WK-1723 SLICE-008: a committed delivery whose proven-dead attempt owns no reservation converges to exactly one successor across repeated cold reissues", async (t) => {
  const fx = await committedFixture(t);
  const ids = idMint();
  const { store } = inMemoryReceiptStore();
  const launches = [];
  const workerLaunches = () => launches.filter((entry) => entry.role === "worker").length;
  const deliveredTip = git(fx.repo, "rev-parse", SLICE_REF);

  clearSubjectReservation(fx.repo);
  assert.equal(readManagedRunProcessIdentity({ mainRepo: fx.repo, tuple: fx.tuple }).state,
    MANAGED_RUN_PROCESS_IDENTITY_STATES.BOUND, "the dead attempt is still unsettled");

  const outcomes = [];
  for (let reissue = 0; reissue < 3; reissue += 1) {
    const backend = reconstructBackend(fx, { procs: DEAD(), ids, launches, receiptStore: store });
    outcomes.push(await dispatchWorker(backend, `holderless-${reissue}`));
  }

  const accepted = outcomes.filter((outcome) => outcome.accepted === true);
  assert.equal(accepted.length, 1, `exactly one reissue is accepted: ${JSON.stringify(outcomes)}`);
  assert.equal(outcomes[0].accepted, true, "the FIRST eligible reissue converges");
  assert.equal(workerLaunches(), 1, "exactly one corrective successor launches");

  assert.equal(launches.find((entry) => entry.role === "worker")
    .worktree_provisioning.slice_binding.base_sha, deliveredTip);

  const retired = readManagedRunProcessIdentity({ mainRepo: fx.repo, tuple: fx.tuple });
  assert.equal(retired.state, MANAGED_RUN_PROCESS_IDENTITY_STATES.RETIRED);
  assert.equal(retired.retirement.reason, "corrective_supersession");
  assert.equal(retired.retirement.evidence.delivered_tip_sha, deliveredTip);
  assert.equal(retired.retirement.evidence.source_worker_run_id, fx.tuple.run_id);

  const reservation = readSubjectReservation(fx.repo);
  assert.equal(reservation.tuple?.run_id, accepted[0].run_id);
  for (const outcome of outcomes.slice(1)) {
    assert.equal(outcome.accepted, false);
    assertConvergentLoser(outcome.refusal, { winnerRunId: accepted[0].run_id });
  }
});

test("WK-1723 SLICE-008: CONCURRENT holder-less reissues elect exactly one successor; every loser observes the winner", async (t) => {
  const fx = await committedFixture(t);
  const ids = idMint();
  const { store } = inMemoryReceiptStore();
  const launches = [];

  clearSubjectReservation(fx.repo);

  const backends = Array.from({ length: 4 }, () =>
    reconstructBackend(fx, { procs: DEAD(), ids, launches, receiptStore: store }));
  const outcomes = await Promise.all(
    backends.map((backend, index) => dispatchWorker(backend, `concurrent-${index}`))
  );

  const accepted = outcomes.filter((outcome) => outcome.accepted === true);
  assert.equal(accepted.length, 1, `exactly one successor wins: ${JSON.stringify(outcomes)}`);
  assert.equal(launches.filter((entry) => entry.role === "worker").length, 1,
    "no duplicate worker launches under concurrency");

  assert.equal(readSubjectReservation(fx.repo).tuple?.run_id, accepted[0].run_id);

  assert.equal(readManagedRunProcessIdentity({ mainRepo: fx.repo, tuple: fx.tuple }).state,
    MANAGED_RUN_PROCESS_IDENTITY_STATES.RETIRED);
  for (const outcome of outcomes.filter((entry) => entry.accepted !== true)) {
    assertConvergentLoser(outcome.refusal, { winnerRunId: accepted[0].run_id });
  }
});

test("WK-1723 SLICE-008: a PLURAL proven-dead history with no reservation holder converges without electing a representative", async (t) => {
  const fx = await committedFixture(t);
  const ids = idMint();
  const { store } = inMemoryReceiptStore();
  const launches = [];

  const historicalTuple = {
    assigned_unit: SUBJECT, launch_ref: "wkmh_hist_dead", run_id: "wkdb_hist_dead", retry_id: 0
  };
  const historicalDeps = livenessDeps({ [process.pid]: "111", 7001: "424" });
  const historicalPending = publishPendingManagedRunProcessIdentity({
    mainRepo: fx.repo, tuple: historicalTuple, role: "worker", deps: historicalDeps
  });
  bindManagedRunSandboxProcessIdentity(historicalPending, {
    pid: 7001, killShape: deriveOuterSandboxKillShape({ pid: 7001 }), deps: historicalDeps
  });
  clearSubjectReservation(fx.repo);

  const allDead = { [process.pid]: "999", 4242: "888", [SANDBOX_PID]: "888" };
  const first = reconstructBackend(fx, { procs: allDead, ids, launches, receiptStore: store });
  const successor = await dispatchWorker(first, "plural-holderless-0");
  assert.equal(successor.accepted, true, JSON.stringify(successor));
  assert.equal(launches.filter((entry) => entry.role === "worker").length, 1);

  for (const tuple of [fx.tuple, historicalTuple]) {
    const record = readManagedRunProcessIdentity({ mainRepo: fx.repo, tuple });
    assert.equal(record.state, MANAGED_RUN_PROCESS_IDENTITY_STATES.RETIRED,
      `${tuple.run_id} is settled`);
    assert.equal(record.retirement.reason, "corrective_supersession");

    assert.equal(record.retirement.evidence.source_worker_run_id, tuple.run_id);
    assert.equal(record.retirement.evidence.source_worker_monitor_handle, tuple.launch_ref);
  }

  const after = reconstructBackend(fx, { procs: allDead, ids, launches, receiptStore: store });
  const reissue = await dispatchWorker(after, "plural-holderless-1");
  assert.equal(reissue.accepted, false, JSON.stringify(reissue));
  assertConvergentLoser(reissue.refusal, { winnerRunId: successor.run_id });
  assert.equal(launches.filter((entry) => entry.role === "worker").length, 1);
});

test("WK-1723 SLICE-008: a contended successor guard refuses without wedging the subject", async (t) => {
  const fx = await committedFixture(t);
  const ids = idMint();
  const { store } = inMemoryReceiptStore();
  const launches = [];

  clearSubjectReservation(fx.repo);

  const guardPath = managedRunSubjectSuccessorGuardFilePath(fx.repo, SUBJECT);
  mkdirSync(path.dirname(guardPath), { recursive: true });
  const heldGuard = `${JSON.stringify({
    schema_version: MANAGED_RUN_SUBJECT_SUCCESSOR_GUARD_SCHEMA_VERSION,
    subject: SUBJECT,
    guard_id: "guard-contended-fixture-0001",
    owner_launcher: { pid: process.pid, starttime: "999", boot_id: BOOT_ID },
    acquired_at: { uptime: 1000, boot_id: BOOT_ID }
  }, null, 2)}\n`;
  writeFileSync(guardPath, heldGuard);

  const blocked = reconstructBackend(fx, { procs: DEAD(), ids, launches, receiptStore: store });
  const refused = await dispatchWorker(blocked, "guard-contended");
  assert.equal(refused.accepted, false, JSON.stringify(refused));
  assert.equal(refused.refusal.reason, "managed_run_prior_attempt_reserved");
  assert.equal(launches.filter((entry) => entry.role === "worker").length, 0);

  assert.equal(readManagedRunProcessIdentity({ mainRepo: fx.repo, tuple: fx.tuple }).state,
    MANAGED_RUN_PROCESS_IDENTITY_STATES.BOUND);
  assert.equal(readSubjectReservation(fx.repo), null);
  assert.equal(readFileSync(guardPath, "utf8"), heldGuard);

  writeFileSync(guardPath, `${JSON.stringify({ subject: SUBJECT })}\n`);
  const opaque = reconstructBackend(fx, { procs: DEAD(), ids, launches, receiptStore: store });
  const unreadable = await dispatchWorker(opaque, "guard-unreadable");
  assert.equal(unreadable.accepted, false, JSON.stringify(unreadable));
  assert.equal(unreadable.refusal.reason, "managed_run_prior_attempt_unreadable");
  assert.equal(launches.filter((entry) => entry.role === "worker").length, 0);
  assert.equal(readManagedRunProcessIdentity({ mainRepo: fx.repo, tuple: fx.tuple }).state,
    MANAGED_RUN_PROCESS_IDENTITY_STATES.BOUND);
  assert.equal(readSubjectReservation(fx.repo), null);

  rmSync(guardPath);
  const freed = reconstructBackend(fx, { procs: DEAD(), ids, launches, receiptStore: store });
  const accepted = await dispatchWorker(freed, "guard-released");
  assert.equal(accepted.accepted, true, JSON.stringify(accepted));
  assert.equal(launches.filter((entry) => entry.role === "worker").length, 1);
  assert.equal(readManagedRunProcessIdentity({ mainRepo: fx.repo, tuple: fx.tuple }).state,
    MANAGED_RUN_PROCESS_IDENTITY_STATES.RETIRED);
});

test("WK-1723 SLICE-005: an advanced-ref committed delivery with a live launcher and dead sandbox stays corrective, never no-delivery retirement", async (t) => {
  const fx = await committedFixture(t);
  const ids = idMint();
  const { store } = inMemoryReceiptStore();
  const launches = [];
  const deliveredTip = git(fx.repo, "rev-parse", SLICE_REF);

  assert.notEqual(deliveredTip, git(fx.repo, "rev-parse", `wk/${INITIATIVE}/${WK}`));

  const liveLauncherDeadSandbox = { [process.pid]: "111", 4242: "888", [SANDBOX_PID]: "888" };
  const backend = reconstructBackend(fx, { procs: liveLauncherDeadSandbox, ids, launches, receiptStore: store });
  const corrective = await dispatchWorker(backend, "restart-0");
  assert.equal(corrective.accepted, true, JSON.stringify(corrective));
  assert.equal(launches.filter((entry) => entry.role === "worker").length, 1);

  const correctiveInput = launches.find((entry) => entry.role === "worker");
  assert.equal(correctiveInput.worktree_provisioning.slice_binding.base_sha, deliveredTip);

  const retired = readManagedRunProcessIdentity({ mainRepo: fx.repo, tuple: fx.tuple });
  assert.equal(retired.state, MANAGED_RUN_PROCESS_IDENTITY_STATES.RETIRED);
  assert.equal(retired.retirement.reason, "corrective_supersession");
  assert.notEqual(retired.retirement.reason, "no_commit_base_equal");
});

test("WK-1723 DECISIVE: live -> cold reissue -> proven-dead no-delivery -> cold reissue -> exactly one successor, never via the old handle", async (t) => {
  const fx = bareFixture(t);
  const ids = idMint();
  const { store } = inMemoryReceiptStore();
  const launches = [];
  const workerLaunchCount = () => launches.filter((entry) => entry.role === "worker").length;

  const start = reconstructBackend(fx, { procs: ALIVE(), ids, launches, receiptStore: store });
  const launched = await dispatchWorker(start, "start-session");
  assert.equal(launched.accepted, true, JSON.stringify(launched));
  assert.equal(workerLaunchCount(), 1);
  const priorTuple = {
    assigned_unit: SUBJECT, launch_ref: launched.monitor_handle, run_id: launched.run_id, retry_id: 0
  };

  const liveBackend = reconstructBackend(fx, { procs: ALIVE(), ids, launches, receiptStore: store });
  const liveReissue = await dispatchWorker(liveBackend, "restart-live");
  assert.equal(liveReissue.accepted, false, JSON.stringify(liveReissue));
  assert.equal(liveReissue.refusal.reason, "managed_run_prior_attempt_live");
  assert.equal(liveReissue.refusal.detail.continuation.kind, "live");
  assert.equal(liveReissue.refusal.detail.continuation.run_id, launched.run_id);
  assert.equal(liveReissue.refusal.detail.continuation.monitor_handle, launched.monitor_handle);
  assert.equal(liveReissue.refusal.detail.recovery_route, "workspace_agent_dispatch");
  assertNoOldHandleStatusRoute(liveReissue.refusal);
  assert.equal(workerLaunchCount(), 1, "a live current attempt is never duplicated");

  assert.equal(git(fx.repo, "rev-parse", SLICE_REF), git(fx.repo, "rev-parse", `wk/${INITIATIVE}/${WK}`));

  const deadBackend = reconstructBackend(fx, { procs: DEAD(), ids, launches, receiptStore: store });
  const successor = await dispatchWorker(deadBackend, "restart-dead");
  assert.equal(successor.accepted, true, JSON.stringify(successor));
  assert.equal(workerLaunchCount(), 2, "exactly one successor launches");
  assert.notEqual(successor.run_id, launched.run_id);
  const retired = readManagedRunProcessIdentity({ mainRepo: fx.repo, tuple: priorTuple });
  assert.equal(retired.state, MANAGED_RUN_PROCESS_IDENTITY_STATES.RETIRED);
  assert.equal(retired.retirement.reason, "no_commit_base_equal");

  const afterBackend = reconstructBackend(fx, { procs: DEAD(), ids, launches, receiptStore: store });
  const afterReissue = await dispatchWorker(afterBackend, "restart-after");
  assert.equal(afterReissue.accepted, false, JSON.stringify(afterReissue));
  assert.equal(afterReissue.refusal.reason, "managed_run_prior_attempt_live");
  assert.equal(afterReissue.refusal.detail.continuation.run_id, successor.run_id);
  assertNoOldHandleStatusRoute(afterReissue.refusal);
  assert.equal(workerLaunchCount(), 2, "the successor is never duplicated across further restarts");
});
