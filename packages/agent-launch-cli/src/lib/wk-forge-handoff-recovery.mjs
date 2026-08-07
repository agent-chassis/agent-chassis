

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const same = (left, right) => canonical(left) === canonical(right);
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const terminalCards = (record) => (record?.slices ?? [])
  .filter((slice) => isObject(slice) && slice.review_purpose === "terminal_whole_wk");

export const localId = (id, recordId) => {
  if (typeof id !== "string") return null;
  const marker = id.indexOf("#");
  if (marker === -1) return id;
  return id.slice(0, marker) === recordId ? id.slice(marker + 1) : null;
};

const WORK_RECORD_DATE = /^\d{4}-\d{2}-\d{2}$/u;
export const isWorkRecordUpdatedDate = (value) =>
  typeof value === "string" && WORK_RECORD_DATE.test(value);

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
  return sameExcept(left, right, ["status"]);
}

function validRecord(value, id) {
  return isObject(value) && typeof id === "string" && value.id === id && Array.isArray(value.slices);
}

function firstCanonicalClosure(before, after) {
  if (!isObject(before) || !isObject(after) || before.sections?.closure !== undefined) return false;
  const closure = after.sections?.closure;
  if (!isObject(closure) || Object.keys(closure).sort().join("\0") !== "follow_ups\0summary\0validation") {
    return false;
  }
  return typeof closure.summary === "string" && Array.isArray(closure.validation) &&
    Array.isArray(closure.follow_ups) && closure.validation.every((entry) => typeof entry === "string") &&
    closure.follow_ups.every((entry) => typeof entry === "string");
}

export function authenticateTerminalReviewProjection({ candidateRecord, liveRecord } = {}) {
  const id = candidateRecord?.id;
  if (!validRecord(candidateRecord, id) || !validRecord(liveRecord, id)) {
    return { ok: false, reason: "record_identity_mismatch" };
  }
  if (!["active", "todo", "review"].includes(candidateRecord.status) || liveRecord.status !== "review") {
    return { ok: false, reason: "unsupported_parent_status" };
  }
  const before = terminalCards(candidateRecord);
  const after = terminalCards(liveRecord);
  if (before.length !== 1 || after.length !== 1 ||
      !["todo", "review"].includes(before[0].status) || after[0].status !== "review" ||
      !sameExcept(after[0], before[0], ["status"])) {
    return { ok: false, reason: "terminal_review_delta" };
  }
  if (candidateRecord.slices.length !== liveRecord.slices.length ||
      !sameExcept(liveRecord, candidateRecord, ["status", "slices"])) {
    return { ok: false, reason: "unrelated_record_drift" };
  }
  for (let index = 0; index < candidateRecord.slices.length; index += 1) {
    if (candidateRecord.slices[index] !== before[0] &&
        !same(candidateRecord.slices[index], liveRecord.slices[index])) {
      return { ok: false, reason: "unrelated_slice_drift" };
    }
  }
  return { ok: true, reviewRecord: liveRecord };
}

export function authenticateTerminalCloseoutProjection({ candidateRecord, liveRecord } = {}) {
  const id = candidateRecord?.id;
  if (!validRecord(candidateRecord, id) || !validRecord(liveRecord, id)) {
    return { ok: false, reason: "record_identity_mismatch" };
  }
  if (!["active", "todo", "review"].includes(candidateRecord.status) || liveRecord.status !== "review") {
    return { ok: false, reason: "unsupported_parent_status" };
  }
  const candidateTerminal = terminalCards(candidateRecord);
  const liveTerminal = terminalCards(liveRecord);
  if (candidateTerminal.length !== 1 || liveTerminal.length !== 1 ||
      !["todo", "review"].includes(candidateTerminal[0].status) ||
      liveTerminal[0].status !== "review" ||
      !sameExcept(liveTerminal[0], candidateTerminal[0], ["status"])) {
    return { ok: false, reason: "terminal_review_delta" };
  }
  if (!isWorkRecordUpdatedDate(candidateRecord.updated) ||
      !isWorkRecordUpdatedDate(liveRecord.updated) ||
      candidateRecord.updated === liveRecord.updated) {
    return { ok: false, reason: "updated_delta" };
  }
  const candidateById = new Map(candidateRecord.slices.map((slice) => [slice?.id, slice]));
  const liveById = new Map(liveRecord.slices.map((slice) => [slice?.id, slice]));
  const declared = [...new Set(candidateTerminal[0].depends_on ?? [])].map((id) => localId(id, candidateRecord.id)).filter((sliceId) => {
    const slice = candidateById.get(sliceId);
    return slice?.work_kind === "implementation" && ["todo", "review"].includes(slice.status);
  });
  if (declared.length !== 1) return { ok: false, reason: "preterminal_dependency_cardinality" };
  const dependencyId = declared[0];
  const before = candidateById.get(dependencyId);
  const after = liveById.get(dependencyId);
  if (!after || after.work_kind !== "implementation" || after.status !== "done" ||
      !firstCanonicalClosure(before, after) || !sameSliceExceptClosure(after, before)) {
    return { ok: false, reason: "preterminal_dependency_delta" };
  }
  if (candidateRecord.slices.length !== liveRecord.slices.length) return { ok: false, reason: "slice_cardinality" };
  for (const candidateSlice of candidateRecord.slices) {
    const liveSlice = liveById.get(candidateSlice?.id);
    if (!liveSlice) return { ok: false, reason: "slice_removed" };
    if (candidateSlice.id === dependencyId || candidateSlice.id === candidateTerminal[0].id) continue;
    if (!same(candidateSlice, liveSlice)) return { ok: false, reason: "unrelated_slice_drift" };
  }
  if (!sameExcept(liveRecord, candidateRecord, ["status", "updated", "slices"])) {
    return { ok: false, reason: "unrelated_record_drift" };
  }
  return { ok: true, dependency_id: dependencyId, reviewRecord: liveRecord };
}

export default authenticateTerminalCloseoutProjection;
