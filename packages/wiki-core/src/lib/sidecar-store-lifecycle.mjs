import { configureReadableSqlite, classifySqliteFailure } from "./sqlite-runtime.mjs";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, lstatSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";

import { captureProcessIdentity, assessProcessLiveness } from "./process-identity.mjs";
import { terminateProcessGroup } from "./process-group.mjs";

import {
  assertLifecycleSchema,
  initializeLifecycleSchema
} from "./sidecar-store-schema.mjs";

export const SIDECAR_UPDATER_LOCK_WAIT_MS = 900_000;
export const SIDECAR_UPDATER_LOCK_MAX_WAIT_MS = 3_600_000;
const LOCK_POLL_MS = 25;

export class SidecarStoreLifecycleError extends Error {
  constructor(message, { code, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "SidecarStoreLifecycleError";
    this.code = code;
  }
}

export function sidecarPreparationCancelledError(signal = null) {
  const error = new Error("sidecar preparation was cancelled",
    signal?.reason === undefined ? undefined : { cause: signal.reason });
  error.code = "sidecar_preparation_cancelled";
  return error;
}

export function throwIfSidecarPreparationCancelled(signal) {
  if (signal?.aborted) throw sidecarPreparationCancelledError(signal);
}

function closeConnection(db) {
  if (db?.isOpen && db.isTransaction) db.exec("ROLLBACK");
  if (db?.isOpen) db.close();
}

export function initializeSidecarLifecycle(lifecyclePath) {
  mkdirSync(path.dirname(lifecyclePath), { recursive: true });
  const db = new DatabaseSync(lifecyclePath, { timeout: 0 });
  try {
    initializeLifecycleSchema(db);
  } catch (cause) {
    throw new SidecarStoreLifecycleError("sidecar lifecycle initialization failed", {
      code: classifySqliteFailure(cause),
      cause
    });
  } finally {
    closeConnection(db);
  }
}

function acquisitionError(cause) {
  return cause instanceof SidecarStoreLifecycleError ? cause :
    new SidecarStoreLifecycleError("sidecar updater lock acquisition failed", {
      code: classifySqliteFailure(cause),
      cause
    });
}

export async function withSidecarUpdaterLock(lifecyclePath, operation, {
  signal = null,
  timeoutMs = SIDECAR_UPDATER_LOCK_WAIT_MS,
  indexing = false
} = {}) {
  if (typeof operation !== "function") {
    throw new TypeError("sidecar updater operation must be a function");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > SIDECAR_UPDATER_LOCK_MAX_WAIT_MS) {
    throw new TypeError(
      `sidecar updater lock timeoutMs must be an integer from 0 through ${SIDECAR_UPDATER_LOCK_MAX_WAIT_MS}`
    );
  }
  const deadline = Date.now() + timeoutMs;
  let db = null;
  let held = false;
  try {
    for (;;) {
      throwIfSidecarPreparationCancelled(signal);
      try {
        if (!existsSync(lifecyclePath)) initializeSidecarLifecycle(lifecyclePath);
        db ??= new DatabaseSync(lifecyclePath, { timeout: 0 });
        configureReadableSqlite(db);
        db.exec("BEGIN EXCLUSIVE");
        break;
      } catch (cause) {
        const error = acquisitionError(cause);
        if (error.code !== "contention") throw error;
        if (Date.now() >= deadline) {
          throw new SidecarStoreLifecycleError(
            `sidecar updater lock was not acquired within ${timeoutMs}ms`,
            { code: "contention", cause }
          );
        }
        await delay(indexing ? 10_000 : LOCK_POLL_MS, undefined, signal ? { signal } : undefined).catch(() => {});
      }
    }
    try {
      assertLifecycleSchema(db);
    } catch (cause) {
      throw new SidecarStoreLifecycleError("sidecar lifecycle schema is missing or incompatible", {
        code: "coordination_unusable",
        cause
      });
    }

    for (const name of readdirSync(path.dirname(lifecyclePath))) {
      if (!/^\.graph-candidate-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.sqlite(?:-journal|-wal|-shm)?$/u.test(name)) continue;
      const artifact = path.join(path.dirname(lifecyclePath), name);
      if (lstatSync(artifact).isFile()) rmSync(artifact);
    }
    let workspacePath = null;
    const ownerPath = path.join(path.dirname(lifecyclePath), ".index-owner.json");
    if (indexing) {

      if (existsSync(ownerPath)) {
        let prior;
        try { prior = JSON.parse(readFileSync(ownerPath, "utf8")); }
        catch (cause) { throw new SidecarStoreLifecycleError(`indexing ownership is unreadable: ${ownerPath}: ${cause.message}`,
          { code: "sidecar_index_owner_invalid", cause }); }
        const abandoned = prior.workspace;
        if (typeof abandoned !== "string" || !path.isAbsolute(abandoned) ||
            !/^sidecar-scip-job-[a-zA-Z0-9-]+$/u.test(path.basename(abandoned)) ||
            (existsSync(abandoned) && !lstatSync(abandoned).isDirectory())) {
          throw new SidecarStoreLifecycleError(`invalid indexing workspace ownership: ${abandoned}`,
            { code: "sidecar_index_workspace_invalid" });
        }
        const verdict = assessProcessLiveness(prior.identity);
        if (verdict.state === "indeterminate") {
          throw new SidecarStoreLifecycleError(`indexing owner cannot be reclaimed: ${verdict.reason}`,
            { code: "sidecar_index_owner_indeterminate" });
        }

        if (existsSync(abandoned)) {
          for (const name of readdirSync(abandoned).filter((name) => /^process-\d+\.json$/u.test(name))) {
            const identity = JSON.parse(readFileSync(path.join(abandoned, name), "utf8"));
            const child = assessProcessLiveness(identity);
            if (child.state === "indeterminate") throw new SidecarStoreLifecycleError(child.reason,
              { code: "sidecar_index_process_indeterminate" });
            if (child.state === "alive") await terminateProcessGroup(identity.pid, { termGraceMs: 500, killGraceMs: 500 });
          }
          rmSync(abandoned, { recursive: true, force: true });
        }
        rmSync(ownerPath);
      }
      workspacePath = path.join(os.tmpdir(), `sidecar-scip-job-${randomUUID()}`);

      writeFileSync(ownerPath, JSON.stringify({ identity: captureProcessIdentity(process.pid), workspace: workspacePath }),
        { flag: "wx", mode: 0o600 });
      try { mkdirSync(workspacePath, { mode: 0o700 }); }
      catch (cause) { rmSync(ownerPath); throw cause; }
    }
    held = true;
    const lock = Object.freeze({
      lifecycle_path: path.resolve(lifecyclePath),
      workspace_path: indexing ? workspacePath : null,
      get held() {
        return held;
      }
    });
    try {
      return await operation(lock);
    } finally {
      if (indexing) {
        rmSync(workspacePath, { recursive: true, force: true });
        rmSync(ownerPath);
      }
    }
  } finally {
    held = false;
    closeConnection(db);
  }
}
