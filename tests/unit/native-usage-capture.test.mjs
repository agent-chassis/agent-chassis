import assert from "node:assert/strict";
import test from "node:test";

import { NATIVE_USAGE_ADAPTERS, NATIVE_USAGE_FAMILIES } from "../../packages/agent-launch-core/src/lib/native-usage-adapters.mjs";
import {
  AGENT_RUN_USAGE_RECORD_SCHEMA_VERSION,
  createNativeUsageCapture
} from "../../packages/agent-launch-core/src/lib/native-usage-capture.mjs";
import {
  aggregateRunUsage,
  selectSessionBaseline
} from "../../packages/agent-launch-core/src/lib/native-usage-records.mjs";

const SENTINEL = "SENTINEL_CONVERSATION_TEXT";
const SESSION = "11111111-2222-4333-8444-555555555555";
const OTHER_SESSION = "99999999-2222-4333-8444-555555555555";
const SOURCE = "claude.stream_json.result_model_usage";
const complete = (value) => ({ value, observed: value, status: "complete" });
const partial = (observed) => ({ value: null, observed, status: "partial" });
const UNAVAILABLE = { value: null, observed: null, status: "unavailable" };
const jsonl = (...events) => Buffer.from(events.map((event) => `${JSON.stringify(event)}\n`).join(""), "utf8");
const codes = (record) => record.causes.map((cause) => cause.code);
let tick = 0;
const now = () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick += 1));

const init = (session) => ({ type: "system", subtype: "init", session_id: session, claude_code_version: "2.1.296" });
const assistant = (session, id, usage) => ({ type: "assistant", session_id: session, parent_tool_use_id: null,
  message: { id, role: "assistant", content: [{ type: "text", text: SENTINEL }], ...(usage ? { usage } : {}) } });
const result = (session, models, cost, fields = {}) => ({ type: "result", subtype: "success", is_error: false,
  session_id: session, result: SENTINEL, total_cost_usd: cost,
  usage: { input_tokens: 1, cache_creation_input_tokens: 1, cache_read_input_tokens: 1, output_tokens: 1 },
  modelUsage: Object.fromEntries(models.map(([key, input, read, creation, output]) => [key, { inputTokens: input,
    cacheReadInputTokens: read, cacheCreationInputTokens: creation, outputTokens: output, costUSD: cost }])), ...fields });
const REQUEST = { input_tokens: 1201, cache_creation_input_tokens: 307, cache_read_input_tokens: 4099, output_tokens: 3 };

const stream = (session, input, read, creation, output, cost = 0.5) =>
  [init(session), assistant(session, `msg-${input}`, REQUEST), result(session, [["model-a", input, read, creation, output]], cost)];

function capture(events, { resumed = false, baseline = null, drained = true, invocation = "inv-1", settle = {}, chunkBytes = null } = {}) {
  const texts = [];
  const instance = createNativeUsageCapture({ family: "claude", resumed, baseline, now, onText: (text) => texts.push(text),
    identity: { invocation_id: invocation, attempt_id: "attempt-1", run_id: "run-1", role: "worker", route: "test", mode: "headless" } });
  const bytes = Buffer.isBuffer(events) ? events : jsonl(...events);
  for (let at = 0; at < bytes.length; at += chunkBytes ?? bytes.length) instance.push(bytes.subarray(at, at + (chunkBytes ?? bytes.length)));
  instance.end({ drained });
  return { record: instance.settle(settle), text: texts.join(""), instance };
}

test("native usage adapters select machine-readable output without losing the invocation", () => {
  assert.deepEqual(NATIVE_USAGE_FAMILIES, ["opencode", "agy", "claude"], "Codex usage comes from its session record, not a stream adapter");
  const { claude } = NATIVE_USAGE_ADAPTERS;
  assert.deepEqual(claude.outputArgs(["--print", "--output-format", "text", "--no-session-persistence", "--json-schema", "{}"]),
    ["--print", "--output-format", "stream-json", "--verbose", "--no-session-persistence", "--json-schema", "{}"]);
  assert.deepEqual(claude.outputArgs(["--model", "m", "--print", "--settings", "/s"]),
    ["--model", "m", "--print", "--output-format", "stream-json", "--verbose", "--settings", "/s"]);
  assert.deepEqual(claude.outputArgs(["-p", "prompt", "--verbose"]), ["-p", "--output-format", "stream-json", "--verbose", "prompt"]);
  assert.equal(claude.outputArgs(["--model", "m"]), null, "an interactive Claude argv has no headless output mode");

  assert.deepEqual(claude.outputArgs(["--print", "--output-format=text", "--model", "m"]),
    ["--print", "--output-format", "stream-json", "--verbose", "--model", "m"]);

  for (const selected of [["--output-format", "json"], ["--output-format=json"], ["--output-format", "stream-json"],
    ["--output-format=stream-json"], ["--output-format"], ["--output-format="]]) {
    assert.equal(claude.outputArgs(["--print", ...selected]), null, selected.join(" "));
    assert.equal(claude.outputArgs([...selected, "-p", "prompt"]), null, selected.join(" "));
  }

  assert.equal(claude.outputArgs(["--print", "--output-format", "text", "--output-format=text"]), null);
  assert.equal(claude.outputArgs(["--print", "--output-format=json", "--output-format", "text"]), null);

  assert.deepEqual([claude.source.id, claude.source.input_semantics, claude.source.counter_kind, claude.source.descendant_coverage],
    [SOURCE, "exclusive", "cumulative", "inclusive"]);
});

