import test from "node:test";
import assert from "node:assert/strict";

import {
  ANONYMOUS_METRICS_SCHEMA_VERSION,
  CALL_RECORD_FIELDS,
  HEALTH_RECORD_FIELDS,
  METRIC_HEALTH_REASONS,
  buildAnonymousMetric,
  buildHealthRecord,
  encodeAnonymousMetricLine,
  projectElapsedMicros,
  projectHourBucket,
  validateAnonymousMetricRecord
} from "../../packages/wiki-mcp/src/lib/tool-usage-audit/anonymous-metrics.mjs";
import {
  JSON_BYTE_MEASUREMENT_LIMITS,
  measureJsonBytes
} from "../../packages/wiki-mcp/src/lib/tool-usage-audit/json-byte-measurement.mjs";

const SENTINEL = "ANON_METRIC_PAYLOAD_SENTINEL_7f3c";
const TOOL = "workspace_read_page";

function callInput(overrides = {}) {
  return {
    tool: TOOL,
    registeredToolNames: new Set([TOOL]),
    hour: projectHourBucket(new Date("2026-09-15T13:47:12.345Z")),
    outcome: "returned",
    elapsed: projectElapsedMicros(1_000n, 5_001_999n),
    request: measureJsonBytes({ path: SENTINEL }),
    response: measureJsonBytes({ content: [{ type: "text", text: SENTINEL }] }),
    ...overrides
  };
}

const jsonBytes = (value) => Buffer.byteLength(JSON.stringify(value), "utf8");

test("anonymous metrics contain only allowed nonidentifying fields", () => {

  const record = buildAnonymousMetric({
    ...callInput({
      request: { ...measureJsonBytes({ q: SENTINEL }), payload: SENTINEL, session_id: SENTINEL }
    }),
    args: { secret: SENTINEL },
    extra: { sessionId: SENTINEL, requestId: SENTINEL },
    error: new Error(SENTINEL),
    repository: SENTINEL
  });
  assert.ok(record);
  assert.equal(Object.isFrozen(record), true);
  assert.deepEqual(Object.keys(record), [...CALL_RECORD_FIELDS]);
  assert.deepEqual(record, {
    schema_version: ANONYMOUS_METRICS_SCHEMA_VERSION,
    kind: "call",
    hour_utc: "2026-09-15T13:00:00.000Z",
    clock_status: "measured",
    tool: TOOL,
    outcome: "returned",
    elapsed_us: 5000,
    duration_status: "measured",
    request_json_bytes: jsonBytes({ q: SENTINEL }),
    request_status: "measured",
    response_json_bytes: jsonBytes({ content: [{ type: "text", text: SENTINEL }] }),
    response_status: "measured",
    input_tokens: null,
    output_tokens: null,
    token_status: "not_instrumented",
    representation: "handler_compact_json"
  });
  const line = encodeAnonymousMetricLine(record);
  assert.equal(line.endsWith("\n"), true);
  assert.equal(line.includes(SENTINEL), false);

  assert.equal(validateAnonymousMetricRecord({ ...record, session_id: "s-1" }), false);
  assert.equal(encodeAnonymousMetricLine({ ...record, message: SENTINEL }), null);
  const { tool: _tool, ...missingTool } = record;
  assert.equal(validateAnonymousMetricRecord(missingTool), false);
  assert.equal(validateAnonymousMetricRecord(Object.fromEntries(Object.entries(record).reverse())), false);
  assert.equal(validateAnonymousMetricRecord({ ...record, elapsed_us: "5000" }), false);
  assert.equal(validateAnonymousMetricRecord({ ...record, input_tokens: 12 }), false);
  assert.equal(validateAnonymousMetricRecord({ ...record, token_status: "estimated" }), false);
  assert.equal(validateAnonymousMetricRecord({ ...record, hour_utc: "2026-09-15T13:47:12.345Z" }), false);
  assert.equal(validateAnonymousMetricRecord({ ...record, tool: SENTINEL }), false);

  assert.equal(buildAnonymousMetric(callInput({ tool: "workspace_not_registered" })), null);
  assert.equal(buildAnonymousMetric(callInput({
    tool: "/home/user/repo",
    registeredToolNames: new Set(["/home/user/repo"])
  })), null);

  const zero = buildAnonymousMetric(callInput({ elapsed: projectElapsedMicros(7n, 7n) }));
  assert.equal(zero.elapsed_us, 0);
  assert.equal(zero.duration_status, "measured");
  assert.deepEqual(projectElapsedMicros(9n, 7n), { elapsed_us: null, duration_status: "invalid_duration" });
  assert.deepEqual(projectElapsedMicros(null, 7n), { elapsed_us: null, duration_status: "clock_unavailable" });
  assert.deepEqual(projectElapsedMicros(5, 7), { elapsed_us: null, duration_status: "clock_unavailable" });
  assert.deepEqual(
    projectElapsedMicros(0n, (BigInt(Number.MAX_SAFE_INTEGER) + 1n) * 1000n),
    { elapsed_us: null, duration_status: "invalid_duration" }
  );
  assert.deepEqual(projectHourBucket(new Date(Number.NaN)), { hour_utc: null, clock_status: "clock_unavailable" });
  assert.deepEqual(projectHourBucket("2026-09-15"), { hour_utc: null, clock_status: "clock_unavailable" });
  assert.deepEqual(projectHourBucket(null), { hour_utc: null, clock_status: "clock_unavailable" });
  const unmeasured = buildAnonymousMetric(callInput({ request: measureJsonBytes(undefined) }));
  assert.equal(unmeasured.request_json_bytes, null);
  assert.equal(unmeasured.request_status, "unsafe_value");
  assert.equal(buildAnonymousMetric(callInput({ request: { status: "measured", bytes: null } })), null);
  assert.equal(buildAnonymousMetric(callInput({ request: { status: "unsafe_value", bytes: 0 } })), null);

  assert.equal(buildAnonymousMetric(callInput({ outcome: "failed" })), null);
  assert.equal(buildAnonymousMetric(callInput({ outcome: "threw" })), null);
  const threw = buildAnonymousMetric(callInput({
    outcome: "threw",
    response: { status: "not_returned", bytes: null }
  }));
  assert.equal(threw.response_status, "not_returned");
  assert.equal(threw.response_json_bytes, null);

  const hour = projectHourBucket(new Date("2026-09-15T13:47:12.345Z"));
  for (const reason of METRIC_HEALTH_REASONS) {
    const health = buildHealthRecord({ hour, reason, count: 3 });
    assert.deepEqual(Object.keys(health), [...HEALTH_RECORD_FIELDS]);
    assert.equal(health.reason, reason);
  }
  assert.equal(buildHealthRecord({ hour, reason: `write failed: ${SENTINEL}`, count: 1 }), null);
  assert.equal(buildHealthRecord({ hour, reason: "queue_full", count: 0 }), null);
  assert.equal(buildHealthRecord({ hour, reason: "queue_full", count: 1.5 }), null);
  assert.equal(
    validateAnonymousMetricRecord({ ...buildHealthRecord({ hour, reason: "file_failed", count: 1 }), message: SENTINEL }),
    false
  );
});

