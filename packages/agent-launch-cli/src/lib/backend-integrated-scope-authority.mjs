

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
import { defaultRunGit } from "./worktree-substrate.mjs";
import { isExactSliceReviewReceiptStoreOccurrence } from
  "./workspace-agent-dispatch-run-receipt-store.mjs";

export const INTEGRATED_DELIVERY_AUTHENTICATION_FAILED_CODE =
  "agent_launch.integrated_delivery.authentication_failed.v1";

const PRODUCER_AUTHENTICATED_INTEGRATED_DELIVERY =
  Symbol("producer-authenticated-integrated-delivery");
const INTEGRATED_DELIVERY_OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const INTEGRATED_DELIVERY_PROOF_SCHEMA =
  "agent_launch.integrated_delivery.producer_authenticated.v1";
const INTEGRATED_DELIVERY_PRODUCER =
  "packages/agent-launch-cli/src/lib/slice-integration-delivery.mjs";

export class IntegratedDeliveryAuthenticationError extends Error {
  constructor(reason, consequence, detail = null) {
    super(`integrated delivery authentication failed: ${reason}`);
    this.name = "IntegratedDeliveryAuthenticationError";
    this.code = INTEGRATED_DELIVERY_AUTHENTICATION_FAILED_CODE;
    this.integrated_delivery_authentication = Object.freeze({
      reason,
      consequence,
      ...(detail === null ? {} : { detail: Object.freeze({ ...detail }) })
    });
  }
}

function integratedDeliveryAuthenticationFailure(reason, consequence, detail = null) {
  throw new IntegratedDeliveryAuthenticationError(reason, consequence, detail);
}

function exactGit(runGit, mainRepo, args, reason, consequence) {
  const result = runGit({ repo: mainRepo, args });
  if (!result || result.ok !== true || typeof result.stdout !== "string") {
    integratedDeliveryAuthenticationFailure(reason, consequence, {
      status: result?.status ?? null,
      stderr: result?.stderr ?? result?.error ?? null
    });
  }
  return result.stdout;
}

function literalCommitIdentity(runGit, mainRepo, oid, reason) {
  if (typeof oid !== "string" || !INTEGRATED_DELIVERY_OID_RE.test(oid)) {
    integratedDeliveryAuthenticationFailure(
      reason,
      "the integration-written delivery identity cannot be verified",
      { oid: typeof oid === "string" ? oid : null }
    );
  }
  const raw = exactGit(
    runGit,
    mainRepo,
    ["--no-replace-objects", "cat-file", "commit", oid],
    reason,
    "the producer-owned delivery receipt cannot be read from the canonical object store"
  );
  const separator = raw.indexOf("\n\n");
  if (separator < 0) {
    integratedDeliveryAuthenticationFailure(
      reason,
      "the producer-owned delivery receipt is malformed"
    );
  }
  const headers = raw.slice(0, separator).split("\n");
  const trees = headers.filter((line) => line.startsWith("tree "));
  const parents = headers.filter((line) => line.startsWith("parent "));
  if (trees.length !== 1 || parents.length !== 1) {
    integratedDeliveryAuthenticationFailure(
      reason,
      "the producer-owned delivery receipt does not have one exact tree and sole parent"
    );
  }
  const tree = trees[0].slice(5);
  const parent = parents[0].slice(7);
  if (!INTEGRATED_DELIVERY_OID_RE.test(tree) || !INTEGRATED_DELIVERY_OID_RE.test(parent)) {
    integratedDeliveryAuthenticationFailure(
      reason,
      "the producer-owned delivery receipt carries a malformed object identity"
    );
  }
  return Object.freeze({ oid, tree, parent, message: raw.slice(separator + 2) });
}

function rawDeliveryDelta(runGit, mainRepo, commit, reason) {
  return exactGit(
    runGit,
    mainRepo,
    [
      "--no-replace-objects", "-c", "core.quotePath=true", "-c", "color.ui=false",
      "diff-tree", "--raw", "-r", "--no-renames", "--no-abbrev",
      "--ignore-submodules=none", "--no-ext-diff", "--no-textconv", "--no-color",
      commit.parent, commit.oid
    ],
    reason,
    "the integration-written delivery delta cannot be compared with its producer receipt"
  );
}

