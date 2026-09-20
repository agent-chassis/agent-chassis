import { types as utilTypes } from "node:util";
import {
  SHA256_PATTERN,
  SLICE_ID_PATTERN,
  WORK_RECORD_STATUS_VALUES,
  WORK_RECORD_WORK_KIND_VALUES,
  WORK_RECORD_REVIEW_PURPOSE_VALUES
} from "./work-record-schema-constants.mjs";
import { projectWorkRecordTestProofValidation } from "./work-record-test-proof-bindings.mjs";
import { analyzeWorkRecordFindingsUnit } from "./work-record-findings-semantics.mjs";
import {
  WORK_RECORD_COMPACT_RESULT_MAX_UTF8_BYTES,
  WORK_RECORD_ENTRY_BODY_PAGE_MAX_SCALARS,
  WORK_RECORD_ENTRY_METADATA_PAGE_DEFAULT,
  WORK_RECORD_ENTRY_METADATA_PAGE_MAX,
  WORK_RECORD_ENTRY_READ_TARGET_UTF8_BYTES,
  WORK_RECORD_TEXT_PAGE_DEFAULT_SCALARS
} from "./work-record-entry-schema.mjs";
import { fitReadPagePopulation } from "./work-record-read-page-budget.mjs";
import { buildNextCall } from "./next-calls-descriptor.mjs";

const MAX_PROJECTED_NODES = 10000;
const MAX_PROJECTED_DEPTH = 64;
const WORK_RECORD_ID_PATTERN = /^WK-[0-9]{4}$/;
const INVALID = Symbol("invalid-selected-unit-projection");

function isObject(value) {
  return value !== null && typeof value === "object" && !utilTypes.isProxy(value);
}

function ownDataValue(value, field) {
  if (value !== null && typeof value === "object" && utilTypes.isProxy(value)) {
    return { present: true, value: INVALID };
  }
  if (!isObject(value)) return { present: false, value: undefined };
  const descriptor = Object.getOwnPropertyDescriptor(value, field);
  if (!descriptor) return { present: false, value: undefined };
  if (!Object.hasOwn(descriptor, "value")) {
    return { present: true, value: INVALID };
  }
  return { present: true, value: descriptor.value };
}

function cloneData(value, state, depth = 0) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (value === undefined) return undefined;
  if (!isObject(value) || depth > MAX_PROJECTED_DEPTH) return INVALID;
  if (state.seen.has(value) || state.nodes >= MAX_PROJECTED_NODES) return INVALID;
  state.seen.add(value);
  state.nodes += 1;

  let result;
  if (Array.isArray(value)) {
    result = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, "value")) return INVALID;
      const cloned = cloneData(descriptor.value, state, depth + 1);
      if (cloned === INVALID) return INVALID;
      result.push(cloned);
    }
  } else {
    result = {};
    for (const [field, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!descriptor.enumerable) continue;
      if (!Object.hasOwn(descriptor, "value")) return INVALID;
      const cloned = cloneData(descriptor.value, state, depth + 1);
      if (cloned === INVALID) return INVALID;
      if (cloned !== undefined || state.preserveUndefinedProperties === true) {
        result[field] = cloned;
      }
    }
  }

  state.seen.delete(value);
  return result;
}

function cloneAuthored(value) {
  return cloneData(value, { seen: new WeakSet(), nodes: 0 });
}

function cloneAcceptanceValidation(value) {
  return cloneData(value, {
    seen: new WeakSet(),
    nodes: 0,
    preserveUndefinedProperties: true
  });
}

function copyAuthored(projected, source, field, transform = cloneAuthored) {
  const authored = ownDataValue(source, field);
  if (!authored.present) return true;
  if (authored.value === INVALID) return false;
  const value = transform(authored.value);
  if (value === INVALID) return false;
  projected[field] = value;
  return true;
}

function isCanonicalString(value) {
  return typeof value === "string";
}

