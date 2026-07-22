

import path from "node:path";
import {
  EXPECTED_MANAGED_CONFINEMENT_ACTIVATION,
  EXPECTED_CLOSED_INPUT_COMMIT_COMPOSITION,
  RETAINED_REVIEWER_LAUNCH_IDENTITY_FIELDS,
  FROZEN_REVIEW_CONTRACT_IDENTITY_FIELDS
} from "./backend-constants.mjs";

const RETAINED_SLICE_REVIEWER_LAUNCH_IDENTITY_FIELDS = Object.freeze([
  "diff_head_sha",
  "initiative",
  "main_repo",
  "record_id",
  "review_slice_id",
  "review_subject",
  "reviewed_sha",
  "slice_ref",
  "trusted_frozen_review_contract",
  "worktree_path"
]);
import {
  FROZEN_FINDINGS_ONLY_ACCEPTANCE_CONTRACT_SCHEMA_VERSION,
  FROZEN_SLICE_LEVEL_ACCEPTANCE_CONTRACT_SCHEMA_VERSION
} from "./workspace-agent-findings-role-context.mjs";
import { sameStringArray } from "./backend-scope-authority.mjs";

export function createManagedWorkerConfinementActivationBinding() {
  return Object.freeze({ ...EXPECTED_MANAGED_CONFINEMENT_ACTIVATION });
}

function hasExactManagedConfinementActivation(binding) {
  if (!isPlainObject(binding)) return false;
  const actualKeys = Object.keys(binding).sort();
  const expectedKeys = Object.keys(EXPECTED_MANAGED_CONFINEMENT_ACTIVATION).sort();
  return sameStringArray(actualKeys, expectedKeys) && expectedKeys.every(
    (field) => binding[field] === EXPECTED_MANAGED_CONFINEMENT_ACTIVATION[field]
  );
}

export function hasExactClosedInputCommitComposition(binding) {
  if (!isPlainObject(binding) || !Object.isFrozen(binding)) return false;
  const actualKeys = Object.keys(binding).sort();
  const expectedKeys = Object.keys(EXPECTED_CLOSED_INPUT_COMMIT_COMPOSITION).sort();
  return sameStringArray(actualKeys, expectedKeys) && expectedKeys.every(
    (field) => binding[field] === EXPECTED_CLOSED_INPUT_COMMIT_COMPOSITION[field]
  );
}

export function hasManagedConfinementActivation(config) {
  if (!isPlainObject(config)) return false;
  const explicit = config.managedConfinementActivation
    ?? config.managed_confinement_activation
    ?? null;
  if (explicit !== null) return hasExactManagedConfinementActivation(explicit);

  return config.confinementAvailable === true;
}

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function createRetainedReviewerLaunchIdentity(context) {
  return Object.freeze({
    main_repo: context.main_repo,
    review_subject: context.review_subject,
    record_id: context.record_id,
    review_slice_id: context.review_slice_id,
    initiative: context.initiative,
    wk_ref: context.wk_ref,
    worktree_path: context.worktree_path,
    wk_sha: context.wk_sha,
    diff_head_sha: context.diff_head_sha,
    trusted_frozen_review_contract: context.trusted_frozen_review_contract
  });
}

export function createTrustedFrozenReviewContract(reviewUnit) {
  return Object.freeze({
    schema_version: FROZEN_FINDINGS_ONLY_ACCEPTANCE_CONTRACT_SCHEMA_VERSION,
    review_subject: reviewUnit.subject,
    canonical_parent_wk_contract: reviewUnit.canonical_parent_wk_contract,
    review_unit_contract: reviewUnit.review_unit_contract
  });
}

function isStructurallyCompleteRetainedSliceReviewerLaunchIdentity(identity) {
  if (!isPlainObject(identity) || !Object.isFrozen(identity) ||
      !sameStringArray(Object.keys(identity).sort(), RETAINED_SLICE_REVIEWER_LAUNCH_IDENTITY_FIELDS)) {
    return false;
  }
  const contract = identity.trusted_frozen_review_contract;
  return typeof identity.main_repo === "string" && path.isAbsolute(identity.main_repo) &&
    typeof identity.review_subject === "string" && /^WK-\d{4}#SLICE-\d{3}$/u.test(identity.review_subject) &&
    typeof identity.record_id === "string" && /^WK-\d{4}$/u.test(identity.record_id) &&
    typeof identity.review_slice_id === "string" && /^SLICE-\d{3}$/u.test(identity.review_slice_id) &&
    typeof identity.initiative === "string" && /^IN-\d{4}$/u.test(identity.initiative) &&
    typeof identity.slice_ref === "string" &&
    /^refs\/heads\/slice\/IN-\d{4}\/WK-\d{4}\/SLICE-\d{3}$/u.test(identity.slice_ref) &&
    typeof identity.worktree_path === "string" && path.isAbsolute(identity.worktree_path) &&
    typeof identity.reviewed_sha === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(identity.reviewed_sha) &&
    typeof identity.diff_head_sha === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(identity.diff_head_sha) &&
    isPlainObject(contract) && Object.isFrozen(contract) &&
    sameStringArray(Object.keys(contract).sort(), FROZEN_REVIEW_CONTRACT_IDENTITY_FIELDS) &&
    contract.schema_version === FROZEN_SLICE_LEVEL_ACCEPTANCE_CONTRACT_SCHEMA_VERSION &&
    typeof contract.review_subject === "string" &&
    typeof contract.canonical_parent_wk_contract === "string" &&
    typeof contract.review_unit_contract === "string";
}

