

import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  managedRunProcessIdentityFilePath
} from "../packages/agent-launch-cli/src/lib/managed-run-process-identity.mjs";
import { bindingFilePath } from "../packages/agent-launch-cli/src/lib/worktree-substrate-identity.mjs";
import {
  defaultRunGit,
  WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES
} from "../packages/agent-launch-cli/src/lib/worktree-substrate.mjs";
import {
  createBackendManagedIdentity,
  MANAGED_NO_DELIVERY_EVIDENCE_DIAGNOSTIC_CODES,
  ManagedNoDeliveryEvidenceError
} from "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-managed-identity.mjs";
import {
  ALIVE,
  assertNoDeliveryEvidenceFailureMutatedNothing,
  assertTypedNoDeliveryEvidenceFailure,
  bareFixture,
  DEAD,
  dispatchWorker,
  idMint,
  inMemoryReceiptStore,
  launchedNoDeliveryAttempt,
  livenessDeps,
  reconstructBackend,
  sliceRefVerificationSeam,
  SLICE_REF,
  SUBJECT
} from "./managed-dispatch-orchestrator-restart-fixture.mjs";

test("WK-1723 an attributable corrupt current record refuses mechanically before spawn, across restarts", async (t) => {
  const fx = bareFixture(t);
  const ids = idMint();
  const { store } = inMemoryReceiptStore();
  const launches = [];

  const start = reconstructBackend(fx, { procs: ALIVE(), ids, launches, receiptStore: store });
  const launched = await dispatchWorker(start, "start-session");
  assert.equal(launched.accepted, true);
  const priorTuple = {
    assigned_unit: SUBJECT, launch_ref: launched.monitor_handle, run_id: launched.run_id, retry_id: 0
  };

  writeFileSync(managedRunProcessIdentityFilePath(fx.repo, priorTuple), "{ not a record");

  for (let restart = 0; restart < 2; restart += 1) {
    const backend = reconstructBackend(fx, { procs: DEAD(), ids, launches, receiptStore: store });
    const reissue = await dispatchWorker(backend, `restart-${restart}`);
    assert.equal(reissue.accepted, false, JSON.stringify(reissue));
    assert.equal(reissue.refusal.reason, "managed_run_prior_attempt_unreadable");

    assert.equal(launches.filter((entry) => entry.role === "worker").length, 1, `restart ${restart}`);
  }
});

function retainedBindingFiles(repo, launchRef) {
  const storeDir = path.dirname(bindingFilePath(repo, "probe", "probe", 0));
  return readdirSync(storeDir)
    .map((name) => path.join(storeDir, name))
    .filter((file) => JSON.parse(readFileSync(file, "utf8")).launch_ref === launchRef);
}

test("WK-1723 SLICE-007: a thrown binding reconstruction reaches the caller typed, never as proven-dead", async (t) => {
  const state = await launchedNoDeliveryAttempt(t);

  const bindings = retainedBindingFiles(state.fx.repo, state.launched.monitor_handle);
  assert.notEqual(bindings.length, 0, "the launched attempt retained launcher bindings");
  writeFileSync(bindings[0], "{ not a binding");

  const backend = reconstructBackend(state.fx, {
    procs: DEAD(), ids: state.ids, launches: state.launches, receiptStore: state.store
  });
  const reissue = await dispatchWorker(backend, "restart-binding-throws");
  assert.equal(reissue.accepted, false, JSON.stringify(reissue));
  assertTypedNoDeliveryEvidenceFailure(reissue.refusal, {
    code: MANAGED_NO_DELIVERY_EVIDENCE_DIAGNOSTIC_CODES.BINDING_UNRESOLVED,
    causeCode: WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.BINDING_NOT_FOUND
  });
  assertNoDeliveryEvidenceFailureMutatedNothing(state);
});