function copyCanonicalScalar(projected, source, field, predicate) {
  const authored = ownDataValue(source, field);
  if (!authored.present) return true;
  if (authored.value === INVALID || !predicate(authored.value)) return false;
  projected[field] = authored.value;
  return true;
}

function projectStringList(value) {
  if (!isObject(value) || !Array.isArray(value)) return INVALID;
  const projected = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, "value") || typeof descriptor.value !== "string") {
      return INVALID;
    }
    projected.push(descriptor.value);
  }
  return projected;
}

function projectAcceptanceValidationList(value) {
  const cloned = cloneAcceptanceValidation(value);
  if (cloned === INVALID) return INVALID;

  const projection = projectWorkRecordTestProofValidation({
    selectedUnit: { acceptance: { validation: cloned } }
  });
  return projection.status === "valid" ? structuredClone(projection.validation_entries) : INVALID;
}

function projectAgentNotes(value) {
  if (typeof value === "string") return value;
  return projectStringList(value);
}

function agentNotesEqual(left, right) {
  if (typeof left === "string" || typeof right === "string") {
    return typeof left === "string" && typeof right === "string" && left === right;
  }
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  return left.every((entry, index) => entry === right[index]);
}

function projectReadScope(value) {
  const refs = [];
  const seen = new Set();
  let authored = false;
  for (const field of ["read_scope", "docs"]) {
    const source = ownDataValue(value, field);
    if (!source.present) continue;
    authored = true;
    const entries = projectStringList(source.value);
    if (entries === INVALID) return INVALID;
    for (const entry of entries) {
      if (seen.has(entry)) continue;
      seen.add(entry);
      refs.push(entry);
    }
  }
  return authored ? refs : undefined;
}

function projectAcceptance(value) {
  const source = ownDataValue(value, "acceptance");
  if (!source.present) return undefined;
  if (source.value === INVALID) return INVALID;

  const acceptance = {};
  if (source.present) {
    if (!isObject(source.value) || Array.isArray(source.value)) {
      return INVALID;
    }
    const criteria = ownDataValue(source.value, "criteria");
    const validation = ownDataValue(source.value, "validation");
    if (criteria.present) {
      acceptance.criteria = projectStringList(criteria.value);
      if (acceptance.criteria === INVALID) return INVALID;
    }
    if (validation.present) {
      acceptance.validation = projectAcceptanceValidationList(validation.value);
      if (acceptance.validation === INVALID) return INVALID;
    }
  }
  return acceptance;
}

