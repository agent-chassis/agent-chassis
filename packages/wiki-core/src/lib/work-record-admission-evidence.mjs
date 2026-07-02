import {
  classifyFileStatThresholdRole,
  classifyNonNegativeInteger,
  isNonEmptyString,
  isObject,
  normalizeControlledVocabularyEntries,
  normalizeStringEntry,
  sortStrings,
  toNonNegativeInteger,
  uniqueBy
} from "./work-record-admission-shared.mjs";
import {
  WORK_UNIT_ATOMICITY_FILE_STATES,
  WORK_UNIT_ATOMICITY_FILE_STATS_ISSUE_CODES,
  WORK_UNIT_ATOMICITY_METRIC_SOURCE_PROVENANCE_ISSUE_CODES
} from "./work-record-admission-decision-codes.mjs";

export function normalizeFileStats(values) {
  const entries = [];
  const invalidEntries = [];
  const missingFileStateEntries = [];
  const invalidFileStateEntries = [];
  for (const value of Array.isArray(values) ? values : []) {
    const entryIndex = entries.length;
    const fieldPath = `file_stats[${entryIndex}]`;
    if (!isObject(value)) {
      const issue = {
        field_path: fieldPath,
        reason_code: WORK_UNIT_ATOMICITY_FILE_STATS_ISSUE_CODES.invalid_entry,
        reason: "file_stats entries must be objects",
        status: "invalid",
        raw_value: value
      };
      invalidEntries.push(issue);
      entries.push({
        status: "invalid",
        evidence: {
          entry_status: "invalid",
          field_path: fieldPath,
          reason_code: issue.reason_code,
          reason: issue.reason,
          raw_value: value
        }
      });
      continue;
    }
    const entryPath = normalizeStringEntry(value.path ?? value.target ?? value.name);
    const thresholdRole = classifyFileStatThresholdRole({ path: entryPath });
    const rawExistingFile = value.existing_file ?? value.exists ?? value.is_existing;
    const rawDirectoryValue = value.is_directory ?? value.directory;
    const rawFileState = value.file_state ?? value.state;
    const hasExistingFileEvidence = rawExistingFile !== undefined && rawExistingFile !== null;
    const hasDirectoryEvidence = rawDirectoryValue !== undefined && rawDirectoryValue !== null;
    const hasFileStateEvidence = rawFileState !== undefined && rawFileState !== null;
    const existingFileValue = typeof rawExistingFile === "boolean" ? rawExistingFile : null;
    const directoryValue = typeof rawDirectoryValue === "boolean" ? rawDirectoryValue : null;
    const normalizedFileState = normalizeStringEntry(rawFileState)?.toLowerCase() ?? null;
    const inferredFileState =
      existingFileValue === true && directoryValue === false
        ? "existing_file"
        : existingFileValue === false && directoryValue === true
          ? "directory"
          : existingFileValue === false && directoryValue === false
            ? "new_file"
            : null;
    const fileStateValue = normalizedFileState
      ? WORK_UNIT_ATOMICITY_FILE_STATES.has(normalizedFileState)
        ? normalizedFileState
        : null
      : inferredFileState;
    const rawLoc = value.loc ?? value.line_count ?? value.lines;
    const rawLocMissing = rawLoc === undefined || rawLoc === null || rawLoc === "";
    const loc =
      rawLocMissing && fileStateValue === "new_file" && existingFileValue === false && directoryValue === false
        ? { value: 0, status: "valid" }
        : classifyNonNegativeInteger(rawLoc);
    if (!hasExistingFileEvidence) {
      missingFileStateEntries.push({
        field_path: `${fieldPath}.existing_file`,
        reason_code: WORK_UNIT_ATOMICITY_FILE_STATS_ISSUE_CODES.missing_existing_file,
        reason: "file_stats entry must declare existing_file",
        status: "missing"
      });
    } else if (existingFileValue === null) {
      invalidFileStateEntries.push({
        field_path: `${fieldPath}.existing_file`,
        reason_code: WORK_UNIT_ATOMICITY_FILE_STATS_ISSUE_CODES.invalid_existing_file,
        reason: "file_stats entry existing_file must be a boolean",
        status: "invalid",
        raw_value: rawExistingFile
      });
    }
    if (!hasDirectoryEvidence) {
      missingFileStateEntries.push({
        field_path: `${fieldPath}.is_directory`,
        reason_code: WORK_UNIT_ATOMICITY_FILE_STATS_ISSUE_CODES.missing_is_directory,
        reason: "file_stats entry must declare is_directory",
        status: "missing"
      });
    } else if (directoryValue === null) {
      invalidFileStateEntries.push({
        field_path: `${fieldPath}.is_directory`,
        reason_code: WORK_UNIT_ATOMICITY_FILE_STATS_ISSUE_CODES.invalid_is_directory,
        reason: "file_stats entry is_directory must be a boolean",
        status: "invalid",
        raw_value: rawDirectoryValue
      });
    }
    if (hasFileStateEvidence && fileStateValue === null) {
      invalidFileStateEntries.push({
        field_path: `${fieldPath}.file_state`,
        reason_code: WORK_UNIT_ATOMICITY_FILE_STATS_ISSUE_CODES.invalid_file_state,
        reason: "file_stats entry file_state must be existing_file, new_file, or directory",
        status: "invalid",
        raw_value: rawFileState
      });
    }
    entries.push({
      ...(entryPath ? { path: entryPath } : {}),
      ...(loc.value !== null ? { loc: loc.value } : {}),
      existing_file: existingFileValue,
      is_directory: directoryValue,
      ...(fileStateValue ? { file_state: fileStateValue } : {}),
      threshold_role: thresholdRole,
      threshold_effect: thresholdRole === "coordination_record" ? "coordination_only" : "threshold_counted",
      evidence: {
        entry_status: "valid",
        loc: loc.status,
        raw_loc: rawLoc ?? null,
        existing_file: !hasExistingFileEvidence ? "missing" : existingFileValue === null ? "invalid" : "valid",
        is_directory: !hasDirectoryEvidence ? "missing" : directoryValue === null ? "invalid" : "valid",
        file_state: hasFileStateEvidence ? (fileStateValue === null ? "invalid" : "valid") : inferredFileState ? "inferred" : "missing",
        raw_existing_file: hasExistingFileEvidence ? rawExistingFile : null,
        raw_is_directory: hasDirectoryEvidence ? rawDirectoryValue : null,
        raw_file_state: hasFileStateEvidence ? rawFileState : null,
        field_path: fieldPath
      },
      ...(isNonEmptyString(value.kind) ? { kind: String(value.kind).trim() } : {}),
      ...(isNonEmptyString(value.source) ? { source: String(value.source).trim() } : {}),
      ...(isNonEmptyString(value.reason) ? { reason: String(value.reason).trim() } : {})
    });
  }
  return {
    entries,
    invalidEntries,
    missingFileStateEntries,
    invalidFileStateEntries
  };
}

