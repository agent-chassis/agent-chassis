

import {
  validateWorkerAdmissionRecoveryResult
} from "@agent-chassis/wiki-core/src/lib/node-engine-worker-admission-recovery.mjs";

function selectedUnitForNeedsReview(subject) {
  const match = /^(WK-\d{4})(?:#([^\s]+))?$/u.exec(subject ?? "");
  if (!match) return null;
  return {
    kind: match[2] ? "slice" : "work_item",
    address: subject,
    record_id: match[1],
    slice_id: match[2] ?? null
  };
}

function nonAuthorizingNextAction(validation) {
  if (validation.state === "valid") {
    return "Follow the CCE-selected recovery actions without substitution or local reordering, then run workspace_validate_dispatch.";
  }
  return "Preserve the CCE needs_review effect and use the validator-owned recovery diagnostic to repair the producer or consumer boundary before revalidation.";
}

export function projectNeedsReviewRefusal({ readiness, subject }) {
  const validation = validateWorkerAdmissionRecoveryResult(
    readiness?.admissibility?.recovery_validation,
    { expectedProjectionMode: "bounded_current_decision_recovery" }
  );
  const selectedUnit = selectedUnitForNeedsReview(subject);
  const validRecovery = validation.state === "valid" ? validation.recovery : null;
  const detail = {
    refusal_kind: "worker_admission_remote_needs_review",
    admissibility_status: "needs_review",
    launch_authoritative: false,
    recovery_contract: validRecovery ? "valid_recovery_v1" : "projection_mismatch",
    ...(selectedUnit ? { selected_unit: selectedUnit } : {}),
    ...(validation.diagnostic ? { recovery_diagnostic: validation.diagnostic } : {}),
    ...(validRecovery ? { worker_admission_recovery: validRecovery } : {})
  };
  return {
    detail,
    nextAction: nonAuthorizingNextAction(validation)
  };
}
