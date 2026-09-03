

import {
  evaluateGraphImpactBlocker,
  RUNTIME_BLOCKER_CODES
} from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
import {
  MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES,
  MANAGED_CORRECTIVE_STATUS_RECOVERY_KIND,
  MANAGED_CORRECTIVE_STATUS_VALUES
} from "@agent-chassis/agent-launch-core";
import {
  CANONICAL_INTEGRATED_LIFECYCLE_STATE_IMPOSSIBLE_CODE
} from "@agent-chassis/agent-launch-cli/src/lib/backend-integrated-scope-authority.mjs";

export const RECOVERABLE_DISPATCH_STATES = new Set([
  "recoverable_missing", "recoverable_stale", "recoverable_outdated"
]);

export function projectManagedCorrectiveStatusRecovery(refusal, subject) {
  if (refusal?.reason !== "managed_run_identity_check_threw") return null;
  const source = refusal?.detail;
  const observed = source?.observed_canonical_status;
  const recovery = source?.recovery;
  if (source?.code !==
        MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES.INTEGRATED_STATE_UNRESOLVED ||
      source?.cause_code !== CANONICAL_INTEGRATED_LIFECYCLE_STATE_IMPOSSIBLE_CODE ||
      !observed || typeof observed !== "object" || Array.isArray(observed) ||
      !recovery || typeof recovery !== "object" || Array.isArray(recovery) ||
      recovery.recovery_kind !== MANAGED_CORRECTIVE_STATUS_RECOVERY_KIND ||
      recovery.responsible_actor !== "launcher" ||
      recovery.next_action !== "retry_workspace_agent_run_status_same_monitor_and_subject" ||
      recovery.slice_unit !== subject || recovery.exact_subject !== subject ||
      recovery.unit !== observed.record_id || typeof recovery.monitor_handle !== "string" ||
      recovery.monitor_handle.length === 0 || recovery.launcher_retirement_required !== true ||
      recovery.filesystem_cleanup_forbidden !== true || recovery.preserve_substantive_review !== true ||
      recovery.preserve_review_status !== true || recovery.replacement_review_required !== false ||
      !MANAGED_CORRECTIVE_STATUS_VALUES.includes(observed.parent_status) ||
      !MANAGED_CORRECTIVE_STATUS_VALUES.includes(observed.slice_status) ||
      observed.parent_status !== recovery.observed?.parent_status ||
      observed.slice_status !== recovery.observed?.slice_status) return null;
  return {
    blockerCode: RUNTIME_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED,
    reason: "launcher_retirement_incomplete",
    detail: {
      observed: { parent_status: observed.parent_status, slice_status: observed.slice_status },
      recovery_kind: MANAGED_CORRECTIVE_STATUS_RECOVERY_KIND, unit: recovery.unit, slice_unit: subject,
      launcher_retirement_required: true, filesystem_cleanup_forbidden: true,
      preserve_substantive_review: true, preserve_review_status: true, replacement_review_required: false,
      notification: recovery.notification,
      next_call: { route: "workspace_agent_run_status", arguments: { monitor_handle: recovery.monitor_handle, subject } }
    },
    nextAction: `workspace_agent_run_status(monitor_handle=${recovery.monitor_handle}, subject=${subject})`
  };
}
export function graphDerivationRequiredForDispatch(state) {
  return state === "fresh" || RECOVERABLE_DISPATCH_STATES.has(state);
}

export function graphBlockerCodeForReadiness(readiness) {
  if (!new Set(["missing_graph_impact", "stale_write_scope"]).has(readiness?.decision_code)) return null;
  if (readiness?.recovery?.graph_impact === "not_required" ||
      readiness?.recovery?.graph_impact === "fresh" ||
      readiness?.recovery?.graph_impact === "nonrecoverable_missing_paths") return null;
  const state = readiness?.state?.graph_state ?? {};
  const evaluated = evaluateGraphImpactBlocker({
    graph_state: state.graph_state ?? null, staleness: state.staleness ?? null,
    dirty_state: state.dirty_state ?? null, overlay_state: state.overlay_state ?? null
  });
  return evaluated?.blocking === true ? evaluated.code : null;
}