export function normalizeValidationCommandMetadata(values) {
  const entries = [];
  for (const value of Array.isArray(values) ? values : []) {
    if (isNonEmptyString(value)) {
      entries.push({ command: String(value).trim(), form: "shell" });
      continue;
    }
    if (!isObject(value)) {
      continue;
    }
    const command = normalizeStringEntry(value.command ?? value.claim ?? value.text ?? value.value);
    const form = normalizeStringEntry(value.form ?? value.kind ?? value.command_form) ?? "shell";
    if (!command) {
      continue;
    }
    entries.push({
      command,
      form,
      ...(isNonEmptyString(value.kind) ? { kind: String(value.kind).trim() } : {}),
      ...(isNonEmptyString(value.source) ? { source: String(value.source).trim() } : {}),
      ...(isNonEmptyString(value.reason) ? { reason: String(value.reason).trim() } : {})
    });
  }
  return entries;
}

export function normalizeRuntimeModeMetadata(values) {
  return normalizeControlledVocabularyEntries(
    values,
    new Set(["local", "advisory", "enforced"]),
    ["mode", "runtime_mode", "value"],
    "runtime_mode"
  );
}

export function normalizeArtifactKindMetadata(values) {
  return normalizeControlledVocabularyEntries(
    values,
    new Set([
      "docs",
      "wiki",
      "code",
      "test",
      "generated_projection",
      "report",
      "config",
      "other"
    ]),
    ["kind", "artifact_kind", "value"],
    "artifact_kind"
  );
}

