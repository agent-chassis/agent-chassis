import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { createNativeTimingRecorder } from "../helpers/test-native-timing.mjs";
import { createTestFixture } from "../helpers/test-fixture.mjs";
import { openTimingJournal, readTimingJournal } from "../helpers/test-timing-journal.mjs";
import { summarizeTestRun } from "../helpers/test-timing-summary.mjs";

const RUN = "00000000-0000-4000-8000-000000000002";
const A = "/work/a.test.mjs";
const B = "/work/b.test.mjs";
const HELPER = "/work/helper.mjs";

const wrapperData = (file, testId) => ({ nesting: 0, name: file, file, testId, type: "test", line: 1, column: 1 });
const inner = (entryFile, testId, name, extra = {}) => ({ nesting: 0, name, file: entryFile, entryFile,
  testId, parentId: 0, type: "test", line: testId, column: 1, ...extra });
const dequeue = (data) => ({ type: "test:dequeue", data });
const complete = (data, details) => ({ type: "test:complete", data: { ...data, details } });

async function recorderIn(t) {
  const fixture = await createTestFixture({ prefix: "native-timing-" });
  t.after(() => fixture.dispose());
  const file = path.join(fixture.rootPath, "events.jsonl");
  const journal = openTimingJournal(file, { runId: RUN, producerId: "observer-1" });
  const recorder = createNativeTimingRecorder({ journal, suiteProducerId: "observer-1" });
  const records = () => {
    const list = [];
    readTimingJournal(file, { onRecord: (record) => list.push(record) });
    return list;
  };
  return { recorder, records, runDir: fixture.rootPath };
}

test("wrapper and inner identities stay distinct across repeated names, imports and files", async (t) => {
  const { recorder, records } = await recorderIn(t);
  const wa = { file: A, id: 1 };
  const wb = { file: B, id: 2 };
  recorder.begin();
  recorder.observe(dequeue(wrapperData(A, 1)), wa);
  recorder.observe(dequeue(wrapperData(B, 2)), wb);

  recorder.observe(dequeue(inner(B, 1, "dup")), null);
  recorder.observe(complete(inner(B, 1, "dup"), { duration_ms: 1.5, type: "test", passed: true }), null);
  recorder.observe(dequeue(inner(A, 1, "dup")), null);
  recorder.observe(dequeue(inner(A, 2, "dup")), null);
  recorder.observe(complete(inner(A, 1, "dup"), { duration_ms: 2, type: "test", passed: true }), null);
  recorder.observe(complete(inner(A, 2, "dup"), { duration_ms: 3, type: "test", passed: false }), null);
  const imported = inner(A, 7, "imported", { file: HELPER });
  recorder.observe(dequeue(imported), null);
  recorder.observe(complete(imported, { duration_ms: 0.5, type: "test", passed: true }), null);
  recorder.observe({ type: "test:pass", data: inner(A, 1, "dup") }, null);
  recorder.observe(complete(wrapperData(B, 2), { duration_ms: 10, type: "test", passed: true }), wb);
  recorder.observe(complete(wrapperData(A, 1), { duration_ms: 20, type: "test", passed: false }), wa);
  recorder.finish();

  const all = records();
  const completes = all.filter((record) => record.event === "complete");
  assert.equal(completes.length, 6, "test:pass is never a second completion");
  const keys = completes.map((record) => JSON.stringify(record.identity));
  assert.equal(new Set(keys).size, 6, keys.join("\n"));
  const wrapperRecord = completes.find((record) => record.kind === "file" && record.identity.file === A);
  assert.deepEqual(wrapperRecord.identity, { namespace: "file", suite_producer: "observer-1", file: A, test_id: 1 });
  const importedRecord = completes.find((record) => record.name === "imported");
  assert.deepEqual(importedRecord.identity, { namespace: "test", entry_file: A,
    source_producer: "observer-1/file/1", test_id: 7 });
  assert.equal(importedRecord.source.file, HELPER);
  assert.equal(completes.every((record) => record.identity_complete), true);
  assert.deepEqual(all.map((record) => record.seq), all.map((_, index) => index + 1));
  assert.deepEqual([all[0].event, all.at(-1).event], ["stream_start", "stream_end"]);
});

test("an inner event with no scheduled wrapper is recorded as incomplete identity", async (t) => {
  const { recorder, records, runDir } = await recorderIn(t);
  recorder.begin();
  recorder.observe(dequeue(inner(A, 1, "orphan")), null);
  recorder.observe(complete(inner(A, 1, "orphan"), { duration_ms: 1, type: "test", passed: true }), null);
  recorder.finish();
  const completed = records().find((record) => record.event === "complete");
  assert.equal(completed.identity.source_producer, null);
  assert.equal(completed.identity_complete, false);
  const summary = summarizeTestRun({ runDir, runId: RUN });
  assert.equal(summary.native.counts.identity_incomplete, 1);
  assert.equal(summary.recording.status, "incomplete");
});

test("the summary keeps inclusive kinds apart and never completes unfinished work", async (t) => {
  const { recorder, runDir } = await recorderIn(t);
  const wa = { file: A, id: 1 };
  recorder.begin();
  recorder.observe(dequeue(wrapperData(A, 1)), wa);
  const suite = inner(A, 1, "suite");
  recorder.observe(dequeue(suite), null);
  recorder.observe(dequeue(inner(A, 2, "leaf", { nesting: 1, parentId: 1 })), null);
  recorder.observe(complete(inner(A, 2, "leaf", { nesting: 1, parentId: 1 }),
    { duration_ms: 4, type: "test", passed: true }), null);
  recorder.observe(complete(suite, { duration_ms: 5, type: "suite", passed: true }), null);
  recorder.observe(dequeue(inner(A, 3, "hangs")), null);

  const summary = summarizeTestRun({ runDir, runId: RUN });
  assert.deepEqual([summary.native.counts.tests, summary.native.counts.suites, summary.native.counts.files], [1, 1, 0]);
  assert.deepEqual(summary.native.slowest.tests.map((row) => row.name), ["leaf"]);
  assert.deepEqual(summary.native.slowest.suites.map((row) => row.name), ["suite"]);
  assert.equal(summary.native.stream_end, false);
  assert.deepEqual(summary.native.unfinished.items.map((item) => item.name).sort(), [A, "hangs"]);
  assert.equal(summary.native.complete, false);
  assert.equal(summary.recording.status, "incomplete");
});
