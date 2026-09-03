

import {
  existsSync,
  closeSync,
  openSync,
  mkdirSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import {
  buildPublicMechanicalRefusal,
  isPlatformErrorCode,
  isPreservableSemanticIdentity
} from "@agent-chassis/wiki-core/src/lib/refusal-payload.mjs";
import {
  projectDiagnostic
} from "@agent-chassis/wiki-core/src/lib/diagnostic-projection.mjs";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  CONTROLLED_CONTRACT_ASSESSMENT_COLLECTION_DESCRIPTORS,
  CONTROLLED_CONTRACT_ASSESSMENT_PROJECTION_VOCABULARY,
  assessmentCollectionDescriptor
} from "@agent-chassis/controlled-contract";

export {
  NEXT_CALLS_DESCRIPTOR_VERSION,
  buildNextCall,
  renderNextCall,
  validateNextCalls,
  pickDoThisNext,
  projectNextActionScalar
} from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
import {
  isRuntimeBlockerCode
} from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
import {
  classifyMechanicalRuntimeBlocker
} from "./dispatch-tools/runtime-blocker-classifier.mjs";

const PROCESS_ERROR_GUARDS_INSTALLED = Symbol.for(
  "agent-chassis.wiki-mcp.process-error-guards-installed"
);

const SPILLED_RESPONSE_SCHEMA_VERSION = "wiki-mcp-spilled-response.v1";
const CONTENT_REFERENCE_READ_SCHEMA_VERSION = "wiki-mcp-content-reference-read.v1";
const CONTENT_REFERENCE_KIND = "wiki_mcp_response_content_reference";
const REFACTOR_ITEM_REFERENCE_SCHEMA_VERSION =
  "controlled-contract-refactor-item-reference.v1";
const CONTENT_REFERENCE_READ_REFUSAL_SCHEMA_VERSION =
  "wiki-mcp-content-reference-read-refusal.v1";
const CONTENT_REFERENCE_RANGED_READ_UNAVAILABLE_CODE =
  "mcp_response.content_reference_ranged_read_unavailable.v1";

const RESPONSE_REFUSAL_SCHEMA_VERSION = "mcp-response-refusal.v1";
const SPILL_PERSISTENCE_FAILED_CODE = "mcp_response.spill_persistence_failed.v1";

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
const DEFAULT_INLINE_BYTE_LIMIT = 128 * 1024;
const DEFAULT_PREVIEW_BYTE_LIMIT = 2048;
const MIN_INLINE_BYTE_LIMIT = 8 * 1024;
const MAX_REFERENCE_READ_BYTE_LIMIT = 64 * 1024;
const REF_ID_PATTERN = /^[a-zA-Z0-9._-]+$/;

const RESPONSE_BOUNDARY_ROUTE = "mcp_response";

const CONTROLLED_CONTRACT_FORBIDDEN_RESPONSE_KEYS = new Set([
  "content_reference", "raw", "raw_bytes", "carrier_bytes", "proof_bytes",
  "artifact_bytes"
]);

function sameJson(left, right) {
  return isDeepStrictEqual(left, right);
}

function assertAssessmentAuthority(value, toolName) {
  const authority = value?.authority;
  const falseKeys = [
    "authoritative", "proof_authority", "requirement_authority", "admission_authority",
    "dispatch_authority", "review_authority", "integration_authority",
    "publication_authority", "completion_authority", "runtime_proof",
    "lifecycle_transition"
  ];
  if (!authority || falseKeys.some((key) => authority[key] !== false) ||
      authority.read_only !== true || authority.experimental !== true ||
      !Array.isArray(authority.grants) || authority.grants.length !== 0) {
    throw new Error(`${toolName ?? "controlled-contract route"} produced authorizing assessment semantics`);
  }
}

function assertTypedContinuation(value, toolName) {
  if (!sameJson(value?.continuation,
    CONTROLLED_CONTRACT_ASSESSMENT_PROJECTION_VOCABULARY.continuation)) {
    throw new Error(`${toolName ?? "controlled-contract route"} omitted typed lossless continuation`);
  }
}

