import { rollbackGraphSidecarWrite } from "./work-records-graph-impact-sidecar-io.mjs";
import { publishWorkRecordAdmissionDerivedEvidenceSidecar } from "../lib/work-record-admission-derived-evidence-persist.mjs";

import { readPreparedGraphEvidenceContribution } from "./work-records-graph-impact.mjs";
import path from "node:path";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import { isObject } from "./work-records-shared.mjs";
import {
  canonicalizeWorkRecordJson,
  canonicalizeWorkRecordReadScope,
  computeWorkRecordSourceDigest,
  parseWorkRecordJson,
  validateWorkRecord
} from "../lib/work-record-schema.mjs";
import {
  captureCanonicalWorkRecordInventory,
  getWorkRecordPath,
  loadWorkRecordById,
  loadWorkRecordByPath
} from "../lib/work-record-store.mjs";
import { ensureDirectory } from "../lib/wiki-shared.mjs";
import { buildCreatedIssueWorkRecord } from "../lib/work-record-birth.mjs";
import { readPreparedProofPostureContribution } from "../lib/work-record-proof-posture.mjs";
import {
  ADMISSION_ARTIFACT_DIRECTORY,
  admissionArtifactReferenceUnavailableDiagnostic,
  classifyAdmissionArtifactBasename,
  collectRetainedAdmissionArtifactPaths
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
import {
  guardOrdinaryWorkRecordPublication,
  publishCanonicalWorkRecord,
  restoreCanonicalWorkRecordBytes,
  serializeCanonicalWorkRecord,
  settleOrdinaryWorkRecordPublication
} from "./work-record-publication.mjs";
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
const WORK_RECORD_BIRTH_LEASES = new WeakMap();

const WORK_RECORD_BIRTH_WRITES = new WeakMap();

const BIRTH_REPLACEMENT_REFUSALS = new WeakSet();

const WORK_RECORD_READ_LEASE_MAX_DURATION_MS = 60_000;

function birthFailure(code, message, details = {}, cause) {
  return Object.assign(new Error(message, cause === undefined ? undefined : { cause }), { code, details });
}

function freezeRecord(value) {
  if (value !== null && typeof value === "object") {
    for (const member of Object.values(value)) freezeRecord(member);
    Object.freeze(value);
  }
  return value;
}

async function assertBirthTargetAbsent(state) {
  try {
    await lstat(getWorkRecordPath(state.targetDir, state.id));
  } catch (cause) {
    if (cause.code === "ENOENT") return;
    throw birthFailure("canonical_work_record_birth_target_unavailable",
      "Canonical birth target cannot be inspected", { record_id: state.id, cause_code: cause.code }, cause);
  }
  throw birthFailure("canonical_work_record_birth_target_exists",
    "Canonical birth target already has a path entry", { record_id: state.id });
}

export function assertCanonicalWorkRecordBirthLease(lease, { dir, id, now = Date.now() } = {}) {
  const state = WORK_RECORD_BIRTH_LEASES.get(lease);
  if (!state?.active || !state.lockHeld) throw birthFailure("canonical_work_record_birth_lease_invalid",
    "Canonical work-record birth lease is missing, forged or released");
  if (typeof dir !== "string" || state.targetDir !== path.resolve(dir) || state.id !== id) {
    throw birthFailure("canonical_work_record_birth_lease_identity_mismatch", "Birth lease identity is mismatched");
  }
  if (!Number.isFinite(now) || now > state.expiresAt) throw birthFailure("canonical_work_record_birth_lease_expired",
    "Canonical work-record birth lease expired");
  return Object.freeze({ target_dir: state.targetDir, record_id: state.id,
    baseline_source_digest: state.baselineDigest, expires_at: new Date(state.expiresAt).toISOString() });
}

export async function readCanonicalWorkRecordBirthLease(lease, { dir, id } = {}) {
  const bound = assertCanonicalWorkRecordBirthLease(lease, { dir, id });
  const state = WORK_RECORD_BIRTH_LEASES.get(lease);
  await assertBirthTargetAbsent(state);
  return Object.freeze({ ...bound, record: freezeRecord(structuredClone(state.baseline)) });
}

export async function withCanonicalWorkRecordBirthLease({ dir, id, title, date, repo,
  maximumDurationMs = WORK_RECORD_READ_LEASE_MAX_DURATION_MS } = {}, callback) {
  if (typeof callback !== "function" || typeof id !== "string" || !/^WK-[0-9]{4}$/u.test(id) ||
      [dir, title, date, repo].some(value => typeof value !== "string" || value.trim() === "") ||
      !Number.isInteger(maximumDurationMs) || maximumDurationMs <= 0 ||
      maximumDurationMs > WORK_RECORD_READ_LEASE_MAX_DURATION_MS) {
    throw birthFailure("canonical_work_record_birth_lease_input_invalid", "Birth lease input is invalid");
  }
  const targetDir = path.resolve(dir);
  return withWorkRecordWriteLock(targetDir, async () => {
    const baseline = freezeRecord(canonicalizeWorkRecordReadScope(buildCreatedIssueWorkRecord({ id, title, date, repo })));
    const validated = await validateWorkRecordCandidate({ targetDir, record: baseline });
    if (validated.refusal) throw birthFailure("canonical_work_record_birth_lease_input_invalid",
      "Pristine birth record is invalid", { diagnostics: validated.refusal.diagnostics });
    const state = { targetDir, id, baseline, baselineDigest: validated.sourceDigest,
      active: true, lockHeld: true, expiresAt: Date.now() + maximumDurationMs };
    await assertBirthTargetAbsent(state);
    const lease = Object.freeze(Object.create(null));
    WORK_RECORD_BIRTH_LEASES.set(lease, state);
    try {
      return await callback(Object.freeze({ lease, record: structuredClone(baseline),
        baseline_source_digest: state.baselineDigest, canonical_record_path: getWorkRecordPath(targetDir, id) }));
    } finally {
      state.active = false;
      state.lockHeld = false;
    }
  });
}

async function loadBirthPublicationBaseline(state) {
  if (!state.lockHeld) throw birthFailure("canonical_work_record_birth_lease_invalid", "Birth lock was released");
  const now = Date.now();
  if (!Number.isFinite(now) || now > state.expiresAt) {
    throw birthFailure("canonical_work_record_birth_lease_expired", "Birth lease expired");
  }
  await assertBirthTargetAbsent(state);
  return { record: state.baseline, source_digest: null };
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
      lockHeld: true,
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
      state.lockHeld = false;
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

function retainedHistoryMutationDiagnostic(persistedRecord, proposedRecord, recordId) {
  if (!preservesReviewProvenance(persistedRecord, proposedRecord)) {
    return reviewProvenanceHistoryMutationDiagnostic(recordId);
  }
  if (!preservesWorkRecordEntryHistory(persistedRecord, proposedRecord)) {
    return entryHistoryMutationDiagnostic(recordId);
  }
  return null;
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

async function restoreBirthAdmissionArtifact(targetDir, publication) {
  const absolutePath = path.resolve(targetDir, publication.relativePath);
  try { await lstat(absolutePath); } catch (error) { if (error.code === "ENOENT") return; throw error; }
  const restored = await rollbackGraphSidecarWrite({ absolutePath, existedBefore: false,
    priorText: null, expectedText: publication.bytes });
  if (!restored.rolledBack) throw birthFailure("work_record_birth_admission_compensation_failed",
    "Birth admission artifact could not be restored without changing foreign bytes", { diagnostic: restored.diagnostic });
}

export async function writeValidatedWorkRecordWithAdmissionSidecars(options = {}) {
  const birth = WORK_RECORD_BIRTH_WRITES.get(options.record);
  if (birth) {
    const targetDir = path.resolve(String(options.dir));
    if (birth.targetDir !== targetDir || birth.id !== options.record.id) throw birthFailure(
      "canonical_work_record_birth_lease_identity_mismatch", "Birth publication identity is mismatched");
    const effects = options.persistenceEffects ?? {};
    const loadRecord = effects.loadRecordByPath ?? loadWorkRecordByPath;
    const replace = options.canonicalReplace ?? rename;
    const publish = effects.publishAdmissionSidecar ?? publishWorkRecordAdmissionDerivedEvidenceSidecar;
    options = { ...options, expectedSourceDigest: birth.baselineDigest,
      canonicalReplace: async (from, to) => {
        try { await loadBirthPublicationBaseline(birth); }
        catch (error) { BIRTH_REPLACEMENT_REFUSALS.add(error); throw error; }
        return replace(from, to);
      },
      persistenceEffects: { ...effects,
        loadRecordByPath: async request => request.path === getWorkRecordPath(targetDir, birth.id)
          ? { ...await loadBirthPublicationBaseline(birth), source_digest: birth.baselineDigest }
          : loadRecord(request),
        publishAdmissionSidecar: async request => {
          await loadBirthPublicationBaseline(birth);
          const file = path.resolve(targetDir, request.publication.relativePath);
          try { await lstat(file); }
          catch (error) { if (error.code !== "ENOENT") throw error;
            const result = await publish(request);
            if (result.ok !== true || result.created === true) return result;
            throw birthFailure("work_record_birth_evidence_collision", "Birth evidence destination appeared before publication");
          }
          throw birthFailure("work_record_birth_evidence_collision", "Birth evidence destination already exists");
        },
        removeAdmissionArtifact: async file => {
          const owned = options.admissionSidecars.find(value => path.resolve(targetDir, value.relativePath) === file);
          if (!owned) throw birthFailure("work_record_birth_evidence_identity_mismatch", "Rollback named an unowned artifact");
          await restoreBirthAdmissionArtifact(targetDir, owned);
        }
      } };
  }
  return runValidatedWorkRecordAdmissionTransaction(options, {
    canonicalReplaceNotAttempted: error => BIRTH_REPLACEMENT_REFUSALS.has(error),
    maintainRecordOwnedAdmissionArtifacts,
    computeWorkRecordPersistenceSnapshotDigest,
    createStoreDiagnostic,
    retainedHistoryMutationDiagnostic,
    validateWorkRecordEntryIntegrity,
    publishCanonicalWorkRecord,
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

async function validateWorkRecordCandidate({ targetDir, record }) {
  if (!isObject(record)) {
    return { refusal: {
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
    } };
  }

  const recordId = typeof record.id === "string" ? record.id : null;
  const canonicalRecordPath = recordId ? getWorkRecordPath(targetDir, recordId) : null;
  const obsoleteInput = obsoleteDocsInputDiagnostic(record);
  if (obsoleteInput) {
    return { refusal: inputContractRefusal({
      record,
      sourceDigest: null,
      canonicalRecordPath,
      diagnostic: obsoleteInput
    }) };
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
    return { refusal: {
      valid: false,
      written: false,
      diagnostics,
      diagnostic_count: diagnostics.length,
      record,
      source_digest: sourceDigest,
      canonical_record_path: canonicalRecordPath
    } };
  }
  return { recordId, canonicalRecordPath, sourceDigest, diagnostics };
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
  const birth = WORK_RECORD_BIRTH_WRITES.get(record);
  if (birth && (birth.targetDir !== targetDir || birth.id !== record.id)) {
    throw birthFailure("canonical_work_record_birth_lease_identity_mismatch", "Birth publication identity is mismatched");
  }
  const birthLoadRecord = birth ? () => loadBirthPublicationBaseline(birth) : null;
  let birthFenceRefusedBeforeReplace = false;
  const publishReplace = birth ? async (from, to) => {
    try {
      await loadBirthPublicationBaseline(birth);
    } catch (error) {
      birthFenceRefusedBeforeReplace = true;
      throw error;
    }
    return canonicalReplace(from, to);
  } : canonicalReplace;
  const validated = await validateWorkRecordCandidate({ targetDir, record });
  if (validated.refusal) return validated.refusal;
  const { recordId, canonicalRecordPath, sourceDigest, diagnostics } = validated;

  let currentLoadedBeforeWrite;
  try {
    const loadRecord = birthLoadRecord ?? persistenceEffects.loadRecordByPath ?? loadWorkRecordByPath;
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
  const loadRecord = birthLoadRecord ?? persistenceEffects.loadRecordByPath ?? loadWorkRecordByPath;
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
      const settleUnderLock = () => settleOrdinaryWorkRecordPublication({
        targetDir,
        canonicalRecordPath,
        record,
        recordId,
        recordStore,
        guardSourceDigest,
        canonicalReplace: publishReplace,
        canonicalFaultInjector,
        loadRecord,
        retainedHistoryMutationDiagnostic
      });
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
      } else if (lockOutcome.value.status === "retained_history_mutation") {
        result = {
          valid: false,
          ...persistenceOutcomeFields(WORK_RECORD_PUBLICATION_STATES.NOT_PUBLISHED),
          diagnostics: [lockOutcome.value.diagnostic],
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
          const publicationState = birthFenceRefusedBeforeReplace
            ? WORK_RECORD_PUBLICATION_STATES.NOT_PUBLISHED
            : publicationStateFromCrashDurableResult(publication);
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

  record = structuredClone(record);
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

  const retainedHistoryMutation = retainedHistoryMutationDiagnostic(loaded.record, record, id);
  if (retainedHistoryMutation) failure(retainedHistoryMutation.code, retainedHistoryMutation.message);
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
      await restorePreparedWorkRecordBytes({ lease, file, priorBytes, record });
    }
  };
}

async function restorePreparedWorkRecordBytes({ lease, file, priorBytes, record }) {
  const state = WORK_RECORD_READ_LEASES.get(lease) ?? WORK_RECORD_BIRTH_LEASES.get(lease);
  if (state?.lockHeld !== true) {
    const error = new Error("canonical work-record read lease no longer holds its lock");
    error.code = WORK_RECORD_BIRTH_LEASES.has(lease)
      ? "canonical_work_record_birth_lease_invalid" : "canonical_work_record_read_lease_invalid";
    throw error;
  }
  return restoreCanonicalWorkRecordBytes({ canonicalRecordPath: file, priorBytes,
    publishedBytes: Buffer.from(serializeCanonicalWorkRecord(record), "utf8") });
}

const WORK_RECORD_SETTLEMENT_MANAGED_FIELDS = Object.freeze(
  ["id", "repo", "proof_posture", "derived_evidence", "projections"]);

export async function prepareValidatedWorkRecordSettlement({
  dir, id, record, lease, canonicalReplace = rename, persistenceEffects = {},
  proofPosturePreparation = null, graphEvidenceContribution = null
}) {
  const failure = (code, message, details = {}) => {
    const error = new Error(message); error.code = code; error.details = details; throw error;
  };
  const birth = WORK_RECORD_BIRTH_LEASES.get(lease);
  const assertLease = birth ? assertCanonicalWorkRecordBirthLease : assertCanonicalWorkRecordReadLease;
  const bound = assertLease(lease, { dir, id });
  const sourceDigest = birth ? bound.baseline_source_digest : bound.source_digest;
  const targetDir = path.resolve(String(dir));
  const file = getWorkRecordPath(targetDir, id);
  const candidate = freezeRecord(structuredClone(record));
  const validated = await validateWorkRecordCandidate({ targetDir, record: candidate });
  if (validated.refusal) {
    const diagnostics = validated.refusal.diagnostics;
    const first = diagnostics.find((entry) => entry.severity === "error") ?? diagnostics[0];
    failure(first.code, first.message, { changed: false, diagnostics });
  }
  if (birth) await assertBirthTargetAbsent(birth);
  const priorBytes = birth ? null : await readFile(file);
  const parsed = birth ? { ok: true, value: birth.baseline }
    : parseWorkRecordJson(priorBytes.toString("utf8"), { sourcePath: file });
  if (!parsed.ok || computeWorkRecordSourceDigest(parsed.value) !== sourceDigest) {
    failure("work_record_settlement_source_stale", "Work-record source moved under its lease",
      { changed: false });
  }

  const contribution = readPreparedProofPostureContribution(proofPosturePreparation,
    { recordId: id, sourceDigest });
  const holdsPosture = (captured, value) =>
    captured.present === Object.hasOwn(value, "proof_posture") &&
    sameCanonicalValue(captured.value, value.proof_posture ?? null);
  const ownerPosture = contribution !== null && contribution.prepared.present &&
    holdsPosture(contribution.prior, parsed.value) && holdsPosture(contribution.prepared, candidate);
  const graph = readPreparedGraphEvidenceContribution(graphEvidenceContribution,
    { recordId: id, sourceDigest, dir: targetDir, recordLease: birth ? lease : null });
  const ownerGraph = graph !== null && sameCanonicalValue(graph.prior, parsed.value.derived_evidence ?? null) &&
    sameCanonicalValue(graph.prepared, candidate.derived_evidence ?? null) &&
    graph.candidateDigest === computeWorkRecordSourceDigest(candidate);
  const members = WORK_RECORD_SETTLEMENT_MANAGED_FIELDS.filter((member) =>
    !(ownerPosture && member === "proof_posture") &&
    !(ownerGraph && member === "derived_evidence") &&
    (Object.hasOwn(parsed.value, member) !== Object.hasOwn(candidate, member) ||
      !sameCanonicalValue(parsed.value[member] ?? null, candidate[member] ?? null)));
  if (members.length > 0) {
    failure("work_record_settlement_managed_field_mutation",
      `A prepared settlement cannot change store-managed members: ${members.join(", ")}`,
      { changed: false, members });
  }
  const guardRecord = structuredClone(candidate);
  if (ownerGraph) {
    const pending = [guardRecord];
    while (pending.length > 0) {
      const value = pending.pop();
      if (value === null || typeof value !== "object") continue;
      for (const key of Object.keys(value)) {
        if (value[key] === graph.admissionSidecarPublication.relativePath) value[key] = null;
        else if (typeof value[key] === "object") pending.push(value[key]);
      }
    }
  }
  const guard = await guardOrdinaryWorkRecordPublication({ targetDir, canonicalRecordPath: file,
    record: guardRecord, recordId: id, recordStore: null, guardSourceDigest: birth ? null : sourceDigest,
    loadRecord: birth ? () => loadBirthPublicationBaseline(birth) : loadWorkRecordByPath,
    retainedHistoryMutationDiagnostic });
  if (guard.status === "stale") {
    failure("work_record_settlement_source_stale", "Work-record source moved under its lease",
      { changed: false });
  }
  if (guard.status !== "clear") {
    const diagnostic = guard.diagnostic ??
      admissionArtifactReferenceUnavailableDiagnostic(id, guard.unavailableReferences);
    failure(diagnostic.code, diagnostic.message, { changed: false, diagnostics: [diagnostic] });
  }

  if (computeWorkRecordPersistenceSnapshotDigest(parsed.value) !==
      computeWorkRecordPersistenceSnapshotDigest(guard.currentLoaded.record)) {
    failure("work_record_settlement_capture_inconsistent",
      "Captured work-record bytes and the loaded record are different generations", { changed: false });
  }
  const noOp = !birth && sameCanonicalValue(parsed.value, candidate);
  let used = false;
  let published = false;
  let admissionPublications = [];
  return {
    commit: async () => {
      if (used) failure("work_record_settlement_handle_consumed", "A prepared settlement commits once");
      if (birth) {
        used = true;
        try { assertLease(lease, { dir, id }); } finally { birth.active = false; }
      } else assertLease(lease, { dir, id });
      used = true;
      if (birth) await loadBirthPublicationBaseline(birth);
      else if (!(await readFile(file)).equals(priorBytes)) {
        failure("work_record_settlement_source_stale", "Work-record bytes changed before publication",
          { changed: false });
      }
      if (!birth) WORK_RECORD_READ_LEASES.get(lease).active = false;
      if (noOp) {
        return { ok: true, no_op: true, written: false, source_digest: bound.source_digest };
      }
      let result;
      try {
        if (birth) WORK_RECORD_BIRTH_WRITES.set(candidate, birth);
        const write = ownerGraph ? writeValidatedWorkRecordWithAdmissionSidecars : writeValidatedWorkRecord;
        result = await write({ dir: targetDir, record: candidate,
          ...(ownerGraph ? { admissionSidecars: [graph.admissionSidecarPublication],
            expectedPersistenceSnapshotDigest: computeWorkRecordPersistenceSnapshotDigest(parsed.value) } : {}),
          expectedSourceDigest: birth ? null : sourceDigest, canonicalReplace, persistenceEffects,
          lockAlreadyHeld: true });
      } catch (error) {
        published = true;
        throw error;
      } finally {
        if (birth) WORK_RECORD_BIRTH_WRITES.delete(candidate);
      }
      admissionPublications = result.admission_sidecar_publications ?? [];

      const publicationState = Object.hasOwn(result, "publication_state")
        ? result.publication_state : WORK_RECORD_PUBLICATION_STATES.NOT_PUBLISHED;
      published = publicationState !== WORK_RECORD_PUBLICATION_STATES.NOT_PUBLISHED;
      if (result.ok !== true) {
        const diagnostics = result.diagnostics ?? [];
        const errors = diagnostics.filter((entry) => entry.severity === "error");

        if (publicationState === WORK_RECORD_PUBLICATION_STATES.PUBLISHED && result.written === true &&
            errors.length > 0 && errors.every((entry) => entry.code === "work_record_write_failed" &&
              entry.phase === WORK_RECORD_PERSISTENCE_PHASES.CLEANUP &&
              entry.publication_state === WORK_RECORD_PUBLICATION_STATES.PUBLISHED)) return result;
        const first = errors[0] ?? diagnostics[0];
        failure(first?.code ?? "work_record_write_failed",
          first?.message ?? "Work-record settlement did not publish", {
            publication_state: publicationState, diagnostics, persistence: result });
      }
      return result;
    },
    compensate: async () => {
      if (!published) return;
      await restorePreparedWorkRecordBytes({ lease, file, priorBytes, record: candidate });
      if (birth && ownerGraph && admissionPublications.some(value => value.created === true)) {
        await restoreBirthAdmissionArtifact(targetDir, graph.admissionSidecarPublication);
      }
    }
  };
}
