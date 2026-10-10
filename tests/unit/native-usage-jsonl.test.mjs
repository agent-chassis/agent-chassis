import assert from "node:assert/strict";
import test from "node:test";

import {
  NATIVE_USAGE_JSONL_MAX_LINE_BYTES,
  createNativeUsageJsonlDecoder
} from "../../packages/agent-launch-core/src/lib/native-usage-jsonl.mjs";

const MAX = 1048576;
const SENTINEL = "SENTINEL_SOURCE_TEXT";
const bytes = (text) => Buffer.from(text, "utf8");
const filled = (length, byte = 0x78) => Buffer.alloc(length, byte);
const open = (fields = {}) =>
  ({ state: "open", complete: null, records: 0, diagnostics: 0, pendingBytes: 0, discarding: false, ...fields });
const settled = (state, complete, records, diagnostics) =>
  ({ state, complete, records, diagnostics, pendingBytes: 0, discarding: false });
const record = (line, value) => ({ line, value });
const diagnostic = (code, line) => ({ code, line });

function collect(hooks = {}) {
  const seen = { records: [], diagnostics: [] };
  seen.decoder = createNativeUsageJsonlDecoder({
    onRecord: (entry) => {
      seen.records.push(entry);
      return hooks.onRecord?.(entry, seen);
    },
    onDiagnostic: (entry) => {
      seen.diagnostics.push(entry);
      return hooks.onDiagnostic?.(entry, seen);
    }
  });
  return seen;
}

function decode(...chunks) {
  const seen = collect();
  for (const chunk of chunks) seen.decoder.push(chunk);
  return seen;
}

const refuses = (action, ErrorType, code) => assert.throws(action, (error) => {
  assert.equal(Object.getPrototypeOf(error), ErrorType.prototype);
  assert.equal(error.code, code);
  assert.equal(String(error.message).includes(SENTINEL), false, "a refusal never repeats caller input");
  return true;
});