export function assertRetainedSliceReviewerLaunchIdentityMatchesContext(identity, context) {
  if (!isStructurallyCompleteRetainedSliceReviewerLaunchIdentity(identity)) {
    throw new Error("consumed frozen slice review context has no structurally complete retained reviewer launch identity");
  }
  const expected = createRetainedSliceReviewerLaunchIdentity(context);
  const flatFields = RETAINED_SLICE_REVIEWER_LAUNCH_IDENTITY_FIELDS.filter(
    (field) => field !== "trusted_frozen_review_contract"
  );
  if (flatFields.some((field) => identity[field] !== expected[field]) ||
      FROZEN_REVIEW_CONTRACT_IDENTITY_FIELDS.some(
        (field) => identity.trusted_frozen_review_contract[field] !==
          expected.trusted_frozen_review_contract[field]
      )) {
    throw new Error("retained slice reviewer launch identity does not match the consumed frozen slice review context");
  }
}

export function createTrustedFrozenSliceReviewContract(reviewUnit) {
  return Object.freeze({
    schema_version: FROZEN_SLICE_LEVEL_ACCEPTANCE_CONTRACT_SCHEMA_VERSION,
    review_subject: reviewUnit.subject,
    canonical_parent_wk_contract: reviewUnit.canonical_parent_wk_contract,
    review_unit_contract: reviewUnit.review_unit_contract
  });
}

export function createRetainedSliceReviewerLaunchIdentity(context) {
  return Object.freeze({
    main_repo: context.main_repo,
    review_subject: context.review_subject,
    record_id: context.record_id,
    review_slice_id: context.review_slice_id,
    initiative: context.initiative,
    slice_ref: context.slice_ref,
    worktree_path: context.worktree_path,
    reviewed_sha: context.reviewed_sha,
    diff_head_sha: context.diff_head_sha,
    trusted_frozen_review_contract: context.trusted_frozen_review_contract
  });
}

function isStructurallyCompleteRetainedReviewerLaunchIdentity(identity) {
  if (!isPlainObject(identity) || !Object.isFrozen(identity) ||
      !sameStringArray(Object.keys(identity).sort(), RETAINED_REVIEWER_LAUNCH_IDENTITY_FIELDS)) {
    return false;
  }
  const contract = identity.trusted_frozen_review_contract;
  return typeof identity.main_repo === "string" && path.isAbsolute(identity.main_repo) &&
    typeof identity.review_subject === "string" && /^WK-\d{4}#SLICE-\d{3}$/u.test(identity.review_subject) &&
    typeof identity.record_id === "string" && /^WK-\d{4}$/u.test(identity.record_id) &&
    typeof identity.review_slice_id === "string" && /^SLICE-\d{3}$/u.test(identity.review_slice_id) &&
    typeof identity.initiative === "string" && /^IN-\d{4}$/u.test(identity.initiative) &&
    typeof identity.wk_ref === "string" && /^refs\/heads\/wk\/IN-\d{4}\/WK-\d{4}$/u.test(identity.wk_ref) &&
    typeof identity.worktree_path === "string" && path.isAbsolute(identity.worktree_path) &&
    typeof identity.wk_sha === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(identity.wk_sha) &&
    typeof identity.diff_head_sha === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(identity.diff_head_sha) &&
    isPlainObject(contract) && Object.isFrozen(contract) &&
    sameStringArray(Object.keys(contract).sort(), FROZEN_REVIEW_CONTRACT_IDENTITY_FIELDS) &&
    contract.schema_version === FROZEN_FINDINGS_ONLY_ACCEPTANCE_CONTRACT_SCHEMA_VERSION &&
    typeof contract.review_subject === "string" &&
    typeof contract.canonical_parent_wk_contract === "string" &&
    typeof contract.review_unit_contract === "string";
}

export function assertRetainedReviewerLaunchIdentityMatchesContext(identity, context) {
  if (!isStructurallyCompleteRetainedReviewerLaunchIdentity(identity)) {
    throw new Error("consumed frozen whole-WK review context has no structurally complete retained reviewer launch identity");
  }
  const expected = createRetainedReviewerLaunchIdentity(context);
  const flatFields = RETAINED_REVIEWER_LAUNCH_IDENTITY_FIELDS.filter(
    (field) => field !== "trusted_frozen_review_contract"
  );
  if (flatFields.some((field) => identity[field] !== expected[field]) ||
      FROZEN_REVIEW_CONTRACT_IDENTITY_FIELDS.some(
        (field) => identity.trusted_frozen_review_contract[field] !==
          expected.trusted_frozen_review_contract[field]
      )) {
    throw new Error("retained reviewer launch identity does not match the consumed frozen whole-WK review context");
  }
}
