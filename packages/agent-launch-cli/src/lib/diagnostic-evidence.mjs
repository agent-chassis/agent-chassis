

export const DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION = "agent_launch.diagnostic_evidence.v1";
export const DIAGNOSTIC_EVIDENCE_MAX_DEPTH = 256;

const ERROR_CORE_KEYS = new Set(["name", "message", "stack", "cause"]);

function describeCaptureError(error) {
  const field = (read) => {
    try {
      const value = read();
      return typeof value === "string" ? value : value === undefined ? null : String(value);
    } catch {
      return null;
    }
  };
  const description = {
    name: field(() => error?.name),
    message: field(() => (typeof error === "object" && error !== null ? error.message : error)),
    stack: field(() => error?.stack)
  };
  return Object.values(description).every((value) => value === null)
    ? { $type: "unencodable" }
    : description;
}

export function captureDiagnosticEvidence(input, { publishedFields = {} } = {}) {
  const firstPaths = new Map();
  const published = new Map();
  for (const [field, object] of Object.entries(publishedFields)) {
    if (typeof object === "object" && object !== null && !published.has(object)) {
      published.set(object, field);
    }
  }
  const captureFailures = [];

  const pending = [];
  const segments = [];
  const guarded = (path, step, read) => {
    try {
      return { ok: true, value: read() };
    } catch (error) {
      captureFailures.push({ path, step, error: describeCaptureError(error) });
      return { ok: false, value: undefined };
    }
  };
  const keyLabel = (key) => (typeof key === "symbol" ? `@@${key.description ?? ""}` : key);
  const childPath = (path, key) => `${path}[${JSON.stringify(keyLabel(key))}]`;

  function encodeProperties(value, path, skip, child) {
    const keys = guarded(path, "own_keys", () => Reflect.ownKeys(value));
    const properties = {};
    if (!keys.ok) return properties;
    for (const key of keys.value) {
      if (skip.has(key)) continue;
      const label = keyLabel(key);
      const got = guarded(childPath(path, key), "get", () => value[key]);

      Object.defineProperty(properties, label.startsWith("$") ? `$${label}` : label, {
        value: got.ok ? child(got.value, childPath(path, key)) : { $type: "capture_failed" },
        enumerable: true,
        writable: true,
        configurable: true
      });
    }
    return properties;
  }

  function encode(value, path, depth = 0) {
    switch (typeof value) {
      case "string":
      case "boolean":
        return value;
      case "number":
        return Number.isFinite(value) && !Object.is(value, -0)
          ? value
          : { $type: "number", value: Object.is(value, -0) ? "-0" : String(value) };
      case "undefined":
        return { $type: "undefined" };
      case "bigint":
        return { $type: "bigint", value: value.toString() };
      case "symbol":
        return { $type: "symbol", description: value.description ?? null };
      default:
        break;
    }
    if (value === null) return null;
    if (firstPaths.has(value)) return { $ref: firstPaths.get(value) };
    if (published.has(value)) {
      firstPaths.set(value, path);
      return { $type: "published_field", field: published.get(value) };
    }
    if (depth >= DIAGNOSTIC_EVIDENCE_MAX_DEPTH) {

      const segment = segments.length + pending.length;
      pending.push({ segment, path, value });
      return { $type: "deep_segment", segment, continues_at: path };
    }
    const child = (entry, entryPath) => encode(entry, entryPath, depth + 1);
    firstPaths.set(value, path);
    const isArray = guarded(path, "is_array", () => Array.isArray(value));
    if (isArray.value === true) {
      const length = guarded(path, "length", () => value.length);
      const items = [];
      for (let index = 0; index < (length.ok ? length.value : 0); index += 1) {
        const got = guarded(`${path}[${index}]`, "get", () => value[index]);
        items.push(got.ok ? child(got.value, `${path}[${index}]`) : { $type: "capture_failed" });
      }
      return items;
    }
    const constructorName = guarded(path, "constructor", () => {
      const prototype = Object.getPrototypeOf(value);
      return prototype === null ? null : prototype?.constructor?.name ?? null;
    });
    const ctor = typeof constructorName.value === "string" ? constructorName.value : null;
    const isError = guarded(path, "instanceof_error", () => value instanceof Error).value === true;
    if (isError) {
      const core = (key) => {
        const got = guarded(childPath(path, key), "get", () => value[key]);
        return got.ok ? child(got.value, childPath(path, key)) : { $type: "capture_failed" };
      };
      const hasCause = guarded(path, "has_cause", () => "cause" in value).value === true;
      return {
        $type: "Error",
        constructor: ctor,
        name: core("name"),
        message: core("message"),
        stack: core("stack"),
        properties: encodeProperties(value, path, ERROR_CORE_KEYS, child),
        ...(hasCause ? { cause: core("cause") } : {})
      };
    }
    if (typeof value === "function") {
      return {
        $type: "function",
        name: guarded(path, "name", () => String(value.name)).value ?? null,
        properties: encodeProperties(value, path, new Set(["length", "name", "prototype"]), child)
      };
    }
    if (guarded(path, "instanceof_date", () => value instanceof Date).value === true) {
      const time = guarded(path, "date", () => value.getTime());
      return {
        $type: "Date",
        value: time.ok && Number.isFinite(time.value) ? new Date(time.value).toISOString() : "Invalid Date"
      };
    }
    if (guarded(path, "instanceof_map", () => value instanceof Map).value === true) {
      const entries = guarded(path, "map_entries", () => [...value.entries()]);
      return { $type: "Map", entries: child(entries.ok ? entries.value : [], `${path}["$entries"]`) };
    }
    if (guarded(path, "instanceof_set", () => value instanceof Set).value === true) {
      const values = guarded(path, "set_values", () => [...value.values()]);
      return { $type: "Set", values: child(values.ok ? values.value : [], `${path}["$values"]`) };
    }
    const properties = encodeProperties(value, path, new Set(), child);
    return ctor === null || ctor === "Object"
      ? properties
      : { $type: "object", constructor: ctor, properties };
  }

  let value;
  try {
    value = encode(input, "$");
  } catch (error) {

    captureFailures.push({ path: "$", step: "encode", error: describeCaptureError(error) });
    value = { $type: "capture_failed" };
  }

  while (pending.length > 0) {
    const next = pending.shift();
    let segmentValue;
    try {
      segmentValue = encode(next.value, next.path);
    } catch (error) {
      captureFailures.push({ path: next.path, step: "encode", error: describeCaptureError(error) });
      segmentValue = { $type: "capture_failed" };
    }
    segments.push({ segment: next.segment, continues_at: next.path, value: segmentValue });
  }
  return {
    schema_version: DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION,
    value,
    segments,
    capture_failures: captureFailures
  };
}
