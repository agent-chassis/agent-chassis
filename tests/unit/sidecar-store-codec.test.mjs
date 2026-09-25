import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync } from "node:zlib";

import {
  decodeSidecarStorePayload,
  encodePreparedSidecarStorePayload,
  encodeSidecarStorePayload,
  prepareSidecarStorePayload,
  readSidecarStorePayload,
  reuseOrEncodeSidecarStorePayload,
  samePreparedSidecarStorePayload,
  sameSidecarStorePayload,
  SIDECAR_STORE_PAYLOAD_MAX_DECODED_BYTES
} from "../../packages/wiki-core/src/lib/sidecar-store-codec.mjs";
import { observeStoreCompression } from "../helpers/sidecar-store-compression-observer.mjs";

const RAW = 0;
const DEFLATE = 1;

function frame(mode, declaredLength, body) {
  const bytes = Buffer.alloc(5 + body.byteLength);
  bytes.writeUInt8(mode, 0);
  bytes.writeUInt32BE(declaredLength, 1);
  Buffer.from(body).copy(bytes, 5);
  return bytes;
}

function sizedValue(bytes, unit = "x") {
  const width = Buffer.byteLength(unit);
  const room = bytes - Buffer.byteLength('{"t":""}');
  return { t: unit.repeat(Math.floor(room / width)) + "x".repeat(room % width) };
}

const large = { z: [1, "😀", { b: null, a: true }], a: { repeated: "residual ".repeat(512) } };

test("residuals round-trip through compressed canonical JSON with stable bytes", () => {
  const encoded = encodeSidecarStorePayload(large, "fixture");
  assert.equal(encoded[0], DEFLATE);
  assert.ok(encoded.byteLength < JSON.stringify(large).length / 10,
    "repetitive residual data is stored compressed");
  assert.deepEqual(decodeSidecarStorePayload(encoded, "fixture"), large);
  const reordered = { a: { repeated: "residual ".repeat(512) }, z: [1, "😀", { a: true, b: null }] };
  assert.equal(sameSidecarStorePayload(encodeSidecarStorePayload(reordered, "fixture"), encoded), true,
    "equal values encode to identical bytes");
  const small = encodeSidecarStorePayload([1, 2], "list");
  assert.deepEqual(small, frame(RAW, 5, Buffer.from("[1,2]")), "small payloads are stored raw");
  assert.deepEqual(decodeSidecarStorePayload(small, "list", { expect: "array" }), [1, 2]);
  assert.equal(sameSidecarStorePayload(null, undefined), true);
  assert.equal(sameSidecarStorePayload(encoded, null), false);
});

test("payload mode follows the 2048-byte canonical UTF-8 boundary", (t) => {
  const observer = observeStoreCompression(t);
  let compressions = 0;
  for (const unit of ["x", "é", "€", "😀"]) {
    for (const bytes of [2047, 2048, 2049]) {
      const value = sizedValue(bytes, unit);
      const prepared = prepareSidecarStorePayload(value, "boundary");
      assert.equal(prepared.raw.byteLength, bytes, `${unit} ${bytes}`);
      const encoded = encodePreparedSidecarStorePayload(prepared);
      const mode = bytes < 2048 ? RAW : DEFLATE;
      compressions += mode;
      assert.equal(encoded[0], mode, `${unit} ${bytes} bytes selects mode ${mode}`);
      assert.equal(encoded.readUInt32BE(1), bytes, "the header declares canonical UTF-8 bytes");
      assert.equal(observer.inputs().length, compressions,
        `${unit} ${bytes} bytes is compressed ${mode} times`);
      if (mode === RAW) assert.deepEqual(encoded.subarray(5), prepared.raw);
      else assert.deepEqual(observer.inputs().at(-1), prepared.raw, "Deflate receives the canonical bytes");
      const read = readSidecarStorePayload(encoded, "boundary");
      assert.deepEqual(read.value, value);
      assert.deepEqual(read.raw, prepared.raw);
    }
  }
});

