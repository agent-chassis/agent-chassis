

import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import {
  CRASH_DURABLE_EFFECTS,
  CRASH_DURABLE_LIVENESS,
  CRASH_DURABLE_LOCK_STATES,
  CRASH_DURABLE_RESULTS,
  classifyLockState,
  createAsyncEffects,
  decideRelease,
  decideRetirement,
  inspectLockPathAsync,
  planLockAcquisition,
  planReplacement,
  planRetirementClaim,
  planTombstoneCleanup,
  runCrashDurablePlanAsync
} from "../lib/crash-durable-state.mjs";
import {
  PROCESS_LIVENESS,
  assessProcessLiveness,
  captureProcessIdentity,
  formatProcessIdentity,
  parseProcessIdentity
} from "../lib/process-identity.mjs";
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
const WORK_RECORD_WRITE_LOCK_RETRY_DELAY_MS = 100;
const WORK_RECORD_WRITE_LOCK_RETRY_ATTEMPTS = 50;

export const WORK_RECORD_WRITE_LOCK_UNAVAILABLE_CODE = "work_record_write_lock_unavailable";

export const WORK_RECORD_WRITE_LOCK_IDENTITY_UNAVAILABLE_CODE =
  "work_record_write_lock_identity_unavailable";

const HELD_WORK_RECORD_WRITE_LOCKS = new AsyncLocalStorage();
const WORK_RECORD_READ_LEASES = new WeakMap();

const WORK_RECORD_READ_LEASE_MAX_DURATION_MS = 60_000;

function getWorkRecordWriteLockPath(targetDir) {
  return path.join(targetDir, "wiki", WORK_RECORD_WRITE_LOCK_FILE);
}

export function mintWorkRecordWriteLockToken(identity) {
  return [
    "wrl",
    identity.pid,
    identity.starttime,
    identity.boot_id,
    randomBytes(12).toString("hex")
  ].join(TOKEN_FIELD_SEPARATOR);
}

const TOKEN_FIELD_SEPARATOR = "~";

export function processIdentityFromWorkRecordWriteLockToken(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(TOKEN_FIELD_SEPARATOR);
  if (parts.length !== 5 || parts[0] !== "wrl") return null;
  return parseProcessIdentity(`proc.v1:pid=${parts[1]}:start=${parts[2]}:boot=${parts[3]}`);
}

function workRecordWriteLockIdentity(identity) {

  return formatProcessIdentity(identity);
}

function workRecordWriteLockIdentityUnavailableError(lockPath, cause) {
  const error = new Error(
    `Refusing to acquire the work-record write lock at ${lockPath}: this host ` +
    "cannot capture a non-reusable process identity (/proc is required), so a " +
    "later holder-death verdict could never be sound. The store will not fall " +
    `back to a reusable PID or a wall-clock lease. Underlying reason: ${cause}`
  );
  error.code = WORK_RECORD_WRITE_LOCK_IDENTITY_UNAVAILABLE_CODE;
  error.lock_path = lockPath;
  return error;
}

function workRecordWriteLockUnavailableError(lockPath, state, livenessReason = null) {
  const explanation = livenessReason === null
    ? "This store cannot prove the holder is dead and will not reclaim it"
    : `This store could not prove the holder is dead (${livenessReason}) and will not reclaim it`;
  const error = new Error(
    `Timed out waiting for work-record write lock at ${lockPath}. ` +
    `Observed lock state: ${state}. ${explanation}; ` +
    "operator action is required to remove the lock."
  );
  error.code = WORK_RECORD_WRITE_LOCK_UNAVAILABLE_CODE;
  error.lock_path = lockPath;
  error.lock_state = state;
  error.liveness_reason = livenessReason;
  return error;
}

async function observeWorkRecordWriteLockState(lockPath) {
  return classifyLockState(await inspectLockPathAsync(lockPath));
}

async function retireDeadWorkRecordWriteLockHolder(lockPath, contenderToken, effects) {
  const inspection = await inspectLockPathAsync(lockPath);
  if (classifyLockState(inspection) !== CRASH_DURABLE_LOCK_STATES.TOKEN_OWNED) {
    return { retired: false, reason: "lock is not token-owned" };
  }
  const observedIdentity = inspection.ownerEntry.owner_identity;
  const identity = parseProcessIdentity(observedIdentity);
  if (identity === null) {

    return { retired: false, reason: "persisted owner identity is not a non-reusable process identity" };
  }
  const verdict = assessProcessLiveness(identity);
  if (verdict.state !== PROCESS_LIVENESS.DEAD) {
    return { retired: false, reason: verdict.reason };
  }

  const decision = decideRetirement({
    inspection,
    contenderToken,
    liveness: CRASH_DURABLE_LIVENESS.DEAD,
    observedIdentity
  });
  if (!decision.retirable) return { retired: false, reason: decision.reason };
  return completeWorkRecordWriteLockRetirement(lockPath, contenderToken, effects, verdict.reason);
}

