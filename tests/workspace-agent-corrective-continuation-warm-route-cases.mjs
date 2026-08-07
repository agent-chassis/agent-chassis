

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  managedRunSubjectReservationFilePath,
  readManagedRunProcessIdentity
} from "../packages/agent-launch-cli/src/lib/managed-run-process-identity.mjs";
import {
  MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES
} from "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-managed-identity.mjs";
import {
  CANONICAL_INTEGRATED_LIFECYCLE_STATE_IMPOSSIBLE_CODE
} from "../packages/agent-launch-cli/src/lib/backend-integrated-scope-authority.mjs";
import {
  managedRunSubjectSuccessorGuardFilePath
} from "../packages/agent-launch-cli/src/lib/managed-run-subject-reservation.mjs";
import {
  git,
  INITIATIVE,
  OLD_TUPLE,
  readReservationRecord,
  SLICE_REF,
  SUBJECT
} from "./workspace-agent-corrective-continuation-fixture.mjs";
import {
  assertCorrectiveSurfaceUnchanged,
  assertDeliverySurfacePreserved,
  assertRefusedBeforeSpawn,
  captureCorrectiveSurface,
  EXPECTED_CORRECTIVE_STATUS_RECOVERY,
  readCanonicalRecord,
  RECORD_RELATIVE_PATH,
  reissueWarmWorkerDispatch,
  reopenIntegratedTargetForCorrection,
  warmCorrectiveFindingsProducer,
  warmCorrectiveScenario,
  warmTwoRoundCorrectiveScenario
} from "./workspace-agent-corrective-continuation-warm-fixture.mjs";

test("WK-1723#SLICE-020 a warm corrective redispatch of a reopened active/todo target converges through the managed-identity route", async (t) => {
  const { fx, warm, deliveredTip } = await warmCorrectiveScenario(t);

  const produce = warmCorrectiveFindingsProducer(fx, warm.backend);
  assert.equal(await produce({ subject: SUBJECT, workspace_dir: fx.repo }), null,
    "the warm findings producer treats a reopened corrective target as inapplicable");

  assert.equal(readCanonicalRecord(fx).slices[0].status, "todo",
    "the reopened target is never represented as being under slice-level review");

  const before = captureCorrectiveSurface(fx);
  const historicalIdentity = readManagedRunProcessIdentity({ mainRepo: fx.repo, tuple: OLD_TUPLE });
  assert.notEqual(historicalIdentity, null);

  const accepted = await reissueWarmWorkerDispatch(fx, warm, "warm-corrective");
  assert.equal(accepted.accepted, true, JSON.stringify(accepted));
  assert.equal(warm.workerLaunches().length, 1, "exactly one corrective worker is admitted");

  const context = warm.workerLaunches().at(-1).readiness.trusted_corrective_findings_context;
  assert.notEqual(context, null, "the corrective worker starts with the reviewed delivery's findings");
  assert.equal(context.authority, "launcher_exact_review_receipt");
  assert.equal(context.reviewed_sha, deliveredTip);
  assert.equal(context.findings.length, 2);
  assert.deepEqual(
    [...context.review_run_ids].sort(),
    fx.receipts.map((receipt) => receipt.review_run_id).sort(),
    "the carried review identities are the durable receipts'"
  );

  assert.notEqual(readManagedRunProcessIdentity({ mainRepo: fx.repo, tuple: OLD_TUPLE }), null,
    "the superseded attempt is retired, never deleted");
  assert.notEqual(accepted.run_id, OLD_TUPLE.run_id);
  assert.equal(readReservationRecord(fx.repo).tuple?.run_id, accepted.run_id);
  assert.equal(existsSync(managedRunSubjectReservationFilePath(fx.repo, SUBJECT)), true);
  assert.equal(existsSync(managedRunSubjectSuccessorGuardFilePath(fx.repo, SUBJECT)), false);

  assertDeliverySurfacePreserved(fx, before);
  assert.equal(git(fx.repo, "rev-parse", SLICE_REF), deliveredTip);

  const wkTip = git(fx.repo, "rev-parse", `refs/heads/wk/${INITIATIVE}/WK-1712`);
  if (wkTip !== before.wk) {
    assert.equal(git(fx.repo, "rev-list", "--parents", "-n", "1", wkTip), `${wkTip} ${before.wk}`,
      "the WK ref only advances on top of the integrated tip");
  }
});

