import test from "node:test";
import assert from "node:assert/strict";

import { createToolUsageAuditBoundaryRecorder } from "../../packages/wiki-mcp/src/lib/tool-usage-audit-mcp-tools.mjs";
import { validateAnonymousMetricRecord } from "../../packages/wiki-mcp/src/lib/tool-usage-audit/anonymous-metrics.mjs";

const SENTINEL = "ANON_HANDLER_PAYLOAD_SENTINEL_91ab";

function recordingWriter(events = []) {
  const records = [];
  const health = [];
  return {
    records,
    health,
    enqueue(record) {
      events.push("enqueue");
      records.push(record);
      return true;
    },
    countHealth(reason) {
      health.push(reason);
      return true;
    }
  };
}

function sequenceClock(values, events = []) {
  let index = 0;
  return () => {
    events.push("clock");
    const value = values[index];
    index += 1;
    return value;
  };
}

async function observeOnce(boundaryOptions, toolName, handler, args = {}) {
  const writer = recordingWriter();
  const boundary = createToolUsageAuditBoundaryRecorder({ writer, ...boundaryOptions });
  const result = await boundary.wrapHandler(toolName, handler)(args, undefined);
  return { writer, result };
}

test("anonymous observation preserves handler identity and truthful timing", async () => {

  const events = [];
  const writer = recordingWriter(events);
  const boundary = createToolUsageAuditBoundaryRecorder({
    writer,
    monotonicNs: sequenceClock([10_000n, 1_010_999n], events),
    now: () => new Date("2026-09-15T08:59:59.999Z")
  });
  const args = { prompt: SENTINEL, nested: { path: `/home/user/${SENTINEL}` } };
  const extra = { signal: new AbortController().signal, sessionId: SENTINEL, requestId: 7 };
  const result = { content: [{ type: "text", text: SENTINEL }] };
  let calls = 0;
  const wrapped = boundary.wrapHandler("workspace_read_page", async (receivedArgs, receivedExtra) => {
    calls += 1;
    events.push("handler");
    assert.equal(receivedArgs, args);
    assert.equal(receivedExtra, extra);
    return result;
  });
  assert.equal(await wrapped(args, extra), result);
  assert.equal(calls, 1);

  assert.deepEqual(events, ["clock", "handler", "clock", "enqueue", "enqueue"]);
  assert.equal(writer.records.length, 2);
  const [metric, trajectory] = writer.records;
  assert.equal(validateAnonymousMetricRecord(trajectory), true);
  assert.equal(trajectory.kind, "trajectory");
  assert.equal(trajectory.tool, "workspace_read_page");

  assert.equal(trajectory.correlation, "none");
  assert.equal(trajectory.trajectory, "unobserved");
  assert.equal(validateAnonymousMetricRecord(metric), true);
  assert.equal(metric.tool, "workspace_read_page");
  assert.equal(metric.elapsed_us, 1000);
  assert.equal(metric.duration_status, "measured");
  assert.equal(metric.hour_utc, "2026-09-15T08:00:00.000Z");
  assert.equal(metric.outcome, "returned");
  assert.equal(metric.request_json_bytes, Buffer.byteLength(JSON.stringify(args), "utf8"));
  assert.equal(metric.response_json_bytes, Buffer.byteLength(JSON.stringify(result), "utf8"));
  assert.equal(JSON.stringify(writer.records).includes(SENTINEL), false);
  assert.equal(JSON.stringify(writer.records).includes("/home/user"), false);

  for (const thrown of [new Error(SENTINEL), SENTINEL, Symbol(SENTINEL), undefined, { code: SENTINEL }]) {
    const throwWriter = recordingWriter();
    const throwing = createToolUsageAuditBoundaryRecorder({
      writer: throwWriter,
      monotonicNs: sequenceClock([5n, 5n])
    });
    let invocations = 0;
    const handler = throwing.wrapHandler("workspace_search_repo", () => {
      invocations += 1;
      throw thrown;
    });
    await assert.rejects(handler({ query: SENTINEL }, undefined), (error) => {
      assert.equal(error, thrown);
      return true;
    });
    assert.equal(invocations, 1);
    const [threw] = throwWriter.records;
    assert.equal(threw.outcome, "threw");
    assert.equal(threw.response_status, "not_returned");
    assert.equal(threw.response_json_bytes, null);
    assert.equal(threw.elapsed_us, 0, "a measured zero duration stays zero");
    assert.equal(JSON.stringify(throwWriter.records).includes(SENTINEL), false);
  }

  const failingWriter = {
    enqueue() { throw new Error(SENTINEL); },
    countHealth() { throw new Error(SENTINEL); }
  };
  const failing = createToolUsageAuditBoundaryRecorder({ writer: failingWriter });
  let returnedCalls = 0;
  const returnedValue = { ok: true };
  assert.equal(
    await failing.wrapHandler("workspace_read_page", async () => { returnedCalls += 1; return returnedValue; })({}),
    returnedValue
  );
  assert.equal(returnedCalls, 1);
  let thrownCalls = 0;
  const domainFailure = { reason: "domain" };
  await assert.rejects(
    failing.wrapHandler("workspace_get_record", async () => { thrownCalls += 1; throw domainFailure; })({}),
    (error) => error === domainFailure
  );
  assert.equal(thrownCalls, 1);

  const noClocks = await observeOnce({
    monotonicNs: () => { throw new Error("no monotonic clock"); },
    now: () => { throw new Error("no wall clock"); }
  }, "workspace_read_page", async () => 1);
  assert.equal(noClocks.writer.records[0].elapsed_us, null);
  assert.equal(noClocks.writer.records[0].duration_status, "clock_unavailable");
  assert.equal(noClocks.writer.records[0].hour_utc, null);
  assert.equal(noClocks.writer.records[0].clock_status, "clock_unavailable");
  const backwards = await observeOnce({ monotonicNs: sequenceClock([10n, 9n]) }, "workspace_read_page", async () => 1);
  assert.equal(backwards.writer.records[0].duration_status, "invalid_duration");
  const numeric = await observeOnce({ monotonicNs: () => 5 }, "workspace_read_page", async () => 1);
  assert.equal(numeric.writer.records[0].duration_status, "clock_unavailable");

  let hookRuns = 0;
  const outcomes = [];
  for (const candidate of [
    { isError: true, content: [] },
    { get isError() { hookRuns += 1; return true; } },
    new Proxy({ isError: true }, {
      get(target, key, receiver) {
        if (key !== "then") hookRuns += 1;
        return Reflect.get(target, key, receiver);
      },
      getOwnPropertyDescriptor(target, key) { hookRuns += 1; return Reflect.getOwnPropertyDescriptor(target, key); },
      ownKeys(target) { hookRuns += 1; return Reflect.ownKeys(target); },
      getPrototypeOf(target) { hookRuns += 1; return Reflect.getPrototypeOf(target); }
    }),
    Object.create({ isError: true }),
    { isError: "true" }
  ]) {
    const observed = await observeOnce({}, "workspace_read_page", async () => candidate);
    assert.equal(observed.result, candidate);
    outcomes.push(observed.writer.records[0].outcome);
  }
  assert.deepEqual(outcomes, ["returned_error", "returned", "returned", "returned", "returned"]);
  assert.equal(hookRuns, 0, "no getter or proxy trap ran while classifying the outcome");

  const unregisteredWriter = recordingWriter();
  const unregistered = createToolUsageAuditBoundaryRecorder({ writer: unregisteredWriter });
  const direct = await unregistered.observeToolCall({
    toolName: "arbitrary_caller_named_tool",
    args: {},
    handler: async () => "value"
  });
  assert.equal(direct, "value");
  assert.deepEqual(unregisteredWriter.records, []);
  assert.deepEqual(unregisteredWriter.health, ["invalid_record"]);

  let passthroughHooks = 0;
  const passArgs = { get probe() { passthroughHooks += 1; return 1; } };
  const disabled = createToolUsageAuditBoundaryRecorder();
  let receivedExtra = null;
  const passResult = await disabled.wrapHandler("workspace_read_page", async (received, contextArg) => {
    receivedExtra = contextArg;
    return received;
  })(passArgs, extra);
  assert.equal(passResult, passArgs);
  assert.equal(receivedExtra, extra);
  assert.equal(passthroughHooks, 0);
  await assert.rejects(disabled.observeToolCall({ toolName: "workspace_read_page", handler: null }), /must be a function/u);
});
