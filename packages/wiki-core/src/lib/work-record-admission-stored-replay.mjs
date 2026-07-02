import {
  classifyExistingCodeSurfaceCount,
  cloneJson,
  computeNormalizedInputDigest,
  isNonEmptyString,
  isObject,
  normalizeStringEntry,
  toNonNegativeInteger
} from "./work-record-admission-shared.mjs";
import {
  WORK_RECORD_ADMISSION_DECISION_LOCAL_SCHEMA_VERSION,
  WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_DECISION_KIND,
  WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_GENERATOR,
  WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_SCHEMA_VERSION,
  WORK_RECORD_ADMISSION_LOCAL_POLICY_BACKEND,
  WORK_UNIT_ATOMICITY_MISSING_SUPPORTING_EVIDENCE_SPECS
} from "./work-record-admission-decision-codes.mjs";
import {
  detectMissingTargetPlanReviewSignal,
  evaluateWorkUnitAtomicityDecisionCore,
  normalizeWorkUnitAtomicityProfile
} from "./work-record-admission-policy.mjs";
import {
  hasBoundedExpectedChangeForLargeSingleFile,
  shouldApplyAggregateTotalLocThreshold
} from "./work-record-admission-work-unit.mjs";
import { sortAdmissionCodes } from "./work-record-admission-decision-codes.mjs";

const STORED_REPLAY_REQUIRED_METRIC_KEYS = [
  "write_scope_count",
  "write_scope_existing_file_count",
  "write_scope_directory_count",
  "write_scope_total_loc",
  "max_write_file_loc",
  "acceptance_criteria_count",
  "validation_command_count",
  "declared_runtime_mode_count",
  "artifact_kind_count",
  "expected_changed_line_budget",
  "unknown_metric_count"
];

const STORED_REPLAY_REQUIRED_PROVENANCE_KEYS = [
  "source_kind",
  "canonicality",
  "evidence_basis",
  "policy_backend",
  "policy_version"
];

const STORED_REPLAY_ABSENT_OPTIONAL_EVIDENCE_TO_METRIC_KEYS = {
  runtime_mode_metadata: "declared_runtime_mode_count",
  artifact_kind_metadata: "artifact_kind_count"
};

const CARRIER_FACTS_RECORDED_RULE = "carrier_facts_recorded_no_local_admissibility_judgment";
const CARRIER_FACTS_RECORDED_REASON =
  "carrier facts are structurally complete for Node Engine evaluation";
const CARRIER_FACTS_RECORDED_EFFECT =
  "allows_carrier_fact_forwarding_without_local_admissibility_judgment";

function storedReplayHasDeterministicCoreEvidence(metricSummary) {
  const missingEvidence = isObject(metricSummary?.missing_evidence) ? metricSummary.missing_evidence : null;
  if (!missingEvidence) {
    return false;
  }
  return missingEvidence.file_stats === false && missingEvidence.validation_command_metadata === false;
}

function collectStoredReplayOptionalAbsentMetricKeys(metricSummary) {
  const excluded = new Set();
  const hasDeterministicCoreEvidence = storedReplayHasDeterministicCoreEvidence(metricSummary);
  const absentOptionalEvidence = isObject(metricSummary?.absent_optional_evidence)
    ? metricSummary.absent_optional_evidence
    : null;
  if (hasDeterministicCoreEvidence && absentOptionalEvidence) {
    for (const [evidenceKey, metricKey] of Object.entries(
      STORED_REPLAY_ABSENT_OPTIONAL_EVIDENCE_TO_METRIC_KEYS
    )) {
      const entry = absentOptionalEvidence[evidenceKey];
      if (isObject(entry) && entry.status === "absent_optional") {
        excluded.add(metricKey);
      }
    }
  }

  const missingMetrics = isObject(metricSummary?.missing_metrics) ? metricSummary.missing_metrics : null;
  if (hasDeterministicCoreEvidence && missingMetrics && missingMetrics.expected_changed_line_budget === false) {
    excluded.add("expected_changed_line_budget");
  }
  return excluded;
}

function countTruthyObjectValues(value) {
  if (!isObject(value)) {
    return 0;
  }
  return Object.values(value).reduce((count, entry) => count + (entry ? 1 : 0), 0);
}