test("WK-1723#SLICE-020 neighbouring and malformed lifecycle states still refuse the warm route before spawn", async (t) => {
  const { fx, warm } = await warmCorrectiveScenario(t);
  const produce = warmCorrectiveFindingsProducer(fx, warm.backend);
  const notUnderSliceReview = /is not an implementation slice under slice-level review/u;
  const parentInWholeWkReview = /is in whole-WK review; a slice-level review requires an active parent/u;

  for (const [label, states, refusal] of [
    ["active/blocked", { parentStatus: "active", sliceStatus: "blocked" }, notUnderSliceReview],
    ["active/done", { parentStatus: "active", sliceStatus: "done" }, notUnderSliceReview],
    ["blocked/todo", { parentStatus: "blocked", sliceStatus: "todo" }, notUnderSliceReview],
    ["review/todo", { parentStatus: "review", sliceStatus: "todo" }, parentInWholeWkReview]
  ]) {
    reopenIntegratedTargetForCorrection(fx, states);
    const before = captureCorrectiveSurface(fx);
    await assert.rejects(
      () => produce({ subject: SUBJECT, workspace_dir: fx.repo }),
      refusal,
      label
    );
    const dispatched = await reissueWarmWorkerDispatch(fx, warm, `warm-${label}`);
    assert.equal(dispatched?.accepted ?? false, false, `${label}: ${JSON.stringify(dispatched)}`);
    assert.equal(warm.workerLaunches().length, 0, `${label} spawns no worker`);
    assertCorrectiveSurfaceUnchanged(fx, before);
  }

  const recordPath = path.join(fx.repo, RECORD_RELATIVE_PATH);
  const authored = readFileSync(recordPath, "utf8");
  writeFileSync(recordPath, "{ this is not a work record");
  await assert.rejects(
    () => produce({ subject: SUBJECT, workspace_dir: fx.repo }),
    /canonical WK-1712 record is unavailable for slice-level review/u
  );
  assert.equal(warm.workerLaunches().length, 0, "a malformed record spawns no worker");
  writeFileSync(recordPath, authored);
});

test("WK-1793#SLICE-002 the reviewed-integrated todo/todo refusal carries bounded status facts and the coordinator reconciliation route", async (t) => {
  const { fx, warm } = await warmCorrectiveScenario(t);
  reopenIntegratedTargetForCorrection(fx, { parentStatus: "todo", sliceStatus: "todo" });
  const before = captureCorrectiveSurface(fx);

  const refused = await reissueWarmWorkerDispatch(fx, warm, "wk1793-actionable");
  const detail = assertRefusedBeforeSpawn(refused, "todo/todo");

  assert.equal(detail.code,
    MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES.INTEGRATED_STATE_UNRESOLVED);
  assert.equal(detail.cause_code, CANONICAL_INTEGRATED_LIFECYCLE_STATE_IMPOSSIBLE_CODE);

  assert.deepEqual({ ...detail.observed_canonical_status }, {
    record_id: "WK-1712",
    slice_id: "SLICE-001",
    parent_status: "todo",
    slice_status: "todo"
  });

  assert.deepEqual(JSON.parse(JSON.stringify(detail.recovery)),
    JSON.parse(JSON.stringify(EXPECTED_CORRECTIVE_STATUS_RECOVERY)));
  assert.equal(detail.recovery.responsible_actor, "coordinator");
  assert.equal(detail.recovery.unit, "WK-1712", "the exact parent WK unit is named");

  assert.deepEqual(Object.keys(detail).sort(),
    ["cause_code", "code", "message", "observed_canonical_status", "recovery"]);
  const serialized = JSON.stringify(detail);
  assert.equal(serialized.includes(fx.repo), false, "no filesystem path is projected");
  assert.equal(serialized.includes("committed_target_digest"), false, "no receipt is projected");
  assert.equal(serialized.includes("    at "), false, "no stack frame is projected");

  assert.equal(warm.workerLaunches().length, 0, "the actionable state still spawns nothing");
  assertCorrectiveSurfaceUnchanged(fx, before);
  assert.equal(readCanonicalRecord(fx).status, "todo",
    "the launcher never performs the reconciliation it names");
});

