

import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  WORK_RECORD_CLOSURE_FIELD_NAMES,
  WORK_RECORD_SCHEMA_VERSION,
  WORK_RECORD_STATUS_VALUES
} from "@agent-chassis/wiki-core";
import { parseArgs } from "../../lib/cli.mjs";
import {
  cloneJson,
  createDiagnostic,
  isObject,
  parseJsonValue,
  readEditOption,
  readOptionalExpectedSourceDigest,
  readOptionalSchemaVersion,
  rejectUnknownEditOptions,
  todayDateString
} from "./options.mjs";
import {
  createBaseEditResult,
  failEditResult,
  getSelectedTarget,
  loadEditableRecord,
  persistEditResult,
  prefixField,
  printEditResult,
  selectEditUnit
} from "./edit-core.mjs";

export async function runSetStatus(argv) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log(
      "Usage: wiki work-records set-status --unit <WK-0001|WK-0001#slice-id> --status <status> [--id <WK-0001>] [--expected-source-digest <sha256:...>] [--dir <path>] [--json]\n" +
        "Update one record or slice status with schema validation. Use --unit for slice addresses.\n" +
        "Pass --expected-source-digest to refuse the write if the on-disk record source digest no longer matches."
    );
    return;
  }

  const command = "set-status";
  const targetDir = path.resolve(String(options.dir || "."));
  const unknownOption = rejectUnknownEditOptions(options, command, argv);
  if (unknownOption) {
    failEditResult({ command, options, diagnostic: unknownOption });
    return;
  }
  const schemaVersion = readOptionalSchemaVersion(argv, options, command);
  if (!schemaVersion.ok) {
    failEditResult({ command, options, diagnostic: schemaVersion.diagnostic });
    return;
  }
  const selected = selectEditUnit(argv, options, command);
  if (!selected.ok) {
    failEditResult({ command, options, diagnostic: selected.diagnostic });
    return;
  }
  const unit = selected.unit;
  const statusOption = readEditOption(argv, options, "status", { command });
  if (!statusOption.ok) {
    failEditResult({ command, options, unit, diagnostic: statusOption.diagnostic });
    return;
  }
  const status = statusOption.value;
  if (!WORK_RECORD_STATUS_VALUES.includes(status)) {
    failEditResult({
      command,
      options,
      unit,
      diagnostic: createDiagnostic("invalid_status", `Unknown work-record status: ${status}`, { path: "status" })
    });
    return;
  }
  const expectedDigest = readOptionalExpectedSourceDigest(argv, options, command);
  if (!expectedDigest.ok) {
    failEditResult({ command, options, unit, diagnostic: expectedDigest.diagnostic });
    return;
  }
  const expectedSourceDigest = expectedDigest.value;

  const loadedResult = await loadEditableRecord({ dir: targetDir, unit, command, options });
  if (!loadedResult.ok) {
    return;
  }
  const { loaded } = loadedResult;
  const record = cloneJson(loaded.record);
  const target = getSelectedTarget(record, unit);
  const fieldPath = prefixField(unit, "status");
  const sourcePath = loaded.source_path_relative || loaded.source_path;

  if (target.status === status) {
    printEditResult(
      createBaseEditResult({
        command,
        unit,
        sourcePath,
        changedFields: [],
        previous: {},
        next: {},
        valid: true,
        written: false,
        noOp: true
      }),
      { json: Boolean(options.json) }
    );
    return;
  }

  const previous = {
    [fieldPath]: target.status
  };
  target.status = status;
  previous.updated = record.updated;
  record.updated = todayDateString();

  await persistEditResult({
    command,
    options,
    targetDir,
    unit,
    record,
    sourcePath,
    changedFields: [fieldPath, "updated"],
    previous,
    next: {
      [fieldPath]: status,
      updated: record.updated
    },
    expectedSourceDigest
  });
}

