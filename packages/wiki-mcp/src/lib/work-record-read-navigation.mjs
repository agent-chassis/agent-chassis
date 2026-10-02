

import { WORK_RECORD_EDIT_FIELD_REGISTRY } from
  "@agent-chassis/wiki-core/src/lib/work-record-contract-edit.mjs";
import { ORDINARY_READ_FIELDS } from
  "@agent-chassis/wiki-core/src/lib/work-record-ordinary-field-read.mjs";
import { buildSelectedRecordMemberCall } from
  "@agent-chassis/wiki-core/src/lib/work-record-selected-unit-projection.mjs";
import {
  findSliceById,
  WORK_RECORD_DETAIL_ROUTES,
  WORK_RECORD_READ_TOOLS,
  workRecordDetailRouteSupported
} from "@agent-chassis/wiki-core/src/lib/work-record-summary.mjs";
import { projectWorkRecordFreshness } from
  "@agent-chassis/wiki-core/src/lib/work-record-schema-constants.mjs";
import { buildNextCall } from "./mcp-response.mjs";
import { isOrchestratorPresentationSession, parseToolProfile, shouldExposeTool } from "./tool-profile.mjs";

export const WORK_RECORD_NAVIGATION_MAX_BYTES = 1024;
export const WORK_RECORD_DETAILS_DEFAULT_LIMIT = 3;
export const WORK_RECORD_DETAILS_MAX_LIMIT = 5;
const ENTRY_READ_TOOL = "workspace_work_record_entry_read";
const SUMMARY_TITLE_MAX_SCALARS = 160;
const TRUNCATION_MARK = "…";

const DEFAULT_TEXT_FIELD_PREFERENCE = Object.freeze([
  "sections.agent_notes", "sections.tasks", "sections.summary"
]);
const USER_REQUIREMENTS_FIELD = "sections.user_requirements";

const published = new WeakSet();

const isObject = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const payloadBytes = value => Buffer.byteLength(JSON.stringify(value), "utf8");

function publish(result) {
  published.add(result);
  return result;
}

export function publishWorkRecordReadPayload(result) {
  return publish(result);
}

export function isWorkRecordNavigationResult(value) {
  return isObject(value) && published.has(value);
}

export function toolVisibleToSession(tool, env = process.env) {
  return shouldExposeTool(parseToolProfile(env), tool);
}

export function workRecordDetailsSelectorIssues(details) {
  if (!isObject(details)) {
    return [{ path: ["details"], message: "details must be an object with optional offset and limit" }];
  }
  const issues = [];
  for (const key of Object.keys(details)) {
    if (key !== "offset" && key !== "limit") {
      issues.push({ path: ["details", key], message: `details does not support ${key}` });
    }
  }
  if (Object.hasOwn(details, "offset") && !(Number.isSafeInteger(details.offset) && details.offset >= 0)) {
    issues.push({ path: ["details", "offset"], message: "details.offset must be a nonnegative safe integer" });
  }
  if (Object.hasOwn(details, "limit") && !(Number.isSafeInteger(details.limit) &&
      details.limit >= 1 && details.limit <= WORK_RECORD_DETAILS_MAX_LIMIT)) {
    issues.push({ path: ["details", "limit"],
      message: `details.limit must be an integer from 1 to ${WORK_RECORD_DETAILS_MAX_LIMIT}` });
  }
  return issues;
}

function registryKind(unit) {
  return unit.kind === "slice" ? "slice" : "record";
}

function ordinaryFieldEntries(unit) {
  const kind = registryKind(unit);
  return ORDINARY_READ_FIELDS
    .map(field => WORK_RECORD_EDIT_FIELD_REGISTRY.find(entry =>
      entry.field === field && entry.applicability.includes(kind)))
    .filter(Boolean);
}

function fieldValue(target, entry) {
  return entry.canonical_address.reduce((value, key) => value?.[key], target);
}

function nonempty(value) {
  return (typeof value === "string" || Array.isArray(value)) && value.length > 0;
}

function readPagePath(unit) {
  return `wiki/work-records/${unit.record_id}.json`;
}

const repoArgument = repository => repository === null ? {} : { repo: repository };

function summaryCall(repository, unit, selector) {
  return buildNextCall({ tool: WORK_RECORD_READ_TOOLS.SUMMARY,
    arguments: { ...repoArgument(repository), unit: unit.address, ...selector } });
}

function entryListCall(repository, unit) {
  return buildNextCall({ tool: ENTRY_READ_TOOL, arguments: { ...repoArgument(repository), unit: unit.address } });
}

function membersCall(repository, unit) {
  return buildSelectedRecordMemberCall({ tool: WORK_RECORD_READ_TOOLS.READ_PAGE, repository,
    identity: { path: readPagePath(unit) }, selectedSlice: unit.kind === "slice" ? unit.slice_id : null,
    member: { path: [] } });
}

function hasSlices(record) {
  return Array.isArray(record.slices) && record.slices.some(isObject);
}

