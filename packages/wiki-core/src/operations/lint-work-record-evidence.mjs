import path from "node:path";
import {
  WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_GENERATOR,
  WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_SCHEMA_VERSION
} from "../lib/work-record-admission.mjs";
import {
  buildWorkRecordDuplicateClaimsIndex,
  getWorkRecordDirectory,
  listWorkRecordJsonPaths,
  loadWorkRecordByPath
} from "../lib/work-record-store.mjs";
import {
  isMigrationReviewAcknowledged,
  validateWorkerAdmissionDerivedEvidence
} from "../lib/work-record-schema.mjs";
import {
  isObject,
  isString,
  normalizeDiagnosticPath
} from "./lint-shared.mjs";

const CANONICAL_WORK_RECORD_BASENAME_PATTERN = /^WK-\d{4}\.json$/;

function isCanonicalWorkRecordPath(filePath, workRecordDir) {
  return (
    path.dirname(filePath) === workRecordDir &&
    CANONICAL_WORK_RECORD_BASENAME_PATTERN.test(path.basename(filePath))
  );
}

export async function loadWorkRecordJsonValues(
  targetDir,
  addFinding,
  structuredRefreshRouteAvailable = false
) {
  const jsonFiles = await listWorkRecordJsonPaths(targetDir);
  const workRecordDir = getWorkRecordDirectory(targetDir);
  const duplicateClaimsIndex = await buildWorkRecordDuplicateClaimsIndex({ dir: targetDir });
  const values = [];
  const recordsById = new Map();

  for (const filePath of jsonFiles) {

    if (!isCanonicalWorkRecordPath(filePath, workRecordDir)) {
      continue;
    }

    const relativePath = path.relative(targetDir, filePath).replaceAll(path.sep, "/");
    const loaded = await loadWorkRecordByPath({
      dir: targetDir,
      path: filePath,
      duplicateClaimsIndex
    });

    for (const diagnostic of loaded.diagnostics) {
      if (isWorkerAdmissionDerivedEvidenceDiagnosticPath(diagnostic.path)) {
        continue;
      }
      addFinding(diagnostic.severity, diagnostic.message, {
        code: diagnostic.code,
        path: normalizeDiagnosticPath(targetDir, diagnostic.path) || relativePath
      });
    }

    if (!loaded.record) {
      continue;
    }

    if (!loaded.record_id || loaded.record_id !== path.basename(filePath, ".json")) {
      continue;
    }

    if (loaded.record && loaded.record.migration && !isMigrationReviewAcknowledged(loaded.record.migration)) {
      addFinding(
        "warning",
        `${relativePath}: migrated work record is review-pending; review the JSON and record migration.review_acknowledgement before dispatch`,
        {
          code: "migration_review_required",
          path: relativePath,
          migration_review_state: loaded.record.migration.review_state ?? null
        }
      );
    }

    const issue = getWorkerAdmissionDerivedEvidenceLintIssue(loaded.record);
    if (issue) {
      const refreshGuidance = buildWorkerAdmissionDerivedEvidenceRefreshGuidance({
        unitAddress: issue.unitAddress || loaded.record_id,
        structuredRefreshRouteAvailable
      });
      addFinding(
        "warning",
        `${relativePath}: ${issue.message}; ${refreshGuidance.message}`,
        {
          code: refreshGuidance.code || issue.code,
          path: relativePath,
          record_id: loaded.record_id,
          refresh_route: refreshGuidance.refresh_route,
          refresh_command: refreshGuidance.refresh_command,
          ...issue.details
        }
      );
    }

    const match = String(loaded.record_id).match(/^WK-(\d{4})$/);
    if (match) {
      values.push(Number.parseInt(match[1], 10));
    }
    if (!recordsById.has(loaded.record_id)) {
      recordsById.set(loaded.record_id, loaded);
    }
  }

  return {
    values: values.sort((left, right) => left - right),
    recordsById
  };
}