function assertTaskRelevantItem(item, descriptor, toolName) {
  if (item?.schema_version === "controlled-contract-assessment-row-projection.v1") {
    const fields = Array.isArray(item.fields)
      ? item.fields.map((field) => field?.path?.length === 1 ? field.path[0] : null) : [];
    if (!sameJson(fields, descriptor.fields)) {
      throw new Error(`${toolName ?? "controlled-contract route"} produced an incomplete field inventory`);
    }
    return;
  }
  if (!sameJson(Object.keys(item).sort(), [...descriptor.fields].sort())) {
    throw new Error(`${toolName ?? "controlled-contract route"} produced a non-task-relevant field`);
  }
}

function assertAssessmentSemanticShape(value, toolName) {
  const removedAssessmentFields = [
    "completeness_exemption", "detail_digest", "result_digest",
    "population_digest", "requirement_digest"
  ];
  const assertAssessmentEnvelope = (candidate, family) => {
    const operation = family === "proof"
      ? "workspace_controlled_contract_assessment_query"
      : "workspace_controlled_contract_integration_test_design_query";
    if (typeof candidate.assessment_identity !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/u.test(candidate.assessment_identity) ||
        candidate.supported_next_call !== operation ||
        removedAssessmentFields.some((field) => Object.hasOwn(candidate, field))) {
      throw new Error(`${toolName ?? "controlled-contract route"} produced an invalid assessment envelope`);
    }
  };
  if (value?.schema_version === "controlled-contract-proof-assessment-summary.v1" ||
      value?.schema_version === "controlled-contract-integration-assessment-summary.v1") {
    const family = value.family;
    assertAssessmentEnvelope(value, family);
    const descriptors = CONTROLLED_CONTRACT_ASSESSMENT_COLLECTION_DESCRIPTORS[family];
    const keys = value.counts && typeof value.counts === "object"
      ? Object.keys(value.counts) : [];
    const expected = Array.isArray(descriptors)
      ? descriptors.map(({ collection }) => collection) : [];
    if (JSON.stringify(keys) !== JSON.stringify(expected) ||
        !keys.every((key) => Number.isInteger(value.counts[key]) && value.counts[key] >= 0)) {
      throw new Error(`${toolName ?? "controlled-contract route"} produced incomplete or invalid descriptor counts`);
    }
    const total = keys.reduce((sum, key) => sum + value.counts[key], 0);
    if (value.total_count !== total || value.omitted_count !== total ||
        !sameJson(value.compact_omission,
          CONTROLLED_CONTRACT_ASSESSMENT_PROJECTION_VOCABULARY.compact_omission)) {
      throw new Error(`${toolName ?? "controlled-contract route"} produced incorrect assessment totals`);
    }
    assertAssessmentAuthority(value, toolName);
    assertTypedContinuation(value, toolName);
  }
  if (value?.schema_version === "controlled-contract-assessment-semantic-page.v1") {
    assertAssessmentEnvelope(value, value.family);
    if (!assessmentCollectionDescriptor(value.family, value.collection)) {
      throw new Error(`${toolName ?? "controlled-contract route"} produced an undeclared assessment collection`);
    }
    if (!Array.isArray(value.items) || value.returned_count !== value.items.length ||
        !Number.isInteger(value.offset) || value.offset < 0 ||
        !Number.isInteger(value.matched_count) || !Number.isInteger(value.omitted_count) ||
        value.returned_count < 0 || value.omitted_count < 0 ||
        value.returned_count > 64 ||
        value.offset + value.returned_count + value.omitted_count !== value.matched_count) {
      throw new Error(`${toolName ?? "controlled-contract route"} produced incorrect assessment page counts`);
    }
    const descriptor = assessmentCollectionDescriptor(value.family, value.collection);
    if (descriptor !== null) {
      value.items.forEach((item) => assertTaskRelevantItem(item, descriptor, toolName));
    }
    assertAssessmentAuthority(value, toolName);
    assertTypedContinuation(value, toolName);
  }
  if (value?.schema_version === "controlled-contract-assessment-field.v1") {
    assertAssessmentEnvelope(value, value.family);
    const descriptor = assessmentCollectionDescriptor(value.family, value.collection);
    if (!Array.isArray(value.field_path) || value.field_path.length === 0 ||
        descriptor === null || !descriptor.fields.includes(String(value.field_path[0])) ||
        value.selector === null || typeof value.selector?.id !== "string" ||
        Object.keys(value.selector).some((key) => key !== "id") ||
        value.source_current !== true ||
        !Number.isInteger(value.total) || value.total < 0) {
      throw new Error(`${toolName ?? "controlled-contract route"} produced invalid field continuation`);
    }
    if (Array.isArray(value.fields) &&
        (!Number.isInteger(value.offset) || value.offset < 0 ||
         value.returned_count !== value.fields.length ||
         !Number.isInteger(value.omitted_count) || value.omitted_count < 0 ||
         value.offset + value.returned_count + value.omitted_count !== value.total)) {
      throw new Error(`${toolName ?? "controlled-contract route"} produced incorrect field counts`);
    }
    if (Object.hasOwn(value, "value_base64") &&
        (!Number.isInteger(value.offset) || value.offset < 0 ||
         !Number.isInteger(value.length) || value.length < 0 ||
         value.offset + value.length > value.total)) {
      throw new Error(`${toolName ?? "controlled-contract route"} produced an invalid scalar range`);
    }
    assertAssessmentAuthority(value, toolName);
    assertTypedContinuation(value, toolName);
  }
}