test("anonymous metric byte counting is exact bounded and inert", () => {
  const shared = { reused: [1, 2] };
  const hidden = { visible: 1 };
  Object.defineProperty(hidden, "hidden", { value: SENTINEL, enumerable: false });
  const fixtures = [
    null, true, false, 0, -0, 1.5, -12e-7, 1e21, 123456789,
    "", "plain", "quote\" back\\slash", "\u0000\u0001\b\t\n\f\r\u001f\u007f",
    "é", "€", "😀", "\ud800", "a\udc00b", "\u2028\u2029",
    [], {}, [1, "two", { three: [null, false] }],
    { nested: { deep: ["ü", { k: "v" }] }, "": 0 },
    Object.assign(Object.create(null), { nullPrototype: "ok" }),
    { "key\"with\nescapes": "value" },
    { a: shared, b: shared },
    hidden
  ];
  for (const value of fixtures) {
    assert.deepEqual(
      measureJsonBytes(value),
      { status: "measured", bytes: jsonBytes(value) },
      `exact compact JSON bytes for ${JSON.stringify(value)}`
    );
  }

  let hooks = 0;
  const countingHandler = Object.fromEntries(
    ["get", "getOwnPropertyDescriptor", "ownKeys", "getPrototypeOf", "has"].map((trap) => [
      trap,
      (...args) => {
        hooks += 1;
        return Reflect[trap](...args);
      }
    ])
  );
  class Custom {
    constructor() {
      this.a = 1;
    }
  }
  const cyclic = { a: 1 };
  cyclic.self = cyclic;
  const arrayGetter = [1];
  Object.defineProperty(arrayGetter, "0", { get() { hooks += 1; return 1; }, enumerable: true });
  const unsafeValues = [
    undefined, () => 1, Symbol("s"), 10n, Number.NaN, Number.POSITIVE_INFINITY,
    { get value() { hooks += 1; return 1; } },
    { toJSON() { hooks += 1; return 1; } },
    new Proxy({ a: 1 }, countingHandler),
    new Proxy([1, 2], countingHandler),
    { inner: new Proxy({}, countingHandler) },
    new Custom(), new Date(0), Buffer.from("x"), new Map(),
    cyclic, [1, , 3], arrayGetter, { [Symbol("key")]: 1 },
    { nested: { bad: undefined } }, [() => 1]
  ];
  for (const value of unsafeValues) {
    assert.deepEqual(measureJsonBytes(value), { status: "unsafe_value", bytes: null });
  }
  assert.equal(hooks, 0, "no getter, proxy trap, or toJSON hook ran");

  assert.deepEqual(JSON_BYTE_MEASUREMENT_LIMITS, { maxDepth: 32, maxValues: 4096, maxStringUnits: 262144 });
  const nest = (depth) => {
    let value = [];
    for (let level = 1; level < depth; level += 1) value = [value];
    return value;
  };
  assert.deepEqual(measureJsonBytes(nest(32)), { status: "measured", bytes: jsonBytes(nest(32)) });
  assert.deepEqual(measureJsonBytes(nest(33)), { status: "budget_exceeded", bytes: null });
  const withinValues = new Array(4095).fill(0);
  assert.deepEqual(measureJsonBytes(withinValues), { status: "measured", bytes: jsonBytes(withinValues) });
  assert.deepEqual(measureJsonBytes(new Array(4096).fill(0)), { status: "budget_exceeded", bytes: null });
  const withinUnits = "x".repeat(262144);
  assert.deepEqual(measureJsonBytes(withinUnits), { status: "measured", bytes: 262146 });
  assert.deepEqual(measureJsonBytes("x".repeat(262145)), { status: "budget_exceeded", bytes: null });
  assert.deepEqual(measureJsonBytes({ ["k".repeat(262140)]: "abcde" }), { status: "budget_exceeded", bytes: null });

  assert.deepEqual(Object.keys(measureJsonBytes({ secret: SENTINEL })), ["status", "bytes"]);
});
