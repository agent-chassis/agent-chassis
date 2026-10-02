

export const TEST_PROOF_TIMING_MEASUREMENT = "server_verification";
export const TEST_PROOF_TIMING_ROUNDING_TOLERANCE_MS = 1;

const ATTEMPT_PHASES = Object.freeze(["preparation", "stage_work", "cleanup"]);
const monotonic = () => performance.now();
const wallClock = () => new Date();

const ms = (value) => Math.round(value) || 0;

const EXACT_ATTEMPTS = new WeakMap();

const RESULT_EXECUTIONS = new WeakMap();

export function startTestProofAttemptTiming({ clock = monotonic } = {}) {
  const started = clock();
  const totals = { preparation: 0, stage_work: 0, cleanup: 0 };
  let cleaned = false;
  let sealed = null;
  const close = (phase, since) => { if (sealed === null) totals[phase] += clock() - since; };
  function measure(phase, operation) {
    if (!ATTEMPT_PHASES.includes(phase)) throw new TypeError(`unknown attempt timing phase ${phase}`);
    if (sealed !== null || (phase === "cleanup" && cleaned)) return operation();
    if (phase === "cleanup") cleaned = true;
    const since = clock();
    let result;
    try {
      result = operation();
    } catch (error) {
      close(phase, since);
      throw error;
    }
    if (result === null || typeof result?.then !== "function") {
      close(phase, since);
      return result;
    }
    return result.then((value) => { close(phase, since); return value; },
      (error) => { close(phase, since); throw error; });
  }
  function seal() {
    if (sealed !== null) return sealed;
    const elapsed = clock() - started;
    const other = elapsed - totals.preparation - totals.stage_work - totals.cleanup;
    sealed = Object.freeze({ state: "measured", elapsed_ms: ms(elapsed),
      preparation_ms: ms(totals.preparation), stage_work_ms: ms(totals.stage_work),
      cleanup_ms: ms(totals.cleanup), other_ms: ms(other) });
    EXACT_ATTEMPTS.set(sealed, Object.freeze({ elapsed, ...totals, other }));
    return sealed;
  }
  return Object.freeze({ measure, seal });
}

export function notStartedTestProofTiming() {
  return Object.freeze({ state: "not_started" });
}

export function testProofExecutionTimingRow(executionIndex, attemptTiming) {
  if (!Number.isSafeInteger(executionIndex) || executionIndex < 1) {
    throw new TypeError("execution_index must be a positive invocation-local integer");
  }
  if (attemptTiming?.state !== "measured") {
    return Object.freeze({ state: "unavailable", execution_index: executionIndex });
  }
  const { state, ...values } = attemptTiming;
  return Object.freeze({ state, execution_index: executionIndex, ...values });
}

export function bindTestProofExecutionTimings(result, attemptTimings) {
  RESULT_EXECUTIONS.set(result, Object.freeze([...attemptTimings]));
  return result;
}

function exactAttempt(timing) {
  const exact = EXACT_ATTEMPTS.get(timing);
  if (exact !== undefined) return exact;
  return { elapsed: timing.elapsed_ms, preparation: timing.preparation_ms,
    stage_work: timing.stage_work_ms, cleanup: timing.cleanup_ms, other: timing.other_ms };
}

function executionAccounting(executions, elapsed) {
  if (executions === null) {
    return { measured_execution_count: null, unmeasured_execution_count: null, distinct_attempt_ms: null,
      preparation_ms: null, stage_work_ms: null, cleanup_ms: null, attempt_other_ms: null,
      invocation_other_ms: null };
  }
  const sums = { elapsed: 0, preparation: 0, stage_work: 0, cleanup: 0, other: 0 };
  let measured = 0;
  for (const timing of executions) {
    if (timing?.state !== "measured") continue;
    measured += 1;
    const exact = exactAttempt(timing);
    for (const key of Object.keys(sums)) sums[key] += exact[key];
  }
  return { measured_execution_count: measured, unmeasured_execution_count: executions.length - measured,
    distinct_attempt_ms: ms(sums.elapsed), preparation_ms: ms(sums.preparation),
    stage_work_ms: ms(sums.stage_work), cleanup_ms: ms(sums.cleanup), attempt_other_ms: ms(sums.other),
    invocation_other_ms: ms(elapsed - sums.elapsed) };
}

export function startTestProofInvocationTiming({ clock = monotonic, now = wallClock } = {}) {
  const startedAt = now().toISOString();
  const started = clock();
  let elapsed = null;
  function stop() {
    if (elapsed === null) elapsed = clock() - started;
  }
  function seal(result = null) {
    stop();
    const executions = result !== null && typeof result === "object"
      ? RESULT_EXECUTIONS.get(result) ?? null : null;
    return Object.freeze({ measurement: TEST_PROOF_TIMING_MEASUREMENT, started_at: startedAt,
      elapsed_ms: ms(elapsed), ...executionAccounting(executions, elapsed) });
  }
  return Object.freeze({ stop, seal });
}