export function assertNoControlledContractRawResponse(value, { toolName = null } = {}) {
  const seen = new Set();
  const visit = (candidate) => {
    if (candidate === null || typeof candidate !== "object" || seen.has(candidate)) return;
    seen.add(candidate);
    assertAssessmentSemanticShape(candidate, toolName);
    if (candidate.schema_version === REFACTOR_ITEM_REFERENCE_SCHEMA_VERSION) {
      if (!["plan", "receipt"].includes(candidate.resource_kind) ||
          typeof candidate.item_identity !== "string" ||
          candidate.content_reference?.kind !== CONTENT_REFERENCE_KIND) {
        throw new Error("controlled-contract refactor item reference is malformed");
      }
      return;
    }
    if (candidate.kind === CONTENT_REFERENCE_KIND ||
        candidate.schema_version === SPILLED_RESPONSE_SCHEMA_VERSION) {
      throw new Error(`${toolName ?? "controlled-contract route"} produced a forbidden content-reference envelope`);
    }
    for (const [key, nested] of Object.entries(candidate)) {
      if (CONTROLLED_CONTRACT_FORBIDDEN_RESPONSE_KEYS.has(key)) {
        throw new Error(`${toolName ?? "controlled-contract route"} produced forbidden raw response field ${key}`);
      }
      visit(nested);
    }
  };
  visit(value);
  return value;
}

const MAX_CAUSE_DEPTH = 4;

function safeReadProperty(target, key) {
  if (target === null || target === undefined) return undefined;
  try {
    return target[key];
  } catch {
    return undefined;
  }
}

function preservedCauseIdentity(error) {
  let current = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current && typeof current === "object"; depth += 1) {

    const code = safeReadProperty(current, "code");
    if (typeof code === "string") {
      if (isPlatformErrorCode(code)) return { identity: null, platform: true };
      if (isPreservableSemanticIdentity(code)) return { identity: code, platform: false };
    }
    current = safeReadProperty(current, "cause");
  }
  return { identity: null, platform: false };
}

function buildResponseMechanicalRefusal({ code, decidingFacts, observedFacts, carried = null }) {
  return buildPublicMechanicalRefusal({
    code,
    deciding_facts: decidingFacts,
    no_supported_route: true,
    recovery: { state: "no_supported_route" },
    route: RESPONSE_BOUNDARY_ROUTE,
    observed_facts: observedFacts,
    ...(carried === null ? {} : { carried })
  });
}

function authenticatedExternalCondition(value) {
  const condition = safeReadProperty(value, "external_condition");
  return safeReadProperty(value, "authenticated_external_condition") === true &&
    typeof condition === "string" && condition.length > 0 && condition.length <= 256
    ? condition
    : null;
}

