

import { spawnSync } from "node:child_process";

export const WRITE_SCOPE_VERIFICATION_SCHEMA_VERSION =
  "claude-write-scope-verification.v1";

export const WRITE_SCOPE_ENFORCEMENT_DIRECTORY_SCOPE = Object.freeze({
  mode: "directory_scope_post_hoc_review",
  kernel_exact_file: false,
  enforced: false
});

export const WRITE_SCOPE_VERIFICATION_REASONS = Object.freeze({
  GIT_UNAVAILABLE: "write_scope_verification_git_unavailable",
  CHECK_THREW: "write_scope_verification_threw"
});

function defaultRunGit({ workspaceDir, args }) {
  let res;
  try {
    res = spawnSync(
      "git",
      ["-C", workspaceDir, "-c", "core.quotePath=false", ...args],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
    );
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
  if (res.error) {
    return { ok: false, error: res.error.message ?? String(res.error) };
  }
  if (typeof res.status !== "number" || res.status !== 0) {
    return {
      ok: false,
      status: res.status ?? null,
      signal: res.signal ?? null,
      stderr: typeof res.stderr === "string" ? res.stderr.slice(0, 512) : null
    };
  }
  return { ok: true, stdout: typeof res.stdout === "string" ? res.stdout : "" };
}

function parseNullableLines(stdout) {
  if (typeof stdout !== "string" || stdout.length === 0) return [];
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function collectGitChangedPaths({ workspaceDir, runGit = defaultRunGit } = {}) {
  if (typeof workspaceDir !== "string" || workspaceDir.length === 0) {
    throw new Error("collectGitChangedPaths requires a non-empty workspaceDir");
  }
  const tracked = runGit({
    workspaceDir,
    args: ["diff", "--name-only", "--no-renames", "HEAD"]
  });
  if (!tracked || tracked.ok !== true) {
    throw new Error(
      `git diff probe failed: ${tracked?.error ?? tracked?.stderr ?? "status " + (tracked?.status ?? "?")}`
    );
  }
  const untracked = runGit({
    workspaceDir,
    args: ["ls-files", "--others", "--exclude-standard"]
  });
  if (!untracked || untracked.ok !== true) {
    throw new Error(
      `git ls-files probe failed: ${untracked?.error ?? untracked?.stderr ?? "status " + (untracked?.status ?? "?")}`
    );
  }
  const set = new Set();
  for (const p of parseNullableLines(tracked.stdout)) set.add(p);
  for (const p of parseNullableLines(untracked.stdout)) set.add(p);
  return set;
}

function normalizeWriteScope(writeScope) {
  const files = new Set();
  const dirs = [];
  for (const raw of Array.isArray(writeScope) ? writeScope : []) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.endsWith("/")) {
      const dir = trimmed.replace(/\/+$/, "");
      if (dir.length > 0) dirs.push(dir);
    } else {
      files.add(trimmed);
    }
  }
  return { files, dirs };
}

function isWithinWriteScope(relPath, { files, dirs }) {
  if (files.has(relPath)) return true;
  for (const dir of dirs) {
    if (relPath === dir || relPath.startsWith(`${dir}/`)) return true;
  }
  return false;
}

export function verifyChangedFilesWithinWriteScope({
  workspaceDir,
  writeScope = [],
  baseline = null,
  runGit = defaultRunGit,
  collect = collectGitChangedPaths
} = {}) {
  let changedNow;
  try {
    changedNow = collect({ workspaceDir, runGit });
  } catch (err) {
    return Object.freeze({
      schema_version: WRITE_SCOPE_VERIFICATION_SCHEMA_VERSION,
      ran: false,
      ok: false,
      reason: WRITE_SCOPE_VERIFICATION_REASONS.GIT_UNAVAILABLE,
      enforcement: WRITE_SCOPE_ENFORCEMENT_DIRECTORY_SCOPE,
      detail: { message: err?.message ?? String(err) },
      changed: Object.freeze([]),
      out_of_scope: Object.freeze([])
    });
  }
  const baselineSet = baseline instanceof Set
    ? baseline
    : new Set(Array.isArray(baseline) ? baseline : []);
  const effective = [...changedNow].filter((p) => !baselineSet.has(p)).sort();
  const normalized = normalizeWriteScope(writeScope);
  const outOfScope = effective.filter((p) => !isWithinWriteScope(p, normalized));
  return Object.freeze({
    schema_version: WRITE_SCOPE_VERIFICATION_SCHEMA_VERSION,
    ran: true,
    ok: outOfScope.length === 0,
    enforcement: WRITE_SCOPE_ENFORCEMENT_DIRECTORY_SCOPE,
    changed: Object.freeze(effective),
    out_of_scope: Object.freeze(outOfScope.slice())
  });
}