function countStoredReplayInvalidEvidenceIssues(metricSummary) {
  const evidenceIssues = isObject(metricSummary?.evidence_issues) ? metricSummary.evidence_issues : null;
  if (!evidenceIssues) {
    return 0;
  }

  const fileStatsIssues = isObject(evidenceIssues.file_stats) ? evidenceIssues.file_stats : {};
  const runtimeModeIssues = isObject(evidenceIssues.runtime_mode_metadata) ? evidenceIssues.runtime_mode_metadata : {};
  const artifactKindIssues = isObject(evidenceIssues.artifact_kind_metadata) ? evidenceIssues.artifact_kind_metadata : {};

  return (
    (toNonNegativeInteger(fileStatsIssues.invalid_count) ?? 0) +
    (toNonNegativeInteger(fileStatsIssues.missing_file_state_count) ?? 0) +
    (toNonNegativeInteger(fileStatsIssues.invalid_file_state_count) ?? 0) +
    (toNonNegativeInteger(fileStatsIssues.loc_issue_count) ?? 0) +
    (toNonNegativeInteger(runtimeModeIssues.invalid_count) ?? 0) +
    (toNonNegativeInteger(artifactKindIssues.invalid_count) ?? 0)
  );
}

function normalizeStoredMissingSupportingEvidence(metricSummary) {
  const missingSupportingEvidence = isObject(metricSummary.missing_supporting_evidence)
    ? cloneJson(metricSummary.missing_supporting_evidence)
    : {};
  const missingEvidence = isObject(metricSummary.missing_evidence) ? metricSummary.missing_evidence : {};

  for (const spec of WORK_UNIT_ATOMICITY_MISSING_SUPPORTING_EVIDENCE_SPECS) {
    if (!missingEvidence[spec.key] || missingSupportingEvidence[spec.key]) {
      continue;
    }
    missingSupportingEvidence[spec.key] = {
      field_path: spec.field_path,
      reason_code: spec.reason_code,
      reason: spec.reason,
      status: "missing"
    };
  }

  return missingSupportingEvidence;
}

function countStoredReplayUnknownMetrics(metricSummary, provenance) {
  const summary = isObject(metricSummary) ? metricSummary : {};
  const explicitUnknownMetricCount = toNonNegativeInteger(summary.unknown_metric_count) ?? 0;
  const missingMetricCount = countTruthyObjectValues(summary.missing_metrics);
  const missingEvidenceCount = countTruthyObjectValues(summary.missing_evidence);
  const provenanceIssueCount = toNonNegativeInteger(summary.evidence_issues?.metric_source_provenance?.missing_field_count) ?? 0;
  const missingProvenanceFieldCount = STORED_REPLAY_REQUIRED_PROVENANCE_KEYS.reduce(
    (count, key) => count + (isNonEmptyString(provenance?.[key]) ? 0 : 1),
    0
  );
  const optionalAbsentMetricKeys = collectStoredReplayOptionalAbsentMetricKeys(summary);
  const nullMetricCount = STORED_REPLAY_REQUIRED_METRIC_KEYS.reduce(
    (count, key) => count + (summary[key] === null && !optionalAbsentMetricKeys.has(key) ? 1 : 0),
    0
  );
  const invalidEvidenceIssueCount = countStoredReplayInvalidEvidenceIssues(summary);

  return Math.max(
    explicitUnknownMetricCount,
    missingMetricCount +
      missingEvidenceCount +
      provenanceIssueCount +
      missingProvenanceFieldCount +
      nullMetricCount +
      invalidEvidenceIssueCount
  );
}

