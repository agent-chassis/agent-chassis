

import {
  WORK_RECORD_COMPLETION_POLICY_VALUES,
  WORK_RECORD_STATUS_VALUES
} from "@agent-chassis/wiki-core/src/lib/work-record-schema-constants.mjs";
import { WORK_RECORD_FINDINGS_TECHNICAL_ROLE_BY_WORK_KIND } from
  "@agent-chassis/wiki-core/src/lib/work-record-findings-semantics.mjs";
import {
  preservesWorkRecordEntryHistory,
  validateWorkRecordEntries,
  validateWorkRecordEntryPopulation
} from "@agent-chassis/wiki-core/src/lib/work-record-entry-schema.mjs";

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const same = (left, right) => canonical(left) === canonical(right);
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isReviewConsumerSlice = (slice) => isObject(slice) && slice.review_purpose === "terminal_whole_wk";

const WORK_RECORD_DATE = /^\d{4}-\d{2}-\d{2}$/u;
export const isWorkRecordUpdatedDate = (value) =>
  typeof value === "string" && WORK_RECORD_DATE.test(value);

function admissibleUpdated(before, after) {
  return same(before, after) || (isWorkRecordUpdatedDate(before) && isWorkRecordUpdatedDate(after));
}

function sameExcept(value, other, excluded) {
  const left = { ...value };
  const right = { ...other };
  for (const key of excluded) { delete left[key]; delete right[key]; }
  return same(left, right);
}

function differingFields(value, other, excluded = [], prefix = "") {
  const keys = [...new Set([...Object.keys(value ?? {}), ...Object.keys(other ?? {})])]
    .filter((key) => !excluded.includes(key)).sort();
  return keys.flatMap((key) => {
    const left = value?.[key];
    const right = other?.[key];
    if (same(left, right)) return [];
    const path = `${prefix}${key}`;
    return isObject(left) && isObject(right) ? differingFields(left, right, [], `${path}.`) : [path];
  });
}

function withoutClosure(sections) {
  const copy = { ...(isObject(sections) ? sections : {}) };
  delete copy.closure;
  return copy;
}

const WORK_RECORD_STATUSES = new Set(WORK_RECORD_STATUS_VALUES);
const stringArray = (value) => Array.isArray(value) &&
  value.every((item) => typeof item === "string" && item.length > 0);
const CANONICAL_REVIEW_CONSUMER_SHAPE = Object.freeze([
  ["id", (slice) => typeof slice.id === "string" && /^SLICE-\d{3}$/u.test(slice.id)],
  ["title", (slice) => typeof slice.title === "string" && slice.title.length > 0],
  ["work_kind", (slice) => slice.work_kind === "review"],
  ["owner", (slice) => typeof slice.owner === "string" && slice.owner.length > 0],
  ["priority", (slice) => ["low", "medium", "high", "critical"].includes(slice.priority)],
  ["status", (slice) => WORK_RECORD_STATUSES.has(slice.status)],
  ["depends_on", (slice) => stringArray(slice.depends_on)],
  ["read_scope", (slice) => stringArray(slice.read_scope)],
  ["repo_paths", (slice) => stringArray(slice.repo_paths)],
  ["write_scope", (slice) => Array.isArray(slice.write_scope) && slice.write_scope.length === 0],
  ["dispatch_intent.intended_agent_role", (slice) =>
    slice.dispatch_intent?.intended_agent_role === WORK_RECORD_FINDINGS_TECHNICAL_ROLE_BY_WORK_KIND.review],
  ["dispatch_intent.target_unit", (slice) => slice.dispatch_intent?.target_unit === "slice"],
  ["acceptance.criteria", (slice) => stringArray(slice.acceptance?.criteria)],
  ["acceptance.validation", (slice) => stringArray(slice.acceptance?.validation)]
]);

function nonCanonicalReviewFields(slice) {
  return CANONICAL_REVIEW_CONSUMER_SHAPE.filter(([, holds]) => !holds(slice)).map(([field]) => field);
}

