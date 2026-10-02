import assert from "node:assert/strict";
import test from "node:test";

import {
  TEST_PROOF_TIMING_MEASUREMENT,
  TEST_PROOF_TIMING_ROUNDING_TOLERANCE_MS,
  bindTestProofExecutionTimings,
  notStartedTestProofTiming,
  startTestProofAttemptTiming,
  startTestProofInvocationTiming,
  testProofExecutionTimingRow
} from "../../packages/agent-launch-core/src/lib/test-proof-timing.mjs";

function controlledClock(start = 1000) {
  let now = start;
  const clock = () => now;
  clock.advance = (ms) => { now += ms; };
  return clock;
}

const DISJOINT = ["preparation_ms", "stage_work_ms", "cleanup_ms", "other_ms"];
const INVOCATION_DISJOINT = ["preparation_ms", "stage_work_ms", "cleanup_ms", "attempt_other_ms",
  "invocation_other_ms"];
const within = (actual, terms, label) => assert.ok(
  Math.abs(actual - terms.reduce((sum, value) => sum + value, 0)) <=
    TEST_PROOF_TIMING_ROUNDING_TOLERANCE_MS * terms.length, `${label}: ${actual} vs ${terms}`);

test("proof timing measures disjoint phases", async () => {

  const clock = controlledClock();
  const attempt = startTestProofAttemptTiming({ clock });
  clock.advance(0.4);
  const prepared = await attempt.measure("preparation", async () => { clock.advance(10.4); return "prepared"; });
  assert.equal(prepared, "prepared", "the operation's own value is returned");
  clock.advance(0.3);
  await attempt.measure("stage_work", async () => { clock.advance(20.3); });
  clock.advance(0.3);
  await attempt.measure("stage_work", async () => { clock.advance(5.3); });

  let releases = 0;
  attempt.measure("cleanup", () => { releases += 1; clock.advance(2.6); });
  attempt.measure("cleanup", () => { releases += 1; clock.advance(100); });
  assert.equal(releases, 2);
  clock.advance(0.7);
  const sealed = attempt.seal();

  assert.deepEqual(sealed, {
    state: "measured", elapsed_ms: 140, preparation_ms: 10, stage_work_ms: 26, cleanup_ms: 3, other_ms: 102
  });
  within(sealed.elapsed_ms, DISJOINT.map((key) => sealed[key]), "attempt reconciliation");
  assert.equal(attempt.seal(), sealed, "the first seal wins");
  clock.advance(50);
  await attempt.measure("stage_work", async () => { clock.advance(50); });
  assert.equal(attempt.seal(), sealed, "no span is added after sealing");

  const failing = controlledClock();
  const thrown = startTestProofAttemptTiming({ clock: failing });
  const original = new Error("preparation threw before returning its owner");
  await assert.rejects(thrown.measure("preparation", async () => { failing.advance(7.7); throw original; }),
    (error) => error === original);
  assert.throws(() => thrown.measure("cleanup", () => { failing.advance(1.2); throw original; }),
    (error) => error === original);
  const failed = thrown.seal();
  assert.deepEqual(failed, { state: "measured", elapsed_ms: 9, preparation_ms: 8, stage_work_ms: 0,
    cleanup_ms: 1, other_ms: 0 });
  const empty = startTestProofAttemptTiming({ clock: controlledClock() }).seal();
  assert.deepEqual(empty, { state: "measured", elapsed_ms: 0, preparation_ms: 0, stage_work_ms: 0,
    cleanup_ms: 0, other_ms: 0 }, "no compiler-cache operation is timed or claimed");
  assert.throws(() => startTestProofAttemptTiming().measure("compile", () => null), TypeError);

  const row = testProofExecutionTimingRow(1, sealed);
  assert.deepEqual(row, { state: "measured", execution_index: 1, elapsed_ms: 140, preparation_ms: 10,
    stage_work_ms: 26, cleanup_ms: 3, other_ms: 102 });
  assert.deepEqual(testProofExecutionTimingRow(2, null), { state: "unavailable", execution_index: 2 });
  assert.deepEqual(notStartedTestProofTiming(), { state: "not_started" });
  assert.throws(() => testProofExecutionTimingRow(0, sealed), TypeError);

  const invocationClock = controlledClock(0);
  const invocation = startTestProofInvocationTiming({ clock: invocationClock,
    now: () => new Date("2026-09-29T23:35:57.086Z") });
  invocationClock.advance(300.2);
  const result = bindTestProofExecutionTimings(Object.freeze({ status: "satisfied" }),
    [sealed, null, failed, empty]);
  invocation.stop();
  invocationClock.advance(1000);
  invocation.stop();
  const settled = invocation.seal(result);
  assert.deepEqual(settled, {
    measurement: TEST_PROOF_TIMING_MEASUREMENT, started_at: "2026-09-29T23:35:57.086Z", elapsed_ms: 300,
    measured_execution_count: 3, unmeasured_execution_count: 1,

    distinct_attempt_ms: 149, preparation_ms: 18, stage_work_ms: 26, cleanup_ms: 4, attempt_other_ms: 102,
    invocation_other_ms: 151
  });
  within(settled.elapsed_ms, INVOCATION_DISJOINT.map((key) => settled[key]), "invocation reconciliation");
  within(settled.distinct_attempt_ms, ["preparation_ms", "stage_work_ms", "cleanup_ms", "attempt_other_ms"]
    .map((key) => settled[key]), "attempt totals");

  const halves = controlledClock(0);
  const half = () => {
    const meter = startTestProofAttemptTiming({ clock: halves });
    meter.measure("stage_work", () => halves.advance(1.4));
    return meter.seal();
  };
  const pair = [half(), half()];
  assert.deepEqual(pair.map(({ stage_work_ms: ms }) => ms), [1, 1]);
  const pairInvocation = startTestProofInvocationTiming({ clock: controlledClock(0), now: () => new Date(0) });
  const pairTiming = pairInvocation.seal(bindTestProofExecutionTimings({}, pair));
  assert.equal(pairTiming.stage_work_ms, 3, "2.8 unrounded rounds to 3, not the rounded sum 2");

  const refusal = startTestProofInvocationTiming({ clock: controlledClock(0), now: () => new Date(0) });
  assert.deepEqual(refusal.seal(), { measurement: "server_verification", started_at: "1970-01-01T00:00:00.000Z",
    elapsed_ms: 0, measured_execution_count: null, unmeasured_execution_count: null, distinct_attempt_ms: null,
    preparation_ms: null, stage_work_ms: null, cleanup_ms: null, attempt_other_ms: null,
    invocation_other_ms: null });
});