function hasEntries(target) {
  return Array.isArray(target?.sections?.entries) && target.sections.entries.length > 0;
}

function missingSlice(unit) {
  return publish({ ok: false, unit: unit.address, diagnostics: [{
    code: "missing_slice",
    severity: "error",
    message: `Selected slice ${unit.slice_id} does not exist on ${unit.record_id}`,
    path: "unit"
  }] });
}

function resolveTarget(loaded, unit) {
  const record = loaded?.record;
  if (!isObject(record)) {
    const diagnostics = Array.isArray(loaded?.diagnostics) ? loaded.diagnostics : [];
    return diagnostics.length > 0
      ? { failure: publish({ ok: false, unit: unit.address, diagnostics }) }
      : null;
  }
  if (record.id !== unit.record_id) return null;
  if (unit.kind !== "slice") return { record, target: record };
  const slice = findSliceById(record, unit.slice_id);
  return slice ? { record, target: slice } : { failure: missingSlice(unit) };
}

function fittedTitle(result, title) {
  if (typeof title !== "string") return null;
  const scalars = Array.from(title);
  const render = count => count >= scalars.length
    ? title
    : `${scalars.slice(0, count).join("")}${TRUNCATION_MARK}`;
  let count = Math.min(scalars.length, SUMMARY_TITLE_MAX_SCALARS);
  while (count > 0 &&
      payloadBytes({ ...result, summary: render(count) }) > WORK_RECORD_NAVIGATION_MAX_BYTES) {
    count -= 1;
  }
  return count === 0 && scalars.length > 0 ? TRUNCATION_MARK : render(count);
}

function openingCalls({ record, target, unit, repository, isToolVisible }) {
  const summaryVisible = isToolVisible(WORK_RECORD_READ_TOOLS.SUMMARY);
  let text = null;
  let navigation = null;
  if (summaryVisible) {
    const enrolled = ordinaryFieldEntries(unit);
    const textField = DEFAULT_TEXT_FIELD_PREFERENCE
      .map(field => enrolled.find(entry => entry.field === field))
      .find(entry => entry && nonempty(fieldValue(target, entry)));
    if (textField) text = summaryCall(repository, unit, { ordinary_field: { field: textField.field } });
  }
  if (hasEntries(target) && isToolVisible(ENTRY_READ_TOOL)) {
    navigation = entryListCall(repository, unit);
  } else if (summaryVisible && unit.kind !== "slice" && hasSlices(record) &&
      workRecordDetailRouteSupported(WORK_RECORD_READ_TOOLS.SUMMARY, WORK_RECORD_DETAIL_ROUTES.SLICE_ENUMERATION)) {
    navigation = summaryCall(repository, unit, { slice_offset: 0 });
  }
  const details = summaryVisible ? summaryCall(repository, unit, { details: {} }) : null;
  return { summaryVisible, text, navigation, details };
}

export function projectWorkRecordNavigation({
  loaded, unit, repository, isToolVisible = toolVisibleToSession,
  isOrchestratorPresentation = isOrchestratorPresentationSession
}) {
  const resolved = resolveTarget(loaded, unit);
  if (!resolved || resolved.failure) return resolved?.failure ?? null;
  const { record, target } = resolved;
  const calls = openingCalls({ record, target, unit, repository, isToolVisible });
  if (isOrchestratorPresentation()) {
    return publish(requirementsFirstNavigation({ loaded, record, target, unit, repository, calls }));
  }
  const result = { ok: true, unit: unit.address, status: target.status ?? null, summary: null,
    next_calls: [calls.text, calls.navigation, calls.details].filter(Boolean) };
  result.summary = fittedTitle(result, target.title);
  return publish(result);
}

