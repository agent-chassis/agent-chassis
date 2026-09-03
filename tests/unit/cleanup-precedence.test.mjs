

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CLEANUP_SECONDARY_EVIDENCE_FIELD,
  runWithCleanupPrecedence,
  withStoreLock
} from
  "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt-store-io.mjs";
import {
  getAllocatorPaths,
  withAllocatorLock
} from "../../packages/wiki-core/src/lib/wiki-allocator.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

async function temporaryDir(t, label) {
  const dir = await mkdtemp(path.join(os.tmpdir(), `wk2382-${label}-`));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function taggedError(message, code) {
  const error = new Error(message);
  error.code = code;

  error.deciding_facts = Object.freeze({ observed: message });
  return error;
}

async function rejectionOf(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new assert.AssertionError({ message: "expected a rejection" });
}

function secondary(error, field = CLEANUP_SECONDARY_EVIDENCE_FIELD) {
  return error?.[field] ?? [];
}

async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

test("a primary semantic failure survives one cleanup failure", async () => {
  const primary = taggedError("lineage moved", "lineage_moved");
  const ran = [];

  const thrown = await rejectionOf(runWithCleanupPrecedence(
    () => { throw primary; },
    [{ step: "release", cleanup: () => { ran.push("release"); throw taggedError("release failed", "release_failed"); } }]
  ));

  assert.equal(thrown, primary);
  assert.equal(thrown.code, "lineage_moved");
  assert.deepEqual(thrown.deciding_facts, { observed: "lineage moved" });

  const evidence = secondary(thrown);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].step, "release");
  assert.equal(evidence[0].order, 0);
  assert.equal(evidence[0].code, "release_failed");
  assert.equal(evidence[0].message, "release failed");
  assert.deepEqual(ran, ["release"]);
});

test("a primary survives EVERY cleanup failure in deterministic order", async () => {
  const primary = taggedError("immutable conflict", "immutable_conflict");
  const ran = [];
  const step = (name) => ({
    step: name,
    cleanup: () => { ran.push(name); throw taggedError(`${name} failed`, `${name}_failed`); }
  });

  const thrown = await rejectionOf(runWithCleanupPrecedence(
    () => { throw primary; },
    [step("first"), step("second"), step("third")]
  ));

  assert.equal(thrown, primary);
  assert.equal(thrown.code, "immutable_conflict");

  assert.deepEqual(ran, ["first", "second", "third"]);
  assert.deepEqual(secondary(thrown).map(({ step: name, order, code }) => ({ name, order, code })), [
    { name: "first", order: 0, code: "first_failed" },
    { name: "second", order: 1, code: "second_failed" },
    { name: "third", order: 2, code: "third_failed" }
  ]);
});

test("with no primary, the first cleanup failure is primary and later ones stay secondary",
  async () => {
    const ran = [];
    const step = (name) => ({
      step: name,
      cleanup: () => { ran.push(name); throw taggedError(`${name} failed`, `${name}_failed`); }
    });

    const thrown = await rejectionOf(runWithCleanupPrecedence(
      () => "the body succeeded",
      [step("first"), step("second")]
    ));

    assert.equal(thrown.code, "first_failed");
    assert.deepEqual(ran, ["first", "second"]);
    assert.deepEqual(secondary(thrown).map(({ step: name, code }) => ({ name, code })), [
      { name: "second", code: "second_failed" }
    ]);
  });

test("a later cleanup step still runs after an earlier one fails", async () => {
  const ran = [];
  const thrown = await rejectionOf(runWithCleanupPrecedence(
    () => "ok",
    [
      { step: "breaks", cleanup: () => { ran.push("breaks"); throw new Error("boom"); } },
      { step: "must-still-run", cleanup: () => { ran.push("must-still-run"); } }
    ]
  ));
  assert.equal(thrown.message, "boom");
  assert.deepEqual(ran, ["breaks", "must-still-run"]);
});

test("clean work with clean cleanup returns the body's value and attaches nothing", async () => {
  const ran = [];
  const value = await runWithCleanupPrecedence(
    () => "result",
    [{ step: "release", cleanup: () => { ran.push("release"); } }]
  );
  assert.equal(value, "result");
  assert.deepEqual(ran, ["release"]);
});

test("withStoreLock releases the real lock and returns the body's value", async (t) => {
  const dir = await temporaryDir(t, "store-ok");
  const lockPath = path.join(dir, ".receipt-store.lock");

  const value = await withStoreLock(dir, null, async () => {
    assert.equal(await pathExists(lockPath), true, "the lock is held during the body");
    return "under lock";
  });

  assert.equal(value, "under lock");
  assert.equal(await pathExists(lockPath), false, "the lock is released afterwards");
});

