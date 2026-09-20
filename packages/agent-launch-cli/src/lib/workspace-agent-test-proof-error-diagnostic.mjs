export const LAUNCHER_TEST_FAILURE_DIAGNOSTIC_SCHEMA_VERSION =
  "launcher-test-failure-diagnostic.v1";

const ISSUE_REASONS = new Set([
  "accessor_not_invoked",
  "error_not_supplied",
  "invalid_aggregate_errors",
  "source_value_unreadable",
  "unsupported_error_value",
  "unsupported_internal_state",
  "unsupported_symbol_key",
  "unsupported_value_type"
]);

const ERROR_FIELDS = Object.freeze([
  ["name", "name", "string"],
  ["message", "message", "string"],
  ["code", "code", "string"],
  ["stack", "stack", "string"],
  ["operator", "operator", "string"],
  ["generatedMessage", "generated_message", "boolean"]
]);

const NO_MATCH = Symbol("no-match");
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayBuffer = Object.getOwnPropertyDescriptor(
  typedArrayPrototype, "buffer"
).get;
const typedArrayByteOffset = Object.getOwnPropertyDescriptor(
  typedArrayPrototype, "byteOffset"
).get;
const typedArrayByteLength = Object.getOwnPropertyDescriptor(
  typedArrayPrototype, "byteLength"
).get;
const typedArrayLength = Object.getOwnPropertyDescriptor(
  typedArrayPrototype, "length"
).get;
const typedArrayTag = Object.getOwnPropertyDescriptor(
  typedArrayPrototype, Symbol.toStringTag
).get;
const arrayBufferByteLength = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype, "byteLength"
).get;
const regexpSource = Object.getOwnPropertyDescriptor(RegExp.prototype, "source").get;
const regexpFlags = Object.getOwnPropertyDescriptor(RegExp.prototype, "flags").get;
const mapSize = Object.getOwnPropertyDescriptor(Map.prototype, "size").get;
const setSize = Object.getOwnPropertyDescriptor(Set.prototype, "size").get;
const errorStackGetter = Object.getOwnPropertyDescriptor(new Error(), "stack")?.get;

function issue(issues, path, reason) {
  issues.push({ path, reason });
}

function pathPart(value) {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1");
}

function childPath(parent, value) {
  return `${parent}/${pathPart(value)}`;
}

function descriptor(value, key, inherited, path, issues) {
  let current = value;
  const seen = new Set();
  while (current !== null && (typeof current === "object" || typeof current === "function")) {
    if (seen.has(current)) {
      issue(issues, path, "source_value_unreadable");
      return { state: "unreadable" };
    }
    seen.add(current);
    let found;
    try {
      found = Object.getOwnPropertyDescriptor(current, key);
    } catch {
      issue(issues, path, "source_value_unreadable");
      return { state: "unreadable" };
    }
    if (found !== undefined) {
      if (!Object.hasOwn(found, "value")) {
        if (key === "stack" && typeof found.get === "function" &&
            found.get === errorStackGetter) {
          try {
            return { state: "value", value: found.get.call(value) };
          } catch {
            issue(issues, path, "source_value_unreadable");
            return { state: "unreadable" };
          }
        }
        issue(issues, path, "accessor_not_invoked");
        return { state: "accessor" };
      }
      return { state: "value", value: found.value };
    }
    if (!inherited) break;
    try {
      current = Object.getPrototypeOf(current);
    } catch {
      issue(issues, path, "source_value_unreadable");
      return { state: "unreadable" };
    }
  }
  return { state: "missing" };
}

function builtinValue(reader) {
  try {
    return reader();
  } catch {
    return NO_MATCH;
  }
}

function plainObject(value) {
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function errorObject(value) {
  try {
    return value instanceof Error;
  } catch {
    return false;
  }
}

function ownDescriptors(value, path, issues) {
  try {
    return Object.getOwnPropertyDescriptors(value);
  } catch {
    issue(issues, path, "source_value_unreadable");
    return null;
  }
}

function byteString(buffer, byteOffset = 0, byteLength = undefined) {
  const view = byteLength === undefined
    ? new Uint8Array(buffer)
    : new Uint8Array(buffer, byteOffset, byteLength);
  return Buffer.from(view).toString("base64");
}

function isArrayIndex(key, length) {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(key)) return false;
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length && String(index) === key;
}

