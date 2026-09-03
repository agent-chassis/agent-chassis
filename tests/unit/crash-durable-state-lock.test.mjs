

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  CRASH_DURABLE_FAULTS,
  CRASH_DURABLE_LIVENESS,
  CRASH_DURABLE_LOCK_STATES,
  CRASH_DURABLE_RESULTS,
  OWNER_ENTRY_FILE,
  classifyLockState,
  createAsyncEffects,
  createSyncEffects,
  decideRelease,
  decideRetirement,
  inspectLockPathSync,
  planLockAcquisition,
  planRetirementClaim,
  planTombstoneCleanup,
  runCrashDurablePlanAsync,
  runCrashDurablePlanSync
} from "../../packages/wiki-core/src/lib/crash-durable-state.mjs";

const OWNER_TOKEN = "token-owner-0000000000000001";
const CONTENDER_TOKEN = "token-contender-000000000002";
const OWNER_IDENTITY = "identity-owner-nonreusable-01";
const CONTENDER_IDENTITY = "identity-contender-nonreuse-2";

const cleanups = [];

function workspace() {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wk2357-lock-")));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function lockPaths(dir) {
  return {
    canonicalPath: path.join(dir, "store.lock"),
    stagingPath: path.join(dir, `.store.lock.staging-${OWNER_TOKEN}`),
    claimantMarkerPath: path.join(dir, `store.lock.retired-${CONTENDER_TOKEN}`),
    tombstonePath: path.join(dir, `store.lock.tombstone-${CONTENDER_TOKEN}`)
  };
}

function injectorFor(boundary) {
  if (boundary === null) return null;
  return (fault) => {
    if (fault === boundary) throw new Error(`injected at ${fault}`);
  };
}

async function acquire(dir, { flavour = "async", boundary = null, token = OWNER_TOKEN, identity = OWNER_IDENTITY } = {}) {
  const paths = lockPaths(dir);
  const plan = planLockAcquisition({
    canonicalPath: paths.canonicalPath,
    stagingPath: path.join(dir, `.store.lock.staging-${token}`),
    ownerToken: token,
    ownerIdentity: identity
  });
  const effects = flavour === "sync"
    ? createSyncEffects({ faultInjector: injectorFor(boundary) })
    : createAsyncEffects({ faultInjector: injectorFor(boundary) });
  return flavour === "sync"
    ? runCrashDurablePlanSync(plan, effects)
    : await runCrashDurablePlanAsync(plan, effects);
}

test("a token-owned lock publishes its exact token and non-reusable identity", async (t) => {
  t.after(() => {
    while (cleanups.length > 0) cleanups.pop()();
  });
  const dir = workspace();
  const result = await acquire(dir);
  const { canonicalPath } = lockPaths(dir);

  assert.equal(result.classification, CRASH_DURABLE_RESULTS.LOCK_ACQUIRED);
  const owner = JSON.parse(readFileSync(path.join(canonicalPath, OWNER_ENTRY_FILE), "utf8"));
  assert.equal(owner.owner_token, OWNER_TOKEN);
  assert.equal(owner.owner_identity, OWNER_IDENTITY);
  assert.equal(classifyLockState(inspectLockPathSync(canonicalPath)), CRASH_DURABLE_LOCK_STATES.TOKEN_OWNED);
});

test("a second acquirer loses the canonical rename and never adopts the held lock", async () => {
  const dir = workspace();
  await acquire(dir);
  const contended = await acquire(dir, { token: CONTENDER_TOKEN, identity: CONTENDER_IDENTITY });

  assert.equal(contended.classification, CRASH_DURABLE_RESULTS.LOCK_CONTENDED);
  const owner = JSON.parse(readFileSync(path.join(lockPaths(dir).canonicalPath, OWNER_ENTRY_FILE), "utf8"));
  assert.equal(owner.owner_token, OWNER_TOKEN, "the incumbent's owner entry is untouched");
  assert.equal(
    existsSync(path.join(dir, `.store.lock.staging-${CONTENDER_TOKEN}`)),
    false,
    "the loser cleans up only its own staged directory"
  );
});

test("exact-token release: a mismatched token never releases a successor's lock", async () => {
  const dir = workspace();
  await acquire(dir);
  const inspection = inspectLockPathSync(lockPaths(dir).canonicalPath);

  assert.deepEqual(decideRelease({ inspection, token: OWNER_TOKEN }).releasable, true);
  const mismatched = decideRelease({ inspection, token: CONTENDER_TOKEN });
  assert.equal(mismatched.releasable, false);
  assert.equal(mismatched.reason, "token mismatch");
});

