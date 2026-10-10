

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  createTaskResultSnapshotRegistry,
  TaskResultSnapshotError
} from "@agent-chassis/controlled-contract/task-result-snapshots";
import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
import { buildPublicMechanicalRefusal } from "@agent-chassis/wiki-core/src/lib/refusal-payload.mjs";
import { isRuntimeBlockerCode } from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
import { WORK_RECORD_COMPACT_RESULT_MAX_UTF8_BYTES } from
  "@agent-chassis/wiki-core/src/lib/work-record-entry-schema.mjs";

import {
  activeMcpInlineByteLimit,
  getResponseSpillConfig,
  isReservedControlledContractAssessmentEnvelope,
  jsonContent,
  listRetainedArtifacts,
  measureMcpInlineResultBytes,
  readRetainedJson,
  retainedArtifactNotFoundError,
  RETAINED_ARTIFACT_READ_FAILURES,
  selectedFullContent
} from "./mcp-response.mjs";
import { RETAINED_REF_ID_PATTERN, SPILLED_REF_ID_PREFIX } from "./mcp-response-shared.mjs";
import { projectZodRequestContract } from "./zod-request-contract-projection.mjs";

export const SELECTED_RESPONSE_SOURCE_SCHEMA_VERSION = "selected-response-source.v1";
export const SELECTED_RESPONSE_DETAIL_SCHEMA_VERSION = "selected-response-detail.v1";
export const SELECTED_RESPONSE_SNAPSHOT_UNAVAILABLE_CODE = "selected_response_snapshot_unavailable";
export const SELECTED_RESPONSE_QUERY_INVALID_CODE = "selected_response_query_invalid";

export const SELECTED_RESPONSE_LOCATOR_NOT_CURRENT_REASON = "source_locator_not_current";

const CONTENT_REFERENCE_UNAVAILABLE_CODE = "mcp_response.content_reference_ranged_read_unavailable.v1";

for (const code of [
  SELECTED_RESPONSE_SNAPSHOT_UNAVAILABLE_CODE,
  SELECTED_RESPONSE_QUERY_INVALID_CODE,
  CONTENT_REFERENCE_UNAVAILABLE_CODE
]) {
  if (!isRuntimeBlockerCode(code)) {
    throw new Error(`selected-response composition publishes ${code}, which is not registered`);
  }
}

export const SELECTED_RESPONSE_MEMBERS_COLLECTION = "members";
const MEMBER_ROW_FIELDS = Object.freeze(["id", "value", "collection", "count"]);
const ARRAY_ROW_FIELDS = Object.freeze(["id", "value"]);
const COLLECTION_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;
const MAXIMUM_ITEMS = 64;

const SCALAR_RANGE_FRAME_RESERVE_BYTES = 1536;

const MEASURED_OBSERVATION_STATE = "unavailable";
const OBSERVATION_IDENTITY_INLINE_MAX_CHARS = 128;

export function selectedResponseDeliveryBound(env = process.env) {
  return Math.min(WORK_RECORD_COMPACT_RESULT_MAX_UTF8_BYTES, activeMcpInlineByteLimit(env));
}

export function selectedResponseMaximumScalarRangeBytes(env = process.env) {
  return scalarRangeBytesWithinDeliveryBound(selectedResponseDeliveryBound(env));
}

export function scalarRangeBytesWithinDeliveryBound(bound) {

  return Math.max(1, Math.floor((bound - SCALAR_RANGE_FRAME_RESERVE_BYTES) * 3 / 4));
}

export function selectedResponseLocatorSchema(z) {
  return z.object({ ref_id: z.string().regex(RETAINED_REF_ID_PATTERN) }).strict();
}

export function selectedResponseLocator(source) {
  return { ref_id: source.ref_id };
}

export function isCurrentSelectedResponseLocator(source) {
  return typeof source?.ref_id === "string" && RETAINED_REF_ID_PATTERN.test(source.ref_id);
}

export function selectedResponseDetailSchema(z) {
  return z.object({
    source: selectedResponseLocatorSchema(z),
    snapshot_identity: z.string().regex(/^[A-Za-z0-9_-]{43}$/u).optional(),
    cursor: z.string().min(1).max(8192).optional(),
    collection: z.string().regex(COLLECTION_NAME_PATTERN),
    selector: z.object({ id: z.string().min(1).max(256) }).strict().optional(),
    ordinal: z.number().int().min(0).optional(),
    field_path: z.array(z.union([
      z.string().min(1).max(256),
      z.number().int().min(0)
    ])).min(1).max(32).optional(),
    offset: z.number().int().min(0).optional(),
    length: z.number().int().min(1).optional()
  }).strict();
}