function graphCapture() {
  const errors = [];
  const values = [];
  const issues = [];
  const errorIds = new WeakMap();
  const valueIds = new WeakMap();

  const unavailableValue = (path, reason, sourceType) => {
    const node = { id: `value-${values.length}`, type: "unavailable", reason,
      ...(sourceType === undefined ? {} : { source_type: sourceType }) };
    values.push(node);
    issue(issues, path, reason);
    return node.id;
  };

  const captureDescriptorValue = (entry, path) => {
    if (!Object.hasOwn(entry, "value")) {
      return unavailableValue(path, "accessor_not_invoked", "accessor");
    }
    return captureValue(entry.value, path);
  };

  const captureProperties = (source, path, excluded = new Set()) => {
    const descriptors = ownDescriptors(source, path, issues);
    if (descriptors === null) return null;
    const properties = [];
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key === "symbol") {
        issue(issues, path, "unsupported_symbol_key");
        continue;
      }
      if (excluded.has(key)) continue;
      properties.push({ key, value: captureDescriptorValue(
        descriptors[key], childPath(path, key)
      ) });
    }
    return properties;
  };

  const captureError = (source, path) => {
    if ((typeof source !== "object" || source === null) && typeof source !== "function") {
      const record = { id: `error-${errors.length}` };
      errors.push(record);
      record.value = captureValue(source, childPath(path, "value"));
      issue(issues, path, "unsupported_error_value");
      return record.id;
    }
    if (errorIds.has(source)) return errorIds.get(source);
    const record = { id: `error-${errors.length}` };
    errors.push(record);
    errorIds.set(source, record.id);
    for (const [sourceKey, targetKey, expectedType] of ERROR_FIELDS) {
      const fieldPath = childPath(path, sourceKey);
      const read = descriptor(source, sourceKey, true, fieldPath, issues);
      if (read.state === "value") {
        if (typeof read.value === expectedType) record[targetKey] = read.value;
        else if (read.value !== undefined) issue(issues, fieldPath, "unsupported_value_type");
      }
    }
    for (const key of ["expected", "actual"]) {
      const read = descriptor(source, key, false, childPath(path, key), issues);
      if (read.state === "value") {
        record[key] = captureValue(read.value, childPath(path, key));
      } else if (read.state === "accessor" || read.state === "unreadable") {
        record[key] = unavailableValue(childPath(path, key),
          read.state === "accessor" ? "accessor_not_invoked" : "source_value_unreadable",
          read.state);
      }
    }
    const cause = descriptor(source, "cause", false, childPath(path, "cause"), issues);
    if (cause.state === "value") {
      record.cause = captureError(cause.value, childPath(path, "cause"));
    }
    const aggregate = descriptor(source, "errors", false, childPath(path, "errors"), issues);
    if (aggregate.state === "value") {
      let isArray = false;
      try { isArray = Array.isArray(aggregate.value); } catch {   }
      if (!isArray) issue(issues, childPath(path, "errors"), "invalid_aggregate_errors");
      else {
        const aggregatePath = childPath(path, "errors");
        const descriptors = ownDescriptors(aggregate.value, aggregatePath, issues);
        const length = descriptors?.length?.value;
        if (!Number.isSafeInteger(length) || length < 0) {
          issue(issues, aggregatePath, "invalid_aggregate_errors");
        } else {
          record.aggregate_errors = [];
          for (let index = 0; index < length; index += 1) {
            const entryPath = childPath(aggregatePath, index);
            const entry = descriptors[String(index)];
            if (entry === undefined) {
              record.aggregate_errors.push(captureError(undefined, entryPath));
            } else if (!Object.hasOwn(entry, "value")) {
              const unavailable = { id: `error-${errors.length}` };
              errors.push(unavailable);
              unavailable.value = unavailableValue(entryPath, "accessor_not_invoked", "accessor");
              issue(issues, entryPath, "unsupported_error_value");
              record.aggregate_errors.push(unavailable.id);
            } else {
              record.aggregate_errors.push(captureError(entry.value, entryPath));
            }
          }
        }
      }
    }
    return record.id;
  };

  const captureValue = (source, path) => {
    if (source === null) {
      const node = { id: `value-${values.length}`, type: "null" };
      values.push(node); return node.id;
    }
    if (typeof source === "string" || typeof source === "boolean") {
      const node = { id: `value-${values.length}`, type: typeof source, value: source };
      values.push(node); return node.id;
    }
    if (typeof source === "number") {
      const node = { id: `value-${values.length}` };
      if (Object.is(source, -0)) Object.assign(node, { type: "negative_zero" });
      else if (Number.isFinite(source)) Object.assign(node, { type: "number", value: source });
      else Object.assign(node, { type: "nonfinite_number",
        value: Number.isNaN(source) ? "NaN" : source > 0 ? "Infinity" : "-Infinity" });
      values.push(node); return node.id;
    }
    if (source === undefined) {
      const node = { id: `value-${values.length}`, type: "undefined" };
      values.push(node); return node.id;
    }
    if (typeof source === "bigint") {
      const node = { id: `value-${values.length}`, type: "bigint", value: source.toString(10) };
      values.push(node); return node.id;
    }
    if (typeof source === "symbol" || typeof source === "function") {
      return unavailableValue(path, "unsupported_value_type", typeof source);
    }
    if (valueIds.has(source)) return valueIds.get(source);
    const node = { id: `value-${values.length}` };
    values.push(node);
    valueIds.set(source, node.id);

    if (errorObject(source)) {
      Object.assign(node, { type: "error", error: captureError(source, path) });
      return node.id;
    }

    let isArray = false;
    try { isArray = Array.isArray(source); } catch {   }
    if (isArray) {
      const descriptors = ownDescriptors(source, path, issues);
      if (descriptors === null) {
        Object.assign(node, { type: "unavailable", reason: "source_value_unreadable",
          source_type: "array" });
        return node.id;
      }
      const lengthDescriptor = descriptors.length;
      if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, "value") ||
          !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) {
        issue(issues, childPath(path, "length"), "source_value_unreadable");
        Object.assign(node, { type: "unavailable", reason: "source_value_unreadable",
          source_type: "array" });
        return node.id;
      }
      const length = lengthDescriptor.value;
      const elements = [];
      const properties = [];
      for (const key of Reflect.ownKeys(descriptors)) {
        if (typeof key === "symbol") {
          issue(issues, path, "unsupported_symbol_key");
          continue;
        }
        if (key === "length") continue;
        const value = captureDescriptorValue(descriptors[key], childPath(path, key));
        if (isArrayIndex(key, length)) elements.push({ index: Number(key), value });
        else properties.push({ key, value });
      }
      Object.assign(node, { type: "array", length, elements, properties });
      return node.id;
    }

    const date = builtinValue(() => Date.prototype.getTime.call(source));
    if (date !== NO_MATCH) {
      Object.assign(node, { type: "date", value: Number.isNaN(date)
        ? null : new Date(date).toISOString() });
      return node.id;
    }
    const expressionSource = builtinValue(() => regexpSource.call(source));
    if (expressionSource !== NO_MATCH) {
      const flags = regexpFlags.call(source);
      const lastIndex = descriptor(source, "lastIndex", false,
        childPath(path, "lastIndex"), issues);
      Object.assign(node, { type: "regexp", source: expressionSource, flags,
        ...(lastIndex.state === "value" && Number.isSafeInteger(lastIndex.value) &&
          lastIndex.value >= 0 ? { last_index: lastIndex.value } : {}) });
      return node.id;
    }
    const mapLength = builtinValue(() => mapSize.call(source));
    if (mapLength !== NO_MATCH) {
      const entries = [];
      let index = 0;
      try {
        for (const [key, value] of Map.prototype.entries.call(source)) {
          entries.push({ key: captureValue(key, `${path}/entries/${index}/key`),
            value: captureValue(value, `${path}/entries/${index}/value`) });
          index++;
        }
        Object.assign(node, { type: "map", size: mapLength, entries });
      } catch {
        issue(issues, path, "source_value_unreadable");
        Object.assign(node, { type: "unavailable", reason: "source_value_unreadable",
          source_type: "map" });
      }
      return node.id;
    }
    const setLength = builtinValue(() => setSize.call(source));
    if (setLength !== NO_MATCH) {
      const entries = [];
      let index = 0;
      try {
        for (const value of Set.prototype.values.call(source)) {
          entries.push(captureValue(value, `${path}/entries/${index++}`));
        }
        Object.assign(node, { type: "set", size: setLength, entries });
      } catch {
        issue(issues, path, "source_value_unreadable");
        Object.assign(node, { type: "unavailable", reason: "source_value_unreadable",
          source_type: "set" });
      }
      return node.id;
    }
    const bufferLength = builtinValue(() => arrayBufferByteLength.call(source));
    if (bufferLength !== NO_MATCH) {
      try {
        Object.assign(node, { type: "array_buffer", byte_length: bufferLength,
          bytes: byteString(source) });
      } catch {
        issue(issues, path, "unsupported_internal_state");
        Object.assign(node, { type: "unavailable", reason: "unsupported_internal_state",
          source_type: "array_buffer" });
      }
      return node.id;
    }
    const viewBuffer = builtinValue(() => typedArrayBuffer.call(source));
    if (viewBuffer !== NO_MATCH) {
      const name = builtinValue(() => typedArrayTag.call(source));
      if (name === NO_MATCH || name === "DataView") {
        issue(issues, path, "unsupported_internal_state");
        Object.assign(node, { type: "unavailable", reason: "unsupported_internal_state",
          source_type: name === NO_MATCH ? "array_buffer_view" : name });
        return node.id;
      }
      try {
        const byteOffset = typedArrayByteOffset.call(source);
        const byteLength = typedArrayByteLength.call(source);
        Object.assign(node, { type: Buffer.isBuffer(source) ? "buffer" : "typed_array",
          name: Buffer.isBuffer(source) ? "Buffer" : name,
          length: typedArrayLength.call(source), byte_length: byteLength,
          bytes: byteString(viewBuffer, byteOffset, byteLength) });
      } catch {
        issue(issues, path, "unsupported_internal_state");
        Object.assign(node, { type: "unavailable", reason: "unsupported_internal_state",
          source_type: "array_buffer_view" });
      }
      return node.id;
    }
    if (plainObject(source)) {
      const properties = captureProperties(source, path);
      if (properties === null) Object.assign(node, { type: "unavailable",
        reason: "source_value_unreadable", source_type: "object" });
      else Object.assign(node, { type: "object", properties });
      return node.id;
    }
    issue(issues, path, "unsupported_internal_state");
    Object.assign(node, { type: "unavailable", reason: "unsupported_internal_state",
      source_type: "object" });
    return node.id;
  };

  return { errors, values, issues, captureError };
}

