import { CONTROLLED_CONTRACT_ASSESSMENT_COLLECTION_DESCRIPTORS, CONTROLLED_CONTRACT_ASSESSMENT_PROJECTION_VOCABULARY, assessmentCollectionDescriptor } from "@agent-chassis/controlled-contract/assessment-collection-descriptors";
import { sameJson, PROCESS_ERROR_GUARDS_INSTALLED, SPILLED_RESPONSE_SCHEMA_VERSION, CONTENT_REFERENCE_READ_SCHEMA_VERSION, CONTENT_REFERENCE_KIND, REFACTOR_ITEM_REFERENCE_SCHEMA_VERSION, CONTENT_REFERENCE_READ_REFUSAL_SCHEMA_VERSION, CONTENT_REFERENCE_RANGED_READ_UNAVAILABLE_CODE, RESPONSE_REFUSAL_SCHEMA_VERSION, SPILL_PERSISTENCE_FAILED_CODE, SPILLED_ENVELOPE_FIELDS, CONTENT_REFERENCE_FIELDS, CONTENT_REFERENCE_READ_TOOL, VERIFY_PROOF_SUMMARY_SCHEMA_VERSION, VERIFY_PROOF_EVIDENCE_SCHEMA_VERSION, RESULT_DIGEST_PATTERN, SPILL_MEASUREMENT_SCHEMA_VERSION, RETAINED_PAYLOAD_ENCODING, SPILL_MEASUREMENT_FIELDS, SPILL_COMPARISONS, spillMeasurement, SPILLED_REASON, SPILLED_REF_ID_PREFIX, DEFAULT_INLINE_BYTE_LIMIT, DEFAULT_PREVIEW_BYTE_LIMIT, MIN_INLINE_BYTE_LIMIT, MAX_REFERENCE_READ_BYTE_LIMIT, REF_ID_PATTERN, RESPONSE_BOUNDARY_ROUTE, hasExactKeys, isPositiveSafeInteger, isLosslessMcpSpillDelivery, isMintedSpillMeasurement, isMintedContentReference, hasOnlyGeneratedTextCarrier, isSpilledEnvelope } from "./mcp-response-shared.mjs";
const CONTROLLED_CONTRACT_FORBIDDEN_RESPONSE_KEYS = new Set([
  "content_reference", "raw", "raw_bytes", "carrier_bytes", "proof_bytes",
  "artifact_bytes"
]);

const CONTROLLED_CONTRACT_RESERVED_ASSESSMENT_SCHEMA_VERSIONS = Object.freeze(new Set([
  "controlled-contract-proof-assessment-summary.v1",
  "controlled-contract-integration-assessment-summary.v1"
]));

export function isReservedControlledContractAssessmentEnvelope(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    CONTROLLED_CONTRACT_RESERVED_ASSESSMENT_SCHEMA_VERSIONS.has(value.schema_version);
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
  const assertAssessmentEnvelope = (candidate) => {
    if (typeof candidate.assessment_identity !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/u.test(candidate.assessment_identity) ||
        candidate.supported_next_call !== null ||
        removedAssessmentFields.some((field) => Object.hasOwn(candidate, field))) {
      throw new Error(`${toolName ?? "controlled-contract route"} produced an invalid assessment envelope`);
    }
  };
  if (isReservedControlledContractAssessmentEnvelope(value)) {
    const family = value.family;
    assertAssessmentEnvelope(value);
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
    assertAssessmentEnvelope(value);
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

export function assertNoControlledContractRawResponse(
  value,
  { toolName = null, losslessDelivery = false } = {}
) {
  if (losslessDelivery === true && isLosslessMcpSpillDelivery(value)) return value;
  const seen = new Set();
  const visit = (candidate) => {
    if (candidate === null || typeof candidate !== "object") return;
    if (seen.has(candidate)) return;
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
    for (const [nestedKey, nested] of Object.entries(candidate)) {
      if (CONTROLLED_CONTRACT_FORBIDDEN_RESPONSE_KEYS.has(nestedKey)) {
        throw new Error(`${toolName ?? "controlled-contract route"} produced forbidden raw response field ${nestedKey}`);
      }
      visit(nested);
    }
  };
  visit(value);
  return value;
}

