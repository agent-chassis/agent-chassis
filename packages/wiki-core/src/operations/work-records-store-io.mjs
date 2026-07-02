

import path from "node:path";
import { mkdtemp, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { isObject } from "./work-records-shared.mjs";
import {
  canonicalizeWorkRecordReadScope,
  computeWorkRecordSourceDigest,
  validateWorkRecord
} from "../lib/work-record-schema.mjs";
import { getWorkRecordPath, loadWorkRecordById, loadWorkRecordByPath } from "../lib/work-record-store.mjs";
import { ensureDirectory } from "../lib/wiki-shared.mjs";

const WORK_RECORD_WRITE_LOCK_FILE = ".work-record-write.lock";
const WORK_RECORD_WRITE_LOCK_STALE_AFTER_MS = 60_000;
const WORK_RECORD_WRITE_LOCK_RETRY_DELAY_MS = 100;
const WORK_RECORD_WRITE_LOCK_RETRY_ATTEMPTS = 50;

function getWorkRecordWriteLockPath(targetDir) {
  return path.join(targetDir, "wiki", WORK_RECORD_WRITE_LOCK_FILE);
}

function buildWorkRecordWriteLockMetadata() {
  return {
    acquired_at: new Date().toISOString(),
    pid: process.pid
  };
}

function getProcessLiveness(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return "unknown";
  }

  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error) {
    if (error?.code === "ESRCH") {
      return "dead";
    }

    if (error?.code === "EPERM") {
      return "alive";
    }

    return "unknown";
  }
}

function parseWorkRecordWriteLockMetadata(rawText, lockStats) {
  const now = Date.now();
  const ageMs =
    lockStats && Number.isFinite(lockStats.mtimeMs)
      ? Math.max(0, now - lockStats.mtimeMs)
      : null;

  if (typeof rawText !== "string" || rawText.trim().length === 0) {
    return {
      acquiredAt: null,
      ageMs,
      liveness: "unknown",
      pid: null
    };
  }

  try {
    const parsed = JSON.parse(rawText);
    const pid = Number.isInteger(parsed?.pid) ? parsed.pid : null;
    const acquiredAt =
      typeof parsed?.acquired_at === "string" && parsed.acquired_at.length > 0
        ? parsed.acquired_at
        : null;
    const acquiredAtMs = acquiredAt ? Date.parse(acquiredAt) : Number.NaN;
    const parsedAgeMs =
      Number.isFinite(acquiredAtMs) && acquiredAtMs > 0 ? Math.max(0, now - acquiredAtMs) : null;

    return {
      acquiredAt,
      ageMs: parsedAgeMs ?? ageMs,
      liveness: getProcessLiveness(pid),
      pid
    };
  } catch {
    return {
      acquiredAt: null,
      ageMs,
      liveness: "unknown",
      pid: null
    };
  }
}

async function readWorkRecordWriteLockState(lockPath) {
  try {
    const [lockStats, rawText] = await Promise.all([stat(lockPath), readFile(lockPath, "utf8")]);
    return {
      ...parseWorkRecordWriteLockMetadata(rawText, lockStats),
      exists: true,
      rawText,
      lockStats
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        acquiredAt: null,
        ageMs: null,
        exists: false,
        liveness: "unknown",
        rawText: null,
        lockStats: null,
        pid: null
      };
    }

    throw error;
  }
}

function shouldRecoverStaleWorkRecordWriteLock(lockState) {
  if (!lockState?.exists) {
    return false;
  }

  if (lockState.liveness === "dead") {
    return true;
  }

  if (lockState.liveness === "unknown" && lockState.ageMs !== null) {
    return lockState.ageMs >= WORK_RECORD_WRITE_LOCK_STALE_AFTER_MS;
  }

  return false;
}

function doesWorkRecordWriteLockMatchSnapshot(observedState, currentState) {
  if (!observedState?.exists || !currentState?.exists) {
    return false;
  }

  if (typeof observedState.rawText !== "string" || typeof currentState.rawText !== "string") {
    return false;
  }

  return observedState.rawText === currentState.rawText;
}