test("native usage JSONL validates its interface and preserves byte framing", () => {
  assert.equal(NATIVE_USAGE_JSONL_MAX_LINE_BYTES, 1048576);
  const noop = () => {};
  let accessorRead = false;
  const withAccessor = { onDiagnostic: noop };
  Object.defineProperty(withAccessor, "onRecord", { enumerable: true, get() { accessorRead = true; return noop; } });
  class Options { constructor() { this.onRecord = noop; this.onDiagnostic = noop; } }
  for (const options of [undefined, null, [], [noop, noop], SENTINEL, 5, true, noop, new Options(),
    Object.create({ onRecord: noop, onDiagnostic: noop }), { onRecord: noop, onDiagnostic: noop, [SENTINEL]: 1 },
    { onRecord: noop, onDiagnostic: noop, [Symbol("extra")]: 1 }, withAccessor, { onRecord: 1, extra: 2 }]) {
    refuses(() => createNativeUsageJsonlDecoder(options), TypeError, "native_usage_jsonl_invalid_options");
  }
  refuses(() => createNativeUsageJsonlDecoder(), TypeError, "native_usage_jsonl_invalid_options");
  assert.equal(accessorRead, false, "an accessor option is refused without being read");
  for (const options of [{}, { onDiagnostic: noop }, { onRecord: SENTINEL, onDiagnostic: SENTINEL },
    { onRecord: null, onDiagnostic: noop }, { onRecord: undefined }]) {
    refuses(() => createNativeUsageJsonlDecoder(options), TypeError, "native_usage_jsonl_invalid_on_record");
  }
  for (const options of [{ onRecord: noop }, { onRecord: noop, onDiagnostic: null },
    { onRecord: noop, onDiagnostic: SENTINEL }, { onRecord: noop, onDiagnostic: {} }]) {
    refuses(() => createNativeUsageJsonlDecoder(options), TypeError, "native_usage_jsonl_invalid_on_diagnostic");
  }
  const bare = createNativeUsageJsonlDecoder(Object.assign(Object.create(null), { onRecord: noop, onDiagnostic: noop }));
  assert.deepEqual(Reflect.ownKeys(bare), ["push", "finish", "getState"]);

  const invalid = collect();
  for (const chunk of [SENTINEL, "", null, undefined, 7, {}, [123, 10], new ArrayBuffer(2), new Uint16Array(2),
    new Uint8ClampedArray(2), new Int8Array(2), new DataView(new ArrayBuffer(2))]) {
    refuses(() => invalid.decoder.push(chunk), TypeError, "native_usage_jsonl_invalid_chunk");
  }
  refuses(() => invalid.decoder.push(), TypeError, "native_usage_jsonl_invalid_chunk");
  assert.deepEqual(invalid.decoder.getState(), open());

  const roots = decode(bytes('{"a":1}\n[1,"two",null]\n"s"\n12.5\ntrue\nfalse\nnull\n-0\n'));
  assert.deepEqual(roots.records, [record(1, { a: 1 }), record(2, [1, "two", null]), record(3, "s"), record(4, 12.5),
    record(5, true), record(6, false), record(7, null), record(8, -0)]);
  assert.deepEqual(roots.diagnostics, []);
  assert.deepEqual(roots.decoder.getState(), open({ records: 8 }));

  const backing = bytes('9\n{"in":1}\n8\n');
  const view = decode(new Uint8Array(backing.buffer, backing.byteOffset + 2, 9));
  assert.deepEqual(view.records, [record(1, { in: 1 })]);

  const lines = decode(bytes("1\r\n\n\r\n2\n\n"), new Uint8Array(0), bytes("3\r"), bytes("\n"));
  assert.deepEqual(lines.records, [record(1, 1), record(4, 2), record(6, 3)]);
  assert.deepEqual(lines.diagnostics, []);
  assert.equal(lines.decoder.push(bytes("")), undefined);
  assert.equal(lines.decoder.push(bytes("4\n")), undefined);
  assert.deepEqual(lines.records.at(-1), record(7, 4));

  const split = collect();
  const text = bytes('{"k":"é😀"}\n["ü"]\n');
  for (let at = 0; at < text.length; at += 1) split.decoder.push(text.subarray(at, at + 1));
  assert.deepEqual(split.records, [record(1, { k: "é😀" }), record(2, ["ü"])]);
  assert.deepEqual(split.decoder.getState(), open({ records: 2 }));

  const owned = collect();
  const head = bytes('{"a":"kept');
  owned.decoder.push(head);
  assert.deepEqual(owned.decoder.getState(), open({ pendingBytes: 10 }));
  head.fill(0x21);
  owned.decoder.push(bytes('"}\n'));
  assert.deepEqual(owned.records, [record(1, { a: "kept" })]);

  const many = collect();
  const stream = bytes(Array.from({ length: 5000 }, (_, at) => `{"n":${at}}\n`).join(""));
  for (let at = 0; at < stream.length; at += 7) many.decoder.push(stream.subarray(at, at + 7));
  assert.equal(many.records.length, 5000);
  assert.deepEqual([many.records[0], many.records[1234], many.records[4999]],
    [record(1, { n: 0 }), record(1235, { n: 1234 }), record(5000, { n: 4999 })]);
  assert.deepEqual(many.decoder.getState(), open({ records: 5000 }));

  const returning = collect({ onRecord: () => Promise.resolve(SENTINEL), onDiagnostic: () => SENTINEL });
  returning.decoder.push(bytes("1\n{\n2\n"));
  const first = returning.decoder.getState();
  assert.deepEqual(Object.keys(first), ["state", "complete", "records", "diagnostics", "pendingBytes", "discarding"]);
  assert.ok(Object.isFrozen(first));
  assert.notEqual(returning.decoder.getState(), first);
  assert.deepEqual(first, open({ records: 2, diagnostics: 1 }));
});

