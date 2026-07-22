

import {
  cloneJson,
  computeNormalizedInputDigest,
  isObject,
  normalizeStringEntry
} from "./work-record-admission-shared.mjs";
import { normalizeStructuralTargetMetrics } from "./work-record-target-metrics.mjs";
import { resolveStructuralTargetResolverEvidenceFromExpectedEditTarget } from "./work-record-target-resolver.mjs";

const WORK_RECORD_LOCAL_TARGET_FUNCTION_RESOLVER_PROVIDER = Object.freeze({
  id: "portfolio-local.target-function-resolver",
  version: "0.1.0",
  mode: "local"
});

const WORK_RECORD_LOCAL_AGGREGATE_TARGET_RESOLVER_PRODUCER = Object.freeze({
  id: "portfolio-local.target-resolver",
  version: "0.1.0",
  mode: "local"
});

function normalizeRepoPathKey(value) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().replaceAll("\\", "/").replace(/^\.\//u, "")
    : null;
}

function buildLocalTargetResolutionEvidence({
  expectedEditTargets,
  sourceTexts,
  selectedUnit,
  sourceRecordDigest
}) {
  const targetSourceTexts = isObject(sourceTexts) ? sourceTexts : {};
  const entries = expectedEditTargets.map((target) => {
    const repoPath = isObject(target) ? normalizeRepoPathKey(target.path) : null;
    const sourceText =
      repoPath && typeof targetSourceTexts[repoPath] === "string" ? targetSourceTexts[repoPath] : null;
    return resolveStructuralTargetResolverEvidenceFromExpectedEditTarget(
      {
        target,
        source_text: sourceText,
        source_record_digest: sourceRecordDigest,
        selected_unit: selectedUnit,
        provider: WORK_RECORD_LOCAL_TARGET_FUNCTION_RESOLVER_PROVIDER
      },
      { hasExpectedEditTargets: true }
    );
  });

  const allTargetsEvaluated =
    entries.length > 0 &&
    entries.every((entry) => entry.target_resolution_status !== "provider_unavailable");

  return {
    status: allTargetsEvaluated ? "present" : "degraded",
    source_record_digest: sourceRecordDigest,
    selected_unit: selectedUnit,

    ...(allTargetsEvaluated ? { producer: WORK_RECORD_LOCAL_AGGREGATE_TARGET_RESOLVER_PRODUCER } : {}),
    targets: entries
  };
}

export function createContextualizedStructuralTargetMetrics(
  subject,
  localInputs,
  selectedUnit,
  sourceRecordDigest
) {

  const hasOwnExpectedEditTargets =
    isObject(subject) && Object.prototype.hasOwnProperty.call(subject, "expected_edit_targets");
  const expectedEditTargets = hasOwnExpectedEditTargets
    ? Array.isArray(subject.expected_edit_targets)
      ? subject.expected_edit_targets
      : []
    : Array.isArray(localInputs?.effective_expected_edit_targets)
      ? localInputs.effective_expected_edit_targets
      : [];

  const planDeclared = hasOwnExpectedEditTargets
    ? Array.isArray(subject.expected_edit_targets)
    : expectedEditTargets.length > 0;

  const hasExpectedEditTargets = expectedEditTargets.length > 0;

  const bindingSourceRecordDigest =
    isObject(localInputs) &&
    typeof localInputs.source_record_digest === "string" &&
    localInputs.source_record_digest.trim().length > 0
      ? localInputs.source_record_digest
      : sourceRecordDigest;

  const localTargetResolutionEvidence = hasExpectedEditTargets
    ? buildLocalTargetResolutionEvidence({
        expectedEditTargets,
        sourceTexts: localInputs?.expected_edit_target_source_texts,
        selectedUnit,
        sourceRecordDigest: bindingSourceRecordDigest
      })
    : undefined;

  return normalizeStructuralTargetMetrics({

    expected_edit_targets: planDeclared ? expectedEditTargets : undefined,
    target_resolution_evidence: localTargetResolutionEvidence,
    write_scope: Array.isArray(subject?.write_scope) ? subject.write_scope : [],
    file_stats: Array.isArray(localInputs?.file_stats) ? localInputs.file_stats : [],
    metric_source_provenance: isObject(localInputs?.metric_source_provenance)
      ? localInputs.metric_source_provenance
      : undefined,
    unit: selectedUnit,
    source_record_digest: bindingSourceRecordDigest
  });
}

