import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import {
  cloneJson,
  classifyFileStatThresholdRole,
  collectThresholdCountedFileStats,
  collectThresholdCountedLocValues,
  countUtf8Lines,
  isObject,
  isNonEmptyString,
  isTestWriteScopePath,
  normalizeDeclaredPathEntries,
  normalizeStringEntry,
  sortStrings,
  toNonNegativeInteger
} from "./work-record-admission-shared.mjs";
import {
  createWorkRecordGraphImpactSummary,
  WORK_RECORD_GRAPH_IMPACT_SUMMARY_KIND,
  WORK_RECORD_GRAPH_IMPACT_SUMMARY_SCHEMA_VERSION
} from "./work-record-graph-impact-summary.mjs";
import { computeWorkRecordSourceDigest } from "./work-record-schema.mjs";
import { normalizeStructuralTargetMetrics } from "./work-record-target-metrics.mjs";
import { loadWorkRecordById } from "./work-record-store.mjs";

function normalizeAuthoredExpectedChangedLineBudget(record) {
  const value = record?.expected_changed_line_budget;
  return Number.isInteger(value) && value >= 0 ? value : null;
}

const BOUNDED_EXTRACTION_REFACTOR_CHANGED_LINE_BUDGET_MAX = 200;
const BOUNDED_EXTRACTION_REFACTOR_OVERSIZED_SOURCE_LOC_MIN = 1201;
const BOUNDED_EXTRACTION_REFACTOR_INTENT_SCHEMA_VERSION =
  "bounded-large-file-extraction-refactor-intent.v1";

export const BOUNDED_EXTRACTION_REFACTOR_PREDICATE = Object.freeze({
  schema_version: BOUNDED_EXTRACTION_REFACTOR_INTENT_SCHEMA_VERSION,
  intent_kind: "bounded_large_file_extraction_refactor",
  expected_changed_line_budget: Object.freeze({
    min: 0,
    max: BOUNDED_EXTRACTION_REFACTOR_CHANGED_LINE_BUDGET_MAX
  }),
  oversized_source_loc_min: BOUNDED_EXTRACTION_REFACTOR_OVERSIZED_SOURCE_LOC_MIN,
  operation_counts: Object.freeze({
    modify: Object.freeze({ exactly: 1 }),
    create: Object.freeze({ min: 1 }),
    delete: Object.freeze({ exactly: 0 }),
    inspect: Object.freeze({ exactly: 0 })
  }),
  requires: Object.freeze({
    single_oversized_threshold_counted_source: true,
    all_new_destinations_verifiable: true,
    validation_covers_source_and_destinations: true
  })
});

function operationCountsSatisfyBoundedExtractionPredicate(operationCounts) {
  for (const [operation, rule] of Object.entries(
    BOUNDED_EXTRACTION_REFACTOR_PREDICATE.operation_counts
  )) {
    const count = Number.isInteger(operationCounts?.[operation]) ? operationCounts[operation] : 0;
    if (Number.isInteger(rule.exactly) && count !== rule.exactly) {
      return false;
    }
    if (Number.isInteger(rule.min) && count < rule.min) {
      return false;
    }
  }
  return true;
}

function changedLineBudgetSatisfiesBoundedExtractionPredicate(expectedChangedLineBudget) {
  const { min, max } = BOUNDED_EXTRACTION_REFACTOR_PREDICATE.expected_changed_line_budget;
  return (
    Number.isInteger(expectedChangedLineBudget) &&
    expectedChangedLineBudget >= min &&
    expectedChangedLineBudget <= max
  );
}

