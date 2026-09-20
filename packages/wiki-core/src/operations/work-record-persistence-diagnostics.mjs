

import { types as nodeUtilTypes } from "node:util";

import { STRUCTURED_DIAGNOSTIC_SCHEMA_VERSION } from
  "../lib/diagnostic-projection.mjs";
import { CRASH_DURABLE_EFFECTS } from "../lib/crash-durable-state.mjs";

export const WORK_RECORD_PERSISTENCE_PHASES = Object.freeze({
  STAGING: "staging",
  LOCK_ACQUISITION: "lock_acquisition",
  TRANSACTION_PREPARATION: "transaction_preparation",
  SIDECAR_PUBLICATION: "sidecar_publication",
  CANONICAL_PUBLICATION: "canonical_publication",
  LOCK_RELEASE: "lock_release",
  CLEANUP: "cleanup"
});

export const WORK_RECORD_PUBLICATION_STATES = Object.freeze({
  NOT_PUBLISHED: "not_published",
  PUBLISHED: "published",
  UNKNOWN: "unknown"
});

const NATIVE_ERROR_STACK_DESCRIPTOR = Object.getOwnPropertyDescriptor(new Error(), "stack");
const trapFreeProxyDetector = nodeUtilTypes.isProxy;

function ownDataProperty(value, key, pathValue) {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return { present: false, value: undefined };
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return { present: false, value: undefined };
  if (!Object.hasOwn(descriptor, "value")) {
    throw new TypeError(`${pathValue}.${String(key)} must be an own data property`);
  }
  return { present: true, value: descriptor.value };
}

function structuredDiagnosticValue(value, pathValue) {
  const schemaVersion = ownDataProperty(value, "schema_version", pathValue);
  if (!schemaVersion.present || schemaVersion.value !== STRUCTURED_DIAGNOSTIC_SCHEMA_VERSION) {
    return { structured: false, value };
  }
  const diagnosticValue = ownDataProperty(value, "value", pathValue);
  if (!diagnosticValue.present) {
    throw new TypeError(`${pathValue}.value is required for a structured diagnostic`);
  }
  return { structured: true, value: diagnosticValue.value };
}

function defineJsonProperty(target, key, value) {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true
  });
}

function propertyPath(parent, key) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key)
    ? `${parent}.${key}`
    : `${parent}[${JSON.stringify(key)}]`;
}

function inheritedErrorName(error, pathValue) {
  let current = error;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, "name");
    if (descriptor) {
      if (!Object.hasOwn(descriptor, "value")) {
        throw new TypeError(`${pathValue}.name must be a data property`);
      }
      return typeof descriptor.value === "string" && descriptor.value.length > 0
        ? descriptor.value
        : "Error";
    }
    current = Object.getPrototypeOf(current);
  }
  return "Error";
}

function isNativeErrorStackDescriptor(value, key, descriptor) {
  return value instanceof Error && key === "stack" &&
    !Object.hasOwn(descriptor, "value") &&
    typeof NATIVE_ERROR_STACK_DESCRIPTOR?.get === "function" &&
    descriptor.get === NATIVE_ERROR_STACK_DESCRIPTOR.get &&
    descriptor.set === NATIVE_ERROR_STACK_DESCRIPTOR.set;
}