test("withStoreLock preserves a body failure and still releases the lock", async (t) => {
  const dir = await temporaryDir(t, "store-primary");
  const lockPath = path.join(dir, ".receipt-store.lock");
  const primary = taggedError("receipt lineage moved", "lineage_moved");

  const thrown = await rejectionOf(withStoreLock(dir, null, async () => { throw primary; }));

  assert.equal(thrown, primary);
  assert.equal(thrown.code, "lineage_moved");
  assert.deepEqual(secondary(thrown), []);
  assert.equal(await pathExists(lockPath), false, "a failing body still releases the lock");
});

test("a release fault becomes secondary evidence on the body's failure", async (t) => {
  const dir = await temporaryDir(t, "store-both");
  const primary = taggedError("monotonicity violated", "monotonic_violation");

  const thrown = await rejectionOf(withStoreLock(dir, null, async () => {
    const ownerPath = path.join(dir, ".receipt-store.lock", "owner.json");
    const owner = JSON.parse(await readFile(ownerPath, "utf8"));
    await writeFile(ownerPath,
      `${JSON.stringify({ ...owner, token: "f".repeat(32) })}\n`, "utf8");
    throw primary;
  }));

  assert.equal(thrown, primary, "the release fault did not replace the primary");
  assert.equal(thrown.code, "monotonic_violation");
  assert.deepEqual(thrown.deciding_facts, { observed: "monotonicity violated" });

  const evidence = secondary(thrown);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].step, "receipt_store_lock_release");
  assert.match(evidence[0].message, /lock ownership changed/u);
});

test("a release fault with no body failure becomes the primary", async (t) => {
  const dir = await temporaryDir(t, "store-cleanup-primary");

  const thrown = await rejectionOf(withStoreLock(dir, null, async () => {
    const ownerPath = path.join(dir, ".receipt-store.lock", "owner.json");
    const owner = JSON.parse(await readFile(ownerPath, "utf8"));
    await writeFile(ownerPath,
      `${JSON.stringify({ ...owner, token: "f".repeat(32) })}\n`, "utf8");
    return "body succeeded";
  }));

  assert.match(thrown.message, /lock ownership changed/u);
  assert.deepEqual(secondary(thrown), []);
});

test("extra cleanup steps run before the release, in order", async (t) => {
  const dir = await temporaryDir(t, "store-extra");
  const ran = [];

  await withStoreLock(dir, null, () => { ran.push("body"); }, {
    cleanups: [
      { step: "first", cleanup: () => { ran.push("first"); } },
      { step: "second", cleanup: () => { ran.push("second"); } }
    ]
  });

  assert.deepEqual(ran, ["body", "first", "second"]);
  assert.equal(await pathExists(path.join(dir, ".receipt-store.lock")), false);
});

test("a failing extra cleanup step does not prevent the release", async (t) => {
  const dir = await temporaryDir(t, "store-extra-fault");
  const lockPath = path.join(dir, ".receipt-store.lock");

  const thrown = await rejectionOf(withStoreLock(dir, null, () => "ok", {
    cleanups: [{ step: "breaks", cleanup: () => { throw taggedError("extra failed", "extra_failed"); } }]
  }));

  assert.equal(thrown.code, "extra_failed");
  assert.equal(await pathExists(lockPath), false,
    "the lock was released even though the earlier cleanup step threw");
});

test("the allocator releases its lock path and returns the callback's value", async (t) => {
  const dir = await temporaryDir(t, "alloc-ok");
  const { lockPath } = getAllocatorPaths(dir);

  const value = await withAllocatorLock(dir, async () => {
    assert.equal(await pathExists(lockPath), true, "the lock is held during the callback");
    return "allocated";
  });

  assert.equal(value, "allocated");
  assert.equal(await pathExists(lockPath), false, "the lock path is removed");
});

test("a callback failure is primary and the lock path is still removed", async (t) => {
  const dir = await temporaryDir(t, "alloc-primary");
  const { lockPath } = getAllocatorPaths(dir);
  const primary = taggedError("allocator state is malformed", "allocator_state_malformed");

  const thrown = await rejectionOf(withAllocatorLock(dir, async () => { throw primary; }));

  assert.equal(thrown, primary);
  assert.equal(thrown.code, "allocator_state_malformed");
  assert.deepEqual(thrown.deciding_facts, { observed: "allocator state is malformed" });
  assert.deepEqual(secondary(thrown), []);
  assert.equal(await pathExists(lockPath), false);
});

function failingCleanupSteps(faults) {
  const attempted = [];
  const injector = async (step) => {
    attempted.push(step);
    if (Object.hasOwn(faults, step)) throw faults[step];
  };
  return { injector, attempted };
}

