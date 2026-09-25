import assert from "node:assert/strict";
import { appendFileSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createBoundedLineReader } from "../helpers/bounded-line-reader.mjs";
import { createTestFixture } from "../helpers/test-fixture.mjs";
import {
  TIMING_MAX_RECORD_BYTES, openTimingJournal, readTimingJournal
} from "../helpers/test-timing-journal.mjs";
import { TEST_TIMING_CODES } from "../helpers/test-timing-diagnostics.mjs";

const RUN = "00000000-0000-4000-8000-000000000001";

async function root(t) {
  const fixture = await createTestFixture({ prefix: "timing-journal-" });
  t.after(() => fixture.dispose());
  return fixture.rootPath;
}

function readAll(file, options) {
  const records = [];
  const result = readTimingJournal(file, { ...options, onRecord: (record) => records.push(record) });
  return { ...result, list: records };
}

test("line framing: split across chunks, bounded, with distinct EOF policies", () => {
  const lines = [];
  const failures = [];
  const trailing = [];
  const reject = createBoundedLineReader({ maxLineBytes: 8, eofPolicy: "reject",
    onLine: (bytes, offset) => lines.push([bytes.toString(), offset]), onFailure: (f) => failures.push(f) });
  reject.push(Buffer.from("ab"));
  reject.push(Buffer.from("c\nde\nf"));
  reject.end();
  assert.deepEqual(lines, [["abc", 0], ["de", 4]]);
  assert.deepEqual(failures.map((f) => f.kind), ["trailing"]);

  const report = createBoundedLineReader({ maxLineBytes: 8, eofPolicy: "report",
    onLine: () => {}, onFailure: (f) => failures.push(f), onTrailing: (t) => trailing.push(t) });
  report.push(Buffer.from("ok\ntorn"));
  report.end();
  assert.deepEqual(trailing.map((t) => [t.offset, t.bytes.toString()]), [[3, "torn"]]);

  const oversize = [];
  const bounded = createBoundedLineReader({ maxLineBytes: 4, eofPolicy: "reject",
    onLine: () => assert.fail("an oversized line is never delivered"), onFailure: (f) => oversize.push(f) });
  bounded.push(Buffer.from("12345\n"));
  bounded.push(Buffer.from("x\n"));
  assert.deepEqual(oversize.map((f) => f.kind), ["oversize"]);
});

test("a journal is create-exclusive, private and sequenced as records are appended", async (t) => {
  const file = path.join(await root(t), "events.jsonl");
  const journal = openTimingJournal(file, { runId: RUN, producerId: "p1" });
  assert.equal(journal.append({ event: "start", name: "a" }), null);

  assert.match(readFileSync(file, "utf8"), /"seq":1,.*"event":"start"/u);
  assert.equal(journal.append({ event: "complete", name: "a" }), null);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(openTimingJournal(file, { runId: RUN, producerId: "p2" }).failure.code,
    TEST_TIMING_CODES.ARTIFACT_WRITE_FAILED, "an existing journal is never reopened or overwritten");
  journal.close();
  const read = readAll(file, { expectedRunId: RUN });
  assert.deepEqual(read.list.map((record) => [record.seq, record.event]), [[1, "start"], [2, "complete"]]);
  assert.deepEqual(read.errors, []);
  assert.equal(read.trailing, null);
});

test("an oversized or reserved record latches the journal without truncation", async (t) => {
  const directory = await root(t);
  const journal = openTimingJournal(path.join(directory, "big.jsonl"), { runId: RUN, producerId: "p" });
  assert.equal(journal.append({ event: "start" }), null);
  const failure = journal.append({ event: "start", name: "x".repeat(TIMING_MAX_RECORD_BYTES) });
  assert.equal(failure.code, TEST_TIMING_CODES.TIMING_RECORD_INVALID);
  assert.equal(journal.append({ event: "after" }), failure, "the first failure latches");
  assert.equal(readFileSync(path.join(directory, "big.jsonl"), "utf8").split("\n").filter(Boolean).length, 1);
  const reserved = openTimingJournal(path.join(directory, "reserved.jsonl"), { runId: RUN, producerId: "p" });
  assert.equal(reserved.append({ seq: 9 }).code, TEST_TIMING_CODES.TIMING_RECORD_INVALID);
});

test("reading tolerates only a torn tail and names every interior defect", async (t) => {
  const directory = await root(t);
  const file = path.join(directory, "events.jsonl");
  const journal = openTimingJournal(file, { runId: RUN, producerId: "p" });
  journal.append({ event: "start" });
  journal.append({ event: "complete" });
  journal.close();
  appendFileSync(file, '{"schema":"test-timing-record.v1","run_id":"');
  const torn = readAll(file, { expectedRunId: RUN });
  assert.equal(torn.list.length, 2, "complete records before the torn tail survive");
  assert.deepEqual(torn.errors, []);
  assert.equal(torn.trailing.offset > 0 && torn.trailing.bytes > 0, true);
  assert.ok(Buffer.from(torn.trailing.raw_base64, "base64").toString().startsWith('{"schema"'));

  const lines = readFileSync(file, "utf8").split("\n").slice(0, 2);
  const second = JSON.parse(lines[1]);
  const corrupt = path.join(directory, "corrupt.jsonl");
  writeFileSync(corrupt, `${lines[0]}\nnot json\n${JSON.stringify({ ...second, seq: 5 })}\n` +
    `${JSON.stringify({ ...second, seq: 6, run_id: "other" })}\n`);
  const read = readAll(corrupt, { expectedRunId: RUN });
  assert.deepEqual(read.errors.map((error) => error.kind), ["malformed", "sequence_break", "foreign_run"]);
  assert.equal(read.trailing, null);
});
