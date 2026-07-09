

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import { resolveWorktreePath } from "./worktree-substrate.mjs";

export const WORKTREE_LEASE_SCHEMA_VERSION = "worktree-integration-lease.v1";

export const ZERO_OID = "0".repeat(40);

export const DEFAULT_LEASE_STALENESS_SECONDS = 90;

export const WORKTREE_LEASE_DIAGNOSTIC_CODES = Object.freeze({
  INVALID_ARG: "agent_launch.worktree_lease.invalid_arg.v1",
  INVALID_INITIATIVE_ID: "agent_launch.worktree_lease.invalid_initiative_id.v1",
  NO_PROC_FAIL_CLOSED: "agent_launch.worktree_lease.no_proc_fail_closed.v1",
  PROC_PID_UNREADABLE: "agent_launch.worktree_lease.proc_pid_unreadable.v1",
  STAT_UNPARSEABLE: "agent_launch.worktree_lease.stat_unparseable.v1",
  MONOTONIC_UNREADABLE: "agent_launch.worktree_lease.monotonic_unreadable.v1",
  KILL_FAILED: "agent_launch.worktree_lease.kill_failed.v1",
  CONFIRM_STILL_LIVE: "agent_launch.worktree_lease.confirm_still_live.v1",
  CONFIRM_INDETERMINATE: "agent_launch.worktree_lease.confirm_indeterminate.v1",
  TOKEN_ORDER_VIOLATION: "agent_launch.worktree_lease.token_order_violation.v1",
  CAS_REJECTED: "agent_launch.worktree_lease.cas_rejected.v1",
  LEASE_ACQUIRE_FAILED: "agent_launch.worktree_lease.lease_acquire_failed.v1",
  LEASE_STEAL_LOST: "agent_launch.worktree_lease.lease_steal_lost.v1",
  LEASE_LOST: "agent_launch.worktree_lease.lease_lost.v1",
  RESET_REFUSED: "agent_launch.worktree_lease.reset_refused.v1",
  GIT_FAILED: "agent_launch.worktree_lease.git_failed.v1"
});

export class WorktreeLeaseError extends Error {
  constructor(message, { code, detail = null, cause = null } = {}) {
    super(message);
    this.name = "WorktreeLeaseError";
    this.code = code ?? "agent_launch.worktree_lease.error.v1";
    if (detail !== null) this.detail = detail;
    if (cause !== null) this.cause = cause;
  }
}

function fail(code, message, detail = null, cause = null) {
  throw new WorktreeLeaseError(`agent-launch worktree-lease: ${message}`, { code, detail, cause });
}

const INITIATIVE_ID_RE = /^IN-\d{4}$/;

function assertInitiativeId(initiative) {
  if (typeof initiative !== "string" || !INITIATIVE_ID_RE.test(initiative)) {
    fail(
      WORKTREE_LEASE_DIAGNOSTIC_CODES.INVALID_INITIATIVE_ID,
      `initiative must match ^IN-\\d{4}$, got: ${JSON.stringify(initiative)}`
    );
  }
  return initiative;
}

