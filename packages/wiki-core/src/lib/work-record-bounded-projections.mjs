

import { calculateSliceAgentNotesBytes } from "./work-record-projection-helpers.mjs";
import {
  normalizeStringList,
  WORK_RECORD_COMPACT_SMALL_RESPONSE_MAX_BYTES,
  WORK_RECORD_LEVEL_CONTRACT_FIELDS,
  WORK_RECORD_SLICE_PAGE_DEFAULT_LIMIT,
  WORK_RECORD_SLICE_PAGE_MAX_LIMIT
} from "./work-record-summary.mjs";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export const WORK_RECORD_SLICE_PAGE_SCHEMA_VERSION = "work-record-slice-enumeration.v1";

export const WORK_RECORD_SLICE_PAGE_MAX_ROW_BYTES = WORK_RECORD_COMPACT_SMALL_RESPONSE_MAX_BYTES;
const SLICE_PAGE_TITLE_LIMIT = 160;

function boundedTitle(value) {
  if (typeof value !== "string") return null;
  return value.length <= SLICE_PAGE_TITLE_LIMIT
    ? value
    : `${value.slice(0, SLICE_PAGE_TITLE_LIMIT - 3)}...`;
}

function summarizeSliceEnumerationRow(slice) {
  return {
    id: slice.id ?? null,
    title: boundedTitle(slice.title),
    status: slice.status ?? null,
    work_kind: slice.work_kind ?? null,
    agent_notes_bytes: calculateSliceAgentNotesBytes(slice)
  };
}

function normalizeSliceStatusFilter(status) {
  if (status === null || status === undefined) return [];
  return normalizeStringList(Array.isArray(status) ? status : [status]);
}

export function projectWorkRecordSlicePage(
  record,
  { offset = 0, limit = null, status = null } = {}
) {
  const slices = isObject(record) && Array.isArray(record.slices)
    ? record.slices.filter((entry) => isObject(entry))
    : [];
  const statusFilter = normalizeSliceStatusFilter(status);
  const filtered = statusFilter.length > 0
    ? slices.filter((slice) => statusFilter.includes(slice.status ?? "unknown"))
    : slices;

  const requestedLimit = Number.isInteger(limit) && limit > 0
    ? limit
    : WORK_RECORD_SLICE_PAGE_DEFAULT_LIMIT;
  let appliedLimit = Math.min(requestedLimit, WORK_RECORD_SLICE_PAGE_MAX_LIMIT);
  let clampReason = appliedLimit < requestedLimit ? "server_max_limit" : null;

  const startOffset = Number.isInteger(offset) && offset > 0 ? offset : 0;
  const rows = filtered
    .slice(startOffset, startOffset + appliedLimit)
    .map(summarizeSliceEnumerationRow);

  while (
    rows.length > 1 &&
    Buffer.byteLength(JSON.stringify(rows), "utf8") > WORK_RECORD_SLICE_PAGE_MAX_ROW_BYTES
  ) {
    rows.pop();
    appliedLimit = rows.length;
    clampReason = "response_size_class";
  }

  const returned = rows.length;
  const nextOffset = startOffset + returned;

  const final = nextOffset >= filtered.length;

  return {
    schema_version: WORK_RECORD_SLICE_PAGE_SCHEMA_VERSION,
    offset: startOffset,
    requested_limit: requestedLimit,
    applied_limit: appliedLimit,
    limit_clamped: clampReason !== null,
    limit_clamp_reason: clampReason,
    server_max_limit: WORK_RECORD_SLICE_PAGE_MAX_LIMIT,
    status_filter: statusFilter.length > 0 ? statusFilter : null,
    slices: rows,
    returned,

    filtered_total: filtered.length,
    unfiltered_total: slices.length,
    has_more: !final,
    final,
    next_offset: final ? null : nextOffset
  };
}

export const WORK_RECORD_CONTRACT_FIELD_ENTRY_MAX_CHARS = 1024;

