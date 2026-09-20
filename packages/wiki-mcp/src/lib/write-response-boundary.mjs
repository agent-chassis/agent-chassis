

import { types as nodeUtilTypes } from "node:util";
import { serializeWorkRecordDiagnosticValue } from
  "@agent-chassis/wiki-core/src/operations/work-record-persistence-diagnostics.mjs";

const VERBOSE_NEXT_ACTION = "Re-call this tool with verbose:true to inspect suppressed write detail";

export const COMPACT_WRITE_DIAGNOSTIC_LIMITS = Object.freeze({
  count: null,
  message: null,
  path: null,
  value: null
});

const DIAGNOSTIC_VALUE_SENTINELS = Object.freeze({
  accessor: "[unsupported:accessor]",
  container: "[unsupported:diagnostics_container]",
  entry: "[unsupported:diagnostic_entry]",
  indexedAccessor: "[unsupported:diagnostic_index_accessor]",
  missingEntry: "[unsupported:missing_diagnostic]",
  object: "[unsupported:object]",
  proxy: "[unsupported:proxy]"
});

const COMPACT_DIAGNOSTIC_FIELD_ALLOWLIST = Object.freeze([
  "code",
  "severity",
  "message",
  "summary",
  "path",
  "value",
  "bounded_context"
]);

const trapFreeProxyDetector =
  typeof nodeUtilTypes?.isProxy === "function" ? nodeUtilTypes.isProxy : null;

