import { deflateSync, inflateSync } from "node:zlib";

export const SIDECAR_STORE_PAYLOAD_MAX_DECODED_BYTES = 32 * 1024 * 1024;

const HEADER_BYTES = 4;
const DEFLATE_LEVEL = 6;
const utf8 = new TextDecoder("utf-8", { fatal: true });

function deflateBound(length) {
  return length + (length >>> 12) + (length >>> 14) + (length >>> 25) + 13;
}

export const SIDECAR_STORE_PAYLOAD_MAX_ENCODED_BYTES =
  HEADER_BYTES + deflateBound(SIDECAR_STORE_PAYLOAD_MAX_DECODED_BYTES);

function invalidPayload(message, cause = null) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = "sidecar_selected_data_invalid";
  return error;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) sorted[key] = canonicalValue(value[key]);
    }
    return sorted;
  }
  return value;
}

function assertExpectedShape(value, expect, label) {
  const isArray = Array.isArray(value);
  if (expect === "array" ? !isArray : (!value || typeof value !== "object" || isArray)) {
    throw invalidPayload(`${label} payload must decode to ${expect === "array" ? "an array" : "an object"}`);
  }
  return value;
}

export function encodeSidecarStorePayload(value, label = "sidecar store") {
  if (!value || typeof value !== "object") {
    throw new TypeError(`${label} payload must be an object or array`);
  }
  const text = JSON.stringify(canonicalValue(value));
  const raw = Buffer.from(text, "utf8");
  if (raw.byteLength > SIDECAR_STORE_PAYLOAD_MAX_DECODED_BYTES) {
    const error = new Error(
      `${label} payload is ${raw.byteLength} bytes; the limit is ${SIDECAR_STORE_PAYLOAD_MAX_DECODED_BYTES}`
    );
    error.code = "sidecar_store_payload_too_large";
    throw error;
  }
  const stream = deflateSync(raw, { level: DEFLATE_LEVEL });
  if (stream.byteLength > deflateBound(raw.byteLength)) {
    throw new Error(`${label} payload compressed beyond the Deflate bound`);
  }
  const payload = Buffer.allocUnsafe(HEADER_BYTES + stream.byteLength);
  payload.writeUInt32BE(raw.byteLength, 0);
  stream.copy(payload, HEADER_BYTES);
  return payload;
}

export function decodeSidecarStorePayload(bytes, label = "sidecar store", { expect = "object" } = {}) {
  if (!(bytes instanceof Uint8Array)) throw invalidPayload(`${label} payload is not a BLOB`);
  if (bytes.byteLength <= HEADER_BYTES || bytes.byteLength > SIDECAR_STORE_PAYLOAD_MAX_ENCODED_BYTES) {
    throw invalidPayload(`${label} payload length ${bytes.byteLength} is invalid`);
  }
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declared = buffer.readUInt32BE(0);
  if (declared === 0 || declared > SIDECAR_STORE_PAYLOAD_MAX_DECODED_BYTES ||
      bytes.byteLength - HEADER_BYTES > deflateBound(declared)) {
    throw invalidPayload(`${label} payload declares an invalid length ${declared}`);
  }
  let raw;
  try {
    raw = inflateSync(buffer.subarray(HEADER_BYTES), { maxOutputLength: declared });
  } catch (cause) {
    throw invalidPayload(`${label} payload is not a valid bounded Deflate stream`, cause);
  }
  if (raw.byteLength !== declared) {
    throw invalidPayload(`${label} payload decoded ${raw.byteLength} bytes, expected ${declared}`);
  }
  let value;
  try {
    value = JSON.parse(utf8.decode(raw));
  } catch (cause) {
    throw invalidPayload(`${label} payload is not valid UTF-8 JSON`, cause);
  }
  return assertExpectedShape(value, expect, label);
}

export function sameSidecarStorePayload(left, right) {
  if (left === null || left === undefined || right === null || right === undefined) {
    return (left ?? null) === (right ?? null);
  }
  return Buffer.compare(left, right) === 0;
}