test("native usage capture records the reported usage once", () => {
  const first = capture([init(SESSION), assistant(SESSION, "msg_0", REQUEST), assistant(SESSION, "msg_0", REQUEST),
    result(SESSION, [["model-a", 1201, 4099, 307, 61]], 0.5)], { chunkBytes: 7 });
  const { record } = first;
  assert.equal(record.schema_version, AGENT_RUN_USAGE_RECORD_SCHEMA_VERSION);
  assert.deepEqual([record.status, record.family, record.client_version, record.native_session_id, record.invocation_id,
    record.attempt_id, record.resumed], ["complete", "claude", "2.1.296", SESSION, "inv-1", "attempt-1", false]);

  assert.deepEqual(record.tokens, { input: complete(5607), cache_read: complete(4099), cache_creation: complete(307),
    output: complete(61), reasoning_output: UNAVAILABLE, total: complete(5668) });
  assert.deepEqual(record.cost, { amount: complete(0.5), currency: "USD", source: "claude.result.total_cost_usd", kind: "native_estimate" });
  assert.deepEqual(record.source, { id: SOURCE, input_semantics: "exclusive", counter_kind: "cumulative",
    descendant_coverage: "inclusive", usage_presence: "present" });
  assert.deepEqual(record.stream, { complete: true, records: 4, diagnostics: 0, drained: true, terminal_event: true, error_event: false });
  assert.deepEqual(record.peak_context, partial(5607), "one request's input, and never called complete");
  assert.equal(first.text, `${SENTINEL}\n`, "the final result text is what text mode prints");
  assert.equal(first.instance.finalText(), SENTINEL);

  const models = capture([init(SESSION), assistant(SESSION, "m", REQUEST),
    result(SESSION, [["model-a", 100, 10, 1, 7], ["model-b", 200, 20, 2, 9]], 0.25)]);
  assert.deepEqual([models.record.tokens.input, models.record.tokens.output, models.record.tokens.total],
    [complete(333), complete(16), complete(349)]);

  assert.equal(first.instance.settle({ exit: { code: 1, signal: null } }), record);
  for (const each of [first, models]) assert.equal(JSON.stringify(each.record).includes(SENTINEL), false);
});

test("native usage capture reconciles resumed sessions against a bound baseline", () => {
  const first = capture(stream(SESSION, 3000, 30, 300, 30, 0.25), { invocation: "inv-1" });
  assert.equal(first.record.end_snapshot.sequence, 1);

  const resumedStream = stream(SESSION, 9000, 60, 600, 90, 0.75);
  const second = capture(resumedStream, { invocation: "inv-2", resumed: true, baseline: first.record });
  assert.deepEqual([second.record.status, second.record.tokens.input, second.record.tokens.output, second.record.tokens.total,
    second.record.cost.amount], ["complete", complete(6330), complete(60), complete(6390), complete(0.5)]);
  assert.notDeepEqual(second.record.end_snapshot.counters, first.record.end_snapshot.counters);

  for (const [options, code] of [
    [{ resumed: true, baseline: null }, "missing_baseline"],
    [{ resumed: null, baseline: first.record }, "missing_baseline"],
    [{ resumed: true, baseline: { ...first.record, native_session_id: OTHER_SESSION } }, "baseline_not_bound_to_session"],
    [{ resumed: true, baseline: { ...first.record, family: "other" } }, "baseline_not_bound_to_session"],
    [{ resumed: true, baseline: { ...first.record, end_snapshot: null } }, "baseline_not_bound_to_session"]
  ]) {
    const unbound = capture(resumedStream, { invocation: "inv-2", ...options });
    assert.equal(unbound.record.status, "unavailable", code);
    assert.deepEqual(unbound.record.tokens.total, UNAVAILABLE, "the session's lifetime total is never charged to one launch");
    assert.ok(codes(unbound.record).includes(code), code);
    assert.deepEqual(unbound.record.end_snapshot, second.record.end_snapshot, "the session's own report is still retained");
  }

  const repeated = capture([init(SESSION), assistant(SESSION, "a", REQUEST),
    result(SESSION, [["model-a", 30000, 150, 1500, 300]], 0.125), result(SESSION, [["model-a", 50000, 200, 2000, 500]], 0.25)]);
  assert.deepEqual([repeated.record.tokens.input, repeated.record.tokens.output], [complete(52200), complete(500)]);

  const records = [first.record, second.record, { ...second.record, native_session_id: OTHER_SESSION }];
  const binding = { family: "claude", native_session_id: SESSION, source_id: SOURCE };
  assert.equal(selectSessionBaseline(records, binding), second.record, "the same session's latest settled record");
  assert.equal(selectSessionBaseline(records, { ...binding, native_session_id: "none" }), null);
  assert.equal(selectSessionBaseline([first.record, { ...first.record, end_snapshot: { ...first.record.end_snapshot,
    counters: { ...first.record.end_snapshot.counters, input: 1 } } }], binding), null, "an ambiguous baseline is no baseline");
});

