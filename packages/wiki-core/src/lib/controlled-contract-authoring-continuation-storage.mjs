import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  unlink
} from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { processStartIdentity } from
  "./controlled-contract-carrier-set-publication.mjs";
import {
  AUTHORING_CONTINUATION_PATTERN,
  CONTROLLED_CONTRACT_MAX_JSON_BYTES,
  ControlledContractToolError,
  canonicalJsonBytes,
  deepFreezePlainData,
  fail,
  isPlainObject,
  resolveControlledContractRepository
} from "./controlled-contract-tool-shared.mjs";

const TRANSITION_SCHEMA = "controlled-contract-authoring-continuation-transition.v1";
const RUNTIME_DIRECTORY = ".agent-runs";
const STORE_DIRECTORY = "controlled-contract-authoring-continuations";
const STORE_VERSION_DIRECTORY = "v1";
const RECORD_SUFFIX = ".json";
const TRANSITION_SUFFIX = ".transition.json";
const LOCK_SUFFIX = ".lock";
const LOCK_SCHEMA = "controlled-contract-authoring-continuation-lock.v1";
let continuationPersistenceHook = null;

export function setControlledContractAuthoringContinuationStorageHookForTest(hook = null) {
  if (hook !== null && typeof hook !== "function") {
    throw new TypeError("continuation persistence hook must be a function or null");
  }
  continuationPersistenceHook = hook;
}

export async function continuationPersistenceBoundary(boundary, details = {}) {
  if (continuationPersistenceHook !== null) {
    await continuationPersistenceHook(boundary, Object.freeze(details));
  }
}

function continuationFailure(code, message, details = {}) {
  fail(`controlled_contract_authoring_continuation_${code}`, message, details);
}

function continuationHex(identity) {
  if (typeof identity !== "string" || !AUTHORING_CONTINUATION_PATTERN.test(identity)) {
    return null;
  }
  return identity.startsWith("sha256:") ? identity.slice(7) : identity;
}

async function ensureRealDirectory(parent, basename) {
  const directory = path.join(parent, basename);
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const entry = await lstat(directory);
  if (!entry.isDirectory() || entry.isSymbolicLink() || await realpath(directory) !== directory) {
    continuationFailure("persistence_failed",
      "durable continuation directory is not one repository-confined real directory", {
        cause_code: "STORE_DIRECTORY_INVALID"
      });
  }
  return directory;
}