function serializeDiagnosticValue(value, pathValue, ancestors) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new TypeError(`${pathValue} must contain a losslessly JSON-serializable number`);
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new TypeError(`${pathValue} must contain only losslessly JSON-serializable values`);
  }
  if (trapFreeProxyDetector(value)) {
    throw new TypeError(`${pathValue} must not be a Proxy`);
  }

  if (ancestors.has(value)) {
    throw new TypeError(`${pathValue} must be acyclic`);
  }
  ancestors.add(value);
  try {
    const structured = structuredDiagnosticValue(value, pathValue);
    if (structured.structured) {
      return serializeDiagnosticValue(structured.value, `${pathValue}.value`, ancestors);
    }

    const descriptors = Object.getOwnPropertyDescriptors(value);
    const symbolKey = Reflect.ownKeys(descriptors).find((key) => typeof key === "symbol");
    if (symbolKey !== undefined) {
      throw new TypeError(`${pathValue} contains a symbol-keyed property that JSON cannot retain`);
    }

    if (Array.isArray(value)) {
      const length = ownDataProperty(value, "length", pathValue).value;
      const allowedKeys = new Set(["length"]);
      const result = [];
      for (let index = 0; index < length; index += 1) {
        const key = String(index);
        allowedKeys.add(key);
        const entry = ownDataProperty(value, key, pathValue);
        if (!entry.present) {
          throw new TypeError(`${pathValue}[${index}] must be present for lossless serialization`);
        }
        defineJsonProperty(
          result,
          key,
          serializeDiagnosticValue(entry.value, `${pathValue}[${index}]`, ancestors)
        );
      }
      const extraKey = Object.keys(descriptors).find((key) => !allowedKeys.has(key));
      if (extraKey !== undefined) {
        throw new TypeError(`${propertyPath(pathValue, extraKey)} cannot be retained by JSON arrays`);
      }
      return result;
    }

    const prototype = Object.getPrototypeOf(value);
    if (!(value instanceof Error) && prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${pathValue} must be a plain object, array, Error, or structured diagnostic`);
    }

    const result = {};
    if (value instanceof Error && !Object.hasOwn(descriptors, "name")) {
      defineJsonProperty(result, "name", inheritedErrorName(value, pathValue));
    }
    for (const key of Object.keys(descriptors)) {
      const descriptor = descriptors[key];
      if (isNativeErrorStackDescriptor(value, key, descriptor)) {

        defineJsonProperty(
          result,
          key,
          serializeDiagnosticValue(
            Reflect.apply(descriptor.get, value, []),
            propertyPath(pathValue, key),
            ancestors
          )
        );
        continue;
      }
      if (!Object.hasOwn(descriptor, "value")) {
        throw new TypeError(`${propertyPath(pathValue, key)} must be a data property`);
      }
      defineJsonProperty(
        result,
        key,
        serializeDiagnosticValue(descriptor.value, propertyPath(pathValue, key), ancestors)
      );
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

export function serializeWorkRecordDiagnosticValue(value, { path = "diagnostic" } = {}) {
  return serializeDiagnosticValue(value, path, new Set());
}

function producerCauseCode(cause, producerDiagnostic) {
  const producerCause = ownDataProperty(producerDiagnostic, "cause_code", "producer_diagnostic");
  if (typeof producerCause.value === "string" && producerCause.value.length > 0) {
    return producerCause.value;
  }
  const directCause = ownDataProperty(cause, "code", "cause");
  if (typeof directCause.value === "string" && directCause.value.length > 0) {
    return directCause.value;
  }
  const structured = structuredDiagnosticValue(cause, "cause");
  const structuredCode = ownDataProperty(
    structured.structured ? structured.value : null,
    "code",
    "cause.value"
  );
  if (typeof structuredCode.value === "string" && structuredCode.value.length > 0) {
    return structuredCode.value;
  }
  const producerCode = ownDataProperty(producerDiagnostic, "code", "producer_diagnostic");
  if (typeof producerCode.value === "string" && producerCode.value.length > 0) {
    return producerCode.value;
  }
  return "unknown_internal_cause";
}

export function publicationStateFromCrashDurableResult(result) {
  const trace = Array.isArray(result?.trace) ? result.trace : [];
  const rename = trace.find((entry) => entry?.effect === CRASH_DURABLE_EFFECTS.PUBLISH_RENAME);
  if (rename?.outcome === "ok") return WORK_RECORD_PUBLICATION_STATES.PUBLISHED;
  if (rename?.outcome === "failed") return WORK_RECORD_PUBLICATION_STATES.UNKNOWN;
  return WORK_RECORD_PUBLICATION_STATES.NOT_PUBLISHED;
}

export function persistenceOutcomeFields(publicationState, { ok = false } = {}) {
  const written = publicationState === WORK_RECORD_PUBLICATION_STATES.PUBLISHED
    ? true
    : publicationState === WORK_RECORD_PUBLICATION_STATES.UNKNOWN
      ? null
      : false;
  return Object.freeze({
    ok: Boolean(ok),
    written,
    no_op: false,
    publication_state: publicationState
  });
}

function persistenceNextAction(publicationState) {
  if (publicationState === WORK_RECORD_PUBLICATION_STATES.PUBLISHED) {
    return "Canonical publication occurred, but persistence did not complete cleanly. Inspect the canonical record with workspace_read_page before deciding any further action; do not repeat this write.";
  }
  if (publicationState === WORK_RECORD_PUBLICATION_STATES.UNKNOWN) {
    return "Canonical publication could not be established. Inspect the canonical record with workspace_read_page before deciding any subsequent mutation; do not repeat this write.";
  }
  return "Canonical publication did not occur. Resolve the reported persistence failure before deciding any later mutation; no automatic retry was performed.";
}

export function composeWorkRecordPersistenceDiagnostic({
  phase,
  cause,
  publicationState,
  producerDiagnostic = null,
  failureRole = "primary",
  recordId = null,
  canonicalRecordPath = null,
  failedFault = null,
  trace = null,
  diagnosticIndex = 0
}) {
  const causeValue = serializeWorkRecordDiagnosticValue(cause, {
    path: `diagnostics.${diagnosticIndex}.cause`
  });
  const producerValue = producerDiagnostic === null
    ? null
    : serializeWorkRecordDiagnosticValue(producerDiagnostic, {
        path: `diagnostics.${diagnosticIndex}.producer_diagnostic`
      });
  const causeCode = producerCauseCode(cause, producerDiagnostic);
  const diagnostic = {
    code: "work_record_write_failed",
    category: "work_record_write_failed",
    operation: "work_record_write_failed",
    severity: "error",
    message: `canonical work-record persistence failed during ${phase}`,
    phase,
    cause_code: causeCode,
    publication_state: publicationState,
    authority_limb: "mechanical",
    failure_role: failureRole,
    cause: causeValue,
    ...(recordId ? { record_id: recordId } : {}),
    ...(canonicalRecordPath ? { path: canonicalRecordPath } : {}),
    ...(producerValue ? { producer_diagnostic: producerValue } : {}),
    ...(failedFault ? { failed_fault: failedFault } : {}),
    ...(Array.isArray(trace) ? { effect_trace: trace } : {})
  };
  return Object.freeze({ diagnostic: Object.freeze(diagnostic) });
}

export function appendWorkRecordPersistenceFailure(result, {
  phase,
  cause,
  publicationState = result?.publication_state ?? WORK_RECORD_PUBLICATION_STATES.NOT_PUBLISHED,
  producerDiagnostic = null,
  failureRole = "primary",
  recordId = result?.record?.id ?? null,
  canonicalRecordPath = result?.canonical_record_path ?? null,
  failedFault = null,
  trace = null
}) {
  const diagnostics = Array.isArray(result?.diagnostics) ? result.diagnostics : [];
  const composed = composeWorkRecordPersistenceDiagnostic({
    phase,
    cause,
    publicationState,
    producerDiagnostic,
    failureRole,
    recordId,
    canonicalRecordPath,
    failedFault,
    trace,
    diagnosticIndex: diagnostics.length
  });
  const next = {
    ...result,
    ...persistenceOutcomeFields(publicationState),
    diagnostics: [...diagnostics, composed.diagnostic],
    next_action: persistenceNextAction(publicationState)
  };
  next.diagnostic_count = next.diagnostics.length;
  if (failedFault !== null) next.failed_fault = failedFault;
  if (Array.isArray(trace)) next.effect_trace = trace;
  if (publicationState === WORK_RECORD_PUBLICATION_STATES.UNKNOWN) {
    next.source_digest = null;
    delete next.current_source_digest;
  }
  return next;
}

export function workRecordPersistenceResult({
  valid,
  record,
  sourceDigest,
  canonicalRecordPath,
  publicationState,
  ok,
  diagnostics = [],
  ...details
}) {
  return {
    valid,
    ...persistenceOutcomeFields(publicationState, { ok }),
    diagnostics,
    diagnostic_count: diagnostics.length,
    record,
    source_digest: publicationState === WORK_RECORD_PUBLICATION_STATES.UNKNOWN
      ? null
      : sourceDigest,
    canonical_record_path: canonicalRecordPath,
    ...details
  };
}

export function workRecordInputContractRefusal({
  record,
  sourceDigest,
  canonicalRecordPath,
  diagnostic
}) {
  return {
    valid: false,
    written: false,
    diagnostics: [diagnostic],
    diagnostic_count: 1,
    record,
    source_digest: sourceDigest,
    canonical_record_path: canonicalRecordPath
  };
}

export function staleWorkRecordPersistenceResult({
  record,
  canonicalRecordPath,
  sourceDigest,
  code,
  currentSourceDigest = null,
  expectedSourceDigest = null
}) {
  return {
    valid: false,
    written: false,
    diagnostics: [{
      code,
      severity: "error",
      message: code === "stale_source_digest"
        ? "source digest does not match the current on-disk record"
        : "persistence snapshot changed since admission materialization",
      ...(record?.id ? { record_id: record.id } : {})
    }],
    record,
    source_digest: sourceDigest,
    canonical_record_path: canonicalRecordPath,
    ...(code === "stale_source_digest" ? {
      current_source_digest: currentSourceDigest,
      ...(expectedSourceDigest ? { expected_source_digest: expectedSourceDigest } : {})
    } : {})
  };
}

export function projectAdmissionSidecarPublications(publications) {
  return publications.map((entry) => ({
    created: entry.created,
    sidecar_path: entry.relativePath,
    sidecar_digest: entry.digest
  }));
}

export function obsoleteDocsInputDiagnostic(record) {
  if (record === null || typeof record !== "object" || Array.isArray(record)) return null;
  if (Object.prototype.propertyIsEnumerable.call(record, "docs")) {
    return Object.freeze({
      code: "obsolete_docs_property",
      severity: "error",
      authority_limb: "mechanical",
      message: "docs is obsolete; supply the current read_scope field",
      path: "read_scope"
    });
  }
  if (!Array.isArray(record.slices)) return null;
  for (let index = 0; index < record.slices.length; index += 1) {
    const slice = record.slices[index];
    if (slice !== null && typeof slice === "object" && !Array.isArray(slice) &&
        Object.prototype.propertyIsEnumerable.call(slice, "docs")) {
      return Object.freeze({
        code: "obsolete_docs_property",
        severity: "error",
        authority_limb: "mechanical",
        message: "slice docs is obsolete; supply the current read_scope field",
        path: `slices[${index}].read_scope`
      });
    }
  }
  return null;
}