test("native usage JSONL reports exact structural diagnostics without source text", () => {
  const mixed = decode(bytes(`{bad ${SENTINEL}\n{"ok":"${SENTINEL}"}\n[${SENTINEL}]\n`));
  assert.deepEqual(mixed.diagnostics, [diagnostic("invalid_json", 1), diagnostic("invalid_json", 3)]);

  assert.deepEqual(mixed.records, [record(2, { ok: SENTINEL })]);
  assert.deepEqual(mixed.decoder.getState(), open({ records: 1, diagnostics: 2 }));
  for (const entry of mixed.diagnostics) assert.deepEqual(Object.keys(entry), ["code", "line"]);

  const blank = decode(bytes(" \n\t\r\n\r\r\n1 2\n1\r2\n{\"a\":1}x\n"));
  assert.deepEqual(blank.diagnostics, [1, 2, 3, 4, 5, 6].map((line) => diagnostic("invalid_json", line)));
  assert.deepEqual(blank.records, []);

  const bom = decode(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes('{"a":1}\n{"a":2}\n')]));
  assert.deepEqual(bom.diagnostics, [diagnostic("invalid_json", 1)]);
  assert.deepEqual(bom.records, [record(2, { a: 2 })]);

  const quoted = (...invalid) => Buffer.concat([bytes(`"${SENTINEL}`), Buffer.from(invalid), bytes('"\n')]);
  const utf8 = decode(
    quoted(0xff),
    quoted(0xc3),
    quoted(0xc0, 0xaf),
    quoted(0xed, 0xa0, 0x80),
    quoted(0xf0, 0x9f, 0x98),
    Buffer.concat([bytes(`{bad ${SENTINEL}`), Buffer.from([0x80, 0x0a])]),
    quoted(0xc3, 0xa9));
  assert.deepEqual(utf8.diagnostics, [1, 2, 3, 4, 5, 6].map((line) => diagnostic("invalid_utf8", line)));
  assert.deepEqual(utf8.records, [record(7, `${SENTINEL}é`)]);

  const cut = decode(Buffer.from([0x22, 0xc3]), Buffer.from([0xa9, 0x22, 0x0a, 0x22, 0xc3]), Buffer.from([0x0a, 0xa9, 0x22, 0x0a]));
  assert.deepEqual(cut.records, [record(1, "é")]);
  assert.deepEqual(cut.diagnostics, [diagnostic("invalid_utf8", 2), diagnostic("invalid_utf8", 3)]);

  const summary = utf8.decoder.finish(true);
  assert.deepEqual(summary, settled("finished", false, 1, 6));
  for (const generated of [mixed.diagnostics, utf8.diagnostics, mixed.decoder.getState(), summary]) {
    assert.equal(JSON.stringify(generated).includes(SENTINEL), false);
  }
});

