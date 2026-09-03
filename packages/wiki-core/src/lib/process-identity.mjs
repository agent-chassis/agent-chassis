

import { existsSync, readFileSync } from "node:fs";

export const NON_REUSABLE_PROCESS_IDENTITY_SCHEMA_VERSION = "non-reusable-process-identity.v1";

export const PROCESS_LIVENESS = Object.freeze({
  ALIVE: "alive",
  DEAD: "dead",
  INDETERMINATE: "indeterminate"
});

export const PROCESS_IDENTITY_DIAGNOSTIC_CODES = Object.freeze({
  INVALID_ARG: "process_identity_invalid_arg",
  UNAVAILABLE: "process_identity_unavailable",
  PID_UNREADABLE: "process_identity_pid_unreadable",
  STAT_UNPARSEABLE: "process_identity_stat_unparseable"
});

export class ProcessIdentityUnavailableError extends Error {
  constructor(message, { code, detail = null } = {}) {
    super(message);
    this.name = "ProcessIdentityUnavailableError";
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, message, detail = null) {
  throw new ProcessIdentityUnavailableError(message, { code, detail });
}

export const defaultProcessIdentityProbes = Object.freeze({
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
  }
});

export function parseStarttimeFromStat(statBody) {
  if (typeof statBody !== "string") return null;
  const rparen = statBody.lastIndexOf(")");
  if (rparen === -1) return null;
  const tail = statBody.slice(rparen + 1).trim();
  if (tail.length === 0) return null;
  const fields = tail.split(/\s+/u);
  const starttime = fields[19];
  if (typeof starttime !== "string" || !/^\d+$/u.test(starttime)) return null;
  return starttime;
}

export function processIdentityAvailable(probes = defaultProcessIdentityProbes) {
  if (!probes.procAvailable()) return false;
  const bootId = probes.readBootId();
  return typeof bootId === "string" && bootId.length > 0;
}

export function captureProcessIdentity(pid, probes = defaultProcessIdentityProbes) {
  if (!Number.isInteger(pid) || pid <= 0) {
    fail(PROCESS_IDENTITY_DIAGNOSTIC_CODES.INVALID_ARG,
      `pid must be a positive integer, got: ${JSON.stringify(pid)}`);
  }
  if (!probes.procAvailable()) {
    fail(PROCESS_IDENTITY_DIAGNOSTIC_CODES.UNAVAILABLE,
      `refusing to capture a process identity without /proc (fail closed): pid ${pid}`);
  }
  const bootId = probes.readBootId();
  if (typeof bootId !== "string" || bootId.length === 0) {
    fail(PROCESS_IDENTITY_DIAGNOSTIC_CODES.UNAVAILABLE,
      `boot_id unreadable; cannot capture an identity for pid ${pid}`);
  }
  const stat = probes.readProcStat(pid);
  if (stat === null) {
    fail(PROCESS_IDENTITY_DIAGNOSTIC_CODES.PID_UNREADABLE,
      `/proc/${pid}/stat is not readable (pid not live?)`);
  }
  const starttime = parseStarttimeFromStat(stat);
  if (starttime === null) {
    fail(PROCESS_IDENTITY_DIAGNOSTIC_CODES.STAT_UNPARSEABLE,
      `could not parse starttime (field 22) from /proc/${pid}/stat`);
  }
  return Object.freeze({ pid, starttime, boot_id: bootId });
}

export function isProcessIdentity(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    Number.isInteger(value.pid) &&
    value.pid > 0 &&
    typeof value.starttime === "string" &&
    value.starttime.length > 0 &&
    typeof value.boot_id === "string" &&
    value.boot_id.length > 0
  );
}

export function assessProcessLiveness(identity, probes = defaultProcessIdentityProbes) {
  if (!isProcessIdentity(identity)) {
    return Object.freeze({
      state: PROCESS_LIVENESS.INDETERMINATE,
      reason: "missing or malformed process identity: cannot confirm death (fail closed)"
    });
  }
  if (!probes.procAvailable()) {
    return Object.freeze({
      state: PROCESS_LIVENESS.INDETERMINATE,
      reason: "no /proc (non-Linux/missing): cannot confirm death (fail closed)"
    });
  }
  const currentBootId = probes.readBootId();
  if (typeof currentBootId !== "string" || currentBootId.length === 0) {
    return Object.freeze({
      state: PROCESS_LIVENESS.INDETERMINATE,
      reason: "boot_id unreadable: cannot confirm death (fail closed)"
    });
  }
  if (currentBootId !== identity.boot_id) {
    return Object.freeze({
      state: PROCESS_LIVENESS.DEAD,
      reason: "boot_id changed (reboot): the recorded holder is unconditionally dead"
    });
  }
  const stat = probes.readProcStat(identity.pid);
  if (stat === null) {
    return Object.freeze({
      state: PROCESS_LIVENESS.DEAD,
      reason: `/proc/${identity.pid} absent while /proc is readable: process gone`
    });
  }
  const currentStarttime = parseStarttimeFromStat(stat);
  if (currentStarttime === null) {
    return Object.freeze({
      state: PROCESS_LIVENESS.INDETERMINATE,
      reason: "unparseable stat: cannot confirm death (fail closed)"
    });
  }
  if (currentStarttime !== identity.starttime) {
    return Object.freeze({
      state: PROCESS_LIVENESS.DEAD,
      reason: "starttime mismatch: the pid was recycled, the recorded process is gone"
    });
  }
  return Object.freeze({
    state: PROCESS_LIVENESS.ALIVE,
    reason: "pid + starttime + boot_id all match: the recorded process is still live"
  });
}

export function processConfirmedDead(identity, probes = defaultProcessIdentityProbes) {
  return assessProcessLiveness(identity, probes).state === PROCESS_LIVENESS.DEAD;
}

const IDENTITY_PREFIX = "proc.v1";

export function formatProcessIdentity(identity) {
  if (!isProcessIdentity(identity)) {
    fail(PROCESS_IDENTITY_DIAGNOSTIC_CODES.INVALID_ARG,
      `cannot format a malformed process identity: ${JSON.stringify(identity)}`);
  }
  return `${IDENTITY_PREFIX}:pid=${identity.pid}:start=${identity.starttime}:boot=${identity.boot_id}`;
}

export function parseProcessIdentity(text) {
  if (typeof text !== "string") return null;
  const match = /^proc\.v1:pid=(\d+):start=(\d+):boot=([^:\s]+)$/u.exec(text.trim());
  if (match === null) return null;
  const pid = Number.parseInt(match[1], 10);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  return Object.freeze({ pid, starttime: match[2], boot_id: match[3] });
}
