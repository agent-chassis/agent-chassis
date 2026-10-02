

import diagnosticGraph from "./workspace-agent-test-proof-diagnostic-graph.cjs";

export const {
  LAUNCHER_TEST_FAILURE_DIAGNOSTIC_SCHEMA_VERSION,
  captureTestFailureDiagnostic,
  isLauncherTestFailureDiagnostic,
  nativeRecordFailureDiagnostic,
  unavailableTestFailureDiagnostic
} = diagnosticGraph;

export const SELECTED_TEST_FAILURE_DIAGNOSTIC_SCHEMA_VERSION =
  "launcher-test-failure-diagnostic-selection.v1";

export const SELECTED_TEST_FAILURE_OPERAND_INLINE_BYTES = 256;

export const SELECTED_TEST_FAILURE_DETAIL_INLINE_BYTES = 4096;

const SCALAR_OPERAND_TYPES = new Set(["null", "undefined", "negative_zero", "boolean", "number",
  "nonfinite_number", "bigint"]);

function operandSize(node) {
  if (node.type === "string") return { utf8_bytes: Buffer.byteLength(node.value, "utf8") };
  if (node.type === "object" || node.type === "array") {
    return { ...(node.type === "array" ? { length: node.length } : {}),
      property_count: node.properties.length };
  }
  if (node.type === "map" || node.type === "set") return { size: node.size };
  if (["array_buffer", "typed_array", "buffer"].includes(node.type)) {
    return { byte_length: node.byte_length };
  }
  if (node.type === "regexp") return { utf8_bytes: Buffer.byteLength(node.source, "utf8") };
  return {};
}

export function projectSelectedTestFailureDiagnostic(diagnostic) {
  if (!isLauncherTestFailureDiagnostic(diagnostic)) {
    return Object.freeze({ schema_version: SELECTED_TEST_FAILURE_DIAGNOSTIC_SCHEMA_VERSION,
      status: "invalid" });
  }
  const issues = diagnostic.issues.map((entry) => ({ path: entry.path, reason: entry.reason }));
  const origin = diagnostic.origin === undefined ? {} : { origin: { ...diagnostic.origin } };
  if (diagnostic.status === "unavailable") {
    return Object.freeze({ schema_version: SELECTED_TEST_FAILURE_DIAGNOSTIC_SCHEMA_VERSION,
      status: "unavailable", ...origin, issues });
  }
  const errors = new Map(diagnostic.errors.map((entry) => [entry.id, entry]));
  const values = new Map(diagnostic.values.map((entry) => [entry.id, entry]));
  const visited = new Set();
  const operand = (id) => {
    const node = values.get(id);
    if (node.type === "error") return { type: "error", error: projectError(node.error) };
    if (node.type === "unavailable") {
      return { type: "unavailable", reason: node.reason,
        ...(node.source_type === undefined ? {} : { source_type: node.source_type }) };
    }
    if (SCALAR_OPERAND_TYPES.has(node.type)) {
      return { type: node.type, ...(Object.hasOwn(node, "value") ? { value: node.value } : {}) };
    }
    if (node.type === "string" &&
        Buffer.byteLength(JSON.stringify(node.value), "utf8") <= SELECTED_TEST_FAILURE_OPERAND_INLINE_BYTES) {
      return { type: "string", value: node.value };
    }
    if (node.type === "date") return { type: "date", value: node.value };
    return { type: node.type, deferred: true, ...operandSize(node) };
  };
  const projectError = (id) => {
    if (visited.has(id)) return { ref: id };
    visited.add(id);
    const entry = errors.get(id);
    const projected = { id };
    for (const field of ["name", "message", "code", "operator", "generated_message"]) {
      if (entry[field] !== undefined) projected[field] = entry[field];
    }
    if (entry.location !== undefined) projected.location = { ...entry.location };
    if (entry.stack !== undefined) projected.stack = entry.stack;
    if (entry.native_details !== undefined) {
      projected.native_details = entry.native_details.map(({ label, text }) =>
        Buffer.byteLength(text, "utf8") <= SELECTED_TEST_FAILURE_DETAIL_INLINE_BYTES ? { label, text }
          : { label, deferred: true, utf8_bytes: Buffer.byteLength(text, "utf8") });
    }
    for (const field of ["expected", "actual", "value"]) {
      if (entry[field] !== undefined) projected[field] = operand(entry[field]);
    }
    if (entry.cause !== undefined) projected.cause = projectError(entry.cause);
    if (entry.aggregate_errors !== undefined) {
      projected.aggregate_errors = entry.aggregate_errors.map(projectError);
    }
    return projected;
  };
  return Object.freeze({ schema_version: SELECTED_TEST_FAILURE_DIAGNOSTIC_SCHEMA_VERSION,
    status: "captured", ...origin, error: projectError(diagnostic.root_error), issues });
}
