import test from "node:test";
import assert from "node:assert/strict";
import { createNativeUsageCapture } from "../../packages/agent-launch-core/src/lib/native-usage-capture.mjs";
import { agyUsage, agyInit, agyStep, agyResult, openCodeStep, jsonl } from "../fixtures/native-usage-step-clients.mjs";
const complete = value => ({ value, observed: value, status: "complete" });
const unavailable = { value: null, observed: null, status: "unavailable" };
function capture(family, events, { baseline = null, resumed = false, drained = true, exit = null } = {}) {
  const tap = createNativeUsageCapture({ family, identity: { invocation_id: "INV-fixture" }, resumed, baseline });
  const bytes = jsonl(events);

  for (let i = 0; i < bytes.length; i += 13) tap.push(bytes.subarray(i, i + 13));
  tap.end({ drained });
  const record = tap.settle({ exit });
  assert.equal(tap.settle({}), record);
  return record;
}
test("OpenCode counts unique finished steps, disjoint output, caches and native cost", () => {
  const a = openCodeStep(1, { reason: "tool-calls" }), b = openCodeStep(2);
  const record = capture("opencode", [a, a, b, b]);
  assert.equal(record.status, "complete");
  assert.deepEqual(record.tokens.input, complete(294));
  assert.deepEqual(record.tokens.output, complete(40));
  assert.deepEqual(record.tokens.reasoning_output, complete(10));
  assert.deepEqual(record.tokens.cache_creation, complete(14));
  assert.deepEqual(record.tokens.total, complete(334));
  assert.deepEqual(record.cost.amount, complete(0.25));
  assert.equal(record.cost.source, "opencode.step_finish.cost");

  const resumed = capture("opencode", [b], { resumed: true, baseline: record });
  assert.deepEqual(resumed.tokens.total, complete(167));
  assert.equal(resumed.resumed, true);
});
test("Agy cumulative results replace steps and repeated aggregates, then subtract the same-session baseline", () => {
  const record = capture("agy", [agyInit(), agyStep(1), agyStep(1), agyResult(), agyStep(1), agyResult(), agyResult(agyUsage(2))]);
  assert.equal(record.status, "complete");
  assert.deepEqual(record.tokens.input, complete(280));
  assert.deepEqual(record.tokens.output, complete(40));
  assert.deepEqual(record.tokens.reasoning_output, complete(10));
  assert.deepEqual(record.tokens.cache_creation, unavailable);
  assert.deepEqual(record.cost.amount, unavailable);
  const resumed = capture("agy", [agyInit(), agyStep(2), agyResult(agyUsage(3))], { resumed: true, baseline: record });
  assert.deepEqual(resumed.tokens.total, complete(160));
  const unknown = capture("agy", [agyInit(), agyResult(agyUsage(3))], { resumed: true });
  assert.equal(unknown.tokens.total.value, null);
  assert.ok(unknown.causes.some(cause => cause.code === "missing_baseline"));
});
test("Agy interrupted steps preserve a cumulative baseline without adding the next result twice", () => {
  const first = capture("agy", [agyInit(), agyResult()]);
  const failed = capture("agy", [agyInit(), agyStep(2), agyStep(2)], { resumed: true, baseline: first,
    exit: { code: null, signal: "SIGTERM" } });
  assert.equal(failed.status, "partial");
  assert.equal(failed.tokens.total.observed, 160);
  assert.equal(failed.end_snapshot.counters.input, 280);
  assert.equal(failed.exit.signal, "SIGTERM");
  const next = capture("agy", [agyInit(), agyResult(agyUsage(3))], { resumed: true, baseline: failed });
  assert.deepEqual(next.tokens.total, complete(160));
});
test("missing fields, errors, conflicting identities and damaged streams never produce complete zeros", () => {
  for (const family of ["agy", "opencode"]) {
    assert.deepEqual(capture(family, []).tokens.total, unavailable);
    const events = family === "agy" ? [agyInit(), agyResult({ output_tokens: 20 })]
      : [openCodeStep(1, { tokens: { output: 15 } })];
    const missing = capture(family, events);
    assert.equal(missing.tokens.input.value, null);
    assert.equal(missing.tokens.input.observed, null);
    assert.equal(missing.tokens.cache_read.value, null);
    const partial = capture(family, family === "agy" ? [agyInit(), agyStep(1)] : [openCodeStep(1)], { drained: false });
    assert.equal(partial.status, "partial");
    assert.equal(partial.tokens.total.value, null);
  }
  const missing = capture("agy", [agyInit(), agyStep(1), agyResult(null)]);
  const conflicting = capture("opencode", [openCodeStep(1), openCodeStep(1, { cost: 99 })]);
  assert.equal(conflicting.status, "partial");
  assert.ok(conflicting.causes.some(cause => cause.code === "event_extraction_failed"));
  const cancelled = capture("agy", [agyInit(), agyResult(agyUsage(), "CANCELED")]);
  assert.equal(cancelled.stream.error_event, true);
  assert.deepEqual(cancelled.tokens.total, complete(160));
  assert.equal(missing.tokens.total.observed, 160);
});

test("Agy observes new steps after a cumulative result and never counts replayed steps again", () => {
  const record = capture("agy", [agyInit(), agyStep(1), agyResult(), agyStep(1), agyStep(2), agyStep(2)]);
  assert.equal(record.status, "partial");
  assert.equal(record.tokens.total.observed, 320);
  const replaced = capture("agy", [agyInit(), agyStep(1), agyResult(), agyStep(2), agyResult(agyUsage(2))]);
  assert.deepEqual(replaced.tokens.total, complete(320));
});

test("foreign-session descendants never add usage and absent cost is never priced", () => {
  const openCode = capture("opencode", [openCodeStep(1), openCodeStep(2, { id: "ses_descendant" })]);
  assert.equal(openCode.tokens.total.observed, 167);
  assert.equal(openCode.tokens.total.value, null);
  const agy = capture("agy", [agyInit(), agyResult(), agyResult(agyUsage(100), "SUCCESS",
    "00000000-0000-0000-0000-000000000999")]);
  assert.equal(agy.tokens.total.observed, 160);
  assert.equal(agy.tokens.total.value, null);
  const event = openCodeStep(1);
  delete event.part.cost;
  assert.deepEqual(capture("opencode", [event]).cost.amount, unavailable);
});
