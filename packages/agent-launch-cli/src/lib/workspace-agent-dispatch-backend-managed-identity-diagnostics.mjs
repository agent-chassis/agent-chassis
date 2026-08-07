

import {
  CanonicalIntegratedLifecycleStateError
} from "./backend-integrated-scope-authority.mjs";

export const MANAGED_NO_DELIVERY_EVIDENCE_DIAGNOSTIC_CODES = Object.freeze({
  BINDING_UNRESOLVED: "agent_launch.managed_run.no_delivery_binding_unresolved.v1",
  GIT_UNRESOLVED: "agent_launch.managed_run.no_delivery_git_unresolved.v1"
});

export const MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES = Object.freeze({
  RECEIPTS_CONTRADICTORY: "agent_launch.managed_run.corrective_receipts_contradictory.v1",
  INTEGRATED_STATE_UNRESOLVED: "agent_launch.managed_run.corrective_integrated_state_unresolved.v1",
  REVIEWED_TARGET_MISMATCH: "agent_launch.managed_run.corrective_reviewed_target_mismatch.v1"
});

const CORRECTIVE_STATUS_RECONCILIATION_RECOVERY_KIND =
  "agent_launch.managed_run.corrective_status_reconciliation.v1";
const CORRECTIVE_STATUS_RECONCILIATION_ACTIONABLE_PARENT_STATUS = "todo";
const CORRECTIVE_STATUS_RECONCILIATION_ACTIONABLE_SLICE_STATUS = "todo";
const CORRECTIVE_STATUS_RECONCILIATION_REQUIRED_PARENT_STATUS = "active";
const CORRECTIVE_STATUS_RECONCILIATION_REQUIRED_SLICE_STATUS = "todo";

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

export function correctiveStatusReconciliationRecovery(subject, observed) {
  if (observed === null ||
      observed.parent_status !== CORRECTIVE_STATUS_RECONCILIATION_ACTIONABLE_PARENT_STATUS ||
      observed.slice_status !== CORRECTIVE_STATUS_RECONCILIATION_ACTIONABLE_SLICE_STATUS) {
    return null;
  }
  return Object.freeze({
    recovery_kind: CORRECTIVE_STATUS_RECONCILIATION_RECOVERY_KIND,

    observed: Object.freeze({
      parent_status: observed.parent_status,
      slice_status: observed.slice_status
    }),
    expected: Object.freeze({
      parent_status: CORRECTIVE_STATUS_RECONCILIATION_REQUIRED_PARENT_STATUS,
      slice_status: CORRECTIVE_STATUS_RECONCILIATION_REQUIRED_SLICE_STATUS
    }),

    unit: observed.record_id,
    slice_unit: subject,
    responsible_actor: "coordinator",
    next_action: "reissue_subject_dispatch_after_canonical_status_reconciliation"
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