async function continuationStore(repoRoot, { create = true } = {}) {
  const { repository } = await resolveControlledContractRepository(repoRoot);
  const runtime = path.join(repository, RUNTIME_DIRECTORY);
  if (!create) {
    try {
      const runtimeEntry = await lstat(runtime);
      if (!runtimeEntry.isDirectory() || runtimeEntry.isSymbolicLink() ||
          await realpath(runtime) !== runtime) {
        continuationFailure("persistence_failed",
          "durable continuation runtime root is not repository-confined");
      }
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }
  try {
    const runtimeRoot = create
      ? await ensureRealDirectory(repository, RUNTIME_DIRECTORY) : runtime;
    const store = create
      ? await ensureRealDirectory(runtimeRoot, STORE_DIRECTORY)
      : path.join(runtimeRoot, STORE_DIRECTORY);
    if (!create) {
      const entry = await lstat(store);
      if (!entry.isDirectory() || entry.isSymbolicLink() || await realpath(store) !== store) {
        continuationFailure("persistence_failed", "durable continuation store escaped");
      }
    }
    const version = create
      ? await ensureRealDirectory(store, STORE_VERSION_DIRECTORY)
      : path.join(store, STORE_VERSION_DIRECTORY);
    if (!create) {
      const entry = await lstat(version);
      if (!entry.isDirectory() || entry.isSymbolicLink() || await realpath(version) !== version) {
        continuationFailure("persistence_failed", "durable continuation version store escaped");
      }
    }
    return Object.freeze({ repository, directory: version });
  } catch (error) {
    if (!create && error?.code === "ENOENT") return null;
    if (error instanceof ControlledContractToolError) throw error;
    continuationFailure("persistence_failed", "durable continuation store is unavailable", {
      cause_code: error?.code ?? null
    });
  }
}

function recordPath(store, identity) {
  const hex = continuationHex(identity);
  return hex === null ? null : path.join(store.directory, `${hex}${RECORD_SUFFIX}`);
}

function transitionPath(store, identity) {
  const hex = continuationHex(identity);
  return hex === null ? null : path.join(store.directory, `${hex}${TRANSITION_SUFFIX}`);
}

async function readConfinedFile(filename, { missing = false } = {}) {
  try {
    const entry = await lstat(filename);
    if (!entry.isFile() || entry.isSymbolicLink() || await realpath(filename) !== filename) {
      continuationFailure("tampered", "durable continuation entry is not one real file");
    }
    const bytes = await readFile(filename);
    if (bytes.byteLength > CONTROLLED_CONTRACT_MAX_JSON_BYTES) {
      continuationFailure("tampered", "durable continuation entry exceeds its byte bound");
    }
    return bytes;
  } catch (error) {
    if (missing && error?.code === "ENOENT") return null;
    if (error instanceof ControlledContractToolError) throw error;
    continuationFailure("persistence_failed", "durable continuation entry is unreadable", {
      cause_code: error?.code ?? null
    });
  }
}

function parseDurableJson(bytes) {
  try {
    const value = JSON.parse(bytes.toString("utf8"));
    if (!isPlainObject(value)) throw new TypeError("record is not an object");
    return value;
  } catch (error) {
    continuationFailure("tampered", "durable continuation entry is malformed JSON", {
      cause_code: error?.code ?? null
    });
  }
}

function validLockRecord(value) {
  return isPlainObject(value) && value.schema_version === LOCK_SCHEMA &&
    typeof value.token === "string" && /^[0-9a-f-]{36}$/u.test(value.token) &&
    Number.isSafeInteger(value.process_id) && value.process_id > 0 &&
    typeof value.process_start_identity === "string" &&
    value.process_start_identity.length > 0;
}

async function cleanupOperationTemps(store, token) {
  const names = await readdir(store.directory);
  for (const name of names.filter((candidate) =>
    candidate.startsWith(".continuation-tmp-") && candidate.includes(token))) {
    await unlink(path.join(store.directory, name)).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

function sameLockOwner(left, right) {
  return left.token === right.token && left.process_id === right.process_id &&
    left.process_start_identity === right.process_start_identity;
}

async function acquireStoreLock(store, wkId) {
  const filename = path.join(store.directory, `${wkId}${LOCK_SUFFIX}`);
  const processStart = await processStartIdentity(process.pid).catch(() => null);
  if (processStart === null) continuationFailure("persistence_failed",
    "durable continuation lock cannot bind the current process");
  const record = {
    schema_version: LOCK_SCHEMA,
    token: randomUUID(),
    process_id: process.pid,
    process_start_identity: processStart
  };
  for (let attempt = 0; attempt < 500; attempt += 1) {
    try {
      const handle = await open(filename, "wx", 0o600);
      try {
        await handle.writeFile(canonicalJsonBytes(record));
        await handle.sync();
      } finally {
        await handle.close();
      }
      await continuationPersistenceBoundary("lock_acquired", {
        wk_id: wkId, contender_token: record.token
      });
      return Object.freeze({ filename, record: deepFreezePlainData(record) });
    } catch (error) {
      if (error?.code !== "EEXIST") continuationFailure("persistence_failed",
        "durable continuation lock could not be created", {
          cause_code: error?.code ?? null
        });
    }
    await continuationPersistenceBoundary("lock_contended", {
      wk_id: wkId, contender_token: record.token
    });
    const observedBytes = await readConfinedFile(filename, { missing: true });
    if (observedBytes === null) {
      await continuationPersistenceBoundary("contended_lock_disappeared", {
        wk_id: wkId, contender_token: record.token
      });
      continue;
    }
    const observed = parseDurableJson(observedBytes);
    if (!validLockRecord(observed)) continuationFailure("persistence_failed",
      "durable continuation lock owner is malformed");
    const observedStart = await processStartIdentity(observed.process_id).catch(() => null);
    if (observedStart === observed.process_start_identity) {
      await delay(10);
      continue;
    }
    await continuationPersistenceBoundary("stale_lock_observed", {
      wk_id: wkId, contender_token: record.token,
      observed_token: observed.token
    });
    const revalidatedBytes = await readConfinedFile(filename, { missing: true });
    if (revalidatedBytes === null) continue;
    const revalidated = parseDurableJson(revalidatedBytes);
    if (!validLockRecord(revalidated)) continuationFailure("persistence_failed",
      "durable continuation lock owner is malformed during reclamation");
    if (!sameLockOwner(observed, revalidated)) {
      await continuationPersistenceBoundary("stale_lock_replaced", {
        wk_id: wkId, contender_token: record.token,
        observed_token: observed.token, replacement_token: revalidated.token
      });
      continue;
    }
    const quarantine = `${filename}.stale-${observed.token}-${record.token}`;
    try {
      await rename(filename, quarantine);
      await cleanupOperationTemps(store, observed.token);
      await unlink(quarantine);
    } catch (error) {
      if (error?.code !== "ENOENT") continuationFailure("persistence_failed",
        "dead durable continuation lock cleanup failed", {
          cause_code: error?.code ?? null
        });
    }
  }
  continuationFailure("persistence_failed", "durable continuation lock acquisition timed out");
}

async function releaseStoreLock(locked) {
  const observed = parseDurableJson(await readConfinedFile(locked.filename));
  if (!validLockRecord(observed) || observed.token !== locked.record.token) {
    continuationFailure("persistence_failed", "durable continuation lock ownership changed");
  }
  try {
    await unlink(locked.filename);
  } catch (error) {
    continuationFailure("persistence_failed", "durable continuation lock release failed", {
      cause_code: error?.code ?? null
    });
  }
}

async function syncDirectory(directory) {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function atomicWrite(store, filename, value, token) {
  const bytes = canonicalJsonBytes(value);
  const temporary = path.join(store.directory,
    `.continuation-tmp-${token}-${randomUUID()}`);
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, filename);
    await syncDirectory(store.directory);
  } catch (error) {
    try {
      await unlink(temporary);
    } catch (cleanupError) {
      if (cleanupError?.code !== "ENOENT") continuationFailure("persistence_failed",
        "durable continuation temporary cleanup failed", {
          cause_code: cleanupError?.code ?? null
        });
    }
    if (error instanceof ControlledContractToolError) throw error;
    continuationFailure("persistence_failed", "durable continuation atomic write failed", {
      cause_code: error?.code ?? null
    });
  }
}

export function createControlledContractAuthoringContinuationStorage({
  authenticateRecord,
  sameJsonValue
}) {
  async function readRecordFile(filename, identity, { missing = false } = {}) {
    const bytes = await readConfinedFile(filename, { missing });
    return bytes === null ? null : authenticateRecord(parseDurableJson(bytes), identity);
  }

  async function storeInitialRecord(store, record, token) {
    const filename = recordPath(store, record.identity);
    const existing = await readRecordFile(filename, record.identity, { missing: true });
    if (existing !== null) {
      if (!sameJsonValue(existing, record)) continuationFailure("tampered",
        "an existing continuation identity resolves to different content");
      return existing;
    }
    await atomicWrite(store, filename, record, token);
    return readRecordFile(filename, record.identity);
  }

  async function readTransitionFile(filename, sourceIdentity, { missing = false } = {}) {
    const bytes = await readConfinedFile(filename, { missing });
    if (bytes === null) return null;
    const transition = parseDurableJson(bytes);
    if (transition.schema_version !== TRANSITION_SCHEMA ||
        transition.source_identity !== sourceIdentity ||
        !isPlainObject(transition.target_record) ||
        JSON.stringify(Object.keys(transition).sort()) !== JSON.stringify([
          "schema_version", "source_identity", "target_record"
        ].sort())) {
      continuationFailure("tampered", "durable continuation transition is malformed");
    }
    const target = await authenticateRecord(
      transition.target_record, transition.target_record.identity);
    return Object.freeze({ transition: deepFreezePlainData(transition), target });
  }

  async function findTransitionTarget(store, identity) {
    const names = (await readdir(store.directory)).filter((name) =>
      name.endsWith(TRANSITION_SUFFIX)).sort();
    for (const name of names) {
      const sourceHex = name.slice(0, -TRANSITION_SUFFIX.length);
      if (!/^[0-9a-f]{64}$/u.test(sourceHex)) continuationFailure("tampered",
        "durable continuation transition filename is invalid");
      const loaded = await readTransitionFile(
        path.join(store.directory, name), `sha256:${sourceHex}`);
      if (loaded.target.identity === identity) return loaded.target;
    }
    return null;
  }

  return Object.freeze({
    acquireStoreLock,
    atomicWrite,
    continuationStore,
    findTransitionTarget,
    readRecordFile,
    readTransitionFile,
    recordPath,
    releaseStoreLock,
    storeInitialRecord,
    transitionPath
  });
}

export async function clearControlledContractAuthoringContinuationStorage(input = null) {
  if (input === null || input?.repoRoot === undefined) return;
  const store = await continuationStore(input.repoRoot, { create: false });
  if (store === null) return;
  const entries = await readdir(store.directory, { withFileTypes: true });
  if (entries.some((entry) => entry.isSymbolicLink())) continuationFailure(
    "persistence_failed", "test cleanup refuses a symlinked continuation entry");
  await rm(path.join(store.repository, RUNTIME_DIRECTORY, STORE_DIRECTORY), {
    recursive: true,
    force: false
  });
}
