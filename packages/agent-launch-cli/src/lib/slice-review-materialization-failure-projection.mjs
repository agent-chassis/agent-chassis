import {
  HISTORICAL_DELIVERY_INDEX_RECOVERY,
  isSliceReviewMaterializationError,
  MATERIALIZATION_MESSAGE_PREFIX,
  SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES,
  SLICE_REVIEW_MATERIALIZATION_ERROR_NAME,
  SLICE_REVIEW_POSTCHECK_STATE_BUDGET,
  SliceReviewMaterializationError
} from "./slice-review-materialization-contract.mjs";

export const SLICE_REVIEW_MATERIALIZATION_FAILURE_PROJECTION_SCHEMA_VERSION =
  "agent_launch.slice_review_materialization_failure_projection.v1";

export const SLICE_REVIEW_MATERIALIZATION_FAILURE_PROJECTION_KIND =
  "slice_review_materialization_failure";

export const SLICE_REVIEW_MATERIALIZATION_PUBLIC_MESSAGE =
  "exact-slice review materialization refused";

export const SLICE_REVIEW_MATERIALIZATION_PROJECTION_KEYS = Object.freeze([
  "schema_version",
  "kind",
  "code",
  "message",
  "detail"
]);

export const SLICE_REVIEW_MATERIALIZATION_PUBLIC_DETAIL_KEYS = Object.freeze([
  "predicate",
  "field",
  "pseudoref",
  "config_key",
  "config_scope",
  "suffix_depth",
  "traversal_bound",
  "git_exit_status"
]);

const OID_ASSERTION_SUFFIX = " is not a canonical Git object id";
const OID_ASSERTION_LABELS = Object.freeze([
  "physical checkout tree",
  "reviewed slice SHA",
  "slice HEAD SHA",
  "base tree",
  "reviewed tree",
  "ordinary index tree",
  "post-preparation HEAD tree",
  "post-preparation ordinary index tree",
  "historical commit tree",
  "historical commit parent",
  "launcher-owned WK fork commit",
  "launcher-owned WK fork tree"
]);

export const SLICE_REVIEW_MATERIALIZATION_PUBLIC_PREDICATES = Object.freeze([
  "preparation requires the canonical main repo and exact base launcher tuple",
  "trusted binding, digest, and Git dependencies are required",
  "could not resolve and verify the exact launcher-bound slice identity",
  "slice review preparation requires the retained v2/full worktree binding",
  "could not derive the exact worktree identity digest",
  "worktree identity digest is unavailable or malformed",
  "retained slice worktree path is missing or unreadable",
  "retained slice worktree path moved or is not canonical",
  "could not enumerate registered Git worktrees",
  "Git worktree registration contains a duplicate field",
  "retained slice worktree registration is missing, moved, detached, locked, or mismatched",
  "could not resolve the retained linked-worktree Git directory",
  "could not resolve the retained linked-worktree top level",
  "retained linked-worktree Git association is missing or unreadable",
  "retained path is not the registered exact linked worktree",
  "retained slice worktree HEAD is detached or unreadable",
  "symbolic HEAD, slice ref, registration, and reviewed SHA do not agree",
  "could not resolve the retained slice worktree operation-state path",
  "could not classify retained slice worktree operation state",
  "retained slice worktree has in-progress Git operation state",
  "could not resolve the canonical Git object directory",
  "could not resolve the canonical Git common directory",
  "canonical Git object or common directory is missing or unreadable",
  "could not classify the canonical Git object alternates",
  "could not resolve the exact reviewed slice ref",
  "could not resolve retained slice HEAD",
  "required slice object is missing or unreadable",
  "required slice object has the wrong Git type",
  "could not resolve the reviewed slice parent",
  "reviewed slice commit does not have the exact launcher-bound base parent",
  "could not resolve the exact base tree",
  "could not resolve the reviewed tree",
  "reviewed tree object is missing",
  "reviewed tree object has the wrong Git type",
  "could not seed the isolated physical-tree index",
  "could not inspect unexpected worktree content",
  "retained slice worktree contains unexpected untracked content",
  "could not measure the physical checkout through the isolated index",
  "could not write the isolated physical checkout tree",
  "physical checkout does not exactly materialize the reviewed commit tree",
  "could not compute the ordinary linked-worktree index tree",
  "ordinary linked-worktree index is locked; refusing without deleting the lock",
  "ordinary linked-worktree index became locked before preparation",
  "the canonical delivery mint point is unavailable",
  "historical index authentication requires a canonical managed slice subject",
  "historical delivery suffix is cyclic",
  "historical delivery suffix object is missing or is not a commit",
  "could not read the literal historical delivery commit object",
  "historical commit object has no literal header/message boundary",
  "historical commit is not a literal single-parent commit object",
  "historical commit carries extra literal tree/parent headers",
  "commit is not an exact canonical server-minted delivery for this slice",
  "the reviewed delivery does not literally head the authenticated suffix",
  "the authenticated binding base does not literally follow the reviewed delivery",
  "historical delivery tree is missing or is not a tree object",
  "no authenticated historical launcher delivery within the fixed traversal bound",
  "the launcher-owned WK fork ref is symbolic",
  "the launcher-owned WK fork ref does not name a commit",
  "the launcher-owned WK fork tree object is missing or is not a tree",
  "could not resolve the launcher-owned WK fork tree",
  "the authenticated suffix reached an invalid launcher-owned WK fork terminal",
  "ordinary index is not the authenticated launcher-owned WK fork tree",
  "could not re-prove the bound review surface before historical index reconciliation",
  "the bound slice ref, HEAD, or ordinary index moved during historical index authentication",
  "git read-tree could not align the ordinary index with the reviewed commit",
  "ordinary linked-worktree index lock remained after preparation",
  "declared bound review-surface state was not produced for comparison",
  "trusted slice/worktree/ref state changed during review-surface preparation",
  "could not resolve the post-preparation HEAD tree",
  "could not resolve the post-preparation ordinary index tree",
  "HEAD, ordinary index, and physical checkout are not the exact unchanged reviewed tree",
  "cached or worktree diff remains after review-surface preparation",
  "could not inspect post-preparation worktree status",
  "retained slice review worktree is not clean after preparation",
  ...OID_ASSERTION_LABELS.map((label) => `${label}${OID_ASSERTION_SUFFIX}`)
]);

