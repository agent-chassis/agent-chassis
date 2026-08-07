

import path from "node:path";
import { createHash } from "node:crypto";
import { mkdtemp, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { isObject } from "./work-records-shared.mjs";
import {
  canonicalizeWorkRecordReadScope,
  canonicalizeWorkRecordJson,
  computeWorkRecordSourceDigest,
  isForgeConfirmedMergePolicy,
  validateWorkRecord
} from "../lib/work-record-schema.mjs";
import { getWorkRecordPath, loadWorkRecordById, loadWorkRecordByPath } from "../lib/work-record-store.mjs";
import { ensureDirectory } from "../lib/wiki-shared.mjs";
import {
  WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_SIDECAR_DIRECTORY,
  publishWorkRecordAdmissionDerivedEvidenceSidecar
} from "../lib/work-record-admission-derived-evidence-persist.mjs";

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

export function computeWorkRecordPersistenceSnapshotDigest(record) {
  const hash = createHash("sha256");
  hash.update(canonicalizeWorkRecordJson(record || {}));
  return `sha256:${hash.digest("hex")}`;
}

function createStoreDiagnostic(code, message, {
  recordId = null,
  unitAddress = null,
  sidecarPath = null,
  operation = null,
  causeCode = null
} = {}) {
  return {
    code,
    severity: "error",
    message,
    ...(recordId ? { record_id: recordId } : {}),
    ...(unitAddress ? { unit_address: unitAddress } : {}),
    ...(sidecarPath ? { sidecar_path: sidecarPath } : {}),
    ...(operation ? { operation } : {}),
    ...(causeCode ? { cause_code: causeCode } : {})
  };
}

function collectReferencedAdmissionSidecarPaths(value, paths = new Set()) {
  if (Array.isArray(value)) {
    for (const entry of value) collectReferencedAdmissionSidecarPaths(entry, paths);
    return paths;
  }
  if (!isObject(value)) return paths;
  for (const [key, entry] of Object.entries(value)) {
    if (
      key === "sidecar_path" &&
      typeof entry === "string" &&
      entry.startsWith(`${WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_SIDECAR_DIRECTORY}/`)
    ) {
      paths.add(path.posix.normalize(entry));
      continue;
    }
    collectReferencedAdmissionSidecarPaths(entry, paths);
  }
  return paths;
}

function recordOwnedAdmissionArtifactPatterns(recordId) {
  const escapedRecordId = recordId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const slice = "(?:SLICE-[0-9]{3}|[a-z0-9][a-z0-9-]*)";
  return {
    immutable: new RegExp(
      `^${escapedRecordId}(?:\\.${slice})?\\.sha256-[a-f0-9]{64}\\.admission\\.json$`,
      "u"
    ),
    stage: new RegExp(
      `^\\.${escapedRecordId}(?:\\.${slice})?\\.sha256-[a-f0-9]{64}` +
        "\\.stage-[a-f0-9]{32}\\.admission\\.tmp$",
      "u"
    )
  };
}

async function inventoryRecordOwnedAdmissionArtifacts({ targetDir, record }) {
  const recordId = typeof record?.id === "string" ? record.id : null;
  const directory = path.resolve(
    targetDir,
    WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_SIDECAR_DIRECTORY
  );
  const referenced = collectReferencedAdmissionSidecarPaths(record);
  const patterns = recordOwnedAdmissionArtifactPatterns(recordId);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { ok: true, immutable: [], stages: [], unreferenced: [] };
    }
    return {
      ok: false,
      diagnostic: createStoreDiagnostic(
        "sidecar_cleanup_failed",
        "record-local admission sidecar inventory failed",
        { recordId, operation: "cleanup_inventory" }
      )
    };
  }
  const immutable = [];
  const stages = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const relativePath = `${WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_SIDECAR_DIRECTORY}/${entry.name}`;
    if (patterns.immutable.test(entry.name)) immutable.push(relativePath);
    if (patterns.stage.test(entry.name)) stages.push(relativePath);
  }
  immutable.sort();
  stages.sort();
  return {
    ok: true,
    immutable,
    stages,
    unreferenced: immutable.filter((entry) => !referenced.has(entry))
  };
}

async function cleanupRecordOwnedAdmissionArtifacts({ targetDir, record, mode }) {
  const inventory = await inventoryRecordOwnedAdmissionArtifacts({ targetDir, record });
  if (!inventory.ok || mode !== "remove") return inventory;
  const removals = [...inventory.unreferenced, ...inventory.stages];
  for (const relativePath of removals) {
    try {
      await rm(path.resolve(targetDir, relativePath));
    } catch (error) {
      return {
        ...inventory,
        ok: false,
        diagnostic: createStoreDiagnostic(
          "sidecar_cleanup_failed",
          "record-local admission sidecar removal failed",
          {
            recordId: record.id,
            sidecarPath: relativePath,
            operation: "cleanup_remove",
            causeCode: ["EACCES", "ENOENT", "EPERM", "EROFS"].includes(error?.code)
              ? error.code
              : null
          }
        )
      };
    }
  }
  return { ...inventory, removed: removals };
}

