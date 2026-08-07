

import path from "node:path";

import {
  cloneJson,
  createContextualizedStructuralTargetMetrics,
  createDispatchReadinessForUnit,
  createRecordLevelDispatchReadiness,
  isObject,
  normalizeNonEmptyString
} from "./work-records-shared.mjs";
import {
  WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_GENERATOR,
  WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_SCHEMA_VERSION,
  createWorkRecordAdmissionDerivedEvidence,
  createWorkRecordAdmissionRecordLocalInputs,
  evaluateWorkRecordAdmissionDerivedEvidence,
  systemUtcClock
} from "../lib/work-record-admission.mjs";
import { computeReviewedUnitSourceDigest } from "../lib/work-record-review-attestation.mjs";
import {
  readPersistedWorkerAdmissionEvidenceSidecarEntry
} from "../lib/work-record-admission-evidence-sidecar.mjs";
import { WORK_RECORD_EXPECTED_EDIT_TARGET_KIND_VALUES } from "../lib/work-record-target-metrics.mjs";

export function selectedUnitReviewedDigest(record, unit) {
  const digestRecord = cloneJson(record);
  return computeReviewedUnitSourceDigest(
    unit?.kind === "slice"
      ? { record: digestRecord, selected_slice_id: unit.slice_id }
      : digestRecord
  );
}

export async function createLiveWorkerAdmissionDerivedEvidence({
  dir,
  record,
  requestedUnit
}) {
  const selectedSlice =
    requestedUnit.kind === "slice" && Array.isArray(record.slices)
      ? record.slices.find((entry) => isObject(entry) && entry.id === requestedUnit.slice_id) || null
      : null;

  if (requestedUnit.kind === "slice" && !selectedSlice) {
    return {
      issue: {
        code: "invalid_record",
        message: `Selected slice ${requestedUnit.slice_id} does not exist on ${record.id}`,
        details: {}
      }
    };
  }

  const materializationSubject =
    requestedUnit.kind === "slice"
      ? {
          ...cloneJson(selectedSlice),
          id: record.id,
          kind: "slice",
          slice_id: selectedSlice.id
        }
      : record;
  const sourceRecordDigest = selectedUnitReviewedDigest(record, requestedUnit);
  if (!sourceRecordDigest) {
    return {
      issue: {
        code: "invalid_record",
        message: `Could not resolve reviewed-unit digest for ${requestedUnit.address}`,
        details: {}
      }
    };
  }
  const recordLocalInputs = await createWorkRecordAdmissionRecordLocalInputs({
    dir,
    record: materializationSubject,

    sourceRecordDigestOverride: sourceRecordDigest
  });
  const contextualStructuralTargetMetrics = createContextualizedStructuralTargetMetrics(
    materializationSubject,
    recordLocalInputs,
    requestedUnit,
    sourceRecordDigest
  );
  const dispatchReadiness =
    requestedUnit.kind === "slice"
      ? createDispatchReadinessForUnit(record.id, requestedUnit)
      : createRecordLevelDispatchReadiness(record.id);

  return {
    evidence: createWorkRecordAdmissionDerivedEvidence({
      record,
      repo: record.repo,
      work_unit_metrics: recordLocalInputs.work_unit_metrics,
      file_stats: recordLocalInputs.file_stats,
      validation_command_metadata: recordLocalInputs.validation_command_metadata,
      runtime_mode_metadata: recordLocalInputs.runtime_mode_metadata,
      artifact_kind_metadata: recordLocalInputs.artifact_kind_metadata,
      structural_target_metrics: contextualStructuralTargetMetrics,
      metric_source_provenance: contextualStructuralTargetMetrics.metric_source_provenance,
      dispatch_readiness: dispatchReadiness,

      clock: systemUtcClock
    })
  };
}

export function isWorkerAdmissionDerivedEvidenceForUnit(entry, recordId, unit) {
  return (
    isObject(entry) &&
    entry.decision_kind === "work_unit_atomicity" &&
    entry.record_id === recordId &&
    isObject(entry.unit) &&
    entry.unit.kind === unit.kind &&
    entry.unit.address === unit.address &&
    entry.unit.record_id === recordId &&
    entry.unit.slice_id === unit.slice_id
  );
}

function getOwnDataPropertyDescriptor(value, propertyName) {
  const descriptor = Object.getOwnPropertyDescriptor(value, propertyName);
  return descriptor && Object.prototype.hasOwnProperty.call(descriptor, "value")
    ? descriptor
    : null;
}

