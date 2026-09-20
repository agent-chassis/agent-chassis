import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { fitReadPagePopulation } from "../../packages/wiki-core/src/lib/work-record-read-page-budget.mjs";
import {
  WORK_RECORD_COMPACT_RESULT_MAX_UTF8_BYTES,
  WORK_RECORD_ENTRY_BODY_PAGE_MAX_SCALARS,
  WORK_RECORD_ENTRY_READ_TARGET_UTF8_BYTES
} from "../../packages/wiki-core/src/lib/work-record-entry-schema.mjs";

const bytes = (value) => Buffer.byteLength(JSON.stringify(value), "utf8");

test("the explicit body page limit is derived from the compact result bound", () => {
  assert.equal(WORK_RECORD_ENTRY_BODY_PAGE_MAX_SCALARS, WORK_RECORD_COMPACT_RESULT_MAX_UTF8_BYTES);
  assert.equal(WORK_RECORD_COMPACT_RESULT_MAX_UTF8_BYTES, 8192);
  assert.equal(WORK_RECORD_ENTRY_READ_TARGET_UTF8_BYTES, 2048);
});

test("fitReadPagePopulation returns the largest prefix whose complete payload fits the named budget", () => {

  const points = Array.from("λ\u{1f680}\"\\\n".repeat(2000));
  const build = (count) => ({
    ok: true,
    source_digest: `sha256:${"a".repeat(64)}`,
    body: { value: points.slice(0, count).join(""), offset: 0, length: count, total: points.length }
  });
  for (const budget of [WORK_RECORD_ENTRY_READ_TARGET_UTF8_BYTES, WORK_RECORD_COMPACT_RESULT_MAX_UTF8_BYTES]) {
    const page = fitReadPagePopulation(points.length, build, budget);
    assert.ok(bytes(page) <= budget, `${budget}: fitted page is ${bytes(page)} bytes`);
    assert.ok(bytes(build(page.body.length + 1)) > budget, `${budget}: one more scalar would not fit`);
  }
  assert.equal(fitReadPagePopulation(10, build, WORK_RECORD_COMPACT_RESULT_MAX_UTF8_BYTES).body.length, 10,
    "a population that fits is returned whole");
});

test("an item larger than the budget is returned alone so a nonterminal page still makes progress", () => {
  const build = (count) => ({ rows: Array.from({ length: count }, () => "x".repeat(4096)) });
  assert.equal(fitReadPagePopulation(3, build, 1024).rows.length, 1);
  assert.deepEqual(fitReadPagePopulation(0, build, 1024), { rows: [] });
});

test("the fitter requires an explicit valid budget instead of assuming one", () => {
  const build = () => ({});
  for (const budget of [undefined, 0, -1, 1.5, "2048"]) {
    assert.throws(() => fitReadPagePopulation(1, build, budget), TypeError, String(budget));
  }
  assert.throws(() => fitReadPagePopulation(-1, build, 2048), TypeError);
  assert.throws(() => fitReadPagePopulation(1, null, 2048), TypeError);
});

test("the entry owner delegates fitting to the one shared fitter", async () => {
  const source = await readFile(
    new URL("../../packages/wiki-core/src/operations/work-record-entries.mjs", import.meta.url), "utf8");
  assert.equal(/function fitPopulation\b/u.test(source), false, "no private copy of the fitter remains");
  assert.match(source, /import \{ fitReadPagePopulation \} from "\.\.\/lib\/work-record-read-page-budget\.mjs"/u);
});
