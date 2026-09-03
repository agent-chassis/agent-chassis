export const SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES = Object.freeze({
  INVALID_ARGUMENT: "agent_launch.slice_review_materialization.invalid_argument.v1",
  BINDING_MISMATCH: "agent_launch.slice_review_materialization.binding_mismatch.v1",
  WORKTREE_MISMATCH: "agent_launch.slice_review_materialization.worktree_mismatch.v1",
  OBJECT_MISMATCH: "agent_launch.slice_review_materialization.object_mismatch.v1",
  INDEX_LOCKED: "agent_launch.slice_review_materialization.index_locked.v1",
  INDEX_STATE_REFUSED: "agent_launch.slice_review_materialization.index_state_refused.v1",
  PHYSICAL_TREE_REFUSED: "agent_launch.slice_review_materialization.physical_tree_refused.v1",
  PREPARE_FAILED: "agent_launch.slice_review_materialization.prepare_failed.v1",
  POSTCHECK_FAILED: "agent_launch.slice_review_materialization.postcheck_failed.v1"
});

export const SLICE_REVIEW_POSTCHECK_STATE_BUDGET = Object.freeze({
  schema_version: "slice-review-postcheck-state-budget.v1",
  bound_fields: Object.freeze([
    "worktreeIdentityDigest",
    "canonicalWorktreePath",
    "gitDir",
    "commonDirectory",
    "objectDirectory",
    "objectAlternates",
    "targetRegistration",
    "sliceRef",
    "headSymbolicRef",
    "headSha",
    "reviewedSha",
    "reviewedTree",
    "baseSha",
    "baseTree",
    "sequencerState"
  ]),
  bound_refs: Object.freeze([
    "the launcher-bound slice ref of the target worktree",
    "the target worktree HEAD (symbolic target and resolved commit)"
  ]),
  refused_pseudorefs: Object.freeze([
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "REBASE_HEAD",
    "BISECT_HEAD",
    "AUTO_MERGE"
  ]),
  unbound: Object.freeze([
    "ORIG_HEAD",
    "FETCH_HEAD",
    "every repository ref outside the closed bound-ref set",
    "the registration, HEAD, and branch of every non-target worktree"
  ])
});

export const SLICE_REVIEW_MATERIALIZATION_ERROR_NAME = "SliceReviewMaterializationError";
export const MATERIALIZATION_MESSAGE_PREFIX = "agent-launch slice-review materialization: ";

const MATERIALIZATION_ERROR_BRAND = new WeakSet();

export class SliceReviewMaterializationError extends Error {
  constructor(message, { code, detail = null, cause = null } = {}) {
    super(message);
    this.name = SLICE_REVIEW_MATERIALIZATION_ERROR_NAME;
    this.code = code ?? SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.PREPARE_FAILED;
    if (detail !== null) this.detail = detail;
    if (cause !== null) this.cause = cause;
    MATERIALIZATION_ERROR_BRAND.add(this);
  }
}

export function failSliceReviewMaterialization(code, message, detail = null, cause = null) {
  throw new SliceReviewMaterializationError(
    `${MATERIALIZATION_MESSAGE_PREFIX}${message}`,
    { code, detail, cause }
  );
}

export function isSliceReviewMaterializationError(value) {
  return MATERIALIZATION_ERROR_BRAND.has(value);
}

export const HISTORICAL_DELIVERY_INDEX_RECOVERY = Object.freeze({
  schema_version: "slice-review-historical-delivery-index-recovery.v1",
  max_suffix_commits: 64,
  literal_object_read_options: Object.freeze(["--no-replace-objects"])
});