const WORK_RECORD_CONTRACT_FIELD_ENTRY_MIN_CHARS = 120;
const CONTRACT_FIELD_ELLIPSIS = "...";

function shortenContractFieldEntry(entry, entryLimit) {
  if (typeof entry !== "string") return entry;
  if (entry.length <= entryLimit) return entry;
  const keep = Math.max(1, entryLimit - CONTRACT_FIELD_ELLIPSIS.length);
  return `${entry.slice(0, keep)}${CONTRACT_FIELD_ELLIPSIS}`;
}

function buildBoundedContractFields(id, authored, entryLimit, keptCounts, maxBytes) {
  const kept = {};
  const disclosure = {};
  let truncated = false;

  for (const field of WORK_RECORD_LEVEL_CONTRACT_FIELDS) {
    const entries = authored[field.bucket].slice(0, keptCounts[field.bucket]);
    let shortened = 0;
    kept[field.bucket] = entries.map((entry) => {
      const bounded = shortenContractFieldEntry(entry, entryLimit);
      if (bounded !== entry) shortened += 1;
      return bounded;
    });
    const omitted = authored[field.bucket].length - entries.length;
    if (omitted > 0 || shortened > 0) truncated = true;
    disclosure[field.disclosure] = {
      total: authored[field.bucket].length,
      returned: entries.length,
      omitted_count: omitted,
      entries_shortened: shortened
    };
  }

  const acceptance = { criteria: kept.criteria, validation: kept.validation };
  return {
    id,
    write_scope: kept.write_scope,
    acceptance,
    validation: acceptance.validation,
    truncated,
    truncation: truncated
      ? {
          reason: "compact_response_size_class",
          max_bytes: maxBytes,
          entry_char_limit: entryLimit,
          fields: disclosure
        }
      : null
  };
}

function contractFieldCountCeiling(entries, maxBytes) {
  let used = 0;
  let count = 0;
  for (const entry of entries) {

    used += typeof entry === "string"
      ? Math.min(entry.length, WORK_RECORD_CONTRACT_FIELD_ENTRY_MIN_CHARS) + 3
      : Buffer.byteLength(JSON.stringify(entry), "utf8") + 1;
    if (used > maxBytes) break;
    count += 1;
  }
  return count;
}

export function projectWorkRecordContractFields(
  record,
  { maxBytes = WORK_RECORD_COMPACT_SMALL_RESPONSE_MAX_BYTES } = {}
) {
  const authored = {};
  for (const field of WORK_RECORD_LEVEL_CONTRACT_FIELDS) {
    authored[field.bucket] = field.authored(record);
  }
  const id = record?.id ?? null;

  const keptCounts = {};
  for (const field of WORK_RECORD_LEVEL_CONTRACT_FIELDS) {
    keptCounts[field.bucket] = contractFieldCountCeiling(authored[field.bucket], maxBytes);
  }

  let entryLimit = WORK_RECORD_CONTRACT_FIELD_ENTRY_MAX_CHARS;
  let projection = buildBoundedContractFields(id, authored, entryLimit, keptCounts, maxBytes);
  while (Buffer.byteLength(JSON.stringify(projection), "utf8") > maxBytes) {
    if (entryLimit > WORK_RECORD_CONTRACT_FIELD_ENTRY_MIN_CHARS) {
      entryLimit = Math.max(
        WORK_RECORD_CONTRACT_FIELD_ENTRY_MIN_CHARS,
        Math.floor(entryLimit / 2)
      );
    } else {

      const widest = WORK_RECORD_LEVEL_CONTRACT_FIELDS
        .map((field) => field.bucket)
        .reduce((left, right) => (keptCounts[right] > keptCounts[left] ? right : left));

      if (keptCounts[widest] === 0) break;
      keptCounts[widest] -= 1;
    }
    projection = buildBoundedContractFields(id, authored, entryLimit, keptCounts, maxBytes);
  }
  return projection;
}