function normalizeStoredWorkRecordAdmissionDerivedEvidenceInput(value) {
  if (!isObject(value)) {
    throw new Error("evaluateWorkRecordAdmissionDerivedEvidence requires a derived evidence record");
  }

  const schemaVersion = normalizeStringEntry(value.schema_version);
  if (schemaVersion !== WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_SCHEMA_VERSION) {
    throw new Error(
      `evaluateWorkRecordAdmissionDerivedEvidence requires ${WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_SCHEMA_VERSION}`
    );
  }

  const decisionKind = normalizeStringEntry(value.decision_kind);
  if (decisionKind !== WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_DECISION_KIND) {
    throw new Error(
      `evaluateWorkRecordAdmissionDerivedEvidence requires decision_kind ${WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_DECISION_KIND}`
    );
  }

  const hasNormalizedRequest = Object.prototype.hasOwnProperty.call(value, "normalized_request");
  let normalizedRequest;
  if (hasNormalizedRequest) {
    const normalizedRequestValue = value.normalized_request;
    if (!isObject(normalizedRequestValue)) {
      throw new Error(
        "evaluateWorkRecordAdmissionDerivedEvidence requires normalized_request to be absent for compact entries or a well-formed object for full inline entries"
      );
    }
    if (
      normalizeStringEntry(normalizedRequestValue.schema_version) !== "worker-admission-request.v1" ||
      normalizeStringEntry(normalizedRequestValue.decision_kind) !==
        WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_DECISION_KIND ||
      !isObject(normalizedRequestValue.subject) ||
      !isObject(normalizedRequestValue.work_unit_metrics)
    ) {
      throw new Error(
        "evaluateWorkRecordAdmissionDerivedEvidence requires normalized_request to be absent for compact entries or a well-formed object for full inline entries"
      );
    }
    normalizedRequest = cloneJson(normalizedRequestValue);
  } else {
    normalizedRequest = {
      unit: cloneJson(value.unit ?? null),
      source_record_digest: normalizeStringEntry(value.source_record_digest) ?? null
    };
  }

  if (!isObject(value.metric_summary)) {
    throw new Error("evaluateWorkRecordAdmissionDerivedEvidence requires metric_summary");
  }
  if (!isObject(value.provenance)) {
    throw new Error("evaluateWorkRecordAdmissionDerivedEvidence requires provenance");
  }

  return {
    normalized_request: normalizedRequest,
    metric_summary: cloneJson(value.metric_summary),
    provenance: cloneJson(value.provenance)
  };
}

function normalizeStoredReplayStructuralTargetMetrics(metricSummary, normalizedRequest) {
  if (isObject(metricSummary?.structural_target_metrics)) {
    return cloneJson(metricSummary.structural_target_metrics);
  }
  if (isObject(normalizedRequest?.structural_target_metrics)) {
    return cloneJson(normalizedRequest.structural_target_metrics);
  }
  if (isObject(normalizedRequest?.evidence?.source_inputs?.structural_target_metrics)) {
    return cloneJson(normalizedRequest.evidence.source_inputs.structural_target_metrics);
  }
  return null;
}

function normalizeStoredWorkUnitAtomicityMetricSummary(metricSummary, normalizedRequest = null) {
  const summary = isObject(metricSummary) ? metricSummary : {};
  return {
    write_scope_count: toNonNegativeInteger(summary.write_scope_count),
    write_scope_existing_file_count: toNonNegativeInteger(summary.write_scope_existing_file_count),
    write_scope_directory_count: toNonNegativeInteger(summary.write_scope_directory_count),
    write_scope_total_loc: toNonNegativeInteger(summary.write_scope_total_loc),
    max_write_file_loc: toNonNegativeInteger(summary.max_write_file_loc),
    acceptance_criteria_count: toNonNegativeInteger(summary.acceptance_criteria_count),
    validation_command_count: toNonNegativeInteger(summary.validation_command_count),
    declared_runtime_mode_count: toNonNegativeInteger(summary.declared_runtime_mode_count),
    artifact_kind_count: toNonNegativeInteger(summary.artifact_kind_count),
    expected_changed_line_budget: toNonNegativeInteger(summary.expected_changed_line_budget),
    unknown_metric_count: toNonNegativeInteger(summary.unknown_metric_count) ?? 0,
    threshold_exclusions: isObject(summary.threshold_exclusions) ? cloneJson(summary.threshold_exclusions) : {},
    missing_metrics: isObject(summary.missing_metrics) ? cloneJson(summary.missing_metrics) : {},
    missing_evidence: isObject(summary.missing_evidence) ? cloneJson(summary.missing_evidence) : {},
    missing_supporting_evidence: isObject(summary.missing_supporting_evidence)
      ? cloneJson(summary.missing_supporting_evidence)
      : {},
    absent_optional_evidence: isObject(summary.absent_optional_evidence)
      ? cloneJson(summary.absent_optional_evidence)
      : {},
    evidence_issues: isObject(summary.evidence_issues) ? cloneJson(summary.evidence_issues) : null,
    structural_target_metrics: normalizeStoredReplayStructuralTargetMetrics(summary, normalizedRequest),
    feature_vector: isObject(summary.feature_vector) ? cloneJson(summary.feature_vector) : null
  };
}