async function parseClosurePatch(argv, options) {
  const hasJsonFile = options["json-file"] !== undefined;
  const flagKeys = ["summary", "validation-json", "follow-ups-json"].filter((key) => options[key] !== undefined);
  if (hasJsonFile && flagKeys.length) {
    return {
      ok: false,
      diagnostic: createDiagnostic(
        "ambiguous_closure_input",
        "set-closure accepts either --json-file or closure field flags, not both",
        { path: "closure" }
      )
    };
  }

  let patch;
  if (hasJsonFile) {
    const fileOption = readEditOption(argv, options, "json-file", {
      command: "set-closure",
      allowDashValue: true
    });
    if (!fileOption.ok) {
      return fileOption;
    }
    const filePath = fileOption.value;
    let text;
    try {
      text = await readFile(filePath, "utf8");
    } catch (error) {
      return {
        ok: false,
        diagnostic: createDiagnostic("closure_json_unreadable", "Unable to read closure JSON file", {
          path: "json-file"
        })
      };
    }
    const parsed = parseJsonValue(text, { fieldName: "json-file" });
    if (!parsed.ok) {
      return parsed;
    }
    patch = parsed.value;
  } else {
    patch = {};
    if (options.summary !== undefined) {
      const summaryOption = readEditOption(argv, options, "summary", {
        command: "set-closure",
        allowEmpty: true,
        allowDashValue: true
      });
      if (!summaryOption.ok) {
        return summaryOption;
      }
      patch.summary = summaryOption.value;
    }
    if (options["validation-json"] !== undefined) {
      const option = readEditOption(argv, options, "validation-json", { command: "set-closure" });
      if (!option.ok) {
        return option;
      }
      const parsed = parseJsonValue(option.value, { fieldName: "validation-json" });
      if (!parsed.ok) {
        return parsed;
      }
      patch.validation = parsed.value;
    }
    if (options["follow-ups-json"] !== undefined) {
      const option = readEditOption(argv, options, "follow-ups-json", { command: "set-closure" });
      if (!option.ok) {
        return option;
      }
      const parsed = parseJsonValue(option.value, { fieldName: "follow-ups-json" });
      if (!parsed.ok) {
        return parsed;
      }
      patch.follow_ups = parsed.value;
    }
  }

  if (!isObject(patch)) {
    return {
      ok: false,
      diagnostic: createDiagnostic("invalid_closure_payload", "closure payload must be a top-level object", {
        path: "closure"
      })
    };
  }

  const allowedKeys = new Set(WORK_RECORD_CLOSURE_FIELD_NAMES);
  if (Object.prototype.hasOwnProperty.call(patch, "schema_version")) {
    return {
      ok: false,
      diagnostic: createDiagnostic(
        "unsupported_schema_version",
        `closure payload must not declare schema_version; the work-record schema is fixed at ${WORK_RECORD_SCHEMA_VERSION}`,
        { path: "closure.schema_version" }
      )
    };
  }
  const unknownKeys = Object.keys(patch).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length) {
    return {
      ok: false,
      diagnostic: createDiagnostic(
        "invalid_closure_payload",
        `closure payload contains unsupported field(s): ${unknownKeys.join(", ")}`,
        { path: "closure" }
      )
    };
  }
  if (!Object.keys(patch).length) {
    return {
      ok: false,
      diagnostic: createDiagnostic("invalid_closure_payload", "closure payload must include at least one schema-owned field", {
        path: "closure"
      })
    };
  }
  if ("summary" in patch && typeof patch.summary !== "string") {
    return {
      ok: false,
      diagnostic: createDiagnostic("invalid_closure_payload", "closure.summary must be a string", {
        path: "closure.summary"
      })
    };
  }
  for (const key of ["validation", "follow_ups"]) {
    if (key in patch && (!Array.isArray(patch[key]) || !patch[key].every((entry) => typeof entry === "string"))) {
      return {
        ok: false,
        diagnostic: createDiagnostic("invalid_closure_payload", `closure.${key} must be an array of strings`, {
          path: `closure.${key}`
        })
      };
    }
  }

  return { ok: true, patch };
}