test("WK-1723 SLICE-007: a thrown slice-ref Git verification reaches the caller typed, with no proven-dead fallback", async (t) => {
  const state = await launchedNoDeliveryAttempt(t);

  const backend = reconstructBackend(state.fx, {
    procs: DEAD(),
    ids: state.ids,
    launches: state.launches,
    receiptStore: state.store,
    reviewContextRunGit: sliceRefVerificationSeam(() => {
      throw new Error("injected slice-ref verification transport failure");
    })
  });
  const reissue = await dispatchWorker(backend, "restart-git-throws");
  assert.equal(reissue.accepted, false, JSON.stringify(reissue));
  assertTypedNoDeliveryEvidenceFailure(reissue.refusal, {
    code: MANAGED_NO_DELIVERY_EVIDENCE_DIAGNOSTIC_CODES.GIT_UNRESOLVED,
    causeText: "injected slice-ref verification transport failure"
  });
  assertNoDeliveryEvidenceFailureMutatedNothing(state);
});

test("WK-1723 SLICE-007: a failed or unusable non-throwing Git result fails visibly, never null", async (t) => {
  for (const [label, result] of [
    ["failed", { ok: false, status: 128, stderr: "fatal: Needed a single revision" }],
    ["unusable", { ok: true, stdout: "   \n" }],
    ["non-canonical", { ok: true, stdout: "garbage\n" }]
  ]) {
    const state = await launchedNoDeliveryAttempt(t);
    const backend = reconstructBackend(state.fx, {
      procs: DEAD(),
      ids: state.ids,
      launches: state.launches,
      receiptStore: state.store,
      reviewContextRunGit: sliceRefVerificationSeam(() => result)
    });
    const reissue = await dispatchWorker(backend, `restart-git-${label}`);
    assert.equal(reissue.accepted, false, `${label}: ${JSON.stringify(reissue)}`);
    assertTypedNoDeliveryEvidenceFailure(reissue.refusal, {
      code: MANAGED_NO_DELIVERY_EVIDENCE_DIAGNOSTIC_CODES.GIT_UNRESOLVED
    });
    assertNoDeliveryEvidenceFailureMutatedNothing(state);
  }
});

function managedIdentitySeam(fx, { procs, reviewContextRunGit = defaultRunGit }) {
  return createBackendManagedIdentity({
    worktreeProvisioningConfig: {
      mainRepo: fx.repo,
      worktreeRoot: fx.worktreeRoot,
      confinementAvailable: true
    },
    reviewContextRunGit,
    correctiveContinuationProofs: new Map(),
    managedRunIdentityRoot: fx.repo,
    managedRunIdentityDeps: livenessDeps(procs)
  });
}

async function captureNoDeliveryEvidenceThrow(fx, options) {
  const seam = managedIdentitySeam(fx, options);
  let captured = null;
  try {
    const resolved = await seam.checkPriorManagedAttempt({ role: "worker", subject: SUBJECT });
    assert.fail(`no-delivery evidence resolution returned instead of failing: ${JSON.stringify(resolved)}`);
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
    captured = error;
  }
  return captured;
}

function assertStructuredNoDeliveryEvidenceError(error, { code, cause = null, causeCode = null }) {
  assert.equal(error instanceof ManagedNoDeliveryEvidenceError, true,
    `expected ManagedNoDeliveryEvidenceError, got ${error?.name}: ${error?.message}`);
  assert.equal(error.code, code, "the stable outer code is carried as a FIELD, not only in prose");
  assert.equal(error.detail?.cause_code ?? null, causeCode,
    "detail.cause_code must carry the original producer's stable code");
  if (causeCode === null) {
    assert.equal(error.cause, undefined, "no producer error exists, so none may be invented");
  } else {
    assert.equal(error.cause instanceof Error, true, "the producer error OBJECT must be retained");
    assert.equal(error.detail.cause_code, error.cause.code ?? null,
      "detail.cause_code must be derived from the retained cause, never fabricated");
    if (cause !== null) {
      assert.equal(error.cause, cause, "cause must be the EXACT original error object");
    }
  }

  assert.equal(typeof error.message === "string" && error.message.length > 0, true);
}

