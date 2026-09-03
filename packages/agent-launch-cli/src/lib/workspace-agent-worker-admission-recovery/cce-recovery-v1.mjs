

import {
  validateWorkerAdmissionRecoveryResult
} from "@agent-chassis/wiki-core/src/lib/node-engine-worker-admission-recovery.mjs";
import { isObject, hasOwn } from "./kernel.mjs";

const CURRENT_DECISION_MODE = "bounded_current_decision_recovery";
const ROUTE_PROBLEM_MODE = "route_problem_recovery";

function selectedUnitRecoveryFacts(unit) {
  return {
    selected_unit_address: unit?.address ?? null,
    selected_record_id: unit?.record_id ?? null,
    selected_slice_id: unit?.slice_id ?? null
  };
}

function checkedValidation(remote, projectionMode) {
  return validateWorkerAdmissionRecoveryResult(remote?.recovery_validation, {
    expectedProjectionMode: projectionMode
  });
}

function diagnosticFields(validation) {
  return {
    recovery_validation: validation,
    recovery_diagnostic: validation.diagnostic,
    ...(validation.diagnostic_carrier === undefined
      ? {}
      : { recovery_diagnostic_carrier: validation.diagnostic_carrier })
  };
}

function invalidRecoveryDetail({ unit, isDenyOrReject, validation }) {
  return Object.freeze({
    classification: validation.issue,
    recovery_source: "wiki_core_worker_admission_recovery_validation",
    owning_boundary: validation.owning_boundary,
    validation_boundary: validation.validation_boundary,
    is_deny_or_reject: isDenyOrReject,
    ...selectedUnitRecoveryFacts(unit),
    ...diagnosticFields(validation),
    redactions: Object.freeze([...validation.redactions]),
    no_supported_route: true,
    next_calls: Object.freeze([]),
    authority_note:
      "The enclosing CCE non-admit effect remains unchanged. wiki-core rejected the typed " +
      "recovery result, so launcher rendering supplies no replacement recovery or action."
  });
}

export function buildCceRecoveryV1Detail({
  unit,
  remote,
  isDenyOrReject,
  projectionMode = CURRENT_DECISION_MODE,
  allowAbsent = false
}) {
  if (allowAbsent && (!isObject(remote) || !hasOwn(remote, "recovery_validation"))) {
    return null;
  }
  const validation = checkedValidation(remote, projectionMode);
  if (validation.state !== "valid") {
    return invalidRecoveryDetail({ unit, isDenyOrReject, validation });
  }

  return Object.freeze({
    classification: "cce_recovery_v1",
    recovery_source: "wiki_core_worker_admission_recovery_validation",
    owning_boundary: validation.owning_boundary,
    validation_boundary: validation.validation_boundary,
    is_deny_or_reject: isDenyOrReject,
    ...selectedUnitRecoveryFacts(unit),
    ...diagnosticFields(validation),
    cce_recovery: validation.recovery,
    recovery_actions: validation.recovery.actions,
    redactions: Object.freeze([...validation.redactions]),
    authority_note:
      "CCE produced this recovery and selected its actions. Launcher rendering preserves them " +
      "without replacement, local ordering, or launch authority; a fresh CCE decision remains required."
  });
}

export function buildRouteProblemRecoveryDetail({ unit, remote }) {
  return buildCceRecoveryV1Detail({
    unit,
    remote,
    isDenyOrReject: true,
    projectionMode: ROUTE_PROBLEM_MODE,
    allowAbsent: true
  });
}
