import assert from "node:assert/strict";
import test from "node:test";

import { decodeCommittedSource, selectCommittedSourceRegion, selectRetainedSourceLines } from
  "../../packages/wiki-core/src/lib/sidecar-source-regions.mjs";

const TEXT = "class Box {\n  method() {\n    return 1;\n  }\n}\nconst tail = 2;";
const SOURCE = decodeCommittedSource(Buffer.from(TEXT));
const occurrence = (range, enclosingRange, symbolRoles = 1) => ({
  symbol_roles: symbolRoles, range, enclosing_range: enclosingRange
});
const select = (targetRange, definitions, source = SOURCE) =>
  selectCommittedSourceRegion({ source, target_range: targetRange,
    definition_occurrences: definitions });

test("selects the outermost enclosing class independent of definition order", () => {
  const outer = occurrence({ start_line: 1, end_line: 1 }, { start_line: 1, end_line: 5 });
  const method = occurrence({ start_line: 2, end_line: 2 }, { start_line: 2, end_line: 4 });
  const duplicate = occurrence({ start_line: 2, end_line: 3 }, { start_line: 1, end_line: 5 });
  const expected = {
    state: "available", kind: "enclosing_definition", start_line: 1, end_line: 5,
    line_count: 5, source_text: "class Box {\n  method() {\n    return 1;\n  }\n}\n",
    selection_basis: ["enclosing_definition"]
  };
  const inputs = [outer, method, duplicate];
  const target = { start_line: 3, end_line: 3 };
  const before = structuredClone({ source: SOURCE, target, inputs });
  assert.deepEqual(select(target, inputs), expected);
  assert.deepEqual(select(target, [...inputs].reverse()), expected);
  assert.deepEqual(select(target, [occurrence(outer.range, outer.enclosing_range, 3)]), expected);
  assert.deepEqual({ source: SOURCE, target, inputs }, before);
});

test("keeps complete outer-function signature and body", () => {
  const text = "function outer() {\n  function inner() {\n    return 1;\n  }\n}\nnext();\n";
  const source = decodeCommittedSource(Buffer.from(text));
  const definitions = [
    occurrence({ start_line: 1, end_line: 1 }, { start_line: 1, end_line: 5 }),
    occurrence({ start_line: 2, end_line: 2 }, { start_line: 2, end_line: 4 })
  ];
  assert.deepEqual(select({ start_line: 3, end_line: 3 }, definitions, source), {
    state: "available", kind: "enclosing_definition", start_line: 1, end_line: 5,
    line_count: 5, source_text: "function outer() {\n  function inner() {\n    return 1;\n  }\n}\n",
    selection_basis: ["enclosing_definition"]
  });
});

test("crossing target scopes fail to the complete file", () => {
  const definitions = [
    occurrence({ start_line: 2, end_line: 2 }, { start_line: 1, end_line: 4 }),
    occurrence({ start_line: 3, end_line: 3 }, { start_line: 2, end_line: 5 })
  ];
  assert.deepEqual(select({ start_line: 3, end_line: 3 }, definitions), {
    state: "available", kind: "complete_file", start_line: 1, end_line: 6,
    line_count: 6, source_text: TEXT, selection_basis: ["crossing_enclosing_ranges"]
  });
});

test("ignores bad metadata while retaining a valid enclosing candidate", () => {
  const valid = occurrence({ start_line: 2, end_line: 2 }, { start_line: 2, end_line: 4 });
  const definitions = [
    occurrence({ start_line: 0, end_line: 1 }, { start_line: 1, end_line: 5 }),
    occurrence({ start_line: 2, end_line: 2 }, null),
    occurrence({ start_line: 2, end_line: 2 }, { start_line: 2, end_line: 99 }),
    occurrence({ start_line: 4, end_line: 4 }, { start_line: 5, end_line: 5 }), valid
  ];
  const expected = {
    state: "available", kind: "enclosing_definition", start_line: 2, end_line: 4,
    line_count: 3, source_text: "  method() {\n    return 1;\n  }\n",
    selection_basis: ["enclosing_definition", "invalid_definition_range",
      "absent_enclosing_range", "invalid_enclosing_range"]
  };
  assert.deepEqual(select({ start_line: 3, end_line: 3 }, definitions), expected);
  assert.deepEqual(select({ start_line: 3, end_line: 3 }, [...definitions].reverse()), expected);
});

test("preserves CRLF and non-ASCII through an unterminated selected final line", () => {
  const source = decodeCommittedSource(Buffer.from("a\r\nclass 雪 {\r\n}"));
  assert.deepEqual(select({ start_line: 3, end_line: 3 }, [
    occurrence({ start_line: 2, end_line: 2 }, { start_line: 2, end_line: 3 })
  ], source), {
    state: "available", kind: "enclosing_definition", start_line: 2, end_line: 3,
    line_count: 2, source_text: "class 雪 {\r\n}", selection_basis: ["enclosing_definition"]
  });
});

test("uses explicit complete-file reasons without fabricating source", () => {
  assert.deepEqual(select(null, []), {
    state: "available", kind: "complete_file", start_line: 1, end_line: 6,
    line_count: 6, source_text: TEXT, selection_basis: ["invalid_target_range"]
  });
  assert.deepEqual(select({ start_line: 3, end_line: 3 }, [
    occurrence({ start_line: 2, end_line: 2 }, { start_line: 1, end_line: 5 }, 2)
  ]), {
    state: "available", kind: "complete_file", start_line: 1, end_line: 6,
    line_count: 6, source_text: TEXT, selection_basis: ["enclosing_scope_unavailable"]
  });
  assert.deepEqual(select(null, [], decodeCommittedSource(Buffer.alloc(0))), {
    state: "available", kind: "complete_file", start_line: null, end_line: null,
    line_count: 0, source_text: "", selection_basis: ["empty_file"]
  });
  assert.deepEqual(select({ start_line: 1, end_line: 1 }, [],
    { state: "unavailable", reason: "invalid_utf8" }),
  { state: "unavailable", reason: "invalid_utf8" });
});

test("retained absolute line selection preserves BOM, Unicode and CRLF without clamping", () => {
  const region = { source_text: "\ufeff雪\r\n🙂 line\r\ntail", start_line: 20, end_line: 22 };
  assert.equal(selectRetainedSourceLines(region, { start_line: 20, end_line: 21 }),
    "\ufeff雪\r\n🙂 line\r\n");
  assert.equal(selectRetainedSourceLines(region, { start_line: 22, end_line: 22 }), "tail");
  for (const lines of [{ start_line: 19, end_line: 20 }, { start_line: 22, end_line: 23 },
    { start_line: 21, end_line: 20 }]) {
    assert.throws(() => selectRetainedSourceLines(region, lines), RangeError);
  }
  assert.equal(region.source_text, "\ufeff雪\r\n🙂 line\r\ntail");
});
