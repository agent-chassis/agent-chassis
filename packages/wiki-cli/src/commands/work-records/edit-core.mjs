

import { readWorkRecordById } from "@agent-chassis/wiki-core";
import { writeValidatedWorkRecord } from "@agent-chassis/wiki-core/src/operations/work-records.mjs";
import {
  createDiagnostic,
  isObject,
  parseAdmissionUnitSelector,
  readEditOption
} from "./options.mjs";
import { printJson } from "./output.mjs";

function createEditUnit(address, commandName = "work-record edit commands") {
  const parsed = parseAdmissionUnitSelector(address);
  if (!parsed) {
    return {
      ok: false,
      diagnostic: createDiagnostic(
        "invalid_unit",
        `${commandName} requires --unit <WK-0001|WK-0001#slice-id>`,
        { path: "unit" }
      )
    };
  }
  return { ok: true, unit: parsed };
}

export function selectEditUnit(argv, options, commandName) {
  const hasUnit = options.unit !== undefined;
  const hasId = options.id !== undefined;
  if (hasUnit && hasId) {
    return {
      ok: false,
      diagnostic: createDiagnostic("ambiguous_selector", `${commandName} accepts --unit or --id, not both`, {
        path: "unit"
      })
    };
  }
  if (!hasUnit && !hasId) {
    return {
      ok: false,
      diagnostic: createDiagnostic("missing_selector", `${commandName} requires --unit <WK-0001|WK-0001#slice-id>`, {
        path: "unit"
      })
    };
  }

  if (hasId) {
    const idOption = readEditOption(argv, options, "id", { command: commandName });
    if (!idOption.ok) {
      return { ok: false, diagnostic: idOption.diagnostic };
    }
    const id = idOption.value;
    if (id.includes("#")) {
      return {
        ok: false,
        diagnostic: createDiagnostic("invalid_id", `${commandName} --id is record-only; use --unit for slices`, {
          path: "id"
        })
      };
    }
    if (!/^WK-[0-9]{4}$/.test(id)) {
      return {
        ok: false,
        diagnostic: createDiagnostic(
          "invalid_id",
          `${commandName} --id must be a canonical work-record id like WK-0001; received ${id}`,
          { path: "id" }
        )
      };
    }
    return createEditUnit(id, commandName);
  }

  const unitOption = readEditOption(argv, options, "unit", { command: commandName });
  if (!unitOption.ok) {
    return { ok: false, diagnostic: unitOption.diagnostic };
  }
  return createEditUnit(unitOption.value, commandName);
}

export function createBaseEditResult({
  command,
  unit,
  sourcePath,
  changedFields = [],
  previous = {},
  next = {},
  valid = true,
  diagnostics = [],
  written = false,
  noOp = false
}) {
  return {
    command,
    unit: {
      address: unit?.address || null,
      record_id: unit?.record_id || null,
      slice_id: unit?.slice_id || null
    },
    record_id: unit?.record_id || null,
    path: sourcePath || null,
    changed_fields: changedFields,
    previous,
    new: next,
    valid,
    diagnostics,
    written,
    no_op: noOp
  };
}

export function printEditResult(result, { json = false } = {}) {
  const hasErrorDiagnostics = (result.diagnostics || []).some((entry) => entry.severity === "error");
  if (json) {
    printJson(result);
  } else if (result.valid && !hasErrorDiagnostics) {
    console.log(`${result.command}: ${result.no_op ? "no-op" : result.written ? "written" : "valid"}`);
    console.log(`Record: ${result.record_id || "(missing)"}`);
    console.log(`Unit: ${result.unit.address || "(missing)"}`);
    console.log(`Path: ${result.path || "(missing)"}`);
    console.log(`Changed fields: ${result.changed_fields.length ? result.changed_fields.join(", ") : "(none)"}`);
    console.log(`Valid: ${result.valid}`);
    console.log(`Previous: ${JSON.stringify(result.previous)}`);
    console.log(`New: ${JSON.stringify(result.new)}`);
    console.log(`Diagnostics: ${JSON.stringify(result.diagnostics || [])}`);
  } else {
    console.log(`${result.command}: refused`);
    console.log(`Record: ${result.record_id || "(missing)"}`);
    console.log(`Unit: ${result.unit.address || "(missing)"}`);
    console.log(`Path: ${result.path || "(missing)"}`);
    console.log(`Changed fields: ${result.changed_fields.length ? result.changed_fields.join(", ") : "(none)"}`);
    console.log(`Valid: ${result.valid}`);
    if ("expected_source_digest" in result) {
      console.log(`Expected source digest: ${result.expected_source_digest || "(missing)"}`);
      console.log(`Current source digest: ${result.current_source_digest || "(missing)"}`);
    }
    console.log(`Previous: ${JSON.stringify(result.previous)}`);
    console.log(`New: ${JSON.stringify(result.new)}`);
    console.log(`Diagnostics: ${JSON.stringify(result.diagnostics || [])}`);
    for (const diagnostic of result.diagnostics || []) {
      console.log(`- ${diagnostic.code}: ${diagnostic.message}`);
    }
  }
}

