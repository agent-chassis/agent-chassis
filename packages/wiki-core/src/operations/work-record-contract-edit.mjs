

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
import { resolveWorkRecordEntryContent } from "../lib/work-record-entry-content.mjs";
import {
  validateWorkRecordEntryContent,
  workRecordEditUsesEntryContent
} from "../lib/work-record-entry-schema.mjs";
import {
  WORK_RECORD_EDIT_FIELD_REGISTRY,
  WORK_RECORD_CONTRACT_EDIT_OPERATIONS,
  applyWorkRecordContractEdit,
  assignWorkRecordToInitiative,
  guardInitiativeAssignmentPersistedDiff,
  guardWorkRecordReadySlicePersistedDiff,
  planWorkRecordReadySlice,
  parseWorkRecordUnitAddress,
  resolveWorkRecordEditRegistryEntry,
  validateWorkRecordProseDestination,
  workRecordProseRegistryEntries,
  validateWorkRecordReadySliceRequest
} from "../lib/work-record-contract-edit.mjs";
import { computeReviewedUnitSourceDigest } from "../lib/work-record-review-attestation.mjs";
import { ASSIGN_WORK_RECORD_TO_INITIATIVE_OPERATION } from "../lib/work-record-contract-edit-shared.mjs";
import { setWorkRecordTaskByUnit, writeValidatedWorkRecord } from "./work-records.mjs";
import {
  computeWorkRecordPersistenceSnapshotDigest,
  writeValidatedWorkRecordWithAdmissionSidecars
} from "./work-records-store-io.mjs";
import { withWorkRecordWriteLock } from "./work-record-write-lock.mjs";
import {
  WORK_RECORD_PERSISTENCE_PHASES,
  WORK_RECORD_PUBLICATION_STATES,
  appendWorkRecordPersistenceFailure
} from "./work-record-persistence-diagnostics.mjs";

export { WORK_RECORD_CONTRACT_EDIT_OPERATIONS };

export { ASSIGN_WORK_RECORD_TO_INITIATIVE_OPERATION };
export const EDIT_WORK_RECORD_OPERATION = "edit_work_record";

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
  ok = undefined,
  publicationState = undefined,
  diagnosticCount = undefined,
  failedFault = undefined,
  effectTrace = undefined,
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
    written: written === null ? null : Boolean(written),
    no_op: Boolean(noOp),
    changed_fields: Array.isArray(changedFields) ? changedFields : [],
    diagnostics: Array.isArray(diagnostics) ? diagnostics : [],
    canonical_record_path: canonicalRecordPath,
    next_action: nextAction,
    policy_facts: collectWorkRecordControlledContractPrivateScopeFacts(
      record ?? loaded?.record ?? null
    )
  };
  if (ok !== undefined) result.ok = Boolean(ok);
  if (publicationState !== undefined) result.publication_state = publicationState;
  if (diagnosticCount !== undefined) result.diagnostic_count = diagnosticCount;
  if (failedFault !== undefined) result.failed_fault = failedFault;
  if (effectTrace !== undefined) result.effect_trace = effectTrace;
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