test("WK-1793#SLICE-002 every neighbouring impossible, unreadable, and unauthenticated state stays fail-closed and non-actionable", async (t) => {
  const { fx, warm } = await warmCorrectiveScenario(t);

  for (const [label, states] of [
    ["todo/blocked", { parentStatus: "todo", sliceStatus: "blocked" }],
    ["todo/done", { parentStatus: "todo", sliceStatus: "done" }],
    ["blocked/todo", { parentStatus: "blocked", sliceStatus: "todo" }],
    ["active/blocked", { parentStatus: "active", sliceStatus: "blocked" }],
    ["review/todo", { parentStatus: "review", sliceStatus: "todo" }],
    ["done/todo", { parentStatus: "done", sliceStatus: "todo" }]
  ]) {
    reopenIntegratedTargetForCorrection(fx, states);
    const before = captureCorrectiveSurface(fx);
    const detail = assertRefusedBeforeSpawn(
      await reissueWarmWorkerDispatch(fx, warm, `wk1793-${label}`),
      label
    );
    assert.equal(Object.hasOwn(detail, "recovery"), false,
      `${label} must carry no recovery route: ${JSON.stringify(detail)}`);
    assert.equal(warm.workerLaunches().length, 0, `${label} spawns no worker`);
    assertCorrectiveSurfaceUnchanged(fx, before);
  }

  reopenIntegratedTargetForCorrection(fx, { parentStatus: "active", sliceStatus: "blocked" });
  const neighbour = assertRefusedBeforeSpawn(
    await reissueWarmWorkerDispatch(fx, warm, "wk1793-active-blocked-facts"),
    "active/blocked"
  );
  assert.equal(neighbour.cause_code, CANONICAL_INTEGRATED_LIFECYCLE_STATE_IMPOSSIBLE_CODE);
  assert.deepEqual({ ...neighbour.observed_canonical_status }, {
    record_id: "WK-1712",
    slice_id: "SLICE-001",
    parent_status: "active",
    slice_status: "blocked"
  });

  const recordPath = path.join(fx.repo, RECORD_RELATIVE_PATH);
  const authored = readFileSync(recordPath, "utf8");
  writeFileSync(recordPath, "{ this is not a work record");
  const unreadableBefore = captureCorrectiveSurface(fx);
  const unreadable = assertRefusedBeforeSpawn(
    await reissueWarmWorkerDispatch(fx, warm, "wk1793-unreadable"),
    "unreadable"
  );
  assert.equal(Object.hasOwn(unreadable, "recovery"), false);
  assert.equal(Object.hasOwn(unreadable, "observed_canonical_status"), false,
    "an unreadable record yields no canonical status facts to project");
  assert.equal(warm.workerLaunches().length, 0, "an unreadable record spawns no worker");
  assertCorrectiveSurfaceUnchanged(fx, unreadableBefore);
  writeFileSync(recordPath, authored);

  reopenIntegratedTargetForCorrection(fx, { parentStatus: "active", sliceStatus: "todo" });
  for (let index = 0; index < fx.receipts.length; index += 1) {
    fx.receipts[index] = { ...fx.receipts[index], reviewed_sha: `${"c".repeat(39)}3` };
  }
  const tamperedBefore = captureCorrectiveSurface(fx);
  const tampered = assertRefusedBeforeSpawn(
    await reissueWarmWorkerDispatch(fx, warm, "wk1793-unauthenticated"),
    "unauthenticated"
  );
  assert.equal(Object.hasOwn(tampered, "recovery"), false,
    `an unauthenticated delivery must carry no recovery route: ${JSON.stringify(tampered)}`);
  assert.notEqual(tampered.code,
    MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES.INTEGRATED_STATE_UNRESOLVED);
  assert.equal(warm.workerLaunches().length, 0, "an unauthenticated delivery spawns no worker");
  assertCorrectiveSurfaceUnchanged(fx, tamperedBefore);
});

