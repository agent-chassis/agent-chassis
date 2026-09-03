import { createHash } from "node:crypto";

class ExactBindingError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ExactBindingError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort(compareCodeUnits).map(
      (key) => [key, canonicalValue(value[key])]
    )
  );
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new ExactBindingError("canonical_json_number_invalid",
      "canonical JSON accepts only finite numbers");
  }
  return Object.is(value, -0) ? 0 : value;
}

function canonicalJsonBytes(value, { file = false } = {}) {
  return Buffer.from(`${JSON.stringify(canonicalValue(value))}${file ? "\n" : ""}`, "utf8");
}
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function canonicalDigest(value) { return sha256(canonicalJsonBytes(value)); }
function parseCanonicalDocument(bytes, label) {
  let value;
  try {
    value = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch (error) {
    throw new ExactBindingError("projection_input_json_invalid",
      `${label} is not valid JSON`, { label, cause: error.message });
  }
  if (!Buffer.from(bytes).equals(canonicalJsonBytes(value, { file: true }))) {
    throw new ExactBindingError("projection_input_noncanonical",
      `${label} must be canonical JSON plus exactly one LF`, { label });
  }
  return value;
}
function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
function sortedUnique(values) {
  return new Set(values).size === values.length && values.every(
    (value, index) => index === 0 || compareCodeUnits(values[index - 1], value) < 0
  );
}

function unsupportedObjectKeys(value, allowedKeys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
  const allowed = new Set(allowedKeys);
  return Object.keys(value).filter((key) => !allowed.has(key)).sort(compareCodeUnits);
}

export { ExactBindingError, canonicalDigest, canonicalJsonBytes, canonicalValue,
  compareCodeUnits, deepFreeze, parseCanonicalDocument, sha256, sortedUnique,
  unsupportedObjectKeys };
