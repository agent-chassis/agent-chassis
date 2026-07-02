import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { countUtf8Lines } from "./work-record-admission-shared.mjs";

export const REPO_LOC_INVENTORY_SCHEMA_VERSION = "repo-loc-inventory.v1";
export const REPO_LOC_INVENTORY_DEFAULT_THRESHOLD = 1200;

export const REPO_LOC_INVENTORY_EXCLUSION_RULES = Object.freeze([
  { pattern: "wiki/catalog.md", reason: "generated wiki view", role: "generated", classification: "generated_wiki_view" },
  { pattern: "wiki/now.md", reason: "generated wiki view", role: "generated", classification: "generated_wiki_view" },
  { pattern: "wiki/inbox.md", reason: "generated wiki view", role: "generated", classification: "generated_wiki_view" },
  { pattern: "wiki/backlog.md", reason: "generated wiki view", role: "generated", classification: "generated_wiki_view" },
  { pattern: "wiki/archive.md", reason: "generated wiki view", role: "generated", classification: "generated_wiki_view" },
  { pattern: "wiki/generated/**", reason: "generated wiki view", role: "generated", classification: "generated_wiki_view" },
  { pattern: ".agent-runs/**", reason: "launcher/runtime scratch state", role: "runtime_artifact", classification: "runtime_artifact" },
  { pattern: ".cache/**", reason: "generated cache", role: "cache", classification: "cache" },
  { pattern: "node_modules/**", reason: "dependency install output", role: "dependency", classification: "dependency" },
  { pattern: "**/node_modules/**", reason: "nested dependency install output", role: "dependency", classification: "dependency" },
  { pattern: ".turbo/**", reason: "build/cache output", role: "cache", classification: "cache" },
  { pattern: "**/.turbo/**", reason: "nested build/cache output", role: "cache", classification: "cache" },
  { pattern: ".next/**", reason: "build output", role: "cache", classification: "cache" },
  { pattern: "**/.next/**", reason: "nested build output", role: "cache", classification: "cache" },
  { pattern: "dist/**", reason: "build output", role: "generated", classification: "generated" },
  { pattern: "**/dist/**", reason: "nested build output", role: "generated", classification: "generated" },
  { pattern: "build/**", reason: "build output", role: "generated", classification: "generated" },
  { pattern: "**/build/**", reason: "nested build output", role: "generated", classification: "generated" },
  { pattern: "out/**", reason: "build output", role: "generated", classification: "generated" },
  { pattern: "**/out/**", reason: "nested build output", role: "generated", classification: "generated" },
  { pattern: "coverage/**", reason: "coverage output", role: "generated", classification: "generated" },
  { pattern: "**/coverage/**", reason: "nested coverage output", role: "generated", classification: "generated" },
  { pattern: ".git/**", reason: "vcs metadata", role: "vcs_metadata", classification: "vcs_metadata" },
  { pattern: "**/.git/**", reason: "nested vcs metadata", role: "vcs_metadata", classification: "vcs_metadata" },
  { pattern: ".gitmodules", reason: "vcs/submodule control file", role: "vcs_metadata", classification: "vcs_metadata" },
  { pattern: ".codex", reason: "local agent-control state", role: "runtime_artifact", classification: "runtime_artifact" },
  { pattern: ".codex/**", reason: "local agent-control state", role: "runtime_artifact", classification: "runtime_artifact" },
  { pattern: "**/.codex", reason: "nested local agent-control state", role: "runtime_artifact", classification: "runtime_artifact" },
  { pattern: "**/.codex/**", reason: "nested local agent-control state", role: "runtime_artifact", classification: "runtime_artifact" },
  { pattern: ".claude", reason: "local agent-control state", role: "runtime_artifact", classification: "runtime_artifact" },
  { pattern: ".claude/**", reason: "local agent-control state", role: "runtime_artifact", classification: "runtime_artifact" },
  { pattern: "**/.claude", reason: "nested local agent-control state", role: "runtime_artifact", classification: "runtime_artifact" },
  { pattern: "**/.claude/**", reason: "nested local agent-control state", role: "runtime_artifact", classification: "runtime_artifact" },
  { pattern: ".env*", reason: "secret-like local file", role: "secret_like", classification: "secret_like" },
  { pattern: "**/.env*", reason: "nested secret-like local file", role: "secret_like", classification: "secret_like" }
]);

function globToRegExp(pattern) {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
      continue;
    }
    if (char === "*") {
      source += "[^/]*";
      continue;
    }
    if ("\\^$+?.()|{}[]".includes(char)) {
      source += `\\${char}`;
      continue;
    }
    source += char;
  }
  return new RegExp(`${source}$`);
}

const COMPILED_EXCLUSION_RULES = REPO_LOC_INVENTORY_EXCLUSION_RULES.map((rule) => ({
  ...rule,
  matcher: globToRegExp(rule.pattern)
}));

function normalizeRepoRelativePath(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/u.test(normalized)) {
    return null;
  }
  if (normalized.includes("\0") || normalized.includes("//")) {
    return null;
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return null;
  }
  return normalized;
}

