

import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, unlinkSync } from "node:fs";

import {
  assessLiveness,
  captureProcessIdentity,
  defaultLivenessDeps,
  readSystemMonotonic
} from "./worktree-lease.mjs";

import {
  MANAGED_RUN_PROCESS_IDENTITY_CODES,
  MANAGED_RUN_PROCESS_IDENTITY_RETIREMENT_REASONS,
  MANAGED_RUN_PROCESS_IDENTITY_VERDICTS,
  fail,
  hasExactKeys,
  normalizeManagedRunIdentityTuple,
  sameTuple
} from "./managed-run-process-identity-contract.mjs";

import {
  isValidProcessIdentity,
  isValidPublishedAt,
  isValidStoredTuple,
  managedRunProcessIdentityStoreDir,
  readManagedRunProcessIdentity,
  replaceAtomically,
  serializeRecord,
  writeExclusive
} from "./managed-run-process-identity-store.mjs";

import {
  assessManagedRunProcessIdentityRecord,
  assessPriorManagedAttemptsForSubject
} from "./managed-run-process-identity-assessment.mjs";

import { retireManagedRunProcessIdentity } from "./managed-run-process-identity-retirement.mjs";

export const MANAGED_RUN_SUBJECT_RESERVATION_SCHEMA_VERSION =
  "managed-run-subject-reservation.v1";

export const MANAGED_RUN_SUBJECT_SUCCESSOR_GUARD_SCHEMA_VERSION =
  "managed-run-subject-successor-guard.v1";

const RESERVATION_KEYS = Object.freeze([
  "schema_version", "subject", "reservation_id", "role", "owner_launcher", "reserved_at", "tuple"
]);

