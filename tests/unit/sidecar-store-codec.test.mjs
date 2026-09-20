import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync } from "node:zlib";

import {
  decodeSidecarStorePayload,
  encodeSidecarStorePayload,
  sameSidecarStorePayload,
  SIDECAR_STORE_PAYLOAD_MAX_DECODED_BYTES
} from "../../packages/wiki-core/src/lib/sidecar-store-codec.mjs";

function framed(declaredLength, stream) {
  const bytes = Buffer.alloc(4 + stream.byteLength);
  bytes.writeUInt32BE(declaredLength, 0);
  stream.copy(bytes, 4);
  return bytes;
}

test("residuals round-trip through compressed canonical JSON with stable bytes", () => {
  const value = { z: [1, "😀", { b: null, a: true }], a: { repeated: "residual ".repeat(512) } };
  const encoded = encodeSidecarStorePayload(value, "fixture");
  assert.ok(encoded.byteLength < JSON.stringify(value).length / 10,
    "repetitive residual data is stored compressed");
  assert.deepEqual(decodeSidecarStorePayload(encoded, "fixture"), value);
  const reordered = { a: { repeated: "residual ".repeat(512) }, z: [1, "😀", { a: true, b: null }] };
  assert.equal(sameSidecarStorePayload(encodeSidecarStorePayload(reordered, "fixture"), encoded), true,
    "equal values encode to identical bytes");
  assert.deepEqual(decodeSidecarStorePayload(encodeSidecarStorePayload([1, 2], "list"), "list",
    { expect: "array" }), [1, 2]);
  assert.equal(sameSidecarStorePayload(null, undefined), true);
  assert.equal(sameSidecarStorePayload(encoded, null), false);
});

test("a payload above the decoded limit is refused before compression", () => {
  const oversized = { text: "x".repeat(SIDECAR_STORE_PAYLOAD_MAX_DECODED_BYTES) };
  assert.throws(() => encodeSidecarStorePayload(oversized, "oversized"),
    { code: "sidecar_store_payload_too_large" });
});

test("corrupt, truncated, mislabelled and overflowing payloads fail as selected data", () => {
  const encoded = encodeSidecarStorePayload({ value: "selected" }, "fixture");
  const flipped = Buffer.from(encoded);
  flipped[flipped.length - 1] ^= 0xff;
  const wrongLength = Buffer.from(encoded);
  wrongLength.writeUInt32BE(encoded.readUInt32BE(0) + 1, 0);
  const expanding = framed(1000, deflateSync(Buffer.from(JSON.stringify({ text: "y".repeat(1024) }))));
  const overLimit = Buffer.from(encoded);
  overLimit.writeUInt32BE(SIDECAR_STORE_PAYLOAD_MAX_DECODED_BYTES + 1, 0);
  const invalidUtf8 = framed(2, deflateSync(Buffer.from([0xc3, 0x28])));
  for (const bytes of [flipped, encoded.subarray(0, encoded.length - 3), wrongLength, expanding,
    overLimit, invalidUtf8, Buffer.alloc(4), "not bytes"]) {
    assert.throws(() => decodeSidecarStorePayload(bytes, "fixture"),
      { code: "sidecar_selected_data_invalid" });
  }
  assert.throws(() => decodeSidecarStorePayload(encodeSidecarStorePayload([1], "list"), "list"),
    { code: "sidecar_selected_data_invalid" });
});
