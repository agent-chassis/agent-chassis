

import test from "node:test";
import assert from "node:assert/strict";

import { accountRequirementSourceResidual } from
  "../../packages/wiki-core/src/operations/controlled-contract/proof-validation-operations.mjs";
import { describeRequirementSourceLink, requirementSourceDigest, resolveRequirementSourceLink } from
  "../../packages/wiki-core/src/operations/controlled-contract/contract-requirement-source-links.mjs";

const WK = "WK-0001";

const row = (id, currentText, linkedIn, passage, occurrence) => ({ row_id: id,
  source: describeRequirementSourceLink(passage === undefined ? null : resolveRequirementSourceLink({ wkId: WK,
    text: linkedIn, passage, occurrence, field: "changes.requirements.requirements[0]" }), currentText) });
const account = (text, ...rows) => accountRequirementSourceResidual({ rows }, text);
const segments = facts => facts.unmapped.segments.map(({ start, end, text, whitespace_only: blank }) => [start, end, text, blank]);

test("text no current link covers is returned exactly as saved, and linked text is covered once", () => {
  const text = "  Alpha beta gamma.\n\tDelta  epsilon ";
  const facts = account(text, row("r1", text, text, "Alpha beta"), row("r2", text, text, "beta gamma"),
    row("r3", text, text, "beta"), row("r4", text, text, "Delta"), row("r5", text, text));
  assert.deepEqual([facts.state, facts.accounted, facts.source_field, facts.source],
    ["accounted", true, "sections.user_requirements",
      { digest: requirementSourceDigest(text), length: text.length, unit: "utf16_code_units" }]);

  assert.deepEqual(facts.links, { current: 4, stale_excluded: 0, absent: 1, inconsistent_row_ids: [] });
  assert.deepEqual(facts.linked, { interval_count: 2, length: 21, intervals: [{ start: 2, end: 18 }, { start: 21, end: 26 }] });

  assert.deepEqual(segments(facts), [[0, 2, "  ", true], [18, 21, ".\n\t", false], [26, 36, "  epsilon ", false]]);
  assert.equal(facts.linked.length + facts.unmapped.length, text.length);
  assert.equal(facts.unmapped.segment_count, 3);
});

test("a repeated passage covers only the occurrence its link chose, and two links to it cover it once", () => {
  const text = "ababa aba";
  const facts = account(text, row("r1", text, text, "aba", 2), row("r2", text, text, "aba", 2));
  assert.deepEqual([facts.links.current, facts.linked.intervals, segments(facts)],
    [2, [{ start: 2, end: 5 }], [[0, 2, "ab", false], [5, 9, " aba", false]]]);

  assert.deepEqual(account(text, row("r1", text, text, "aba", 1), row("r2", text, text, "aba", 2)).linked,
    { interval_count: 1, length: 5, intervals: [{ start: 0, end: 5 }] });
});

test("a stale link covers nothing of the current text, although its passage still occurs", () => {
  const saved = "The exporter must not write the ledger.", current = `Preface. ${saved}`;
  const facts = account(current, row("r1", current, saved, "must not write the ledger"));
  assert.deepEqual([facts.links, facts.linked.length, segments(facts)],
    [{ current: 0, stale_excluded: 1, absent: 0, inconsistent_row_ids: [] }, 0, [[0, current.length, current, false]]]);
});

test("a current link whose location no longer holds its passage is named and covers nothing", () => {
  const text = "Alpha beta gamma.";
  const broken = row("r1", text, text, "beta");
  const moved = { ...broken, source: { ...broken.source, location: { ...broken.source.location, start: 0, end: 4 } } };
  const facts = account(text, moved);
  assert.deepEqual([facts.links, segments(facts)],
    [{ current: 0, stale_excluded: 0, absent: 0, inconsistent_row_ids: ["r1"] }, [[0, text.length, text, false]]]);
});

test("wholly linked text has no unmapped segment; no rows leaves the whole text; no text is unknown, never empty", () => {
  const text = "Alpha beta";
  const whole = account(text, row("r1", text, text, text));
  assert.deepEqual([whole.state, whole.unmapped, whole.linked.length],
    ["accounted", { segment_count: 0, length: 0, segments: [] }, text.length]);
  assert.deepEqual(segments(accountRequirementSourceResidual({ status: "absent", rows: [] }, text)), [[0, text.length, text, false]]);
  assert.deepEqual(segments(accountRequirementSourceResidual(null, text)), [[0, text.length, text, false]]);
  for (const missing of [null, undefined, ""]) {
    const unknown = accountRequirementSourceResidual({ rows: [] }, missing);
    assert.deepEqual([unknown.state, unknown.accounted, unknown.source_field, Object.hasOwn(unknown, "unmapped")],
      ["unknown", false, "sections.user_requirements", false]);
    assert.match(unknown.reason, /no sections\.user_requirements text is saved/u);
  }
});
