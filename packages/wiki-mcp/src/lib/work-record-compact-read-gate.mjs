import { ordinaryFieldSelectionIssues, ORDINARY_FIELD_CODES } from "@agent-chassis/wiki-core/src/lib/work-record-ordinary-field-read.mjs";
import { runOrdinaryFieldRead } from "./work-record-ordinary-field-read.mjs";
import { types as utilTypes } from "node:util";
import {
  isWorkRecordFreshness,
  projectWorkRecordFreshness,
  SLICE_ID_PATTERN
} from "@agent-chassis/wiki-core/src/lib/work-record-schema-constants.mjs";
import {
  parseWorkRecordSummaryUnit,
  WORK_RECORD_SLICE_PAGE_MAX_LIMIT,
  workRecordDetailSelectorSupported
} from "@agent-chassis/wiki-core/src/lib/work-record-summary.mjs";
import {
  buildSelectedRecordMemberCall,
  SELECTED_RECORD_MEMBERS_ENTRY_FIELDS,
  SELECTED_RECORD_MEMBERS_MAX,
  selectedRecordMemberSelectorIssues,
  selectedRecordMembersSelectorIssues
} from "@agent-chassis/wiki-core/src/lib/work-record-selected-unit-projection.mjs";
import { buildNextCall } from "./mcp-response.mjs";

import {
  classifyReadPagePath,
  extractWorkRecordReadPath,
  isGraphEvidenceReadPath,
  isSafeWorkspaceRelativePath,
  isWorkRecordReadPath,
  projectSelectedReadResult,
  throwSelectedIdentityError,
  WORK_RECORD_ID_PATTERN,
  WORK_RECORD_ID_PREFIX_PATTERN
} from "./work-record-selected-detail-projection.mjs";

import {
  buildContinuationMetadata,
  GET_RECORD_TOOL_FAMILY,
  READ_PAGE_TOOL_FAMILY,
  runSelectedRecordContractFields,
  runSelectedRecordMember,
  runSliceEnumeration,
  SUMMARY_TOOL_FAMILY
} from "./work-record-compact-read-continuation.mjs";
import { withCanonicalProjectionReadRecovery } from "./work-record-canonical-read-recovery.mjs";
import {
  projectWorkRecordDetailMenu,
  projectWorkRecordNavigation,
  toolVisibleToSession,
  workRecordDetailsSelectorIssues
} from "./work-record-read-navigation.mjs";
import { isOrchestratorPresentationSession } from "./tool-profile.mjs";

export {
  selectedRecordMemberSchema,
  workRecordDetailSelectorSchemaShape
} from "./work-record-compact-read-continuation.mjs";

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
  SLICE_PAGE_INVALID: "selector_slice_page_invalid",
  DETAILS_INVALID: "selector_details_invalid",
  MEMBER_INVALID: "selector_member_invalid"
});

const DETAILS_EXCLUSIVE_FIELDS = Object.freeze([
  "ordinary_field", "selected_record", "slice_offset", "slice_limit", "slice_status",
  "expected_source_digest", "member", "members"
]);

const SLICE_PAGE_ARGUMENT_FIELDS = Object.freeze([
  "slice_offset",
  "slice_limit",
  "slice_status",
  "expected_source_digest"
]);

const MEMBER_EXCLUSIVE_FIELDS = Object.freeze([
  "ordinary_field", "details", "selected_record", "include_body", "members", ...SLICE_PAGE_ARGUMENT_FIELDS
]);
const MEMBERS_EXCLUSIVE_FIELDS = Object.freeze([
  "ordinary_field", "details", "selected_record", "include_body", "member", "entry", "content_reference",
  "slice_offset", "slice_limit", "slice_status"
]);

const MEMBERS_RECOVERY_IDENTITY_FIELDS = Object.freeze([
  "repo", "id", "unit", "path", "selected_slice", "profile", "extensionNamespaces"
]);
const MEMBERS_RECOVERY_CALL_MAX_BYTES = 4096;

