import assert from "node:assert/strict";
import test from "node:test";

import { decodeCommittedSource } from
  "../../packages/wiki-core/src/lib/sidecar-source-regions.mjs";

function available(bytes, expected) {
  const result = decodeCommittedSource(bytes);
  assert.deepEqual(result, { state: "available", ...expected });
  assert.deepEqual(Buffer.from(result.source_text, "utf8"), bytes);
}

test("decodes exact UTF-8 bytes and reports UTF-16 line starts", () => {
  available(Buffer.from("alpha\n雪\r\nomega\r", "utf8"), {
    source_text: "alpha\n雪\r\nomega\r",
    line_count: 3,
    line_starts: [0, 6, 9]
  });
  available(Buffer.from("🌍\nx", "utf8"), {
    source_text: "🌍\nx",
    line_count: 2,
    line_starts: [0, 3]
  });
});

test("preserves BOM, lone CR, final unterminated bytes, and no phantom line", () => {
  available(Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0x0a]), {
    source_text: "\ufeffa\n",
    line_count: 1,
    line_starts: [0]
  });
  available(Buffer.from("one\rtwo", "utf8"), {
    source_text: "one\rtwo",
    line_count: 1,
    line_starts: [0]
  });
  available(Buffer.from("one\ntwo", "utf8"), {
    source_text: "one\ntwo",
    line_count: 2,
    line_starts: [0, 4]
  });
});

test("distinguishes empty and BOM-only files", () => {
  available(Buffer.alloc(0), { source_text: "", line_count: 0, line_starts: [] });
  available(Buffer.from([0xef, 0xbb, 0xbf]), {
    source_text: "\ufeff",
    line_count: 1,
    line_starts: [0]
  });
});

test("reports binary and malformed UTF-8 without replacement text", () => {
  assert.deepEqual(decodeCommittedSource(Buffer.from([0x61, 0x00, 0xff])), {
    state: "unavailable", reason: "binary_source"
  });
  for (const bytes of [Buffer.from([0x80]), Buffer.from([0xe2, 0x82])]) {
    assert.deepEqual(decodeCommittedSource(bytes), {
      state: "unavailable", reason: "invalid_utf8"
    });
  }
});

test("requires a Buffer", () => {
  for (const value of ["text", new Uint8Array([1]), null, undefined]) {
    assert.throws(() => decodeCommittedSource(value), TypeError);
  }
});