function isGraphImpactSummaryShape(value) {
  return (
    isObject(value) &&
    (value.kind === WORK_RECORD_GRAPH_IMPACT_SUMMARY_KIND ||
      value.schema_version === WORK_RECORD_GRAPH_IMPACT_SUMMARY_SCHEMA_VERSION ||
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

  const summaryFromRef = value.graphImpactSummaryRef?.summary;
  if (isObject(summaryFromRef)) {
    const normalizedSummaryFromRef = createWorkRecordGraphImpactSummary(summaryFromRef);
    if (normalizedSummaryFromRef) {
      return normalizedSummaryFromRef;
    }
  }

  const rawGraphImpact = isObject(value.graph_impact)
    ? value.graph_impact
    : isObject(value.graphImpact)
      ? value.graphImpact
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

  if (isGraphImpactSummaryShape(value.summary)) {
    return cloneJson(value);
  }

  const suppliedSummary = isGraphImpactSummaryShape(value.graph_impact_summary)
    ? value.graph_impact_summary
    : value.graph_impact_summary ?? value.summary;
  const normalizedSummary = isGraphImpactSummaryShape(suppliedSummary)
    ? cloneJson(suppliedSummary)
    : normalizeGraphImpactSummary(suppliedSummary);
  if (normalizedSummary) {
    return cloneJson({
      ...value,
      summary: normalizedSummary
    });
  }

  return cloneJson(value);
}

function collectDeclaredWritableFileEntries(record) {
  return normalizeDeclaredPathEntries(record?.writable_files ?? record?.writableFiles);
}

function normalizeLargeFileDecAuthorityRepoPath(value) {
  const normalized = normalizeStringEntry(value);
  if (!normalized) {
    return null;
  }

  const repoPath = normalized.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (
    repoPath.startsWith("/") ||
    repoPath.startsWith("~") ||
    repoPath === ".." ||
    repoPath.startsWith("../") ||
    repoPath.includes("/../") ||
    repoPath.endsWith("/..") ||
    repoPath.includes("/./")
  ) {
    return null;
  }

  return repoPath;
}

function normalizeLargeFileDecAuthorityUnit(value) {
  if (isNonEmptyString(value)) {
    const address = normalizeStringEntry(value);
    if (!address) {
      return null;
    }
    const parts = address.split("#");
    return {
      kind: parts.length > 1 ? "slice" : "work_item",
      address,
      record_id: parts[0] || null,
      slice_id: parts.length > 1 ? parts.slice(1).join("#") : null
    };
  }

  if (!isObject(value)) {
    return null;
  }

  const recordId = normalizeStringEntry(value.record_id ?? value.recordId);
  const sliceId = normalizeStringEntry(value.slice_id ?? value.sliceId);
  const address =
    normalizeStringEntry(value.address ?? value.work_unit_address ?? value.workUnitAddress) ??
    (recordId ? (sliceId ? `${recordId}#${sliceId}` : recordId) : null);
  const kind = normalizeStringEntry(value.kind)?.toLowerCase() ?? (sliceId ? "slice" : recordId ? "work_item" : null);

  if (!recordId && !sliceId && !address) {
    return null;
  }

  return {
    kind,
    address,
    record_id: recordId,
    slice_id: sliceId
  };
}

function normalizeLargeFileDecAuthorityPathList(value) {
  const rawPaths = Array.isArray(value) ? value : isNonEmptyString(value) ? [value] : [];
  return sortStrings(rawPaths.map(normalizeLargeFileDecAuthorityRepoPath).filter(Boolean));
}

function normalizeLargeFileDecAuthorityEntry(value) {
  if (!isObject(value)) {
    return null;
  }

  const scope = isObject(value.scope) ? value.scope : {};
  const unit =
    normalizeLargeFileDecAuthorityUnit(
      value.unit ?? value.selected_unit ?? value.selectedUnit ?? scope.unit ?? scope.selected_unit ?? scope.selectedUnit
    ) ??
    normalizeLargeFileDecAuthorityUnit(
      isNonEmptyString(value.record_id ?? value.recordId) || isNonEmptyString(value.slice_id ?? value.sliceId)
        ? value
        : null
    );
  const filePaths = normalizeLargeFileDecAuthorityPathList([
    value.file_path,
    value.filePath,
    value.path,
    value.target_path,
    value.targetPath,
    value.selected_path,
    value.selectedPath,
    ...(Array.isArray(value.file_paths) ? value.file_paths : []),
    ...(Array.isArray(value.paths) ? value.paths : []),
    scope.file_path,
    scope.filePath,
    scope.path,
    scope.target_path,
    scope.targetPath,
    ...(Array.isArray(scope.file_paths) ? scope.file_paths : []),
    ...(Array.isArray(scope.paths) ? scope.paths : []),
    ...(Array.isArray(scope.write_scope) ? scope.write_scope : [])
  ]);
  const status = normalizeStringEntry(value.status ?? value.decision_status ?? value.state)?.toLowerCase() ?? null;
  const authorityRef =
    normalizeStringEntry(value.authority_ref ?? value.authorityRef ?? value.dec_ref ?? value.decRef ?? value.id) ?? null;
  const expiresAt =
    normalizeStringEntry(value.expires_at ?? value.expiresAt ?? scope.expires_at ?? scope.expiresAt) ?? null;
  const maxWriteFileLoc = toNonNegativeInteger(
    value.max_write_file_loc ?? value.maxWriteFileLoc ?? scope.max_write_file_loc ?? scope.maxWriteFileLoc
  );
  const largeFileThreshold = toNonNegativeInteger(
    value.large_file_threshold ?? value.largeFileThreshold ?? value.threshold ?? scope.large_file_threshold ?? scope.threshold
  );
  const permittedOperationShape =
    normalizeStringEntry(
      value.permitted_operation_shape ??
        value.operation_shape ??
        value.operation ??
        scope.permitted_operation_shape ??
        scope.operation_shape ??
        scope.operation
    ) ?? null;

  if (
    !unit &&
    filePaths.length === 0 &&
    !status &&
    !authorityRef &&
    !expiresAt &&
    maxWriteFileLoc === null &&
    largeFileThreshold === null &&
    !permittedOperationShape
  ) {
    return null;
  }

  return {
    status,
    authority_ref: authorityRef,
    expires_at: expiresAt,
    unit,
    file_paths: filePaths,
    max_write_file_loc: maxWriteFileLoc,
    large_file_threshold: largeFileThreshold,
    permitted_operation_shape: permittedOperationShape
  };
}

function normalizeLargeFileDecAuthorityEntries(value) {
  const rawEntries = Array.isArray(value)
    ? value
    : isObject(value) && Array.isArray(value.authorities)
      ? value.authorities
      : isObject(value)
        ? [value]
        : [];
  return rawEntries.map((entry) => normalizeLargeFileDecAuthorityEntry(entry)).filter(Boolean);
}

function collectDeclaredLargeFileDecAuthorityEntries(record) {
  const rawEntries = [];
  const candidateValues = [
    record?.large_file_dec_authority,
    record?.largeFileDecAuthority,
    record?.large_file_dec_authorities,
    record?.largeFileDecAuthorities,
    record?.acceptance?.large_file_dec_authority,
    record?.acceptance?.largeFileDecAuthority,
    record?.acceptance?.large_file_dec_authorities,
    record?.acceptance?.largeFileDecAuthorities
  ];

  for (const candidate of candidateValues) {
    if (Array.isArray(candidate)) {
      rawEntries.push(...candidate);
      continue;
    }
    if (isObject(candidate) && Array.isArray(candidate.authorities)) {
      rawEntries.push(...candidate.authorities);
      continue;
    }
    if (isObject(candidate)) {
      rawEntries.push(candidate);
    }
  }

  return normalizeLargeFileDecAuthorityEntries(rawEntries);
}

async function collectRecordWriteScopeFileStats(writeScopeEntries, targetDir, writableFilesEntries = []) {
  const entries = [];
  const rootDir = path.resolve(String(targetDir || "."));
  const writableFilePaths = new Set(normalizeDeclaredPathEntries(writableFilesEntries));

  for (const declaredPath of normalizeDeclaredPathEntries(writeScopeEntries)) {
    const absolutePath = path.resolve(rootDir, declaredPath);
    const relativePath = path.relative(rootDir, absolutePath);
    if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      entries.push({
        path: declaredPath,
        existing_file: null,
        is_directory: null,
        reason: "write_scope path escapes the repository root",
        source: "canonical_record"
      });
      continue;
    }

    try {
      const stats = await lstat(absolutePath);
      if (stats.isDirectory()) {
        if (writableFilePaths.has(declaredPath)) {
          entries.push({
            path: declaredPath,
            loc: 0,
            existing_file: false,
            is_directory: false,
            file_state: "new_file",
            reason: "write_scope explicit writable file entry",
            source: "canonical_record"
          });
          continue;
        }
        entries.push({
          path: declaredPath,
          existing_file: false,
          is_directory: true,
          reason: "write_scope directory entry",
          source: "canonical_record"
        });
        continue;
      }
      if (!stats.isFile()) {
        entries.push({
          path: declaredPath,
          existing_file: null,
          is_directory: null,
          reason: "write_scope path is not a regular file or directory",
          source: "canonical_record"
        });
        continue;
      }

      const text = await readFile(absolutePath, "utf8");
      const thresholdRole = classifyFileStatThresholdRole({ path: declaredPath });
      entries.push({
        path: declaredPath,
        loc: countUtf8Lines(text),
        existing_file: true,
        is_directory: false,
        threshold_role: thresholdRole,
        threshold_effect: thresholdRole === "coordination_record" ? "coordination_only" : "threshold_counted",
        reason: "write_scope file entry",
        source: "canonical_record",

        source_text: text
      });
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
        entries.push({
          path: declaredPath,
          loc: 0,
          existing_file: false,
          is_directory: false,
          file_state: "new_file",
          reason: "write_scope new file entry",
          source: "canonical_record"
        });
        continue;
      }
      entries.push({
        path: declaredPath,
        existing_file: null,
        is_directory: null,
        reason: "write_scope path state could not be read",
        source: "canonical_record"
      });
    }
  }

  return entries;
}

