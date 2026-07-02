import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

const UNSUPPORTED_GLOB_SYNTAX = /[?[\]{}]/;

export const SIDECAR_FORBIDDEN_PATH_PATTERNS = Object.freeze([
  { pattern: "wiki/catalog.md", reason: "generated wiki view" },
  { pattern: "wiki/now.md", reason: "generated wiki view" },
  { pattern: "wiki/inbox.md", reason: "generated wiki view" },
  { pattern: "wiki/backlog.md", reason: "generated wiki view" },
  { pattern: "wiki/archive.md", reason: "generated wiki view" },
  { pattern: "wiki/generated/**", reason: "generated wiki view" },
  { pattern: ".agent-runs/**", reason: "launcher/runtime scratch state" },
  { pattern: ".cache/**", reason: "generated caches, including code index cache" },
  { pattern: "node_modules/**", reason: "dependency install output" },
  { pattern: "**/node_modules/**", reason: "nested dependency install output" },
  { pattern: ".turbo/**", reason: "build/cache output" },
  { pattern: "**/.turbo/**", reason: "nested build/cache output" },
  { pattern: ".next/**", reason: "build output" },
  { pattern: "**/.next/**", reason: "nested build output" },
  { pattern: "dist/**", reason: "build output" },
  { pattern: "**/dist/**", reason: "nested build output" },
  { pattern: "build/**", reason: "build output" },
  { pattern: "**/build/**", reason: "nested build output" },
  { pattern: "out/**", reason: "build output" },
  { pattern: "**/out/**", reason: "nested build output" },
  { pattern: "coverage/**", reason: "coverage output" },
  { pattern: "**/coverage/**", reason: "nested coverage output" },
  { pattern: ".git/**", reason: "VCS metadata" },
  { pattern: "**/.git/**", reason: "nested VCS metadata" },
  { pattern: ".gitmodules", reason: "VCS/submodule control file" },
  { pattern: ".codex", reason: "local agent-control state" },
  { pattern: ".codex/**", reason: "local agent-control state" },
  { pattern: "**/.codex", reason: "nested local agent-control state" },
  { pattern: "**/.codex/**", reason: "nested local agent-control state" },
  { pattern: ".claude", reason: "local agent-control state" },
  { pattern: ".claude/**", reason: "local agent-control state" },
  { pattern: "**/.claude", reason: "nested local agent-control state" },
  { pattern: "**/.claude/**", reason: "nested local agent-control state" },
  { pattern: ".env*", reason: "secret-like local file" },
  { pattern: "**/.env*", reason: "nested secret-like local file" }
]);

export const SIDECAR_DIRTY_IGNORED_RUNTIME_PATTERNS = Object.freeze([
  { pattern: ".cache/**", reason: "ignored generated cache state" },
  { pattern: ".codex", reason: "ignored local agent-control state" },
  { pattern: ".codex/**", reason: "ignored local agent-control state" },
  { pattern: "**/.codex", reason: "ignored nested local agent-control state" },
  { pattern: "**/.codex/**", reason: "ignored nested local agent-control state" },
  { pattern: ".claude", reason: "ignored local agent-control state" },
  { pattern: ".claude/**", reason: "ignored local agent-control state" },
  { pattern: "**/.claude", reason: "ignored nested local agent-control state" },
  { pattern: "**/.claude/**", reason: "ignored nested local agent-control state" }
]);

