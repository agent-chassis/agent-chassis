import { isDeepStrictEqual } from "node:util";
import { isRuntimeBlockerCode } from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
export function sameJson(left, right) {
  return isDeepStrictEqual(left, right);
}
export const PROCESS_ERROR_GUARDS_INSTALLED = Symbol.for(
  "agent-chassis.wiki-mcp.process-error-guards-installed"
);

export const SPILLED_RESPONSE_SCHEMA_VERSION = "wiki-mcp-spilled-response.v1";
export const CONTENT_REFERENCE_READ_SCHEMA_VERSION = "wiki-mcp-content-reference-read.v1";
export const CONTENT_REFERENCE_KIND = "wiki_mcp_response_content_reference";
export const REFACTOR_ITEM_REFERENCE_SCHEMA_VERSION =
  "controlled-contract-refactor-item-reference.v1";
export const CONTENT_REFERENCE_READ_REFUSAL_SCHEMA_VERSION =
  "wiki-mcp-content-reference-read-refusal.v1";
export const CONTENT_REFERENCE_RANGED_READ_UNAVAILABLE_CODE =
  "mcp_response.content_reference_ranged_read_unavailable.v1";

export const RESPONSE_REFUSAL_SCHEMA_VERSION = "mcp-response-refusal.v1";
export const SPILL_PERSISTENCE_FAILED_CODE = "mcp_response.spill_persistence_failed.v1";

for (const code of [
  SPILL_PERSISTENCE_FAILED_CODE,
  CONTENT_REFERENCE_RANGED_READ_UNAVAILABLE_CODE
]) {
  if (!isRuntimeBlockerCode(code)) {
    throw new Error(
      `mcp-response publishes ${code}, which is not registered in runtime-blocker-codes.v1.json`
    );
  }
}

export const SPILLED_ENVELOPE_FIELDS = Object.freeze([
  "schema_version", "response_spilled", "reason", "inline_byte_limit", "total_bytes",
  "measurement", "preview", "content_reference"
]);
export const CONTENT_REFERENCE_FIELDS = Object.freeze([
  "kind", "ref_id", "media_type", "encoding", "byte_count", "sha256", "read_tool", "range"
]);
export const CONTENT_REFERENCE_READ_TOOL = "workspace_read_mcp_content_reference";

export const VERIFY_PROOF_SUMMARY_SCHEMA_VERSION = "workspace-verify-proof-summary.v1";
export const VERIFY_PROOF_EVIDENCE_SCHEMA_VERSION = "workspace-verify-proof-aggregate.v1";
export const RESULT_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;

export const SPILL_MEASUREMENT_SCHEMA_VERSION = "mcp-response-spill-measurement.v2";
export const RETAINED_PAYLOAD_ENCODING = "application/json; charset=utf-8; indent=2";
export const SPILL_MEASUREMENT_FIELDS = Object.freeze([
  "schema_version", "compared", "admission_bytes", "serialized_result_bytes",
  "inline_byte_limit", "retained_payload_bytes", "retained_payload_encoding", "meaning"
]);
export const SPILL_COMPARISONS = Object.freeze({

  MEASURED: "admission_bytes_exceeded_inline_byte_limit",

  FORCED: "not_compared_retention_forced"
});

export function spillMeasurement({ comparison, inlineByteLimit, retainedPayloadBytes }) {
  return {
    schema_version: SPILL_MEASUREMENT_SCHEMA_VERSION,
    compared: comparison === null ? SPILL_COMPARISONS.FORCED : SPILL_COMPARISONS.MEASURED,
    admission_bytes: comparison?.admissionBytes ?? null,
    serialized_result_bytes: comparison?.serializedResultBytes ?? null,
    inline_byte_limit: inlineByteLimit,
    retained_payload_bytes: retainedPayloadBytes,
    retained_payload_encoding: RETAINED_PAYLOAD_ENCODING,
    meaning: comparison === null
      ? "no inline admission comparison occurred: the producer forced retention, so " +
        "admission_bytes and serialized_result_bytes are null. total_bytes and " +
        "retained_payload_bytes measure the persisted indented payload."
      : "inline admission compares admission_bytes — the larger of the UTF-8 bytes of compact " +
        "structuredContent and of its delivered text, plus any nonmirrored content and protocol " +
        "metadata — against inline_byte_limit. serialized_result_bytes is the physical size of the " +
        "complete serialized CallToolResult and was not compared. total_bytes and " +
        "retained_payload_bytes measure only the persisted indented payload."
  };
}

