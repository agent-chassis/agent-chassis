

import { WORK_RECORD_GRAPH_INLINE_REF_KIND } from "./work-record-graph-evidence-sidecar.mjs";
import { SIDECAR_GRAPH_SCHEMA_VERSION } from "./sidecar-graph-schema.mjs";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeNonEmptyString(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isGraphImpactEnvelope(value) {
  return (
    isObject(value) &&
    (value.query_kind === "graph_impact_paths" ||
      value.query_kind === "graph_impact_diff" ||
      Object.prototype.hasOwnProperty.call(value, "graph_nodes") ||
      Object.prototype.hasOwnProperty.call(value, "graph_edges") ||
      Object.prototype.hasOwnProperty.call(value, "structural_impacts") ||
      Object.prototype.hasOwnProperty.call(value, "missing_update_hints") ||
      Object.prototype.hasOwnProperty.call(value, "summary") ||
      Object.prototype.hasOwnProperty.call(value, "validated_paths") ||
      Object.prototype.hasOwnProperty.call(value, "invalid_paths"))
  );
}

function isWorkerAdmissionGraphImpactUnitMatch(candidateUnit, unit, recordId) {
  if (!isObject(candidateUnit) || !isObject(unit)) {
    return false;
  }

  const normalizedRecordId = normalizeNonEmptyString(recordId);
  const candidateRecordId = normalizeNonEmptyString(candidateUnit.record_id);
  const expectedRecordId = normalizeNonEmptyString(unit.record_id);
  const candidateAddress = normalizeNonEmptyString(candidateUnit.address);
  const expectedAddress = normalizeNonEmptyString(unit.address);
  const candidateKind = normalizeNonEmptyString(candidateUnit.kind);
  const expectedKind = normalizeNonEmptyString(unit.kind);
  const candidateSliceId = normalizeNonEmptyString(candidateUnit.slice_id);
  const expectedSliceId = unit.kind === "slice" ? normalizeNonEmptyString(unit.slice_id) : null;

  return Boolean(
    normalizedRecordId &&
      candidateRecordId === normalizedRecordId &&
      expectedRecordId === normalizedRecordId &&
      candidateAddress &&
      candidateAddress === expectedAddress &&
      candidateKind === expectedKind &&
      candidateSliceId === expectedSliceId
  );
}

function isWorkerAdmissionGraphImpactEvidenceForUnit(graphImpact, recordId, unit, sourceDigest) {
  if (!isGraphImpactEnvelope(graphImpact)) {
    return false;
  }

  const normalizedRecordId = normalizeNonEmptyString(recordId);
  const expectedDigest = normalizeNonEmptyString(sourceDigest);
  const graphImpactDigest = normalizeNonEmptyString(graphImpact.source_record_digest);
  const graphImpactSliceId = normalizeNonEmptyString(graphImpact.slice_id);
  const expectedSliceId = unit?.kind === "slice" ? normalizeNonEmptyString(unit.slice_id) : null;

  return Boolean(
    normalizedRecordId &&
      normalizeNonEmptyString(graphImpact.record_id) === normalizedRecordId &&
      isWorkerAdmissionGraphImpactUnitMatch(graphImpact.unit, unit, normalizedRecordId) &&
      graphImpactSliceId === expectedSliceId &&
      graphImpactDigest &&
      (!expectedDigest || graphImpactDigest === expectedDigest)
  );
}

function isWorkerAdmissionGraphImpactSummaryForUnit(summary, recordId, unit, sourceDigest) {
  if (!isObject(summary)) {
    return false;
  }

  const normalizedRecordId = normalizeNonEmptyString(recordId);
  const expectedDigest = normalizeNonEmptyString(sourceDigest);
  const summaryDigest = normalizeNonEmptyString(summary.source_record_digest);
  const summarySliceId = normalizeNonEmptyString(summary.slice_id);
  const expectedSliceId = unit?.kind === "slice" ? normalizeNonEmptyString(unit.slice_id) : null;

  return Boolean(
    normalizedRecordId &&
      normalizeNonEmptyString(summary.record_id) === normalizedRecordId &&
      isWorkerAdmissionGraphImpactUnitMatch(summary.unit, unit, normalizedRecordId) &&
      summarySliceId === expectedSliceId &&
      summaryDigest &&
      (!expectedDigest || summaryDigest === expectedDigest)
  );
}

function getWorkerAdmissionGraphImpactGraphState(graphImpact) {
  if (!isObject(graphImpact)) {
    return null;
  }
  if (isObject(graphImpact.graph_state)) {
    return graphImpact.graph_state;
  }
  if (isObject(graphImpact.summary?.graph_state)) {
    return graphImpact.summary.graph_state;
  }
  return null;
}

function hasUsableWorkerAdmissionDirtyOverlaySemantics(graphImpact) {
  const graphState = getWorkerAdmissionGraphImpactGraphState(graphImpact);
  if (!isObject(graphState)) {
    return false;
  }

  const degradedStateKind = normalizeNonEmptyString(graphImpact?.graph_quality?.degraded_state?.kind);
  return (
    normalizeNonEmptyString(graphState.edge_source) === "dirty_overlay" ||
    normalizeNonEmptyString(graphState.dirty_graph_mode) === "overlay_parsed" ||
    degradedStateKind === "dirty_overlay"
  );
}

function hasUsableWorkerAdmissionStaleBaseIndexSemantics(graphImpact) {
  const graphState = getWorkerAdmissionGraphImpactGraphState(graphImpact);
  if (!isObject(graphState)) {
    return false;
  }

  return (
    graphState.graph_available === true &&
    normalizeNonEmptyString(graphState.graph_schema_version) === SIDECAR_GRAPH_SCHEMA_VERSION &&
    normalizeNonEmptyString(graphState.edge_source) === "base_index" &&
    normalizeNonEmptyString(graphState.dirty_graph_mode) === "base_index_only"
  );
}

function isCarryForwardableWorkerAdmissionGraphImpact(graphImpact) {
  const graphState = getWorkerAdmissionGraphImpactGraphState(graphImpact);
  if (!isObject(graphState)) {
    return false;
  }

  const graphSchemaVersion = normalizeNonEmptyString(graphState.graph_schema_version);
  const staleness = normalizeNonEmptyString(graphState.staleness);
  if (
    !graphSchemaVersion ||
    graphState.graph_available !== true ||
    !staleness ||
    normalizeNonEmptyString(graphState.edge_source) === "unavailable" ||
    normalizeNonEmptyString(graphState.dirty_graph_mode) === "unavailable"
  ) {
    return false;
  }

  if (staleness === "fresh") {
    return true;
  }

  if (staleness === "stale") {
    return (
      hasUsableWorkerAdmissionDirtyOverlaySemantics(graphImpact) ||
      hasUsableWorkerAdmissionStaleBaseIndexSemantics(graphImpact)
    );
  }

  if (staleness === "rebuild_required" || staleness === "missing") {
    return hasUsableWorkerAdmissionDirtyOverlaySemantics(graphImpact);
  }

  return false;
}

function rebindGraphImpactSourceDigest(graphImpact, sourceDigest) {
  if (!isObject(graphImpact)) {
    return graphImpact;
  }

  const rebasedGraphImpact = cloneJson(graphImpact);
  rebasedGraphImpact.source_record_digest = sourceDigest;

  if (isObject(rebasedGraphImpact.summary) && Object.prototype.hasOwnProperty.call(rebasedGraphImpact.summary, "source_record_digest")) {
    rebasedGraphImpact.summary.source_record_digest = sourceDigest;
  }

  return rebasedGraphImpact;
}

function carryForwardSourceCompatibleGraphImpactEvidence(previousEntry, derivedEvidence, currentSourceDigest) {
  if (!isObject(previousEntry) || !isObject(derivedEvidence)) {
    return;
  }

  if (isObject(derivedEvidence.graph_impact)) {
    return;
  }
  const priorGraphImpact = previousEntry.graph_impact;
  if (!isGraphImpactEnvelope(priorGraphImpact)) {
    return;
  }
  const recordId = normalizeNonEmptyString(previousEntry.record_id) || normalizeNonEmptyString(derivedEvidence.record_id);
  const unit = isObject(derivedEvidence.unit) ? derivedEvidence.unit : null;
  const freshDigest = normalizeNonEmptyString(derivedEvidence.source_record_digest);
  const priorDigest = normalizeNonEmptyString(priorGraphImpact.source_record_digest);
  const currentDigest = normalizeNonEmptyString(currentSourceDigest);
  const previousEntryDigest = normalizeNonEmptyString(previousEntry.source_record_digest);
  if (!recordId || !unit || !freshDigest || !priorDigest || !currentDigest || !previousEntryDigest) {
    return;
  }
  if (previousEntryDigest !== currentDigest || priorDigest !== currentDigest) {
    return;
  }
  if (!isWorkerAdmissionGraphImpactEvidenceForUnit(priorGraphImpact, recordId, unit, currentDigest)) {
    return;
  }
  if (!isCarryForwardableWorkerAdmissionGraphImpact(priorGraphImpact)) {
    return;
  }
  if (
    isObject(previousEntry.graph_impact_summary) &&
    !isCarryForwardableWorkerAdmissionGraphImpact(previousEntry.graph_impact_summary)
  ) {
    return;
  }

  const previousSummaryRef = previousEntry.graph_impact_summary_ref;
  const previousSummaryRefIsCompactInline =
    isObject(previousSummaryRef) &&
    normalizeNonEmptyString(previousSummaryRef.kind) === WORK_RECORD_GRAPH_INLINE_REF_KIND;
  if (
    isObject(previousSummaryRef) &&
    !previousSummaryRefIsCompactInline &&
    (!isObject(previousSummaryRef.summary) ||
      !isCarryForwardableWorkerAdmissionGraphImpact(previousSummaryRef.summary))
  ) {
    return;
  }
  if (
    isObject(previousEntry.graph_impact_summary) &&
    !isWorkerAdmissionGraphImpactSummaryForUnit(
      previousEntry.graph_impact_summary,
      recordId,
      unit,
      currentDigest
    )
  ) {
    return;
  }
  if (isObject(previousSummaryRef)) {
    if (previousSummaryRefIsCompactInline) {

      const refUnitMatches = isWorkerAdmissionGraphImpactUnitMatch(
        previousSummaryRef.unit,
        unit,
        recordId
      );
      const refDigest = normalizeNonEmptyString(previousSummaryRef.source_record_digest);
      if (!refUnitMatches || !refDigest || refDigest !== currentDigest) {
        return;
      }
    } else {
      const summaryRef = previousSummaryRef;
      if (
        !isWorkerAdmissionGraphImpactSummaryForUnit(summaryRef.summary, recordId, unit, currentDigest)
      ) {
        return;
      }
      const summaryRefDigest = normalizeNonEmptyString(summaryRef.source_record_digest);
      const summaryDigest = normalizeNonEmptyString(summaryRef.summary?.source_record_digest);
      if (summaryRefDigest !== currentDigest || summaryDigest !== currentDigest) {
        return;
      }
    }
  }

  derivedEvidence.graph_impact = rebindGraphImpactSourceDigest(priorGraphImpact, freshDigest);
  if (isObject(previousEntry.graph_impact_summary)) {
    const rebasedGraphImpactSummary = cloneJson(previousEntry.graph_impact_summary);
    if (Object.prototype.hasOwnProperty.call(rebasedGraphImpactSummary, "source_record_digest")) {
      rebasedGraphImpactSummary.source_record_digest = freshDigest;
    }
    derivedEvidence.graph_impact_summary = rebasedGraphImpactSummary;
  }
  if (isObject(previousEntry.graph_impact_summary_ref)) {
    const rebasedGraphImpactSummaryRef = cloneJson(previousEntry.graph_impact_summary_ref);
    rebasedGraphImpactSummaryRef.source_record_digest = freshDigest;
    if (
      isObject(rebasedGraphImpactSummaryRef.summary) &&
      Object.prototype.hasOwnProperty.call(rebasedGraphImpactSummaryRef.summary, "source_record_digest")
    ) {
      rebasedGraphImpactSummaryRef.summary.source_record_digest = freshDigest;
    }
    derivedEvidence.graph_impact_summary_ref = rebasedGraphImpactSummaryRef;
  }
}

export {
  carryForwardSourceCompatibleGraphImpactEvidence,
  getWorkerAdmissionGraphImpactGraphState,
  hasUsableWorkerAdmissionDirtyOverlaySemantics,
  hasUsableWorkerAdmissionStaleBaseIndexSemantics,
  isCarryForwardableWorkerAdmissionGraphImpact,
  isWorkerAdmissionGraphImpactEvidenceForUnit,
  isWorkerAdmissionGraphImpactSummaryForUnit,
  isWorkerAdmissionGraphImpactUnitMatch,
  rebindGraphImpactSourceDigest
};