function reviewConsumerDelta(candidateRecord, liveRecord) {
  const drift = (slice_id, cause, fields = []) => ({
    ok: false, reason: "review_consumer_slice_drift", slice_id, cause, fields
  });
  const seen = new Set();
  for (const after of liveRecord.slices) {
    const id = isObject(after) ? after.id : undefined;
    if (seen.has(id)) return drift(id ?? null, "duplicate_slice_id", ["id"]);
    seen.add(id);
  }
  const byId = (slices, id) => slices.find((slice) => isObject(slice) && slice.id === id);
  for (const before of candidateRecord.slices.filter(isReviewConsumerSlice)) {
    const after = byId(liveRecord.slices, before.id);
    if (after === undefined) return drift(before.id, "candidate_review_removed");
    if (!isReviewConsumerSlice(after)) return drift(before.id, "review_purpose_changed", ["review_purpose"]);
    const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
      .filter((field) => !same(before[field], after[field]))
      .filter((field) => !(field === "status" && WORK_RECORD_STATUSES.has(after.status)) &&
        !(field === "updated" && admissibleUpdated(before.updated, after.updated)));
    if (fields.length > 0) return drift(before.id, "candidate_review_changed", fields);
  }
  for (const after of liveRecord.slices.filter(isReviewConsumerSlice)) {
    const before = byId(candidateRecord.slices, after.id);
    if (before !== undefined) {
      if (!isReviewConsumerSlice(before)) return drift(after.id, "review_purpose_changed", ["review_purpose"]);
      continue;
    }
    const fields = nonCanonicalReviewFields(after);
    if (fields.length > 0) return drift(after.id ?? null, "non_canonical_review_addition", fields);
  }
  return { ok: true };
}

function canonicalClosure(closure) {
  if (!isObject(closure) || Object.keys(closure).sort().join("\0") !== "follow_ups\0summary\0validation") {
    return false;
  }
  return typeof closure.summary === "string" && Array.isArray(closure.validation) &&
    Array.isArray(closure.follow_ups) && closure.validation.every((entry) => typeof entry === "string") &&
    closure.follow_ups.every((entry) => typeof entry === "string");
}

function isSliceCloseout(before, after, { deliveryAuthenticated = false } = {}) {
  const closure = after?.sections?.closure;
  if (!isObject(before) || !isObject(after) || before.id !== after.id ||
      before.work_kind !== "implementation" || after.work_kind !== "implementation" ||
      before.status === "done" || after.status !== "done" ||
      before.sections?.closure != null ||
      !(canonicalClosure(closure) || (deliveryAuthenticated && closure == null)) ||
      !admissibleUpdated(before.updated, after.updated)) return false;
  return same(withoutClosure(before.sections), withoutClosure(after.sections)) &&
    sameExcept(before, after, ["status", "updated", "sections",
      ...(deliveryAuthenticated ? ["integrated_delivery_sha"] : [])]);
}

function integratedDeliveryDelta(before, after, expected) {
  const beforeValue = before?.integrated_delivery_sha ?? null;
  const afterValue = isObject(after) && Object.hasOwn(after, "integrated_delivery_sha")
    ? after.integrated_delivery_sha
    : null;
  if (same(beforeValue, afterValue)) return { changed: false };
  const authenticated = beforeValue === null && isObject(expected) &&
    expected.slice_id === before?.id &&
    typeof afterValue === "string" && afterValue === expected.integrated_delivery_sha;
  return {
    changed: true,
    authenticated,
    refusal: {
      ok: false,
      reason: "integrated_delivery_unauthenticated",
      slice_id: before?.id ?? null,
      expected_slice_id: expected?.slice_id ?? null,
      expected_integrated_delivery_sha: expected?.integrated_delivery_sha ?? null,
      candidate_integrated_delivery_sha: beforeValue,
      observed_integrated_delivery_sha: afterValue
    }
  };
}