function exactDeliveryMessage(subject, baseSha) {
  return `agent-launch worker delivery: ${subject} (base ${baseSha.slice(0, 12)})\n\n` +
    `Wk-Slice: ${subject}\n`;
}

function zeroDeltaReceiptMatches({
  runGit, mainRepo, integrated, reviewed, subject, reviewedBase
}) {
  const expected = `agent-launch zero-delta integration evidence: ${subject}\n\n` +
    `Wk-Slice: ${subject}\n` +
    "Wk-Slice-Integration: v1\n" +
    `Wk-Slice-Delivery: ${reviewed.oid}\n` +
    `Wk-Slice-Base: ${reviewedBase}\n` +
    `Wk-Slice-Wk-Parent: ${integrated.parent}\n` +
    "Wk-Slice-Empty: true\n";
  return integrated.message === expected &&
    rawDeliveryDelta(
      runGit,
      mainRepo,
      integrated,
      "zero_delta_evidence_delta_unreadable"
    ) === "";
}

function producerReceiptMatches({ runGit, mainRepo, integrated, reviewed, subject, reviewedBase }) {
  if (reviewed.parent !== reviewedBase ||
      reviewed.message !== exactDeliveryMessage(subject, reviewedBase)) {
    return false;
  }
  if (integrated.oid === reviewed.oid) return true;
  if (zeroDeltaReceiptMatches({
    runGit, mainRepo, integrated, reviewed, subject, reviewedBase
  })) return true;
  return integrated.message === reviewed.message &&
    rawDeliveryDelta(runGit, mainRepo, integrated, "integrated_delivery_delta_unreadable") ===
      rawDeliveryDelta(runGit, mainRepo, reviewed, "reviewed_delivery_delta_unreadable");
}

function targetIntegratedDeliveryTransition(frozenReviewUnit, currentProjection, sliceId) {
  const historical = JSON.parse(frozenReviewUnit.canonical_parent_wk_contract);
  const historicalIndex = historical.slices.findIndex((entry) => entry?.id === sliceId);
  const liveIndex = currentProjection.slices.findIndex((entry) => entry?.id === sliceId);
  if (historicalIndex < 0 || liveIndex < 0 || historicalIndex !== liveIndex) {
    integratedDeliveryAuthenticationFailure(
      "addressed_delivery_unit_mismatch",
      "the producer receipt cannot be bound to one exact canonical delivery path"
    );
  }
  const historicalSlice = historical.slices[historicalIndex];
  const liveSlice = currentProjection.slices[liveIndex];
  const historicalHas = Object.hasOwn(historicalSlice, "integrated_delivery_sha");
  const historicalValue = historicalHas ? historicalSlice.integrated_delivery_sha : undefined;
  const liveValue = liveSlice.integrated_delivery_sha;
  if ((historicalHas && historicalValue !== null) ||
      typeof liveValue !== "string" || !INTEGRATED_DELIVERY_OID_RE.test(liveValue)) {
    integratedDeliveryAuthenticationFailure(
      "integrated_delivery_transition_not_absent_or_null_to_exact",
      "the integration-written delivery transition cannot be distinguished from authored replacement",
      { historical: historicalHas ? historicalValue : "absent", live: liveValue ?? null }
    );
  }
  return Object.freeze({
    path: `/slices/${liveIndex}/integrated_delivery_sha`,
    change_kind: historicalHas ? "replace" : "add",
    from: historicalHas ? null : "absent",
    to: liveValue
  });
}

