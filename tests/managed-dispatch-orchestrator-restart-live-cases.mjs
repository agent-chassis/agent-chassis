

import assert from "node:assert/strict";
import test from "node:test";

import {
  bindManagedRunSandboxProcessIdentity,
  deriveOuterSandboxKillShape,
  MANAGED_RUN_PROCESS_IDENTITY_STATES,
  publishPendingManagedRunProcessIdentity,
  readManagedRunProcessIdentity
} from "../packages/agent-launch-cli/src/lib/managed-run-process-identity.mjs";
import {
  ALIVE,
  bareFixture,
  DEAD,
  dispatchWorker,
  git,
  idMint,
  INITIATIVE,
  inMemoryReceiptStore,
  LAUNCHER_ALIVE_SANDBOX_DEAD,
  livenessDeps,
  reconstructBackend,
  SANDBOX_PID,
  SLICE_REF,
  SUBJECT,
  WK
} from "./managed-dispatch-orchestrator-restart-fixture.mjs";

test("WK-1723 a live current attempt converges as an observable continuation across repeated restarts, never duplicated", async (t) => {
  const fx = bareFixture(t);
  const ids = idMint();
  const { store } = inMemoryReceiptStore();
  const launches = [];

  const start = await reconstructBackend(fx, { procs: ALIVE(), ids, launches, receiptStore: store });
  const launched = await dispatchWorker(start, "start-session");
  assert.equal(launched.accepted, true, JSON.stringify(launched));
  const workerLaunchCount = () => launches.filter((entry) => entry.role === "worker").length;
  assert.equal(workerLaunchCount(), 1);

  for (let restart = 0; restart < 3; restart += 1) {
    const backend = reconstructBackend(fx, { procs: ALIVE(), ids, launches, receiptStore: store });
    const reissue = await dispatchWorker(backend, `restart-${restart}`);
    assert.equal(reissue.accepted, false, `restart ${restart}: a live attempt is never relaunched`);
    assert.equal(reissue.refusal.reason, "managed_run_prior_attempt_live");

    const continuation = reissue.refusal.detail.continuation;
    assert.equal(continuation.kind, "live");
    assert.equal(continuation.run_id, launched.run_id);
    assert.equal(continuation.monitor_handle, launched.monitor_handle);

    assert.equal(workerLaunchCount(), 1, `restart ${restart}: no duplicate worker`);
  }
});

test("WK-1723 plural historical attempts do not brick the subject; the current reservation resolves the live continuation", async (t) => {
  const fx = bareFixture(t);
  const ids = idMint();
  const { store } = inMemoryReceiptStore();
  const launches = [];

  const start = reconstructBackend(fx, { procs: ALIVE(), ids, launches, receiptStore: store });
  const launched = await dispatchWorker(start, "start-session");
  assert.equal(launched.accepted, true, JSON.stringify(launched));

  for (const [suffix, pid] of [["hist_a", 6001], ["hist_b", 6002]]) {
    const deps = livenessDeps({ [process.pid]: "555", [pid]: "424" });
    const pending = publishPendingManagedRunProcessIdentity({
      mainRepo: fx.repo,
      tuple: { assigned_unit: SUBJECT, launch_ref: `wkmh_${suffix}`, run_id: `wkdb_${suffix}`, retry_id: 0 },
      role: "worker",
      deps
    });
    bindManagedRunSandboxProcessIdentity(pending, {
      pid, killShape: deriveOuterSandboxKillShape({ pid }), deps
    });
  }

  for (let restart = 0; restart < 2; restart += 1) {

    const procs = { [process.pid]: "555", [SANDBOX_PID]: "777", 6001: "424", 6002: "424" };
    const backend = reconstructBackend(fx, { procs, ids, launches, receiptStore: store });
    const reissue = await dispatchWorker(backend, `restart-${restart}`);
    assert.equal(reissue.accepted, false);
    assert.equal(reissue.refusal.reason, "managed_run_prior_attempt_live");
    assert.notEqual(reissue.refusal.reason, "managed_run_prior_attempt_ambiguous");
    assert.equal(reissue.refusal.detail.continuation.run_id, launched.run_id);
  }
});

