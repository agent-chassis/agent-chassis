import {
  computeNormalizedInputDigest,
  isNonEmptyString,
  normalizeStringEntry,
  normalizeWorkUnitMetrics,
  toNonNegativeInteger
} from "./work-record-admission-shared.mjs";
import {
  WORK_UNIT_ATOMICITY_ABSENT_OPTIONAL_EVIDENCE_SPECS,
  WORK_UNIT_ATOMICITY_MISSING_SUPPORTING_EVIDENCE_SPECS
} from "./work-record-admission-decision-codes.mjs";
import {
  collectFileStatMetrics,
  collectWorkUnitAtomicityContradictions,
  normalizeArtifactKindMetadata,
  normalizeFileStats,
  normalizeMetricSourceProvenance,
  normalizeRuntimeModeMetadata,
  normalizeValidationCommandMetadata
} from "./work-record-admission-evidence.mjs";
import {
  detectMissingTargetPlanReviewSignal,
  evaluateWorkUnitAtomicityDecisionCore,
  normalizeStructuralTargetMetricsInput,
  normalizeWorkUnitAtomicityProfile
} from "./work-record-admission-policy.mjs";

function toNonNegativeFiniteNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }
  return numeric;
}

function bindNonTruncatedExpectedChangedLineBudget(normalizedWorkUnitMetrics, rawWorkUnitMetrics) {
  const nonTruncatedBudget = toNonNegativeFiniteNumber(rawWorkUnitMetrics?.expected_changed_line_budget);
  if (nonTruncatedBudget === null) {
    return normalizedWorkUnitMetrics;
  }
  return {
    ...normalizedWorkUnitMetrics,
    expected_changed_line_budget: nonTruncatedBudget
  };
}

export function resolveDispatchReadinessRecordId(dispatchReadiness) {
  if (isNonEmptyString(dispatchReadiness?.record_id)) {
    return String(dispatchReadiness.record_id).trim();
  }
  if (isNonEmptyString(dispatchReadiness?.unit?.record_id)) {
    return String(dispatchReadiness.unit.record_id).trim();
  }
  return "unknown";
}

export function resolveWorkUnitAtomicitySubjectAddress(dispatchReadiness) {
  const explicitAddress = normalizeStringEntry(dispatchReadiness?.unit?.address);
  if (explicitAddress) {
    return explicitAddress;
  }

  const recordId = resolveDispatchReadinessRecordId(dispatchReadiness);
  const sliceId = normalizeStringEntry(dispatchReadiness?.unit?.slice_id);
  if (recordId !== "unknown" && sliceId) {
    return `${recordId}#${sliceId}`;
  }

  return recordId;
}

export function shouldApplyAggregateTotalLocThreshold(metrics) {

  void metrics;
  return false;
}

export function hasBoundedExpectedChangeForLargeSingleFile(metrics, thresholds, fileStats) {

  void metrics;
  void thresholds;
  void fileStats;
  return false;
}

