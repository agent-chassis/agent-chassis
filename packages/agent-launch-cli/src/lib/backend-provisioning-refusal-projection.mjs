import { INTEGRATED_SLICE_REDISPATCH_CODE } from "@agent-chassis/wiki-core/src/lib/integrated-slice-dispatch.mjs";
import { MANAGED_CONTROLLED_CONTRACT_GENERATION_DIAGNOSTIC_CODES } from "./worktree-provisioning-dispatch-managed.mjs";
import { controlledAcceptanceDispatchGuidance } from "@agent-chassis/wiki-core/src/lib/controlled-acceptance-dispatch-recovery.mjs";

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
import {
  CANONICAL_WK_CONTENT_SOURCE_KIND,
  CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES
} from "./controlled-carrier-attachment-primitive.mjs";

const MANAGED_PROVISIONING_UNAVAILABLE =
  RUNTIME_BLOCKER_CODES.MANAGED_WORKTREE_PROVISIONING_UNAVAILABLE;
const MANAGED_SLICE_TIP_RECONCILE_REQUIRED =
  RUNTIME_BLOCKER_CODES.MANAGED_SLICE_TIP_RECONCILE_REQUIRED;

export const BASE_SELECTION_MISSING_LAUNCH_REASON = "managed_worktree_base_selection_missing";
export const BASE_SELECTION_PREREQUISITE =
  "the canonical WK record must explicitly select base_branch before its first worker starts";
export const BASE_SELECTION_NO_FALLBACK =
  "No checkout, HEAD, main or master fallback applies; after allocation the captured base is frozen.";
export const BASE_SELECTION_EDITOR = "save_record";

export function baseSelectionMissingPreflightMessage(recordId) {
  return `Root ${recordId} selects no base_branch, so dispatch refuses before its first ` +
    `managed allocation (${BASE_SELECTION_MISSING_LAUNCH_REASON}). An operator chooses an ` +
    `existing canonical short local branch; author it on the root ${recordId}, not a slice, ` +
    `through ${BASE_SELECTION_EDITOR} changes.base_branch with the root record's fresh ` +
    "revision from workspace_read_wiki({subject:root}), then retry start_agent on the original " +
    "exact slice. The save requires the caller's branch choice; it is not an executable call yet. " +
    BASE_SELECTION_NO_FALLBACK;
}

function baseSelectionGuidanceRecovery() {
  return Object.freeze({
    state: "no_supported_route",
    route: null,
    responsible_actor: "operator",
    prerequisite: BASE_SELECTION_PREREQUISITE,
    operator_action:
      `choose an existing canonical short local branch; read the root through workspace_read_wiki and author changes.base_branch through ${BASE_SELECTION_EDITOR} with that root's fresh revision. The branch value is required caller input, not an executable correction`,
    retry_condition: "resubmit the original start_agent after the save is accepted",
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
      "retry start_agent only after the prerequisite is confirmed",
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

function exhaustedCanonicalWkContentRefresh(error) {
  const details = error?.details;
  if (error?.code !== CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.SOURCE_CHANGED ||
      !isPlainObject(details) || details.source_kind !== CANONICAL_WK_CONTENT_SOURCE_KIND ||
      details.single_refresh?.exhausted !== true) {
    return null;
  }
  return details;
}

function unsettledCanonicalWkContentRecovery() {
  return Object.freeze({
    state: "no_supported_route",
    route: null,
    responsible_actor: "coordinator",
    prerequisite: "updates to the canonical WK record have settled",
    retry_condition:
      "a later explicit start_agent request is a new attempt; nothing resubmits it and it is not promised to succeed",
    explanation:
      "the canonical WK record changed during preparation and again during its single refresh, so preparation could not settle; the contract and its proofs were not found invalid, and no worker was started"
  });
}

export function projectProvisioningRefusal(error, serialized, { requestedRepositoryAlias = null } = {}) {
  const { cause, diagnostic } = serialized;
  if (error?.code === INTEGRATED_SLICE_REDISPATCH_CODE) {
    return { accepted: false, refusal: { code: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
      reason: INTEGRATED_SLICE_REDISPATCH_CODE,
      detail: { cause, diagnostic, integrated_slice: { code: error.code, reason: error.message, detail: error.detail } } } };
  }

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
  const controlled = Object.values(MANAGED_CONTROLLED_CONTRACT_GENERATION_DIAGNOSTIC_CODES).includes(error?.code)
    ? error.detail?.controlled_acceptance_failure ?? null : null;
  const unsettled = exhaustedCanonicalWkContentRefresh(error);
  return {
    accepted: false,
    refusal: {
      code: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
      reason: MANAGED_PROVISIONING_UNAVAILABLE,
      detail: Object.freeze(unsettled === null ? {
        cause,
        diagnostic,
        ...(error?.preparation_settlement === undefined ? {} : { preparation_settlement: error.preparation_settlement }),
        ...(error?.preparation_cleanup === undefined ? {} : { preparation_cleanup: error.preparation_cleanup }),
        ...(controlled === null ? {} : { controlled_acceptance_failure: controlled }),
        recovery: controlled === null ? Object.freeze({
          state: "no_supported_route",
          route: null
        }) : controlledAcceptanceDispatchGuidance(controlled)
      } : {
        cause,
        diagnostic,
        ...(error?.preparation_settlement === undefined ? {} : { preparation_settlement: error.preparation_settlement }),
        ...(error?.preparation_cleanup === undefined ? {} : { preparation_cleanup: error.preparation_cleanup }),

        failure_stage: unsettled.stage,
        source_kind: unsettled.source_kind,
        source_path: unsettled.path,
        preparation_refresh: unsettled.single_refresh,
        actor_recovery: "coordinator",
        recovery: unsettledCanonicalWkContentRecovery()
      })
    }
  };
}