function buildPlannerParams(operation, params, unit, repository) {
  const sliceId = unit.kind === "slice" ? unit.slice_id : null;
  switch (operation) {
    case "upsert_slice":
      return { slice: params.slice };
    case "delete_slice":
      return { sliceId: params.slice_id ?? params.sliceId ?? sliceId ?? undefined };
    case "edit_work_record":
      return { sliceId, edit: params.edit, repository };
    case "set_list_field":

      return { sliceId, field: params.field, values: params.values, mode: params.mode, repository };
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
          message: `${operation} accepts record-level WK selectors only`,
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
  let nextAction;
  if (writeResult.ok === false && writeResult.publication_state === "published") {
    nextAction = "the assignment was published but persistence did not finish cleanly; inspect the canonical record with workspace_read_page and do not repeat the write";
  } else if (writeResult.publication_state === "unknown") {
    nextAction = "publication is unknown; inspect the canonical record with workspace_read_page before deciding any later mutation and do not repeat the write";
  } else if (writeResult.written) {
    nextAction = "assignment persisted; initiative membership is derived from WK.initiative";
  } else if (isStale) {
    nextAction = `reload ${parsed.recordId} and retry with the current source digest`;
  } else {
    nextAction = "the validated WK write was refused; resolve the reported diagnostics and retry";
  }

  return buildResult({
    operation,
    recordId: parsed.recordId,
    unit: parsed.unit,
    loaded,
    diagnostics: writeResult.diagnostics || [],
    sourceDigest: writeResult.publication_state === "unknown"
      ? null
      : writeResult.source_digest ??
        computeWorkRecordSourceDigest(persistedDiffGuard.normalizedCandidate),
    valid: Boolean(writeResult.valid),
    written: writeResult.written,
    noOp: false,
    ok: writeResult.ok,
    publicationState: writeResult.publication_state,
    diagnosticCount: writeResult.diagnostic_count,
    failedFault: writeResult.failed_fault,
    effectTrace: writeResult.effect_trace,
    changedFields: writeResult.written === true ? ["initiative"] : [],
    canonicalRecordPath:
      writeResult.canonical_record_path || getWorkRecordPath(targetDir, parsed.recordId),
    nextAction,
    expectedSourceDigest: expected === null || expected === undefined ? undefined : expected,
    currentSourceDigest: writeResult.current_source_digest || null,
    verbose,
    record: persistedDiffGuard.normalizedCandidate
  });
}

export async function editWorkRecordByUnit(options = {}) {
  const { edit = null } = options;
  const parsed = parseWorkRecordUnitAddress(options.unitAddress);
  const registryResolution = parsed.ok && edit && typeof edit === "object"
    ? resolveWorkRecordEditRegistryEntry({
      field: edit.field,
      kind: edit.kind,
      sliceId: parsed.unit.kind === "slice" ? parsed.unit.slice_id : null
    })
    : null;
  if (registryResolution?.ok && workRecordEditUsesEntryContent(registryResolution.entry, edit.action)) {
    return editWorkRecordWithResolvedContent({ ...options, parsed, entry: registryResolution.entry });
  }
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
      recordStore: options.recordStore ?? null,
      writeWorkRecord: options.writeWorkRecord
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

function proseContentDiagnostic(diagnostic, path) {
  const suffix = typeof diagnostic?.path === "string"
    ? diagnostic.path.replace(/^(?:value|content|ref)/u, "")
    : "";
  return { ...diagnostic, path: `${path}${suffix}` };
}

function proseWriteRefusal({ operation, parsed, diagnostic, expectedSourceDigest = null }) {
  return buildResult({
    operation,
    recordId: parsed?.recordId ?? null,
    unit: parsed?.unit ?? null,
    diagnostics: [diagnostic],
    valid: false,
    written: false,
    noOp: false,
    changedFields: [],
    expectedSourceDigest: expectedSourceDigest ?? undefined,
    nextAction:
      "supply the registry-declared closed {text}, {ref}, or nonempty flat {parts} carrier"
  });
}

async function resolveProseCarrier({
  content,
  path: contentPath,
  field,
  scope,
  repository,
  dir,
  loadSourceWorkRecordById
}) {
  const shape = validateWorkRecordEntryContent(content, { path: contentPath });
  if (!shape.ok) return shape;
  const resolved = await resolveWorkRecordEntryContent({
    content,
    repository,
    dir,
    loadWorkRecordById: loadSourceWorkRecordById ?? loadWorkRecordById
  });
  if (!resolved.ok) {
    return { ...resolved, diagnostic: proseContentDiagnostic(resolved.diagnostic, contentPath) };
  }
  const destination = validateWorkRecordProseDestination({
    field,
    scope,
    value: resolved.value,
    path: contentPath
  });
  if (!destination.ok) return destination;
  return { ...resolved, value: destination.value };
}

export async function upsertWorkRecordSliceByUnit(options = {}) {
  const operation = "upsert_slice";
  const parsed = parseWorkRecordUnitAddress(options.unitAddress);
  const expected = options.expectedSourceDigest ?? options.expected_source_digest ?? null;
  const slice = options.slice ?? options.params?.slice;
  if (!parsed.ok) {
    return editWorkRecordContractByUnit({ ...options, operation, params: { slice } });
  }
  const prose = workRecordProseRegistryEntries("slice").filter(({ canonical_address }) =>
    slice?.sections && Object.hasOwn(slice.sections, canonical_address.at(-1))
  );
  for (const entry of prose) {
    const key = entry.canonical_address.at(-1);
    const shape = validateWorkRecordEntryContent(slice.sections[key], {
      path: `slice.sections.${key}`
    });
    if (!shape.ok) return proseWriteRefusal({ operation, parsed, diagnostic: shape.diagnostic,
      expectedSourceDigest: expected });
  }
  if (prose.length === 0) {
    return editWorkRecordContractByUnit({
      ...options,
      operation,
      params: { slice }
    });
  }
  const targetDir = path.resolve(String(options.dir ?? "."));
  const execute = async () => {
    const resolvedSlice = structuredClone(slice);
    let targetRepository = options.repository ?? null;
    if (targetRepository === null) {
      const target = await loadWorkRecordById({
        dir: targetDir,
        id: parsed.recordId,
        recordStore: options.recordStore ?? null
      });
      targetRepository = target.record?.repo ?? null;
    }
    for (const entry of prose) {
      const key = entry.canonical_address.at(-1);
      const resolved = await resolveProseCarrier({
        content: slice.sections[key],
        path: `slice.sections.${key}`,
        field: entry.field,
        scope: "slice",
        repository: targetRepository,
        dir: targetDir,
        loadSourceWorkRecordById: options.loadSourceWorkRecordById
      });
      if (!resolved.ok) return proseWriteRefusal({ operation, parsed,
        diagnostic: resolved.diagnostic, expectedSourceDigest: expected });
      resolvedSlice.sections[key] = resolved.value;
    }
    const writer = options.writeWorkRecord ?? writeValidatedWorkRecord;
    const lockedWriter = writeOptions => writer({ ...writeOptions, lockAlreadyHeld: true });
    return editWorkRecordContractByUnit({
      ...options,
      dir: targetDir,
      operation,
      params: { slice: resolvedSlice },
      expectedSourceDigest: expected,
      writeWorkRecord: lockedWriter
    });
  };
  const lockOutcome = await withWorkRecordWriteLock(targetDir, execute, { settle: true,
    faultInjector: options.persistenceEffects?.lockFaultInjector ?? null });
  if (lockOutcome.acquisition_error) return persistenceFailureBase({ parsed,
    error: lockOutcome.acquisition_error, phase: WORK_RECORD_PERSISTENCE_PHASES.LOCK_ACQUISITION,
    expectedSourceDigest: expected, targetDir });
  if (lockOutcome.callback_error) return persistenceFailureBase({ parsed,
    error: lockOutcome.callback_error, phase: WORK_RECORD_PERSISTENCE_PHASES.TRANSACTION_PREPARATION,
    expectedSourceDigest: expected, targetDir });
  let result = lockOutcome.value;
  if (lockOutcome.release_error) result = appendWorkRecordPersistenceFailure(result, {
    phase: WORK_RECORD_PERSISTENCE_PHASES.LOCK_RELEASE,
    cause: lockOutcome.release_error,
    publicationState: result?.publication_state ?? WORK_RECORD_PUBLICATION_STATES.NOT_PUBLISHED,
    failureRole: result?.ok === false ? "secondary" : "primary",
    recordId: parsed?.recordId ?? null,
    canonicalRecordPath: parsed?.recordId ? getWorkRecordPath(targetDir, parsed.recordId) : null
  });
  return result;
}

function contentEditInputRefusal({ parsed, diagnostic, expectedSourceDigest = null }) {
  return buildResult({
    operation: EDIT_WORK_RECORD_OPERATION,
    recordId: parsed?.recordId ?? null,
    unit: parsed?.unit ?? null,
    diagnostics: [diagnostic],
    valid: false,
    written: false,
    noOp: false,
    changedFields: [],
    expectedSourceDigest: expectedSourceDigest ?? undefined,
    nextAction: "supply the closed exact-content value required by this enrolled field"
  });
}

function persistenceFailureBase({ parsed, error, phase, expectedSourceDigest, targetDir }) {
  const canonicalRecordPath = parsed?.recordId ? getWorkRecordPath(targetDir, parsed.recordId) : null;
  const failed = appendWorkRecordPersistenceFailure({
    operation: EDIT_WORK_RECORD_OPERATION,
    record_id: parsed?.recordId ?? null,
    selected_unit: selectedUnitProjection(parsed?.unit ?? null),
    valid: false,
    written: false,
    no_op: false,
    changed_fields: [],
    diagnostics: [],
    source_digest: null,
    canonical_record_path: canonicalRecordPath
  }, {
    phase,
    cause: error,
    publicationState: WORK_RECORD_PUBLICATION_STATES.NOT_PUBLISHED,
    recordId: parsed?.recordId ?? null,
    canonicalRecordPath
  });
  if (expectedSourceDigest !== null && expectedSourceDigest !== undefined) {
    failed.expected_source_digest = expectedSourceDigest;
    failed.current_source_digest = null;
  }
  failed.next_action = "resolve the reported persistence failure before retrying the edit";
  return failed;
}

async function editWorkRecordWithResolvedContent(options) {
  const { edit, parsed, entry } = options;
  const shape = validateWorkRecordEntryContent(edit.value);
  if (!shape.ok) {
    return contentEditInputRefusal({ parsed, diagnostic: shape.diagnostic,
      expectedSourceDigest: options.expectedSourceDigest ?? options.expected_source_digest ?? null });
  }
  const allowedKeys = new Set(["kind", "field", "action", "value", "text", "index"]);
  const unknown = Object.keys(edit).find((key) => !allowedKeys.has(key));
  if (unknown) {
    return contentEditInputRefusal({ parsed, diagnostic: {
      code: "unbounded_edit_request", severity: "error", authority_limb: "mechanical",
      message: `edit.${unknown} is not accepted`, path: `edit.${unknown}`
    } });
  }
  const targetDir = path.resolve(String(options.dir ?? "."));
  const expected = options.expectedSourceDigest ?? options.expected_source_digest ?? null;
  const execute = async () => {
    const resolved = await resolveWorkRecordEntryContent({
      content: edit.value,
      repository: options.repository ?? null,
      dir: targetDir,
      loadWorkRecordById: options.loadSourceWorkRecordById ?? loadWorkRecordById
    });
    if (!resolved.ok) {
      const refusal = contentEditInputRefusal({ parsed, diagnostic: resolved.diagnostic,
        expectedSourceDigest: expected });
      if (Object.hasOwn(resolved, "current_source_digest")) {
        refusal.reference_expected_source_digest = resolved.expected_source_digest;
        refusal.reference_current_source_digest = resolved.current_source_digest;
      }
      return refusal;
    }
    const taskMinLength = entry.kind === "task" ? entry.value_schema[edit.action]?.min_length ?? 0 : 0;
    if (entry.kind === "task" &&
        (resolved.value.length < taskMinLength || resolved.value.trim() !== resolved.value)) {
      return contentEditInputRefusal({ parsed, diagnostic: {
        code: "work_record_content_destination_normalization_refused",
        severity: "error",
        authority_limb: "mechanical",
        message: taskMinLength > 0
          ? `${edit.action} task text must be nonempty and have no leading or trailing whitespace; destination normalization would alter the exact content`
          : `${edit.action} task text must have no leading or trailing whitespace; destination normalization would alter the exact content`,
        path: "value"
      }, expectedSourceDigest: expected });
    }
    const writer = options.writeWorkRecord ?? writeValidatedWorkRecord;
    const lockedWriter = (writeOptions) => writer({
      ...writeOptions,
      persistenceEffects: options.persistenceEffects ?? writeOptions.persistenceEffects ?? {},
      lockAlreadyHeld: true
    });
    const resolvedEdit = { ...edit, value: resolved.value };
    if (entry.kind === "task") {
      const taskResult = await setWorkRecordTaskByUnit({
        dir: targetDir,
        unitAddress: options.unitAddress,
        action: resolvedEdit.action,
        text: resolvedEdit.text,
        index: resolvedEdit.index,
        value: resolvedEdit.value,
        expectedSourceDigest: expected,
        recordStore: options.recordStore ?? null,
        writeWorkRecord: lockedWriter
      });
      return {
        operation: EDIT_WORK_RECORD_OPERATION,
        ...taskResult,
        next_action: taskResult.written
          ? "edit persisted; rerun validation if the record is now ready to dispatch"
          : taskResult.no_op
            ? "no change needed; the record already matches the requested edit"
            : "fix the reported diagnostics and retry the edit"
      };
    }
    return editWorkRecordContractByUnit({
      dir: targetDir,
      unitAddress: options.unitAddress,
      operation: EDIT_WORK_RECORD_OPERATION,
      params: { edit: resolvedEdit },
      expectedSourceDigest: expected,
      recordStore: options.recordStore ?? null,
      writeWorkRecord: lockedWriter,
      verbose: Boolean(options.verbose)
    });
  };

  const lockOutcome = await withWorkRecordWriteLock(targetDir, execute, {
    settle: true,
    faultInjector: options.persistenceEffects?.lockFaultInjector ?? null
  });
  if (lockOutcome.acquisition_error) {
    return persistenceFailureBase({ parsed, error: lockOutcome.acquisition_error,
      phase: WORK_RECORD_PERSISTENCE_PHASES.LOCK_ACQUISITION, expectedSourceDigest: expected,
      targetDir });
  }
  if (lockOutcome.callback_error) {
    return persistenceFailureBase({ parsed, error: lockOutcome.callback_error,
      phase: WORK_RECORD_PERSISTENCE_PHASES.TRANSACTION_PREPARATION, expectedSourceDigest: expected,
      targetDir });
  }
  let result = lockOutcome.value;
  if (lockOutcome.release_error) {
    result = appendWorkRecordPersistenceFailure(result, {
      phase: WORK_RECORD_PERSISTENCE_PHASES.LOCK_RELEASE,
      cause: lockOutcome.release_error,
      publicationState: result?.publication_state ?? WORK_RECORD_PUBLICATION_STATES.NOT_PUBLISHED,
      failureRole: result?.ok === false ? "secondary" : "primary",
      recordId: parsed.recordId,
      canonicalRecordPath: result?.canonical_record_path ?? getWorkRecordPath(targetDir, parsed.recordId)
    });
  }
  return result;
}

export async function editWorkRecordContractByUnit({
  dir = ".",
  unitAddress,
  operation,
  params = {},
  expectedSourceDigest = null,
  expected_source_digest = null,
  recordStore = null,
  writeWorkRecord = writeValidatedWorkRecord,
  verbose = false,

  repository = null
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

  if ((loaded.diagnostics || []).some((entry) => entry.severity === "error")) {
    return buildResult({
      operation,
      recordId: parsed.recordId,
      unit: parsed.unit,
      loaded,
      diagnostics: loaded.diagnostics,
      sourceDigest: loaded.source_digest || null,
      nextAction: "the base work record is invalid; no ordinary edit may proceed until the reported diagnostics are resolved",
      verbose
    });
  }

  const plannerParams = buildPlannerParams(operation, params || {}, parsed.unit, repository);
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

  const updatedRecord = plan.updatedRecord;
  updatedRecord.updated = todayDateString();
  const changedFields = [...plan.changedFields, "updated"];

  const effectiveExpectedSourceDigest =
    expected !== null && expected !== undefined ? expected : loaded.source_digest || null;

  const writeResult = await writeWorkRecord({
    dir: targetDir,
    record: updatedRecord,
    expectedSourceDigest: effectiveExpectedSourceDigest,
    recordStore
  });

  const isStale = writeResult.diagnostics?.some((entry) => entry.code === "stale_source_digest");
  const canonicalRecordPath =
    writeResult.canonical_record_path || getWorkRecordPath(targetDir, updatedRecord.id);

  let nextAction;
  if (writeResult.ok === false && writeResult.publication_state === "published") {
    nextAction = "the edit was published but persistence did not finish cleanly; inspect the canonical record with workspace_read_page and do not repeat the write";
  } else if (writeResult.publication_state === "unknown") {
    nextAction = "publication is unknown; inspect the canonical record with workspace_read_page before deciding any later mutation and do not repeat the write";
  } else if (writeResult.written) {
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
    sourceDigest: writeResult.publication_state === "unknown"
      ? null
      : operation === EDIT_WORK_RECORD_OPERATION && writeResult.publication_state === "not_published"
        ? writeResult.current_source_digest ?? null
        : writeResult.source_digest ?? computeWorkRecordSourceDigest(updatedRecord),
    valid: Boolean(writeResult.valid),
    written: writeResult.written,
    noOp: false,
    ok: writeResult.ok,
    publicationState: writeResult.publication_state,
    diagnosticCount: writeResult.diagnostic_count,
    failedFault: writeResult.failed_fault,
    effectTrace: writeResult.effect_trace,
    changedFields: operation === EDIT_WORK_RECORD_OPERATION && writeResult.written !== true ? [] : changedFields,
    canonicalRecordPath,
    nextAction,
    expectedSourceDigest: expected === null || expected === undefined ? undefined : expected,
    currentSourceDigest: writeResult.current_source_digest || null,
    verbose,
    record: operation === EDIT_WORK_RECORD_OPERATION && writeResult.written !== true ? null : updatedRecord,
    generationTransition: projectWorkRecordGenerationTransition(generation, {
      persisted: writeResult.written === true,
      written: writeResult.written === true,
      noOp: false
    })
  });
}

export const READY_WORK_RECORD_SLICE_OPERATION = "ready_work_record_slice";
const READY_RESULT_PATH_LIMIT = 64;

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
  policyFacts = [],
  ok = undefined,
  publicationState = undefined,
  failedFault = undefined,
  effectTrace = undefined,
  admissionSidecarPublications = undefined,
  admissionSidecarCleanup = undefined,
  nextAction = undefined
} = {}) {
  const completeDiagnostics = Array.isArray(diagnostics) ? diagnostics : [];
  const result = {
    contract_persisted: contractPersisted === null ? null : Boolean(contractPersisted),
    selected_unit: selectedUnit,
    changed_fields: changedFields.slice(0, READY_RESULT_PATH_LIMIT),
    changed_paths: changedPaths.slice(0, READY_RESULT_PATH_LIMIT),
    written: written === null ? null : Boolean(written),
    no_op: Boolean(noOp),
    source_digest: sourceDigest,
    reviewed_unit_digest: reviewedUnitDigest,
    generation_transition: generationTransition,
    diagnostics: completeDiagnostics,
    diagnostic_count: completeDiagnostics.length,
    policy_facts: policyFacts
  };
  if (ok !== undefined) result.ok = Boolean(ok);
  if (publicationState !== undefined) result.publication_state = publicationState;
  if (failedFault !== undefined) result.failed_fault = failedFault;
  if (effectTrace !== undefined) result.effect_trace = effectTrace;
  if (admissionSidecarPublications !== undefined) {
    result.admission_sidecar_publications = admissionSidecarPublications;
  }
  if (admissionSidecarCleanup !== undefined) {
    result.admission_sidecar_cleanup = admissionSidecarCleanup;
  }
  if (nextAction !== undefined) result.next_action = nextAction;
  return result;
}
function readyDiagnostic(code, message, pathValue = null) {
  return { code, severity: "error", message, path: pathValue };
}

