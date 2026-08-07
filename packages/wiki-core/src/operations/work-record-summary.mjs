import path from "node:path";
import {
  parseWorkRecordSummaryUnit,
  summarizeWorkRecord
} from "../lib/work-record-summary.mjs";
import { loadWorkRecordById, loadWorkRecordByPath } from "../lib/work-record-store.mjs";

function buildErrorResult({ recordId = null, diagnostics = [], unit = null }) {
  return {
    record_id: recordId,
    source_path: null,
    source_path_relative: null,
    source_digest: null,
    valid: false,
    selected_unit: unit,
    summary: null,
    diagnostics
  };
}

function buildLoadedResult(loaded, { parsedUnit, summary, diagnostics, verbose, include_full_summary, valid }) {
  const response = {
    record_id: loaded.record?.id ?? loaded.record_id ?? null,
    source_path_relative: loaded.source_path_relative || null,
    valid,
    selected_unit: parsedUnit,
    summary,
    diagnostics: diagnostics || []
  };

  if (verbose || include_full_summary) {
    response.source_path = loaded.source_path || null;
    response.source_digest = loaded.source_digest || null;
  }

  return response;
}

function resolveWorkspacePath(targetDir, requestedPath) {
  const raw = String(requestedPath).replaceAll("\\", "/");
  if (path.isAbsolute(raw)) {
    return { error: "absolute", relativePath: raw };
  }
  const relativeInput = raw.replace(/^\.\//, "");
  const absolutePath = path.resolve(targetDir, relativeInput);
  const containment = path.relative(targetDir, absolutePath).split(path.sep).join("/");
  if (
    containment === ".." ||
    containment.startsWith("../") ||
    path.isAbsolute(containment)
  ) {
    return { error: "traversal", relativePath: raw };
  }
  return { absolutePath, relativePath: containment || relativeInput };
}

async function loadDependencyRecords({ record, targetDir, recordStore }) {
  const resolved = new Map();
  const dependencies = Array.isArray(record.depends_on) ? record.depends_on : [];

  for (const dependency of dependencies) {
    if (typeof dependency !== "string") continue;
    const parsed = parseWorkRecordSummaryUnit(dependency.trim());
    if (!parsed || parsed.record_id === record.id) continue;

    try {
      const loaded = await loadWorkRecordById({
        dir: targetDir,
        id: parsed.record_id,
        recordStore
      });
      if (loaded?.valid !== true || loaded.record?.id !== parsed.record_id) continue;
      resolved.set(dependency.trim(), loaded.record);
    } catch {

    }
  }

  return (dependency) => resolved.get(dependency) ?? null;
}

export async function getWorkRecordSummary({
  dir = ".",
  id = null,
  unit = null,
  pathInput = null,
  recordStore = null,
  verbose = false,
  include_full_summary = false
} = {}) {
  const targetDir = path.resolve(String(dir));

  let parsedUnit = null;
  let resolvedId = null;

  if (unit) {
    parsedUnit = parseWorkRecordSummaryUnit(unit);
    if (!parsedUnit) {
      return buildErrorResult({
        diagnostics: [
          {
            code: "invalid_unit",
            severity: "error",
            message: `Invalid work-record unit address: ${unit}`,
            path: "unit"
          }
        ]
      });
    }
    resolvedId = parsedUnit.record_id;
  } else if (id) {
    parsedUnit = parseWorkRecordSummaryUnit(id);
    if (!parsedUnit) {
      return buildErrorResult({
        diagnostics: [
          {
            code: "invalid_id",
            severity: "error",
            message: `Invalid work-record id: ${id}`,
            path: "id"
          }
        ]
      });
    }
    resolvedId = parsedUnit.record_id;
  }

  let loaded;
  if (pathInput) {
    const contained = resolveWorkspacePath(targetDir, pathInput);
    if (contained.error) {
      return buildErrorResult({
        unit: parsedUnit,
        diagnostics: [
          {
            code: "path_out_of_scope",
            severity: "error",
            message:
              contained.error === "absolute"
                ? `Work-record path must be a workspace-relative path; absolute paths are rejected: ${contained.relativePath}`
                : `Work-record path resolves outside the configured workspace and is rejected: ${contained.relativePath}`,
            path: "path"
          }
        ]
      });
    }
    loaded = await loadWorkRecordByPath({
      dir: targetDir,
      path: contained.absolutePath,
      recordStore
    });
  } else if (resolvedId) {
    loaded = await loadWorkRecordById({ dir: targetDir, id: resolvedId, recordStore });
  } else {
    return buildErrorResult({
      diagnostics: [
        {
          code: "missing_selector",
          severity: "error",
          message: "getWorkRecordSummary requires id, unit, or path",
          path: "id"
        }
      ]
    });
  }

  if (!loaded.record) {
    return buildLoadedResult(loaded, {
      parsedUnit,
      summary: null,
      diagnostics: loaded.diagnostics,
      verbose,
      include_full_summary,
      valid: false
    });
  }

  const dependencyResolver = await loadDependencyRecords({
    record: loaded.record,
    targetDir,
    recordStore
  });
  const summary = summarizeWorkRecord(loaded.record, {
    unit: parsedUnit,
    verbose,
    include_full_summary,
    dependencyResolver
  });
  if (parsedUnit && parsedUnit.kind === "slice" && summary.selected_unit_summary == null) {
    return buildLoadedResult(loaded, {
      parsedUnit,
      summary,
      diagnostics: [
        ...(loaded.diagnostics || []),
        {
          code: "missing_slice",
          severity: "error",
          message: `Selected slice ${parsedUnit.slice_id} does not exist on ${loaded.record.id}`,
          path: "unit"
        }
      ],
      verbose,
      include_full_summary,
      valid: false
    });
  }

  return buildLoadedResult(loaded, {
    parsedUnit,
    summary,
    diagnostics: loaded.diagnostics,
    verbose,
    include_full_summary,
    valid: true
  });
}
