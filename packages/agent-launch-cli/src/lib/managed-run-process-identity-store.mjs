

import path from "node:path";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync
} from "node:fs";

import {
  assertKillShape,
  captureProcessIdentity,
  defaultLivenessDeps,
  readSystemMonotonic
} from "./worktree-lease.mjs";

import {
  MANAGED_RUN_PROCESS_IDENTITY_CODES,
  MANAGED_RUN_PROCESS_IDENTITY_SCHEMA_VERSION,
  MANAGED_RUN_PROCESS_IDENTITY_STATES,
  MANAGED_RUN_PROCESS_IDENTITY_VERDICTS,
  RETIREMENT_REASON_VALUES,
  fail,
  hasExactKeys,
  isPlainObject,
  normalizeManagedRunIdentityTuple,
  sameTuple
} from "./managed-run-process-identity-contract.mjs";

export function managedRunProcessIdentityStoreDir(mainRepo) {
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo)) {
    fail(
      MANAGED_RUN_PROCESS_IDENTITY_CODES.INVALID_ARG,
      `mainRepo must be an absolute path, got: ${JSON.stringify(mainRepo)}`
    );
  }
  return path.join(mainRepo, ".agent-launch", "managed-run-identity");
}

export function managedRunProcessIdentityFilePath(mainRepo, tuple) {
  const normalized = normalizeManagedRunIdentityTuple(tuple);
  const key = JSON.stringify([
    MANAGED_RUN_PROCESS_IDENTITY_SCHEMA_VERSION,
    normalized.assigned_unit,
    normalized.launch_ref,
    normalized.run_id,
    normalized.retry_id
  ]);
  const digest = createHash("sha256").update(key).digest("hex");
  return path.join(managedRunProcessIdentityStoreDir(mainRepo), `identity-${digest}.json`);
}

const PENDING_BRAND = Symbol("managed-run-process-identity.PendingPublication");

class PendingManagedRunIdentityPublication {
  constructor(brand, { mainRepo, tuple, filePath, record }) {
    if (brand !== PENDING_BRAND) {
      fail(
        MANAGED_RUN_PROCESS_IDENTITY_CODES.INVALID_ARG,
        "PendingManagedRunIdentityPublication is not externally constructible"
      );
    }
    this.mainRepo = mainRepo;
    this.tuple = tuple;
    this.filePath = filePath;
    this.record = record;
    Object.freeze(this);
  }
}

export function serializeRecord(record) {
  return `${JSON.stringify(record, null, 2)}\n`;
}

export function writeExclusive(filePath, contents) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  let fd;
  try {
    fd = openSync(filePath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
  } catch (err) {
    if (err && err.code === "EEXIST") {
      fail(
        MANAGED_RUN_PROCESS_IDENTITY_CODES.STORE_COLLISION,
        `a managed-run identity record already exists for this exact tuple: ${filePath}`,
        { errno: err.code },
        err
      );
    }
    fail(
      MANAGED_RUN_PROCESS_IDENTITY_CODES.STORE_WRITE_FAILED,
      `failed to create the managed-run identity record: ${filePath}`,
      { errno: err?.code ?? null },
      err
    );
  }
  try {
    writeSync(fd, contents);
  } catch (err) {
    try { closeSync(fd); } catch {   }
    try { unlinkSync(filePath); } catch {   }
    fail(
      MANAGED_RUN_PROCESS_IDENTITY_CODES.STORE_WRITE_FAILED,
      `failed to write the managed-run identity record: ${filePath}`,
      { errno: err?.code ?? null },
      err
    );
  }
  try { closeSync(fd); } catch {   }
}

