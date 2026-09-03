

import { RUNTIME_BLOCKER_CODES } from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
import {
  projectWorkRecordCompactOmissions,
  WORK_RECORD_COMPACT_SMALL_RESPONSE_MAX_BYTES,
  WORK_RECORD_SLICE_PAGE_MAX_LIMIT,
  workRecordDetailRoutesFor,
  workRecordDetailSelectorArguments
} from "@agent-chassis/wiki-core/src/lib/work-record-summary.mjs";
import {
  projectWorkRecordContractFields,
  projectWorkRecordSlicePage,
  WORK_RECORD_SLICE_PAGE_SCHEMA_VERSION
} from "@agent-chassis/wiki-core/src/lib/work-record-bounded-projections.mjs";
import { throwSelectedIdentityError } from "./work-record-selected-detail-projection.mjs";
import { buildNextCall } from "./mcp-response.mjs";

export const COMPACT_READ_SCHEMA_VERSION = "work-record-compact-read-gate.v1";
export const COMPACT_READ_REFUSAL_SCHEMA_VERSION = "work-record-compact-read-refusal.v1";

export const SUMMARY_TOOL_FAMILY = "workspace_work_record_summary";
export const GET_RECORD_TOOL_FAMILY = "workspace_get_record";
export const READ_PAGE_TOOL_FAMILY = "workspace_read_page";

const MAX_PER_SLICE_NEXT_CALLS = 3;

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function responseSizeMetadata(value) {
  const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  return {
    bytes,
    class: bytes < 8192 ? "small" : bytes < 32768 ? "medium" : "large"
  };
}

const SURFACE_ADAPTERS = Object.freeze({
  [SUMMARY_TOOL_FAMILY]: Object.freeze({
    toolFamily: SUMMARY_TOOL_FAMILY,

    detailSource: (compactResult) => (isObject(compactResult?.summary) ? compactResult.summary : {}),
    sliceRowsField: "slices",

    reviewSliceRows: (detail) =>
      (Array.isArray(detail?.review_state?.review_slices) ? detail.review_state.review_slices : []),
    observedSliceTotal: (detail) => firstInteger(detail?.slices_total, detail?.slice_count),
    observedReviewSliceTotal: (detail) => firstInteger(detail?.review_state?.review_slices_total),
    compactFirstCall: (recordId) => ({ id: recordId }),

    sliceCall: (recordId, sliceId) => ({ unit: `${recordId}#${sliceId}` }),
    enumerationTool: SUMMARY_TOOL_FAMILY,
    enumerationCall: (recordId) => ({ id: recordId, slice_offset: 0 }),

    recordFieldsTool: SUMMARY_TOOL_FAMILY,
    recordFieldsCall: (recordId) => ({ id: recordId, selected_record: true }),

    sliceCallReachesAgentNotes: true
  }),
  [GET_RECORD_TOOL_FAMILY]: Object.freeze({
    toolFamily: GET_RECORD_TOOL_FAMILY,
    detailSource: (compactResult) => (isObject(compactResult) ? compactResult : {}),
    sliceRowsField: "working_slices",
    reviewSliceRows: () => [],
    observedSliceTotal: (detail) => firstInteger(detail?.slice_counts?.total),
    observedReviewSliceTotal: () => null,
    compactFirstCall: (recordId) => ({ id: recordId }),
    sliceCall: (recordId, sliceId) => ({ id: recordId, selected_slice: sliceId }),
    enumerationTool: GET_RECORD_TOOL_FAMILY,
    enumerationCall: (recordId) => ({ id: recordId, slice_offset: 0 }),

    recordFieldsTool: SUMMARY_TOOL_FAMILY,
    recordFieldsCall: (recordId) => ({ id: recordId, selected_record: true })
  }),
  [READ_PAGE_TOOL_FAMILY]: Object.freeze({
    toolFamily: READ_PAGE_TOOL_FAMILY,
    detailSource: (compactResult) => (isObject(compactResult) ? compactResult : {}),
    sliceRowsField: "working_slices",
    reviewSliceRows: () => [],
    observedSliceTotal: (detail) => firstInteger(detail?.slice_counts?.total),
    observedReviewSliceTotal: () => null,
    compactFirstCall: (recordId, context) => ({ path: context.path }),
    sliceCall: (recordId, sliceId, context) => ({ path: context.path, selected_slice: sliceId }),

    enumerationTool: SUMMARY_TOOL_FAMILY,
    enumerationCall: (recordId) => ({ id: recordId, slice_offset: 0 }),

    recordFieldsTool: SUMMARY_TOOL_FAMILY,
    recordFieldsCall: (recordId) => ({ id: recordId, selected_record: true })
  })
});

