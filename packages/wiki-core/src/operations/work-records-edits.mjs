

import path from "node:path";
import { cloneJson, isObject, parseDispatchUnitAddress } from "./work-records-shared.mjs";
import { writeValidatedWorkRecord } from "./work-records-store-io.mjs";
import {
  WORK_RECORD_CLOSURE_FIELD_NAMES,
  WORK_RECORD_STATUS_VALUES,
  computeWorkRecordSourceDigest,
  isForgeConfirmedMergePolicy,
  validateWorkRecord
} from "../lib/work-record-schema.mjs";
import { getWorkRecordPath, loadWorkRecordById } from "../lib/work-record-store.mjs";

function createSelectedUnitProjection(unit) {
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

function prefixSelectedUnitField(unit, fieldPath) {
  return unit.kind === "slice" ? `slices[${unit.slice_id}].${fieldPath}` : fieldPath;
}

function getSelectedTarget(record, unit) {
  if (unit.kind === "slice") {
    return Array.isArray(record.slices)
      ? record.slices.find((entry) => isObject(entry) && entry.id === unit.slice_id) || null
      : null;
  }

  return record;
}

function resolveEffectiveExpectedSourceDigest(expectedSourceDigest, loadedSourceDigest) {
  if (expectedSourceDigest !== null && expectedSourceDigest !== undefined) {
    return expectedSourceDigest;
  }

  return loadedSourceDigest || null;
}

function createInvalidWorkRecordEditResult({ recordId = null, unit = null, diagnostics = [] } = {}) {
  return {
    record_id: recordId,
    selected_unit: createSelectedUnitProjection(unit),
    source_path: null,
    source_path_relative: null,
    source_digest: null,
    diagnostics,
    valid: false,
    written: false,
    no_op: false,
    changed_fields: [],
    status: null,
    task: null,
    canonical_record_path: null
  };
}

function createWorkRecordEditResult({
  loaded,
  selectedUnit,
  sourceDigest,
  diagnostics,
  valid,
  written,
  noOp,
  changedFields,
  status = null,
  task = null,
  canonicalRecordPath = null,
  currentSourceDigest = null,
  expectedSourceDigest = undefined
} = {}) {
  const result = {
    record_id: loaded?.record_id || null,
    selected_unit: createSelectedUnitProjection(selectedUnit),
    source_path: loaded?.source_path || null,
    source_path_relative: loaded?.source_path_relative || null,
    source_digest: sourceDigest,
    diagnostics: diagnostics || [],
    valid: Boolean(valid),
    written: Boolean(written),
    no_op: Boolean(noOp),
    changed_fields: Array.isArray(changedFields) ? changedFields : [],
    status,
    task,
    canonical_record_path: canonicalRecordPath || null
  };

  if (expectedSourceDigest !== undefined) {
    result.expected_source_digest = expectedSourceDigest;
    result.current_source_digest = currentSourceDigest ?? null;
  }

  return result;
}

function createStatusEditNoopResult({ loaded, selectedUnit, sourceDigest, currentStatus, sourcePath }) {
  return createWorkRecordEditResult({
    loaded: {
      record_id: loaded?.record_id || null,
      source_path: sourcePath || loaded?.source_path || null,
      source_path_relative: loaded?.source_path_relative || null
    },
    selectedUnit,
    sourceDigest,
    diagnostics: loaded?.diagnostics || [],
    valid: true,
    written: false,
    noOp: true,
    changedFields: [],
    status: currentStatus,
    task: null,
    canonicalRecordPath: loaded?.canonical_record_path || null
  });
}

function createTaskEditNoopResult({ loaded, selectedUnit, sourceDigest, currentTask, sourcePath }) {
  return createWorkRecordEditResult({
    loaded: {
      record_id: loaded?.record_id || null,
      source_path: sourcePath || loaded?.source_path || null,
      source_path_relative: loaded?.source_path_relative || null
    },
    selectedUnit,
    sourceDigest,
    diagnostics: loaded?.diagnostics || [],
    valid: true,
    written: false,
    noOp: true,
    changedFields: [],
    status: currentTask?.status || null,
    task: currentTask,
    canonicalRecordPath: loaded?.canonical_record_path || null
  });
}

function createEditRefusalResult({ loaded, unit, code, message, fieldPath }) {
  return createWorkRecordEditResult({
    loaded,
    selectedUnit: unit,
    sourceDigest: loaded?.source_digest || null,
    diagnostics: [{ code, severity: "error", message, path: fieldPath }],
    valid: false,
    written: false,
    noOp: false,
    changedFields: [],
    canonicalRecordPath: loaded?.canonical_record_path || null
  });
}

async function loadEditableWorkRecordByUnit({ dir = ".", unitAddress, recordStore = null } = {}) {
  const targetDir = path.resolve(String(dir));
  const requestedUnit = parseDispatchUnitAddress(unitAddress);

  if (!requestedUnit.ok) {
    return {
      ok: false,
      result: createInvalidWorkRecordEditResult({
        diagnostics: [
          {
            code: requestedUnit.error.code,
            severity: "error",
            message: requestedUnit.error.message,
            path: requestedUnit.error.path
          }
        ]
      })
    };
  }

  const loaded = await loadWorkRecordById({
    dir: targetDir,
    id: requestedUnit.recordId,
    recordStore
  });

  if (!loaded.record) {
    return {
      ok: false,
      result: createWorkRecordEditResult({
        loaded,
        selectedUnit: requestedUnit.unit,
        sourceDigest: loaded.source_digest || null,
        diagnostics: loaded.diagnostics,
        valid: false,
        written: false,
        noOp: false,
        changedFields: [],
        status: null,
        task: null,
        canonicalRecordPath: loaded.canonical_record_path || null
      })
    };
  }

  if (loaded.diagnostics?.some((entry) => entry.severity === "error")) {
    return {
      ok: false,
      result: createWorkRecordEditResult({
        loaded,
        selectedUnit: requestedUnit.unit,
        sourceDigest: loaded.source_digest || null,
        diagnostics: loaded.diagnostics,
        valid: false,
        written: false,
        noOp: false,
        changedFields: [],
        status: null,
        task: null,
        canonicalRecordPath: loaded.canonical_record_path || null
      })
    };
  }

  const target = getSelectedTarget(loaded.record, requestedUnit.unit);
  if (!target) {
    return {
      ok: false,
      result: createWorkRecordEditResult({
        loaded,
        selectedUnit: requestedUnit.unit,
        sourceDigest: loaded.source_digest || null,
        diagnostics: [
          ...loaded.diagnostics,
          {
            code: "invalid_record",
            severity: "error",
            message: `Selected slice ${requestedUnit.unit.slice_id} does not exist on ${loaded.record.id}`,
            path: "unit"
          }
        ],
        valid: false,
        written: false,
        noOp: false,
        changedFields: [],
        status: null,
        task: null,
        canonicalRecordPath: loaded.canonical_record_path || null
      })
    };
  }

  return {
    ok: true,
    loaded,
    requestedUnit,
    target,
    sourcePath: loaded.source_path_relative || loaded.source_path
  };
}

export async function setWorkRecordStatusByUnit({
  dir = ".",
  unitAddress,
  status,
  expectedSourceDigest = null,
  recordStore = null
} = {}) {
  const loadedResult = await loadEditableWorkRecordByUnit({
    dir,
    unitAddress,
    recordStore
  });

  if (!loadedResult.ok) {
    return loadedResult.result;
  }

  const { loaded, requestedUnit, target, sourcePath } = loadedResult;
  const normalizedStatus = typeof status === "string" ? status.trim() : "";
  if (!WORK_RECORD_STATUS_VALUES.includes(normalizedStatus)) {
    return createWorkRecordEditResult({
      loaded,
      selectedUnit: requestedUnit.unit,
      sourceDigest: loaded.source_digest || null,
      diagnostics: [
        {
          code: "invalid_status",
          severity: "error",
          message: `Unknown work-record status: ${status}`,
          path: "status"
        }
      ],
      valid: false,
      written: false,
      noOp: false,
      changedFields: [],
      status: null,
      task: null,
      canonicalRecordPath: loaded.canonical_record_path || null
    });
  }

  if (target.status === normalizedStatus) {
    return createStatusEditNoopResult({
      loaded,
      selectedUnit: requestedUnit.unit,
      sourceDigest: loaded.source_digest || null,
      currentStatus: target.status,
      sourcePath
    });
  }

  if (
    requestedUnit.unit.kind === "work_item" &&
    normalizedStatus === "done" &&
    isForgeConfirmedMergePolicy(loaded.record)
  ) {
    return createEditRefusalResult({
      loaded,
      unit: requestedUnit.unit,
      code: "forge_confirmed_completion_required",
      message:
        "completion_policy forge_confirmed_merge requires forge-confirmed closeout; ordinary status mutation cannot set done",
      fieldPath: "status"
    });
  }

  const updatedRecord = cloneJson(loaded.record);
  const updatedTarget = getSelectedTarget(updatedRecord, requestedUnit.unit);
  const fieldPath = prefixSelectedUnitField(requestedUnit.unit, "status");
  updatedTarget.status = normalizedStatus;
  updatedRecord.updated = todayDateString();

  const sourceDigest = computeWorkRecordSourceDigest(updatedRecord);
  const diagnostics = validateWorkRecord(updatedRecord, {
    sourcePath: loaded.source_path,
    sourceDigest
  });
  if (diagnostics.some((entry) => entry.severity === "error")) {
    return createWorkRecordEditResult({
      loaded,
      selectedUnit: requestedUnit.unit,
      sourceDigest,
      diagnostics,
      valid: false,
      written: false,
      noOp: false,
      changedFields: [],
      status: null,
      task: null,
      canonicalRecordPath: loaded.canonical_record_path || null
    });
  }

  const effectiveExpectedSourceDigest = resolveEffectiveExpectedSourceDigest(
    expectedSourceDigest,
    loaded.source_digest
  );

  const writeResult = await writeValidatedWorkRecord({
    dir,
    record: updatedRecord,
    expectedSourceDigest: effectiveExpectedSourceDigest,
    recordStore
  });

  return createWorkRecordEditResult({
    loaded,
    selectedUnit: requestedUnit.unit,
    sourceDigest: writeResult.source_digest || sourceDigest,
    diagnostics: writeResult.diagnostics,
    valid: writeResult.valid,
    written: Boolean(writeResult.written),
    noOp: false,
    changedFields: [fieldPath, "updated"],
    status: normalizedStatus,
    task: null,
    canonicalRecordPath: writeResult.canonical_record_path || getWorkRecordPath(path.resolve(String(dir)), updatedRecord.id),
    currentSourceDigest: writeResult.current_source_digest || null,
    expectedSourceDigest
  });
}

function selectTaskBySelector({ tasks, text, index }) {
  if (text !== undefined && index !== undefined) {
    return {
      ok: false,
      issue: {
        code: "ambiguous_task_selector",
        message: "set-task accepts --text or --index, not both",
        path: "tasks"
      }
    };
  }

  if (text === undefined && index === undefined) {
    return {
      ok: false,
      issue: {
        code: "missing_task_selector",
        message: "set-task requires --text <task text> or --index <n>",
        path: "tasks"
      }
    };
  }

  if (!tasks) {
    return {
      ok: false,
      issue: {
        code: "missing_tasks",
        message: "selected unit has no tasks array",
        path: "sections.tasks"
      }
    };
  }

  if (index !== undefined) {
    const normalizedIndex = typeof index === "number" ? String(index) : String(index || "").trim();
    if (!/^(0|[1-9][0-9]*)$/.test(normalizedIndex)) {
      return {
        ok: false,
        issue: {
          code: "invalid_task_index",
          message: `Task index must be a zero-based integer: ${normalizedIndex}`,
          path: "index"
        }
      };
    }
    const numericIndex = Number(normalizedIndex);
    if (numericIndex < 0 || numericIndex >= tasks.length) {
      return {
        ok: false,
        issue: {
          code: "missing_task",
          message: `Task index ${numericIndex} does not exist`,
          path: "index"
        }
      };
    }
    return { ok: true, index: numericIndex };
  }

  const normalizedText = String(text || "").trim();
  const matches = tasks
    .map((task, taskIndex) => ({ task, taskIndex }))
    .filter(
      ({ task }) =>
        isObject(task) && typeof task.text === "string" && task.text.trim() === normalizedText
    );

  if (matches.length === 0) {
    return {
      ok: false,
      issue: {
        code: "missing_task",
        message: `No task matches text: ${normalizedText}`,
        path: "text"
      }
    };
  }

  if (matches.length > 1) {
    return {
      ok: false,
      issue: {
        code: "ambiguous_task",
        message: `Multiple tasks match text: ${normalizedText}`,
        path: "text"
      }
    };
  }

  return { ok: true, index: matches[0].taskIndex };
}

export async function setWorkRecordTaskByUnit({
  dir = ".",
  unitAddress,
  text = undefined,
  index = undefined,
  expectedSourceDigest = null,
  recordStore = null
} = {}) {
  const loadedResult = await loadEditableWorkRecordByUnit({
    dir,
    unitAddress,
    recordStore
  });

  if (!loadedResult.ok) {
    return loadedResult.result;
  }

  const { loaded, requestedUnit, target, sourcePath } = loadedResult;
  target.sections = isObject(target.sections) ? target.sections : {};
  const tasks = Array.isArray(target.sections.tasks) ? target.sections.tasks : null;
  const selectedTask = selectTaskBySelector({ tasks, text, index });
  if (!selectedTask.ok) {
    return createWorkRecordEditResult({
      loaded,
      selectedUnit: requestedUnit.unit,
      sourceDigest: loaded.source_digest || null,
      diagnostics: [
        {
          code: selectedTask.issue.code,
          severity: "error",
          message: selectedTask.issue.message,
          path: selectedTask.issue.path
        }
      ],
      valid: false,
      written: false,
      noOp: false,
      changedFields: [],
      status: null,
      task: null,
      canonicalRecordPath: loaded.canonical_record_path || null
    });
  }

  const task = tasks[selectedTask.index];
  const currentStatus = typeof task.status === "string" ? task.status : null;
  const currentTaskResult = {
    index: selectedTask.index,
    text: typeof task.text === "string" ? task.text : null,
    status: currentStatus
  };

  if (currentStatus === "done") {
    return createTaskEditNoopResult({
      loaded,
      selectedUnit: requestedUnit.unit,
      sourceDigest: loaded.source_digest || null,
      currentTask: currentTaskResult,
      sourcePath
    });
  }

  const updatedRecord = cloneJson(loaded.record);
  const updatedTarget = getSelectedTarget(updatedRecord, requestedUnit.unit);
  updatedTarget.sections = isObject(updatedTarget.sections) ? updatedTarget.sections : {};
  const updatedTasks = Array.isArray(updatedTarget.sections.tasks) ? updatedTarget.sections.tasks : null;
  const updatedTask = updatedTasks[selectedTask.index];
  const fieldPath = prefixSelectedUnitField(
    requestedUnit.unit,
    `sections.tasks[${selectedTask.index}].status`
  );

  updatedTask.status = "done";
  updatedRecord.updated = todayDateString();

  const sourceDigest = computeWorkRecordSourceDigest(updatedRecord);
  const diagnostics = validateWorkRecord(updatedRecord, {
    sourcePath: loaded.source_path,
    sourceDigest
  });
  if (diagnostics.some((entry) => entry.severity === "error")) {
    return createWorkRecordEditResult({
      loaded,
      selectedUnit: requestedUnit.unit,
      sourceDigest,
      diagnostics,
      valid: false,
      written: false,
      noOp: false,
      changedFields: [],
      status: null,
      task: null,
      canonicalRecordPath: loaded.canonical_record_path || null
    });
  }

  const effectiveExpectedSourceDigest = resolveEffectiveExpectedSourceDigest(
    expectedSourceDigest,
    loaded.source_digest
  );

  const writeResult = await writeValidatedWorkRecord({
    dir,
    record: updatedRecord,
    expectedSourceDigest: effectiveExpectedSourceDigest,
    recordStore
  });

  return createWorkRecordEditResult({
    loaded,
    selectedUnit: requestedUnit.unit,
    sourceDigest: writeResult.source_digest || sourceDigest,
    diagnostics: writeResult.diagnostics,
    valid: writeResult.valid,
    written: Boolean(writeResult.written),
    noOp: false,
    changedFields: [fieldPath, "updated"],
    status: "done",
    task: {
      index: selectedTask.index,
      text: currentTaskResult.text,
      status: "done"
    },
    canonicalRecordPath: writeResult.canonical_record_path || getWorkRecordPath(path.resolve(String(dir)), updatedRecord.id),
    currentSourceDigest: writeResult.current_source_digest || null,
    expectedSourceDigest
  });
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function validateClosurePatch(closurePatch) {
  if (!isObject(closurePatch)) {
    return {
      issue: {
        code: "invalid_closure_payload",
        message: "closure payload must be a top-level object",
        path: "closure"
      }
    };
  }
  if (Object.prototype.hasOwnProperty.call(closurePatch, "schema_version")) {
    return {
      issue: {
        code: "unsupported_schema_version",
        message:
          "closure payload must not declare schema_version; the work-record schema is fixed",
        path: "closure.schema_version"
      }
    };
  }
  const allowed = new Set(WORK_RECORD_CLOSURE_FIELD_NAMES);
  const unknown = Object.keys(closurePatch).filter((key) => !allowed.has(key));
  if (unknown.length) {
    return {
      issue: {
        code: "invalid_closure_payload",
        message: `closure payload contains unsupported field(s): ${unknown.join(", ")}`,
        path: "closure"
      }
    };
  }
  if (!Object.keys(closurePatch).length) {
    return {
      issue: {
        code: "invalid_closure_payload",
        message: "closure payload must include at least one schema-owned field",
        path: "closure"
      }
    };
  }
  if ("summary" in closurePatch && typeof closurePatch.summary !== "string") {
    return {
      issue: {
        code: "invalid_closure_payload",
        message: "closure.summary must be a string",
        path: "closure.summary"
      }
    };
  }
  for (const key of ["validation", "follow_ups"]) {
    if (
      key in closurePatch &&
      (!Array.isArray(closurePatch[key]) ||
        !closurePatch[key].every((entry) => typeof entry === "string"))
    ) {
      return {
        issue: {
          code: "invalid_closure_payload",
          message: `closure.${key} must be an array of strings`,
          path: `closure.${key}`
        }
      };
    }
  }
  return { issue: null };
}

function createInvalidSetClosureResult({ recordId = null, unit = null, diagnostics = [] } = {}) {
  return {
    record_id: recordId,
    selected_unit: unit,
    source_path: null,
    source_path_relative: null,
    source_digest: null,
    record: null,
    diagnostics,
    valid: false,
    written: false,
    canonical_record_path: null,
    no_op: false,
    changed_fields: []
  };
}

export async function setWorkRecordClosureByUnit({
  dir = ".",
  unitAddress,
  closurePatch = null,
  closure_patch = null,
  expectedSourceDigest = null,
  recordStore = null
} = {}) {
  const targetDir = path.resolve(String(dir));
  const requestedUnit = parseDispatchUnitAddress(unitAddress);

  if (!requestedUnit.ok) {
    return createInvalidSetClosureResult({
      diagnostics: [
        {
          code: requestedUnit.error.code,
          severity: "error",
          message: requestedUnit.error.message,
          path: requestedUnit.error.path
        }
      ]
    });
  }

  const patchInput = closurePatch ?? closure_patch;
  const patchCheck = validateClosurePatch(patchInput);
  if (patchCheck.issue) {
    return createInvalidSetClosureResult({
      recordId: requestedUnit.recordId,
      unit: requestedUnit.unit,
      diagnostics: [
        {
          code: patchCheck.issue.code,
          severity: "error",
          message: patchCheck.issue.message,
          path: patchCheck.issue.path
        }
      ]
    });
  }

  const loaded = await loadWorkRecordById({
    dir: targetDir,
    id: requestedUnit.recordId,
    recordStore
  });

  if (!loaded.record) {
    return {
      ...loaded,
      selected_unit: requestedUnit.unit,
      valid: false,
      written: false,
      no_op: false,
      changed_fields: []
    };
  }

  if (loaded.diagnostics?.some((entry) => entry.severity === "error")) {
    return {
      ...loaded,
      selected_unit: requestedUnit.unit,
      valid: false,
      written: false,
      no_op: false,
      changed_fields: []
    };
  }

  const updatedRecord = cloneJson(loaded.record);
  const selectedSlice =
    requestedUnit.unit.kind === "slice"
      ? Array.isArray(updatedRecord.slices)
        ? updatedRecord.slices.find(
            (entry) => isObject(entry) && entry.id === requestedUnit.unit.slice_id
          ) || null
        : null
      : null;

  if (requestedUnit.unit.kind === "slice" && !selectedSlice) {
    return {
      ...loaded,
      selected_unit: requestedUnit.unit,
      valid: false,
      written: false,
      no_op: false,
      changed_fields: [],
      diagnostics: [
        ...loaded.diagnostics,
        {
          code: "invalid_record",
          severity: "error",
          message: `Selected slice ${requestedUnit.unit.slice_id} does not exist on ${updatedRecord.id}`,
          path: "unit"
        }
      ]
    };
  }

  const target = requestedUnit.unit.kind === "slice" ? selectedSlice : updatedRecord;
  target.sections = isObject(target.sections) ? target.sections : {};
  const currentClosureObject = isObject(target.sections.closure)
    ? cloneJson(target.sections.closure)
    : {};
  const nextClosure = {
    ...currentClosureObject,
    ...cloneJson(patchInput)
  };

  const changedKeys = Object.keys(patchInput).filter(
    (key) => JSON.stringify(currentClosureObject[key]) !== JSON.stringify(nextClosure[key])
  );

  if (!changedKeys.length) {
    return {
      ...loaded,
      selected_unit: requestedUnit.unit,
      valid: true,
      written: false,
      no_op: true,
      changed_fields: [],
      record: updatedRecord
    };
  }

  target.sections.closure = nextClosure;
  updatedRecord.updated = todayDateString();

  const effectiveExpectedSourceDigest = resolveEffectiveExpectedSourceDigest(
    expectedSourceDigest,
    loaded.source_digest
  );

  const writeResult = await writeValidatedWorkRecord({
    dir: targetDir,
    record: updatedRecord,
    expectedSourceDigest: effectiveExpectedSourceDigest,
    recordStore
  });

  const prefix =
    requestedUnit.unit.kind === "slice"
      ? `slices[${requestedUnit.unit.slice_id}].sections.closure`
      : "sections.closure";
  const changedFields = changedKeys.map((key) => `${prefix}.${key}`);
  changedFields.push("updated");

  return {
    ...loaded,
    ...writeResult,
    selected_unit: requestedUnit.unit,
    diagnostics: writeResult.diagnostics,
    record: updatedRecord,
    source_digest: writeResult.source_digest,
    valid: writeResult.valid,
    written: Boolean(writeResult.written),
    no_op: false,
    changed_fields: changedFields,
    canonical_record_path:
      writeResult.canonical_record_path || getWorkRecordPath(targetDir, updatedRecord.id),
    closure: nextClosure
  };
}
