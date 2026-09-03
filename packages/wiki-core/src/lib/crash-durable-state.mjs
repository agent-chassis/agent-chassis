

import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync
} from "node:fs";
import { constants as fsConstants } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

export const CRASH_DURABLE_STATE_SCHEMA_VERSION = "crash-durable-state.v1";

export const CRASH_DURABLE_FAULTS = Object.freeze({
  PRIVATE_CREATED: "private_created",
  PARTIAL_BYTES_WRITTEN: "partial_bytes_written",
  COMPLETE_BYTES_WRITTEN: "complete_bytes_written",
  FILE_SYNCED: "file_synced",
  TARGET_PUBLISHED: "target_published",
  DIRECTORY_SYNCED: "directory_synced",
  LOCK_ACQUIRED: "lock_acquired",
  OWNER_ENTRY_RETIREMENT_CLAIMED: "owner_entry_retirement_claimed",
  CLAIMED_DIRECTORY_MOVED: "claimed_directory_moved",
  TOMBSTONE_CLEANED: "tombstone_cleaned"
});

export const CRASH_DURABLE_EFFECTS = Object.freeze({
  CREATE_PRIVATE_EXCLUSIVE: "create_private_exclusive",
  WRITE_BYTES: "write_bytes",
  SYNC_FILE: "sync_file",
  PUBLISH_RENAME: "publish_rename",
  SYNC_DIRECTORY: "sync_directory",
  DISCARD_PRIVATE: "discard_private",
  CREATE_DIRECTORY_EXCLUSIVE: "create_directory_exclusive",
  CLAIM_OWNER_ENTRY: "claim_owner_entry",
  MOVE_CLAIMED_DIRECTORY: "move_claimed_directory",
  REMOVE_TOMBSTONE: "remove_tombstone"
});

export const CRASH_DURABLE_RESULTS = Object.freeze({
  PUBLISHED: "published",
  PRIOR_PRESERVED: "prior_preserved",
  LOCK_ACQUIRED: "lock_acquired",
  LOCK_CONTENDED: "lock_contended",
  RETIREMENT_CLAIMED: "retirement_claimed",
  NOT_RETIRABLE: "not_retirable",
  TOMBSTONE_CLEANED: "tombstone_cleaned"
});

export const CRASH_DURABLE_LOCK_STATES = Object.freeze({
  ABSENT: "absent",
  TOKEN_OWNED: "token_owned",
  LEGACY_REGULAR_FILE: "legacy_regular_file",
  LEGACY_OWNERLESS_DIRECTORY: "legacy_ownerless_directory",
  MALFORMED: "malformed"
});

export const CRASH_DURABLE_LIVENESS = Object.freeze({
  LIVE: "live",
  DEAD: "dead",
  INDETERMINATE: "indeterminate"
});

export const OWNER_ENTRY_FILE = "owner.json";

class CrashDurableFaultError extends Error {
  constructor(fault, cause) {
    super(`crash-durable fault injected at ${fault}`);
    this.name = "CrashDurableFaultError";
    this.fault = fault;
    this.cause = cause ?? null;
  }
}

export { CrashDurableFaultError };

function step(effect, fault, args) {
  return Object.freeze({ effect, fault, ...args });
}

