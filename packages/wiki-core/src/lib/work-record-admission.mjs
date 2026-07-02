import {
  WORK_RECORD_ADMISSION_DECISION_CODES,
  WORK_RECORD_ADMISSION_DECISION_LOCAL_SCHEMA_VERSION,
  WORK_RECORD_ADMISSION_DECISION_SCHEMA_VERSION,
  WORK_RECORD_ADMISSION_DECISION_VALUES,
  WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_DECISION_KIND,
  WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_GENERATOR,
  WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_SCHEMA_VERSION,
  WORK_RECORD_ADMISSION_LOCAL_AUTHORITY,
  WORK_RECORD_ADMISSION_LOCAL_POLICY_BACKEND,
  WORK_RECORD_ADMISSION_SCHEMA_VERSION,
  WORK_UNIT_ATOMICITY_REVIEW_DECISION_CODES
} from "./work-record-admission-decision-codes.mjs";
import { loadReferenceWorkerAdmissionPolicyPack } from "./work-record-admission-policy.mjs";
import { createWorkerAdmissionDecisionFromFeatureVector } from "./work-record-admission-feature-vector.mjs";
import { createWorkRecordAdmissionRecordLocalInputs } from "./work-record-admission-record-inputs.mjs";
import {
  createWorkRecordAdmissionEnvelope as createWorkRecordAdmissionEnvelopeBase
} from "./work-record-admission-envelope.mjs";
import {
  computeNormalizedRequestOutputHash,
  createWorkRecordAdmissionDerivedEvidence as createWorkRecordAdmissionDerivedEvidenceBase,
  evaluateWorkRecordAdmissionDerivedEvidence as evaluateWorkRecordAdmissionDerivedEvidenceBase,
  NORMALIZED_REQUEST_OUTPUT_HASH_PLACEHOLDER,
  systemUtcClock
} from "./work-record-admission-derived-evidence.mjs";
import { cloneJson, isObject, toNonNegativeInteger } from "./work-record-admission-shared.mjs";

const STORED_REPLAY_PRIVATE_METRIC_KEYS = [
  "absent_optional_evidence",
  "feature_vector",
  "structural_target_metrics"
];
const CARRIER_FACTS_RECORDED_RULE = "carrier_facts_recorded_no_local_admissibility_judgment";
const CARRIER_FACTS_RECORDED_REASON =
  "carrier facts are structurally complete for Node Engine evaluation";

function hasCoordinationOnlyStoredReplayLocExclusion(metrics) {
  if (!isObject(metrics)) {
    return false;
  }

  const thresholdExclusions = isObject(metrics.threshold_exclusions) ? metrics.threshold_exclusions : null;
  const missingMetrics = isObject(metrics.missing_metrics) ? metrics.missing_metrics : null;
  return (
    metrics.write_scope_total_loc === null &&
    metrics.max_write_file_loc === null &&
    toNonNegativeInteger(metrics.unknown_metric_count) === 0 &&
    toNonNegativeInteger(thresholdExclusions?.coordination_only_file_count) > 0 &&
    toNonNegativeInteger(thresholdExclusions?.threshold_counted_loc_file_count) === 0 &&
    missingMetrics?.write_scope_total_loc === false &&
    missingMetrics?.max_write_file_loc === false
  );
}

function hasStoredReplayRequestSideFileStatsEvidence(value) {
  const normalizedRequest = isObject(value?.normalized_request) ? value.normalized_request : null;
  const normalizedRequestFileStats = Array.isArray(normalizedRequest?.file_stats)
    ? normalizedRequest.file_stats
    : [];
  const sourceInputs = isObject(normalizedRequest?.evidence?.source_inputs)
    ? normalizedRequest.evidence.source_inputs
    : null;
  const sourceInputsFileStats = Array.isArray(sourceInputs?.file_stats) ? sourceInputs.file_stats : [];

  return normalizedRequestFileStats.length > 0 || sourceInputsFileStats.length > 0;
}

