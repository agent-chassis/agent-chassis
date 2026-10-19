

import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseRepositoryScopeFileSelector } from "@agent-chassis/wiki-core/src/lib/work-record-repository-path.mjs";
import { createWorkerScopeTreeReader } from "./backend-worker-scope-tree.mjs";
import { defaultRunGit } from "./worktree-substrate.mjs";

function fileDigest(bytes, objectFormat = null) {
  const hash = createHash(objectFormat ?? "sha256");
  if (objectFormat !== null) hash.update(`blob ${bytes.length}\0`);
  return `${objectFormat === null ? "sha256" : `git-${objectFormat}`}:${hash.update(bytes).digest("hex")}`;
}

export const ORDINARY_SOURCE_SNAPSHOT_SCHEMA_VERSION = "repository-execution-source-snapshot.v3";

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
  symlinks = "refuse", refuse = defaultRefuse, mappedDependencies = null,
  selectedPaths = null, objectFormat = null } = {}) {
  if (symlinks !== "refuse" && symlinks !== "omit") {
    throw new TypeError("repository source entries omit or refuse symlinks");
  }
  const topLevel = new Set(excludedTopLevelNames);
  const excluded = new Map(exclusions.map(({ path: relative, keepNames = [] }) => [relative, new Set(keepNames)]));
  const entries = [];
  const record = (absolute, relative, stat, walk) => {
    if (stat.isDirectory()) {
      if (selectedPaths === null) entries.push({ path: relative, kind: "directory", mode: stat.mode & 0o777 });
      walk(absolute);
    } else if (stat.isFile()) {
      entries.push({ path: relative, kind: "file", mode: objectFormat === null ? stat.mode & 0o777
        : (stat.mode & 0o111) === 0 ? 0o644 : 0o755,
        digest: fileDigest(readFileSync(absolute), objectFormat) });
    } else if (stat.isSymbolicLink()) {
      if (symlinks === "refuse") refuse("symlink", { path: relative });
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
    const mapped = mappedDependencies === null ? [] : mappedDependencies(directory);
    for (const name of readdirSync(directory).sort()) {
      const absolute = path.join(directory, name);
      const relative = relativeOf(absolute);
      if (selectedPaths !== null && !selectedPaths.some(selected => selected === relative ||
          selected.startsWith(`${relative}/`))) continue;
      if (directory === root && topLevel.has(name)) continue;
      const keep = excluded.get(relative);
      if (keep !== undefined) {
        if (keep.size > 0 && lstatSync(absolute).isDirectory()) walkCovered(absolute, keep);
        continue;
      }
      if (mapped.includes(absolute)) continue;
      record(absolute, relative, lstatSync(absolute), walk);
    }
  };
  walk(root);
  return entries;
}

export function captureRepositoryDefinitionSnapshot({ root, paths, commit = null, runGit = defaultRunGit }) {
  const fail = (code, message, detail) => { throw Object.assign(new Error(message), { code, detail }); };
  if (!Array.isArray(paths) || paths.length === 0 || new Set(paths).size !== paths.length ||
      !paths.every(value => parseRepositoryScopeFileSelector(value).ok)) {
    fail("repository_test_definition_paths_invalid", "definition paths must be exact canonical repository files", { paths });
  }
  const probe = args => {
    const result = runGit({ repo: root, args: ["--no-replace-objects", ...args] });
    if (result?.ok !== true) fail("repository_test_definition_git_unavailable", "cannot read definition Git identity",
      { commit, args, result });
    return result.stdout.trim();
  };
  const objectFormat = probe(["rev-parse", "--show-object-format"]);
  if (!["sha1", "sha256"].includes(objectFormat)) fail("repository_test_definition_object_format_invalid",
    "definition repository has an unsupported object format", { objectFormat });
  let entries;
  if (commit === null) entries = collectRepositorySourceEntries(root, { selectedPaths: paths, objectFormat });
  else {
    const reader = createWorkerScopeTreeReader({ runGit, mainRepo: root, baseSha: commit });
    entries = paths.map(relative => {
      const resolved = reader.resolve(relative.split("/"));
      if (resolved.kind !== "file" || resolved.index !== relative.split("/").length - 1) {
        if (resolved.kind === "symlink") defaultRefuse("symlink", { path: relative, commit });
        fail("repository_test_definition_unavailable", "listed definition is not a regular file at the launch commit",
          { path: relative, commit, kind: resolved.kind });
      }
      return { path: relative, kind: "file", mode: Number.parseInt(resolved.mode, 8) & 0o777,
        digest: `git-${objectFormat}:${probe(["rev-parse", "--verify", `${commit}:${relative}`])}` };
    });
  }
  entries.sort((left, right) => left.path.localeCompare(right.path));
  if (entries.length !== paths.length || entries.some(entry => entry.kind !== "file") ||
      paths.some(relative => !entries.some(entry => entry.path === relative))) {
    fail("repository_test_definition_unavailable", "a listed definition is missing or is not a regular file", { paths });
  }
  return Object.freeze({ schema_version: "repository-test-definition-snapshot.v1", entries: Object.freeze(entries),
    digest: repositorySnapshotDigest(entries) });
}

export function repositorySnapshotDigest(value) {
  return `sha256:${createHash("sha256").update(`${JSON.stringify(canonicalJson(value))}\n`, "utf8")
    .digest("hex")}`;
}

function launcherOwnedOrSelfAuthenticated(root) {
  let gitIsDirectory = false;
  try {
    gitIsDirectory = lstatSync(path.join(root, ".git")).isDirectory();
  } catch {
    gitIsDirectory = false;
  }
  return [{ path: ".agent-launch", keepNames: [] },
    ...(gitIsDirectory ? [{ path: ".git/objects", keepNames: [] }] : [])];
}

export function captureRepositorySourceSnapshot(root, { exclusions = [], mappedDependencies = null } = {}) {
  const omitted = [...launcherOwnedOrSelfAuthenticated(root), ...exclusions]
    .map(({ path: relative, keepNames = [] }) => ({ path: relative, keepNames: [...keepNames].sort() }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const entries = collectRepositorySourceEntries(root, { exclusions: omitted, symlinks: "omit",
    mappedDependencies });
  const body = { schema_version: ORDINARY_SOURCE_SNAPSHOT_SCHEMA_VERSION, exclusions: omitted, entries };
  return Object.freeze({ schema_version: ORDINARY_SOURCE_SNAPSHOT_SCHEMA_VERSION, entry_count: entries.length,
    source_snapshot_digest: repositorySnapshotDigest(body) });
}
