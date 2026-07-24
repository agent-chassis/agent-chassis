import { realpathSync, statSync } from "node:fs";
import path from "node:path";

import { parseWorkRecordUnitAddress } from "@agent-chassis/agent-launch-core";
import { loadWorkRecordById } from "@agent-chassis/wiki-core";
import { isWithinRepo } from "./launch-isolation.mjs";
import {
  LAUNCHER_SOURCE_READ_MODE_NATIVE_FILESYSTEM
} from "./workspace-agent-launch-adapter-contract.mjs";

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

export function classifyAssignedSourceSet({
  workspaceDir,
  readScope = [],
  repoPaths = [],
  writeScope = [],
  statFn = statSync,
  realpathFn = realpathSync
} = {}) {
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
    const absolute = path.resolve(workspaceDir, value);
    const relative = path.relative(workspaceDir, absolute);
    const lexicalEscape = relative === "" || relative.startsWith("..") || path.isAbsolute(relative);
    let stats = null;
    try { stats = statFn(absolute); } catch {   }
    if (stats?.isDirectory()) {
      result.namespaces.push({ path: value, path_class });
      continue;
    }
    if (stats?.isFile()) {
      let real = absolute;
      try { real = realpathFn(absolute); } catch {   }
      if (lexicalEscape || !isWithinRepo(real, repoReal)) {
        result.refusals.push({ path: value, path_class, cause: "assigned_source_outside_proven_scope" });
      } else {
        result.existingFiles.push({ path: value, path_class });
      }
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

export async function proveAssignedSourceReadable({
  app = null,
  subject = null,
  workspace_dir = null,
  sourceReadMode = null,
  nativeReadCapability = null,
  loadWorkRecord = null
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
    writeScope: lists.writeScope
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