function mintProducerAuthenticatedIntegratedDeliveryProof({
  mainRepo,
  subject,
  frozenReceipt,
  frozenReviewUnit,
  currentProjection,
  currentState,
  runGit
}) {
  if (!isExactSliceReviewReceiptStoreOccurrence(frozenReceipt)) {
    integratedDeliveryAuthenticationFailure(
      "receipt_occurrence_not_producer_owned",
      "a caller-provided or copied receipt occurrence cannot authenticate delivery authority"
    );
  }
  const transition = targetIntegratedDeliveryTransition(
    frozenReviewUnit,
    currentProjection,
    currentState.slice_id
  );
  const expectedWkRef =
    `refs/heads/wk/${currentState.initiative}/${currentState.record_id}`;
  const receiptWkRef = frozenReceipt.worktree_identity?.wk_ref;
  if (frozenReceipt.unit_address !== subject || frozenReceipt.record_id !== currentState.record_id ||
      frozenReceipt.slice_id !== currentState.slice_id ||
      frozenReceipt.initiative !== currentState.initiative ||
      receiptWkRef !== expectedWkRef ||
      typeof frozenReceipt.reviewed_sha !== "string" ||
      typeof frozenReceipt.diff_base_sha !== "string") {
    integratedDeliveryAuthenticationFailure(
      "receipt_address_or_identity_mismatch",
      "the producer receipt cannot authenticate the exact addressed delivery transition"
    );
  }
  const currentW = exactGit(
    runGit,
    mainRepo,
    ["rev-parse", "--verify", expectedWkRef],
    "current_w_unavailable",
    "the integration-written delivery cannot be bound to the exact current WK tip"
  ).trim();
  if (!INTEGRATED_DELIVERY_OID_RE.test(currentW)) {
    integratedDeliveryAuthenticationFailure(
      "current_w_identity_malformed",
      "the integration-written delivery cannot be bound to the exact current WK tip"
    );
  }
  const integrated = literalCommitIdentity(
    runGit,
    mainRepo,
    transition.to,
    "integrated_delivery_receipt_unreadable"
  );
  const reviewed = literalCommitIdentity(
    runGit,
    mainRepo,
    frozenReceipt.reviewed_sha,
    "reviewed_delivery_receipt_unreadable"
  );
  if (!producerReceiptMatches({
    runGit,
    mainRepo,
    integrated,
    reviewed,
    subject,
    reviewedBase: frozenReceipt.diff_base_sha
  })) {
    integratedDeliveryAuthenticationFailure(
      "producer_receipt_delivery_mismatch",
      "the live delivery identity is not the exact producer-integrated reviewed delivery"
    );
  }
  const reachable = runGit({
    repo: mainRepo,
    args: ["merge-base", "--is-ancestor", transition.to, currentW]
  });
  if (!reachable || reachable.ok !== true) {
    integratedDeliveryAuthenticationFailure(
      "integrated_delivery_not_reachable_from_current_w",
      "the canonical delivery field cannot prove that the producer result is in the exact current WK tip",
      { integrated_delivery_sha: transition.to, current_w: currentW }
    );
  }
  const reobservedW = exactGit(
    runGit,
    mainRepo,
    ["rev-parse", "--verify", expectedWkRef],
    "current_w_reauthentication_failed",
    "the producer proof became stale while its repository facts were authenticated"
  ).trim();
  const reobservedRecord = readValidatedCanonicalWorkRecord(mainRepo, currentState.record_id);
  const reobservedProjection = projectSliceReviewReceiptContracts(
    reobservedRecord,
    currentState.slice_id
  ).parent;
  if (reobservedW !== currentW ||
      canonicalizeWorkRecordJson(reobservedProjection) !==
        canonicalizeWorkRecordJson(currentProjection)) {
    integratedDeliveryAuthenticationFailure(
      "producer_receipt_observation_stale",
      "the producer proof no longer describes the exact current WK tip and canonical bytes"
    );
  }
  const proof = {
    schema_version: INTEGRATED_DELIVERY_PROOF_SCHEMA,
    producer: Object.freeze({ module: INTEGRATED_DELIVERY_PRODUCER, receipt: "slice-integration.v1" }),
    repository: mainRepo,
    record_id: currentState.record_id,
    slice_id: currentState.slice_id,
    subject,
    canonical_path: transition.path,
    change_kind: transition.change_kind,
    historical_value: transition.from,
    integrated_delivery_sha: transition.to,
    reviewed_delivery_sha: reviewed.oid,
    reviewed_delivery_base_sha: reviewed.parent,
    wk_ref: expectedWkRef,
    current_w: currentW,
    failure_consequence:
      "candidate or delivery authority is unverifiable and terminal recovery must not proceed"
  };
  Object.defineProperty(proof, PRODUCER_AUTHENTICATED_INTEGRATED_DELIVERY, {
    value: true,
    enumerable: false
  });
  return Object.freeze(proof);
}

