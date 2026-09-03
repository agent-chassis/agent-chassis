export const TEST_RESOURCE_SCOPE_ERROR_CODES = Object.freeze({
  INVALID_LABEL: "test_resource_scope.invalid_label.v1",
  INVALID_DISPOSER: "test_resource_scope.invalid_disposer.v1",
  INVALID_ACQUIRER: "test_resource_scope.invalid_acquirer.v1",
  DUPLICATE_LABEL: "test_resource_scope.duplicate_label.v1",
  DISPOSAL_STARTED: "test_resource_scope.disposal_started.v1",
  ACQUISITION_DISPOSAL_RACE: "test_resource_scope.acquisition_disposal_race.v1",
  CLEANUP_FAILED: "test_resource_scope.cleanup_failed.v1"
});

export class TestResourceScopeError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "TestResourceScopeError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new TestResourceScopeError(code, message);
}

function isThenable(value) {
  return value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof value.then === "function";
}

function labelledCleanupError(label, cause) {
  const error = new TestResourceScopeError(
    TEST_RESOURCE_SCOPE_ERROR_CODES.CLEANUP_FAILED,
    `test resource cleanup failed for "${label}"`,
    { cause }
  );
  error.label = label;
  return error;
}

export function createTestResourceScope() {
  let state = "open";
  let disposePromise;
  const labels = new Set();
  const entries = new Map();
  const registrationOrder = [];
  const acquisitions = new Set();
  const attempts = [];

  function validateLabel(label) {
    if (typeof label !== "string" || label.length === 0) {
      fail(TEST_RESOURCE_SCOPE_ERROR_CODES.INVALID_LABEL,
        "test resource label must be a non-empty string");
    }
  }

  function validateDisposer(disposer) {
    if (typeof disposer !== "function") {
      fail(TEST_RESOURCE_SCOPE_ERROR_CODES.INVALID_DISPOSER,
        "test resource disposer must be a function");
    }
  }

  function reserve(label) {
    if (state !== "open") {
      fail(TEST_RESOURCE_SCOPE_ERROR_CODES.DISPOSAL_STARTED,
        "test resource scope no longer accepts ownership");
    }
    validateLabel(label);
    if (labels.has(label)) {
      fail(TEST_RESOURCE_SCOPE_ERROR_CODES.DUPLICATE_LABEL,
        `test resource label is already owned: ${label}`);
    }
    labels.add(label);
    const entry = {
      label,
      disposer: null,
      status: "acquiring",
      earlyPromise: null
    };
    entries.set(label, entry);
    registrationOrder.push(entry);
    return entry;
  }

  function releaseFailedReservation(entry) {
    entries.delete(entry.label);
    labels.delete(entry.label);
    entry.status = "retired";
  }

  function retire(entry) {
    entries.delete(entry.label);
    entry.status = "retired";
  }

  function beginAttempt(entry) {
    const attempt = { label: entry.label, cause: undefined };
    attempts.push(attempt);
    return attempt;
  }

  function discardSuccessfulAttempt(attempt) {
    const index = attempts.indexOf(attempt);
    if (index !== -1) attempts.splice(index, 1);
  }

  function invokeEarlyDisposer(entry) {
    const attempt = beginAttempt(entry);
    let result;
    try {
      result = entry.disposer();
    } catch (error) {
      attempt.cause = error;
      entry.status = "early-failed";
      throw error;
    }

    if (!isThenable(result)) {
      discardSuccessfulAttempt(attempt);
      retire(entry);
      return undefined;
    }

    entry.status = "early-pending";
    const settlement = Promise.resolve(result).then(
      () => {
        discardSuccessfulAttempt(attempt);
        retire(entry);
      },
      (error) => {
        attempt.cause = error;
        entry.status = "early-failed";
        throw error;
      }
    );
    entry.earlyPromise = settlement;
    return settlement;
  }

  function add(label, disposer) {
    if (state !== "open") {
      fail(TEST_RESOURCE_SCOPE_ERROR_CODES.DISPOSAL_STARTED,
        "test resource scope no longer accepts ownership");
    }
    validateLabel(label);
    validateDisposer(disposer);
    if (labels.has(label)) {
      fail(TEST_RESOURCE_SCOPE_ERROR_CODES.DUPLICATE_LABEL,
        `test resource label is already owned: ${label}`);
    }
    const entry = reserve(label);
    entry.disposer = disposer;
    entry.status = "active";
  }

  function acquire(label, acquireValue, disposer) {
    if (state !== "open") {
      fail(TEST_RESOURCE_SCOPE_ERROR_CODES.DISPOSAL_STARTED,
        "test resource scope no longer accepts ownership");
    }
    validateLabel(label);
    if (typeof acquireValue !== "function") {
      fail(TEST_RESOURCE_SCOPE_ERROR_CODES.INVALID_ACQUIRER,
        "test resource acquirer must be a function");
    }
    validateDisposer(disposer);
    if (labels.has(label)) {
      fail(TEST_RESOURCE_SCOPE_ERROR_CODES.DUPLICATE_LABEL,
        `test resource label is already owned: ${label}`);
    }

    const entry = reserve(label);
    let acquired;
    try {
      acquired = acquireValue();
    } catch (error) {
      releaseFailedReservation(entry);
      throw error;
    }

    const acquisition = Promise.resolve(acquired).then(
      async (value) => {
        entry.disposer = () => disposer(value);
        if (state === "open") {
          entry.status = "active";
          return value;
        }

        let cleanupFailure;
        try {
          await invokeEarlyDisposer(entry);
        } catch (error) {
          cleanupFailure = error;
        }
        const raceError = new TestResourceScopeError(
          TEST_RESOURCE_SCOPE_ERROR_CODES.ACQUISITION_DISPOSAL_RACE,
          `test resource acquisition completed after disposal began: ${label}`
        );
        if (cleanupFailure === undefined) throw raceError;
        throw new AggregateError([
          raceError,
          labelledCleanupError(label, cleanupFailure)
        ], `test resource acquisition race cleanup failed for "${label}"`);
      },
      (error) => {
        releaseFailedReservation(entry);
        throw error;
      }
    );
    acquisitions.add(acquisition);
    void acquisition.finally(() => acquisitions.delete(acquisition)).catch(() => {});
    return acquisition;
  }

  function disposeOne(label) {
    const entry = entries.get(label);
    if (entry === undefined || state !== "open" ||
        entry.status === "early-failed") {
      return undefined;
    }
    if (entry.status === "early-pending") return entry.earlyPromise;
    if (entry.status !== "active") return undefined;
    return invokeEarlyDisposer(entry);
  }

  async function runDispose() {
    await Promise.allSettled([...acquisitions]);

    for (let index = registrationOrder.length - 1; index >= 0; index -= 1) {
      const entry = registrationOrder[index];
      if (!entries.has(entry.label)) continue;
      if (entry.status === "early-pending") {
        await Promise.allSettled([entry.earlyPromise]);
        if (!entries.has(entry.label)) continue;
      }
      if (entry.status === "acquiring") continue;

      const attempt = beginAttempt(entry);
      try {
        await entry.disposer();
        discardSuccessfulAttempt(attempt);
        retire(entry);
      } catch (error) {
        attempt.cause = error;
        entry.status = "retired";
        entries.delete(entry.label);
      }
    }

    state = "disposed";
    const failures = attempts.filter((attempt) => attempt.cause !== undefined);
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map(({ label, cause }) => labelledCleanupError(label, cause)),
        `${failures.length} test resource cleanup attempt(s) failed`
      );
    }
  }

  function dispose() {
    if (disposePromise !== undefined) return disposePromise;
    state = "disposing";
    disposePromise = runDispose();
    return disposePromise;
  }

  return Object.freeze({ add, acquire, disposeOne, dispose });
}