export function surfaceAdapter(toolFamily) {
  return SURFACE_ADAPTERS[toolFamily] ?? SURFACE_ADAPTERS[SUMMARY_TOOL_FAMILY];
}

function sliceRows(adapter, compactResult) {
  const detail = adapter.detailSource(compactResult);
  const rows = detail?.[adapter.sliceRowsField];
  return Array.isArray(rows) ? rows : [];
}

function firstInteger(...candidates) {
  for (const candidate of candidates) {
    if (Number.isInteger(candidate) && candidate >= 0) return candidate;
  }
  return null;
}

export function projectOmissions({ toolFamily, compactResult, record = null }) {
  const adapter = surfaceAdapter(toolFamily);
  const detail = adapter.detailSource(compactResult);
  const rows = sliceRows(adapter, compactResult);
  const reviewRows = adapter.reviewSliceRows(detail);
  return projectWorkRecordCompactOmissions({
    record,
    returnedSliceIds: rows.map((row) => row?.id),
    returnedReviewSliceIds: reviewRows.map((row) => row?.id),
    returnedSliceRows: rows,
    returnedRecordFields: [],
    observedSliceTotal: adapter.observedSliceTotal(detail),
    observedReviewSliceTotal: adapter.observedReviewSliceTotal(detail)
  });
}

export function omittedDetailCounts(omissions) {
  return {
    slices: integerCount(omissions?.slices?.omitted_count),
    review_slices: integerCount(omissions?.review_slices?.omitted_count),
    included_slices_with_omitted_agent_notes: integerCount(omissions?.agent_notes?.omitted_count),
    record_fields: integerCount(omissions?.record_fields?.omitted_count)
  };
}

function integerCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

export function detailAvailableVia({ toolFamily, resourceKind = "work_record", omissions }) {
  return workRecordDetailRoutesFor({
    tool: toolFamily,
    resource: {
      kind: resourceKind,
      withheld: {
        slices: integerCount(omissions?.slices?.omitted_count),
        review_slices: integerCount(omissions?.review_slices?.omitted_count),

        agent_notes: integerCount(omissions?.agent_notes?.omitted_count),
        record_fields: integerCount(omissions?.record_fields?.omitted_count),

        record_entry: 0
      }
    }
  });
}

const NON_DISCRIMINATING_ARGUMENTS = new Set([
  "compact_read_token",
  "repo",
  "profile",
  "extensionNamespaces"
]);

const RANK_COMPACT_FIRST_RECOVERY = 0;
const RANK_SLICE_ENUMERATION = 1;
const RANK_RECORD_FIELDS = 2;
const RANK_SELECTED_SLICE = 3;

const RANK_SELECTED_SLICE_AGENT_NOTES = 4;

const SUMMARY_SELECTOR_ALIASES = new Set(["unit", "path"]);

function callSignature(tool, callArguments) {
  const normalized = [];
  for (const [key, value] of Object.entries(isObject(callArguments) ? callArguments : {})) {
    if (NON_DISCRIMINATING_ARGUMENTS.has(key)) continue;
    if (value === null || value === undefined) continue;
    normalized.push([
      tool === SUMMARY_TOOL_FAMILY && SUMMARY_SELECTOR_ALIASES.has(key) ? "id" : key,
      value
    ]);
  }
  normalized.sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
  return JSON.stringify([tool, normalized]);
}

function originArguments({ adapter, args, selector, recordId, context }) {
  const origin = { ...(isObject(args) ? args : {}) };
  if (adapter.toolFamily === SUMMARY_TOOL_FAMILY) {
    delete origin.unit;
    delete origin.path;
    origin.id = selector?.selected_slice ? (selector.selected ?? recordId) : recordId;
    return origin;
  }
  if (adapter.toolFamily === READ_PAGE_TOOL_FAMILY) {
    origin.path = context.path;
    return origin;
  }
  origin.id = recordId;
  return origin;
}