export function projectSelectedWorkRecordUnit(value) {
  if (!isObject(value) || Array.isArray(value)) return null;

  const projected = {};
  if (!copyCanonicalScalar(projected, value, "id", (entry) =>
    isCanonicalString(entry) &&
    (WORK_RECORD_ID_PATTERN.test(entry) || SLICE_ID_PATTERN.test(entry))
  )) return null;
  if (!copyCanonicalScalar(projected, value, "title", isCanonicalString)) return null;
  if (!copyCanonicalScalar(projected, value, "status", (entry) =>
    WORK_RECORD_STATUS_VALUES.includes(entry)
  )) return null;
  if (!copyCanonicalScalar(projected, value, "priority", isCanonicalString)) return null;
  if (!copyCanonicalScalar(projected, value, "owner", isCanonicalString)) return null;
  if (!copyCanonicalScalar(projected, value, "work_kind", (entry) =>
    WORK_RECORD_WORK_KIND_VALUES.includes(entry)
  )) return null;
  if (!copyCanonicalScalar(projected, value, "review_purpose", (entry) =>
    WORK_RECORD_REVIEW_PURPOSE_VALUES.includes(entry)
  )) return null;

  const findings = analyzeWorkRecordFindingsUnit(projected);
  if (
    Object.hasOwn(projected, "review_purpose") &&
    findings.review_purpose_origin !== "authored"
  ) {
    return null;
  }
  if (findings.review_purpose_origin === "reviewer_default") {
    projected.review_purpose = findings.effective_review_purpose;
  }

  const acceptance = projectAcceptance(value);
  if (acceptance === INVALID) return null;
  if (acceptance !== undefined) projected.acceptance = acceptance;

  const readScope = projectReadScope(value);
  if (readScope === INVALID) return null;
  if (readScope !== undefined) projected.read_scope = readScope;

  for (const field of ["repo_paths", "write_scope", "depends_on"]) {
    if (!copyAuthored(projected, value, field, projectStringList)) return null;
  }
  for (const field of [
    "dispatch_intent",
    "activity_artifact_targets",
    "scenarios",
    "expected_edit_targets",
    "expected",
    "closure"
  ]) {
    if (!copyAuthored(projected, value, field)) return null;
  }
  if (!copyCanonicalScalar(
    projected,
    value,
    "expected_changed_line_budget",
    (entry) => entry === null || (Number.isInteger(entry) && entry >= 0)
  )) return null;

  const sectionsSource = ownDataValue(value, "sections");
  if (sectionsSource.present) {
    if (!isObject(sectionsSource.value) || Array.isArray(sectionsSource.value)) return null;
    if (ownDataValue(sectionsSource.value, "structured_validation").present) return null;
    const sections = {};
    if (!copyAuthored(sections, sectionsSource.value, "agent_notes", projectAgentNotes)) return null;
    projected.sections = sections;
  }

  const directAgentNotes = ownDataValue(value, "agent_notes");
  const sectionAgentNotes = sectionsSource.present && isObject(sectionsSource.value) &&
      !Array.isArray(sectionsSource.value)
    ? ownDataValue(sectionsSource.value, "agent_notes")
    : { present: false, value: undefined };
  if (directAgentNotes.present || sectionAgentNotes.present) {
    const source = directAgentNotes.present ? directAgentNotes.value : sectionAgentNotes.value;
    const agentNotes = projectAgentNotes(source);
    if (agentNotes === INVALID) return null;
    projected.agent_notes = agentNotes;
  }

  if (
    Object.hasOwn(projected, "agent_notes") &&
    Object.hasOwn(projected, "sections") &&
    Object.hasOwn(projected.sections, "agent_notes") &&
    agentNotesEqual(projected.agent_notes, projected.sections.agent_notes)
  ) {
    delete projected.sections.agent_notes;
  }

  return projected;
}

export function selectedUnitProjectionProbe(value, fields) {
  if (!isObject(value) || Array.isArray(value)) return value;
  const probe = {};
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (descriptor) Object.defineProperty(probe, field, descriptor);
  }
  return probe;
}

export const SELECTED_RECORD_MEMBER_PATH_MAX_SEGMENTS = 64;
export const SELECTED_RECORD_MEMBER_FIELDS = Object.freeze([
  "path", "offset", "limit", "length", "expected_source_digest"
]);