async function breakStaleWorkRecordWriteLock(lockPath, observedState) {
  const currentState = await readWorkRecordWriteLockState(lockPath);
  if (!doesWorkRecordWriteLockMatchSnapshot(observedState, currentState)) {
    return false;
  }

  if (!shouldRecoverStaleWorkRecordWriteLock(currentState)) {
    return false;
  }

  const recoveryPath = `${lockPath}.stale-${process.pid}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;

  try {
    await rename(lockPath, recoveryPath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }

    throw error;
  } finally {
    await rm(recoveryPath, { force: true });
  }
}

async function withWorkRecordWriteLock(targetDir, callback) {
  const lockPath = getWorkRecordWriteLockPath(targetDir);
  await ensureDirectory(path.dirname(lockPath));
  let handle = null;

  for (let attempt = 0; attempt < WORK_RECORD_WRITE_LOCK_RETRY_ATTEMPTS; attempt += 1) {
    try {
      handle = await open(lockPath, "wx");
      try {
        await handle.writeFile(`${JSON.stringify(buildWorkRecordWriteLockMetadata(), null, 2)}\n`, {
          encoding: "utf8"
        });
      } catch (error) {
        await handle.close();
        handle = null;
        await rm(lockPath, { force: true });
        throw error;
      }
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }

      const lockState = await readWorkRecordWriteLockState(lockPath);
      if (shouldRecoverStaleWorkRecordWriteLock(lockState)) {
        const recovered = await breakStaleWorkRecordWriteLock(lockPath, lockState);
        if (recovered) {
          continue;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, WORK_RECORD_WRITE_LOCK_RETRY_DELAY_MS));
    }
  }

  if (!handle) {
    throw new Error(`Timed out waiting for work-record write lock at ${lockPath}`);
  }

  try {
    return await callback();
  } finally {
    await handle.close();
    await rm(lockPath, { force: true });
  }
}

async function writeJsonFileToTemp(filePath, value) {
  const directory = path.dirname(filePath);
  const tempDir = await mkdtemp(path.join(directory, ".record-tmp-"));
  const tempPath = path.join(tempDir, path.basename(filePath));
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx"
  });
  return { tempDir, tempPath };
}

export async function readWorkRecordById({
  dir = ".",
  id,
  recordStore = null
} = {}) {
  const targetDir = path.resolve(String(dir));
  return loadWorkRecordById({ dir: targetDir, id, recordStore });
}

export async function readWorkRecordByPath({
  dir = ".",
  path: requestedPath,
  recordStore = null
} = {}) {
  const targetDir = path.resolve(String(dir));
  return loadWorkRecordByPath({ dir: targetDir, path: requestedPath, recordStore });
}

export function digestWorkRecord(record) {
  return computeWorkRecordSourceDigest(record);
}

export async function writeValidatedWorkRecord({
  dir = ".",
  record: inputRecord,
  expectedSourceDigest = null,
  recordStore = null
} = {}) {
  const targetDir = path.resolve(String(dir));

  const record = isObject(inputRecord)
    ? canonicalizeWorkRecordReadScope(inputRecord)
    : inputRecord;

  if (!isObject(record)) {
    return {
      valid: false,
      written: false,
      diagnostics: [
        {
          code: "invalid_record",
          severity: "error",
          message: "work record must be an object",
          path: null
        }
      ],
      record: null,
      source_digest: null,
      canonical_record_path: null
    };
  }

  const recordId = typeof record.id === "string" ? record.id : null;
  const canonicalRecordPath = recordId ? getWorkRecordPath(targetDir, recordId) : null;
  const sourceDigest = computeWorkRecordSourceDigest(record);
  const diagnostics = validateWorkRecord(record, {
    sourcePath: canonicalRecordPath,
    sourceDigest
  });

  if (!canonicalRecordPath || diagnostics.some((entry) => entry.severity === "error")) {
    return {
      valid: false,
      written: false,
      diagnostics,
      record,
      source_digest: sourceDigest,
      canonical_record_path: canonicalRecordPath
    };
  }

  const currentLoadedBeforeWrite = await loadWorkRecordByPath({
    dir: targetDir,
    path: canonicalRecordPath,
    recordStore
  });
  const baselineSourceDigest = currentLoadedBeforeWrite.source_digest || null;
  if (expectedSourceDigest !== null && expectedSourceDigest !== undefined) {
    if (typeof expectedSourceDigest !== "string" || expectedSourceDigest.length === 0) {
      return {
        valid: false,
        written: false,
        diagnostics: [
          {
            code: "invalid_expected_source_digest",
            severity: "error",
            message: "expected source digest must be a non-empty string",
            path: canonicalRecordPath
          }
        ],
        record,
        source_digest: sourceDigest,
        canonical_record_path: canonicalRecordPath,
        expected_source_digest: expectedSourceDigest,
        current_source_digest: null
      };
    }
  }

  const guardSourceDigest =
    expectedSourceDigest !== null && expectedSourceDigest !== undefined
      ? expectedSourceDigest
      : baselineSourceDigest;
  let tempWrite = null;
  try {
    tempWrite = await writeJsonFileToTemp(canonicalRecordPath, record);
    const writeResult = await withWorkRecordWriteLock(targetDir, async () => {
      const currentLoaded = await loadWorkRecordByPath({
        dir: targetDir,
        path: canonicalRecordPath,
        recordStore
      });
      const currentSourceDigest = currentLoaded.source_digest || null;
      if (currentSourceDigest !== guardSourceDigest) {
        return {
          status: "stale",
          current_source_digest: currentSourceDigest
        };
      }

      try {
        await rename(tempWrite.tempPath, canonicalRecordPath);
      } catch {
        return {
          status: "write_failed"
        };
      }

      return {
        status: "written",
        current_source_digest: currentSourceDigest
      };
    });

    if (writeResult.status === "stale") {
      return {
        valid: false,
        written: false,
        diagnostics: [
          {
            code: "stale_source_digest",
            severity: "error",
            message: "source digest does not match the current on-disk record",
            path: canonicalRecordPath
          }
        ],
        record,
        source_digest: sourceDigest,
        canonical_record_path: canonicalRecordPath,
        record_id: recordId,
        current_source_digest: writeResult.current_source_digest,
        ...(expectedSourceDigest !== null && expectedSourceDigest !== undefined
          ? { expected_source_digest: expectedSourceDigest }
          : {})
      };
    }

    if (writeResult.status === "write_failed") {
      return {
        valid: true,
        written: false,
        diagnostics: [
          {
            code: "work_record_write_failed",
            severity: "error",
            message: "failed to write canonical work record JSON",
            path: canonicalRecordPath
          }
        ],
        record,
        source_digest: sourceDigest,
        canonical_record_path: canonicalRecordPath
      };
    }
  } catch {
    return {
      valid: true,
      written: false,
      diagnostics: [
        {
          code: "work_record_write_failed",
          severity: "error",
          message: "failed to write canonical work record JSON",
          path: canonicalRecordPath
        }
      ],
      record,
      source_digest: sourceDigest,
      canonical_record_path: canonicalRecordPath
    };
  } finally {
    if (tempWrite) {
      await rm(tempWrite.tempDir, { recursive: true, force: true });
    }
  }

  return {
    valid: true,
    written: true,
    diagnostics,
    record,
    source_digest: sourceDigest,
    canonical_record_path: canonicalRecordPath
  };
}