export function replaceAtomically(filePath, contents) {
  const temp = `${filePath}.publish-${process.pid}.tmp`;
  let fd;
  try {
    fd = openSync(temp, fsConstants.O_CREAT | fsConstants.O_TRUNC | fsConstants.O_WRONLY, 0o600);
    writeSync(fd, contents);
    closeSync(fd);
    fd = null;

    renameSync(temp, filePath);
  } catch (err) {
    if (fd !== null) { try { closeSync(fd); } catch {   } }
    try { unlinkSync(temp); } catch {   }
    fail(
      MANAGED_RUN_PROCESS_IDENTITY_CODES.STORE_WRITE_FAILED,
      `failed to atomically complete the managed-run identity record: ${filePath}`,
      { errno: err?.code ?? null },
      err
    );
  }
}

export function publishPendingManagedRunProcessIdentity({
  mainRepo,
  tuple,
  role,
  deps = defaultLivenessDeps
} = {}) {
  const normalized = normalizeManagedRunIdentityTuple(tuple);
  if (typeof role !== "string" || role.length === 0) {
    fail(MANAGED_RUN_PROCESS_IDENTITY_CODES.INVALID_ARG, "role must be a non-empty string");
  }
  let launcherIdentity;
  let publishedAt;
  try {
    launcherIdentity = captureProcessIdentity(process.pid, deps);
    publishedAt = readSystemMonotonic(deps);
  } catch (error) {
    fail(
      MANAGED_RUN_PROCESS_IDENTITY_CODES.IDENTITY_CAPTURE_FAILED,
      "cannot capture the launcher's own non-reusable identity; refusing to publish (fail closed)",
      { source_code: error?.code ?? null },
      error
    );
  }
  const filePath = managedRunProcessIdentityFilePath(mainRepo, normalized);
  const record = {
    schema_version: MANAGED_RUN_PROCESS_IDENTITY_SCHEMA_VERSION,
    state: MANAGED_RUN_PROCESS_IDENTITY_STATES.PENDING,
    role,
    tuple: { ...normalized },
    launcher_identity: {
      pid: launcherIdentity.pid,
      starttime: launcherIdentity.starttime,
      boot_id: launcherIdentity.boot_id
    },
    published_at: { uptime: publishedAt.uptime, boot_id: publishedAt.boot_id },
    sandbox_identity: null,
    kill_shape: null,
    retirement: null
  };
  writeExclusive(filePath, serializeRecord(record));
  return new PendingManagedRunIdentityPublication(PENDING_BRAND, {
    mainRepo,
    tuple: normalized,
    filePath,
    record: Object.freeze(record)
  });
}

export function bindManagedRunSandboxProcessIdentity(pending, { pid, killShape, deps = defaultLivenessDeps } = {}) {
  if (!(pending instanceof PendingManagedRunIdentityPublication)) {
    fail(
      MANAGED_RUN_PROCESS_IDENTITY_CODES.TOKEN_ORDER_VIOLATION,
      "binding the outer sandbox identity requires the token minted by the pending publication " +
      "(fixed order: publish pending -> spawn -> bind outer identity -> accept)"
    );
  }
  {
    if (!Number.isInteger(pid) || pid <= 0) {
      fail(
        MANAGED_RUN_PROCESS_IDENTITY_CODES.PUBLICATION_INCOMPLETE,
        `the accepted launch reported no usable outer sandbox pid, got: ${JSON.stringify(pid)}`
      );
    }
    assertKillShape(killShape);
    if (killShape.kind !== "process-group" && killShape.pid !== pid) {
      fail(
        MANAGED_RUN_PROCESS_IDENTITY_CODES.BINDING_MISMATCH,
        "the recorded kill shape does not address the exact outer sandbox pid",
        { kill_shape_pid: killShape.pid ?? null, outer_pid: pid }
      );
    }
    const sandboxIdentity = captureProcessIdentity(pid, deps);
    if (sandboxIdentity.boot_id !== pending.record.launcher_identity.boot_id) {

      fail(
        MANAGED_RUN_PROCESS_IDENTITY_CODES.BINDING_MISMATCH,
        "the outer sandbox boot_id disagrees with the launcher boot_id"
      );
    }
    const record = {
      ...pending.record,
      state: MANAGED_RUN_PROCESS_IDENTITY_STATES.BOUND,
      sandbox_identity: {
        pid: sandboxIdentity.pid,
        starttime: sandboxIdentity.starttime,
        boot_id: sandboxIdentity.boot_id
      },
      kill_shape: { ...killShape }
    };
    replaceAtomically(pending.filePath, serializeRecord(record));

    const readBack = readManagedRunProcessIdentity({ mainRepo: pending.mainRepo, tuple: pending.tuple });
    if (readBack === null || readBack.state !== MANAGED_RUN_PROCESS_IDENTITY_STATES.BOUND ||
        readBack.sandbox_identity?.pid !== sandboxIdentity.pid ||
        readBack.sandbox_identity?.starttime !== sandboxIdentity.starttime ||
        readBack.sandbox_identity?.boot_id !== sandboxIdentity.boot_id ||
        !sameTuple(normalizeManagedRunIdentityTuple(readBack.tuple), pending.tuple)) {
      fail(
        MANAGED_RUN_PROCESS_IDENTITY_CODES.PUBLICATION_INCOMPLETE,
        "the managed-run identity record did not round-trip as a complete bound publication"
      );
    }
    return Object.freeze(readBack);
  }
}

