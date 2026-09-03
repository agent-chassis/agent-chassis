

import path from "node:path";

import { loadKindRecordById } from "../lib/kind-record-store.mjs";
import { computeWorkRecordSourceDigest } from "../lib/work-record-schema.mjs";
import { collectWorkRecordControlledContractPrivateScopeFacts } from
  "../lib/controlled-contract-private-path-policy.mjs";
import {
  classifyWorkRecordGenerationTransition,
  projectWorkRecordGenerationTransition
} from "../lib/work-record-generation-transition.mjs";
import { SHA256_PATTERN } from "../lib/work-record-schema-constants.mjs";
import { getWorkRecordPath, loadWorkRecordById } from "../lib/work-record-store.mjs";
import {
  WORK_RECORD_EDIT_FIELD_REGISTRY,
  WORK_RECORD_CONTRACT_EDIT_OPERATIONS,
  applyWorkRecordContractEdit,
  assignWorkRecordToInitiative,
  assessAcceptanceRepairEligibility,
  guardAcceptanceRepairPersistedDiff,
  guardInitiativeAssignmentPersistedDiff,
  guardWorkRecordReadySlicePersistedDiff,
  planWorkRecordReadySlice,
  parseWorkRecordUnitAddress,
  validateWorkRecordReadySliceRequest
} from "../lib/work-record-contract-edit.mjs";
import { computeReviewedUnitSourceDigest } from "../lib/work-record-review-attestation.mjs";
import { setWorkRecordTaskByUnit, writeValidatedWorkRecord } from "./work-records.mjs";
import {
  computeWorkRecordPersistenceSnapshotDigest,
  writeValidatedWorkRecordWithAdmissionSidecars
} from "./work-records-store-io.mjs";
import { generateAndLint } from "./generate-and-lint.mjs";
import { lintRepo } from "./lint.mjs";

export { WORK_RECORD_CONTRACT_EDIT_OPERATIONS };

export const ASSIGN_WORK_RECORD_TO_INITIATIVE_OPERATION =
  "assign_work_record_to_initiative";
export const EDIT_WORK_RECORD_OPERATION = "edit_work_record";

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
  record = null,
  generationTransition = null
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
    next_action: nextAction,
    policy_facts: collectWorkRecordControlledContractPrivateScopeFacts(
      record ?? loaded?.record ?? null
    )
  };
  if (generationTransition) result.generation_transition = generationTransition;
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
    case "edit_work_record":
      return { sliceId, edit: params.edit };
    case "set_list_field":

      return { sliceId, field: params.field, values: params.values, mode: params.mode };
    case "set_acceptance":
      return { sliceId, criteria: params.criteria, validation: params.validation };
    case "shape_review_unit":
      return { sliceId };
    default:
      return {};
  }
}

function sliceUnit(recordId, sliceId) {
  return {
    kind: "slice",
    address: `${recordId}#${sliceId}`,
    record_id: recordId,
    slice_id: sliceId
  };
}

function resolveGenerationSelectedUnit({ operation, parsedUnit, plannerParams, beforeRecord, afterRecord }) {
  if (parsedUnit.kind === "slice") return parsedUnit;
  if (operation === "delete_slice") {
    return sliceUnit(parsedUnit.record_id, plannerParams.sliceId);
  }
  if (operation === "upsert_slice") {
    const suppliedSliceId = plannerParams.slice?.id;
    if (suppliedSliceId) return sliceUnit(parsedUnit.record_id, suppliedSliceId);
    const beforeIds = new Set((beforeRecord.slices ?? []).map((slice) => slice?.id));
    const created = (afterRecord.slices ?? []).filter((slice) => !beforeIds.has(slice?.id));
    if (created.length === 1) return sliceUnit(parsedUnit.record_id, created[0].id);
  }
  return parsedUnit;
}

function classifyProspectiveTransition(selectedUnit, beforeRecord, afterRecord) {
  return classifyWorkRecordGenerationTransition(selectedUnit, beforeRecord, afterRecord);
}

function completedRevisionDiagnostic() {
  return {
    code: "completed_revision",
    severity: "error",
    message: "completed work-record content cannot be revised or deleted in place",
    path: "status"
  };
}

