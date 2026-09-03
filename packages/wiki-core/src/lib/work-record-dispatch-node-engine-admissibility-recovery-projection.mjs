

import {
  validateWorkerAdmissionRecoveryResult
} from "./node-engine-worker-admission-recovery.mjs";
import { isObject } from "./work-record-dispatch-shared.mjs";
import {
  REVIEW_THRESHOLD_REASON_CODES,
  classifyNeedsReviewReasonShape,
  projectBoundedNeedsReviewReasonFacts,
  selectedUnitFactsFromReadiness
} from "./work-record-dispatch-node-engine-admissibility-reason-projection.mjs";

function projectWorkerAdmissionRecoverySummary(validation) {
  validation = validateWorkerAdmissionRecoveryResult(validation, {
    expectedProjectionMode: "bounded_current_decision_recovery"
  });
  return validation.state === "valid" ? validation.recovery : null;
}

function isReviewThresholdReasonCode(reasonCode) {
  return REVIEW_THRESHOLD_REASON_CODES.has(reasonCode);
}

export function buildNeedsReviewRecoveryProjection({ readiness, reasons }) {
  const packReasonCount = Array.isArray(reasons) ? reasons.length : 0;
  const reasonFacts = projectBoundedNeedsReviewReasonFacts(reasons);
  const recognizedReasonCount = reasonFacts.length;
  const unrecognizedReasonCount = Math.max(0, packReasonCount - recognizedReasonCount);
  const thresholdReasonControls = [
    ...new Set(
      reasonFacts
        .filter((fact) => isReviewThresholdReasonCode(fact.reason_code))
        .map((fact) => fact.control)
        .filter((control) => control)
    )
  ];
  const reasonFamilies = [
    ...new Set(reasonFacts.map((fact) => fact.reason_family).filter((family) => family))
  ];
  const reviewThresholdControls = reasonFamilies.length > 0 ? [] : thresholdReasonControls;
  const classification = classifyNeedsReviewReasonShape({
    packReasonCount,
    recognizedReasonCount,
    reviewThresholdControls,
    reasonFamilies
  });
  return Object.freeze({
    classification,
    recovery_source: "legacy_reason_fact_compatibility",
    owning_boundary: "cce.worker-admission-recovery-producer",
    is_deny_or_reject: false,
    ...selectedUnitFactsFromReadiness(readiness),
    review_threshold_controls: reviewThresholdControls,
    reason_families: reasonFamilies,
    reason_facts: reasonFacts,
    pack_reason_count: packReasonCount,
    recognized_reason_count: recognizedReasonCount,
    unrecognized_reason_count: unrecognizedReasonCount,
    dropped_reason_count: unrecognizedReasonCount,
    bounded_by_returned_reason_facts: true,
    redactions: Object.freeze([]),
    no_supported_route: true,
    next_calls: Object.freeze([]),
    controls_note:
      "Compatibility facts list only controls present in the bounded CCE reason summary; " +
      "they infer no hidden controls and select no recovery action.",
    authority_note:
      "CCE remains the sole recovery producer and admission authority. These compatibility " +
      "facts are not remediation, review evidence, accepted authority, or launch authority."
  });
}

export function attachNeedsReviewRecoveryProjection(admissibility, recovery) {
  Object.defineProperty(admissibility, "needs_review_recovery", {
    value: recovery,
    enumerable: false,
    configurable: true
  });
  Object.defineProperty(admissibility, "toJSON", {
    value() {
      return { ...this, needs_review_recovery: recovery };
    },
    enumerable: false,
    configurable: true
  });
}

export function attachPrimaryRecoveryProjection(admissibility, recovery) {
  Object.defineProperty(admissibility, "recovery", {
    value: recovery,
    enumerable: true,
    configurable: true
  });
}

export function validRatifiedCurrentDecisionRecovery(outcome) {
  if (
    !["needs_review", "reject"].includes(outcome.status) ||
    outcome.pack_backed !== true ||
    outcome.node_engine_backed !== true ||
    outcome.ratified !== true
  ) {
    return null;
  }
  const recovery = projectWorkerAdmissionRecoverySummary(outcome.recovery_validation);
  return recovery?.projection_mode === "bounded_current_decision_recovery" ? recovery : null;
}

export function resolveNeedsReviewEnumerableRecovery(outcome) {
  if (isObject(outcome.recovery_validation)) {
    const packRecovery = projectWorkerAdmissionRecoverySummary(outcome.recovery_validation);
    return packRecovery?.projection_mode === "bounded_current_decision_recovery"
      ? packRecovery
      : null;
  }

  return null;
}
