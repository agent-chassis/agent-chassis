import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  TEST_FIXTURE_ERROR_CODES,
  assertPathsAbsent,
  captureExpectedFailure,
  captureExpectedFailureSync,
  createTestFixture,
  resolveTestFixtureRoot,
  waitForCondition,
  withTestFixture
} from "../helpers/test-fixture.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function temporaryRoot(prefix = "test-fixture-contract-") {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

test("fixture root safety rejects protected and symlink escapes", async () => {
  const sandbox = await temporaryRoot();
  const originalXdgCache = process.env.XDG_CACHE_HOME;
  try {
    const xdgRoot = path.join(sandbox, "xdg-cache");
    await mkdir(xdgRoot);
    process.env.XDG_CACHE_HOME = xdgRoot;
    await assert.rejects(resolveTestFixtureRoot(repoRoot),
      (error) => error.code === TEST_FIXTURE_ERROR_CODES.UNSAFE_ROOT);
    await assert.rejects(resolveTestFixtureRoot(path.join(repoRoot, "tests")),
      (error) => error.code === TEST_FIXTURE_ERROR_CODES.UNSAFE_ROOT);
    await assert.rejects(resolveTestFixtureRoot(xdgRoot),
      (error) => error.code === TEST_FIXTURE_ERROR_CODES.UNSAFE_ROOT);
    await assert.rejects(resolveTestFixtureRoot(sandbox),
      (error) => error.code === TEST_FIXTURE_ERROR_CODES.UNSAFE_ROOT);

    const repoLink = path.join(sandbox, "repo-link");
    await symlink(repoRoot, repoLink);
    await assert.rejects(resolveTestFixtureRoot(repoLink),
      (error) => error.code === TEST_FIXTURE_ERROR_CODES.UNSAFE_ROOT);
  } finally {
    if (originalXdgCache === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = originalXdgCache;
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("fixture root safety canonicalizes missing protected paths through symlinked ancestors", async () => {
  const sandbox = await temporaryRoot();
  const originalXdgCache = process.env.XDG_CACHE_HOME;
  try {
    const fixtureRoot = path.join(sandbox, "fixture-root");
    const unrelatedRoot = path.join(sandbox, "unrelated-root");
    await mkdir(fixtureRoot);
    await mkdir(unrelatedRoot);

    const protectedLink = path.join(sandbox, "protected-link");
    await symlink(fixtureRoot, protectedLink);
    process.env.XDG_CACHE_HOME = path.join(protectedLink, "missing", "nested");
    await assert.rejects(resolveTestFixtureRoot(fixtureRoot),
      (error) => error.code === TEST_FIXTURE_ERROR_CODES.UNSAFE_ROOT);

    const unrelatedLink = path.join(sandbox, "unrelated-link");
    await symlink(unrelatedRoot, unrelatedLink);
    process.env.XDG_CACHE_HOME = path.join(unrelatedLink, "missing", "nested");
    assert.equal(await resolveTestFixtureRoot(fixtureRoot), await realpath(fixtureRoot));
  } finally {
    if (originalXdgCache === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = originalXdgCache;
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("fixture creation, child containment, reverse cleanup, and disposal are single-owned", async () => {
  const fixture = await createTestFixture();
  const outside = await temporaryRoot("test-fixture-outside-");
  let consumerDisposed = false;
  try {
    await assert.rejects(fixture.childPath(""),
      (error) => error.code === TEST_FIXTURE_ERROR_CODES.CHILD_ESCAPE);
    await assert.rejects(fixture.childPath(".."),
      (error) => error.code === TEST_FIXTURE_ERROR_CODES.CHILD_ESCAPE);
    await assert.rejects(fixture.childPath("../escape"),
      (error) => error.code === TEST_FIXTURE_ERROR_CODES.CHILD_ESCAPE);
    await assert.rejects(fixture.childPath(path.resolve(os.tmpdir(), "escape")),
      (error) => error.code === TEST_FIXTURE_ERROR_CODES.CHILD_ESCAPE);

    const target = path.join(outside, "target");
    await writeFile(target, "outside");
    await symlink(outside, path.join(fixture.rootPath, "outside-link"));
    await assert.rejects(fixture.childPath("outside-link/target"),
      (error) => error.code === TEST_FIXTURE_ERROR_CODES.CHILD_ESCAPE);
    await assert.rejects(fixture.childPath("outside-link/not-created"),
      (error) => error.code === TEST_FIXTURE_ERROR_CODES.CHILD_ESCAPE);
    assert.equal(await fixture.childPath("..cache"), path.join(fixture.rootPath, "..cache"));
    assert.equal(await fixture.childPath("..cache/item"),
      path.join(fixture.rootPath, "..cache", "item"));

    fixture.resources.add("consumer", async () => {
      assert.equal(await realpath(fixture.rootPath), fixture.rootPath,
        "consumer must dispose before the fixture root");
      consumerDisposed = true;
    });
    assert.throws(() => fixture.resources.add("fixture-root", () => {}),
      (error) => error.code === "test_resource_scope.duplicate_label.v1");
    const firstDispose = fixture.dispose();
    assert.equal(fixture.dispose(), firstDispose, "explicit disposal must be idempotent");
    await firstDispose;
    assert.equal(consumerDisposed, true);
    await assertPathsAbsent([fixture.rootPath]);
  } finally {
    await fixture.dispose();
    await rm(outside, { recursive: true, force: true });
  }
});

test("default fixture allocation owns one child beneath the platform temporary root", async () => {
  const allocationParent = await realpath(os.tmpdir());
  assert.equal(await resolveTestFixtureRoot(), allocationParent);

  const fixture = await createTestFixture();
  const fixturePath = fixture.rootPath;
  assert.equal(path.dirname(fixturePath), allocationParent);
  await fixture.dispose();

  await assertPathsAbsent([fixturePath]);
  assert.equal(await realpath(os.tmpdir()), allocationParent,
    "fixture cleanup must preserve its allocation parent");
});

test("fixture prefixes reject traversal without rejecting valid two-dot names", async () => {
  await assert.rejects(createTestFixture({ prefix: ".." }),
    (error) => error.code === TEST_FIXTURE_ERROR_CODES.INVALID_ARGUMENT);
  const fixture = await createTestFixture({ prefix: "..cache-" });
  try {
    assert.ok(path.basename(fixture.rootPath).startsWith("..cache-"));
  } finally {
    await fixture.dispose();
  }
});

test("withTestFixture returns the exact operation value and always cleans up", async () => {
  let fixturePath;
  const value = { exact: true };
  const returned = await withTestFixture(async (fixture) => {
    fixturePath = fixture.rootPath;
    return value;
  });
  assert.equal(returned, value);
  await assertPathsAbsent([fixturePath]);
});

test("bounded waits probe immediately, never overlap, and return the exact accepted value", async () => {
  let active = 0;
  let maximumActive = 0;
  let attempts = 0;
  const accepted = { ready: true };
  const startedAt = Date.now();
  const result = await waitForCondition(async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    attempts += 1;
    await new Promise((resolve) => setTimeout(resolve, 4));
    active -= 1;
    return attempts === 3 ? accepted : null;
  }, { timeoutMs: 100, intervalMs: 1 });
  assert.ok(Date.now() - startedAt >= 4, "the first probe runs immediately, not after an interval");
  assert.equal(result, accepted);
  assert.equal(maximumActive, 1);
  assert.equal(attempts, 3);
});

test("bounded waits fail loudly on timeout and cancellation", async () => {
  const timeout = await captureExpectedFailure(
    () => waitForCondition(() => false, { timeoutMs: 15, intervalMs: 2 }),
    (error) => error.code === TEST_FIXTURE_ERROR_CODES.WAIT_TIMEOUT);
  assert.ok(timeout.detail.attempts >= 1);
  assert.ok(timeout.detail.elapsedMs <= timeout.detail.timeoutMs);

  const controller = new AbortController();
  let probes = 0;
  const waiting = waitForCondition(() => { probes += 1; return false; }, {
    timeoutMs: 1000,
    intervalMs: 1000,
    signal: controller.signal
  });
  controller.abort(new Error("stop"));
  const cancelled = await captureExpectedFailure(() => waiting,
    (error) => error.code === TEST_FIXTURE_ERROR_CODES.WAIT_CANCELLED);
  assert.ok(probes <= 1);
  assert.equal(cancelled.cause?.message, "stop");
});

test("bounded waits stop never-settling and deadline-crossing probe callbacks", async () => {
  let neverProbeCalls = 0;
  await assert.rejects(waitForCondition(() => {
    neverProbeCalls += 1;
    return new Promise(() => {});
  }, { timeoutMs: 10 }),
  (error) => error.code === TEST_FIXTURE_ERROR_CODES.WAIT_TIMEOUT);
  assert.equal(neverProbeCalls, 1);

  let lateProbeCalls = 0;
  await assert.rejects(waitForCondition(() => {
    lateProbeCalls += 1;
    return new Promise((resolve, reject) => setTimeout(() => reject(new Error("late")), 20));
  }, { timeoutMs: 5 }),
  (error) => error.code === TEST_FIXTURE_ERROR_CODES.WAIT_TIMEOUT);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(lateProbeCalls, 1);
});

test("bounded waits stop never-settling and deadline-crossing accept callbacks", async () => {
  let neverAcceptCalls = 0;
  await assert.rejects(waitForCondition(() => "value", {
    accept: () => {
      neverAcceptCalls += 1;
      return new Promise(() => {});
    },
    timeoutMs: 10
  }), (error) => error.code === TEST_FIXTURE_ERROR_CODES.WAIT_TIMEOUT);
  assert.equal(neverAcceptCalls, 1);

  let lateAcceptCalls = 0;
  await assert.rejects(waitForCondition(() => "value", {
    accept: () => {
      lateAcceptCalls += 1;
      return new Promise((resolve) => setTimeout(() => resolve(true), 20));
    },
    timeoutMs: 5
  }), (error) => error.code === TEST_FIXTURE_ERROR_CODES.WAIT_TIMEOUT);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(lateAcceptCalls, 1);
});

test("bounded waits cancel an active probe or accept without starting more work", async () => {
  for (const blocked of ["probe", "accept"]) {
    const controller = new AbortController();
    let probeCalls = 0;
    let acceptCalls = 0;
    const waiting = waitForCondition(() => {
      probeCalls += 1;
      return blocked === "probe" ? new Promise(() => {}) : "value";
    }, {
      accept: () => {
        acceptCalls += 1;
        return new Promise(() => {});
      },
      timeoutMs: 1000,
      signal: controller.signal
    });
    setTimeout(() => controller.abort(new Error(`cancel ${blocked}`)), 5);
    await assert.rejects(waiting,
      (error) => error.code === TEST_FIXTURE_ERROR_CODES.WAIT_CANCELLED);
    assert.equal(probeCalls, 1);
    assert.equal(acceptCalls, blocked === "accept" ? 1 : 0);
  }
});

test("bounded waits propagate probe failures unless explicitly transient", async () => {
  const fatal = new Error("fatal probe");
  await assert.rejects(waitForCondition(() => { throw fatal; }), (error) => error === fatal);

  const transient = new Error("not ready");
  const timeout = await captureExpectedFailure(() => waitForCondition(() => { throw transient; }, {
    timeoutMs: 5,
    intervalMs: 1,
    isTransientProbeError: (error) => error === transient
  }), (error) => error.code === TEST_FIXTURE_ERROR_CODES.WAIT_TIMEOUT);
  assert.equal(timeout.cause, transient);

  const predicateFailure = new Error("transient classifier failed");
  await assert.rejects(waitForCondition(() => { throw transient; }, {
    isTransientProbeError: () => { throw predicateFailure; }
  }), (error) => error === predicateFailure);
});

test("residue inspection reports the complete stable population and only ignores ENOENT", async () => {
  const fixture = await createTestFixture();
  try {
    const first = await fixture.childPath("b-present");
    const second = await fixture.childPath("a-present");
    const absent = await fixture.childPath("absent");
    await writeFile(first, "b");
    await writeFile(second, "a");
    const residue = await captureExpectedFailure(
      () => assertPathsAbsent([first, absent, second, first]),
      (error) => error.code === TEST_FIXTURE_ERROR_CODES.PATH_RESIDUE);
    assert.deepEqual(residue.detail.presentPaths, [second, first]);

    const inspectionFailure = new Error("inspection denied");
    inspectionFailure.code = "EACCES";
    await assert.rejects(assertPathsAbsent([absent], {
      inspectPath: async () => { throw inspectionFailure; }
    }), (error) => error === inspectionFailure);
  } finally {
    await fixture.dispose();
  }
});

test("synchronous expected-failure capture invokes once and preserves exact Error identity", () => {
  const exact = new Error("expected");
  let invocations = 0;
  const captured = captureExpectedFailureSync(() => { invocations += 1; throw exact; },
    (error) => error === exact);
  assert.equal(captured, exact);
  assert.equal(invocations, 1);
  assert.throws(() => captureExpectedFailureSync(() => {}),
    (error) => error.code === TEST_FIXTURE_ERROR_CODES.EXPECTED_FAILURE_MISSING);
  assert.throws(() => captureExpectedFailureSync(() => { throw "bad"; }),
    (error) => error.code === TEST_FIXTURE_ERROR_CODES.NON_ERROR_THROWN);
  for (const result of [false, undefined, null, 1, "true", {}]) {
    assert.throws(() => captureExpectedFailureSync(() => { throw exact; }, () => result),
      (error) => error.code === TEST_FIXTURE_ERROR_CODES.EXPECTED_FAILURE_MISMATCH);
  }
  assert.throws(() => captureExpectedFailureSync(() => { throw exact; }, async () => true),
    (error) => error.code === TEST_FIXTURE_ERROR_CODES.EXPECTED_FAILURE_MISMATCH);
  const predicateFailure = new Error("predicate failed");
  assert.throws(() => captureExpectedFailureSync(() => { throw exact; }, () => {
    throw predicateFailure;
  }), (error) => error === predicateFailure);
});

test("asynchronous expected-failure capture invokes once and preserves exact Error identity", async () => {
  const exact = new Error("async expected");
  let invocations = 0;
  const captured = await captureExpectedFailure(async () => { invocations += 1; throw exact; },
    async (error) => error === exact);
  assert.equal(captured, exact);
  assert.equal(invocations, 1);
  await assert.rejects(captureExpectedFailure(async () => {}),
    (error) => error.code === TEST_FIXTURE_ERROR_CODES.EXPECTED_FAILURE_MISSING);
  await assert.rejects(captureExpectedFailure(async () => { throw { bad: true }; }),
    (error) => error.code === TEST_FIXTURE_ERROR_CODES.NON_ERROR_THROWN);
  for (const result of [false, undefined, null, 1, "true", {}]) {
    await assert.rejects(captureExpectedFailure(async () => { throw exact; }, async () => result),
      (error) => error.code === TEST_FIXTURE_ERROR_CODES.EXPECTED_FAILURE_MISMATCH);
  }
  const predicateFailure = new Error("async predicate failed");
  await assert.rejects(captureExpectedFailure(async () => { throw exact; }, async () => {
    throw predicateFailure;
  }), (error) => error === predicateFailure);
});
