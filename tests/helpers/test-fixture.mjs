import { lstat, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { createTestResourceScope } from "./test-resource-scope.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_PREFIX = "agent-chassis-test-";

export const TEST_FIXTURE_ERROR_CODES = Object.freeze({
  INVALID_ARGUMENT: "test_fixture.invalid_argument.v1",
  UNSAFE_ROOT: "test_fixture.unsafe_root.v1",
  CHILD_ESCAPE: "test_fixture.child_escape.v1",
  WAIT_TIMEOUT: "test_fixture.wait_timeout.v1",
  WAIT_CANCELLED: "test_fixture.wait_cancelled.v1",
  PATH_RESIDUE: "test_fixture.path_residue.v1",
  EXPECTED_FAILURE_MISSING: "test_fixture.expected_failure_missing.v1",
  NON_ERROR_THROWN: "test_fixture.non_error_thrown.v1",
  EXPECTED_FAILURE_MISMATCH: "test_fixture.expected_failure_mismatch.v1"
});

export class TestFixtureError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "TestFixtureError";
    this.code = code;
    if (options.detail !== undefined) this.detail = options.detail;
  }
}

function failure(code, message, options) {
  return new TestFixtureError(code, message, options);
}

function isContained(candidate, parent) {
  const relative = path.relative(parent, candidate);
  const traversesParent = relative === ".." || relative.startsWith(`..${path.sep}`);
  return relative === "" || (!traversesParent && !path.isAbsolute(relative));
}

function pathsIntersect(left, right) {
  return isContained(left, right) || isContained(right, left);
}

async function partialRealpath(candidate) {
  let existing = path.resolve(candidate);
  const suffix = [];
  while (true) {
    try {
      const resolvedExisting = await realpath(existing);
      return path.resolve(resolvedExisting, ...suffix.reverse());
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      try {
        await lstat(existing);
      } catch (inspectionError) {
        if (inspectionError?.code !== "ENOENT") throw inspectionError;
        const parent = path.dirname(existing);
        if (parent === existing) throw error;
        suffix.push(path.basename(existing));
        existing = parent;
        continue;
      }
      throw error;
    }
  }
}

function protectedRootInputs() {
  const home = process.env.HOME ? path.resolve(process.env.HOME) : null;
  return [
    REPOSITORY_ROOT,
    path.join(REPOSITORY_ROOT, "tests"),
    path.join(REPOSITORY_ROOT, "docs"),
    path.join(REPOSITORY_ROOT, "wiki"),
    home,
    process.env.XDG_CONFIG_HOME,
    process.env.XDG_CACHE_HOME,
    process.env.XDG_DATA_HOME,
    process.env.XDG_STATE_HOME,
    process.env.XDG_RUNTIME_DIR,
    home && path.join(home, ".config"),
    home && path.join(home, ".cache"),
    home && path.join(home, ".local", "share"),
    home && path.join(home, ".local", "state")
  ].filter(Boolean);
}

async function resolveTestFixtureAllocation(root) {
  const platformTempRoot = tmpdir();
  const selectedRoot = root === undefined ? platformTempRoot : root;
  if (typeof selectedRoot !== "string" || selectedRoot.trim() === "") {
    throw failure(TEST_FIXTURE_ERROR_CODES.INVALID_ARGUMENT,
      "test fixture root must be a non-empty string");
  }
  const requested = path.resolve(selectedRoot);
  const requestedTempRoot = path.resolve(platformTempRoot);
  if (!isContained(requested, requestedTempRoot)) {
    throw failure(TEST_FIXTURE_ERROR_CODES.UNSAFE_ROOT,
      `test fixture root must be under ${requestedTempRoot}: ${requested}`);
  }
  const protectedInputs = protectedRootInputs();
  const [resolved, resolvedTmp, ...protectedRoots] = await Promise.all([
    realpath(requested),
    realpath(requestedTempRoot),
    ...protectedInputs.map(partialRealpath)
  ]);
  if (!isContained(resolved, resolvedTmp)) {
    throw failure(TEST_FIXTURE_ERROR_CODES.UNSAFE_ROOT,
      `test fixture root escapes ${resolvedTmp}: ${resolved}`);
  }
  if (root !== undefined) {
    const blocked = protectedRoots.find((candidate) => pathsIntersect(resolved, candidate));
    if (blocked !== undefined) {
      throw failure(TEST_FIXTURE_ERROR_CODES.UNSAFE_ROOT,
        `test fixture root is protected: ${resolved} inside ${blocked}`);
    }
  }
  return Object.freeze({
    allocationParent: resolved,
    temporaryParent: resolvedTmp,
    protectedRoots: Object.freeze(protectedRoots)
  });
}

export async function resolveTestFixtureRoot(root) {
  const allocation = await resolveTestFixtureAllocation(root);
  return allocation.allocationParent;
}

