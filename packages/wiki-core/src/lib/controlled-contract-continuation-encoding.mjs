import {
  CONTROLLED_CONTRACT_MAX_JSON_BYTES,
  digestBytes,
  fail
} from "./controlled-contract-tool-shared.mjs";

export const CONTROLLED_CONTRACT_CONTINUATION_PROJECTION_CAPACITY = 4;

export const CONTROLLED_CONTRACT_CONTINUATION_MAX_BYTES =
  CONTROLLED_CONTRACT_CONTINUATION_PROJECTION_CAPACITY *
  CONTROLLED_CONTRACT_MAX_JSON_BYTES;

export const CONTROLLED_CONTRACT_CONTINUATION_BUDGET = Object.freeze({
  maximum_bytes: CONTROLLED_CONTRACT_CONTINUATION_MAX_BYTES,
  measurement: "compact_utf8_bytes",
  projection_capacity: CONTROLLED_CONTRACT_CONTINUATION_PROJECTION_CAPACITY,
  per_projection_bytes: CONTROLLED_CONTRACT_MAX_JSON_BYTES,
  derivation:
    "projection_capacity * per_projection_bytes; measured on the compact store " +
    "encoding, never on the pretty identity input"
});

function continuationEncodingFailure(code, message, details = {}) {
  fail(`controlled_contract_authoring_continuation_${code}`, message, details);
}

function compactText(value) {
  let text;
  try {
    text = `${JSON.stringify(value)}\n`;
  } catch {
    continuationEncodingFailure("invalid",
      "continuation content must be bounded JSON data");
  }
  if (text === "undefined\n") continuationEncodingFailure("invalid",
    "continuation content must be bounded JSON data");
  return text;
}

function assertContinuationBudget(compactBytes) {
  if (compactBytes.byteLength > CONTROLLED_CONTRACT_CONTINUATION_MAX_BYTES) {
    continuationEncodingFailure("too_large",
      "durable continuation exceeds its continuation-specific byte budget", {
        changed: false,
        byte_length: compactBytes.byteLength,
        ...CONTROLLED_CONTRACT_CONTINUATION_BUDGET
      });
  }
  return compactBytes;
}

export function continuationStorageBytes(value) {
  return assertContinuationBudget(Buffer.from(compactText(value), "utf8"));
}

export function continuationIdentityBytes(value) {
  assertContinuationBudget(Buffer.from(compactText(value), "utf8"));
  let text;
  try {
    text = `${JSON.stringify(value, null, 2)}\n`;
  } catch {
    continuationEncodingFailure("invalid",
      "continuation content must be bounded JSON data");
  }
  return Buffer.from(text, "utf8");
}

export function continuationContentDigest(value) {
  return digestBytes(continuationIdentityBytes(value));
}