async function completeWorkRecordWriteLockRetirement(lockPath, contenderToken, effects, reason) {
  const tombstonePath = `${lockPath}.released-${contenderToken}`;
  const claimantMarkerPath = `${lockPath}.owner-released-${contenderToken}`;
  const claimed = await runCrashDurablePlanAsync(
    planRetirementClaim({
      canonicalPath: lockPath,
      claimantMarkerPath,
      tombstonePath,
      claimantToken: contenderToken
    }),
    effects
  );
  if (claimed.classification !== CRASH_DURABLE_RESULTS.RETIREMENT_CLAIMED) {

    return { retired: false, reason: "lost the retirement claim to a concurrent contender" };
  }
  await runCrashDurablePlanAsync(
    planTombstoneCleanup({ tombstonePath, claimantToken: contenderToken }),
    effects
  );
  await rm(claimantMarkerPath, { force: true });
  return { retired: true, reason };
}

async function transferCrashedWorkRecordWriteLockClaim(lockPath, contenderToken, effects) {
  const inspection = await inspectLockPathAsync(lockPath);
  if (classifyLockState(inspection) !== CRASH_DURABLE_LOCK_STATES.LEGACY_OWNERLESS_DIRECTORY) {
    return { retired: false, reason: "lock is not an interrupted retirement" };
  }
  const markerPrefix = `${path.basename(lockPath)}.owner-released-`;
  let siblings;
  try {
    siblings = await readdir(path.dirname(lockPath));
  } catch {
    return { retired: false, reason: "cannot enumerate retirement markers" };
  }
  for (const entry of siblings) {
    if (!entry.startsWith(markerPrefix)) continue;
    const claimantToken = entry.slice(markerPrefix.length);
    if (claimantToken === contenderToken) continue;
    const claimantIdentity = processIdentityFromWorkRecordWriteLockToken(claimantToken);
    if (claimantIdentity === null) {

      continue;
    }
    const verdict = assessProcessLiveness(claimantIdentity);
    if (verdict.state !== PROCESS_LIVENESS.DEAD) continue;

    const tombstonePath = `${lockPath}.released-${contenderToken}`;
    try {
      await rename(lockPath, tombstonePath);
    } catch {
      return { retired: false, reason: "lost the interrupted-retirement transfer to a concurrent contender" };
    }
    await runCrashDurablePlanAsync(
      planTombstoneCleanup({ tombstonePath, claimantToken: contenderToken }),
      effects
    );

    await rm(path.join(path.dirname(lockPath), entry), { force: true });
    return { retired: true, reason: `crashed retirement claimant is dead: ${verdict.reason}` };
  }
  return { retired: false, reason: "no authoritatively dead retirement claimant" };
}