function uniqueStrings(values) {
  return Array.isArray(values) && values.every((value) => typeof value === "string") &&
    new Set(values).size === values.length;
}

function exactRecord(value, allowed, required = allowed) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).every((key) => allowed.includes(key)) &&
    required.every((key) => Object.hasOwn(value, key));
}

const errorId = (value) => typeof value === "string" && /^error-[0-9]+$/u.test(value);
const valueId = (value) => typeof value === "string" && /^value-[0-9]+$/u.test(value);
const nonnegativeInteger = (value) => Number.isSafeInteger(value) && value >= 0;
const base64Bytes = (value, byteLength) => typeof value === "string" &&
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value) &&
  Buffer.from(value, "base64").byteLength === byteLength;

function validPropertyEntries(entries) {
  return Array.isArray(entries) && entries.every((entry) =>
    exactRecord(entry, ["key", "value"]) && typeof entry.key === "string" &&
    valueId(entry.value)) && new Set(entries.map(({ key }) => key)).size === entries.length;
}

function validDiagnosticValue(entry) {
  if (!exactRecord(entry, ["id", "type", "value", "properties", "length", "elements",
    "source", "flags", "last_index", "size", "entries", "byte_length", "bytes",
    "name", "error", "reason", "source_type"], ["id", "type"]) ||
      !valueId(entry.id) || typeof entry.type !== "string") return false;
  const only = (keys) => exactRecord(entry, keys);
  if (["null", "undefined", "negative_zero"].includes(entry.type)) {
    return only(["id", "type"]);
  }
  if (entry.type === "string") {
    return only(["id", "type", "value"]) && typeof entry.value === "string";
  }
  if (entry.type === "boolean") {
    return only(["id", "type", "value"]) && typeof entry.value === "boolean";
  }
  if (entry.type === "number") {
    return only(["id", "type", "value"]) && typeof entry.value === "number" &&
      Number.isFinite(entry.value) && !Object.is(entry.value, -0);
  }
  if (entry.type === "bigint") {
    return only(["id", "type", "value"]) && typeof entry.value === "string" &&
      /^-?(?:0|[1-9][0-9]*)$/u.test(entry.value);
  }
  if (entry.type === "nonfinite_number") {
    return only(["id", "type", "value"]) &&
      ["NaN", "Infinity", "-Infinity"].includes(entry.value);
  }
  if (entry.type === "object") {
    return only(["id", "type", "properties"]) && validPropertyEntries(entry.properties);
  }
  if (entry.type === "array") {
    return only(["id", "type", "length", "elements", "properties"]) &&
      nonnegativeInteger(entry.length) && validPropertyEntries(entry.properties) &&
      Array.isArray(entry.elements) && entry.elements.every((element) =>
        exactRecord(element, ["index", "value"]) && nonnegativeInteger(element.index) &&
        element.index < entry.length && valueId(element.value)) &&
      new Set(entry.elements.map(({ index }) => index)).size === entry.elements.length;
  }
  if (entry.type === "date") {
    return only(["id", "type", "value"]) &&
      (entry.value === null || typeof entry.value === "string");
  }
  if (entry.type === "regexp") {
    return exactRecord(entry, ["id", "type", "source", "flags", "last_index"],
      ["id", "type", "source", "flags"]) && typeof entry.source === "string" &&
      typeof entry.flags === "string" &&
      (entry.last_index === undefined || nonnegativeInteger(entry.last_index));
  }
  if (entry.type === "map") {
    return only(["id", "type", "size", "entries"]) && nonnegativeInteger(entry.size) &&
      Array.isArray(entry.entries) && entry.entries.length === entry.size &&
      entry.entries.every((item) => exactRecord(item, ["key", "value"]) &&
        valueId(item.key) && valueId(item.value));
  }
  if (entry.type === "set") {
    return only(["id", "type", "size", "entries"]) && nonnegativeInteger(entry.size) &&
      Array.isArray(entry.entries) && entry.entries.length === entry.size &&
      entry.entries.every(valueId);
  }
  if (entry.type === "array_buffer") {
    return only(["id", "type", "byte_length", "bytes"]) &&
      nonnegativeInteger(entry.byte_length) && base64Bytes(entry.bytes, entry.byte_length);
  }
  if (["typed_array", "buffer"].includes(entry.type)) {
    return only(["id", "type", "name", "length", "byte_length", "bytes"]) &&
      typeof entry.name === "string" && entry.name.length > 0 &&
      nonnegativeInteger(entry.length) && nonnegativeInteger(entry.byte_length) &&
      base64Bytes(entry.bytes, entry.byte_length);
  }
  if (entry.type === "error") {
    return only(["id", "type", "error"]) && errorId(entry.error);
  }
  if (entry.type === "unavailable") {
    return exactRecord(entry, ["id", "type", "reason", "source_type"],
      ["id", "type", "reason"]) && ["accessor_not_invoked", "source_value_unreadable",
        "unsupported_internal_state", "unsupported_value_type"].includes(entry.reason) &&
      (entry.source_type === undefined || typeof entry.source_type === "string");
  }
  return false;
}

