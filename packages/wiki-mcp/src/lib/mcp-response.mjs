import { isDeepStrictEqual } from "node:util";
import { WORK_RECORD_COMPACT_RESULT_MAX_UTF8_BYTES } from
  "@agent-chassis/wiki-core/src/lib/work-record-entry-schema.mjs";
import { buildPublicMechanicalRefusal } from "@agent-chassis/wiki-core/src/lib/refusal-payload.mjs";
import { PROCESS_ERROR_GUARDS_INSTALLED, SPILLED_RESPONSE_SCHEMA_VERSION, CONTENT_REFERENCE_READ_SCHEMA_VERSION, CONTENT_REFERENCE_KIND, REFACTOR_ITEM_REFERENCE_SCHEMA_VERSION, CONTENT_REFERENCE_READ_REFUSAL_SCHEMA_VERSION, CONTENT_REFERENCE_RANGED_READ_UNAVAILABLE_CODE, RESPONSE_REFUSAL_SCHEMA_VERSION, SPILL_PERSISTENCE_FAILED_CODE, SPILLED_ENVELOPE_FIELDS, CONTENT_REFERENCE_FIELDS, CONTENT_REFERENCE_READ_TOOL, VERIFY_PROOF_SUMMARY_SCHEMA_VERSION, VERIFY_PROOF_EVIDENCE_SCHEMA_VERSION, RESULT_DIGEST_PATTERN, SPILL_MEASUREMENT_SCHEMA_VERSION, RETAINED_PAYLOAD_ENCODING, SPILL_MEASUREMENT_FIELDS, SPILL_COMPARISONS, spillMeasurement, SPILLED_REASON, DEFAULT_INLINE_BYTE_LIMIT, DEFAULT_PREVIEW_BYTE_LIMIT, MIN_INLINE_BYTE_LIMIT, MAX_REFERENCE_READ_BYTE_LIMIT, REF_ID_PATTERN, RETAINED_REF_ID_PATTERN, RESPONSE_BOUNDARY_ROUTE, hasExactKeys, isPositiveSafeInteger, isLosslessMcpSpillDelivery, isMintedSpillMeasurement, isMintedContentReference, isSpilledEnvelope } from "./mcp-response-shared.mjs";
import { safeReadProperty, buildResponseMechanicalRefusal, normalizeDeclaredOperatorRecoveryEnvelope, untypedFailureEnvelope } from "./mcp-response-diagnostics.mjs";
export { isReservedControlledContractAssessmentEnvelope, assertNoControlledContractRawResponse } from "./mcp-response-assessment.mjs";
export { isLosslessMcpSpillDelivery, VERIFY_PROOF_SUMMARY_SCHEMA_VERSION, VERIFY_PROOF_EVIDENCE_SCHEMA_VERSION } from "./mcp-response-shared.mjs";
export { installProcessErrorGuards, createDiagnosticSink, createStdioShutdownController } from "./mcp-response-diagnostics.mjs";