function untypedFailureEnvelope(error) {
  const { identity, platform } = preservedCauseIdentity(error);
  const preservableIdentity = identity === "operator_recovery_needed" ? null : identity;
  const diagnostic = projectDiagnostic(error, {
    fieldPrefix: "mcp_response.thrown_diagnostic"
  });
  const decidingFacts = [
    { field: "mcp_response.handler_completed", value: false }
  ];
  const observedFacts = { "mcp_response.handler_completed": false };
  if (preservableIdentity !== null) {

    decidingFacts.push({ field: "mcp_response.cause_identity", value: preservableIdentity });
    observedFacts["mcp_response.cause_identity"] = preservableIdentity;
  }
  if (platform) {

    decidingFacts.push({ field: "mcp_response.platform_error", value: true });
    observedFacts["mcp_response.platform_error"] = true;
  }
  const externalCondition = authenticatedExternalCondition(error);
  const classification = externalCondition !== null
    ? classifyMechanicalRuntimeBlocker({
        producer: "unexpected_external",
        condition: "authenticated_condition",
        detail: { authenticated: true, external_condition: externalCondition }
      })
    : preservableIdentity !== null && isRuntimeBlockerCode(preservableIdentity)
      ? null
      : classifyMechanicalRuntimeBlocker({
          producer: "mcp_response",
          condition: platform ? "platform_failure" : "handler_exception"
        });
  const code = classification?.code ?? preservableIdentity;
  if (externalCondition !== null) {
    decidingFacts.push({
      field: "mcp_response.external_condition",
      value: externalCondition
    });
    observedFacts["mcp_response.external_condition"] = externalCondition;
  }
  return {
    schema_version: RESPONSE_REFUSAL_SCHEMA_VERSION,
    code,
    accepted: false,
    owning_boundary: classification?.owning_boundary ?? "wiki-mcp.mcp-response",
    next_calls: classification?.detail?.next_calls ?? [],
    diagnostic: diagnostic.value,
    diagnostic_redactions: diagnostic.redactions,
    refusal: buildResponseMechanicalRefusal({
      code,
      decidingFacts,
      observedFacts
    })
  };
}

function normalizeDeclaredOperatorRecoveryEnvelope(envelope) {
  const declaredRefusal = safeReadProperty(envelope, "refusal");
  const topLevelClaim = safeReadProperty(envelope, "code") === "operator_recovery_needed";
  const nestedClaim = declaredRefusal !== null && typeof declaredRefusal === "object" &&
    !Array.isArray(declaredRefusal) &&
    safeReadProperty(declaredRefusal, "code") === "operator_recovery_needed";
  if (!topLevelClaim && !nestedClaim) return envelope;

  const externalCondition = authenticatedExternalCondition(envelope);
  const classification = externalCondition === null
    ? classifyMechanicalRuntimeBlocker({
        producer: "mcp_response",
        condition: "handler_exception"
      })
    : classifyMechanicalRuntimeBlocker({
        producer: "unexpected_external",
        condition: "authenticated_condition",
        detail: { authenticated: true, external_condition: externalCondition }
      });
  const decidingFacts = externalCondition === null
    ? [
        { field: "mcp_response.handler_completed", value: false },
        { field: "mcp_response.declared_operator_recovery_authenticated", value: false }
      ]
    : [
        { field: "mcp_response.handler_completed", value: false },
        { field: "mcp_response.external_condition", value: externalCondition }
      ];
  const observedFacts = Object.fromEntries(
    decidingFacts.map(({ field, value }) => [field, value])
  );
  return {
    schema_version: RESPONSE_REFUSAL_SCHEMA_VERSION,
    code: classification.code,
    accepted: false,
    authority_limb: classification.authority_limb,
    cause: classification.cause,
    actor_recovery: classification.actor_recovery,
    owning_boundary: classification.owning_boundary,
    no_supported_route: true,
    next_calls: classification.detail.next_calls,
    ...(externalCondition === null ? {} : {
      authenticated_external_condition: true,
      external_condition: externalCondition
    }),
    refusal: buildResponseMechanicalRefusal({
      code: classification.code,
      decidingFacts,
      observedFacts,
      carried: { mechanical_classification: classification }
    })
  };
}

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

export function measureMcpInlineResultBytes(payload, { isError = false } = {}) {
  const canonical = canonicalizeStructuredPayload(payload);
  if (!canonical) return Number.POSITIVE_INFINITY;
  return serializedResultBytes(buildTwoChannelResult(canonical, { isError }));
}

export function activeMcpInlineByteLimit(env = process.env) {
  return getResponseSpillConfig(env).inlineByteLimit;
}

