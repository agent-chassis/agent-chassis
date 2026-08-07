

import {
  canonicalizeWorkRecordJson,
  computeWorkRecordSourceDigest,
  projectSliceReviewReceiptContracts
} from "@agent-chassis/wiki-core";
import { validateWorkRecord } from "@agent-chassis/wiki-core/src/lib/work-record-schema.mjs";
import { EXACT_IMPLEMENTATION_SLICE_RE } from "./backend-constants.mjs";
import { isPlainObject } from "./backend-review-identity.mjs";
import { deepFreezeCanonicalSnapshot } from "./backend-scope-authority-shared.mjs";
import { readCanonicalWorkRecord } from "./backend-worker-scope-authority.mjs";
import { resolveFrozenSliceReviewReceiptContract } from "./backend-slice-review-authority.mjs";

const TRUSTED_REVIEW_RECEIPT_GROUP_KEY_FIELDS = Object.freeze([
  "record_id", "slice_id", "initiative", "slice_ref",
  "reviewed_sha", "diff_base_sha", "committed_target_digest",
  "canonical_parent_contract_digest", "slice_review_contract_digest",
  "canonical_parent_wk_contract", "slice_review_contract"
]);

export function trustedReviewReceiptGroupKey(receipt) {
  return JSON.stringify(
    TRUSTED_REVIEW_RECEIPT_GROUP_KEY_FIELDS.map((field) => receipt?.[field] ?? null)
  );
}

export function groupTrustedReviewReceiptsByReviewedIdentity(receipts) {
  const grouped = new Map();
  for (const receipt of receipts) {
    const key = trustedReviewReceiptGroupKey(receipt);
    const existing = grouped.get(key);
    if (existing === undefined) grouped.set(key, [receipt]);
    else existing.push(receipt);
  }
  return Object.freeze([...grouped.values()].map((members) => Object.freeze({
    receipts: Object.freeze([...members]),
    witness: members[0]
  })));
}

const INTEGRATED_LIFECYCLE_NEUTRALIZED =
  "\u0000agent_launch.integrated_lifecycle_neutralized\u0000";
const INTEGRATED_SIBLING_GENERATED_FIELDS = Object.freeze(["derived_evidence", "projections"]);

function normalizeIntegratedLifecycleContract(parentContract, sliceId) {
  if (!isPlainObject(parentContract)) {
    throw new Error("canonical integrated contract projection is not a work record");
  }
  parentContract.status = INTEGRATED_LIFECYCLE_NEUTRALIZED;
  if (!Array.isArray(parentContract.slices)) {
    throw new Error("canonical integrated contract projection carries no slices");
  }
  let target = null;
  for (const entry of parentContract.slices) {
    if (!isPlainObject(entry)) continue;
    const isTarget = entry.id === sliceId;
    if (isTarget) target = entry;

    entry.status = INTEGRATED_LIFECYCLE_NEUTRALIZED;
    const sections = isPlainObject(entry.sections) ? entry.sections : {};
    sections.agent_notes = INTEGRATED_LIFECYCLE_NEUTRALIZED;
    entry.sections = sections;

    if (isTarget) continue;
    for (const field of INTEGRATED_SIBLING_GENERATED_FIELDS) delete entry[field];
  }
  if (target === null) {
    throw new Error("canonical integrated slice is absent from the frozen receipt contract");
  }
  return parentContract;
}

function deepCloneCanonicalProjection(value) {
  return JSON.parse(JSON.stringify(value));
}

export const CANONICAL_INTEGRATED_CONTRACT_CLASSIFICATIONS = Object.freeze({
  HISTORICAL_FROZEN_CONTRACT_UNCHANGED:
    "historical_frozen_contract_unchanged",
  CORRECTIVE_CURRENT_CONTRACT_REQUIRES_FRESH_IDENTITY:
    "corrective_current_contract_requires_fresh_identity"
});

