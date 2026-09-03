

export const MONITOR_CALL_DEFAULT_TIMEOUT_MS = 60000;

export const RUN_STATUS_CALL_BUDGET_MS = MONITOR_CALL_DEFAULT_TIMEOUT_MS;

export const RUN_WAIT_TIMEOUT_MS_BOUNDS = Object.freeze({ min: 1, max: 300000 });

export const BACKEND_SETTLE_GRACE_MS = 1000;

export const DEADLINE_EXPIRED = Object.freeze({ settled: false, value: null });

export function createCallDeadline(timeoutMs) {
  const expiresAt = Date.now() + timeoutMs;
  return Object.freeze({
    timeout_ms: timeoutMs,
    remainingMs: () => expiresAt - Date.now(),
    expired: () => expiresAt - Date.now() <= 0
  });
}

export function retainAbandonedWork(promise) {
  Promise.resolve(promise).catch(() => {});
  return promise;
}

export async function settleWithinDeadline(work, deadline, { graceMs = 0 } = {}) {
  const promise = Promise.resolve(work);
  retainAbandonedWork(promise);
  let timer = null;
  try {
    const outcome = await Promise.race([
      promise.then(
        (value) => ({ settled: true, value, rejection: null }),
        (error) => ({ settled: true, value: null, rejection: { error } })
      ),
      new Promise((resolve) => {
        timer = setTimeout(
          () => resolve(DEADLINE_EXPIRED),
          Math.max(0, deadline.remainingMs()) + graceMs
        );
        if (typeof timer?.unref === "function") timer.unref();
      })
    ]);
    if (outcome.settled && outcome.rejection !== null) throw outcome.rejection.error;
    return outcome.settled ? { settled: true, value: outcome.value } : DEADLINE_EXPIRED;
  } finally {

    if (timer !== null) clearTimeout(timer);
  }
}
