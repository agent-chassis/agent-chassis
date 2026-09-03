

export const MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES = Object.freeze({
  RECEIPTS_CONTRADICTORY:
    "agent_launch.managed_run.corrective_receipts_contradictory.v1",
  INTEGRATED_STATE_UNRESOLVED:
    "agent_launch.managed_run.corrective_integrated_state_unresolved.v1",
  REVIEWED_TARGET_MISMATCH:
    "agent_launch.managed_run.corrective_reviewed_target_mismatch.v1"
});

export const MANAGED_CORRECTIVE_STATUS_RECOVERY_KIND =
  "agent_launch.managed_run.corrective_status_reconciliation.v1";

export const MANAGED_CORRECTIVE_STATUSES = Object.freeze({
  TODO: "todo",
  ACTIVE: "active",
  BLOCKED: "blocked",
  REVIEW: "review",
  DONE: "done"
});

export const MANAGED_CORRECTIVE_STATUS_VALUES = Object.freeze(
  Object.values(MANAGED_CORRECTIVE_STATUSES)
);

export const MANAGED_CORRECTIVE_OBSERVED_STATUS_FIELDS = Object.freeze([
  "parent_status",
  "record_id",
  "slice_id",
  "slice_status"
]);

export const MANAGED_CORRECTIVE_RECOVERY_OBSERVED_FIELDS = Object.freeze([
  "parent_status",
  "slice_status"
]);

export const MANAGED_CORRECTIVE_RECOVERY_FIELDS = Object.freeze([
  "exact_subject",
  "filesystem_cleanup_forbidden",
  "launcher_retirement_required",
  "monitor_handle",
  "next_action",
  "notification",
  "observed",
  "preserve_review_status",
  "preserve_substantive_review",
  "recovery_kind",
  "replacement_review_required",
  "responsible_actor",
  "slice_unit",
  "unit"
]);