function entryAppend(before, after, path) {
  const prior = before?.sections?.entries;
  const next = after?.sections?.entries;
  if (same(prior, next)) return { appended: [] };
  const retained = prior === undefined ? [] : prior;
  if (!Array.isArray(retained) || !Array.isArray(next) || next.length <= retained.length ||
      retained.some((entry, index) => !same(entry, next[index]))) {
    return { refusal: { ok: false, reason: "entry_history_drift", unit: path } };
  }
  const diagnostics = validateWorkRecordEntries(next, { path: `${path}.sections.entries` });
  if (diagnostics.length > 0) return { refusal: entryAppendInvalid(diagnostics) };
  return { appended: next.slice(retained.length).map((entry) => entry.id) };
}

function entryAppendInvalid(diagnostics) {
  return {
    ok: false,
    reason: "entry_append_invalid",
    diagnostics: diagnostics.map(({ code, path }) => ({ code, path }))
  };
}

function withCandidateEntries(before, after) {
  if (!isObject(after) || !isObject(after.sections)) return after;
  const sections = { ...after.sections };
  if (isObject(before?.sections) && Object.hasOwn(before.sections, "entries")) {
    sections.entries = before.sections.entries;
  } else {
    delete sections.entries;
  }
  const copy = { ...after, sections };
  if (!isObject(before?.sections) && Object.keys(sections).length === 0) delete copy.sections;
  return copy;
}

function admitEntryAppends(candidateRecord, liveRecord) {
  const parent = entryAppend(candidateRecord, liveRecord, candidateRecord.id);
  if (parent.refusal) return parent;
  const appended = parent.appended.length > 0 ? [{ unit: candidateRecord.id, entry_ids: parent.appended }] : [];
  const slices = [];
  for (const after of liveRecord.slices) {
    const before = isObject(after)
      ? candidateRecord.slices.find((slice) => isObject(slice) && slice.id === after.id)
      : undefined;
    if (before === undefined) { slices.push(after); continue; }
    const unit = `${candidateRecord.id}#${before.id}`;
    const delta = entryAppend(before, after, unit);
    if (delta.refusal) return delta;
    if (delta.appended.length > 0) appended.push({ unit, entry_ids: delta.appended });
    slices.push(withCandidateEntries(before, after));
  }
  if (appended.length === 0) return { appended, comparable: liveRecord };
  const diagnostics = validateWorkRecordEntryPopulation(liveRecord);
  if (diagnostics.length > 0) return { refusal: entryAppendInvalid(diagnostics) };
  if (!preservesWorkRecordEntryHistory(candidateRecord, liveRecord)) {
    return { refusal: { ok: false, reason: "entry_append_invalid", diagnostics: [] } };
  }
  return { appended, comparable: { ...withCandidateEntries(candidateRecord, liveRecord), slices } };
}

const isNotesValue = (value) => typeof value === "string" ||
  (Array.isArray(value) && value.every((item) => typeof item === "string"));

function withCandidateNotes(before, after) {
  const prior = isObject(before?.sections) ? before.sections.agent_notes : undefined;
  const next = isObject(after?.sections) ? after.sections.agent_notes : undefined;
  if (same(prior, next) || !isNotesValue(next) || (prior !== undefined && !isNotesValue(prior))) {
    return { changed: false, unit: after };
  }
  const sections = { ...after.sections };
  if (prior === undefined) delete sections.agent_notes;
  else sections.agent_notes = prior;
  const copy = { ...after, sections };
  if (!isObject(before?.sections) && Object.keys(sections).length === 0) delete copy.sections;
  return { changed: true, unit: copy };
}

