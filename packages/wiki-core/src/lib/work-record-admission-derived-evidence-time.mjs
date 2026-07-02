

import {
  cloneJson,
  computeNormalizedInputDigest,
  isNonEmptyString,
  isObject
} from "./work-record-admission-shared.mjs";

export class DerivedEvidenceContractError extends Error {
  constructor(code, message, diagnostics = {}) {
    super(message);
    this.name = "DerivedEvidenceContractError";
    this.code = code;
    this.diagnostics = diagnostics;
  }
}

export const NORMALIZED_REQUEST_OUTPUT_HASH_PLACEHOLDER =
  "sentinel:worker_admission.normalized_request_output_hash_pending.v1";

export function computeNormalizedRequestOutputHash(normalizedRequest) {

  if (!isObject(normalizedRequest)) {
    throw new DerivedEvidenceContractError(
      "normalized_request_output_hash_input_not_object",
      "computeNormalizedRequestOutputHash requires a normalized-request object",
      { received_type: normalizedRequest === null ? "null" : Array.isArray(normalizedRequest) ? "array" : typeof normalizedRequest }
    );
  }
  const body = cloneJson(normalizedRequest);
  if (Array.isArray(body.artifact_refs)) {
    body.artifact_refs = body.artifact_refs.map((ref) =>
      isObject(ref)
        ? { ...ref, produced_by_preparation_output_hash: NORMALIZED_REQUEST_OUTPUT_HASH_PLACEHOLDER }
        : ref
    );
  }
  if (Array.isArray(body.preparation_audit_refs)) {
    body.preparation_audit_refs = body.preparation_audit_refs.map((ref) =>
      isObject(ref)
        ? { ...ref, output_hash: NORMALIZED_REQUEST_OUTPUT_HASH_PLACEHOLDER }
        : ref
    );
  }
  return computeNormalizedInputDigest(body);
}

function normalizeTimeValue(value) {
  if (isNonEmptyString(value)) {
    const trimmed = String(value).trim();

    if (Number.isNaN(new Date(trimmed).getTime())) {
      return null;
    }
    return trimmed;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  return null;
}

export const systemUtcClock = () => new Date();

export function resolveDerivedEvidenceGeneratedAt(value, { clock } = {}) {
  if (value !== undefined && value !== null) {
    const normalized = normalizeTimeValue(value);
    if (normalized) {
      return normalized;
    }
    throw new DerivedEvidenceContractError(
      "generated_at_invalid",
      "generated_at must be a non-empty ISO-8601 string or a valid Date",
      { received_type: typeof value }
    );
  }
  if (typeof clock === "function") {
    const ticked = normalizeTimeValue(clock());
    if (ticked) {
      return ticked;
    }
    throw new DerivedEvidenceContractError(
      "generated_at_clock_invalid",
      "injected generated_at clock must return a non-empty ISO-8601 string or a valid Date"
    );
  }
  throw new DerivedEvidenceContractError(
    "generated_at_required",
    "generated_at is required for digest-bearing derived evidence; supply a caller timestamp or an injected clock contract (refusing silent wall-clock)"
  );
}
