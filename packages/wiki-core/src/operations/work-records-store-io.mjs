

import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import {
  CRASH_DURABLE_EFFECTS,
  createAsyncEffects,
  planReplacement,
  runCrashDurablePlanAsync
} from "../lib/crash-durable-state.mjs";
import { isObject } from "./work-records-shared.mjs";
import {
  canonicalizeWorkRecordJson,
  computeWorkRecordSourceDigest,
  validateWorkRecord
} from "../lib/work-record-schema.mjs";
import {
  captureCanonicalWorkRecordInventory,
  getWorkRecordPath,
  loadWorkRecordById,
  loadWorkRecordByPath
} from "../lib/work-record-store.mjs";
import { ensureDirectory } from "../lib/wiki-shared.mjs";
import {
  ADMISSION_ARTIFACT_DIRECTORY,
  admissionArtifactReferenceUnavailableDiagnostic,
  classifyAdmissionArtifactBasename,
  collectRetainedAdmissionArtifactPaths,
  findUnavailableNewAdmissionArtifactReferences
} from "../lib/work-record-admission-artifact-references.mjs";
import {
  WORK_RECORD_PERSISTENCE_PHASES,
  WORK_RECORD_PUBLICATION_STATES,
  appendWorkRecordPersistenceFailure as appendPersistenceFailure,
  obsoleteDocsInputDiagnostic,
  persistenceOutcomeFields,
  publicationStateFromCrashDurableResult,
  staleWorkRecordPersistenceResult as staleTransactionResult,
  workRecordInputContractRefusal as inputContractRefusal,
  workRecordPersistenceResult as persistenceResult
} from "./work-record-persistence-diagnostics.mjs";
import {
  runValidatedWorkRecordAdmissionTransaction,
  settleWorkRecordPersistenceWithOptionalLock
} from
  "./work-record-persistence-transaction.mjs";
import { withWorkRecordWriteLock } from "./work-record-write-lock.mjs";
import { preservesWorkRecordEntryHistory } from "../lib/work-record-entry-schema.mjs";
import { validateWorkRecordEntryIntegrity } from "../lib/work-record-entry-content.mjs";

export {
  WORK_RECORD_WRITE_LOCK_IDENTITY_UNAVAILABLE_CODE,
  WORK_RECORD_WRITE_LOCK_UNAVAILABLE_CODE,
  mintWorkRecordWriteLockToken,
  processIdentityFromWorkRecordWriteLockToken
} from "./work-record-write-lock.mjs";

const WORK_RECORD_READ_LEASES = new WeakMap();

const WORK_RECORD_READ_LEASE_MAX_DURATION_MS = 60_000;

async function publishCanonicalWorkRecord({
  canonicalRecordPath,
  record,
  canonicalReplace = rename,
  faultInjector = null,
  canonicalBytes
}) {
  const bytes = canonicalBytes ?? `${JSON.stringify(record, null, 2)}\n`;
  const privatePath = path.join(
    path.dirname(canonicalRecordPath),
    `.${path.basename(canonicalRecordPath)}.publish-${process.pid}-${randomBytes(8).toString("hex")}`
  );

  const effects = {
    ...createAsyncEffects({ mode: 0o666, faultInjector }),
    [CRASH_DURABLE_EFFECTS.PUBLISH_RENAME]: async (step) => {
      if (typeof faultInjector === "function" && step.fault !== null) faultInjector(step.fault);
      await canonicalReplace(step.privatePath, step.targetPath);
    }
  };
  const result = await runCrashDurablePlanAsync(
    planReplacement({ targetPath: canonicalRecordPath, privatePath, bytes }),
    effects
  );
  return result;
}

