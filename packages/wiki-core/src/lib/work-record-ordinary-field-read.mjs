
import { WORK_RECORD_EDIT_FIELD_REGISTRY } from "./work-record-contract-edit.mjs";
import { encodeWorkRecordTextReference, findExactScalarMatches } from "./work-record-entry-content.mjs";
import {
  WORK_RECORD_AMBIGUITY_DEFAULT_CHOICES,
  WORK_RECORD_AMBIGUITY_MAX_CHOICES,
  checkedAdd,
  isUnicodeScalarString,
  validateSelectionLiteral
} from "./work-record-entry-schema.mjs";
import { selectTaskBySelector } from "./work-record-task-selection.mjs";
import { findSliceById, parseWorkRecordSummaryUnit,
  WORK_RECORD_SLICE_PAGE_DEFAULT_LIMIT, WORK_RECORD_SLICE_PAGE_MAX_LIMIT
} from "./work-record-summary.mjs";
import { SHA256_PATTERN } from "./work-record-schema-constants.mjs";

export const ORDINARY_FIELD_CODES = Object.freeze({
  INVALID: "selector_ordinary_field_invalid",
  RANGE_INVALID: "selector_ordinary_field_range_invalid",
  MISSING: "missing_ordinary_field",
  NO_MATCH: "ordinary_field_selection_no_match",
  AMBIGUOUS: "ordinary_field_selection_ambiguous"
});
export const ORDINARY_READ_FIELDS = Object.freeze([
  ...new Set(WORK_RECORD_EDIT_FIELD_REGISTRY
    .filter((entry) => entry.facade && entry.kind === "scalar" &&
      entry.value_schema?.entry_content === true)
    .map((entry) => entry.field)),
  "sections.tasks"
]);
const own = (value, key) => Object.hasOwn(value, key);
const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function selectionShapeIssues(selection, add) {
  if (!isObject(selection.selection)) {
    add(ORDINARY_FIELD_CODES.INVALID, "selection", "selection must be a closed object containing text");
    return;
  }
  const allowed = new Set(["text", "occurrence", "choice_limit"]);
  for (const key of Object.keys(selection.selection)) {
    if (!allowed.has(key)) add(ORDINARY_FIELD_CODES.INVALID, `selection.${key}`, "Unknown exact-selection argument");
  }
  const literalIssue = validateSelectionLiteral(selection.selection.text);
  if (literalIssue) add(literalIssue.code, "selection.text", literalIssue.message);
  if (own(selection.selection, "occurrence") &&
      (!Number.isSafeInteger(selection.selection.occurrence) || selection.selection.occurrence < 0)) {
    add(ORDINARY_FIELD_CODES.INVALID, "selection.occurrence", "selection.occurrence must be a nonnegative safe integer");
  }
  if (own(selection.selection, "choice_limit") &&
      (!Number.isSafeInteger(selection.selection.choice_limit) || selection.selection.choice_limit < 1 ||
       selection.selection.choice_limit > WORK_RECORD_AMBIGUITY_MAX_CHOICES)) {
    add(ORDINARY_FIELD_CODES.INVALID, "selection.choice_limit",
      `selection.choice_limit must be between 1 and ${WORK_RECORD_AMBIGUITY_MAX_CHOICES}`);
  }
}

