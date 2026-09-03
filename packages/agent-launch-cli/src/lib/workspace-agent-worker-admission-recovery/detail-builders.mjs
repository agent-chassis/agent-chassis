

import {
  isObject,
  isNonEmptyString,
  normalizeStringArray,
  readCurrentCceTypedRecovery,
  extractPreconditionReason,
  PRECONDITION_REJECT_REASON_CODES
} from "./kernel.mjs";

function selectedUnitRecoveryFacts(unit) {
  return {
    selected_unit_address: unit?.address ?? null,
    selected_record_id: unit?.record_id ?? null,
    selected_slice_id: unit?.slice_id ?? null
  };
}

function buildCurrentCceRecoveryDetail({ unit, remote, effect }) {
  const typed = readCurrentCceTypedRecovery(remote, effect);
  const validation = typed?.recovery_validation;
  if (!validation) return null;
  return Object.freeze({
    classification: "cce_recovery_v1",
    recovery_source: "wiki_core_worker_admission_recovery_validation",
    owning_boundary: validation.owning_boundary,
    validation_boundary: validation.validation_boundary,
    is_deny_or_reject: effect === "reject",
    ...selectedUnitRecoveryFacts(unit),
    response_provenance: typed.response_provenance,
    recovery_validation: validation,
    recovery_diagnostic: validation.diagnostic,
    ...(validation.diagnostic_carrier === undefined
      ? {}
      : { recovery_diagnostic_carrier: validation.diagnostic_carrier }),
    cce_recovery: validation.recovery,
    recovery_actions: validation.recovery.actions,
    redactions: Object.freeze([...(validation.redactions ?? [])]),
    authority_note:
      "CCE produced this recovery and selected its actions. Launcher rendering preserves them " +
      "without replacement, local ordering, or launch authority; a fresh CCE decision remains required."
  });
}

function projectPreconditionEvidence(reasonCode, evidence) {
  if (!isObject(evidence)) return Object.freeze({});
  if (reasonCode === "unsatisfied_dependencies") {
    return Object.freeze({
      unsatisfied_count: Number.isInteger(evidence.unsatisfied_count)
        ? evidence.unsatisfied_count
        : null,
      incomplete_upstream_ids: normalizeStringArray(evidence.incomplete_upstream_ids)
    });
  }
  if (reasonCode === "dependency_cycle") {
    const cycles = Array.isArray(evidence.cycles)
      ? evidence.cycles
        .filter((cycle) => Array.isArray(cycle))
        .map((cycle) => normalizeStringArray(cycle))
        .filter((cycle) => cycle.length > 0)
      : [];
    return Object.freeze({
      cycles,
      cycle_ids: normalizeStringArray(evidence.cycle_ids)
    });
  }
  if (reasonCode === "lifecycle_not_dispatchable") {
    return Object.freeze({
      lifecycle_state: isNonEmptyString(evidence.lifecycle_state)
        ? evidence.lifecycle_state.trim()
        : null,
      current_status: isNonEmptyString(evidence.current_status)
        ? evidence.current_status.trim()
        : null
    });
  }
  if (reasonCode === "unit_superseded") {
    return Object.freeze({
      superseded_id: isNonEmptyString(evidence.superseded_id)
        ? evidence.superseded_id.trim()
        : null,
      replacement_unit: isNonEmptyString(evidence.replacement_unit)
        ? evidence.replacement_unit.trim()
        : null
    });
  }
  if (reasonCode === "precondition_graph_malformed") {
    return Object.freeze({
      malformed_field: isNonEmptyString(evidence.malformed_field)
        ? evidence.malformed_field.trim()
        : null
    });
  }
  return Object.freeze({});
}

