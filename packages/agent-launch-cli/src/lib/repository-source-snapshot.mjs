

import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import path from "node:path";

export const ORDINARY_SOURCE_SNAPSHOT_SCHEMA_VERSION = "repository-execution-source-snapshot.v2";

export const REPOSITORY_SOURCE_SNAPSHOT_REFUSALS = Object.freeze({
  symlink: Object.freeze({ code: "test_proof_source_snapshot_symlink_unsupported",
    message: "source snapshot refuses symlinks because link-target bytes are not authenticated" }),
  special: Object.freeze({ code: "test_proof_source_snapshot_unsupported_entry",
    message: "source snapshot encountered a non-file repository entry" })
});

function defaultRefuse(kind, detail) {
  const { code, message } = REPOSITORY_SOURCE_SNAPSHOT_REFUSALS[kind];
  throw Object.assign(new Error(message), { code, detail });
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
  return value;
}

export function collectRepositorySourceEntries(root, { excludedTopLevelNames = [], exclusions = [],
  symlinks = "refuse", refuse = defaultRefuse } = {}) {
  if (symlinks !== "refuse" && symlinks !== "record") {
    throw new TypeError("repository source entries record or refuse symlinks");
  }
  const topLevel = new Set(excludedTopLevelNames);
  const excluded = new Map(exclusions.map(({ path: relative, keepNames = [] }) => [relative, new Set(keepNames)]));
  const entries = [];
  const record = (absolute, relative, stat, walk) => {
    if (stat.isDirectory()) {
      entries.push({ path: relative, kind: "directory", mode: stat.mode & 0o777 });
      walk(absolute);
    } else if (stat.isFile()) {
      entries.push({ path: relative, kind: "file", mode: stat.mode & 0o777,
        digest: `sha256:${createHash("sha256").update(readFileSync(absolute)).digest("hex")}` });
    } else if (stat.isSymbolicLink()) {
      if (symlinks === "refuse") refuse("symlink", { path: relative });
      entries.push({ path: relative, kind: "symlink", target: readlinkSync(absolute) });
    } else {
      if (symlinks === "refuse") refuse("special", { path: relative });
      entries.push({ path: relative, kind: "special", mode: stat.mode });
    }
  };
  const relativeOf = (absolute) => path.relative(root, absolute).split(path.sep).join("/");

  const walkCovered = (directory, keep) => {
    for (const name of readdirSync(directory).sort()) {
      const absolute = path.join(directory, name);
      const stat = lstatSync(absolute);
      if (keep.has(name)) record(absolute, relativeOf(absolute), stat, walk);
      else if (stat.isDirectory()) walkCovered(absolute, keep);
    }
  };
  const walk = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const absolute = path.join(directory, name);
      const relative = relativeOf(absolute);
      if (directory === root && topLevel.has(name)) continue;
      const stat = lstatSync(absolute);
      const keep = excluded.get(relative);
      if (keep !== undefined) {
        if (keep.size > 0 && stat.isDirectory()) walkCovered(absolute, keep);
        continue;
      }
      record(absolute, relative, stat, walk);
    }
  };
  walk(root);
  return entries;
}

export function repositorySnapshotDigest(value) {
  return `sha256:${createHash("sha256").update(`${JSON.stringify(canonicalJson(value))}\n`, "utf8")
    .digest("hex")}`;
}

function maskedOrSelfAuthenticated(root) {
  let gitIsDirectory = false;
  try {
    gitIsDirectory = lstatSync(path.join(root, ".git")).isDirectory();
  } catch {
    gitIsDirectory = false;
  }
  return [{ path: ".agent-launch", keepNames: [] }, { path: ".env", keepNames: [] },
    ...(gitIsDirectory ? [{ path: ".git/objects", keepNames: [] }] : [])];
}

export function captureRepositorySourceSnapshot(root, { exclusions = [] } = {}) {
  const omitted = [...maskedOrSelfAuthenticated(root), ...exclusions]
    .map(({ path: relative, keepNames = [] }) => ({ path: relative, keepNames: [...keepNames].sort() }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const entries = collectRepositorySourceEntries(root, { exclusions: omitted, symlinks: "record" });
  const body = { schema_version: ORDINARY_SOURCE_SNAPSHOT_SCHEMA_VERSION, exclusions: omitted, entries };
  return Object.freeze({ schema_version: ORDINARY_SOURCE_SNAPSHOT_SCHEMA_VERSION, entry_count: entries.length,
    source_snapshot_digest: repositorySnapshotDigest(body) });
}
