

import { isWorkRecordUpdatedDate } from "./wk-forge-handoff-recovery.mjs";

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

const TERMINAL = (record) => (record?.slices ?? []).filter((slice) => slice?.review_purpose === "terminal_whole_wk");
const same = (a, b) => canonical(a) === canonical(b);

function closureIsFirstCanonical(candidate, live) {
  const before = candidate?.sections?.closure;
  const after = live?.sections?.closure;
  if (before !== undefined) return false;
  if (!after || typeof after !== "object" || Array.isArray(after)) return false;
  const keys = Object.keys(after).sort();
  return same(keys, ["follow_ups", "summary", "validation"]) &&
    typeof after.summary === "string" && Array.isArray(after.validation) &&
    Array.isArray(after.follow_ups) && after.validation.every((item) => typeof item === "string") &&
    after.follow_ups.every((item) => typeof item === "string");
}

const localId = (id, recordId) => {
  const value = String(id);
  const marker = value.indexOf("#");
  if (marker === -1) return value;
  return value.slice(0, marker) === recordId ? value.slice(marker + 1) : null;
};

function sameExcept(value, other, excluded) {
  const left = { ...value };
  const right = { ...other };
  for (const key of excluded) { delete left[key]; delete right[key]; }
  return same(left, right);
}

function sameSliceExceptClosure(after, before) {
  const left = { ...after, sections: { ...(after?.sections ?? {}) } };
  const right = { ...before, sections: { ...(before?.sections ?? {}) } };
  delete left.sections.closure;
  delete right.sections.closure;
  return sameExcept(left, right, ["status", "updated"]);
}

export function authenticateTerminalCloseoutProjection({ candidateRecord, liveRecord } = {}) {
  if (!candidateRecord || !liveRecord || candidateRecord.id !== liveRecord.id) return { ok: false, reason: "record_identity_mismatch" };
  if (liveRecord.status !== "review" || !["active", "todo", "review"].includes(candidateRecord.status)) {
    return { ok: false, reason: "unsupported_parent_status" };
  }
  const candidateTerminal = TERMINAL(candidateRecord);
  const liveTerminal = TERMINAL(liveRecord);
  if (candidateTerminal.length !== 1 || liveTerminal.length !== 1) return { ok: false, reason: "terminal_review_cardinality" };
  const [candidateReview] = candidateTerminal;
  const [liveReview] = liveTerminal;
  if (!sameExcept(liveReview, candidateReview, ["status"]) || !["todo", "review"].includes(candidateReview.status) || liveReview.status !== "review") {
    return { ok: false, reason: "terminal_review_delta" };
  }
  const candidateById = new Map((candidateRecord.slices ?? []).map((slice) => [slice?.id, slice]));
  const liveById = new Map((liveRecord.slices ?? []).map((slice) => [slice?.id, slice]));
  const declared = [...new Set(candidateReview.depends_on ?? [])].map((id) => localId(id, candidateRecord.id)).filter((id) => {
    const slice = candidateById.get(id);
    return slice?.work_kind === "implementation" && ["todo", "review"].includes(slice.status);
  });
  if (declared.length !== 1) return { ok: false, reason: "preterminal_dependency_cardinality" };
  const dependencyId = declared[0];
  const before = candidateById.get(dependencyId);
  const after = liveById.get(dependencyId);
  if (!after || after.work_kind !== "implementation" || after.status !== "done" || !closureIsFirstCanonical(before, after) ||
      !isWorkRecordUpdatedDate(before.updated) || !isWorkRecordUpdatedDate(after.updated) ||
      before.updated === after.updated ||
      !sameSliceExceptClosure(after, before)) {
    return { ok: false, reason: "preterminal_dependency_delta" };
  }
  if ((candidateRecord.slices ?? []).length !== (liveRecord.slices ?? []).length) {
    return { ok: false, reason: "slice_cardinality" };
  }
  for (const candidateSlice of candidateRecord.slices ?? []) {
    const liveSlice = liveById.get(candidateSlice?.id);
    if (!liveSlice) return { ok: false, reason: "slice_removed" };
    if (candidateSlice.id === dependencyId || candidateSlice.id === candidateReview.id) continue;
    if (!same(candidateSlice, liveSlice)) return { ok: false, reason: "unrelated_slice_drift" };
  }
  if (!sameExcept(liveRecord, candidateRecord, ["status", "sections", "slices"])) return { ok: false, reason: "unrelated_record_drift" };
  const candidateSections = { ...(candidateRecord.sections ?? {}) };
  const liveSections = { ...(liveRecord.sections ?? {}) };
  delete candidateSections.closure;
  delete liveSections.closure;
  if (!same(candidateSections, liveSections)) return { ok: false, reason: "unrelated_sections_drift" };
  return { ok: true, dependency_id: dependencyId, reviewRecord: liveRecord };
}

export default authenticateTerminalCloseoutProjection;