test("a handle.close failure does not prevent lock-path removal", async (t) => {
  const dir = await temporaryDir(t, "alloc-close");
  const { lockPath } = getAllocatorPaths(dir);
  const { injector, attempted } = failingCleanupSteps({
    allocator_lock_handle_close: taggedError("close failed", "close_failed")
  });

  const thrown = await rejectionOf(withAllocatorLock(
    dir, async () => "callback succeeded", { faultInjector: injector }
  ));

  assert.equal(thrown.code, "close_failed");

  assert.deepEqual(attempted,
    ["allocator_lock_handle_close", "allocator_lock_path_remove"]);
  assert.equal(await pathExists(lockPath), false,
    "the lock path was removed even though handle.close threw");

  assert.equal(await withAllocatorLock(dir, async () => "next allocation"), "next allocation");
});

test("an rm failure alone becomes primary and leaves the lock path in place", async (t) => {
  const dir = await temporaryDir(t, "alloc-rm");
  const { lockPath } = getAllocatorPaths(dir);
  const { injector, attempted } = failingCleanupSteps({
    allocator_lock_path_remove: taggedError("removal failed", "remove_failed")
  });

  const thrown = await rejectionOf(withAllocatorLock(
    dir, async () => "callback succeeded", { faultInjector: injector }
  ));

  assert.equal(thrown.code, "remove_failed");
  assert.deepEqual(secondary(thrown), []);
  assert.deepEqual(attempted,
    ["allocator_lock_handle_close", "allocator_lock_path_remove"]);

  assert.equal(await pathExists(lockPath), true);
});

test("close and removal faults together keep both as ordered cleanup evidence", async (t) => {
  const dir = await temporaryDir(t, "alloc-both-cleanup");
  const { injector, attempted } = failingCleanupSteps({
    allocator_lock_handle_close: taggedError("close failed", "close_failed"),
    allocator_lock_path_remove: taggedError("removal failed", "remove_failed")
  });

  const thrown = await rejectionOf(withAllocatorLock(
    dir, async () => "callback succeeded", { faultInjector: injector }
  ));

  assert.equal(thrown.code, "close_failed");
  assert.deepEqual(attempted,
    ["allocator_lock_handle_close", "allocator_lock_path_remove"]);
  assert.deepEqual(secondary(thrown).map(({ step, order, code }) => ({ step, order, code })), [
    { step: "allocator_lock_path_remove", order: 0, code: "remove_failed" }
  ]);
});

test("a callback failure outranks close and removal faults together", async (t) => {
  const dir = await temporaryDir(t, "alloc-all");
  const primary = taggedError("refused to mint an occupied identity", "identity_occupied");
  const { injector, attempted } = failingCleanupSteps({
    allocator_lock_handle_close: taggedError("close failed", "close_failed"),
    allocator_lock_path_remove: taggedError("removal failed", "remove_failed")
  });

  const thrown = await rejectionOf(withAllocatorLock(
    dir, async () => { throw primary; }, { faultInjector: injector }
  ));

  assert.equal(thrown, primary, "a cleanup fault never replaces the semantic failure");
  assert.equal(thrown.code, "identity_occupied");
  assert.deepEqual(thrown.deciding_facts, { observed: "refused to mint an occupied identity" });
  assert.deepEqual(attempted,
    ["allocator_lock_handle_close", "allocator_lock_path_remove"]);
  assert.deepEqual(secondary(thrown).map(({ step, order, code }) => ({ step, order, code })), [
    { step: "allocator_lock_handle_close", order: 0, code: "close_failed" },
    { step: "allocator_lock_path_remove", order: 1, code: "remove_failed" }
  ]);
});

test("force:true suppresses only absence, not other removal failures", async (t) => {
  const dir = await temporaryDir(t, "alloc-absent");
  const { lockPath } = getAllocatorPaths(dir);

  const value = await withAllocatorLock(dir, async () => {
    await rm(lockPath, { force: true });
    return "absent is not a failure";
  });

  assert.equal(value, "absent is not a failure");
});

test("no hand-authored receipt-store finally/release copy survives", async () => {
  const source = await readFile(path.join(REPO,
    "packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt-store.mjs"), "utf8");

  assert.equal(source.includes("acquireStoreLock"), false,
    "a call site still acquires the lock directly instead of using the owner");
  assert.equal(source.includes("await release();"), false,
    "a hand-authored finally { await release(); } copy survives");
  assert.equal(source.split("withStoreLock(").length - 1, 17,
    "every previous lock call site routes through the single owner");
});

test("the allocator keeps one scoped-run owner and no per-call-site wrapper", async () => {
  const source = await readFile(path.join(REPO,
    "packages/wiki-core/src/lib/wiki-allocator.mjs"), "utf8");

  assert.equal(source.split("export async function withAllocatorLock(").length - 1, 1,
    "withAllocatorLock is defined exactly once");

  assert.match(source, /const retries = 50;/u);
  assert.match(source, /const delayMs = 100;/u);
  assert.match(source, /await open\(lockPath, "wx"\)/u);
  assert.match(source, /Timed out waiting for allocator lock at \$\{lockPath\}/u);
});
