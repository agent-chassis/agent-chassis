import { deflateSync, inflateSync } from "node:zlib";

export const SIDECAR_STORE_PAYLOAD_MAX_DECODED_BYTES = 32 * 1024 * 1024;

const HEADER_BYTES = 5;
const MODE_RAW = 0;
const MODE_DEFLATE = 1;
const RAW_BELOW_BYTES = 2048;
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

export function prepareSidecarStorePayload(value, label = "sidecar store") {
  if (!value || typeof value !== "object") {
    throw new TypeError(`${label} payload must be an object or array`);
  }
  const raw = Buffer.from(JSON.stringify(canonicalValue(value)), "utf8");
  if (raw.byteLength > SIDECAR_STORE_PAYLOAD_MAX_DECODED_BYTES) {
    const error = new Error(
      `${label} payload is ${raw.byteLength} bytes; the limit is ${SIDECAR_STORE_PAYLOAD_MAX_DECODED_BYTES}`
    );
    error.code = "sidecar_store_payload_too_large";
    throw error;
  }
  return { label, expect: Array.isArray(value) ? "array" : "object", raw };
}

function framed(mode, decodedLength, body) {
  const payload = Buffer.allocUnsafe(HEADER_BYTES + body.byteLength);
  payload.writeUInt8(mode, 0);
  payload.writeUInt32BE(decodedLength, 1);
  body.copy(payload, HEADER_BYTES);
  return payload;
}

export function encodePreparedSidecarStorePayload({ label, raw }) {
  if (raw.byteLength < RAW_BELOW_BYTES) return framed(MODE_RAW, raw.byteLength, raw);
  const stream = deflateSync(raw, { level: DEFLATE_LEVEL });
  if (stream.byteLength > deflateBound(raw.byteLength)) {
    throw new Error(`${label} payload compressed beyond the Deflate bound`);
  }
  return framed(MODE_DEFLATE, raw.byteLength, stream);
}

export function encodeSidecarStorePayload(value, label = "sidecar store") {
  return encodePreparedSidecarStorePayload(prepareSidecarStorePayload(value, label));
}

export function readSidecarStorePayload(bytes, label = "sidecar store", { expect = "object" } = {}) {
  if (!(bytes instanceof Uint8Array)) throw invalidPayload(`${label} payload is not a BLOB`);
  if (bytes.byteLength <= HEADER_BYTES || bytes.byteLength > SIDECAR_STORE_PAYLOAD_MAX_ENCODED_BYTES) {
    throw invalidPayload(`${label} payload length ${bytes.byteLength} is invalid`);
  }
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const mode = buffer.readUInt8(0);
  const declared = buffer.readUInt32BE(1);
  const body = buffer.subarray(HEADER_BYTES);
  let raw;
  if (mode === MODE_RAW) {
    if (declared === 0 || declared >= RAW_BELOW_BYTES || body.byteLength !== declared) {
      throw invalidPayload(`${label} raw payload declares an invalid length ${declared}`);
    }
    raw = body;
  } else if (mode === MODE_DEFLATE) {
    if (declared < RAW_BELOW_BYTES || declared > SIDECAR_STORE_PAYLOAD_MAX_DECODED_BYTES ||
        body.byteLength > deflateBound(declared)) {
      throw invalidPayload(`${label} compressed payload declares an invalid length ${declared}`);
    }
    try {
      raw = inflateSync(body, { maxOutputLength: declared });
    } catch (cause) {
      throw invalidPayload(`${label} payload is not a valid bounded Deflate stream`, cause);
    }
    if (raw.byteLength !== declared) {
      throw invalidPayload(`${label} payload decoded ${raw.byteLength} bytes, expected ${declared}`);
    }
  } else {
    throw invalidPayload(`${label} payload has unknown mode ${mode}`);
  }
  let value;
  try {
    value = JSON.parse(utf8.decode(raw));
  } catch (cause) {
    throw invalidPayload(`${label} payload is not valid UTF-8 JSON`, cause);
  }
  return { value: assertExpectedShape(value, expect, label), raw };
}

export function decodeSidecarStorePayload(bytes, label = "sidecar store", options = {}) {
  return readSidecarStorePayload(bytes, label, options).value;
}

export function samePreparedSidecarStorePayload(prepared, stored) {
  return Buffer.compare(prepared.raw, stored.raw) === 0;
}

export function reuseOrEncodeSidecarStorePayload(prepared, storedBytes) {
  if (storedBytes !== null && storedBytes !== undefined && samePreparedSidecarStorePayload(prepared,
    readSidecarStorePayload(storedBytes, prepared.label, { expect: prepared.expect }))) {
    return storedBytes;
  }
  return encodePreparedSidecarStorePayload(prepared);
}

export function sameSidecarStorePayload(left, right) {
  if (left === null || left === undefined || right === null || right === undefined) {
    return (left ?? null) === (right ?? null);
  }
  return Buffer.compare(left, right) === 0;
}
