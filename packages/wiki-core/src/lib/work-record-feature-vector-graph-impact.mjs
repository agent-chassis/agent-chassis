

import {
  isObject,
  isNonEmptyString,
  normalizeString
} from "./work-record-feature-vector-normalize.mjs";
import { cloneJson } from "./work-record-admission-shared.mjs";
import {
  createWorkRecordGraphImpactSummary,
  WORK_RECORD_GRAPH_IMPACT_SUMMARY_KIND,
  WORK_RECORD_GRAPH_IMPACT_SUMMARY_SCHEMA_VERSION
} from "./work-record-graph-impact-summary.mjs";

function isGraphImpactSummaryShape(value) {
  return (
    isObject(value) &&
    (normalizeString(value.kind) === WORK_RECORD_GRAPH_IMPACT_SUMMARY_KIND ||
      normalizeString(value.schema_version) === WORK_RECORD_GRAPH_IMPACT_SUMMARY_SCHEMA_VERSION ||
      isObject(value.graph_quality) ||
      isObject(value.warning_counts))
  );
}

function normalizeGraphImpactSummary(value) {
  if (!isObject(value)) {
    return null;
  }

  if (isGraphImpactSummaryShape(value)) {
    return cloneJson(value);
  }

  const suppliedSummary =
    value.graph_impact_summary ??
    value.graphImpactSummary ??
    value.summary ??
    value.graphImpactSummaryRef?.summary;
  if (isGraphImpactSummaryShape(suppliedSummary)) {
    return cloneJson(suppliedSummary);
  }
  if (isObject(suppliedSummary)) {
    const normalizedSuppliedSummary = createWorkRecordGraphImpactSummary(suppliedSummary);
    if (normalizedSuppliedSummary) {
      return normalizedSuppliedSummary;
    }
  }

  const rawGraphImpact = isObject(value.graph_impact)
    ? value.graph_impact
    : isObject(value.graphImpact)
      ? value.graphImpact
      : isObject(value.graph_evidence)
        ? value.graph_evidence
        : null;
  if (!rawGraphImpact) {
    return null;
  }

  return createWorkRecordGraphImpactSummary(rawGraphImpact);
}

function normalizeGraphImpactSummaryRef(value) {
  if (!isObject(value)) {
    return null;
  }

  const hasRefFields =
    isNonEmptyString(value.ref_id) ||
    isNonEmptyString(value.ref) ||
    isNonEmptyString(value.digest) ||
    isNonEmptyString(value.source_record_digest) ||
    isNonEmptyString(value.kind);
  if (isGraphImpactSummaryShape(value) && !hasRefFields) {
    return cloneJson(value);
  }

  const suppliedSummary = isGraphImpactSummaryShape(value.graph_impact_summary)
    ? value.graph_impact_summary
    : value.graph_impact_summary ?? value.summary;
  const normalizedSuppliedSummary = isGraphImpactSummaryShape(suppliedSummary)
    ? cloneJson(suppliedSummary)
    : normalizeGraphImpactSummary(suppliedSummary);
  if (normalizedSuppliedSummary) {
    return cloneJson({
      ...value,
      summary: normalizedSuppliedSummary
    });
  }

  return cloneJson(value);
}

function normalizeGraphOrDiffEvidence(value) {
  return isObject(value) ? cloneJson(value) : null;
}

export { normalizeGraphImpactSummary, normalizeGraphImpactSummaryRef, normalizeGraphOrDiffEvidence };
