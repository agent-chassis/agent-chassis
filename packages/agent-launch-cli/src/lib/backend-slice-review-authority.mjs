

import {
  canonicalizeWorkRecordJson,
  projectSliceReviewReceiptContracts
} from "@agent-chassis/wiki-core";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { defaultRunGit } from "./worktree-substrate.mjs";
import { EXACT_IMPLEMENTATION_SLICE_RE } from "./backend-constants.mjs";
import {
  createTrustedFrozenSliceReviewContract,
  isPlainObject
} from "./backend-review-identity.mjs";
import { resolveCommittedSliceReviewAdmission } from
  "./committed-slice-review-admission.mjs";
import {
  runFrozenReviewTargetObjectStoreProbes
} from "./backend-terminal-review-target-authority.mjs";
import { readCanonicalContractGenerationIdentity } from
  "./slice-integration-authorization.mjs";
import { digestTrustedExactReviewEvidence } from
  "./workspace-agent-dispatch-run-receipt.mjs";

const SLICE_REVIEW_TARGET_REF_RE = /^refs\/heads\/slice\/(IN-\d{4})\/(WK-\d{4})\/(SLICE-\d{3})$/u;
const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const RECORD_ID_RE = /^WK-\d{4}$/u;
const SLICE_ID_RE = /^SLICE-\d{3}$/u;
const SUBJECT_RE = /^WK-\d{4}#SLICE-\d{3}$/u;

export const SLICE_REVIEW_CONTEXT_MISMATCH_FIELDS = Object.freeze({
  CANONICAL_PARENT_CONTRACT: "canonical_parent_wk_contract",
  REVIEW_UNIT_CONTRACT: "review_unit_contract",
  SELECTED_UNIT_IDENTITY: "parent_status_or_selected_unit_identity",
  REVIEWED_SHA: "reviewed_sha",
  DIFF_BASE_SHA: "diff_base_sha",
  SLICE_REF: "slice_ref",
  WORKTREE_IDENTITY: "worktree_identity",
  REPOSITORY_IDENTITY: "repository_identity",
  COMMITTED_TARGET_DIGEST: "committed_target_digest",
  CANONICAL_RECORD: "canonical_record",
  RECORD_INITIATIVE: "initiative",
  RECORD_ID: "record_id",
  RECORD_SLICES: "slices",
  SELECTED_SLICE: "selected_slice",
  SELECTED_SLICE_WORK_KIND: "work_kind",
  OBJECT_STORE_PROBE: "object_store_probe"
});
const SLICE_REVIEW_CONTEXT_MISMATCH_FIELD_SET = new Set(
  Object.values(SLICE_REVIEW_CONTEXT_MISMATCH_FIELDS)
);

export const SLICE_REVIEW_AUTHORITY_GROUPS = Object.freeze({
  REVIEW_TARGET_ROUTE: "review_target_route",
  CANONICAL_RECORD_STATE: "canonical_record_state",
  RECEIPT_CONTRACT: "receipt_contract"
});