function normalizeRepoPathKey(value) {
  const normalized = normalizeStringEntry(value);
  return normalized ? normalized.replaceAll("\\", "/").replace(/^\.\//u, "") : null;
}

async function resolveEffectiveExpectedEditTargets(record, targetDir) {
  const ownTargets = Array.isArray(record?.expected_edit_targets) ? record.expected_edit_targets : [];
  if (ownTargets.length > 0) {
    return ownTargets;
  }
  if (record?.kind !== "slice" || !isNonEmptyString(record?.id)) {
    return ownTargets;
  }
  const loadedParent = await loadWorkRecordById({ dir: targetDir, id: record.id.trim() });
  if (isObject(loadedParent.record) && Array.isArray(loadedParent.record.expected_edit_targets)) {
    return loadedParent.record.expected_edit_targets;
  }
  return ownTargets;
}

async function collectExpectedEditTargetSourceTexts(expectedEditTargets, targetDir, fileStats) {
  const sourceTexts = {};
  for (const entry of Array.isArray(fileStats) ? fileStats : []) {
    if (!isObject(entry) || typeof entry.source_text !== "string") {
      continue;
    }
    const key = normalizeRepoPathKey(entry.path);
    if (key) {
      sourceTexts[key] = entry.source_text;
    }
  }

  const rootDir = path.resolve(String(targetDir || "."));
  for (const target of Array.isArray(expectedEditTargets) ? expectedEditTargets : []) {
    const repoPath = isObject(target) ? normalizeRepoPathKey(target.path) : null;
    if (!repoPath || Object.prototype.hasOwnProperty.call(sourceTexts, repoPath)) {
      continue;
    }
    const absolutePath = path.resolve(rootDir, repoPath);
    const relativePath = path.relative(rootDir, absolutePath);
    if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      continue;
    }
    try {
      const stats = await lstat(absolutePath);
      if (!stats.isFile()) {
        continue;
      }
      sourceTexts[repoPath] = await readFile(absolutePath, "utf8");
    } catch {

    }
  }

  return sourceTexts;
}