export function normalizeMetricSourceProvenance(value, normalizedInputDigest) {
  const provenance = isObject(value) ? value : {};
  const normalized = {
    source_kind: normalizeStringEntry(provenance.source_kind),
    canonicality: normalizeStringEntry(provenance.canonicality),
    evidence_basis: normalizeStringEntry(provenance.evidence_basis),
    normalized_input_digest: normalizedInputDigest,
    policy_backend: normalizeStringEntry(provenance.policy_backend),
    policy_version: normalizeStringEntry(provenance.policy_version)
  };
  const missingFieldSpecs = [
    [
      "source_kind",
      WORK_UNIT_ATOMICITY_METRIC_SOURCE_PROVENANCE_ISSUE_CODES.source_kind_missing,
      "metric_source_provenance.source_kind is required"
    ],
    [
      "canonicality",
      WORK_UNIT_ATOMICITY_METRIC_SOURCE_PROVENANCE_ISSUE_CODES.canonicality_missing,
      "metric_source_provenance.canonicality is required"
    ],
    [
      "evidence_basis",
      WORK_UNIT_ATOMICITY_METRIC_SOURCE_PROVENANCE_ISSUE_CODES.evidence_basis_missing,
      "metric_source_provenance.evidence_basis is required"
    ],
    [
      "policy_backend",
      WORK_UNIT_ATOMICITY_METRIC_SOURCE_PROVENANCE_ISSUE_CODES.policy_backend_missing,
      "metric_source_provenance.policy_backend is required"
    ],
    [
      "policy_version",
      WORK_UNIT_ATOMICITY_METRIC_SOURCE_PROVENANCE_ISSUE_CODES.policy_version_missing,
      "metric_source_provenance.policy_version is required"
    ]
  ];
  const missingFieldEntries = missingFieldSpecs.flatMap(([fieldName, reasonCode, reason]) => {
    const normalizedValue = normalized[fieldName];
    if (isNonEmptyString(normalizedValue)) {
      return [];
    }
    return [
      {
        field_path: `metric_source_provenance.${fieldName}`,
        reason_code: reasonCode,
        reason,
        status: "missing",
        raw_value: provenance[fieldName] ?? null
      }
    ];
  });

  return {
    provenance: normalized,
    issues:
      missingFieldEntries.length > 0
        ? {
            missing_field_count: missingFieldEntries.length,
            missing_field_entries: missingFieldEntries
          }
        : null
  };
}