export function ordinaryFieldSelectionIssues(selection, expectedSourceDigest) {
  const issues = [];
  const add = (code, key, message) => issues.push({ code,
    path: key === "expected_source_digest" ? [key] : ["ordinary_field", ...(key ? key.split(".") : [])], message });
  if (!isObject(selection) || !ORDINARY_READ_FIELDS.includes(selection.field)) {
    add(ORDINARY_FIELD_CODES.INVALID, "", `Select one of: ${ORDINARY_READ_FIELDS.join(", ")}`);
    return issues;
  }
  const task = selection.field === "sections.tasks";
  const individual = task && (own(selection, "index") || own(selection, "text"));
  const selectedText = task && individual && selection.member === "text";
  const enrolledText = !task || selectedText;
  const allowed = new Set(task ? individual
    ? ["field", "index", "text", "member", "offset", "length", "reference_only", "selection"]
    : selection.all === true ? ["field", "all"] : ["field", "offset", "limit"]
    : ["field", "offset", "length", "reference_only", "selection"]);
  for (const key of Object.keys(selection)) {
    if (!allowed.has(key)) add(ORDINARY_FIELD_CODES.INVALID, key, "Argument conflicts with the selected ordinary-field form");
  }
  if (own(selection, "index") && (!Number.isSafeInteger(selection.index) || selection.index < 0)) {
    add(ORDINARY_FIELD_CODES.INVALID, "index", "Task index must be a nonnegative integer");
  }
  if (own(selection, "text") && (typeof selection.text !== "string" || !selection.text.trim())) {
    add(ORDINARY_FIELD_CODES.INVALID, "text", "Task text must be nonempty");
  }
  if (own(selection, "index") && own(selection, "text")) {
    add(ORDINARY_FIELD_CODES.INVALID, "index", "Task index and text are mutually exclusive");
  }
  if (own(selection, "member") && !["index", "text", "status"].includes(selection.member)) {
    add(ORDINARY_FIELD_CODES.INVALID, "member", "Select index, text or status");
  }
  for (const key of ["offset", "limit", "length"]) {
    if (own(selection, key) && (!Number.isSafeInteger(selection[key]) || selection[key] < (key === "offset" ? 0 : 1))) {
      add(ORDINARY_FIELD_CODES.RANGE_INVALID, key, "Range coordinates must be nonnegative; length and limit must be positive integers");
    }
  }
  if (own(selection, "reference_only") && typeof selection.reference_only !== "boolean") {
    add(ORDINARY_FIELD_CODES.INVALID, "reference_only", "reference_only must be boolean");
  }
  if (own(selection, "selection")) selectionShapeIssues(selection, add);
  if (own(selection, "selection") && (own(selection, "offset") || own(selection, "length"))) {
    add(ORDINARY_FIELD_CODES.RANGE_INVALID, "selection", "selection is mutually exclusive with offset and length");
  }
  if (task && (own(selection, "reference_only") || own(selection, "selection")) && !selectedText) {
    add(ORDINARY_FIELD_CODES.INVALID, "member", "Task references and exact selection require one task selector with member:text");
  }
  if (individual && selection.member !== "text" && (own(selection, "offset") || own(selection, "length"))) {
    add(ORDINARY_FIELD_CODES.RANGE_INVALID, "member", "Only a text member supports scalar ranges");
  }
  if (!enrolledText && (own(selection, "reference_only") || own(selection, "selection"))) {
    add(ORDINARY_FIELD_CODES.INVALID, "reference_only", "This ordinary-field form is not an enrolled text source");
  }
  const requiresPin = own(selection, "index") || selection.offset > 0 ||
    own(selection.selection ?? {}, "occurrence");
  if (requiresPin && expectedSourceDigest == null) {
    add(ORDINARY_FIELD_CODES.RANGE_INVALID, "expected_source_digest",
      "Index selection, chosen occurrences and noninitial pages/ranges require source_digest");
  }
  return issues;
}

function referenceFactory({ repository, record, selectedUnit, sourceDigest, field, taskIndex, total }) {
  const sourceField = field === "sections.tasks" ? "sections.tasks.text" : field;
  return (offset, length) => encodeWorkRecordTextReference({
    repository,
    recordId: record.id,
    sliceId: selectedUnit.kind === "slice" ? selectedUnit.slice_id : null,
    field: sourceField,
    taskIndex,
    sourceDigest,
    offset,
    length,
    total
  });
}