test("a payload above the decoded limit is refused before compression", (t) => {
  const observer = observeStoreCompression(t);
  const oversized = { text: "x".repeat(SIDECAR_STORE_PAYLOAD_MAX_DECODED_BYTES) };
  assert.throws(() => encodeSidecarStorePayload(oversized, "oversized"),
    { code: "sidecar_store_payload_too_large" });
  assert.equal(observer.inputs().length, 0);
});

test("corrupt, truncated, mislabelled and overflowing payloads fail as selected data", () => {
  const compressed = encodeSidecarStorePayload(large, "fixture");
  assert.equal(compressed[0], DEFLATE, "compressed cases exercise the Deflate branch");
  const flipped = Buffer.from(compressed);
  flipped[flipped.length - 1] ^= 0xff;
  const wrongLength = Buffer.from(compressed);
  wrongLength.writeUInt32BE(compressed.readUInt32BE(1) + 1, 1);
  const expanding = frame(DEFLATE, 3000,
    deflateSync(Buffer.from(JSON.stringify({ text: "y".repeat(5000) }))));
  const overLimit = Buffer.from(compressed);
  overLimit.writeUInt32BE(SIDECAR_STORE_PAYLOAD_MAX_DECODED_BYTES + 1, 1);
  const invalidUtf8 = Buffer.alloc(2048, 0xff);
  const notJson = Buffer.from("x".repeat(2048));
  const smallJson = Buffer.from(JSON.stringify({ value: "selected" }));
  const raw = encodeSidecarStorePayload({ value: "selected" }, "fixture");
  assert.equal(raw[0], RAW);
  const rawFlippedLength = Buffer.from(raw);
  rawFlippedLength.writeUInt32BE(raw.readUInt32BE(1) + 1, 1);
  const legacy = Buffer.alloc(4 + deflateSync(smallJson).byteLength);
  legacy.writeUInt32BE(smallJson.byteLength, 0);
  deflateSync(smallJson).copy(legacy, 4);
  const cases = {
    "Deflate body corrupted": flipped,
    "Deflate body truncated": compressed.subarray(0, compressed.length - 3),
    "Deflate length mismatch": wrongLength,
    "Deflate expands past its declared length": expanding,
    "declared length over the limit": overLimit,
    "Deflate of invalid UTF-8": frame(DEFLATE, 2048, deflateSync(invalidUtf8)),
    "Deflate of non-JSON": frame(DEFLATE, 2048, deflateSync(notJson)),
    "Deflate below the raw threshold": frame(DEFLATE, smallJson.byteLength, deflateSync(smallJson)),
    "raw at the Deflate threshold": frame(RAW, 2048, Buffer.from(JSON.stringify(sizedValue(2048)))),
    "raw length mismatch": rawFlippedLength,
    "raw body truncated": raw.subarray(0, raw.length - 2),
    "raw zero length": frame(RAW, 0, Buffer.alloc(0)),
    "raw invalid UTF-8": frame(RAW, 2, Buffer.from([0xc3, 0x28])),
    "raw non-JSON": frame(RAW, 3, Buffer.from("abc")),
    "unknown mode": frame(2, smallJson.byteLength, smallJson),
    "previous four-byte frame": legacy,
    "header only": Buffer.alloc(5),
    "short header": Buffer.alloc(3),
    "not bytes": "not bytes"
  };
  for (const [label, bytes] of Object.entries(cases)) {
    assert.throws(() => decodeSidecarStorePayload(bytes, "fixture"),
      { code: "sidecar_selected_data_invalid" }, label);
  }
  for (const value of [[1], [large]]) {
    assert.throws(() => decodeSidecarStorePayload(encodeSidecarStorePayload(value, "list"), "list"),
      { code: "sidecar_selected_data_invalid" }, "the wrong top-level shape is refused in both modes");
  }
});

