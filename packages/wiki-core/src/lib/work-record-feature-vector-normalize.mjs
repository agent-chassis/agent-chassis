

import { WORK_UNIT_PROVENANCE_VALUES } from "./work-record-feature-vector-vocabulary.mjs";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeString(value) {
  return isNonEmptyString(value) ? value.trim() : null;
}

function normalizeRepoPath(value) {
  const normalized = normalizeString(value);
  return normalized ? normalized.replaceAll("\\", "/").replace(/^\.\//u, "") : null;
}

function normalizeControlledValue(value, allowedValues) {
  const normalized = normalizeString(value)?.toLowerCase().replaceAll("-", "_").replace(/\s+/gu, "_") ?? null;
  const allowed = allowedValues instanceof Set ? allowedValues : new Set(Array.isArray(allowedValues) ? allowedValues : []);
  return normalized && allowed.has(normalized) ? normalized : null;
}

function normalizeBoolean(value) {
  if (value === true || value === false) {
    return value;
  }
  const normalized = normalizeString(value)?.toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return null;
}

function normalizeNonNegativeInteger(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }
  return Math.trunc(numeric);
}

function normalizeControlledValueWithSource(value, allowedValues) {
  const normalized = normalizeControlledValue(value, allowedValues);
  if (!normalized) {
    return {
      value: null,
      provenance: "unavailable"
    };
  }
  return {
    value: normalized,
    provenance: "authored_record"
  };
}

function normalizeProvenance(value, fallback = "unavailable") {
  const normalized = normalizeControlledValue(value, WORK_UNIT_PROVENANCE_VALUES);
  return normalized ?? fallback;
}

function createMetricEntry(value, provenance = "derived_normalizer", basis = null) {
  const entry = { value, provenance };
  if (basis) {
    entry.basis = basis;
  }
  return entry;
}

function sortObjectEntries(entries) {
  return Object.fromEntries(
    [...entries].sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey, "en"))
  );
}

function countBy(items, selector) {
  const counts = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const rawKey = selector(item);
    const key = normalizeString(rawKey);
    if (!key) {
      continue;
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return sortObjectEntries(counts.entries());
}

function countByPair(items, leftSelector, rightSelector, separator = "::") {
  const counts = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const left = normalizeString(leftSelector(item));
    const right = normalizeString(rightSelector(item));
    if (!left || !right) {
      continue;
    }
    const key = `${left}${separator}${right}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return sortObjectEntries(counts.entries());
}

function uniqueCount(items, selector) {
  return new Set(
    (Array.isArray(items) ? items : [])
      .map((item) => normalizeString(selector(item)))
      .filter(Boolean)
  ).size;
}

function selectArrayCandidate(sources, keys) {
  for (const source of sources) {
    if (!isObject(source)) {
      continue;
    }
    for (const key of keys) {
      if (Array.isArray(source[key])) {
        return source[key];
      }
    }
  }
  return [];
}

function selectObjectCandidate(sources, keys) {
  for (const source of sources) {
    if (!isObject(source)) {
      continue;
    }
    for (const key of keys) {
      if (isObject(source[key])) {
        return source[key];
      }
    }
  }
  return null;
}

function normalizeFacetProvenance(rawValue, defaults = {}) {
  const raw = isObject(rawValue) ? rawValue : {};
  const result = {};
  for (const [fieldName, defaultValue] of Object.entries(defaults)) {
    result[fieldName] = normalizeProvenance(raw[fieldName], defaultValue);
  }
  return result;
}

export {
  isObject,
  isNonEmptyString,
  normalizeString,
  normalizeRepoPath,
  normalizeControlledValue,
  normalizeBoolean,
  normalizeProvenance,
  createMetricEntry,
  countBy,
  countByPair,
  uniqueCount,
  selectArrayCandidate,
  normalizeFacetProvenance
};