export function discardManagedRunProcessIdentity({ mainRepo, tuple } = {}) {
  const filePath = managedRunProcessIdentityFilePath(mainRepo, tuple);
  try {
    unlinkSync(filePath);
    return { discarded: true, file_path: filePath };
  } catch (err) {
    if (err && err.code === "ENOENT") return { discarded: false, file_path: filePath };
    fail(
      MANAGED_RUN_PROCESS_IDENTITY_CODES.STORE_WRITE_FAILED,
      `failed to discard the managed-run identity record: ${filePath}`,
      { errno: err?.code ?? null },
      err
    );
    return null;
  }
}

const RECORD_TOP_LEVEL_KEYS_BY_STATE = Object.freeze({
  [MANAGED_RUN_PROCESS_IDENTITY_STATES.PENDING]: Object.freeze([
    "schema_version", "state", "role", "tuple", "launcher_identity",
    "published_at", "sandbox_identity", "kill_shape", "retirement"
  ]),
  [MANAGED_RUN_PROCESS_IDENTITY_STATES.BOUND]: Object.freeze([
    "schema_version", "state", "role", "tuple", "launcher_identity",
    "published_at", "sandbox_identity", "kill_shape", "retirement"
  ]),
  [MANAGED_RUN_PROCESS_IDENTITY_STATES.RETIRED]: Object.freeze([
    "schema_version", "state", "role", "tuple", "launcher_identity",
    "published_at", "sandbox_identity", "kill_shape", "retirement"
  ])
});

const IDENTITY_KEYS = Object.freeze(["pid", "starttime", "boot_id"]);
const PUBLISHED_AT_KEYS = Object.freeze(["uptime", "boot_id"]);
const KILL_SHAPE_KEYS = Object.freeze(["kind", "pid"]);
const RETIREMENT_KEYS = Object.freeze(["reason", "verdict", "retired_at", "evidence"]);

export function isValidProcessIdentity(value) {
  return hasExactKeys(value, IDENTITY_KEYS) &&
    Number.isInteger(value.pid) && value.pid > 0 &&
    typeof value.starttime === "string" && /^\d+$/.test(value.starttime) &&
    typeof value.boot_id === "string" && value.boot_id.length > 0;
}

export function isValidPublishedAt(value) {
  return hasExactKeys(value, PUBLISHED_AT_KEYS) &&
    typeof value.uptime === "number" && Number.isFinite(value.uptime) && value.uptime >= 0 &&
    typeof value.boot_id === "string" && value.boot_id.length > 0;
}