function projectExactSelection({ projection, text, selection, makeRef }) {
  const { sourcePoints, literalPoints, matches } = findExactScalarMatches(text, selection.text);
  if (matches.length === 0) {
    projection.selection = { state: "no_match", occurrence_count: 0 };
    return { ok: false, code: ORDINARY_FIELD_CODES.NO_MATCH,
      message: "selection.text does not occur in the complete selected value" };
  }
  const choice = (offset, occurrence) => {
    const end = checkedAdd(offset, literalPoints.length);
    const beforeStart = Math.max(0, offset - 24);
    const afterEnd = Math.min(sourcePoints.length, end + 24);
    return {
      occurrence,
      offset,
      length: literalPoints.length,
      context_before: sourcePoints.slice(beforeStart, offset).join(""),
      context_after: sourcePoints.slice(end, afterEnd).join(""),
      before_ref: makeRef(0, offset),
      match_ref: makeRef(offset, literalPoints.length),
      after_ref: makeRef(end, sourcePoints.length - end)
    };
  };
  if (own(selection, "occurrence")) {
    if (selection.occurrence >= matches.length) {
      projection.selection = { state: "no_such_occurrence", occurrence_count: matches.length };
      return { ok: false, code: ORDINARY_FIELD_CODES.NO_MATCH,
        message: `selection.occurrence ${selection.occurrence} is outside ${matches.length} matches` };
    }
    const chosen = choice(matches[selection.occurrence], selection.occurrence);
    projection.selection = { state: "selected", occurrence_count: matches.length, ...chosen };
    return { ok: true };
  }
  if (matches.length === 1) {
    projection.selection = { state: "unique", occurrence_count: 1, ...choice(matches[0], 0) };
    return { ok: true };
  }
  const limit = Math.min(selection.choice_limit ?? WORK_RECORD_AMBIGUITY_DEFAULT_CHOICES, matches.length);
  projection.selection = {
    state: "ambiguous",
    occurrence_count: matches.length,
    returned_count: limit,
    has_more: limit < matches.length,
    choices: matches.slice(0, limit).map(choice)
  };
  return { ok: false, code: ORDINARY_FIELD_CODES.AMBIGUOUS,
    message: `selection.text has ${matches.length} overlapping-aware matches; choose one occurrence` };
}

