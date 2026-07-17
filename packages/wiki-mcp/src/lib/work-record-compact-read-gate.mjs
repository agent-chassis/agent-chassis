import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { types as utilTypes } from "node:util";
import { RUNTIME_BLOCKER_CODES } from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
import { SLICE_ID_PATTERN } from "@agent-chassis/wiki-core/src/lib/work-record-schema-constants.mjs";
import { projectSelectedWorkRecordUnit } from "@agent-chassis/wiki-core/src/lib/work-record-selected-unit-projection.mjs";

import { buildNextCall } from "./mcp-response.mjs";

const COMPACT_READ_TOKEN_ACCEPTED = "compact_read_token_accepted";
const COMPACT_READ_NOT_REQUIRED = "compact_read_not_required";

const COMPACT_READ_SCHEMA_VERSION = "work-record-compact-read-gate.v1";
const COMPACT_READ_TOKEN_SCHEMA_VERSION = "work-record-compact-read-token.v1";
const SUMMARY_TOOL_FAMILY = "workspace_work_record_summary";
const GET_RECORD_TOOL_FAMILY = "workspace_get_record";
const READ_PAGE_TOOL_FAMILY = "workspace_read_page";
const WORK_RECORD_ID_PATTERN = /^WK-[0-9]{4}$/;
const WORK_RECORD_ID_PREFIX_PATTERN = /^WK-/;
const WORK_RECORD_READ_PATH_PATTERN = /^(?:\.\/)?wiki\/work-records\/(WK-[0-9]{4})\.json$/;
const GRAPH_EVIDENCE_READ_PATH_PATTERN =
  /^(?:\.\/)?wiki\/work-records\/evidence\/(WK-[0-9]{4})\.graph\.json$/;
const WORK_RECORD_NAMESPACE_CLAIM_PATTERN =
  /^(?:\.\/)?wiki\/+work-records(?:\/|$)/;
const GRAPH_EVIDENCE_NAMESPACE_CLAIM_PATTERN =
  /^(?:\.\/)?wiki\/+work-records\/+evidence(?:\/|$)/;
const SELECTOR_REFUSAL_SCHEMA_VERSION = "work-record-selector-refusal.v1";
const IDENTITY_REFUSAL_SCHEMA_VERSION = "work-record-selected-identity-refusal.v1";
const IDENTITY_REFUSAL_CODE = "selected_result_identity_mismatch";
const MAX_SELECTOR_DIAGNOSTICS = 8;
const SELECTOR_REFUSAL_CODES = Object.freeze({
  UNKNOWN_ARGUMENT: "selector_unknown_argument",
  COUNT_INVALID: "selector_count_invalid",
  UNSUPPORTED: "selector_unsupported",
  RECORD_ID_MALFORMED: "selector_record_id_malformed",
  UNIT_ADDRESS_MALFORMED: "selector_unit_address_malformed",
  PATH_MALFORMED: "selector_path_malformed",
  SLICE_ID_MALFORMED: "selector_slice_id_malformed",
  SELECTED_RECORD_INVALID: "selector_selected_record_invalid",
  CONFLICT: "selector_conflict",
  PATH_UNSUPPORTED: "selector_path_unsupported",
  ACCEPT_FULL_READ_INVALID: "selector_accept_full_read_invalid"
});
const LARGE_RECORD_SLICE_THRESHOLD = 8;
const LARGE_RECORD_BYTE_THRESHOLD = 32768;
const TOKEN_TTL_MS = 15 * 60 * 1000;
const TOKEN_SIGNING_SECRET = randomBytes(32);
const SUMMARY_ARGUMENT_FIELDS = new Set([
  "repo",
  "id",
  "unit",
  "path",
  "verbose",
  "include_full_summary",
  "accept_full_read",
  "compact_read_token"
]);
const READ_PAGE_ARGUMENT_FIELDS = new Set([
  "path",
  "repo",
  "profile",
  "extensionNamespaces",
  "verbose",
  "include_body",
  "include_raw",
  "include_record",
  "selected_slice",
  "selected_record",
  "accept_full_read",
  "compact_read_token"
]);
const GET_RECORD_ARGUMENT_FIELDS = new Set([
  "id",
  "repo",
  "profile",
  "extensionNamespaces",
  "verbose",
  "include_record",
  "include_body",
  "include_raw",
  "selected_slice",
  "accept_full_read",
  "compact_read_token"
]);