async function readyWorkRecordSliceResolvedByUnit(options = {}) {
  const {
    dir = ".",
    request: nestedRequest = null,
    recordStore = null,
    writeWorkRecordTransaction = writeValidatedWorkRecordWithAdmissionSidecars,
    lockAlreadyHeld = false,

    repository = null,
    ...topLevelRequest
  } = options;
  if (nestedRequest !== null && Object.keys(topLevelRequest).length > 0) {
    return readyCoreResult({
      diagnostics: [readyDiagnostic("ready_slice_ambiguous_request", "supply ready-slice fields either in request or at top level, not both")]
    });
  }
  const request = nestedRequest ?? topLevelRequest;
  const preflight = validateWorkRecordReadySliceRequest(request, { resolvedProse: true });
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

  const plan = planWorkRecordReadySlice(loaded.record, request, { repository });
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
    recordStore,
    lockAlreadyHeld
  });
  if (writeResult.ok === false || writeResult.written !== true) {
    const publicationState = writeResult.publication_state;
    const contractPersisted = publicationState === "published"
      ? true
      : publicationState === "unknown"
        ? null
        : false;
    const published = publicationState === "published";
    const changedFields = published
      ? [...plan.changedFields,
          ...(loaded.record.updated !== persistedGuard.normalizedCandidate.updated ? ["updated"] : [])]
      : [];
    return readyCoreResult({
      contractPersisted,
      selectedUnit: plan.selectedUnit,
      changedFields,
      changedPaths: published ? persistedGuard.diffPaths : [],
      written: writeResult.written,
      noOp: false,
      ok: false,
      publicationState,
      sourceDigest: publicationState === "unknown"
        ? null
        : published
          ? writeResult.source_digest ?? null
          : loadedSourceDigest,
      reviewedUnitDigest: published ? afterReviewedDigest : null,
      policyFacts: plan.policyFacts,
      generationTransition: projectWorkRecordGenerationTransition(generation, {
        persisted: published,
        written: published,
        noOp: false
      }),
      diagnostics: writeResult.diagnostics ?? [],
      failedFault: writeResult.failed_fault,
      effectTrace: writeResult.effect_trace,
      admissionSidecarPublications: writeResult.admission_sidecar_publications,
      admissionSidecarCleanup: writeResult.admission_sidecar_cleanup,
      nextAction: writeResult.next_action
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
    ok: true,
    publicationState: writeResult.publication_state ?? "published",
    sourceDigest: writeResult.source_digest ?? computeWorkRecordSourceDigest(persistedGuard.normalizedCandidate),
    policyFacts: plan.policyFacts,
    reviewedUnitDigest: afterReviewedDigest,
    generationTransition: projectWorkRecordGenerationTransition(generation, {
      persisted: true,
      written: true,
      noOp: false
    }),
    diagnostics: writeResult.diagnostics ?? [],
    failedFault: writeResult.failed_fault,
    effectTrace: writeResult.effect_trace,
    admissionSidecarPublications: writeResult.admission_sidecar_publications,
    admissionSidecarCleanup: writeResult.admission_sidecar_cleanup
  });
}