function collectMissingMetricFlags(metrics, sources, thresholdExclusions) {
  const hasDeterministicCoreEvidence =
    Array.isArray(sources.file_stats) &&
    sources.file_stats.length > 0 &&
    Array.isArray(sources.validation_command_metadata) &&
    sources.validation_command_metadata.length > 0;

  const coordinationOnlyFileCount = toNonNegativeInteger(
    thresholdExclusions?.coordination_only_file_count
  );
  const allEligibleFilesAreCoordinationOnly =
    Array.isArray(sources.file_stats) &&
    sources.file_stats.length > 0 &&
    coordinationOnlyFileCount !== null &&
    coordinationOnlyFileCount > 0 &&
    coordinationOnlyFileCount === sources.file_stats.length;
  const missingMetricFlags = {
    write_scope_count: metrics.write_scope_count === null,
    write_scope_existing_file_count: metrics.write_scope_existing_file_count === null,
    write_scope_directory_count: metrics.write_scope_directory_count === null,
    write_scope_total_loc:
      metrics.write_scope_total_loc === null && !allEligibleFilesAreCoordinationOnly,
    max_write_file_loc:
      metrics.max_write_file_loc === null && !allEligibleFilesAreCoordinationOnly,
    acceptance_criteria_count: metrics.acceptance_criteria_count === null,
    validation_command_count: metrics.validation_command_count === null,
    declared_runtime_mode_count: !hasDeterministicCoreEvidence && metrics.declared_runtime_mode_count === null,
    artifact_kind_count: !hasDeterministicCoreEvidence && metrics.artifact_kind_count === null,
    expected_changed_line_budget: !hasDeterministicCoreEvidence && metrics.expected_changed_line_budget === null
  };

  const missingMetricCount = Object.values(missingMetricFlags).filter(Boolean).length;
  const missingEvidence = {
    file_stats: !Array.isArray(sources.file_stats) || sources.file_stats.length === 0,
    validation_command_metadata:
      !Array.isArray(sources.validation_command_metadata) || sources.validation_command_metadata.length === 0,
    runtime_mode_metadata:
      !hasDeterministicCoreEvidence &&
      (!Array.isArray(sources.runtime_mode_metadata) || sources.runtime_mode_metadata.length === 0),
    artifact_kind_metadata:
      !hasDeterministicCoreEvidence &&
      (!Array.isArray(sources.artifact_kind_metadata) || sources.artifact_kind_metadata.length === 0)
  };

  const missingSupportingEvidence = {};
  for (const spec of WORK_UNIT_ATOMICITY_MISSING_SUPPORTING_EVIDENCE_SPECS) {
    if (missingEvidence[spec.key]) {
      missingSupportingEvidence[spec.key] = {
        field_path: spec.field_path,
        reason_code: spec.reason_code,
        reason: spec.reason,
        status: "missing"
      };
    }
  }

  const absentOptionalEvidence = {};
  if (hasDeterministicCoreEvidence) {
    for (const spec of WORK_UNIT_ATOMICITY_ABSENT_OPTIONAL_EVIDENCE_SPECS) {
      if (!Array.isArray(sources[spec.key]) || sources[spec.key].length === 0) {
        absentOptionalEvidence[spec.key] = {
          field_path: spec.field_path,
          reason_code: spec.reason_code,
          reason: spec.reason,
          status: "absent_optional"
        };
      }
    }
  }

  return {
    missingMetricFlags,
    missingEvidence,
    missingSupportingEvidence,
    absentOptionalEvidence,
    absentOptionalEvidenceCount: Object.keys(absentOptionalEvidence).length,
    missingSupportingEvidenceCount: Object.keys(missingSupportingEvidence).length,
    missingMetricCount
  };
}

function projectCleanCarrierFactsRecordedResult(result) {
  if (
    result?.decision !== undefined ||
    result?.decision_code !== undefined ||
    result?.effect !== undefined
  ) {
    return result;
  }

  const decisionCodes = Array.isArray(result?.decision_codes) ? result.decision_codes : [];
  if (decisionCodes.length > 0) {
    return result;
  }

  const matchedRules = Array.isArray(result?.matched_rules) ? result.matched_rules : [];
  const reasons = Array.isArray(result?.reasons) ? result.reasons : [];
  if (
    !matchedRules.includes("carrier_facts_recorded_no_local_admissibility_judgment") &&
    !reasons.includes("carrier facts are structurally complete for Node Engine evaluation")
  ) {
    return result;
  }

  return {
    ...result,
    decision: "allow",
    allowed: true,
    effect: "allows_carrier_fact_forwarding_without_local_admissibility_judgment"
  };
}