const PUBLIC_PREDICATE_SET = new Set(SLICE_REVIEW_MATERIALIZATION_PUBLIC_PREDICATES);
const PUBLIC_CODE_SET = new Set(Object.values(SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES));
const PUBLIC_BOUND_FIELD_SET = new Set(SLICE_REVIEW_POSTCHECK_STATE_BUDGET.bound_fields);
const PUBLIC_PSEUDOREF_SET = new Set(SLICE_REVIEW_POSTCHECK_STATE_BUDGET.refused_pseudorefs);

function ownDataValue(target, key) {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (!descriptor || !Object.hasOwn(descriptor, "value")) return undefined;
  return descriptor.value;
}

function boundedEnumValue(detail, key, allowed) {
  const value = ownDataValue(detail, key);
  return typeof value === "string" && allowed.has(value) ? value : null;
}

function boundedIntegerValue(detail, key, minimum, maximum) {
  const value = ownDataValue(detail, key);
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : null;
}

function boundedMaterializationDetail(predicate, detail) {
  const source = detail === null ? null : detail;
  return Object.freeze({
    predicate,
    field: source === null ? null : boundedEnumValue(source, "field", PUBLIC_BOUND_FIELD_SET),
    pseudoref: source === null ? null : boundedEnumValue(source, "pseudoref", PUBLIC_PSEUDOREF_SET),

    config_key: null,
    config_scope: null,
    suffix_depth: source === null ? null : boundedIntegerValue(source, "depth", 0,
      HISTORICAL_DELIVERY_INDEX_RECOVERY.max_suffix_commits),
    traversal_bound: source === null ? null : boundedIntegerValue(source, "bound",
      HISTORICAL_DELIVERY_INDEX_RECOVERY.max_suffix_commits,
      HISTORICAL_DELIVERY_INDEX_RECOVERY.max_suffix_commits),
    git_exit_status: source === null ? null : boundedIntegerValue(source, "status", 0, 255)
  });
}

export function projectAuthenticatedSliceReviewMaterializationFailure(error) {
  if (!isSliceReviewMaterializationError(error)) return null;
  if (!(error instanceof SliceReviewMaterializationError)) return null;
  if (ownDataValue(error, "name") !== SLICE_REVIEW_MATERIALIZATION_ERROR_NAME) return null;
  const message = ownDataValue(error, "message");
  if (typeof message !== "string" || !message.startsWith(MATERIALIZATION_MESSAGE_PREFIX)) return null;
  const code = ownDataValue(error, "code");
  if (typeof code !== "string" || !PUBLIC_CODE_SET.has(code)) return null;
  let detail = null;
  if (Object.hasOwn(error, "detail")) {
    detail = ownDataValue(error, "detail");
    if (detail === null || typeof detail !== "object" || Array.isArray(detail) ||
        Object.getPrototypeOf(detail) !== Object.prototype) return null;
  }
  const reason = message.slice(MATERIALIZATION_MESSAGE_PREFIX.length);
  return Object.freeze({
    schema_version: SLICE_REVIEW_MATERIALIZATION_FAILURE_PROJECTION_SCHEMA_VERSION,
    kind: SLICE_REVIEW_MATERIALIZATION_FAILURE_PROJECTION_KIND,
    code,
    message: SLICE_REVIEW_MATERIALIZATION_PUBLIC_MESSAGE,
    detail: boundedMaterializationDetail(
      PUBLIC_PREDICATE_SET.has(reason) ? reason : null,
      detail
    )
  });
}