const SUCCESSOR_GUARD_KEYS = Object.freeze([
  "schema_version", "subject", "guard_id", "owner_launcher", "acquired_at"
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

export function managedRunSubjectSuccessorGuardFilePath(mainRepo, subject) {
  return `${managedRunSubjectReservationFilePath(mainRepo, subject)}.successor`;
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

function parseSuccessorGuardBody(body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!hasExactKeys(parsed, SUCCESSOR_GUARD_KEYS)) return null;
  if (parsed.schema_version !== MANAGED_RUN_SUBJECT_SUCCESSOR_GUARD_SCHEMA_VERSION) return null;
  if (typeof parsed.subject !== "string" || parsed.subject.length === 0) return null;
  if (typeof parsed.guard_id !== "string" || parsed.guard_id.length === 0) return null;
  if (!isValidProcessIdentity(parsed.owner_launcher)) return null;
  if (!isValidPublishedAt(parsed.acquired_at)) return null;
  return parsed;
}

function readSuccessorGuard(guardPath) {
  let body;
  try {
    body = readFileSync(guardPath, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    return { unreadable: true, errno: err?.code ?? null };
  }
  const parsed = parseSuccessorGuardBody(body);
  return parsed === null ? { unreadable: true, errno: null } : parsed;
}

function releaseSuccessorGuard(guardPath, guardId) {
  const held = readSuccessorGuard(guardPath);
  if (held === null) return Object.freeze({ released: false, reason: "absent" });
  if (held.unreadable === true) return Object.freeze({ released: false, reason: "unreadable" });
  if (held.guard_id !== guardId) {
    return Object.freeze({ released: false, reason: "held_by_another_launcher" });
  }
  try {
    unlinkSync(guardPath);
  } catch (error) {
    if (error?.code === "ENOENT") return Object.freeze({ released: false, reason: "absent" });
    throw error;
  }
  return Object.freeze({ released: true, reason: "guard_id" });
}

function successorGuardIsProvablyAbandoned({ held, deps }) {
  let owner;
  try {
    owner = assessLiveness(held.owner_launcher, deps);
  } catch {
    return { abandoned: false, verdict: MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.UNREADABLE };
  }
  if (owner.state === "dead") {
    return { abandoned: true, verdict: MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.ABSENT };
  }
  return {
    abandoned: false,
    verdict: owner.state === "alive"
      ? MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.LIVE
      : MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.UNRESOLVED
  };
}

function acquireSuccessorGuard({ guardPath, subject, deps }) {
  let ownerIdentity;
  let acquiredAt;
  try {
    ownerIdentity = captureProcessIdentity(process.pid, deps);
    acquiredAt = readSystemMonotonic(deps);
  } catch (error) {
    fail(
      MANAGED_RUN_PROCESS_IDENTITY_CODES.IDENTITY_CAPTURE_FAILED,
      "cannot capture the successor guard owner identity; refusing to reserve (fail closed)",
      { source_code: error?.code ?? null },
      error
    );
  }
  const guard = {
    schema_version: MANAGED_RUN_SUBJECT_SUCCESSOR_GUARD_SCHEMA_VERSION,
    subject,
    guard_id: randomUUID(),
    owner_launcher: {
      pid: ownerIdentity.pid,
      starttime: ownerIdentity.starttime,
      boot_id: ownerIdentity.boot_id
    },
    acquired_at: { uptime: acquiredAt.uptime, boot_id: acquiredAt.boot_id }
  };
  const contended = (verdict, reason) => Object.freeze({ acquired: false, verdict, reason });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeExclusive(guardPath, serializeRecord(guard));
      return Object.freeze({ acquired: true, guard: Object.freeze(guard) });
    } catch (error) {
      if (error?.code !== MANAGED_RUN_PROCESS_IDENTITY_CODES.STORE_COLLISION) throw error;
      if (attempt === 1) {
        return contended(
          MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.RESERVED,
          "another launcher is reserving a successor for this unit"
        );
      }
      const held = readSuccessorGuard(guardPath);
      if (held === null) continue;
      if (held.unreadable === true) {
        return contended(
          MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.UNREADABLE,
          "the managed-run subject successor guard exists but could not be read as a valid guard"
        );
      }
      const abandonment = successorGuardIsProvablyAbandoned({ held, deps });
      if (!abandonment.abandoned) {
        return contended(
          abandonment.verdict === MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.UNREADABLE
            ? MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.UNREADABLE
            : MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.RESERVED,
          "another launcher holds the managed-run subject successor guard for this unit"
        );
      }
      releaseSuccessorGuard(guardPath, held.guard_id);
    }
  }
  return contended(
    MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.RESERVED,
    "the managed-run subject successor guard could not be acquired"
  );
}

function reserveSuccessorForProvenDeadNoDeliverySet({ mainRepo, subject, role, provenDeadSet, deps }) {
  if (typeof subject !== "string" || subject.length === 0 ||
      typeof role !== "string" || role.length === 0) {
    fail(
      MANAGED_RUN_PROCESS_IDENTITY_CODES.INVALID_ARG,
      "a proven-dead no-delivery successor requires the exact subject and a non-empty role"
    );
  }
  if (!Array.isArray(provenDeadSet) || provenDeadSet.length === 0) {
    fail(
      MANAGED_RUN_PROCESS_IDENTITY_CODES.INVALID_ARG,
      "a proven-dead no-delivery successor requires a non-empty proven-dead set"
    );
  }
  for (const member of provenDeadSet) {
    const memberTuple = normalizeManagedRunIdentityTuple(member?.tuple);
    if (memberTuple.assigned_unit !== subject) {
      fail(
        MANAGED_RUN_PROCESS_IDENTITY_CODES.INVALID_ARG,
        "every proven-dead attempt in the set must name the exact subject"
      );
    }
  }
  const filePath = managedRunSubjectReservationFilePath(mainRepo, subject);

  const guardPath = managedRunSubjectSuccessorGuardFilePath(mainRepo, subject);
  const reservedRefusal = (reason) => Object.freeze({
    retired: false,
    may_launch: false,
    verdict: MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.RESERVED,
    reason,
    subject,
    reservation: null
  });
  const guard = acquireSuccessorGuard({ guardPath, subject, deps });
  if (guard.acquired !== true) {
    return Object.freeze({
      retired: false,
      may_launch: false,
      verdict: guard.verdict,
      reason: guard.reason,
      subject,
      reservation: null
    });
  }
  try {

    const held = readReservation(filePath);
    if (held !== null) {
      if (held.unreadable === true) {
        return Object.freeze({
          retired: false,
          may_launch: false,
          verdict: MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.UNREADABLE,
          reason: "the managed-run subject reservation exists but could not be read",
          subject,
          reservation: null
        });
      }
      const abandonment = reservationIsProvablyAbandoned({ mainRepo, held, deps });
      if (!abandonment.abandoned) {
        return reservedRefusal("a managed-run subject reservation already designates an attempt for this unit");
      }

      try {
        unlinkSync(filePath);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    let ownerIdentity;
    let reservedAt;
    try {
      ownerIdentity = captureProcessIdentity(process.pid, deps);
      reservedAt = readSystemMonotonic(deps);
    } catch (error) {
      fail(
        MANAGED_RUN_PROCESS_IDENTITY_CODES.IDENTITY_CAPTURE_FAILED,
        "cannot capture the proven-dead no-delivery successor launcher identity",
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
    try {
      writeExclusive(filePath, serializeRecord(successor));
    } catch (error) {
      if (error?.code === MANAGED_RUN_PROCESS_IDENTITY_CODES.STORE_COLLISION) {
        return reservedRefusal("another launcher won the successor reservation for this unit");
      }
      throw error;
    }
    const readBack = readReservation(filePath);
    if (readBack === null || readBack.unreadable === true ||
        readBack.reservation_id !== successor.reservation_id || readBack.tuple !== null) {
      fail(
        MANAGED_RUN_PROCESS_IDENTITY_CODES.RESERVATION_UNREADABLE,
        "the proven-dead no-delivery successor reservation did not round-trip"
      );
    }
    return Object.freeze({
      retired: false,
      may_launch: true,
      verdict: MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.ABSENT,
      reason: "the complete proven-dead no-delivery set was mechanically superseded by a fresh successor reservation",
      subject,
      reservation: Object.freeze({ ...successor, file_path: filePath })
    });
  } finally {
    releaseSuccessorGuard(guardPath, guard.guard.guard_id);
  }
}

export function retireProvenDeadAndReserveSuccessor({
  mainRepo,
  tuple,
  subject,
  role,
  reason,
  evidence,

  provenDeadSet = null,
  deps = defaultLivenessDeps
} = {}) {

  if (provenDeadSet !== null) {
    return reserveSuccessorForProvenDeadNoDeliverySet({ mainRepo, subject, role, provenDeadSet, deps });
  }
  const normalized = normalizeManagedRunIdentityTuple(tuple);
  if (normalized.assigned_unit !== subject || typeof role !== "string" || role.length === 0) {
    fail(
      MANAGED_RUN_PROCESS_IDENTITY_CODES.INVALID_ARG,
      "a proven-dead successor requires the exact prior subject and a non-empty role"
    );
  }
  const filePath = managedRunSubjectReservationFilePath(mainRepo, subject);

  const guardPath = managedRunSubjectSuccessorGuardFilePath(mainRepo, subject);
  const guard = acquireSuccessorGuard({ guardPath, subject, deps });
  if (guard.acquired !== true) {
    return Object.freeze({
      retired: false,
      may_launch: false,
      verdict: guard.verdict,
      reason: guard.reason,
      subject,
      reservation: null
    });
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
      reason,
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
        "the prior reservation changed before successor publication",
        { subject }
      );
    }
    replaceAtomically(filePath, serializeRecord(successor));
    const readBack = readReservation(filePath);
    if (readBack === null || readBack.unreadable === true ||
        readBack.reservation_id !== successor.reservation_id || readBack.tuple !== null) {
      fail(
        MANAGED_RUN_PROCESS_IDENTITY_CODES.RESERVATION_UNREADABLE,
        "the successor reservation did not round-trip"
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
    releaseSuccessorGuard(guardPath, guard.guard.guard_id);
  }
}

export function retireManagedRunAndReserveCorrectiveSuccessor(args = {}) {
  return retireProvenDeadAndReserveSuccessor({
    ...args,
    reason: MANAGED_RUN_PROCESS_IDENTITY_RETIREMENT_REASONS.CORRECTIVE_SUPERSESSION
  });
}

export function retireNoCommitAndReserveSuccessor(args = {}) {
  return retireProvenDeadAndReserveSuccessor({
    ...args,
    reason: MANAGED_RUN_PROCESS_IDENTITY_RETIREMENT_REASONS.NO_COMMIT_BASE_EQUAL
  });
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
  const filePath = managedRunSubjectReservationFilePath(mainRepo, subject);

  const heldReservation = readReservation(filePath);
  const currentTuple = heldReservation !== null && heldReservation.unreadable !== true
    ? (heldReservation.tuple ?? null)
    : null;

  const priorAttempt = assessPriorManagedAttemptsForSubject({ mainRepo, subject, currentTuple, deps });
  if (priorAttempt.may_launch !== true) {
    return Object.freeze({ ...priorAttempt, reservation: null });
  }
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