export function assertCanonicalWorkRecordReadLease(lease, {
  dir = ".", id, now = Date.now()
} = {}) {
  const state = lease !== null && typeof lease === "object"
    ? WORK_RECORD_READ_LEASES.get(lease) : null;
  if (state === null || state === undefined || state.active !== true) {
    const error = new Error("canonical work-record read lease is missing or forged");
    error.code = "canonical_work_record_read_lease_invalid";
    throw error;
  }
  const targetDir = path.resolve(String(dir));
  if (state.targetDir !== targetDir || state.id !== id) {
    const error = new Error("canonical work-record read lease identity is mismatched");
    error.code = "canonical_work_record_read_lease_identity_mismatch";
    throw error;
  }
  if (!Number.isFinite(now) || now > state.expiresAt) {
    const error = new Error("canonical work-record read lease expired");
    error.code = "canonical_work_record_read_lease_expired";
    throw error;
  }
  return Object.freeze({
    target_dir: state.targetDir,
    record_id: state.id,
    source_digest: state.sourceDigest,
    expires_at: new Date(state.expiresAt).toISOString()
  });
}

export async function withCanonicalWorkRecordReadLease({
  dir = ".", id, recordStore = null, maximumDurationMs = WORK_RECORD_READ_LEASE_MAX_DURATION_MS,
  requireValidRecord = true
} = {}, callback) {
  if (typeof callback !== "function" || typeof id !== "string" || id.length === 0 ||
      !Number.isInteger(maximumDurationMs) || maximumDurationMs <= 0 ||
      maximumDurationMs > WORK_RECORD_READ_LEASE_MAX_DURATION_MS) {
    const error = new Error("canonical work-record read lease input is invalid");
    error.code = "canonical_work_record_read_lease_input_invalid";
    throw error;
  }
  const targetDir = path.resolve(String(dir));
  return withWorkRecordWriteLock(targetDir, async () => {
    const loaded = await loadWorkRecordById({ dir: targetDir, id, recordStore });
    if ((requireValidRecord && loaded.valid !== true) || loaded.record_id !== id || !loaded.record ||
        typeof loaded.source_digest !== "string") {
      const error = new Error("canonical work record is unavailable or invalid under its lease");
      error.code = "canonical_work_record_read_lease_source_invalid";
      error.details = { diagnostics: structuredClone(loaded.diagnostics ?? []) };
      throw error;
    }
    const token = Object.freeze(Object.create(null));
    const state = {
      active: true,
      expiresAt: Date.now() + maximumDurationMs,
      id,
      sourceDigest: loaded.source_digest,
      targetDir
    };
    WORK_RECORD_READ_LEASES.set(token, state);
    try {
      return await callback(Object.freeze({
        lease: token,
        record: loaded.record,
        source_digest: loaded.source_digest,
        canonical_record_path: loaded.canonical_path ?? getWorkRecordPath(targetDir, id)
      }));
    } finally {
      state.active = false;
    }
  }, { reentrant: true });
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

function sameCanonicalValue(left, right) {
  return canonicalizeWorkRecordJson(left) === canonicalizeWorkRecordJson(right);
}

function preservesReviewProvenance(persistedRecord, proposedRecord) {
  const persistedHasLedger = Object.prototype.hasOwnProperty.call(
    persistedRecord ?? {}, "review_provenance");
  const proposedHasLedger = Object.prototype.hasOwnProperty.call(
    proposedRecord ?? {}, "review_provenance");
  if (persistedHasLedger === proposedHasLedger &&
      (!persistedHasLedger || sameCanonicalValue(
        persistedRecord.review_provenance,
        proposedRecord.review_provenance
      ))) {
    return true;
  }
  return false;
}

function reviewProvenanceHistoryMutationDiagnostic(recordId) {
  return createStoreDiagnostic(
    "review_provenance_history_mutation",
    "archival review_provenance must be preserved exactly",
    { recordId }
  );
}

function entryHistoryMutationDiagnostic(recordId) {
  return createStoreDiagnostic(
    "work_record_entry_history_mutation",
    "published work-record entry versions must be retained byte-for-byte",
    { recordId }
  );
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

const MAINTENANCE_CAUSE_CODES = new Set(["EACCES", "EBUSY", "EIO", "ENOENT", "EPERM", "EROFS"]);

function maintenanceCauseCode(error) {
  return MAINTENANCE_CAUSE_CODES.has(error?.code) ? error.code : null;
}

function countMaintenance(instrumentation, name, amount = 1) {
  if (typeof instrumentation?.increment === "function") instrumentation.increment(name, amount);
}

async function maintainRecordOwnedAdmissionArtifacts({
  targetDir,
  record,
  mode,
  retainedPaths = [],
  recordStore = null,
  instrumentation = null,
  unlinkArtifact = unlink
}) {
  const recordId = typeof record?.id === "string" ? record.id : null;
  const report = {
    ok: true,
    mode,
    record_id: recordId,
    immutable: [],
    stages: [],
    retained: [],
    unreferenced: [],
    removed: [],
    failed: [],
    canonical_records_scanned: 0
  };
  const fail = (operation, error, canonicalRecordPath = null) => ({
    ...report,
    ok: false,
    diagnostic: {
      ...createStoreDiagnostic(
        "sidecar_cleanup_failed",
        `admission artifact maintenance ${operation} failed; no artifact was removed`,
        { recordId, operation, causeCode: maintenanceCauseCode(error) }
      ),
      ...(canonicalRecordPath ? { path: canonicalRecordPath } : {}),
      ...(typeof error?.code === "string" && error.code.startsWith("work_record_")
        ? { producer_code: error.code }
        : {})
    }
  });

  let entries;
  countMaintenance(instrumentation, "evidence_enumeration_count");
  try {
    entries = await readdir(path.resolve(targetDir, ADMISSION_ARTIFACT_DIRECTORY), {
      withFileTypes: true
    });
  } catch (error) {
    if (error?.code === "ENOENT") return report;
    return fail("cleanup_inventory", error);
  }
  for (const entry of entries) {

    if (!entry.isFile()) continue;
    const classified = classifyAdmissionArtifactBasename(entry.name);
    if (classified === null || classified.record_id !== recordId) continue;
    const relativePath = `${ADMISSION_ARTIFACT_DIRECTORY}/${entry.name}`;
    if (classified.kind === "immutable") report.immutable.push(relativePath);
    else report.stages.push(relativePath);
  }
  report.immutable.sort();
  report.stages.sort();

  const retained = new Set(retainedPaths);
  collectRetainedAdmissionArtifactPaths(record, retained);
  let candidates = report.immutable.filter((entry) => !retained.has(entry));
  if (candidates.length > 0) {
    let inventory;
    try {
      inventory = await captureCanonicalWorkRecordInventory({
        dir: targetDir,
        recordStore,
        instrumentation
      });
    } catch (error) {
      return fail("cleanup_reference_inventory", error);
    }
    const targetRecordPath = getWorkRecordPath(targetDir, recordId);
    for (const captured of inventory) {
      if (captured.readError !== null) {
        return fail("cleanup_reference_read", captured.readError, captured.relativePath);
      }

      if (captured.absolutePath === targetRecordPath) continue;
      let parsed;
      try {
        parsed = JSON.parse(captured.rawBytes.toString("utf8"));
      } catch (error) {
        return fail("cleanup_reference_parse", error, captured.relativePath);
      }
      countMaintenance(instrumentation, "canonical_parse_count");
      collectRetainedAdmissionArtifactPaths(parsed, retained);
      countMaintenance(instrumentation, "canonical_traversal_count");
      report.canonical_records_scanned += 1;
    }
    candidates = candidates.filter((entry) => !retained.has(entry));
  }
  report.unreferenced = candidates;
  report.retained = report.immutable.filter((entry) => !candidates.includes(entry));
  if (mode !== "remove") return report;

  for (const relativePath of [...candidates, ...report.stages]) {
    countMaintenance(instrumentation, "unlink_attempt_count");
    try {
      await unlinkArtifact(path.resolve(targetDir, relativePath));
      report.removed.push(relativePath);
    } catch (error) {
      report.failed.push({ sidecar_path: relativePath, cause_code: maintenanceCauseCode(error) });
    }
  }
  if (report.failed.length === 0) return report;
  return {
    ...report,
    ok: false,
    diagnostic: createStoreDiagnostic(
      "sidecar_cleanup_failed",
      "admission artifact maintenance could not remove every eligible artifact",
      {
        recordId,
        sidecarPath: report.failed[0].sidecar_path,
        operation: "cleanup_remove",
        causeCode: report.failed[0].cause_code
      }
    )
  };
}

export async function writeValidatedWorkRecordWithAdmissionSidecars(options = {}) {
  return runValidatedWorkRecordAdmissionTransaction(options, {
    maintainRecordOwnedAdmissionArtifacts,
    computeWorkRecordPersistenceSnapshotDigest,
    createStoreDiagnostic,
    preservesReviewProvenance,
    preservesWorkRecordEntryHistory,
    entryHistoryMutationDiagnostic,
    validateWorkRecordEntryIntegrity,
    publishCanonicalWorkRecord,
    reviewProvenanceHistoryMutationDiagnostic,
    withWorkRecordWriteLock,
    writeJsonFileToTemp
  });
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
    const inventory = await maintainRecordOwnedAdmissionArtifacts({
      targetDir,
      record: loaded.record,
      mode: "report",
      recordStore
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

export async function writeValidatedWorkRecord({
  dir = ".",
  record: inputRecord,
  expectedSourceDigest = null,
  recordStore = null,
  canonicalReplace = rename,
  persistenceEffects = {},

  lockAlreadyHeld = false
} = {}) {
  const targetDir = path.resolve(String(dir));
  const record = inputRecord;

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
      diagnostic_count: 1,
      record: null,
      source_digest: null,
      canonical_record_path: null
    };
  }

  const recordId = typeof record.id === "string" ? record.id : null;
  const canonicalRecordPath = recordId ? getWorkRecordPath(targetDir, recordId) : null;
  const obsoleteInput = obsoleteDocsInputDiagnostic(record);
  if (obsoleteInput) {
    return inputContractRefusal({
      record,
      sourceDigest: null,
      canonicalRecordPath,
      diagnostic: obsoleteInput
    });
  }
  const sourceDigest = computeWorkRecordSourceDigest(record);
  const diagnostics = validateWorkRecord(record, {
    sourcePath: canonicalRecordPath,
    sourceDigest
  });

  if (!diagnostics.some((entry) => entry.severity === "error") && canonicalRecordPath) {
    const integrity = await validateWorkRecordEntryIntegrity({
      record,
      repository: record.repo,
      dir: targetDir,
      loadWorkRecordById
    });
    if (!integrity.ok) diagnostics.push(integrity.diagnostic);
  }

  if (!canonicalRecordPath || diagnostics.some((entry) => entry.severity === "error")) {
    return {
      valid: false,
      written: false,
      diagnostics,
      diagnostic_count: diagnostics.length,
      record,
      source_digest: sourceDigest,
      canonical_record_path: canonicalRecordPath
    };
  }

  let currentLoadedBeforeWrite;
  try {
    const loadRecord = persistenceEffects.loadRecordByPath ?? loadWorkRecordByPath;
    currentLoadedBeforeWrite = await loadRecord({
      dir: targetDir,
      path: canonicalRecordPath,
      recordStore
    });
  } catch (error) {
    return appendPersistenceFailure({
      valid: true,
      diagnostics,
      record,
      source_digest: sourceDigest,
      canonical_record_path: canonicalRecordPath
    }, {
      phase: WORK_RECORD_PERSISTENCE_PHASES.TRANSACTION_PREPARATION,
      cause: error,
      publicationState: WORK_RECORD_PUBLICATION_STATES.NOT_PUBLISHED,
      recordId,
      canonicalRecordPath
    });
  }
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
        diagnostic_count: 1,
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
  const stageJsonFile = persistenceEffects.stageJsonFile ?? writeJsonFileToTemp;
  const loadRecord = persistenceEffects.loadRecordByPath ?? loadWorkRecordByPath;
  const removeTemporaryDirectory = persistenceEffects.removeTemporaryDirectory ?? rm;
  const canonicalFaultInjector = persistenceEffects.canonicalFaultInjector ?? null;
  const lockFaultInjector = persistenceEffects.lockFaultInjector ?? null;
  let tempWrite = null;
  let result = null;
  try {

    try {
      await ensureDirectory(path.dirname(canonicalRecordPath));
      tempWrite = await stageJsonFile(canonicalRecordPath, record);
    } catch (error) {
      result = appendPersistenceFailure({
        valid: true,
        diagnostics,
        record,
        source_digest: sourceDigest,
        canonical_record_path: canonicalRecordPath
      }, {
        phase: WORK_RECORD_PERSISTENCE_PHASES.STAGING,
        cause: error,
        publicationState: WORK_RECORD_PUBLICATION_STATES.NOT_PUBLISHED,
        recordId,
        canonicalRecordPath
      });
    }

    if (result === null) {
      const settleUnderLock = async () => {
        const currentLoaded = await loadRecord({
          dir: targetDir,
          path: canonicalRecordPath,
          recordStore
        });
        const currentSourceDigest = currentLoaded.source_digest || null;
        if (currentSourceDigest !== guardSourceDigest) {
          return { status: "stale", current_source_digest: currentSourceDigest };
        }
        if (!preservesReviewProvenance(currentLoaded.record, record)) {
          return { status: "review_provenance_history_mutation" };
        }
        if (!preservesWorkRecordEntryHistory(currentLoaded.record, record)) {
          return { status: "entry_history_mutation" };
        }
        const unavailableReferences = await findUnavailableNewAdmissionArtifactReferences({
          targetDir,
          previousRecord: currentLoaded.record,
          proposedRecord: record
        });
        if (unavailableReferences.length > 0) {
          return { status: "admission_artifact_reference_unavailable", unavailableReferences };
        }
        const publication = await publishCanonicalWorkRecord({
          canonicalRecordPath,
          record,
          canonicalReplace,
          faultInjector: canonicalFaultInjector
        });
        return { status: "publication", publication, current_source_digest: currentSourceDigest };
      };
      const lockOutcome = await settleWorkRecordPersistenceWithOptionalLock({
        targetDir,
        settleUnderLock,
        lockAlreadyHeld,
        lockFaultInjector,
        withWorkRecordWriteLock
      });

      if (lockOutcome.acquisition_error) {
        result = appendPersistenceFailure({
          valid: true,
          diagnostics,
          record,
          source_digest: sourceDigest,
          canonical_record_path: canonicalRecordPath
        }, {
          phase: WORK_RECORD_PERSISTENCE_PHASES.LOCK_ACQUISITION,
          cause: lockOutcome.acquisition_error,
          publicationState: WORK_RECORD_PUBLICATION_STATES.NOT_PUBLISHED,
          recordId,
          canonicalRecordPath
        });
      } else if (lockOutcome.callback_error) {
        result = appendPersistenceFailure({
          valid: true,
          diagnostics,
          record,
          source_digest: sourceDigest,
          canonical_record_path: canonicalRecordPath
        }, {
          phase: WORK_RECORD_PERSISTENCE_PHASES.TRANSACTION_PREPARATION,
          cause: lockOutcome.callback_error,
          publicationState: WORK_RECORD_PUBLICATION_STATES.NOT_PUBLISHED,
          recordId,
          canonicalRecordPath
        });
      } else if (lockOutcome.value.status === "stale") {
        result = {
          valid: false,
          ...persistenceOutcomeFields(WORK_RECORD_PUBLICATION_STATES.NOT_PUBLISHED),
          diagnostics: [
          {
            code: "stale_source_digest",
            severity: "error",
            message: "source digest does not match the current on-disk record",
            path: canonicalRecordPath
          }
          ],
          diagnostic_count: 1,
          record,
        source_digest: sourceDigest,
        canonical_record_path: canonicalRecordPath,
        record_id: recordId,
        current_source_digest: lockOutcome.value.current_source_digest,
        ...(expectedSourceDigest !== null && expectedSourceDigest !== undefined
          ? { expected_source_digest: expectedSourceDigest }
          : {})
        };
      } else if (lockOutcome.value.status === "review_provenance_history_mutation") {
        result = {
          valid: false,
          ...persistenceOutcomeFields(WORK_RECORD_PUBLICATION_STATES.NOT_PUBLISHED),
          diagnostics: [reviewProvenanceHistoryMutationDiagnostic(recordId)],
          diagnostic_count: 1,
        record,
        source_digest: sourceDigest,
        canonical_record_path: canonicalRecordPath,
        record_id: recordId
        };
      } else if (lockOutcome.value.status === "entry_history_mutation") {
        result = {
          valid: false,
          ...persistenceOutcomeFields(WORK_RECORD_PUBLICATION_STATES.NOT_PUBLISHED),
          diagnostics: [entryHistoryMutationDiagnostic(recordId)],
          diagnostic_count: 1,
          record,
          source_digest: sourceDigest,
          canonical_record_path: canonicalRecordPath,
          record_id: recordId
        };
      } else if (lockOutcome.value.status === "admission_artifact_reference_unavailable") {
        result = {
          valid: false,
          ...persistenceOutcomeFields(WORK_RECORD_PUBLICATION_STATES.NOT_PUBLISHED),
          diagnostics: [admissionArtifactReferenceUnavailableDiagnostic(
            recordId,
            lockOutcome.value.unavailableReferences
          )],
          diagnostic_count: 1,
          record,
          source_digest: sourceDigest,
          canonical_record_path: canonicalRecordPath,
          record_id: recordId
        };
      } else {
        const publication = lockOutcome.value.publication;
        if (publication.failed_fault !== null) {
          const publicationState = publicationStateFromCrashDurableResult(publication);
          result = appendPersistenceFailure({
            valid: true,
            diagnostics,
            record,
            source_digest: sourceDigest,
            canonical_record_path: canonicalRecordPath,
            current_source_digest: lockOutcome.value.current_source_digest
          }, {
            phase: WORK_RECORD_PERSISTENCE_PHASES.CANONICAL_PUBLICATION,
            cause: publication.error ?? "canonical work-record publication failed",
            publicationState,
            recordId,
            canonicalRecordPath,
            failedFault: publication.failed_fault,
            trace: publication.trace
          });
        } else {
          result = persistenceResult({
            valid: true,
            record,
            sourceDigest,
            canonicalRecordPath,
            publicationState: WORK_RECORD_PUBLICATION_STATES.PUBLISHED,
            ok: true,
            diagnostics,
            current_source_digest: lockOutcome.value.current_source_digest
          });
        }
      }
      if (lockOutcome.release_error) {
        result = appendPersistenceFailure(result, {
          phase: WORK_RECORD_PERSISTENCE_PHASES.LOCK_RELEASE,
          cause: lockOutcome.release_error,
          publicationState: result?.publication_state ??
            WORK_RECORD_PUBLICATION_STATES.NOT_PUBLISHED,
          failureRole: result?.ok === false ? "secondary" : "primary",
          recordId,
          canonicalRecordPath
        });
      }
    }
  } finally {
    if (tempWrite) {
      try {
        await removeTemporaryDirectory(tempWrite.tempDir, { recursive: true, force: true });
      } catch (error) {
        result = appendPersistenceFailure(result ?? {
          valid: true,
          diagnostics,
          record,
          source_digest: sourceDigest,
          canonical_record_path: canonicalRecordPath
        }, {
          phase: WORK_RECORD_PERSISTENCE_PHASES.CLEANUP,
          cause: error,
          publicationState: result?.publication_state ??
            WORK_RECORD_PUBLICATION_STATES.NOT_PUBLISHED,
          failureRole: result?.ok === false ? "secondary" : "primary",
          recordId,
          canonicalRecordPath
        });
      }
    }
  }
  return result;
}

export async function prepareWorkRecordTestTargetSettlement({
  dir, id, selectedUnit = null, record, lease, allowProofPosture = false
}) {
  const bound = assertCanonicalWorkRecordReadLease(lease, { dir, id });
  const loaded = await loadWorkRecordById({ dir, id });
  const failure = (code, message, details = {}) => {
    const error = new Error(message); error.code = code; error.details = details; throw error;
  };
  if (loaded.source_digest !== bound.source_digest) failure('work_record_target_source_stale', 'Target source moved under its lease');
  const previous = structuredClone(loaded.record), candidate = structuredClone(record);
  const select = value => selectedUnit === null ? value : value.slices.find(slice => slice.id === selectedUnit);
  if (!select(previous) || !select(candidate)) failure('work_record_target_unit_missing', 'Selected target owner does not exist');
  select(candidate).acceptance.validation = select(previous).acceptance.validation;
  if (allowProofPosture) {
    if (Object.hasOwn(previous, 'proof_posture')) {
      candidate.proof_posture = structuredClone(previous.proof_posture);
    } else {
      delete candidate.proof_posture;
    }
    candidate.updated = previous.updated;
  }
  if (computeWorkRecordSourceDigest(candidate) !== computeWorkRecordSourceDigest(previous)) {
    failure('work_record_target_scope_invalid', allowProofPosture
      ? 'Target participant changes fields outside selected validation and parent proof posture'
      : 'Target participant changes fields outside selected validation');
  }
  const diagnostics = validateWorkRecord(record, { sourcePath: loaded.canonical_path, sourceDigest: computeWorkRecordSourceDigest(record) });
  if (diagnostics.some(d => d.severity === 'error')) failure('work_record_target_invalid', 'Prospective target record is invalid', { diagnostics });
  const file = getWorkRecordPath(path.resolve(dir), id);
  const priorBytes = await readFile(file);
  let attempted = false;
  return {
    commit: async () => {
      assertCanonicalWorkRecordReadLease(lease, { dir, id });
      const current = await readFile(file);
      if (!current.equals(priorBytes)) failure('work_record_target_source_stale', 'Target bytes changed before terminal publication');
      WORK_RECORD_READ_LEASES.get(lease).active = false;
      attempted = true;
      const result = await publishCanonicalWorkRecord({ canonicalRecordPath: file, record });
      if (result.failed_fault !== null) failure('work_record_target_publication_failed', 'Target publication did not settle', {
        publication_state: publicationStateFromCrashDurableResult(result), retry_safe: false });
      return { source_digest: computeWorkRecordSourceDigest(record) };
    },
    compensate: async () => {
      if (!attempted) return;
      const current = await loadWorkRecordById({ dir, id });
      if (current.source_digest === loaded.source_digest) return;
      if (current.source_digest !== computeWorkRecordSourceDigest(record)) failure('work_record_target_compensation_stale', 'Target compensation cannot replace unrelated changes');
      const result = await publishCanonicalWorkRecord({ canonicalRecordPath: file, record: previous, canonicalBytes: priorBytes });
      if (result.failed_fault !== null || !(await readFile(file)).equals(priorBytes)) {
        failure('work_record_target_compensation_failed', 'Exact prior target bytes were not restored');
      }
    }
  };
}