export async function runSetClosure(argv) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log(
      "Usage: wiki work-records set-closure --unit <WK-0001|WK-0001#slice-id> [--id <WK-0001>] [--summary <text> | --validation-json <json> | --follow-ups-json <json> | --json-file <path>] [--expected-source-digest <sha256:...>] [--dir <path>] [--json]\n" +
        "Partially update schema-owned closure fields: summary, validation, and follow_ups.\n" +
        "Pass --expected-source-digest to refuse the write if the on-disk record source digest no longer matches."
    );
    return;
  }

  const command = "set-closure";
  const targetDir = path.resolve(String(options.dir || "."));
  const unknownOption = rejectUnknownEditOptions(options, command, argv);
  if (unknownOption) {
    failEditResult({ command, options, diagnostic: unknownOption });
    return;
  }
  const schemaVersion = readOptionalSchemaVersion(argv, options, command);
  if (!schemaVersion.ok) {
    failEditResult({ command, options, diagnostic: schemaVersion.diagnostic });
    return;
  }
  const selected = selectEditUnit(argv, options, command);
  if (!selected.ok) {
    failEditResult({ command, options, diagnostic: selected.diagnostic });
    return;
  }
  const unit = selected.unit;
  const parsedPatch = await parseClosurePatch(argv, options);
  if (!parsedPatch.ok) {
    failEditResult({ command, options, unit, diagnostic: parsedPatch.diagnostic });
    return;
  }
  const expectedDigest = readOptionalExpectedSourceDigest(argv, options, command);
  if (!expectedDigest.ok) {
    failEditResult({ command, options, unit, diagnostic: expectedDigest.diagnostic });
    return;
  }
  const expectedSourceDigest = expectedDigest.value;

  const loadedResult = await loadEditableRecord({ dir: targetDir, unit, command, options });
  if (!loadedResult.ok) {
    return;
  }
  const { loaded } = loadedResult;
  const record = cloneJson(loaded.record);
  const target = getSelectedTarget(record, unit);
  const sourcePath = loaded.source_path_relative || loaded.source_path;
  target.sections = isObject(target.sections) ? target.sections : {};
  const currentClosureObject = isObject(target.sections.closure) ? cloneJson(target.sections.closure) : {};
  const nextClosure = {
    ...currentClosureObject,
    ...cloneJson(parsedPatch.patch)
  };

  const changedClosureFields = Object.keys(parsedPatch.patch).filter(
    (key) => JSON.stringify(currentClosureObject[key]) !== JSON.stringify(nextClosure[key])
  );
  if (!changedClosureFields.length) {
    printEditResult(
      createBaseEditResult({
        command,
        unit,
        sourcePath,
        changedFields: [],
        previous: {},
        next: {},
        valid: true,
        written: false,
        noOp: true
      }),
      { json: Boolean(options.json) }
    );
    return;
  }

  target.sections.closure = nextClosure;
  const previous = {};
  const next = {};
  const changedFields = changedClosureFields.map((key) => prefixField(unit, `sections.closure.${key}`));
  for (const key of changedClosureFields) {
    previous[prefixField(unit, `sections.closure.${key}`)] = currentClosureObject[key];
    next[prefixField(unit, `sections.closure.${key}`)] = nextClosure[key];
  }
  previous.updated = record.updated;
  record.updated = todayDateString();
  changedFields.push("updated");
  next.updated = record.updated;

  await persistEditResult({
    command,
    options,
    targetDir,
    unit,
    record,
    sourcePath,
    changedFields,
    previous,
    next,
    expectedSourceDigest
  });
}

function getTasksContainer(target) {
  target.sections = isObject(target.sections) ? target.sections : {};
  return Array.isArray(target.sections.tasks) ? target.sections.tasks : null;
}