function plan(kind, steps, meta = {}) {
  return Object.freeze({
    schema_version: CRASH_DURABLE_STATE_SCHEMA_VERSION,
    kind,
    ...meta,
    steps: Object.freeze(steps)
  });
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

export function planReplacement({ targetPath, privatePath, bytes }) {
  assertNonEmptyString(targetPath, "targetPath");
  assertNonEmptyString(privatePath, "privatePath");
  if (typeof bytes !== "string") throw new Error("bytes must be a string");
  if (path.dirname(path.resolve(targetPath)) !== path.dirname(path.resolve(privatePath))) {

    throw new Error("the private path must be a sibling of the publication target");
  }
  return plan("replacement", [
    step(CRASH_DURABLE_EFFECTS.CREATE_PRIVATE_EXCLUSIVE, CRASH_DURABLE_FAULTS.PRIVATE_CREATED, { privatePath }),
    step(CRASH_DURABLE_EFFECTS.WRITE_BYTES, CRASH_DURABLE_FAULTS.PARTIAL_BYTES_WRITTEN, { privatePath, bytes, boundary: "partial" }),
    step(CRASH_DURABLE_EFFECTS.WRITE_BYTES, CRASH_DURABLE_FAULTS.COMPLETE_BYTES_WRITTEN, { privatePath, bytes, boundary: "complete" }),
    step(CRASH_DURABLE_EFFECTS.SYNC_FILE, CRASH_DURABLE_FAULTS.FILE_SYNCED, { privatePath }),
    step(CRASH_DURABLE_EFFECTS.PUBLISH_RENAME, CRASH_DURABLE_FAULTS.TARGET_PUBLISHED, { privatePath, targetPath }),
    step(CRASH_DURABLE_EFFECTS.SYNC_DIRECTORY, CRASH_DURABLE_FAULTS.DIRECTORY_SYNCED, { directory: path.dirname(targetPath) })
  ], { targetPath, privatePath });
}

export function planLogicalAppend({ targetPath, privatePath, priorBytes, appendedBytes }) {
  if (typeof priorBytes !== "string") throw new Error("priorBytes must be a string");
  if (typeof appendedBytes !== "string") throw new Error("appendedBytes must be a string");
  const composed = `${priorBytes}${appendedBytes}`;
  return plan("logical_append", planReplacement({ targetPath, privatePath, bytes: composed }).steps, {
    targetPath,
    privatePath,
    prior_byte_length: Buffer.byteLength(priorBytes, "utf8"),
    appended_byte_length: Buffer.byteLength(appendedBytes, "utf8")
  });
}

export function planLockAcquisition({ canonicalPath, stagingPath, ownerToken, ownerIdentity }) {
  assertNonEmptyString(canonicalPath, "canonicalPath");
  assertNonEmptyString(stagingPath, "stagingPath");
  assertNonEmptyString(ownerToken, "ownerToken");
  assertNonEmptyString(ownerIdentity, "ownerIdentity");
  const ownerBytes = `${JSON.stringify({
    schema_version: CRASH_DURABLE_STATE_SCHEMA_VERSION,
    owner_token: ownerToken,
    owner_identity: ownerIdentity
  })}\n`;
  return plan("lock_acquisition", [
    step(CRASH_DURABLE_EFFECTS.CREATE_DIRECTORY_EXCLUSIVE, CRASH_DURABLE_FAULTS.PRIVATE_CREATED, { directory: stagingPath }),
    step(CRASH_DURABLE_EFFECTS.CREATE_PRIVATE_EXCLUSIVE, CRASH_DURABLE_FAULTS.PRIVATE_CREATED, { privatePath: path.join(stagingPath, OWNER_ENTRY_FILE) }),
    step(CRASH_DURABLE_EFFECTS.WRITE_BYTES, CRASH_DURABLE_FAULTS.COMPLETE_BYTES_WRITTEN, { privatePath: path.join(stagingPath, OWNER_ENTRY_FILE), bytes: ownerBytes, boundary: "complete" }),
    step(CRASH_DURABLE_EFFECTS.SYNC_FILE, CRASH_DURABLE_FAULTS.FILE_SYNCED, { privatePath: path.join(stagingPath, OWNER_ENTRY_FILE) }),
    step(CRASH_DURABLE_EFFECTS.PUBLISH_RENAME, CRASH_DURABLE_FAULTS.LOCK_ACQUIRED, { privatePath: stagingPath, targetPath: canonicalPath }),
    step(CRASH_DURABLE_EFFECTS.SYNC_DIRECTORY, CRASH_DURABLE_FAULTS.DIRECTORY_SYNCED, { directory: path.dirname(canonicalPath) })
  ], { canonicalPath, privatePath: stagingPath, ownerToken });
}

export function planRetirementClaim({
  canonicalPath,
  claimantMarkerPath,
  tombstonePath,
  claimantToken
}) {
  assertNonEmptyString(canonicalPath, "canonicalPath");
  assertNonEmptyString(claimantMarkerPath, "claimantMarkerPath");
  assertNonEmptyString(tombstonePath, "tombstonePath");
  assertNonEmptyString(claimantToken, "claimantToken");
  if (!path.basename(tombstonePath).includes(claimantToken)) {

    throw new Error("the tombstone path must be bound to the claimant token");
  }
  return plan("retirement_claim", [
    step(CRASH_DURABLE_EFFECTS.CLAIM_OWNER_ENTRY, CRASH_DURABLE_FAULTS.OWNER_ENTRY_RETIREMENT_CLAIMED, {
      privatePath: path.join(canonicalPath, OWNER_ENTRY_FILE),
      targetPath: claimantMarkerPath
    }),
    step(CRASH_DURABLE_EFFECTS.MOVE_CLAIMED_DIRECTORY, CRASH_DURABLE_FAULTS.CLAIMED_DIRECTORY_MOVED, {
      privatePath: canonicalPath,
      targetPath: tombstonePath
    }),
    step(CRASH_DURABLE_EFFECTS.SYNC_DIRECTORY, CRASH_DURABLE_FAULTS.DIRECTORY_SYNCED, { directory: path.dirname(canonicalPath) })
  ], { canonicalPath, tombstonePath, claimantToken });
}

export function planTombstoneCleanup({ tombstonePath, claimantToken }) {
  assertNonEmptyString(tombstonePath, "tombstonePath");
  assertNonEmptyString(claimantToken, "claimantToken");
  if (!path.basename(tombstonePath).includes(claimantToken)) {
    throw new Error("cleanup may only address a tombstone bound to the caller's own token");
  }
  return plan("tombstone_cleanup", [
    step(CRASH_DURABLE_EFFECTS.REMOVE_TOMBSTONE, CRASH_DURABLE_FAULTS.TOMBSTONE_CLEANED, { tombstonePath })
  ], { tombstonePath, claimantToken });
}

export function compensationFor(activePlan, failedFault) {
  if (failedFault === null) return Object.freeze([]);
  const published =
    failedFault === CRASH_DURABLE_FAULTS.DIRECTORY_SYNCED ||
    failedFault === CRASH_DURABLE_FAULTS.CLAIMED_DIRECTORY_MOVED ||
    failedFault === CRASH_DURABLE_FAULTS.TOMBSTONE_CLEANED;
  if (published) return Object.freeze([]);
  if (activePlan.kind === "replacement" || activePlan.kind === "logical_append") {
    if (failedFault === CRASH_DURABLE_FAULTS.TARGET_PUBLISHED) {
      return Object.freeze([step(CRASH_DURABLE_EFFECTS.DISCARD_PRIVATE, null, { privatePath: activePlan.privatePath })]);
    }
    return Object.freeze([step(CRASH_DURABLE_EFFECTS.DISCARD_PRIVATE, null, { privatePath: activePlan.privatePath })]);
  }
  if (activePlan.kind === "lock_acquisition") {

    return Object.freeze([step(CRASH_DURABLE_EFFECTS.DISCARD_PRIVATE, null, { privatePath: activePlan.privatePath })]);
  }

  return Object.freeze([]);
}

export function classifyRun(activePlan, failedFault) {
  if (failedFault === null) {
    switch (activePlan.kind) {
      case "lock_acquisition": return CRASH_DURABLE_RESULTS.LOCK_ACQUIRED;
      case "retirement_claim": return CRASH_DURABLE_RESULTS.RETIREMENT_CLAIMED;
      case "tombstone_cleanup": return CRASH_DURABLE_RESULTS.TOMBSTONE_CLEANED;
      default: return CRASH_DURABLE_RESULTS.PUBLISHED;
    }
  }
  switch (activePlan.kind) {
    case "lock_acquisition": return CRASH_DURABLE_RESULTS.LOCK_CONTENDED;
    case "retirement_claim": return CRASH_DURABLE_RESULTS.NOT_RETIRABLE;

    default: return CRASH_DURABLE_RESULTS.PRIOR_PRESERVED;
  }
}

export function classifyLockState(inspection) {
  if (inspection === null || inspection === undefined) return CRASH_DURABLE_LOCK_STATES.ABSENT;
  if (inspection.exists === false) return CRASH_DURABLE_LOCK_STATES.ABSENT;
  if (inspection.kind === "file") return CRASH_DURABLE_LOCK_STATES.LEGACY_REGULAR_FILE;
  if (inspection.kind !== "directory") return CRASH_DURABLE_LOCK_STATES.MALFORMED;
  if (inspection.ownerEntry === null || inspection.ownerEntry === undefined) {
    return CRASH_DURABLE_LOCK_STATES.LEGACY_OWNERLESS_DIRECTORY;
  }
  const owner = inspection.ownerEntry;
  if (typeof owner.owner_token !== "string" || owner.owner_token.length === 0 ||
      typeof owner.owner_identity !== "string" || owner.owner_identity.length === 0) {
    return CRASH_DURABLE_LOCK_STATES.MALFORMED;
  }
  return CRASH_DURABLE_LOCK_STATES.TOKEN_OWNED;
}

export function decideRelease({ inspection, token }) {
  const state = classifyLockState(inspection);
  if (state !== CRASH_DURABLE_LOCK_STATES.TOKEN_OWNED) {
    return Object.freeze({ releasable: false, state, reason: "lock is not token-owned" });
  }
  if (inspection.ownerEntry.owner_token !== token) {
    return Object.freeze({ releasable: false, state, reason: "token mismatch" });
  }
  return Object.freeze({ releasable: true, state, reason: null });
}

export function decideRetirement({ inspection, contenderToken, liveness, observedIdentity = null }) {
  assertNonEmptyString(contenderToken, "contenderToken");
  const state = classifyLockState(inspection);
  const deny = (reason) => Object.freeze({ retirable: false, state, reason });
  if (state !== CRASH_DURABLE_LOCK_STATES.TOKEN_OWNED) return deny(`lock state ${state} is never retired`);
  const owner = inspection.ownerEntry;
  if (owner.owner_token === contenderToken) return deny("a token does not retire its own lock");
  if (observedIdentity !== null && observedIdentity !== owner.owner_identity) {

    return deny("persisted owner identity moved since it was judged");
  }
  if (liveness !== CRASH_DURABLE_LIVENESS.DEAD) {
    return deny(`liveness verdict ${liveness ?? "missing"} does not authorize reclamation`);
  }
  return Object.freeze({ retirable: true, state, reason: null });
}

function traceEntry(activeStep, outcome) {
  return Object.freeze({ effect: activeStep.effect, fault: activeStep.fault ?? null, outcome });
}

function runResult(activePlan, trace, failure) {
  const failedFault = failure === null ? null : failure.fault;
  return Object.freeze({
    schema_version: CRASH_DURABLE_STATE_SCHEMA_VERSION,
    kind: activePlan.kind,
    classification: classifyRun(activePlan, failedFault),
    failed_fault: failedFault,
    error: failure === null ? null : failure.error,
    trace: Object.freeze(trace)
  });
}

export function runCrashDurablePlanSync(activePlan, effects) {
  const trace = [];
  let failure = null;
  for (const activeStep of activePlan.steps) {
    try {
      effects[activeStep.effect](activeStep);
      trace.push(traceEntry(activeStep, "ok"));
    } catch (error) {
      trace.push(traceEntry(activeStep, "failed"));
      failure = { fault: activeStep.fault, error };
      break;
    }
  }
  if (failure !== null) {
    for (const compensation of compensationFor(activePlan, failure.fault)) {
      try {
        effects[compensation.effect](compensation);
        trace.push(traceEntry(compensation, "compensated"));
      } catch {
        trace.push(traceEntry(compensation, "compensation_failed"));
      }
    }
  }
  return runResult(activePlan, trace, failure);
}

export async function runCrashDurablePlanAsync(activePlan, effects) {
  const trace = [];
  let failure = null;
  for (const activeStep of activePlan.steps) {
    try {
      await effects[activeStep.effect](activeStep);
      trace.push(traceEntry(activeStep, "ok"));
    } catch (error) {
      trace.push(traceEntry(activeStep, "failed"));
      failure = { fault: activeStep.fault, error };
      break;
    }
  }
  if (failure !== null) {
    for (const compensation of compensationFor(activePlan, failure.fault)) {
      try {
        await effects[compensation.effect](compensation);
        trace.push(traceEntry(compensation, "compensated"));
      } catch {
        trace.push(traceEntry(compensation, "compensation_failed"));
      }
    }
  }
  return runResult(activePlan, trace, failure);
}

function inject(faultInjector, fault) {
  if (typeof faultInjector === "function" && fault !== null) faultInjector(fault);
}

export function createSyncEffects({ faultInjector = null, mode = 0o600 } = {}) {
  return Object.freeze({
    [CRASH_DURABLE_EFFECTS.CREATE_PRIVATE_EXCLUSIVE]: (s) => {
      inject(faultInjector, s.fault);
      closeSync(openSync(s.privatePath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, mode));
    },
    [CRASH_DURABLE_EFFECTS.WRITE_BYTES]: (s) => {
      inject(faultInjector, s.fault);
      if (s.boundary === "partial") return;
      const fd = openSync(s.privatePath, fsConstants.O_WRONLY | fsConstants.O_TRUNC, mode);
      try { writeSync(fd, s.bytes); } finally { closeSync(fd); }
    },
    [CRASH_DURABLE_EFFECTS.SYNC_FILE]: (s) => {
      inject(faultInjector, s.fault);
      const fd = openSync(s.privatePath, fsConstants.O_RDONLY);
      try { fsyncSync(fd); } finally { closeSync(fd); }
    },
    [CRASH_DURABLE_EFFECTS.PUBLISH_RENAME]: (s) => {
      inject(faultInjector, s.fault);
      renameSync(s.privatePath, s.targetPath);
    },
    [CRASH_DURABLE_EFFECTS.SYNC_DIRECTORY]: (s) => {
      inject(faultInjector, s.fault);
      const fd = openSync(s.directory, fsConstants.O_RDONLY);
      try { fsyncSync(fd); } finally { closeSync(fd); }
    },
    [CRASH_DURABLE_EFFECTS.DISCARD_PRIVATE]: (s) => {
      rmSync(s.privatePath, { recursive: true, force: true });
    },
    [CRASH_DURABLE_EFFECTS.CREATE_DIRECTORY_EXCLUSIVE]: (s) => {
      inject(faultInjector, s.fault);
      mkdirSync(s.directory, { mode: 0o700 });
    },
    [CRASH_DURABLE_EFFECTS.CLAIM_OWNER_ENTRY]: (s) => {
      inject(faultInjector, s.fault);
      renameSync(s.privatePath, s.targetPath);
    },
    [CRASH_DURABLE_EFFECTS.MOVE_CLAIMED_DIRECTORY]: (s) => {
      inject(faultInjector, s.fault);
      renameSync(s.privatePath, s.targetPath);
    },
    [CRASH_DURABLE_EFFECTS.REMOVE_TOMBSTONE]: (s) => {
      inject(faultInjector, s.fault);
      rmSync(s.tombstonePath, { recursive: true, force: true });
    }
  });
}

export function createAsyncEffects({ faultInjector = null, mode = 0o600 } = {}) {
  return Object.freeze({
    [CRASH_DURABLE_EFFECTS.CREATE_PRIVATE_EXCLUSIVE]: async (s) => {
      inject(faultInjector, s.fault);
      const handle = await open(s.privatePath, "wx", mode);
      await handle.close();
    },
    [CRASH_DURABLE_EFFECTS.WRITE_BYTES]: async (s) => {
      inject(faultInjector, s.fault);
      if (s.boundary === "partial") return;
      const handle = await open(s.privatePath, "w", mode);
      try { await handle.writeFile(s.bytes, "utf8"); } finally { await handle.close(); }
    },
    [CRASH_DURABLE_EFFECTS.SYNC_FILE]: async (s) => {
      inject(faultInjector, s.fault);
      const handle = await open(s.privatePath, "r");
      try { await handle.sync(); } finally { await handle.close(); }
    },
    [CRASH_DURABLE_EFFECTS.PUBLISH_RENAME]: async (s) => {
      inject(faultInjector, s.fault);
      await rename(s.privatePath, s.targetPath);
    },
    [CRASH_DURABLE_EFFECTS.SYNC_DIRECTORY]: async (s) => {
      inject(faultInjector, s.fault);
      const handle = await open(s.directory, "r");
      try { await handle.sync(); } finally { await handle.close(); }
    },
    [CRASH_DURABLE_EFFECTS.DISCARD_PRIVATE]: async (s) => {
      await rm(s.privatePath, { recursive: true, force: true });
    },
    [CRASH_DURABLE_EFFECTS.CREATE_DIRECTORY_EXCLUSIVE]: async (s) => {
      inject(faultInjector, s.fault);
      await mkdir(s.directory, { mode: 0o700 });
    },
    [CRASH_DURABLE_EFFECTS.CLAIM_OWNER_ENTRY]: async (s) => {
      inject(faultInjector, s.fault);
      await rename(s.privatePath, s.targetPath);
    },
    [CRASH_DURABLE_EFFECTS.MOVE_CLAIMED_DIRECTORY]: async (s) => {
      inject(faultInjector, s.fault);
      await rename(s.privatePath, s.targetPath);
    },
    [CRASH_DURABLE_EFFECTS.REMOVE_TOMBSTONE]: async (s) => {
      inject(faultInjector, s.fault);
      await rm(s.tombstonePath, { recursive: true, force: true });
    }
  });
}

export function inspectLockPathSync(canonicalPath) {
  let info;
  try {
    info = statSync(canonicalPath);
  } catch (error) {
    if (error?.code === "ENOENT") return Object.freeze({ exists: false, kind: null, ownerEntry: null });
    throw error;
  }
  if (!info.isDirectory()) return Object.freeze({ exists: true, kind: "file", ownerEntry: null });
  try {
    return Object.freeze({
      exists: true,
      kind: "directory",
      ownerEntry: JSON.parse(readFileSync(path.join(canonicalPath, OWNER_ENTRY_FILE), "utf8"))
    });
  } catch (error) {
    if (error?.code === "ENOENT") return Object.freeze({ exists: true, kind: "directory", ownerEntry: null });

    return Object.freeze({ exists: true, kind: "directory", ownerEntry: { malformed: true } });
  }
}

export async function inspectLockPathAsync(canonicalPath) {
  let info;
  try {
    info = await stat(canonicalPath);
  } catch (error) {
    if (error?.code === "ENOENT") return Object.freeze({ exists: false, kind: null, ownerEntry: null });
    throw error;
  }
  if (!info.isDirectory()) return Object.freeze({ exists: true, kind: "file", ownerEntry: null });
  try {
    return Object.freeze({
      exists: true,
      kind: "directory",
      ownerEntry: JSON.parse(await readFile(path.join(canonicalPath, OWNER_ENTRY_FILE), "utf8"))
    });
  } catch (error) {
    if (error?.code === "ENOENT") return Object.freeze({ exists: true, kind: "directory", ownerEntry: null });
    return Object.freeze({ exists: true, kind: "directory", ownerEntry: { malformed: true } });
  }
}
