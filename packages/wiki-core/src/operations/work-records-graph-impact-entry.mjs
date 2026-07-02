

import {
  cloneJson,
  createContextualizedStructuralTargetMetrics,
  createDispatchReadinessForUnit,
  isObject,
  normalizeNonEmptyString
} from "./work-records-shared.mjs";
import { createWorkRecordGraphImpactSummary } from "../lib/work-record-graph-impact-summary.mjs";
import {
  createWorkRecordAdmissionDerivedEvidence,
  createWorkRecordAdmissionRecordLocalInputs,
  systemUtcClock
} from "../lib/work-record-admission.mjs";

function createGraphImpactPersistenceReadiness(recordId, unit) {
  return createDispatchReadinessForUnit(recordId, unit);
}

export function createPersistedGraphImpactSummary(graphImpact, requestedUnit, sourceDigest) {
  const summary = createWorkRecordGraphImpactSummary(graphImpact, { unit: requestedUnit });
  if (!summary) {
    return null;
  }

  return {
    ...summary,
    source_record_digest: summary.source_record_digest || sourceDigest
  };
}

export function extractGraphImpactRawEvidenceToken(graphImpact, graphImpactSummaryRef = null) {
  const sources = [graphImpactSummaryRef, graphImpact, graphImpact?.summary];
  for (const source of sources) {
    if (!isObject(source)) {
      continue;
    }
    for (const field of [
      "binding_token",
      "raw_evidence_digest",
      "raw_evidence_ref",
      "digest",
      "ref",
      "ref_id",
      "artifact_ref"
    ]) {
      const token = normalizeNonEmptyString(source[field]);
      if (token) {
        return token;
      }
    }
  }
  return null;
}

export function createPersistedGraphImpactSummaryRef(
  summary,
  sourceDigest,
  rawEvidenceToken = null,
  sourceGraphImpactSummaryRef = null
) {
  if (!summary) {
    return null;
  }

  const summaryRef = {
    kind: "graph_impact_reference",
    source_record_digest: sourceDigest,
    summary: cloneJson(summary)
  };
  const normalizedRawEvidenceToken = normalizeNonEmptyString(rawEvidenceToken);
  if (normalizedRawEvidenceToken) {
    summaryRef.binding_token = normalizedRawEvidenceToken;
  }
  if (isObject(sourceGraphImpactSummaryRef)) {
    const rawEvidenceDigest = normalizeNonEmptyString(sourceGraphImpactSummaryRef.raw_evidence_digest);
    const rawEvidenceRef = normalizeNonEmptyString(sourceGraphImpactSummaryRef.raw_evidence_ref);
    if (rawEvidenceDigest) {
      summaryRef.raw_evidence_digest = rawEvidenceDigest;
    }
    if (rawEvidenceRef) {
      summaryRef.raw_evidence_ref = rawEvidenceRef;
    }
  }
  return summaryRef;
}

function createPersistedGraphImpactAdmissionRecord(record, graphImpactSummary, graphImpactSummaryRef) {
  const admissionRecord = cloneJson(record);
  if (graphImpactSummary) {
    Object.defineProperty(admissionRecord, "graph_impact_summary", {
      value: cloneJson(graphImpactSummary),
      enumerable: false,
      configurable: true,
      writable: true
    });
  }
  if (graphImpactSummaryRef) {
    Object.defineProperty(admissionRecord, "graph_impact_summary_ref", {
      value: cloneJson(graphImpactSummaryRef),
      enumerable: false,
      configurable: true,
      writable: true
    });
  }
  return admissionRecord;
}

export async function createPersistedGraphImpactEntry({
  dir,
  record,
  graphImpact,
  graphImpactSummary,
  graphImpactSummaryRef,
  requestedUnit,
  selectedSlice,
  sourceDigest,
  generatedAt
}) {
  const dispatchReadiness = createGraphImpactPersistenceReadiness(record.id, requestedUnit);
  const materializationSubject =
    requestedUnit.kind === "slice" && selectedSlice
      ? {
          ...cloneJson(selectedSlice),
          id: record.id,
          kind: "slice",
          slice_id: selectedSlice.id
        }
      : record;
  const materializationRecord = {
    ...cloneJson(materializationSubject),
    graph_impact: cloneJson(graphImpact),
    ...(graphImpactSummary ? { graph_impact_summary: cloneJson(graphImpactSummary) } : {}),
    ...(graphImpactSummaryRef ? { graph_impact_summary_ref: cloneJson(graphImpactSummaryRef) } : {})
  };
  const admissionRecord = createPersistedGraphImpactAdmissionRecord(
    record,
    graphImpactSummary,
    graphImpactSummaryRef
  );
  const recordLocalInputs = await createWorkRecordAdmissionRecordLocalInputs({
    dir,
    record: materializationRecord
  });
  const contextualStructuralTargetMetrics = createContextualizedStructuralTargetMetrics(
    materializationRecord,
    recordLocalInputs,
    requestedUnit,
    sourceDigest
  );
  const derivedEvidence = createWorkRecordAdmissionDerivedEvidence({
    record: admissionRecord,
    repo: record.repo,

    clock: systemUtcClock,
    work_unit_metrics: recordLocalInputs.work_unit_metrics,
    file_stats: recordLocalInputs.file_stats,
    validation_command_metadata: recordLocalInputs.validation_command_metadata,
    runtime_mode_metadata: recordLocalInputs.runtime_mode_metadata,
    artifact_kind_metadata: recordLocalInputs.artifact_kind_metadata,
    structural_target_metrics: contextualStructuralTargetMetrics,
    metric_source_provenance: contextualStructuralTargetMetrics.metric_source_provenance,
    dispatch_readiness: dispatchReadiness,
    graph_impact: cloneJson(graphImpact),
    ...(graphImpactSummary ? { graph_impact_summary: cloneJson(graphImpactSummary) } : {}),
    ...(graphImpactSummaryRef ? { graph_impact_summary_ref: cloneJson(graphImpactSummaryRef) } : {})
  });

  derivedEvidence.graph_impact = {
    ...cloneJson(graphImpact),
    record_id: record.id,
    unit: cloneJson(requestedUnit),
    source_record_digest: sourceDigest,
    generated_at: generatedAt
  };
  if (graphImpactSummary) {
    derivedEvidence.graph_impact_summary = cloneJson(graphImpactSummary);
  }
  if (graphImpactSummaryRef) {
    derivedEvidence.graph_impact_summary_ref = cloneJson(graphImpactSummaryRef);
  }

  return derivedEvidence;
}

export function compactPersistedGraphImpactEntry(persistedEntry, inlineRef) {
  const fullGraphImpactForResponse = persistedEntry.graph_impact
    ? cloneJson(persistedEntry.graph_impact)
    : null;
  if (isObject(persistedEntry.graph_impact)) {
    persistedEntry.graph_impact.summary = null;

    const unit = isObject(persistedEntry.graph_impact.unit)
      ? persistedEntry.graph_impact.unit
      : null;
    if (unit && unit.kind === "slice") {
      const sliceId = normalizeNonEmptyString(unit.slice_id);
      if (sliceId) {
        persistedEntry.graph_impact.slice_id = sliceId;
      }
    }
  }
  delete persistedEntry.graph_impact_summary;
  persistedEntry.graph_impact_summary_ref = cloneJson(inlineRef);
  return fullGraphImpactForResponse;
}
