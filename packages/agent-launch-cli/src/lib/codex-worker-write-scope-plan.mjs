

import path from "node:path";
import { lstat, mkdir, realpath, stat } from "node:fs/promises";

import {
  hasGlobSyntax,
  looksLikeFileScopeEntry,
  normalizeProjectScopeEntry,
  parentDirectoryForScopeEntry
} from "./codex-role-write-scope.mjs";

async function isDirectory(entryPath) {
  try {
    return (await stat(entryPath)).isDirectory();
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return false;
    }
    throw error;
  }
}

export async function writeScopeEntryResolvesToFile(repo, normalizedEntry) {
  try {
    const stats = await stat(path.join(repo, normalizedEntry));
    return stats.isFile();
  } catch (error) {
    if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") {
      throw error;
    }
    return looksLikeFileScopeEntry(normalizedEntry);
  }
}

export async function collectSliceDeclaredWritableFiles({ repo, record, selectedSlice, writeScope }) {
  const collected = [];
  const seen = new Set();
  const push = (entry) => {
    if (typeof entry !== "string") return;
    const normalized = normalizeProjectScopeEntry(entry);
    if (!normalized || normalized === "." || hasGlobSyntax(normalized)) return;
    const withoutTrailingSlash = normalized.replace(/\/+$/, "") || ".";
    if (withoutTrailingSlash.split("/").some((segment) => segment === "..")) return;
    if (seen.has(withoutTrailingSlash)) return;
    seen.add(withoutTrailingSlash);
    collected.push(withoutTrailingSlash);
  };

  const explicitSource = selectedSlice && Array.isArray(selectedSlice.writable_files)
    ? selectedSlice.writable_files
    : (!selectedSlice && record && Array.isArray(record.writable_files))
      ? record.writable_files
      : [];
  for (const entry of explicitSource) {
    push(entry);
  }
  for (const entry of Array.isArray(writeScope) ? writeScope : []) {
    const normalized = normalizeProjectScopeEntry(entry);
    if (!normalized || hasGlobSyntax(normalized) || normalized === ".") continue;
    const withoutTrailingSlash = normalized.replace(/\/+$/, "") || ".";
    if (withoutTrailingSlash.split("/").some((segment) => segment === "..")) continue;
    if (await writeScopeEntryResolvesToFile(repo, withoutTrailingSlash)) {
      push(withoutTrailingSlash);
    }
  }
  return collected;
}

export async function isolationWritableDirectoriesForLaunch(repo, writeScope) {
  const roots = [];
  const seen = new Set();
  for (const entry of Array.isArray(writeScope) ? writeScope : []) {
    const normalized = normalizeProjectScopeEntry(entry);
    if (!normalized || hasGlobSyntax(normalized) || normalized === ".") continue;
    const withoutTrailingSlash = normalized.replace(/\/+$/, "") || ".";
    if (withoutTrailingSlash.split("/").some((segment) => segment === "..")) continue;
    if (await writeScopeEntryResolvesToFile(repo, withoutTrailingSlash)) continue;
    if (seen.has(withoutTrailingSlash)) continue;
    seen.add(withoutTrailingSlash);
    roots.push(withoutTrailingSlash);
  }
  return roots;
}

async function projectPermissionRootsForScopeEntry(repo, entry) {
  const normalized = normalizeProjectScopeEntry(entry);
  if (!normalized || hasGlobSyntax(normalized)) {
    return normalized ? [normalized] : [];
  }
  const withoutTrailingSlash = normalized.replace(/\/+$/, "") || ".";
  try {
    const stats = await stat(path.join(repo, withoutTrailingSlash));
    if (stats.isFile()) {

      return [parentDirectoryForScopeEntry(withoutTrailingSlash)];
    }
  } catch (error) {
    if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") {
      throw error;
    }
    if (looksLikeFileScopeEntry(withoutTrailingSlash)) {
      return [parentDirectoryForScopeEntry(withoutTrailingSlash)];
    }
    return [withoutTrailingSlash];
  }
  return [withoutTrailingSlash];
}

export async function projectPermissionWritesForWorkerLaunch(repo, writeScope) {
  const roots = [];
  const seen = new Set();
  for (const entry of Array.isArray(writeScope) ? writeScope : []) {
    const scopeRoots = await projectPermissionRootsForScopeEntry(repo, entry);
    for (const root of scopeRoots) {
      if (!root || seen.has(root)) {
        continue;
      }
      seen.add(root);
      roots.push(root);
    }
  }
  return roots;
}

export async function writeScopeTargetDirectory(repo, entry) {
  try {
    const stats = await stat(path.join(repo, entry));
    if (stats.isFile()) {
      return parentDirectoryForScopeEntry(entry);
    }
    return entry;
  } catch (error) {
    if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") {
      throw error;
    }
    if (looksLikeFileScopeEntry(entry)) {
      return parentDirectoryForScopeEntry(entry);
    }
    return entry;
  }
}

export async function planWorkerWriteScopeNewDirectories(repo, writeScope) {
  const planned = [];
  const seen = new Set();
  for (const rawEntry of Array.isArray(writeScope) ? writeScope : []) {
    const normalized = normalizeProjectScopeEntry(rawEntry);
    if (!normalized || hasGlobSyntax(normalized) || normalized === ".") {
      continue;
    }
    const withoutTrailingSlash = normalized.replace(/\/+$/, "") || ".";
    if (withoutTrailingSlash.split("/").some((segment) => segment === "..")) {
      continue;
    }
    const directory = await writeScopeTargetDirectory(repo, withoutTrailingSlash);
    if (!directory || directory === "." || seen.has(directory)) {
      continue;
    }
    seen.add(directory);
    if (await isDirectory(path.join(repo, directory))) {
      continue;
    }
    planned.push({ scope_entry: rawEntry, directory });
  }
  return planned;
}

async function assertMissingWriteRootParentContained(repoReal, target, displayDirectory, role) {
  let current = target;
  while (true) {
    try {
      await lstat(current);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        const reason = error?.code ? ` (${error.code})` : "";
        throw new Error(`codex-${role}: failed to inspect write_scope directory ${displayDirectory}${reason}`);
      }
      const parent = path.dirname(current);
      if (parent === current) {
        throw new Error(`codex-${role}: write_scope directory escapes repo root: ${displayDirectory}`);
      }
      current = parent;
      continue;
    }

    const existingReal = await realpath(current);
    if (!isRealPathWithin(repoReal, existingReal)) {
      throw new Error(`codex-${role}: write_scope directory escapes repo root: ${displayDirectory}`);
    }
    return;
  }
}

function isRealPathWithin(rootReal, candidateReal) {
  const relative = path.relative(rootReal, candidateReal);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function ensureNewWorkerWriteRoots(repo, plannedRoots, role) {
  const created = [];
  if (!Array.isArray(plannedRoots) || plannedRoots.length === 0) {
    return created;
  }
  const repoReal = await realpath(repo);
  for (const item of plannedRoots) {
    const target = path.resolve(repoReal, item.directory);
    const relative = path.relative(repoReal, target);
    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`codex-${role}: write_scope directory escapes repo root: ${item.directory}`);
    }
    await assertMissingWriteRootParentContained(repoReal, target, item.directory, role);
    try {
      await mkdir(target, { recursive: true });
    } catch (error) {
      const reason = error?.code ? ` (${error.code})` : "";
      throw new Error(`codex-${role}: failed to prepare write_scope directory ${item.directory}${reason}`);
    }
    created.push(item.directory);
  }
  return created;
}