export function createBoundTargetResolutionEvidence(structuralTargetMetrics, { selectedUnit, sourceRecordDigest } = {}) {
  if (!isObject(structuralTargetMetrics)) {
    return null;
  }

  const metricSourceProvenance = isObject(structuralTargetMetrics.metric_source_provenance)
    ? structuralTargetMetrics.metric_source_provenance
    : null;
  if (!metricSourceProvenance) {
    return null;
  }

  const selectedUnitValue = cloneJson(selectedUnit ?? metricSourceProvenance.selected_unit ?? null);
  const sourceRecordDigestValue =
    normalizeStringEntry(sourceRecordDigest) ?? normalizeStringEntry(metricSourceProvenance.source_record_digest) ?? null;

  const perTargetProvider = (entry) =>
    entry.provider || entry.provider_version || entry.provider_mode
      ? {
          id: entry.provider ?? null,
          version: entry.provider_version ?? null,
          mode: entry.provider_mode ?? null
        }
      : null;
  const expectedEditTargets = Array.isArray(structuralTargetMetrics.targets)
    ? structuralTargetMetrics.targets.map((entry) => ({
        path: entry.path ?? null,
        kind: entry.kind ?? null,
        name: entry.name ?? null,
        operation: entry.operation ?? null,
        optional: entry.optional === true,
        resolution_status: entry.resolution_status ?? null,
        resolution_reason: entry.resolution_reason ?? null,
        provider: entry.provider ?? null,
        provider_version: entry.provider_version ?? null,
        provider_mode: entry.provider_mode ?? null,
        span: cloneJson(entry.span ?? null),
        fanout: cloneJson(entry.fanout ?? null),
        candidates: Array.isArray(entry.candidates) ? cloneJson(entry.candidates) : []
      }))
    : [];
  const resolverTargets = Array.isArray(structuralTargetMetrics.targets)
    ? structuralTargetMetrics.targets.map((entry) => ({
        target: {
          path: entry.path ?? null,
          kind: entry.kind ?? null,
          name: entry.name ?? null,
          operation: entry.operation ?? null
        },
        provider: perTargetProvider(entry),
        resolution_status: entry.resolution_status ?? null,
        target_resolution_status: entry.resolution_status ?? null,
        target_resolution_provider: perTargetProvider(entry),
        target_resolution_evidence_status: entry.evidence?.status ?? structuralTargetMetrics.target_resolution_evidence_status ?? "degraded",
        target_resolution_status_reason: entry.resolution_reason ?? structuralTargetMetrics.target_resolution_status_reason ?? null,
        span: cloneJson(entry.span ?? null),
        target_resolution_span: cloneJson(entry.span ?? null),
        fanout: cloneJson(entry.fanout ?? null),
        target_resolution_fanout: cloneJson(entry.fanout ?? null),
        candidates: Array.isArray(entry.candidates) ? cloneJson(entry.candidates) : [],
        target_resolution_candidates: Array.isArray(entry.candidates) ? cloneJson(entry.candidates) : []
      }))
    : [];
  const payloadBoundInputDigest =
    normalizeStringEntry(metricSourceProvenance.payload_bound_input_digest) ??
    computeNormalizedInputDigest({
      selected_unit: selectedUnitValue,
      source_record_digest: sourceRecordDigestValue,
      expected_edit_targets: expectedEditTargets,
      producer: cloneJson(metricSourceProvenance.producer ?? null)
    });
  const normalizedMetricSourceProvenance = {
    ...cloneJson(metricSourceProvenance),
    payload_bound_input_digest: payloadBoundInputDigest,
    binding_status: metricSourceProvenance.binding_status ?? null,
    binding_reason:
      metricSourceProvenance.binding_reason ??
      (metricSourceProvenance.binding_status === "trusted" ? "trusted structural target evidence" : null)
  };

  return {
    target_resolution_evidence_status: structuralTargetMetrics.target_resolution_evidence_status ?? "degraded",
    target_resolution_provider: structuralTargetMetrics.target_resolution_provider ?? null,
    target_resolution_provider_version: structuralTargetMetrics.target_resolution_provider_version ?? null,
    target_resolution_status_reason: structuralTargetMetrics.target_resolution_status_reason ?? null,
    selected_unit: selectedUnitValue,
    source_record_digest: sourceRecordDigestValue,
    expected_edit_targets: expectedEditTargets,
    targets: resolverTargets,
    resolutions: cloneJson(resolverTargets),
    producer: cloneJson(metricSourceProvenance.producer ?? null),
    payload_bound_input_digest: payloadBoundInputDigest,
    expected_payload_bound_input_digest:
      normalizeStringEntry(metricSourceProvenance.expected_payload_bound_input_digest) ?? null,
    binding_status: normalizedMetricSourceProvenance.binding_status ?? null,
    binding_reason: normalizedMetricSourceProvenance.binding_reason ?? null,
    metric_source_provenance: normalizedMetricSourceProvenance
  };
}

function appendCanonicalLargeFileDecAuthority(value, sink) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (isObject(entry)) {
        sink.push(entry);
      }
    }
    return;
  }
  if (isObject(value) && Array.isArray(value.authorities)) {
    for (const entry of value.authorities) {
      if (isObject(entry)) {
        sink.push(entry);
      }
    }
    return;
  }
  if (isObject(value)) {
    sink.push(value);
  }
}

export function collectSelectedUnitLargeFileDecAuthority(record, dispatchReadiness) {
  const entries = [];
  if (!isObject(record)) {
    return entries;
  }
  appendCanonicalLargeFileDecAuthority(record.large_file_dec_authority, entries);
  appendCanonicalLargeFileDecAuthority(record.acceptance?.large_file_dec_authority, entries);

  const selectedSliceId = normalizeStringEntry(dispatchReadiness?.unit?.slice_id);
  if (selectedSliceId && Array.isArray(record.slices)) {
    const selectedSlice = record.slices.find(
      (slice) => isObject(slice) && normalizeStringEntry(slice.id) === selectedSliceId
    );
    if (selectedSlice) {
      appendCanonicalLargeFileDecAuthority(selectedSlice.large_file_dec_authority, entries);
      appendCanonicalLargeFileDecAuthority(selectedSlice.acceptance?.large_file_dec_authority, entries);
    }
  }
  return entries;
}