const ALWAYS_KEEP_KEYS = [
  "status",
  "ok",
  "valid",
  "written",
  "no_op",
  "publication_state",
  "diagnostic_count",
  "failed_fault",
  "effect_trace",
  "contract_persisted",
  "admission_sidecar_publications",
  "admission_sidecar_cleanup",
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

const WHOLE_RECORD_RESULT_KEYS = new Set(["record"]);

function withoutWholeRecord(result) {
  if (!isPlainObject(result) || ![...WHOLE_RECORD_RESULT_KEYS].some((key) => hasOwn(result, key))) {
    return result;
  }
  const detailed = { ...result };
  for (const key of WHOLE_RECORD_RESULT_KEYS) delete detailed[key];
  return detailed;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isObjectLike(value) {
  return value !== null && (typeof value === "object" || typeof value === "function");
}

function isProxyFailClosed(value) {
  if (!isObjectLike(value)) {
    return false;
  }
  if (!trapFreeProxyDetector) {
    return true;
  }
  try {
    return trapFreeProxyDetector(value);
  } catch {
    return true;
  }
}

function inspectDiagnosticContainer(value) {
  if (isObjectLike(value) && isProxyFailClosed(value)) {
    return {
      kind: "unsafe",
      reason: trapFreeProxyDetector ? "proxy" : "proxy_detector_unavailable"
    };
  }

  let lengthDescriptor = null;
  if (isObjectLike(value)) {
    try {
      lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length") ?? null;
    } catch {
      return { kind: "unsafe", reason: "length_descriptor_unavailable" };
    }
    if (lengthDescriptor && !hasOwn(lengthDescriptor, "value")) {
      return { kind: "unsafe", reason: "accessor_length" };
    }
  }

  if (!Array.isArray(value)) {
    return { kind: "unsafe", reason: "non_array" };
  }
  if (!lengthDescriptor) {
    return { kind: "unsafe", reason: "missing_length" };
  }

  const totalCount = lengthDescriptor.value;
  if (!Number.isSafeInteger(totalCount) || totalCount < 0) {
    return { kind: "unsafe", reason: "malformed_length" };
  }
  return { kind: "safe", totalCount };
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value ?? {}, key);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function compactDiagnostic(entry) {
  const extracted = extractDiagnosticDescriptors(entry);
  if (extracted.kind === "primitive") {
    return DIAGNOSTIC_VALUE_SENTINELS.entry;
  }
  if (extracted.kind === "proxy") {
    return DIAGNOSTIC_VALUE_SENTINELS.proxy;
  }
  if (extracted.kind !== "descriptors") {
    return DIAGNOSTIC_VALUE_SENTINELS.object;
  }

  const { descriptors } = extracted;
  const projectDescriptor = (descriptor, fallback = null) => {
    if (!descriptor) {
      return fallback;
    }
    if (!hasOwn(descriptor, "value")) {
      return DIAGNOSTIC_VALUE_SENTINELS.accessor;
    }
    return projectDiagnosticValue(descriptor.value).projected;
  };
  const messageDescriptor = descriptors.message ?? descriptors.summary;
  const compact = {
    code: projectDescriptor(descriptors.code),
    severity: projectDescriptor(descriptors.severity),
    message: projectDescriptor(messageDescriptor)
  };
  if (descriptors.path) {
    compact.path = projectDescriptor(descriptors.path);
  }
  return compact;
}

function boundedList(value, limit = 3) {
  const inspection = inspectDiagnosticContainer(value);
  if (inspection.kind !== "safe") {
    return [];
  }

  const bounded = [];
  const returnedCount = Math.min(inspection.totalCount, limit);
  for (let index = 0; index < returnedCount; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    const entry =
      descriptor && hasOwn(descriptor, "value")
        ? compactDiagnostic(descriptor.value)
        : descriptor
          ? DIAGNOSTIC_VALUE_SENTINELS.indexedAccessor
          : DIAGNOSTIC_VALUE_SENTINELS.missingEntry;
    Object.defineProperty(bounded, String(index), {
      configurable: true,
      enumerable: true,
      value: entry,
      writable: true
    });
  }
  return bounded;
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
  if (DETAIL_KEY_ALLOWLIST.has(key) || WHOLE_RECORD_RESULT_KEYS.has(key)) {
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

function unsupportedDiagnosticValue(type) {
  return `[unsupported:${type}]`;
}

function extractDiagnosticDescriptors(entry) {
  if (!isObjectLike(entry)) {
    return { kind: "primitive" };
  }
  if (isProxyFailClosed(entry)) {
    return { kind: "proxy" };
  }

  const descriptors = Object.create(null);
  try {
    for (const key of COMPACT_DIAGNOSTIC_FIELD_ALLOWLIST) {
      const descriptor = Object.getOwnPropertyDescriptor(entry, key);
      if (descriptor) {
        descriptors[key] = descriptor;
      }
    }
  } catch {
    return { kind: "unsupported" };
  }
  return { descriptors, kind: "descriptors" };
}

function projectDiagnosticValue(value) {

  const projection = {
    projected: value,
    reasons: {
      accessor: false,
      depth: false,
      entries: false,
      proxy: false,
      size: false,
      cycle: false,
      unsupported: false
    },
    replacements: { accessor: 0, proxy: 0 },
    truncated: false
  };

  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return projection;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return projection;
  }

  projection.truncated = true;
  projection.reasons.unsupported = true;
  if (isObjectLike(value) && isProxyFailClosed(value)) {
    projection.projected = DIAGNOSTIC_VALUE_SENTINELS.proxy;
    projection.reasons.proxy = true;
    projection.replacements.proxy = 1;
    return projection;
  }
  if (typeof value === "object") {
    projection.projected = DIAGNOSTIC_VALUE_SENTINELS.object;
    return projection;
  }
  if (typeof value === "number") {
    projection.projected = unsupportedDiagnosticValue("non_finite_number");
    return projection;
  }
  projection.projected = unsupportedDiagnosticValue(typeof value);
  return projection;
}

function enforceCompactDiagnosticBoundary(response) {
  if (!hasOwn(response, "diagnostics")) {
    return response;
  }

  const complete = serializeWorkRecordDiagnosticValue(response.diagnostics, {
    path: "diagnostics"
  });
  if (!Array.isArray(complete)) {
    throw new TypeError("diagnostics must be an array");
  }

  response.diagnostics = complete;
  response.diagnostic_count = complete.length;
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
    return withoutWholeRecord(result);
  }

  const ok =
    result.ok !== undefined
      ? Boolean(result.ok)
      : result.valid !== undefined
        ? Boolean(result.valid)
        : result.written === true || result.written === "true";
  const hasDiagnosticsProperty = hasOwn(result, "diagnostics");
  const diagnostics = hasDiagnosticsProperty ? result.diagnostics : [];
  const diagnosticsInspection = hasDiagnosticsProperty
    ? inspectDiagnosticContainer(diagnostics)
    : { kind: "safe", totalCount: 0 };
  const hasDiagnostics =
    hasDiagnosticsProperty &&
    (diagnosticsInspection.kind !== "safe" || diagnosticsInspection.totalCount > 0);

  const response = {};

  for (const key of ALWAYS_KEEP_KEYS) {
    if (!hasOwn(result, key)) {
      continue;
    }
    if (key === "diagnostics") {
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

  return appendVerboseHintIfNeeded(
    enforceCompactWriteResponseOkSemantics(enforceCompactDiagnosticBoundary(response)),
    result
  );
}

function cloneDiagnostics(diagnostics) {
  const inspection = inspectDiagnosticContainer(diagnostics);
  if (inspection.kind !== "safe") {
    return [];
  }

  const clone = [];
  for (let index = 0; index < inspection.totalCount; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(diagnostics, String(index));
    const value =
      descriptor && hasOwn(descriptor, "value")
        ? descriptor.value
        : descriptor
          ? DIAGNOSTIC_VALUE_SENTINELS.indexedAccessor
          : DIAGNOSTIC_VALUE_SENTINELS.missingEntry;
    Object.defineProperty(clone, String(index), {
      configurable: true,
      enumerable: true,
      value,
      writable: true
    });
  }
  return clone;
}

export function enforceCompactWriteResponseOkSemantics(response) {
  const boundary = isPlainObject(response) ? { ...response } : {};
  const hasWritten = hasOwn(boundary, "written");
  const hasNoOp = hasOwn(boundary, "no_op");
  const written = hasWritten
    ? boundary.written === null ? null : Boolean(boundary.written)
    : false;
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

  if (boundary.ok !== false && valid && (written === true || noOp)) {
    boundary.ok = true;
    if (Array.isArray(boundary.diagnostics)) {
      boundary.diagnostics = cloneDiagnostics(boundary.diagnostics);
    }
    return boundary;
  }

  boundary.ok = false;

  if (valid && !written && !noOp) {
    const diagnostics = cloneDiagnostics(boundary.diagnostics);
    const diagnosticsLength = Object.getOwnPropertyDescriptor(diagnostics, "length").value;

    if (diagnosticsLength === 0) {
      Object.defineProperty(diagnostics, "0", {
        configurable: true,
        enumerable: true,
        value: {
          code: "write_response_not_written",
          message: "Compact write response was valid but did not report a write or valid no-op."
        },
        writable: true
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
