

import {
  canonicalizeWorkRecordJson,
  computeWorkRecordSourceDigest,
  projectSliceReviewReceiptContracts,
  WORK_RECORD_CLOSURE_FIELD_NAMES
} from "@agent-chassis/wiki-core";
import {
  evaluateWorkRecordParentLifecycleContract
} from "@agent-chassis/wiki-core/src/lib/work-record-parent-lifecycle-contract.mjs";
import { isPlainObject } from "./backend-review-identity.mjs";
import { sameStringArray } from "./backend-scope-authority-shared.mjs";
import { readCanonicalWorkRecord } from "./backend-worker-scope-authority.mjs";

export function resolveCanonicalFindingsOnlyReviewUnit(mainRepo, wkId) {
  const record = readCanonicalWorkRecord(mainRepo, wkId);
  if (!record || record.id !== wkId) {
    throw new Error(`canonical ${wkId} record is unavailable for whole-WK review`);
  }
  return resolveCanonicalFindingsOnlyReviewUnitFromRecord(record, wkId);
}

function resolveCanonicalFindingsOnlyReviewUnitFromRecord(record, wkId) {
  const parentLifecycleContract = evaluateWorkRecordParentLifecycleContract(record);
  if (!parentLifecycleContract.complete) {
    const terminalMissing = parentLifecycleContract.missing_facts.includes("terminal_review_contract_unit");
    const terminalAmbiguous = parentLifecycleContract.ambiguous_facts.includes("terminal_review_contract_unit");
    const terminalCount = terminalMissing ? "0" : terminalAmbiguous ? "more than 1" : "unresolved";
    throw new Error(
      `canonical ${wkId} parent lifecycle contract is incomplete: ` +
      `missing [${parentLifecycleContract.missing_facts.join(", ")}], ` +
      `ambiguous [${parentLifecycleContract.ambiguous_facts.join(", ")}]; ` +
      `eligible findings-only review slices found ${terminalCount}`
    );
  }
  const slice = parentLifecycleContract.terminal_review_contract_unit;

  const contracts = projectSliceReviewReceiptContracts(record, slice.id);
  if (contracts.slice_review_contract === null) {
    throw new Error(`canonical ${wkId} findings-only review slice is absent from its own review contract projection`);
  }
  return Object.freeze({
    record_id: wkId,
    slice_id: slice.id,
    subject: `${wkId}#${slice.id}`,
    initiative: record.initiative,
    parent_status: record.status ?? null,
    canonical_parent_wk_contract: contracts.canonical_parent_wk_contract,
    review_unit_contract: contracts.slice_review_contract
  });
}

export const TERMINAL_REVIEW_LIFECYCLE_INADMISSIBLE_CODE =
  "agent_launch.terminal_review_lifecycle.inadmissible.v1";

const TERMINAL_REVIEW_LIFECYCLE_NEUTRALIZED =
  "\u0000agent_launch.terminal_review_lifecycle_neutralized\u0000";

const AUTHENTICATED_PARENT_TRANSITIONS = Object.freeze([
  Object.freeze(["todo", "review"]),
  Object.freeze(["active", "review"]),
  Object.freeze(["review", "review"])
]);
const AUTHENTICATED_REVIEW_UNIT_TRANSITIONS = Object.freeze([
  Object.freeze(["todo", "todo"]),
  Object.freeze(["todo", "review"]),
  Object.freeze(["review", "review"])
]);

const AUTHENTICATED_DEPENDENCY_TRANSITIONS = Object.freeze([
  Object.freeze(["todo", "done"]),
  Object.freeze(["review", "done"]),
  Object.freeze(["done", "done"])
]);
const DEPENDENCY_RECORD_ID_RE = /^WK-\d{4}$/u;
const DEPENDENCY_SLICE_ID_RE = /^SLICE-\d{3}$/u;
const TERMINAL_REVIEW_CLOSURE_NEUTRALIZED =
  "\u0000agent_launch.terminal_review_closure_neutralized\u0000";