export const SIDECAR_SOURCE_PATH_FIXTURES = Object.freeze([
  { path: "packages/wiki-core/src/index.mjs", forbidden: false, dirtyIgnored: false },
  { path: "wiki/issues/WK-0036.md", forbidden: false, dirtyIgnored: false },
  { path: "wiki/catalog.md", forbidden: true, pattern: "wiki/catalog.md", dirtyIgnored: false },
  { path: "wiki/now.md", forbidden: true, pattern: "wiki/now.md", dirtyIgnored: false },
  { path: "wiki/inbox.md", forbidden: true, pattern: "wiki/inbox.md", dirtyIgnored: false },
  { path: "wiki/backlog.md", forbidden: true, pattern: "wiki/backlog.md", dirtyIgnored: false },
  { path: "wiki/archive.md", forbidden: true, pattern: "wiki/archive.md", dirtyIgnored: false },
  { path: "wiki/generated", forbidden: true, pattern: "wiki/generated/**", dirtyIgnored: false },
  { path: "wiki/generated/view.md", forbidden: true, pattern: "wiki/generated/**", dirtyIgnored: false },
  { path: ".agent-runs/RUN-1/response.md", forbidden: true, pattern: ".agent-runs/**", dirtyIgnored: false },
  { path: ".cache", forbidden: true, pattern: ".cache/**", dirtyIgnored: true },
  { path: ".cache/wiki-search/index.json", forbidden: true, pattern: ".cache/**", dirtyIgnored: true },
  { path: "node_modules/pkg/index.js", forbidden: true, pattern: "node_modules/**", dirtyIgnored: false },
  { path: "packages/app/node_modules/pkg/index.js", forbidden: true, pattern: "**/node_modules/**", dirtyIgnored: false },
  { path: ".turbo/cache.bin", forbidden: true, pattern: ".turbo/**", dirtyIgnored: false },
  { path: "packages/app/.turbo/cache.bin", forbidden: true, pattern: "**/.turbo/**", dirtyIgnored: false },
  { path: ".next/server/app.js", forbidden: true, pattern: ".next/**", dirtyIgnored: false },
  { path: "packages/app/.next/server/app.js", forbidden: true, pattern: "**/.next/**", dirtyIgnored: false },
  { path: "dist/index.js", forbidden: true, pattern: "dist/**", dirtyIgnored: false },
  { path: "packages/app/dist/index.js", forbidden: true, pattern: "**/dist/**", dirtyIgnored: false },
  { path: "build/index.js", forbidden: true, pattern: "build/**", dirtyIgnored: false },
  { path: "packages/app/build/index.js", forbidden: true, pattern: "**/build/**", dirtyIgnored: false },
  { path: "out/index.js", forbidden: true, pattern: "out/**", dirtyIgnored: false },
  { path: "packages/app/out/index.js", forbidden: true, pattern: "**/out/**", dirtyIgnored: false },
  { path: "coverage/lcov.info", forbidden: true, pattern: "coverage/**", dirtyIgnored: false },
  { path: "packages/app/coverage/lcov.info", forbidden: true, pattern: "**/coverage/**", dirtyIgnored: false },
  { path: ".git/config", forbidden: true, pattern: ".git/**", dirtyIgnored: false },
  { path: "packages/app/.git/config", forbidden: true, pattern: "**/.git/**", dirtyIgnored: false },
  { path: ".gitmodules", forbidden: true, pattern: ".gitmodules", dirtyIgnored: false },
  { path: ".codex", forbidden: true, pattern: ".codex", dirtyIgnored: true },
  { path: ".codex/session.json", forbidden: true, pattern: ".codex/**", dirtyIgnored: true },
  { path: "packages/app/.codex", forbidden: true, pattern: "**/.codex", dirtyIgnored: true },
  { path: "packages/app/.codex/session.json", forbidden: true, pattern: "**/.codex/**", dirtyIgnored: true },
  { path: ".claude", forbidden: true, pattern: ".claude", dirtyIgnored: true },
  { path: ".claude/settings.json", forbidden: true, pattern: ".claude/**", dirtyIgnored: true },
  { path: "packages/app/.claude", forbidden: true, pattern: "**/.claude", dirtyIgnored: true },
  { path: "packages/app/.claude/settings.json", forbidden: true, pattern: "**/.claude/**", dirtyIgnored: true },
  { path: ".env", forbidden: true, pattern: ".env*", dirtyIgnored: false },
  { path: ".env.local", forbidden: true, pattern: ".env*", dirtyIgnored: false },
  { path: ".env.example", forbidden: true, pattern: ".env*", dirtyIgnored: false },
  { path: ".env.production.example", forbidden: true, pattern: ".env*", dirtyIgnored: false },
  { path: ".env.sample", forbidden: true, pattern: ".env*", dirtyIgnored: false },
  { path: ".env.template", forbidden: true, pattern: ".env*", dirtyIgnored: false },
  { path: ".env.example.local", forbidden: true, pattern: ".env*", dirtyIgnored: false },
  { path: "packages/app/.env", forbidden: true, pattern: "**/.env*", dirtyIgnored: false },
  { path: "packages/app/.env.local", forbidden: true, pattern: "**/.env*", dirtyIgnored: false },
  { path: "packages/app/.env.example", forbidden: true, pattern: "**/.env*", dirtyIgnored: false },
  {
    path: "packages/app/.env.production.example",
    forbidden: true,
    pattern: "**/.env*",
    dirtyIgnored: false
  },
  { path: "packages/app/.env.sample", forbidden: true, pattern: "**/.env*", dirtyIgnored: false },
  {
    path: "packages/app/.env.template",
    forbidden: true,
    pattern: "**/.env*",
    dirtyIgnored: false
  },
  {
    path: "packages/app/.env.example.local",
    forbidden: true,
    pattern: "**/.env*",
    dirtyIgnored: false
  },
  { path: ".envrc", forbidden: true, pattern: ".env*", dirtyIgnored: false },
  { path: "packages/app/.envrc", forbidden: true, pattern: "**/.env*", dirtyIgnored: false }
]);

