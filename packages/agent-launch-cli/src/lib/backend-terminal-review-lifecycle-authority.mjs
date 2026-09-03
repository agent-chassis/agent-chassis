

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
import {
  assertProducerAuthenticatedIntegratedDeliveryProof,
  IntegratedDeliveryAuthenticationError
} from "./backend-integrated-scope-authority.mjs";
import { assertTerminalWkCandidateVersionDecision } from "./terminal-wk-candidate.mjs";

export const TERMINAL_REVIEW_VERSION_LIFECYCLE_PROJECTION_SCHEMA_VERSION =
  "agent_launch.terminal_review.version_lifecycle_projection.v1";

export function projectTerminalReviewCandidateVersionLifecycle({
  versionDecision,
  applicableReviewEvidence = false,
  blockedReason = null,
  reviewSubject = null
} = {}) {
  const decision = assertTerminalWkCandidateVersionDecision(versionDecision);
  const state = blockedReason !== null ||
      new Set(["conflict", "recovery", "unpublished"]).has(decision.state)
    ? "blocked"
    : decision.state === "superseded"
      ? "superseded"
      : applicableReviewEvidence === true
        ? "selected"
        : "unreviewed";
  const nextCall = state === "unreviewed" && typeof reviewSubject === "string"
    ? Object.freeze({
        tool: "workspace_agent_dispatch",
        arguments: Object.freeze({ role: "reviewer", assigned_unit: reviewSubject })
      })
    : state === "blocked" && decision.state === "recovery"
      ? Object.freeze({
          tool: "workspace_terminal_review_candidate_status",
          arguments: Object.freeze({ wk_id: decision.canonical_wk_id })
        })
      : null;
  return Object.freeze({
    schema_version: TERMINAL_REVIEW_VERSION_LIFECYCLE_PROJECTION_SCHEMA_VERSION,
    state,
    cause: blockedReason ?? (state === "blocked" ? decision.state : null),
    version_decision: decision,
    next_call: nextCall
  });
}

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

const AUTHENTICATED_DEPENDENCY_CLOSURE_TRANSITIONS = Object.freeze([
  Object.freeze(["review", "done"]),
  Object.freeze(["done", "done"])
]);
const DEPENDENCY_RECORD_ID_RE = /^WK-\d{4}$/u;
const DEPENDENCY_SLICE_ID_RE = /^SLICE-\d{3}$/u;
const TERMINAL_REVIEW_CLOSURE_NEUTRALIZED =
  "\u0000agent_launch.terminal_review_closure_neutralized\u0000";
const TERMINAL_REVIEW_COORDINATION_FACT_NEUTRALIZED =
  "\u0000agent_launch.terminal_review_coordination_fact_neutralized\u0000";

export const TERMINAL_REVIEW_LIFECYCLE_DECISION_SCHEMA_VERSION =
  "agent_launch.terminal_review_lifecycle.invariant_bound_decision.v1";

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

function dependencyClosureTransitionRequested(historicalDependency, liveDependency) {
  const historicalSectionsAbsent = !Object.hasOwn(historicalDependency, "sections");
  const historicalSections = historicalDependency.sections;
  const liveSections = liveDependency.sections;
  if ((!historicalSectionsAbsent && !isPlainObject(historicalSections)) ||
      !isPlainObject(liveSections)) return false;
  const historicalHasClosure = isPlainObject(historicalSections) &&
    Object.hasOwn(historicalSections, "closure");
  const liveHasClosure = Object.hasOwn(liveSections, "closure");
  if (!liveHasClosure || (historicalHasClosure && historicalSections.closure !== null)) {
    return false;
  }

  return !historicalHasClosure || liveSections.closure !== null;
}