function requirementsFirstNavigation({ loaded, record, target, unit, repository, calls }) {
  const text = record.sections?.user_requirements;
  const present = typeof text === "string";
  const scalars = present ? Array.from(text) : [];
  const sourceDigest = projectWorkRecordFreshness(loaded.source_digest);
  const requirementsCall = present && calls.summaryVisible
    ? summaryCall(repository, { address: record.id }, {
      expected_source_digest: sourceDigest, ordinary_field: { field: USER_REQUIREMENTS_FIELD } })
    : null;
  const first = present ? requirementsCall : calls.text;
  const titleScalars = typeof target.title === "string" ? Array.from(target.title) : null;
  const renderTitle = count => titleScalars === null ? null
    : count >= titleScalars.length ? target.title
      : count === 0 && titleScalars.length > 0 ? TRUNCATION_MARK
        : `${titleScalars.slice(0, count).join("")}${TRUNCATION_MARK}`;
  const frame = ({ title, navigation, length, details }) => ({
    ok: true,
    unit: unit.address,
    status: target.status ?? null,
    user_requirements: { unit: record.id, source_digest: sourceDigest, offset: 0,
      length: present ? length : 0, total: scalars.length,
      value: present ? scalars.slice(0, length).join("") : null },
    summary: renderTitle(title),
    next_calls: [first, navigation ? calls.navigation : null, details ? calls.details : null].filter(Boolean)
  });
  const fits = candidate => payloadBytes(candidate) <= WORK_RECORD_NAVIGATION_MAX_BYTES;
  const titleCap = titleScalars === null ? 0 : Math.min(titleScalars.length, SUMMARY_TITLE_MAX_SCALARS);

  const largest = (upper, build) => {
    if (!fits(build(0))) return null;
    let low = 0;
    let high = upper;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (fits(build(middle))) low = middle;
      else high = middle - 1;
    }
    return low;
  };
  const full = { title: titleCap, navigation: true, length: scalars.length, details: true };

  const title = largest(titleCap, count => frame({ ...full, title: count }));
  if (title !== null) return frame({ ...full, title });
  const unnavigated = { ...full, title: 0, navigation: false };
  if (fits(frame(unnavigated))) return frame(unnavigated);

  for (const details of [true, false]) {
    const length = largest(scalars.length, count => frame({ ...unnavigated, details, length: count }));
    if (length !== null) return frame({ ...unnavigated, details, length });
  }

  return frame({ ...unnavigated, details: false, length: 0 });
}

function detailRows({ record, unit, repository, isToolVisible }) {
  const rows = [];
  const summaryVisible = isToolVisible(WORK_RECORD_READ_TOOLS.SUMMARY);
  const root = unit.kind !== "slice";
  if (summaryVisible) {
    for (const entry of ordinaryFieldEntries(unit)) {
      rows.push({ field: entry.field,
        next_call: summaryCall(repository, unit, { ordinary_field: { field: entry.field } }) });
    }
  }
  if (isToolVisible(ENTRY_READ_TOOL)) {
    rows.push({ field: "sections.entries", next_call: entryListCall(repository, unit) });
  }
  if (summaryVisible && root && hasSlices(record) &&
      workRecordDetailRouteSupported(WORK_RECORD_READ_TOOLS.SUMMARY, WORK_RECORD_DETAIL_ROUTES.SLICE_ENUMERATION)) {
    rows.push({ field: "slices", next_call: summaryCall(repository, unit, { slice_offset: 0 }) });
  }

  if (summaryVisible && root &&
      workRecordDetailRouteSupported(WORK_RECORD_READ_TOOLS.SUMMARY, WORK_RECORD_DETAIL_ROUTES.SELECTED_RECORD)) {
    rows.push({ field: "contract_fields", next_call: summaryCall(repository, unit, { selected_record: true }) });
  }
  if (isToolVisible(WORK_RECORD_READ_TOOLS.READ_PAGE) && (root ||
      workRecordDetailRouteSupported(WORK_RECORD_READ_TOOLS.READ_PAGE, WORK_RECORD_DETAIL_ROUTES.SELECTED_SLICE))) {
    rows.push({ field: "members", next_call: membersCall(repository, unit) });
  }
  return rows;
}

export function projectLeanOrdinaryFieldPage(result) {
  const source = result.ordinary_field;
  const ordinaryField = { field: source.field };
  if (source.member !== undefined) ordinaryField.member = source.member;
  if (source.selection !== undefined) {
    ordinaryField.selection = source.selection;
  } else {
    Object.assign(ordinaryField, { offset: source.offset, length: source.length, total: source.total });
    if (Object.hasOwn(source, "value")) ordinaryField.value = source.value;
    else ordinaryField.reference = source.reference;
  }
  return publish({
    valid: true,
    source_digest: result.source_digest,
    ordinary_field: ordinaryField,
    next_calls: (result.next_calls ?? []).map(({ tool, arguments: callArguments }) =>
      ({ tool, arguments: callArguments }))
  });
}

export function projectWorkRecordDetailMenu({
  loaded, unit, repository, details = {}, isToolVisible = toolVisibleToSession
}) {
  const resolved = resolveTarget(loaded, unit);
  if (!resolved || resolved.failure) return resolved?.failure ?? null;
  const rows = detailRows({ record: resolved.record, unit, repository, isToolVisible });
  const offset = details.offset ?? 0;
  const limit = details.limit ?? WORK_RECORD_DETAILS_DEFAULT_LIMIT;
  const page = count => {
    const items = rows.slice(offset, offset + count);
    const end = offset + items.length;
    const nextDetails = { offset: end, ...(limit !== WORK_RECORD_DETAILS_DEFAULT_LIMIT ? { limit } : {}) };
    return { ok: true, unit: unit.address, offset, total_count: rows.length, items,
      next_calls: end < rows.length ? [summaryCall(repository, unit, { details: nextDetails })] : [] };
  };
  let count = limit;
  let result = page(count);

  while (result.items.length > 1 && payloadBytes(result) > WORK_RECORD_NAVIGATION_MAX_BYTES) {
    count = result.items.length - 1;
    result = page(count);
  }
  return publish(result);
}
