import { createHash } from "node:crypto";

export function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function sortStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter(isNonEmptyString).map(String))]
    .sort((left, right) => left.localeCompare(right));
}

export function normalizeStringEntry(value) {
  return isNonEmptyString(value) ? String(value).trim() : null;
}

export function normalizeRepoPathForAdmission(value) {
  const rawPath = normalizeStringEntry(value);
  if (!rawPath) {
    return null;
  }
  return rawPath.replaceAll("\\", "/").replace(/^\.\//u, "");
}

export function isCoordinationRecordPath(value) {
  const normalizedPath = normalizeRepoPathForAdmission(value);
  return Boolean(normalizedPath && /^wiki\/work-records\/WK-\d{4}\.json$/u.test(normalizedPath));
}

export function classifyFileStatThresholdRole(entry) {
  return isCoordinationRecordPath(entry?.path) ? "coordination_record" : "threshold_counted";
}

export function uniqueBy(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of Array.isArray(items) ? items : []) {
    const key = keyFn(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

export function toNonNegativeInteger(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }
  return Math.trunc(numeric);
}

export function classifyNonNegativeInteger(value) {
  if (value === null || value === undefined || value === "") {
    return {
      value: null,
      status: "missing"
    };
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return {
      value: null,
      status: "invalid"
    };
  }

  return {
    value: Math.trunc(numeric),
    status: "valid"
  };
}

export function canonicalizeForDigest(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeForDigest(entry));
  }
  if (isObject(value)) {
    return Object.keys(value)
      .sort()
      .reduce((accumulator, key) => {
        if (value[key] !== undefined) {
          accumulator[key] = canonicalizeForDigest(value[key]);
        }
        return accumulator;
      }, {});
  }
  return value;
}

export function computeNormalizedInputDigest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonicalizeForDigest(value))).digest("hex")}`;
}

export function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function countUtf8Lines(text) {
  const normalized = String(text ?? "").replaceAll("\r\n", "\n");
  if (normalized.length === 0) {
    return 0;
  }

  const lines = normalized.split("\n");
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines.length;
}

export function normalizeNumericMetrics(input = {}) {
  const metrics = {};
  for (const [key, value] of Object.entries(isObject(input) ? input : {})) {
    const normalized = toNonNegativeInteger(value);
    if (normalized !== null) {
      metrics[key] = normalized;
    }
  }
  return metrics;
}

export function normalizeWorkUnitMetrics(value) {
  return normalizeNumericMetrics(value);
}

export function normalizeControlledVocabularyEntries(values, allowedValues, keyNames, issueName) {
  const entries = [];
  const normalizedValues = [];
  const invalidEntries = [];
  for (const entry of Array.isArray(values) ? values : []) {
    const rawValue = keyNames
      .map((key) => (isObject(entry) ? entry[key] : null))
      .find((candidate) => isNonEmptyString(candidate)) ?? entry;
    const normalizedValue = normalizeStringEntry(rawValue)?.toLowerCase();
    if (!normalizedValue || !allowedValues.has(normalizedValue)) {
      const invalidEntry = {
        ...(isObject(entry) ? entry : {}),
        ...(isNonEmptyString(rawValue) ? { raw_value: String(rawValue).trim() } : {}),
        value: null,
        status: "invalid",
        evidence: {
          issue: issueName,
          status: "invalid",
          reason: `unsupported ${issueName}`
        }
      };
      entries.push(invalidEntry);
      invalidEntries.push(invalidEntry);
      continue;
    }
    entries.push(
      isObject(entry)
        ? { ...entry, value: normalizedValue, status: "valid" }
        : { value: normalizedValue, status: "valid" }
    );
    normalizedValues.push(normalizedValue);
  }
  return {
    entries,
    values: sortStrings(normalizedValues),
    invalidEntries,
    invalidCount: invalidEntries.length
  };
}

export function normalizeDeclaredPathEntries(values) {
  const output = [];
  for (const entry of Array.isArray(values) ? values : []) {
    if (isNonEmptyString(entry)) {
      output.push(String(entry));
      continue;
    }
    if (isObject(entry) && isNonEmptyString(entry.path)) {
      output.push(String(entry.path));
    }
  }
  return sortStrings(output);
}

export function pathCategory(path) {
  const value = String(path || "");
  if (value.startsWith("tests/") || value.includes(".test.") || value.includes(".spec.")) {
    return "test";
  }
  if (value.startsWith("docs/")) {
    return "docs";
  }
  if (value.startsWith("wiki/")) {
    return "wiki";
  }
  if (value.startsWith("packages/agent-launch-")) {
    return "launcher";
  }
  if (value.startsWith("packages/wiki-mcp/")) {
    return "mcp";
  }
  if (value.startsWith("packages/wiki-cli/")) {
    return "cli";
  }
  if (value.startsWith("packages/node-engine/")) {
    return "node_engine";
  }
  return "implementation";
}

export function isCriticalSurfacePath(path) {
  const value = String(path || "");
  return (
    value === "docs/agent-blackboard-protocol.md" ||
    value === "docs/agent-launch-quickstart.md" ||
    value === "docs/work-record-schema.md" ||
    value.startsWith("packages/agent-launch-cli/") ||
    value.startsWith("packages/agent-launch-core/") ||
    value.startsWith("packages/wiki-core/src/lib/work-record-") ||
    value === "packages/wiki-core/src/index.mjs"
  );
}

export function isRuntimeOrSchemaPath(path) {
  const value = String(path || "");
  return (
    pathCategory(value) === "implementation" ||
    pathCategory(value) === "launcher" ||
    pathCategory(value) === "cli" ||
    pathCategory(value) === "mcp" ||
    pathCategory(value) === "node_engine" ||
    isCriticalSurfacePath(value)
  );
}

export function isCodeSurfacePath(value) {
  const normalized = String(value || "").replaceAll("\\", "/").replace(/^\.\//u, "");
  if (!normalized) {
    return false;
  }
  if (normalized.startsWith("docs/")) {
    return false;
  }
  if (normalized.startsWith("wiki/")) {
    return false;
  }
  if (/^tests?\//u.test(normalized) || normalized.includes(".test.") || normalized.includes(".spec.")) {
    return true;
  }
  if (
    normalized.startsWith("packages/") ||
    normalized === "package.json" ||
    normalized.startsWith("scripts/") ||
    normalized.startsWith("bin/") ||
    normalized.endsWith(".mjs") ||
    normalized.endsWith(".js") ||
    normalized.endsWith(".ts") ||
    normalized.endsWith(".tsx") ||
    normalized.endsWith(".sh")
  ) {
    return true;
  }
  return false;
}

export function classifyExistingCodeSurfaceCount(fileStats) {
  return (Array.isArray(fileStats) ? fileStats : []).filter(
    (entry) =>
      isObject(entry) &&
      entry.existing_file === true &&
      classifyFileStatThresholdRole(entry) !== "coordination_record" &&
      isCodeSurfacePath(entry.path)
  ).length;
}

export function collectThresholdCountedLocValues(fileStats) {
  return (Array.isArray(fileStats) ? fileStats : [])
    .filter((entry) => classifyFileStatThresholdRole(entry) !== "coordination_record")
    .map((entry) => toNonNegativeInteger(entry.loc))
    .filter((value) => value !== null);
}

export function collectThresholdCountedFileStats(fileStats) {
  return (Array.isArray(fileStats) ? fileStats : []).filter(
    (entry) => classifyFileStatThresholdRole(entry) !== "coordination_record"
  );
}