export function projectOrdinaryFieldRead({
  loaded,
  unit = null,
  selection,
  expectedSourceDigest = null,
  repository = null
}) {
  const record = loaded?.record;
  const selectedUnit = typeof unit === "string" ? parseWorkRecordSummaryUnit(unit)
    : unit ?? parseWorkRecordSummaryUnit(record?.id);
  const result = { record_id: record?.id ?? loaded?.record_id ?? null,
    selected_unit: selectedUnit, source_digest: loaded?.source_digest ?? null,
    valid: false, ordinary_field: null, diagnostics: loaded?.diagnostics ?? [] };
  const refuse = (code, message, fieldPath, projection = null) => ({ ...result,
    ordinary_field: projection,
    diagnostics: [...result.diagnostics, { code, severity: "error", authority_limb: "mechanical", message, path: fieldPath }] });
  if (!record || loaded.valid !== true) return result;
  const target = selectedUnit?.kind === "slice" ? findSliceById(record, selectedUnit.slice_id) : record;
  if (!target) return { ...refuse("missing_slice", `Selected slice ${selectedUnit.slice_id} does not exist on ${record.id}`, "unit"), summary: null };
  const issues = ordinaryFieldSelectionIssues(selection, expectedSourceDigest);
  if (issues.length) return { ...result, diagnostics: issues.map(issue => ({ ...issue, severity: "error", authority_limb: "mechanical" })) };
  if (expectedSourceDigest !== null && !SHA256_PATTERN.test(expectedSourceDigest)) {
    return refuse("invalid_expected_source_digest", "expected_source_digest must be sha256:<64 lowercase hex>", "expected_source_digest");
  }
  if (expectedSourceDigest !== null && expectedSourceDigest !== result.source_digest) {
    return { ...refuse("stale_source_digest", "source digest does not match the current on-disk record", "expected_source_digest"),
      expected_source_digest: expectedSourceDigest, current_source_digest: result.source_digest };
  }
  const entry = WORK_RECORD_EDIT_FIELD_REGISTRY.find(entry => entry.field === selection.field &&
    entry.applicability.includes(selectedUnit?.kind === "slice" ? "slice" : "record"));
  if (!entry) return refuse(ORDINARY_FIELD_CODES.INVALID, "Field does not apply to selected unit", "ordinary_field.field");
  const value = entry.canonical_address.reduce((current, key) => current?.[key], target);
  const projection = { field: entry.field };
  const scalar = (text, taskIndex = null) => {
    if (!isUnicodeScalarString(text)) {
      return { ok: false, refusal: refuse("ordinary_field_source_unicode_invalid",
        "Selected source contains invalid Unicode rather than scalar text", entry.field) };
    }
    if (typeof repository !== "string" || repository.length === 0) {
      return { ok: false, refusal: refuse("ordinary_field_repository_identity_missing",
        "Configured repository identity is required to mint reusable references", "repo") };
    }
    const points = Array.from(text);
    const makeRef = referenceFactory({ repository, record, selectedUnit,
      sourceDigest: result.source_digest, field: entry.field, taskIndex, total: points.length });
    if (own(selection, "selection")) {
      const selected = projectExactSelection({ projection, text, selection: selection.selection, makeRef });
      if (!selected.ok) return { ok: false, refusal: refuse(selected.code, selected.message,
        "ordinary_field.selection.text", projection) };
      return { ok: true };
    }
    const offset = selection.offset ?? 0;

    const requested = selection.length ?? points.length;
    const end = Math.min(points.length, checkedAdd(offset, requested) ?? points.length);
    const length = offset >= points.length ? 0 : Math.max(0, end - offset);
    Object.assign(projection, {
      offset,
      length,
      total: points.length,
      reference: makeRef(Math.min(offset, points.length), length),
      has_more: offset + length < points.length,
      next_offset: offset + length < points.length ? offset + length : null,
      body_included: selection.reference_only !== true
    });
    if (selection.reference_only !== true) projection.value = points.slice(offset, end).join("");
    return { ok: true };
  };
  if (entry.kind === "scalar") {
    if (value === undefined) return refuse(ORDINARY_FIELD_CODES.MISSING, "Selected text field is absent", entry.field);
    const projected = scalar(value);
    if (!projected.ok) return projected.refusal;
  } else {
    if (!Array.isArray(value)) return refuse("missing_tasks", "selected unit has no tasks array", entry.field);
    if (own(selection, "index") || own(selection, "text")) {
      const selected = selectTaskBySelector({ tasks: value, index: selection.index, text: selection.text });
      if (!selected.ok) return refuse(selected.issue.code, selected.issue.message, selected.issue.path);
      const task = { index: selected.index, ...value[selected.index] };
      if (selection.member) {
        projection.member = selection.member;
        if (selection.member === "text") {
          const projected = scalar(task.text, selected.index);
          if (!projected.ok) return projected.refusal;
        } else projection.value = task[selection.member];
      } else projection.task = task;
    } else {
      const offset = selection.offset ?? 0;
      const limit = selection.all === true ? value.length
        : Math.min(selection.limit ?? WORK_RECORD_SLICE_PAGE_DEFAULT_LIMIT, WORK_RECORD_SLICE_PAGE_MAX_LIMIT);
      const tasks = value.slice(offset, offset + limit).map((task, index) => ({ index: offset + index, ...task }));
      Object.assign(projection, { tasks, offset, applied_limit: limit, total: value.length,
        returned_count: tasks.length, has_more: offset + tasks.length < value.length,
        next_offset: offset + tasks.length < value.length ? offset + tasks.length : null });
      if (selection.all === true) projection.all = true;
    }
  }
  return { ...result, valid: true, ordinary_field: projection };
}