test("native usage capture keeps zero, missing and damaged evidence apart", () => {

  const absent = capture([init(SESSION), assistant(SESSION, "a", null), result(SESSION, [["model-a", 0, 0, 0, 0]], 0)]);
  assert.deepEqual([absent.record.status, absent.record.source.usage_presence, absent.record.tokens.total.value,
    absent.record.cost.amount.value], ["partial", "absent", null, null]);
  assert.ok(codes(absent.record).includes("source_usage_absent"));
  const zero = capture([init(SESSION),
    assistant(SESSION, "a", { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 }),
    result(SESSION, [["model-a", 0, 0, 0, 0]], 0)]);
  assert.deepEqual([zero.record.status, zero.record.tokens.total, zero.record.cost.amount], ["complete", complete(0), complete(0)]);

  const interrupted = capture([init(SESSION), assistant(SESSION, "a", REQUEST)], { drained: false });
  assert.deepEqual([interrupted.record.status, interrupted.record.native_session_id], ["unavailable", SESSION]);
  assert.ok(codes(interrupted.record).includes("terminal_usage_missing") && codes(interrupted.record).includes("stream_incomplete"));
  assert.equal(interrupted.text, "", "no final text is invented for a result that never arrived");
  const nothing = capture(Buffer.alloc(0));
  assert.deepEqual([nothing.record.status, nothing.record.native_session_id, nothing.record.end_snapshot], ["unavailable", null, null]);
  assert.ok(codes(nothing.record).includes("missing_identity"));

  const good = jsonl(...stream(SESSION, 10, 1, 2, 3));
  for (const [bytes, drained] of [
    [Buffer.concat([Buffer.from(`{not json ${SENTINEL}\n`), good]), true],
    [Buffer.concat([good, Buffer.from(`{"type":"assistant","message":{"text":"${SENTINEL}`)]), true],
    [Buffer.concat([Buffer.alloc(1048577, 0x78), Buffer.from("\n"), good]), true],
    [good, false]
  ]) {
    const damaged = capture(bytes, { drained });
    assert.deepEqual([damaged.record.status, damaged.record.tokens.total, damaged.record.end_snapshot], ["partial", partial(16), null]);
    assert.ok(codes(damaged.record).includes("stream_incomplete"));
    assert.equal(JSON.stringify(damaged.record).includes(SENTINEL), false);
    assert.equal(damaged.text, `${SENTINEL}\n`, "the readable projection of the intact events is unaffected");
  }

  for (const model of [["m", -1, 0, 0, 2], ["m", "10", 0, 0, 2], ["m", 10, 0, 0, 1.5], ["m", 10, null, 0, 2]]) {
    const invalid = capture([init(SESSION), assistant(SESSION, "a", REQUEST), result(SESSION, [model], 0.5)]);
    assert.notEqual(invalid.record.status, "complete");
    assert.equal(invalid.record.tokens.total.value, null);
  }

  const mixed = capture([...stream(SESSION, 10, 1, 2, 3), init(OTHER_SESSION)]);
  assert.deepEqual([mixed.record.status, codes(mixed.record).includes("native_session_changed")], ["partial", true]);
});