function isValidKillShapeFor(killShape, sandboxIdentity) {
  if (!hasExactKeys(killShape, KILL_SHAPE_KEYS)) return false;
  if (killShape.kind !== "bwrap-pid" && killShape.kind !== "interactive-pid") return false;
  try {
    assertKillShape(killShape);
  } catch {
    return false;
  }
  return killShape.pid === sandboxIdentity.pid;
}

export function isValidStoredTuple(tuple) {
  if (!hasExactKeys(tuple, ["assigned_unit", "launch_ref", "run_id", "retry_id"])) return false;
  try {
    normalizeManagedRunIdentityTuple(tuple);
    return true;
  } catch {
    return false;
  }
}

function isValidRetirement(retirement) {
  return hasExactKeys(retirement, RETIREMENT_KEYS) &&
    RETIREMENT_REASON_VALUES.has(retirement.reason) &&
    retirement.verdict === MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.PROVEN_DEAD &&
    isValidPublishedAt(retirement.retired_at) &&
    isPlainObject(retirement.evidence);
}

export function parseRecordBody(body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed) ||
      parsed.schema_version !== MANAGED_RUN_PROCESS_IDENTITY_SCHEMA_VERSION ||
      typeof parsed.state !== "string") {
    return null;
  }
  const expectedKeys = RECORD_TOP_LEVEL_KEYS_BY_STATE[parsed.state];

  if (!expectedKeys || !hasExactKeys(parsed, expectedKeys)) return null;
  if (typeof parsed.role !== "string" || parsed.role.length === 0) return null;
  if (!isValidStoredTuple(parsed.tuple)) return null;
  if (!isValidProcessIdentity(parsed.launcher_identity)) return null;
  if (!isValidPublishedAt(parsed.published_at)) return null;
  if (parsed.state === MANAGED_RUN_PROCESS_IDENTITY_STATES.PENDING) {

    return parsed.sandbox_identity === null && parsed.kill_shape === null &&
      parsed.retirement === null
      ? parsed
      : null;
  }
  if (!isValidProcessIdentity(parsed.sandbox_identity)) return null;
  if (!isValidKillShapeFor(parsed.kill_shape, parsed.sandbox_identity)) return null;
  if (parsed.state === MANAGED_RUN_PROCESS_IDENTITY_STATES.BOUND) {
    return parsed.retirement === null ? parsed : null;
  }

  return isValidRetirement(parsed.retirement) ? parsed : null;
}

export function readManagedRunProcessIdentity({ mainRepo, tuple } = {}) {
  const filePath = managedRunProcessIdentityFilePath(mainRepo, tuple);
  let body;
  try {
    body = readFileSync(filePath, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    return Object.freeze({ unreadable: true, file_path: filePath, errno: err?.code ?? null });
  }
  const parsed = parseRecordBody(body);
  if (parsed === null) return Object.freeze({ unreadable: true, file_path: filePath, errno: null });
  return Object.freeze({ ...parsed, file_path: filePath });
}

export function enumerateStoredRecords(mainRepo) {
  let entries;
  try {
    entries = readdirSync(managedRunProcessIdentityStoreDir(mainRepo));
  } catch (err) {
    if (err && err.code === "ENOENT") return { records: [], unreadable: [] };
    return { records: [], unreadable: [{ file_path: null, errno: err?.code ?? null }] };
  }
  const records = [];
  const unreadable = [];
  const storeDir = managedRunProcessIdentityStoreDir(mainRepo);
  for (const entry of entries) {
    if (!entry.startsWith("identity-") || !entry.endsWith(".json")) continue;
    const filePath = path.join(storeDir, entry);
    let body;
    try {
      body = readFileSync(filePath, "utf8");
    } catch (err) {
      unreadable.push({ file_path: filePath, errno: err?.code ?? null });
      continue;
    }
    const parsed = parseRecordBody(body);
    if (parsed === null) unreadable.push({ file_path: filePath, errno: null });
    else records.push(Object.freeze({ ...parsed, file_path: filePath }));
  }
  return { records, unreadable };
}
