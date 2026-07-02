

const VERBOSE_NEXT_ACTION = "Re-call this tool with verbose:true to inspect suppressed write detail";

const ALWAYS_KEEP_KEYS = [
  "status",
  "ok",
  "valid",
  "written",
  "no_op",
  "cleanly_closeable",
  "error_count",
  "record_id",
  "id",
  "selected_unit",
  "unit",
  "source_digest",
  "expected_source_digest",
  "current_source_digest",
  "use_as_expected_source_digest",
  "diagnostics",
  "refusal",
  "decision",
  "decision_code",
  "decision_codes",
  "admission_summary",
  "metric_completeness",
  "remediation_summary",
  "next_action"
];

const DETAIL_KEY_ALLOWLIST = new Set([
  "verbose",
  "workspaceRepo",
  "operation",
  "source_path_relative"
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value ?? {}, key);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function compactDiagnostic(entry) {
  if (!isPlainObject(entry)) {
    return entry;
  }
  const compact = {
    code: entry.code ?? null,
    severity: entry.severity ?? null,
    message: entry.message ?? entry.summary ?? null
  };
  if (hasOwn(entry, "path")) {
    compact.path = entry.path ?? null;
  }
  return compact;
}

function boundedList(value, limit = 3) {
  return Array.isArray(value) ? value.slice(0, limit).map((entry) => compactDiagnostic(entry)) : [];
}

function compactReport(report) {
  if (!isPlainObject(report)) {
    return report ?? null;
  }
  const compact = {};
  for (const key of [
    "status",
    "mode",
    "changed",
    "removed_count",
    "kept_count",
    "candidate_count",
    "graph_sidecar",
    "summary",
    "next_action"
  ]) {
    if (hasOwn(report, key)) {
      compact[key] = cloneJson(report[key]);
    }
  }
  return Object.keys(compact).length > 0 ? compact : null;
}

function isNonTrivialSuppressedValue(key, value) {
  if (DETAIL_KEY_ALLOWLIST.has(key)) {
    return false;
  }
  if (value === null || value === undefined || value === false) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (isPlainObject(value)) {
    return Object.keys(value).length > 0;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return true;
}

function appendVerboseHintIfNeeded(response, result) {
  const suppressed = Object.keys(result).some(
    (key) => !hasOwn(response, key) && isNonTrivialSuppressedValue(key, result[key])
  );
  if (!suppressed) {
    return response;
  }
  response.detail_available = true;
  if (!response.next_action) {
    response.next_action = VERBOSE_NEXT_ACTION;
  }
  return response;
}

export function shapeWriteResponse(result, options = {}) {
  if (!result) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "missing_result",
          severity: "error",
          message: "No write result provided to response boundary helper"
        }
      ]
    };
  }

  const isVerbose = Boolean(options?.verbose || result?.verbose);
  if (isVerbose) {
    return result;
  }

  const ok =
    result.valid !== undefined
      ? Boolean(result.valid)
      : result.ok !== undefined
        ? Boolean(result.ok)
        : result.written === true || result.written === "true";
  const diagnostics = Array.isArray(result.diagnostics) ? result.diagnostics : [];
  const hasDiagnostics = diagnostics.length > 0;

  const response = {};

  for (const key of ALWAYS_KEEP_KEYS) {
    if (!hasOwn(result, key)) {
      continue;
    }
    if (key === "diagnostics" && !hasDiagnostics && ok) {
      continue;
    }
    response[key] = result[key];
  }

  if (!hasOwn(response, "ok")) {
    response.ok = ok;
  }

  if (!hasOwn(response, "valid") && hasOwn(result, "valid")) {
    response.valid = Boolean(result.valid);
  }

  if (typeof result.written === "string") {
    response.written = result.written === "true";
  }

  const selectedUnit = result.selected_unit ?? null;
  const unitAddress =
    isPlainObject(selectedUnit) && typeof selectedUnit.address === "string"
      ? selectedUnit.address
      : typeof selectedUnit === "string"
        ? selectedUnit
        : null;
  const recordId = result.record_id ?? result.id ?? null;

  if (!hasOwn(response, "selected_unit") && selectedUnit) {
    response.selected_unit = selectedUnit;
  }
  if (!hasOwn(response, "unit") && unitAddress && unitAddress.includes("#")) {
    response.unit = unitAddress;
  }
  if (!hasOwn(response, "id") && (recordId || unitAddress)) {
    response.id = recordId || unitAddress;
  }

  if (hasOwn(result, "report") && !hasOwn(response, "report")) {
    const report = compactReport(result.report);
    if (report) {
      response.report = report;
    }
  }

  if (Array.isArray(result.top_findings) && !hasOwn(response, "top_findings")) {
    response.top_findings = boundedList(result.top_findings);
  }

  if (Array.isArray(result.validation_diagnostics) && !hasOwn(response, "validation_diagnostics")) {
    response.validation_diagnostics = boundedList(result.validation_diagnostics);
  }

  if (hasDiagnostics || !ok) {
    response.diagnostics = diagnostics;
    if (result.next_action) {
      response.next_action = result.next_action;
    }
  }

  return appendVerboseHintIfNeeded(enforceCompactWriteResponseOkSemantics(response), result);
}

function cloneDiagnostics(diagnostics) {
  if (!Array.isArray(diagnostics)) {
    return [];
  }

  return diagnostics.map((entry) => (isPlainObject(entry) ? { ...entry } : entry));
}

export function enforceCompactWriteResponseOkSemantics(response) {
  const boundary = isPlainObject(response) ? { ...response } : {};
  const hasWritten = hasOwn(boundary, "written");
  const hasNoOp = hasOwn(boundary, "no_op");
  const written = hasWritten ? Boolean(boundary.written) : false;
  const noOp = hasNoOp ? Boolean(boundary.no_op) : false;
  const valid = boundary.valid === undefined ? Boolean(written || noOp) : Boolean(boundary.valid);

  if (hasOwn(boundary, "valid")) {
    boundary.valid = valid;
  }
  if (hasWritten) {
    boundary.written = written;
  }
  if (hasNoOp) {
    boundary.no_op = noOp;
  }

  if (valid && (written || noOp)) {
    boundary.ok = true;
    if (Array.isArray(boundary.diagnostics)) {
      boundary.diagnostics = cloneDiagnostics(boundary.diagnostics);
    }
    return boundary;
  }

  boundary.ok = false;

  if (valid && !written && !noOp) {
    const diagnostics = cloneDiagnostics(boundary.diagnostics);

    if (diagnostics.length === 0) {
      diagnostics.push({
        code: 'write_response_not_written',
        message: 'Compact write response was valid but did not report a write or valid no-op.',
      });
    }

    boundary.diagnostics = diagnostics;
    return boundary;
  }

  if (Array.isArray(boundary.diagnostics)) {
    boundary.diagnostics = cloneDiagnostics(boundary.diagnostics);
  }

  return boundary;
}
