

import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
  createTaskResultSnapshotRegistry,
  TaskResultSnapshotError
} from "@agent-chassis/controlled-contract";
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
  measureMcpInlineResultBytes,
  readSpilledMcpContentReference
} from "./mcp-response.mjs";
import { projectZodRequestContract } from "./zod-request-contract-projection.mjs";

export const SELECTED_RESPONSE_SOURCE_SCHEMA_VERSION = "selected-response-source.v1";
export const SELECTED_RESPONSE_DETAIL_SCHEMA_VERSION = "selected-response-detail.v1";
export const SELECTED_RESPONSE_SNAPSHOT_UNAVAILABLE_CODE = "selected_response_snapshot_unavailable";
export const SELECTED_RESPONSE_QUERY_INVALID_CODE = "selected_response_query_invalid";

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

export function selectedResponseDetailSchema(z) {
  return z.object({
    source: z.object({
      ref_id: z.string().regex(/^[A-Za-z0-9._-]{1,200}$/u),
      sha256: z.string().regex(/^[a-f0-9]{64}$/u)
    }).strict(),
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
      ? null : canonicalJson(binding.observation_identity)
  });
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
    sha256: source.sha256,
    repository: binding.repository,
    unit: binding.unit,
    query_identity_sha256: binding.query_identity === null
      ? null : sha256Hex(JSON.stringify(binding.query_identity)),
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

function queryInvalid(route, reason, details = {}) {
  const facts = [
    { field: "selected_response.query_valid", value: false },
    { field: "selected_response.invalid_reason", value: reason }
  ];
  if (Object.keys(details).length > 0) {
    facts.push({ field: "selected_response.invalid_details", value: canonicalJson(details) });
  }
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

export function retainSelectedResponseSource({ binding, carrier }, { env = process.env } = {}) {
  const envelope = {
    schema_version: SELECTED_RESPONSE_SOURCE_SCHEMA_VERSION,
    binding: assertBinding(binding),
    carrier: canonicalJson(carrier)
  };
  const retained = jsonContent(envelope, { env, forceSpill: true }).structuredContent;
  const reference = retained?.content_reference;
  if (retained?.response_spilled !== true || typeof reference?.ref_id !== "string") {
    throw refusalError("selected-response source could not be retained", retained);
  }
  return Object.freeze({ ref_id: reference.ref_id, sha256: reference.sha256 });
}

export function readSelectedResponseSource(source, { env = process.env, expected }) {
  const route = expected.route;
  const { maxReferenceReadBytes } = getResponseSpillConfig(env);
  const chunks = [];
  let offset = 0;
  while (offset !== null) {
    let page;
    try {
      page = readSpilledMcpContentReference(
        { ref_id: source.ref_id, offset, length: maxReferenceReadBytes }, { env });
    } catch (error) {
      if (error?.envelope) throw error;
      throw queryInvalid(route, "source_locator_invalid");
    }
    if (page.sha256 !== source.sha256) {
      throw retainedSourceUnreadable(route, "content_reference_digest_mismatch");
    }
    chunks.push(Buffer.from(page.data_base64, "base64"));
    offset = page.next_offset;
  }
  const bytes = Buffer.concat(chunks);
  if (sha256Hex(bytes) !== source.sha256) {
    throw retainedSourceUnreadable(route, "content_reference_digest_mismatch");
  }
  let envelope;
  try {
    envelope = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw retainedSourceUnreadable(route, "retained_source_unparseable");
  }
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
  return envelope;
}

function selectionOf(request) {
  const selection = { source: { ref_id: request.source.ref_id, sha256: request.source.sha256 },
    collection: request.collection };
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
  env = process.env,
  now = undefined,
  capacity = undefined,
  ttlMs = undefined
}) {
  if (typeof route !== "string" || typeof buildDetailArguments !== "function" ||
      requestSchema === null || typeof requestSchema !== "object") {
    throw new TypeError("selected-response session requires route, requestSchema and buildDetailArguments");
  }
  const maximumBytes = selectedResponseDeliveryBound(env);
  const maximumScalarRangeBytes = selectedResponseMaximumScalarRangeBytes(env);
  const sourceIdentity = (source) => ({ route, ref_id: source.ref_id, sha256: source.sha256 });

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
    return measureMcpInlineResultBytes({
      schema_version: SELECTED_RESPONSE_DETAIL_SCHEMA_VERSION,
      route,
      observation: { kind: "retained_prior_observation", state: MEASURED_OBSERVATION_STATE },
      page: candidate,
      next_calls: remaining === 0 ? [] : [buildNextCall({
        tool: route,
        arguments: argumentsFor(page.retained_source,
          { ...selectionBase, offset: offset + length, length }),
        recommended: true
      })]
    });
  }

  function fittingRangeLength(page, selectionBase, offset) {
    let low = 1;
    let high = Math.min(maximumScalarRangeBytes, page.total - offset);
    const fits = (length) =>
      rangeFrameBytes(page, selectionBase, offset, length) <= maximumBytes - RANGE_DIGIT_MARGIN_BYTES;
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
      source: { ref_id: retained.ref_id, sha256: retained.sha256 },
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
      return { ...base, snapshot_identity: page.task_result_identity,
        cursor: page.continuation.cursor, ordinal: page.offset + page.returned };
    }
    return null;
  }

  function projectResponse(page, observationState) {
    const response = {
      schema_version: SELECTED_RESPONSE_DETAIL_SCHEMA_VERSION,
      route,
      observation: { kind: "retained_prior_observation", state: observationState },
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

  const measure = (page) => containsReservedAssessmentEnvelope(page.value) ||
    containsReservedAssessmentEnvelope(page.items)
    ? Number.POSITIVE_INFINITY
    : measureMcpInlineResultBytes(projectResponse(page, MEASURED_OBSERVATION_STATE));

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
      selectors: Object.freeze(["id"]),
      fields: collection === SELECTED_RESPONSE_MEMBERS_COLLECTION ? MEMBER_ROW_FIELDS : ARRAY_ROW_FIELDS
    }),

    projectPage: ({ result, domain, collection, selector, ordinal, maximumItems: limit }) => {
      const rows = result.collections[collection];
      if (!Array.isArray(rows)) {
        throw new TaskResultSnapshotError("invalid", "collection_unknown", null, { collection });
      }
      const selected = selector === null ? rows : rows.filter((row) => row.id === selector.id);
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
    projectPageContext: ({ result }) => ({ retained_source: result.retained_source }),

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
        collections: projectSelectedResponseCollections(envelope.carrier)
      },
      sourceIdentity: sourceIdentity(source),
      recovery: { source }
    });
  }

  function refusalFor(error, request, rehydratable) {
    if (error?.envelope) return error;
    if (!(error instanceof TaskResultSnapshotError)) throw error;
    const reason = error.details?.reason ?? "unknown";
    if (error.kind !== "unavailable") {
      const { changed: _changed, reason: _reason, caller_correctable: _correctable,
        recovery: _recovery, ...details } = error.details ?? {};
      return queryInvalid(route, reason, details);
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

  async function seek(first, ordinal, expectedSourceIdentity, recovery) {
    let page = first;
    while (page.offset < ordinal) {
      if (page.offset + page.returned > ordinal) {
        throw new TaskResultSnapshotError("invalid", "ordinal_not_page_boundary", null, { ordinal });
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

    retain({ binding, carrier }) {
      const canonicalBinding = assertBinding(binding);
      if (canonicalBinding.route !== route) {
        throw new TypeError("selected-response binding route must be the session route");
      }
      const canonicalCarrier = canonicalJson(carrier);
      const source = retainSelectedResponseSource(
        { binding: canonicalBinding, carrier: canonicalCarrier }, { env });
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
          page = await registry.query({ domain: route, identity: detail.snapshot_identity,
            collection: detail.collection, selector: detail.selector ?? null,
            fieldPath: detail.field_path ?? null, offset: detail.offset ?? null,
            length: detail.length ?? null, expectedSourceIdentity, recovery });
          if (detail.ordinal !== undefined) {
            page = await seek(page, detail.ordinal, expectedSourceIdentity, recovery);
          }
        }
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
        assertEmittedPage(page);
        const response = projectResponse(page, await observationState(page.retained_source));
        if (measureMcpInlineResultBytes(response) > maximumBytes) {
          throw new TaskResultSnapshotError("invalid", "projection_exceeds_delivery_bound", null);
        }
        return response;
      } catch (error) {
        throw refusalFor(error, request, hasIdentity);
      }
    }
  });
}
