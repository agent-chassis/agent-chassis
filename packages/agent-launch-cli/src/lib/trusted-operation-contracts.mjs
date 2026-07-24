

export function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const SLICE_REVIEW_SURFACE_PREPARATION_SCHEMA_VERSION =
  "slice-review-surface-preparation.v1";

export const SLICE_REVIEW_SURFACE_PREPARATION_VERIFIED_PARTS = Object.freeze([
  "launcher_tuple_and_v2_full_binding",
  "canonical_worktree_registration",
  "reviewed_commit_parent_and_tree",
  "symbolic_head_and_slice_ref",
  "physical_tree_from_isolated_index",
  "ordinary_index_allowed_prestate",
  "ordinary_index_reviewed_tree",
  "empty_cached_worktree_and_status",
  "no_sparse_or_hidden_index_entries",
  "refs_registration_and_physical_tree_unchanged"
]);

export const TERMINAL_REVIEW_EVIDENCE_SCHEMA_VERSION =
  "agent_launch.terminal_review_evidence.v1";

export const TRUSTED_TERMINAL_REVIEW_EVIDENCE_FIELDS = Object.freeze([
  "schema_version", "materialization", "review_target", "run", "wk_binding"
]);

export const TERMINAL_REVIEW_EVIDENCE_WK_BINDING_SCHEMA_VERSION =
  "worktree-identity-binding.v1";

export const TERMINAL_REVIEW_EVIDENCE_WK_BINDING_FIELDS = Object.freeze([
  "schema_version", "run_id", "retry_id", "unit_address", "output_branch",
  "worktree_path", "base_ref", "base_sha"
]);

export const WK_FORGE_HANDOFF_RESULT_SCHEMA_VERSION = "wk-forge-handoff.v1";

export const WK_FORGE_HANDOFF_FAILURE_CATEGORIES = Object.freeze({
  REQUEST_INVALID: "request_invalid",
  REMOTE_INVALID: "remote_invalid",
  ELIGIBILITY: "eligibility",
  CCE_POLICY: "cce_policy",
  PUBLICATION_DISAGREEMENT: "publication_disagreement",
  INDETERMINATE: "indeterminate",
  GIT_FAILED: "git_failed"
});

export const WK_FORGE_HANDOFF_BOUNDARY_AUTHORIZATION_SCHEMA_VERSION =
  "wk-forge-handoff-boundary-authorization.v1";

export const WK_FORGE_HANDOFF_CCE_POLICY_REQUEST_SCHEMA_VERSION =
  "wk-forge-handoff-cce-policy-request.v1";

export const WK_FORGE_HANDOFF_CCE_POLICY_DECISION_SCHEMA_VERSION =
  "wk-forge-handoff-cce-policy-decision.v1";

export const WK_FORGE_HANDOFF_POLICY_POSTURES = Object.freeze({
  FREE_SUBSTRATE: "free_substrate",
  CCE_POLICY: "cce_policy"
});

export const WK_FORGE_HANDOFF_RESULT_KINDS = Object.freeze({
  NO_CHANGES: "no_changes",
  HANDED_OFF: "handed_off",
  HUMAN_ACTION_REQUIRED: "human_action_required",
  HUMAN_RECONCILIATION_REQUIRED: "human_reconciliation_required"
});