function deriveWorkUnitAtomicityMetrics({
  workUnitMetrics,
  fileStats,
  validationCommandMetadata,
  runtimeModeMetadata,
  artifactKindMetadata,
  metricSourceProvenanceIssues
}) {
  const derivedFileStats = collectFileStatMetrics(fileStats);
  const runtimeModes = new Set(runtimeModeMetadata.values);
  const artifactKinds = new Set(artifactKindMetadata.values);
  const locIssueCount = toNonNegativeInteger(derivedFileStats.loc_issue_count) ?? 0;
  const invalidFileStatsCount = toNonNegativeInteger(derivedFileStats.invalid_count) ?? 0;
  const missingFileStateCount = toNonNegativeInteger(derivedFileStats.missing_file_state_count) ?? 0;
  const invalidFileStateCount = toNonNegativeInteger(derivedFileStats.invalid_file_state_count) ?? 0;
  const runtimeModeIssueCount = toNonNegativeInteger(runtimeModeMetadata.invalidCount) ?? 0;
  const artifactKindIssueCount = toNonNegativeInteger(artifactKindMetadata.invalidCount) ?? 0;
  const metricSourceProvenanceIssueCount = toNonNegativeInteger(metricSourceProvenanceIssues?.missing_field_count) ?? 0;

  const metrics = {
    write_scope_count:
      workUnitMetrics.write_scope_count ?? (Array.isArray(fileStats) && fileStats.length > 0 ? derivedFileStats.write_scope_count : null),
    write_scope_existing_file_count:
      workUnitMetrics.write_scope_existing_file_count ??
      (Array.isArray(fileStats) && fileStats.length > 0 ? derivedFileStats.write_scope_existing_file_count : null),
    write_scope_directory_count:
      workUnitMetrics.write_scope_directory_count ??
      (Array.isArray(fileStats) && fileStats.length > 0 ? derivedFileStats.write_scope_directory_count : null),
    write_scope_total_loc:
      workUnitMetrics.write_scope_total_loc ??
      (Array.isArray(fileStats) && fileStats.length > 0 ? derivedFileStats.write_scope_total_loc : null),
    max_write_file_loc:
      workUnitMetrics.max_write_file_loc ??
      (Array.isArray(fileStats) && fileStats.length > 0 ? derivedFileStats.max_write_file_loc : null),
    acceptance_criteria_count: workUnitMetrics.acceptance_criteria_count ?? null,
    validation_command_count:
      workUnitMetrics.validation_command_count ??
      (validationCommandMetadata.length > 0 ? validationCommandMetadata.length : null),
    declared_runtime_mode_count:
      workUnitMetrics.declared_runtime_mode_count ??
      (runtimeModes.size > 0 ? runtimeModes.size : null),
    artifact_kind_count: workUnitMetrics.artifact_kind_count ?? (artifactKinds.size > 0 ? artifactKinds.size : null),
    expected_changed_line_budget: workUnitMetrics.expected_changed_line_budget ?? null,
    unknown_metric_count: workUnitMetrics.unknown_metric_count ?? null
  };

  const missing = collectMissingMetricFlags(
    metrics,
    {
      file_stats: fileStats,
      validation_command_metadata: validationCommandMetadata,
      runtime_mode_metadata: runtimeModeMetadata.values,
      artifact_kind_metadata: artifactKindMetadata.values
    },
    derivedFileStats.threshold_exclusions
  );

  const unknownMetricCount = Math.max(
    toNonNegativeInteger(metrics.unknown_metric_count) ?? 0,
    missing.missingMetricCount +
      missing.missingSupportingEvidenceCount +
      invalidFileStatsCount +
      missingFileStateCount +
      invalidFileStateCount +
      locIssueCount +
      runtimeModeIssueCount +
      artifactKindIssueCount
  ) + metricSourceProvenanceIssueCount;

  return {
    metrics: {
      ...metrics,
      unknown_metric_count: unknownMetricCount,
      threshold_exclusions: derivedFileStats.threshold_exclusions,
      missing_metrics: missing.missingMetricFlags,
      missing_evidence: missing.missingEvidence,
      missing_supporting_evidence: missing.missingSupportingEvidence,
      absent_optional_evidence: missing.absentOptionalEvidence,
      evidence_issues: {
        file_stats: {
          invalid_count: invalidFileStatsCount,
          invalid_entries: derivedFileStats.invalid_entries,
          missing_file_state_count: missingFileStateCount,
          missing_file_state_entries: derivedFileStats.missing_file_state_entries,
          invalid_file_state_count: invalidFileStateCount,
          invalid_file_state_entries: derivedFileStats.invalid_file_state_entries,
          loc_issue_count: locIssueCount,
          missing_or_invalid_loc_entries: derivedFileStats.missing_or_invalid_loc_entries
        },
        runtime_mode_metadata: {
          invalid_count: runtimeModeIssueCount,
          invalid_entries: runtimeModeMetadata.invalidEntries
        },
        artifact_kind_metadata: {
          invalid_count: artifactKindIssueCount,
          invalid_entries: artifactKindMetadata.invalidEntries
        },
        metric_source_provenance: metricSourceProvenanceIssueCount > 0 ? metricSourceProvenanceIssues : null
      }
    },
    missing
  };
}