function parseSameRecordSliceDependency(entry, recordId) {
  if (typeof entry !== "string" || entry.includes(":")) return null;
  const hashIndex = entry.indexOf("#");
  if (hashIndex === -1) {
    return DEPENDENCY_SLICE_ID_RE.test(entry) ? entry : null;
  }
  const declaredRecordId = entry.slice(0, hashIndex);
  const declaredSliceId = entry.slice(hashIndex + 1);
  if (!DEPENDENCY_RECORD_ID_RE.test(declaredRecordId) || declaredRecordId !== recordId ||
      !DEPENDENCY_SLICE_ID_RE.test(declaredSliceId)) {
    return null;
  }
  return declaredSliceId;
}

function isCanonicalCoordinationClosure(value) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value).sort();
  const expected = [...WORK_RECORD_CLOSURE_FIELD_NAMES].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    return false;
  }
  return typeof value.summary === "string" &&
    Array.isArray(value.validation) && value.validation.every((entry) => typeof entry === "string") &&
    Array.isArray(value.follow_ups) && value.follow_ups.every((entry) => typeof entry === "string");
}

function neutralizeAuthenticatedDependencyClosure(historicalDependency, liveDependency) {
  const historicalSections = historicalDependency.sections;
  const liveSections = liveDependency.sections;
  if (!isPlainObject(historicalSections) || !isPlainObject(liveSections)) return false;
  const historicalHasClosure = Object.hasOwn(historicalSections, "closure");
  const liveHasClosure = Object.hasOwn(liveSections, "closure");
  if (historicalHasClosure || !liveHasClosure) return false;
  if (!isCanonicalCoordinationClosure(liveSections.closure)) return false;
  historicalSections.closure = TERMINAL_REVIEW_CLOSURE_NEUTRALIZED;
  liveSections.closure = TERMINAL_REVIEW_CLOSURE_NEUTRALIZED;
  return true;
}

export function terminalReviewLifecycleRefusal(reason, detail = null) {
  const error = new Error(`terminal review coordination state is inadmissible: ${reason}`);
  error.code = TERMINAL_REVIEW_LIFECYCLE_INADMISSIBLE_CODE;
  error.terminal_review_lifecycle = Object.freeze({
    reason,
    ...(detail === null ? {} : { detail: Object.freeze({ ...detail }) })
  });
  return error;
}

export function isTerminalReviewLifecycleRefusal(error) {
  return error?.code === TERMINAL_REVIEW_LIFECYCLE_INADMISSIBLE_CODE;
}

function parseTerminalReviewParentContract(contract, reason) {
  if (typeof contract !== "string" || contract.length === 0) {
    throw terminalReviewLifecycleRefusal(reason);
  }
  let parsed;
  try {
    parsed = JSON.parse(contract);
  } catch (error) {
    throw terminalReviewLifecycleRefusal(reason, { message: error?.message ?? String(error) });
  }
  if (!isPlainObject(parsed)) throw terminalReviewLifecycleRefusal(reason);
  return parsed;
}

function findTerminalReviewContractSlice(parent, sliceId) {
  return parent.slices.find((entry) => isPlainObject(entry) && entry.id === sliceId) ?? null;
}

function neutralizeTerminalReviewLifecycle(parent, { recordId, reviewSliceId, side }) {
  if (parent.id !== recordId) {
    throw terminalReviewLifecycleRefusal(`${side}_contract_identity_mismatch`);
  }
  if (!Array.isArray(parent.slices)) {
    throw terminalReviewLifecycleRefusal(`${side}_contract_carries_no_slices`);
  }
  const unit = findTerminalReviewContractSlice(parent, reviewSliceId);
  if (unit === null) {
    throw terminalReviewLifecycleRefusal(`${side}_designated_review_unit_absent`);
  }
  const parentStatus = typeof parent.status === "string" ? parent.status : null;
  const unitStatus = typeof unit.status === "string" ? unit.status : null;

  parent.status = TERMINAL_REVIEW_LIFECYCLE_NEUTRALIZED;
  unit.status = TERMINAL_REVIEW_LIFECYCLE_NEUTRALIZED;
  return { normalized: parent, unit, parentStatus, unitStatus };
}