export function isProducerAuthenticatedIntegratedDeliveryProof(value, expected = null) {
  if (!isPlainObject(value) || value[PRODUCER_AUTHENTICATED_INTEGRATED_DELIVERY] !== true ||
      value.schema_version !== INTEGRATED_DELIVERY_PROOF_SCHEMA) {
    return false;
  }
  if (expected === null) return true;
  return Object.entries(expected).every(([key, expectedValue]) => value[key] === expectedValue);
}

export function assertProducerAuthenticatedIntegratedDeliveryProof(value, expected = null) {
  if (!isProducerAuthenticatedIntegratedDeliveryProof(value, expected)) {
    integratedDeliveryAuthenticationFailure(
      "producer_authenticated_proof_mismatch",
      "candidate or delivery authority is unverifiable from a caller, copied, stale, or mismatched proof"
    );
  }
  return value;
}

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

    entry.integrated_delivery_sha = INTEGRATED_LIFECYCLE_NEUTRALIZED;
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
    parent_status: record.status, slice_status: slice.status,

    integrated_delivery_sha: typeof slice.integrated_delivery_sha === "string"
      ? slice.integrated_delivery_sha
      : null
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

  const corrective = slice.status === "todo";
  const nonFinal = record.status === "active" && slice.status === "done" &&
    incompleteImplementationSiblings.length > 0;
  const final = record.status === "review" &&
    (slice.status === "review" || slice.status === "done") &&
    incompleteImplementationSiblings.length === 0;
  return Object.freeze({
    record_id: match[1],
    slice_id: match[2],
    initiative: record.initiative,
    final,
    corrective,
    lifecycle_state: corrective ? "corrective" : final ? "final" : "non_final",
    parent_status: record.status,
    slice_status: slice.status,

    integrated_delivery_sha: typeof slice.integrated_delivery_sha === "string"
      ? slice.integrated_delivery_sha
      : null
  });
}

export function classifyCanonicalIntegratedSliceContract(
  mainRepo,
  subject,
  frozenContract,
  { authenticateIntegratedDelivery = false } = {}
) {
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
  const integratedDeliveryProof = authenticateIntegratedDelivery
    ? mintProducerAuthenticatedIntegratedDeliveryProof({
        mainRepo,
        subject,
        frozenReceipt: frozenContract,
        frozenReviewUnit,
        currentProjection,
        currentState,
        runGit: defaultRunGit
      })
    : null;
  const unchanged = compareIntegratedContracts(record, frozenReviewUnit, match[2], currentProjection);
  if (unchanged) {
    return Object.freeze({
      classification: CANONICAL_INTEGRATED_CONTRACT_CLASSIFICATIONS.HISTORICAL_FROZEN_CONTRACT_UNCHANGED,
      current_contract: canonicalizeWorkRecordJson(currentProjection),
      ...(integratedDeliveryProof === null
        ? {}
        : { integrated_delivery_proof: integratedDeliveryProof }),
      ...currentState
    });
  }
  return Object.freeze({
    classification:
      CANONICAL_INTEGRATED_CONTRACT_CLASSIFICATIONS.CORRECTIVE_CURRENT_CONTRACT_REQUIRES_FRESH_IDENTITY,
    current_contract: canonicalizeWorkRecordJson(currentProjection),
    ...(integratedDeliveryProof === null
      ? {}
      : { integrated_delivery_proof: integratedDeliveryProof }),
    ...currentState
  });
}

export function authenticateCanonicalIntegratedDeliveryTransition(
  mainRepo,
  subject,
  frozenReceipt
) {
  const classification = classifyCanonicalIntegratedSliceContract(
    mainRepo,
    subject,
    frozenReceipt,
    { authenticateIntegratedDelivery: true }
  );
  return classification.integrated_delivery_proof;
}

export function resolveCanonicalIntegratedSliceState(mainRepo, subject, frozenContract = null) {
  const match = typeof subject === "string" ? subject.match(EXACT_IMPLEMENTATION_SLICE_RE) : null;
  if (!match) throw new Error("integrated slice subject is not canonical");
  const record = readCanonicalWorkRecord(mainRepo, match[1]);
  return resolveCanonicalIntegratedSliceStateFromRecord(record, subject, frozenContract);
}