test("native usage JSONL enforces the byte limit and recovers later records", () => {

  const ascii = decode(Buffer.concat([bytes('"'), filled(MAX - 2), bytes('"\n')]));
  assert.deepEqual(ascii.diagnostics, []);
  assert.deepEqual([ascii.records.length, ascii.records[0].line, ascii.records[0].value.length], [1, 1, 1048574]);
  const wide = Buffer.concat([bytes('"'), bytes("é".repeat(524287)), bytes('"')]);
  assert.equal(wide.length, 1048576);
  const multibyte = decode(wide, bytes("\n"));
  assert.deepEqual(multibyte.diagnostics, []);
  assert.deepEqual([multibyte.records[0].value.length, multibyte.records[0].value.at(-1)], [524287, "é"]);
  const withCr = decode(Buffer.concat([bytes('"'), filled(MAX - 3), bytes('"\r\n')]));
  assert.deepEqual([withCr.diagnostics, withCr.records[0].value.length], [[], 1048573]);

  const overCr = decode(Buffer.concat([bytes('"'), filled(MAX - 2), bytes('"\r\n7\n')]));
  assert.deepEqual(overCr.diagnostics, [diagnostic("line_too_large", 1)]);
  assert.deepEqual(overCr.records, [record(2, 7)]);
  const overWide = decode(Buffer.concat([bytes('"'), bytes("é".repeat(524287)), bytes('a"\n'), bytes("8\n")]));
  assert.deepEqual(overWide.diagnostics, [diagnostic("line_too_large", 1)]);
  assert.deepEqual(overWide.records, [record(2, 8)]);

  const endless = collect();
  endless.decoder.push(filled(MAX));
  assert.deepEqual(endless.decoder.getState(), open({ pendingBytes: 1048576 }));
  assert.deepEqual(endless.diagnostics, []);
  endless.decoder.push(filled(1, 0xff));
  assert.deepEqual(endless.diagnostics, [diagnostic("line_too_large", 1)]);
  assert.deepEqual(endless.decoder.getState(), open({ diagnostics: 1, discarding: true }));
  endless.decoder.push(filled(3 * MAX, 0xff));
  endless.decoder.push(filled(17));
  assert.deepEqual(endless.decoder.getState(), open({ diagnostics: 1, discarding: true }));
  endless.decoder.push(bytes(`\n{"after":"${SENTINEL}"}\n`));
  assert.deepEqual(endless.diagnostics, [diagnostic("line_too_large", 1)]);
  assert.deepEqual(endless.records, [record(2, { after: SENTINEL })]);
  assert.deepEqual(endless.decoder.getState(), open({ records: 1, diagnostics: 1 }));

  const huge = decode(Buffer.concat([filled(3 * MAX + 5), bytes("\n"), filled(2 * MAX), bytes('\n\n{"final":true}')]));
  assert.deepEqual(huge.diagnostics, [diagnostic("line_too_large", 1), diagnostic("line_too_large", 2)]);
  assert.deepEqual(huge.decoder.getState(), open({ diagnostics: 2, pendingBytes: 14 }));
  assert.deepEqual(huge.decoder.finish(true), settled("finished", false, 1, 2));
  assert.deepEqual(huge.records, [record(4, { final: true })]);

  const fragmented = collect();
  const reportedAfter = [];
  for (let fragment = 1; fragment <= 20; fragment += 1) {
    fragmented.decoder.push(filled(65536));
    if (fragmented.diagnostics.length === 1 && reportedAfter.length === 0) reportedAfter.push(fragment);
  }
  assert.deepEqual(reportedAfter, [17]);
  fragmented.decoder.push(bytes("xx\n1\n"));
  fragmented.decoder.push(filled(MAX - 1));
  fragmented.decoder.push(bytes("\n2\n"));
  assert.deepEqual(fragmented.diagnostics, [diagnostic("line_too_large", 1), diagnostic("invalid_json", 3)]);
  assert.deepEqual(fragmented.records, [record(2, 1), record(4, 2)]);
});