export async function readyWorkRecordSliceByUnit(options = {}) {
  const {
    dir = ".",
    request: nestedRequest = null,
    repository = null,
    ...topLevelRequest
  } = options;
  if (nestedRequest !== null && Object.keys(topLevelRequest).some((key) =>
    !["recordStore", "writeWorkRecordTransaction", "loadSourceWorkRecordById",
      "persistenceEffects"].includes(key))) {
    return readyCoreResult({ diagnostics: [readyDiagnostic(
      "ready_slice_ambiguous_request",
      "supply ready-slice fields either in request or at top level, not both"
    )] });
  }
  const request = nestedRequest ?? Object.fromEntries(Object.entries(topLevelRequest)
    .filter(([key]) => !["recordStore", "writeWorkRecordTransaction",
      "loadSourceWorkRecordById", "persistenceEffects"].includes(key)));
  const preflight = validateWorkRecordReadySliceRequest(request);
  if (!preflight.ok) return readyCoreResult({ diagnostics: preflight.diagnostics });
  const prose = workRecordProseRegistryEntries("slice").filter(({ canonical_address }) =>
    Object.hasOwn(request, canonical_address.at(-1))
  );
  if (prose.length === 0) return readyWorkRecordSliceResolvedByUnit(options);
  const targetDir = path.resolve(String(dir));
  const execute = async () => {
    const resolvedRequest = structuredClone(request);
    for (const entry of prose) {
      const key = entry.canonical_address.at(-1);
      const resolved = await resolveProseCarrier({
        content: request[key],
        path: key,
        field: entry.field,
        scope: "slice",
        repository,
        dir: targetDir,
        loadSourceWorkRecordById: options.loadSourceWorkRecordById
      });
      if (!resolved.ok) return readyCoreResult({ diagnostics: [resolved.diagnostic] });
      resolvedRequest[key] = resolved.value;
    }
    return readyWorkRecordSliceResolvedByUnit({
      dir: targetDir,
      request: resolvedRequest,
      recordStore: options.recordStore ?? null,
      writeWorkRecordTransaction: options.writeWorkRecordTransaction ??
        writeValidatedWorkRecordWithAdmissionSidecars,
      repository,
      lockAlreadyHeld: true
    });
  };
  const lockOutcome = await withWorkRecordWriteLock(targetDir, execute, { settle: true,
    faultInjector: options.persistenceEffects?.lockFaultInjector ?? null });
  if (lockOutcome.acquisition_error) return readyCoreResult({ diagnostics: [readyDiagnostic(
    "work_record_lock_acquisition_failed", lockOutcome.acquisition_error.message, null)] });
  if (lockOutcome.callback_error) return readyCoreResult({ diagnostics: [readyDiagnostic(
    "work_record_transaction_preparation_failed", lockOutcome.callback_error.message, null)] });
  let result = lockOutcome.value;
  if (lockOutcome.release_error) result = appendWorkRecordPersistenceFailure(result, {
    phase: WORK_RECORD_PERSISTENCE_PHASES.LOCK_RELEASE,
    cause: lockOutcome.release_error,
    publicationState: result?.publication_state ?? WORK_RECORD_PUBLICATION_STATES.NOT_PUBLISHED,
    failureRole: result?.ok === false ? "secondary" : "primary",
    recordId: request.unit ?? null,
    canonicalRecordPath: request.unit ? getWorkRecordPath(targetDir, request.unit) : null
  });
  return result;
}

export const readyWorkRecordSliceContractByUnit = readyWorkRecordSliceByUnit;
