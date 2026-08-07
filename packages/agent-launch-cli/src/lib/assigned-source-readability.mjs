

import { realpathSync, statSync } from "node:fs";
import path from "node:path";

import { parseWorkRecordUnitAddress } from "@agent-chassis/agent-launch-core";
import { loadWorkRecordById } from "@agent-chassis/wiki-core";
import { isWithinRepo } from "./launch-isolation.mjs";
import { LANDING_AUTHORITY_WORK_RECORD_RE } from "./backend-worker-scope-authority.mjs";
import { SCOPE_TREE_PATH_KINDS, createWorkerScopeTreeReader } from "./backend-worker-scope-tree.mjs";

import { defaultRunGit } from "./worktree-substrate-primitives.mjs";
import {
  LAUNCHER_SOURCE_READ_MODE_NATIVE_FILESYSTEM
} from "./workspace-agent-launch-adapter-contract.mjs";

const PRESENT_DIRECTORY = "directory";
const PRESENT_FILE = "file";
const NOT_PRESENT = "absent";
const OUTSIDE_PROVEN_SCOPE = "outside_proven_scope";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function uniqueSortedStringList(...lists) {
  const values = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) if (isNonEmptyString(entry)) values.push(entry.trim());
  }
  return [...new Set(values)].sort();
}

function selectedUnit(record, sliceId) {
  if (!sliceId || !Array.isArray(record?.slices)) return record;
  return record.slices.find((slice) => slice?.id === sliceId) ?? null;
}

function isGlobLikeSourceEntry(value) {
  return /[*?[\]{}]/.test(value);
}

function pathClassForAssignedEntry(value, writeSet, repoSet) {
  if (writeSet.has(value)) return "write_scope";
  if (repoSet.has(value)) return "repo_paths";
  return "read_scope";
}

function classifyOnLanding(value, { workspaceDir, repoReal, statFn, realpathFn }) {
  const absolute = path.resolve(workspaceDir, value);
  const relative = path.relative(workspaceDir, absolute);
  const lexicalEscape = relative === "" || relative.startsWith("..") || path.isAbsolute(relative);
  let stats = null;
  try { stats = statFn(absolute); } catch {   }
  if (stats?.isDirectory()) return PRESENT_DIRECTORY;
  if (stats?.isFile()) {
    let real = absolute;
    try { real = realpathFn(absolute); } catch {   }
    return (lexicalEscape || !isWithinRepo(real, repoReal)) ? OUTSIDE_PROVEN_SCOPE : PRESENT_FILE;
  }
  return NOT_PRESENT;
}

function classifyAtBase(reader, value) {
  const parts = value.split("/");

  const resolved = reader.resolve(parts);
  const at = JSON.stringify(parts.slice(0, resolved.index + 1).join("/"));
  if (resolved.kind === SCOPE_TREE_PATH_KINDS.SYMLINK) {
    throw new Error(`assigned source crosses a symlink at ${at}`);
  }
  if (resolved.kind === SCOPE_TREE_PATH_KINDS.GITLINK) {
    throw new Error(`assigned source crosses a gitlink at ${at}`);
  }
  if (resolved.kind === SCOPE_TREE_PATH_KINDS.DIRECTORY) return PRESENT_DIRECTORY;
  const terminal = resolved.index === parts.length - 1;
  if (resolved.kind === SCOPE_TREE_PATH_KINDS.FILE && terminal) return PRESENT_FILE;
  return NOT_PRESENT;
}

export function classifyAssignedSourceSet({
  workspaceDir,
  readScope = [],
  repoPaths = [],
  writeScope = [],
  statFn = statSync,
  realpathFn = realpathSync,
  scopeExistenceReader = null
} = {}) {

  if (scopeExistenceReader === null || typeof scopeExistenceReader.resolve !== "function") {
    throw new Error(
      "assigned-source classification requires the launcher-resolved scope-path existence base; it does not fall back to the live working directory"
    );
  }
  const writeSet = new Set(writeScope);
  const repoSet = new Set(repoPaths);
  const allPaths = uniqueSortedStringList(readScope, repoPaths, writeScope);
  let repoReal = workspaceDir;
  try { repoReal = realpathFn(workspaceDir); } catch {   }
  const result = { existingFiles: [], createTargets: [], namespaces: [], refusals: [] };
  for (const value of allPaths) {
    const path_class = pathClassForAssignedEntry(value, writeSet, repoSet);

    if (isGlobLikeSourceEntry(value) || value.endsWith("/")) {
      result.namespaces.push({ path: value, path_class });
      continue;
    }
    const presence = LANDING_AUTHORITY_WORK_RECORD_RE.test(value)
      ? classifyOnLanding(value, { workspaceDir, repoReal, statFn, realpathFn })
      : classifyAtBase(scopeExistenceReader, value);
    if (presence === PRESENT_DIRECTORY) {
      result.namespaces.push({ path: value, path_class });
      continue;
    }
    if (presence === PRESENT_FILE) {
      result.existingFiles.push({ path: value, path_class });
      continue;
    }
    if (presence === OUTSIDE_PROVEN_SCOPE) {
      result.refusals.push({ path: value, path_class, cause: "assigned_source_outside_proven_scope" });
      continue;
    }
    if (writeSet.has(value)) {
      result.createTargets.push({ path: value, path_class: "write_scope" });
    } else {
      result.refusals.push({ path: value, path_class, cause: "assigned_source_absent" });
    }
  }
  return result;
}