export function buildNextCalls({
  adapter,
  recordId,
  omissions,
  originCallArguments = {},
  context = {},
  compactFirstRecovery = false
}) {
  const originSignature = callSignature(adapter.toolFamily, originCallArguments);
  const seen = new Set([originSignature]);
  const candidates = [];

  const push = (rank, tool, callArguments, reach) => {
    const signature = callSignature(tool, callArguments);
    if (seen.has(signature)) return;
    seen.add(signature);
    candidates.push({ rank, tool, arguments: callArguments, reach });
  };

  const omittedSlices = integerCount(omissions?.slices?.omitted_count);
  const omittedRecordFields = integerCount(omissions?.record_fields?.omitted_count);

  if (compactFirstRecovery) {
    push(
      RANK_COMPACT_FIRST_RECOVERY,
      adapter.toolFamily,
      adapter.compactFirstCall(recordId, context),
      "compact_first"
    );
  }

  if (omittedSlices > 0) {
    push(
      RANK_SLICE_ENUMERATION,
      adapter.enumerationTool,
      adapter.enumerationCall(recordId, context),
      "all_omitted_slices"
    );
  }

  if (omittedRecordFields > 0 && typeof adapter.recordFieldsCall === "function") {
    push(
      RANK_RECORD_FIELDS,
      adapter.recordFieldsTool ?? adapter.toolFamily,
      adapter.recordFieldsCall(recordId, context),
      "record_fields"
    );
  }

  const omittedSliceIds = (Array.isArray(omissions?.slices?.omitted) ? omissions.slices.omitted : [])
    .map((entry) => (isObject(entry) && typeof entry.id === "string" ? entry.id : null))
    .filter((id) => id !== null);
  const addressedSliceIds = [];
  for (const sliceId of omittedSliceIds.slice(0, MAX_PER_SLICE_NEXT_CALLS)) {
    addressedSliceIds.push(sliceId);
    push(
      RANK_SELECTED_SLICE,
      adapter.toolFamily,
      adapter.sliceCall(recordId, sliceId, context),
      "one_slice"
    );
  }

  const withheldNoteSliceIds = (
    Array.isArray(omissions?.agent_notes?.omitted) ? omissions.agent_notes.omitted : []
  ).filter((id) => typeof id === "string" && id.trim().length > 0);
  if (adapter.sliceCallReachesAgentNotes) {
    for (const sliceId of withheldNoteSliceIds.slice(0, MAX_PER_SLICE_NEXT_CALLS)) {
      push(
        RANK_SELECTED_SLICE_AGENT_NOTES,
        adapter.toolFamily,
        adapter.sliceCall(recordId, sliceId, context),
        "one_slice_agent_notes"
      );
    }
  }

  candidates.sort((left, right) => left.rank - right.rank);
  const nextCalls = candidates.map((candidate) => buildNextCall({
    tool: candidate.tool,
    arguments: candidate.arguments,
    recommended: true
  }));

  const reachesEveryOmittedSlice = candidates.some(
    (candidate) => candidate.reach === "all_omitted_slices" || candidate.reach === "compact_first"
  );
  const addressed = reachesEveryOmittedSlice
    ? omittedSlices
    : Math.min(addressedSliceIds.length, omittedSlices);

  return {
    next_calls: nextCalls,

    coverage: {
      omitted_slices: omittedSlices,
      omitted_slices_addressed: addressed,
      omitted_slices_unaddressed: Math.max(0, omittedSlices - addressed),
      per_slice_entry_limit: MAX_PER_SLICE_NEXT_CALLS,
      complete: addressed >= omittedSlices
    }
  };
}

export function selectedResources({ adapter, selector, recordId }) {
  if (adapter.toolFamily === SUMMARY_TOOL_FAMILY) {
    const isSlice = Boolean(selector?.selected_slice);
    return {
      type: isSlice ? "slice" : "work_record",
      id: isSlice ? (selector?.selected ?? recordId) : recordId,
      selection_reason: isSlice
        ? "compact_read_selected_slice_scope"
        : "compact_read_compact_first_scope"
    };
  }
  if (selector?.selected_slice) {
    return {
      type: "slice",
      id: selector.selected_slice,
      selection_reason: "compact_read_selected_slice_scope"
    };
  }
  if (selector?.selected_record) {
    return {
      type: "work_record",
      id: recordId,
      selection_reason: "compact_read_selected_record_scope"
    };
  }
  return {
    type: "work_record",
    id: recordId,
    selection_reason: "compact_read_compact_first_scope"
  };
}

