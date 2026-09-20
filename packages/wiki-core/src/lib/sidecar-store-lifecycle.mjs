import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";

import {
  assertLifecycleSchema,
  configureReadableSqlite,
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

function sqliteCode(error) {
  return typeof error?.code === "string" ? error.code : null;
}

export function classifyLifecycleFailure(error) {
  const code = sqliteCode(error);
  if (["missing", "contention", "recovery_pending", "coordination_unusable", "failure"]
    .includes(code)) return code;
  if (code === "ERR_SQLITE_ERROR" && /SQLITE_(?:BUSY|LOCKED)/.test(error?.message ?? "")) {
    return "contention";
  }
  if (
    code === "SQLITE_BUSY" ||
    code === "SQLITE_LOCKED" ||
    /database is locked|database table is locked/i.test(error?.message ?? "")
  ) return "contention";
  if (
    code === "SQLITE_READONLY_ROLLBACK" ||
    /readonly.*rollback|hot journal|recovery.*pending/i.test(error?.message ?? "")
  ) return "recovery_pending";
  if (
    code === "SQLITE_CORRUPT" ||
    code === "SQLITE_NOTADB" ||
    /not a database|database disk image is malformed/i.test(error?.message ?? "")
  ) return "coordination_unusable";
  return "failure";
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
      code: classifyLifecycleFailure(cause),
      cause
    });
  } finally {
    closeConnection(db);
  }
}

function acquisitionError(cause) {
  return cause instanceof SidecarStoreLifecycleError ? cause :
    new SidecarStoreLifecycleError("sidecar updater lock acquisition failed", {
      code: classifyLifecycleFailure(cause),
      cause
    });
}

export async function withSidecarUpdaterLock(lifecyclePath, operation, {
  signal = null,
  timeoutMs = SIDECAR_UPDATER_LOCK_WAIT_MS
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
        await delay(LOCK_POLL_MS, undefined, signal ? { signal } : undefined).catch(() => {});
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
    held = true;
    const lock = Object.freeze({
      lifecycle_path: path.resolve(lifecyclePath),
      get held() {
        return held;
      }
    });
    return await operation(lock);
  } finally {
    held = false;
    closeConnection(db);
  }
}