function serializedResultFits(result, limit) {
  try {
    return serializedResultBytes(result) <= limit;
  } catch {
    return false;
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

function buildTwoChannelResult({ jsonText, value }, { isError = false } = {}) {
  const result = {
    content: [{ type: "text", text: jsonText }],
    structuredContent: value
  };
  if (isError) {
    result.isError = true;
  }
  return result;
}

function requiredStructuredContentFailure(operation, brokenInvariant) {
  const payload = {
    code: "mechanical_failure",
    authority_limb: "mechanical_failure",
    operation,
    broken_invariant: brokenInvariant
  };
  return buildTwoChannelResult(canonicalizeStructuredPayload(payload), { isError: true });
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

function contentMirrorsStructuredContent(content, payload) {
  if (!Array.isArray(content) || content.length !== 1) {
    return false;
  }
  const [block] = content;
  if (!block || block.type !== "text" || typeof block.text !== "string") {
    return false;
  }
  let parsed;
  try {
    parsed = JSON.parse(block.text);
  } catch {
    return false;
  }
  return isDeepStrictEqual(parsed, payload);
}

function isSpilledEnvelope(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.schema_version === SPILLED_RESPONSE_SCHEMA_VERSION &&
    value.response_spilled === true
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

function buildPreview(buffer, previewByteLimit) {
  const previewBuffer = buffer.subarray(0, Math.min(previewByteLimit, buffer.byteLength));
  return {
    text: previewBuffer.toString("utf8"),
    bytes: previewBuffer.byteLength
  };
}

function persistSpilledPayload(jsonText, { env = process.env, config = null } = {}) {
  const resolvedConfig = config ?? getResponseSpillConfig(env);
  const bytes = Buffer.from(jsonText, "utf8");

  mkdirSync(resolvedConfig.stateDir, { recursive: true, mode: 0o700 });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const refId = `resp-${Date.now()}-${process.pid}-${randomUUID()}`;
  const absolutePath = referencePathForId(resolvedConfig.stateDir, refId);
  const metadataPath = metadataPathForId(resolvedConfig.stateDir, refId);
  writeFileSync(absolutePath, bytes, { mode: 0o600 });
  writeFileSync(
    metadataPath,
    `${JSON.stringify({
      schema_version: "wiki-mcp-content-reference-metadata.v1",
      ref_id: refId,
      media_type: "application/json",
      encoding: "utf8",
      byte_count: bytes.byteLength,
      sha256,
      created_at: new Date().toISOString()
    }, null, 2)}\n`,
    { mode: 0o600 }
  );

  return {
    schema_version: SPILLED_RESPONSE_SCHEMA_VERSION,
    response_spilled: true,
    reason: "response_exceeds_inline_byte_limit",
    inline_byte_limit: resolvedConfig.inlineByteLimit,
    total_bytes: bytes.byteLength,
    preview: buildPreview(bytes, resolvedConfig.previewByteLimit),
    content_reference: {
      kind: CONTENT_REFERENCE_KIND,
      ref_id: refId,
      media_type: "application/json",
      encoding: "utf8",
      byte_count: bytes.byteLength,
      sha256,
      read_tool: "workspace_read_mcp_content_reference",
      range: {
        offset: 0,
        length: Math.min(resolvedConfig.maxReferenceReadBytes, bytes.byteLength),
        max_length: resolvedConfig.maxReferenceReadBytes
      }
    }
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
    ? ["schema_version", "response_spilled", "reason", "inline_byte_limit", "total_bytes", "preview", "content_reference"]
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
  const result = buildTwoChannelResult(canonical, { isError });
  if (serializedResultBytes(result) <= config.inlineByteLimit) {
    return result;
  }
  const trimmed = canonicalizeStructuredPayload(dropEnvelopePreview(envelope)) ?? canonical;
  const trimmedResult = buildTwoChannelResult(trimmed, { isError });
  if (serializedResultBytes(trimmedResult) <= config.inlineByteLimit) {
    return trimmedResult;
  }
  const bounded = canonicalizeStructuredPayload(canonicalTerminalEnvelopeFields(trimmed.value));
  const boundedResult = buildTwoChannelResult(bounded, { isError });
  return serializedResultFits(boundedResult, config.inlineByteLimit)
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
  const diagnostic = projectDiagnostic(cause, {
    fieldPrefix: "mcp_response.spill_failure_cause"
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

    cause_diagnostic: diagnostic.value,
    cause_diagnostic_redactions: diagnostic.redactions
  };
}

function spillOrRefuse(canonicalValue, { isError = false, env = process.env, config }) {
  const jsonText = JSON.stringify(canonicalValue, null, 2);
  let envelope;

  try {
    envelope = persistSpilledPayload(jsonText, { env, config });
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
  { isError = false, env = process.env, config = null, forceSpill = false } = {}
) {
  const resolvedConfig = config ?? getResponseSpillConfig(env);
  const canonical = canonicalizeStructuredPayload(payload);
  if (!canonical) {
    return null;
  }
  if (!forceSpill) {
    const inline = buildTwoChannelResult(canonical, { isError });
    if (serializedResultBytes(inline) <= resolvedConfig.inlineByteLimit) {
      return inline;
    }
    if (isSpilledEnvelope(canonical.value) || isTerminalResponseRefusalEnvelope(canonical.value)) {
      return boundTerminalEnvelopeResult(canonical.value, { isError, config: resolvedConfig });
    }
  }
  return spillOrRefuse(canonical.value, { isError, env, config: resolvedConfig });
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

export function jsonContent(data, { env = process.env, forceSpill = false } = {}) {
  const config = getResponseSpillConfig(env);
  const shaped = shapeStructuredResult(data, { isError: false, env, config, forceSpill });
  if (shaped) {
    return shaped;
  }

  return errorContent(new Error("MCP result payload is not JSON-serializable"), { env });
}

export function normalizeMcpToolResult(result, { env = process.env } = {}) {
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    return result;
  }
  if (!Object.prototype.hasOwnProperty.call(result, "structuredContent")) {
    return result;
  }
  const payload = result.structuredContent;
  if (payload === undefined) {
    return result;
  }
  const config = getResponseSpillConfig(env);
  const isError = result.isError === true;
  if (
    contentMirrorsStructuredContent(result.content, payload) &&
    serializedResultFits(result, config.inlineByteLimit)
  ) {
    return result;
  }
  const canonical = canonicalizeStructuredPayload(payload);
  if (!canonical) {
    return errorContent(new Error("MCP result payload is not JSON-serializable"), { env });
  }
  const inline = buildTwoChannelResult(canonical, { isError });
  const completeInline = { ...result, ...inline };
  if (serializedResultFits(completeInline, config.inlineByteLimit)) {
    return completeInline;
  }
  if (isSpilledEnvelope(canonical.value) || isTerminalResponseRefusalEnvelope(canonical.value)) {
    return boundTerminalEnvelopeResult(canonical.value, { isError, config });
  }

  const shaped = shapeStructuredResult(payload, {
    isError,
    env,
    config,
    forceSpill: true
  });
  if (!shaped) {
    return errorContent(new Error("MCP result payload is not JSON-serializable"), { env });
  }
  const completeSpill = { ...result, ...shaped };

  return serializedResultFits(completeSpill, config.inlineByteLimit)
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
        if (requiredFailure !== null) return requiredFailure;
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

export function installProcessErrorGuards({
  processLike = process,
  log = null,
  diagnostics = null,
  requestShutdown = null
} = {}) {
  if (!processLike || typeof processLike.on !== "function") {
    throw new Error("installProcessErrorGuards requires a process-like object with .on()");
  }
  if (processLike[PROCESS_ERROR_GUARDS_INSTALLED]) {
    return { installed: false };
  }

  let lastTerminalDiagnostic = null;

  const failStop = ({ event, error, origin = null }) => {
    const entry = {
      level: "error",
      message:
        "wiki-mcp process-level invariant escaped its registered owner; failing stop",
      event,
      origin,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null
    };

    let published = false;
    if (diagnostics && typeof diagnostics.emit === "function") {
      try {
        published = diagnostics.emit(entry) === true;
      } catch {

        published = false;
      }
    }
    lastTerminalDiagnostic = Object.freeze({ event, origin, published });

    if (typeof log === "function") {
      try {
        log({ ...entry, diagnostic_published: published });
      } catch {

      }
    }

    if (diagnostics && typeof diagnostics.disable === "function") {
      try {
        diagnostics.disable();
      } catch {

      }
    }

    if (typeof requestShutdown === "function") requestShutdown(1);
  };

  processLike.on("unhandledRejection", (reason) => {
    failStop({ event: "unhandledRejection", error: reason });
  });
  processLike.on("uncaughtException", (error, origin) => {
    failStop({ event: "uncaughtException", error, origin });
  });

  Object.defineProperty(processLike, PROCESS_ERROR_GUARDS_INSTALLED, {
    value: true,
    enumerable: false,
    configurable: false
  });
  return {
    installed: true,
    get lastTerminalDiagnostic() { return lastTerminalDiagnostic; }
  };
}

export function createDiagnosticSink({
  stderr = process.stderr,
  serialize = JSON.stringify,
  write = (stream, text) => stream.write(text),
  log = null
} = {}) {
  let state = "active";
  const disable = () => { state = "disabled"; };
  if (stderr && typeof stderr.on === "function") {
    stderr.on("error", disable);
    stderr.on("close", disable);
  }
  const emit = (entry) => {
    if (state !== "active") return false;
    state = "emitting";
    try {
      write(stderr, `${serialize(entry)}\n`);
      if (typeof log === "function") log(entry);

      if (state === "emitting") state = "active";
      return true;
    } catch {
      disable();
      return false;
    }
  };
  return {
    emit,
    disable,
    get state() { return state; },
    get disabled() { return state === "disabled"; }
  };
}

export function createStdioShutdownController({
  processLike = process,
  stdin = process.stdin,
  stdout = process.stdout,
  stderr = process.stderr,
  readPpid = () => processLike.ppid,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  terminate = (code) => processLike.exit(code),
  disableDiagnostics = () => {},
  closeTimeoutMs = 2000
} = {}) {
  if (!processLike || typeof processLike.on !== "function") {
    throw new Error("createStdioShutdownController requires a process-like object");
  }
  const on = (stream, event, handler) => {
    if (!stream || typeof stream.on !== "function") {
      throw new Error(`shutdown controller requires a ${event} stream listener`);
    }
    stream.on(event, handler);
  };
  let phase = "running";
  let outcome = 0;
  let eofObserved = false;
  let serverCloseHook = null;
  let cleanupPromise = null;
  let cleanupCompletionPromise = null;
  let cleanupHook = null;
  let parentInterval = null;
  let cleanupTimer = null;
  let terminalActionTaken = false;
  const initialPpid = readPpid();

  const terminateOnce = (code) => {
    if (terminalActionTaken) return;
    terminalActionTaken = true;
    if (cleanupTimer !== null) clearTimeoutFn(cleanupTimer);
    if (parentInterval !== null) {
      clearIntervalFn(parentInterval);
      parentInterval = null;
    }
    phase = "terminated";
    terminate(code);
  };
  const cleanup = () => {
    if (cleanupPromise) return cleanupPromise;

    cleanupHook = serverCloseHook;
    cleanupPromise = Promise.resolve().then(() => (
      typeof cleanupHook === "function" ? cleanupHook() : undefined
    ));
    return cleanupPromise;
  };
  const requestShutdown = (requestedOutcome = 1) => {
    if (phase === "terminated") return cleanupPromise || Promise.resolve();
    if (requestedOutcome === 1) outcome = 1;
    if (phase === "running") phase = "closing";
    const currentCleanup = cleanup();
    if (cleanupTimer === null) cleanupTimer = setTimeoutFn(() => terminateOnce(1), closeTimeoutMs);
    if (cleanupCompletionPromise === null) {
      cleanupCompletionPromise = currentCleanup.then(
        () => terminateOnce(outcome),
        () => terminateOnce(1)
      );
    }
    return currentCleanup;
  };
  on(stdin, "end", () => { eofObserved = true; requestShutdown(0); });
  on(stdin, "close", () => requestShutdown(eofObserved ? 0 : 1));
  on(stdin, "error", () => requestShutdown(1));
  on(stdout, "close", () => requestShutdown(1));
  on(stdout, "error", () => requestShutdown(1));
  on(stderr, "close", disableDiagnostics);
  on(stderr, "error", disableDiagnostics);

  const initialPpidValid = Number.isInteger(initialPpid) && initialPpid > 1;
  if (!initialPpidValid) {
    requestShutdown(1);
  } else {
    parentInterval = setIntervalFn(() => {
      if (readPpid() !== initialPpid) requestShutdown(1);
    }, 250);
    if (parentInterval && typeof parentInterval.unref === "function") parentInterval.unref();
  }
  return {
    requestShutdown,
    setServerCloseHook(hook) {
      if (typeof hook !== "function") throw new TypeError("server close hook must be a function");
      serverCloseHook = hook;
    },
    cleanup,
    get phase() { return phase; },
    get outcome() { return outcome; },
    get parentInterval() { return parentInterval; }
  };
}

export function redactAbsolutePaths(text) {
  return text;
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
        text: projectDiagnostic(error, {
          fieldPrefix: "mcp_response.thrown_diagnostic"
        }).value
      }
    ],
    isError: true
  };
}
