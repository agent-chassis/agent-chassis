

import {
  canonicalizeWorkRecordJson,
  projectSliceReviewReceiptContracts
} from "@agent-chassis/wiki-core";
import { defaultRunGit } from "./worktree-substrate.mjs";
import { EXACT_IMPLEMENTATION_SLICE_RE } from "./backend-constants.mjs";
import { isPlainObject } from "./backend-review-identity.mjs";
import { readCanonicalWorkRecord } from "./backend-worker-scope-authority.mjs";
import {
  runFrozenReviewTargetObjectStoreProbes
} from "./backend-terminal-review-target-authority.mjs";

const SLICE_REVIEW_TARGET_REF_RE = /^refs\/heads\/slice\/(IN-\d{4})\/(WK-\d{4})\/(SLICE-\d{3})$/u;
const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export function assertFrozenSliceReviewTarget(target) {
  if (!isPlainObject(target) ||
      typeof target.ref !== "string" || !SLICE_REVIEW_TARGET_REF_RE.test(target.ref) ||
      typeof target.sha !== "string" || !OID_RE.test(target.sha) ||
      target.diff_head_sha !== target.sha ||
      typeof target.diff_base_sha !== "string" || !OID_RE.test(target.diff_base_sha) ||
      target.diff_range !== `${target.diff_base_sha}..${target.sha}` ||
      target.slice_level_review !== true ||
      Object.prototype.hasOwnProperty.call(target, "complete_parent_wk_contract") ||
      Object.prototype.hasOwnProperty.call(target, "accumulated_wk_diff")) {
    throw new Error("frozen slice-level review target is incomplete or incompatible");
  }
  return target;
}

export function verifyFrozenSliceReviewTargetAgainstObjectStore({ mainRepo, context, runGit = defaultRunGit }) {
  return runFrozenReviewTargetObjectStoreProbes({
    mainRepo,
    runGit,
    probes: [
      { name: "slice_ref_resolves_to_reviewed_sha", rev: `${context.slice_ref}^{commit}`, expect: context.reviewed_sha },
      { name: "reviewed_commit_object_present", rev: `${context.reviewed_sha}^{commit}`, expect: context.reviewed_sha },
      { name: "slice_diff_base_object_present", rev: `${context.diff_base_sha}^{commit}`, expect: context.diff_base_sha }
    ]
  });
}

function resolveCanonicalImplementationSliceUnit(mainRepo, subject, { requireReview }) {
  const match = typeof subject === "string" ? subject.match(EXACT_IMPLEMENTATION_SLICE_RE) : null;
  if (!match) {
    throw new Error(`canonical slice-review subject is not an exact implementation-slice address: ${JSON.stringify(subject)}`);
  }
  const wkId = match[1];
  const sliceId = match[2];
  const record = readCanonicalWorkRecord(mainRepo, wkId);
  if (!record || record.id !== wkId || !/^IN-\d{4}$/u.test(record.initiative ?? "") ||
      !Array.isArray(record.slices)) {
    throw new Error(`canonical ${wkId} record is unavailable for slice-level review`);
  }
  if (requireReview && record.status === "review") {
    throw new Error(`canonical ${wkId} is in whole-WK review; a slice-level review requires an active parent`);
  }
  const slice = record.slices.find((entry) => entry?.id === sliceId);
  if (!isPlainObject(slice) || slice.work_kind !== "implementation" ||
      (requireReview && slice.status !== "review")) {
    throw new Error(`canonical slice ${wkId}#${sliceId} is not an implementation slice under slice-level review`);
  }

  const contracts = projectSliceReviewReceiptContracts(record, sliceId);
  if (contracts.slice_review_contract === null) {
    throw new Error(`canonical slice ${wkId}#${sliceId} is absent from its own review contract projection`);
  }
  return Object.freeze({
    record_id: wkId,
    slice_id: sliceId,
    subject: `${wkId}#${sliceId}`,
    initiative: record.initiative,
    parent_status: record.status ?? null,
    canonical_parent_wk_contract: contracts.canonical_parent_wk_contract,
    review_unit_contract: contracts.slice_review_contract
  });
}

export function resolveCanonicalSliceReviewUnit(mainRepo, subject) {
  return resolveCanonicalImplementationSliceUnit(mainRepo, subject, { requireReview: true });
}

export function resolveCanonicalSliceIntegrationUnit(mainRepo, subject) {
  return resolveCanonicalImplementationSliceUnit(mainRepo, subject, { requireReview: false });
}

export function resolveFrozenSliceReviewReceiptContract(receipt) {
  let record;
  let slice;
  try {
    record = JSON.parse(receipt?.canonical_parent_wk_contract);
    slice = JSON.parse(receipt?.slice_review_contract);
  } catch (error) {
    throw new Error("exact slice review receipt frozen contract is not valid JSON", { cause: error });
  }
  if (!isPlainObject(record) || record.id !== receipt.record_id ||
      record.initiative !== receipt.initiative || record.status === "review" ||
      !Array.isArray(record.slices) || !isPlainObject(slice) ||
      slice.id !== receipt.slice_id || slice.work_kind !== "implementation" ||
      slice.status !== "review") {
    throw new Error("exact slice review receipt frozen contract is not a pre-integration review unit");
  }
  const parentSlice = record.slices.find((entry) => entry?.id === receipt.slice_id);

  if (!isPlainObject(parentSlice) ||
      canonicalizeWorkRecordJson(parentSlice) !== canonicalizeWorkRecordJson(slice)) {
    throw new Error("exact slice review receipt parent and slice contracts disagree");
  }
  return Object.freeze({
    record_id: receipt.record_id,
    slice_id: receipt.slice_id,
    subject: receipt.unit_address,
    initiative: receipt.initiative,
    parent_status: record.status ?? null,
    canonical_parent_wk_contract: receipt.canonical_parent_wk_contract,
    review_unit_contract: receipt.slice_review_contract
  });
}

export function verifyFrozenReceiptObjectsAgainstObjectStore({ mainRepo, receipt, runGit = defaultRunGit }) {
  return runFrozenReviewTargetObjectStoreProbes({
    mainRepo,
    runGit,
    probes: [
      { name: "reviewed_commit_object_present", rev: `${receipt.reviewed_sha}^{commit}`, expect: receipt.reviewed_sha },
      { name: "slice_diff_base_object_present", rev: `${receipt.diff_base_sha}^{commit}`, expect: receipt.diff_base_sha }
    ]
  });
}
