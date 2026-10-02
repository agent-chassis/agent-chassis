

import { isPublicRedactionReason } from "./refusal-payload.mjs";

export const STRUCTURED_DIAGNOSTIC_SCHEMA_VERSION = "structured-diagnostic.v1";
export const UNREADABLE_DIAGNOSTIC = "[unreadable diagnostic]";

function safeRead(value, key) {
  if (value === null || value === undefined) return undefined;
  try {
    return value[key];
  } catch {
    return undefined;
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function isJsonDiagnostic(value, seen = new Set()) {
  try {
    if (value === null || typeof value === "string" || typeof value === "boolean") return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (!Array.isArray(value) && !isPlainObject(value)) return false;
    if (seen.has(value)) return false;
    seen.add(value);
    const valid = Array.isArray(value)
      ? value.every((entry) => isJsonDiagnostic(entry, seen))
      : Object.values(value).every((entry) => isJsonDiagnostic(entry, seen));
    seen.delete(value);
    return valid;
  } catch {
    seen.delete(value);
    return false;
  }
}

function cloneJsonDiagnostic(value) {
  if (Array.isArray(value)) return value.map((entry) => cloneJsonDiagnostic(entry));
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneJsonDiagnostic(entry)])
    );
  }
  return value;
}

function safeDiagnosticValue(value) {
  if (value instanceof Error) {
    const message = safeRead(value, "message");
    return typeof message === "string" ? message : UNREADABLE_DIAGNOSTIC;
  }
  if (isJsonDiagnostic(value)) {
    try {
      return cloneJsonDiagnostic(value);
    } catch {
      return UNREADABLE_DIAGNOSTIC;
    }
  }
  if ((typeof value === "object" && value !== null) || typeof value === "function") {
    const constructor = safeRead(value, "constructor");
    const name = safeRead(constructor, "name");
    return `[${typeof name === "string" && name.length > 0 ? name : "Object"}]`;
  }
  try {
    return String(value);
  } catch {
    return UNREADABLE_DIAGNOSTIC;
  }
}

function isSensitiveValueDeclaration(value) {
  return isPlainObject(value) &&
    typeof value.field === "string" && value.field.length > 0 &&
    typeof value.value === "string" && value.value.length > 0 &&
    isPublicRedactionReason(value.reason);
}

export function isStructuredDiagnostic(value) {
  return isPlainObject(value) &&
    value.schema_version === STRUCTURED_DIAGNOSTIC_SCHEMA_VERSION &&
    isJsonDiagnostic(value.value) &&
    Array.isArray(value.sensitive_values) &&
    value.sensitive_values.every(isSensitiveValueDeclaration);
}

export function isDiagnosticValue(value) {
  if (isPlainObject(value) &&
      value.schema_version === STRUCTURED_DIAGNOSTIC_SCHEMA_VERSION) {
    if (!isStructuredDiagnostic(value)) {
      throw new TypeError("structured diagnostic must use the closed schema and redaction vocabulary");
    }
    return true;
  }
  return isJsonDiagnostic(value);
}

export function projectDiagnostic(value) {
  if (isPlainObject(value) &&
      value.schema_version === STRUCTURED_DIAGNOSTIC_SCHEMA_VERSION &&
      !isStructuredDiagnostic(value)) {
    throw new TypeError("structured diagnostic must use the closed schema and redaction vocabulary");
  }
  return Object.freeze({
    value: isStructuredDiagnostic(value)
      ? cloneJsonDiagnostic(value.value)
      : safeDiagnosticValue(value),
    redactions: Object.freeze([])
  });
}

export function captureStructuredDiagnostic(value, { sensitiveValues = [] } = {}) {
  const diagnosticValue = safeDiagnosticValue(value);
  if (!isJsonDiagnostic(diagnosticValue)) {
    throw new TypeError("structured diagnostic value must be JSON-compatible and acyclic");
  }
  if (!Array.isArray(sensitiveValues) || !sensitiveValues.every(isSensitiveValueDeclaration)) {
    throw new TypeError("structured diagnostic sensitive values must be explicit closed declarations");
  }
  return Object.freeze({
    schema_version: STRUCTURED_DIAGNOSTIC_SCHEMA_VERSION,
    value: cloneJsonDiagnostic(diagnosticValue),
    sensitive_values: Object.freeze(sensitiveValues.map((entry) => Object.freeze({
      field: entry.field,
      value: entry.value,
      reason: entry.reason
    })))
  });
}