function isObject(value) {
  return Boolean(value) &&
    typeof value === "object" &&
    !utilTypes.isProxy(value) &&
    !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function hasOwn(value, key) {
  return isObject(value) && Object.hasOwn(value, key);
}

function boundedLabel(value) {
  const text = String(value);
  return text.length <= 80 ? text : `${text.slice(0, 77)}...`;
}

function selectorIssue(code, path, message) {
  return {
    code,
    path,
    message: `${code}: ${message}`
  };
}

function boundedSelectorIssues(issues) {
  return issues.slice(0, MAX_SELECTOR_DIAGNOSTICS);
}

function throwSelectorValidationError(toolFamily, issues) {
  const diagnostics = boundedSelectorIssues(issues).map((issue) => ({
    code: issue.code,
    severity: "error",
    path: issue.path,
    message: issue.message
  }));
  const first = diagnostics[0];
  const error = new Error(first.message);
  error.name = "WorkRecordSelectorValidationError";
  error.code = first.code;
  error.diagnostics = diagnostics;
  error.envelope = {
    schema_version: SELECTOR_REFUSAL_SCHEMA_VERSION,
    tool: toolFamily,
    accepted: false,
    refusal_code: first.code,
    diagnostics
  };
  throw error;
}

function throwSelectedIdentityError(toolFamily) {
  const message = `${toolFamily} selected result identity did not match the requested selector`;
  const diagnostics = [{
    code: IDENTITY_REFUSAL_CODE,
    severity: "error",
    path: [],
    message
  }];
  const error = new Error(message);
  error.name = "WorkRecordSelectedIdentityError";
  error.code = IDENTITY_REFUSAL_CODE;
  error.diagnostics = diagnostics;
  error.envelope = {
    schema_version: IDENTITY_REFUSAL_SCHEMA_VERSION,
    tool: toolFamily,
    accepted: false,
    refusal_code: IDENTITY_REFUSAL_CODE,
    diagnostics
  };
  throw error;
}

function extractWorkRecordReadPath(value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  const match = normalized.match(WORK_RECORD_READ_PATH_PATTERN);
  return match
    ? { kind: "work_record", path: normalized, record_id: match[1] }
    : null;
}

function extractGraphEvidenceReadPath(value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  const match = normalized.match(GRAPH_EVIDENCE_READ_PATH_PATTERN);
  return match
    ? { kind: "graph_evidence", path: normalized, record_id: match[1] }
    : null;
}

function classifyReadPagePath(value) {
  const normalized = normalizeString(value);
  if (!normalized) return { kind: "invalid", path: null, record_id: null };
  const graphEvidence = extractGraphEvidenceReadPath(normalized);
  if (graphEvidence) return graphEvidence;
  const workRecord = extractWorkRecordReadPath(normalized);
  if (workRecord) return workRecord;
  const normalizedClaimPath = path.posix.normalize(normalized);
  if (
    GRAPH_EVIDENCE_NAMESPACE_CLAIM_PATTERN.test(normalized) ||
    normalizedClaimPath === "wiki/work-records/evidence" ||
    normalizedClaimPath.startsWith("wiki/work-records/evidence/")
  ) {
    return { kind: "malformed_graph_evidence", path: normalized, record_id: null };
  }
  if (
    WORK_RECORD_NAMESPACE_CLAIM_PATTERN.test(normalized) ||
    normalizedClaimPath === "wiki/work-records" ||
    normalizedClaimPath.startsWith("wiki/work-records/")
  ) {
    return { kind: "malformed_work_record", path: normalized, record_id: null };
  }
  return { kind: "generic", path: normalized, record_id: null };
}

function isSafeWorkspaceRelativePath(value) {
  const normalized = normalizeString(value);
  if (!normalized || normalized.includes("\0") || normalized.startsWith("/")) return false;
  const posix = normalized.replaceAll("\\", "/");
  if (/^[A-Za-z]:\//.test(posix)) return false;
  return !posix.split("/").includes("..");
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

export function getSummarySelectorValidationIssues(args) {
  const issues = [];
  for (const field of Object.keys(isObject(args) ? args : {})) {
    if (!SUMMARY_ARGUMENT_FIELDS.has(field) && field !== "selected_slice" && field !== "selected_record") {
      issues.push(selectorIssue(
        SELECTOR_REFUSAL_CODES.UNKNOWN_ARGUMENT,
        [boundedLabel(field)],
        `${SUMMARY_TOOL_FAMILY} does not support argument ${boundedLabel(field)}`
      ));
    }
  }
  const suppliedSelectors = ["id", "unit", "path"].filter((field) => hasOwn(args, field));
  if (suppliedSelectors.length !== 1) {
    issues.push(selectorIssue(
      SELECTOR_REFUSAL_CODES.COUNT_INVALID,
      [],
      `${SUMMARY_TOOL_FAMILY} requires exactly one non-empty selector among id, unit, and path`
    ));
  }
  for (const unsupported of ["selected_slice", "selected_record"]) {
    if (hasOwn(args, unsupported)) {
      issues.push(selectorIssue(
        SELECTOR_REFUSAL_CODES.UNSUPPORTED,
        [unsupported],
        `${SUMMARY_TOOL_FAMILY} does not support the ${unsupported} selector`
      ));
    }
  }
  if (hasOwn(args, "accept_full_read") && args.accept_full_read !== true) {
    issues.push(selectorIssue(
      SELECTOR_REFUSAL_CODES.ACCEPT_FULL_READ_INVALID,
      ["accept_full_read"],
      `${SUMMARY_TOOL_FAMILY} accept_full_read must be literal true when supplied`
    ));
  }

  if (suppliedSelectors.length === 1) {
    const selectorField = suppliedSelectors[0];
    const selected = normalizeString(args[selectorField]);
    if (!selected) {
      issues.push(selectorIssue(
        SELECTOR_REFUSAL_CODES.COUNT_INVALID,
        [selectorField],
        `${SUMMARY_TOOL_FAMILY} requires exactly one non-empty selector among id, unit, and path`
      ));
    } else if (selectorField === "id" && !WORK_RECORD_ID_PATTERN.test(selected)) {
      issues.push(selectorIssue(
        SELECTOR_REFUSAL_CODES.RECORD_ID_MALFORMED,
        [selectorField],
        `${SUMMARY_TOOL_FAMILY} id must match the canonical WK-0000 grammar`
      ));
    } else if (selectorField === "unit" && !parseSelectedUnitAddress(selected)) {
      issues.push(selectorIssue(
        SELECTOR_REFUSAL_CODES.UNIT_ADDRESS_MALFORMED,
        [selectorField],
        `${SUMMARY_TOOL_FAMILY} unit must be a canonical WK-0000 or WK-0000#slice-id address`
      ));
    } else if (selectorField === "path" && !extractWorkRecordReadPath(selected)) {
      issues.push(selectorIssue(
        SELECTOR_REFUSAL_CODES.PATH_MALFORMED,
        [selectorField],
        `${SUMMARY_TOOL_FAMILY} path must be a canonical wiki/work-records/WK-0000.json path`
      ));
    }
  }
  return boundedSelectorIssues(issues);
}

function validateAndNormalizeSummarySelector(args) {
  const issues = getSummarySelectorValidationIssues(args);
  if (issues.length > 0) {
    throwSelectorValidationError(SUMMARY_TOOL_FAMILY, issues);
  }

  const selectorField = ["id", "unit", "path"].find((field) => hasOwn(args, field));
  const selected = normalizeString(args[selectorField]);

  const normalizedArgs = { ...args };
  delete normalizedArgs.id;
  delete normalizedArgs.unit;
  delete normalizedArgs.path;
  normalizedArgs[selectorField] = selected;

  const id = selectorField === "id" ? selected : null;
  const unit = selectorField === "unit" ? selected : null;
  const path = selectorField === "path" ? selected : null;
  const selectedAddress = selectorField === "unit"
    ? parseSelectedUnitAddress(selected)
    : null;
  return {
    args: normalizedArgs,
    selector: {
      id,
      unit,
      path,
      selected,
      selected_slice: selectedAddress?.kind === "slice"
    }
  };
}

function isWorkRecordReadPath(value) {
  return extractWorkRecordReadPath(value) !== null;
}

function isGraphEvidenceReadPath(value) {
  return extractGraphEvidenceReadPath(value) !== null;
}

export function getReadSelectorValidationIssues(args, toolFamily) {
  if (toolFamily !== GET_RECORD_TOOL_FAMILY && toolFamily !== READ_PAGE_TOOL_FAMILY) {
    return [selectorIssue(
      SELECTOR_REFUSAL_CODES.UNSUPPORTED,
      [],
      `Unsupported work-record read tool family: ${boundedLabel(toolFamily)}`
    )];
  }

  const issues = [];
  const allowedFields = toolFamily === GET_RECORD_TOOL_FAMILY
    ? GET_RECORD_ARGUMENT_FIELDS
    : READ_PAGE_ARGUMENT_FIELDS;
  for (const field of Object.keys(isObject(args) ? args : {})) {
    if (
      !allowedFields.has(field) &&
      field !== "selected_record" &&
      !["id", "unit", "path"].includes(field)
    ) {
      issues.push(selectorIssue(
        SELECTOR_REFUSAL_CODES.UNKNOWN_ARGUMENT,
        [boundedLabel(field)],
        `${toolFamily} does not support argument ${boundedLabel(field)}`
      ));
    }
  }
  const primaryField = toolFamily === GET_RECORD_TOOL_FAMILY ? "id" : "path";
  if (hasOwn(args, "accept_full_read") && args.accept_full_read !== true) {
    issues.push(selectorIssue(
      SELECTOR_REFUSAL_CODES.ACCEPT_FULL_READ_INVALID,
      ["accept_full_read"],
      `${toolFamily} accept_full_read must be literal true when supplied`
    ));
  }
  const unsupportedPrimaryFields = ["id", "unit", "path"].filter(
    (field) => field !== primaryField && hasOwn(args, field)
  );
  if (unsupportedPrimaryFields.length > 0) {
    issues.push(selectorIssue(
      SELECTOR_REFUSAL_CODES.UNSUPPORTED,
      [unsupportedPrimaryFields[0]],
      `${toolFamily} does not support selector${unsupportedPrimaryFields.length === 1 ? "" : "s"} ` +
        unsupportedPrimaryFields.join(", ")
    ));
  }
  if (!hasOwn(args, primaryField)) {
    issues.push(selectorIssue(
      SELECTOR_REFUSAL_CODES.COUNT_INVALID,
      [primaryField],
      `${toolFamily} requires a non-empty ${primaryField} selector`
    ));
  }
  const selected = hasOwn(args, primaryField) ? normalizeString(args[primaryField]) : null;
  const readPagePath = selected && toolFamily === READ_PAGE_TOOL_FAMILY
    ? classifyReadPagePath(selected)
    : null;
  if (hasOwn(args, primaryField) && !selected) {
    issues.push(selectorIssue(
      SELECTOR_REFUSAL_CODES.COUNT_INVALID,
      [primaryField],
      `${toolFamily} requires a non-empty ${primaryField} selector`
    ));
  } else if (
    selected &&
    toolFamily === GET_RECORD_TOOL_FAMILY &&
    (
      WORK_RECORD_ID_PREFIX_PATTERN.test(selected) ||
      hasOwn(args, "selected_slice") ||
      hasOwn(args, "selected_record") ||
      hasOwn(args, "compact_read_token")
    ) &&
    !WORK_RECORD_ID_PATTERN.test(selected)
  ) {
    issues.push(selectorIssue(
      SELECTOR_REFUSAL_CODES.RECORD_ID_MALFORMED,
      [primaryField],
      `${GET_RECORD_TOOL_FAMILY} id must match the canonical WK-0000 grammar`
    ));
  } else if (
    selected &&
    toolFamily === READ_PAGE_TOOL_FAMILY &&
    !isSafeWorkspaceRelativePath(selected)
  ) {
    issues.push(selectorIssue(
      SELECTOR_REFUSAL_CODES.PATH_MALFORMED,
      [primaryField],
      `${READ_PAGE_TOOL_FAMILY} path must be a safe workspace-relative path without traversal segments`
    ));
  } else if (
    readPagePath?.kind === "malformed_work_record" ||
    readPagePath?.kind === "malformed_graph_evidence"
  ) {
    issues.push(selectorIssue(
      SELECTOR_REFUSAL_CODES.PATH_MALFORMED,
      [primaryField],
      readPagePath.kind === "malformed_graph_evidence"
        ? `${READ_PAGE_TOOL_FAMILY} graph-evidence filename must match the canonical WK-0000.graph.json grammar`
        : `${READ_PAGE_TOOL_FAMILY} work-record filename must match the canonical WK-0000.json grammar`
    ));
  }

  const selectedSliceSupplied = hasOwn(args, "selected_slice");
  const selectedSlice = selectedSliceSupplied ? normalizeString(args.selected_slice) : null;
  if (selectedSliceSupplied && !selectedSlice) {
    issues.push(selectorIssue(
      SELECTOR_REFUSAL_CODES.SLICE_ID_MALFORMED,
      ["selected_slice"],
      `${toolFamily} selected_slice must be a non-empty string matching the canonical slice-id grammar`
    ));
  } else if (selectedSlice && !SLICE_ID_PATTERN.test(selectedSlice)) {
    issues.push(selectorIssue(
      SELECTOR_REFUSAL_CODES.SLICE_ID_MALFORMED,
      ["selected_slice"],
      `${toolFamily} selected_slice must match the canonical slice-id grammar`
    ));
  }

  const selectedRecordSupplied = hasOwn(args, "selected_record");
  if (selectedRecordSupplied && args.selected_record !== true) {
    issues.push(selectorIssue(
      SELECTOR_REFUSAL_CODES.SELECTED_RECORD_INVALID,
      ["selected_record"],
      `${toolFamily} selected_record must be literal true when supplied`
    ));
  }
  const selectedRecord = args.selected_record === true;

  if (toolFamily === GET_RECORD_TOOL_FAMILY && selectedRecordSupplied) {
    issues.push(selectorIssue(
      SELECTOR_REFUSAL_CODES.UNSUPPORTED,
      ["selected_record"],
      `${GET_RECORD_TOOL_FAMILY} does not support the selected_record selector`
    ));
  }
  if (selectedSliceSupplied && selectedRecordSupplied) {
    issues.push(selectorIssue(
      SELECTOR_REFUSAL_CODES.CONFLICT,
      ["selected_record"],
      `${READ_PAGE_TOOL_FAMILY} selected_slice and selected_record are mutually exclusive`
    ));
  }
  if (
    toolFamily === READ_PAGE_TOOL_FAMILY &&
    selectedSlice &&
    selected &&
    !isWorkRecordReadPath(selected) &&
    !isGraphEvidenceReadPath(selected)
  ) {
    issues.push(selectorIssue(
      SELECTOR_REFUSAL_CODES.PATH_UNSUPPORTED,
      ["selected_slice"],
      `${READ_PAGE_TOOL_FAMILY} selected_slice requires a canonical work-record or graph-evidence path`
    ));
  }
  if (
    toolFamily === READ_PAGE_TOOL_FAMILY &&
    selectedRecord &&
    selected &&
    !isGraphEvidenceReadPath(selected)
  ) {
    issues.push(selectorIssue(
      SELECTOR_REFUSAL_CODES.PATH_UNSUPPORTED,
      ["selected_record"],
      `${READ_PAGE_TOOL_FAMILY} selected_record requires a canonical graph-evidence path`
    ));
  }
  if (
    toolFamily === READ_PAGE_TOOL_FAMILY &&
    hasOwn(args, "compact_read_token") &&
    readPagePath &&
    readPagePath.kind !== "work_record" &&
    readPagePath.kind !== "graph_evidence"
  ) {
    issues.push(selectorIssue(
      SELECTOR_REFUSAL_CODES.PATH_UNSUPPORTED,
      ["compact_read_token"],
      `${READ_PAGE_TOOL_FAMILY} compact_read_token requires a canonical work-record or graph-evidence path`
    ));
  }
  return boundedSelectorIssues(issues);
}

function validateAndNormalizeReadSelector(args, toolFamily) {
  const issues = getReadSelectorValidationIssues(args, toolFamily);
  if (issues.length > 0) {
    throwSelectorValidationError(toolFamily, issues);
  }

  const primaryField = toolFamily === GET_RECORD_TOOL_FAMILY ? "id" : "path";
  const selected = normalizeString(args[primaryField]);
  const selectedSliceSupplied = hasOwn(args, "selected_slice");
  const selectedSlice = selectedSliceSupplied ? normalizeString(args.selected_slice) : null;
  const selectedRecord = args.selected_record === true;

  const normalizedArgs = { ...args };
  delete normalizedArgs.id;
  delete normalizedArgs.unit;
  delete normalizedArgs.path;
  normalizedArgs[primaryField] = selected;
  if (selectedSliceSupplied) normalizedArgs.selected_slice = selectedSlice;

  return {
    args: normalizedArgs,
    selector: {
      id: primaryField === "id" ? selected : null,
      path: primaryField === "path" ? selected : null,
      selected,
      selected_slice: selectedSlice,
      selected_record: selectedRecord,
      selected_detail: Boolean(selectedSlice || selectedRecord)
    }
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

  const path = args.path ?? `wiki/work-records/${recordId}.json`;
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

function buildReadContinuationMetadata({ compactResult, compactToken, toolFamily, args, selector }) {
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
      selector,
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

const INVALID_DATA_PROPERTY = Symbol("invalid-data-property");
const MAX_IDENTITY_PROJECTION_NODES = 10000;
const MAX_IDENTITY_PROJECTION_DEPTH = 64;
const IDENTITY_CHILD_FIELDS = ["selected_unit", "unit", "identity"];
const PROJECTED_IDENTITY_CONTAINER_FIELDS = [
  "acceptance",
  "dispatch_intent",
  "sections",
  "activity_artifact_targets",
  "scenarios",
  "expected_edit_targets",
  "expected",
  "closure"
];
const PROJECTED_GRAPH_CONTAINER_FIELDS = ["graph_state", "counts", "degraded_state"];

function ownDataProperty(value, field) {
  if (value && typeof value === "object" && utilTypes.isProxy(value)) {
    return { present: true, value: INVALID_DATA_PROPERTY };
  }
  if (!value || typeof value !== "object") {
    return { present: false, value: undefined };
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, field);
  if (!descriptor) return { present: false, value: undefined };
  if (!Object.hasOwn(descriptor, "value")) {
    return { present: true, value: INVALID_DATA_PROPERTY };
  }
  return { present: true, value: descriptor.value };
}

function requiredDataProperty(value, field) {
  const property = ownDataProperty(value, field);
  return property.present && property.value !== INVALID_DATA_PROPERTY
    ? property.value
    : INVALID_DATA_PROPERTY;
}

function projectSelectedUnit(value) {
  if (!isObject(value)) return null;
  const kind = requiredDataProperty(value, "kind");
  const address = requiredDataProperty(value, "address");
  const recordId = requiredDataProperty(value, "record_id");
  const sliceId = requiredDataProperty(value, "slice_id");
  if ([kind, address, recordId, sliceId].includes(INVALID_DATA_PROPERTY)) return null;
  return {
    kind,
    address,
    record_id: recordId,
    slice_id: sliceId
  };
}

function parseSelectedUnitAddress(value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  const pieces = normalized.split("#");
  if (
    pieces.length < 1 ||
    pieces.length > 2 ||
    !WORK_RECORD_ID_PATTERN.test(pieces[0])
  ) {
    return null;
  }
  if (pieces.length === 1) {
    return {
      kind: "work_item",
      address: pieces[0],
      record_id: pieces[0],
      slice_id: null
    };
  }
  if (!SLICE_ID_PATTERN.test(pieces[1])) return null;
  return {
    kind: "slice",
    address: `${pieces[0]}#${pieces[1]}`,
    record_id: pieces[0],
    slice_id: pieces[1]
  };
}

function recordIdFromReadPath(value) {
  return extractWorkRecordReadPath(value)?.record_id ??
    extractGraphEvidenceReadPath(value)?.record_id ??
    null;
}

function requestedSummaryIdentity(selector) {
  const identity = parseSelectedUnitAddress(selector?.selected);
  return identity?.kind === "slice" ? identity : null;
}

function requestedReadIdentity(selector) {
  const recordId = selector?.id
    ? normalizeString(selector.id)
    : recordIdFromReadPath(selector?.path);
  if (!recordId || !WORK_RECORD_ID_PATTERN.test(recordId)) return null;
  const sliceId = selector?.selected_slice ?? null;
  if (sliceId !== null && !SLICE_ID_PATTERN.test(sliceId)) return null;
  return {
    kind: sliceId === null ? "work_item" : "slice",
    address: sliceId === null ? recordId : `${recordId}#${sliceId}`,
    record_id: recordId,
    slice_id: sliceId
  };
}

function exactIdentityStringMatches(value, expected) {

  return typeof value === "string" && value === expected;
}

function selectedSliceIdValueMatches(value, expectedSliceId) {
  return expectedSliceId === null
    ? value === null
    : exactIdentityStringMatches(value, expectedSliceId);
}

function selectedUnitIdentityMatches(value, expected) {
  if (!isObject(value) || !expected) return false;
  const kind = requiredDataProperty(value, "kind");
  const address = requiredDataProperty(value, "address");
  const recordId = requiredDataProperty(value, "record_id");
  const sliceId = requiredDataProperty(value, "slice_id");
  if ([kind, address, recordId, sliceId].includes(INVALID_DATA_PROPERTY)) return false;
  const selectedSliceId = ownDataProperty(value, "selected_slice_id");
  if (selectedSliceId.value === INVALID_DATA_PROPERTY) return false;
  return (
    kind === expected.kind &&
    exactIdentityStringMatches(address, expected.address) &&
    exactIdentityStringMatches(recordId, expected.record_id) &&
    (expected.slice_id === null
      ? sliceId === null
      : exactIdentityStringMatches(sliceId, expected.slice_id)) &&
    (!selectedSliceId.present ||
      selectedSliceIdValueMatches(selectedSliceId.value, expected.slice_id))
  );
}

function optionalPathIdentityMatches(value, expected) {
  for (const field of ["relativePath", "source_path_relative"]) {
    const property = ownDataProperty(value, field);
    if (!property.present) continue;
    if (
      property.value === INVALID_DATA_PROPERTY ||
      typeof property.value !== "string" ||
      property.value !== property.value.trim() ||
      recordIdFromReadPath(property.value) !== expected.record_id
    ) {
      return false;
    }
  }
  return true;
}

function directIdentityCarriersMatch(value, expected) {
  if (!isObject(value) || !expected) return false;
  const recordId = ownDataProperty(value, "record_id");
  const selectedSliceId = ownDataProperty(value, "selected_slice_id");
  const sliceId = ownDataProperty(value, "slice_id");
  const address = ownDataProperty(value, "address");
  for (const property of [recordId, selectedSliceId, sliceId, address]) {
    if (property.value === INVALID_DATA_PROPERTY) return false;
  }
  if (recordId.present && !exactIdentityStringMatches(recordId.value, expected.record_id)) {
    return false;
  }
  if (selectedSliceId.present && !selectedSliceIdValueMatches(selectedSliceId.value, expected.slice_id)) {
    return false;
  }
  if (sliceId.present) {
    if (
      expected.slice_id === null
        ? sliceId.value !== null
        : !exactIdentityStringMatches(sliceId.value, expected.slice_id)
    ) {
      return false;
    }
  }
  if (address.present && !exactIdentityStringMatches(address.value, expected.address)) {
    return false;
  }
  return optionalPathIdentityMatches(value, expected);
}

function validateRecognizedIdentityTree(roots, expected) {
  const stack = [];
  for (let index = 0; index < roots.length; index += 1) {
    stack.push({ value: roots[index], boundary: true, deep: false, root: true, depth: 0 });
  }
  const seen = new WeakSet();
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    const value = current.value;
    if (!value || typeof value !== "object" || utilTypes.isProxy(value)) return false;
    if (current.depth > MAX_IDENTITY_PROJECTION_DEPTH || nodes >= MAX_IDENTITY_PROJECTION_NODES) {
      return false;
    }
    if (seen.has(value)) return false;
    seen.add(value);
    nodes += 1;

    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        const entry = ownDataProperty(value, String(index));
        if (!entry.present || entry.value === INVALID_DATA_PROPERTY) return false;
        if (entry.value && typeof entry.value === "object") {
          stack.push({
            value: entry.value,
            boundary: true,
            deep: current.deep,
            root: false,
            depth: current.depth + 1
          });
        }
      }
      continue;
    }

    if (current.boundary && !directIdentityCarriersMatch(value, expected)) return false;
    for (const field of IDENTITY_CHILD_FIELDS) {
      const child = ownDataProperty(value, field);
      if (!child.present) continue;
      if (
        child.value === INVALID_DATA_PROPERTY ||
        !selectedUnitIdentityMatches(child.value, expected)
      ) {
        return false;
      }
      stack.push({
        value: child.value,
        boundary: true,
        deep: false,
        root: false,
        depth: current.depth + 1
      });
    }

    const graphRef = ownDataProperty(value, "graph_impact_summary_ref");
    if (graphRef.present) {
      if (graphRef.value === INVALID_DATA_PROPERTY || !isObject(graphRef.value)) return false;
      stack.push({
        value: graphRef.value,
        boundary: true,
        deep: true,
        root: false,
        depth: current.depth + 1
      });
    }

    if (current.root) {
      for (const field of PROJECTED_IDENTITY_CONTAINER_FIELDS) {
        const child = ownDataProperty(value, field);
        if (!child.present) continue;
        if (child.value === INVALID_DATA_PROPERTY) return false;
        if (child.value && typeof child.value === "object") {
          stack.push({
            value: child.value,
            boundary: true,
            deep: field !== "sections",
            root: false,
            sections: field === "sections",
            depth: current.depth + 1
          });
        }
      }
      for (const field of PROJECTED_GRAPH_CONTAINER_FIELDS) {
        const child = ownDataProperty(value, field);
        if (!child.present) continue;
        if (child.value === INVALID_DATA_PROPERTY) return false;
        if (child.value && typeof child.value === "object") {
          stack.push({
            value: child.value,
            boundary: true,
            deep: false,
            root: false,
            depth: current.depth + 1
          });
        }
      }
    }

    if (current.deep) {
      const descriptors = Object.getOwnPropertyDescriptors(value);
      for (const [field, descriptor] of Object.entries(descriptors)) {
        if (!descriptor.enumerable) continue;
        if (!Object.hasOwn(descriptor, "value")) return false;
        if (IDENTITY_CHILD_FIELDS.includes(field) || field === "graph_impact_summary_ref") {
          continue;
        }
        if (descriptor.value && typeof descriptor.value === "object") {
          stack.push({
            value: descriptor.value,
            boundary: true,
            deep: true,
            root: false,
            depth: current.depth + 1
          });
        }
      }
    } else if (current.sections) {
      const agentNotes = ownDataProperty(value, "agent_notes");
      if (agentNotes.value === INVALID_DATA_PROPERTY) return false;
      if (agentNotes.present && agentNotes.value && typeof agentNotes.value === "object") {
        stack.push({
          value: agentNotes.value,
          boundary: true,
          deep: true,
          root: false,
          depth: current.depth + 1
        });
      }
    }
  }
  return true;
}

function validateCompletedProjectionIdentity(value, expected) {
  const stack = [{ value, depth: 0 }];
  const seen = new WeakSet();
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    const entry = current.value;
    if (!entry || typeof entry !== "object" || utilTypes.isProxy(entry)) return false;
    if (current.depth > MAX_IDENTITY_PROJECTION_DEPTH || nodes >= MAX_IDENTITY_PROJECTION_NODES) {
      return false;
    }
    if (seen.has(entry)) return false;
    seen.add(entry);
    nodes += 1;

    if (!Array.isArray(entry) && !directIdentityCarriersMatch(entry, expected)) return false;
    for (const field of IDENTITY_CHILD_FIELDS) {
      const identity = ownDataProperty(entry, field);
      if (!identity.present) continue;
      if (
        identity.value === INVALID_DATA_PROPERTY ||
        !selectedUnitIdentityMatches(identity.value, expected)
      ) {
        return false;
      }
    }

    const descriptors = Object.getOwnPropertyDescriptors(entry);
    for (const field of Object.keys(descriptors)) {
      const descriptor = descriptors[field];
      if (!descriptor.enumerable) continue;
      if (!Object.hasOwn(descriptor, "value")) return false;
      const child = descriptor.value;
      if (!child || typeof child !== "object") continue;
      if (utilTypes.isProxy(child)) return false;
      stack.push({ value: child, depth: current.depth + 1 });
    }
  }
  return true;
}

function selectedEnvelopeIdentityMatches(value, expected) {
  if (!isObject(value) || !expected) return false;
  const recordId = requiredDataProperty(value, "record_id");
  if (
    recordId === INVALID_DATA_PROPERTY ||
    !exactIdentityStringMatches(recordId, expected.record_id) ||
    !directIdentityCarriersMatch(value, expected)
  ) {
    return false;
  }
  const roots = [value];
  const summary = ownDataProperty(value, "summary");
  if (summary.present && summary.value !== null) {
    if (summary.value === INVALID_DATA_PROPERTY || !isObject(summary.value)) return false;
    roots.push(summary.value);
  }
  return validateRecognizedIdentityTree(roots, expected);
}

function projectSelectedSummaryResult(fullSummaryResult, requestedIdentity) {
  if (!selectedEnvelopeIdentityMatches(fullSummaryResult, requestedIdentity)) return null;
  const selectedUnitSourceProperty = ownDataProperty(fullSummaryResult, "selected_unit");
  if (
    !selectedUnitSourceProperty.present ||
    selectedUnitSourceProperty.value === INVALID_DATA_PROPERTY ||
    !selectedUnitIdentityMatches(selectedUnitSourceProperty.value, requestedIdentity)
  ) {
    return null;
  }
  const selectedUnit = projectSelectedUnit(selectedUnitSourceProperty.value);

  const summaryProperty = ownDataProperty(fullSummaryResult, "summary");
  let selectedUnitSource = null;
  if (summaryProperty.present && summaryProperty.value !== null) {
    if (summaryProperty.value === INVALID_DATA_PROPERTY || !isObject(summaryProperty.value)) {
      return null;
    }
    const selectedSummaryProperty = ownDataProperty(
      summaryProperty.value,
      "selected_unit_summary"
    );
    if (selectedSummaryProperty.present) {
      if (
        selectedSummaryProperty.value === INVALID_DATA_PROPERTY ||
        (selectedSummaryProperty.value !== null && !isObject(selectedSummaryProperty.value))
      ) {
        return null;
      }
      selectedUnitSource = selectedSummaryProperty.value;
    }
  }

  if (selectedUnitSource !== null) {
    const id = requiredDataProperty(selectedUnitSource, "id");
    if (
      id === INVALID_DATA_PROPERTY ||
      !exactIdentityStringMatches(id, requestedIdentity.slice_id) ||
      !validateRecognizedIdentityTree([selectedUnitSource], requestedIdentity)
    ) {
      return null;
    }
  }
  const selectedUnitSummary = selectedUnitSource === null
    ? null
    : projectSelectedWorkRecordUnit(selectedUnitSource);
  if (selectedUnitSource !== null && selectedUnitSummary === null) return null;
  const recordId = requiredDataProperty(fullSummaryResult, "record_id");
  const valid = ownDataProperty(fullSummaryResult, "valid");
  const result = {
    record_id: recordId,
    valid: valid.value === true && selectedUnitSummary !== null,
    selected_unit: selectedUnit,
    summary: selectedUnitSummary
  };
  return validateCompletedProjectionIdentity(result, requestedIdentity) ? result : null;
}

function copyGraphScalar(result, source, field, predicate = () => true) {
  const property = ownDataProperty(source, field);
  if (!property.present) return true;
  if (property.value === INVALID_DATA_PROPERTY || !predicate(property.value)) return false;
  result[field] = property.value;
  return true;
}

function projectGraphStringList(source, field) {
  const property = ownDataProperty(source, field);
  if (!property.present) return { valid: true, present: false, value: undefined };
  if (
    property.value === INVALID_DATA_PROPERTY ||
    utilTypes.isProxy(property.value) ||
    !Array.isArray(property.value)
  ) {
    return { valid: false, present: true, value: undefined };
  }
  const value = [];
  for (let index = 0; index < property.value.length; index += 1) {
    const entry = ownDataProperty(property.value, String(index));
    if (!entry.present || entry.value === INVALID_DATA_PROPERTY || typeof entry.value !== "string") {
      return { valid: false, present: true, value: undefined };
    }
    value.push(entry.value);
  }
  return { valid: true, present: true, value };
}

function projectGraphState(value) {
  if (!isObject(value)) return null;
  const result = {};
  for (const field of [
    "graph_available",
    "dirty_state",
    "staleness",
    "edge_source",
    "dirty_graph_mode",
    "graph_schema_version",
    "unavailable_path_count"
  ]) {
    if (!copyGraphScalar(result, value, field, (entry) =>
      entry === null || ["string", "number", "boolean"].includes(typeof entry)
    )) {
      return null;
    }
  }
  return result;
}

function projectNumericCounts(value) {
  if (!isObject(value)) return null;
  const result = {};
  for (const [field, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable) continue;
    if (!Object.hasOwn(descriptor, "value")) return null;
    if (typeof descriptor.value === "number" && Number.isFinite(descriptor.value)) {
      result[field] = descriptor.value;
    }
  }
  return result;
}

function projectDegradedState(value) {
  if (!isObject(value)) return null;
  const result = {};
  for (const field of ["kind", "code", "reason_code", "message"]) {
    if (!copyGraphScalar(result, value, field, (entry) =>
      entry === null || (typeof entry === "string" && entry.length <= 1000)
    )) {
      return null;
    }
  }
  return result;
}

function copyGraphIdentityFields(result, source) {
  for (const field of ["record_id", "slice_id", "selected_slice_id", "address"]) {
    if (!copyGraphScalar(result, source, field, (entry) => entry === null || typeof entry === "string")) {
      return false;
    }
  }
  for (const field of ["unit", "identity"]) {
    const property = ownDataProperty(source, field);
    if (!property.present) continue;
    if (property.value === INVALID_DATA_PROPERTY) return false;
    const identity = projectSelectedUnit(property.value);
    if (!identity) return false;
    result[field] = identity;
  }
  return true;
}

function projectGraphImpactSummaryRef(value) {
  if (!isObject(value)) return null;
  const result = {};
  if (!copyGraphIdentityFields(result, value)) return null;
  for (const field of [
    "kind",
    "replay_detail_available",
    "query_kind",
    "source_record_digest",
    "generated_at",
    "invalid_path_count",
    "raw_evidence_digest",
    "graph_entry_digest"
  ]) {
    if (!copyGraphScalar(result, value, field, (entry) =>
      entry === null || ["string", "number", "boolean"].includes(typeof entry)
    )) {
      return null;
    }
  }
  for (const field of ["input_paths", "validated_paths"]) {
    const projected = projectGraphStringList(value, field);
    if (!projected.valid) return null;
    if (projected.present) result[field] = projected.value;
  }
  for (const [field, projector] of [
    ["graph_state", projectGraphState],
    ["counts", projectNumericCounts],
    ["degraded_state", projectDegradedState]
  ]) {
    const property = ownDataProperty(value, field);
    if (!property.present) continue;
    if (property.value === INVALID_DATA_PROPERTY) return null;
    const projected = projector(property.value);
    if (projected === null) return null;
    result[field] = projected;
  }
  return result;
}

function projectPublicGraphEntry(value, envelope) {
  if (!isObject(value)) return null;
  const result = {};
  if (!copyGraphIdentityFields(result, value)) return null;
  for (const field of [
    "replay_detail_available",
    "query_kind",
    "source_record_digest",
    "generated_at",
    "invalid_path_count",
    "raw_evidence_digest",
    "graph_entry_digest"
  ]) {
    if (!copyGraphScalar(result, value, field, (entry) =>
      entry === null || ["string", "number", "boolean"].includes(typeof entry)
    )) {
      return null;
    }
  }
  if (!Object.hasOwn(result, "generated_at")) {
    const generatedAt = ownDataProperty(envelope, "generated_at");
    if (generatedAt.value === INVALID_DATA_PROPERTY) return null;
    if (generatedAt.present && (generatedAt.value === null || typeof generatedAt.value === "string")) {
      result.generated_at = generatedAt.value;
    }
  }
  for (const field of ["input_paths", "validated_paths"]) {
    const projected = projectGraphStringList(value, field);
    if (!projected.valid) return null;
    if (projected.present) result[field] = projected.value;
  }
  for (const [field, projector] of [
    ["graph_state", projectGraphState],
    ["counts", projectNumericCounts],
    ["degraded_state", projectDegradedState]
  ]) {
    const property = ownDataProperty(value, field);
    if (!property.present) continue;
    if (property.value === INVALID_DATA_PROPERTY) return null;
    const projected = projector(property.value);
    if (projected === null) return null;
    result[field] = projected;
  }
  const graphRef = ownDataProperty(value, "graph_impact_summary_ref");
  if (graphRef.present) {
    if (graphRef.value === INVALID_DATA_PROPERTY) return null;
    const projected = projectGraphImpactSummaryRef(graphRef.value);
    if (projected === null) return null;
    result.graph_impact_summary_ref = projected;
  }
  return result;
}

function projectSelectedSliceReadResult(compactResult, requestedIdentity) {
  const format = requiredDataProperty(compactResult, "format");
  if (format !== "json-work-record" && format !== "graph-evidence-sidecar") return null;
  if (
    !selectedEnvelopeIdentityMatches(compactResult, requestedIdentity) ||
    !selectedSliceIdValueMatches(
      requiredDataProperty(compactResult, "selected_slice_id"),
      requestedIdentity?.slice_id
    )
  ) {
    return null;
  }
  const selectedSlice = requiredDataProperty(compactResult, "selected_slice");
  const selectedSliceFoundValue = requiredDataProperty(compactResult, "selected_slice_found");
  if (typeof selectedSliceFoundValue !== "boolean") return null;
  const selectedSliceFound = selectedSliceFoundValue === true;
  if (selectedSliceFound !== isObject(selectedSlice)) return null;

  if (!selectedSliceFound) return null;
  if (selectedSliceFound) {
    const primaryIdentityMatches = format === "json-work-record"
      ? exactIdentityStringMatches(
          requiredDataProperty(selectedSlice, "id"),
          requestedIdentity.slice_id
        )
      : selectedUnitIdentityMatches(
          requiredDataProperty(selectedSlice, "unit"),
          requestedIdentity
        );
    if (!primaryIdentityMatches || !validateRecognizedIdentityTree([selectedSlice], requestedIdentity)) {
      return null;
    }
  }
  const recordId = requiredDataProperty(compactResult, "record_id");
  const selectedSliceId = requiredDataProperty(compactResult, "selected_slice_id");
  const projectedSlice = !selectedSliceFound
    ? null
    : format === "json-work-record"
      ? projectSelectedWorkRecordUnit(selectedSlice)
      : projectPublicGraphEntry(selectedSlice, compactResult);
  if (selectedSliceFound && projectedSlice === null) return null;
  const result = {
    format,
    record_id: recordId,
    selected_slice_id: selectedSliceId,
    selected_slice: projectedSlice,
    selected_slice_found: selectedSliceFound
  };

  if (format === "json-work-record") {
    result.valid = ownDataProperty(compactResult, "valid").value === true;
  }
  return validateCompletedProjectionIdentity(result, requestedIdentity) ? result : null;
}

function projectSelectedRecordReadResult(compactResult, requestedIdentity) {
  if (
    requiredDataProperty(compactResult, "format") !== "graph-evidence-sidecar" ||
    requiredDataProperty(compactResult, "selected_record") !== true ||
    !selectedEnvelopeIdentityMatches(compactResult, requestedIdentity)
  ) {
    return null;
  }
  const recordEntry = requiredDataProperty(compactResult, "record_entry");
  const recordEntryFoundValue = requiredDataProperty(compactResult, "record_entry_found");
  if (typeof recordEntryFoundValue !== "boolean") return null;
  const recordEntryFound = recordEntryFoundValue === true;
  if (recordEntryFound !== isObject(recordEntry)) return null;
  if (
    recordEntryFound &&
    (!selectedUnitIdentityMatches(requiredDataProperty(recordEntry, "unit"), requestedIdentity) ||
      !validateRecognizedIdentityTree([recordEntry], requestedIdentity))
  ) {
    return null;
  }
  const projectedEntry = recordEntryFound
    ? projectPublicGraphEntry(recordEntry, compactResult)
    : null;
  if (recordEntryFound && projectedEntry === null) return null;
  const result = {
    format: "graph-evidence-sidecar",
    record_id: requiredDataProperty(compactResult, "record_id"),
    selected_record: true,
    record_entry: projectedEntry,
    record_entry_found: recordEntryFound
  };
  return validateCompletedProjectionIdentity(result, requestedIdentity) ? result : null;
}

function projectSelectedReadResult(compactResult, selector) {
  const requestedIdentity = requestedReadIdentity(selector);
  return selector.selected_slice
    ? projectSelectedSliceReadResult(compactResult, requestedIdentity)
    : projectSelectedRecordReadResult(compactResult, requestedIdentity);
}

export async function runWorkRecordSummaryWithCompactGate({
  workspaceRepo,
  workspaceDir,
  args,
  getWorkRecordSummary,
  readSelectedWorkRecordSummary = getWorkRecordSummary,
  readWorkRecordById
}) {
  const normalized = validateAndNormalizeSummarySelector(args);
  const normalizedArgs = normalized.args;
  const selector = normalized.selector;

  if (selector.selected_slice) {
    const pendingSummaryResult = readSelectedWorkRecordSummary({
      dir: workspaceDir,
      ...buildSummaryArgs(normalizedArgs, {
        verbose: true,
        include_full_summary: true
      })
    });
    if (pendingSummaryResult &&
        typeof pendingSummaryResult === "object" &&
        utilTypes.isProxy(pendingSummaryResult)) {
      throwSelectedIdentityError(SUMMARY_TOOL_FAMILY);
    }
    const fullSummaryResult = await pendingSummaryResult;
    const selectedResult = projectSelectedSummaryResult(
      fullSummaryResult,
      requestedSummaryIdentity(selector)
    );
    if (!selectedResult) {
      throwSelectedIdentityError(SUMMARY_TOOL_FAMILY);
    }
    return selectedResult;
  }

  const compactResult = await getWorkRecordSummary({
    dir: workspaceDir,
    ...buildSummaryArgs(normalizedArgs)
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

  const blockedOptions = expensiveOptions(normalizedArgs);
  const fullReadAcknowledged = normalizedArgs.accept_full_read === true;
  const largeUnscopedExpensiveRequest =
    blockedOptions.length > 0 &&
    isLargeOrTracker(compactResult.summary) &&
    !selector.selected_slice &&
    !fullReadAcknowledged;
  const tokenDecision = largeUnscopedExpensiveRequest
    ? validateToken({
        token: normalizeString(normalizedArgs.compact_read_token),
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

  if (blockedOptions.length > 0) {
    return getWorkRecordSummary({
      dir: workspaceDir,
      id: normalizedArgs.id ?? null,
      unit: normalizedArgs.unit ?? null,
      pathInput: normalizedArgs.path ?? null,
      verbose: Boolean(normalizedArgs.verbose),
      include_full_summary: Boolean(normalizedArgs.include_full_summary)
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
  const normalized = validateAndNormalizeReadSelector(args, toolFamily);
  const normalizedArgs = normalized.args;
  const selector = normalized.selector;
  const pendingCompactResult = readCompact({
    ...buildReadArgs(normalizedArgs),
    dir: workspaceDir
  });
  if (pendingCompactResult &&
      typeof pendingCompactResult === "object" &&
      utilTypes.isProxy(pendingCompactResult)) {
    throwSelectedIdentityError(toolFamily);
  }
  const compactResult = await pendingCompactResult;

  if (selector.selected_detail) {
    const selectedResult = projectSelectedReadResult(compactResult, selector);
    if (!selectedResult) {
      throwSelectedIdentityError(toolFamily);
    }
    return selectedResult;
  }

  if (compactResult?.format !== "json-work-record" || !compactResult.record_id) {
    if (expensiveReadOptions(normalizedArgs).length > 0) {
      return readExpensive({
        ...normalizedArgs,
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

  const blockedOptions = expensiveReadOptions(normalizedArgs);
  const fullReadAcknowledged = normalizedArgs.accept_full_read === true;
  const largeUnscopedExpensiveRequest =
    blockedOptions.length > 0 &&
    isLargeOrTrackerReadResult(compactResult, loadedRecord) &&
    !selector.selected_detail &&
    !fullReadAcknowledged;
  const tokenDecision = largeUnscopedExpensiveRequest
    ? validateToken({
        token: normalizeString(normalizedArgs.compact_read_token),
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
      args: normalizedArgs
    });
  }

  if (blockedOptions.length > 0 && !tokenDecision.accepted) {
    return buildReadRefusal({
      compactResult,
      blockedOptions,
      tokenDecision,
      toolFamily,
      args: normalizedArgs
    });
  }

  if (blockedOptions.length > 0) {
    return readExpensive({
      ...normalizedArgs,
      dir: workspaceDir
    });
  }

  compactResult.compact_read = buildReadContinuationMetadata({
    compactResult,
    compactToken,
    toolFamily,
    args: normalizedArgs,
    selector
  });
  return compactResult;
}
