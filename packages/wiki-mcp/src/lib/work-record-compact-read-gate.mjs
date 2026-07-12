import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { RUNTIME_BLOCKER_CODES } from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";

import { buildNextCall } from "./mcp-response.mjs";

const COMPACT_READ_TOKEN_ACCEPTED = "compact_read_token_accepted";
const COMPACT_READ_NOT_REQUIRED = "compact_read_not_required";

const COMPACT_READ_SCHEMA_VERSION = "work-record-compact-read-gate.v1";
const COMPACT_READ_TOKEN_SCHEMA_VERSION = "work-record-compact-read-token.v1";
const SUMMARY_TOOL_FAMILY = "workspace_work_record_summary";
const GET_RECORD_TOOL_FAMILY = "workspace_get_record";
const READ_PAGE_TOOL_FAMILY = "workspace_read_page";
const LARGE_RECORD_SLICE_THRESHOLD = 8;
const LARGE_RECORD_BYTE_THRESHOLD = 32768;
const TOKEN_TTL_MS = 15 * 60 * 1000;
const TOKEN_SIGNING_SECRET = randomBytes(32);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function base64UrlEncode(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function base64UrlDecodeJson(value) {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function signTokenPayload(encodedPayload) {
  return createHmac("sha256", TOKEN_SIGNING_SECRET).update(encodedPayload).digest("base64url");
}

function signatureMatches(actualSignature, expectedSignature) {
  if (typeof actualSignature !== "string" || typeof expectedSignature !== "string") {
    return false;
  }
  const actual = Buffer.from(actualSignature, "base64url");
  const expected = Buffer.from(expectedSignature, "base64url");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function encodeSignedToken(payload) {
  const encodedPayload = base64UrlEncode(payload);
  return `${encodedPayload}.${signTokenPayload(encodedPayload)}`;
}

function decodeSignedToken(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [encodedPayload, signature] = parts;
  const expectedSignature = signTokenPayload(encodedPayload);
  if (!signatureMatches(signature, expectedSignature)) return null;
  return base64UrlDecodeJson(encodedPayload);
}

function normalizeSummarySelector(args) {
  const unit = normalizeString(args.unit);
  const id = normalizeString(args.id);
  const path = normalizeString(args.path);
  const selected = unit ?? id ?? path;
  return {
    id,
    unit,
    path,
    selected,
    selected_slice: Boolean((unit ?? id ?? "").includes("#"))
  };
}

function normalizeReadSelector(args, toolFamily) {
  const id = normalizeString(args.id);
  const path = normalizeString(args.path);
  const selectedSlice = normalizeString(args.selected_slice);
  const selectedRecord = args.selected_record === true;
  const selected = toolFamily === GET_RECORD_TOOL_FAMILY ? id : path;
  return {
    id,
    path,
    selected,
    selected_slice: selectedSlice,
    selected_record: selectedRecord,
    selected_detail: Boolean(selectedSlice || selectedRecord)
  };
}

function buildSummaryArgs(args, overrides = {}) {
  return {
    id: args.id ?? null,
    unit: args.unit ?? null,
    pathInput: args.path ?? null,
    verbose: false,
    include_full_summary: false,
    ...overrides
  };
}

function buildReadArgs(args, overrides = {}) {
  return {
    ...args,
    verbose: false,
    include_record: false,
    include_body: false,
    include_raw: false,
    ...overrides
  };
}

function responseSizeMetadata(value) {
  const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  return {
    bytes,
    class: bytes < 8192 ? "small" : bytes < 32768 ? "medium" : "large"
  };
}

function isLargePayload(value) {
  if (value === undefined) {
    return false;
  }
  return responseSizeMetadata(value).bytes >= LARGE_RECORD_BYTE_THRESHOLD;
}

function omittedDetailCounts(summary) {
  const omissions = isObject(summary?.slice_detail_omissions)
    ? summary.slice_detail_omissions
    : null;
  const slices = Array.isArray(summary?.slices) ? summary.slices : [];
  return {
    slice_detail_omissions: typeof omissions?.count === "number" ? omissions.count : null,
    included_slices_with_omitted_agent_notes: slices.filter(
      (slice) => Number(slice?.agent_notes_bytes ?? 0) > 0 && !Object.hasOwn(slice, "agent_notes")
    ).length
  };
}

function omittedReadDetailCounts(result) {
  const omissions = isObject(result?.slice_detail_omissions)
    ? result.slice_detail_omissions
    : null;
  const workingSlices = Array.isArray(result?.working_slices) ? result.working_slices : [];
  return {
    slice_detail_omissions: typeof omissions?.suppressed_total === "number"
      ? omissions.suppressed_total
      : null,
    current_slices_omitted_count: typeof omissions?.current_slices_omitted_count === "number"
      ? omissions.current_slices_omitted_count
      : null,
    included_slices_with_omitted_agent_notes: workingSlices.filter(
      (slice) => Number(slice?.agent_notes_bytes ?? 0) > 0 && !Object.hasOwn(slice, "agent_notes")
    ).length
  };
}

function isLargeOrTracker(summary) {
  return summary?.work_kind === "tracker" || Number(summary?.slice_count ?? 0) > LARGE_RECORD_SLICE_THRESHOLD;
}

function isLargeOrTrackerReadResult(result, loadedRecord = null) {
  return (
    result?.format === "json-work-record" &&
    (
      result?.work_kind === "tracker" ||
      Number(result?.slice_counts?.total ?? 0) > LARGE_RECORD_SLICE_THRESHOLD ||
      isLargePayload(result) ||
      isLargePayload(loadedRecord?.record)
    )
  );
}

function expensiveOptions(args) {
  const blocked = [];
  if (args.verbose === true) blocked.push("verbose");
  if (args.include_full_summary === true) blocked.push("include_full_summary");
  return blocked;
}

function expensiveReadOptions(args) {
  const blocked = [];
  if (args.verbose === true) blocked.push("verbose");
  if (args.include_record === true) blocked.push("include_record");
  if (args.include_raw === true) blocked.push("include_raw");
  if (args.include_body === true) blocked.push("include_body");
  return blocked;
}

function createToken({
  workspaceRepo,
  recordId,
  selector,
  sourceDigest,
  toolFamily = SUMMARY_TOOL_FAMILY,
  now = Date.now()
}) {
  return encodeSignedToken({
    schema_version: COMPACT_READ_TOKEN_SCHEMA_VERSION,
    tool_family: toolFamily,
    workspace_repo: workspaceRepo,
    record_id: recordId,
    selector,
    source_digest: sourceDigest,
    issued_at: new Date(now).toISOString(),
    expires_at_ms: now + TOKEN_TTL_MS
  });
}

function validateToken({
  token,
  workspaceRepo,
  recordId,
  selector,
  sourceDigest,
  toolFamily = SUMMARY_TOOL_FAMILY,
  now = Date.now()
}) {
  if (!token) {
    return { accepted: false, reason_code: RUNTIME_BLOCKER_CODES.COMPACT_READ_TOKEN_MISSING };
  }
  const decoded = decodeSignedToken(token);
  if (!isObject(decoded)) {
    return { accepted: false, reason_code: RUNTIME_BLOCKER_CODES.COMPACT_READ_TOKEN_MALFORMED };
  }
  if (decoded.schema_version !== COMPACT_READ_TOKEN_SCHEMA_VERSION) {
    return { accepted: false, reason_code: RUNTIME_BLOCKER_CODES.COMPACT_READ_TOKEN_WRONG_SCHEMA };
  }
  if (decoded.tool_family !== toolFamily) {
    return { accepted: false, reason_code: RUNTIME_BLOCKER_CODES.COMPACT_READ_TOKEN_WRONG_TOOL_FAMILY };
  }
  if (decoded.workspace_repo !== workspaceRepo || decoded.record_id !== recordId) {
    return { accepted: false, reason_code: RUNTIME_BLOCKER_CODES.COMPACT_READ_TOKEN_WRONG_SCOPE };
  }
  if (decoded.selector !== selector) {
    return { accepted: false, reason_code: RUNTIME_BLOCKER_CODES.COMPACT_READ_TOKEN_WRONG_SELECTOR };
  }
  if (decoded.source_digest !== sourceDigest) {
    return { accepted: false, reason_code: RUNTIME_BLOCKER_CODES.COMPACT_READ_TOKEN_STALE_SOURCE_DIGEST };
  }
  if (typeof decoded.expires_at_ms !== "number" || decoded.expires_at_ms < now) {
    return { accepted: false, reason_code: RUNTIME_BLOCKER_CODES.COMPACT_READ_TOKEN_EXPIRED };
  }
  return { accepted: true, reason_code: COMPACT_READ_TOKEN_ACCEPTED };
}

function buildSummaryNextCalls({ recordId, compactToken, selectedSlices }) {
  const calls = [
    buildNextCall({
      tool: SUMMARY_TOOL_FAMILY,
      arguments: { id: recordId },
      recommended: true
    })
  ];
  for (const slice of selectedSlices.slice(0, 3)) {
    calls.push(buildNextCall({
      tool: SUMMARY_TOOL_FAMILY,
      arguments: { unit: `${recordId}#${slice.id}` },
      recommended: true
    }));
  }
  if (calls.length === 1 && compactToken) {
    calls.push(buildNextCall({
      tool: SUMMARY_TOOL_FAMILY,
      arguments: { id: recordId, compact_read_token: compactToken },
      recommended: true
    }));
  }
  return calls;
}

function buildReadNextCalls({ toolFamily, args, recordId, selectedSlices }) {
  const calls = [];
  if (toolFamily === GET_RECORD_TOOL_FAMILY) {
    calls.push(buildNextCall({
      tool: GET_RECORD_TOOL_FAMILY,
      arguments: { id: recordId },
      recommended: true
    }));
    for (const slice of selectedSlices.slice(0, 3)) {
      calls.push(buildNextCall({
        tool: GET_RECORD_TOOL_FAMILY,
        arguments: { id: recordId, selected_slice: slice.id },
        recommended: true
      }));
    }
    return calls;
  }

  const path = normalizeString(args.path) ?? `wiki/work-records/${recordId}.json`;
  calls.push(buildNextCall({
    tool: READ_PAGE_TOOL_FAMILY,
    arguments: { path },
    recommended: true
  }));
  for (const slice of selectedSlices.slice(0, 3)) {
    calls.push(buildNextCall({
      tool: READ_PAGE_TOOL_FAMILY,
      arguments: { path, selected_slice: slice.id },
      recommended: true
    }));
  }
  return calls;
}

function summarySelectedResources({ selector, recordId }) {
  const isSlice = Boolean(selector?.selected_slice);
  return {
    type: isSlice ? "slice" : "work_record",
    id: isSlice ? (selector?.selected ?? recordId) : recordId,
    selection_reason: isSlice
      ? "compact_read_selected_slice_scope"
      : "compact_read_compact_first_scope"
  };
}

function readSelectedResources({ selector, recordId }) {
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

function buildContinuationMetadata({ compactResult, compactToken, selector }) {
  const summary = compactResult.summary || {};
  const selectedSlices = Array.isArray(summary.slices) ? summary.slices.filter((slice) => slice?.id) : [];
  const detailAvailableVia = new Set(["selected_slice"]);
  const omissionRoutes = summary.slice_detail_omissions?.detail_available_via;
  if (Array.isArray(omissionRoutes)) {
    for (const route of omissionRoutes) detailAvailableVia.add(route);
  }
  const nextCalls = buildSummaryNextCalls({
    recordId: compactResult.record_id,
    compactToken,
    selectedSlices
  });
  return {
    schema_version: COMPACT_READ_SCHEMA_VERSION,
    source_digest: compactResult.source_digest ?? null,
    compact_read_token: compactToken,
    response_size: responseSizeMetadata(compactResult),
    omitted_detail_counts: omittedDetailCounts(summary),
    detail_available_via: [...detailAvailableVia],
    selected_resources: summarySelectedResources({ selector, recordId: compactResult.record_id }),
    next_calls: nextCalls
  };
}

function buildReadContinuationMetadata({ compactResult, compactToken, toolFamily, args }) {
  const selectedSlices = Array.isArray(compactResult.working_slices)
    ? compactResult.working_slices.filter((slice) => slice?.id)
    : [];
  const detailAvailableVia = new Set(["selected_slice"]);
  if (toolFamily === READ_PAGE_TOOL_FAMILY) {
    detailAvailableVia.add("selected_record");
  }
  const nextCalls = buildReadNextCalls({
    toolFamily,
    args,
    recordId: compactResult.record_id,
    selectedSlices
  });
  return {
    schema_version: COMPACT_READ_SCHEMA_VERSION,
    source_digest: compactResult.source_digest ?? null,
    compact_read_token: compactToken,
    response_size: responseSizeMetadata(compactResult),
    omitted_detail_counts: omittedReadDetailCounts(compactResult),
    detail_available_via: [...detailAvailableVia],
    selected_resources: readSelectedResources({
      selector: normalizeReadSelector(args, toolFamily),
      recordId: compactResult.record_id
    }),
    next_calls: nextCalls
  };
}

function buildRefusal({ compactResult, blockedOptions, tokenDecision, selector, toolFamily = SUMMARY_TOOL_FAMILY }) {
  const continuation = buildContinuationMetadata({ compactResult, compactToken: null, selector });
  return {
    schema_version: "work-record-compact-read-refusal.v1",
    tool: toolFamily,
    accepted: false,
    blocked_expensive_options: blockedOptions,
    reason_code: tokenDecision.reason_code === RUNTIME_BLOCKER_CODES.COMPACT_READ_TOKEN_MISSING
      ? RUNTIME_BLOCKER_CODES.COMPACT_FIRST_REQUIRED
      : tokenDecision.reason_code,
    response_size_risk: continuation.response_size,
    source_digest: compactResult.source_digest ?? null,
    detail_available_via: continuation.detail_available_via,
    selected_resources: continuation.selected_resources,
    next_calls: continuation.next_calls
  };
}

function buildReadRefusal({ compactResult, blockedOptions, tokenDecision, toolFamily, args }) {
  const continuation = buildReadContinuationMetadata({
    compactResult,
    compactToken: null,
    toolFamily,
    args
  });
  return {
    schema_version: "work-record-compact-read-refusal.v1",
    tool: toolFamily,
    accepted: false,
    blocked_expensive_options: blockedOptions,
    reason_code: tokenDecision.reason_code === RUNTIME_BLOCKER_CODES.COMPACT_READ_TOKEN_MISSING
      ? RUNTIME_BLOCKER_CODES.COMPACT_FIRST_REQUIRED
      : tokenDecision.reason_code,
    response_size_risk: continuation.response_size,
    source_digest: compactResult.source_digest ?? null,
    detail_available_via: continuation.detail_available_via,
    selected_resources: continuation.selected_resources,
    next_calls: continuation.next_calls
  };
}

function boundedSelectedSliceResult({ compactResult, selector, blockedOptions, compactToken }) {
  if (isObject(compactResult.summary)) {
    compactResult.summary = {
      ...compactResult.summary,
      slices: []
    };
  }
  const selectedNextCalls = [
    buildNextCall({
      tool: SUMMARY_TOOL_FAMILY,
      arguments: { unit: selector.selected },
      recommended: true
    })
  ];
  compactResult.compact_read = {
    ...buildContinuationMetadata({ compactResult, compactToken, selector }),
    downgraded_expensive_options: blockedOptions,
    reason_code: RUNTIME_BLOCKER_CODES.SELECTED_SLICE_COMPACT_DETAIL_REQUIRED,
    next_calls: selectedNextCalls
  };
  return compactResult;
}

function boundedSelectedReadResult({ compactResult, blockedOptions, compactToken, toolFamily, args }) {
  const selectedNextCalls = buildReadNextCalls({
    toolFamily,
    args,
    recordId: compactResult.record_id,
    selectedSlices: compactResult.selected_slice?.id ? [compactResult.selected_slice] : []
  });
  compactResult.compact_read = {
    ...buildReadContinuationMetadata({ compactResult, compactToken, toolFamily, args }),
    downgraded_expensive_options: blockedOptions,
    reason_code: RUNTIME_BLOCKER_CODES.SELECTED_SLICE_COMPACT_DETAIL_REQUIRED,
    next_calls: selectedNextCalls
  };
  return compactResult;
}

export async function runWorkRecordSummaryWithCompactGate({
  workspaceRepo,
  workspaceDir,
  args,
  getWorkRecordSummary,
  readWorkRecordById
}) {
  const selector = normalizeSummarySelector(args);
  const compactResult = await getWorkRecordSummary({
    dir: workspaceDir,
    ...buildSummaryArgs(args)
  });

  if (!compactResult.valid || !compactResult.record_id) {
    return compactResult;
  }

  const loadedRecord = typeof readWorkRecordById === "function"
    ? await readWorkRecordById({ dir: workspaceDir, id: compactResult.record_id })
    : null;
  const sourceDigest = loadedRecord?.source_digest ?? compactResult.source_digest ?? null;
  compactResult.source_digest = sourceDigest;

  const compactToken = createToken({
    workspaceRepo,
    recordId: compactResult.record_id,
    selector: selector.selected,
    sourceDigest,
    toolFamily: SUMMARY_TOOL_FAMILY
  });

  const blockedOptions = expensiveOptions(args);
  const largeUnscopedExpensiveRequest =
    blockedOptions.length > 0 &&
    isLargeOrTracker(compactResult.summary) &&
    !selector.selected_slice;
  const tokenDecision = largeUnscopedExpensiveRequest
    ? validateToken({
        token: normalizeString(args.compact_read_token),
        workspaceRepo,
        recordId: compactResult.record_id,
        selector: selector.selected,
        sourceDigest,
        toolFamily: SUMMARY_TOOL_FAMILY
      })
    : { accepted: true, reason_code: COMPACT_READ_NOT_REQUIRED };

  if (largeUnscopedExpensiveRequest) {
    const refusalDecision = tokenDecision.accepted
      ? {
          accepted: false,
          reason_code: RUNTIME_BLOCKER_CODES.COMPACT_READ_SELECTED_DETAIL_REQUIRED
        }
      : tokenDecision;
    return buildRefusal({ compactResult, blockedOptions, tokenDecision: refusalDecision, selector });
  }

  if (blockedOptions.length > 0 && !tokenDecision.accepted) {
    return buildRefusal({ compactResult, blockedOptions, tokenDecision, selector });
  }

  if (blockedOptions.length > 0 && selector.selected_slice) {
    return boundedSelectedSliceResult({ compactResult, selector, blockedOptions, compactToken });
  }

  if (blockedOptions.length > 0) {
    return getWorkRecordSummary({
      dir: workspaceDir,
      id: args.id ?? null,
      unit: args.unit ?? null,
      pathInput: args.path ?? null,
      verbose: Boolean(args.verbose),
      include_full_summary: Boolean(args.include_full_summary)
    });
  }

  compactResult.compact_read = buildContinuationMetadata({ compactResult, compactToken, selector });
  return compactResult;
}

export async function runWorkRecordReadWithCompactGate({
  workspaceRepo,
  workspaceDir,
  args,
  toolFamily,
  readCompact,
  readExpensive,
  readWorkRecordById
}) {
  const selector = normalizeReadSelector(args, toolFamily);
  const compactResult = await readCompact({
    ...buildReadArgs(args),
    dir: workspaceDir
  });

  if (compactResult?.format !== "json-work-record" || !compactResult.record_id) {
    if (expensiveReadOptions(args).length > 0) {
      return readExpensive({
        ...args,
        dir: workspaceDir
      });
    }
    return compactResult;
  }

  const loadedRecord = typeof readWorkRecordById === "function"
    ? await readWorkRecordById({ dir: workspaceDir, id: compactResult.record_id })
    : null;
  const sourceDigest = loadedRecord?.source_digest ?? compactResult.source_digest ?? null;
  compactResult.source_digest = sourceDigest;

  const compactToken = createToken({
    workspaceRepo,
    recordId: compactResult.record_id,
    selector: selector.selected,
    sourceDigest,
    toolFamily
  });

  const blockedOptions = expensiveReadOptions(args);
  const largeUnscopedExpensiveRequest =
    blockedOptions.length > 0 &&
    isLargeOrTrackerReadResult(compactResult, loadedRecord) &&
    !selector.selected_detail;
  const tokenDecision = largeUnscopedExpensiveRequest
    ? validateToken({
        token: normalizeString(args.compact_read_token),
        workspaceRepo,
        recordId: compactResult.record_id,
        selector: selector.selected,
        sourceDigest,
        toolFamily
      })
    : { accepted: true, reason_code: COMPACT_READ_NOT_REQUIRED };

  if (largeUnscopedExpensiveRequest) {
    const refusalDecision = tokenDecision.accepted
      ? {
          accepted: false,
          reason_code: RUNTIME_BLOCKER_CODES.COMPACT_READ_SELECTED_DETAIL_REQUIRED
        }
      : tokenDecision;
    return buildReadRefusal({
      compactResult,
      blockedOptions,
      tokenDecision: refusalDecision,
      toolFamily,
      args
    });
  }

  if (blockedOptions.length > 0 && !tokenDecision.accepted) {
    return buildReadRefusal({ compactResult, blockedOptions, tokenDecision, toolFamily, args });
  }

  if (blockedOptions.length > 0 && selector.selected_detail) {
    return boundedSelectedReadResult({
      compactResult,
      blockedOptions,
      compactToken,
      toolFamily,
      args
    });
  }

  if (blockedOptions.length > 0) {
    return readExpensive({
      ...args,
      dir: workspaceDir
    });
  }

  compactResult.compact_read = buildReadContinuationMetadata({
    compactResult,
    compactToken,
    toolFamily,
    args
  });
  return compactResult;
}