import {
  existsSync,
  closeSync,
  linkSync,
  openSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import {
  projectDiagnostic
} from "@agent-chassis/wiki-core/src/lib/diagnostic-projection.mjs";
import { serializeWorkRecordDiagnosticValue } from
  "@agent-chassis/wiki-core/src/operations/work-record-persistence-diagnostics.mjs";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

export {
  NEXT_CALLS_DESCRIPTOR_VERSION,
  buildNextCall,
  renderNextCall,
  validateNextCalls,
  pickDoThisNext,
  projectNextActionScalar
} from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";

function contentReferenceReadUnavailable(reason) {
  const envelope = Object.freeze({
    schema_version: CONTENT_REFERENCE_READ_REFUSAL_SCHEMA_VERSION,
    accepted: false,
    complete: false,
    recoverable: false,
    code: CONTENT_REFERENCE_RANGED_READ_UNAVAILABLE_CODE,
    limb: "ranged_read",
    reason,

    refusal: buildResponseMechanicalRefusal({
      code: CONTENT_REFERENCE_RANGED_READ_UNAVAILABLE_CODE,
      decidingFacts: [
        { field: "content_reference.readable", value: false },
        { field: "content_reference.failed_limb", value: "ranged_read" },
        { field: "content_reference.failed_step", value: reason }
      ],
      observedFacts: {
        "content_reference.readable": false,
        "content_reference.failed_limb": "ranged_read",
        "content_reference.failed_step": reason
      }
    })
  });
  const error = new Error(`MCP content reference ranged read unavailable: ${reason}`);
  error.envelope = envelope;
  return error;
}

function selectedAccessMarker(access) {

  if (access?.operator_only === true) return { operator_only: true };
  const call = access?.owner_call;
  if (call === null || typeof call !== "object" || typeof call.tool !== "string" ||
      call.arguments === null || typeof call.arguments !== "object" ||
      access.request_schema === null || typeof access.request_schema !== "object") {
    throw new TypeError("a selected-access marker requires the owner call and its request schema");
  }
  return { owner_call: { tool: call.tool, arguments: structuredClone(call.arguments) },
    request_schema: structuredClone(access.request_schema) };
}

function selectedAccessRequired(refId, access) {
  const owner = access?.owner_call;
  const facts = [
    { field: "content_reference.readable", value: false },
    { field: "content_reference.failed_limb", value: "selected_access" },
    { field: "content_reference.failed_step", value: "content_reference_selected_owner_required" },
    { field: "content_reference.selected_owner_read", value: false }
  ];
  const observed = Object.fromEntries(facts.map(({ field, value }) => [field, value]));
  let refusal;
  if (owner === null || typeof owner !== "object" || typeof owner.tool !== "string") {

    const unowned = [...facts.slice(0, 3),
      { field: "content_reference.operator_only", value: access?.operator_only === true }];
    refusal = buildResponseMechanicalRefusal({
      code: CONTENT_REFERENCE_RANGED_READ_UNAVAILABLE_CODE,
      decidingFacts: unowned,
      observedFacts: Object.fromEntries(unowned.map(({ field, value }) => [field, value]))
    });
  } else {
    const predicate = { fact: "content_reference.selected_owner_read", operator: "is_true" };
    refusal = buildPublicMechanicalRefusal({
      code: CONTENT_REFERENCE_RANGED_READ_UNAVAILABLE_CODE,
      deciding_facts: facts,
      next_calls: [buildNextCall({ tool: owner.tool, arguments: owner.arguments, recommended: true,
        success_predicate: predicate })],
      recovery: {
        state: "callable",
        prerequisite: "this retained artifact is a selected task result; only its owner route reads it",
        operation: owner.tool,
        success_condition: "the owner route returns the selected original result without re-executing it",
        success_predicate: predicate,
        selected_from: ["content_reference.selected_owner_read"]
      },
      route: RESPONSE_BOUNDARY_ROUTE,
      observed_facts: observed,
      request_schemas: { [owner.tool]: access.request_schema }
    });
  }
  const envelope = Object.freeze({
    schema_version: CONTENT_REFERENCE_READ_REFUSAL_SCHEMA_VERSION,
    accepted: false,
    complete: false,
    recoverable: refusal.next_calls !== undefined,
    code: CONTENT_REFERENCE_RANGED_READ_UNAVAILABLE_CODE,
    limb: "selected_access",
    reason: "content_reference_selected_owner_required",
    ref_id: refId,
    refusal
  });
  const error = new Error(
    `MCP content reference ${refId} is a selected task result; read it through ${owner?.tool ?? "its owner route"}`);
  error.envelope = envelope;
  return error;
}

export function retainOperatorOnlyEvidence(value, { env = process.env } = {}) {
  const canonical = canonicalizeStructuredPayload(value);
  if (canonical === null) throw new TypeError("operator evidence must be JSON");
  const persisted = persistSpilledPayload(JSON.stringify(canonical.value, null, 2), {
    env, selectedAccess: () => ({ operator_only: true }) });
  return Object.freeze({ ref_id: persisted.content_reference.ref_id,
    sha256: persisted.content_reference.sha256, byte_count: persisted.total_bytes });
}

export function describeRetentionFailure(error, { operation, subject = null }) {
  const code = safeReadProperty(error, "code");
  let cause;
  let serializationFailure = null;
  try {
    cause = serializeWorkRecordDiagnosticValue(error, { path: "retention_failure.cause" });
  } catch (serializationError) {

    cause = projectDiagnostic(error).value;
    serializationFailure = projectDiagnostic(serializationError).value;
  }
  return {
    retained: false,
    failed_operation: operation,
    subject,
    cause_code: typeof code === "string" ? code : null,
    cause,
    ...(serializationFailure === null ? {} : { cause_serialization_failure: serializationFailure })
  };
}

export function readOperatorOnlyEvidence(reference, { env = process.env } = {}) {
  return JSON.parse(readRetainedArtifactBytes(reference, { stateDir: resolveStateDir(env) }).toString("utf8"));
}

export const RETAINED_ARTIFACT_READ_FAILURES = Object.freeze({
  INVALID_REFERENCE: "invalid_reference",
  NOT_CURRENT: "locator_not_current",
  NOT_READABLE: "not_readable",
  METADATA_NOT_FOUND: "metadata_not_found",
  METADATA_INVALID: "metadata_invalid",
  EVIDENCE_MISMATCH: "evidence_digest_mismatch",
  BYTES_MISMATCH: "bytes_mismatch",
  UNPARSEABLE: "unparseable"
});

const RETAINED_METADATA_SCHEMA_VERSION = "wiki-mcp-content-reference-metadata.v1";
const retainedReadFailure = (reason) =>
  Object.assign(new Error(`retained artifact read failed: ${reason}`), { reason });

export function readRetainedArtifact({ ref_id: refId, sha256 = null }, { stateDir }) {
  if (typeof refId !== "string" || !REF_ID_PATTERN.test(refId)) {
    throw retainedReadFailure(RETAINED_ARTIFACT_READ_FAILURES.INVALID_REFERENCE);
  }
  if (!RETAINED_REF_ID_PATTERN.test(refId)) {
    throw retainedReadFailure(RETAINED_ARTIFACT_READ_FAILURES.NOT_CURRENT);
  }
  return readRetainedArtifactByMetadata({ ref_id: refId, sha256 }, { stateDir });
}

function readRetainedArtifactByMetadata({ ref_id: refId, sha256 }, { stateDir }) {
  const fail = retainedReadFailure;
  const payloadPath = referencePathForId(stateDir, refId);
  let metadataText;
  try {
    metadataText = readFileSync(metadataPathForId(stateDir, refId), "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw fail(RETAINED_ARTIFACT_READ_FAILURES.METADATA_INVALID);

    throw fail(existsSync(payloadPath) ? RETAINED_ARTIFACT_READ_FAILURES.METADATA_NOT_FOUND
      : RETAINED_ARTIFACT_READ_FAILURES.NOT_READABLE);
  }
  let metadata;
  try {
    metadata = JSON.parse(metadataText);
  } catch {
    throw fail(RETAINED_ARTIFACT_READ_FAILURES.METADATA_INVALID);
  }
  if (metadata === null || typeof metadata !== "object" ||
      metadata.schema_version !== RETAINED_METADATA_SCHEMA_VERSION || metadata.ref_id !== refId ||
      !Number.isSafeInteger(metadata.byte_count) || metadata.byte_count < 0 ||
      typeof metadata.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(metadata.sha256)) {
    throw fail(RETAINED_ARTIFACT_READ_FAILURES.METADATA_INVALID);
  }
  if (sha256 !== null && sha256 !== metadata.sha256) {
    throw fail(RETAINED_ARTIFACT_READ_FAILURES.EVIDENCE_MISMATCH);
  }
  let bytes;
  try {
    bytes = readFileSync(payloadPath);
  } catch {
    throw fail(RETAINED_ARTIFACT_READ_FAILURES.NOT_READABLE);
  }
  if (bytes.byteLength !== metadata.byte_count ||
      createHash("sha256").update(bytes).digest("hex") !== metadata.sha256) {
    throw fail(RETAINED_ARTIFACT_READ_FAILURES.BYTES_MISMATCH);
  }
  return { bytes, sha256: metadata.sha256, byte_count: metadata.byte_count };
}

const verifiedRetainedValues = new WeakMap();

export function readRetainedJson(reference, { stateDir, allowNonCurrent = false }) {
  const artifact = allowNonCurrent
    ? readRetainedArtifactByMetadata({ ref_id: reference.ref_id, sha256: reference.sha256 ?? null }, { stateDir })
    : readRetainedArtifact(reference, { stateDir });
  let value;
  try {
    value = JSON.parse(artifact.bytes.toString("utf8"));
  } catch {
    throw retainedReadFailure(RETAINED_ARTIFACT_READ_FAILURES.UNPARSEABLE);
  }
  if (value !== null && typeof value === "object") verifiedRetainedValues.set(value, artifact.sha256);
  return { value, source: Object.freeze({ ref_id: reference.ref_id, sha256: artifact.sha256 }) };
}

export function listRetainedArtifacts({ stateDir, nonCurrentPrefix }) {
  let files;
  try {
    files = readdirSync(stateDir);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const published = new Set(files.filter((file) => file.endsWith(".json.meta.json"))
    .map((file) => file.slice(0, -".json.meta.json".length)));
  return files.filter((file) => file.endsWith(".json") && !file.endsWith(".meta.json"))
    .map((file) => file.slice(0, -".json".length))
    .filter((refId) => published.has(refId) &&
      (RETAINED_REF_ID_PATTERN.test(refId) || refId.startsWith(nonCurrentPrefix)))
    .map((refId) => ({ ref_id: refId, current: RETAINED_REF_ID_PATTERN.test(refId) }));
}

export function readRetainedArtifactBytes({ ref_id: refId, sha256, byte_count: byteCount = null },
  { stateDir }) {
  const fail = (reason) => Object.assign(new Error(`retained artifact read failed: ${reason}`), { reason });
  let absolutePath;
  try {
    absolutePath = referencePathForId(stateDir, refId);
  } catch {
    throw fail(RETAINED_ARTIFACT_READ_FAILURES.INVALID_REFERENCE);
  }
  let bytes;
  try {
    bytes = readFileSync(absolutePath);
  } catch {
    throw fail(RETAINED_ARTIFACT_READ_FAILURES.NOT_READABLE);
  }
  if ((byteCount !== null && bytes.byteLength !== byteCount) ||
      createHash("sha256").update(bytes).digest("hex") !== sha256) {
    throw fail(RETAINED_ARTIFACT_READ_FAILURES.BYTES_MISMATCH);
  }
  return bytes;
}

export function describeRetainedArtifactFile(reference, { env = process.env } = {}) {
  const stateDir = resolveStateDir(env);

  const artifact = reference.sha256 === undefined ? readRetainedArtifact(reference, { stateDir })
    : { bytes: readRetainedArtifactBytes(reference, { stateDir }), sha256: reference.sha256 };
  return Object.freeze({
    path: referencePathForId(stateDir, reference.ref_id),
    media_type: "application/json",
    encoding: "utf8",
    byte_count: artifact.bytes.byteLength,
    sha256: artifact.sha256
  });
}

export function retainedArtifactNotFoundError() {
  return contentReferenceReadUnavailable("content_reference_not_found");
}

function readReferenceStep(reason, operation) {
  try {
    return operation();
  } catch {
    throw contentReferenceReadUnavailable(reason);
  }
}

function parsePositiveInteger(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function resolveStateDir(env = process.env) {
  if (typeof env.WIKI_MCP_RESPONSE_STATE_DIR === "string" && env.WIKI_MCP_RESPONSE_STATE_DIR.length > 0) {
    return path.resolve(env.WIKI_MCP_RESPONSE_STATE_DIR);
  }
  if (typeof env.XDG_STATE_HOME === "string" && env.XDG_STATE_HOME.length > 0) {
    return path.join(env.XDG_STATE_HOME, "agent-chassis", "wiki-mcp", "response-spill");
  }
  const home = homedir();
  if (typeof home === "string" && home.length > 0) {
    return path.join(home, ".local", "state", "agent-chassis", "wiki-mcp", "response-spill");
  }
  return path.join(tmpdir(), "agent-chassis", "wiki-mcp", "response-spill");
}

export function getResponseSpillConfig(env = process.env) {
  const inlineByteLimit = Math.max(
    MIN_INLINE_BYTE_LIMIT,
    parsePositiveInteger(env.WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT, DEFAULT_INLINE_BYTE_LIMIT)
  );
  const previewByteLimit = Math.min(
    parsePositiveInteger(env.WIKI_MCP_RESPONSE_PREVIEW_BYTE_LIMIT, DEFAULT_PREVIEW_BYTE_LIMIT),
    Math.max(256, Math.floor(inlineByteLimit / 8))
  );
  const maxReferenceReadBytes = Math.min(
    parsePositiveInteger(env.WIKI_MCP_RESPONSE_REFERENCE_READ_BYTE_LIMIT, Math.floor(inlineByteLimit / 8)),
    MAX_REFERENCE_READ_BYTE_LIMIT,
    Math.max(1, Math.floor(inlineByteLimit / 8))
  );
  return {
    inlineByteLimit,
    previewByteLimit,
    maxReferenceReadBytes,
    stateDir: resolveStateDir(env)
  };
}

function serializedResultBytes(result) {
  return Buffer.byteLength(JSON.stringify(result), "utf8");
}

function resultAdmissionBytes(result) {
  const { content, structuredContent, isError, ...protocol } = result;
  const structuredBytes = structuredContent === undefined ? 0
    : Buffer.byteLength(JSON.stringify(structuredContent), "utf8");
  const blocks = Array.isArray(content) ? content : [];
  const textBytes = blocks
    .filter((block) => block && typeof block === "object" && block.type === "text")
    .reduce((sum, block) => sum + Buffer.byteLength(String(block.text ?? ""), "utf8"), 0);
  const nonmirrored = withoutTextCarriers(content);
  const residual = {
    ...protocol,
    ...(isError === undefined || typeof isError === "boolean" ? {} : { isError }),
    ...(content !== undefined && !Array.isArray(content) ? { content } : {}),
    ...(nonmirrored.length > 0 ? { content: nonmirrored } : {})
  };
  const residualText = JSON.stringify(residual);
  const residualBytes = residualText === "{}" ? 0 : Buffer.byteLength(residualText, "utf8");
  return Math.max(structuredBytes, textBytes) + residualBytes;
}

export function measureMcpInlineResultBytes(payload, { isError = false } = {}) {
  const canonical = canonicalizeStructuredPayload(payload);
  if (!canonical) return Number.POSITIVE_INFINITY;
  return resultAdmissionBytes(structuredToolResult(canonical.value, { isError }));
}

export function measureMcpSerializedResultBytes(payload, { isError = false } = {}) {
  const canonical = canonicalizeStructuredPayload(payload);
  if (!canonical) return Number.POSITIVE_INFINITY;
  return serializedResultBytes(structuredToolResult(canonical.value, { isError }));
}

export function activeMcpInlineByteLimit(env = process.env) {
  return getResponseSpillConfig(env).inlineByteLimit;
}

export function selectedResponseDeliveryBound(env = process.env) {
  return Math.min(WORK_RECORD_COMPACT_RESULT_MAX_UTF8_BYTES, activeMcpInlineByteLimit(env));
}

function resultAdmissionFits(result, limit) {
  try {
    return resultAdmissionBytes(result) <= limit;
  } catch {
    return false;
  }
}

function admissionComparison(result) {
  try {
    return { admissionBytes: resultAdmissionBytes(result), serializedResultBytes: serializedResultBytes(result) };
  } catch {
    return null;
  }
}

function canonicalizeStructuredPayload(payload) {
  let jsonText;
  try {
    jsonText = JSON.stringify(payload);
  } catch {
    return null;
  }
  if (typeof jsonText !== "string") {
    return null;
  }
  return { jsonText, value: JSON.parse(jsonText) };
}

function generatedTextBlock(value) {
  return { type: "text", text: JSON.stringify(value) };
}

export function structuredToolResult(value, { isError = false } = {}) {
  const result = { content: [generatedTextBlock(value)], structuredContent: value };
  if (isError) {
    result.isError = true;
  }
  return result;
}

function withoutTextCarriers(content) {
  return Array.isArray(content)
    ? content.filter((block) => !(block && typeof block === "object" && block.type === "text"))
    : [];
}

function requiredStructuredContentFailure(operation, brokenInvariant) {
  const payload = {
    code: "mechanical_failure",
    authority_limb: "mechanical_failure",
    operation,
    broken_invariant: brokenInvariant
  };
  return structuredToolResult(canonicalizeStructuredPayload(payload).value, { isError: true });
}

function normalizeDeclaredOutputSchema(outputSchema) {
  if (outputSchema && (typeof outputSchema.safeParseAsync === "function" ||
      typeof outputSchema.safeParse === "function")) {
    return outputSchema;
  }
  if (outputSchema && typeof outputSchema === "object" && !Array.isArray(outputSchema)) {
    return z.object(outputSchema);
  }
  return null;
}

async function validateRequiredStructuredContent(result, { name, outputSchema }) {
  if (result === null || typeof result !== "object" || Array.isArray(result) ||
      !Object.prototype.hasOwnProperty.call(result, "structuredContent") ||
      result.structuredContent === undefined) {
    return requiredStructuredContentFailure(
      name,
      "outputSchema requires structuredContent"
    );
  }
  const canonical = canonicalizeStructuredPayload(result.structuredContent);
  if (!canonical || !isDeepStrictEqual(canonical.value, result.structuredContent)) {
    return requiredStructuredContentFailure(name, "structuredContent must be JSON");
  }
  const schema = normalizeDeclaredOutputSchema(outputSchema);
  let parsed;
  try {
    parsed = typeof schema?.safeParseAsync === "function"
      ? await schema.safeParseAsync(result.structuredContent)
      : schema?.safeParse(result.structuredContent);
  } catch {
    parsed = null;
  }
  return parsed?.success === true
    ? null
    : requiredStructuredContentFailure(
        name,
        "structuredContent must satisfy outputSchema"
      );
}

function isTerminalResponseRefusalEnvelope(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.schema_version === RESPONSE_REFUSAL_SCHEMA_VERSION &&
    value.code === SPILL_PERSISTENCE_FAILED_CODE &&
    value.response_spilled === false
  );
}

function referencePathForId(stateDir, refId) {
  if (typeof refId !== "string" || !REF_ID_PATTERN.test(refId)) {
    throw new Error("Invalid MCP content reference id");
  }
  const absolutePath = path.resolve(stateDir, `${refId}.json`);
  const stateRoot = path.resolve(stateDir);
  if (absolutePath !== path.join(stateRoot, path.basename(absolutePath))) {
    throw new Error("Invalid MCP content reference path");
  }
  return absolutePath;
}

function metadataPathForId(stateDir, refId) {
  return `${referencePathForId(stateDir, refId)}.meta.json`;
}

const RETAINED_ALLOCATION_ATTEMPTS = 8;
export const RETAINED_ALLOCATION_EXHAUSTED_CODE = "retained_handle_allocation_exhausted";
const mintRetainedRefId = () => randomBytes(6).toString("base64url");

export function allocateRetainedArtifact({ stateDir, bytes, metadataFor, mintRefId = mintRetainedRefId }) {
  for (let attempt = 0; attempt < RETAINED_ALLOCATION_ATTEMPTS; attempt += 1) {
    const refId = mintRefId();
    if (typeof refId !== "string" || !RETAINED_REF_ID_PATTERN.test(refId)) {
      throw new TypeError("a retained handle is eight base64url characters");
    }
    const payloadPath = referencePathForId(stateDir, refId);
    const metadataPath = metadataPathForId(stateDir, refId);
    if (existsSync(metadataPath)) continue;
    const metadataText = `${JSON.stringify(metadataFor(refId), null, 2)}\n`;
    try {
      writeFileSync(payloadPath, bytes, { mode: 0o600, flag: "wx" });
    } catch (error) {
      if (error?.code === "EEXIST") continue;
      throw error;
    }
    const pendingPath = `${metadataPath}.${process.pid}.${randomBytes(6).toString("hex")}.pending`;
    writeFileSync(pendingPath, metadataText, { mode: 0o600, flag: "wx" });
    try {
      linkSync(pendingPath, metadataPath);
    } catch (error) {
      if (error?.code === "EEXIST") continue;
      throw error;
    } finally {
      unlinkSync(pendingPath);
    }
    return refId;
  }
  throw Object.assign(new Error(
    `no unused retained handle was allocated in ${RETAINED_ALLOCATION_ATTEMPTS} attempts`),
  { code: RETAINED_ALLOCATION_EXHAUSTED_CODE, attempts: RETAINED_ALLOCATION_ATTEMPTS });
}

function buildPreview(buffer, previewByteLimit) {
  const previewBuffer = buffer.subarray(0, Math.min(previewByteLimit, buffer.byteLength));
  return {
    text: previewBuffer.toString("utf8"),
    bytes: previewBuffer.byteLength
  };
}

function persistSpilledPayload(
  jsonText,
  { env = process.env, config = null, comparison = null, selectedAccess = null } = {}
) {
  const resolvedConfig = config ?? getResponseSpillConfig(env);
  const bytes = Buffer.from(jsonText, "utf8");

  mkdirSync(resolvedConfig.stateDir, { recursive: true, mode: 0o700 });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const refId = allocateRetainedArtifact({
    stateDir: resolvedConfig.stateDir,
    bytes,
    metadataFor: (allocated) => ({
      schema_version: RETAINED_METADATA_SCHEMA_VERSION,
      ref_id: allocated,
      media_type: "application/json",
      encoding: "utf8",
      byte_count: bytes.byteLength,
      sha256,
      created_at: new Date().toISOString(),

      ...(selectedAccess === null ? {}
        : { selected_access: selectedAccessMarker(selectedAccess({ ref_id: allocated })) })
    })
  });

  const access = selectedAccess === null ? null : selectedAccess({ ref_id: refId });
  return {
    schema_version: SPILLED_RESPONSE_SCHEMA_VERSION,
    response_spilled: true,
    reason: SPILLED_REASON,
    inline_byte_limit: resolvedConfig.inlineByteLimit,
    total_bytes: bytes.byteLength,

    measurement: spillMeasurement({
      comparison,
      inlineByteLimit: resolvedConfig.inlineByteLimit,
      retainedPayloadBytes: bytes.byteLength
    }),

    preview: selectedAccess === null ? buildPreview(bytes, resolvedConfig.previewByteLimit)
      : { text: "", bytes: 0 },
    content_reference: {
      kind: CONTENT_REFERENCE_KIND,
      ref_id: refId,
      media_type: "application/json",
      encoding: "utf8",
      byte_count: bytes.byteLength,
      sha256,
    },
    complete: false,
    next_calls: access?.owner_call === undefined ? [] : [buildNextCall({ ...access.owner_call, recommended: true })],
    no_supported_route: access?.owner_call === undefined,
    recovery: access?.owner_call !== undefined ? { state: "callable", operation: access.owner_call.tool,
      reason: "Read the retained result through its semantic owner; no producing action is repeated." }
      : { state: "no_supported_route", missing_capability: "authorized_semantic_selection",
        reason: "This response exceeded ordinary delivery and has no registered semantic owner selection. The original is retained internally; no public byte reader or reconstruction route is served. Delivery is incomplete; do not repeat an effectful request to retrieve it." }
  };
}

export function persistControlledContractRefactorItemReference({
  resourceKind, itemIdentity, item
}, options = {}) {
  if (!["plan", "receipt"].includes(resourceKind) ||
      typeof itemIdentity !== "string" || itemIdentity.length === 0 ||
      item === undefined) {
    throw new TypeError("refactor item persistence requires one bounded plan or receipt item");
  }
  const canonical = canonicalizeStructuredPayload(item);
  if (canonical === null) throw new TypeError("refactor semantic item must be JSON");
  const persisted = persistSpilledPayload(canonical.jsonText, options);
  return Object.freeze({
    schema_version: REFACTOR_ITEM_REFERENCE_SCHEMA_VERSION,
    resource_kind: resourceKind,
    item_identity: itemIdentity,
    byte_count: persisted.total_bytes,
    content_reference: Object.freeze(persisted.content_reference)
  });
}

export const VERIFY_PROOF_CACHED_RECORD_SCHEMA_VERSION = "workspace-verify-proof-cached-record.v1";
export const VERIFY_PROOF_CACHED_RECORD_CODES = Object.freeze({
  UNAVAILABLE: "verify_proof_cache.record_unavailable.v1",
  CORRUPT: "verify_proof_cache.record_corrupt.v1"
});
const VERIFY_PROOF_CACHED_RECORD_KINDS = Object.freeze({
  aggregate: VERIFY_PROOF_EVIDENCE_SCHEMA_VERSION,
  refusal: "workspace-verify-proof-refusal.v1"
});

function cachedRecordFailure(code, reason) {
  return Object.assign(new Error(`cached verifier record is ${reason}`), { code, details: { reason } });
}

export function persistVerifyProofCachedRecord({ kind, record, recordIdentity }, { stateDir, env = process.env }) {
  if (!Object.hasOwn(VERIFY_PROOF_CACHED_RECORD_KINDS, kind) || record === null ||
      typeof record !== "object" || Array.isArray(record) ||
      record.schema_version !== VERIFY_PROOF_CACHED_RECORD_KINDS[kind] ||
      typeof recordIdentity !== "string" || !RESULT_DIGEST_PATTERN.test(recordIdentity) ||
      (kind === "aggregate" && record.result_digest !== recordIdentity) ||
      typeof stateDir !== "string" || !path.isAbsolute(stateDir)) {
    throw new TypeError("cached verifier persistence requires one identified record and an absolute durable directory");
  }
  const envelope = { schema_version: VERIFY_PROOF_CACHED_RECORD_SCHEMA_VERSION, kind,
    record_identity: recordIdentity, record };
  const canonical = canonicalizeStructuredPayload(envelope);
  if (canonical === null) throw new TypeError("cached verifier record must be JSON");
  const persisted = persistSpilledPayload(canonical.jsonText, {
    config: { ...getResponseSpillConfig(env), stateDir }
  });
  return Object.freeze({
    kind,
    record_identity: recordIdentity,
    ref_id: persisted.content_reference.ref_id,
    sha256: persisted.content_reference.sha256,
    byte_count: persisted.total_bytes
  });
}

export function readVerifyProofCachedRecord({ ref_id: refId, sha256, byte_count: byteCount,
  kind, record_identity: recordIdentity }, { stateDir, includeVerifiedSource = false }) {
  let bytes;
  try {
    bytes = readRetainedArtifactBytes({ ref_id: refId, sha256, byte_count: byteCount }, { stateDir });
  } catch (error) {
    if (error.reason === RETAINED_ARTIFACT_READ_FAILURES.INVALID_REFERENCE) {
      throw cachedRecordFailure(VERIFY_PROOF_CACHED_RECORD_CODES.CORRUPT, "addressed by an invalid reference");
    }
    if (error.reason === RETAINED_ARTIFACT_READ_FAILURES.NOT_READABLE) {
      throw cachedRecordFailure(VERIFY_PROOF_CACHED_RECORD_CODES.UNAVAILABLE, "not readable");
    }
    throw cachedRecordFailure(VERIFY_PROOF_CACHED_RECORD_CODES.CORRUPT, "not the recorded bytes");
  }
  let envelope;
  try {
    envelope = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw cachedRecordFailure(VERIFY_PROOF_CACHED_RECORD_CODES.CORRUPT, "not JSON");
  }
  if (!hasExactKeys(envelope, ["schema_version", "kind", "record_identity", "record"]) ||
      envelope.schema_version !== VERIFY_PROOF_CACHED_RECORD_SCHEMA_VERSION ||
      envelope.kind !== kind || envelope.record_identity !== recordIdentity ||
      envelope.record?.schema_version !== VERIFY_PROOF_CACHED_RECORD_KINDS[kind] ||
      (kind === "aggregate" && envelope.record.result_digest !== recordIdentity)) {
    throw cachedRecordFailure(VERIFY_PROOF_CACHED_RECORD_CODES.CORRUPT, "bound to another identity");
  }
  return includeVerifiedSource ? { record: envelope.record, retained: envelope,
    serializedBytes: bytes, source: { ref_id: refId, sha256 } } : envelope.record;
}

function dropEnvelopePreview(envelope) {
  if (
    envelope === null ||
    typeof envelope !== "object" ||
    Array.isArray(envelope) ||
    envelope.preview === undefined
  ) {
    return envelope;
  }
  return { ...envelope, preview: { text: "", bytes: 0, omitted: true } };
}

function canonicalTerminalEnvelopeFields(envelope) {
  const fields = isSpilledEnvelope(envelope)
    ? SPILLED_ENVELOPE_FIELDS
    : ["schema_version", "code", "response_spilled", "reason", "inline_byte_limit", "total_bytes", "cause_diagnostic", "cause_diagnostic_redactions"];
  return Object.fromEntries(
    fields
      .filter((field) => Object.prototype.hasOwnProperty.call(envelope, field))
      .map((field) => [field, envelope[field]])
  );
}

function boundTerminalEnvelopeResult(envelope, { isError = false, config }) {
  const canonical = canonicalizeStructuredPayload(envelope);
  if (!canonical) {

    return errorContent(new Error("MCP response envelope is not JSON-serializable"));
  }
  const result = structuredToolResult(canonical.value, { isError });
  if (resultAdmissionBytes(result) <= config.inlineByteLimit) {
    return result;
  }
  const trimmed = canonicalizeStructuredPayload(dropEnvelopePreview(envelope)) ?? canonical;
  const trimmedResult = structuredToolResult(trimmed.value, { isError });
  if (resultAdmissionBytes(trimmedResult) <= config.inlineByteLimit) {
    return trimmedResult;
  }
  const bounded = canonicalizeStructuredPayload(canonicalTerminalEnvelopeFields(trimmed.value));
  const boundedResult = structuredToolResult(bounded.value, { isError });
  return resultAdmissionFits(boundedResult, config.inlineByteLimit)
    ? boundedResult
    : errorContent(new Error("Canonical MCP terminal envelope exceeds inline byte limit"));
}

function coreResultDisclosure(core, isError) {
  if (core === null || typeof core !== "object" || Array.isArray(core)) {
    return { outcome: isError ? "failed" : "succeeded", preserved: "none" };
  }
  return {

    outcome: isError ? "failed" : "succeeded",
    preserved: "identity_only",
    ...(typeof core.schema_version === "string" ? { schema_version: core.schema_version } : {}),
    ...(typeof core.code === "string" ? { code: core.code } : {}),
    ...(typeof core.accepted === "boolean" ? { accepted: core.accepted } : {}),
    ...(typeof core.ok === "boolean" ? { ok: core.ok } : {})
  };
}

function buildSpillPersistenceRefusal({ totalBytes, cause, config, core = null, isError = false }) {
  const coreResult = coreResultDisclosure(core, isError);
  const diagnostic = serializeWorkRecordDiagnosticValue(cause, {
    path: "mcp_response.spill_failure_cause"
  });
  return {
    schema_version: RESPONSE_REFUSAL_SCHEMA_VERSION,
    code: SPILL_PERSISTENCE_FAILED_CODE,
    response_spilled: false,
    reason: "spill_persistence_failed",
    inline_byte_limit: config.inlineByteLimit,
    total_bytes: totalBytes,

    core_result: coreResult,
    refusal: buildResponseMechanicalRefusal({
      code: SPILL_PERSISTENCE_FAILED_CODE,
      decidingFacts: [
        { field: "mcp_response.spill_persisted", value: false },
        { field: "mcp_response.core_operation_outcome", value: coreResult.outcome }
      ],
      observedFacts: {
        "mcp_response.spill_persisted": false,
        "mcp_response.core_operation_outcome": coreResult.outcome
      }
    }),
    cause_diagnostic: diagnostic,
    cause_diagnostic_redactions: []
  };
}

function spillOrRefuse(
  canonicalValue,
  { isError = false, env = process.env, config, comparison = null, selectedAccess = null }
) {
  const jsonText = JSON.stringify(canonicalValue, null, 2);
  let envelope;

  try {
    envelope = persistSpilledPayload(jsonText, { env, config, comparison, selectedAccess });
  } catch (cause) {
    const refusal = buildSpillPersistenceRefusal({
      totalBytes: Buffer.byteLength(jsonText, "utf8"),
      cause,
      config,

      core: canonicalValue,
      isError
    });

    return boundTerminalEnvelopeResult(refusal, { isError: true, config });
  }
  return boundTerminalEnvelopeResult(envelope, { isError, config });
}

function shapeStructuredResult(
  payload,
  {
    isError = false,
    env = process.env,
    config = null,
    forceSpill = false,
    comparedAdmission = null,
    selectedAccess = null
  } = {}
) {
  const resolvedConfig = config ?? getResponseSpillConfig(env);
  const canonical = canonicalizeStructuredPayload(payload);
  if (!canonical) {
    return null;
  }

  let comparison = comparedAdmission;
  if (!forceSpill) {
    const inline = structuredToolResult(canonical.value, { isError });
    comparison = admissionComparison(inline);
    if (comparison.admissionBytes <= resolvedConfig.inlineByteLimit) {
      return inline;
    }
    if (isSpilledEnvelope(canonical.value) || isTerminalResponseRefusalEnvelope(canonical.value)) {
      return boundTerminalEnvelopeResult(canonical.value, { isError, config: resolvedConfig });
    }
  }
  return spillOrRefuse(canonical.value, {
    isError, env, config: resolvedConfig, comparison, selectedAccess
  });
}

export function readSpilledMcpContentReference({ ref_id, offset = 0, length = null }, { env = process.env } = {}) {
  const config = getResponseSpillConfig(env);
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error("offset must be a non-negative integer");
  }
  const requestedLength = length ?? config.maxReferenceReadBytes;
  if (!Number.isInteger(requestedLength) || requestedLength < 1) {
    throw new Error("length must be a positive integer");
  }
  if (requestedLength > config.maxReferenceReadBytes) {
    throw new Error(
      `length exceeds max_length ${config.maxReferenceReadBytes}; request smaller ranges and reassemble by offset`
    );
  }

  const absolutePath = referencePathForId(config.stateDir, ref_id);
  if (!existsSync(absolutePath)) {
    throw contentReferenceReadUnavailable("content_reference_not_found");
  }
  const metadataPath = metadataPathForId(config.stateDir, ref_id);
  if (!existsSync(metadataPath)) {
    throw contentReferenceReadUnavailable("content_reference_metadata_not_found");
  }

  const stats = readReferenceStep("content_reference_stat_failed", () => statSync(absolutePath));
  if (!stats.isFile()) {
    throw contentReferenceReadUnavailable("content_reference_not_file");
  }
  if (offset > stats.size) {
    throw new Error("offset exceeds reference byte_count");
  }

  const metadataText = readReferenceStep(
    "content_reference_metadata_read_failed",
    () => readFileSync(metadataPath, "utf8")
  );
  const metadata = readReferenceStep(
    "content_reference_metadata_invalid",
    () => JSON.parse(metadataText)
  );
  if (metadata.byte_count !== stats.size) {
    throw contentReferenceReadUnavailable("content_reference_metadata_byte_count_mismatch");
  }
  if (metadata.selected_access !== undefined) {
    throw selectedAccessRequired(ref_id, metadata.selected_access);
  }
  const bytesToRead = Math.min(requestedLength, Math.max(0, stats.size - offset));
  const chunk = Buffer.alloc(bytesToRead);
  const fd = readReferenceStep("content_reference_open_failed", () => openSync(absolutePath, "r"));
  let readError = null;
  try {
    if (bytesToRead > 0) {
      try {
        readSync(fd, chunk, 0, bytesToRead, offset);
      } catch {
        readError = contentReferenceReadUnavailable("content_reference_read_failed");
      }
    }
  } finally {
    try {
      closeSync(fd);
    } catch {
      if (readError === null) {
        readError = contentReferenceReadUnavailable("content_reference_close_failed");
      }
    }
  }
  if (readError !== null) {
    throw readError;
  }
  const nextOffset = offset + chunk.byteLength;
  return {
    schema_version: CONTENT_REFERENCE_READ_SCHEMA_VERSION,
    ref_id,
    offset,
    requested_length: requestedLength,
    length: chunk.byteLength,
    total_bytes: stats.size,
    eof: nextOffset >= stats.size,
    next_offset: nextOffset >= stats.size ? null : nextOffset,
    max_length: config.maxReferenceReadBytes,
    media_type: metadata.media_type ?? "application/json",
    encoding: "base64",
    source_encoding: metadata.encoding ?? "utf8",
    sha256: metadata.sha256,
    data_base64: chunk.toString("base64")
  };
}

export function jsonContent(data, { env = process.env, forceSpill = false, selectedAccess = null } = {}) {
  if (selectedAccess !== null && (forceSpill !== true || typeof selectedAccess !== "function")) {
    throw new TypeError("a selected-access artifact is a forced retention with an owner-call derivation");
  }
  const config = getResponseSpillConfig(env);
  const shaped = shapeStructuredResult(data, { isError: false, env, config, forceSpill, selectedAccess });
  if (shaped) {
    return shaped;
  }

  return errorContent(new Error("MCP result payload is not JSON-serializable"), { env });
}

const selectedFullResults = new WeakSet();
const selectedFullValues = new WeakMap();

function completeContentResult(canonical, options) {
  const result = structuredToolResult(canonical.value, options);
  selectedFullResults.add(result);
  selectedFullValues.set(result.structuredContent, canonical.jsonText);
  return result;
}

export function selectedFullContent({ source, retained, serializedBytes, member, projection }) {
  const native = serializedBytes !== undefined;
  const verified = native
    ? Buffer.isBuffer(serializedBytes) && serializedBytes.length > 0 && retained === undefined &&
      member === undefined && projection !== undefined &&
      createHash("sha256").update(serializedBytes).digest("hex") === source?.sha256
    : retained !== null && typeof retained === "object" &&
      createHash("sha256").update(JSON.stringify(retained, null, 2), "utf8").digest("hex") ===
        (verifiedRetainedValues.get(retained) ?? source?.sha256);
  if ((member === undefined) === (projection === undefined)) {
    throw new TypeError("selected-full delivery takes exactly one of member and projection");
  }
  const canonical = verified
    ? canonicalizeStructuredPayload(projection === undefined ? retained[member] : projection) : null;
  if (canonical === null || canonical.value === null || typeof canonical.value !== "object" ||
      Array.isArray(canonical.value)) {
    throw new TypeError(projection === undefined
      ? "selected-full delivery requires an object member of the verified retained value"
      : "selected-full delivery requires an object projection of the verified retained value");
  }
  return completeContentResult(canonical);
}

export function completeProducedContent(projection, { isError = false } = {}) {
  const canonical = canonicalizeStructuredPayload(projection);
  if (canonical === null || canonical.value === null || typeof canonical.value !== "object" ||
      Array.isArray(canonical.value)) {
    throw new TypeError("complete task delivery requires the task's object projection");
  }
  return completeContentResult(canonical, { isError });
}

export function normalizeMcpToolResult(result, { env = process.env } = {}) {
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    return result;
  }
  if (!Object.prototype.hasOwnProperty.call(result, "structuredContent") || result.structuredContent === undefined) {
    return selectedFullResults.has(result)
      ? errorContent(new TypeError("Authenticated selected result lost structuredContent"), { env }) : result;
  }
  const payload = result.structuredContent;
  const config = getResponseSpillConfig(env);
  const isError = result.isError === true;
  const canonical = canonicalizeStructuredPayload(payload);
  if (!canonical) {
    return errorContent(new Error("MCP result payload is not JSON-serializable"), { env });
  }

  const retainedContent = withoutTextCarriers(result.content);
  const selected = selectedFullResults.has(result) && selectedFullValues.get(payload) === canonical.jsonText;
  const inline = structuredToolResult(canonical.value, { isError });
  const completeInline = { ...result, ...inline, content: [...inline.content, ...retainedContent] };

  if (selected) {
    resultAdmissionBytes(completeInline);
    const delivered = isDeepStrictEqual(completeInline, result) ? result : completeInline;
    selectedFullResults.add(delivered);
    selectedFullValues.set(delivered.structuredContent, canonical.jsonText);
    return delivered;
  }
  if (isDeepStrictEqual(completeInline, result) &&
      resultAdmissionFits(result, config.inlineByteLimit)) {
    return result;
  }

  const comparison = admissionComparison(completeInline);
  if (comparison !== null && comparison.admissionBytes <= config.inlineByteLimit) {
    return completeInline;
  }
  if (isSpilledEnvelope(canonical.value) || isTerminalResponseRefusalEnvelope(canonical.value)) {
    return boundTerminalEnvelopeResult(canonical.value, { isError, config });
  }

  const shaped = shapeStructuredResult(payload, {
    isError,
    env,
    config,
    forceSpill: true,
    comparedAdmission: comparison
  });
  if (!shaped) {
    return errorContent(new Error("MCP result payload is not JSON-serializable"), { env });
  }
  const completeSpill = { ...result, ...shaped, content: [...shaped.content, ...retainedContent] };

  return resultAdmissionFits(completeSpill, config.inlineByteLimit)
    ? completeSpill
    : shaped;
}

export function guardToolHandler(
  handler,
  { name = null, log = null, env = process.env, outputSchema = null } = {}
) {
  return async (...args) => {
    try {
      const result = await handler(...args);
      if (outputSchema !== null) {
        const requiredFailure = await validateRequiredStructuredContent(result, {
          name,
          outputSchema
        });

        if (requiredFailure !== null) {
          return normalizeMcpToolResult(requiredFailure, { env });
        }
      }
      return normalizeMcpToolResult(result, { env });
    } catch (error) {
      if (typeof log === "function") {
        log({
          level: "error",
          message: "wiki-mcp tool handler threw; returning error result instead of closing transport",
          tool: name,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      return errorContent(error, { env });
    }
  };
}

export function errorContent(error, { env = process.env } = {}) {

  const declaredEnvelope =
    error && typeof error === "object" && !Array.isArray(error)
      ? safeReadProperty(error, "envelope")
      : undefined;
  const envelope =
    declaredEnvelope &&
    typeof declaredEnvelope === "object" &&
    !Array.isArray(declaredEnvelope)
      ? declaredEnvelope
      : null;
  if (envelope) {
    const shaped = shapeStructuredResult(normalizeDeclaredOperatorRecoveryEnvelope(envelope), {
      isError: true,
      env
    });
    if (shaped) {
      return shaped;
    }
  }

  const translated = shapeStructuredResult(untypedFailureEnvelope(error), {
    isError: true,
    env
  });
  if (translated) return translated;

  return {
    content: [
      {
        type: "text",
        text: projectDiagnostic(error).value
      }
    ],
    isError: true
  };
}