function isMemberIndex(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function memberDiagnostic(code, message, path, recoveryPath = null) {
  return { code, severity: "error", authority_limb: "mechanical", message, path,
    ...(recoveryPath === null ? {} : { recovery_member_path: recoveryPath }) };
}

export function selectedRecordMemberSelectorIssues(member) {
  if (!isObject(member) || Array.isArray(member)) {
    return [{ path: [], message: "member must be an object with path and optional offset, limit, length and expected_source_digest" }];
  }
  const issues = [];
  for (const key of Object.keys(member)) {
    if (!SELECTED_RECORD_MEMBER_FIELDS.includes(key)) {
      issues.push({ path: [key], message: `member does not support ${key}` });
    }
  }
  const path = ownDataValue(member, "path");
  if (!path.present || path.value === INVALID || !Array.isArray(path.value) || utilTypes.isProxy(path.value)) {
    issues.push({ path: ["path"], message: "member.path must be an array of own-key strings and array indexes" });
  } else {
    if (path.value.length > SELECTED_RECORD_MEMBER_PATH_MAX_SEGMENTS) {
      issues.push({ path: ["path"],
        message: `member.path accepts at most ${SELECTED_RECORD_MEMBER_PATH_MAX_SEGMENTS} segments` });
    }
    for (let index = 0; index < path.value.length; index += 1) {
      const segment = ownDataValue(path.value, String(index));
      if (!segment.present || (typeof segment.value !== "string" && !isMemberIndex(segment.value))) {
        issues.push({ path: ["path", index], message: "member.path segments are strings or nonnegative safe integers" });
      }
    }
  }
  const bounded = (field, minimum, maximum) => {
    const supplied = ownDataValue(member, field);
    if (!supplied.present) return;
    if (!Number.isSafeInteger(supplied.value) || supplied.value < minimum || supplied.value > maximum) {
      issues.push({ path: [field], message: `member.${field} must be an integer from ${minimum} to ${maximum}` });
    }
  };
  bounded("offset", 0, Number.MAX_SAFE_INTEGER);
  bounded("limit", 1, WORK_RECORD_ENTRY_METADATA_PAGE_MAX);
  bounded("length", 1, WORK_RECORD_ENTRY_BODY_PAGE_MAX_SCALARS);
  const digest = ownDataValue(member, "expected_source_digest");
  if (digest.present && (typeof digest.value !== "string" || !SHA256_PATTERN.test(digest.value))) {
    issues.push({ path: ["expected_source_digest"],
      message: "member.expected_source_digest must be the source_digest a member read returned" });
  }
  return issues;
}

function memberKind(value) {
  if (value === null) return "null";
  if (typeof value === "string") return "string";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return Number.isFinite(value) ? "number" : null;
  if (isObject(value)) return Array.isArray(value) ? "array" : "object";
  return null;
}

function scalarLength(text) {
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) index += 1;
    }
    count += 1;
  }
  return count;
}

function scalarWindow(text, start, count) {
  const scalars = [];
  let scalar = 0;
  for (let index = 0; index < text.length && scalars.length < count;) {
    const code = text.charCodeAt(index);
    const next = index + 1 < text.length ? text.charCodeAt(index + 1) : 0;
    const width = code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff ? 2 : 1;
    if (scalar >= start) scalars.push(text.slice(index, index + width));
    scalar += 1;
    index += width;
  }
  return scalars;
}

function describeMember(value) {
  const kind = memberKind(value);
  if (kind === "string") return { kind, length: scalarLength(value) };
  if (kind === "array") return { kind, count: value.length };
  if (kind === "object") return { kind, count: Object.keys(value).length };
  return { kind };
}

function resolveMember(root, path) {
  let current = root;
  for (let index = 0; index < path.length; index += 1) {
    const segment = path[index];
    const where = `member.path[${index}]`;
    const kind = memberKind(current);
    if (typeof segment === "number" ? kind !== "array" : kind !== "object") {
      return { diagnostic: memberDiagnostic("record_member_path_type_mismatch",
        `${where} ${typeof segment === "number" ? "indexes an array" : "names an object key"}, ` +
          `but the selected value is ${kind ?? "not a JSON value"}`,
        where, path.slice(0, index)) };
    }
    const descriptor = Object.getOwnPropertyDescriptor(current, String(segment));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value") ||
        (typeof segment === "number" && segment >= current.length)) {
      return { diagnostic: memberDiagnostic("record_member_path_missing",
        `${where} is not a member of the selected value`, where, path.slice(0, index)) };
    }
    current = descriptor.value;
  }
  return { value: current };
}