const SLICE_REVIEW_AUTHORITY_FAILURES = Object.freeze({
  FROZEN_TARGET_INCOMPATIBLE: Object.freeze({
    code: "agent_launch.slice_review_authority.frozen_target_incompatible.v1",
    group: SLICE_REVIEW_AUTHORITY_GROUPS.REVIEW_TARGET_ROUTE
  }),
  SUBJECT_NOT_EXACT_IMPLEMENTATION_SLICE: Object.freeze({
    code: "agent_launch.slice_review_authority.subject_not_exact_implementation_slice.v1",
    group: SLICE_REVIEW_AUTHORITY_GROUPS.REVIEW_TARGET_ROUTE
  }),
  CANONICAL_RECORD_UNAVAILABLE: Object.freeze({
    code: "agent_launch.slice_review_authority.canonical_record_unavailable.v1",
    group: SLICE_REVIEW_AUTHORITY_GROUPS.CANONICAL_RECORD_STATE
  }),
  CANONICAL_RECORD_ABSENT: Object.freeze({
    code: "agent_launch.slice_review_authority.record_absent.v1",
    group: SLICE_REVIEW_AUTHORITY_GROUPS.CANONICAL_RECORD_STATE
  }),
  CANONICAL_RECORD_IDENTITY_INCOMPLETE: Object.freeze({
    code: "agent_launch.slice_review_authority.record_identity_incomplete.v1",
    group: SLICE_REVIEW_AUTHORITY_GROUPS.CANONICAL_RECORD_STATE
  }),
  CANONICAL_RECORD_IDENTITY_MISMATCH: Object.freeze({
    code: "agent_launch.slice_review_authority.record_identity_mismatch.v1",
    group: SLICE_REVIEW_AUTHORITY_GROUPS.CANONICAL_RECORD_STATE
  }),
  CANONICAL_RECORD_SLICES_INVALID: Object.freeze({
    code: "agent_launch.slice_review_authority.record_slices_invalid.v1",
    group: SLICE_REVIEW_AUTHORITY_GROUPS.CANONICAL_RECORD_STATE
  }),
  SELECTED_SLICE_ABSENT: Object.freeze({
    code: "agent_launch.slice_review_authority.slice_absent.v1",
    group: SLICE_REVIEW_AUTHORITY_GROUPS.CANONICAL_RECORD_STATE
  }),
  SELECTED_SLICE_NOT_IMPLEMENTATION: Object.freeze({
    code: "agent_launch.slice_review_authority.slice_not_implementation.v1",
    group: SLICE_REVIEW_AUTHORITY_GROUPS.CANONICAL_RECORD_STATE
  }),
  SELECTED_SLICE_MALFORMED: Object.freeze({
    code: "agent_launch.slice_review_authority.slice_malformed.v1",
    group: SLICE_REVIEW_AUTHORITY_GROUPS.CANONICAL_RECORD_STATE
  }),
  PARENT_IN_WHOLE_WK_REVIEW: Object.freeze({
    code: "agent_launch.slice_review_authority.parent_in_whole_wk_review.v1",
    group: SLICE_REVIEW_AUTHORITY_GROUPS.CANONICAL_RECORD_STATE
  }),
  SLICE_NOT_UNDER_SLICE_LEVEL_REVIEW: Object.freeze({
    code: "agent_launch.slice_review_authority.slice_not_under_slice_level_review.v1",
    group: SLICE_REVIEW_AUTHORITY_GROUPS.CANONICAL_RECORD_STATE
  }),
  SLICE_ABSENT_FROM_REVIEW_CONTRACT: Object.freeze({
    code: "agent_launch.slice_review_authority.slice_absent_from_review_contract.v1",
    group: SLICE_REVIEW_AUTHORITY_GROUPS.CANONICAL_RECORD_STATE
  }),
  RECEIPT_CONTRACT_NOT_JSON: Object.freeze({
    code: "agent_launch.slice_review_authority.receipt_contract_not_json.v1",
    group: SLICE_REVIEW_AUTHORITY_GROUPS.RECEIPT_CONTRACT
  }),
  RECEIPT_CONTRACT_NOT_PRE_INTEGRATION: Object.freeze({
    code: "agent_launch.slice_review_authority.receipt_contract_not_pre_integration.v1",
    group: SLICE_REVIEW_AUTHORITY_GROUPS.RECEIPT_CONTRACT
  }),
  RECEIPT_CONTRACTS_DISAGREE: Object.freeze({
    code: "agent_launch.slice_review_authority.receipt_contracts_disagree.v1",
    group: SLICE_REVIEW_AUTHORITY_GROUPS.RECEIPT_CONTRACT
  })
});

export const SLICE_REVIEW_AUTHORITY_CODES = Object.freeze(Object.fromEntries(
  Object.entries(SLICE_REVIEW_AUTHORITY_FAILURES)
    .map(([key, descriptor]) => [key, descriptor.code])
));

export const SLICE_REVIEW_AUTHORITY_CODE_GROUPS = Object.freeze(Object.fromEntries(
  Object.values(SLICE_REVIEW_AUTHORITY_FAILURES)
    .map((descriptor) => [descriptor.code, descriptor.group])
));

