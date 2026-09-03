

import {
  CanonicalIntegratedLifecycleStateError
} from "./backend-integrated-scope-authority.mjs";
import {
  MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES,
  MANAGED_CORRECTIVE_OBSERVED_STATUS_FIELDS,
  MANAGED_CORRECTIVE_RECOVERY_FIELDS,
  MANAGED_CORRECTIVE_RECOVERY_OBSERVED_FIELDS,
  MANAGED_CORRECTIVE_STATUSES,
  MANAGED_CORRECTIVE_STATUS_RECOVERY_KIND,
  MANAGED_CORRECTIVE_STATUS_VALUES
} from "@agent-chassis/agent-launch-core";

export {
  MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES,
  MANAGED_CORRECTIVE_OBSERVED_STATUS_FIELDS,
  MANAGED_CORRECTIVE_RECOVERY_FIELDS,
  MANAGED_CORRECTIVE_RECOVERY_OBSERVED_FIELDS,
  MANAGED_CORRECTIVE_STATUSES,
  MANAGED_CORRECTIVE_STATUS_RECOVERY_KIND,
  MANAGED_CORRECTIVE_STATUS_VALUES
};

export const MANAGED_NO_DELIVERY_EVIDENCE_DIAGNOSTIC_CODES = Object.freeze({
  BINDING_UNRESOLVED: "agent_launch.managed_run.no_delivery_binding_unresolved.v1",
  GIT_UNRESOLVED: "agent_launch.managed_run.no_delivery_git_unresolved.v1"
});

export const CORRECTIVE_REVIEW_OUTCOME = "changes_requested";
export const CORRECTIVE_COMMITTED_REVIEW_ADMISSION_KIND = "canonical_committed_slice";
export const TRUSTED_CORRECTIVE_FINDINGS_CONTEXT_SCHEMA_VERSION =
  "workspace-agent-trusted-corrective-findings-context.v1";

export const CORRECTIVE_GROUP_DIAGNOSTIC_MAX = 8;
export const SUPERSEDED_ATTEMPT_RETIREMENT_RESULTS_SCHEMA_VERSION =
  "workspace-agent-superseded-attempt-retirement-results.v1";
export const SUPERSEDED_ATTEMPT_RETIREMENT_RESULT_MAX = 32;
export const SUPERSEDED_ATTEMPT_RETIREMENT_REASON_MAX = 200;

export class ManagedCorrectiveContinuationError extends Error {
  constructor(message, { code, detail = null, cause = null } = {}) {
    super(message);
    this.name = "ManagedCorrectiveContinuationError";
    this.code = code;
    if (detail !== null) this.detail = detail;
    if (cause !== null) this.cause = cause;
  }
}

export function failCorrectiveContinuation(code, what, { detail = null, cause = null } = {}) {
  const causeCode = typeof cause?.code === "string" ? cause.code : null;
  const causeMessage = cause === null ? null : (cause.message ?? String(cause));
  throw new ManagedCorrectiveContinuationError(
    `agent-launch managed-run corrective continuation: ${what} [${code}]` +
      (causeCode === null ? "" : ` cause=${causeCode}`) +
      (causeMessage === null ? "" : `: ${causeMessage}`),
    { code, detail: { ...(detail ?? {}), cause_code: causeCode }, cause }
  );
}

export function observedCanonicalStatusFacts(cause) {
  return cause instanceof CanonicalIntegratedLifecycleStateError
    ? (cause.observed ?? null)
    : null;
}

export function correctiveStatusReconciliationRecovery(subject, observed, {
  monitorHandle = null
} = {}) {
  if (observed === null ||
      observed.parent_status !== MANAGED_CORRECTIVE_STATUSES.TODO ||
      observed.slice_status !== MANAGED_CORRECTIVE_STATUSES.TODO) {
    return null;
  }
  if (typeof monitorHandle !== "string" || monitorHandle.length === 0) return null;
  return Object.freeze({
    recovery_kind: MANAGED_CORRECTIVE_STATUS_RECOVERY_KIND,

    observed: Object.freeze({
      parent_status: observed.parent_status,
      slice_status: observed.slice_status
    }),

    unit: observed.record_id,
    slice_unit: subject,
    responsible_actor: "launcher",
    next_action: "retry_workspace_agent_run_status_same_monitor_and_subject",
    monitor_handle: monitorHandle,
    exact_subject: subject,
    launcher_retirement_required: true,
    filesystem_cleanup_forbidden: true,
    preserve_substantive_review: true,
    preserve_review_status: true,
    replacement_review_required: false,
    notification:
      "launcher retirement is required; filesystem cleanup is forbidden; preserve the substantive review and review status; retry workspace_agent_run_status with the same monitor handle and exact subject"
  });
}

export function sharedRejectedCanonicalStatusFacts(subject, rejected) {
  if (rejected.length < 2) return null;
  let shared = null;
  for (const entry of rejected) {
    if (!(entry.error instanceof ManagedCorrectiveContinuationError) ||
        entry.error.code !==
          MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES.INTEGRATED_STATE_UNRESOLVED) {
      return null;
    }

    const observed = observedCanonicalStatusFacts(entry.error.cause);
    if (observed === null) return null;

    if (`${observed.record_id}#${observed.slice_id}` !== subject) return null;
    if (shared === null) {
      shared = observed;
    } else if (observed.record_id !== shared.record_id ||
        observed.slice_id !== shared.slice_id ||
        observed.parent_status !== shared.parent_status ||
        observed.slice_status !== shared.slice_status) {
      return null;
    }
  }
  return shared;
}

export const NO_DELIVERY_COMMIT_ID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export const NO_DELIVERY_DIAGNOSTIC_VALUE_MAX = 120;

export class ManagedNoDeliveryEvidenceError extends Error {
  constructor(message, { code, detail = null, cause = null } = {}) {
    super(message);
    this.name = "ManagedNoDeliveryEvidenceError";
    this.code = code;
    if (detail !== null) this.detail = detail;
    if (cause !== null) this.cause = cause;
  }
}

export function failNoDeliveryEvidence(code, what, { detail = null, cause = null } = {}) {
  const causeCode = typeof cause?.code === "string" ? cause.code : null;
  const causeMessage = cause === null ? null : (cause.message ?? String(cause));
  throw new ManagedNoDeliveryEvidenceError(
    `agent-launch managed-run restart: ${what} [${code}]` +
      (causeCode === null ? "" : ` cause=${causeCode}`) +
      (causeMessage === null ? "" : `: ${causeMessage}`),
    { code, detail: { ...(detail ?? {}), cause_code: causeCode }, cause }
  );
}