function hasResolvedStoredReplayTargetEvidence(result) {
  const structuralTargetMetrics = isObject(result?.metrics?.structural_target_metrics)
    ? result.metrics.structural_target_metrics
    : isObject(result?.request?.structural_target_metrics)
      ? result.request.structural_target_metrics
      : null;
  if (!structuralTargetMetrics) {
    return false;
  }

  const expectedTargetCount = toNonNegativeInteger(structuralTargetMetrics.expected_edit_target_count) ?? 0;
  const resolvedTargetCount = toNonNegativeInteger(structuralTargetMetrics.resolved_edit_target_count) ?? 0;
  const unresolvedTargetCount = toNonNegativeInteger(structuralTargetMetrics.unresolved_edit_target_count) ?? 0;
  const ambiguousTargetCount = toNonNegativeInteger(structuralTargetMetrics.ambiguous_edit_target_count) ?? 0;
  const unresolvedWriteScopeTargetCount =
    toNonNegativeInteger(structuralTargetMetrics.write_scope_without_resolved_targets) ?? 0;

  return (
    normalizeStringEntry(structuralTargetMetrics.target_resolution_evidence_status) === "present" &&
    expectedTargetCount > 0 &&
    resolvedTargetCount === expectedTargetCount &&
    unresolvedTargetCount === 0 &&
    ambiguousTargetCount === 0 &&
    unresolvedWriteScopeTargetCount === 0
  );
}

function hasCoordinationOnlyStoredReplayLocExclusion(metrics) {
  if (!isObject(metrics)) {
    return false;
  }

  const thresholdExclusions = isObject(metrics.threshold_exclusions) ? metrics.threshold_exclusions : {};
  const missingMetrics = isObject(metrics.missing_metrics) ? metrics.missing_metrics : {};
  const writeScopeTotalLoc = toNonNegativeInteger(metrics.write_scope_total_loc);
  const maxWriteFileLoc = toNonNegativeInteger(metrics.max_write_file_loc);
  const thresholdCountedLocFileCount =
    toNonNegativeInteger(thresholdExclusions.threshold_counted_loc_file_count) ?? 0;
  return (
    (metrics.write_scope_total_loc === null || writeScopeTotalLoc === 0) &&
    (metrics.max_write_file_loc === null || maxWriteFileLoc === 0) &&
    toNonNegativeInteger(metrics.unknown_metric_count) === 0 &&
    toNonNegativeInteger(thresholdExclusions.coordination_only_file_count) > 0 &&
    thresholdCountedLocFileCount === 0 &&
    missingMetrics.write_scope_total_loc === false &&
    missingMetrics.max_write_file_loc === false
  );
}

function removeCarrierSuccessMarkersForCoordinationOnlyReplay(result) {
  if (!isObject(result)) {
    return result;
  }

  const matchedRules = Array.isArray(result.matched_rules)
    ? result.matched_rules.filter((rule) => rule !== CARRIER_FACTS_RECORDED_RULE)
    : result.matched_rules;
  const reasons = Array.isArray(result.reasons)
    ? result.reasons.filter((reason) => reason !== CARRIER_FACTS_RECORDED_REASON)
    : result.reasons;

  return {
    ...result,
    matched_rules: matchedRules,
    reasons
  };
}

function projectCleanCarrierSuccessForStoredReplay(result) {
  if (!isObject(result) || result.decision != null || result.effect != null || result.decision_code != null) {
    return result;
  }

  const decisionCodes = Array.isArray(result.decision_codes) ? result.decision_codes : [];
  if (decisionCodes.length > 0) {
    return result;
  }

  const matchedRules = Array.isArray(result.matched_rules) ? result.matched_rules : [];
  const reasons = Array.isArray(result.reasons) ? result.reasons : [];
  if (
    !matchedRules.includes(CARRIER_FACTS_RECORDED_RULE) &&
    !reasons.includes(CARRIER_FACTS_RECORDED_REASON)
  ) {
    return result;
  }

  if (
    hasCoordinationOnlyStoredReplayLocExclusion(result.metrics) ||
    hasCoordinationOnlyStoredReplayLocExclusion(result.request?.evidence?.materialized_work_unit_metrics)
  ) {
    return removeCarrierSuccessMarkersForCoordinationOnlyReplay(result);
  }

  if (!hasResolvedStoredReplayTargetEvidence(result)) {
    return result;
  }

  return {
    ...result,
    decision: "allow",
    allowed: true,
    effect: CARRIER_FACTS_RECORDED_EFFECT
  };
}