async function resolvedChildPath(rootPath, relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0 ||
      path.isAbsolute(relativePath)) {
    throw failure(TEST_FIXTURE_ERROR_CODES.CHILD_ESCAPE,
      "test fixture child path must be a non-empty relative path");
  }
  const candidate = path.resolve(rootPath, relativePath);
  if (!isContained(candidate, rootPath)) {
    throw failure(TEST_FIXTURE_ERROR_CODES.CHILD_ESCAPE,
      `test fixture child path escapes its root: ${relativePath}`);
  }
  const resolvedCandidate = await partialRealpath(candidate);
  if (!isContained(resolvedCandidate, rootPath)) {
    throw failure(TEST_FIXTURE_ERROR_CODES.CHILD_ESCAPE,
      `test fixture child path resolves outside its root: ${relativePath}`);
  }
  return candidate;
}

export async function createTestFixture({ root, prefix = DEFAULT_PREFIX } = {}) {
  if (typeof prefix !== "string" || prefix.length === 0 || prefix === "." || prefix === ".." ||
      prefix.includes(path.sep)) {
    throw failure(TEST_FIXTURE_ERROR_CODES.INVALID_ARGUMENT,
      "test fixture prefix must be one non-empty path segment");
  }
  const allocation = await resolveTestFixtureAllocation(root);
  const fixturePath = await mkdtemp(path.join(allocation.allocationParent, prefix));
  const resources = createTestResourceScope();
  resources.add("fixture-root", () => rm(fixturePath, { recursive: true, force: true }));
  try {
    const resolvedFixturePath = await realpath(fixturePath);
    if (resolvedFixturePath === allocation.allocationParent ||
        !isContained(resolvedFixturePath, allocation.allocationParent) ||
        !isContained(resolvedFixturePath, allocation.temporaryParent)) {
      throw failure(TEST_FIXTURE_ERROR_CODES.UNSAFE_ROOT,
        `created test fixture escaped its validated root: ${resolvedFixturePath}`);
    }
    const blocked = allocation.protectedRoots.find((candidate) =>
      pathsIntersect(resolvedFixturePath, candidate));
    if (blocked !== undefined) {
      throw failure(TEST_FIXTURE_ERROR_CODES.UNSAFE_ROOT,
        `created test fixture is protected: ${resolvedFixturePath} inside ${blocked}`);
    }
    return Object.freeze({
      rootPath: resolvedFixturePath,
      resources,
      childPath: (relativePath) => resolvedChildPath(resolvedFixturePath, relativePath),
      dispose: resources.dispose
    });
  } catch (error) {
    await resources.dispose();
    throw error;
  }
}

export async function withTestFixture(operation, options) {
  if (typeof operation !== "function") {
    throw failure(TEST_FIXTURE_ERROR_CODES.INVALID_ARGUMENT,
      "withTestFixture operation must be a function");
  }
  const fixture = await createTestFixture(options);
  try {
    return await operation(fixture);
  } finally {
    await fixture.dispose();
  }
}

function waitDetail(startedAt, timeoutMs, intervalMs, attempts) {
  return Object.freeze({
    timeoutMs,
    intervalMs,
    attempts,
    elapsedMs: Math.min(timeoutMs, Math.max(0, Math.floor(performance.now() - startedAt)))
  });
}

function delay(milliseconds, signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, milliseconds);
    function finish() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    }
    signal?.addEventListener("abort", finish, { once: true });
  });
}

function runWaitCallback(callback, { deadline, signal, timeoutFailure, cancellationFailure }) {
  if (signal?.aborted) return Promise.reject(cancellationFailure());
  const remaining = deadline - performance.now();
  if (remaining <= 0) return Promise.reject(timeoutFailure());

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(reject, timeoutFailure()), remaining);
    const onAbort = () => finish(reject, cancellationFailure());
    signal?.addEventListener("abort", onAbort, { once: true });

    function finish(settle, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      settle(value);
    }

    let callbackPromise;
    try {
      callbackPromise = Promise.resolve(callback());
    } catch (error) {
      callbackPromise = Promise.reject(error);
    }
    callbackPromise.then(
      (value) => {
        if (signal?.aborted) finish(reject, cancellationFailure());
        else if (performance.now() >= deadline) finish(reject, timeoutFailure());
        else finish(resolve, value);
      },
      (error) => {
        if (signal?.aborted) finish(reject, cancellationFailure());
        else if (performance.now() >= deadline) finish(reject, timeoutFailure());
        else finish(reject, error);
      }
    );
    if (signal?.aborted) onAbort();
  });
}