export function pathIsSameOrDescendant(parentPath, candidatePath) {
  const normalizedParent = String(parentPath || "").replace(/\/+$/, "");
  const normalizedCandidate = String(candidatePath || "").replace(/\/+$/, "");
  if (!normalizedParent || !normalizedCandidate) {
    return false;
  }
  const parentSegments = normalizedParent.split("/");
  const candidateSegments = normalizedCandidate.split("/");
  if (candidateSegments.length < parentSegments.length) {
    return false;
  }
  return parentSegments.every((segment, index) => segment === candidateSegments[index]);
}

export const SIDECAR_INVALID_PATH_FIXTURES = Object.freeze([
  "",
  "/absolute/path",
  "C:/absolute/path",
  "C:relative/path",
  "foo\\bar",
  "foo\0bar",
  "foo//bar",
  "foo/./bar",
  "foo/../bar",
  "foo/"
]);

export class SidecarPathValidationError extends Error {
  constructor(message, { code, inputPath, relativePath, pattern, reason } = {}) {
    super(message);
    this.name = "SidecarPathValidationError";
    this.code = code;
    this.inputPath = inputPath;
    this.relativePath = relativePath;
    this.pattern = pattern;
    this.reason = reason;
  }
}

function fail(message, details) {
  throw new SidecarPathValidationError(message, details);
}

function hasDriveLetterPath(value) {
  return /^[A-Za-z]:/.test(value);
}

function normalizePathInput(inputPath) {
  if (typeof inputPath !== "string") {
    fail("sidecar path must be a string", { code: "invalid_type", inputPath });
  }

  const value = inputPath;
  if (!value) {
    fail("sidecar path must not be empty", { code: "empty_path", inputPath });
  }
  if (value.includes("\0")) {
    fail("sidecar path must not contain NUL bytes", { code: "nul_byte", inputPath });
  }
  if (value.includes("\\")) {
    fail("sidecar path must use / separators", { code: "backslash", inputPath });
  }
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || hasDriveLetterPath(value)) {
    fail("sidecar path must be repository-relative", { code: "absolute_path", inputPath });
  }
  if (value.includes("//")) {
    fail("sidecar path must not contain repeated separators", {
      code: "repeated_separator",
      inputPath
    });
  }

  const segments = value.split("/");
  if (segments.some((segment) => segment === "")) {
    fail("sidecar path must not contain empty segments", { code: "empty_segment", inputPath });
  }
  if (segments.some((segment) => segment === "." || segment === "..")) {
    fail("sidecar path must not contain dot segments", { code: "dot_segment", inputPath });
  }

  return value;
}

export function normalizeSidecarRepoPath(inputPath) {
  return normalizePathInput(inputPath);
}

function validatePatternSyntax(pattern) {
  normalizePathInput(pattern);
  if (UNSUPPORTED_GLOB_SYNTAX.test(pattern)) {
    fail("sidecar path pattern uses unsupported glob syntax", {
      code: "unsupported_glob_syntax",
      inputPath: pattern
    });
  }

  const segments = pattern.split("/");
  for (const [index, segment] of segments.entries()) {
    const validDoubleStarSegment =
      segment === "**" &&
      ((index === 0 && pattern.startsWith("**/")) ||
        (index === segments.length - 1 && pattern.endsWith("/**")));
    if (segment.includes("**") && !validDoubleStarSegment) {
      fail("sidecar path pattern uses unsupported ** placement", {
        code: "unsupported_double_star",
        inputPath: pattern
      });
    }
  }
}