export function selectedResponseRequestSchema(zodSchema) {
  const projected = projectZodRequestContract(zodSchema);
  if (projected === null || (projected.unprojected ?? []).length > 0) {
    throw new TypeError("selected-response request schema must project exactly");
  }
  return projected.contract;
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalJson(value) {
  return JSON.parse(JSON.stringify(value));
}

export function containsReservedAssessmentEnvelope(value) {
  const stack = [value];
  while (stack.length > 0) {
    const candidate = stack.pop();
    if (candidate === null || typeof candidate !== "object") continue;
    if (isReservedControlledContractAssessmentEnvelope(candidate)) return true;
    for (const nested of Object.values(candidate)) stack.push(nested);
  }
  return false;
}

function assertBinding(binding) {
  if (binding === null || typeof binding !== "object" ||
      typeof binding.route !== "string" || binding.route.length === 0 ||
      typeof binding.repository !== "string" || binding.repository.length === 0 ||
      !(binding.unit === null || typeof binding.unit === "string")) {
    throw new TypeError("selected-response binding requires route, repository and unit");
  }
  return Object.freeze({
    route: binding.route,
    repository: binding.repository,
    unit: binding.unit,
    query_identity: binding.query_identity === undefined ? null : canonicalJson(binding.query_identity),
    observation_identity: binding.observation_identity === undefined
      ? null : canonicalJson(binding.observation_identity),

    ...(binding.authority_identity === undefined || binding.authority_identity === null
      ? {} : { authority_identity: canonicalJson(binding.authority_identity) })
  });
}

function authorityIdentityDigest(identity) {
  return sha256Hex(JSON.stringify(canonicalJson(identity)));
}

function hasAuthorityIdentity(identity) {
  return identity !== undefined && identity !== null;
}

export function projectSelectedResponseCollections(carrier) {
  if (carrier === null || typeof carrier !== "object" || Array.isArray(carrier)) {
    throw new TypeError("selected-response carrier must be an object");
  }
  const members = [];
  const collections = {};
  for (const [key, value] of Object.entries(carrier)) {
    if (Array.isArray(value)) {
      if (key === SELECTED_RESPONSE_MEMBERS_COLLECTION || !COLLECTION_NAME_PATTERN.test(key)) {
        throw new TypeError(`selected-response carrier array member ${key} cannot be a collection`);
      }
      collections[key] = value.map((item, index) => ({ id: String(index), value: item }));
      members.push({ id: key, collection: key, count: value.length });
    } else {
      members.push({ id: key, value });
    }
  }
  return { [SELECTED_RESPONSE_MEMBERS_COLLECTION]: members, ...collections };
}

export function selectedResponseCollectionCounts(carrier) {
  return Object.fromEntries(Object.entries(projectSelectedResponseCollections(carrier))
    .map(([collection, rows]) => [collection, rows.length]));
}

function retainedSourceSummary(binding, source) {
  const observation = binding.observation_identity;
  const inlineObservation = typeof observation === "string" &&
    observation.length <= OBSERVATION_IDENTITY_INLINE_MAX_CHARS;
  return Object.freeze({
    route: binding.route,
    ref_id: source.ref_id,
    repository: binding.repository,
    unit: binding.unit,
    query_identity_sha256: binding.query_identity === null
      ? null : sha256Hex(JSON.stringify(binding.query_identity)),

    ...(Object.hasOwn(binding, "authority_identity")
      ? { authority_identity_sha256: authorityIdentityDigest(binding.authority_identity) } : {}),
    ...(inlineObservation
      ? { observation_identity: observation }
      : { observation_identity_sha256: observation === null
          ? null : sha256Hex(JSON.stringify(observation)) })
  });
}

function refusalError(message, envelope) {
  const error = new Error(message);
  error.code = envelope.code;
  error.envelope = envelope;
  return error;
}

function factsObject(facts) {
  return Object.fromEntries(facts.map(({ field, value }) => [field, value]));
}

function retainedSourceUnreadable(route, reason) {
  const facts = [
    { field: "content_reference.readable", value: false },
    { field: "content_reference.failed_limb", value: "retained_source_integrity" },
    { field: "content_reference.failed_step", value: reason }
  ];
  return refusalError(`selected-response retained source is unreadable: ${reason}`,
    buildPublicMechanicalRefusal({
      code: CONTENT_REFERENCE_UNAVAILABLE_CODE,
      deciding_facts: facts,
      no_supported_route: true,
      recovery: { state: "no_supported_route" },
      route,
      observed_facts: factsObject(facts)
    }));
}

export function selectedResponseQueryInvalidError(route, reason, details = {}) {
  return queryInvalid(route, reason, details);
}

const SELECTION_CORRECTIONS = Object.freeze({
  field_requires_exact_row_identity: Object.freeze({
    prerequisite: "a field_path read selects one exact row by selector.id",
    success_condition: "the call returns this retained collection's rows without selecting one, " +
      "exposing their ids and valid field paths; it does not return the requested field"
  }),
  field_unknown: Object.freeze({
    prerequisite: "field_path names a field the selected row carries",
    success_condition: "the call returns this retained row without the invalid field_path, " +
      "exposing its valid field paths; it does not return the requested field"
  }),
  scalar_range_requires_field_path: Object.freeze({
    prerequisite: "offset and length select a UTF-8 byte range of one scalar field_path, not rows",
    success_condition: "the call returns this retained selection's structure without offset and length, " +
      "exposing its rows and valid field paths; it does not return the requested range or a row range"
  }),
  ordinal_not_page_boundary: Object.freeze({
    prerequisite: "ordinal names the first row of a page this selection returns, not a row identity",
    success_condition: "the call returns the retained page that contains the requested ordinal, from that " +
      "page's own first row; it does not select a row by ordinal or serve the refused request"
  })
});

const containingPages = new WeakMap();

export function selectedResponseCorrectableError(route, reason, details, { arguments: corrected,
  requestSchema, prerequisite, successCondition }) {
  return queryInvalid(route, reason, details, { arguments: corrected, requestSchema, prerequisite,
    success_condition: successCondition });
}

function queryInvalid(route, reason, details = {}, correction = null) {
  const facts = [
    { field: "selected_response.query_valid", value: false },
    { field: "selected_response.invalid_reason", value: reason }
  ];
  if (Object.keys(details).length > 0) {
    facts.push({ field: "selected_response.invalid_details", value: canonicalJson(details) });
  }
  if (correction === null) {
    return refusalError(`selected-response query is invalid: ${reason}`,
      buildPublicMechanicalRefusal({
        code: SELECTED_RESPONSE_QUERY_INVALID_CODE,
        deciding_facts: facts,
        no_supported_route: true,
        recovery: { state: "no_supported_route" },
        route,
        observed_facts: factsObject(facts)
      }));
  }
  const predicate = { fact: "selected_response.query_valid", operator: "is_true" };
  const { prerequisite, success_condition: successCondition } = correction.prerequisite === undefined
    ? SELECTION_CORRECTIONS[reason] : correction;
  return refusalError(`selected-response query is invalid: ${reason}`,
    buildPublicMechanicalRefusal({
      code: SELECTED_RESPONSE_QUERY_INVALID_CODE,
      deciding_facts: facts,
      next_calls: [buildNextCall({
        tool: route,
        arguments: correction.arguments,
        recommended: true,
        success_predicate: predicate,
        prerequisite_predicate: predicate
      })],
      recovery: {
        state: "callable",
        prerequisite,
        operation: route,
        success_condition: successCondition,
        success_predicate: predicate,
        selected_from: ["selected_response.invalid_reason"]
      },
      route,
      observed_facts: factsObject(facts),
      request_schemas: { [route]: correction.requestSchema }
    }));
}

export function retainSelectedResponseSource(source, options) {
  return Object.freeze(selectedResponseLocator(retainSelectedResponseEvidence(source, options)));
}

export function retainSelectedResponseEvidence({ binding, carrier, ownerCall = null,
  ownerRequestSchema = null }, { env = process.env, responseOwner = null } = {}) {
  const envelope = {
    schema_version: SELECTED_RESPONSE_SOURCE_SCHEMA_VERSION,
    binding: assertBinding(binding),
    carrier: canonicalJson(carrier)
  };
  if (ownerCall !== null && (typeof ownerCall !== "function" ||
      ownerRequestSchema === null || typeof ownerRequestSchema !== "object")) {
    throw new TypeError("a protected selected-response source requires its owner call and request schema");
  }
  const options = { forceSpill: true,
    ...(ownerCall === null ? {} : { selectedAccess: (locator) => ({
      owner_call: ownerCall(Object.freeze({ ...locator })), request_schema: ownerRequestSchema }) }) };
  const retained = (responseOwner === null
    ? jsonContent(envelope, { env, ...options })
    : responseOwner(envelope, options))?.structuredContent;
  const reference = retained?.content_reference;
  if (retained?.response_spilled !== true || typeof reference?.ref_id !== "string") {
    throw refusalError("selected-response source could not be retained", retained);
  }
  return Object.freeze({ ref_id: reference.ref_id, sha256: reference.sha256 });
}

const RETAINED_READ_INTEGRITY_FAILURES = Object.freeze({
  [RETAINED_ARTIFACT_READ_FAILURES.METADATA_NOT_FOUND]: "content_reference_metadata_not_found",
  [RETAINED_ARTIFACT_READ_FAILURES.METADATA_INVALID]: "content_reference_metadata_invalid",
  [RETAINED_ARTIFACT_READ_FAILURES.EVIDENCE_MISMATCH]: "content_reference_recorded_digest_mismatch",
  [RETAINED_ARTIFACT_READ_FAILURES.BYTES_MISMATCH]: "content_reference_digest_mismatch",
  [RETAINED_ARTIFACT_READ_FAILURES.UNPARSEABLE]: "retained_source_unparseable"
});

export function selectedResponseLocatorNotCurrentError(route, details = {}) {
  return queryInvalid(route, SELECTED_RESPONSE_LOCATOR_NOT_CURRENT_REASON, {
    ...details, accepted_form: "ref_id: the eight-character handle a current answer returned" });
}

export function readSelectedResponseSource(source, { env = process.env, expected,
  route = expected.route }) {
  return readVerifiedEnvelope(source, { env, expected, route }).envelope;
}

export function readSelectedResponseEvidence(source, { env = process.env, expected,
  route = expected.route }) {
  const { envelope, source: evidence } = readVerifiedEnvelope(source, { env, expected, route });
  return { envelope, evidence };
}

function readVerifiedEnvelope(source, { env, expected, route, allowNonCurrent = false }) {
  let read;
  try {
    read = readRetainedJson({ ref_id: source?.ref_id, sha256: source?.sha256 ?? null },
      { stateDir: getResponseSpillConfig(env).stateDir, allowNonCurrent });
  } catch (error) {
    if (error.reason === RETAINED_ARTIFACT_READ_FAILURES.INVALID_REFERENCE) {
      throw queryInvalid(route, "source_locator_invalid");
    }
    if (error.reason === RETAINED_ARTIFACT_READ_FAILURES.NOT_CURRENT) {
      throw selectedResponseLocatorNotCurrentError(route);
    }
    if (error.reason === RETAINED_ARTIFACT_READ_FAILURES.NOT_READABLE) throw retainedArtifactNotFoundError();
    if (!Object.hasOwn(RETAINED_READ_INTEGRITY_FAILURES, error.reason)) throw error;
    throw retainedSourceUnreadable(route, RETAINED_READ_INTEGRITY_FAILURES[error.reason]);
  }
  const envelope = read.value;
  if (envelope?.schema_version !== SELECTED_RESPONSE_SOURCE_SCHEMA_VERSION ||
      envelope.binding === null || typeof envelope.binding !== "object" ||
      envelope.carrier === null || typeof envelope.carrier !== "object") {

    throw queryInvalid(route, "source_not_selected_response");
  }
  for (const field of Object.keys(expected)) {
    if (!isDeepStrictEqual(envelope.binding[field], expected[field])) {
      throw queryInvalid(route, "source_binding_mismatch", { binding_field: field });
    }
  }
  return { envelope, source: read.source };
}

export function findSelectedResponseSources({ env = process.env, expected }) {
  if (!["route", "repository", "unit", "query_identity", "authority_identity"].every(field =>
    Object.hasOwn(expected, field))) throw new TypeError("source recovery requires the complete producer binding");
  const stateDir = getResponseSpillConfig(env).stateDir;
  const sources = [];
  for (const { ref_id: refId, current } of listRetainedArtifacts({ stateDir,
    nonCurrentPrefix: SPILLED_REF_ID_PREFIX })) {
    const candidate = JSON.parse(readFileSync(path.join(stateDir, `${refId}.json`), "utf8"));
    if (candidate?.schema_version !== SELECTED_RESPONSE_SOURCE_SCHEMA_VERSION ||
        !Object.keys(expected).every(field => isDeepStrictEqual(candidate.binding?.[field], expected[field]))) continue;
    const read = readVerifiedEnvelope({ ref_id: refId }, { env, expected, route: expected.route,
      allowNonCurrent: !current });
    sources.push({ result: selectedResponseLocator(read.source), current, ...read.envelope });
  }
  return sources;
}

export function readSelectedResponseFull(source, { env = process.env, expected, route = expected?.route }) {
  const retained = readAuthenticatedSelectedSource(source, { env, expected, route });
  return selectedFullContent({ source, retained, member: "carrier" });
}

function readAuthenticatedSelectedSource(source, { env, expected, route }) {
  if (typeof route !== "string" || route.length === 0) {
    throw new TypeError("selected-full delivery requires the reading route");
  }
  for (const field of ["route", "repository", "unit"]) {
    if (expected === null || typeof expected !== "object" || expected[field] === undefined) {
      throw queryInvalid(route, "source_binding_mismatch", { binding_field: field });
    }
  }
  if (!hasAuthorityIdentity(expected.authority_identity)) {
    throw queryInvalid(route, "authority_identity_missing", { boundary: "expected" });
  }
  return readSelectedResponseSource(source, { env, expected, route });
}

export async function readSelectedResponseProjection(source, { env = process.env, expected,
  route = expected?.route, project }) {
  if (typeof project !== "function") {
    throw new TypeError("selected-projection delivery requires the route's projector");
  }
  const retained = readAuthenticatedSelectedSource(source, { env, expected, route });

  const projection = await project(structuredClone({ binding: retained.binding, carrier: retained.carrier }));
  return selectedFullContent({ source, retained, projection });
}

function selectionOf(request) {
  const selection = { source: selectedResponseLocator(request.source), collection: request.collection };
  for (const key of ["selector", "ordinal", "field_path", "offset", "length"]) {
    if (request[key] !== undefined) selection[key] = canonicalJson(request[key]);
  }
  return selection;
}

export function createSelectedResponseSession({
  route,
  requestSchema,
  buildDetailArguments,
  assertEmittedPage = () => {},
  resolveCurrentObservationIdentity = null,
  requireAuthorityIdentity = false,
  projectCollections = projectSelectedResponseCollections,
  selectorKeys = null,
  selectRows = null,
  projectRow = null,
  describeObservation = null,
  measuredObservation = null,
  completePageDelivery = null,

  navigationReserveBytes = 0,

  pageAppendsNavigation = () => true,

  maximumBytes: routeMaximumBytes = null,
  presentResponse = null,
  env = process.env,
  now = undefined,
  capacity = undefined,
  ttlMs = undefined
}) {
  if (typeof route !== "string" || typeof buildDetailArguments !== "function" ||
      requestSchema === null || typeof requestSchema !== "object") {
    throw new TypeError("selected-response session requires route, requestSchema and buildDetailArguments");
  }
  const deliveryBound = selectedResponseDeliveryBound(env);
  if (routeMaximumBytes !== null && (!Number.isSafeInteger(routeMaximumBytes) || routeMaximumBytes < 1 ||
      routeMaximumBytes > deliveryBound)) {
    throw new TypeError("a selected-response route bound may only tighten the delivery bound");
  }
  if (presentResponse !== null && typeof presentResponse !== "function") {
    throw new TypeError("a selected-response presenter must be a function");
  }
  const maximumBytes = routeMaximumBytes ?? deliveryBound;
  const present = presentResponse ?? ((response) => response);
  if (!Number.isSafeInteger(navigationReserveBytes) || navigationReserveBytes < 0 ||
      navigationReserveBytes >= maximumBytes / 2) {
    throw new TypeError("selected-response navigation reserve must be a small non-negative integer");
  }
  if (typeof projectCollections !== "function") {
    throw new TypeError("a selected-response collection projector must be a function");
  }
  if (selectorKeys !== null && (!Array.isArray(selectorKeys) || selectorKeys.length === 0 ||
      selectorKeys.some((key) => typeof key !== "string" || key.length === 0))) {
    throw new TypeError("selected-response selector keys must be a non-empty list of names");
  }
  if (selectRows !== null && typeof selectRows !== "function") {
    throw new TypeError("a selected-response row selection must be a function");
  }
  if (projectRow !== null && typeof projectRow !== "function") {
    throw new TypeError("a selected-response row projection must be a function");
  }
  if (completePageDelivery !== null && typeof completePageDelivery?.acceptsCursor !== "function") {
    throw new TypeError("selected-response complete-page delivery requires the route's cursor validator");
  }
  if (describeObservation !== null && (typeof describeObservation !== "function" ||
      completePageDelivery === null && (measuredObservation === null || typeof measuredObservation !== "object"))) {
    throw new TypeError("a selected-response observation owner requires its measured observation");
  }
  if (describeObservation === null && measuredObservation !== null) {
    throw new TypeError("a measured observation requires its selected-response observation owner");
  }

  const sizedObservation = Object.freeze(measuredObservation === null
    ? { kind: "retained_prior_observation", state: MEASURED_OBSERVATION_STATE } : { ...measuredObservation });
  const declaredSelectors = Object.freeze([...(selectorKeys ?? ["id"])]);

  const selectionOfSnapshot = (result, collection, selector) => {
    const selection = selectRows({ collections: result.collections, collection, selector });
    if (!Array.isArray(selection?.rows)) {
      throw new TypeError("a selected-response row selection must return its rows");
    }
    return selection;
  };
  if (typeof pageAppendsNavigation !== "function") {
    throw new TypeError("selected-response pageAppendsNavigation must be a function");
  }

  const pageBytes = maximumBytes - navigationReserveBytes;

  const maximumScalarRangeBytes = routeMaximumBytes === null
    ? selectedResponseMaximumScalarRangeBytes(env) : maximumBytes;

  const sourceIdentity = (source) => selectedResponseLocator(source);

  const argumentsFor = (retained, selection) => buildDetailArguments(Object.freeze({
    repository: retained.repository,
    unit: retained.unit
  }), selection);

  const RANGE_DIGIT_MARGIN_BYTES = 32;
  const SCALAR_PAGE_KEYS = new Set(["complete", "range_required", "total", "returned", "remaining",
    "continuation", "offset", "length", "unit", "value_base64", "value"]);
  function rangeFrameBytes(page, selectionBase, offset, length) {
    const fieldCommon = Object.fromEntries(Object.entries(page)
      .filter(([key]) => !SCALAR_PAGE_KEYS.has(key)));
    const remaining = page.total - offset - length;
    const candidate = {
      ...fieldCommon,
      total: page.total,
      returned: length,
      remaining,
      continuation: remaining === 0 ? null : { kind: "scalar_range", next_offset: offset + length },
      complete: remaining === 0,
      offset,
      length,
      unit: "utf8_bytes",
      value_base64: Buffer.alloc(length).toString("base64")
    };
    return measureMcpInlineResultBytes(present({
      schema_version: SELECTED_RESPONSE_DETAIL_SCHEMA_VERSION,
      route,
      observation: sizedObservation,
      page: candidate,
      next_calls: remaining === 0 ? [] : [buildNextCall({
        tool: route,
        arguments: argumentsFor(page.retained_source,
          { ...selectionBase, offset: offset + length, length }),
        recommended: true
      })]
    }));
  }

  function fittingRangeLength(page, selectionBase, offset) {
    let low = 1;
    let high = Math.min(maximumScalarRangeBytes, page.total - offset);
    const fits = (length) =>
      rangeFrameBytes(page, selectionBase, offset, length) <= pageBytes - RANGE_DIGIT_MARGIN_BYTES;
    if (high < 1 || !fits(1)) {
      throw new TaskResultSnapshotError("invalid", "scalar_range_frame_exceeds_delivery_bound", null);
    }
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (fits(middle)) low = middle;
      else high = middle - 1;
    }
    return low;
  }

  function continuationSelection(page) {
    const retained = page.retained_source;
    const base = {
      source: selectedResponseLocator(retained),
      collection: page.collection,
      ...(page.selector === null ? {} : { selector: page.selector })
    };
    if (Array.isArray(page.field_path)) {
      const fieldBase = { ...base, field_path: page.field_path };

      const rangeBase = { ...fieldBase, snapshot_identity: page.task_result_identity };
      if (page.range_required === true) {
        return { ...rangeBase, offset: 0, length: fittingRangeLength(page, rangeBase, 0) };
      }
      if (page.continuation?.kind === "scalar_range") {
        const next = page.continuation.next_offset;
        return { ...rangeBase, offset: next, length: fittingRangeLength(page, rangeBase, next) };
      }
      if (page.continuation?.kind === "cursor") {
        return { ...fieldBase, snapshot_identity: page.task_result_identity,
          cursor: page.continuation.cursor, ordinal: page.offset + page.returned };
      }
      return null;
    }
    if (page.continuation?.kind === "cursor") {

      if (completePageDelivery !== null && !completePageDelivery.acceptsCursor(page.continuation.cursor)) {
        return { ...base, snapshot_identity: page.task_result_identity, ordinal: page.offset + page.returned };
      }
      return { ...base, snapshot_identity: page.task_result_identity,
        cursor: page.continuation.cursor, ordinal: page.offset + page.returned };
    }
    return null;
  }

  function projectResponse(page, observation) {
    const response = {
      schema_version: SELECTED_RESPONSE_DETAIL_SCHEMA_VERSION,
      route,
      observation,
      page,
      next_calls: []
    };
    const next = continuationSelection(page);
    if (next !== null) {
      response.next_calls = [buildNextCall({
        tool: route,
        arguments: argumentsFor(page.retained_source, next),
        recommended: true
      })];
    }
    return response;
  }

  const rowsOnly = (page) => completePageDelivery !== null && Array.isArray(page.items);
  const measure = (page) => containsReservedAssessmentEnvelope(page.value) ||
    containsReservedAssessmentEnvelope(page.items)
    ? Number.POSITIVE_INFINITY
    : rowsOnly(page) ? measureMcpInlineResultBytes({ items: page.items })
      : measureMcpInlineResultBytes(present(projectResponse(page, sizedObservation))) +
        (pageAppendsNavigation(page) ? navigationReserveBytes : 0);

  const NO_ROWS = Object.freeze([]);
  const idGroupsByCollection = new WeakMap();
  function rowsWithId(rows, id) {
    let groups = idGroupsByCollection.get(rows);
    if (groups === undefined) {
      groups = new Map();
      for (const row of rows) {
        const group = groups.get(row.id);
        if (group === undefined) groups.set(row.id, [row]);
        else group.push(row);
      }
      idGroupsByCollection.set(rows, groups);
    }
    return groups.get(id) ?? NO_ROWS;
  }

  const registry = createTaskResultSnapshotRegistry({
    ...(now === undefined ? {} : { now }),
    ...(capacity === undefined ? {} : { capacity }),
    ...(ttlMs === undefined ? {} : { ttlMs }),
    maximumItems: MAXIMUM_ITEMS,
    maximumBytes,
    maximumScalarRangeBytes,
    collectionDescriptor: (domain, collection) => domain !== route ? null : Object.freeze({
      collection,
      stable_id: "id",
      selectors: declaredSelectors,
      fields: collection === SELECTED_RESPONSE_MEMBERS_COLLECTION ? MEMBER_ROW_FIELDS : ARRAY_ROW_FIELDS
    }),

    projectPage: ({ result, domain, collection, selector, ordinal, maximumItems: limit }) => {
      const rows = selectRows === null ? result.collections[collection]
        : selectionOfSnapshot(result, collection, selector).rows;
      if (!Array.isArray(rows)) {
        throw new TaskResultSnapshotError("invalid", "collection_unknown", null, { collection });
      }
      const selected = selectRows !== null || selector === null ? rows : rowsWithId(rows, selector.id);
      return {
        schema_version: "task-result-semantic-page.v1",
        domain,
        collection,
        selector,
        offset: ordinal,
        matched_count: selected.length,
        items: selected.slice(ordinal, ordinal + limit),
        authority: { kind: "advisory_evidence", confers: [] }
      };
    },
    projectPageContext: ({ result, collection, selector }) => ({ retained_source: result.retained_source,
      ...(selectRows === null ? {}
        : { selected: selectionOfSnapshot(result, collection, selector).metadata ?? null }) }),
    ...(projectRow === null ? {} : { projectRow }),

    expandRowField: (_domain, _collection, _field, value) =>
      value !== null && typeof value === "object" && containsReservedAssessmentEnvelope(value),
    measureProjectionBytes: measure,
    assertProjectionBound: (page, bound) => {
      if (measure(page) > bound) {
        throw new TaskResultSnapshotError("invalid", "projection_exceeds_delivery_bound", null);
      }
      return page;
    },
    queryOperationForDomain: () => route
  });

  function put(envelope, source) {
    const binding = assertBinding(envelope.binding);
    return registry.put({
      domain: route,
      result: {
        retained_source: retainedSourceSummary(binding, source),
        collections: projectCollections(envelope.carrier)
      },
      sourceIdentity: sourceIdentity(source),
      recovery: { source: selectedResponseLocator(source) }
    });
  }

  function refusalFor(error, request, rehydratable, correction = null) {
    if (error?.envelope) return error;
    if (!(error instanceof TaskResultSnapshotError)) throw error;
    const reason = error.details?.reason ?? "unknown";
    if (error.kind !== "unavailable") {
      const { changed: _changed, reason: _reason, caller_correctable: _correctable,
        recovery: _recovery, ...details } = error.details ?? {};
      return queryInvalid(route, reason, details,
        correction === null ? null : { arguments: correction, requestSchema });
    }
    const facts = [
      { field: "selected_response.snapshot_available", value: false },
      { field: "selected_response.unavailable_reason", value: reason }
    ];
    if (!rehydratable) {
      return refusalError(`selected-response snapshot is unavailable: ${reason}`,
        buildPublicMechanicalRefusal({
          code: SELECTED_RESPONSE_SNAPSHOT_UNAVAILABLE_CODE,
          deciding_facts: facts,
          no_supported_route: true,
          recovery: { state: "no_supported_route" },
          route,
          observed_facts: factsObject(facts)
        }));
    }
    const predicate = { fact: "selected_response.snapshot_available", operator: "is_true" };
    const nextCall = buildNextCall({
      tool: route,
      arguments: request.buildArguments(selectionOf(request.detail)),
      recommended: true,
      success_predicate: predicate,
      prerequisite_predicate: predicate
    });
    return refusalError(`selected-response snapshot is unavailable: ${reason}`,
      buildPublicMechanicalRefusal({
        code: SELECTED_RESPONSE_SNAPSHOT_UNAVAILABLE_CODE,
        deciding_facts: facts,
        next_calls: [nextCall],
        recovery: {
          state: "callable",
          prerequisite: "this host no longer holds the selected snapshot identity or cursor",
          operation: route,
          success_condition: "the same selection returns a page read from the retained source",
          success_predicate: predicate,
          selected_from: ["selected_response.snapshot_available"]
        },
        route,
        observed_facts: factsObject(facts),
        request_schemas: { [route]: requestSchema }
      }));
  }

  async function observationOf(retained) {
    if (describeObservation !== null) return describeObservation(Object.freeze({ ...retained }));
    return { kind: "retained_prior_observation", state: await observationState(retained) };
  }

  async function observationState(retained) {
    if (typeof resolveCurrentObservationIdentity !== "function" ||
        retained.observation_identity === undefined) return "unavailable";
    try {
      const current = await resolveCurrentObservationIdentity(Object.freeze({ ...retained }));
      if (typeof current !== "string") return "unavailable";
      return current === retained.observation_identity ? "current" : "changed";
    } catch {
      return "unavailable";
    }
  }

  function assertServedPage(page, expected, detail) {
    if (page.collection !== detail.collection ||
        !isDeepStrictEqual(page.selector ?? null, detail.selector ?? null)) {
      throw new TaskResultSnapshotError("invalid", "cursor_selection_mismatch", null);
    }
    for (const field of Object.keys(expected)) {
      if (field === "route") continue;
      if (!Object.hasOwn(page.retained_source, field)) continue;
      if (!isDeepStrictEqual(page.retained_source[field], expected[field])) {
        throw queryInvalid(route, "source_binding_mismatch", { binding_field: field });
      }
    }
    if (requireAuthorityIdentity) {

      if (!Object.hasOwn(page.retained_source, "authority_identity_sha256")) {
        throw queryInvalid(route, "authority_identity_missing", { boundary: "retained" });
      }
      if (page.retained_source.authority_identity_sha256 !==
          authorityIdentityDigest(expected.authority_identity)) {
        throw queryInvalid(route, "source_binding_mismatch", { binding_field: "authority_identity" });
      }
    }
    assertEmittedPage(page);
  }

  async function selectionCorrection(error, { detail, expected, servedIdentity }) {
    const reason = error instanceof TaskResultSnapshotError && error.kind === "invalid"
      ? error.details?.reason : undefined;
    if (servedIdentity === null || detail.cursor !== undefined ||
        !Object.hasOwn(SELECTION_CORRECTIONS, reason)) return null;
    const base = {
      source: selectedResponseLocator(detail.source),
      ...(detail.snapshot_identity === undefined ? {} : { snapshot_identity: detail.snapshot_identity }),
      collection: detail.collection,
      ...(detail.selector === undefined ? {} : { selector: canonicalJson(detail.selector) })
    };
    let selection;
    let served;
    try {
      if (reason === "ordinal_not_page_boundary") {

        served = containingPages.get(error);
        if (served === undefined) return null;
        selection = { ...base,
          ...(detail.field_path === undefined ? {} : { field_path: canonicalJson(detail.field_path) }),
          ...(served.offset === 0 ? {} : { ordinal: served.offset }) };
      } else {
        if (reason === "scalar_range_requires_field_path") {
          if (detail.field_path !== undefined) return null;
          selection = { ...base, ...(detail.ordinal === undefined ? {} : { ordinal: detail.ordinal }) };
        } else {
          if ((reason === "field_unknown") !== (detail.selector !== undefined)) return null;
          const { selector: _selector, ...withoutRow } = base;
          selection = reason === "field_unknown" ? base : withoutRow;
        }
        const recovery = { source: detail.source };
        const expectedSourceIdentity = sourceIdentity(detail.source);
        served = await registry.query({ domain: route, identity: servedIdentity,
          collection: selection.collection, selector: selection.selector ?? null,
          expectedSourceIdentity, recovery });
        if (selection.ordinal !== undefined) {
          served = await seek(served, selection.ordinal, expectedSourceIdentity, recovery);
        }
      }
      assertServedPage(served, expected, selection);
    } catch (refused) {

      if (refused?.envelope || refused instanceof TaskResultSnapshotError) return null;
      throw refused;
    }
    return buildDetailArguments(Object.freeze({
      repository: expected.repository, unit: expected.unit ?? null
    }), selection);
  }

  async function seek(first, ordinal, expectedSourceIdentity, recovery) {
    let page = first;
    while (page.offset < ordinal) {
      if (page.offset + page.returned > ordinal) {
        const error = new TaskResultSnapshotError("invalid", "ordinal_not_page_boundary", null, { ordinal });
        containingPages.set(error, page);
        throw error;
      }
      if (page.continuation?.kind !== "cursor") {
        throw new TaskResultSnapshotError("invalid", "ordinal_out_of_range", null, { ordinal });
      }
      page = await registry.query({ domain: route, cursor: page.continuation.cursor,
        expectedSourceIdentity, recovery });
    }
    if (page.offset !== ordinal) {
      throw new TaskResultSnapshotError("invalid", "ordinal_not_page_boundary", null, { ordinal });
    }
    return page;
  }

  return Object.freeze({
    route,
    maximumBytes,
    maximumScalarRangeBytes,
    registry,

    retain({ binding, carrier, ownerCall = null, ownerRequestSchema = null }) {
      const canonicalBinding = assertBinding(binding);
      if (canonicalBinding.route !== route) {
        throw new TypeError("selected-response binding route must be the session route");
      }
      if (requireAuthorityIdentity && !hasAuthorityIdentity(canonicalBinding.authority_identity)) {
        throw queryInvalid(route, "authority_identity_missing", { boundary: "retention" });
      }
      const canonicalCarrier = canonicalJson(carrier);
      const source = retainSelectedResponseSource({ binding: canonicalBinding, carrier: canonicalCarrier,
        ownerCall, ownerRequestSchema }, { env });
      const snapshotIdentity = put({ binding: canonicalBinding, carrier: canonicalCarrier }, source);
      return Object.freeze({ source, snapshot_identity: snapshotIdentity });
    },

    detailCall(binding, selection, { recommended = true } = {}) {
      return buildNextCall({
        tool: route,
        arguments: buildDetailArguments(Object.freeze({
          repository: binding.repository, unit: binding.unit
        }), selection),
        recommended
      });
    },

    async detail({ expected, detail }) {
      const request = {
        detail,
        buildArguments: (selection) => buildDetailArguments(Object.freeze({
          repository: expected.repository, unit: expected.unit ?? null
        }), selection)
      };
      const hasIdentity = detail.snapshot_identity !== undefined || detail.cursor !== undefined;
      if (requireAuthorityIdentity && !hasAuthorityIdentity(expected.authority_identity)) {
        throw queryInvalid(route, "authority_identity_missing", { boundary: "expected" });
      }

      let servedIdentity = null;
      try {
        if (detail.ordinal !== undefined &&
            (detail.field_path !== undefined && (detail.offset !== undefined || detail.length !== undefined))) {
          throw new TaskResultSnapshotError("invalid", "ordinal_and_range_are_mutually_exclusive", null);
        }
        const expectedSourceIdentity = sourceIdentity(detail.source);
        const recovery = { source: detail.source };
        let page;
        if (!hasIdentity) {
          const envelope = readSelectedResponseSource(detail.source, { env, expected });
          const identity = put(envelope, detail.source);
          servedIdentity = identity;
          page = await registry.query({ domain: route, identity, collection: detail.collection,
            selector: detail.selector ?? null, fieldPath: detail.field_path ?? null,
            offset: detail.offset ?? null, length: detail.length ?? null,
            expectedSourceIdentity, recovery });
          if (detail.ordinal !== undefined) {
            page = await seek(page, detail.ordinal, expectedSourceIdentity, recovery);
          }
        } else if (detail.cursor !== undefined) {
          page = await registry.query({ domain: route, cursor: detail.cursor,
            expectedSourceIdentity, recovery });
          if (detail.ordinal !== undefined && page.offset !== detail.ordinal) {
            throw new TaskResultSnapshotError("invalid", "ordinal_cursor_mismatch", null,
              { ordinal: detail.ordinal });
          }
        } else {
          servedIdentity = detail.snapshot_identity;
          page = await registry.query({ domain: route, identity: detail.snapshot_identity,
            collection: detail.collection, selector: detail.selector ?? null,
            fieldPath: detail.field_path ?? null, offset: detail.offset ?? null,
            length: detail.length ?? null, expectedSourceIdentity, recovery });
          if (detail.ordinal !== undefined) {
            page = await seek(page, detail.ordinal, expectedSourceIdentity, recovery);
          }
        }
        assertServedPage(page, expected, detail);
        const response = present(projectResponse(page, await observationOf(page.retained_source)));

        if (!rowsOnly(page) && measureMcpInlineResultBytes(response) > maximumBytes) {
          throw new TaskResultSnapshotError("invalid", "projection_exceeds_delivery_bound", null);
        }
        return response;
      } catch (error) {
        throw refusalFor(error, request, hasIdentity,
          await selectionCorrection(error, { detail, expected, servedIdentity }));
      }
    }
  });
}