test("WK-1793#SLICE-002 the actionable todo/todo recovery survives two rounds of ordinary receipt history", async (t) => {
  const { fx, warm } = await warmTwoRoundCorrectiveScenario(t);
  reopenIntegratedTargetForCorrection(fx, { parentStatus: "todo", sliceStatus: "todo" });
  const before = captureCorrectiveSurface(fx);
  const workersBefore = warm.workerLaunches().length;

  const detail = assertRefusedBeforeSpawn(
    await reissueWarmWorkerDispatch(fx, warm, "wk1793-m1-actionable"),
    "two-group todo/todo"
  );

  assert.equal(detail.code,
    MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES.INTEGRATED_STATE_UNRESOLVED,
    `history must not re-classify a lifecycle observation: ${JSON.stringify(detail)}`);
  assert.equal(detail.cause_code, CANONICAL_INTEGRATED_LIFECYCLE_STATE_IMPOSSIBLE_CODE);
  assert.deepEqual({ ...detail.observed_canonical_status }, {
    record_id: "WK-1712",
    slice_id: "SLICE-001",
    parent_status: "todo",
    slice_status: "todo"
  });
  assert.deepEqual(JSON.parse(JSON.stringify(detail.recovery)),
    JSON.parse(JSON.stringify(EXPECTED_CORRECTIVE_STATUS_RECOVERY)));

  assert.deepEqual(Object.keys(detail).sort(),
    ["cause_code", "code", "message", "observed_canonical_status", "recovery"]);

  assert.equal(warm.workerLaunches().length, workersBefore, "the actionable state spawns nothing");
  assertCorrectiveSurfaceUnchanged(fx, before);
  assert.equal(readCanonicalRecord(fx).status, "todo",
    "the launcher never performs the reconciliation it names");
  assert.equal(fx.receipts.length, 4, "no historical receipt is deleted or synthesized");
});

test("WK-1793#SLICE-002 rejected groups whose causes differ keep the aggregate mismatch and inherit no recovery", async (t) => {
  const { fx, warm } = await warmTwoRoundCorrectiveScenario(t);

  for (const index of [0, 1]) {
    fx.receipts[index] = {
      ...fx.receipts[index],
      canonical_parent_wk_contract: "{ this is not a frozen contract"
    };
  }

  reopenIntegratedTargetForCorrection(fx, { parentStatus: "todo", sliceStatus: "todo" });
  const before = captureCorrectiveSurface(fx);
  const workersBefore = warm.workerLaunches().length;

  const detail = assertRefusedBeforeSpawn(
    await reissueWarmWorkerDispatch(fx, warm, "wk1793-m1-mixed"),
    "mixed-cause two-group todo/todo"
  );

  assert.equal(detail.code,
    MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES.REVIEWED_TARGET_MISMATCH,
    `a genuinely mixed rejection keeps the aggregate refusal: ${JSON.stringify(detail)}`);
  assert.equal(Object.hasOwn(detail, "recovery"), false,
    `an untyped cause must not inherit recovery: ${JSON.stringify(detail)}`);
  assert.equal(Object.hasOwn(detail, "observed_canonical_status"), false,
    "the aggregate refusal claims no single canonical observation");

  assert.equal(warm.workerLaunches().length, workersBefore, "no worker is created");
  assertCorrectiveSurfaceUnchanged(fx, before);
});