function neutralizeAuthenticatedTerminalReviewDependencies(historical, live, recordId, reviewSliceId) {
  const declared = historical.unit.depends_on;

  if (!Array.isArray(declared) || !sameStringArray(live.unit.depends_on, declared)) {
    return Object.freeze([]);
  }
  const authenticated = [];
  const derived = new Set();
  let authenticatedClosure = false;
  for (const entry of declared) {

    const sliceId = parseSameRecordSliceDependency(entry, recordId);
    if (sliceId === null || sliceId === reviewSliceId || derived.has(sliceId)) continue;
    derived.add(sliceId);
    const historicalDependency = findTerminalReviewContractSlice(historical.normalized, sliceId);
    const liveDependency = findTerminalReviewContractSlice(live.normalized, sliceId);

    if (historicalDependency === null || liveDependency === null ||
        historicalDependency.work_kind !== "implementation" ||
        liveDependency.work_kind !== "implementation") {
      continue;
    }
    const from = typeof historicalDependency.status === "string" ? historicalDependency.status : null;
    const to = typeof liveDependency.status === "string" ? liveDependency.status : null;
    if (!AUTHENTICATED_DEPENDENCY_TRANSITIONS.some(([f, t]) => f === from && t === to)) continue;
    const closureRequested = isPlainObject(historicalDependency.sections) &&
      isPlainObject(liveDependency.sections) &&
      !Object.hasOwn(historicalDependency.sections, "closure") &&
      Object.hasOwn(liveDependency.sections, "closure");
    if (closureRequested) {

      if (authenticatedClosure) continue;

      if (from !== "review" || to !== "done" ||
          !neutralizeAuthenticatedDependencyClosure(historicalDependency, liveDependency)) {
        continue;
      }
      authenticatedClosure = true;
    } else {
      neutralizeAuthenticatedDependencyClosure(historicalDependency, liveDependency);
    }
    historicalDependency.status = TERMINAL_REVIEW_LIFECYCLE_NEUTRALIZED;
    liveDependency.status = TERMINAL_REVIEW_LIFECYCLE_NEUTRALIZED;
    const historicalSections = isPlainObject(historicalDependency.sections)
      ? historicalDependency.sections
      : null;
    const historicalCarriesNoClosure = historicalSections === null ||
      historicalSections.closure === undefined || historicalSections.closure === null;
    const bothSectionsAbsent = !Object.hasOwn(historicalDependency, "sections") &&
      !Object.hasOwn(liveDependency, "sections");
    const liveCarriesClosure = isPlainObject(liveDependency.sections) &&
      Object.hasOwn(liveDependency.sections, "closure");
    if (historicalCarriesNoClosure && (bothSectionsAbsent || liveCarriesClosure)) {
      if (!isPlainObject(historicalDependency.sections)) historicalDependency.sections = {};
      if (!isPlainObject(liveDependency.sections)) liveDependency.sections = {};
      historicalDependency.sections.closure = TERMINAL_REVIEW_LIFECYCLE_NEUTRALIZED;
      liveDependency.sections.closure = TERMINAL_REVIEW_LIFECYCLE_NEUTRALIZED;
    }
    authenticated.push(Object.freeze({ slice_id: sliceId, from, to }));
  }
  return Object.freeze(authenticated);
}

function assertCanonicalTerminalReviewAddress(recordId, reviewSliceId) {
  if (typeof recordId !== "string" || !/^WK-\d{4}$/u.test(recordId) ||
      typeof reviewSliceId !== "string" || !/^SLICE-\d{3}$/u.test(reviewSliceId)) {
    throw terminalReviewLifecycleRefusal("addressed_unit_identity_is_not_canonical");
  }
}