export async function assignWorkRecordToInitiativeByUnit({
  dir = ".",
  unit,
  initiative,
  expectedSourceDigest = null,
  expected_source_digest = null,
  recordStore = null,
  writeWorkRecord = writeValidatedWorkRecord,
  verbose = false
} = {}) {
  const operation = ASSIGN_WORK_RECORD_TO_INITIATIVE_OPERATION;
  const targetDir = path.resolve(String(dir));
  const expected = expectedSourceDigest ?? expected_source_digest;
  const parsed = parseWorkRecordUnitAddress(unit);

  if (!parsed.ok) {
    return buildResult({
      operation,
      diagnostics: [{ ...parsed.error, severity: "error" }],
      nextAction: "supply a record-level WK selector (WK-####)",
      verbose
    });
  }

  if (parsed.unit.kind !== "work_item") {
    return buildResult({
      operation,
      recordId: parsed.recordId,
      unit: parsed.unit,
      diagnostics: [
        {
          code: "unsupported_slice_selector",
          severity: "error",
          message: "assign_work_record_to_initiative accepts record-level WK selectors only",
          path: "unit"
        }
      ],
      nextAction: `retry with the record selector ${parsed.recordId}`,
      verbose
    });
  }

  if (
    expected !== null &&
    expected !== undefined &&
    (typeof expected !== "string" || !SHA256_PATTERN.test(expected))
  ) {
    return buildResult({
      operation,
      recordId: parsed.recordId,
      unit: parsed.unit,
      diagnostics: [
        {
          code: "invalid_expected_source_digest",
          severity: "error",
          message: "expected_source_digest must be sha256:<64 lowercase hex>",
          path: "expected_source_digest"
        }
      ],
      expectedSourceDigest: expected,
      currentSourceDigest: null,
      nextAction:
        "supply a valid expected_source_digest (sha256:<64 lowercase hex>) or omit the field",
      verbose
    });
  }

  const loaded = await loadWorkRecordById({
    dir: targetDir,
    id: parsed.recordId,
    recordStore
  });
  if (!loaded.record || loaded.diagnostics?.some((entry) => entry.severity === "error")) {
    return buildResult({
      operation,
      recordId: parsed.recordId,
      unit: parsed.unit,
      loaded,
      diagnostics: loaded.diagnostics || [],
      sourceDigest: loaded.source_digest || null,
      nextAction: "the WK record could not be loaded as a valid canonical work record",
      verbose
    });
  }

  const plan = assignWorkRecordToInitiative(loaded.record, { initiative });
  if (!plan.ok) {
    return buildResult({
      operation,
      recordId: parsed.recordId,
      unit: parsed.unit,
      loaded,
      diagnostics: plan.diagnostics,
      sourceDigest: loaded.source_digest || null,
      nextAction: "supply a valid initiative selector (IN-####)",
      verbose
    });
  }

  if (expected !== null && expected !== undefined && expected !== loaded.source_digest) {
    return buildResult({
      operation,
      recordId: parsed.recordId,
      unit: parsed.unit,
      loaded,
      diagnostics: [
        {
          code: "stale_source_digest",
          severity: "error",
          message: "source digest does not match the current on-disk record",
          path: loaded.source_path_relative || loaded.source_path || null
        }
      ],
      sourceDigest: loaded.source_digest || null,
      expectedSourceDigest: expected,
      currentSourceDigest: loaded.source_digest || null,
      nextAction: `reload ${parsed.recordId} and retry with the current source digest`,
      verbose
    });
  }

  const target = await loadKindRecordById({ repoRoot: targetDir, id: initiative });
  if (!target.record) {
    const missing = target.diagnostics?.some((entry) => entry.code === "missing_json_record");
    return buildResult({
      operation,
      recordId: parsed.recordId,
      unit: parsed.unit,
      loaded,
      diagnostics: missing
        ? [
            {
              code: "initiative_not_found",
              severity: "error",
              message: `Target initiative '${initiative}' does not exist`,
              path: "initiative"
            }
          ]
        : target.diagnostics || [],
      sourceDigest: loaded.source_digest || null,
      nextAction: "supply the id of an existing canonical initiative record",
      verbose
    });
  }
  if (target.record_id !== initiative) {
    return buildResult({
      operation,
      recordId: parsed.recordId,
      unit: parsed.unit,
      loaded,
      diagnostics: [
        {
          code: "initiative_record_mismatch",
          severity: "error",
          message: `Target initiative file '${initiative}' claims id '${target.record_id}'`,
          path: "initiative"
        }
      ],
      sourceDigest: loaded.source_digest || null,
      nextAction: "repair the target initiative record before assigning work to it",
      verbose
    });
  }
  if (target.record.record_kind !== "initiative") {
    const actualKind =
      typeof target.record.record_kind === "string"
        ? target.record.record_kind.slice(0, 64)
        : typeof target.record.record_kind;
    return buildResult({
      operation,
      recordId: parsed.recordId,
      unit: parsed.unit,
      loaded,
      diagnostics: [
        {
          code: "initiative_record_kind_mismatch",
          severity: "error",
          message: `Target '${initiative}' has record_kind '${actualKind}', expected 'initiative'`,
          path: "initiative"
        }
      ],
      sourceDigest: loaded.source_digest || null,
      nextAction: "supply a canonical initiative record target",
      verbose
    });
  }
  if (target.diagnostics?.some((entry) => entry.severity === "error")) {
    return buildResult({
      operation,
      recordId: parsed.recordId,
      unit: parsed.unit,
      loaded,
      diagnostics: target.diagnostics,
      sourceDigest: loaded.source_digest || null,
      nextAction: "repair the target initiative record before assigning work to it",
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
      canonicalRecordPath: loaded.canonical_record_path || getWorkRecordPath(targetDir, parsed.recordId),
      nextAction: "no change needed; WK.initiative already names the target initiative",
      verbose,
      record: plan.updatedRecord
    });
  }

  const persistedDiffGuard = guardInitiativeAssignmentPersistedDiff(
    loaded.record,
    plan.updatedRecord
  );
  if (!persistedDiffGuard.ok) {
    return buildResult({
      operation,
      recordId: parsed.recordId,
      unit: parsed.unit,
      loaded,
      diagnostics: [persistedDiffGuard.diagnostic],
      sourceDigest: loaded.source_digest || null,
      valid: false,
      written: false,
      noOp: false,
      changedFields: [],
      canonicalRecordPath:
        loaded.canonical_record_path || getWorkRecordPath(targetDir, parsed.recordId),
      nextAction:
        "canonicalize unrelated work-record fields through their owning operation before retrying assignment",
      verbose
    });
  }

  const effectiveExpectedSourceDigest =
    expected !== null && expected !== undefined ? expected : loaded.source_digest || null;
  const writeResult = await writeWorkRecord({
    dir: targetDir,
    record: persistedDiffGuard.normalizedCandidate,
    expectedSourceDigest: effectiveExpectedSourceDigest,
    recordStore
  });
  const isStale = writeResult.diagnostics?.some((entry) => entry.code === "stale_source_digest");

  return buildResult({
    operation,
    recordId: parsed.recordId,
    unit: parsed.unit,
    loaded,
    diagnostics: writeResult.diagnostics || [],
    sourceDigest:
      writeResult.source_digest ||
      computeWorkRecordSourceDigest(persistedDiffGuard.normalizedCandidate),
    valid: Boolean(writeResult.valid),
    written: Boolean(writeResult.written),
    noOp: false,
    changedFields: writeResult.written ? ["initiative"] : [],
    canonicalRecordPath:
      writeResult.canonical_record_path || getWorkRecordPath(targetDir, parsed.recordId),
    nextAction: writeResult.written
      ? "assignment persisted; initiative membership is derived from WK.initiative"
      : isStale
        ? `reload ${parsed.recordId} and retry with the current source digest`
        : "the validated WK write was refused; resolve the reported diagnostics and retry",
    expectedSourceDigest: expected === null || expected === undefined ? undefined : expected,
    currentSourceDigest: writeResult.current_source_digest || null,
    verbose,
    record: persistedDiffGuard.normalizedCandidate
  });
}

