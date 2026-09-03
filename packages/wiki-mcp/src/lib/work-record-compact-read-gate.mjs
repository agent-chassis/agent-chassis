import { types as utilTypes } from "node:util";
import { RUNTIME_BLOCKER_CODES } from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
import { SLICE_ID_PATTERN } from "@agent-chassis/wiki-core/src/lib/work-record-schema-constants.mjs";
import {
  parseWorkRecordSummaryUnit,
  WORK_RECORD_SLICE_PAGE_MAX_LIMIT,
  workRecordDetailSelectorSupported
} from "@agent-chassis/wiki-core/src/lib/work-record-summary.mjs";

import {
  classifyReadPagePath,
  extractWorkRecordReadPath,
  isGraphEvidenceReadPath,
  isSafeWorkspaceRelativePath,
  isWorkRecordReadPath,
  projectSelectedReadResult,
  projectSelectedSummaryResult,
  requestedSummaryIdentity,
  throwSelectedIdentityError,
  WORK_RECORD_ID_PATTERN,
  WORK_RECORD_ID_PREFIX_PATTERN
} from "./work-record-selected-detail-projection.mjs";

import {
  buildContinuationMetadata,
  buildRefusal,
  GET_RECORD_TOOL_FAMILY,
  READ_PAGE_TOOL_FAMILY,
  responseSizeMetadata,
  runSelectedRecordContractFields,
  runSliceEnumeration,
  SUMMARY_TOOL_FAMILY
} from "./work-record-compact-read-continuation.mjs";
import { buildNextCall } from "./mcp-response.mjs";

export { workRecordDetailSelectorSchemaShape } from "./work-record-compact-read-continuation.mjs";

const COMPACT_READ_TOKEN_ACCEPTED = "compact_read_token_accepted";
const COMPACT_READ_NOT_REQUIRED = "compact_read_not_required";

const COMPACT_READ_ACK_SCHEMA_VERSION = "work-record-compact-read-ack.v1";
const SELECTOR_REFUSAL_SCHEMA_VERSION = "work-record-selector-refusal.v1";
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
  ACCEPT_FULL_READ_INVALID: "selector_accept_full_read_invalid",
  SLICE_PAGE_INVALID: "selector_slice_page_invalid"
});

const SLICE_PAGE_ARGUMENT_FIELDS = Object.freeze([
  "slice_offset",
  "slice_limit",
  "slice_status",
  "expected_source_digest"
]);
const LARGE_RECORD_SLICE_THRESHOLD = 8;
const LARGE_RECORD_BYTE_THRESHOLD = 32768;

const COMPACT_READ_ACK_LIFETIME_MS = 15 * 60 * 1000;