function collectStoredReplayTargetPlanSignal({
  normalizedRequest,
  metricSummary,
  policyProfile
}) {
  const fileStats = Array.isArray(normalizedRequest.file_stats)
    ? normalizedRequest.file_stats
    : Array.isArray(normalizedRequest.evidence?.source_inputs?.file_stats)
      ? normalizedRequest.evidence.source_inputs.file_stats
      : [];
  const targetPlanSignal = detectMissingTargetPlanReviewSignal({
    structuralTargetMetrics: metricSummary.structural_target_metrics,
    fileStats
  });
  if (targetPlanSignal) {
    return targetPlanSignal;
  }

  const structuralTargetMetrics = isObject(metricSummary.structural_target_metrics)
    ? metricSummary.structural_target_metrics
    : null;
  if (!structuralTargetMetrics) {
    return null;
  }

  if (classifyExistingCodeSurfaceCount(fileStats) === 0) {
    return null;
  }

  const unresolvedTargetCount = toNonNegativeInteger(structuralTargetMetrics.write_scope_without_resolved_targets) ?? 0;
  if (unresolvedTargetCount === 0) {
    return null;
  }

  const validationCommandCount = toNonNegativeInteger(metricSummary.validation_command_count) ?? 0;
  const validationCommandReviewThreshold = toNonNegativeInteger(
    policyProfile?.thresholds?.review_when_validation_command_count_above
  );
  const validationCommandThresholdExceeded =
    validationCommandReviewThreshold !== null && validationCommandCount > validationCommandReviewThreshold;

  const explicitUnknownMetricCount = toNonNegativeInteger(metricSummary.unknown_metric_count) ?? 0;

  if (explicitUnknownMetricCount <= 0 && !validationCommandThresholdExceeded) {
    return null;
  }

  return {
    reason_code: "worker_admission.work_unit_atomicity.target_plan_missing_requires_review.v1",
    reason:
      "expected_edit_targets evidence is absent and the unit touches an existing code surface; supply a target plan before launch",
    rule: "target_plan_missing_for_code_surface"
  };
}

function createWorkUnitAtomicityDecisionFromStoredDerivedEvidence({
  normalizedRequest,
  metricSummary,
  provenance,
  policyProfile,
  mode
}) {
  const normalizedProfile = normalizeWorkUnitAtomicityProfile(policyProfile);
  const normalizedMetricSummary = normalizeStoredWorkUnitAtomicityMetricSummary(metricSummary, normalizedRequest);
  const storedMissingSupportingEvidence = normalizeStoredMissingSupportingEvidence(normalizedMetricSummary);
  const storedUnknownMetricCount = countStoredReplayUnknownMetrics(normalizedMetricSummary, provenance);
  const storedTargetPlanSignal = collectStoredReplayTargetPlanSignal({
    normalizedRequest,
    metricSummary: normalizedMetricSummary,
    policyProfile: normalizedProfile
  });
  const normalizedRequestContext = isObject(normalizedRequest.context) ? normalizedRequest.context : {};
  const requestMode = normalizeStringEntry(mode ?? normalizedRequestContext.mode) ?? "local";
  const policyVersion =
    normalizeStringEntry(normalizedRequestContext.policy_version) ??
    normalizeStringEntry(provenance.policy_version) ??
    "worker-admission-policy.v1";
  const normalizedInputDigest = computeNormalizedInputDigest({
    schema_version: WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_SCHEMA_VERSION,
    decision_kind: WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_DECISION_KIND,
    record_id: normalizeStringEntry(normalizedRequest.record_id) ?? null,
    subject: normalizedRequest.subject ?? null,
    work_unit_metrics: normalizedMetricSummary,
    context: {
      source_path: normalizeStringEntry(normalizedRequestContext.source_path) ?? null,
      field_path: normalizeStringEntry(normalizedRequestContext.field_path) ?? "work_unit_metrics",
      mode: requestMode,
      policy_version: policyVersion
    },
    policy_profile: normalizedProfile,
    provenance: {
      policy_backend: normalizeStringEntry(provenance.policy_backend) ?? "portfolio-local",
      policy_version: normalizeStringEntry(provenance.policy_version) ?? "worker-admission-policy.v1"
    }
  });
  const contradictions = Array.isArray(normalizedRequest.evidence?.contradictions)
    ? cloneJson(normalizedRequest.evidence.contradictions)
    : [];
  const applyAggregateTotalLocThreshold = shouldApplyAggregateTotalLocThreshold(normalizedMetricSummary);
  const boundedExpectedChangeForLargeSingleFile = hasBoundedExpectedChangeForLargeSingleFile(
    normalizedMetricSummary,
    normalizedProfile.thresholds
  );

  const coreResult = evaluateWorkUnitAtomicityDecisionCore({
    schema_version: WORK_RECORD_ADMISSION_DECISION_LOCAL_SCHEMA_VERSION,
    decision_kind: WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_DECISION_KIND,
    policy_profile: normalizedProfile,
    metrics: {
      ...normalizedMetricSummary,
      unknown_metric_count: storedUnknownMetricCount
    },
    contradictions,
    target_plan_signal: storedTargetPlanSignal,
    missing_supporting_evidence: storedMissingSupportingEvidence,
    provenance,
    request: normalizedRequest,
    input_digest: normalizedInputDigest,
    mode: requestMode,
    apply_aggregate_total_loc_threshold: applyAggregateTotalLocThreshold,
    bounded_expected_change_for_large_single_file: boundedExpectedChangeForLargeSingleFile,
    policy_backend:
      normalizeStringEntry(provenance.policy_backend) ?? WORK_RECORD_ADMISSION_LOCAL_POLICY_BACKEND,
    policy_backend_version: WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_GENERATOR.version
  });

  const adjustedDecisionCodes = [...coreResult.decision_codes];
  const adjustedMatchedRules = [...coreResult.matched_rules];
  const adjustedReasons = [...coreResult.reasons];

  if (storedTargetPlanSignal && !adjustedDecisionCodes.includes(storedTargetPlanSignal.reason_code)) {
    adjustedMatchedRules.push(storedTargetPlanSignal.rule);
    adjustedReasons.push(storedTargetPlanSignal.reason);
    adjustedDecisionCodes.push(storedTargetPlanSignal.reason_code);
  }

  if (adjustedDecisionCodes.length === coreResult.decision_codes.length) {
    return projectCleanCarrierSuccessForStoredReplay(coreResult);
  }

  return projectCleanCarrierSuccessForStoredReplay({
    ...coreResult,
    decision_codes: sortAdmissionCodes(adjustedDecisionCodes),
    matched_rules: adjustedMatchedRules,
    reasons: adjustedReasons
  });
}

