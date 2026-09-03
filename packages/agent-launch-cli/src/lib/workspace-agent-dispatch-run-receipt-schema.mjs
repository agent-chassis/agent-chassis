import {
  buildLegacyWorkspaceAgentResultModeCompatibilityEnvelope,
  validateWorkspaceAgentResultModeEnvelope,
  resultModeCompletesMechanicalReview
} from "./workspace-agent-dispatch-result-mode.mjs";

export const EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION =
  "workspace-agent-exact-slice-review-receipt.v1";
export const EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V2 =
  "workspace-agent-exact-slice-review-receipt.v2";
export const EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V3 =
  "workspace-agent-exact-slice-review-receipt.v3";
export const EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V4 =
  "workspace-agent-exact-slice-review-receipt.v4";

export const EXACT_REVIEW_RECEIPT_PARTITION_BINDING_CODE =
  "exact_slice_review_receipt_partition_binding_mismatch";
export const RECEIPT_VERDICT_EVIDENCE_STATES = Object.freeze({
  PENDING: "pending",
  VERDICT_RECORDED: "verdict_recorded",
  NEUTRAL_PROSE_RECORDED: "neutral_prose_recorded",
  NO_VERDICT_CHILD_TERMINAL: "no_verdict_child_terminal",
  NO_VERDICT_LAUNCH_FAILED: "no_verdict_launch_failed"
});
export const RECEIPT_NO_VERDICT_EVIDENCE_VALUES = Object.freeze(new Set([
  RECEIPT_VERDICT_EVIDENCE_STATES.NO_VERDICT_CHILD_TERMINAL,
  RECEIPT_VERDICT_EVIDENCE_STATES.NO_VERDICT_LAUNCH_FAILED
]));

export const RECEIPT_DIRECTORY = "exact-slice-review-receipts";
export const STORE_EVENT_SCHEMA_VERSION = "workspace-agent-exact-slice-review-receipt-event.v1";
export const EVENT_FILE_RE = /^event-([0-9]{16})-([0-9a-f]{64})-([0-9a-f]{64})\.json$/u;
export const PARTITION_DIRECTORY = "partitions";
export const PARTITION_DIR_RE = /^[0-9a-f]{64}$/u;
export const LAYOUT_MARKER_FILE = "layout-partitioned.json";
export const LAYOUT_MARKER_SCHEMA_VERSION = "workspace-agent-exact-slice-review-receipt-layout.v1";
export const SELECTOR_INDEX_FILE = "selector-index";
export const RECEIPT_OUTCOMES = new Set(["clean", "changes_requested"]);
export const RECEIPT_STATES = new Set(["available", "reserved", "consumed"]);
export const RUN_STATUSES = new Set(["launching", "running", "succeeded", "failed", "cancelled"]);
export const PROOF_STATES = new Set(["unminted", "minted"]);
export const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);
export const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
export const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
export const OPAQUE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;

export const REVIEW_DISPATCH_IDENTITY_SCHEMA_VERSION =
  "workspace-agent-review-dispatch-identity.v1";
export const ATTEMPT_LINEAGE_IDENTITY_SCHEMA_VERSION =
  "workspace-agent-attempt-lineage-identity.v1";
export const RECOVERY_TRANSITION_IDENTITY_SCHEMA_VERSION =
  "workspace-agent-recovery-transition-identity.v1";