const MAX_COMPACT_READ_ACK_ENCODED_LENGTH = 4096;
const COMPACT_READ_ACK_FIELDS = Object.freeze([
  "schema_version",
  "tool_family",
  "workspace_repo",
  "record_id",
  "selector",
  "source_digest",
  "issued_at_ms",
  "expires_at_ms"
]);
const BASE64URL_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;
const SUMMARY_ARGUMENT_FIELDS = new Set([
  "repo",
  "id",
  "unit",
  "path",
  "verbose",
  "include_full_summary",
  "accept_full_read",
  "compact_read_token",
  ...SLICE_PAGE_ARGUMENT_FIELDS
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
  "compact_read_token",
  ...SLICE_PAGE_ARGUMENT_FIELDS
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

function encodeCompactReadAck(payload) {
  return base64UrlEncode(payload);
}

function decodeCompactReadAck(token) {
  if (typeof token !== "string") return null;
  if (token.length === 0 || token.length > MAX_COMPACT_READ_ACK_ENCODED_LENGTH) return null;
  if (!BASE64URL_SEGMENT_PATTERN.test(token)) return null;
  const decoded = base64UrlDecodeJson(token);
  return isObject(decoded) ? decoded : null;
}

function sliceStatusFilterIsWellFormed(value) {
  const entries = Array.isArray(value) ? value : [value];
  if (entries.length === 0) return true;
  return entries.every((entry) => typeof entry === "string" && entry.trim().length > 0);
}

function getSlicePageSelectorValidationIssues(args, toolFamily) {
  const issues = [];
  if (hasOwn(args, "slice_offset") &&
      !(Number.isInteger(args.slice_offset) && args.slice_offset >= 0)) {
    issues.push(selectorIssue(
      SELECTOR_REFUSAL_CODES.SLICE_PAGE_INVALID,
      ["slice_offset"],
      `${toolFamily} slice_offset must be an integer of 0 or more`
    ));
  }
  if (hasOwn(args, "slice_limit") &&
      !(Number.isInteger(args.slice_limit) && args.slice_limit >= 1)) {
    issues.push(selectorIssue(
      SELECTOR_REFUSAL_CODES.SLICE_PAGE_INVALID,
      ["slice_limit"],
      `${toolFamily} slice_limit must be an integer of 1 or more; a limit above the ` +
        `server maximum of ${WORK_RECORD_SLICE_PAGE_MAX_LIMIT} clamps and the applied limit is reported`
    ));
  }
  if (hasOwn(args, "slice_status") && !sliceStatusFilterIsWellFormed(args.slice_status)) {
    issues.push(selectorIssue(
      SELECTOR_REFUSAL_CODES.SLICE_PAGE_INVALID,
      ["slice_status"],
      `${toolFamily} slice_status must be a non-empty status string or an array of them`
    ));
  }
  if (hasOwn(args, "expected_source_digest") && !normalizeString(args.expected_source_digest)) {
    issues.push(selectorIssue(
      SELECTOR_REFUSAL_CODES.SLICE_PAGE_INVALID,
      ["expected_source_digest"],
      `${toolFamily} expected_source_digest must be the non-empty source_digest a prior page returned`
    ));
  }
  if (hasOwn(args, "expected_source_digest") &&
      !SLICE_PAGE_ARGUMENT_FIELDS.some((field) => field !== "expected_source_digest" && hasOwn(args, field))) {
    issues.push(selectorIssue(
      SELECTOR_REFUSAL_CODES.SLICE_PAGE_INVALID,
      ["expected_source_digest"],
      `${toolFamily} expected_source_digest continues a slice enumeration and requires slice_offset, ` +
        "slice_limit, or slice_status"
    ));
  }
  return issues;
}

function slicePageRequested(args) {
  return SLICE_PAGE_ARGUMENT_FIELDS.some((field) => hasOwn(args, field));
}

function normalizeSlicePageRequest(args) {
  if (!slicePageRequested(args)) return null;
  const status = hasOwn(args, "slice_status")
    ? (Array.isArray(args.slice_status) ? args.slice_status : [args.slice_status])
        .map((entry) => entry.trim())
    : null;
  return {
    offset: hasOwn(args, "slice_offset") ? args.slice_offset : 0,
    limit: hasOwn(args, "slice_limit") ? args.slice_limit : null,
    status,
    expected_source_digest: hasOwn(args, "expected_source_digest")
      ? normalizeString(args.expected_source_digest)
      : null
  };
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
    if (hasOwn(args, unsupported) &&
        !workRecordDetailSelectorSupported(SUMMARY_TOOL_FAMILY, unsupported)) {
      issues.push(selectorIssue(
        SELECTOR_REFUSAL_CODES.UNSUPPORTED,
        [unsupported],
        `${SUMMARY_TOOL_FAMILY} does not support the ${unsupported} selector`
      ));
    }
  }
  if (hasOwn(args, "selected_record") && args.selected_record !== true) {
    issues.push(selectorIssue(
      SELECTOR_REFUSAL_CODES.SELECTED_RECORD_INVALID,
      ["selected_record"],
      `${SUMMARY_TOOL_FAMILY} selected_record must be literal true when supplied`
    ));
  }
  if (hasOwn(args, "selected_record") && slicePageRequested(args)) {
    issues.push(selectorIssue(
      SELECTOR_REFUSAL_CODES.CONFLICT,
      ["selected_record"],
      `${SUMMARY_TOOL_FAMILY} selected_record and slice enumeration are mutually exclusive`
    ));
  }
  if (hasOwn(args, "accept_full_read") && args.accept_full_read !== true) {
    issues.push(selectorIssue(
      SELECTOR_REFUSAL_CODES.ACCEPT_FULL_READ_INVALID,
      ["accept_full_read"],
      `${SUMMARY_TOOL_FAMILY} accept_full_read must be literal true when supplied`
    ));
  }
  issues.push(...getSlicePageSelectorValidationIssues(args, SUMMARY_TOOL_FAMILY));

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
    } else if (selectorField === "unit" && !parseWorkRecordSummaryUnit(selected)) {
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

    const selectedSliceUnit =
      selectorField === "unit" && parseWorkRecordSummaryUnit(selected)?.kind === "slice";
    if (slicePageRequested(args) && selectedSliceUnit) {
      issues.push(selectorIssue(
        SELECTOR_REFUSAL_CODES.CONFLICT,
        ["slice_offset"],
        `${SUMMARY_TOOL_FAMILY} slice enumeration and a selected slice unit are mutually exclusive`
      ));
    }
    if (hasOwn(args, "selected_record") && selectedSliceUnit) {
      issues.push(selectorIssue(
        SELECTOR_REFUSAL_CODES.CONFLICT,
        ["selected_record"],
        `${SUMMARY_TOOL_FAMILY} selected_record and a selected slice unit are mutually exclusive`
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
    ? parseWorkRecordSummaryUnit(selected)
    : null;
  return {
    args: normalizedArgs,
    selector: {
      id,
      unit,
      path,
      selected,
      selected_slice: selectedAddress?.kind === "slice",
      selected_record: args.selected_record === true,
      slice_page: normalizeSlicePageRequest(args)
    }
  };
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
  if (toolFamily === GET_RECORD_TOOL_FAMILY) {
    issues.push(...getSlicePageSelectorValidationIssues(args, toolFamily));
    if (slicePageRequested(args) && hasOwn(args, "selected_slice")) {
      issues.push(selectorIssue(
        SELECTOR_REFUSAL_CODES.CONFLICT,
        ["slice_offset"],
        `${GET_RECORD_TOOL_FAMILY} slice enumeration and selected_slice are mutually exclusive`
      ));
    }
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
      hasOwn(args, "selected_record")
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
    readPagePath.kind !== "graph_evidence" &&
    !selected.endsWith(".json")
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
      selected_detail: Boolean(selectedSlice || selectedRecord),
      slice_page: toolFamily === GET_RECORD_TOOL_FAMILY ? normalizeSlicePageRequest(args) : null
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

function isLargePayload(value) {
  if (value === undefined) {
    return false;
  }
  return responseSizeMetadata(value).bytes >= LARGE_RECORD_BYTE_THRESHOLD;
}

function isLargeOrTracker(summary) {
  return summary?.work_kind === "tracker" || Number(summary?.slice_count ?? 0) > LARGE_RECORD_SLICE_THRESHOLD;
}

function isLargeOrTrackerReadResult(result, loadedRecord = null) {
  return (
    result?.format === "json-kind-record" ||
    (result?.format === "json-work-record" &&
    (
      result?.work_kind === "tracker" ||
      Number(result?.slice_counts?.total ?? 0) > LARGE_RECORD_SLICE_THRESHOLD ||
      isLargePayload(result) ||
      isLargePayload(loadedRecord?.record)
    ))
  );
}

function kindRecordCompactMembers(result, record) {
  const members = [];
  if (result?.record_id === record?.id) members.push("id");
  if (result?.record_kind === record?.record_kind) members.push("record_kind");
  if (Object.hasOwn(record, "title") && result?.title === record.title) members.push("title");
  return members.sort();
}

function kindRecordSourceMembers(record) {
  const topLevelMembers = Object.keys(record);
  const sectionMembers = isObject(record.sections)
    ? Object.keys(record.sections).map((member) => `sections.${member}`)
    : [];
  return [...topLevelMembers, ...sectionMembers].sort();
}

function projectKindRecordCompactDisclosure(result) {
  if (result?.format !== "json-kind-record" || !isObject(result.record)) return null;
  const sourceRecord = result.record;
  const sourceMembers = kindRecordSourceMembers(sourceRecord);
  const compactMembers = kindRecordCompactMembers(result, sourceRecord);
  const compactMemberSet = new Set(compactMembers);
  const omittedMembers = sourceMembers.filter((member) => !compactMemberSet.has(member));
  const accountedMembers = [...compactMembers, ...omittedMembers].sort();
  const disclosedMembers = [...compactMembers];
  const recoveredMembers = [...sourceMembers];
  const compactResult = { ...result };
  delete compactResult.record;
  return {
    compactResult,
    sourceRecord,
    memberLedger: {
      source_members: sourceMembers,
      compact_members: compactMembers,
      omitted_members: omittedMembers,
      accounted_members: accountedMembers,
      disclosed_members: disclosedMembers,
      recovered_members: recoveredMembers,
      source_member_count: sourceMembers.length,
      compact_member_count: compactMembers.length,
      omitted_member_count: omittedMembers.length,
      accounted_member_count: accountedMembers.length,
      disclosed_member_count: disclosedMembers.length,
      recovered_member_count: recoveredMembers.length
    }
  };
}

function kindRecordRecoveryCall(toolFamily, compactResult) {
  const identity = toolFamily === READ_PAGE_TOOL_FAMILY
    ? { path: compactResult.relativePath }
    : { id: compactResult.record_id };
  return buildNextCall({
    tool: toolFamily,
    arguments: { ...identity, include_record: true, accept_full_read: true },
    recommended: true
  });
}

function buildKindRecordContinuation({
  toolFamily,
  compactResult,
  compactToken,
  selector,
  args,
  memberLedger
}) {
  const continuation = buildContinuationMetadata({
    toolFamily,
    compactResult,
    compactToken,
    selector,
    args
  });
  const omittedMembers = memberLedger.omitted_member_count;
  return {
    ...continuation,
    omitted_detail_counts: {
      ...continuation.omitted_detail_counts,
      record_members: omittedMembers
    },
    detail_available_via: ["accept_full_read"],
    selected_resources: {
      type: "canonical_record",
      id: compactResult.record_id,
      record_kind: compactResult.record_kind,
      selection_reason: "compact_read_compact_first_scope"
    },
    next_calls: [kindRecordRecoveryCall(toolFamily, compactResult)],
    next_calls_coverage: {
      omitted_record_members: omittedMembers,
      omitted_record_members_addressed: omittedMembers,
      omitted_record_members_unaddressed: 0,
      complete: true
    },
    member_ledger: memberLedger
  };
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
  return encodeCompactReadAck({
    schema_version: COMPACT_READ_ACK_SCHEMA_VERSION,
    tool_family: toolFamily,
    workspace_repo: workspaceRepo,
    record_id: recordId,
    selector,
    source_digest: sourceDigest,
    issued_at_ms: now,
    expires_at_ms: now + COMPACT_READ_ACK_LIFETIME_MS
  });
}

function malformedAck() {
  return { accepted: false, reason_code: RUNTIME_BLOCKER_CODES.COMPACT_READ_TOKEN_MALFORMED };
}

function ackShapeIsWellFormed(decoded) {
  const keys = Object.keys(decoded);
  if (keys.length !== COMPACT_READ_ACK_FIELDS.length) return false;
  for (const field of COMPACT_READ_ACK_FIELDS) {
    if (!Object.hasOwn(decoded, field)) return false;
  }
  for (const field of ["schema_version", "tool_family", "workspace_repo", "record_id", "selector"]) {
    if (typeof decoded[field] !== "string") return false;
  }
  if (decoded.source_digest !== null && typeof decoded.source_digest !== "string") return false;
  if (!Number.isInteger(decoded.issued_at_ms) || !Number.isInteger(decoded.expires_at_ms)) return false;
  if (decoded.expires_at_ms - decoded.issued_at_ms !== COMPACT_READ_ACK_LIFETIME_MS) return false;
  return true;
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
  const decoded = decodeCompactReadAck(token);
  if (!decoded || !ackShapeIsWellFormed(decoded)) {
    return malformedAck();
  }
  if (decoded.schema_version !== COMPACT_READ_ACK_SCHEMA_VERSION) {
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

  if (decoded.issued_at_ms > now) {
    return malformedAck();
  }
  if (now > decoded.expires_at_ms) {
    return { accepted: false, reason_code: RUNTIME_BLOCKER_CODES.COMPACT_READ_TOKEN_EXPIRED };
  }
  return { accepted: true, reason_code: COMPACT_READ_TOKEN_ACCEPTED };
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

  const selectedRecordId =
    parseWorkRecordSummaryUnit(selector.selected)?.record_id ??
    extractWorkRecordReadPath(selector.selected)?.record_id ??
    selector.selected;

  if (selector.slice_page) {
    return runSliceEnumeration({
      toolFamily: SUMMARY_TOOL_FAMILY,
      workspaceDir,
      recordId: selectedRecordId,
      request: selector.slice_page,
      readWorkRecordById
    });
  }

  if (selector.selected_record) {
    return runSelectedRecordContractFields({
      toolFamily: SUMMARY_TOOL_FAMILY,
      workspaceDir,
      recordId: selectedRecordId,
      readWorkRecordById
    });
  }

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
    return buildRefusal({
      toolFamily: SUMMARY_TOOL_FAMILY,
      compactResult,
      blockedOptions,
      tokenDecision: refusalDecision,
      selector,
      args: normalizedArgs,
      record: loadedRecord?.record ?? null
    });
  }

  if (blockedOptions.length > 0 && !tokenDecision.accepted) {
    return buildRefusal({
      toolFamily: SUMMARY_TOOL_FAMILY,
      compactResult,
      blockedOptions,
      tokenDecision,
      selector,
      args: normalizedArgs,
      record: loadedRecord?.record ?? null
    });
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

  compactResult.compact_read = buildContinuationMetadata({
    toolFamily: SUMMARY_TOOL_FAMILY,
    compactResult,
    compactToken,
    selector,
    args: normalizedArgs,
    record: loadedRecord?.record ?? null
  });
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

  if (selector.slice_page) {
    return runSliceEnumeration({
      toolFamily,
      workspaceDir,
      recordId: selector.id,
      request: selector.slice_page,
      readWorkRecordById
    });
  }

  const pendingCompactResult = readCompact({
    ...buildReadArgs(normalizedArgs),
    dir: workspaceDir
  });
  if (pendingCompactResult &&
      typeof pendingCompactResult === "object" &&
      utilTypes.isProxy(pendingCompactResult)) {
    throwSelectedIdentityError(toolFamily);
  }
  const readResult = await pendingCompactResult;
  const kindDisclosure = projectKindRecordCompactDisclosure(readResult);
  const compactResult = kindDisclosure?.compactResult ?? readResult;

  if (selector.selected_detail) {
    const selectedResult = projectSelectedReadResult(compactResult, selector);
    if (!selectedResult) {
      throwSelectedIdentityError(toolFamily);
    }
    return selectedResult;
  }

  if (
    !["json-work-record", "json-kind-record"].includes(compactResult?.format) ||
    !compactResult.record_id
  ) {
    if (expensiveReadOptions(normalizedArgs).length > 0) {
      return readExpensive({
        ...normalizedArgs,
        dir: workspaceDir
      });
    }
    return compactResult;
  }

  const loadedRecord = compactResult.format === "json-kind-record"
    ? {
        record: kindDisclosure?.sourceRecord ?? null,
        source_digest: compactResult.source_digest ?? null
      }
    : (typeof readWorkRecordById === "function"
        ? await readWorkRecordById({ dir: workspaceDir, id: compactResult.record_id })
        : null);
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
    return buildRefusal({
      toolFamily,
      compactResult,
      blockedOptions,
      tokenDecision: refusalDecision,
      selector,
      args: normalizedArgs,
      record: loadedRecord?.record ?? null
    });
  }

  if (blockedOptions.length > 0 && !tokenDecision.accepted) {
    return buildRefusal({
      toolFamily,
      compactResult,
      blockedOptions,
      tokenDecision,
      selector,
      args: normalizedArgs,
      record: loadedRecord?.record ?? null
    });
  }

  if (blockedOptions.length > 0) {
    return readExpensive({
      ...normalizedArgs,
      dir: workspaceDir
    });
  }

  compactResult.compact_read = kindDisclosure
    ? buildKindRecordContinuation({
        toolFamily,
        compactResult,
        compactToken,
        selector,
        args: normalizedArgs,
        memberLedger: kindDisclosure.memberLedger
      })
    : buildContinuationMetadata({
        toolFamily,
        compactResult,
        compactToken,
        selector,
        args: normalizedArgs,
        record: loadedRecord?.record ?? null
      });
  return compactResult;
}