function isWorkerAdmissionDerivedEvidenceEntry(entry) {
  return isObject(entry) && entry.decision_kind === "work_unit_atomicity";
}

function getWorkerAdmissionDerivedEvidenceUnitAddress(entry) {
  return isObject(entry?.unit) && isString(entry.unit.address) ? entry.unit.address : null;
}

function buildWorkerAdmissionDerivedEvidenceRefreshCommand(unitAddress) {
  return `npm run wiki -- work-records refresh-admission-metrics --id ${unitAddress}`;
}

function buildWorkerAdmissionDerivedEvidenceRefreshGuidance({
  unitAddress,
  structuredRefreshRouteAvailable
}) {
  const refreshRoute = "workspace_work_record_refresh_admission_metrics";
  const refreshCommand = buildWorkerAdmissionDerivedEvidenceRefreshCommand(unitAddress);

  if (structuredRefreshRouteAvailable) {
    return {
      code: null,
      message: `use structured MCP route \`${refreshRoute}\` to refresh this unit; human/operator fallback only: \`${refreshCommand}\``,
      refresh_route: refreshRoute,
      refresh_command: refreshCommand
    };
  }

  return {
    code: "missing_structured_metric_refresh_route",
    message: `structured MCP route \`${refreshRoute}\` is unavailable; human/operator fallback only: \`${refreshCommand}\``,
    refresh_route: refreshRoute,
    refresh_command: refreshCommand
  };
}

export function isWorkerAdmissionDerivedEvidenceDiagnosticPath(diagnosticPath) {
  const normalizedPath = String(diagnosticPath || "");
  return normalizedPath === "derived_evidence" || normalizedPath.startsWith("derived_evidence[");
}

function getWorkerAdmissionDerivedEvidenceLintIssue(record) {
  if (!Array.isArray(record?.derived_evidence)) {
    return null;
  }

  for (let index = 0; index < record.derived_evidence.length; index += 1) {
    const entry = record.derived_evidence[index];
    if (!isWorkerAdmissionDerivedEvidenceEntry(entry)) {
      continue;
    }

    const malformedIssue = getWorkerAdmissionDerivedEvidenceMalformedIssue(record, entry, index);
    if (malformedIssue) {
      return malformedIssue;
    }

    if (isString(entry.schema_version) && entry.schema_version !== WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_SCHEMA_VERSION) {
      return {
        code: "outdated_worker_admission_derived_evidence",
        message: "worker-admission derived evidence schema version is outdated",
        unitAddress: getWorkerAdmissionDerivedEvidenceUnitAddress(entry),
        details: {
          derived_evidence_index: index,
          derived_evidence_schema_version: entry.schema_version
        }
      };
    }

    if (
      isObject(entry.generator) &&
      isString(entry.generator.version) &&
      entry.generator.version !== WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_GENERATOR.version
    ) {
      return {
        code: "outdated_worker_admission_derived_evidence",
        message: "worker-admission derived evidence generator version is outdated",
        unitAddress: getWorkerAdmissionDerivedEvidenceUnitAddress(entry),
        details: {
          derived_evidence_index: index,
          derived_evidence_generator_version: entry.generator.version
        }
      };
    }

  }

  return null;
}

function getWorkerAdmissionDerivedEvidenceMalformedIssue(record, entry, index) {
  const diagnostics = validateWorkerAdmissionDerivedEvidence(entry, {
    path: `derived_evidence[${index}]`,
    recordId: isString(record?.id) ? record.id : null,
    recordRepo: isString(record?.repo) ? record.repo : null,
    expectedUnit: isObject(entry) ? entry.unit : null
  });

  if (diagnostics.length === 0) {
    return null;
  }

  return {
    code: "malformed_worker_admission_derived_evidence",
    message: "worker-admission derived evidence is malformed",
    unitAddress: getWorkerAdmissionDerivedEvidenceUnitAddress(entry),
    details: { derived_evidence_index: index }
  };
}