export async function editWorkRecordByUnit(options = {}) {
  const { edit = null } = options;
  const taskEntry = WORK_RECORD_EDIT_FIELD_REGISTRY.find(
    (entry) => entry.facade && entry.kind === "task" && entry.field === edit?.field
  );
  const taskKeys = new Set(["kind", "field", "action", "value", "text", "index"]);
  const taskShapeIsClosed = edit && Object.keys(edit).every((key) => taskKeys.has(key));
  if (
    taskShapeIsClosed &&
    edit.kind === "task" &&
    taskEntry &&
    taskEntry.actions.includes(edit.action)
  ) {
    const result = await setWorkRecordTaskByUnit({
      dir: options.dir,
      unitAddress: options.unitAddress,
      action: edit.action,
      text: edit.text,
      index: edit.index,
      value: edit.value,
      expectedSourceDigest: options.expectedSourceDigest ?? options.expected_source_digest ?? null,
      recordStore: options.recordStore ?? null
    });
    return {
      operation: EDIT_WORK_RECORD_OPERATION,
      ...result,
      next_action: result.written
        ? "edit persisted; rerun validation if the record is now ready to dispatch"
        : result.no_op
          ? "no change needed; the record already matches the requested edit"
          : "fix the reported diagnostics and retry the edit"
    };
  }
  return editWorkRecordContractByUnit({
    ...options,
    operation: EDIT_WORK_RECORD_OPERATION,
    params: { edit }
  });
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

  if (
    operation !== EDIT_WORK_RECORD_OPERATION &&
    !WORK_RECORD_CONTRACT_EDIT_OPERATIONS.includes(operation)
  ) {
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

  if (expected !== null && expected !== undefined && expected !== loaded.source_digest) {
    return buildResult({
      operation,
      recordId: parsed.recordId,
      unit: parsed.unit,
      loaded,
      diagnostics: [{
        code: "stale_source_digest",
        severity: "error",
        message: "source digest does not match the current on-disk record",
        path: "expected_source_digest"
      }],
      sourceDigest: loaded.source_digest || null,
      expectedSourceDigest: expected,
      currentSourceDigest: loaded.source_digest || null,
      nextAction: `reload ${parsed.recordId} and retry with the current source digest`,
      verbose
    });
  }

  const baseErrors = (loaded.diagnostics || []).filter((entry) => entry.severity === "error");
  let acceptanceRepair = null;
  if (baseErrors.length > 0) {
    if (operation !== "set_acceptance") {
      return buildResult({
        operation,
        recordId: parsed.recordId,
        unit: parsed.unit,
        loaded,
        diagnostics: loaded.diagnostics,
        sourceDigest: loaded.source_digest || null,
        nextAction: "the base work record is invalid; only an eligible set_acceptance repair may proceed",
        verbose
      });
    }

    acceptanceRepair = assessAcceptanceRepairEligibility(loaded.record, {
      sliceId: parsed.unit.kind === "slice" ? parsed.unit.slice_id : null,
      diagnostics: loaded.diagnostics || []
    });
    if (!acceptanceRepair.ok) {
      return buildResult({
        operation,
        recordId: parsed.recordId,
        unit: parsed.unit,
        loaded,
        diagnostics: [acceptanceRepair.diagnostic, ...baseErrors],
        sourceDigest: loaded.source_digest || null,
        nextAction: "the invalid base record is outside the allowlisted set_acceptance repair boundary",
        verbose
      });
    }
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

  const generationUnit = resolveGenerationSelectedUnit({
    operation,
    parsedUnit: parsed.unit,
    plannerParams,
    beforeRecord: loaded.record,
    afterRecord: plan.updatedRecord
  });
  const generation = classifyProspectiveTransition(
    generationUnit,
    loaded.record,
    plan.updatedRecord
  );

  if (generation.transition === "completed_revision") {
    return buildResult({
      operation,
      recordId: parsed.recordId,
      unit: parsed.unit,
      loaded,
      diagnostics: [completedRevisionDiagnostic()],
      sourceDigest: loaded.source_digest || null,
      valid: false,
      written: false,
      noOp: false,
      changedFields: [],
      canonicalRecordPath: loaded.canonical_record_path || null,
      nextAction: "create a new work-record lifecycle for further requirements",
      generationTransition: projectWorkRecordGenerationTransition(generation),
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
      record: plan.updatedRecord,
      generationTransition: projectWorkRecordGenerationTransition(generation, {
        persisted: true,
        written: false,
        noOp: true
      })
    });
  }

  let updatedRecord = plan.updatedRecord;
  updatedRecord.updated = todayDateString();
  const changedFields = [...plan.changedFields, "updated"];

  if (acceptanceRepair) {
    const persistedDiff = guardAcceptanceRepairPersistedDiff(loaded.record, updatedRecord, {
      sliceIndex: acceptanceRepair.sliceIndex,
      hasCriteria: params?.criteria !== undefined,
      hasValidation: params?.validation !== undefined
    });
    if (!persistedDiff.ok) {
      return buildResult({
        operation,
        recordId: parsed.recordId,
        unit: parsed.unit,
        loaded,
        diagnostics: [persistedDiff.diagnostic],
        sourceDigest: loaded.source_digest || null,
        nextAction: "the post-normalization persisted diff exceeded the set_acceptance repair allowlist",
        generationTransition: projectWorkRecordGenerationTransition(generation),
        verbose
      });
    }
    updatedRecord = persistedDiff.normalizedCandidate;
  }

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
    record: updatedRecord,
    generationTransition: projectWorkRecordGenerationTransition(generation, {
      persisted: Boolean(writeResult.written),
      written: Boolean(writeResult.written),
      noOp: false
    })
  });
}

