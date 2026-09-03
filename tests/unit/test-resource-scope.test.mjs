import assert from "node:assert/strict";
import test from "node:test";

import {
  TEST_RESOURCE_SCOPE_ERROR_CODES,
  createTestResourceScope
} from "../helpers/test-resource-scope.mjs";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("resource scope owns unique labels and disposes exhaustively in strict LIFO order", async () => {
  const scope = createTestResourceScope();
  const calls = [];
  const firstFailure = new Error("first failed");
  const thirdFailure = new Error("third failed");
  scope.add("first", () => { calls.push("first"); throw firstFailure; });
  scope.add("second", () => { calls.push("second"); });
  scope.add("third", () => { calls.push("third"); throw thirdFailure; });

  assert.throws(() => scope.add("second", () => {}),
    (error) => error?.code === TEST_RESOURCE_SCOPE_ERROR_CODES.DUPLICATE_LABEL);

  const disposal = scope.dispose();
  assert.equal(scope.dispose(), disposal, "concurrent disposal must share one settlement");
  await assert.rejects(disposal, (error) => {
    assert.equal(error instanceof AggregateError, true);
    assert.deepEqual(error.errors.map((item) => item.label), ["third", "first"]);
    assert.deepEqual(error.errors.map((item) => item.cause), [thirdFailure, firstFailure]);
    return true;
  });
  assert.deepEqual(calls, ["third", "second", "first"]);
  assert.equal(scope.dispose(), disposal, "sequential disposal must retain its settlement");
  assert.throws(() => scope.add("late", () => {}),
    (error) => error?.code === TEST_RESOURCE_SCOPE_ERROR_CODES.DISPOSAL_STARTED);
});

test("add refuses invalid ownership synchronously without invoking the disposer", () => {
  const scope = createTestResourceScope();
  let calls = 0;
  const disposer = () => { calls += 1; };
  assert.throws(() => scope.add("", disposer),
    (error) => error?.code === TEST_RESOURCE_SCOPE_ERROR_CODES.INVALID_LABEL);
  assert.throws(() => scope.add("bad-disposer", null),
    (error) => error?.code === TEST_RESOURCE_SCOPE_ERROR_CODES.INVALID_DISPOSER);
  assert.equal(calls, 0);
});

test("disposeOne has same-turn synchronous effects, is idempotent, and retires success", async () => {
  const scope = createTestResourceScope();
  let calls = 0;
  scope.add("sync", () => { calls += 1; });
  assert.equal(scope.disposeOne("missing"), undefined);
  assert.equal(scope.disposeOne("sync"), undefined);
  assert.equal(calls, 1, "synchronous disposer must run before disposeOne returns");
  assert.equal(scope.disposeOne("sync"), undefined);
  await scope.dispose();
  assert.equal(calls, 1);
});

test("failed synchronous disposeOne throws in the caller turn and receives one final retry", async () => {
  const scope = createTestResourceScope();
  const failures = [new Error("early"), new Error("final")];
  let calls = 0;
  scope.add("retry", () => { throw failures[calls++]; });

  assert.throws(() => scope.disposeOne("retry"), (error) => error === failures[0]);
  assert.equal(calls, 1);
  assert.equal(scope.disposeOne("retry"), undefined, "only final disposal may retry");
  assert.equal(calls, 1);
  await assert.rejects(scope.dispose(), (error) => {
    assert.deepEqual(error.errors.map((item) => item.label), ["retry", "retry"]);
    assert.deepEqual(error.errors.map((item) => item.cause), failures);
    return true;
  });
  assert.equal(calls, 2);
});

test("concurrent asynchronous disposeOne calls share one attempt and a rejection retries once", async () => {
  const scope = createTestResourceScope();
  const first = deferred();
  const finalFailure = new Error("final async failure");
  let calls = 0;
  scope.add("async", () => {
    calls += 1;
    return calls === 1 ? first.promise : Promise.reject(finalFailure);
  });
  const one = scope.disposeOne("async");
  assert.equal(scope.disposeOne("async"), one);
  const earlyFailure = new Error("early async failure");
  first.reject(earlyFailure);
  await assert.rejects(one, (error) => error === earlyFailure);
  await assert.rejects(scope.dispose(), (error) => {
    assert.deepEqual(error.errors.map((item) => item.cause), [earlyFailure, finalFailure]);
    return true;
  });
  assert.equal(calls, 2);
});

test("acquire reserves labels, releases failed reservations, and returns the acquired value", async () => {
  const scope = createTestResourceScope();
  const acquisitionFailure = new Error("acquire failed");
  assert.throws(() => scope.acquire("value", () => { throw acquisitionFailure; }, () => {}),
    (error) => error === acquisitionFailure);

  const disposed = [];
  assert.equal(await scope.acquire("value", () => 42, (value) => disposed.push(value)), 42);
  assert.throws(() => scope.acquire("value", () => 43, () => {}),
    (error) => error?.code === TEST_RESOURCE_SCOPE_ERROR_CODES.DUPLICATE_LABEL);
  await scope.dispose();
  assert.deepEqual(disposed, [42]);
});

test("dispose waits for an in-flight acquisition and cleans a raced value before rejection", async () => {
  const scope = createTestResourceScope();
  const acquired = deferred();
  const calls = [];
  const acquisition = scope.acquire("raced", () => acquired.promise,
    async (value) => { calls.push(`disposed:${value}`); });
  const disposal = scope.dispose();
  let disposalSettled = false;
  void disposal.finally(() => { disposalSettled = true; });
  await Promise.resolve();
  assert.equal(disposalSettled, false);

  acquired.resolve("resource");
  await assert.rejects(acquisition,
    (error) => error?.code === TEST_RESOURCE_SCOPE_ERROR_CODES.ACQUISITION_DISPOSAL_RACE);
  await disposal;
  assert.deepEqual(calls, ["disposed:resource"]);
});

test("a raced acquisition cleanup failure remains loud and is retried during final disposal", async () => {
  const scope = createTestResourceScope();
  const acquired = deferred();
  const failures = [new Error("race cleanup"), new Error("race retry")];
  let calls = 0;
  const acquisition = scope.acquire("raced-failure", () => acquired.promise,
    () => { throw failures[calls++]; });
  const disposal = scope.dispose();
  acquired.resolve("resource");

  await assert.rejects(acquisition, (error) => {
    assert.equal(error instanceof AggregateError, true);
    assert.equal(error.errors[0].code,
      TEST_RESOURCE_SCOPE_ERROR_CODES.ACQUISITION_DISPOSAL_RACE);
    assert.equal(error.errors[1].cause, failures[0]);
    return true;
  });
  await assert.rejects(disposal, (error) => {
    assert.deepEqual(error.errors.map((item) => item.cause), failures);
    return true;
  });
  assert.equal(calls, 2);
});