function staleTransactionResult({
  record,
  canonicalRecordPath,
  sourceDigest,
  code,
  currentSourceDigest = null,
  expectedSourceDigest = null
}) {
  return {
    valid: false,
    written: false,
    diagnostics: [
      createStoreDiagnostic(
        code,
        code === "stale_source_digest"
          ? "source digest does not match the current on-disk record"
          : "persistence snapshot changed since admission materialization",
        { recordId: record?.id ?? null }
      )
    ],
    record,
    source_digest: sourceDigest,
    canonical_record_path: canonicalRecordPath,
    ...(code === "stale_source_digest"
      ? {
          current_source_digest: currentSourceDigest,
          ...(expectedSourceDigest ? { expected_source_digest: expectedSourceDigest } : {})
        }
      : {})
  };
}

export async function writeValidatedWorkRecordWithAdmissionSidecars({
  dir = ".",
  record: inputRecord,
  expectedSourceDigest,
  expectedPersistenceSnapshotDigest,
  admissionSidecars = [],
  cleanupAdmissionSidecars = null,
  recordStore = null,
  canonicalReplace = rename
} = {}) {
  const targetDir = path.resolve(String(dir));
  const record = isObject(inputRecord)
    ? canonicalizeWorkRecordReadScope(inputRecord)
    : inputRecord;
  const recordId = typeof record?.id === "string" ? record.id : null;
  const canonicalRecordPath = recordId ? getWorkRecordPath(targetDir, recordId) : null;
  const sourceDigest = isObject(record) ? computeWorkRecordSourceDigest(record) : null;
  const diagnostics = isObject(record)
    ? validateWorkRecord(record, { sourcePath: canonicalRecordPath, sourceDigest })
    : [createStoreDiagnostic("invalid_record", "work record must be an object")];
  if (!canonicalRecordPath || diagnostics.some((entry) => entry.severity === "error")) {
    return {
      valid: false,
      written: false,
      diagnostics,
      record: isObject(record) ? record : null,
      source_digest: sourceDigest,
      canonical_record_path: canonicalRecordPath
    };
  }
  if (typeof expectedSourceDigest !== "string" || expectedSourceDigest.length === 0) {
    return {
      valid: false,
      written: false,
      diagnostics: [
        createStoreDiagnostic(
          "invalid_expected_source_digest",
          "expected source digest must be a non-empty string",
          { recordId }
        )
      ],
      record,
      source_digest: sourceDigest,
      canonical_record_path: canonicalRecordPath
    };
  }
  if (
    typeof expectedPersistenceSnapshotDigest !== "string" ||
    expectedPersistenceSnapshotDigest.length === 0
  ) {
    return {
      valid: false,
      written: false,
      diagnostics: [
        createStoreDiagnostic(
          "invalid_expected_persistence_snapshot_digest",
          "expected persistence snapshot digest must be a non-empty string",
          { recordId }
        )
      ],
      record,
      source_digest: sourceDigest,
      canonical_record_path: canonicalRecordPath
    };
  }

  let tempWrite = null;
  try {
    tempWrite = await writeJsonFileToTemp(canonicalRecordPath, record);
    return await withWorkRecordWriteLock(targetDir, async () => {
      const currentLoaded = await loadWorkRecordByPath({
        dir: targetDir,
        path: canonicalRecordPath,
        recordStore
      });
      const currentSourceDigest = currentLoaded.source_digest || null;
      if (currentSourceDigest !== expectedSourceDigest) {
        return staleTransactionResult({
          record,
          canonicalRecordPath,
          sourceDigest,
          code: "stale_source_digest",
          currentSourceDigest,
          expectedSourceDigest
        });
      }
      const currentSnapshotDigest = computeWorkRecordPersistenceSnapshotDigest(currentLoaded.record);
      if (currentSnapshotDigest !== expectedPersistenceSnapshotDigest) {
        return staleTransactionResult({
          record,
          canonicalRecordPath,
          sourceDigest,
          code: "stale_persistence_snapshot_digest"
        });
      }

      const publications = [];
      for (const publication of admissionSidecars) {
        const published = await publishWorkRecordAdmissionDerivedEvidenceSidecar({
          targetDir,
          publication
        });
        if (!published.ok) {
          for (const created of publications.filter((entry) => entry.created)) {
            await rm(path.resolve(targetDir, created.relativePath), { force: true }).catch(() => {});
          }
          return {
            valid: false,
            written: false,
            diagnostics: [published.diagnostic],
            record,
            source_digest: sourceDigest,
            canonical_record_path: canonicalRecordPath
          };
        }
        publications.push(published);
      }

      try {
        await canonicalReplace(tempWrite.tempPath, canonicalRecordPath);
      } catch {
        for (const created of publications.filter((entry) => entry.created)) {
          await rm(path.resolve(targetDir, created.relativePath), { force: true }).catch(() => {});
        }
        return {
          valid: true,
          written: false,
          diagnostics: [
            createStoreDiagnostic(
              "work_record_write_failed",
              "failed to write canonical work record JSON",
              { recordId }
            )
          ],
          record,
          source_digest: sourceDigest,
          canonical_record_path: canonicalRecordPath
        };
      }

      const cleanupMode = cleanupAdmissionSidecars?.mode;
      const cleanup = cleanupMode
        ? await cleanupRecordOwnedAdmissionArtifacts({
            targetDir,
            record,
            mode: cleanupMode
          })
        : null;
      return {
        valid: cleanup ? cleanup.ok : true,
        written: true,
        diagnostics: cleanup && !cleanup.ok ? [cleanup.diagnostic] : diagnostics,
        record,
        source_digest: sourceDigest,
        canonical_record_path: canonicalRecordPath,
        current_source_digest: currentSourceDigest,
        admission_sidecar_publications: publications.map((entry) => ({
          created: entry.created,
          sidecar_path: entry.relativePath,
          sidecar_digest: entry.digest
        })),
        admission_sidecar_cleanup: cleanup
      };
    });
  } catch {
    return {
      valid: true,
      written: false,
      diagnostics: [
        createStoreDiagnostic(
          "work_record_write_failed",
          "failed to stage canonical work record JSON",
          { recordId }
        )
      ],
      record,
      source_digest: sourceDigest,
      canonical_record_path: canonicalRecordPath
    };
  } finally {
    if (tempWrite) await rm(tempWrite.tempDir, { recursive: true, force: true });
  }
}