test("reclamation requires an authoritative dead verdict and nothing else", async () => {
  const dir = workspace();
  await acquire(dir);
  const inspection = inspectLockPathSync(lockPaths(dir).canonicalPath);
  const judge = (liveness, extra = {}) =>
    decideRetirement({ inspection, contenderToken: CONTENDER_TOKEN, liveness, ...extra });

  assert.equal(judge(CRASH_DURABLE_LIVENESS.DEAD).retirable, true, "a dead verdict authorizes reclamation");
  assert.equal(judge(CRASH_DURABLE_LIVENESS.LIVE).retirable, false, "a live owner is never retired");
  assert.equal(
    judge(CRASH_DURABLE_LIVENESS.INDETERMINATE).retirable,
    false,
    "an indeterminate verdict fails closed rather than reclaiming"
  );
  assert.equal(judge(undefined).retirable, false, "a missing verdict never authorizes reclamation");

  const moved = judge(CRASH_DURABLE_LIVENESS.DEAD, { observedIdentity: "identity-of-a-reused-pid" });
  assert.equal(moved.retirable, false);
  assert.equal(moved.reason, "persisted owner identity moved since it was judged");

  assert.equal(
    decideRetirement({ inspection, contenderToken: OWNER_TOKEN, liveness: CRASH_DURABLE_LIVENESS.DEAD }).retirable,
    false,
    "a token does not retire its own lock"
  );
});

test("legacy and malformed lock shapes are recognized deterministically and fail closed", () => {
  const dir = workspace();

  const filePath = path.join(dir, "legacy-file.lock");
  writeFileSync(filePath, `${JSON.stringify({ acquired_at: "2026-01-01T00:00:00Z", pid: 1234 })}\n`, "utf8");
  assert.equal(classifyLockState(inspectLockPathSync(filePath)), CRASH_DURABLE_LOCK_STATES.LEGACY_REGULAR_FILE);

  const ownerlessPath = path.join(dir, "legacy-ownerless.lock");
  mkdirSync(ownerlessPath);
  assert.equal(
    classifyLockState(inspectLockPathSync(ownerlessPath)),
    CRASH_DURABLE_LOCK_STATES.LEGACY_OWNERLESS_DIRECTORY
  );

  const malformedPath = path.join(dir, "malformed.lock");
  mkdirSync(malformedPath);
  writeFileSync(path.join(malformedPath, OWNER_ENTRY_FILE), "{ not json", "utf8");
  assert.equal(classifyLockState(inspectLockPathSync(malformedPath)), CRASH_DURABLE_LOCK_STATES.MALFORMED);

  const absentPath = path.join(dir, "absent.lock");
  assert.equal(classifyLockState(inspectLockPathSync(absentPath)), CRASH_DURABLE_LOCK_STATES.ABSENT);

  for (const candidate of [filePath, ownerlessPath, malformedPath, absentPath]) {
    const decision = decideRetirement({
      inspection: inspectLockPathSync(candidate),
      contenderToken: CONTENDER_TOKEN,
      liveness: CRASH_DURABLE_LIVENESS.DEAD
    });
    assert.equal(decision.retirable, false, `${path.basename(candidate)} must fail closed`);
    assert.match(decision.reason, /is never retired/u);
  }
});

test("the retirement claim is single-winner and the directory move frees the canonical name", async () => {
  const dir = workspace();
  await acquire(dir);
  const paths = lockPaths(dir);

  const claim = await runCrashDurablePlanAsync(
    planRetirementClaim({
      canonicalPath: paths.canonicalPath,
      claimantMarkerPath: paths.claimantMarkerPath,
      tombstonePath: paths.tombstonePath,
      claimantToken: CONTENDER_TOKEN
    }),
    createAsyncEffects({})
  );

  assert.equal(claim.classification, CRASH_DURABLE_RESULTS.RETIREMENT_CLAIMED);
  assert.equal(existsSync(paths.canonicalPath), false, "only the directory rename frees the canonical name");
  assert.equal(existsSync(paths.tombstonePath), true, "the claimed directory becomes a token-bound tombstone");
  assert.equal(
    existsSync(paths.claimantMarkerPath),
    true,
    "the owner entry was renamed to the claimant-token retirement marker"
  );

  const loser = await runCrashDurablePlanAsync(
    planRetirementClaim({
      canonicalPath: paths.canonicalPath,
      claimantMarkerPath: path.join(dir, "store.lock.retired-token-third-00000000003"),
      tombstonePath: path.join(dir, "store.lock.tombstone-token-third-00000000003"),
      claimantToken: "token-third-00000000003"
    }),
    createAsyncEffects({})
  );
  assert.equal(loser.classification, CRASH_DURABLE_RESULTS.NOT_RETIRABLE);
  assert.equal(loser.failed_fault, CRASH_DURABLE_FAULTS.OWNER_ENTRY_RETIREMENT_CLAIMED);
  assert.equal(existsSync(paths.tombstonePath), true, "the loser did not disturb the winner's tombstone");
});