function assertSupportedDerivedEvidenceSchemaVersion(options) {
  const callerSchemaVersion = normalizeStringEntry(options.schema_version ?? options.schemaVersion);
  if (callerSchemaVersion && callerSchemaVersion !== WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_SCHEMA_VERSION) {
    throw new Error(
      `evaluateWorkRecordAdmissionDerivedEvidence: unsupported schema_version "${callerSchemaVersion}"; ` +
        `local entrypoint accepts only ${WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_SCHEMA_VERSION}`
    );
  }
}

export function evaluateWorkRecordAdmissionDerivedEvidence(value, options = {}) {
  assertSupportedDerivedEvidenceSchemaVersion(options);
  const normalized = normalizeStoredWorkRecordAdmissionDerivedEvidenceInput(value);
  return createWorkUnitAtomicityDecisionFromStoredDerivedEvidence({
    normalizedRequest: normalized.normalized_request,
    metricSummary: normalized.metric_summary,
    provenance: normalized.provenance,
    policyProfile: options.policy_profile ?? options.policyProfile ?? normalized.normalized_request.policy_profile,
    mode: options.mode ?? options.request_mode ?? normalized.normalized_request.context?.mode
  });
}

export {
  STORED_REPLAY_ABSENT_OPTIONAL_EVIDENCE_TO_METRIC_KEYS,
  STORED_REPLAY_REQUIRED_METRIC_KEYS,
  STORED_REPLAY_REQUIRED_PROVENANCE_KEYS,
  assertSupportedDerivedEvidenceSchemaVersion,
  collectStoredReplayOptionalAbsentMetricKeys,
  countStoredReplayInvalidEvidenceIssues,
  countStoredReplayUnknownMetrics,
  createWorkUnitAtomicityDecisionFromStoredDerivedEvidence,
  hasCoordinationOnlyStoredReplayLocExclusion,
  hasResolvedStoredReplayTargetEvidence,
  normalizeStoredMissingSupportingEvidence,
  normalizeStoredReplayStructuralTargetMetrics,
  normalizeStoredWorkRecordAdmissionDerivedEvidenceInput,
  normalizeStoredWorkUnitAtomicityMetricSummary,
  projectCleanCarrierSuccessForStoredReplay,
  removeCarrierSuccessMarkersForCoordinationOnlyReplay,
  storedReplayHasDeterministicCoreEvidence
};