export function collectFileStatMetrics(fileStats) {
  const allEntries = Array.isArray(fileStats) ? fileStats : [];
  const validEntries = allEntries.filter((entry) => entry.evidence?.entry_status !== "invalid");
  const thresholdCountedEntries = validEntries.filter(
    (entry) => classifyFileStatThresholdRole(entry) !== "coordination_record"
  );
  const count = thresholdCountedEntries.length;
  const existingFileEvidence = validEntries.some((entry) => entry.evidence?.existing_file === "valid");
  const directoryEvidence = validEntries.some((entry) => entry.evidence?.is_directory === "valid");
  const missingOrInvalidLocEntries = validEntries.filter((entry) => entry.evidence?.loc !== "valid");
  const invalidEntries = allEntries
    .filter((entry) => entry.evidence?.entry_status === "invalid")
    .map((entry) => ({
      field_path: entry.evidence?.field_path ?? null,
      reason_code: entry.evidence?.reason_code ?? WORK_UNIT_ATOMICITY_FILE_STATS_ISSUE_CODES.invalid_entry,
      reason: entry.evidence?.reason ?? "file_stats entries must be objects",
      status: "invalid",
      raw_value: entry.evidence?.raw_value ?? null
    }));
  const missingFileStateEntries = validEntries.flatMap((entry) => {
    const issueEntries = [];
    if (entry.evidence?.existing_file === "missing") {
      issueEntries.push({
        field_path: `${entry.evidence?.field_path ?? "file_stats"}.existing_file`,
        reason_code: WORK_UNIT_ATOMICITY_FILE_STATS_ISSUE_CODES.missing_existing_file,
        reason: "file_stats entry must declare existing_file",
        status: "missing"
      });
    }
    if (entry.evidence?.is_directory === "missing") {
      issueEntries.push({
        field_path: `${entry.evidence?.field_path ?? "file_stats"}.is_directory`,
        reason_code: WORK_UNIT_ATOMICITY_FILE_STATS_ISSUE_CODES.missing_is_directory,
        reason: "file_stats entry must declare is_directory",
        status: "missing"
      });
    }
    return issueEntries;
  });
  const invalidFileStateEntries = validEntries.flatMap((entry) => {
    const issueEntries = [];
    if (entry.evidence?.existing_file === "invalid") {
      issueEntries.push({
        field_path: `${entry.evidence?.field_path ?? "file_stats"}.existing_file`,
        reason_code: WORK_UNIT_ATOMICITY_FILE_STATS_ISSUE_CODES.invalid_existing_file,
        reason: "file_stats entry existing_file must be a boolean",
        status: "invalid",
        raw_value: entry.evidence?.raw_existing_file ?? null
      });
    }
    if (entry.evidence?.is_directory === "invalid") {
      issueEntries.push({
        field_path: `${entry.evidence?.field_path ?? "file_stats"}.is_directory`,
        reason_code: WORK_UNIT_ATOMICITY_FILE_STATS_ISSUE_CODES.invalid_is_directory,
        reason: "file_stats entry is_directory must be a boolean",
        status: "invalid",
        raw_value: entry.evidence?.raw_is_directory ?? null
      });
    }
    if (entry.evidence?.file_state === "invalid") {
      issueEntries.push({
        field_path: `${entry.evidence?.field_path ?? "file_stats"}.file_state`,
        reason_code: WORK_UNIT_ATOMICITY_FILE_STATS_ISSUE_CODES.invalid_file_state,
        reason: "file_stats entry file_state must be existing_file, new_file, or directory",
        status: "invalid",
        raw_value: entry.evidence?.raw_file_state ?? null
      });
    }
    return issueEntries;
  });
  const existingFileCount = uniqueBy(
    thresholdCountedEntries.filter((entry) => entry.evidence?.existing_file === "valid" && entry.existing_file === true),
    (entry) => entry.path ?? JSON.stringify(entry)
  ).length;
  const directoryCount = uniqueBy(
    thresholdCountedEntries.filter((entry) => entry.evidence?.is_directory === "valid" && entry.is_directory === true),
    (entry) => entry.path ?? JSON.stringify(entry)
  ).length;
  const coordinationOnlyPaths = sortStrings(
    validEntries
      .filter((entry) => classifyFileStatThresholdRole(entry) === "coordination_record")
      .map((entry) => entry.path)
  );
  const locValues = thresholdCountedEntries
    .filter((entry) => entry.evidence?.loc === "valid")
    .map((entry) => toNonNegativeInteger(entry.loc))
    .filter((value) => value !== null);

  const thresholdCountedLocFileCount = thresholdCountedEntries.filter(
    (entry) => entry.evidence?.loc === "valid" && entry.existing_file === true
  ).length;

  return {
    write_scope_count: validEntries.length > 0 ? count : null,
    write_scope_existing_file_count: existingFileEvidence ? existingFileCount : null,
    write_scope_directory_count: directoryEvidence ? directoryCount : null,
    write_scope_total_loc: locValues.length > 0 ? locValues.reduce((sum, value) => sum + value, 0) : null,
    max_write_file_loc: locValues.length > 0 ? locValues.reduce((max, value) => Math.max(max, value), 0) : null,
    threshold_exclusions: {
      coordination_only_paths: coordinationOnlyPaths,
      coordination_only_file_count: coordinationOnlyPaths.length,
      threshold_counted_loc_file_count: thresholdCountedLocFileCount,
      reason_code: "worker_admission.work_unit_atomicity.coordination_record_loc_threshold_excluded.v1",
      reason: "coordination work-record JSON files remain in file_stats evidence but are excluded from LOC threshold metrics"
    },
    loc_issue_count: missingOrInvalidLocEntries.length,
    invalid_count: invalidEntries.length,
    missing_file_state_count: missingFileStateEntries.length,
    invalid_file_state_count: invalidFileStateEntries.length,
    invalid_entries: invalidEntries,
    missing_file_state_entries: missingFileStateEntries,
    invalid_file_state_entries: invalidFileStateEntries,
    missing_or_invalid_loc_entries: missingOrInvalidLocEntries.map((entry) => ({
      ...(isNonEmptyString(entry.path) ? { path: entry.path } : {}),
      ...(isNonEmptyString(entry.source) ? { source: entry.source } : {}),
      ...(isNonEmptyString(entry.kind) ? { kind: entry.kind } : {}),
      ...(isNonEmptyString(entry.reason) ? { reason: entry.reason } : {}),
      loc_status: entry.evidence?.loc ?? "missing",
      raw_loc: entry.evidence?.raw_loc ?? null
    }))
  };
}