function classifyTargetResolutionRecovery(evidence, inheritedState = null) {
  const metrics = evidence?.metric_summary?.structural_target_metrics;
  if (!isObject(metrics)) return "nonrecoverable_malformed";
  const counterNames = [
    "expected_edit_target_count",
    "planned_create_target_count",
    "planned_modify_target_count",
    "planned_delete_target_count",
    "planned_inspect_target_count",
    "target_kind_count",
    "resolved_edit_target_count",
    "unresolved_edit_target_count",
    "ambiguous_edit_target_count",
    "write_scope_without_resolved_targets"
  ];
  const counters = {};
  for (const name of counterNames) {
    const descriptor = getOwnDataPropertyDescriptor(metrics, name);
    if (
      !descriptor ||
      !Number.isSafeInteger(descriptor.value) ||
      descriptor.value < 0
    ) {
      return "nonrecoverable_malformed";
    }
    counters[name] = descriptor.value;
  }

  const expectedCount = counters.expected_edit_target_count;
  const plannedCreateCount = counters.planned_create_target_count;
  const plannedOperationCount =
    plannedCreateCount +
    counters.planned_modify_target_count +
    counters.planned_delete_target_count +
    counters.planned_inspect_target_count;
  const resolvedCount = counters.resolved_edit_target_count;
  const unresolvedCount = counters.unresolved_edit_target_count;
  const ambiguousCount = counters.ambiguous_edit_target_count;
  const resolutionCount =
    resolvedCount + unresolvedCount + ambiguousCount + plannedCreateCount;
  const targetKindCount = counters.target_kind_count;
  if (
    !Number.isSafeInteger(plannedOperationCount) ||
    plannedOperationCount !== expectedCount ||
    !Number.isSafeInteger(resolutionCount) ||
    resolutionCount !== expectedCount
  ) {
    return "nonrecoverable_malformed";
  }
  if (
    (expectedCount === 0 && targetKindCount !== 0) ||
    (expectedCount > 0 &&
      (targetKindCount < 1 ||
        targetKindCount >
          Math.min(expectedCount, WORK_RECORD_EXPECTED_EDIT_TARGET_KIND_VALUES.length)))
  ) {
    return "nonrecoverable_malformed";
  }

  const statusDescriptor = getOwnDataPropertyDescriptor(
    metrics,
    "target_resolution_evidence_status"
  );
  const providerDescriptor = getOwnDataPropertyDescriptor(
    metrics,
    "target_resolution_provider"
  );
  if (!statusDescriptor || !providerDescriptor) return "nonrecoverable_malformed";

  const status = statusDescriptor.value;
  const provider = providerDescriptor.value;
  if (!["present", "absent", "partial", "degraded"].includes(status)) {
    return "nonrecoverable_malformed";
  }
  const providerPresent =
    typeof provider === "string" &&
    normalizeNonEmptyString(provider) === provider;
  const providerAbsent = provider === null;
  if (!providerPresent && !providerAbsent) return "nonrecoverable_malformed";

  if (expectedCount === 0) {
    return status === "absent" && providerAbsent
      ? "not_required"
      : "nonrecoverable_malformed";
  }

  if (status === "degraded") {

    if (providerPresent) return "nonrecoverable_malformed";
    return inheritedState ?? "fresh";
  }
  if (status !== "present" && status !== "partial") {
    return "nonrecoverable_malformed";
  }
  if (!providerPresent) return "nonrecoverable_malformed";
  if (status === "partial" && unresolvedCount === 0 && ambiguousCount === 0) {
    return "nonrecoverable_malformed";
  }

  return inheritedState ?? "fresh";
}

function admissionRecoveryResult(admissionMetrics, targetResolution, issue = null, evidence = null) {
  return { recovery: { admission_metrics: admissionMetrics, target_resolution: targetResolution }, issue, evidence };
}

function classifyPersistedWorkerAdmissionComponents({ record, unit, entry, evaluatedEvidence }) {
  const targetState = classifyTargetResolutionRecovery(evaluatedEvidence);
  const admissionState =
    entry.schema_version !== WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_SCHEMA_VERSION ||
    entry.generator?.version !== WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_GENERATOR.version
      ? "recoverable_outdated"
      : entry.source_record_digest !== selectedUnitReviewedDigest(record, unit)
        ? "recoverable_stale"
        : "fresh";
  const inheritedTargetState = targetState === "fresh"
    ? admissionState
    : targetState;
  const issue = admissionState === "recoverable_outdated"
    ? { code: "outdated_worker_admission_derived_evidence" }
    : admissionState === "recoverable_stale"
      ? { code: "stale_worker_admission_derived_evidence" }
      : null;
  return admissionRecoveryResult(admissionState, inheritedTargetState, issue, evaluatedEvidence);
}