test("native usage JSONL settles drained and interrupted streams once", () => {
  const drained = decode(bytes('1\n{"last":2}'));
  for (const completion of [undefined, null, 1, 0, "true", SENTINEL, {}]) {
    refuses(() => drained.decoder.finish(completion), TypeError, "native_usage_jsonl_invalid_completion");
  }
  refuses(() => drained.decoder.finish(), TypeError, "native_usage_jsonl_invalid_completion");
  assert.deepEqual(drained.decoder.getState(), open({ records: 1, pendingBytes: 10 }));

  const summary = drained.decoder.finish(true);
  assert.deepEqual(summary, settled("finished", true, 2, 0));
  assert.ok(Object.isFrozen(summary));
  assert.deepEqual(drained.records, [record(1, 1), record(2, { last: 2 })]);
  assert.equal(drained.decoder.finish(true), summary);
  refuses(() => drained.decoder.finish(false), Error, "native_usage_jsonl_finish_conflict");
  refuses(() => drained.decoder.push(bytes("3\n")), Error, "native_usage_jsonl_finished");
  refuses(() => drained.decoder.push(new Uint8Array(0)), Error, "native_usage_jsonl_finished");
  refuses(() => drained.decoder.push(SENTINEL), TypeError, "native_usage_jsonl_invalid_chunk");
  refuses(() => drained.decoder.finish(SENTINEL), TypeError, "native_usage_jsonl_invalid_completion");
  assert.equal(drained.decoder.finish(true), summary);
  assert.deepEqual(drained.decoder.getState(), settled("finished", true, 2, 0));
  assert.notEqual(drained.decoder.getState(), summary);
  assert.deepEqual([drained.records.length, drained.diagnostics.length], [2, 0]);

  const finish = (completion, ...chunks) => {
    const seen = decode(...chunks);
    seen.summary = seen.decoder.finish(completion);
    return seen;
  };

  assert.deepEqual(finish(true).summary, settled("finished", true, 0, 0));
  const finalCr = finish(true, bytes("1\n\r"));
  assert.deepEqual([finalCr.summary, finalCr.records, finalCr.diagnostics], [settled("finished", true, 1, 0), [record(1, 1)], []]);
  assert.deepEqual(finish(true, bytes("3\r")).records, [record(1, 3)]);
  const badTail = finish(true, bytes(`1\n{"${SENTINEL}`));
  assert.deepEqual([badTail.summary, badTail.diagnostics], [settled("finished", false, 1, 1), [diagnostic("invalid_json", 2)]]);
  const overflowTail = finish(true, bytes("1\n"), filled(MAX + 1));
  assert.deepEqual([overflowTail.summary, overflowTail.diagnostics, overflowTail.records],
    [settled("finished", false, 1, 1), [diagnostic("line_too_large", 2)], [record(1, 1)]]);

  const interrupted = finish(false, bytes(`1\n{"partial":"${SENTINEL}`));
  assert.deepEqual(interrupted.diagnostics, [diagnostic("truncated_record", 2), diagnostic("source_incomplete", 2)]);
  assert.deepEqual(interrupted.records, [record(1, 1)]);
  assert.deepEqual(interrupted.summary, settled("finished", false, 1, 2));
  assert.equal(JSON.stringify(interrupted.summary).includes(SENTINEL), false);
  assert.equal(interrupted.decoder.finish(false), interrupted.summary);
  refuses(() => interrupted.decoder.finish(true), Error, "native_usage_jsonl_finish_conflict");
  refuses(() => interrupted.decoder.push(bytes("2\n")), Error, "native_usage_jsonl_finished");
  assert.equal(interrupted.diagnostics.length, 2);

  const noResidue = finish(false, bytes("1\n2\n"));
  assert.deepEqual([noResidue.diagnostics, noResidue.summary],
    [[diagnostic("source_incomplete", 3)], settled("finished", false, 2, 1)]);
  const nothing = finish(false);
  assert.deepEqual([nothing.diagnostics, nothing.summary], [[diagnostic("source_incomplete", 1)], settled("finished", false, 0, 1)]);
  assert.deepEqual(finish(false, bytes("1\n\r")).diagnostics, [diagnostic("truncated_record", 2), diagnostic("source_incomplete", 2)]);

  const overflowed = finish(false, filled(MAX + 1));
  assert.deepEqual([overflowed.diagnostics, overflowed.summary],
    [[diagnostic("line_too_large", 1), diagnostic("source_incomplete", 1)], settled("finished", false, 0, 2)]);
});