export const READY_WORK_RECORD_SLICE_OPERATION = "ready_work_record_slice";
const READY_RESULT_DIAGNOSTIC_LIMIT = 20;
const READY_RESULT_PATH_LIMIT = 64;

function boundedReadyDiagnostics(diagnostics) {
  return (Array.isArray(diagnostics) ? diagnostics : [])
    .slice(0, READY_RESULT_DIAGNOSTIC_LIMIT)
    .map((entry) => ({
      code: entry?.code ?? "ready_slice_failure",
      severity: entry?.severity ?? "error",
      message: typeof entry?.message === "string" ? entry.message.slice(0, 256) : "ready-slice operation refused",
      path: typeof entry?.path === "string" || entry?.path === null ? entry.path : null
    }));
}
function readyCoreResult({
  contractPersisted = false,
  selectedUnit = null,
  changedFields = [],
  changedPaths = [],
  written = false,
  noOp = false,
  sourceDigest = null,
  reviewedUnitDigest = null,
  generationTransition = null,
  diagnostics = [],
  policyFacts = []
} = {}) {
  return {
    contract_persisted: Boolean(contractPersisted),
    selected_unit: selectedUnit,
    changed_fields: changedFields.slice(0, READY_RESULT_PATH_LIMIT),
    changed_paths: changedPaths.slice(0, READY_RESULT_PATH_LIMIT),
    written: Boolean(written),
    no_op: Boolean(noOp),
    source_digest: sourceDigest,
    reviewed_unit_digest: reviewedUnitDigest,
    generation_transition: generationTransition,
    diagnostics: boundedReadyDiagnostics(diagnostics),
    policy_facts: policyFacts
  };
}
function readyDiagnostic(code, message, pathValue = null) {
  return { code, severity: "error", message, path: pathValue };
}