async function withWorkRecordWriteLock(targetDir, callback, { reentrant = false } = {}) {
  const lockPath = getWorkRecordWriteLockPath(targetDir);
  if (reentrant && HELD_WORK_RECORD_WRITE_LOCKS.getStore()?.has(lockPath)) {
    return callback();
  }
  await ensureDirectory(path.dirname(lockPath));

  let selfIdentity;
  try {
    selfIdentity = captureProcessIdentity(process.pid);
  } catch (error) {
    throw workRecordWriteLockIdentityUnavailableError(lockPath, error?.message ?? String(error));
  }
  const token = mintWorkRecordWriteLockToken(selfIdentity);
  const identity = workRecordWriteLockIdentity(selfIdentity);
  const stagingPath = path.join(path.dirname(lockPath), `.${WORK_RECORD_WRITE_LOCK_FILE}.staging-${token}`);
  const effects = createAsyncEffects({});

  let acquired = false;
  let observedState = CRASH_DURABLE_LOCK_STATES.ABSENT;
  let livenessReason = null;
  for (let attempt = 0; attempt < WORK_RECORD_WRITE_LOCK_RETRY_ATTEMPTS; attempt += 1) {

    observedState = await observeWorkRecordWriteLockState(lockPath);
    if (observedState !== CRASH_DURABLE_LOCK_STATES.ABSENT) {

      const recovery = observedState === CRASH_DURABLE_LOCK_STATES.TOKEN_OWNED
        ? await retireDeadWorkRecordWriteLockHolder(lockPath, token, effects)
        : await transferCrashedWorkRecordWriteLockClaim(lockPath, token, effects);
      livenessReason = recovery.reason;
      if (recovery.retired) {

        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, WORK_RECORD_WRITE_LOCK_RETRY_DELAY_MS));
      continue;
    }
    const result = await runCrashDurablePlanAsync(
      planLockAcquisition({ canonicalPath: lockPath, stagingPath, ownerToken: token, ownerIdentity: identity }),
      effects
    );
    if (result.classification === CRASH_DURABLE_RESULTS.LOCK_ACQUIRED) {
      acquired = true;
      break;
    }

    observedState = await observeWorkRecordWriteLockState(lockPath);
    await new Promise((resolve) => setTimeout(resolve, WORK_RECORD_WRITE_LOCK_RETRY_DELAY_MS));
  }

  if (!acquired) {
    throw workRecordWriteLockUnavailableError(lockPath, observedState, livenessReason);
  }

  const heldHere = new Set(HELD_WORK_RECORD_WRITE_LOCKS.getStore() ?? []);
  heldHere.add(lockPath);
  try {
    return await HELD_WORK_RECORD_WRITE_LOCKS.run(heldHere, callback);
  } finally {
    await releaseWorkRecordWriteLock(lockPath, token, effects);
  }
}

async function releaseWorkRecordWriteLock(lockPath, token, effects) {
  const inspection = await inspectLockPathAsync(lockPath);
  if (!decideRelease({ inspection, token }).releasable) {

    return false;
  }
  const tombstonePath = `${lockPath}.released-${token}`;
  const claimed = await runCrashDurablePlanAsync(
    planRetirementClaim({
      canonicalPath: lockPath,
      claimantMarkerPath: `${lockPath}.owner-released-${token}`,
      tombstonePath,
      claimantToken: token
    }),
    effects
  );
  if (claimed.classification !== CRASH_DURABLE_RESULTS.RETIREMENT_CLAIMED) return false;
  await runCrashDurablePlanAsync(
    planTombstoneCleanup({ tombstonePath, claimantToken: token }),
    effects
  );
  await rm(`${lockPath}.owner-released-${token}`, { force: true });
  return true;
}

async function publishCanonicalWorkRecord({ canonicalRecordPath, record, canonicalReplace = rename }) {
  const bytes = `${JSON.stringify(record, null, 2)}\n`;
  const privatePath = path.join(
    path.dirname(canonicalRecordPath),
    `.${path.basename(canonicalRecordPath)}.publish-${process.pid}-${randomBytes(8).toString("hex")}`
  );

  const effects = {
    ...createAsyncEffects({ mode: 0o666 }),
    [CRASH_DURABLE_EFFECTS.PUBLISH_RENAME]: async (step) => {
      await canonicalReplace(step.privatePath, step.targetPath);
    }
  };
  const result = await runCrashDurablePlanAsync(
    planReplacement({ targetPath: canonicalRecordPath, privatePath, bytes }),
    effects
  );
  if (result.failed_fault !== null) {
    throw result.error ?? new Error("canonical work-record publication failed");
  }
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
  dir = ".", id, recordStore = null, maximumDurationMs = WORK_RECORD_READ_LEASE_MAX_DURATION_MS
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
    if (loaded.valid !== true || loaded.record_id !== id || !loaded.record ||
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

      if (!preservesReviewProvenance(currentLoaded.record, record)) {
        return {
          valid: false,
          written: false,
          diagnostics: [reviewProvenanceHistoryMutationDiagnostic(recordId)],
          record,
          source_digest: sourceDigest,
          canonical_record_path: canonicalRecordPath
        };
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
        await publishCanonicalWorkRecord({ canonicalRecordPath, record, canonicalReplace });
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

    await ensureDirectory(path.dirname(canonicalRecordPath));
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

      if (!preservesReviewProvenance(currentLoaded.record, record)) {
        return {
          status: "review_provenance_history_mutation"
        };
      }

      try {
        await publishCanonicalWorkRecord({ canonicalRecordPath, record });
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

    if (writeResult.status === "review_provenance_history_mutation") {
      return {
        valid: false,
        written: false,
        diagnostics: [reviewProvenanceHistoryMutationDiagnostic(recordId)],
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