function segmentMatches(patternSegment, pathSegment) {
  if (!patternSegment.includes("*")) {
    return patternSegment === pathSegment;
  }

  const parts = patternSegment.split("*");
  let offset = 0;

  if (!pathSegment.startsWith(parts[0])) {
    return false;
  }
  offset = parts[0].length;

  for (let index = 1; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part) {
      continue;
    }
    const nextOffset = pathSegment.indexOf(part, offset);
    if (nextOffset === -1) {
      return false;
    }
    offset = nextOffset + part.length;
  }

  const lastPart = parts.at(-1);
  return lastPart === "" || pathSegment.endsWith(lastPart);
}

function anchoredPatternMatches(pattern, relativePath) {
  if (pattern.endsWith("/**")) {
    const directoryPattern = pattern.slice(0, -3);
    const directorySegments = directoryPattern.split("/");
    const pathSegments = relativePath.split("/");
    if (pathSegments.length < directorySegments.length) {
      return false;
    }
    return directorySegments.every((patternSegment, index) =>
      segmentMatches(patternSegment, pathSegments[index])
    );
  }

  const patternSegments = pattern.split("/");
  const pathSegments = relativePath.split("/");
  if (patternSegments.length !== pathSegments.length) {
    return false;
  }

  return patternSegments.every((patternSegment, index) =>
    segmentMatches(patternSegment, pathSegments[index])
  );
}

function patternMatches(pattern, relativePath) {
  if (!pattern.startsWith("**/")) {
    return anchoredPatternMatches(pattern, relativePath);
  }

  const remainder = pattern.slice(3);
  const segments = relativePath.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    const suffix = segments.slice(index).join("/");
    if (patternMatches(remainder, suffix)) {
      return true;
    }
  }
  return false;
}

export function matchSidecarPathPattern(pattern, inputPath) {
  validatePatternSyntax(pattern);
  return patternMatches(pattern, normalizePathInput(inputPath));
}

export function getForbiddenSidecarPathMatch(relativePath) {
  const normalizedPath = normalizePathInput(relativePath);
  return (
    SIDECAR_FORBIDDEN_PATH_PATTERNS.find(({ pattern }) =>
      patternMatches(pattern, normalizedPath)
    ) || null
  );
}

export function validateVirtualSidecarPath(inputPath) {
  const relativePath = normalizePathInput(inputPath);
  const forbidden = getForbiddenSidecarPathMatch(relativePath);
  if (forbidden) {
    fail(`sidecar path '${relativePath}' is forbidden by pattern '${forbidden.pattern}'`, {
      code: "forbidden_path",
      inputPath,
      relativePath,
      pattern: forbidden.pattern,
      reason: forbidden.reason
    });
  }

  return { relativePath };
}

export function isForbiddenSidecarSourcePath(relativePath) {
  return getForbiddenSidecarPathMatch(relativePath) != null;
}

export function getSidecarDirtyIgnoredPathMatch(relativePath) {
  const normalizedPath = normalizePathInput(relativePath);
  return (
    SIDECAR_DIRTY_IGNORED_RUNTIME_PATTERNS.find(({ pattern }) =>
      matchSidecarPathPattern(pattern, normalizedPath)
    ) || null
  );
}

export function isSidecarDirtyIgnoredPath(relativePath) {
  return getSidecarDirtyIgnoredPathMatch(relativePath) != null;
}