export async function readyWorkRecordSliceByUnit(options = {}) {
  const {
    dir = ".",
    request: nestedRequest = null,
    recordStore = null,
    writeWorkRecordTransaction = writeValidatedWorkRecordWithAdmissionSidecars,
    ...topLevelRequest
  } = options;
  if (nestedRequest !== null && Object.keys(topLevelRequest).length > 0) {
    return readyCoreResult({
      diagnostics: [readyDiagnostic("ready_slice_ambiguous_request", "supply ready-slice fields either in request or at top level, not both")]
    });
  }
  const request = nestedRequest ?? topLevelRequest;
  const preflight = validateWorkRecordReadySliceRequest(request);
  if (!preflight.ok) return readyCoreResult({ diagnostics: preflight.diagnostics });

  const targetDir = path.resolve(String(dir));
  const loaded = await loadWorkRecordById({ dir: targetDir, id: request.unit, recordStore });
  if (!loaded.record || loaded.diagnostics?.some((entry) => entry.severity === "error")) {
    return readyCoreResult({
      sourceDigest: loaded.source_digest ?? null,
      diagnostics: loaded.diagnostics ?? []
    });
  }
  const loadedSourceDigest = computeWorkRecordSourceDigest(loaded.record);
  const loadedSnapshotDigest = computeWorkRecordPersistenceSnapshotDigest(loaded.record);
  if (request.expected_source_digest && request.expected_source_digest !== loadedSourceDigest) {
    return readyCoreResult({
      sourceDigest: loadedSourceDigest,
      policyFacts: collectWorkRecordControlledContractPrivateScopeFacts(loaded.record),
      diagnostics: [readyDiagnostic("stale_source_digest", "source digest does not match the current on-disk record", "expected_source_digest")]
    });
  }

  const selectedBefore = request.slice_id
    ? { kind: "slice", address: `${request.unit}#${request.slice_id}`, record_id: request.unit, slice_id: request.slice_id }
    : null;

  const plan = planWorkRecordReadySlice(loaded.record, request);
  if (!plan.ok) {
    return readyCoreResult({
      selectedUnit: selectedBefore,
      sourceDigest: loadedSourceDigest,
      policyFacts: plan.policyFacts ?? collectWorkRecordControlledContractPrivateScopeFacts(loaded.record),
      diagnostics: plan.diagnostics
    });
  }

  const generation = classifyProspectiveTransition(
    plan.selectedUnit,
    loaded.record,
    plan.updatedRecord
  );
  if (generation.transition === "completed_revision") {
    return readyCoreResult({
      selectedUnit: plan.selectedUnit,
      sourceDigest: loadedSourceDigest,
      policyFacts: plan.policyFacts,
      generationTransition: projectWorkRecordGenerationTransition(generation),
      diagnostics: [completedRevisionDiagnostic()]
    });
  }

  let candidate = plan.updatedRecord;
  const afterReviewedDigest = computeReviewedUnitSourceDigest({
    record: candidate,
    slice_id: plan.selectedUnit.slice_id
  });
  if (!afterReviewedDigest) {
    return readyCoreResult({
      selectedUnit: plan.selectedUnit,
      sourceDigest: loadedSourceDigest,
      policyFacts: plan.policyFacts,
      diagnostics: [readyDiagnostic("ready_slice_reviewed_digest_unavailable", "prospective reviewed digest could not be computed")]
    });
  }

  if (plan.changedFields.length === 0) {
    return readyCoreResult({
      contractPersisted: true,
      selectedUnit: plan.selectedUnit,
      sourceDigest: loadedSourceDigest,
      policyFacts: plan.policyFacts,
      reviewedUnitDigest: afterReviewedDigest,
      noOp: true,
      generationTransition: projectWorkRecordGenerationTransition(generation, {
        persisted: true,
        written: false,
        noOp: true
      }),
      diagnostics: plan.diagnostics
    });
  }

  candidate = structuredClone(candidate);
  candidate.updated = todayDateString();
  const persistedGuard = guardWorkRecordReadySlicePersistedDiff(loaded.record, candidate, {
    allowedPrefixes: plan.allowedPersistedPrefixes
  });
  if (!persistedGuard.ok) {
    return readyCoreResult({
      selectedUnit: plan.selectedUnit,
      sourceDigest: loadedSourceDigest,
      policyFacts: plan.policyFacts,
      generationTransition: projectWorkRecordGenerationTransition(generation),
      diagnostics: [persistedGuard.diagnostic]
    });
  }
  const writeResult = await writeWorkRecordTransaction({
    dir: targetDir,
    record: persistedGuard.normalizedCandidate,
    expectedSourceDigest: loadedSourceDigest,
    expectedPersistenceSnapshotDigest: loadedSnapshotDigest,
    admissionSidecars: [],
    recordStore
  });
  if (!writeResult.written) {
    return readyCoreResult({
      selectedUnit: plan.selectedUnit,
      sourceDigest: loadedSourceDigest,
      policyFacts: plan.policyFacts,
      generationTransition: projectWorkRecordGenerationTransition(generation),
      diagnostics: writeResult.diagnostics ?? []
    });
  }
  const changedFields = [...plan.changedFields];
  if (loaded.record.updated !== persistedGuard.normalizedCandidate.updated) changedFields.push("updated");
  return readyCoreResult({
    contractPersisted: true,
    selectedUnit: plan.selectedUnit,
    changedFields,
    changedPaths: persistedGuard.diffPaths,
    written: true,
    sourceDigest: writeResult.source_digest ?? computeWorkRecordSourceDigest(persistedGuard.normalizedCandidate),
    policyFacts: plan.policyFacts,
    reviewedUnitDigest: afterReviewedDigest,
    generationTransition: projectWorkRecordGenerationTransition(generation, {
      persisted: true,
      written: true,
      noOp: false
    }),
    diagnostics: writeResult.diagnostics ?? []
  });
}

export const readyWorkRecordSliceContractByUnit = readyWorkRecordSliceByUnit;