export function projectSelectedRecordMember({ value, member, sourceDigest = null, envelope = {}, buildCall }) {
  const path = member.path;
  const resolved = resolveMember(value, path);
  if (resolved.diagnostic) return { ok: false, diagnostic: resolved.diagnostic };
  const selected = resolved.value;
  const kind = memberKind(selected);

  const pinned = (selector) => buildCall(sourceDigest === null
    ? selector
    : { ...selector, expected_source_digest: sourceDigest });
  const refuse = (code, message, field) => ({ ok: false,
    diagnostic: memberDiagnostic(code, message, `member.${field}`, path) });
  if (kind === null) {
    return { ok: false, diagnostic: memberDiagnostic("record_member_value_unsupported",
      "the selected member is not a JSON value", "member.path") };
  }

  if (kind === "object" || kind === "array") {
    if (member.length !== undefined) {
      return refuse("record_member_selector_invalid",
        "length ranges a string member; a container pages with offset and limit", "length");
    }
    const keys = kind === "object" ? Object.keys(selected) : null;
    const total = keys === null ? selected.length : keys.length;
    const start = member.offset ?? 0;
    if (start > total) {
      return refuse("record_member_range_invalid", `offset ${start} is past the ${total} immediate members`, "offset");
    }
    const limit = member.limit ?? WORK_RECORD_ENTRY_METADATA_PAGE_DEFAULT;
    const rows = [];
    for (let position = start; position < Math.min(total, start + limit); position += 1) {
      const segment = keys === null ? position : keys[position];
      rows.push({ ...(keys === null ? { index: segment } : { key: segment }),
        ...describeMember(selected[segment]), next_call: pinned({ path: [...path, segment] }) });
    }
    const build = (count) => {
      const end = start + count;
      return { ...envelope,
        member: { path, kind, offset: start, total_count: total, returned_count: count, members: rows.slice(0, count) },
        next_calls: end < total
          ? [pinned({ path, offset: end, ...(member.limit === undefined ? {} : { limit: member.limit }) })]
          : [] };
    };
    const budget = member.limit === undefined
      ? WORK_RECORD_ENTRY_READ_TARGET_UTF8_BYTES
      : WORK_RECORD_COMPACT_RESULT_MAX_UTF8_BYTES;
    return { ok: true, result: fitReadPagePopulation(rows.length, build, budget) };
  }

  if (kind === "string") {
    if (member.limit !== undefined) {
      return refuse("record_member_selector_invalid",
        "limit pages a container; a string member accepts offset and length", "limit");
    }
    const total = scalarLength(selected);
    const start = member.offset ?? 0;
    if (start > total) {
      return refuse("record_member_range_invalid", `offset ${start} is past the ${total} scalars`, "offset");
    }
    const maximum = Math.min(member.length ?? WORK_RECORD_TEXT_PAGE_DEFAULT_SCALARS, total - start);
    const scalars = scalarWindow(selected, start, maximum);
    const build = (count) => {
      const end = start + count;
      return { ...envelope,
        member: { path, kind, offset: start, length: count, total, value: scalars.slice(0, count).join("") },
        next_calls: end < total
          ? [pinned({ path, offset: end, ...(member.length === undefined ? {} : { length: member.length }) })]
          : [] };
    };
    const budget = member.length === undefined
      ? WORK_RECORD_ENTRY_READ_TARGET_UTF8_BYTES
      : WORK_RECORD_COMPACT_RESULT_MAX_UTF8_BYTES;
    return { ok: true, result: fitReadPagePopulation(maximum, build, budget) };
  }

  for (const field of ["offset", "limit", "length"]) {
    if (member[field] !== undefined) {
      return refuse("record_member_selector_invalid",
        `${field} applies to container or string members; a ${kind} member is returned whole`, field);
    }
  }
  return { ok: true, result: { ...envelope, member: { path, kind, value: selected }, next_calls: [] } };
}

export function buildSelectedRecordMemberCall({
  tool, repository = null, identity, selectedSlice = null, member, recommended = false
}) {
  return buildNextCall({ tool,
    arguments: { ...(repository === null ? {} : { repo: repository }), ...identity,
      ...(selectedSlice === null ? {} : { selected_slice: selectedSlice }), member },
    ...(recommended ? { recommended: true } : {}) });
}
