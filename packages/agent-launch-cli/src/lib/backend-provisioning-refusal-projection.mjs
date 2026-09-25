

import path from "node:path";

import {
  RUNTIME_BLOCKER_CODES,
  getRuntimeBlockerEntry
} from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
import { BACKEND_REFUSAL_CODES } from "@agent-chassis/agent-launch-core";
import { WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES } from "./worktree-substrate.mjs";

import {
  SLICE_TIP_RECONCILE_DIAGNOSTIC_CODES,
  SLICE_TIP_RECONCILE_STATES
} from "./worktree-substrate-exact-unit.mjs";
import { isPlainObject } from "./backend-review-identity.mjs";
import { LAUNCHER_TRANSITION_FAILURES } from "./launcher-transition-plan.mjs";

const MANAGED_PROVISIONING_UNAVAILABLE =
  RUNTIME_BLOCKER_CODES.MANAGED_WORKTREE_PROVISIONING_UNAVAILABLE;
const MANAGED_SLICE_TIP_RECONCILE_REQUIRED =
  RUNTIME_BLOCKER_CODES.MANAGED_SLICE_TIP_RECONCILE_REQUIRED;

export const BASE_SELECTION_MISSING_LAUNCH_REASON = "managed_worktree_base_selection_missing";
export const BASE_SELECTION_PREREQUISITE =
  "the canonical WK record must explicitly select base_branch before its first worker starts";
export const BASE_SELECTION_NO_FALLBACK =
  "No checkout, HEAD, main or master fallback applies; after allocation the captured base is frozen.";
export const BASE_SELECTION_EDITOR = "workspace_work_record_edit";
export const BASE_SELECTION_FIELD_GUIDANCE = Object.freeze({
  route: "workspace_tools_describe",
  args: Object.freeze({
    tool_name: BASE_SELECTION_EDITOR,
    input_contract: Object.freeze({ kind: "field", field: "base_branch", scope: "record" })
  }),
  information: "The ordinary editor's record-level base_branch field contract: action, value constraints and request shape."
});

export function baseSelectionMissingPreflightMessage(recordId) {
  return `Root ${recordId} selects no base_branch, so dispatch refuses before its first ` +
    `managed allocation (${BASE_SELECTION_MISSING_LAUNCH_REASON}). An operator chooses an ` +
    `existing canonical short local branch; author it on the root ${recordId}, not a slice, ` +
    `through ${BASE_SELECTION_EDITOR} field base_branch with the root record's fresh ` +
    "expected_source_digest (field guidance: workspace_tools_describe input_contract " +
    '{kind:"field",field:"base_branch",scope:"record"}), then dispatch. ' +
    BASE_SELECTION_NO_FALLBACK;
}

function baseSelectionGuidanceRecovery() {
  return Object.freeze({
    state: "guidance",
    route: BASE_SELECTION_FIELD_GUIDANCE.route,
    args: BASE_SELECTION_FIELD_GUIDANCE.args,
    information: BASE_SELECTION_FIELD_GUIDANCE.information,
    responsible_actor: "operator",
    prerequisite: BASE_SELECTION_PREREQUISITE,
    operator_action:
      `choose an existing canonical short local branch; author it on the root record's base_branch through ${BASE_SELECTION_EDITOR} with the root's fresh expected_source_digest`,
    retry_condition: "resubmit the original workspace_agent_dispatch after the edit is accepted",
    explanation: BASE_SELECTION_NO_FALLBACK
  });
}

function missingBaseRefRecovery() {
  return Object.freeze({
    state: "no_supported_route",
    route: null,
    responsible_actor: "operator",
    prerequisite:
      "the launcher-selected repository must resolve the WK-selected local branch to the intended commit",
    operator_action:
      "create or restore the selected local branch at the intended commit, or correct base_branch before the WK is provisioned",
    retry_condition:
      "retry workspace_agent_dispatch only after the prerequisite is confirmed",
    explanation:
      "no automatic recovery route is available; retry alone cannot create or repair the required ref"
  });
}

function missingRequiredBaseRefDiagnostic(error) {
  const detail = error?.detail;
  if (error?.code !== WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.GIT_FAILED ||
      !isPlainObject(detail) || !["required_base_ref_missing", "required_base_selection_missing"].includes(detail.failure_kind) ||
      detail.provisioning_stage !== "pre_worker_worktree_provisioning" ||
      detail.provisioning_operation !== "base_ref_resolution" ||
      typeof detail.repository_path !== "string" || !path.isAbsolute(detail.repository_path) ||
      (detail.required_ref !== null && typeof detail.required_ref !== "string") ||
      detail.base_selection?.source !== "work_record.base_branch" ||
      detail.base_selection?.policy !== "explicit_per_wk_branch" ||
      (detail.failure_kind === "required_base_ref_missing" &&
        (typeof detail.status !== "number" || typeof detail.stderr !== "string"))) {
    return null;
  }
  return detail;
}

const SLICE_TIP_RECONCILE_TAXONOMY_ENTRY =
  getRuntimeBlockerEntry(MANAGED_SLICE_TIP_RECONCILE_REQUIRED);