function selectTask({ tasks, argv, options }) {
  if (options.index !== undefined && options.text !== undefined) {
    return {
      ok: false,
      diagnostic: createDiagnostic("ambiguous_task_selector", "set-task accepts --text or --index, not both", {
        path: "tasks"
      })
    };
  }
  if (options.index === undefined && options.text === undefined) {
    return {
      ok: false,
      diagnostic: createDiagnostic("missing_task_selector", "set-task requires --text <task text> or --index <n>", {
        path: "tasks"
      })
    };
  }
  if (!tasks) {
    return {
      ok: false,
      diagnostic: createDiagnostic("missing_tasks", "selected unit has no tasks array", { path: "sections.tasks" })
    };
  }
  if (options.index !== undefined) {
    const indexOption = readEditOption(argv, options, "index", { command: "set-task" });
    if (!indexOption.ok) {
      return { ok: false, diagnostic: indexOption.diagnostic };
    }
    const rawIndex = indexOption.value;
    if (!/^(0|[1-9][0-9]*)$/.test(rawIndex)) {
      return {
        ok: false,
        diagnostic: createDiagnostic("invalid_task_index", `Task index must be a zero-based integer: ${rawIndex}`, {
          path: "index"
        })
      };
    }
    const index = Number(rawIndex);
    if (index < 0 || index >= tasks.length) {
      return {
        ok: false,
        diagnostic: createDiagnostic("missing_task", `Task index ${index} does not exist`, { path: "index" })
      };
    }
    return { ok: true, index };
  }

  const textOption = readEditOption(argv, options, "text", {
    command: "set-task",
    allowDashValue: true
  });
  if (!textOption.ok) {
    return { ok: false, diagnostic: textOption.diagnostic };
  }
  const text = textOption.value.trim();
  const matches = tasks
    .map((task, index) => ({ task, index }))
    .filter(({ task }) => isObject(task) && typeof task.text === "string" && task.text.trim() === text);
  if (matches.length === 0) {
    return {
      ok: false,
      diagnostic: createDiagnostic("missing_task", `No task matches text: ${text}`, { path: "text" })
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      diagnostic: createDiagnostic("ambiguous_task", `Multiple tasks match text: ${text}`, { path: "text" })
    };
  }
  return { ok: true, index: matches[0].index };
}

export async function runSetTask(argv) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log(
      "Usage: wiki work-records set-task --unit <WK-0001|WK-0001#slice-id> [--id <WK-0001>] (--text <task text> | --index <n>) [--expected-source-digest <sha256:...>] [--dir <path>] [--json]\n" +
        "Mark one record or slice task done by exact trimmed text match or zero-based index.\n" +
        "Pass --expected-source-digest to refuse the write if the on-disk record source digest no longer matches."
    );
    return;
  }

  const command = "set-task";
  const targetDir = path.resolve(String(options.dir || "."));
  const unknownOption = rejectUnknownEditOptions(options, command, argv);
  if (unknownOption) {
    failEditResult({ command, options, diagnostic: unknownOption });
    return;
  }
  const schemaVersion = readOptionalSchemaVersion(argv, options, command);
  if (!schemaVersion.ok) {
    failEditResult({ command, options, diagnostic: schemaVersion.diagnostic });
    return;
  }
  const selected = selectEditUnit(argv, options, command);
  if (!selected.ok) {
    failEditResult({ command, options, diagnostic: selected.diagnostic });
    return;
  }
  const unit = selected.unit;
  const expectedDigest = readOptionalExpectedSourceDigest(argv, options, command);
  if (!expectedDigest.ok) {
    failEditResult({ command, options, unit, diagnostic: expectedDigest.diagnostic });
    return;
  }
  const expectedSourceDigest = expectedDigest.value;
  const loadedResult = await loadEditableRecord({ dir: targetDir, unit, command, options });
  if (!loadedResult.ok) {
    return;
  }
  const { loaded } = loadedResult;
  const record = cloneJson(loaded.record);
  const target = getSelectedTarget(record, unit);
  const sourcePath = loaded.source_path_relative || loaded.source_path;
  const tasks = getTasksContainer(target);
  const selectedTask = selectTask({ tasks, argv, options });
  if (!selectedTask.ok) {
    failEditResult({ command, options, unit, sourcePath, diagnostic: selectedTask.diagnostic });
    return;
  }

  const task = tasks[selectedTask.index];
  const fieldPath = prefixField(unit, `sections.tasks[${selectedTask.index}].status`);
  if (task.status === "done") {
    printEditResult(
      createBaseEditResult({
        command,
        unit,
        sourcePath,
        changedFields: [],
        previous: {},
        next: {},
        valid: true,
        written: false,
        noOp: true
      }),
      { json: Boolean(options.json) }
    );
    return;
  }

  const previous = {
    [fieldPath]: task.status,
    updated: record.updated
  };
  task.status = "done";
  record.updated = todayDateString();

  await persistEditResult({
    command,
    options,
    targetDir,
    unit,
    record,
    sourcePath,
    changedFields: [fieldPath, "updated"],
    previous,
    next: {
      [fieldPath]: "done",
      updated: record.updated
    },
    expectedSourceDigest
  });
}