function admitNotes(candidateRecord, comparable) {
  const parent = withCandidateNotes(candidateRecord, comparable);
  const changed = parent.changed ? [candidateRecord.id] : [];
  const slices = comparable.slices.map((after) => {
    const before = isObject(after)
      ? candidateRecord.slices.find((slice) => isObject(slice) && slice.id === after.id)
      : undefined;
    if (before === undefined) return after;
    const notes = withCandidateNotes(before, after);
    if (!notes.changed) return after;
    changed.push(`${candidateRecord.id}#${before.id}`);
    return admissibleUpdated(before.updated, notes.unit.updated) && Object.hasOwn(before, "updated")
      ? { ...notes.unit, updated: before.updated }
      : notes.unit;
  });
  return { changed, comparable: { ...parent.unit, slices } };
}

const COMPLETION_POLICY = "completion_policy";
const COMPLETION_POLICIES = new Set(WORK_RECORD_COMPLETION_POLICY_VALUES);

function completionPolicyDelta(candidateRecord, liveRecord) {
  const established = Object.hasOwn(candidateRecord, COMPLETION_POLICY);
  const observed = Object.hasOwn(liveRecord, COMPLETION_POLICY);
  if (established ? observed && same(candidateRecord[COMPLETION_POLICY], liveRecord[COMPLETION_POLICY]) : !observed) {
    return { changed: false, comparable: liveRecord };
  }
  if (established || !COMPLETION_POLICIES.has(liveRecord[COMPLETION_POLICY])) {
    return { refusal: { ok: false, reason: "unrelated_record_drift", field: COMPLETION_POLICY } };
  }
  const { [COMPLETION_POLICY]: _introduced, ...comparable } = liveRecord;
  return { changed: true, comparable };
}

function preservesPublishedCloseout(candidateRecord, publishedRecord, liveRecord) {
  const id = candidateRecord.id;
  if (!isObject(publishedRecord) || publishedRecord.id !== id || !Array.isArray(publishedRecord.slices)) {
    return { ok: false, reason: "published_closeout_unavailable" };
  }
  const drift = (fields) => ({ ok: false, reason: "published_closeout_drift", unit: id, ...fields });
  const parent = entryAppend(publishedRecord, liveRecord, id);
  if (parent.refusal) return parent.refusal;
  if (Object.hasOwn(publishedRecord, COMPLETION_POLICY) &&
      !same(publishedRecord[COMPLETION_POLICY], liveRecord[COMPLETION_POLICY])) {
    return drift({ field: COMPLETION_POLICY });
  }
  const publishedClosure = publishedRecord.sections?.closure ?? null;
  if (publishedClosure !== null && !same(publishedClosure, liveRecord.sections?.closure ?? null)) {
    return drift({ field: "sections.closure" });
  }
  for (const published of publishedRecord.slices) {
    if (!isObject(published)) continue;
    const live = liveRecord.slices.find((slice) => isObject(slice) && slice.id === published.id);
    const unit = `${id}#${published.id}`;
    if (live === undefined) {
      if (Array.isArray(published.sections?.entries) && published.sections.entries.length > 0) {
        return { ok: false, reason: "entry_history_drift", unit };
      }
      continue;
    }
    const entries = entryAppend(published, live, unit);
    if (entries.refusal) return entries.refusal;
    const before = candidateRecord.slices.find((slice) => isObject(slice) && slice.id === published.id);
    const closedByPublished = published.work_kind === "implementation" && published.status === "done" &&
      before?.status !== "done";
    if (!closedByPublished) continue;
    for (const field of ["status", "integrated_delivery_sha"]) {
      if (!same(published[field] ?? null, live[field] ?? null)) return drift({ unit, field });
    }
    if (!same(published.sections?.closure ?? null, live.sections?.closure ?? null)) {
      return drift({ unit, field: "sections.closure" });
    }
  }
  return { ok: true };
}