function stripFileStatSourceText(fileStats) {
  return (Array.isArray(fileStats) ? fileStats : []).map((entry) => {
    if (!isObject(entry) || !Object.prototype.hasOwnProperty.call(entry, "source_text")) {
      return entry;
    }
    const { source_text: _omitted, ...rest } = entry;
    return rest;
  });
}

function normalizeExpectedEditTargetEntry(value) {
  if (!isObject(value)) {
    return null;
  }

  const repoPath = normalizeRepoPathKey(value.path);
  const kind = normalizeStringEntry(value.kind);
  const operation = normalizeStringEntry(value.operation)?.toLowerCase() ?? null;
  if (!repoPath || !kind || !normalizeStringEntry(value.name) || !["create", "modify", "delete", "inspect"].includes(operation)) {
    return null;
  }

  return { path: repoPath, kind, operation };
}

function normalizeValidationCoverageToken(value) {
  if (!isNonEmptyString(value)) {
    return null;
  }
  return String(value)
    .replaceAll("\\", "/")
    .replace(/^['"]|['"]$/gu, "")
    .replace(/^\.\//u, "")
    .replace(/[,:;]+$/u, "");
}

function validationCoversRepoPath(validationCommands, repoPath) {
  const normalizedRepoPath = normalizeValidationCoverageToken(repoPath);
  if (!normalizedRepoPath) {
    return false;
  }
  return validationCommands.some((command) => {
    if (!isNonEmptyString(command)) {
      return false;
    }
    for (const match of String(command).replaceAll("\\", "/").matchAll(/"([^"]*)"|'([^']*)'|[^\s]+/gu)) {
      if (normalizeValidationCoverageToken(match[1] ?? match[2] ?? match[0]) === normalizedRepoPath) {
        return true;
      }
    }
    return false;
  });
}

function isExistingOversizedThresholdCountedFile(entry) {
  return (
    isObject(entry) &&
    entry.existing_file === true &&
    entry.is_directory === false &&
    entry.threshold_effect !== "coordination_only" &&
    Number.isInteger(entry.loc) &&
    entry.loc >= BOUNDED_EXTRACTION_REFACTOR_PREDICATE.oversized_source_loc_min
  );
}

function isVerifiableNewDestinationFile(entry) {
  return (
    isObject(entry) &&
    entry.existing_file === false &&
    entry.is_directory === false &&
    Number.isInteger(entry.loc)
  );
}

function collectBoundedExtractionTargets(targets, fileStats) {
  const fileStatsByPath = new Map();
  for (const entry of Array.isArray(fileStats) ? fileStats : []) {
    const repoPath = isObject(entry) ? normalizeRepoPathKey(entry.path) : null;
    if (repoPath && !fileStatsByPath.has(repoPath)) {
      fileStatsByPath.set(repoPath, entry);
    }
  }

  return {
    createTargets: targets.filter((target) => target.operation === "create"),
    modifyTargets: targets.filter((target) => target.operation === "modify"),
    sourceCount: targets.filter((target) => isExistingOversizedThresholdCountedFile(fileStatsByPath.get(target.path))).length,
    destinationsVerifiable: targets
      .filter((target) => target.operation === "create")
      .every((target) => isVerifiableNewDestinationFile(fileStatsByPath.get(target.path)))
  };
}

export function evaluateBoundedExtractionRefactorPredicate({
  expectedEditTargets,
  expectedChangedLineBudget,
  fileStats,
  validationCommands
}) {
  if (
    !Array.isArray(expectedEditTargets) ||
    expectedEditTargets.length === 0 ||
    !changedLineBudgetSatisfiesBoundedExtractionPredicate(expectedChangedLineBudget) ||
    !Array.isArray(validationCommands) ||
    validationCommands.length === 0
  ) {
    return { satisfied: false };
  }

  const targets = expectedEditTargets.map(normalizeExpectedEditTargetEntry);
  if (targets.some((target) => !target)) {
    return { satisfied: false };
  }

  const operationCounts = {
    create: 0,
    modify: 0,
    delete: 0,
    inspect: 0
  };
  for (const target of targets) {
    operationCounts[target.operation] += 1;
  }
  if (!operationCountsSatisfyBoundedExtractionPredicate(operationCounts)) {
    return { satisfied: false };
  }

  const { createTargets, modifyTargets, sourceCount, destinationsVerifiable } = collectBoundedExtractionTargets(
    targets,
    fileStats
  );
  if (sourceCount !== 1 || !destinationsVerifiable) {
    return { satisfied: false };
  }

  if (![...modifyTargets, ...createTargets].every((target) => validationCoversRepoPath(validationCommands, target.path))) {
    return { satisfied: false };
  }

  return {
    satisfied: true,
    operation_counts: operationCounts,
    verifiable_new_target_count: createTargets.length
  };
}

function createBoundedLargeFileExtractionRefactorIntent(inputs) {
  const evaluation = evaluateBoundedExtractionRefactorPredicate(inputs);
  if (!evaluation.satisfied) {
    return null;
  }

  return {
    schema_version: BOUNDED_EXTRACTION_REFACTOR_PREDICATE.schema_version,
    intent_kind: BOUNDED_EXTRACTION_REFACTOR_PREDICATE.intent_kind,
    evidence_basis: "structured_work_record_facts",
    expected_changed_line_budget: inputs.expectedChangedLineBudget,
    operation_counts: evaluation.operation_counts,
    source: {
      existing_oversized_threshold_counted_target_count: 1,
      operation: "modify"
    },
    destinations: {
      verifiable_new_target_count: evaluation.verifiable_new_target_count,
      operation: "create"
    },
    validation_coverage: {
      source_target_covered: true,
      destination_targets_covered: true
    }
  };
}

function normalizeRecordSelectedUnit(record) {
  if (!isObject(record) || typeof record.id !== "string" || !record.id.trim()) {
    return null;
  }

  const recordId = record.id.trim();
  const sliceId = typeof record.slice_id === "string" && record.slice_id.trim() ? record.slice_id.trim() : null;
  if (record.kind === "slice" || sliceId) {
    if (!sliceId) {
      return null;
    }

    return {
      kind: "slice",
      address: `${recordId}#${sliceId}`,
      record_id: recordId,
      slice_id: sliceId
    };
  }

  return {
    kind: "work_item",
    address: recordId,
    record_id: recordId,
    slice_id: null
  };
}

function createRecordLocalTargetMetricSourceProvenance(record, selectedUnit, sourceRecordDigest) {
  return {
    source_kind: "canonical_work_record",
    canonicality: "canonical",
    evidence_basis: "normalized_target_projection",
    policy_backend: "portfolio-local",
    policy_version: "worker-admission-policy.v1",
    selected_unit: selectedUnit,
    source_record_digest: sourceRecordDigest,
    producer: {
      id: "portfolio-local.target-function-resolver",
      version: "0.1.0",
      mode: "local"
    }
  };
}

async function resolveRecordSourceDigest(record, dir) {
  if (!isObject(record)) {
    return null;
  }

  if (record.kind !== "slice") {
    return computeWorkRecordSourceDigest(record);
  }

  if (typeof record.id !== "string" || !record.id.trim()) {
    return computeWorkRecordSourceDigest(record);
  }

  const loadedParent = await loadWorkRecordById({
    dir,
    id: record.id.trim()
  });
  if (isObject(loadedParent.record)) {
    return loadedParent.source_digest || computeWorkRecordSourceDigest(loadedParent.record);
  }

  return computeWorkRecordSourceDigest(record);
}

export async function createWorkRecordAdmissionRecordLocalInputs({
  dir = ".",
  record,

  sourceRecordDigestOverride = null
} = {}) {
  if (!isObject(record)) {
    throw new Error("createWorkRecordAdmissionRecordLocalInputs requires record");
  }

  const writableFiles = collectDeclaredWritableFileEntries(record);
  const fileStatsWithSource = await collectRecordWriteScopeFileStats(record.write_scope, dir, writableFiles);

  const effectiveExpectedEditTargets = await resolveEffectiveExpectedEditTargets(record, dir);
  const expectedEditTargetSourceTexts = await collectExpectedEditTargetSourceTexts(
    effectiveExpectedEditTargets,
    dir,
    fileStatsWithSource
  );
  const fileStats = stripFileStatSourceText(fileStatsWithSource);
  const acceptance = isObject(record.acceptance) ? record.acceptance : {};
  const validationCommands = Array.isArray(acceptance.validation) ? acceptance.validation : [];
  const runtimeModeMetadata = [];
  const artifactKindMetadata = [];
  const sourceRecordDigest = isNonEmptyString(sourceRecordDigestOverride)
    ? sourceRecordDigestOverride
    : await resolveRecordSourceDigest(record, dir);
  const selectedUnit = normalizeRecordSelectedUnit(record);
  const targetResolutionEvidence = isObject(record.target_resolution_evidence) ? record.target_resolution_evidence : null;
  const metricSourceProvenance = isObject(targetResolutionEvidence?.metric_source_provenance)
    ? targetResolutionEvidence.metric_source_provenance
      : createRecordLocalTargetMetricSourceProvenance(record, selectedUnit, sourceRecordDigest);
  const thresholdCountedFileStats = collectThresholdCountedFileStats(fileStats);

  const thresholdCountedTestFileStats = thresholdCountedFileStats.filter((entry) =>
    isTestWriteScopePath(entry.path)
  );
  const thresholdCountedCodeFileCount =
    thresholdCountedFileStats.length - thresholdCountedTestFileStats.length;
  const thresholdCountedLocValues = collectThresholdCountedLocValues(fileStats);
  const expectedChangedLineBudget = normalizeAuthoredExpectedChangedLineBudget(record);
  const graphImpactSummary = normalizeGraphImpactSummary({
    graph_impact: record.graph_impact ?? record.graphImpact ?? null,
    graphImpact: record.graphImpact ?? record.graph_impact ?? null,
    graph_impact_summary: record.graph_impact_summary ?? record.graphImpactSummary ?? null,
    graphImpactSummary: record.graphImpactSummary ?? record.graph_impact_summary ?? null,
    summary: record.summary ?? null,
    graphImpactSummaryRef: record.graphImpactSummaryRef ?? record.graph_impact_summary_ref ?? null
  });
  const graphImpactSummaryRef = normalizeGraphImpactSummaryRef(
    record.graph_impact_summary_ref ?? record.graphImpactSummaryRef ?? null
  );
  const largeFileDecAuthority = collectDeclaredLargeFileDecAuthorityEntries(record);
  const structuralTargetMetrics = normalizeStructuralTargetMetrics({
    expected_edit_targets: Array.isArray(record.expected_edit_targets)
      ? record.expected_edit_targets
      : undefined,
    target_resolution_evidence: targetResolutionEvidence ?? undefined,
    metric_source_provenance: metricSourceProvenance,
    unit: selectedUnit ?? undefined,
    source_record_digest: sourceRecordDigest,
    write_scope: Array.isArray(record.write_scope) ? record.write_scope : []
  });
  const boundedLargeFileExtractionRefactorIntent = createBoundedLargeFileExtractionRefactorIntent({
    expectedEditTargets: effectiveExpectedEditTargets,
    expectedChangedLineBudget,
    fileStats,
    validationCommands
  });
  const metricSourceProvenanceForContext = cloneJson(structuralTargetMetrics.metric_source_provenance);
  if (isObject(metricSourceProvenanceForContext)) {
    delete metricSourceProvenanceForContext.normalized_input_digest;
  }

  return {
    source_record_digest: sourceRecordDigest,
    selected_unit: selectedUnit,
    work_unit_metrics: {
      write_scope_count: thresholdCountedCodeFileCount,
      write_scope_test_count: thresholdCountedTestFileStats.length,
      write_scope_existing_file_count: thresholdCountedFileStats.filter((entry) => entry.existing_file === true).length,
      write_scope_directory_count: thresholdCountedFileStats.filter((entry) => entry.is_directory === true).length,
      write_scope_total_loc:
        thresholdCountedLocValues.length > 0
          ? thresholdCountedLocValues.reduce((sum, value) => sum + value, 0)
          : null,
      max_write_file_loc:
        thresholdCountedLocValues.length > 0
          ? thresholdCountedLocValues.reduce((max, value) => Math.max(max, value), 0)
          : null,
      acceptance_criteria_count: Array.isArray(acceptance.criteria) ? acceptance.criteria.length : null,
      validation_command_count: validationCommands.length,
      declared_runtime_mode_count: null,
      artifact_kind_count: null,
      expected_changed_line_budget: expectedChangedLineBudget,
      unknown_metric_count: 0
    },
    file_stats: fileStats,
    validation_command_metadata: validationCommands,
    runtime_mode_metadata: runtimeModeMetadata,
    artifact_kind_metadata: artifactKindMetadata,
    graph_impact_summary: graphImpactSummary,
    ...(graphImpactSummaryRef ? { graph_impact_summary_ref: graphImpactSummaryRef } : {}),
    large_file_dec_authority: largeFileDecAuthority,
    structural_target_metrics: structuralTargetMetrics,
    ...(boundedLargeFileExtractionRefactorIntent
      ? { bounded_large_file_extraction_refactor_intent: boundedLargeFileExtractionRefactorIntent }
      : {}),
    metric_source_provenance: metricSourceProvenanceForContext,

    effective_expected_edit_targets: effectiveExpectedEditTargets,
    expected_edit_target_source_texts: expectedEditTargetSourceTexts
  };
}