test("native usage JSONL isolates instances and propagates callback failures", () => {

  const left = collect();
  const right = collect();
  for (const [seen, chunk] of [[left, '{"l":'], [right, "[1,"], [left, "1}\n"], [right, "2]\n{bad\n"], [left, '"x'], [right, "3"]]) {
    seen.decoder.push(bytes(chunk));
  }
  assert.deepEqual([left.records, left.diagnostics], [[record(1, { l: 1 })], []]);
  assert.deepEqual([right.records, right.diagnostics], [[record(1, [1, 2])], [diagnostic("invalid_json", 2)]]);
  assert.deepEqual(left.decoder.getState(), open({ records: 1, pendingBytes: 2 }));
  assert.deepEqual(right.decoder.getState(), open({ records: 1, diagnostics: 1, pendingBytes: 1 }));

  const thrown = { marker: SENTINEL };
  const failing = collect({ onRecord: (entry) => { if (entry.value === 2) throw thrown; } });
  assert.throws(() => failing.decoder.push(bytes('1\n2\n3\n{"unfinished"')), (error) => error === thrown);
  assert.deepEqual(failing.records, [record(1, 1), record(2, 2)]);
  const failed = settled("failed", false, 1, 0);
  assert.deepEqual(failing.decoder.getState(), failed);
  refuses(() => failing.decoder.push(bytes("4\n")), Error, "native_usage_jsonl_failed");
  refuses(() => failing.decoder.push(new Uint8Array(0)), Error, "native_usage_jsonl_failed");
  refuses(() => failing.decoder.push(SENTINEL), TypeError, "native_usage_jsonl_invalid_chunk");
  refuses(() => failing.decoder.finish(SENTINEL), TypeError, "native_usage_jsonl_invalid_completion");
  const failedSummary = failing.decoder.finish(true);
  assert.deepEqual(failedSummary, failed);
  assert.ok(Object.isFrozen(failedSummary));
  assert.equal(failing.decoder.finish(false), failedSummary);
  assert.equal(failing.decoder.finish(true), failedSummary);
  assert.equal(JSON.stringify(failedSummary).includes(SENTINEL), false);
  assert.deepEqual([failing.records.length, failing.diagnostics.length], [2, 0], "nothing is retried or replayed");
  left.decoder.push(bytes('"\n'));
  assert.deepEqual(left.records, [record(1, { l: 1 }), record(2, "x")]);

  const error = new RangeError(SENTINEL);
  const diagnosing = collect({ onDiagnostic: () => { throw error; } });
  assert.throws(() => diagnosing.decoder.push(bytes("1\n{bad\n2\n")), (caught) => caught === error);
  assert.deepEqual([diagnosing.records, diagnosing.diagnostics], [[record(1, 1)], [diagnostic("invalid_json", 2)]]);
  assert.deepEqual(diagnosing.decoder.finish(false), settled("failed", false, 1, 1));

  const finalRecord = collect({ onRecord: () => { throw thrown; } });
  finalRecord.decoder.push(bytes("1"));
  assert.throws(() => finalRecord.decoder.finish(true), (caught) => caught === thrown);
  assert.deepEqual(finalRecord.decoder.finish(false), settled("failed", false, 0, 0));
  const interrupted = collect({ onDiagnostic: () => { throw thrown; } });
  interrupted.decoder.push(bytes("1\n2"));
  assert.throws(() => interrupted.decoder.finish(false), (caught) => caught === thrown);
  assert.deepEqual(interrupted.diagnostics, [diagnostic("truncated_record", 2)]);
  assert.deepEqual(interrupted.decoder.finish(false), settled("failed", false, 1, 1));
  refuses(() => interrupted.decoder.push(bytes("3\n")), Error, "native_usage_jsonl_failed");

  const refusals = [];
  const states = [];
  const attempt = (action) => {
    try {
      action();
    } catch (caught) {
      refusals.push([Object.getPrototypeOf(caught) === Error.prototype || caught.constructor.name, caught.code]);
    }
  };
  const reentrant = collect({
    onRecord: (entry, seen) => {
      states.push(seen.decoder.getState());
      if (entry.value !== 1) return;
      attempt(() => seen.decoder.push(bytes("9\n")));
      attempt(() => seen.decoder.finish(true));
      attempt(() => seen.decoder.push(SENTINEL));
    },
    onDiagnostic: (entry, seen) => attempt(() => seen.decoder.finish(false))
  });
  reentrant.decoder.push(bytes("1\n2\n{bad\n3"));
  assert.deepEqual(refusals, [[true, "native_usage_jsonl_reentrant_call"], [true, "native_usage_jsonl_reentrant_call"],
    ["TypeError", "native_usage_jsonl_invalid_chunk"], [true, "native_usage_jsonl_reentrant_call"]]);
  assert.deepEqual(states, [open(), open({ records: 1 })]);
  assert.deepEqual(reentrant.records, [record(1, 1), record(2, 2)]);
  assert.deepEqual(reentrant.decoder.getState(), open({ records: 2, diagnostics: 1, pendingBytes: 1 }));
  assert.deepEqual(reentrant.decoder.finish(true), settled("finished", false, 3, 1));
  assert.deepEqual(reentrant.records.at(-1), record(4, 3));

  const escaping = collect({ onRecord: (entry, seen) => seen.decoder.push(bytes("9\n")) });
  refuses(() => escaping.decoder.push(bytes("1\n2\n")), Error, "native_usage_jsonl_reentrant_call");
  assert.deepEqual(escaping.records, [record(1, 1)]);
  assert.deepEqual(escaping.decoder.getState(), settled("failed", false, 0, 0));
  const settling = collect({ onDiagnostic: (entry, seen) => seen.decoder.finish(false) });
  refuses(() => settling.decoder.finish(false), Error, "native_usage_jsonl_reentrant_call");
  assert.deepEqual(settling.decoder.finish(true), settled("failed", false, 0, 1));
});