function compareIntegratedContracts(currentRecord, frozenReviewUnit, sliceId, currentProjection = null) {

  const frozenNormalized = normalizeIntegratedLifecycleContract(
    deepCloneCanonicalProjection(JSON.parse(frozenReviewUnit.canonical_parent_wk_contract)),
    sliceId
  );
  const currentNormalized = normalizeIntegratedLifecycleContract(
    deepCloneCanonicalProjection(
      currentProjection ?? projectSliceReviewReceiptContracts(currentRecord, sliceId).parent
    ),
    sliceId
  );
  return canonicalizeWorkRecordJson(currentNormalized) ===
    canonicalizeWorkRecordJson(frozenNormalized);
}

function readValidatedCanonicalWorkRecord(mainRepo, wkId) {
  const record = readCanonicalWorkRecord(mainRepo, wkId);
  if (record === null) {
    throw new Error(`canonical ${wkId} record is unavailable for integrated contract classification`);
  }

  const snapshot = deepFreezeCanonicalSnapshot(record);
  const sourcePath = `wiki/work-records/${wkId}.json`;
  const diagnostics = validateWorkRecord(snapshot, {
    sourcePath,
    sourceDigest: computeWorkRecordSourceDigest(snapshot)
  });
  if (diagnostics.length !== 0) {
    throw new Error("canonical work-record validation refused the current record", {
      cause: diagnostics
    });
  }
  return snapshot;
}

function resolveCanonicalIntegratedSliceStateFromRecord(record, subject, frozenContract = null) {
  const match = typeof subject === "string" ? subject.match(EXACT_IMPLEMENTATION_SLICE_RE) : null;
  if (!match) throw new Error("integrated slice subject is not canonical");
  if (!isPlainObject(record) || record.id !== match[1] ||
      !/^IN-\d{4}$/u.test(record.initiative ?? "") || !Array.isArray(record.slices)) {
    throw new Error("canonical integrated slice identity is unavailable");
  }
  const slice = record.slices.find((entry) => entry?.id === match[2]);
  if (!isPlainObject(slice) || slice.work_kind !== "implementation") {
    throw new Error("canonical integrated slice identity is unavailable");
  }
  const incompleteSiblings = record.slices.filter((entry) =>
    entry?.id !== match[2] && entry?.work_kind === "implementation" &&
    entry.status !== "done" && entry.status !== "cancelled"
  );
  const corrective = slice.status === "todo";
  const final = !corrective && record.status === "review";
  if (corrective) {
    if (record.status === "review") throw new Error("canonical corrective integrated slice state is inconsistent");
  } else if (final) {
    if (incompleteSiblings.length !== 0 || (slice.status !== "review" && slice.status !== "done")) {
      throw new Error("canonical final integrated slice state is inconsistent");
    }
  } else if (slice.status !== "done" || incompleteSiblings.length === 0) {
    throw new Error("canonical non-final integrated slice state is inconsistent");
  }
  if (frozenContract !== null && !compareIntegratedContracts(record, frozenContract, match[2])) {
    throw new Error("canonical integrated state changed beyond the permitted lifecycle transition");
  }
  return Object.freeze({
    record_id: match[1], slice_id: match[2], initiative: record.initiative,
    final, corrective, lifecycle_state: corrective ? "corrective" : final ? "final" : "non_final",
    parent_status: record.status, slice_status: slice.status
  });
}

export const CANONICAL_INTEGRATED_LIFECYCLE_STATE_IMPOSSIBLE_CODE =
  "agent_launch.canonical_integrated_lifecycle_state.impossible.v1";

const CANONICAL_INTEGRATED_LIFECYCLE_STATE_IMPOSSIBLE_MESSAGE =
  "canonical integrated lifecycle state is impossible";

export class CanonicalIntegratedLifecycleStateError extends Error {
  constructor({ record_id, slice_id, parent_status, slice_status }) {
    super(CANONICAL_INTEGRATED_LIFECYCLE_STATE_IMPOSSIBLE_MESSAGE);
    this.name = "CanonicalIntegratedLifecycleStateError";
    this.code = CANONICAL_INTEGRATED_LIFECYCLE_STATE_IMPOSSIBLE_CODE;
    this.observed = Object.freeze({ record_id, slice_id, parent_status, slice_status });
  }
}

