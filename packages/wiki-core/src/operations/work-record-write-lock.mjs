

import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import {
  CRASH_DURABLE_LIVENESS,
  CRASH_DURABLE_LOCK_STATES,
  CRASH_DURABLE_RESULTS,
  classifyLockState,
  createAsyncEffects,
  decideRelease,
  decideRetirement,
  inspectLockPathAsync,
  planLockAcquisition,
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
import { ensureDirectory } from "../lib/wiki-shared.mjs";

const WORK_RECORD_WRITE_LOCK_FILE = ".work-record-write.lock";
const WORK_RECORD_WRITE_LOCK_RETRY_DELAY_MS = 100;
const WORK_RECORD_WRITE_LOCK_RETRY_ATTEMPTS = 50;

export const WORK_RECORD_WRITE_LOCK_UNAVAILABLE_CODE = "work_record_write_lock_unavailable";

export const WORK_RECORD_WRITE_LOCK_IDENTITY_UNAVAILABLE_CODE =
  "work_record_write_lock_identity_unavailable";

const HELD_WORK_RECORD_WRITE_LOCKS = new AsyncLocalStorage();

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

export async function withWorkRecordWriteLock(targetDir, callback, {
  reentrant = false,
  settle = false,
  faultInjector = null
} = {}) {
  const lockPath = getWorkRecordWriteLockPath(targetDir);
  if (reentrant && HELD_WORK_RECORD_WRITE_LOCKS.getStore()?.has(lockPath)) {
    return callback();
  }
  try {
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
    const effects = createAsyncEffects({ faultInjector });

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
    let value;
    let callbackError = null;
    let releaseError = null;
    try {
      value = await HELD_WORK_RECORD_WRITE_LOCKS.run(heldHere, callback);
    } catch (error) {
      callbackError = error;
    }
    try {
      const released = await releaseWorkRecordWriteLock(lockPath, token, effects);
      if (settle && released !== true) {
        releaseError = new Error("work-record write lock release did not prove token ownership");
        releaseError.code = "work_record_write_lock_release_refused";
        releaseError.lock_path = lockPath;
      }
    } catch (error) {
      releaseError = error;
    }
    if (settle) {
      return { value, callback_error: callbackError, release_error: releaseError };
    }
    if (releaseError !== null) throw releaseError;
    if (callbackError !== null) throw callbackError;
    return value;
  } catch (error) {
    if (settle) return { acquisition_error: error, value: undefined, callback_error: null, release_error: null };
    throw error;
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
  if (claimed.failed_fault !== null) {
    const error = claimed.error instanceof Error
      ? claimed.error
      : new Error("work-record write lock release claim failed");
    error.failed_fault = claimed.failed_fault;
    error.effect_trace = claimed.trace;
    throw error;
  }
  if (claimed.classification !== CRASH_DURABLE_RESULTS.RETIREMENT_CLAIMED) return false;
  const cleaned = await runCrashDurablePlanAsync(
    planTombstoneCleanup({ tombstonePath, claimantToken: token }),
    effects
  );
  if (cleaned.failed_fault !== null) {
    const error = cleaned.error instanceof Error
      ? cleaned.error
      : new Error("work-record write lock tombstone cleanup failed");
    error.failed_fault = cleaned.failed_fault;
    error.effect_trace = cleaned.trace;
    throw error;
  }
  await rm(`${lockPath}.owner-released-${token}`, { force: true });
  return true;
}