test("native usage capture refuses invalid launcher inputs and survives its sink", () => {
  const identity = { invocation_id: "inv-1" };
  for (const [options, code] of [
    [{ family: "other", identity, resumed: false }, "native_usage_capture_unknown_family"],
    [{ family: "codex", identity, resumed: false }, "native_usage_capture_unknown_family"],
    [{ family: "constructor", identity, resumed: false }, "native_usage_capture_unknown_family"],
    [{ family: "claude", identity, resumed: "no" }, "native_usage_capture_invalid_resumed"],
    [{ family: "claude", identity, resumed: false, onText: SENTINEL }, "native_usage_capture_invalid_on_text"],
    [{ family: "claude", identity: null, resumed: false }, "native_usage_capture_invalid_identity"],
    [{ family: "claude", identity: {}, resumed: false }, "native_usage_capture_invalid_identity"],
    [{ family: "claude", identity: { invocation_id: `../${SENTINEL}` }, resumed: false }, "native_usage_capture_invalid_identity"],
    [{ family: "claude", identity: { invocation_id: "inv-1", role: 5 }, resumed: false }, "native_usage_capture_invalid_identity"]
  ]) {
    assert.throws(() => createNativeUsageCapture(options), (error) => error instanceof TypeError && error.code === code
      && !error.message.includes(SENTINEL));
  }

  const failure = new Error("sink closed");
  const instance = createNativeUsageCapture({ family: "claude", identity, resumed: false, onText: () => { throw failure; } });
  instance.push(jsonl(...stream(SESSION, 10, 1, 2, 3)));
  assert.throws(() => instance.end({ drained: true }), (error) => error === failure);
  const record = instance.settle({ exit: { code: 0, signal: null } });
  assert.deepEqual([record.status, record.tokens.total, record.exit], ["complete", complete(16), { code: 0, signal: null }]);
  assert.ok(codes(record).includes("text_sink_failed"));

  const silent = createNativeUsageCapture({ family: "claude", identity, resumed: false });
  silent.push(stream(SESSION, 10, 1, 2, 3).map((event) => `${JSON.stringify(event)}\n`).join(""));
  assert.equal(silent.settle().status, "partial", "a stream never reported drained is not complete");
});

test("native usage task totals cover every expected contributor exactly once", () => {
  const record = (invocation, session, input, output, cost, options = {}) =>
    capture(stream(session, input, 0, 0, output, cost), { invocation, ...options }).record;
  const orchestrator = record("inv-orch", SESSION, 1000, 50, 0.5);
  const worker = record("inv-worker", OTHER_SESSION, 2000, 70, 0.25);
  const retry = record("inv-retry", "77777777-2222-4333-8444-555555555555", 300, 9, 0.125);
  const launched = (invocation_id) => ({ invocation_id, outcome: "launched" });
  const contributors = [launched("inv-orch"), launched("inv-worker"), launched("inv-retry"),
    { invocation_id: "inv-refused", outcome: "not_spawned" }];

  const task = aggregateRunUsage({ contributors, records: [orchestrator, worker, retry, worker] });
  assert.deepEqual([task.schema_version, task.status], ["agent-run-usage-task.v1", "complete"]);
  assert.deepEqual(task.coverage, { expected: 3, complete: 3, partial: 0, unavailable: 0, not_spawned: 1, unknown_outcome: 0 });

  assert.deepEqual([task.tokens.input, task.tokens.output, task.tokens.total, task.cost.amount],
    [complete(3300), complete(129), complete(3429), complete(0.875)]);
  assert.deepEqual(task.causes, []);

  const partialRecord = record("inv-retry", SESSION, 300, 9, 0.125, { drained: false });
  for (const [input, coverage, code, observed] of [
    [{ contributors, records: [orchestrator, worker] },
      { expected: 3, complete: 2, partial: 0, unavailable: 1, not_spawned: 1, unknown_outcome: 0 }, "contributor_record_missing", 3000],
    [{ contributors, records: [orchestrator, worker, partialRecord] },
      { expected: 3, complete: 2, partial: 1, unavailable: 0, not_spawned: 1, unknown_outcome: 0 }, null, 3300],
    [{ contributors: [launched("inv-orch"), { invocation_id: "inv-worker", outcome: "unknown" }], records: [orchestrator, worker] },
      { expected: 2, complete: 2, partial: 0, unavailable: 0, not_spawned: 0, unknown_outcome: 1 }, "contributor_outcome_unknown", 3000],
    [{ contributors: [launched("inv-orch"), launched("inv-worker")], records: [orchestrator, worker, { ...worker, tokens: orchestrator.tokens }] },
      { expected: 2, complete: 1, partial: 0, unavailable: 1, not_spawned: 0, unknown_outcome: 0 }, "conflicting_invocation_records", 1000]
  ]) {
    const total = aggregateRunUsage(input);
    assert.deepEqual(total.coverage, coverage);
    assert.deepEqual([total.status, total.tokens.input], ["partial", partial(observed)]);
    if (code !== null) assert.ok(total.causes.some((cause) => cause.code === code), code);
  }

  const unlisted = aggregateRunUsage({ contributors: [launched("inv-orch")], records: [orchestrator, worker] });
  assert.deepEqual([unlisted.status, unlisted.tokens.input], ["complete", complete(1000)]);
  const none = aggregateRunUsage({ contributors: [], records: [orchestrator] });
  assert.deepEqual([none.status, none.tokens.total, none.coverage.expected], ["unavailable", UNAVAILABLE, 0]);
});