function stripStoredReplayPrivateMetricFields(metrics) {
  if (!isObject(metrics)) {
    return metrics;
  }

  const clonedMetrics = { ...metrics };
  for (const key of STORED_REPLAY_PRIVATE_METRIC_KEYS) {
    delete clonedMetrics[key];
  }
  return clonedMetrics;
}

function stripStoredReplayPrivateMetricFieldsFromReplaySurface(
  surface,
  { preserveTrustedTargetResolutionEvidence = false } = {}
) {
  if (!isObject(surface)) {
    return surface;
  }

  const clonedSurface = cloneJson(surface) ?? {};
  if (!preserveTrustedTargetResolutionEvidence && isObject(clonedSurface.metric_summary)) {
    clonedSurface.metric_summary = stripStoredReplayPrivateMetricFields(clonedSurface.metric_summary);
  }
  if (!preserveTrustedTargetResolutionEvidence && isObject(clonedSurface.metrics)) {
    clonedSurface.metrics = stripStoredReplayPrivateMetricFields(clonedSurface.metrics);
  }

  const requestLike = isObject(clonedSurface.normalized_request)
    ? clonedSurface.normalized_request
    : isObject(clonedSurface.request)
      ? clonedSurface.request
      : null;
  if (isObject(requestLike)) {
    if (!preserveTrustedTargetResolutionEvidence && Object.prototype.hasOwnProperty.call(requestLike, "feature_vector")) {
      delete requestLike.feature_vector;
    }
    if (
      !preserveTrustedTargetResolutionEvidence &&
      Object.prototype.hasOwnProperty.call(requestLike, "structural_target_metrics")
    ) {
      delete requestLike.structural_target_metrics;
    }
    if (isObject(requestLike.work_unit_metrics)) {
      requestLike.work_unit_metrics = stripStoredReplayPrivateMetricFields(requestLike.work_unit_metrics);
    }
    if (isObject(requestLike.evidence?.materialized_work_unit_metrics)) {
      requestLike.evidence.materialized_work_unit_metrics = stripStoredReplayPrivateMetricFields(
        requestLike.evidence.materialized_work_unit_metrics
      );
    }
    if (isObject(requestLike.evidence)) {
      if (
        !preserveTrustedTargetResolutionEvidence &&
        Object.prototype.hasOwnProperty.call(requestLike.evidence, "feature_vector")
      ) {
        delete requestLike.evidence.feature_vector;
      }
      if (
        !preserveTrustedTargetResolutionEvidence &&
        Object.prototype.hasOwnProperty.call(requestLike.evidence, "structural_target_metrics")
      ) {
        delete requestLike.evidence.structural_target_metrics;
      }
      if (isObject(requestLike.evidence.source_inputs)) {
        if (
          !preserveTrustedTargetResolutionEvidence &&
          Object.prototype.hasOwnProperty.call(requestLike.evidence.source_inputs, "feature_vector")
        ) {
          delete requestLike.evidence.source_inputs.feature_vector;
        }
        if (
          !preserveTrustedTargetResolutionEvidence &&
          Object.prototype.hasOwnProperty.call(requestLike.evidence.source_inputs, "structural_target_metrics")
        ) {
          delete requestLike.evidence.source_inputs.structural_target_metrics;
        }
      }
    }
    if (isObject(requestLike.evidence?.source_inputs?.work_unit_metrics)) {
      requestLike.evidence.source_inputs.work_unit_metrics = stripStoredReplayPrivateMetricFields(
        requestLike.evidence.source_inputs.work_unit_metrics
      );
    }
  }

  return clonedSurface;
}

