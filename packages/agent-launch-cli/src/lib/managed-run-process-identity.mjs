

import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
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
  assessLiveness,
  captureProcessIdentity,
  defaultLivenessDeps,
  readSystemMonotonic
} from "./worktree-lease.mjs";

export const MANAGED_RUN_PROCESS_IDENTITY_SCHEMA_VERSION = "managed-run-process-identity.v1";

export const MANAGED_RUN_PROCESS_IDENTITY_STATES = Object.freeze({
  PENDING: "pending",
  BOUND: "bound",
  RETIRED: "retired"
});

export const MANAGED_RUN_PROCESS_IDENTITY_RETIREMENT_REASONS = Object.freeze({

  FINALIZED_INTEGRATION: "finalized_integration",

  CORRECTIVE_SUPERSESSION: "corrective_supersession",

  NO_COMMIT_BASE_EQUAL: "no_commit_base_equal"
});

const RETIREMENT_REASON_VALUES = new Set(Object.values(MANAGED_RUN_PROCESS_IDENTITY_RETIREMENT_REASONS));

export const MANAGED_RUN_WK_BINDING_RUN_ID_SUFFIX = ".wk";
export const MANAGED_RUN_SLICE_BINDING_RUN_ID_SUFFIX = ".slice";

export const MANAGED_RUN_PROCESS_IDENTITY_VERDICTS = Object.freeze({
  ABSENT: "absent",
  LIVE: "live",
  PARTIAL: "partial",
  AMBIGUOUS: "ambiguous",
  UNREADABLE: "unreadable",
  MISMATCHED: "mismatched",
  UNRESOLVED: "unresolved",
  PROVEN_DEAD: "proven_dead",

  RETIRED: "retired",

  RESERVED: "reserved"
});

const SPAWN_PERMISSIVE_VERDICTS = new Set([MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.ABSENT]);

export const MANAGED_RUN_PROCESS_IDENTITY_CODES = Object.freeze({
  INVALID_ARG: "agent_launch.managed_run_process_identity.invalid_arg.v1",
  STORE_COLLISION: "agent_launch.managed_run_process_identity.store_collision.v1",
  STORE_WRITE_FAILED: "agent_launch.managed_run_process_identity.store_write_failed.v1",
  PUBLICATION_INCOMPLETE: "agent_launch.managed_run_process_identity.publication_incomplete.v1",
  IDENTITY_CAPTURE_FAILED: "agent_launch.managed_run_process_identity.identity_capture_failed.v1",
  TOKEN_ORDER_VIOLATION: "agent_launch.managed_run_process_identity.token_order_violation.v1",
  BINDING_MISMATCH: "agent_launch.managed_run_process_identity.binding_mismatch.v1",
  RETIREMENT_REFUSED: "agent_launch.managed_run_process_identity.retirement_refused.v1",
  RESERVATION_UNREADABLE: "agent_launch.managed_run_process_identity.reservation_unreadable.v1"
});

export class ManagedRunProcessIdentityError extends Error {
  constructor(message, { code, detail = null, cause = null } = {}) {
    super(message);
    this.name = "ManagedRunProcessIdentityError";
    this.code = code ?? "agent_launch.managed_run_process_identity.error.v1";
    if (detail !== null) this.detail = detail;
    if (cause !== null) this.cause = cause;
  }
}