export const SLICE_REVIEW_AUTHORITY_REASONS = Object.freeze({
  TARGET_SHAPE_INVALID: "target_shape_invalid",
  TARGET_REF_INVALID: "target_ref_invalid",
  TARGET_SHA_INVALID: "target_sha_invalid",
  TARGET_DIFF_BINDING_INVALID: "target_diff_binding_invalid",
  TARGET_SLICE_DISCRIMINANT_ABSENT: "target_slice_discriminant_absent",
  TARGET_CARRIES_WHOLE_WK_MARKERS: "target_carries_whole_wk_markers",
  SUBJECT_NOT_EXACT_IMPLEMENTATION_SLICE: "subject_not_exact_implementation_slice",
  RECORD_ABSENT: "record_absent",
  RECORD_IDENTITY_INCOMPLETE: "record_identity_incomplete",
  RECORD_IDENTITY_MISMATCH: "record_identity_mismatch",
  RECORD_MALFORMED: "record_malformed",
  RECORD_SLICES_INVALID: "record_slices_invalid",
  PARENT_IN_WHOLE_WK_REVIEW: "parent_in_whole_wk_review",
  SLICE_ABSENT: "slice_absent",
  SLICE_NOT_IMPLEMENTATION: "slice_not_implementation",
  SLICE_MALFORMED: "slice_malformed",
  SLICE_NOT_UNDER_REVIEW: "slice_not_under_review",
  SLICE_REVIEW_CONTRACT_ABSENT: "slice_review_contract_absent",
  RECEIPT_CONTRACT_NOT_JSON: "receipt_contract_not_json",
  RECEIPT_RECORD_SHAPE_INVALID: "receipt_record_shape_invalid",
  RECEIPT_RECORD_IDENTITY_MISMATCH: "receipt_record_identity_mismatch",
  RECEIPT_RECORD_IN_WHOLE_WK_REVIEW: "receipt_record_in_whole_wk_review",
  RECEIPT_RECORD_SLICES_INVALID: "receipt_record_slices_invalid",
  RECEIPT_SLICE_SHAPE_INVALID: "receipt_slice_shape_invalid",
  RECEIPT_SLICE_IDENTITY_MISMATCH: "receipt_slice_identity_mismatch",
  RECEIPT_SLICE_NOT_IMPLEMENTATION: "receipt_slice_not_implementation",
  RECEIPT_SLICE_NOT_UNDER_REVIEW: "receipt_slice_not_under_review",
  RECEIPT_CONTRACTS_DISAGREE: "receipt_contracts_disagree"
});

const SLICE_REVIEW_AUTHORITY_REASON_SET = Object.freeze(
  new Set(Object.values(SLICE_REVIEW_AUTHORITY_REASONS))
);

export const SLICE_REVIEW_AUTHORITY_DETAIL_KEYS = Object.freeze([
  "subject",
  "record_id",
  "slice_id",
  "reviewed_sha",
  "mismatch_field",

  "refusal_reason"
]);

function boundedSliceReviewAuthorityDetail(detail) {
  const source = typeof detail === "object" && detail !== null && !Array.isArray(detail)
    ? detail
    : {};
  const bounded = (key, pattern) =>
    (typeof source[key] === "string" && pattern.test(source[key]) ? source[key] : null);
  return Object.freeze({
    subject: bounded("subject", SUBJECT_RE),
    record_id: bounded("record_id", RECORD_ID_RE),
    slice_id: bounded("slice_id", SLICE_ID_RE),
    reviewed_sha: bounded("reviewed_sha", OID_RE),
    mismatch_field: typeof source.mismatch_field === "string" &&
      SLICE_REVIEW_CONTEXT_MISMATCH_FIELD_SET.has(source.mismatch_field)
      ? source.mismatch_field
      : null,
    refusal_reason: typeof source.refusal_reason === "string" &&
      SLICE_REVIEW_AUTHORITY_REASON_SET.has(source.refusal_reason)
      ? source.refusal_reason
      : null
  });
}

export class SliceReviewAuthorityError extends Error {
  constructor(message, { code, detail = null, cause } = {}) {
    if (!Object.hasOwn(SLICE_REVIEW_AUTHORITY_CODE_GROUPS, code ?? "")) {
      throw new Error("slice review authority failure requires a closed slice-review-authority code");
    }
    super(message, cause === undefined ? undefined : { cause });
    this.name = "SliceReviewAuthorityError";
    this.code = code;
    this.group = SLICE_REVIEW_AUTHORITY_CODE_GROUPS[code];
    this.detail = boundedSliceReviewAuthorityDetail(detail);
  }
}

function sliceReviewAuthorityFailure(code, message, detail, cause) {
  return new SliceReviewAuthorityError(message, { code, detail, cause });
}