export const REVIEW_DISPATCH_ID_RE = /^review-dispatch-[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
export const ATTEMPT_LINEAGE_ID_RE = /^attempt-lineage-[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
export const RECOVERY_TRANSITION_ID_RE = /^recovery-transition-[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
export const IDENTITY_GENERATION_DIGEST_RE = /^(?:controlled-contract-generation:none|sha256:[0-9a-f]{64})$/u;
export const REVIEW_DISPATCH_IDENTITY_FIELDS = Object.freeze([
  "schema_version", "kind", "review_dispatch_id", "target", "current_generation"
]);
export const ATTEMPT_LINEAGE_IDENTITY_FIELDS = Object.freeze([
  "schema_version", "kind", "review_dispatch_id", "attempt_id", "attempt_number",
  "target", "current_generation", "run_id", "monitor_handle"
]);
export const RECOVERY_TRANSITION_IDENTITY_FIELDS = Object.freeze([
  "schema_version", "kind", "transition_id", "transition_type", "review_dispatch_id",
  "prior_attempt_id", "next_attempt_id", "target", "prior_generation", "next_generation"
]);
export const REVIEWER_LINEAGE_RECEIPT_FIELDS = Object.freeze([
  "review_dispatch_identity", "attempt_lineage_identity", "recovery_transition_identity"
]);
export const UNIT_RE = /^(WK-\d{4})#(SLICE-\d{3})$/u;
export const INITIATIVE_RE = /^IN-\d{4}$/u;
export const FINDING_SEVERITIES = new Set(["critical", "high", "medium", "low", "info"]);
export const FINDING_COUNT_FIELDS = Object.freeze(["total", "blocking", "critical", "high", "medium", "low", "info"]);
export const REVIEW_RESULT_FIELDS = Object.freeze([
  "review_outcome", "clean_review", "no_findings", "blocking_finding_count",
  "medium_finding_count", "reviewed_controls"
]);
export const COMMON_RECEIPT_FIELDS = Object.freeze([
  "schema_version", "unit_address", "record_id", "slice_id", "initiative",
  "canonical_parent_wk_contract", "canonical_parent_contract_digest",
  "slice_review_contract", "slice_review_contract_digest",
  "review_run_id", "review_monitor_handle", "reviewer_role", "slice_ref", "worktree_path",
  "worktree_identity", "worktree_identity_digest", "reviewed_sha", "diff_base_sha",
  "frozen_context_state", "terminal_run_status", "structured_outcome", "proof_state",
  "trusted_evidence_digest", "receipt_digest"
]);
export const V3_COMMON_RECEIPT_FIELDS = Object.freeze(COMMON_RECEIPT_FIELDS.filter((field) =>
  field !== "frozen_context_state" && field !== "proof_state"
));
export const V1_RECEIPT_IDENTITY_FIELDS = Object.freeze(["source_worker_run_id", "source_worker_monitor_handle"]);
export const V2_RECEIPT_IDENTITY_FIELDS = Object.freeze(["review_admission_kind", "committed_target_digest"]);
export const RECEIPT_FIELDS = Object.freeze([...COMMON_RECEIPT_FIELDS, ...V1_RECEIPT_IDENTITY_FIELDS]);
export const RECEIPT_FIELDS_V2 = Object.freeze([...COMMON_RECEIPT_FIELDS, ...V2_RECEIPT_IDENTITY_FIELDS]);
export const RECEIPT_FIELDS_V3 = Object.freeze([...V3_COMMON_RECEIPT_FIELDS, ...V2_RECEIPT_IDENTITY_FIELDS]);
export const RECEIPT_FIELDS_V4 = Object.freeze([...RECEIPT_FIELDS_V3, ...REVIEWER_LINEAGE_RECEIPT_FIELDS]);
export const IMMUTABLE_COMMON_RECEIPT_FIELDS = Object.freeze(COMMON_RECEIPT_FIELDS.filter((field) => ![
  "frozen_context_state", "terminal_run_status", "structured_outcome", "proof_state",
  "trusted_evidence_digest", "receipt_digest"
].includes(field)));
export const RECEIPT_VERDICT_EVIDENCE_FIELD = "verdict_evidence";
export const VERDICT_EVIDENCE_VALUES = new Set(Object.values(RECEIPT_VERDICT_EVIDENCE_STATES));
export const VERDICT_EVIDENCE_RANK = Object.freeze({
  pending: 0, verdict_recorded: 1, neutral_prose_recorded: 1,
  no_verdict_child_terminal: 1, no_verdict_launch_failed: 1
});
export const RECEIPT_CLEANUP_ONLY_FIELD = "cleanup_only_terminal_failure";
export const RECEIPT_RESULT_MODE_FIELD = "result_mode";
export const RECEIPT_DEPENDENCY_PROJECTION_EVIDENCE_FIELD =
  "dependency_projection_evidence";
export const FINDINGS_DEPENDENCY_PROJECTION_EVIDENCE_SCHEMA_VERSION =
  "workspace-agent-findings-dependency-projection-evidence.v1";
export const OPTIONAL_RECEIPT_FIELDS = Object.freeze([
  RECEIPT_VERDICT_EVIDENCE_FIELD,
  RECEIPT_CLEANUP_ONLY_FIELD,
  RECEIPT_RESULT_MODE_FIELD,
  RECEIPT_DEPENDENCY_PROJECTION_EVIDENCE_FIELD
]);
export const V1_WORKTREE_FIELDS = Object.freeze([
  "schema_version", "launch_ref", "run_id", "retry_id", "unit_address", "initiative",
  "record_id", "slice_id", "base_ref", "base_sha", "output_branch", "worktree_path",
  "read_scope", "repo_paths", "write_scope", "write_scope_source", "selected_unit",
  "source_digest", "source_version", "cone_dirs", "index_sparse"
]);
export const V2_WORKTREE_FIELDS = Object.freeze([
  ...V1_WORKTREE_FIELDS.filter((field) => field !== "cone_dirs" && field !== "index_sparse"),
  "checkout_mode"
]);
export const IMMUTABLE_COMMIT_RANGE_WORKTREE_FIELDS = Object.freeze([
  "schema_version", "unit_address", "initiative", "record_id", "slice_id",
  "repository_identity", "diff_base_sha", "reviewed_sha", "reviewed_tree_sha",
  "immutable_source_identity", "snapshot_commit", "snapshot_tree", "worktree_path",
  "committed_target_digest"
]);
export const COMMITTED_SLICE_WORKTREE_FIELDS = Object.freeze([
  "schema_version", "unit_address", "initiative", "record_id", "slice_id",
  "slice_ref", "wk_ref", "wk_sha", "reviewed_sha", "diff_base_sha",
  "worktree_path", "changed_paths", "write_scope", "source_digest",
  "commit_chain", "committed_target_digest"
]);
export const STANDALONE_FINDINGS_WORKTREE_FIELDS = Object.freeze([
  "schema_version", "unit_address", "initiative", "record_id", "slice_id",
  "repository_path", "target_ref", "target_sha", "worktree_path",
  "canonical_source_digest", "committed_target_digest"
]);

export function receiptCompletesExactSliceReview(receipt) {
  if (receipt === null || typeof receipt !== "object") return false;
  let resultMode;
  try {
    resultMode = Object.prototype.hasOwnProperty.call(receipt, RECEIPT_RESULT_MODE_FIELD)
      ? validateWorkspaceAgentResultModeEnvelope(receipt[RECEIPT_RESULT_MODE_FIELD])
      : buildLegacyWorkspaceAgentResultModeCompatibilityEnvelope(receipt);
  } catch {
    return false;
  }
  return resultModeCompletesMechanicalReview(resultMode.mode) &&
    (receipt.terminal_run_status === "succeeded" ||
      (receipt.terminal_run_status === "failed" && receipt[RECEIPT_CLEANUP_ONLY_FIELD] === true));
}

export function receiptCarriesUsableReviewVerdict(receipt) {
  return receiptCompletesExactSliceReview(receipt);
}