export function buildContinuationMetadata({
  toolFamily = SUMMARY_TOOL_FAMILY,
  compactResult,
  compactToken,
  selector,
  args = {},
  record = null,
  omissions = null,
  compactFirstRecovery = false
}) {
  const adapter = surfaceAdapter(toolFamily);
  const recordId = compactResult?.record_id ?? null;
  const context = { path: args?.path ?? `wiki/work-records/${recordId}.json` };
  const withheld = omissions ?? projectOmissions({ toolFamily, compactResult, record });
  const { next_calls: nextCalls, coverage } = buildNextCalls({
    adapter,
    recordId,
    omissions: withheld,
    originCallArguments: originArguments({ adapter, args, selector, recordId, context }),
    context,
    compactFirstRecovery
  });

  return {
    schema_version: COMPACT_READ_SCHEMA_VERSION,
    source_digest: compactResult?.source_digest ?? null,
    compact_read_token: compactToken,
    response_size: responseSizeMetadata(compactResult),
    omitted_detail_counts: omittedDetailCounts(withheld),
    detail_available_via: detailAvailableVia({ toolFamily: adapter.toolFamily, omissions: withheld }),
    selected_resources: selectedResources({ adapter, selector, recordId }),
    next_calls: nextCalls,
    next_calls_coverage: coverage
  };
}

export function buildRefusal({
  toolFamily = SUMMARY_TOOL_FAMILY,
  compactResult,
  blockedOptions,
  tokenDecision,
  selector,
  args = {},
  record = null,
  omissions = null
}) {
  const continuation = buildContinuationMetadata({
    toolFamily,
    compactResult,
    compactToken: null,
    selector,
    args,
    record,
    omissions,
    compactFirstRecovery: true
  });
  return {
    schema_version: COMPACT_READ_REFUSAL_SCHEMA_VERSION,
    tool: toolFamily,
    accepted: false,
    blocked_expensive_options: blockedOptions,
    reason_code: tokenDecision.reason_code === RUNTIME_BLOCKER_CODES.COMPACT_READ_TOKEN_MISSING
      ? RUNTIME_BLOCKER_CODES.COMPACT_FIRST_REQUIRED
      : tokenDecision.reason_code,
    response_size_risk: continuation.response_size,
    source_digest: compactResult?.source_digest ?? null,
    detail_available_via: continuation.detail_available_via,
    selected_resources: continuation.selected_resources,
    next_calls: continuation.next_calls,
    next_calls_coverage: continuation.next_calls_coverage
  };
}

function enumerationPageCall({ toolFamily, recordId, page, sourceDigest }) {
  const callArguments = {
    id: recordId,
    slice_offset: page.next_offset,
    slice_limit: page.applied_limit,
    expected_source_digest: sourceDigest
  };
  if (page.status_filter) callArguments.slice_status = page.status_filter;
  return buildNextCall({ tool: toolFamily, arguments: callArguments, recommended: true });
}

export function buildSliceEnumerationResponse({
  toolFamily,
  recordId,
  sourceDigest,
  expectedSourceDigest = null,
  page
}) {
  const response = {
    schema_version: WORK_RECORD_SLICE_PAGE_SCHEMA_VERSION,
    tool: toolFamily,
    accepted: true,
    record_id: recordId,
    source_digest: sourceDigest,
    expected_source_digest: expectedSourceDigest,
    source_digest_matches: expectedSourceDigest === null ? null : expectedSourceDigest === sourceDigest,
    slice_page: page,
    next_calls: page.has_more
      ? [enumerationPageCall({ toolFamily, recordId, page, sourceDigest })]
      : []
  };
  response.response_size = responseSizeMetadata(response);
  return response;
}

export function buildSliceEnumerationDigestMismatch({
  toolFamily,
  recordId,
  sourceDigest,
  expectedSourceDigest,
  request
}) {
  const restart = { id: recordId, slice_offset: 0, expected_source_digest: sourceDigest };
  if (Number.isInteger(request?.limit)) restart.slice_limit = request.limit;
  if (Array.isArray(request?.status) && request.status.length > 0) {
    restart.slice_status = request.status;
  }
  return {
    schema_version: WORK_RECORD_SLICE_PAGE_SCHEMA_VERSION,
    tool: toolFamily,
    accepted: false,
    reason_code: RUNTIME_BLOCKER_CODES.COMPACT_READ_TOKEN_STALE_SOURCE_DIGEST,
    record_id: recordId,
    source_digest: sourceDigest,
    expected_source_digest: expectedSourceDigest,
    source_digest_matches: false,
    slice_page: null,
    next_calls: [buildNextCall({ tool: toolFamily, arguments: restart, recommended: true })]
  };
}