function classifyValidatedCanonicalIntegratedSliceState(record, subject) {
  const match = typeof subject === "string" ? subject.match(EXACT_IMPLEMENTATION_SLICE_RE) : null;
  if (!match || !isPlainObject(record) || record.id !== match[1]) {
    throw new Error("canonical integrated slice identity is unavailable");
  }
  const slice = record.slices.find((entry) => entry?.id === match[2]);
  if (!isPlainObject(slice) || slice.work_kind !== "implementation") {
    throw new Error("canonical integrated slice identity is unavailable");
  }
  const incompleteImplementationSiblings = record.slices.filter((entry) =>
    entry?.id !== match[2] && entry?.work_kind === "implementation" &&
    entry.status !== "done" && entry.status !== "cancelled"
  );
  const corrective = record.status === "active" && slice.status === "todo";
  const nonFinal = record.status === "active" && slice.status === "done" &&
    incompleteImplementationSiblings.length > 0;
  const final = record.status === "review" &&
    (slice.status === "review" || slice.status === "done") &&
    incompleteImplementationSiblings.length === 0;
  if (!corrective && !nonFinal && !final) {

    throw new CanonicalIntegratedLifecycleStateError({
      record_id: match[1],
      slice_id: match[2],
      parent_status: record.status,
      slice_status: slice.status
    });
  }
  return Object.freeze({
    record_id: match[1],
    slice_id: match[2],
    initiative: record.initiative,
    final,
    corrective,
    lifecycle_state: corrective ? "corrective" : final ? "final" : "non_final",
    parent_status: record.status,
    slice_status: slice.status
  });
}

export function classifyCanonicalIntegratedSliceContract(mainRepo, subject, frozenContract) {
  const match = typeof subject === "string" ? subject.match(EXACT_IMPLEMENTATION_SLICE_RE) : null;
  if (!match) throw new Error("integrated slice subject is not canonical");
  const frozenReviewUnit = resolveFrozenSliceReviewReceiptContract(frozenContract);
  if (frozenReviewUnit.subject !== subject || frozenReviewUnit.record_id !== match[1] ||
      frozenReviewUnit.slice_id !== match[2]) {
    throw new Error("exact slice review receipt does not identify the requested integrated slice");
  }
  const record = readValidatedCanonicalWorkRecord(mainRepo, match[1]);
  const currentState = classifyValidatedCanonicalIntegratedSliceState(record, subject);
  const currentProjection = projectSliceReviewReceiptContracts(record, match[2]).parent;
  const unchanged = compareIntegratedContracts(record, frozenReviewUnit, match[2], currentProjection);
  if (unchanged) {
    return Object.freeze({
      classification: CANONICAL_INTEGRATED_CONTRACT_CLASSIFICATIONS.HISTORICAL_FROZEN_CONTRACT_UNCHANGED,
      current_contract: canonicalizeWorkRecordJson(currentProjection),
      ...currentState
    });
  }
  if (!currentState.corrective) {
    throw new Error("canonical integrated state changed beyond the permitted lifecycle transition");
  }
  return Object.freeze({
    classification:
      CANONICAL_INTEGRATED_CONTRACT_CLASSIFICATIONS.CORRECTIVE_CURRENT_CONTRACT_REQUIRES_FRESH_IDENTITY,
    current_contract: canonicalizeWorkRecordJson(currentProjection),
    ...currentState
  });
}

export function resolveCanonicalIntegratedSliceState(mainRepo, subject, frozenContract = null) {
  const match = typeof subject === "string" ? subject.match(EXACT_IMPLEMENTATION_SLICE_RE) : null;
  if (!match) throw new Error("integrated slice subject is not canonical");
  const record = readCanonicalWorkRecord(mainRepo, match[1]);
  return resolveCanonicalIntegratedSliceStateFromRecord(record, subject, frozenContract);
}