test("a crash between the claim and the move leaves a claimed marker, not a freed name", async () => {
  const dir = workspace();
  await acquire(dir);
  const paths = lockPaths(dir);

  const interrupted = await runCrashDurablePlanAsync(
    planRetirementClaim({
      canonicalPath: paths.canonicalPath,
      claimantMarkerPath: paths.claimantMarkerPath,
      tombstonePath: paths.tombstonePath,
      claimantToken: CONTENDER_TOKEN
    }),
    createAsyncEffects({ faultInjector: injectorFor(CRASH_DURABLE_FAULTS.CLAIMED_DIRECTORY_MOVED) })
  );

  assert.equal(interrupted.failed_fault, CRASH_DURABLE_FAULTS.CLAIMED_DIRECTORY_MOVED);
  assert.equal(
    existsSync(paths.canonicalPath),
    true,
    "the canonical directory still holds the name until the move succeeds"
  );
  assert.equal(existsSync(paths.claimantMarkerPath), true, "the retirement claim itself is durable");
  assert.equal(existsSync(paths.tombstonePath), false, "no tombstone exists yet");

  assert.equal(
    classifyLockState(inspectLockPathSync(paths.canonicalPath)),
    CRASH_DURABLE_LOCK_STATES.LEGACY_OWNERLESS_DIRECTORY
  );
});

test("cleanup addresses only a token-bound tombstone and never a canonical path", async () => {
  const dir = workspace();
  await acquire(dir);
  const paths = lockPaths(dir);
  await runCrashDurablePlanAsync(
    planRetirementClaim({
      canonicalPath: paths.canonicalPath,
      claimantMarkerPath: paths.claimantMarkerPath,
      tombstonePath: paths.tombstonePath,
      claimantToken: CONTENDER_TOKEN
    }),
    createAsyncEffects({})
  );

  const cleaned = await runCrashDurablePlanAsync(
    planTombstoneCleanup({ tombstonePath: paths.tombstonePath, claimantToken: CONTENDER_TOKEN }),
    createAsyncEffects({})
  );
  assert.equal(cleaned.classification, CRASH_DURABLE_RESULTS.TOMBSTONE_CLEANED);
  assert.equal(existsSync(paths.tombstonePath), false);

  assert.throws(
    () => planTombstoneCleanup({ tombstonePath: paths.tombstonePath, claimantToken: "token-someone-else-000000004" }),
    /own token/u,
    "cleanup of a foreign tombstone is refused at plan time"
  );

  assert.throws(
    () => planTombstoneCleanup({ tombstonePath: paths.canonicalPath, claimantToken: CONTENDER_TOKEN }),
    /own token/u
  );
});

test("sync and async lock interpreters produce identical traces at every boundary", async () => {
  const boundaries = [
    null,
    CRASH_DURABLE_FAULTS.PRIVATE_CREATED,
    CRASH_DURABLE_FAULTS.COMPLETE_BYTES_WRITTEN,
    CRASH_DURABLE_FAULTS.FILE_SYNCED,
    CRASH_DURABLE_FAULTS.LOCK_ACQUIRED,
    CRASH_DURABLE_FAULTS.DIRECTORY_SYNCED
  ];
  for (const boundary of boundaries) {
    const syncDir = workspace();
    const asyncDir = workspace();
    const syncResult = await acquire(syncDir, { flavour: "sync", boundary });
    const asyncResult = await acquire(asyncDir, { flavour: "async", boundary });

    assert.deepEqual(
      syncResult.trace,
      asyncResult.trace,
      `lock boundary ${boundary}: identical operation order and cleanup authority`
    );
    assert.equal(syncResult.classification, asyncResult.classification, `lock boundary ${boundary}: identical classification`);
    assert.equal(
      existsSync(path.join(syncDir, "store.lock")),
      existsSync(path.join(asyncDir, "store.lock")),
      `lock boundary ${boundary}: identical resulting canonical state`
    );
  }
});

test("a tombstone path that is not bound to the claimant token is refused at plan time", () => {
  assert.throws(
    () =>
      planRetirementClaim({
        canonicalPath: "/tmp/x/store.lock",
        claimantMarkerPath: "/tmp/x/store.lock.retired",
        tombstonePath: "/tmp/x/store.lock.tombstone",
        claimantToken: CONTENDER_TOKEN
      }),
    /bound to the claimant token/u,
    "a tombstone that does not identify its claimant is not self-identifying"
  );
});
