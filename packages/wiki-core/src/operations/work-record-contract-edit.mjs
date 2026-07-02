

import path from "node:path";

import { computeWorkRecordSourceDigest } from "../lib/work-record-schema.mjs";
import { getWorkRecordPath, loadWorkRecordById } from "../lib/work-record-store.mjs";
import {
  WORK_RECORD_CONTRACT_EDIT_OPERATIONS,
  applyWorkRecordContractEdit,
  parseWorkRecordUnitAddress
} from "../lib/work-record-contract-edit.mjs";
import { writeValidatedWorkRecord } from "./work-records.mjs";
import { generateAndLint } from "./generate-and-lint.mjs";
import { lintRepo } from "./lint.mjs";

export { WORK_RECORD_CONTRACT_EDIT_OPERATIONS };

const CLOSEOUT_LINT_TOP_FINDINGS_LIMIT = 5;

export async function buildCloseoutLintSummary({
  dir = ".",
  regenerateViews = true,
  topFindingsLimit = CLOSEOUT_LINT_TOP_FINDINGS_LIMIT
} = {}) {
  let lintResult;
  let generatedViews;
  try {
    if (regenerateViews) {
      const result = await generateAndLint({ dir, includeAllFindings: true });

      lintResult = result.lint ?? result;
      generatedViews = "refreshed";
    } else {
      lintResult = await lintRepo({ dir, includeAllFindings: true });
      generatedViews = "not_refreshed_may_be_stale";
    }
  } catch (error) {
    return {
      ran: false,
      ok: null,
      valid: null,
      cleanly_closeable: null,
      generated_views: regenerateViews ? "refresh_failed" : "not_refreshed_may_be_stale",
      warning_count: null,
      error_count: null,
      top_findings: [],
      findings_truncated: false,
      error: { message: error?.message ? String(error.message) : String(error) },
      next_action:
        "Automatic repo lint could not run after this write; run `npm run wiki -- generate-and-lint` (or `npm run wiki -- lint`) manually and resolve or record any failures before treating this unit as cleanly closed."
    };
  }

  const findings = Array.isArray(lintResult.findings) ? lintResult.findings : [];
  const errorFindings = findings.filter((entry) => entry?.severity === "error");
  const warningFindings = findings.filter((entry) => entry?.severity === "warning");
  const errorCount =
    typeof lintResult.error_count === "number" ? lintResult.error_count : errorFindings.length;
  const warningCount =
    typeof lintResult.warning_count === "number"
      ? lintResult.warning_count
      : warningFindings.length;
  const orderedFindings = [...errorFindings, ...warningFindings];
  const topFindings = orderedFindings.slice(0, topFindingsLimit).map((entry) => ({
    severity: entry.severity ?? null,
    code: entry.code ?? null,
    message: entry.message ?? null,
    path: entry.path ?? null
  }));
  const ok = errorCount === 0;

  let nextAction;
  if (!ok) {
    const noun = errorCount === 1 ? "error" : "errors";
    nextAction =
      `LINT RED: repo lint reports ${errorCount} ${noun}. This unit is NOT cleanly closeable ` +
      "until repo lint is fixed or a specific pre-existing lint blocker is recorded on the work " +
      "record (for example in the closure notes or an escalation). Fix the listed errors and " +
      "rerun, or record the accepted lint blocker before treating this unit as closed.";
  } else if (warningCount > 0) {
    const noun = warningCount === 1 ? "warning" : "warnings";
    nextAction =
      `Repo lint passed with no errors but ${warningCount} ${noun}. The unit is cleanly ` +
      `closeable; review the listed ${noun} when convenient.`;
  } else {
    nextAction = "Repo lint passed with no errors or warnings. The unit is cleanly closeable.";
  }

  return {
    ran: true,
    ok,
    valid: Boolean(lintResult.valid ?? ok),
    cleanly_closeable: ok,
    generated_views: generatedViews,
    warning_count: warningCount,
    error_count: errorCount,
    top_findings: topFindings,
    findings_truncated: orderedFindings.length > topFindings.length,
    next_action: nextAction
  };
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function selectedUnitProjection(unit) {
  if (!unit) {
    return null;
  }
  return {
    kind: unit.kind,
    address: unit.address,
    record_id: unit.record_id,
    slice_id: unit.slice_id
  };
}

function buildResult({
  operation,
  unit = null,
  recordId = null,
  loaded = null,
  sourceDigest = null,
  diagnostics = [],
  valid = false,
  written = false,
  noOp = false,
  changedFields = [],
  canonicalRecordPath = null,
  nextAction,
  expectedSourceDigest = undefined,
  currentSourceDigest = null,
  verbose = false,
  record = null
}) {
  const result = {
    operation,
    record_id: recordId,
    selected_unit: selectedUnitProjection(unit),
    source_path: loaded?.source_path || null,
    source_path_relative: loaded?.source_path_relative || null,
    source_digest: sourceDigest,
    valid: Boolean(valid),
    written: Boolean(written),
    no_op: Boolean(noOp),
    changed_fields: Array.isArray(changedFields) ? changedFields : [],
    diagnostics: Array.isArray(diagnostics) ? diagnostics : [],
    canonical_record_path: canonicalRecordPath,
    next_action: nextAction
  };
  if (expectedSourceDigest !== undefined) {
    result.expected_source_digest = expectedSourceDigest;
    result.current_source_digest = currentSourceDigest ?? null;
  }
  if (verbose && record) {
    result.record = record;
  }
  return result;
}

function buildPlannerParams(operation, params, unit) {
  const sliceId = unit.kind === "slice" ? unit.slice_id : null;
  switch (operation) {
    case "upsert_slice":
      return { slice: params.slice };
    case "delete_slice":
      return { sliceId: params.slice_id ?? params.sliceId ?? sliceId ?? undefined };
    case "set_list_field":
      return { sliceId, field: params.field, values: params.values };
    case "set_acceptance":
      return { sliceId, criteria: params.criteria, validation: params.validation };
    case "shape_review_unit":
      return { sliceId };
    default:
      return {};
  }
}

export async function editWorkRecordContractByUnit({
  dir = ".",
  unitAddress,
  operation,
  params = {},
  expectedSourceDigest = null,
  expected_source_digest = null,
  recordStore = null,
  verbose = false
} = {}) {
  const targetDir = path.resolve(String(dir));
  const expected = expectedSourceDigest ?? expected_source_digest;

  const parsed = parseWorkRecordUnitAddress(unitAddress);
  if (!parsed.ok) {
    return buildResult({
      operation,
      diagnostics: [{ ...parsed.error, severity: "error" }],
      nextAction: "supply a valid unit address (WK-#### or WK-#####slice-id)",
      verbose
    });
  }

  if (!WORK_RECORD_CONTRACT_EDIT_OPERATIONS.includes(operation)) {
    return buildResult({
      operation,
      recordId: parsed.recordId,
      unit: parsed.unit,
      diagnostics: [
        {
          code: "unsupported_operation",
          severity: "error",
          message: `Unsupported contract edit operation '${operation}'; expected one of: ${WORK_RECORD_CONTRACT_EDIT_OPERATIONS.join(", ")}`,
          path: "operation"
        }
      ],
      nextAction: "call with a supported operation",
      verbose
    });
  }

  if (operation === "delete_slice") {
    const addressSliceId = parsed.unit.kind === "slice" ? parsed.unit.slice_id : null;
    const explicitSliceId = params?.slice_id ?? params?.sliceId ?? null;
    if (addressSliceId !== null && explicitSliceId !== null && explicitSliceId !== addressSliceId) {
      return buildResult({
        operation,
        recordId: parsed.recordId,
        unit: parsed.unit,
        diagnostics: [
          {
            code: "conflicting_slice_id",
            severity: "error",
            message: `unit address names slice '${addressSliceId}' but explicit slice_id '${explicitSliceId}' differs; supply one or the other`,
            path: "slice_id"
          }
        ],
        nextAction: "remove slice_id or use a record-scoped unit address (WK-####) when supplying slice_id",
        verbose
      });
    }
  }

  const loaded = await loadWorkRecordById({
    dir: targetDir,
    id: parsed.recordId,
    recordStore
  });

  if (!loaded.record) {
    return buildResult({
      operation,
      recordId: parsed.recordId,
      unit: parsed.unit,
      loaded,
      diagnostics: loaded.diagnostics || [],
      sourceDigest: loaded.source_digest || null,
      nextAction: "the base work record could not be loaded; resolve the reported diagnostics",
      verbose
    });
  }

  if (loaded.diagnostics?.some((entry) => entry.severity === "error")) {
    return buildResult({
      operation,
      recordId: parsed.recordId,
      unit: parsed.unit,
      loaded,
      diagnostics: loaded.diagnostics,
      sourceDigest: loaded.source_digest || null,
      nextAction: "the base work record is invalid; fix it before editing",
      verbose
    });
  }

  const plannerParams = buildPlannerParams(operation, params || {}, parsed.unit);
  const plan = applyWorkRecordContractEdit(loaded.record, { operation, ...plannerParams });

  if (!plan.ok) {
    return buildResult({
      operation,
      recordId: parsed.recordId,
      unit: parsed.unit,
      loaded,
      diagnostics: plan.diagnostics,
      sourceDigest: loaded.source_digest || null,
      nextAction: "fix the reported diagnostics and retry the edit",
      verbose
    });
  }

  if (!plan.changedFields.length) {
    return buildResult({
      operation,
      recordId: parsed.recordId,
      unit: parsed.unit,
      loaded,
      diagnostics: plan.diagnostics,
      sourceDigest: loaded.source_digest || null,
      valid: true,
      written: false,
      noOp: true,
      changedFields: [],
      canonicalRecordPath: loaded.canonical_record_path || null,
      nextAction: "no change needed; the record already matches the requested edit",
      verbose,
      record: plan.updatedRecord
    });
  }

  const updatedRecord = plan.updatedRecord;
  updatedRecord.updated = todayDateString();
  const changedFields = [...plan.changedFields, "updated"];
  const effectiveExpectedSourceDigest =
    expected !== null && expected !== undefined ? expected : loaded.source_digest || null;

  const writeResult = await writeValidatedWorkRecord({
    dir: targetDir,
    record: updatedRecord,
    expectedSourceDigest: effectiveExpectedSourceDigest,
    recordStore
  });

  const isStale = writeResult.diagnostics?.some((entry) => entry.code === "stale_source_digest");
  const canonicalRecordPath =
    writeResult.canonical_record_path || getWorkRecordPath(targetDir, updatedRecord.id);

  let nextAction;
  if (writeResult.written) {
    nextAction = "edit persisted; rerun validation if the record is now ready to dispatch";
  } else if (isStale) {
    nextAction = `reload ${parsed.recordId} and retry with the current source digest`;
  } else {
    nextAction = "the validated write was refused; resolve the reported diagnostics and retry";
  }

  return buildResult({
    operation,
    recordId: parsed.recordId,
    unit: parsed.unit,
    loaded,
    diagnostics: writeResult.diagnostics || [],
    sourceDigest: writeResult.source_digest || computeWorkRecordSourceDigest(updatedRecord),
    valid: Boolean(writeResult.valid),
    written: Boolean(writeResult.written),
    noOp: false,
    changedFields,
    canonicalRecordPath,
    nextAction,
    expectedSourceDigest: expected === null || expected === undefined ? undefined : expected,
    currentSourceDigest: writeResult.current_source_digest || null,
    verbose,
    record: updatedRecord
  });
}
