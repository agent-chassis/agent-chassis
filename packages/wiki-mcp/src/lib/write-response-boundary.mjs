

import { types as nodeUtilTypes } from "node:util";

const VERBOSE_NEXT_ACTION = "Re-call this tool with verbose:true to inspect suppressed write detail";

export const COMPACT_WRITE_DIAGNOSTIC_LIMITS = Object.freeze({
  count: 20,
  message: 512,
  path: 1024,
  value: 512
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

function truncateDiagnosticString(value, key, limit, truncatedFields) {
  if (typeof value !== "string" || value.length <= limit) {
    return value;
  }
  truncatedFields[key] += 1;
  return String.prototype.slice.call(value, 0, limit);
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

function recordValueProjection(valueProjection, projection) {
  valueProjection.projected_count += 1;
  valueProjection.depth_limited_count += Number(projection.reasons.depth);
  valueProjection.entry_limited_count += Number(projection.reasons.entries);
  valueProjection.size_limited_count += Number(projection.reasons.size);
  valueProjection.cycle_replaced_count += Number(projection.reasons.cycle);
  valueProjection.unsupported_replaced_count += Number(projection.reasons.unsupported);
  valueProjection.accessor_replaced_count += projection.replacements.accessor;
  valueProjection.proxy_replaced_count += projection.replacements.proxy;
}

function accessorProjection() {
  return {
    projected: DIAGNOSTIC_VALUE_SENTINELS.accessor,
    reasons: {
      accessor: true,
      cycle: false,
      depth: false,
      entries: false,
      proxy: false,
      size: false,
      unsupported: true
    },
    replacements: { accessor: 1, proxy: 0 },
    truncated: true
  };
}

function countedDiagnosticField(key) {
  if (key === "message" || key === "summary") {
    return "message";
  }
  return key === "path" || key === "value" ? key : null;
}

function unsafeContainerResponse(response, reason) {
  response.diagnostics = [DIAGNOSTIC_VALUE_SENTINELS.container];
  response.diagnostics_truncation = {
    truncated: true,
    total_count: null,
    returned_count: 1,
    omitted_count: null,
    count_known: false,
    limits: { ...COMPACT_WRITE_DIAGNOSTIC_LIMITS },
    truncated_fields: { message: 0, path: 0, value: 0 },
    container_projection: {
      reason,
      sentinel: DIAGNOSTIC_VALUE_SENTINELS.container
    }
  };
  response.detail_available = true;
  if (!response.next_action) {
    response.next_action = VERBOSE_NEXT_ACTION;
  }
  return response;
}

function enforceCompactDiagnosticBoundary(response) {
  if (!hasOwn(response, "diagnostics")) {
    return response;
  }

  const container = response.diagnostics;
  const inspection = inspectDiagnosticContainer(container);
  if (inspection.kind !== "safe") {
    return unsafeContainerResponse(response, inspection.reason);
  }

  const totalCount = inspection.totalCount;
  const returnedCount = Math.min(totalCount, COMPACT_WRITE_DIAGNOSTIC_LIMITS.count);
  const truncatedFields = {
    message: 0,
    path: 0,
    value: 0
  };
  const valueProjection = {
    projected_count: 0,
    depth_limited_count: 0,
    entry_limited_count: 0,
    size_limited_count: 0,
    cycle_replaced_count: 0,
    unsupported_replaced_count: 0,
    accessor_replaced_count: 0,
    proxy_replaced_count: 0
  };
  const unsupportedProjection = {
    projected_entry_count: 0,
    entry_proxy_replaced_count: 0,
    accessor_replaced_count: 0,
    nested_proxy_replaced_count: 0,
    unsupported_value_replaced_count: 0,
    missing_entry_replaced_count: 0,
    indexed_accessor_replaced_count: 0,
    unsupported_entry_replaced_count: 0
  };
  const bounded = [];

  for (let index = 0; index < returnedCount; index += 1) {
    let indexedDescriptor;
    try {
      indexedDescriptor = Object.getOwnPropertyDescriptor(container, String(index));
    } catch {
      return unsafeContainerResponse(response, "index_descriptor_unavailable");
    }
    if (!indexedDescriptor) {
      unsupportedProjection.projected_entry_count += 1;
      unsupportedProjection.missing_entry_replaced_count += 1;
      Object.defineProperty(bounded, String(index), {
        configurable: true,
        enumerable: true,
        value: DIAGNOSTIC_VALUE_SENTINELS.missingEntry,
        writable: true
      });
      continue;
    }
    if (!hasOwn(indexedDescriptor, "value")) {
      unsupportedProjection.projected_entry_count += 1;
      unsupportedProjection.indexed_accessor_replaced_count += 1;
      Object.defineProperty(bounded, String(index), {
        configurable: true,
        enumerable: true,
        value: DIAGNOSTIC_VALUE_SENTINELS.indexedAccessor,
        writable: true
      });
      continue;
    }

    const entry = indexedDescriptor.value;
    const extracted = extractDiagnosticDescriptors(entry);
    if (extracted.kind === "primitive") {
      unsupportedProjection.projected_entry_count += 1;
      unsupportedProjection.unsupported_entry_replaced_count += 1;
      Object.defineProperty(bounded, String(index), {
        configurable: true,
        enumerable: true,
        value: DIAGNOSTIC_VALUE_SENTINELS.entry,
        writable: true
      });
      continue;
    }
    if (extracted.kind === "proxy") {
      unsupportedProjection.projected_entry_count += 1;
      unsupportedProjection.entry_proxy_replaced_count += 1;
      Object.defineProperty(bounded, String(index), {
        configurable: true,
        enumerable: true,
        value: DIAGNOSTIC_VALUE_SENTINELS.proxy,
        writable: true
      });
      continue;
    }
    if (extracted.kind !== "descriptors") {
      unsupportedProjection.projected_entry_count += 1;
      unsupportedProjection.unsupported_entry_replaced_count += 1;
      Object.defineProperty(bounded, String(index), {
        configurable: true,
        enumerable: true,
        value: DIAGNOSTIC_VALUE_SENTINELS.entry,
        writable: true
      });
      continue;
    }

    const diagnostic = {};
    let entryWasUnsupported = false;
    for (const key of COMPACT_DIAGNOSTIC_FIELD_ALLOWLIST) {
      const descriptor = extracted.descriptors[key];
      if (!descriptor) {
        continue;
      }

      const projected = hasOwn(descriptor, "value")
        ? projectDiagnosticValue(descriptor.value)
        : accessorProjection();

      let fieldValue = projected.projected;
      const countedField = countedDiagnosticField(key);
      if (countedField && typeof fieldValue === "string" && !projected.truncated) {
        fieldValue = truncateDiagnosticString(
          fieldValue,
          countedField,
          COMPACT_WRITE_DIAGNOSTIC_LIMITS[countedField],
          truncatedFields
        );
      } else if (countedField && projected.truncated) {
        truncatedFields[countedField] += 1;
      }

      if (projected.reasons.unsupported) {
        entryWasUnsupported = true;
        unsupportedProjection.accessor_replaced_count += projected.replacements.accessor;
        unsupportedProjection.nested_proxy_replaced_count += projected.replacements.proxy;
        unsupportedProjection.unsupported_value_replaced_count += Number(
          projected.replacements.accessor === 0 && projected.replacements.proxy === 0
        );
      }
      if (key === "value" && projected.truncated) {
        recordValueProjection(valueProjection, projected);
      }

      Object.defineProperty(diagnostic, key, {
        configurable: true,
        enumerable: true,
        value: fieldValue,
        writable: true
      });
    }
    if (entryWasUnsupported) {
      unsupportedProjection.projected_entry_count += 1;
    }
    Object.defineProperty(bounded, String(index), {
      configurable: true,
      enumerable: true,
      value: diagnostic,
      writable: true
    });
  }

  const omittedCount = totalCount - returnedCount;
  const hasFieldTruncation =
    truncatedFields.message > 0 || truncatedFields.path > 0 || truncatedFields.value > 0;
  const hasUnsupportedProjection = unsupportedProjection.projected_entry_count > 0;

  response.diagnostics = bounded;
  if (omittedCount === 0 && !hasFieldTruncation && !hasUnsupportedProjection) {
    return response;
  }

  response.diagnostics_truncation = {
    truncated: true,
    total_count: totalCount,
    returned_count: returnedCount,
    omitted_count: omittedCount,
    limits: { ...COMPACT_WRITE_DIAGNOSTIC_LIMITS },
    truncated_fields: truncatedFields
  };
  if (valueProjection.projected_count > 0) {
    response.diagnostics_truncation.value_projection = valueProjection;
  }
  if (hasUnsupportedProjection) {
    response.diagnostics_truncation.unsupported_projection = unsupportedProjection;
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
