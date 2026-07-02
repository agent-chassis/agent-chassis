

import path from "node:path";
import { statSync, realpathSync } from "node:fs";

import { loadWorkRecordById } from "@agent-chassis/wiki-core";
import { parseWorkRecordUnitAddress } from "@agent-chassis/agent-launch-core";

export async function resolveCanonicalWriteScope({
  subject,
  workspaceDir,
  loadWorkRecord = loadWorkRecordById
} = {}) {
  if (typeof subject !== "string" || subject.length === 0) return [];
  if (typeof workspaceDir !== "string" || workspaceDir.length === 0) return [];
  const parsed = parseWorkRecordUnitAddress(subject);
  if (!parsed || parsed.ok !== true || !parsed.value) return [];
  const recordId = parsed.value.record_id;
  const sliceId = parsed.value.slice_id ?? null;
  if (typeof recordId !== "string" || recordId.length === 0) return [];
  let loaded;
  try {
    loaded = await loadWorkRecord({ dir: workspaceDir, id: recordId });
  } catch {
    return [];
  }
  const record = loaded && typeof loaded === "object" ? loaded.record : null;
  if (!record || typeof record !== "object") return [];
  if (sliceId) {

    const slice = Array.isArray(record.slices)
      ? record.slices.find((entry) => entry && entry.id === sliceId) || null
      : null;
    if (!slice) return [];
    return Array.isArray(slice.write_scope) ? slice.write_scope : [];
  }
  return Array.isArray(record.write_scope) ? record.write_scope : [];
}

export function deriveWritableMountsFromWriteScope({ workspaceDir, writeScope } = {}) {
  const writableRoots = [];
  const writableFiles = [];
  if (typeof workspaceDir !== "string" || workspaceDir.length === 0) {
    return { writableRoots, writableFiles };
  }
  const repoRoot = path.resolve(workspaceDir);
  for (const raw of Array.isArray(writeScope) ? writeScope : []) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    const dirHint = trimmed.endsWith("/");
    const entry = dirHint ? trimmed.replace(/\/+$/, "") : trimmed;
    if (entry.length === 0) continue;
    const abs = path.isAbsolute(entry)
      ? path.normalize(entry)
      : path.resolve(repoRoot, entry);

    const rel = path.relative(repoRoot, abs);
    if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) continue;
    let isDir = dirHint;
    if (!isDir) {
      try {
        isDir = statSync(abs).isDirectory();
      } catch {
        isDir = false;
      }
    }
    if (isDir) {
      if (!writableRoots.includes(abs)) writableRoots.push(abs);
    } else if (!writableFiles.includes(abs)) {
      writableFiles.push(abs);
    }
  }
  return { writableRoots, writableFiles };
}

export function deriveDirectoryScopedWritableMountsFromWriteScope({
  workspaceDir,
  writeScope
} = {}) {
  const writableRoots = [];
  const writableFiles = [];
  if (typeof workspaceDir !== "string" || workspaceDir.length === 0) {
    return { writableRoots, writableFiles };
  }
  const repoRoot = path.resolve(workspaceDir);
  for (const raw of Array.isArray(writeScope) ? writeScope : []) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    const dirHint = trimmed.endsWith("/");
    const entry = dirHint ? trimmed.replace(/\/+$/, "") : trimmed;
    if (entry.length === 0) continue;
    const abs = path.isAbsolute(entry)
      ? path.normalize(entry)
      : path.resolve(repoRoot, entry);

    const rel = path.relative(repoRoot, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) continue;
    let isDir = dirHint;
    if (!isDir) {
      try {
        isDir = statSync(abs).isDirectory();
      } catch {
        isDir = false;
      }
    }

    const dir = isDir ? abs : path.dirname(abs);
    if (!writableRoots.includes(dir)) writableRoots.push(dir);
  }
  return { writableRoots, writableFiles };
}

export function assertDirectoryScopeWritableRootsSafe({
  workspaceDir,
  writableRoots,
  realpath = realpathSync
} = {}) {
  const refusal = (kind, detail) => ({
    ok: false,
    reason: "claude_directory_scope_mount_unsafe",
    detail: { kind, ...(detail ?? {}) }
  });
  if (typeof workspaceDir !== "string" || workspaceDir.length === 0) {
    return refusal("workspace_dir_invalid", { workspaceDir: workspaceDir ?? null });
  }
  let repoReal;
  try {
    repoReal = realpath(path.resolve(workspaceDir));
  } catch (err) {
    return refusal("workspace_dir_unresolvable", {
      workspaceDir,
      message: err?.message ?? String(err)
    });
  }

  let gitReal = null;
  try {
    gitReal = realpath(path.join(repoReal, ".git"));
  } catch {
    gitReal = null;
  }
  const resolved = [];
  for (const root of Array.isArray(writableRoots) ? writableRoots : []) {
    if (typeof root !== "string" || root.length === 0) {
      return refusal("writable_root_invalid", { root: root ?? null });
    }
    let real;
    try {
      real = realpath(root);
    } catch (err) {

      return refusal("parent_unresolvable", { root, message: err?.message ?? String(err) });
    }
    if (real === repoReal) {
      return refusal("repo_root", { root, real, repoReal });
    }
    if (!isWithinRepoPath(real, repoReal)) {
      return refusal("repo_escape", { root, real, repoReal });
    }
    if (gitReal !== null) {
      if (
        real === gitReal ||
        isWithinRepoPath(real, gitReal) ||
        isWithinRepoPath(gitReal, real)
      ) {
        return refusal("git_dir", { root, real, gitReal });
      }
    }
    resolved.push(real);
  }

  for (let i = 0; i < resolved.length; i += 1) {
    for (let j = 0; j < resolved.length; j += 1) {
      if (i === j) continue;
      if (isWithinRepoPath(resolved[j], resolved[i])) {
        return refusal("ancestor_subsumption", {
          ancestor: resolved[i],
          descendant: resolved[j]
        });
      }
    }
  }
  return { ok: true, writableRoots: resolved };
}

function isWithinRepoPath(inner, outer) {
  if (inner === outer) return true;
  const prefix = outer.endsWith(path.sep) ? outer : outer + path.sep;
  return inner.startsWith(prefix);
}