export function assertFrozenSliceReviewTarget(target) {

  const refuse = (refusalReason) => {
    throw sliceReviewAuthorityFailure(
      SLICE_REVIEW_AUTHORITY_CODES.FROZEN_TARGET_INCOMPATIBLE,
      "frozen slice-level review target is incomplete or incompatible",
      { refusal_reason: refusalReason }
    );
  };
  if (!isPlainObject(target)) refuse(SLICE_REVIEW_AUTHORITY_REASONS.TARGET_SHAPE_INVALID);
  if (typeof target.ref !== "string" || !SLICE_REVIEW_TARGET_REF_RE.test(target.ref)) {
    refuse(SLICE_REVIEW_AUTHORITY_REASONS.TARGET_REF_INVALID);
  }
  if (typeof target.sha !== "string" || !OID_RE.test(target.sha)) {
    refuse(SLICE_REVIEW_AUTHORITY_REASONS.TARGET_SHA_INVALID);
  }
  if (target.diff_head_sha !== target.sha ||
      typeof target.diff_base_sha !== "string" || !OID_RE.test(target.diff_base_sha) ||
      target.diff_range !== `${target.diff_base_sha}..${target.sha}`) {
    refuse(SLICE_REVIEW_AUTHORITY_REASONS.TARGET_DIFF_BINDING_INVALID);
  }
  if (target.slice_level_review !== true) {
    refuse(SLICE_REVIEW_AUTHORITY_REASONS.TARGET_SLICE_DISCRIMINANT_ABSENT);
  }
  if (Object.prototype.hasOwnProperty.call(target, "complete_parent_wk_contract") ||
      Object.prototype.hasOwnProperty.call(target, "accumulated_wk_diff")) {
    refuse(SLICE_REVIEW_AUTHORITY_REASONS.TARGET_CARRIES_WHOLE_WK_MARKERS);
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

function readCurrentSliceReviewRecord(mainRepo, wkId) {
  const recordPath = path.join(mainRepo, "wiki", "work-records", `${wkId}.json`);
  try {
    const requestedRepo = path.resolve(mainRepo);
    const repo = realpathSync(requestedRepo);
    if (requestedRepo !== repo) {
      return Object.freeze({ state: SLICE_REVIEW_AUTHORITY_REASONS.RECORD_MALFORMED });
    }
    const stat = lstatSync(recordPath);
    if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(recordPath) !== recordPath) {
      return Object.freeze({ state: SLICE_REVIEW_AUTHORITY_REASONS.RECORD_MALFORMED });
    }
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    return Object.freeze({ state: "present", record });
  } catch (error) {
    return Object.freeze({
      state: error?.code === "ENOENT"
        ? SLICE_REVIEW_AUTHORITY_REASONS.RECORD_ABSENT
        : SLICE_REVIEW_AUTHORITY_REASONS.RECORD_MALFORMED
    });
  }
}

const CURRENT_RECORD_FAILURE_CODE = Object.freeze({
  [SLICE_REVIEW_AUTHORITY_REASONS.RECORD_ABSENT]:
    SLICE_REVIEW_AUTHORITY_CODES.CANONICAL_RECORD_ABSENT,
  [SLICE_REVIEW_AUTHORITY_REASONS.RECORD_IDENTITY_INCOMPLETE]:
    SLICE_REVIEW_AUTHORITY_CODES.CANONICAL_RECORD_IDENTITY_INCOMPLETE,
  [SLICE_REVIEW_AUTHORITY_REASONS.RECORD_IDENTITY_MISMATCH]:
    SLICE_REVIEW_AUTHORITY_CODES.CANONICAL_RECORD_IDENTITY_MISMATCH,
  [SLICE_REVIEW_AUTHORITY_REASONS.RECORD_SLICES_INVALID]:
    SLICE_REVIEW_AUTHORITY_CODES.CANONICAL_RECORD_SLICES_INVALID,
  [SLICE_REVIEW_AUTHORITY_REASONS.RECORD_MALFORMED]:
    SLICE_REVIEW_AUTHORITY_CODES.CANONICAL_RECORD_UNAVAILABLE
});

const SELECTED_SLICE_FAILURE_CODE = Object.freeze({
  [SLICE_REVIEW_AUTHORITY_REASONS.SLICE_ABSENT]:
    SLICE_REVIEW_AUTHORITY_CODES.SELECTED_SLICE_ABSENT,
  [SLICE_REVIEW_AUTHORITY_REASONS.SLICE_NOT_IMPLEMENTATION]:
    SLICE_REVIEW_AUTHORITY_CODES.SELECTED_SLICE_NOT_IMPLEMENTATION,
  [SLICE_REVIEW_AUTHORITY_REASONS.SLICE_MALFORMED]:
    SLICE_REVIEW_AUTHORITY_CODES.SELECTED_SLICE_MALFORMED,
  [SLICE_REVIEW_AUTHORITY_REASONS.SLICE_NOT_UNDER_REVIEW]:
    SLICE_REVIEW_AUTHORITY_CODES.SLICE_NOT_UNDER_SLICE_LEVEL_REVIEW
});

function resolveCanonicalImplementationSliceUnit(mainRepo, subject, { requireReview }) {
  const match = typeof subject === "string" ? subject.match(EXACT_IMPLEMENTATION_SLICE_RE) : null;
  if (!match) {

    throw sliceReviewAuthorityFailure(
      SLICE_REVIEW_AUTHORITY_CODES.SUBJECT_NOT_EXACT_IMPLEMENTATION_SLICE,
      `canonical slice-review subject is not an exact implementation-slice address: ${JSON.stringify(subject)}`,
      { refusal_reason: SLICE_REVIEW_AUTHORITY_REASONS.SUBJECT_NOT_EXACT_IMPLEMENTATION_SLICE }
    );
  }
  const wkId = match[1];
  const sliceId = match[2];
  const unit = { subject: `${wkId}#${sliceId}`, record_id: wkId, slice_id: sliceId };
  const currentRecord = readCurrentSliceReviewRecord(mainRepo, wkId);
  const record = currentRecord.record;
  const recordReason = currentRecord.state !== "present"
    ? currentRecord.state
    : !isPlainObject(record)
      ? SLICE_REVIEW_AUTHORITY_REASONS.RECORD_MALFORMED
      : typeof record.id !== "string" || !RECORD_ID_RE.test(record.id) ||
          !/^IN-\d{4}$/u.test(record.initiative ?? "")
        ? SLICE_REVIEW_AUTHORITY_REASONS.RECORD_IDENTITY_INCOMPLETE
        : record.id !== wkId
          ? SLICE_REVIEW_AUTHORITY_REASONS.RECORD_IDENTITY_MISMATCH
          : !Array.isArray(record.slices)
            ? SLICE_REVIEW_AUTHORITY_REASONS.RECORD_SLICES_INVALID
            : null;
  if (recordReason !== null) {
    const mismatchField = recordReason === SLICE_REVIEW_AUTHORITY_REASONS.RECORD_ABSENT ||
        recordReason === SLICE_REVIEW_AUTHORITY_REASONS.RECORD_MALFORMED
      ? SLICE_REVIEW_CONTEXT_MISMATCH_FIELDS.CANONICAL_RECORD
      : recordReason === SLICE_REVIEW_AUTHORITY_REASONS.RECORD_SLICES_INVALID
        ? SLICE_REVIEW_CONTEXT_MISMATCH_FIELDS.RECORD_SLICES
        : isPlainObject(record) && typeof record.id === "string" &&
            RECORD_ID_RE.test(record.id) && record.id !== wkId
          ? SLICE_REVIEW_CONTEXT_MISMATCH_FIELDS.RECORD_ID
          : isPlainObject(record) && record.id === wkId
            ? SLICE_REVIEW_CONTEXT_MISMATCH_FIELDS.RECORD_INITIATIVE
            : SLICE_REVIEW_CONTEXT_MISMATCH_FIELDS.RECORD_ID;
    throw sliceReviewAuthorityFailure(
      CURRENT_RECORD_FAILURE_CODE[recordReason] ??
        SLICE_REVIEW_AUTHORITY_CODES.CANONICAL_RECORD_UNAVAILABLE,
      `canonical ${wkId} record is unavailable for slice-level review`,
      { ...unit, refusal_reason: recordReason, mismatch_field: mismatchField }
    );
  }
  if (requireReview && record.status === "review") {
    throw sliceReviewAuthorityFailure(
      SLICE_REVIEW_AUTHORITY_CODES.PARENT_IN_WHOLE_WK_REVIEW,
      `canonical ${wkId} is in whole-WK review; a slice-level review requires an active parent`,
      { ...unit, refusal_reason: SLICE_REVIEW_AUTHORITY_REASONS.PARENT_IN_WHOLE_WK_REVIEW }
    );
  }
  const matchingSlices = record.slices.filter((entry) => entry?.id === sliceId);
  const slice = matchingSlices[0];
  const sliceReason = matchingSlices.length === 0
    ? SLICE_REVIEW_AUTHORITY_REASONS.SLICE_ABSENT
    : matchingSlices.length !== 1 || !isPlainObject(slice)
      ? SLICE_REVIEW_AUTHORITY_REASONS.SLICE_MALFORMED
      : slice.work_kind !== "implementation"
      ? SLICE_REVIEW_AUTHORITY_REASONS.SLICE_NOT_IMPLEMENTATION
      : (requireReview && slice.status !== "review")
        ? SLICE_REVIEW_AUTHORITY_REASONS.SLICE_NOT_UNDER_REVIEW
        : null;
  if (sliceReason !== null) {
    const mismatchField = sliceReason === SLICE_REVIEW_AUTHORITY_REASONS.SLICE_NOT_IMPLEMENTATION
      ? SLICE_REVIEW_CONTEXT_MISMATCH_FIELDS.SELECTED_SLICE_WORK_KIND
      : SLICE_REVIEW_CONTEXT_MISMATCH_FIELDS.SELECTED_SLICE;
    throw sliceReviewAuthorityFailure(
      SELECTED_SLICE_FAILURE_CODE[sliceReason] ??
        SLICE_REVIEW_AUTHORITY_CODES.SLICE_NOT_UNDER_SLICE_LEVEL_REVIEW,
      `canonical slice ${wkId}#${sliceId} is not an implementation slice under slice-level review`,
      { ...unit, refusal_reason: sliceReason, mismatch_field: mismatchField }
    );
  }

  let contracts;
  try {
    contracts = projectSliceReviewReceiptContracts(record, sliceId);
  } catch (error) {
    throw sliceReviewAuthorityFailure(
      SLICE_REVIEW_AUTHORITY_CODES.SELECTED_SLICE_MALFORMED,
      `canonical slice ${wkId}#${sliceId} is malformed for its review contract projection`,
      {
        ...unit,
        refusal_reason: SLICE_REVIEW_AUTHORITY_REASONS.SLICE_MALFORMED,
        mismatch_field: SLICE_REVIEW_CONTEXT_MISMATCH_FIELDS.SELECTED_SLICE
      },
      error
    );
  }
  if (contracts.slice_review_contract === null) {
    throw sliceReviewAuthorityFailure(
      SLICE_REVIEW_AUTHORITY_CODES.SLICE_ABSENT_FROM_REVIEW_CONTRACT,
      `canonical slice ${wkId}#${sliceId} is absent from its own review contract projection`,
      { ...unit, refusal_reason: SLICE_REVIEW_AUTHORITY_REASONS.SLICE_REVIEW_CONTRACT_ABSENT }
    );
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

export function resolveCanonicalSliceReviewUnit(
  mainRepo,
  subject,
  { requireReview = true } = {}
) {
  return resolveCanonicalImplementationSliceUnit(mainRepo, subject, { requireReview });
}

export function resolveCanonicalSliceIntegrationUnit(mainRepo, subject) {
  return resolveCanonicalImplementationSliceUnit(mainRepo, subject, { requireReview: false });
}

export function resolveFrozenSliceReviewReceiptContract(
  receipt,
  { requireReview = true } = {}
) {

  const receiptDetail = {
    subject: receipt?.unit_address,
    record_id: receipt?.record_id,
    slice_id: receipt?.slice_id,
    reviewed_sha: receipt?.reviewed_sha
  };
  let record;
  let slice;
  try {
    record = JSON.parse(receipt?.canonical_parent_wk_contract);
    slice = JSON.parse(receipt?.slice_review_contract);
  } catch (error) {
    throw sliceReviewAuthorityFailure(
      SLICE_REVIEW_AUTHORITY_CODES.RECEIPT_CONTRACT_NOT_JSON,
      "exact slice review receipt frozen contract is not valid JSON",
      { ...receiptDetail, refusal_reason: SLICE_REVIEW_AUTHORITY_REASONS.RECEIPT_CONTRACT_NOT_JSON },
      error
    );
  }
  const contractReason = !isPlainObject(record)
    ? SLICE_REVIEW_AUTHORITY_REASONS.RECEIPT_RECORD_SHAPE_INVALID
    : (record.id !== receipt.record_id || record.initiative !== receipt.initiative)
      ? SLICE_REVIEW_AUTHORITY_REASONS.RECEIPT_RECORD_IDENTITY_MISMATCH
      : requireReview && record.status === "review"
        ? SLICE_REVIEW_AUTHORITY_REASONS.RECEIPT_RECORD_IN_WHOLE_WK_REVIEW
        : !Array.isArray(record.slices)
          ? SLICE_REVIEW_AUTHORITY_REASONS.RECEIPT_RECORD_SLICES_INVALID
          : !isPlainObject(slice)
            ? SLICE_REVIEW_AUTHORITY_REASONS.RECEIPT_SLICE_SHAPE_INVALID
            : slice.id !== receipt.slice_id
              ? SLICE_REVIEW_AUTHORITY_REASONS.RECEIPT_SLICE_IDENTITY_MISMATCH
              : slice.work_kind !== "implementation"
                ? SLICE_REVIEW_AUTHORITY_REASONS.RECEIPT_SLICE_NOT_IMPLEMENTATION
                : requireReview && slice.status !== "review"
                  ? SLICE_REVIEW_AUTHORITY_REASONS.RECEIPT_SLICE_NOT_UNDER_REVIEW
                  : null;
  if (contractReason !== null) {
    throw sliceReviewAuthorityFailure(
      SLICE_REVIEW_AUTHORITY_CODES.RECEIPT_CONTRACT_NOT_PRE_INTEGRATION,
      "exact slice review receipt frozen contract is not a pre-integration review unit",
      { ...receiptDetail, refusal_reason: contractReason }
    );
  }
  const parentSlice = record.slices.find((entry) => entry?.id === receipt.slice_id);

  if (!isPlainObject(parentSlice) ||
      canonicalizeWorkRecordJson(parentSlice) !== canonicalizeWorkRecordJson(slice)) {
    throw sliceReviewAuthorityFailure(
      SLICE_REVIEW_AUTHORITY_CODES.RECEIPT_CONTRACTS_DISAGREE,
      "exact slice review receipt parent and slice contracts disagree",
      { ...receiptDetail, refusal_reason: SLICE_REVIEW_AUTHORITY_REASONS.RECEIPT_CONTRACTS_DISAGREE }
    );
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

export function selectedSliceReviewUnitIdentityMismatch(context, reviewUnit) {
  return context.review_subject !== reviewUnit.subject ||
      context.record_id !== reviewUnit.record_id ||
      context.review_slice_id !== reviewUnit.slice_id ||
      context.initiative !== reviewUnit.initiative ||
      reviewUnit.parent_status === "review"
    ? SLICE_REVIEW_CONTEXT_MISMATCH_FIELDS.SELECTED_UNIT_IDENTITY
    : null;
}

export function frozenSliceReviewContractMismatch(context, reviewUnit) {
  const trusted = context.trusted_frozen_review_contract;
  if (!isPlainObject(trusted) || trusted.review_subject !== reviewUnit.subject) {
    return SLICE_REVIEW_CONTEXT_MISMATCH_FIELDS.SELECTED_UNIT_IDENTITY;
  }
  if (context.review_unit_contract !== reviewUnit.review_unit_contract ||
      trusted.review_unit_contract !== reviewUnit.review_unit_contract) {
    return SLICE_REVIEW_CONTEXT_MISMATCH_FIELDS.REVIEW_UNIT_CONTRACT;
  }
  if (context.canonical_parent_wk_contract !== reviewUnit.canonical_parent_wk_contract ||
      trusted.canonical_parent_wk_contract !== reviewUnit.canonical_parent_wk_contract) {
    return SLICE_REVIEW_CONTEXT_MISMATCH_FIELDS.CANONICAL_PARENT_CONTRACT;
  }
  const expected = createTrustedFrozenSliceReviewContract(reviewUnit);
  return trusted.schema_version === expected.schema_version
    ? null
    : SLICE_REVIEW_CONTEXT_MISMATCH_FIELDS.SELECTED_UNIT_IDENTITY;
}

export function immutableSliceReviewDeliveryMismatch(existing, current) {
  if (existing.review_subject !== current.review_subject ||
      existing.record_id !== current.record_id ||
      existing.review_slice_id !== current.review_slice_id ||
      existing.initiative !== current.initiative ||
      existing.review_admission_kind !== current.review_admission_kind ||
      existing.slice_level_review !== true || current.slice_level_review !== true) {
    return SLICE_REVIEW_CONTEXT_MISMATCH_FIELDS.SELECTED_UNIT_IDENTITY;
  }
  if (existing.reviewed_sha !== current.reviewed_sha) {
    return SLICE_REVIEW_CONTEXT_MISMATCH_FIELDS.REVIEWED_SHA;
  }
  if (existing.diff_base_sha !== current.diff_base_sha ||
      existing.diff_head_sha !== current.diff_head_sha ||
      existing.diff_range !== current.diff_range) {
    return SLICE_REVIEW_CONTEXT_MISMATCH_FIELDS.DIFF_BASE_SHA;
  }
  if (existing.slice_ref !== current.slice_ref) {
    return SLICE_REVIEW_CONTEXT_MISMATCH_FIELDS.SLICE_REF;
  }
  if (existing.main_repo !== current.main_repo) {
    return SLICE_REVIEW_CONTEXT_MISMATCH_FIELDS.REPOSITORY_IDENTITY;
  }
  if (!isPlainObject(existing.worktree_identity) ||
      existing.worktree_path !== current.worktree_path ||
      existing.worktree_identity_digest !==
        digestTrustedExactReviewEvidence(existing.worktree_identity) ||
      current.worktree_identity_digest !==
        digestTrustedExactReviewEvidence(current.worktree_identity) ||
      existing.worktree_identity_digest !== current.worktree_identity_digest) {
    return SLICE_REVIEW_CONTEXT_MISMATCH_FIELDS.WORKTREE_IDENTITY;
  }
  if (existing.committed_target_digest !== current.committed_target_digest ||
      existing.worktree_identity.committed_target_digest !== existing.committed_target_digest ||
      current.worktree_identity.committed_target_digest !== current.committed_target_digest) {
    return SLICE_REVIEW_CONTEXT_MISMATCH_FIELDS.COMMITTED_TARGET_DIGEST;
  }
  return null;
}

export function readCurrentSliceReviewLineageAuthority({
  context,
  runGit = defaultRunGit
} = {}) {
  const generation = readCanonicalContractGenerationIdentity(
    context.main_repo,
    context.record_id
  );
  const generationValid = (generation?.state === "present" &&
      typeof generation.digest === "string" &&
      typeof generation.manifest_digest === "string") ||
    (generation?.state === "absent" &&
      generation.digest === "controlled-contract-generation:none" &&
      generation.manifest_digest === null);
  if (!generationValid) throw new Error("current controlled-contract generation is unresolved");
  const wkRef = context.worktree_identity?.wk_ref ??
    `refs/heads/wk/${context.initiative}/${context.record_id}`;
  const tipResult = runGit({
    repo: context.main_repo,
    args: ["rev-parse", "--verify", `${wkRef}^{commit}`]
  });
  const wkTipSha = tipResult?.ok === true && typeof tipResult.stdout === "string"
    ? tipResult.stdout.trim()
    : "";
  if (!OID_RE.test(wkTipSha)) {
    throw new Error("current accumulated WK tip is unresolved");
  }
  return Object.freeze({
    generation: generation.digest,
    manifest_digest: generation.manifest_digest,
    wk_ref: wkRef,
    wk_tip_sha: wkTipSha
  });
}

const lineageAuthorityKey = (authority) => JSON.stringify(authority);

function currentSliceReviewLineageApplicability({ context, worktreeRoot, runGit }) {
  let currentUnit;
  try {
    currentUnit = resolveCanonicalSliceReviewUnit(context.main_repo, context.review_subject);
  } catch {
    return false;
  }
  if (selectedSliceReviewUnitIdentityMismatch(context, currentUnit) !== null ||
      frozenSliceReviewContractMismatch(context, currentUnit) !== null) return false;
  try {
    const currentAdmission = resolveCommittedSliceReviewAdmission({
      mainRepo: context.main_repo,
      worktreeRoot,
      subject: context.review_subject,
      reviewUnit: currentUnit,
      runGit
    });
    return immutableSliceReviewDeliveryMismatch(context, Object.freeze({
      ...context,
      committed_target_digest: currentAdmission.committed_target_digest,
      worktree_path: currentAdmission.worktree_path,
      slice_ref: currentAdmission.target.ref,
      reviewed_sha: currentAdmission.target.sha,
      diff_base_sha: currentAdmission.target.diff_base_sha,
      diff_head_sha: currentAdmission.target.sha,
      diff_range: currentAdmission.target.diff_range,
      worktree_identity: currentAdmission.identity,
      worktree_identity_digest: digestTrustedExactReviewEvidence(currentAdmission.identity)
    })) === null;
  } catch {
    return false;
  }
}

export function createSliceReviewLineageAuthorityReassessment({
  context,
  frozenAuthority = null,
  worktreeRoot,
  runGit = defaultRunGit
} = {}) {
  return async () => {
    let before;
    let after;
    try {
      before = readCurrentSliceReviewLineageAuthority({ context, runGit });
      if (!currentSliceReviewLineageApplicability({ context, worktreeRoot, runGit })) {
        return { ok: false, conflict_class: "result_inapplicable" };
      }
      after = readCurrentSliceReviewLineageAuthority({ context, runGit });
    } catch {
      return { ok: false, conflict_class: "generation_tip_reassessment_failed" };
    }
    if (lineageAuthorityKey(before) !== lineageAuthorityKey(after)) {
      return {
        ok: false,
        conflict_class: before.generation !== after.generation ||
            before.manifest_digest !== after.manifest_digest
          ? "generation_changed_during_reassessment"
          : "accumulated_tip_moved_during_reassessment"
      };
    }
    if (frozenAuthority === null ||
        lineageAuthorityKey(after) === lineageAuthorityKey(frozenAuthority)) {
      return { ok: true };
    }
    return {
      ok: false,
      conflict_class: before.generation !== frozenAuthority.generation ||
          before.manifest_digest !== frozenAuthority.manifest_digest
        ? "stale_contract_generation"
        : "moved_accumulated_tip"
    };
  };
}