function compareMetricEvidence({
  metric,
  suppliedValue,
  derivedValue,
  source,
  suppliedField,
  derivedField
}) {
  const supplied = toNonNegativeInteger(suppliedValue);
  const derived = toNonNegativeInteger(derivedValue);
  if (supplied === null || derived === null || supplied === derived) {
    return null;
  }

  return {
    metric,
    source,
    supplied_field: suppliedField,
    derived_field: derivedField,
    supplied_value: supplied,
    derived_value: derived,
    reason: `${suppliedField}=${supplied} contradicts ${derivedField}=${derived}`
  };
}

export function collectWorkUnitAtomicityContradictions({
  workUnitMetrics,
  fileStats,
  validationCommandMetadata,
  runtimeModeMetadata,
  artifactKindMetadata
}) {
  const derivedFileStats = collectFileStatMetrics(fileStats);
  const derivedRuntimeModeCount = Array.isArray(runtimeModeMetadata?.values)
    ? runtimeModeMetadata.values.length
    : 0;
  const derivedArtifactKindCount = Array.isArray(artifactKindMetadata?.values)
    ? artifactKindMetadata.values.length
    : 0;
  const contradictions = [
    compareMetricEvidence({
      metric: "write_scope_count",
      suppliedValue: workUnitMetrics.write_scope_count,
      derivedValue: derivedFileStats.write_scope_count,
      source: "file_stats",
      suppliedField: "work_unit_metrics.write_scope_count",
      derivedField: "file_stats.write_scope_count"
    }),
    compareMetricEvidence({
      metric: "write_scope_existing_file_count",
      suppliedValue: workUnitMetrics.write_scope_existing_file_count,
      derivedValue: derivedFileStats.write_scope_existing_file_count,
      source: "file_stats",
      suppliedField: "work_unit_metrics.write_scope_existing_file_count",
      derivedField: "file_stats.write_scope_existing_file_count"
    }),
    compareMetricEvidence({
      metric: "write_scope_directory_count",
      suppliedValue: workUnitMetrics.write_scope_directory_count,
      derivedValue: derivedFileStats.write_scope_directory_count,
      source: "file_stats",
      suppliedField: "work_unit_metrics.write_scope_directory_count",
      derivedField: "file_stats.write_scope_directory_count"
    }),
    compareMetricEvidence({
      metric: "write_scope_total_loc",
      suppliedValue: workUnitMetrics.write_scope_total_loc,
      derivedValue: derivedFileStats.write_scope_total_loc,
      source: "file_stats",
      suppliedField: "work_unit_metrics.write_scope_total_loc",
      derivedField: "file_stats.total_loc"
    }),
    compareMetricEvidence({
      metric: "max_write_file_loc",
      suppliedValue: workUnitMetrics.max_write_file_loc,
      derivedValue: derivedFileStats.max_write_file_loc,
      source: "file_stats",
      suppliedField: "work_unit_metrics.max_write_file_loc",
      derivedField: "file_stats.max_write_file_loc"
    }),
    compareMetricEvidence({
      metric: "validation_command_count",
      suppliedValue: workUnitMetrics.validation_command_count,
      derivedValue: Array.isArray(validationCommandMetadata) ? validationCommandMetadata.length : null,
      source: "validation_command_metadata",
      suppliedField: "work_unit_metrics.validation_command_count",
      derivedField: "validation_command_metadata.count"
    }),
    compareMetricEvidence({
      metric: "declared_runtime_mode_count",
      suppliedValue: workUnitMetrics.declared_runtime_mode_count,
      derivedValue: derivedRuntimeModeCount,
      source: "runtime_mode_metadata",
      suppliedField: "work_unit_metrics.declared_runtime_mode_count",
      derivedField: "runtime_mode_metadata.distinct_count"
    }),
    compareMetricEvidence({
      metric: "artifact_kind_count",
      suppliedValue: workUnitMetrics.artifact_kind_count,
      derivedValue: derivedArtifactKindCount,
      source: "artifact_kind_metadata",
      suppliedField: "work_unit_metrics.artifact_kind_count",
      derivedField: "artifact_kind_metadata.distinct_count"
    })
  ].filter(Boolean);

  return contradictions;
}