test("WK-1723 a proven-dead no-delivery attempt is retired subject-addressed and the subject becomes launchable without the old handle", async (t) => {
  const fx = bareFixture(t);
  const ids = idMint();
  const { store } = inMemoryReceiptStore();
  const launches = [];

  const start = reconstructBackend(fx, { procs: ALIVE(), ids, launches, receiptStore: store });
  const launched = await dispatchWorker(start, "start-session");
  assert.equal(launched.accepted, true, JSON.stringify(launched));
  const priorTuple = {
    assigned_unit: SUBJECT,
    launch_ref: launched.monitor_handle,
    run_id: launched.run_id,
    retry_id: 0
  };

  assert.equal(git(fx.repo, "rev-parse", SLICE_REF), git(fx.repo, "rev-parse", `wk/${INITIATIVE}/${WK}`));

  const backend = reconstructBackend(fx, { procs: DEAD(), ids, launches, receiptStore: store });
  const reissue = await dispatchWorker(backend, "restart-0");
  assert.equal(reissue.accepted, true, JSON.stringify(reissue));

  assert.equal(launches.filter((entry) => entry.role === "worker").length, 2);
  assert.notEqual(reissue.run_id, launched.run_id);

  const retired = readManagedRunProcessIdentity({ mainRepo: fx.repo, tuple: priorTuple });
  assert.equal(retired.state, MANAGED_RUN_PROCESS_IDENTITY_STATES.RETIRED);
  assert.equal(retired.retirement.reason, "no_commit_base_equal");
});

test("WK-1723 SLICE-005: a live-launcher dead-sandbox no-delivery attempt converges by subject redispatch, exactly one successor without the old handle", async (t) => {
  const fx = bareFixture(t);
  const ids = idMint();
  const { store } = inMemoryReceiptStore();
  const launches = [];
  const workerLaunchCount = () => launches.filter((entry) => entry.role === "worker").length;

  const start = reconstructBackend(fx, { procs: ALIVE(), ids, launches, receiptStore: store });
  const launched = await dispatchWorker(start, "start-session");
  assert.equal(launched.accepted, true, JSON.stringify(launched));
  const priorTuple = {
    assigned_unit: SUBJECT,
    launch_ref: launched.monitor_handle,
    run_id: launched.run_id,
    retry_id: 0
  };

  assert.equal(git(fx.repo, "rev-parse", SLICE_REF), git(fx.repo, "rev-parse", `wk/${INITIATIVE}/${WK}`));

  const backend = reconstructBackend(fx, {
    procs: LAUNCHER_ALIVE_SANDBOX_DEAD(), ids, launches, receiptStore: store
  });
  const reissue = await dispatchWorker(backend, "restart-0");
  assert.equal(reissue.accepted, true, JSON.stringify(reissue));

  assert.equal(workerLaunchCount(), 2, "exactly one successor launches");
  assert.notEqual(reissue.run_id, launched.run_id);

  const retired = readManagedRunProcessIdentity({ mainRepo: fx.repo, tuple: priorTuple });
  assert.equal(retired.state, MANAGED_RUN_PROCESS_IDENTITY_STATES.RETIRED);
  assert.equal(retired.retirement.reason, "no_commit_base_equal");

  const afterBackend = reconstructBackend(fx, {
    procs: LAUNCHER_ALIVE_SANDBOX_DEAD(), ids, launches, receiptStore: store
  });
  const afterReissue = await dispatchWorker(afterBackend, "restart-1");
  assert.equal(afterReissue.accepted, false, JSON.stringify(afterReissue));
  assert.equal(afterReissue.refusal.reason, "managed_run_prior_attempt_live");
  assert.equal(afterReissue.refusal.detail.continuation.run_id, reissue.run_id);
  assert.equal(workerLaunchCount(), 2, "the successor is never duplicated");
});