const RECORD_PROJECTION_PAGE_KINDS = new Set(["work-records", "issues", "initiatives", "decisions"]);
const SUMMARY_ARGUMENT_FIELDS = new Set([
  "ordinary_field",
  "repo",
  "id",
  "unit",
  "path",
  "details",
  "member",
  "members",
  ...SLICE_PAGE_ARGUMENT_FIELDS
]);

const READ_PAGE_PRIMARY_FIELDS = Object.freeze(["path", "id", "unit"]);
const READ_PAGE_DELEGATED_FIELDS = Object.freeze(["entry", "content_reference"]);
const READ_PAGE_ARGUMENT_FIELDS = new Set([
  "path",
  "id",
  "unit",
  "repo",
  "profile",
  "extensionNamespaces",
  "include_body",
  "selected_slice",
  "selected_record",
  "member",
  "members",
  "expected_source_digest",
  ...READ_PAGE_DELEGATED_FIELDS
]);
const GET_RECORD_ARGUMENT_FIELDS = new Set([
  "id",
  "repo",
  "profile",
  "extensionNamespaces",
  "include_body",
  "selected_slice",
  "member",
  "members",
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
    message: issue.message,
    ...(issue.next_call === undefined ? {} : { next_call: issue.next_call })
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
  if (hasOwn(args, "members")) return issues;
  if (hasOwn(args, "expected_source_digest") && !isWorkRecordFreshness(args.expected_source_digest)) {
    issues.push(selectorIssue(
      SELECTOR_REFUSAL_CODES.SLICE_PAGE_INVALID,
      ["expected_source_digest"],
      `${toolFamily} expected_source_digest must be the 16-hex source_digest a prior read returned`
    ));
  }
  if (hasOwn(args, "expected_source_digest") && !hasOwn(args, "ordinary_field") &&
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
  return SLICE_PAGE_ARGUMENT_FIELDS.some((field) =>
    !((hasOwn(args, "ordinary_field") || hasOwn(args, "members")) && field === "expected_source_digest") &&
    hasOwn(args, field));
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

function getMemberSelectorValidationIssues(args, toolFamily) {
  if (!hasOwn(args, "member")) return [];
  const issues = selectedRecordMemberSelectorIssues(args.member).map((issue) => selectorIssue(
    SELECTOR_REFUSAL_CODES.MEMBER_INVALID,
    ["member", ...issue.path],
    `${toolFamily} ${issue.message}`
  ));
  const conflicting = MEMBER_EXCLUSIVE_FIELDS.filter((field) => hasOwn(args, field));
  if (conflicting.length > 0) {
    issues.push(selectorIssue(
      SELECTOR_REFUSAL_CODES.CONFLICT,
      ["member"],
      `${toolFamily} member is mutually exclusive with ${conflicting.join(", ")}`
    ));
  }
  return issues;
}

function membersRecoveryCall(args, toolFamily) {
  const entryIssues = selectedRecordMembersSelectorIssues(args.members);
  const malformed = new Set(entryIssues.filter((issue) => typeof issue.path[0] === "number")
    .map((issue) => issue.path[0]));
  const kept = Array.isArray(args.members)
    ? args.members.filter((entry, index) => !malformed.has(index)).slice(0, SELECTED_RECORD_MEMBERS_MAX)
      .map((entry) => Object.fromEntries(SELECTED_RECORD_MEMBERS_ENTRY_FIELDS
        .filter((field) => hasOwn(entry, field)).map((field) => [field, entry[field]])))
    : [];
  const recovered = Object.fromEntries(MEMBERS_RECOVERY_IDENTITY_FIELDS
    .filter((field) => hasOwn(args, field)).map((field) => [field, args[field]]));
  recovered.members = kept.length > 0 ? kept : [{ path: [] }];
  if (isWorkRecordFreshness(args.expected_source_digest)) {
    recovered.expected_source_digest = args.expected_source_digest;
  }
  const call = buildNextCall({ tool: toolFamily, arguments: recovered, recommended: true });
  return Buffer.byteLength(JSON.stringify(call), "utf8") <= MEMBERS_RECOVERY_CALL_MAX_BYTES ? call : undefined;
}

function getMembersSelectorValidationIssues(args, toolFamily) {
  if (!hasOwn(args, "members")) return [];
  const issues = selectedRecordMembersSelectorIssues(args.members).map((issue) => selectorIssue(
    SELECTOR_REFUSAL_CODES.MEMBER_INVALID,
    ["members", ...issue.path],
    `${toolFamily} ${issue.message}`
  ));
  if (hasOwn(args, "expected_source_digest") && !isWorkRecordFreshness(args.expected_source_digest)) {
    issues.push(selectorIssue(
      SELECTOR_REFUSAL_CODES.MEMBER_INVALID,
      ["expected_source_digest"],
      `${toolFamily} expected_source_digest must be the 16-hex source_digest a prior read returned`
    ));
  }
  const conflicting = MEMBERS_EXCLUSIVE_FIELDS.filter((field) => hasOwn(args, field));
  if (conflicting.length > 0) {
    issues.push(selectorIssue(
      SELECTOR_REFUSAL_CODES.CONFLICT,
      ["members"],
      `${toolFamily} members is mutually exclusive with ${conflicting.join(", ")}`
    ));
  }
  if (issues.length === 0) return issues;
  const recovery = membersRecoveryCall(args, toolFamily);
  return recovery === undefined ? issues : issues.map((issue) => ({ ...issue, next_call: recovery }));
}

function getReadPageDigestPlacementIssues(args) {
  if (!hasOwn(args, "expected_source_digest") || hasOwn(args, "members")) return [];
  return [selectorIssue(
    SELECTOR_REFUSAL_CODES.CONFLICT,
    ["expected_source_digest"],
    `${READ_PAGE_TOOL_FAMILY} top-level expected_source_digest pins a members batch only; pin a single ` +
      "member read with member.expected_source_digest"
  )];
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
  issues.push(...getSlicePageSelectorValidationIssues(args, SUMMARY_TOOL_FAMILY));
  issues.push(...getMemberSelectorValidationIssues(args, SUMMARY_TOOL_FAMILY));
  issues.push(...getMembersSelectorValidationIssues(args, SUMMARY_TOOL_FAMILY));
  if (hasOwn(args, "details")) {
    for (const issue of workRecordDetailsSelectorIssues(args.details)) {
      issues.push(selectorIssue(SELECTOR_REFUSAL_CODES.DETAILS_INVALID, issue.path,
        `${SUMMARY_TOOL_FAMILY} ${issue.message}`));
    }
    const conflicting = DETAILS_EXCLUSIVE_FIELDS.filter((field) => hasOwn(args, field));
    if (conflicting.length > 0) {
      issues.push(selectorIssue(
        SELECTOR_REFUSAL_CODES.CONFLICT,
        ["details"],
        `${SUMMARY_TOOL_FAMILY} details is mutually exclusive with ${conflicting.join(", ")}`
      ));
    }
  }
  if (hasOwn(args, "ordinary_field")) {
    issues.push(...ordinaryFieldSelectionIssues(args.ordinary_field, args.expected_source_digest));
    if (args.slice_offset > 0 && args.expected_source_digest == null) {
      issues.push(selectorIssue(ORDINARY_FIELD_CODES.RANGE_INVALID, ["expected_source_digest"],
        "Noninitial compound slice pages require source_digest"));
    }
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

  const selectedAddress = selectorField === "unit"
    ? parseWorkRecordSummaryUnit(selected)
    : null;
  return {
    args: normalizedArgs,
    selector: {
      id: selectorField === "id" ? selected : null,
      unit: selectorField === "unit" ? selected : null,
      path: selectorField === "path" ? selected : null,
      selected,
      selected_slice: selectedAddress?.kind === "slice" ? selectedAddress.slice_id : null,
      selected_record: args.selected_record === true,
      slice_page: normalizeSlicePageRequest(args),
      member: hasOwn(args, "member") ? args.member : null,
      members: hasOwn(args, "members") ? args.members : null,
      expected_source_digest: hasOwn(args, "expected_source_digest") ? args.expected_source_digest : null
    }
  };
}

function getOrdinaryReaderSelectorIssues(args, primaryField) {
  const issues = [];
  const delegated = READ_PAGE_DELEGATED_FIELDS.filter((field) => hasOwn(args, field));
  const primaries = READ_PAGE_PRIMARY_FIELDS.filter((field) => hasOwn(args, field));

  if (delegated.length > 1) {
    issues.push(selectorIssue(
      SELECTOR_REFUSAL_CODES.CONFLICT,
      [delegated[1]],
      `${READ_PAGE_TOOL_FAMILY} reads one of ${READ_PAGE_DELEGATED_FIELDS.join(" or ")}, not both`
    ));
    return boundedSelectorIssues(issues);
  }

  if (hasOwn(args, "content_reference")) {

    for (const field of [...READ_PAGE_PRIMARY_FIELDS, "selected_slice", "selected_record", "member",
      "include_body", "profile", "extensionNamespaces"]) {
      if (!hasOwn(args, field)) continue;
      issues.push(selectorIssue(
        SELECTOR_REFUSAL_CODES.CONFLICT,
        [field],
        `${READ_PAGE_TOOL_FAMILY} content_reference reads one retained reference and accepts no ${field}`
      ));
    }
    return boundedSelectorIssues(issues);
  }

  if (hasOwn(args, "entry")) {

    for (const field of ["selected_slice", "selected_record", "member", "include_body"]) {
      if (!hasOwn(args, field)) continue;
      issues.push(selectorIssue(
        SELECTOR_REFUSAL_CODES.CONFLICT,
        [field],
        `${READ_PAGE_TOOL_FAMILY} entry selects inside one unit and accepts no ${field}`
      ));
    }
    if (!hasOwn(args, "id") && !hasOwn(args, "unit")) {
      issues.push(selectorIssue(
        SELECTOR_REFUSAL_CODES.COUNT_INVALID,
        ["unit"],
        `${READ_PAGE_TOOL_FAMILY} entry requires the canonical id or unit that owns the entry`
      ));
    }
    if (hasOwn(args, "path")) {
      issues.push(selectorIssue(
        SELECTOR_REFUSAL_CODES.CONFLICT,
        ["path"],
        `${READ_PAGE_TOOL_FAMILY} entry is addressed by canonical id or unit, not by path`
      ));
    }
    return boundedSelectorIssues(issues);
  }

  if (primaries.length === 0) {
    issues.push(selectorIssue(
      SELECTOR_REFUSAL_CODES.COUNT_INVALID,
      [primaryField],
      `${READ_PAGE_TOOL_FAMILY} requires exactly one of ${READ_PAGE_PRIMARY_FIELDS.join(", ")}`
    ));
    return boundedSelectorIssues(issues);
  }
  if (primaries.length > 1) {
    issues.push(selectorIssue(
      SELECTOR_REFUSAL_CODES.CONFLICT,
      [primaries[1]],
      `${READ_PAGE_TOOL_FAMILY} accepts exactly one of ${READ_PAGE_PRIMARY_FIELDS.join(", ")}; ` +
        `received ${primaries.join(", ")}`
    ));
  }

  if (hasOwn(args, "unit") && hasOwn(args, "selected_slice") &&
      normalizeString(args.unit)?.includes("#")) {
    issues.push(selectorIssue(
      SELECTOR_REFUSAL_CODES.CONFLICT,
      ["selected_slice"],
      `${READ_PAGE_TOOL_FAMILY} unit already names its slice; selected_slice would address a second one`
    ));
  }
  return boundedSelectorIssues(issues);
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
  const primaryField = toolFamily === GET_RECORD_TOOL_FAMILY
    ? "id"
    : (READ_PAGE_PRIMARY_FIELDS.find((field) => hasOwn(args, field)) ?? "path");
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
  issues.push(...getMemberSelectorValidationIssues(args, toolFamily));
  issues.push(...getMembersSelectorValidationIssues(args, toolFamily));
  if (toolFamily === READ_PAGE_TOOL_FAMILY) {
    issues.push(...getReadPageDigestPlacementIssues(args));
    issues.push(...getOrdinaryReaderSelectorIssues(args, primaryField));
  } else {
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
  }
  const selected = hasOwn(args, primaryField) ? normalizeString(args[primaryField]) : null;

  const pathIdentity = toolFamily !== READ_PAGE_TOOL_FAMILY || primaryField === "path";
  const canonicalRecordId = pathIdentity || selected === null
    ? null
    : (primaryField === "unit" ? parseWorkRecordSummaryUnit(selected)?.record_id ?? selected : selected);
  const readPagePath = selected && toolFamily === READ_PAGE_TOOL_FAMILY && pathIdentity
    ? classifyReadPagePath(selected)
    : null;
  if (!pathIdentity && selected && canonicalRecordId !== null &&
      WORK_RECORD_ID_PREFIX_PATTERN.test(canonicalRecordId) &&
      !WORK_RECORD_ID_PATTERN.test(canonicalRecordId)) {
    issues.push(selectorIssue(
      SELECTOR_REFUSAL_CODES.RECORD_ID_MALFORMED,
      [primaryField],
      `${READ_PAGE_TOOL_FAMILY} ${primaryField} must match the canonical WK-0000 grammar`
    ));
  }
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
    pathIdentity &&
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
    pathIdentity &&
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
    selectedSlice &&
    !pathIdentity &&
    canonicalRecordId !== null &&
    !WORK_RECORD_ID_PATTERN.test(canonicalRecordId)
  ) {
    issues.push(selectorIssue(
      SELECTOR_REFUSAL_CODES.UNSUPPORTED,
      ["selected_slice"],
      `${READ_PAGE_TOOL_FAMILY} selected_slice requires a canonical work-record id or unit`
    ));
  }
  if (
    toolFamily === READ_PAGE_TOOL_FAMILY &&
    selectedRecord &&
    selected &&
    (!pathIdentity || !isGraphEvidenceReadPath(selected))
  ) {
    issues.push(selectorIssue(
      SELECTOR_REFUSAL_CODES.PATH_UNSUPPORTED,
      ["selected_record"],
      `${READ_PAGE_TOOL_FAMILY} selected_record requires a canonical graph-evidence path`
    ));
  }

  if (
    toolFamily === READ_PAGE_TOOL_FAMILY &&
    (hasOwn(args, "member") || hasOwn(args, "members")) &&
    readPagePath &&
    (readPagePath.kind === "graph_evidence" ||
      (readPagePath.kind === "generic" && !selected.endsWith(".json")))
  ) {
    issues.push(selectorIssue(
      SELECTOR_REFUSAL_CODES.PATH_UNSUPPORTED,
      [hasOwn(args, "member") ? "member" : "members"],
      `${READ_PAGE_TOOL_FAMILY} member requires a canonical WK, initiative or decision JSON path`
    ));
  }

  if (
    toolFamily === READ_PAGE_TOOL_FAMILY &&
    args?.include_body === true &&
    (!pathIdentity ||
      (readPagePath &&
        (readPagePath.kind === "work_record" || readPagePath.kind === "graph_evidence")))
  ) {
    issues.push(selectorIssue(
      SELECTOR_REFUSAL_CODES.PATH_UNSUPPORTED,
      ["include_body"],
      `${READ_PAGE_TOOL_FAMILY} include_body reads Markdown page bodies; select record content with ` +
        "member:{path}, or one WK entry body with entry:{entry_id,include_body:true}"
    ));
  }
  return boundedSelectorIssues(issues);
}

function validateAndNormalizeReadSelector(args, toolFamily) {
  const issues = getReadSelectorValidationIssues(args, toolFamily);
  if (issues.length > 0) {
    throwSelectorValidationError(toolFamily, issues);
  }

  const primaryField = toolFamily === GET_RECORD_TOOL_FAMILY
    ? "id"
    : (READ_PAGE_PRIMARY_FIELDS.find((field) => hasOwn(args, field)) ?? "path");
  const selected = normalizeString(args[primaryField]);
  const selectedSliceSupplied = hasOwn(args, "selected_slice");
  let selectedSlice = selectedSliceSupplied ? normalizeString(args.selected_slice) : null;
  const selectedRecord = args.selected_record === true;

  let canonicalId = null;
  if (primaryField === "unit") {
    const parsed = parseWorkRecordSummaryUnit(selected);
    canonicalId = parsed?.record_id ?? selected;
    selectedSlice = parsed?.slice_id ?? selectedSlice;
  } else if (primaryField === "id") {
    canonicalId = selected;
  }

  const normalizedArgs = { ...args };
  delete normalizedArgs.id;
  delete normalizedArgs.unit;
  delete normalizedArgs.path;
  delete normalizedArgs.entry;
  delete normalizedArgs.content_reference;

  normalizedArgs[canonicalId === null ? primaryField : "id"] = canonicalId ?? selected;
  if (selectedSlice !== null) normalizedArgs.selected_slice = selectedSlice;

  return {
    args: normalizedArgs,
    selector: {
      id: canonicalId ?? (primaryField === "id" ? selected : null),
      path: primaryField === "path" ? selected : null,
      identity_kind: primaryField,
      identity_argument: primaryField === "path" ? { path: selected } : { [primaryField]: selected },
      selected,
      selected_slice: selectedSlice,
      selected_record: selectedRecord,
      selected_detail: Boolean(selectedSlice || selectedRecord),
      slice_page: toolFamily === GET_RECORD_TOOL_FAMILY ? normalizeSlicePageRequest(args) : null,
      member: hasOwn(args, "member") ? args.member : null,
      members: hasOwn(args, "members") ? args.members : null,
      expected_source_digest: hasOwn(args, "expected_source_digest") ? args.expected_source_digest : null
    }
  };
}

function throwRecordBodyUnsupported(toolFamily) {
  throwSelectorValidationError(toolFamily, [selectorIssue(
    SELECTOR_REFUSAL_CODES.PATH_UNSUPPORTED,
    ["include_body"],
    `${toolFamily} include_body reads Markdown page bodies, not canonical records or their ` +
      "projections; select record content with member"
  )]);
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

function buildKindRecordContinuation({
  toolFamily,
  workspaceRepo,
  compactResult,
  selector,
  args,
  memberLedger
}) {
  const continuation = buildContinuationMetadata({
    toolFamily,
    compactResult,
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
    detail_available_via: ["member"],
    selected_resources: {
      type: "canonical_record",
      id: compactResult.record_id,
      record_kind: compactResult.record_kind,
      selection_reason: "compact_read_compact_first_scope"
    },
    next_calls: [buildSelectedRecordMemberCall({
      tool: toolFamily,
      repository: workspaceRepo,
      identity: toolFamily === READ_PAGE_TOOL_FAMILY
        ? { path: compactResult.relativePath }
        : { id: compactResult.record_id },
      member: { path: [] },
      recommended: true
    })],
    next_calls_coverage: {
      omitted_record_members: omittedMembers,
      omitted_record_members_addressed: omittedMembers,
      omitted_record_members_unaddressed: 0,
      complete: true
    },
    member_ledger: memberLedger
  };
}

async function loadNavigationUnit({ workspaceDir, recordId, unitAddress, readWorkRecordById }) {
  const loaded = await readWorkRecordById({ dir: workspaceDir, id: recordId });
  return { loaded, unit: parseWorkRecordSummaryUnit(unitAddress ?? recordId) };
}

export async function runWorkRecordSummaryWithCompactGate({
  workspaceRepo,
  callRepository = workspaceRepo,
  workspaceDir,
  args,
  readWorkRecordById,
  isToolVisible = toolVisibleToSession,
  isOrchestratorPresentation = isOrchestratorPresentationSession
}) {
  const normalized = validateAndNormalizeSummarySelector(args);
  const normalizedArgs = normalized.args;
  const selector = normalized.selector;

  if (callRepository === null) delete normalizedArgs.repo;

  const selectedRecordId =
    parseWorkRecordSummaryUnit(selector.selected)?.record_id ??
    extractWorkRecordReadPath(selector.selected)?.record_id ??
    selector.selected;

  if (hasOwn(normalizedArgs, "ordinary_field")) {
    return runOrdinaryFieldRead({ workspaceDir, workspaceRepo, recordId: selectedRecordId,
      args: normalizedArgs, selector, readWorkRecordById });
  }

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

  if (selector.member || selector.members) {
    return runSelectedRecordMember({
      toolFamily: SUMMARY_TOOL_FAMILY,
      workspaceRepo: callRepository,
      workspaceDir,
      recordId: selectedRecordId,
      sliceId: selector.selected_slice,
      identity: { unit: selector.selected_slice ? `${selectedRecordId}#${selector.selected_slice}` : selectedRecordId },
      member: selector.member,
      members: selector.members,
      expectedSourceDigest: selector.expected_source_digest,
      readWorkRecordById
    });
  }

  const { loaded, unit } = await loadNavigationUnit({ workspaceDir, recordId: selectedRecordId,
    unitAddress: normalizedArgs.unit, readWorkRecordById });
  if (hasOwn(normalizedArgs, "details")) {
    const menu = projectWorkRecordDetailMenu({ loaded, unit, repository: callRepository,
      details: normalizedArgs.details, isToolVisible });
    if (!menu) throwSelectedIdentityError(SUMMARY_TOOL_FAMILY);
    return menu;
  }

  const navigation = projectWorkRecordNavigation({ loaded, unit, repository: callRepository, isToolVisible,
    isOrchestratorPresentation });
  if (!navigation) throwSelectedIdentityError(SUMMARY_TOOL_FAMILY);
  return navigation;
}

export async function runWorkRecordReadWithCompactGate(options) {
  if (options.toolFamily !== READ_PAGE_TOOL_FAMILY) return runWorkRecordRead(options);
  return withCanonicalProjectionReadRecovery({
    toolFamily: options.toolFamily,
    workspaceRepo: options.callRepository === undefined ? options.workspaceRepo : options.callRepository,
    workspaceDir: options.workspaceDir,
    args: options.args,
    loadKindRecordByPath: options.loadKindRecordByPath,
    read: () => runWorkRecordRead(options)
  });
}

async function runWorkRecordRead({
  workspaceRepo,
  callRepository = workspaceRepo,
  workspaceDir,
  args,
  toolFamily,
  readCompact,
  readExpensive,

  readCompactById = null,
  readExpensiveById = null,
  readWorkRecordById,
  loadKindRecordById,
  loadKindRecordByPath,
  isToolVisible = toolVisibleToSession,
  isOrchestratorPresentation = isOrchestratorPresentationSession
}) {
  const normalized = validateAndNormalizeReadSelector(args, toolFamily);
  const normalizedArgs = normalized.args;
  const selector = normalized.selector;
  const canonicalIdentity = toolFamily === READ_PAGE_TOOL_FAMILY &&
    selector.identity_kind !== undefined && selector.identity_kind !== "path";
  if (canonicalIdentity && typeof readCompactById !== "function") {
    throwSelectorValidationError(toolFamily, [selectorIssue(
      SELECTOR_REFUSAL_CODES.UNSUPPORTED,
      [selector.identity_kind],
      `${toolFamily} has no canonical identity reader available in this runtime`
    )]);
  }
  const selectedCompactReader = canonicalIdentity ? readCompactById : readCompact;
  const selectedExpensiveReader = canonicalIdentity
    ? (readExpensiveById ?? readCompactById) : readExpensive;

  if (selector.slice_page) {
    return runSliceEnumeration({
      toolFamily,
      workspaceDir,
      recordId: selector.id,
      request: selector.slice_page,
      readWorkRecordById
    });
  }

  if (selector.member || selector.members) {
    const workRecordId = toolFamily === GET_RECORD_TOOL_FAMILY || canonicalIdentity
      ? (WORK_RECORD_ID_PATTERN.test(selector.id ?? "") ? selector.id : null)
      : extractWorkRecordReadPath(selector.path)?.record_id ?? null;
    return runSelectedRecordMember({
      toolFamily,
      workspaceRepo: callRepository,
      workspaceDir,
      recordId: workRecordId ?? selector.selected,
      workRecord: workRecordId !== null,
      sliceId: selector.selected_slice,
      identity: toolFamily === GET_RECORD_TOOL_FAMILY
        ? { id: selector.id }
        : { ...(selector.identity_argument ?? { path: selector.path }) },
      member: selector.member,
      members: selector.members,
      expectedSourceDigest: selector.expected_source_digest,
      readWorkRecordById,
      loadKindRecordById,
      loadKindRecordByPath
    });
  }

  const bodyRequested = normalizedArgs.include_body === true;
  const pendingCompactResult = selectedCompactReader({
    ...normalizedArgs,
    include_body: false,
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

  if (toolFamily === READ_PAGE_TOOL_FAMILY && compactResult?.format === "json-work-record" &&
      (canonicalIdentity || isWorkRecordReadPath(selector.path))) {
    const recordId = canonicalIdentity
      ? selector.id : extractWorkRecordReadPath(selector.path).record_id;
    const { loaded, unit } = await loadNavigationUnit({ workspaceDir, recordId,
      unitAddress: selector.selected_slice ? `${recordId}#${selector.selected_slice}` : recordId,
      readWorkRecordById });
    const navigation = projectWorkRecordNavigation({ loaded, unit, repository: callRepository, isToolVisible,
      isOrchestratorPresentation });

    if (!navigation || (selector.selected_slice && navigation.ok === false &&
        navigation.diagnostics?.[0]?.code === "missing_slice")) {
      throwSelectedIdentityError(toolFamily);
    }
    return navigation;
  }

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
    if (!bodyRequested) return compactResult;
    if (compactResult?.format !== "markdown") throwRecordBodyUnsupported(toolFamily);
    const page = await selectedExpensiveReader({ ...normalizedArgs, include_body: true,
      dir: workspaceDir });
    if (RECORD_PROJECTION_PAGE_KINDS.has(page?.pageKind)) throwRecordBodyUnsupported(toolFamily);
    return page;
  }
  if (bodyRequested) throwRecordBodyUnsupported(toolFamily);

  if (kindDisclosure) {
    compactResult.source_digest = projectWorkRecordFreshness(compactResult.source_digest);
    compactResult.compact_read = buildKindRecordContinuation({
      toolFamily,
      workspaceRepo: callRepository,
      compactResult,
      selector,
      args: normalizedArgs,
      memberLedger: kindDisclosure.memberLedger
    });
    return compactResult;
  }

  const loadedRecord = typeof readWorkRecordById === "function"
    ? await readWorkRecordById({ dir: workspaceDir, id: compactResult.record_id })
    : null;
  compactResult.source_digest = projectWorkRecordFreshness(loadedRecord?.source_digest ?? compactResult.source_digest);
  compactResult.compact_read = buildContinuationMetadata({
    toolFamily,
    compactResult,
    selector,
    args: normalizedArgs,
    record: loadedRecord?.record ?? null
  });
  return compactResult;
}