function fail(code, message, detail = null, cause = null) {
  throw new ManagedRunProcessIdentityError(
    `agent-launch managed-run-process-identity: ${message}`,
    { code, detail, cause }
  );
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeManagedRunIdentityTuple(tuple) {
  if (!isPlainObject(tuple)) {
    fail(MANAGED_RUN_PROCESS_IDENTITY_CODES.INVALID_ARG, "tuple must be an object");
  }
  const { assigned_unit: assignedUnit, launch_ref: launchRef, run_id: runId, retry_id: retryId = 0 } = tuple;
  for (const [label, value] of [["assigned_unit", assignedUnit], ["launch_ref", launchRef], ["run_id", runId]]) {
    if (typeof value !== "string" || value.length === 0) {
      fail(
        MANAGED_RUN_PROCESS_IDENTITY_CODES.INVALID_ARG,
        `tuple.${label} must be a non-empty string, got: ${JSON.stringify(value)}`
      );
    }
  }
  if (!Number.isInteger(retryId) || retryId < 0) {
    fail(
      MANAGED_RUN_PROCESS_IDENTITY_CODES.INVALID_ARG,
      `tuple.retry_id must be a non-negative integer, got: ${JSON.stringify(retryId)}`
    );
  }
  return Object.freeze({
    assigned_unit: assignedUnit,
    launch_ref: launchRef,
    run_id: runId,
    retry_id: retryId
  });
}

function sameTuple(left, right) {
  return left.assigned_unit === right.assigned_unit &&
    left.launch_ref === right.launch_ref &&
    left.run_id === right.run_id &&
    left.retry_id === right.retry_id;
}

function bindingMismatch(message, detail) {
  fail(MANAGED_RUN_PROCESS_IDENTITY_CODES.BINDING_MISMATCH, message, detail);
}

export function deriveManagedRunIdentityTupleFromBindingPair({
  assignedUnit,
  launchRef,
  wkBinding,
  sliceBinding,
  expectedRunId = null
} = {}) {
  if (typeof assignedUnit !== "string" || assignedUnit.length === 0) {
    fail(MANAGED_RUN_PROCESS_IDENTITY_CODES.INVALID_ARG, "assignedUnit must be a non-empty string");
  }
  if (typeof launchRef !== "string" || launchRef.length === 0) {
    fail(MANAGED_RUN_PROCESS_IDENTITY_CODES.INVALID_ARG, "launchRef must be a non-empty string");
  }
  if (!isPlainObject(wkBinding) || !isPlainObject(sliceBinding)) {
    bindingMismatch("the managed-run tuple requires both the retained WK and slice bindings", {
      wk_binding_present: isPlainObject(wkBinding),
      slice_binding_present: isPlainObject(sliceBinding)
    });
  }
  const wkRunId = wkBinding.run_id;
  const sliceRunId = sliceBinding.run_id;

  let workerRunId;
  if (typeof wkRunId === "string" && wkRunId.length > MANAGED_RUN_WK_BINDING_RUN_ID_SUFFIX.length &&
      wkRunId.endsWith(MANAGED_RUN_WK_BINDING_RUN_ID_SUFFIX)) {
    workerRunId = wkRunId.slice(0, -MANAGED_RUN_WK_BINDING_RUN_ID_SUFFIX.length);
  } else if (wkRunId === undefined && typeof expectedRunId === "string" && expectedRunId.length > 0) {
    workerRunId = expectedRunId;
  } else {
    bindingMismatch("the retained WK binding does not carry a launcher-minted worker run id", {
      wk_run_id: typeof wkRunId === "string" ? wkRunId : null,
      expected_run_id: expectedRunId
    });
  }

  if (sliceRunId !== `${workerRunId}${MANAGED_RUN_SLICE_BINDING_RUN_ID_SUFFIX}`) {
    bindingMismatch("the retained slice binding does not pair with the retained WK binding run id", {
      wk_run_id: typeof wkRunId === "string" ? wkRunId : null,
      worker_run_id: workerRunId,
      slice_run_id: typeof sliceRunId === "string" ? sliceRunId : null
    });
  }
  if (expectedRunId !== null && expectedRunId !== workerRunId) {
    bindingMismatch("the retained binding pair does not carry the expected worker run id", {
      expected_run_id: expectedRunId,
      binding_run_id: workerRunId
    });
  }
  if (sliceBinding.launch_ref !== launchRef ||
      (wkBinding.launch_ref !== undefined && wkBinding.launch_ref !== launchRef)) {
    bindingMismatch("the retained binding pair does not carry the expected launch ref", {
      expected_launch_ref: launchRef,
      wk_launch_ref: wkBinding.launch_ref ?? null,
      slice_launch_ref: sliceBinding.launch_ref ?? null
    });
  }
  if (!Number.isInteger(sliceBinding.retry_id) ||
      (wkBinding.retry_id !== undefined && sliceBinding.retry_id !== wkBinding.retry_id)) {
    bindingMismatch("the retained binding pair does not carry one exact retry id", {
      wk_retry_id: wkBinding.retry_id ?? null,
      slice_retry_id: sliceBinding.retry_id ?? null
    });
  }

  const address = String(sliceBinding.unit_address ?? "").split("/");
  if (address.length !== 3 || `${address[1]}#${address[2]}` !== assignedUnit) {
    bindingMismatch("the retained slice binding does not address the assigned unit", {
      assigned_unit: assignedUnit,
      slice_unit_address: sliceBinding.unit_address ?? null
    });
  }
  return normalizeManagedRunIdentityTuple({
    assigned_unit: assignedUnit,
    launch_ref: launchRef,
    run_id: workerRunId,
    retry_id: sliceBinding.retry_id
  });
}

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

function serializeRecord(record) {
  return `${JSON.stringify(record, null, 2)}\n`;
}

function writeExclusive(filePath, contents) {
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

function replaceAtomically(filePath, contents) {
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

function hasExactKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.length) return false;
  return expected.every((key) => Object.hasOwn(value, key));
}

function isValidProcessIdentity(value) {
  return hasExactKeys(value, IDENTITY_KEYS) &&
    Number.isInteger(value.pid) && value.pid > 0 &&
    typeof value.starttime === "string" && /^\d+$/.test(value.starttime) &&
    typeof value.boot_id === "string" && value.boot_id.length > 0;
}

function isValidPublishedAt(value) {
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

function isValidStoredTuple(tuple) {
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

function parseRecordBody(body) {
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

function verdict(state, reason, extra = null) {
  return Object.freeze({ verdict: state, reason, ...(extra ?? {}) });
}

export function assessManagedRunProcessIdentityRecord(record, { expectedTuple = null, deps = defaultLivenessDeps } = {}) {
  if (record === null) {
    return verdict(MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.ABSENT, "no durable managed-run identity record");
  }
  if (record.unreadable === true) {
    return verdict(
      MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.UNREADABLE,
      "a managed-run identity record exists but could not be read as a valid record",
      { file_path: record.file_path ?? null }
    );
  }
  if (expectedTuple !== null) {
    let recorded;
    try {
      recorded = normalizeManagedRunIdentityTuple(record.tuple);
    } catch {
      return verdict(
        MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.UNREADABLE,
        "the managed-run identity record carries a malformed tuple"
      );
    }
    const expected = normalizeManagedRunIdentityTuple(expectedTuple);
    if (!sameTuple(recorded, expected)) {
      return verdict(
        MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.MISMATCHED,
        "the managed-run identity record is bound to a different launcher tuple",
        { recorded_tuple: recorded, expected_tuple: expected }
      );
    }
  }
  if (record.state === MANAGED_RUN_PROCESS_IDENTITY_STATES.PENDING) {

    return verdict(
      MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.PARTIAL,
      "the managed-run identity record is pending: the outer sandbox identity was never bound"
    );
  }
  if (record.state === MANAGED_RUN_PROCESS_IDENTITY_STATES.RETIRED) {

    return verdict(
      MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.RETIRED,
      `the managed-run identity record was retired (${record.retirement.reason})`,
      { retirement: record.retirement }
    );
  }

  let launcher;
  let sandbox;
  try {
    launcher = assessLiveness(record.launcher_identity, deps);
    sandbox = assessLiveness(record.sandbox_identity, deps);
  } catch (error) {
    return verdict(
      MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.UNREADABLE,
      "the managed-run identity record could not be assessed against the liveness oracle",
      { source_code: error?.code ?? null }
    );
  }
  const liveness = Object.freeze({ launcher: launcher.state, sandbox: sandbox.state });
  if (launcher.state === "alive" || sandbox.state === "alive") {
    return verdict(
      MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.LIVE,
      launcher.state === "alive" ? launcher.reason : sandbox.reason,
      { liveness }
    );
  }
  if (launcher.state !== "dead" || sandbox.state !== "dead") {

    return verdict(
      MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.UNRESOLVED,
      launcher.state === "indeterminate" ? launcher.reason : sandbox.reason,
      { liveness }
    );
  }

  return verdict(
    MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.PROVEN_DEAD,
    "both the bound launcher and outer sandbox identities are provably dead",
    { liveness, boot_changed: sandbox.reason.includes("boot_id changed") }
  );
}

export function assessManagedRunProcessIdentity({ mainRepo, tuple, deps = defaultLivenessDeps } = {}) {
  const normalized = normalizeManagedRunIdentityTuple(tuple);
  const record = readManagedRunProcessIdentity({ mainRepo, tuple: normalized });
  const assessed = assessManagedRunProcessIdentityRecord(record, { expectedTuple: normalized, deps });
  return Object.freeze({ ...assessed, tuple: normalized });
}

function enumerateStoredRecords(mainRepo) {
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

export function assessPriorManagedAttemptsForSubject({ mainRepo, subject, deps = defaultLivenessDeps } = {}) {
  if (typeof subject !== "string" || subject.length === 0) {
    fail(MANAGED_RUN_PROCESS_IDENTITY_CODES.INVALID_ARG, "subject must be a non-empty string");
  }
  const { records, unreadable } = enumerateStoredRecords(mainRepo);
  if (unreadable.length > 0) {

    return Object.freeze({
      may_launch: false,
      ...verdict(
        MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.UNREADABLE,
        "the managed-run identity store contains a record that could not be read",
        { unreadable_count: unreadable.length }
      ),
      subject
    });
  }

  const forSubject = records.filter((record) =>
    record.tuple?.assigned_unit === subject &&
    record.state !== MANAGED_RUN_PROCESS_IDENTITY_STATES.RETIRED
  );
  if (forSubject.length === 0) {
    return Object.freeze({
      may_launch: true,
      ...verdict(MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.ABSENT, "no prior managed attempt is recorded for this unit"),
      subject
    });
  }
  if (forSubject.length > 1) {

    return Object.freeze({
      may_launch: false,
      ...verdict(
        MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.AMBIGUOUS,
        "more than one durable managed attempt is recorded for this unit",
        { attempt_count: forSubject.length }
      ),
      subject
    });
  }
  const assessed = assessManagedRunProcessIdentityRecord(forSubject[0], { deps });
  return Object.freeze({
    may_launch: SPAWN_PERMISSIVE_VERDICTS.has(assessed.verdict),
    ...assessed,
    subject,
    tuple: normalizeManagedRunIdentityTuple(forSubject[0].tuple)
  });
}

export function deriveOuterSandboxKillShape({ pid, enforcement = undefined }) {
  const unenforcedPlainLaunch = isPlainObject(enforcement) && enforcement.enforced === false;
  return Object.freeze({ kind: unenforcedPlainLaunch ? "interactive-pid" : "bwrap-pid", pid });
}

function retirementRefusal(state, reason, extra = null) {
  return Object.freeze({ retired: false, verdict: state, reason, ...(extra ?? {}) });
}

function validateRetirementEvidence({ reason, evidence, record }) {
  if (reason === MANAGED_RUN_PROCESS_IDENTITY_RETIREMENT_REASONS.FINALIZED_INTEGRATION) {

    if (typeof evidence?.slice_ref !== "string" || typeof evidence?.integrated_sha !== "string") {
      return "finalized_integration retirement requires the integrated slice ref and sha";
    }
    return null;
  }
  if (reason === MANAGED_RUN_PROCESS_IDENTITY_RETIREMENT_REASONS.NO_COMMIT_BASE_EQUAL) {

    if (typeof evidence?.slice_ref !== "string" ||
        typeof evidence?.base_sha !== "string" || evidence.base_sha.length === 0 ||
        typeof evidence?.slice_tip_sha !== "string") {
      return "no_commit_base_equal retirement requires the slice ref, authenticated base sha, and observed tip";
    }
    if (evidence.slice_tip_sha !== evidence.base_sha) {
      return "no_commit_base_equal retirement requires the slice tip to equal its authenticated base";
    }
    return null;
  }
  if (reason === MANAGED_RUN_PROCESS_IDENTITY_RETIREMENT_REASONS.CORRECTIVE_SUPERSESSION) {

    const requiredEvidenceFields = [
      "source_worker_run_id", "source_worker_monitor_handle", "subject", "slice_ref",
      "frozen_base_sha", "delivered_tip_sha", "commit_chain", "committed_target_digest"
    ];
    if (!hasExactKeys(evidence, requiredEvidenceFields) ||
        evidence.source_worker_run_id !== record.tuple.run_id ||
        evidence?.source_worker_monitor_handle !== record.tuple.launch_ref) {
      return "corrective_supersession retirement requires the exact prior attempt identity";
    }
    const subject = record.tuple.assigned_unit;
    const subjectMatch = subject.match(/^(WK-\d{4})#(SLICE-\d{3})$/u);
    const expectedRefSuffix = subjectMatch === null
      ? null
      : `/${subjectMatch[1]}/${subjectMatch[2]}`;
    const oid = (value) => typeof value === "string" &&
      /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value) && !/^0+$/u.test(value);
    if (evidence?.subject !== subject || expectedRefSuffix === null ||
        typeof evidence?.slice_ref !== "string" ||
        !evidence.slice_ref.startsWith("refs/heads/slice/IN-") ||
        !evidence.slice_ref.endsWith(expectedRefSuffix) ||
        !oid(evidence?.frozen_base_sha) || !oid(evidence?.delivered_tip_sha) ||
        !Array.isArray(evidence?.commit_chain) || evidence.commit_chain.length === 0 ||
        evidence.commit_chain.some((commit) => !oid(commit)) ||
        evidence.commit_chain.at(-1) !== evidence.delivered_tip_sha ||
        typeof evidence?.committed_target_digest !== "string" ||
        !/^sha256:[0-9a-f]{64}$/u.test(evidence.committed_target_digest)) {
      return "corrective_supersession retirement requires exact authenticated delivery identity";
    }
    return null;
  }
  return "unsupported retirement reason";
}

export function retireManagedRunProcessIdentity({
  mainRepo,
  tuple,
  reason,
  evidence = null,
  deps = defaultLivenessDeps
} = {}) {
  const normalized = normalizeManagedRunIdentityTuple(tuple);
  if (!RETIREMENT_REASON_VALUES.has(reason)) {
    fail(
      MANAGED_RUN_PROCESS_IDENTITY_CODES.INVALID_ARG,
      `retirement reason must be one of ${[...RETIREMENT_REASON_VALUES].join("|")}, got: ${JSON.stringify(reason)}`
    );
  }
  const record = readManagedRunProcessIdentity({ mainRepo, tuple: normalized });
  const assessed = assessManagedRunProcessIdentityRecord(record, { expectedTuple: normalized, deps });
  if (assessed.verdict === MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.RETIRED ||
      assessed.verdict === MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.ABSENT) {

    return Object.freeze({
      retired: true,
      already_retired: true,
      verdict: assessed.verdict,
      reason: "the managed-run identity record is already settled",
      tuple: normalized
    });
  }
  if (assessed.verdict !== MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.PROVEN_DEAD) {
    return retirementRefusal(
      assessed.verdict,
      "only a provably dead bound attempt may be retired",
      { detail: assessed.reason, liveness: assessed.liveness ?? null, tuple: normalized }
    );
  }
  const evidenceRefusal = validateRetirementEvidence({ reason, evidence, record });
  if (evidenceRefusal !== null) {
    fail(MANAGED_RUN_PROCESS_IDENTITY_CODES.RETIREMENT_REFUSED, evidenceRefusal, {
      retirement_reason: reason
    });
  }
  let retiredAt;
  try {
    retiredAt = readSystemMonotonic(deps);
  } catch (error) {
    fail(
      MANAGED_RUN_PROCESS_IDENTITY_CODES.RETIREMENT_REFUSED,
      "cannot read the system monotonic clock; refusing to retire (fail closed)",
      { source_code: error?.code ?? null },
      error
    );
  }
  const retired = {
    schema_version: record.schema_version,
    state: MANAGED_RUN_PROCESS_IDENTITY_STATES.RETIRED,
    role: record.role,
    tuple: { ...record.tuple },
    launcher_identity: { ...record.launcher_identity },
    published_at: { ...record.published_at },
    sandbox_identity: { ...record.sandbox_identity },
    kill_shape: { ...record.kill_shape },
    retirement: {
      reason,
      verdict: MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.PROVEN_DEAD,
      retired_at: { uptime: retiredAt.uptime, boot_id: retiredAt.boot_id },
      evidence: { ...(evidence ?? {}) }
    }
  };
  const filePath = managedRunProcessIdentityFilePath(mainRepo, normalized);
  replaceAtomically(filePath, serializeRecord(retired));
  const readBack = readManagedRunProcessIdentity({ mainRepo, tuple: normalized });
  if (readBack === null || readBack.unreadable === true ||
      readBack.state !== MANAGED_RUN_PROCESS_IDENTITY_STATES.RETIRED) {
    fail(
      MANAGED_RUN_PROCESS_IDENTITY_CODES.RETIREMENT_REFUSED,
      "the retired managed-run identity record did not round-trip as a valid retired record"
    );
  }
  return Object.freeze({
    retired: true,
    already_retired: false,
    verdict: MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.PROVEN_DEAD,
    retirement_reason: reason,
    tuple: normalized,
    file_path: filePath
  });
}

export const MANAGED_RUN_SUBJECT_RESERVATION_SCHEMA_VERSION =
  "managed-run-subject-reservation.v1";

const RESERVATION_KEYS = Object.freeze([
  "schema_version", "subject", "reservation_id", "role", "owner_launcher", "reserved_at", "tuple"
]);

export function managedRunSubjectReservationFilePath(mainRepo, subject) {
  if (typeof subject !== "string" || subject.length === 0) {
    fail(MANAGED_RUN_PROCESS_IDENTITY_CODES.INVALID_ARG, "subject must be a non-empty string");
  }
  const digest = createHash("sha256")
    .update(JSON.stringify([MANAGED_RUN_SUBJECT_RESERVATION_SCHEMA_VERSION, subject]))
    .digest("hex");
  return path.join(managedRunProcessIdentityStoreDir(mainRepo), `subject-${digest}.json`);
}

function parseReservationBody(body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!hasExactKeys(parsed, RESERVATION_KEYS)) return null;
  if (parsed.schema_version !== MANAGED_RUN_SUBJECT_RESERVATION_SCHEMA_VERSION) return null;
  if (typeof parsed.subject !== "string" || parsed.subject.length === 0) return null;
  if (typeof parsed.reservation_id !== "string" || parsed.reservation_id.length === 0) return null;
  if (typeof parsed.role !== "string" || parsed.role.length === 0) return null;
  if (!isValidProcessIdentity(parsed.owner_launcher)) return null;
  if (!isValidPublishedAt(parsed.reserved_at)) return null;
  if (parsed.tuple !== null && !isValidStoredTuple(parsed.tuple)) return null;
  return parsed;
}

function readReservation(filePath) {
  let body;
  try {
    body = readFileSync(filePath, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    return { unreadable: true, errno: err?.code ?? null };
  }
  const parsed = parseReservationBody(body);
  return parsed === null ? { unreadable: true, errno: null } : parsed;
}

export function retireManagedRunAndReserveCorrectiveSuccessor({
  mainRepo,
  tuple,
  subject,
  role,
  evidence,
  deps = defaultLivenessDeps
} = {}) {
  const normalized = normalizeManagedRunIdentityTuple(tuple);
  if (normalized.assigned_unit !== subject || typeof role !== "string" || role.length === 0) {
    fail(
      MANAGED_RUN_PROCESS_IDENTITY_CODES.INVALID_ARG,
      "corrective successor requires the exact prior subject and a non-empty role"
    );
  }
  const filePath = managedRunSubjectReservationFilePath(mainRepo, subject);
  const guardPath = `${filePath}.corrective-successor`;
  try {
    writeExclusive(guardPath, `${JSON.stringify({ subject, tuple: normalized })}\n`);
  } catch (error) {
    if (error?.code === MANAGED_RUN_PROCESS_IDENTITY_CODES.STORE_COLLISION) {
      return Object.freeze({
        retired: false,
        may_launch: false,
        verdict: MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.RESERVED,
        reason: "another launcher is reserving a corrective successor for this unit",
        subject,
        reservation: null
      });
    }
    throw error;
  }

  try {
    const held = readReservation(filePath);
    if (held === null || held.unreadable === true || held.subject !== subject ||
        held.tuple === null || !sameTuple(held.tuple, normalized)) {
      return Object.freeze({
        retired: false,
        may_launch: false,
        verdict: held?.unreadable === true
          ? MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.UNREADABLE
          : MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.MISMATCHED,
        reason: "the exact prior attempt does not own the subject reservation",
        subject,
        reservation: null
      });
    }

    let ownerIdentity;
    let reservedAt;
    try {
      ownerIdentity = captureProcessIdentity(process.pid, deps);
      reservedAt = readSystemMonotonic(deps);
    } catch (error) {
      fail(
        MANAGED_RUN_PROCESS_IDENTITY_CODES.IDENTITY_CAPTURE_FAILED,
        "cannot capture the corrective successor launcher identity",
        { source_code: error?.code ?? null },
        error
      );
    }
    const successor = {
      schema_version: MANAGED_RUN_SUBJECT_RESERVATION_SCHEMA_VERSION,
      subject,
      reservation_id: randomUUID(),
      role,
      owner_launcher: {
        pid: ownerIdentity.pid,
        starttime: ownerIdentity.starttime,
        boot_id: ownerIdentity.boot_id
      },
      reserved_at: { uptime: reservedAt.uptime, boot_id: reservedAt.boot_id },
      tuple: null
    };

    const retirement = retireManagedRunProcessIdentity({
      mainRepo,
      tuple: normalized,
      reason: MANAGED_RUN_PROCESS_IDENTITY_RETIREMENT_REASONS.CORRECTIVE_SUPERSESSION,
      evidence,
      deps
    });
    if (retirement.retired !== true) {
      return Object.freeze({
        ...retirement,
        may_launch: false,
        subject,
        reservation: null
      });
    }

    const current = readReservation(filePath);
    if (current === null || current.unreadable === true || current.subject !== subject ||
        current.reservation_id !== held.reservation_id || current.tuple === null ||
        !sameTuple(current.tuple, normalized)) {
      fail(
        MANAGED_RUN_PROCESS_IDENTITY_CODES.RESERVATION_UNREADABLE,
        "the prior reservation changed before corrective successor publication",
        { subject }
      );
    }
    replaceAtomically(filePath, serializeRecord(successor));
    const readBack = readReservation(filePath);
    if (readBack === null || readBack.unreadable === true ||
        readBack.reservation_id !== successor.reservation_id || readBack.tuple !== null) {
      fail(
        MANAGED_RUN_PROCESS_IDENTITY_CODES.RESERVATION_UNREADABLE,
        "the corrective successor reservation did not round-trip"
      );
    }
    return Object.freeze({
      retired: true,
      may_launch: true,
      verdict: MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.ABSENT,
      reason: "the exact prior attempt was mechanically superseded",
      subject,
      reservation: Object.freeze({ ...successor, file_path: filePath })
    });
  } finally {
    try { unlinkSync(guardPath); } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

function reservationIsProvablyAbandoned({ mainRepo, held, deps }) {
  let owner;
  try {
    owner = assessLiveness(held.owner_launcher, deps);
  } catch {
    return { abandoned: false, verdict: MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.UNREADABLE };
  }
  if (owner.state !== "dead") {
    return {
      abandoned: false,
      verdict: owner.state === "alive"
        ? MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.LIVE
        : MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.UNRESOLVED,
      reason: owner.reason
    };
  }
  if (held.tuple === null) {

    return { abandoned: true, verdict: MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.ABSENT };
  }
  const assessed = assessManagedRunProcessIdentityRecord(
    readManagedRunProcessIdentity({ mainRepo, tuple: held.tuple }),
    { expectedTuple: held.tuple, deps }
  );
  const settled = assessed.verdict === MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.ABSENT ||
    assessed.verdict === MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.RETIRED;
  return { abandoned: settled, verdict: assessed.verdict, reason: assessed.reason };
}

export function acquireManagedRunSubjectReservation({
  mainRepo,
  subject,
  role,
  deps = defaultLivenessDeps
} = {}) {
  if (typeof role !== "string" || role.length === 0) {
    fail(MANAGED_RUN_PROCESS_IDENTITY_CODES.INVALID_ARG, "role must be a non-empty string");
  }

  const priorAttempt = assessPriorManagedAttemptsForSubject({ mainRepo, subject, deps });
  if (priorAttempt.may_launch !== true) {
    return Object.freeze({ ...priorAttempt, reservation: null });
  }
  const filePath = managedRunSubjectReservationFilePath(mainRepo, subject);
  let ownerIdentity;
  let reservedAt;
  try {
    ownerIdentity = captureProcessIdentity(process.pid, deps);
    reservedAt = readSystemMonotonic(deps);
  } catch (error) {
    fail(
      MANAGED_RUN_PROCESS_IDENTITY_CODES.IDENTITY_CAPTURE_FAILED,
      "cannot capture the reserving launcher's own identity; refusing to reserve (fail closed)",
      { source_code: error?.code ?? null },
      error
    );
  }
  const reservation = {
    schema_version: MANAGED_RUN_SUBJECT_RESERVATION_SCHEMA_VERSION,
    subject,
    reservation_id: randomUUID(),
    role,
    owner_launcher: {
      pid: ownerIdentity.pid,
      starttime: ownerIdentity.starttime,
      boot_id: ownerIdentity.boot_id
    },
    reserved_at: { uptime: reservedAt.uptime, boot_id: reservedAt.boot_id },
    tuple: null
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeExclusive(filePath, serializeRecord(reservation));
      return Object.freeze({
        may_launch: true,
        verdict: MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.ABSENT,
        reason: "no prior managed attempt is recorded for this unit",
        subject,
        reservation: Object.freeze({ ...reservation, file_path: filePath })
      });
    } catch (error) {
      if (error?.code !== MANAGED_RUN_PROCESS_IDENTITY_CODES.STORE_COLLISION || attempt === 1) throw error;
      const held = readReservation(filePath);
      if (held === null) continue;
      if (held.unreadable === true) {
        return Object.freeze({
          may_launch: false,
          verdict: MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.UNREADABLE,
          reason: "the managed-run subject reservation exists but could not be read as a valid reservation",
          subject,
          reservation: null
        });
      }
      const abandonment = reservationIsProvablyAbandoned({ mainRepo, held, deps });
      if (!abandonment.abandoned) {
        return Object.freeze({
          may_launch: false,
          verdict: MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.RESERVED,
          reason: "another launcher holds the managed-run subject reservation for this unit",
          subject,
          holder: Object.freeze({
            reservation_id: held.reservation_id,
            owner_verdict: abandonment.verdict,
            tuple: held.tuple
          }),
          reservation: null
        });
      }

      try {
        unlinkSync(filePath);
      } catch (err) {
        if (err && err.code !== "ENOENT") throw err;
      }
    }
  }
  fail(
    MANAGED_RUN_PROCESS_IDENTITY_CODES.STORE_COLLISION,
    "the managed-run subject reservation could not be acquired"
  );
  return null;
}

export function attachTupleToManagedRunSubjectReservation({ mainRepo, reservation, tuple } = {}) {
  const normalized = normalizeManagedRunIdentityTuple(tuple);
  const filePath = managedRunSubjectReservationFilePath(mainRepo, reservation?.subject);
  const held = readReservation(filePath);
  if (held === null || held.unreadable === true || held.reservation_id !== reservation?.reservation_id) {
    fail(
      MANAGED_RUN_PROCESS_IDENTITY_CODES.RESERVATION_UNREADABLE,
      "the managed-run subject reservation is no longer held by this launcher",
      { subject: reservation?.subject ?? null }
    );
  }
  replaceAtomically(filePath, serializeRecord({ ...held, tuple: { ...normalized } }));
  return Object.freeze({ ...reservation, tuple: normalized });
}

export function releaseManagedRunSubjectReservation({
  mainRepo,
  subject,
  reservationId = null,
  tuple = null
} = {}) {
  const filePath = managedRunSubjectReservationFilePath(mainRepo, subject);
  const held = readReservation(filePath);
  if (held === null) return Object.freeze({ released: false, reason: "absent" });
  if (held.unreadable === true) {
    return Object.freeze({ released: false, reason: "unreadable" });
  }
  const idMatches = reservationId !== null && held.reservation_id === reservationId;
  const tupleMatches = tuple !== null && held.tuple !== null &&
    sameTuple(normalizeManagedRunIdentityTuple(held.tuple), normalizeManagedRunIdentityTuple(tuple));
  if (!idMatches && !tupleMatches) {
    return Object.freeze({ released: false, reason: "held_by_another_attempt" });
  }
  try {
    unlinkSync(filePath);
  } catch (err) {
    if (err && err.code === "ENOENT") return Object.freeze({ released: false, reason: "absent" });
    fail(
      MANAGED_RUN_PROCESS_IDENTITY_CODES.STORE_WRITE_FAILED,
      `failed to release the managed-run subject reservation: ${filePath}`,
      { errno: err?.code ?? null },
      err
    );
  }
  return Object.freeze({ released: true, reason: idMatches ? "reservation_id" : "tuple" });
}