export function workRecordDetailSelectorSchemaShape(z, toolFamily) {
  const nonEmptyString = z.string().refine((value) => value.trim().length > 0, {
    message: "Expected a non-empty string"
  });
  const byArgument = {
    selected_slice: () => nonEmptyString.optional()
      .describe("Return only this slice's detail."),
    selected_record: () => z.literal(true).optional()
      .describe(
        "Return only this record's write_scope, acceptance, and validation projection, within the " +
          "compact size class and without slice bodies."
      ),
    slice_offset: () => z.number().int().min(0).optional()
      .describe(
        "Zero-based index of the first slice to return. An offset past the end returns an " +
          "empty, explicitly-final page."
      ),
    slice_limit: () => z.number().int().min(1).optional()
      .describe(
        `Maximum slices per page. Clamped to the server maximum of ${WORK_RECORD_SLICE_PAGE_MAX_LIMIT} ` +
          "and to the compact response-size class; the applied limit is always reported."
      ),
    slice_status: () => z.union([nonEmptyString, z.array(nonEmptyString).min(1)]).optional()
      .describe(
        "Return only slices with this status (or one of these statuses). The page reports the " +
          "filtered and unfiltered totals side by side."
      ),
    expected_source_digest: () => z.string().optional()
      .describe(
        "The source_digest the previous page returned. A page whose digest differs reports the " +
          "mismatch instead of continuing against a record that changed mid-enumeration."
      )
  };
  const shape = {};
  for (const argument of workRecordDetailSelectorArguments(toolFamily)) {
    const build = byArgument[argument];
    if (build) shape[argument] = build();
  }
  return shape;
}

const SELECTED_RECORD_SIZE_RESERVE_BYTES = 256;

export async function runSelectedRecordContractFields({
  toolFamily,
  workspaceDir,
  recordId,
  readWorkRecordById
}) {
  const loaded = typeof readWorkRecordById === "function"
    ? await readWorkRecordById({ dir: workspaceDir, id: recordId })
    : null;
  const record = loaded?.record ?? null;
  if (!isObject(record) || loaded?.valid === false || record.id !== recordId) {
    throwSelectedIdentityError(toolFamily);
  }
  const envelope = {
    record_id: recordId,
    valid: true,
    selected_record: true,
    source_digest: loaded?.source_digest ?? null
  };
  const overhead = Buffer.byteLength(
    JSON.stringify({
      ...envelope,
      summary: null,
      response_size: responseSizeMetadata(null)
    }),
    "utf8"
  );
  const result = {
    ...envelope,
    summary: projectWorkRecordContractFields(record, {
      maxBytes: Math.max(
        0,
        WORK_RECORD_COMPACT_SMALL_RESPONSE_MAX_BYTES - overhead - SELECTED_RECORD_SIZE_RESERVE_BYTES
      )
    })
  };
  return { ...result, response_size: responseSizeMetadata(result) };
}

export async function runSliceEnumeration({
  toolFamily,
  workspaceDir,
  recordId,
  request,
  readWorkRecordById
}) {
  const loaded = typeof readWorkRecordById === "function"
    ? await readWorkRecordById({ dir: workspaceDir, id: recordId })
    : null;
  const record = loaded?.record ?? null;
  if (!isObject(record) || loaded?.valid === false) {
    throwSelectedIdentityError(toolFamily);
  }
  const sourceDigest = loaded?.source_digest ?? null;

  if (request.expected_source_digest !== null &&
      request.expected_source_digest !== sourceDigest) {
    return buildSliceEnumerationDigestMismatch({
      toolFamily,
      recordId,
      sourceDigest,
      expectedSourceDigest: request.expected_source_digest,
      request
    });
  }

  return buildSliceEnumerationResponse({
    toolFamily,
    recordId,
    sourceDigest,
    expectedSourceDigest: request.expected_source_digest,
    page: projectWorkRecordSlicePage(record, {
      offset: request.offset,
      limit: request.limit,
      status: request.status
    })
  });
}
