

import path from "node:path";
import { realpathSync } from "node:fs";

import {
  loadWorkRecordById as defaultLoadWorkRecordById
} from "@agent-chassis/wiki-core/src/lib/work-record-store.mjs";
import {
  resolveWorkRecordEntryMaterial
} from "@agent-chassis/wiki-core/src/lib/work-record-entry-material.mjs";

import { resolveLauncherConfiguredWorkspaceAlias } from "./codex-role-mcp-env.mjs";

export const WORKER_ASSIGNMENT_CAPTURE_SCHEMA_VERSION = "worker-assignment-capture.v1";

export function resolveWorkerMaterialRepository({
  managedCanonicalMainRepo,
  dispatchWorkspaceBinding,
  env,
  canonicalReadRepo
}) {
  if (managedCanonicalMainRepo === null || managedCanonicalMainRepo === undefined) {
    return resolveLauncherConfiguredWorkspaceAlias({
      env,
      repo: canonicalReadRepo,
      mcpServerName: "wiki"
    });
  }
  const alias = dispatchWorkspaceBinding?.workspace_alias;
  const dir = dispatchWorkspaceBinding?.workspace_dir;
  if (typeof alias !== "string" || alias.length === 0 || alias.trim() !== alias ||
      typeof dir !== "string" || !path.isAbsolute(dir)) {
    return null;
  }
  try {
    return realpathSync(dir) === managedCanonicalMainRepo ? alias : null;
  } catch {
    return null;
  }
}

export function createCapturedRecordLoader({
  record,
  loadWorkRecordById = defaultLoadWorkRecordById
} = {}) {
  const cache = new Map();
  if (record && typeof record.id === "string") {
    cache.set(record.id, { valid: true, record, diagnostics: [] });
  }
  return async ({ dir, id }) => {
    if (!cache.has(id)) cache.set(id, await loadWorkRecordById({ dir, id }));
    return cache.get(id);
  };
}

export async function captureWorkerAssignmentMaterial({
  record,
  selectedUnitContract = null,
  repository,
  dir,
  loadWorkRecordById = defaultLoadWorkRecordById
} = {}) {
  const selected = selectedUnitContract ?? record;
  const material = await resolveWorkRecordEntryMaterial({
    record,
    selected,
    repository,
    dir,
    loadWorkRecordById: createCapturedRecordLoader({ record, loadWorkRecordById })
  });
  if (!material.ok) return Object.freeze({ ok: false, diagnostic: material.diagnostic });
  return Object.freeze({
    ok: true,
    capture: Object.freeze({
      schema_version: WORKER_ASSIGNMENT_CAPTURE_SCHEMA_VERSION,
      repository,
      entry_material: material
    })
  });
}