export function buildPreconditionRecoveryDetail({ unit, reasonCode, evidence }) {
  const projectedEvidence = projectPreconditionEvidence(reasonCode, evidence);
  const recovery = {
    classification: reasonCode,
    is_deny_or_reject: PRECONDITION_REJECT_REASON_CODES.includes(reasonCode),
    selected_unit_address: unit?.address ?? null,
    selected_record_id: unit?.record_id ?? null,
    selected_slice_id: unit?.slice_id ?? null,
    reason_facts: [Object.freeze({ reason_code: reasonCode, evidence: projectedEvidence })],
    reason_evidence: projectedEvidence
  };

  if (reasonCode === "no_precondition_constraints") {
    recovery.authority_note =
      "no_precondition_constraints is an admit reason for a well-formed dispatchable target " +
      "with no dependency edges; it is not a denial and needs no recovery action.";
    recovery.next_actions = [
      "Treat no_precondition_constraints as an admit reason, not as a remediation blocker."
    ];
    return Object.freeze(recovery);
  }

  recovery.precondition_non_waivable = true;
  recovery.authority_note =
    "Precondition rejects are non-waivable structural dispatch preconditions. " +
    "Do not use accepted_authorities, scoped authority, escalation, or review attestation " +
    "to clear this result; satisfy the precondition and resubmit.";

  const nextActions = {
    unsatisfied_dependencies:
      "Complete the upstream dependency unit(s) named in reason.evidence.incomplete_upstream_ids, then re-run dispatch.",
    dependency_cycle:
      "Fix the depends_on edges that form the dependency cycle named in reason.evidence.cycles, then re-run dispatch.",
    lifecycle_not_dispatchable:
      "Change status for the target unit to a dispatchable lifecycle state, then re-run dispatch.",
    unit_superseded:
      "Re-point the dependency edge to the replacement unit for the superseded node, then re-run dispatch.",
    precondition_graph_malformed:
      "Treat the malformed precondition graph as a producer defect; fix the portfolio graph producer and resubmit."
  };
  recovery.next_actions = [nextActions[reasonCode] ??
    "Satisfy the non-waivable precondition reported in reason.evidence, then re-run dispatch."];
  return Object.freeze(recovery);
}

export function buildNeedsReviewRecoveryDetail({ unit, remote }) {
  return buildCurrentCceRecoveryDetail({ unit, remote, effect: "needs_review" });
}

export function buildRejectRecoveryDetail({ unit, remote }) {
  return buildCurrentCceRecoveryDetail({ unit, remote, effect: "reject" });
}

export const REMOTE_GATE_REFUSAL_RECOVERY_CODES = Object.freeze([
  "remote_admit_unratified",
  "remote_enforcement_unavailable",
  "remote_enforcement_absent"
]);

const REMOTE_GATE_REFUSAL_RECOVERY_NEXT_ACTIONS = Object.freeze({
  remote_admit_unratified:
    "Ratify/enable the Chassis Control Engine worker-admission authority binding, then retry (non-launchable until ratified)",
  remote_enforcement_unavailable:
    "The paid Chassis Control Engine backend transport/auth/entitlement failed (degrades closed); check service reachability, API key/auth, and entitlement, then retry",
  remote_enforcement_absent:
    "Configure the missing NODE_ENGINE_* (service url / key / route / request-contract digest), or confirm the intended free/local-only path"
});

export function buildRemoteGateRefusalRecoveryDetail({ unit, remoteGateCode } = {}) {
  if (!isNonEmptyString(remoteGateCode)) return null;
  const nextAction = REMOTE_GATE_REFUSAL_RECOVERY_NEXT_ACTIONS[remoteGateCode];
  if (!nextAction) return null;
  return Object.freeze({
    classification: remoteGateCode,
    is_deny_or_reject: false,
    selected_unit_address: unit?.address ?? null,
    selected_record_id: unit?.record_id ?? null,
    selected_slice_id: unit?.slice_id ?? null,
    authority_note:
      "This is a fail-closed Chassis Control Engine worker-admission refusal; Chassis Control Engine remains the only " +
      "authority that can return a ratified pack-backed admit. The next step is an operator/coordinator " +
      "action to clear the fail-closed condition, after which dispatch must be re-run; performing it does " +
      "not itself authorize a launch and does not convert the refusal to admit.",
    next_actions: [nextAction]
  });
}

export function projectWorkerAdmissionRecovery(decision) {
  const unit = isObject(decision?.unit) ? decision.unit : null;
  const preconditionReason = extractPreconditionReason(decision);
  if (preconditionReason) {
    return buildPreconditionRecoveryDetail({
      unit,
      reasonCode: preconditionReason.code,
      evidence: preconditionReason.evidence
    });
  }
  if (
    decision?.exact_policy_payload_authenticated === true &&
    decision.effect === "admit"
  ) {
    return null;
  }
  if (decision?.effect === "needs_review") {
    return buildNeedsReviewRecoveryDetail({ unit, remote: decision });
  }
  if (decision?.effect === "reject") {
    return buildRejectRecoveryDetail({ unit, remote: decision });
  }
  return Object.freeze({
    classification: "worker_admission_recovery_unclassified",
    is_deny_or_reject: false,
    selected_unit_address: unit?.address ?? null,
    selected_record_id: unit?.record_id ?? null,
    selected_slice_id: unit?.slice_id ?? null,
    next_actions: [
      "Inspect the worker-admission decision and retry with a recognized needs_review or reject result."
    ]
  });
}