export function failEditResult({
  command,
  options,
  unit = null,
  sourcePath = null,
  diagnostic
}) {
  const result = createBaseEditResult({
    command,
    unit,
    sourcePath,
    valid: false,
    diagnostics: [diagnostic],
    written: false
  });
  printEditResult(result, { json: Boolean(options.json) });
  process.exitCode = 1;
  return result;
}

export async function loadEditableRecord({ dir, unit, command, options }) {
  const loaded = await readWorkRecordById({
    dir,
    id: unit.record_id,
    recordStore: null
  });
  if (!loaded.record) {
    return {
      ok: false,
      result: failEditResult({
        command,
        options,
        unit,
        sourcePath: loaded.source_path_relative || loaded.source_path || null,
        diagnostic:
          loaded.diagnostics?.find((entry) => entry.severity === "error") ||
          createDiagnostic("missing_json_record", `No canonical JSON work record exists for ${unit.record_id}`, {
            path: "id"
          })
      })
    };
  }
  if (loaded.diagnostics?.some((entry) => entry.severity === "error")) {
    return {
      ok: false,
      result: failEditResult({
        command,
        options,
        unit,
        sourcePath: loaded.source_path_relative || loaded.source_path || null,
        diagnostic:
          loaded.diagnostics.find((entry) => entry.severity === "error") ||
          createDiagnostic("invalid_record", `Cannot edit invalid work record ${unit.record_id}`, { path: "record" })
      })
    };
  }
  if (unit.kind === "slice") {
    const slice = Array.isArray(loaded.record.slices)
      ? loaded.record.slices.find((entry) => isObject(entry) && entry.id === unit.slice_id)
      : null;
    if (!slice) {
      return {
        ok: false,
        result: failEditResult({
          command,
          options,
          unit,
          sourcePath: loaded.source_path_relative || loaded.source_path || null,
          diagnostic: createDiagnostic(
            "missing_slice",
            `Selected slice ${unit.slice_id} does not exist on ${unit.record_id}`,
            { path: "unit" }
          )
        })
      };
    }
  }
  return { ok: true, loaded };
}

export function getSelectedTarget(record, unit) {
  if (unit.kind !== "slice") {
    return record;
  }
  return record.slices.find((entry) => isObject(entry) && entry.id === unit.slice_id);
}

export function prefixField(unit, fieldPath) {
  return unit.kind === "slice" ? `slices[${unit.slice_id}].${fieldPath}` : fieldPath;
}

export async function persistEditResult({
  command,
  options,
  targetDir,
  unit,
  record,
  sourcePath,
  changedFields,
  previous,
  next,
  expectedSourceDigest = null
}) {
  const writeOptions = { dir: targetDir, record };
  if (expectedSourceDigest !== null) {
    writeOptions.expectedSourceDigest = expectedSourceDigest;
  }
  const writeResult = await writeValidatedWorkRecord(writeOptions);
  const valid = Boolean(writeResult.valid);
  const hasErrorDiagnostics = (writeResult.diagnostics || []).some((entry) => entry.severity === "error");
  const staleDigestRefusal = (writeResult.diagnostics || []).some((entry) => entry.code === "stale_source_digest");
  const result = createBaseEditResult({
    command,
    unit,
    sourcePath: writeResult.canonical_record_path || sourcePath,
    changedFields: staleDigestRefusal ? [] : changedFields,
    previous: staleDigestRefusal ? {} : previous,
    next: staleDigestRefusal ? {} : next,
    valid,
    diagnostics: writeResult.diagnostics || [],
    written: Boolean(writeResult.written),
    noOp: false
  });
  if (expectedSourceDigest !== null) {
    result.expected_source_digest = expectedSourceDigest;
    result.current_source_digest =
      writeResult.current_source_digest !== undefined ? writeResult.current_source_digest : null;
  }
  printEditResult(result, { json: Boolean(options.json) });
  if (!valid || hasErrorDiagnostics || !writeResult.written) {
    process.exitCode = 1;
  }
  return result;
}
