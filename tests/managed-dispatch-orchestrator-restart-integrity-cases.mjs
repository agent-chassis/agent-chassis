

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  MANAGED_RUN_PROCESS_IDENTITY_STATES,
  readManagedRunProcessIdentity
} from "../packages/agent-launch-cli/src/lib/managed-run-process-identity.mjs";
import { WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES } from "../packages/agent-launch-cli/src/lib/worktree-substrate.mjs";
import {
  MANAGED_NO_DELIVERY_EVIDENCE_DIAGNOSTIC_CODES
} from "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-managed-identity.mjs";
import {
  ALIVE,
  assertTypedNoDeliveryEvidenceFailure,
  bareFixture,
  DEAD,
  dispatchWorker,
  git,
  idMint,
  INITIATIVE,
  inMemoryReceiptStore,
  reconstructBackend,
  SUBJECT,
  WK
} from "./managed-dispatch-orchestrator-restart-fixture.mjs";

test("WK-1723 contradictory immutable Git for a proven-dead attempt fails closed, never a silent duplicate", async (t) => {
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

  git(fx.repo, "worktree", "remove", "--force", path.join(fx.worktreeRoot, `slice-${INITIATIVE}-${WK}-SLICE-001`));

  const sliceBranch = `slice/${INITIATIVE}/${WK}/SLICE-001`;
  try { git(fx.repo, "branch", "-D", sliceBranch); } catch {   }

  const backend = reconstructBackend(fx, { procs: DEAD(), ids, launches, receiptStore: store });
  const reissue = await dispatchWorker(backend, "restart-0");

  assert.equal(reissue.accepted, false, JSON.stringify(reissue));

  assertTypedNoDeliveryEvidenceFailure(reissue.refusal, {
    code: MANAGED_NO_DELIVERY_EVIDENCE_DIAGNOSTIC_CODES.BINDING_UNRESOLVED,
    causeCode: WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.BINDING_NOT_FOUND
  });

  assert.equal(launches.filter((entry) => entry.role === "worker").length, 1);

  assert.equal(readManagedRunProcessIdentity({ mainRepo: fx.repo, tuple: priorTuple }).state,
    MANAGED_RUN_PROCESS_IDENTITY_STATES.BOUND);
});