export const SPILLED_REASON = "response_exceeds_inline_byte_limit";

export const SPILLED_REF_ID_PREFIX = "resp-";

export const RETAINED_REF_ID_PATTERN = /^[A-Za-z0-9_-]{8}$/u;
export const DEFAULT_INLINE_BYTE_LIMIT = 128 * 1024;
export const DEFAULT_PREVIEW_BYTE_LIMIT = 2048;
export const MIN_INLINE_BYTE_LIMIT = 8 * 1024;
export const MAX_REFERENCE_READ_BYTE_LIMIT = 64 * 1024;
export const REF_ID_PATTERN = /^[a-zA-Z0-9._-]+$/;

export const RESPONSE_BOUNDARY_ROUTE = "mcp_response";

export function hasExactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    sameJson(Object.keys(value).sort(), [...keys].sort());
}

export function isPositiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

export function isLosslessMcpSpillDelivery(result) {
  if (result === null || typeof result !== "object" || Array.isArray(result)) return false;
  const envelope = result.structuredContent;
  if (!isSpilledEnvelope(envelope) || !hasExactKeys(envelope, SPILLED_ENVELOPE_FIELDS) ||
      !hasOnlyGeneratedTextCarrier(result)) {
    return false;
  }
  const { preview, content_reference: reference } = envelope;
  const previewFields = preview?.omitted === true ? ["text", "bytes", "omitted"] : ["text", "bytes"];
  if (envelope.reason !== SPILLED_REASON ||
      !isPositiveSafeInteger(envelope.inline_byte_limit) ||
      !isPositiveSafeInteger(envelope.total_bytes) ||
      !isMintedSpillMeasurement(envelope.measurement, envelope) ||
      !hasExactKeys(preview, previewFields) || typeof preview.text !== "string" ||
      !Number.isSafeInteger(preview.bytes) || preview.bytes < 0) {
    return false;
  }
  return isMintedContentReference(reference, envelope.total_bytes);
}

export function isMintedSpillMeasurement(measurement, envelope) {
  if (!hasExactKeys(measurement, SPILL_MEASUREMENT_FIELDS)) return false;
  const compared = measurement.compared === SPILL_COMPARISONS.MEASURED;
  return measurement.schema_version === SPILL_MEASUREMENT_SCHEMA_VERSION &&
    (compared || measurement.compared === SPILL_COMPARISONS.FORCED) &&
    (compared
      ? isPositiveSafeInteger(measurement.admission_bytes) &&
        measurement.admission_bytes > envelope.inline_byte_limit &&
        isPositiveSafeInteger(measurement.serialized_result_bytes)
      : measurement.admission_bytes === null && measurement.serialized_result_bytes === null) &&
    measurement.inline_byte_limit === envelope.inline_byte_limit &&
    measurement.retained_payload_bytes === envelope.total_bytes &&
    measurement.retained_payload_encoding === RETAINED_PAYLOAD_ENCODING &&
    typeof measurement.meaning === "string" && measurement.meaning.length > 0;
}

export function isMintedContentReference(reference, totalBytes) {
  return hasExactKeys(reference, CONTENT_REFERENCE_FIELDS) &&
    reference.kind === CONTENT_REFERENCE_KIND &&
    typeof reference.ref_id === "string" &&
    RETAINED_REF_ID_PATTERN.test(reference.ref_id) &&
    reference.media_type === "application/json" && reference.encoding === "utf8" &&
    isPositiveSafeInteger(totalBytes) && reference.byte_count === totalBytes &&
    typeof reference.sha256 === "string" && /^[a-f0-9]{64}$/u.test(reference.sha256) &&
    reference.read_tool === CONTENT_REFERENCE_READ_TOOL &&
    hasExactKeys(reference.range, ["offset", "length", "max_length"]) &&
    reference.range.offset === 0 &&
    isPositiveSafeInteger(reference.range.length) &&
    isPositiveSafeInteger(reference.range.max_length) &&
    reference.range.length <= reference.range.max_length &&
    reference.range.length <= totalBytes;
}

export function hasOnlyGeneratedTextCarrier(result) {
  return Array.isArray(result?.content) && result.content.length === 1 &&
    hasExactKeys(result.content[0], ["type", "text"]) &&
    result.content[0].type === "text" &&
    result.content[0].text === JSON.stringify(result.structuredContent);
}

export function isSpilledEnvelope(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.schema_version === SPILLED_RESPONSE_SCHEMA_VERSION &&
    value.response_spilled === true
  );
}

