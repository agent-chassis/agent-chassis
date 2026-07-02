

const SHELL_SUFFIX_PATTERN = /\.(sh|bash|zsh|fish)$/i;
const BIN_WRAPPER_PATTERN = /^packages\/[^/]+\/bin\/([^/]+)$/;
const BIN_WRAPPER_PACKAGE_PATTERN = /^packages\/([^/]+)\/bin\/([^/]+)$/;
const SRC_DELEGATE_PATTERN = /^packages\/([^/]+)\/src\/.+\.mjs$/;

export function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

export function normalizeOperationShape(value) {
  return isNonEmptyString(value) ? value.trim().toLowerCase().replace(/\s+/g, " ") : null;
}

export function toNonNegativeInteger(value) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : null;
}

export function stringifyPathList(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter(isNonEmptyString))].sort(
    (left, right) => left.localeCompare(right)
  );
}

export function uniqueBy(values, keyFn) {
  const seen = new Set();
  const output = [];
  for (const value of Array.isArray(values) ? values : []) {
    const key = keyFn(value);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(value);
  }
  return output;
}

export function compareArrays(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function parseIsoTimestamp(value) {
  if (!isNonEmptyString(value)) {
    return Number.NaN;
  }
  return Date.parse(value);
}

export function isBashWrapperPath(relativePath) {
  if (typeof relativePath !== "string") {
    return false;
  }
  if (SHELL_SUFFIX_PATTERN.test(relativePath)) {
    return true;
  }
  const match = BIN_WRAPPER_PATTERN.exec(relativePath);
  return match ? !match[1].includes(".") : false;
}

export function getShimWrapperPackageAndBasename(wrapperPath) {
  const match = BIN_WRAPPER_PACKAGE_PATTERN.exec(wrapperPath);
  if (!match) {
    return null;
  }

  return {
    packageName: match[1],
    basename: match[2]
  };
}

export function isShimDelegatePathForWrapper(wrapperPath, candidatePath) {
  const wrapperInfo = getShimWrapperPackageAndBasename(wrapperPath);
  if (!wrapperInfo || typeof candidatePath !== "string") {
    return false;
  }

  return SRC_DELEGATE_PATTERN.test(candidatePath) && candidatePath.startsWith(`packages/${wrapperInfo.packageName}/src/`);
}

export function isShimTestPathForWrapper(wrapperBasename, candidatePath) {
  if (typeof wrapperBasename !== "string" || typeof candidatePath !== "string") {
    return false;
  }

  return candidatePath === `tests/${wrapperBasename}-shim.test.mjs`;
}
