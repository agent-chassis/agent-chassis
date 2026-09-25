

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

function withoutClosure(sections) {
  const copy = { ...(isObject(sections) ? sections : {}) };
  delete copy.closure;
  return copy;
}

function isCanonicalReviewConsumerSlice(slice) {
  const stringArray = (value) => Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item.length > 0);
  const dispatchIntent = slice?.dispatch_intent;
  return isReviewConsumerSlice(slice) && typeof slice.id === "string" &&
    /^SLICE-\d{3}$/u.test(slice.id) && typeof slice.title === "string" &&
    slice.title.length > 0 && slice.work_kind === "review" &&
    typeof slice.owner === "string" && slice.owner.length > 0 &&
    ["low", "medium", "high", "critical"].includes(slice.priority) &&
    ["todo", "in_progress", "review", "done"].includes(slice.status) &&
    stringArray(slice.depends_on) && stringArray(slice.read_scope) &&
    stringArray(slice.repo_paths) && Array.isArray(slice.write_scope) &&
    slice.write_scope.length === 0 && isObject(dispatchIntent) &&
    dispatchIntent.intended_agent_role === "reviewer" &&
    dispatchIntent.target_unit === "slice" &&
    isObject(slice.acceptance) && stringArray(slice.acceptance.criteria) &&
    stringArray(slice.acceptance.validation);
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

export function authenticateWkCloseoutProjection({
  candidateRecord, liveRecord, integratedDelivery = null
} = {}) {
  const id = candidateRecord?.id;
  if (!isObject(candidateRecord) || !isObject(liveRecord) || typeof id !== "string" ||
      liveRecord.id !== id || !Array.isArray(candidateRecord.slices) ||
      !Array.isArray(liveRecord.slices)) {
    return { ok: false, reason: "record_identity_mismatch" };
  }
  if (candidateRecord.status === "done" || liveRecord.status !== "review") {
    return { ok: false, reason: "unsupported_parent_status" };
  }
  if (!admissibleUpdated(candidateRecord.updated, liveRecord.updated)) {
    return { ok: false, reason: "updated_delta" };
  }

  const candidateClosure = candidateRecord.sections?.closure ?? null;
  const liveClosure = liveRecord.sections?.closure ?? null;
  if (!same(withoutClosure(candidateRecord.sections), withoutClosure(liveRecord.sections)) ||
      (candidateClosure !== null && !same(candidateClosure, liveClosure)) ||
      (liveClosure !== null && !canonicalClosure(liveClosure))) {
    return { ok: false, reason: "unrelated_sections_drift" };
  }

  if (!sameExcept(liveRecord, candidateRecord, ["status", "updated", "sections", "slices",
    "review_provenance", "derived_evidence", "projections"])) {
    return { ok: false, reason: "unrelated_record_drift" };
  }

  const candidateReview = candidateRecord.slices.filter(isReviewConsumerSlice);
  const liveReview = liveRecord.slices.filter(isReviewConsumerSlice);
  if (candidateReview.length > 1 || liveReview.length > 1 ||
      (candidateReview.length === 1 && (liveReview.length !== 1 ||
        !sameExcept(liveReview[0], candidateReview[0], ["status"]))) ||
      (candidateReview.length === 0 && liveReview.length === 1 &&
        !isCanonicalReviewConsumerSlice(liveReview[0]))) {
    return { ok: false, reason: "review_consumer_slice_drift" };
  }

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
    !same(candidateRecord.sections?.closure, liveRecord.sections?.closure) ||
    !same(candidateReview, liveReview) ||
    !same(candidateRecord.review_provenance, liveRecord.review_provenance);
  if (!same(candidateRecord.updated, liveRecord.updated) && !closeoutChanged) {
    return { ok: false, reason: "updated_delta" };
  }
  return {
    ok: true,
    closed_slice_id: closedSliceId,
    integrated_delivery: admittedDelivery,
    closeoutRecord: liveRecord
  };
}

export default authenticateWkCloseoutProjection;