function neutralizeAuthenticatedDependencyClosure(historicalDependency, liveDependency) {
  if (!dependencyClosureTransitionRequested(historicalDependency, liveDependency)) return false;
  const liveSections = liveDependency.sections;
  if (!isCanonicalCoordinationClosure(liveSections.closure)) return false;
  if (!isPlainObject(historicalDependency.sections)) historicalDependency.sections = {};
  const historicalSections = historicalDependency.sections;
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
    const closureRequested = dependencyClosureTransitionRequested(
      historicalDependency,
      liveDependency
    );
    if (closureRequested) {

      if (authenticatedClosure) continue;

      if (!AUTHENTICATED_DEPENDENCY_CLOSURE_TRANSITIONS.some(
        ([f, t]) => f === from && t === to
      ) || !neutralizeAuthenticatedDependencyClosure(historicalDependency, liveDependency)) {
        continue;
      }
      authenticatedClosure = true;
    }
    historicalDependency.status = TERMINAL_REVIEW_LIFECYCLE_NEUTRALIZED;
    liveDependency.status = TERMINAL_REVIEW_LIFECYCLE_NEUTRALIZED;
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

function prepareAuthenticatedTerminalReviewLifecycleComparison({
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
  return { historical, live, dependencies };
}

function assertAuthenticatedTerminalReviewStatuses(historical, live) {
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
}

function jsonValueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  return typeof value;
}

function jsonValuesEqual(historical, live) {
  const historicalType = jsonValueType(historical);
  if (historicalType !== jsonValueType(live)) return false;
  if (historicalType === "object" || historicalType === "array") return false;
  return JSON.stringify(historical) === JSON.stringify(live);
}

function collectAuthenticatedTerminalReviewDifferences(historical, live) {
  const differences = new Map();
  const add = (path, changeKind) => {
    const key = `${path}\u0000${changeKind}`;
    if (!differences.has(key)) differences.set(key, Object.freeze({ path, change_kind: changeKind }));
  };
  const pointerFor = (path, key) => `${path}/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`;
  const visit = (historicalValue, liveValue, path) => {
    const historicalType = jsonValueType(historicalValue);
    const liveType = jsonValueType(liveValue);
    if (historicalType !== liveType) {
      add(path, "replace");
      return;
    }
    if (historicalType === "array") {
      const sharedLength = Math.min(historicalValue.length, liveValue.length);
      for (let index = 0; index < sharedLength; index += 1) {
        const childHistorical = historicalValue[index];
        const childLive = liveValue[index];
        const childHistoricalType = jsonValueType(childHistorical);
        const childLiveType = jsonValueType(childLive);
        if ((childHistoricalType === "object" || childHistoricalType === "array") &&
            childHistoricalType === childLiveType) {
          visit(childHistorical, childLive, pointerFor(path, index));
        } else if (!jsonValuesEqual(childHistorical, childLive)) {
          add(pointerFor(path, index), "replace");
        }
      }
      for (let index = sharedLength; index < liveValue.length; index += 1) {
        add(pointerFor(path, index), "add");
      }
      for (let index = sharedLength; index < historicalValue.length; index += 1) {
        add(pointerFor(path, index), "remove");
      }
      return;
    }
    if (historicalType === "object") {
      const keys = new Set([...Object.keys(historicalValue), ...Object.keys(liveValue)]);
      for (const key of keys) {
        const childPath = pointerFor(path, key);
        const historicalHasKey = Object.hasOwn(historicalValue, key);
        const liveHasKey = Object.hasOwn(liveValue, key);
        if (!historicalHasKey) add(childPath, "add");
        else if (!liveHasKey) add(childPath, "remove");
        else {
          const childHistorical = historicalValue[key];
          const childLive = liveValue[key];
          const childHistoricalType = jsonValueType(childHistorical);
          const childLiveType = jsonValueType(childLive);
          if ((childHistoricalType === "object" || childHistoricalType === "array") &&
              childHistoricalType === childLiveType) {
            visit(childHistorical, childLive, childPath);
          } else if (!jsonValuesEqual(childHistorical, childLive)) {
            add(childPath, "replace");
          }
        }
      }
      return;
    }
    if (!jsonValuesEqual(historicalValue, liveValue)) add(path, "replace");
  };
  visit(historical, live, "");
  const changeKindOrder = { add: 0, remove: 1, replace: 2 };
  const compareCodePointStrings = (left, right) => {
    const leftCodePoints = Array.from(left, (character) => character.codePointAt(0));
    const rightCodePoints = Array.from(right, (character) => character.codePointAt(0));
    const sharedLength = Math.min(leftCodePoints.length, rightCodePoints.length);
    for (let index = 0; index < sharedLength; index += 1) {
      if (leftCodePoints[index] !== rightCodePoints[index]) {
        return leftCodePoints[index] - rightCodePoints[index];
      }
    }
    return leftCodePoints.length - rightCodePoints.length;
  };
  return Object.freeze([...differences.values()].sort((left, right) => {
    const pathOrder = compareCodePointStrings(left.path, right.path);
    return pathOrder === 0
      ? changeKindOrder[left.change_kind] - changeKindOrder[right.change_kind]
      : pathOrder;
  }));
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

function neutralizeOptionalCoordinationField(historical, live, field) {
  if (!Object.hasOwn(historical, field) && !Object.hasOwn(live, field)) return false;
  historical[field] = TERMINAL_REVIEW_COORDINATION_FACT_NEUTRALIZED;
  live[field] = TERMINAL_REVIEW_COORDINATION_FACT_NEUTRALIZED;
  return true;
}

function neutralizeCoordinationSections(historical, live) {
  const historicalSections = isPlainObject(historical.sections) ? historical.sections : {};
  const liveSections = isPlainObject(live.sections) ? live.sections : {};
  let changed = false;
  for (const field of ["closure"]) {
    changed = neutralizeOptionalCoordinationField(
      historicalSections,
      liveSections,
      field
    ) || changed;
  }
  if (!changed) return;
  historical.sections = historicalSections;
  live.sections = liveSections;
}

function coordinationChangeKind(historical, live, field) {
  const historicalHas = Object.hasOwn(historical, field);
  const liveHas = Object.hasOwn(live, field);
  if (!historicalHas && !liveHas) return null;
  if (!historicalHas) return "add";
  if (!liveHas) return "remove";
  return canonicalizeWorkRecordJson(historical[field]) === canonicalizeWorkRecordJson(live[field])
    ? null
    : "replace";
}

function collectNonAuthorizingCoordinationFacts(historical, live, recordId) {
  const facts = [];
  const addFields = (historicalOwner, liveOwner, prefix, addressedUnit = null) => {
    for (const field of ["status", "updated"]) {
      const changeKind = coordinationChangeKind(historicalOwner, liveOwner, field);
      if (changeKind !== null) facts.push(Object.freeze({
        canonical_path: `${prefix}/${field}`,
        change_kind: changeKind,
        kind: field === "status" ? "lifecycle_status" : "coordination_prose",
        ...(addressedUnit === null ? {} : { addressed_unit: addressedUnit }),
        authorizing: false
      }));
    }
    const historicalSections = isPlainObject(historicalOwner.sections)
      ? historicalOwner.sections
      : {};
    const liveSections = isPlainObject(liveOwner.sections) ? liveOwner.sections : {};
    for (const field of ["closure"]) {
      const changeKind = coordinationChangeKind(historicalSections, liveSections, field);
      if (changeKind !== null) facts.push(Object.freeze({
        canonical_path: `${prefix}/sections/${field}`,
        change_kind: changeKind,
        kind: "coordination_prose",
        ...(addressedUnit === null ? {} : { addressed_unit: addressedUnit }),
        authorizing: false
      }));
    }
  };
  addFields(historical, live, "");
  const liveById = new Map(live.slices.map((slice) => [slice?.id, slice]));
  for (let index = 0; index < historical.slices.length; index += 1) {
    const historicalSlice = historical.slices[index];
    const liveSlice = liveById.get(historicalSlice?.id);
    if (!isPlainObject(historicalSlice) || !isPlainObject(liveSlice)) continue;
    addFields(
      historicalSlice,
      liveSlice,
      `/slices/${index}`,
      `${recordId}#${historicalSlice.id}`
    );
  }
  return Object.freeze(facts);
}

function terminalReviewInvariantRefusal(reason, invariant, consequence, detail = null) {
  throw terminalReviewLifecycleRefusal(reason, {
    invariant,
    consequence,
    ...(detail === null ? {} : detail)
  });
}

function classifyInvariantDifference(differences) {
  const integratedDelivery = differences.find((entry) =>
    /\/integrated_delivery_sha$/u.test(entry.path));
  if (integratedDelivery !== undefined) {
    return {
      reason: "integrated_delivery_receipt_required",
      invariant: "integration_written_delivery_is_bound_to_its_producer_receipt",
      consequence:
        "the delivery present in the candidate cannot be authenticated against the accumulated WK tip"
    };
  }
  const authority = differences.find((entry) =>
    /\/(?:acceptance|read_scope|repo_paths|write_scope|expected_edit_targets|dispatch_intent|depends_on|work_kind)(?:\/|$)/u
      .test(entry.path));
  if (authority !== undefined) {
    return {
      reason: "executable_or_dependency_authority_changed",
      invariant: "executable_scope_acceptance_and_dependency_authority_remain_exact",
      consequence:
        "the frozen candidate no longer proves the implementation or review contract that would execute"
    };
  }
  return {
    reason: "canonical_authored_bytes_unauthenticated",
    invariant: "unclassified_authored_bytes_remain_exact",
    consequence:
      "the candidate/live difference has no authenticated producer and cannot be used as recovery authority"
  };
}

function exactSameRecordDependencyIds(historicalOwner, liveOwner, recordId) {
  const historical = historicalOwner?.depends_on;
  const live = liveOwner?.depends_on;
  if (!Array.isArray(historical) || !sameStringArray(live, historical)) return null;
  return historical.map((entry) => parseSameRecordSliceDependency(entry, recordId));
}

function resolveIntegratedDeliveryDependencyPaths(
  historicalRecord,
  liveRecord,
  recordId,
  reviewSliceId
) {
  const historicalTerminal = findTerminalReviewContractSlice(historicalRecord, reviewSliceId);
  const liveTerminal = findTerminalReviewContractSlice(liveRecord, reviewSliceId);
  const terminalDependencies = exactSameRecordDependencyIds(
    historicalTerminal,
    liveTerminal,
    recordId
  );
  if (terminalDependencies === null) return Object.freeze([]);
  const paths = [];
  for (const dependencyId of terminalDependencies) {
    if (dependencyId === null || dependencyId === reviewSliceId) continue;
    const historicalDependency = findTerminalReviewContractSlice(historicalRecord, dependencyId);
    const liveDependency = findTerminalReviewContractSlice(liveRecord, dependencyId);
    if (historicalDependency === null || liveDependency === null ||
        historicalDependency.work_kind !== liveDependency.work_kind) {
      continue;
    }
    if (historicalDependency.work_kind === "implementation") {
      paths.push(Object.freeze({
        kind: "direct_implementation",
        implementation_slice_id: dependencyId
      }));
      continue;
    }
    if (historicalDependency.work_kind !== "review") continue;
    const reviewDependencies = exactSameRecordDependencyIds(
      historicalDependency,
      liveDependency,
      recordId
    );
    if (reviewDependencies === null) continue;
    for (const implementationId of reviewDependencies) {
      if (implementationId === null || implementationId === reviewSliceId ||
          implementationId === dependencyId) {
        continue;
      }
      const historicalImplementation = findTerminalReviewContractSlice(
        historicalRecord,
        implementationId
      );
      const liveImplementation = findTerminalReviewContractSlice(liveRecord, implementationId);
      if (historicalImplementation?.work_kind !== "implementation" ||
          liveImplementation?.work_kind !== "implementation") {
        continue;
      }
      paths.push(Object.freeze({
        kind: "review_to_implementation",
        review_slice_id: dependencyId,
        implementation_slice_id: implementationId
      }));
    }
  }
  return Object.freeze(paths);
}

function neutralizeNonAuthorizingReviewDependencyContracts(
  historicalRecord,
  liveRecord,
  dependencyPaths
) {
  const reviewIds = new Set(dependencyPaths
    .filter((path) => path.kind === "review_to_implementation")
    .map((path) => path.review_slice_id));
  for (const reviewId of reviewIds) {
    const historicalIndex = historicalRecord.slices.findIndex((slice) => slice?.id === reviewId);
    const liveIndex = liveRecord.slices.findIndex((slice) => slice?.id === reviewId);
    if (historicalIndex < 0 || historicalIndex !== liveIndex) continue;
    const historical = historicalRecord.slices[historicalIndex];
    const live = liveRecord.slices[liveIndex];
    const project = (slice) => ({
      id: slice.id,
      work_kind: slice.work_kind,
      depends_on: slice.depends_on,
      ...(Object.hasOwn(slice, "title") ? { title: slice.title } : {}),
      ...(isPlainObject(slice.sections) && Object.hasOwn(slice.sections, "agent_notes")
        ? { sections: { agent_notes: slice.sections.agent_notes } }
        : {})
    });
    historicalRecord.slices[historicalIndex] = project(historical);
    liveRecord.slices[liveIndex] = project(live);
  }
}

function prepareInvariantBoundLifecycleDecision({
  historicalParentContract,
  liveParentContract,
  recordId,
  reviewSliceId,
  integratedDeliveryProof = null
}) {
  assertCanonicalTerminalReviewAddress(recordId, reviewSliceId);
  const historicalRecord = parseTerminalReviewParentContract(
    historicalParentContract,
    "historical_contract_unreadable"
  );
  const liveRecord = parseTerminalReviewParentContract(
    liveParentContract,
    "live_contract_unreadable"
  );
  if (historicalRecord.id !== recordId || liveRecord.id !== recordId) {
    terminalReviewInvariantRefusal(
      "canonical_record_identity_mismatch",
      "historical_and_live_contracts_identify_the_addressed_repository_record",
      "the lifecycle difference cannot be attributed to the addressed WK"
    );
  }
  if (!Array.isArray(historicalRecord.slices) || !Array.isArray(liveRecord.slices)) {
    terminalReviewInvariantRefusal(
      "canonical_slice_population_unavailable",
      "historical_and_live_contracts_carry_one_addressable_slice_population",
      "the designated review unit and implementation dependencies cannot be resolved"
    );
  }
  const historicalReview = findTerminalReviewContractSlice(historicalRecord, reviewSliceId);
  const liveReview = findTerminalReviewContractSlice(liveRecord, reviewSliceId);
  if (historicalReview === null || liveReview === null) {
    terminalReviewInvariantRefusal(
      "designated_review_unit_identity_mismatch",
      "the_exact_designated_review_unit_exists_on_both_canonical_contracts",
      "the supported terminal-review operation has no exact addressed unit"
    );
  }

  const parentTransition = Object.freeze({
    from: historicalRecord.status ?? null,
    to: liveRecord.status ?? null
  });
  const reviewTransition = Object.freeze({
    from: historicalReview.status ?? null,
    to: liveReview.status ?? null
  });
  const coordinationFacts = collectNonAuthorizingCoordinationFacts(
    historicalRecord,
    liveRecord,
    recordId
  );
  historicalRecord.status = TERMINAL_REVIEW_COORDINATION_FACT_NEUTRALIZED;
  liveRecord.status = TERMINAL_REVIEW_COORDINATION_FACT_NEUTRALIZED;
  neutralizeOptionalCoordinationField(historicalRecord, liveRecord, "updated");
  neutralizeCoordinationSections(historicalRecord, liveRecord);

  const dependencyTransitions = [];
  const declared = Array.isArray(historicalReview.depends_on)
    ? historicalReview.depends_on
    : [];
  const liveDeclared = Array.isArray(liveReview.depends_on) ? liveReview.depends_on : [];
  const declarationsExact = sameStringArray(declared, liveDeclared);
  const declaredImplementationIds = new Set();
  if (declarationsExact) {
    for (const entry of declared) {
      const sliceId = parseSameRecordSliceDependency(entry, recordId);
      if (sliceId !== null && sliceId !== reviewSliceId) declaredImplementationIds.add(sliceId);
    }
  }
  const integratedDeliveryDependencyPaths = resolveIntegratedDeliveryDependencyPaths(
    historicalRecord,
    liveRecord,
    recordId,
    reviewSliceId
  );
  for (const path of integratedDeliveryDependencyPaths) {
    declaredImplementationIds.add(path.implementation_slice_id);
  }
  neutralizeNonAuthorizingReviewDependencyContracts(
    historicalRecord,
    liveRecord,
    integratedDeliveryDependencyPaths
  );

  for (let index = 0; index < Math.max(historicalRecord.slices.length, liveRecord.slices.length); index += 1) {
    const historicalSlice = historicalRecord.slices[index];
    const liveSlice = liveRecord.slices[index];
    if (!isPlainObject(historicalSlice) || !isPlainObject(liveSlice) ||
        historicalSlice.id !== liveSlice.id) {
      continue;
    }
    const from = historicalSlice.status ?? null;
    const to = liveSlice.status ?? null;
    historicalSlice.status = TERMINAL_REVIEW_COORDINATION_FACT_NEUTRALIZED;
    liveSlice.status = TERMINAL_REVIEW_COORDINATION_FACT_NEUTRALIZED;
    neutralizeCoordinationSections(historicalSlice, liveSlice);
    if (declaredImplementationIds.has(historicalSlice.id) &&
        historicalSlice.work_kind === "implementation" &&
        liveSlice.work_kind === "implementation") {
      dependencyTransitions.push(Object.freeze({
        slice_id: historicalSlice.id,
        from,
        to
      }));
    }
  }

  let authenticatedDelivery = null;
  let authenticatedDeliveryDependencyPath = null;
  if (integratedDeliveryProof !== null) {
    try {
      authenticatedDelivery = assertProducerAuthenticatedIntegratedDeliveryProof(
        integratedDeliveryProof,
        { record_id: recordId }
      );
    } catch (error) {
      if (!(error instanceof IntegratedDeliveryAuthenticationError)) throw error;
      terminalReviewInvariantRefusal(
        "integrated_delivery_receipt_unauthenticated",
        "integration_written_delivery_is_bound_to_its_producer_receipt",
        error.integrated_delivery_authentication.consequence,
        { authentication_reason: error.integrated_delivery_authentication.reason }
      );
    }
    const matchingDependencyPaths = integratedDeliveryDependencyPaths.filter(
      (path) => path.implementation_slice_id === authenticatedDelivery.slice_id
    );
    if (matchingDependencyPaths.length === 0) {
      terminalReviewInvariantRefusal(
        "integrated_delivery_dependency_identity_mismatch",
        "producer_receipt_addresses_one_exact_canonical_implementation_dependency",
        "the delivery receipt cannot authorize a sibling, missing edge, caller-shaped linkage, or arbitrary transitive unit"
      );
    }
    if (matchingDependencyPaths.length !== 1) {
      terminalReviewInvariantRefusal(
        "integrated_delivery_dependency_chain_ambiguous",
        "producer_receipt_addresses_one_unambiguous_canonical_dependency_chain",
        "more than one canonical dependency path could attribute the delivery transition",
        { dependency_paths: matchingDependencyPaths }
      );
    }
    if (matchingDependencyPaths[0].kind === "review_to_implementation" &&
        integratedDeliveryDependencyPaths.length !== 1) {
      terminalReviewInvariantRefusal(
        "integrated_delivery_dependency_chain_ambiguous",
        "producer_receipt_addresses_one_unambiguous_canonical_dependency_chain",
        "a sibling review chain prevents attribution to one exact canonical linkage",
        { dependency_paths: integratedDeliveryDependencyPaths }
      );
    }
    authenticatedDeliveryDependencyPath = matchingDependencyPaths[0];
    const historicalIndex = historicalRecord.slices.findIndex(
      (entry) => entry?.id === authenticatedDelivery.slice_id
    );
    const liveIndex = liveRecord.slices.findIndex(
      (entry) => entry?.id === authenticatedDelivery.slice_id
    );
    if (historicalIndex < 0 || historicalIndex !== liveIndex ||
        authenticatedDelivery.canonical_path !==
          `/slices/${liveIndex}/integrated_delivery_sha`) {
      terminalReviewInvariantRefusal(
        "integrated_delivery_canonical_path_mismatch",
        "producer_receipt_names_the_exact_canonical_delivery_path",
        "the receipt cannot be applied to a moved or copied delivery field"
      );
    }
    const historicalSlice = historicalRecord.slices[historicalIndex];
    const liveSlice = liveRecord.slices[liveIndex];
    const historicalHas = Object.hasOwn(historicalSlice, "integrated_delivery_sha");
    const expectedHistorical = historicalHas ? historicalSlice.integrated_delivery_sha : "absent";
    if (!((!historicalHas && authenticatedDelivery.historical_value === "absent") ||
          (historicalHas && expectedHistorical === null &&
            authenticatedDelivery.historical_value === null)) ||
        liveSlice.integrated_delivery_sha !== authenticatedDelivery.integrated_delivery_sha) {
      terminalReviewInvariantRefusal(
        "integrated_delivery_transition_mismatch",
        "producer_receipt_binds_the_exact_absent_or_null_to_integrated_delivery_transition",
        "the live field is stale, copied, replaced, or belongs to another producer result"
      );
    }
    historicalSlice.integrated_delivery_sha = TERMINAL_REVIEW_COORDINATION_FACT_NEUTRALIZED;
    liveSlice.integrated_delivery_sha = TERMINAL_REVIEW_COORDINATION_FACT_NEUTRALIZED;
  }

  const historicalBytes = canonicalizeWorkRecordJson(historicalRecord);
  const liveBytes = canonicalizeWorkRecordJson(liveRecord);
  if (historicalBytes !== liveBytes) {
    const differences = collectAuthenticatedTerminalReviewDifferences(
      historicalRecord,
      liveRecord
    );
    const refusal = classifyInvariantDifference(differences);
    terminalReviewInvariantRefusal(
      refusal.reason,
      refusal.invariant,
      refusal.consequence,
      { differences }
    );
  }

  return Object.freeze({
    parent: parentTransition,
    review_unit: reviewTransition,
    dependencies: Object.freeze(dependencyTransitions),
    authenticated_delivery: authenticatedDelivery,
    authenticated_delivery_dependency_path: authenticatedDeliveryDependencyPath,
    coordination_facts: Object.freeze(coordinationFacts)
  });
}

export function decideAuthenticatedTerminalReviewLifecycleDelta(inputs = {}) {
  const decision = prepareInvariantBoundLifecycleDecision(inputs);
  return Object.freeze({
    schema_version: TERMINAL_REVIEW_LIFECYCLE_DECISION_SCHEMA_VERSION,
    decision: "admissible",
    authority_invariants: Object.freeze({
      canonical_record_identity: "exact",
      executable_and_dependency_authority: "exact",
      integrated_delivery:
        decision.authenticated_delivery === null ? "not_present" : "producer_authenticated"
    }),
    non_authorizing_coordination_facts: decision.coordination_facts,
    parent: decision.parent,
    review_unit: decision.review_unit,
    dependencies: decision.dependencies,
    ...(decision.authenticated_delivery === null
      ? {}
      : {
          integrated_delivery: decision.authenticated_delivery,
          integrated_delivery_dependency_path:
            decision.authenticated_delivery_dependency_path
        })
  });
}

export function normalizeAuthenticatedTerminalReviewLifecycleDelta({
  historicalParentContract,
  liveParentContract,
  recordId,
  reviewSliceId,
  integratedDeliveryProof = null,
  decisionMode = null
} = {}) {
  if (decisionMode === "invariant_bound" || integratedDeliveryProof !== null) {
    return decideAuthenticatedTerminalReviewLifecycleDelta({
      historicalParentContract,
      liveParentContract,
      recordId,
      reviewSliceId,
      integratedDeliveryProof
    });
  }
  const { historical, live, dependencies } = prepareAuthenticatedTerminalReviewLifecycleComparison({
    historicalParentContract,
    liveParentContract,
    recordId,
    reviewSliceId
  });

  if (canonicalizeWorkRecordJson(live.normalized) !== canonicalizeWorkRecordJson(historical.normalized)) {
    throw terminalReviewLifecycleRefusal("authored_contract_changed_beyond_authenticated_transition");
  }
  assertAuthenticatedTerminalReviewStatuses(historical, live);
  return Object.freeze({
    parent: Object.freeze({ from: historical.parentStatus, to: live.parentStatus }),
    review_unit: Object.freeze({ from: historical.unitStatus, to: live.unitStatus }),

    dependencies
  });
}

export function projectAuthenticatedTerminalReviewAuthoredDifferences({
  historicalParentContract,
  liveParentContract,
  recordId,
  reviewSliceId
} = {}) {
  const { historical, live } = prepareAuthenticatedTerminalReviewLifecycleComparison({
    historicalParentContract,
    liveParentContract,
    recordId,
    reviewSliceId
  });
  if (canonicalizeWorkRecordJson(live.normalized) === canonicalizeWorkRecordJson(historical.normalized)) {
    assertAuthenticatedTerminalReviewStatuses(historical, live);
    return Object.freeze([]);
  }
  return collectAuthenticatedTerminalReviewDifferences(historical.normalized, live.normalized);
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

export function resolveCanonicalTerminalReviewCoordinationStateForInvariantDecision(
  mainRepo,
  wkId,
  reviewSliceId
) {
  assertCanonicalTerminalReviewAddress(wkId, reviewSliceId);
  const record = readCanonicalWorkRecord(mainRepo, wkId);
  if (!record || record.id !== wkId || !Array.isArray(record.slices)) {
    throw terminalReviewLifecycleRefusal("live_canonical_record_unavailable", {
      record_id: wkId ?? null
    });
  }
  const slice = findTerminalReviewContractSlice(record, reviewSliceId);
  if (!isPlainObject(slice) || slice.work_kind !== "review") {
    throw terminalReviewLifecycleRefusal("live_terminal_review_unit_unresolved", {
      record_id: wkId,
      review_slice_id: reviewSliceId
    });
  }
  const contracts = projectSliceReviewReceiptContracts(record, reviewSliceId);
  if (contracts.slice_review_contract === null) {
    throw terminalReviewLifecycleRefusal("live_terminal_review_unit_unresolved", {
      record_id: wkId,
      review_slice_id: reviewSliceId
    });
  }
  return Object.freeze({
    unit: Object.freeze({
      record_id: wkId,
      slice_id: reviewSliceId,
      subject: `${wkId}#${reviewSliceId}`,
      initiative: record.initiative,
      parent_status: record.status ?? null,
      canonical_parent_wk_contract: contracts.canonical_parent_wk_contract,
      review_unit_contract: contracts.slice_review_contract
    }),
    source_digest: computeWorkRecordSourceDigest(record)
  });
}