export function authenticateWkCloseoutProjection({
  candidateRecord, liveRecord: observedRecord, integratedDelivery = null, publishedRecord = null
} = {}) {
  const id = candidateRecord?.id;
  if (!isObject(candidateRecord) || !isObject(observedRecord) || typeof id !== "string" ||
      observedRecord.id !== id || !Array.isArray(candidateRecord.slices) ||
      !Array.isArray(observedRecord.slices)) {
    return { ok: false, reason: "record_identity_mismatch" };
  }
  if (candidateRecord.status === "done" || observedRecord.status !== "review") {
    return { ok: false, reason: "unsupported_parent_status" };
  }
  if (!admissibleUpdated(candidateRecord.updated, observedRecord.updated)) {
    return { ok: false, reason: "updated_delta" };
  }
  const entries = admitEntryAppends(candidateRecord, observedRecord);
  if (entries.refusal) return entries.refusal;
  const notes = admitNotes(candidateRecord, entries.comparable);
  const policy = completionPolicyDelta(candidateRecord, notes.comparable);
  if (policy.refusal) return policy.refusal;
  const liveRecord = policy.comparable;

  const candidateClosure = candidateRecord.sections?.closure ?? null;
  const liveClosure = liveRecord.sections?.closure ?? null;
  if (!same(withoutClosure(candidateRecord.sections), withoutClosure(liveRecord.sections)) ||
      (candidateClosure !== null && !same(candidateClosure, liveClosure)) ||
      (liveClosure !== null && !canonicalClosure(liveClosure))) {
    return { ok: false, reason: "unrelated_sections_drift" };
  }

  const protectedDrift = differingFields(candidateRecord, liveRecord, ["status", "updated", "sections",
    "slices", "review_provenance", "derived_evidence", "projections"]);
  if (protectedDrift.length > 0) {

    return { ok: false, reason: "unrelated_record_drift", fields: protectedDrift };
  }

  const review = reviewConsumerDelta(candidateRecord, liveRecord);
  if (review.ok !== true) return review;
  const candidateReview = candidateRecord.slices.filter(isReviewConsumerSlice);
  const liveReview = liveRecord.slices.filter(isReviewConsumerSlice);

  const candidateOrdinary = candidateRecord.slices.filter((slice) => !isReviewConsumerSlice(slice));
  const liveOrdinary = liveRecord.slices.filter((slice) => !isReviewConsumerSlice(slice));
  if (candidateOrdinary.length !== liveOrdinary.length) return { ok: false, reason: "slice_cardinality" };
  let closedSliceId = null;
  let admittedDelivery = null;
  for (const [index, before] of candidateOrdinary.entries()) {
    const after = liveOrdinary[index];
    if (!isObject(after) || after.id !== before?.id) return { ok: false, reason: "slice_removed" };
    if (same(before, after)) continue;
    const delivery = integratedDeliveryDelta(before, after, integratedDelivery);
    if (delivery.changed && !delivery.authenticated) return delivery.refusal;
    if (closedSliceId !== null ||
        !isSliceCloseout(before, after, { deliveryAuthenticated: delivery.changed })) {
      return { ok: false, reason: "unrelated_slice_drift", slice_id: before.id };
    }
    closedSliceId = before.id;
    if (delivery.changed) admittedDelivery = integratedDelivery;
  }

  const closeoutChanged = candidateRecord.status !== liveRecord.status || closedSliceId !== null ||
    entries.appended.length > 0 || notes.changed.length > 0 || policy.changed ||
    !same(candidateRecord.sections?.closure, liveRecord.sections?.closure) ||
    !same(candidateReview, liveReview) ||
    !same(candidateRecord.review_provenance, liveRecord.review_provenance);
  if (!same(candidateRecord.updated, liveRecord.updated) && !closeoutChanged) {
    return { ok: false, reason: "updated_delta" };
  }
  if (publishedRecord !== null) {
    const preserved = preservesPublishedCloseout(candidateRecord, publishedRecord, observedRecord);
    if (preserved.ok !== true) return preserved;
  }
  return {
    ok: true,
    closed_slice_id: closedSliceId,
    integrated_delivery: admittedDelivery,
    appended_entries: entries.appended,
    replaced_notes: notes.changed,
    closeoutRecord: observedRecord
  };
}

export default authenticateWkCloseoutProjection;