function shouldPromoteStoredCoordinationOnlyReplay(value, result) {
  const metricSummary = isObject(value?.metric_summary) ? value.metric_summary : null;
  const materializedMetrics = isObject(value?.normalized_request?.evidence?.materialized_work_unit_metrics)
    ? value.normalized_request.evidence.materialized_work_unit_metrics
    : null;
  const decisionCodes = Array.isArray(result?.decision_codes) ? result.decision_codes : [];
  return (
    decisionCodes.length === 1 &&
    decisionCodes[0] === WORK_UNIT_ATOMICITY_REVIEW_DECISION_CODES.required_metric_missing &&
    hasStoredReplayRequestSideFileStatsEvidence(value) &&
    (hasCoordinationOnlyStoredReplayLocExclusion(metricSummary) || hasCoordinationOnlyStoredReplayLocExclusion(materializedMetrics))
  );
}

function isCleanCarrierFactsRecordedReplayResult(result) {
  if (
    !isObject(result) ||
    result.decision != null ||
    result.decision_code != null ||
    result.effect != null
  ) {
    return false;
  }

  const decisionCodes = Array.isArray(result.decision_codes) ? result.decision_codes : [];
  if (decisionCodes.length > 0) {
    return false;
  }

  const matchedRules = Array.isArray(result.matched_rules) ? result.matched_rules : [];
  if (matchedRules.includes(CARRIER_FACTS_RECORDED_RULE)) {
    return true;
  }

  const reasons = Array.isArray(result.reasons) ? result.reasons : [];
  return reasons.includes(CARRIER_FACTS_RECORDED_REASON);
}

function promoteCleanCarrierFactsRecordedReplayResult(result) {
  if (!isCleanCarrierFactsRecordedReplayResult(result)) {
    return result;
  }

  return {
    ...result,
    decision: "allow",
    allowed: true,
    decision_code: "admission_allowed",
    effect: "allows"
  };
}

function patchCoordinationOnlyStoredReplayMetricsOnOptions(value = {}) {
  const clonedValue = cloneJson(value) ?? {};
  if (!isObject(clonedValue.metric_summary)) {
    return clonedValue;
  }

  const coordinationOnlyOptionalMetricValues = {
    write_scope_total_loc: 0,
    max_write_file_loc: 0,
    declared_runtime_mode_count: 0,
    artifact_kind_count: 0
  };

  clonedValue.metric_summary = {
    ...clonedValue.metric_summary,
    ...coordinationOnlyOptionalMetricValues,
    unknown_metric_count: 0
  };
  if (isObject(clonedValue.metric_summary.missing_metrics)) {
    clonedValue.metric_summary.missing_metrics = {
      ...clonedValue.metric_summary.missing_metrics,
      write_scope_total_loc: false,
      max_write_file_loc: false,
      declared_runtime_mode_count: false,
      artifact_kind_count: false
    };
  }

  return clonedValue;
}

function restoreCoordinationOnlyStoredReplayMetrics(result = {}) {
  const clonedResult = cloneJson(result) ?? {};
  if (isObject(clonedResult.metrics)) {
    clonedResult.metrics = {
      ...clonedResult.metrics,
      write_scope_total_loc: null,
      max_write_file_loc: null,
      unknown_metric_count: 0
    };
  }
  return clonedResult;
}

export function createWorkRecordAdmissionEnvelope(options = {}) {
  return createWorkRecordAdmissionEnvelopeBase(options);
}

export function createWorkRecordAdmissionDerivedEvidence(options = {}) {
  return createWorkRecordAdmissionDerivedEvidenceBase(options);
}