export function createWorkUnitAtomicityDecision({
  dispatchReadiness,
  workUnitMetrics,
  fileStats,
  validationCommandMetadata,
  runtimeModeMetadata,
  artifactKindMetadata,
  metricSourceProvenance,
  structuralTargetMetrics,
  policyProfile,
  options = {}
}) {
  const normalizedWorkUnitMetrics = normalizeWorkUnitMetrics(workUnitMetrics);
  const normalizedFileStats = normalizeFileStats(fileStats);
  const normalizedValidationCommandMetadata = normalizeValidationCommandMetadata(validationCommandMetadata);
  const normalizedRuntimeModeMetadata = normalizeRuntimeModeMetadata(runtimeModeMetadata);
  const normalizedArtifactKindMetadata = normalizeArtifactKindMetadata(artifactKindMetadata);
  const normalizedStructuralTargetMetrics = normalizeStructuralTargetMetricsInput(structuralTargetMetrics);
  const normalizedProfile = normalizeWorkUnitAtomicityProfile(policyProfile ?? options.policy_profile ?? options.policyProfile);

  const digestBoundWorkUnitMetrics = bindNonTruncatedExpectedChangedLineBudget(
    normalizedWorkUnitMetrics,
    workUnitMetrics
  );
  const normalizedInputDigest = computeNormalizedInputDigest({
    subject: {
      kind: "work_unit",
      repo: normalizeStringEntry(options.repo ?? options.repository) ?? "agent-chassis/agent-chassis",
      unit: {
        record_id: dispatchReadiness.record_id ?? dispatchReadiness.unit?.record_id ?? null,
        slice_id: dispatchReadiness.unit?.slice_id ?? null,
        address: resolveWorkUnitAtomicitySubjectAddress(dispatchReadiness)
      }
    },
    work_unit_metrics: digestBoundWorkUnitMetrics,
    file_stats: normalizedFileStats.entries,
    validation_command_metadata: normalizedValidationCommandMetadata,
    runtime_mode_metadata: normalizedRuntimeModeMetadata.entries,
    artifact_kind_metadata: normalizedArtifactKindMetadata.entries,
    structural_target_metrics: normalizedStructuralTargetMetrics,
    context: {
      source_path: `wiki/work-records/${resolveDispatchReadinessRecordId(dispatchReadiness)}.json`,
      field_path: normalizeStringEntry(options.field_path ?? options.context?.field_path) ?? "work_unit_metrics",
      mode: normalizeStringEntry(options.mode ?? options.context?.mode) ?? "local",
      policy_version: normalizeStringEntry(options.policy_version ?? options.context?.policy_version) ?? "worker-admission-policy.v1"
    },
    policy_profile: normalizedProfile
  });
  const provenanceResult = normalizeMetricSourceProvenance(metricSourceProvenance, normalizedInputDigest);
  const provenance = provenanceResult.provenance;
  const contradictions = collectWorkUnitAtomicityContradictions({
    workUnitMetrics: normalizedWorkUnitMetrics,
    fileStats: normalizedFileStats.entries,
    validationCommandMetadata: normalizedValidationCommandMetadata,
    runtimeModeMetadata: normalizedRuntimeModeMetadata,
    artifactKindMetadata: normalizedArtifactKindMetadata
  });
  const normalizedSourceInputs = {
    subject: {
      kind: "work_unit",
      repo: normalizeStringEntry(options.repo ?? options.repository) ?? "agent-chassis/agent-chassis",
      unit: {
        record_id: dispatchReadiness.record_id ?? dispatchReadiness.unit?.record_id ?? null,
        slice_id: dispatchReadiness.unit?.slice_id ?? null,
        address: resolveWorkUnitAtomicitySubjectAddress(dispatchReadiness)
      }
    },
    work_unit_metrics: digestBoundWorkUnitMetrics,
    file_stats: normalizedFileStats.entries,
    validation_command_metadata: normalizedValidationCommandMetadata,
    runtime_mode_metadata: normalizedRuntimeModeMetadata.entries,
    artifact_kind_metadata: normalizedArtifactKindMetadata.entries,
    structural_target_metrics: normalizedStructuralTargetMetrics,
    context: {
      source_path: `wiki/work-records/${resolveDispatchReadinessRecordId(dispatchReadiness)}.json`,
      field_path: normalizeStringEntry(options.field_path ?? options.context?.field_path) ?? "work_unit_metrics",
      mode: normalizeStringEntry(options.mode ?? options.context?.mode) ?? "local",
      policy_version: normalizeStringEntry(options.policy_version ?? options.context?.policy_version) ?? "worker-admission-policy.v1"
    },
    policy_profile: normalizedProfile
  };
  const normalizedRequest = {
    schema_version: "worker-admission-request.v1",
    decision_kind: "work_unit_atomicity",
    subject: normalizedSourceInputs.subject,
    claim: null,
    work_unit_metrics: null,
    file_stats: normalizedFileStats.entries,
    validation_command_metadata: normalizedValidationCommandMetadata,
    runtime_mode_metadata: normalizedRuntimeModeMetadata.entries,
    artifact_kind_metadata: normalizedArtifactKindMetadata.entries,
    structural_target_metrics: normalizedStructuralTargetMetrics,
    context: normalizedSourceInputs.context,
    evidence: {
      metric_source_provenance: metricSourceProvenance,
      contradictions,
      policy_profile: normalizedProfile,
      source_inputs: normalizedSourceInputs,
      source_issues: null
    },
    policy_profile: normalizedProfile
  };

  normalizedRequest.evidence.metric_source_provenance = provenanceResult.provenance;

  const derivedMetrics = deriveWorkUnitAtomicityMetrics({
    workUnitMetrics: normalizedWorkUnitMetrics,
    fileStats: normalizedFileStats.entries,
    validationCommandMetadata: normalizedValidationCommandMetadata,
    runtimeModeMetadata: normalizedRuntimeModeMetadata,
    artifactKindMetadata: normalizedArtifactKindMetadata,
    metricSourceProvenanceIssues: provenanceResult.issues
  });
  const metrics = derivedMetrics.metrics;

  metrics.expected_changed_line_budget = toNonNegativeFiniteNumber(
    workUnitMetrics?.expected_changed_line_budget
  );
  metrics.structural_target_metrics = normalizedStructuralTargetMetrics;
  normalizedRequest.work_unit_metrics = metrics;
  normalizedRequest.evidence.materialized_work_unit_metrics = metrics;
  normalizedRequest.evidence.structural_target_metrics = normalizedStructuralTargetMetrics;
  normalizedRequest.evidence.source_issues = {
    file_stats: {
      invalid_count: metrics.evidence_issues.file_stats.invalid_count,
      invalid_entries: metrics.evidence_issues.file_stats.invalid_entries,
      missing_file_state_count: metrics.evidence_issues.file_stats.missing_file_state_count,
      missing_file_state_entries: metrics.evidence_issues.file_stats.missing_file_state_entries,
      invalid_file_state_count: metrics.evidence_issues.file_stats.invalid_file_state_count,
      invalid_file_state_entries: metrics.evidence_issues.file_stats.invalid_file_state_entries,
      loc_issue_count: metrics.evidence_issues.file_stats.loc_issue_count,
      missing_or_invalid_loc_entries: metrics.evidence_issues.file_stats.missing_or_invalid_loc_entries
    },
    runtime_mode_metadata: {
      invalid_count: metrics.evidence_issues.runtime_mode_metadata.invalid_count,
      invalid_entries: metrics.evidence_issues.runtime_mode_metadata.invalid_entries
    },
    artifact_kind_metadata: {
      invalid_count: metrics.evidence_issues.artifact_kind_metadata.invalid_count,
      invalid_entries: metrics.evidence_issues.artifact_kind_metadata.invalid_entries
    },
    metric_source_provenance: metrics.evidence_issues.metric_source_provenance,
    missing_supporting_evidence: metrics.missing_supporting_evidence,
    absent_optional_evidence: metrics.absent_optional_evidence
  };
  const targetPlanSignal = detectMissingTargetPlanReviewSignal({
    structuralTargetMetrics: normalizedStructuralTargetMetrics,
    fileStats: normalizedFileStats.entries
  });

  return projectCleanCarrierFactsRecordedResult(evaluateWorkUnitAtomicityDecisionCore({
    metrics,
    contradictions,
    missing_supporting_evidence: metrics.missing_supporting_evidence,
    target_plan_signal: targetPlanSignal,
    provenance,
    request: normalizedRequest,
    input_digest: normalizedInputDigest,
    policy_profile: normalizedProfile,
    policy_backend: provenance.policy_backend,
    policy_backend_version: "0.2.0",
    mode: normalizedRequest.context.mode
  }));
}