const VALID_ARTIFACT_ROLES = new Set([
  "work_unit_record",
  "work_unit_derived_evidence",
  "preparation_audit",
  "pack_manifest",
  "request_payload",
  "conformance_fixture"
]);

const VALID_REF_KINDS = new Set([
  "local_file",
  "uri",
  "wiki_record",
  "api_response",
  "manifest_bundle",
  "manual_input"
]);

const VALID_ACTOR_KINDS = new Set([
  "sdk-core-preflight",
  "sdk-plugin",
  "consumer-wrapper",
  "consumer-adapter"
]);

export function normalizeArtifactRefs(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.map((entry) => {
    if (!isObject(entry)) {
      return null;
    }
    const refId = normalizeStringEntry(entry.ref_id);
    const artifactRole = normalizeStringEntry(entry.artifact_role);
    const refKind = normalizeStringEntry(entry.ref_kind);
    const ref = normalizeStringEntry(entry.ref);
    if (!refId || !artifactRole || !refKind || !ref) {
      return null;
    }
    if (!VALID_ARTIFACT_ROLES.has(artifactRole) || !VALID_REF_KINDS.has(refKind)) {
      return null;
    }
    return {
      ref_id: refId,
      artifact_role: artifactRole,
      ref_kind: refKind,
      ref,
      digest: normalizeStringEntry(entry.digest) ?? "not_applicable",
      observed_at: normalizeStringEntry(entry.observed_at) ?? "not_applicable",
      produced_by_preparation_audit_id: normalizeStringEntry(entry.produced_by_preparation_audit_id) ?? "not_applicable",
      produced_by_preparation_output_hash: normalizeStringEntry(entry.produced_by_preparation_output_hash) ?? "not_applicable"
    };
  }).filter(Boolean);
}

export function normalizePreparationAuditRefs(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.map((entry) => {
    if (!isObject(entry)) {
      return null;
    }
    const auditId = normalizeStringEntry(entry.audit_id);
    const ref = normalizeStringEntry(entry.ref);
    const digest = normalizeStringEntry(entry.digest);
    const actorKind = normalizeStringEntry(entry.actor_kind);
    const outputHash = normalizeStringEntry(entry.output_hash);
    const preparedRefIds = Array.isArray(entry.prepared_artifact_ref_ids)
      ? entry.prepared_artifact_ref_ids.filter(isNonEmptyString).map((s) => String(s).trim())
      : [];
    if (!auditId || !ref || !digest || !actorKind || !outputHash || preparedRefIds.length === 0) {
      return null;
    }
    if (!VALID_ACTOR_KINDS.has(actorKind)) {
      return null;
    }
    return {
      audit_id: auditId,
      ref,
      digest,
      actor_kind: actorKind,
      output_hash: outputHash,
      prepared_artifact_ref_ids: preparedRefIds
    };
  }).filter(Boolean);
}