export function evaluateWorkRecordAdmissionDerivedEvidence(value, options = {}) {
  const preserveTrustedTargetResolutionEvidence =
    isObject(value?.normalized_request?.evidence?.target_resolution_evidence?.metric_source_provenance) &&
    value.normalized_request.evidence.target_resolution_evidence.metric_source_provenance.binding_status ===
      "trusted";
  const sanitizedValue = stripStoredReplayPrivateMetricFieldsFromReplaySurface(value, {
    preserveTrustedTargetResolutionEvidence
  });
  const baseResult = evaluateWorkRecordAdmissionDerivedEvidenceBase(sanitizedValue, options);
  let normalizedResult = stripStoredReplayPrivateMetricFieldsFromReplaySurface(baseResult, {
    preserveTrustedTargetResolutionEvidence
  });

  const persistedDecisionCodes = Array.isArray(sanitizedValue?.admission_summary?.decision_codes)
    ? sanitizedValue.admission_summary.decision_codes.filter((code) => typeof code === "string")
    : [];
  if (
    !preserveTrustedTargetResolutionEvidence &&
    normalizedResult?.decision === "review_required" &&
    persistedDecisionCodes.length > 0 &&
    Array.isArray(normalizedResult.decision_codes)
  ) {
    const persistedDecisionCodeSet = new Set(persistedDecisionCodes);
    const filteredDecisionCodes = normalizedResult.decision_codes.filter((code) => persistedDecisionCodeSet.has(code));
    if (filteredDecisionCodes.length > 0) {
      normalizedResult = {
        ...normalizedResult,
        decision_codes: filteredDecisionCodes
      };
      if (Array.isArray(normalizedResult.matched_rules)) {
        normalizedResult.matched_rules = normalizedResult.matched_rules.filter((rule) =>
          !rule.includes("write_scope_count")
        );
      }
      if (Array.isArray(normalizedResult.reasons)) {
        normalizedResult.reasons = normalizedResult.reasons.filter((reason) =>
          !/breadth|write scope count/i.test(reason)
        );
      }
    }
  }
  if (
    preserveTrustedTargetResolutionEvidence &&
    Array.isArray(normalizedResult?.decision_codes) &&
    normalizedResult.decision_codes.includes(
      "worker_admission.work_unit_atomicity.excessive_breadth.v1"
    )
  ) {
    normalizedResult = {
      ...normalizedResult,
      decision_codes: normalizedResult.decision_codes.filter(
        (code) => code !== "worker_admission.work_unit_atomicity.excessive_breadth.v1"
      )
    };
    if (Array.isArray(normalizedResult.matched_rules)) {
      normalizedResult.matched_rules = normalizedResult.matched_rules.filter(
        (rule) => !rule.includes("write_scope_count")
      );
    }
    if (Array.isArray(normalizedResult.reasons)) {
      normalizedResult.reasons = normalizedResult.reasons.filter(
        (reason) => !/breadth|write scope count/i.test(reason)
      );
    }
  }
  normalizedResult = promoteCleanCarrierFactsRecordedReplayResult(normalizedResult);
  if (!shouldPromoteStoredCoordinationOnlyReplay(sanitizedValue, normalizedResult)) {
    return normalizedResult;
  }

  const promotedValue = patchCoordinationOnlyStoredReplayMetricsOnOptions(sanitizedValue);
  const promotedResult = promoteCleanCarrierFactsRecordedReplayResult(
    evaluateWorkRecordAdmissionDerivedEvidenceBase(promotedValue, options)
  );
  if (promotedResult?.decision !== "allow") {
    return normalizedResult;
  }

  return stripStoredReplayPrivateMetricFieldsFromReplaySurface(
    restoreCoordinationOnlyStoredReplayMetrics(promotedResult)
  );
}

export {
  WORK_RECORD_ADMISSION_DECISION_CODES,
  WORK_RECORD_ADMISSION_DECISION_LOCAL_SCHEMA_VERSION,
  WORK_RECORD_ADMISSION_DECISION_SCHEMA_VERSION,
  WORK_RECORD_ADMISSION_DECISION_VALUES,
  WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_DECISION_KIND,
  WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_GENERATOR,
  WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_SCHEMA_VERSION,
  WORK_RECORD_ADMISSION_LOCAL_AUTHORITY,
  WORK_RECORD_ADMISSION_LOCAL_POLICY_BACKEND,
  WORK_RECORD_ADMISSION_SCHEMA_VERSION,
  loadReferenceWorkerAdmissionPolicyPack,
  createWorkerAdmissionDecisionFromFeatureVector,
  createWorkRecordAdmissionRecordLocalInputs,
  computeNormalizedRequestOutputHash,
  NORMALIZED_REQUEST_OUTPUT_HASH_PLACEHOLDER,
  systemUtcClock
};