function resolveRepoRoot() {
  try {
    const topLevel = String(execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" })).trim();
    if (topLevel) {
      return topLevel;
    }
  } catch {

  }

  let current = dirname(fileURLToPath(import.meta.url));
  while (current && current !== dirname(current)) {
    if (existsSync(join(current, ".git"))) {
      return current;
    }
    current = dirname(current);
  }
  throw new Error("Unable to resolve repository root for repo LOC inventory");
}

function parseTrackedEntry(rawEntry) {
  const text = String(rawEntry ?? "");
  if (!text) {
    return null;
  }
  const tabIndex = text.indexOf("\t");
  if (tabIndex === -1) {
    return null;
  }
  const head = text.slice(0, tabIndex);
  const path = normalizeRepoRelativePath(text.slice(tabIndex + 1));
  if (!path) {
    return null;
  }
  const [mode, objectId, stage] = head.split(" ");
  if (!mode || !objectId || stage === undefined) {
    return null;
  }
  return { mode, objectId, stage, path };
}

function loadTrackedEntries(repoRoot) {
  const output = execFileSync("git", ["ls-files", "-s", "-z"], { cwd: repoRoot, encoding: "buffer" });
  return output.toString("utf8")
    .split("\0")
    .map(parseTrackedEntry)
    .filter(Boolean);
}

function getExclusionRule(path) {
  return COMPILED_EXCLUSION_RULES.find((rule) => rule.matcher.test(path)) ?? null;
}

function classifyIncludedPath(path) {
  if (path.startsWith("docs/")) {
    return { role: "docs", classification: "canonical_docs" };
  }
  if (path.startsWith("wiki/")) {
    return { role: "wiki", classification: "canonical_wiki" };
  }
  if (path.startsWith("tests/") || path.includes(".test.") || path.includes(".spec.")) {
    return { role: "test", classification: "test" };
  }
  if (path.startsWith("packages/")) {
    return { role: "source", classification: "runtime_source" };
  }
  if (path.endsWith(".json") || path.endsWith(".yaml") || path.endsWith(".yml")) {
    return { role: "config", classification: "config" };
  }
  if (path.endsWith(".md") || path.endsWith(".txt")) {
    return { role: "documentation", classification: "text" };
  }
  return { role: "other", classification: "other" };
}

function classifyExcludedPath(rule, mode) {
  if (mode === "160000") {
    return { role: "submodule", classification: "gitlink", reason: "tracked gitlink" };
  }
  if (mode === "120000") {
    return { role: "symlink", classification: "symlink", reason: "tracked symlink" };
  }
  if (rule) {
    return { role: rule.role, classification: rule.classification, reason: rule.reason };
  }
  return { role: "excluded", classification: "excluded", reason: "non-canonical tracked path" };
}

function readPhysicalLineCount(repoRoot, path) {
  const absolutePath = resolve(repoRoot, path);
  return countUtf8Lines(readFileSync(absolutePath, "utf8"));
}

export function computeRepoLocInventory({ threshold = REPO_LOC_INVENTORY_DEFAULT_THRESHOLD } = {}) {
  if (!Number.isInteger(threshold) || threshold < 0) {
    throw new TypeError("computeRepoLocInventory expects threshold to be a non-negative integer");
  }

  const repoRoot = resolveRepoRoot();
  const trackedEntries = loadTrackedEntries(repoRoot);
  const files = [];
  const excludedFiles = [];
  const matchingFiles = [];
  let includedCount = 0;
  let excludedCount = 0;
  let totalLineCount = 0;
  let maxLineCount = 0;

  for (const entry of trackedEntries) {
    const rule = getExclusionRule(entry.path);
    const excluded = Boolean(rule) || entry.mode === "160000" || entry.mode === "120000";
    const line_count = entry.mode.startsWith("100") ? readPhysicalLineCount(repoRoot, entry.path) : null;
    const inclusion = excluded ? "excluded" : "included";
    const classification = excluded ? classifyExcludedPath(rule, entry.mode) : classifyIncludedPath(entry.path);
    const fileEntry = {
      path: entry.path,
      line_count,
      role: classification.role,
      classification: classification.classification,
      inclusion,
      reason: excluded ? classification.reason : "counted canonical tracked file",
      mode: entry.mode
    };
    files.push(fileEntry);
    if (excluded) {
      excludedCount += 1;
      excludedFiles.push(fileEntry);
      continue;
    }
    includedCount += 1;
    totalLineCount += line_count;
    if (line_count > maxLineCount) {
      maxLineCount = line_count;
    }
    if (line_count > threshold) {
      matchingFiles.push(fileEntry);
    }
  }

  return {
    schema_version: REPO_LOC_INVENTORY_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    repo_root: repoRoot,
    counted_universe: {
      tracked_path_count: trackedEntries.length,
      included_path_count: includedCount,
      excluded_path_count: excludedCount,
      matching_path_count: matchingFiles.length,
      total_line_count: totalLineCount,
      max_line_count: maxLineCount
    },
    threshold: {
      field: "line_count",
      operator: ">",
      value: threshold,
      strict: true
    },
    exclusion_rules: REPO_LOC_INVENTORY_EXCLUSION_RULES,
    files,
    excluded_files: excludedFiles,
    matching_files: matchingFiles
  };
}