export function classifyWorkRecordAdmissionCompactRecovery({ record, unit } = {}) {
  if (!isObject(record) || !isObject(unit)) {
    return admissionRecoveryResult("nonrecoverable_malformed", "nonrecoverable_malformed", {
      code: "invalid_record"
    });
  }
  const matchingEntries = (Array.isArray(record.derived_evidence) ? record.derived_evidence : [])
    .filter((entry) => isWorkerAdmissionDerivedEvidenceForUnit(entry, record.id, unit));
  if (matchingEntries.length > 1) {
    return admissionRecoveryResult("nonrecoverable_ambiguous", "nonrecoverable_ambiguous", {
      code: "duplicate_worker_admission_derived_evidence"
    });
  }
  if (matchingEntries.length === 0) {
    return admissionRecoveryResult("recoverable_missing", "recoverable_missing", {
      code: "missing_worker_admission_derived_evidence"
    });
  }
  const entry = matchingEntries[0];
  if (classifyTargetResolutionRecovery(entry) === "nonrecoverable_malformed") {
    return { ...admissionRecoveryResult(
      "nonrecoverable_malformed",
      "nonrecoverable_malformed",
      null,
      entry
    ), entry };
  }
  let evaluatedEvidence;
  try {
    evaluateWorkRecordAdmissionDerivedEvidence(entry);
    evaluatedEvidence = entry;
  } catch {
    return admissionRecoveryResult("nonrecoverable_malformed", "nonrecoverable_malformed", {
      code: "malformed_worker_admission_derived_evidence"
    });
  }
  const classified = classifyPersistedWorkerAdmissionComponents({
    record,
    unit,
    entry,
    evaluatedEvidence
  });
  return { ...classified, entry };
}

export async function classifyWorkRecordAdmissionRecovery({
  dir = ".",
  record,
  unit
} = {}) {
  if (!isObject(record) || !isObject(unit)) {
    return admissionRecoveryResult("nonrecoverable_malformed", "nonrecoverable_malformed", {
      code: "invalid_record"
    });
  }

  const matchingEntries = (Array.isArray(record.derived_evidence) ? record.derived_evidence : [])
    .filter((entry) => isWorkerAdmissionDerivedEvidenceForUnit(entry, record.id, unit));
  if (matchingEntries.length > 1) {
    return admissionRecoveryResult("nonrecoverable_ambiguous", "nonrecoverable_ambiguous", {
      code: "duplicate_worker_admission_derived_evidence"
    });
  }
  if (matchingEntries.length === 0) {
    let live;
    try {
      live = await createLiveWorkerAdmissionDerivedEvidence({
        dir: path.resolve(String(dir)),
        record,
        requestedUnit: unit
      });
    } catch {
      return admissionRecoveryResult("nonrecoverable_provider_unavailable", "nonrecoverable_provider_unavailable", {
        code: "admission_evidence_provider_unavailable"
      });
    }
    if (!live?.evidence) {
      return admissionRecoveryResult("nonrecoverable_malformed", "nonrecoverable_malformed", {
        code: live?.issue?.code ?? "live_admission_materialization_failed"
      });
    }
    try {
      if (classifyTargetResolutionRecovery(live.evidence) === "nonrecoverable_malformed") {
        throw new TypeError("malformed target-resolution evidence");
      }
      evaluateWorkRecordAdmissionDerivedEvidence(live.evidence);
    } catch {
      return admissionRecoveryResult("nonrecoverable_malformed", "nonrecoverable_malformed", {
        code: "malformed_worker_admission_derived_evidence"
      });
    }
    return admissionRecoveryResult("recoverable_missing",
      classifyTargetResolutionRecovery(live.evidence, "recoverable_missing"),
      { code: "missing_worker_admission_derived_evidence" }, live.evidence);
  }

  const entry = matchingEntries[0];
  let evaluatedEvidence;
  try {
    evaluatedEvidence =
      (await readPersistedWorkerAdmissionEvidenceSidecarEntry({ dir, entry })) ?? entry;
    if (classifyTargetResolutionRecovery(evaluatedEvidence) === "nonrecoverable_malformed") {
      throw new TypeError("malformed target-resolution evidence");
    }
    evaluateWorkRecordAdmissionDerivedEvidence(evaluatedEvidence);
  } catch (error) {
    const integrityFailure = typeof error?.code === "string" && error.code.startsWith("sidecar_");
    return admissionRecoveryResult(
      integrityFailure ? "nonrecoverable_integrity_failure" : "nonrecoverable_malformed",
      integrityFailure ? "nonrecoverable_integrity_failure" : "nonrecoverable_malformed",
      { code: error?.code ?? "malformed_worker_admission_derived_evidence" }
    );
  }

  return classifyPersistedWorkerAdmissionComponents({ record, unit, entry, evaluatedEvidence });
}