export function defaultRunGit({ repo, args, input = null }) {
  let res;
  try {
    res = spawnSync("git", ["-C", repo, "-c", "core.quotePath=false", ...args], {
      encoding: "utf8",
      input: input === null ? undefined : input,
      maxBuffer: 64 * 1024 * 1024
    });
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
  if (res.error) {
    return { ok: false, error: res.error.message ?? String(res.error) };
  }
  if (typeof res.status !== "number" || res.status !== 0) {
    return {
      ok: false,
      status: res.status ?? null,
      signal: res.signal ?? null,
      stdout: typeof res.stdout === "string" ? res.stdout : "",
      stderr: typeof res.stderr === "string" ? res.stderr.slice(0, 2048) : null
    };
  }
  return { ok: true, stdout: typeof res.stdout === "string" ? res.stdout : "" };
}

function gitOrThrow(runGit, repo, args, whatFailed, { input = null } = {}) {
  const res = runGit({ repo, args, input });
  if (!res || res.ok !== true) {
    fail(
      WORKTREE_LEASE_DIAGNOSTIC_CODES.GIT_FAILED,
      `${whatFailed} (git ${args.join(" ")})`,
      { status: res?.status ?? null, signal: res?.signal ?? null, error: res?.error ?? null, stderr: res?.stderr ?? null }
    );
  }
  return res;
}

export const defaultLivenessDeps = Object.freeze({
  procAvailable() {
    return existsSync("/proc/self/stat");
  },
  readProcStat(pid) {
    try {
      return readFileSync(`/proc/${pid}/stat`, "utf8");
    } catch {
      return null;
    }
  },
  readBootId() {
    try {
      return readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
    } catch {
      return null;
    }
  },
  readUptime() {
    try {
      const first = readFileSync("/proc/uptime", "utf8").trim().split(/\s+/)[0];
      const value = Number.parseFloat(first);
      return Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  },
  sendSignal(target, signal) {
    process.kill(target, signal);
  }
});

export function parseStarttimeFromStat(statBody) {
  if (typeof statBody !== "string") return null;
  const rparen = statBody.lastIndexOf(")");
  if (rparen === -1) return null;
  const tail = statBody.slice(rparen + 1).trim();
  if (tail.length === 0) return null;
  const fields = tail.split(/\s+/);
  const starttime = fields[19];
  if (typeof starttime !== "string" || !/^\d+$/.test(starttime)) return null;
  return starttime;
}

export function captureProcessIdentity(pid, deps = defaultLivenessDeps) {
  if (!Number.isInteger(pid) || pid <= 0) {
    fail(WORKTREE_LEASE_DIAGNOSTIC_CODES.INVALID_ARG, `pid must be a positive integer, got: ${JSON.stringify(pid)}`);
  }
  if (!deps.procAvailable()) {
    fail(
      WORKTREE_LEASE_DIAGNOSTIC_CODES.NO_PROC_FAIL_CLOSED,
      `refusing to capture process identity without /proc (fail closed): pid ${pid}`
    );
  }
  const bootId = deps.readBootId();
  if (typeof bootId !== "string" || bootId.length === 0) {
    fail(WORKTREE_LEASE_DIAGNOSTIC_CODES.NO_PROC_FAIL_CLOSED, `boot_id unreadable; cannot capture identity for pid ${pid}`);
  }
  const stat = deps.readProcStat(pid);
  if (stat === null) {
    fail(WORKTREE_LEASE_DIAGNOSTIC_CODES.PROC_PID_UNREADABLE, `/proc/${pid}/stat not readable (pid not live?)`);
  }
  const starttime = parseStarttimeFromStat(stat);
  if (starttime === null) {
    fail(WORKTREE_LEASE_DIAGNOSTIC_CODES.STAT_UNPARSEABLE, `could not parse starttime (field 22) from /proc/${pid}/stat`);
  }
  return Object.freeze({ pid, starttime, boot_id: bootId });
}

function assertIdentityShape(identity) {
  if (
    !identity ||
    typeof identity !== "object" ||
    !Number.isInteger(identity.pid) ||
    identity.pid <= 0 ||
    typeof identity.starttime !== "string" ||
    typeof identity.boot_id !== "string"
  ) {
    fail(
      WORKTREE_LEASE_DIAGNOSTIC_CODES.INVALID_ARG,
      `identity must be { pid:int>0, starttime:string, boot_id:string }, got: ${JSON.stringify(identity)}`
    );
  }
}

export function assessLiveness(identity, deps = defaultLivenessDeps) {
  assertIdentityShape(identity);
  if (!deps.procAvailable()) {
    return { state: "indeterminate", reason: "no /proc (non-Linux/missing): cannot confirm death (fail closed)" };
  }
  const currentBootId = deps.readBootId();
  if (typeof currentBootId !== "string" || currentBootId.length === 0) {
    return { state: "indeterminate", reason: "boot_id unreadable: cannot confirm death (fail closed)" };
  }

  if (currentBootId !== identity.boot_id) {
    return { state: "dead", reason: "boot_id changed (reboot): prior holder unconditionally dead" };
  }
  const stat = deps.readProcStat(identity.pid);
  if (stat === null) {

    return { state: "dead", reason: `/proc/${identity.pid} absent: process gone` };
  }
  const currentStart = parseStarttimeFromStat(stat);
  if (currentStart === null) {
    return { state: "indeterminate", reason: "unparseable stat: cannot confirm death (fail closed)" };
  }
  if (currentStart !== identity.starttime) {
    return { state: "dead", reason: "starttime mismatch: pid recycled to a different process" };
  }
  return { state: "alive", reason: "pid + starttime + boot_id all match: process still live" };
}

export function confirmedDead(identity, deps = defaultLivenessDeps) {
  return assessLiveness(identity, deps).state === "dead";
}

export function readSystemMonotonic(deps = defaultLivenessDeps) {
  if (!deps.procAvailable()) {
    fail(WORKTREE_LEASE_DIAGNOSTIC_CODES.MONOTONIC_UNREADABLE, "no /proc: cannot read the system monotonic clock (fail closed)");
  }
  const uptime = deps.readUptime();
  const bootId = deps.readBootId();
  if (uptime === null || typeof bootId !== "string" || bootId.length === 0) {
    fail(WORKTREE_LEASE_DIAGNOSTIC_CODES.MONOTONIC_UNREADABLE, "system monotonic source (/proc/uptime + boot_id) unreadable");
  }
  return Object.freeze({ uptime, boot_id: bootId });
}

export function assessStaleness(stored, current, thresholdSeconds = DEFAULT_LEASE_STALENESS_SECONDS) {
  if (!stored || typeof stored.uptime !== "number" || typeof stored.boot_id !== "string") {
    fail(WORKTREE_LEASE_DIAGNOSTIC_CODES.INVALID_ARG, `stored heartbeat must be { uptime:number, boot_id:string }, got: ${JSON.stringify(stored)}`);
  }
  if (!current || typeof current.uptime !== "number" || typeof current.boot_id !== "string") {
    fail(WORKTREE_LEASE_DIAGNOSTIC_CODES.INVALID_ARG, `current reading must be { uptime:number, boot_id:string }, got: ${JSON.stringify(current)}`);
  }
  if (!Number.isFinite(thresholdSeconds) || thresholdSeconds < 0) {
    fail(WORKTREE_LEASE_DIAGNOSTIC_CODES.INVALID_ARG, `thresholdSeconds must be a non-negative finite number, got: ${JSON.stringify(thresholdSeconds)}`);
  }
  if (current.boot_id !== stored.boot_id) {
    return { stale: true, dead: true, elapsed: null, indeterminate: false, reason: "boot_id changed (reboot): prior holder unconditionally dead" };
  }
  const elapsed = current.uptime - stored.uptime;
  if (!(elapsed >= 0)) {
    return { stale: false, dead: false, elapsed, indeterminate: true, reason: "monotonic clock went backwards within one boot: anomaly (fail closed, not stale)" };
  }
  return { stale: elapsed > thresholdSeconds, dead: false, elapsed, indeterminate: false, reason: elapsed > thresholdSeconds ? "heartbeat past staleness threshold" : "heartbeat fresh" };
}

const OID_RE = /^[0-9a-f]{40}$/;

function assertOid(oid, label) {
  if (typeof oid !== "string" || !OID_RE.test(oid)) {
    fail(WORKTREE_LEASE_DIAGNOSTIC_CODES.INVALID_ARG, `${label} must be a 40-hex object id, got: ${JSON.stringify(oid)}`);
  }
  return oid;
}

export function casPublishRef({ repo, ref, newOid, expectedOld, runGit = defaultRunGit }) {
  if (typeof repo !== "string" || repo.length === 0) {
    fail(WORKTREE_LEASE_DIAGNOSTIC_CODES.INVALID_ARG, "repo must be a non-empty string");
  }
  if (typeof ref !== "string" || ref.length === 0) {
    fail(WORKTREE_LEASE_DIAGNOSTIC_CODES.INVALID_ARG, "ref must be a non-empty string");
  }
  assertOid(newOid, "newOid");
  assertOid(expectedOld, "expectedOld");
  const res = runGit({ repo, args: ["update-ref", ref, newOid, expectedOld] });
  if (res && res.ok === true) {
    return { ok: true, ref, oldOid: expectedOld, newOid };
  }
  return { ok: false, rejected: true, ref, expectedOld, newOid, status: res?.status ?? null, stderr: res?.stderr ?? res?.error ?? null };
}

export function readRefOid({ repo, ref, runGit = defaultRunGit }) {
  const res = runGit({ repo, args: ["rev-parse", "--verify", "--quiet", ref] });
  if (!res || res.ok !== true) return ZERO_OID;
  const oid = res.stdout.trim();
  return OID_RE.test(oid) ? oid : ZERO_OID;
}

export function publishViaRefCas({
  repo,
  ref,
  fetch = () => {},
  merge,
  validateLease,
  runGit = defaultRunGit,
  maxAttempts = 3
}) {
  if (typeof merge !== "function") {
    fail(WORKTREE_LEASE_DIAGNOSTIC_CODES.INVALID_ARG, "merge must be a function returning the new tip oid");
  }
  if (typeof validateLease !== "function") {
    fail(WORKTREE_LEASE_DIAGNOSTIC_CODES.INVALID_ARG, "validateLease must be a function returning a boolean");
  }
  let lastRejection = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {

    fetch();
    if (!validateLease()) {
      fail(WORKTREE_LEASE_DIAGNOSTIC_CODES.LEASE_LOST, "lease no longer held before publish; aborting (no blind retry)");
    }
    const expectedOld = readRefOid({ repo, ref, runGit });
    const newOid = merge({ expectedOld, attempt });
    assertOid(newOid, "merge() result");
    const result = casPublishRef({ repo, ref, newOid, expectedOld, runGit });
    if (result.ok) return { ...result, attempts: attempt + 1 };
    lastRejection = result;

    if (!validateLease()) {
      fail(WORKTREE_LEASE_DIAGNOSTIC_CODES.LEASE_LOST, "CAS rejected and lease no longer held; aborting (no blind retry)", { rejection: result });
    }
  }
  fail(WORKTREE_LEASE_DIAGNOSTIC_CODES.CAS_REJECTED, `ref-CAS publish did not converge after ${maxAttempts} attempts`, { lastRejection });
  return null;
}

export function leaseRefFor(initiative) {
  assertInitiativeId(initiative);
  return `refs/agent-launch/lease/${initiative}`;
}

function buildLeaseRecord({ initiative, runId, identity, killShape, heartbeat }) {
  assertInitiativeId(initiative);
  assertIdentityShape(identity);
  assertKillShape(killShape);
  if (typeof runId !== "string" || runId.length === 0) {
    fail(WORKTREE_LEASE_DIAGNOSTIC_CODES.INVALID_ARG, "runId must be a non-empty string");
  }
  if (!heartbeat || typeof heartbeat.uptime !== "number" || typeof heartbeat.boot_id !== "string") {
    fail(WORKTREE_LEASE_DIAGNOSTIC_CODES.INVALID_ARG, "heartbeat must be { uptime:number, boot_id:string }");
  }
  return {
    schema_version: WORKTREE_LEASE_SCHEMA_VERSION,
    initiative,
    run_id: runId,

    process_identity: { pid: identity.pid, starttime: identity.starttime, boot_id: identity.boot_id },

    kill_shape: killShape,
    heartbeat: { uptime: heartbeat.uptime, boot_id: heartbeat.boot_id }
  };
}

function writeLeaseBlob({ repo, record, runGit }) {
  const body = `${JSON.stringify(record, null, 2)}\n`;
  const res = gitOrThrow(runGit, repo, ["hash-object", "-w", "--stdin"], "failed to write lease blob object", { input: body });
  const oid = res.stdout.trim();
  return assertOid(oid, "lease blob oid");
}

class LeaseHandle {
  constructor(brand, { repo, initiative, leaseRef, oid, record }) {
    if (brand !== LEASE_BRAND) {
      fail(WORKTREE_LEASE_DIAGNOSTIC_CODES.INVALID_ARG, "LeaseHandle is not externally constructible");
    }
    this.repo = repo;
    this.initiative = initiative;
    this.leaseRef = leaseRef;
    this.oid = oid;
    this.record = record;
    Object.freeze(this);
  }
}
const LEASE_BRAND = Symbol("worktree-lease.LeaseHandle");

export function acquireLease({ repo, initiative, runId, identity, killShape, heartbeat, runGit = defaultRunGit }) {
  const leaseRef = leaseRefFor(initiative);
  const record = buildLeaseRecord({ initiative, runId, identity, killShape, heartbeat });
  const oid = writeLeaseBlob({ repo, record, runGit });
  const result = casPublishRef({ repo, ref: leaseRef, newOid: oid, expectedOld: ZERO_OID, runGit });
  if (!result.ok) {
    fail(WORKTREE_LEASE_DIAGNOSTIC_CODES.LEASE_ACQUIRE_FAILED, `lease already held for ${initiative}; acquire (create) CAS rejected`, { rejection: result });
  }
  return new LeaseHandle(LEASE_BRAND, { repo, initiative, leaseRef, oid, record });
}

export function readLease({ repo, initiative, runGit = defaultRunGit }) {
  const leaseRef = leaseRefFor(initiative);
  const oid = readRefOid({ repo, ref: leaseRef, runGit });
  if (oid === ZERO_OID) return null;
  const res = runGit({ repo, args: ["cat-file", "-p", oid] });
  if (!res || res.ok !== true) return null;
  let record;
  try {
    record = JSON.parse(res.stdout);
  } catch {
    return null;
  }
  return { oid, record };
}

export function heartbeatLease(leaseHandle, { heartbeat, runGit = defaultRunGit } = {}) {
  assertLeaseHandle(leaseHandle);
  const record = buildLeaseRecord({
    initiative: leaseHandle.initiative,
    runId: leaseHandle.record.run_id,
    identity: leaseHandle.record.process_identity,
    killShape: leaseHandle.record.kill_shape,
    heartbeat
  });
  const oid = writeLeaseBlob({ repo: leaseHandle.repo, record, runGit });
  const result = casPublishRef({ repo: leaseHandle.repo, ref: leaseHandle.leaseRef, newOid: oid, expectedOld: leaseHandle.oid, runGit });
  if (!result.ok) {
    fail(WORKTREE_LEASE_DIAGNOSTIC_CODES.LEASE_LOST, "heartbeat CAS rejected: lease was stolen/superseded; this holder has lost it", { rejection: result });
  }
  return new LeaseHandle(LEASE_BRAND, { repo: leaseHandle.repo, initiative: leaseHandle.initiative, leaseRef: leaseHandle.leaseRef, oid, record });
}

function assertLeaseHandle(handle) {
  if (!(handle instanceof LeaseHandle)) {
    fail(WORKTREE_LEASE_DIAGNOSTIC_CODES.TOKEN_ORDER_VIOLATION, "expected a LeaseHandle from acquire/steal; got a non-handle (order violation)");
  }
}

const KILL_SHAPE_KINDS = new Set(["bwrap-pid", "process-group", "interactive-pid"]);

export function assertKillShape(killShape) {
  if (!killShape || typeof killShape !== "object" || !KILL_SHAPE_KINDS.has(killShape.kind)) {
    fail(
      WORKTREE_LEASE_DIAGNOSTIC_CODES.INVALID_ARG,
      `killShape.kind must be one of ${[...KILL_SHAPE_KINDS].join("|")}, got: ${JSON.stringify(killShape)}`
    );
  }
  if (killShape.kind === "process-group") {
    if (!Number.isInteger(killShape.pgid) || killShape.pgid <= 0) {
      fail(WORKTREE_LEASE_DIAGNOSTIC_CODES.INVALID_ARG, `process-group killShape needs pgid:int>0, got: ${JSON.stringify(killShape)}`);
    }
  } else if (!Number.isInteger(killShape.pid) || killShape.pid <= 0) {
    fail(WORKTREE_LEASE_DIAGNOSTIC_CODES.INVALID_ARG, `${killShape.kind} killShape needs pid:int>0, got: ${JSON.stringify(killShape)}`);
  }
  return killShape;
}

const TOKEN_BRAND = Symbol("worktree-lease.token");
class KillIssuedToken {
  constructor(brand, killShape, identity) {
    if (brand !== TOKEN_BRAND) fail(WORKTREE_LEASE_DIAGNOSTIC_CODES.INVALID_ARG, "token not externally constructible");
    this.killShape = killShape;
    this.identity = identity;
    Object.freeze(this);
  }
}
class ConfirmedDeadToken {
  constructor(brand, identity) {
    if (brand !== TOKEN_BRAND) fail(WORKTREE_LEASE_DIAGNOSTIC_CODES.INVALID_ARG, "token not externally constructible");
    this.identity = identity;
    Object.freeze(this);
  }
}
class CleanupCompleteToken {
  constructor(brand, integrationWorktreePath) {
    if (brand !== TOKEN_BRAND) fail(WORKTREE_LEASE_DIAGNOSTIC_CODES.INVALID_ARG, "token not externally constructible");
    this.integrationWorktreePath = integrationWorktreePath;
    Object.freeze(this);
  }
}

function assertToken(token, Ctor, stepName) {
  if (!(token instanceof Ctor)) {
    fail(
      WORKTREE_LEASE_DIAGNOSTIC_CODES.TOKEN_ORDER_VIOLATION,
      `${stepName} requires a ${Ctor.name} from the immediately-preceding takeover step; got ${token?.constructor?.name ?? typeof token} (fixed order: kill → confirm → cleanup → steal → first ref write)`
    );
  }
  return token;
}

export function killPriorHolder({ killShape, identity, signal = "SIGKILL", deps = defaultLivenessDeps }) {
  assertKillShape(killShape);
  assertIdentityShape(identity);
  const target = killShape.kind === "process-group" ? -killShape.pgid : killShape.pid;
  try {
    deps.sendSignal(target, signal);
  } catch (err) {

    if (err && err.code !== "ESRCH") {
      fail(WORKTREE_LEASE_DIAGNOSTIC_CODES.KILL_FAILED, `failed to signal ${target} with ${signal}: ${err.message}`, { errno: err.code ?? null }, err);
    }
  }
  return new KillIssuedToken(TOKEN_BRAND, killShape, identity);
}

export function confirmTermination(killIssuedToken, { identity, deps = defaultLivenessDeps, maxChecks = 50, sleep = defaultSleep, sleepMs = 20 } = {}) {
  assertToken(killIssuedToken, KillIssuedToken, "confirmTermination");
  assertIdentityShape(identity);
  for (let i = 0; i < maxChecks; i += 1) {
    const verdict = assessLiveness(identity, deps);
    if (verdict.state === "dead") {
      return new ConfirmedDeadToken(TOKEN_BRAND, identity);
    }
    if (verdict.state === "indeterminate") {
      fail(WORKTREE_LEASE_DIAGNOSTIC_CODES.CONFIRM_INDETERMINATE, `cannot confirm death (${verdict.reason}); refusing takeover (fail closed)`);
    }
    if (i < maxChecks - 1) sleep(sleepMs);
  }
  fail(WORKTREE_LEASE_DIAGNOSTIC_CODES.CONFIRM_STILL_LIVE, `prior holder still live after ${maxChecks} checks; refusing takeover (fail closed)`);
  return null;
}

function defaultSleep(ms) {
  if (!(ms > 0)) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function cleanIntegrationWorktree(confirmedDeadToken, { integrationWorktreePath, runGit = defaultRunGit } = {}) {
  assertToken(confirmedDeadToken, ConfirmedDeadToken, "cleanIntegrationWorktree");
  if (typeof integrationWorktreePath !== "string" || integrationWorktreePath.length === 0) {
    fail(WORKTREE_LEASE_DIAGNOSTIC_CODES.INVALID_ARG, "integrationWorktreePath must be a non-empty string");
  }
  const mergeHead = runGit({ repo: integrationWorktreePath, args: ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"] });
  if (mergeHead && mergeHead.ok === true) {

    gitOrThrow(runGit, integrationWorktreePath, ["merge", "--abort"], "failed to abort in-progress merge during takeover cleanup");
  }
  return new CleanupCompleteToken(TOKEN_BRAND, integrationWorktreePath);
}

export function stealLease(cleanupCompleteToken, { repo, initiative, runId, identity, killShape, heartbeat, runGit = defaultRunGit }) {
  assertToken(cleanupCompleteToken, CleanupCompleteToken, "stealLease");
  const leaseRef = leaseRefFor(initiative);
  const expectedOld = readRefOid({ repo, ref: leaseRef, runGit });
  const record = buildLeaseRecord({ initiative, runId, identity, killShape, heartbeat });
  const oid = writeLeaseBlob({ repo, record, runGit });
  const result = casPublishRef({ repo, ref: leaseRef, newOid: oid, expectedOld, runGit });
  if (!result.ok) {
    fail(WORKTREE_LEASE_DIAGNOSTIC_CODES.LEASE_STEAL_LOST, `lease-steal CAS rejected: another taker won or the lease advanced (expected-old ${expectedOld})`, { rejection: result });
  }
  return new LeaseHandle(LEASE_BRAND, { repo, initiative, leaseRef, oid, record });
}

export function firstRefWriteUnderLease(leaseHandle, { repo, ref, newOid, expectedOld, runGit = defaultRunGit }) {
  assertLeaseHandle(leaseHandle);
  return casPublishRef({ repo, ref, newOid, expectedOld, runGit });
}

export function resetWorktreeToIntegrationTip({
  mainRepo,
  launchRef,
  runId,
  retryId = 0,
  priorIdentity,
  deps = defaultLivenessDeps,
  runGit = defaultRunGit
}) {

  const resolved = resolveWorktreePath({ mainRepo, launchRef, runId, retryId });
  const worktreePath = resolved.worktree_path;
  const integrationRef = resolved.base_ref;

  const verdict = assessLiveness(priorIdentity, deps);
  if (verdict.state !== "dead") {
    fail(
      WORKTREE_LEASE_DIAGNOSTIC_CODES.RESET_REFUSED,
      `refusing reset --hard: prior holder is ${verdict.state} (${verdict.reason}); reset is gated on a confirmed death (fail closed)`,
      { worktreePath, integrationRef, liveness: verdict.state }
    );
  }

  gitOrThrow(
    runGit,
    worktreePath,
    ["reset", "--hard", integrationRef],
    `failed to reset worktree ${worktreePath} to integration tip ${integrationRef}`
  );
  const tip = gitOrThrow(runGit, worktreePath, ["rev-parse", "HEAD"], "failed to read reset HEAD");
  return Object.freeze({
    worktree_path: worktreePath,
    integration_ref: integrationRef,
    reset_to_sha: tip.stdout.trim(),
    liveness: verdict.state
  });
}
