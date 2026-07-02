import path from "node:path";
import { lstat, realpath } from "node:fs/promises";

const TARGET_SOURCES = new Set([
  "adapter_observed",
  "repo_config_static",
  "launcher_metadata",
  "user_supplied",
  "model_supplied",
  "test_fixture"
]);
const CHANGE_ENDPOINTS = {
  create: { required: ["new_path"], forbidden: ["old_path"], evaluated: ["new_path"] },
  modify: { required: ["new_path"], optionalEqual: ["old_path"], evaluated: ["new_path"] },
  delete: { required: ["old_path"], forbidden: ["new_path"], evaluated: ["old_path"] },
  rename: { required: ["old_path", "new_path"], evaluated: ["old_path", "new_path"] },
  copy: { required: ["old_path", "new_path"], evaluated: ["old_path", "new_path"] }
};

export class RoleGuardError extends Error {
  constructor(message, code = "role_guard_error") {
    super(message);
    this.name = "RoleGuardError";
    this.code = code;
  }
}

export function fail(message, code) {
  throw new RoleGuardError(message, code);
}

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function assertPlainObject(value, name) {
  if (!isPlainObject(value)) {
    fail(`${name} must be an object`, "schema_invalid");
  }
}

export function assertString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${name} must be a non-empty string`, "schema_invalid");
  }
}

export function rejectUnknownKeys(object, allowed, name) {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) {
      fail(`Unsupported ${name} key: ${key}`, "schema_unknown_key");
    }
  }
}

export function validatePattern(pattern, name) {
  if (typeof pattern !== "string" || pattern.length === 0) {
    fail(`${name} must be a non-empty glob string`, "path_pattern_invalid");
  }
  const slashPattern = pattern.replaceAll("\\", "/");
  const normalized = slashPattern.endsWith("/") ? `${slashPattern}**` : slashPattern;
  if (normalized === "." || normalized === "/" || normalized === "**" || normalized === "**/*") {
    fail(`${name} is repo-wide and rejected`, "repo_wide_pattern_rejected");
  }
  if (normalized.includes("..")) {
    fail(`${name} must not contain dot segments`, "path_pattern_invalid");
  }
  return normalized;
}

export function normalizeRepoRelativePath(input, name = "path") {
  assertString(input, name);
  const slashPath = input.replaceAll("\\", "/");
  if (path.posix.isAbsolute(slashPath) || /^[A-Za-z]:\//.test(slashPath) || slashPath.startsWith("//")) {
    fail(`${name} must be repo-relative`, "path_absolute_rejected");
  }
  const normalized = path.posix.normalize(slashPath);
  if (normalized === "." || normalized.startsWith("../") || normalized === "..") {
    fail(`${name} must remain inside repo`, "path_outside_repo");
  }
  if (normalized.includes("\0")) {
    fail(`${name} contains a NUL byte`, "path_invalid");
  }
  return normalized;
}

export function globToRegExp(pattern) {
  const normalized = validatePattern(pattern, "glob");
  let out = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];
    if (char === "*" && next === "*") {
      out += ".*";
      index += 1;
    } else if (char === "*") {
      out += "[^/]*";
    } else {
      out += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  out += "$";
  return new RegExp(out);
}

export function matchesAny(pathValue, patterns) {
  return patterns.some((pattern) => globToRegExp(pattern).test(pathValue));
}

export function assertPathInside(root, candidate, name) {
  const relative = path.relative(root, candidate);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return;
  }
  fail(`${name} must remain inside repo root`, "path_outside_repo");
}

async function rejectSymlinkedExistingComponents(repoRoot, relativePath) {
  const parts = relativePath.split("/");
  let current = repoRoot;
  for (const part of parts) {
    current = path.join(current, part);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) {
        fail(`write target uses symlinked component: ${relativePath}`, "path_symlink_rejected");
      }
    } catch (error) {
      if (error?.code === "ENOENT") {
        return;
      }
      throw error;
    }
  }
}

export async function normalizeAndValidateEvaluatedPaths({ repoRoot, config, paths }) {
  const root = await realpath(repoRoot);
  const normalizedPaths = [];
  for (const rawPath of paths) {
    const normalized = normalizeRepoRelativePath(rawPath, "target path");
    const absolutePath = path.resolve(root, normalized);
    assertPathInside(root, absolutePath, "target path");
    if (matchesAny(normalized, config.path_policy.deny)) {
      fail(`target path is denied by path_policy: ${normalized}`, "path_policy_denied");
    }
    await rejectSymlinkedExistingComponents(root, normalized);
    normalizedPaths.push(normalized);
  }
  return normalizedPaths;
}

export function scopeAllowsPath(scopePatterns, pathValue) {
  return matchesAny(pathValue, scopePatterns);
}

export function validateTargetPayload(payload, { expectedSource = null, allowTestFixture = false } = {}) {
  assertPlainObject(payload, "target payload");
  rejectUnknownKeys(
    payload,
    new Set(["target_source", "targets", "trusted_target_proof"]),
    "target payload"
  );
  if (!TARGET_SOURCES.has(payload.target_source)) {
    fail(`Unsupported target_source: ${payload.target_source}`, "target_source_invalid");
  }
  if (payload.target_source === "test_fixture" && !allowTestFixture) {
    fail("test_fixture targets are test-only", "test_fixture_rejected");
  }
  if (expectedSource && payload.target_source !== expectedSource) {
    fail(`target_source must be ${expectedSource}`, "target_source_invalid");
  }
  if (!Array.isArray(payload.targets) || payload.targets.length === 0) {
    fail("targets must be a non-empty array", "targets_missing");
  }
  const seen = new Set();
  const evaluatedPaths = [];
  const targets = payload.targets.map((target, index) => {
    assertPlainObject(target, `targets[${index}]`);
    rejectUnknownKeys(
      target,
      new Set(["change_kind", "old_path", "new_path"]),
      `targets[${index}]`
    );
    const rule = CHANGE_ENDPOINTS[target.change_kind];
    if (!rule) {
      fail(`Unsupported change_kind: ${target.change_kind}`, "change_kind_invalid");
    }
    for (const endpoint of rule.required) {
      if (!(endpoint in target)) {
        fail(`${target.change_kind} target missing ${endpoint}`, "target_endpoint_missing");
      }
    }
    for (const endpoint of rule.forbidden ?? []) {
      if (endpoint in target) {
        fail(`${target.change_kind} target must not include ${endpoint}`, "target_endpoint_contradiction");
      }
    }
    const normalized = { change_kind: target.change_kind };
    if (target.old_path !== undefined) {
      normalized.old_path = normalizeRepoRelativePath(target.old_path, "old_path");
    }
    if (target.new_path !== undefined) {
      normalized.new_path = normalizeRepoRelativePath(target.new_path, "new_path");
    }
    if (rule.optionalEqual?.includes("old_path") && normalized.old_path && normalized.old_path !== normalized.new_path) {
      fail("modify old_path must equal new_path when supplied", "target_endpoint_contradiction");
    }
    for (const endpoint of rule.evaluated) {
      const pathValue = normalized[endpoint];
      if (seen.has(pathValue)) {
        fail(`Duplicate target endpoint: ${pathValue}`, "target_duplicate");
      }
      seen.add(pathValue);
      evaluatedPaths.push(pathValue);
    }
    return normalized;
  });
  return {
    target_source: payload.target_source,
    targets,
    evaluated_paths: evaluatedPaths,
    trusted_target_proof: payload.trusted_target_proof ?? null
  };
}