export async function loadAssignedSourceListsForUnit({
  workspaceDir,
  subject,
  loadWorkRecord = null
} = {}) {
  if (!isNonEmptyString(workspaceDir) || !isNonEmptyString(subject)) {
    return { ok: false, reason: "assigned_source_unresolvable" };
  }
  const parsed = parseWorkRecordUnitAddress(subject);
  if (!parsed.ok) return { ok: false, reason: "assigned_source_unit_unparseable" };
  let loaded;
  try {
    loaded = typeof loadWorkRecord === "function"
      ? await loadWorkRecord({ dir: workspaceDir, id: parsed.value.record_id })
      : await loadWorkRecordById({ dir: workspaceDir, id: parsed.value.record_id });
  } catch {
    return { ok: false, reason: "assigned_source_record_unresolvable" };
  }
  const unit = selectedUnit(loaded?.record, parsed.value.slice_id);
  if (!unit) return { ok: false, reason: "assigned_source_record_unresolvable" };
  return {
    ok: true,
    unitAddress: parsed.value.address,
    readScope: uniqueSortedStringList(unit.read_scope),
    repoPaths: uniqueSortedStringList(unit.repo_paths),
    writeScope: uniqueSortedStringList(unit.write_scope)
  };
}

function openScopeExistenceBase(scopeExistence, createReader) {
  if (scopeExistence === null || typeof scopeExistence !== "object" ||
      Array.isArray(scopeExistence) || typeof scopeExistence.main_repo !== "string" ||
      scopeExistence.base === null || typeof scopeExistence.base !== "object" ||
      typeof scopeExistence.base.base_ref !== "string" || scopeExistence.base.base_ref.length === 0 ||
      typeof scopeExistence.base.base_sha !== "string") {
    throw new Error(
      "launcher-resolved assigned-source existence base is absent; the readability proof does not fall back to the live working directory"
    );
  }
  return createReader({
    runGit: typeof scopeExistence.run_git === "function" ? scopeExistence.run_git : defaultRunGit,
    mainRepo: scopeExistence.main_repo,
    baseSha: scopeExistence.base.base_sha
  });
}

export async function proveAssignedSourceReadable({
  app = null,
  subject = null,
  workspace_dir = null,
  sourceReadMode = null,
  nativeReadCapability = null,
  loadWorkRecord = null,
  scopeExistence = null,
  createScopeExistenceReader = createWorkerScopeTreeReader
} = {}) {
  const baseDetail = { app, subject, source_read_mode: sourceReadMode };
  if (sourceReadMode !== LAUNCHER_SOURCE_READ_MODE_NATIVE_FILESYSTEM) {
    return { ok: false, cause: "undeclared_source_read_mode", path_class: null, detail: baseDetail };
  }
  if (nativeReadCapability == null) {
    return { ok: false, cause: "undeclared_native_read_capability", path_class: null, detail: baseDetail };
  }
  const lists = await loadAssignedSourceListsForUnit({
    workspaceDir: workspace_dir,
    subject,
    loadWorkRecord
  });
  if (!lists.ok) return { ok: false, cause: lists.reason, path_class: null, detail: baseDetail };
  const classification = classifyAssignedSourceSet({
    workspaceDir: workspace_dir,
    readScope: lists.readScope,
    repoPaths: lists.repoPaths,
    writeScope: lists.writeScope,
    scopeExistenceReader: openScopeExistenceBase(scopeExistence, createScopeExistenceReader)
  });
  if (classification.refusals.length > 0) {
    const first = classification.refusals[0];
    return {
      ok: false,
      cause: first.cause,
      path_class: first.path_class,
      detail: { ...baseDetail, path: first.path, refusals: classification.refusals }
    };
  }
  return {
    ok: true,
    detail: {
      ...baseDetail,
      unit_address: lists.unitAddress,
      proven_existing_source_count: classification.existingFiles.length,
      create_target_count: classification.createTargets.length,
      namespace_count: classification.namespaces.length
    }
  };
}