function isContainedRelativePath(relativePath) {
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

export async function validateExistingSidecarPath({ dir, inputPath }) {
  const { relativePath } = validateVirtualSidecarPath(inputPath);
  const repoRoot = await realpath(path.resolve(dir));
  const candidatePath = path.resolve(repoRoot, relativePath);

  let stats;
  try {
    stats = await lstat(candidatePath);
  } catch (error) {
    fail(`sidecar path '${relativePath}' does not exist`, {
      code: "missing_path",
      inputPath,
      relativePath,
      reason: error.message
    });
  }

  const candidateRealPath = await realpath(candidatePath);
  const containment = path.relative(repoRoot, candidateRealPath);
  if (!isContainedRelativePath(containment)) {
    fail(`sidecar path '${relativePath}' resolves outside the repository`, {
      code: "outside_repo",
      inputPath,
      relativePath
    });
  }

  return {
    relativePath,
    absolutePath: candidatePath,
    realPath: candidateRealPath,
    stats
  };
}

export function filterSidecarSourcePaths(inputPaths) {
  const included = [];
  const rejected = [];

  for (const inputPath of inputPaths) {
    try {
      const { relativePath } = validateVirtualSidecarPath(inputPath);
      included.push(relativePath);
    } catch (error) {
      if (error instanceof SidecarPathValidationError) {
        rejected.push({
          inputPath,
          code: error.code,
          relativePath: error.relativePath,
          pattern: error.pattern,
          reason: error.reason || error.message
        });
        continue;
      }
      throw error;
    }
  }

  return { included, rejected };
}

function parsePatchEndpoint(value, endpointKind) {
  if (value === "/dev/null") {
    return null;
  }

  if (endpointKind === "old" && value.startsWith("a/")) {
    return value.slice(2);
  }
  if (endpointKind === "new" && value.startsWith("b/")) {
    return value.slice(2);
  }

  return value;
}

function classifyDiffRecord(record) {
  if (record.changeKind) {
    return record.changeKind;
  }
  if (record.oldPath == null && record.newPath != null) {
    return "added";
  }
  if (record.oldPath != null && record.newPath == null) {
    return "deleted";
  }
  return "modified";
}

function validateParsedDiffRecord(record) {
  const validated = {
    changeKind: classifyDiffRecord(record),
    oldPath: null,
    newPath: null
  };

  if (record.oldPath != null) {
    validated.oldPath = validateVirtualSidecarPath(record.oldPath).relativePath;
  }
  if (record.newPath != null) {
    validated.newPath = validateVirtualSidecarPath(record.newPath).relativePath;
  }
  if (validated.oldPath == null && validated.newPath == null) {
    fail("diff record must contain an old path, new path, or absent endpoint", {
      code: "empty_diff_record"
    });
  }

  return validated;
}

export function validateParsedSidecarDiffRecords(records) {
  if (!Array.isArray(records)) {
    fail("diff records must be an array", { code: "invalid_diff_records" });
  }

  return records.map((record) => {
    if (record == null || typeof record !== "object" || Array.isArray(record)) {
      fail("diff record must be an object", {
        code: "invalid_diff_record",
        reason: "diff record must be an object"
      });
    }
    return validateParsedDiffRecord({
      changeKind: record.changeKind,
      oldPath: record.oldPath ?? null,
      newPath: record.newPath ?? null
    });
  });
}

export function parseSidecarPatch(patchText) {
  const lines = String(patchText ?? "").replace(/\r\n?/g, "\n").split("\n");
  const records = [];
  let current = null;

  const flush = () => {
    if (!current) {
      return;
    }
    if (current.oldPath != null || current.newPath != null) {
      records.push({
        changeKind: classifyDiffRecord(current),
        oldPath: current.oldPath ?? null,
        newPath: current.newPath ?? null
      });
    }
    current = null;
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      flush();
      current = {};
      continue;
    }
    if (!current) {
      continue;
    }

    if (line === "new file mode" || line.startsWith("new file mode ")) {
      current.changeKind = "added";
      continue;
    }
    if (line === "deleted file mode" || line.startsWith("deleted file mode ")) {
      current.changeKind = "deleted";
      continue;
    }
    if (line.startsWith("rename from ")) {
      current.changeKind = "renamed";
      current.oldPath = line.slice("rename from ".length);
      continue;
    }
    if (line.startsWith("rename to ")) {
      current.changeKind = "renamed";
      current.newPath = line.slice("rename to ".length);
      continue;
    }
    if (line.startsWith("copy from ")) {
      current.changeKind = "copied";
      current.oldPath = line.slice("copy from ".length);
      continue;
    }
    if (line.startsWith("copy to ")) {
      current.changeKind = "copied";
      current.newPath = line.slice("copy to ".length);
      continue;
    }
    if (line.startsWith("--- ")) {
      current.oldPath = parsePatchEndpoint(line.slice(4), "old");
      continue;
    }
    if (line.startsWith("+++ ")) {
      current.newPath = parsePatchEndpoint(line.slice(4), "new");
    }
  }

  flush();
  return records;
}

export function parseAndValidateSidecarPatch(patchText) {
  return validateParsedSidecarDiffRecords(parseSidecarPatch(patchText));
}