test("prepared payloads compare canonical bytes with validated stored bytes", () => {
  for (const [label, filler] of [["raw", "x"], ["Deflate", "x".repeat(4096)]]) {
    const value = { b: [1, { d: filler, c: null }], a: "😀", skipped: undefined };
    const prepared = prepareSidecarStorePayload(value, "fixture");
    const stored = encodeSidecarStorePayload(value, "fixture");
    assert.equal(stored[0], label === "raw" ? RAW : DEFLATE);
    assert.deepEqual(encodePreparedSidecarStorePayload(prepared), stored,
      `${label}: encoding frames the one prepared canonical form`);
    const read = readSidecarStorePayload(stored, "fixture");
    assert.deepEqual(read.value, { a: "😀", b: [1, { c: null, d: filler }] });
    assert.deepEqual(read.raw, prepared.raw, `${label}: the original decoded bytes are retained`);
    assert.equal(samePreparedSidecarStorePayload(
      prepareSidecarStorePayload({ a: "😀", b: [1, { c: null, d: filler }] }, "fixture"), read), true,
    `${label}: object key order is not significant`);
    for (const different of [
      { a: "😀", b: [{ d: filler, c: null }, 1] },
      { a: "😀", b: ["1", { d: filler, c: null }] },
      { a: "😀", b: [1, { d: filler, c: null }], extra: null }
    ]) {
      assert.equal(samePreparedSidecarStorePayload(prepareSidecarStorePayload(different, "fixture"), read),
        false, `${label}: ${JSON.stringify(different).slice(0, 60)}`);
    }
  }
});

test("reuse returns the stored BLOB without compression and compresses a change once", (t) => {
  const small = encodeSidecarStorePayload({ z: 1, a: [2, 3] }, "fixture");
  const big = encodeSidecarStorePayload({ z: 1, a: "b".repeat(4096) }, "fixture");
  assert.deepEqual([small[0], big[0]], [RAW, DEFLATE]);
  const observer = observeStoreCompression(t);
  const reuse = (value, stored) =>
    reuseOrEncodeSidecarStorePayload(prepareSidecarStorePayload(value, "fixture"), stored);
  assert.equal(reuse({ a: [2, 3], z: 1 }, small), small);
  assert.equal(reuse({ a: "b".repeat(4096), z: 1 }, big), big);
  assert.equal(observer.inputs().length, 0, "equal payloads of either mode are never compressed");
  const changedSmall = reuse({ a: [2, 3], z: "1" }, small);
  assert.equal(observer.inputs().length, 0, "a changed small payload is stored raw");
  const changedBig = reuse({ a: "b".repeat(4096), z: "1" }, big);
  assert.equal(observer.inputs().length, 1, "a changed large payload is compressed exactly once");
  const freshSmall = reuse({ a: 1 }, null);
  const freshBig = reuse({ a: "c".repeat(4096) }, null);
  assert.equal(observer.inputs().length, 2, "a new large payload is compressed exactly once");
  observer.restore();
  assert.deepEqual(decodeSidecarStorePayload(changedSmall, "fixture"), { a: [2, 3], z: "1" });
  assert.deepEqual(decodeSidecarStorePayload(changedBig, "fixture"), { a: "b".repeat(4096), z: "1" });
  assert.deepEqual(freshSmall, encodeSidecarStorePayload({ a: 1 }, "fixture"));
  assert.deepEqual(freshBig, encodeSidecarStorePayload({ a: "c".repeat(4096) }, "fixture"));
});

test("comparison keeps incoming and stored error taxonomy", () => {
  assert.throws(() => prepareSidecarStorePayload("text", "incoming"), TypeError);
  assert.throws(() => prepareSidecarStorePayload(
    { text: "x".repeat(SIDECAR_STORE_PAYLOAD_MAX_DECODED_BYTES) }, "incoming"),
  { code: "sidecar_store_payload_too_large" });
  for (const value of [{ value: "selected" }, { value: "selected".repeat(512) }]) {
    const prepared = prepareSidecarStorePayload(value, "fixture");
    const corrupt = Buffer.from(encodeSidecarStorePayload(value, "fixture"));
    corrupt[corrupt.length - 1] ^= 0xff;
    for (const stored of [corrupt, frame(RAW, 2, Buffer.from([0xc3, 0x28])),
      encodeSidecarStorePayload(["selected"], "list"),
      encodeSidecarStorePayload({ value: "other" }, "fixture").subarray(0, 7)]) {
      assert.throws(() => reuseOrEncodeSidecarStorePayload(prepared, stored),
        { code: "sidecar_selected_data_invalid" },
        "stored framing, body, UTF-8, JSON and top-level shape are validated even when unequal");
    }
  }
});