if (SLICE_TIP_RECONCILE_TAXONOMY_ENTRY?.actor_recovery !== "coordinator" ||
    typeof SLICE_TIP_RECONCILE_TAXONOMY_ENTRY?.recovery?.route !== "string") {
  throw new Error("WK-1694 slice-tip reconciliation blocker entry is absent or incompatible");
}

const SLICE_TIP_RECONCILE_BLOCKING_STATES = Object.freeze([
  SLICE_TIP_RECONCILE_STATES.ACCUMULATED_IMPLEMENTATION_TIP,
  SLICE_TIP_RECONCILE_STATES.ORPHANED
]);

function boundedString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function classifySliceTipReconcileRefusal(error) {
  if (error?.code !== SLICE_TIP_RECONCILE_DIAGNOSTIC_CODES.SLICE_TIP_RECONCILE_REQUIRED) return null;
  const detail = error.detail;
  if (!isPlainObject(detail)) return null;
  if (!SLICE_TIP_RECONCILE_BLOCKING_STATES.includes(detail.reconcile_state)) return null;
  const unit = typeof detail.unit_address === "string"
    ? detail.unit_address.match(/^IN-\d{4}\/(WK-\d{4})\/(SLICE-\d{3})$/u)
    : null;
  if (unit === null) return null;
  return {
    subject: `${unit[1]}#${unit[2]}`,
    reconcile_state: detail.reconcile_state,
    slice_tip: boundedString(detail.slice_tip),
    wk_base_ref: boundedString(detail.wk_base_ref),
    wk_base_sha: boundedString(detail.wk_base_sha),
    reason: boundedString(detail.reason),
    recovery_route: boundedString(detail.recovery_route)
  };
}

export function projectProvisioningRefusal(error, serialized, { requestedRepositoryAlias = null } = {}) {
  const { cause, diagnostic } = serialized;
  const missingBase = missingRequiredBaseRefDiagnostic(error);
  if (missingBase !== null) {
    const selectionMissing = missingBase.failure_kind === "required_base_selection_missing";
    return {
      accepted: false,
      refusal: {
        code: BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
        reason: selectionMissing
          ? BASE_SELECTION_MISSING_LAUNCH_REASON
          : "managed_worktree_base_ref_missing",
        detail: Object.freeze({
          cause,
          diagnostic,
          failure_stage: missingBase.provisioning_stage,
          provisioning_operation: missingBase.provisioning_operation,
          repository_path: missingBase.repository_path,
          requested_repository_alias: typeof requestedRepositoryAlias === "string"
            ? requestedRepositoryAlias
            : null,
          required_ref: missingBase.required_ref,
          base_selection: missingBase.base_selection,

          ...(selectionMissing ? { provisioning_compensation: "completed" } : {}),
          actor_recovery: "operator",
          recovery: selectionMissing ? baseSelectionGuidanceRecovery() : missingBaseRefRecovery()
        })
      }
    };
  }

  const reconcile = classifySliceTipReconcileRefusal(error);
  if (reconcile !== null) {
    if (reconcile.reconcile_state ===
        SLICE_TIP_RECONCILE_STATES.ACCUMULATED_IMPLEMENTATION_TIP) {
      return {
        accepted: false,
        refusal: {
          code: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
          reason: LAUNCHER_TRANSITION_FAILURES.LIFECYCLE_ALLOCATION_FAILED.code,
          detail: Object.freeze({
            cause,
            diagnostic,
            reason: "exact_slice_accumulated_implementation_requires_integration",
            failure_class: "lifecycle",
            reconcile_state: reconcile.reconcile_state,
            slice_tip: reconcile.slice_tip,
            wk_base_ref: reconcile.wk_base_ref,
            wk_base_sha: reconcile.wk_base_sha,
            actor_recovery: "coordinator",
            next_action: reconcile.recovery_route ??
              "integrate_accumulated_implementation"
          })
        }
      };
    }
    return {
      accepted: false,
      refusal: {
        code: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
        reason: MANAGED_SLICE_TIP_RECONCILE_REQUIRED,
        detail: Object.freeze({
          cause,
          diagnostic,

          reconcile_state: reconcile.reconcile_state,
          slice_tip: reconcile.slice_tip,
          wk_base_ref: reconcile.wk_base_ref,
          wk_base_sha: reconcile.wk_base_sha,
          actor_recovery: SLICE_TIP_RECONCILE_TAXONOMY_ENTRY.actor_recovery,
          next_action: SLICE_TIP_RECONCILE_TAXONOMY_ENTRY.recovery.route,
          next_action_args: Object.freeze({ role: "reviewer", subject: reconcile.subject })
        })
      }
    };
  }
  return {
    accepted: false,
    refusal: {
      code: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
      reason: MANAGED_PROVISIONING_UNAVAILABLE,
      detail: Object.freeze({
        cause,
        diagnostic,
        recovery: Object.freeze({
          state: "no_supported_route",
          route: null
        })
      })
    }
  };
}