test("WK-1723 SLICE-007: a binding reconstruction failure carries a STRUCTURED code, cause_code, and the exact cause", async (t) => {
  const state = await launchedNoDeliveryAttempt(t);
  const bindings = retainedBindingFiles(state.fx.repo, state.launched.monitor_handle);
  assert.notEqual(bindings.length, 0, "the launched attempt retained launcher bindings");
  writeFileSync(bindings[0], "{ not a binding");

  const error = await captureNoDeliveryEvidenceThrow(state.fx, { procs: DEAD() });
  assertStructuredNoDeliveryEvidenceError(error, {
    code: MANAGED_NO_DELIVERY_EVIDENCE_DIAGNOSTIC_CODES.BINDING_UNRESOLVED,
    causeCode: WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.BINDING_NOT_FOUND
  });

  assert.equal(error.cause instanceof Error, true, "the producer error object is retained as cause");
  assert.equal(error.cause.code, WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.BINDING_NOT_FOUND);
  assert.equal(error.detail.subject, SUBJECT);
  assert.equal(error.detail.launch_ref, state.launched.monitor_handle);
  assertNoDeliveryEvidenceFailureMutatedNothing(state);
});

test("WK-1723 SLICE-007: a thrown Git verification carries a STRUCTURED code and the exact injected cause", async (t) => {
  const state = await launchedNoDeliveryAttempt(t);

  const injected = new Error("injected structured slice-ref transport failure");
  injected.code = "agent_launch.test_seam.slice_ref_transport_failed.v1";

  const error = await captureNoDeliveryEvidenceThrow(state.fx, {
    procs: DEAD(),
    reviewContextRunGit: sliceRefVerificationSeam(() => { throw injected; })
  });
  assertStructuredNoDeliveryEvidenceError(error, {
    code: MANAGED_NO_DELIVERY_EVIDENCE_DIAGNOSTIC_CODES.GIT_UNRESOLVED,
    cause: injected,
    causeCode: injected.code
  });
  assert.equal(error.detail.slice_ref, SLICE_REF);
  assertNoDeliveryEvidenceFailureMutatedNothing(state);
});

test("WK-1723 SLICE-007: a failed or non-canonical Git RESULT carries a structured code and bounded result detail", async (t) => {

  const failedState = await launchedNoDeliveryAttempt(t);
  const failed = await captureNoDeliveryEvidenceThrow(failedState.fx, {
    procs: DEAD(),
    reviewContextRunGit: sliceRefVerificationSeam(() => ({
      ok: false, status: 128, stderr: "fatal: Needed a single revision"
    }))
  });
  assertStructuredNoDeliveryEvidenceError(failed, {
    code: MANAGED_NO_DELIVERY_EVIDENCE_DIAGNOSTIC_CODES.GIT_UNRESOLVED
  });
  assert.equal(failed.detail.status, 128);
  assert.equal(failed.detail.stderr, "fatal: Needed a single revision");
  assertNoDeliveryEvidenceFailureMutatedNothing(failedState);

  const garbageState = await launchedNoDeliveryAttempt(t);
  const garbage = await captureNoDeliveryEvidenceThrow(garbageState.fx, {
    procs: DEAD(),
    reviewContextRunGit: sliceRefVerificationSeam(() => ({ ok: true, stdout: "garbage\n" }))
  });
  assertStructuredNoDeliveryEvidenceError(garbage, {
    code: MANAGED_NO_DELIVERY_EVIDENCE_DIAGNOSTIC_CODES.GIT_UNRESOLVED
  });

  assert.equal(garbage.detail.resolved_output, "garbage");
  assert.equal(garbage.detail.resolved_output_length, 7);
  assert.equal(garbage.detail.slice_ref, SLICE_REF);
  assertNoDeliveryEvidenceFailureMutatedNothing(garbageState);
});