export async function waitForCondition(probe, {
  accept = Boolean,
  timeoutMs = 1000,
  intervalMs = 10,
  signal,
  isTransientProbeError
} = {}) {
  if (typeof probe !== "function" || typeof accept !== "function" ||
      (isTransientProbeError !== undefined && typeof isTransientProbeError !== "function") ||
      !Number.isFinite(timeoutMs) || timeoutMs < 0 ||
      !Number.isFinite(intervalMs) || intervalMs < 0) {
    throw failure(TEST_FIXTURE_ERROR_CODES.INVALID_ARGUMENT, "invalid bounded wait options");
  }
  const startedAt = performance.now();
  const deadline = startedAt + timeoutMs;
  let attempts = 0;
  let lastTransientFailure;
  const timeoutFailure = () => failure(
    TEST_FIXTURE_ERROR_CODES.WAIT_TIMEOUT,
    "bounded wait timed out",
    {
      cause: lastTransientFailure,
      detail: waitDetail(startedAt, timeoutMs, intervalMs, attempts)
    }
  );
  const cancellationFailure = () => failure(
    TEST_FIXTURE_ERROR_CODES.WAIT_CANCELLED,
    "bounded wait was cancelled",
    {
      cause: signal?.reason instanceof Error ? signal.reason : undefined,
      detail: waitDetail(startedAt, timeoutMs, intervalMs, attempts)
    }
  );
  while (true) {
    if (signal?.aborted) throw cancellationFailure();
    if (performance.now() >= deadline) throw timeoutFailure();
    let value;
    let probeSucceeded = false;
    attempts += 1;
    try {
      value = await runWaitCallback(probe, {
        deadline, signal, timeoutFailure, cancellationFailure
      });
      probeSucceeded = true;
    } catch (error) {
      if (error?.code === TEST_FIXTURE_ERROR_CODES.WAIT_TIMEOUT ||
          error?.code === TEST_FIXTURE_ERROR_CODES.WAIT_CANCELLED) throw error;
      if (isTransientProbeError === undefined || !isTransientProbeError(error)) throw error;
      lastTransientFailure = error;
    }
    if (probeSucceeded && await runWaitCallback(() => accept(value), {
      deadline, signal, timeoutFailure, cancellationFailure
    })) return value;
    const now = performance.now();
    if (now >= deadline) throw timeoutFailure();
    await delay(Math.min(intervalMs, deadline - now), signal);
  }
}

export async function assertPathsAbsent(paths, { inspectPath = lstat } = {}) {
  if (!Array.isArray(paths) || paths.some((entry) => typeof entry !== "string" || entry.length === 0) ||
      typeof inspectPath !== "function") {
    throw failure(TEST_FIXTURE_ERROR_CODES.INVALID_ARGUMENT,
      "path residue inspection requires an array of non-empty paths");
  }
  const population = [...new Set(paths)].sort();
  const presentPaths = [];
  for (const candidate of population) {
    try {
      await inspectPath(candidate);
      presentPaths.push(candidate);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  if (presentPaths.length > 0) {
    throw failure(TEST_FIXTURE_ERROR_CODES.PATH_RESIDUE,
      `test path residue remains: ${presentPaths.join(", ")}`, {
        detail: Object.freeze({ presentPaths: Object.freeze(presentPaths) })
      });
  }
}

function validateCapturedFailure(didThrow, error) {
  if (!didThrow) {
    throw failure(TEST_FIXTURE_ERROR_CODES.EXPECTED_FAILURE_MISSING,
      "operation completed successfully when failure was expected");
  }
  if (!(error instanceof Error)) {
    throw failure(TEST_FIXTURE_ERROR_CODES.NON_ERROR_THROWN,
      "operation threw a non-Error value");
  }
}

export function captureExpectedFailureSync(operation, predicate) {
  if (typeof operation !== "function" || (predicate !== undefined && typeof predicate !== "function")) {
    throw failure(TEST_FIXTURE_ERROR_CODES.INVALID_ARGUMENT, "expected-failure inputs must be functions");
  }
  let didThrow = false;
  let captured;
  try { operation(); } catch (error) { didThrow = true; captured = error; }
  validateCapturedFailure(didThrow, captured);
  if (predicate !== undefined) {
    const result = predicate(captured);
    if (result !== true) {
      if (result !== null && (typeof result === "object" || typeof result === "function") &&
          typeof result.then === "function") {
        void Promise.resolve(result).catch(() => {});
      }
      throw failure(TEST_FIXTURE_ERROR_CODES.EXPECTED_FAILURE_MISMATCH,
        "captured Error did not satisfy the expected-failure predicate");
    }
  }
  return captured;
}

export async function captureExpectedFailure(operation, predicate) {
  if (typeof operation !== "function" || (predicate !== undefined && typeof predicate !== "function")) {
    throw failure(TEST_FIXTURE_ERROR_CODES.INVALID_ARGUMENT, "expected-failure inputs must be functions");
  }
  let didThrow = false;
  let captured;
  try { await operation(); } catch (error) { didThrow = true; captured = error; }
  validateCapturedFailure(didThrow, captured);
  if (predicate !== undefined) {
    const result = await predicate(captured);
    if (result !== true) {
      throw failure(TEST_FIXTURE_ERROR_CODES.EXPECTED_FAILURE_MISMATCH,
        "captured Error did not satisfy the expected-failure predicate");
    }
  }
  return captured;
}