export async function inspectWorkRecordAdmissionSidecarArtifacts({
  dir = ".",
  id,
  expectedSourceDigest,
  expectedPersistenceSnapshotDigest,
  recordStore = null
} = {}) {
  const targetDir = path.resolve(String(dir));
  const canonicalRecordPath = getWorkRecordPath(targetDir, id);
  return withWorkRecordWriteLock(targetDir, async () => {
    const loaded = await loadWorkRecordByPath({
      dir: targetDir,
      path: canonicalRecordPath,
      recordStore
    });
    if (loaded.source_digest !== expectedSourceDigest) {
      return staleTransactionResult({
        record: loaded.record,
        canonicalRecordPath,
        sourceDigest: loaded.source_digest,
        code: "stale_source_digest",
        currentSourceDigest: loaded.source_digest,
        expectedSourceDigest
      });
    }
    if (
      computeWorkRecordPersistenceSnapshotDigest(loaded.record) !==
      expectedPersistenceSnapshotDigest
    ) {
      return staleTransactionResult({
        record: loaded.record,
        canonicalRecordPath,
        sourceDigest: loaded.source_digest,
        code: "stale_persistence_snapshot_digest"
      });
    }
    const inventory = await cleanupRecordOwnedAdmissionArtifacts({
      targetDir,
      record: loaded.record,
      mode: "report"
    });
    return {
      valid: inventory.ok,
      written: false,
      diagnostics: inventory.ok ? [] : [inventory.diagnostic],
      record: loaded.record,
      source_digest: loaded.source_digest,
      canonical_record_path: canonicalRecordPath,
      admission_sidecar_cleanup: inventory
    };
  });
}

function refusesForgeConfirmedCompletion(persistedRecord, proposedRecord) {
  if (proposedRecord.status !== "done") {
    return false;
  }
  if (!isObject(persistedRecord)) {
    return isForgeConfirmedMergePolicy(proposedRecord);
  }
  return isForgeConfirmedMergePolicy(persistedRecord) && persistedRecord.status !== "done";
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

      if (refusesForgeConfirmedCompletion(currentLoaded.record, record)) {
        return {
          status: "forge_confirmed_completion_required"
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

    if (writeResult.status === "forge_confirmed_completion_required") {
      return {
        valid: false,
        written: false,
        diagnostics: [
          {
            code: "forge_confirmed_completion_required",
            severity: "error",
            message:
              "completion_policy forge_confirmed_merge requires forge-confirmed closeout; ordinary status mutation cannot set done",
            path: "status"
          }
        ],
        record,
        source_digest: sourceDigest,
        canonical_record_path: canonicalRecordPath,
        record_id: recordId
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
