import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";

import { loadWorkRecordById, getWorkRecordPath } from "./work-record-store.mjs";
import { validateWorkReport } from "./work-record-schema.mjs";

export const WORK_REPORT_INGESTION_DECISION_CODES = Object.freeze([
  "ingested",
  "ingested_with_follow_ups",
  "requires_orchestrator_review",
  "blocked_validation_failed",
  "blocked_out_of_scope_paths",
  "blocked_report_unit_mismatch",
  "blocked_invalid_role",
  "blocked_invalid_report",
  "blocked_missing_canonical_record"
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function normalizeRepoPath(value) {
  return String(value || "")
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+$/, "");
}

function parseUnitAddress(unitAddress) {
  if (!isNonEmptyString(unitAddress)) {
    return { ok: false, value: null };
  }

  const pieces = String(unitAddress).split("#");
  if (pieces.length > 2 || !/^WK-[0-9]{4}$/.test(pieces[0])) {
    return { ok: false, value: null };
  }

  if (pieces.length === 1) {
    return {
      ok: true,
      value: {
        kind: "work_item",
        address: pieces[0],
        record_id: pieces[0],
        slice_id: null
      }
    };
  }

  if (!/^[a-z0-9][a-z0-9-]*$/.test(pieces[1])) {
    return { ok: false, value: null };
  }

  return {
    ok: true,
    value: {
      kind: "slice",
      address: unitAddress,
      record_id: pieces[0],
      slice_id: pieces[1]
    }
  };
}

function buildUnitAddress(report) {
  if (!isObject(report) || !isNonEmptyString(report.record_id)) {
    return null;
  }
  return report.slice_id ? `${report.record_id}#${report.slice_id}` : report.record_id;
}

function createInvalidResult({
  unitAddress,
  report,
  decisionCode,
  diagnostics,
  reason
}) {
  return {
    valid: false,
    decision_code: decisionCode,
    unit_address: unitAddress ?? buildUnitAddress(report) ?? null,
    record_id: isObject(report) && isNonEmptyString(report.record_id) ? report.record_id : null,
    slice_id:
      isObject(report) && (report.slice_id === null || isNonEmptyString(report.slice_id))
        ? report.slice_id
        : null,
    reasons: reason ? [reason] : [],
    diagnostics: clone(diagnostics || []),
    canonical_record_path: null,
    written: false,
    record: null,
    report: isObject(report) ? clone(report) : null
  };
}

function pathWithinScope(candidatePath, scopeEntries) {
  const candidate = normalizeRepoPath(candidatePath);
  if (!candidate) {
    return false;
  }

  for (const rawScopeEntry of Array.isArray(scopeEntries) ? scopeEntries : []) {
    const scopeEntry = normalizeRepoPath(rawScopeEntry);
    if (!scopeEntry) {
      continue;
    }
    if (candidate === scopeEntry || candidate.startsWith(`${scopeEntry}/`)) {
      return true;
    }
  }

  return false;
}

function isInScopeFollowUp(repoRef, recordId) {
  if (!isNonEmptyString(repoRef)) {
    return false;
  }

  const localRef = repoRef.includes(":") ? repoRef.split(":").at(-1) : repoRef;
  return localRef === recordId || localRef.startsWith(`${recordId}#`);
}

function summarizeValidation(validationEntries) {
  return (Array.isArray(validationEntries) ? validationEntries : []).map((entry) => {
    const reason = isNonEmptyString(entry.reason) ? ` (${entry.reason})` : "";
    return `${entry.command}: ${entry.status}${reason}`;
  });
}

function summarizeFollowUps(followUps) {
  return (Array.isArray(followUps) ? followUps : []).map((entry) =>
    isNonEmptyString(entry.repo_ref) ? `${entry.title} -> ${entry.repo_ref}` : entry.title
  );
}

function createStoredResult({
  unit,
  decisionCode,
  report,
  outOfScopePaths,
  followUpsOutsideScope,
  now
}) {
  return {
    unit_address: unit.address,
    decision_code: decisionCode,
    recorded_at: now,
    report: clone(report),
    out_of_scope_changed_paths: clone(outOfScopePaths),
    follow_ups_outside_scope: clone(followUpsOutsideScope)
  };
}

function chooseDecisionCode({
  invalidReport,
  invalidRole,
  missingCanonicalRecord,
  unitMismatch,
  outOfScopePaths,
  validationStatuses,
  reportStatus,
  blockers,
  followUps
}) {
  if (missingCanonicalRecord) {
    return "blocked_missing_canonical_record";
  }
  if (invalidRole) {
    return "blocked_invalid_role";
  }
  if (invalidReport) {
    return "blocked_invalid_report";
  }
  if (unitMismatch) {
    return "blocked_report_unit_mismatch";
  }
  if (outOfScopePaths.length > 0) {
    return "blocked_out_of_scope_paths";
  }
  if (validationStatuses.includes("failed") || reportStatus === "failed") {
    return "blocked_validation_failed";
  }
  if (
    validationStatuses.includes("skipped") ||
    validationStatuses.includes("not_run") ||
    reportStatus === "partial" ||
    reportStatus === "blocked" ||
    blockers.some((entry) => entry.kind === "authority_violation")
  ) {
    return "requires_orchestrator_review";
  }
  if (followUps.length > 0) {
    return "ingested_with_follow_ups";
  }
  return "ingested";
}

async function loadReportInput({ report, reportPath }) {
  if (reportPath) {
    const text = await readFile(reportPath, "utf8");
    return JSON.parse(text);
  }
  return report;
}

export async function ingestWorkReport({
  dir = ".",
  unitAddress = null,
  report = null,
  reportPath = null,
  now = new Date().toISOString()
} = {}) {
  const targetDir = path.resolve(String(dir));

  let loadedReport;
  try {
    loadedReport = await loadReportInput({
      report,
      reportPath: reportPath ? path.resolve(targetDir, String(reportPath)) : null
    });
  } catch (error) {
    return createInvalidResult({
      unitAddress,
      report,
      decisionCode: "blocked_invalid_report",
      diagnostics: [
        {
          code: "invalid_record",
          severity: "error",
          path: "report",
          message: error instanceof Error ? error.message : String(error)
        }
      ],
      reason: "Failed to load work-report evidence."
    });
  }

  const reportDiagnostics = validateWorkReport(loadedReport);
  const invalidRole = isObject(loadedReport) && loadedReport.agent_role !== "worker";
  const invalidReport = reportDiagnostics.some((entry) => entry.severity === "error");
  const parsedUnit = parseUnitAddress(unitAddress ?? buildUnitAddress(loadedReport));

  if (!parsedUnit.ok) {
    return createInvalidResult({
      unitAddress,
      report: loadedReport,
      decisionCode: invalidRole ? "blocked_invalid_role" : "blocked_invalid_report",
      diagnostics: reportDiagnostics,
      reason: "Assigned unit address is missing or invalid."
    });
  }

  const unit = parsedUnit.value;

  if (unit.record_id !== loadedReport?.record_id || unit.slice_id !== (loadedReport?.slice_id ?? null)) {
    return createInvalidResult({
      unitAddress: unit.address,
      report: loadedReport,
      decisionCode: "blocked_report_unit_mismatch",
      diagnostics: reportDiagnostics,
      reason: "Report record_id or slice_id does not match the assigned unit."
    });
  }

  if (invalidRole) {
    return createInvalidResult({
      unitAddress: unit.address,
      report: loadedReport,
      decisionCode: "blocked_invalid_role",
      diagnostics: reportDiagnostics,
      reason: "work-report ingestion accepts worker reports only."
    });
  }

  if (invalidReport) {
    return createInvalidResult({
      unitAddress: unit.address,
      report: loadedReport,
      decisionCode: "blocked_invalid_report",
      diagnostics: reportDiagnostics,
      reason: "Work-report evidence did not satisfy the v1 schema."
    });
  }

  const loadedRecord = await loadWorkRecordById({ dir: targetDir, id: unit.record_id });
  if (loadedRecord.diagnostics.some((entry) => entry.code === "missing_json_record")) {
    return createInvalidResult({
      unitAddress: unit.address,
      report: loadedReport,
      decisionCode: "blocked_missing_canonical_record",
      diagnostics: loadedRecord.diagnostics,
      reason: "Missing canonical work-record JSON for the reported unit."
    });
  }

  if (!loadedRecord.valid || !loadedRecord.record) {
    return createInvalidResult({
      unitAddress: unit.address,
      report: loadedReport,
      decisionCode: "blocked_invalid_report",
      diagnostics: loadedRecord.diagnostics,
      reason: "Canonical work-record JSON is invalid."
    });
  }

  const updatedRecord = clone(loadedRecord.record);
  const slice =
    unit.kind === "slice"
      ? updatedRecord.slices.find((entry) => isObject(entry) && entry.id === unit.slice_id) || null
      : null;
  if (unit.kind === "slice" && !slice) {
    return createInvalidResult({
      unitAddress: unit.address,
      report: loadedReport,
      decisionCode: "blocked_report_unit_mismatch",
      diagnostics: [],
      reason: `Selected slice ${unit.slice_id} does not exist on ${unit.record_id}.`
    });
  }

  const writeScope =
    unit.kind === "slice"
      ? Array.isArray(slice?.write_scope)
        ? slice.write_scope
        : []
      : Array.isArray(updatedRecord.write_scope)
        ? updatedRecord.write_scope
        : [];
  const outOfScopePaths = loadedReport.changed_paths.filter(
    (entry) => !pathWithinScope(entry, writeScope)
  );
  const validationStatuses = loadedReport.validation.map((entry) => entry.status);
  const followUpsOutsideScope = loadedReport.follow_ups.filter(
    (entry) => !isInScopeFollowUp(entry.repo_ref, updatedRecord.id)
  );
  const decisionCode = chooseDecisionCode({
    invalidReport: false,
    invalidRole: false,
    missingCanonicalRecord: false,
    unitMismatch: false,
    outOfScopePaths,
    validationStatuses,
    reportStatus: loadedReport.status,
    blockers: loadedReport.blockers,
    followUps: loadedReport.follow_ups
  });
  const storedResult = createStoredResult({
    unit,
    decisionCode,
    report: loadedReport,
    outOfScopePaths,
    followUpsOutsideScope,
    now
  });

  if (unit.kind === "slice") {
    slice.result = storedResult;
  } else {
    updatedRecord.report_ingestion = storedResult;
    updatedRecord.sections = isObject(updatedRecord.sections) ? updatedRecord.sections : {};
    updatedRecord.sections.closure = {
      summary: `Structured work-report ingestion recorded ${decisionCode} for ${unit.address}.`,
      validation: summarizeValidation(loadedReport.validation),
      follow_ups: summarizeFollowUps(loadedReport.follow_ups)
    };
  }

  await writeFile(
    getWorkRecordPath(targetDir, updatedRecord.id),
    `${JSON.stringify(updatedRecord, null, 2)}\n`,
    "utf8"
  );

  const reasons = [];
  if (outOfScopePaths.length > 0) {
    reasons.push(`Out-of-scope changed paths: ${outOfScopePaths.join(", ")}`);
  }
  if (validationStatuses.includes("failed")) {
    reasons.push("Validation reported a failed command.");
  }
  if (validationStatuses.includes("skipped") || validationStatuses.includes("not_run")) {
    reasons.push("Validation includes skipped or not-run commands.");
  }
  if (loadedReport.blockers.some((entry) => entry.kind === "authority_violation")) {
    reasons.push("Worker report attempted an authority-violating action.");
  }
  if (followUpsOutsideScope.length > 0) {
    reasons.push("Follow-ups include allocator-created work outside the current unit scope.");
  }

  return {
    valid: true,
    decision_code: decisionCode,
    unit_address: unit.address,
    record_id: updatedRecord.id,
    slice_id: unit.slice_id,
    reasons,
    diagnostics: [],
    canonical_record_path: getWorkRecordPath(targetDir, updatedRecord.id),
    written: true,
    record: updatedRecord,
    report: clone(loadedReport)
  };
}