export function assertAdmissibleLiveTerminalReviewCoordination({
  liveParentContract,
  recordId,
  reviewSliceId
} = {}) {
  assertCanonicalTerminalReviewAddress(recordId, reviewSliceId);
  const live = neutralizeTerminalReviewLifecycle(
    parseTerminalReviewParentContract(liveParentContract, "live_contract_unreadable"),
    { recordId, reviewSliceId, side: "live" }
  );
  if (!AUTHENTICATED_PARENT_TRANSITIONS.some(([, to]) => to === live.parentStatus)) {
    throw terminalReviewLifecycleRefusal("live_parent_status_not_review_admissible", {
      parent_status: live.parentStatus
    });
  }
  if (!AUTHENTICATED_REVIEW_UNIT_TRANSITIONS.some(([, to]) => to === live.unitStatus)) {
    throw terminalReviewLifecycleRefusal("live_review_unit_status_not_review_admissible", {
      review_unit_status: live.unitStatus
    });
  }
  return Object.freeze({ parent_status: live.parentStatus, review_unit_status: live.unitStatus });
}

export function normalizeAuthenticatedTerminalReviewLifecycleDelta({
  historicalParentContract,
  liveParentContract,
  recordId,
  reviewSliceId
} = {}) {
  assertCanonicalTerminalReviewAddress(recordId, reviewSliceId);
  const historical = neutralizeTerminalReviewLifecycle(
    parseTerminalReviewParentContract(historicalParentContract, "historical_contract_unreadable"),
    { recordId, reviewSliceId, side: "historical" }
  );
  const live = neutralizeTerminalReviewLifecycle(
    parseTerminalReviewParentContract(liveParentContract, "live_contract_unreadable"),
    { recordId, reviewSliceId, side: "live" }
  );
  const dependencies = neutralizeAuthenticatedTerminalReviewDependencies(
    historical,
    live,
    recordId,
    reviewSliceId
  );

  if (canonicalizeWorkRecordJson(live.normalized) !== canonicalizeWorkRecordJson(historical.normalized)) {
    throw terminalReviewLifecycleRefusal("authored_contract_changed_beyond_authenticated_transition");
  }
  if (!AUTHENTICATED_PARENT_TRANSITIONS.some(
    ([from, to]) => from === historical.parentStatus && to === live.parentStatus
  )) {
    throw terminalReviewLifecycleRefusal("parent_status_transition_unauthenticated", {
      from: historical.parentStatus,
      to: live.parentStatus
    });
  }
  if (!AUTHENTICATED_REVIEW_UNIT_TRANSITIONS.some(
    ([from, to]) => from === historical.unitStatus && to === live.unitStatus
  )) {
    throw terminalReviewLifecycleRefusal("review_unit_status_transition_unauthenticated", {
      from: historical.unitStatus,
      to: live.unitStatus
    });
  }
  return Object.freeze({
    parent: Object.freeze({ from: historical.parentStatus, to: live.parentStatus }),
    review_unit: Object.freeze({ from: historical.unitStatus, to: live.unitStatus }),

    dependencies
  });
}

export function resolveCanonicalTerminalReviewCoordinationState(mainRepo, wkId) {
  const record = readCanonicalWorkRecord(mainRepo, wkId);
  if (!record || record.id !== wkId) {
    throw terminalReviewLifecycleRefusal("live_canonical_record_unavailable", { record_id: wkId ?? null });
  }
  let unit;
  try {
    unit = resolveCanonicalFindingsOnlyReviewUnitFromRecord(record, wkId);
  } catch (error) {
    throw terminalReviewLifecycleRefusal("live_terminal_review_unit_unresolved", {
      message: error?.message ?? String(error)
    });
  }
  return Object.freeze({ unit, source_digest: computeWorkRecordSourceDigest(record) });
}