export function isLauncherTestFailureDiagnostic(value) {
  try {
    if (!exactRecord(value,
      ["schema_version", "status", "root_error", "errors", "values", "issues"]) ||
        value.schema_version !== LAUNCHER_TEST_FAILURE_DIAGNOSTIC_SCHEMA_VERSION ||
        !["captured", "unavailable"].includes(value.status) ||
        !Array.isArray(value.errors) || !Array.isArray(value.values) ||
        !Array.isArray(value.issues) || value.issues.some((entry) =>
          !exactRecord(entry, ["path", "reason"]) || typeof entry.path !== "string" ||
          entry.path.length === 0 || !ISSUE_REASONS.has(entry.reason))) return false;
    const errorIds = value.errors.map((entry) => entry?.id);
    const valueIds = value.values.map((entry) => entry?.id);
    if (!uniqueStrings(errorIds) || !errorIds.every(errorId) ||
        !uniqueStrings(valueIds) || !valueIds.every(valueId) ||
        value.values.some((entry) => !validDiagnosticValue(entry))) return false;
    const errors = new Set(errorIds);
    const values = new Set(valueIds);
    if (value.status === "captured" ? !errors.has(value.root_error) :
      value.root_error !== null || value.errors.length !== 0 || value.values.length !== 0 ||
      value.issues.length === 0) return false;
    for (const entry of value.errors) {
      if (!exactRecord(entry, ["id", "name", "message", "code", "stack", "operator",
        "generated_message", "expected", "actual", "value", "cause", "aggregate_errors"],
      ["id"]) || !errorId(entry.id) ||
          ["name", "message", "code", "stack", "operator"].some((key) =>
            entry[key] !== undefined && typeof entry[key] !== "string") ||
          (entry.generated_message !== undefined && typeof entry.generated_message !== "boolean") ||
          ["expected", "actual", "value"].some((key) =>
            entry[key] !== undefined && !values.has(entry[key])) ||
          (entry.cause !== undefined && !errors.has(entry.cause)) ||
          (entry.aggregate_errors !== undefined && (!Array.isArray(entry.aggregate_errors) ||
            entry.aggregate_errors.some((id) => !errors.has(id))))) return false;
    }
    for (const entry of value.values) {
      const refs = [
        ...(entry.properties ?? []).map(({ value: id }) => id),
        ...(entry.elements ?? []).map(({ value: id }) => id),
        ...(entry.type === "map" ? entry.entries.flatMap(({ key, value: id }) => [key, id]) : []),
        ...(entry.type === "set" ? entry.entries : [])
      ];
      if (refs.some((ref) => !values.has(ref)) ||
          (entry.error !== undefined && !errors.has(entry.error))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function captureTestFailureDiagnostic(error) {
  if (error === undefined || error === null) return Object.freeze({
    schema_version: LAUNCHER_TEST_FAILURE_DIAGNOSTIC_SCHEMA_VERSION,
    status: "unavailable",
    root_error: null,
    errors: Object.freeze([]),
    values: Object.freeze([]),
    issues: Object.freeze([{ path: "/error", reason: "error_not_supplied" }])
  });
  const graph = graphCapture();
  const rootError = graph.captureError(error, "/error");
  return Object.freeze({
    schema_version: LAUNCHER_TEST_FAILURE_DIAGNOSTIC_SCHEMA_VERSION,
    status: "captured",
    root_error: rootError,
    errors: Object.freeze(graph.errors.map((entry) => Object.freeze(entry))),
    values: Object.freeze(graph.values.map((entry) => Object.freeze(entry))),
    issues: Object.freeze(graph.issues.map((entry) => Object.freeze(entry)))
  });
}
