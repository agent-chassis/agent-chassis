

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
  publishAttemptJournalEvents,
  readAttemptJournalEvents,
  readManagedRunProcessIdentity,
  replaceAtomically,
  serializeRecord,
  withAttemptPartitionLock,
  writeExclusive
} from "./managed-run-process-identity-store.mjs";

import {
  ATTEMPT_EVENT_KINDS,
  ATTEMPT_EXECUTION_LIVENESS,
  ATTEMPT_NEXT_COMMANDS,
  admitAttemptCommand,
  reduceAttemptJournal,
  sameAttempt as sameAttemptTuple
} from "@agent-chassis/agent-launch-core";

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

function retireAndReserveSuccessorViaJournal({
  mainRepo, subject, role, priorTuple, reason, evidence, deps, liveness
}) {
  if (typeof role !== "string" || role.length === 0) {
    fail(
      MANAGED_RUN_PROCESS_IDENTITY_CODES.INVALID_ARG,
      "a successor reservation requires a non-empty role"
    );
  }
  const repository = journalRepositoryFor(mainRepo);
  let ownerIdentity;
  let reservedAt;
  try {
    ownerIdentity = captureProcessIdentity(process.pid, deps);
    reservedAt = readSystemMonotonic(deps);
  } catch (error) {
    fail(
      MANAGED_RUN_PROCESS_IDENTITY_CODES.IDENTITY_CAPTURE_FAILED,
      "cannot capture the successor owner identity; refusing to reserve (fail closed)",
      { source_code: error?.code ?? null },
      error
    );
  }

  const locked = withAttemptPartitionLock({ mainRepo, repository, subject }, () => {
    const read = readAttemptJournalEvents({ mainRepo, repository, subject });
    if (read.refusal !== null) {
      return {
        retired: false, may_launch: false,
        verdict: MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.UNREADABLE,
        reason: "the managed-run attempt journal for this subject could not be read as a valid sequence",
        subject, reservation: null
      };
    }
    let events = read.events;
    const reduced = reduceAttemptJournal({ repository, subject, events, liveness });
    if (reduced.refusal !== null) {
      return {
        retired: false, may_launch: false,
        verdict: MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.UNREADABLE,
        reason: "the managed-run attempt journal for this subject could not be reduced",
        subject, reservation: null
      };
    }

    let retired = false;
    if (reduced.reservation.held === true) {
      const holder = reduced.reservation.holder;

      if (priorTuple === null) {
        const ownerVerdict = holderOwnerVerdict(events, reduced, deps);
        if (ownerVerdict !== MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.ABSENT) {
          return {
            retired: false, may_launch: false,
            verdict: ownerVerdict === MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.LIVE
              ? MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.RESERVED
              : ownerVerdict,
            reason: "the current subject reservation owner is not authenticated dead",
            subject, reservation: null
          };
        }
      }

      if (priorTuple !== null) {
        const bound = resolveDispatchTupleFor(events, holder);
        const matches = bound !== null &&
          sameAttemptTuple(normalizeManagedRunIdentityTuple(bound), normalizeManagedRunIdentityTuple(priorTuple));
        if (!matches) {
          return {
            retired: false, may_launch: false,
            verdict: MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.MISMATCHED,
            reason: "the exact prior attempt does not own the subject reservation",
            subject, reservation: null
          };
        }
      }
      const step = (kind, payload) => {
        const admitted = admitAttemptCommand({
          repository, subject, events, attempt: holder, kind, payload, liveness
        });
        if (admitted.admitted !== true) return admitted.refusal;
        events = admitted.events;
        return null;
      };
      if (reduced.current_attempt.terminal !== true) {
        const refusal = step(ATTEMPT_EVENT_KINDS.ATTEMPT_TERMINAL, { reason, evidence: evidence ?? null });
        if (refusal !== null) {
          return {
            retired: false, may_launch: false,
            verdict: MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.LIVE,
            reason: "the prior attempt is not terminal and retains its reservation without exact release proof",
            subject, reservation: null, refusal: refusal.code
          };
        }
      }
      const releaseRefusal = step(ATTEMPT_EVENT_KINDS.RESERVATION_RELEASED, {});
      if (releaseRefusal !== null) {
        return {
          retired: false, may_launch: false,
          verdict: MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.LIVE,
          reason: "the prior attempt retains its reservation without exact release proof",
          subject, reservation: null, refusal: releaseRefusal.code
        };
      }

      const bound = resolveDispatchTupleFor(events, holder);
      if (bound !== null) {
        const retirement = retireManagedRunProcessIdentity({
          mainRepo, tuple: normalizeManagedRunIdentityTuple(bound), reason, evidence, deps
        });
        if (retirement.retired !== true) {
          return { ...retirement, may_launch: false, subject, reservation: null };
        }
      }
      retired = true;
    }

    const reservationId = randomUUID();
    const attempt = reservationAttemptTuple(subject, reservationId);
    const frozen = frozenFactsFor({ reservationId });
    const claimed = admitAttemptCommand({
      repository, subject, events, attempt,
      kind: ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED,
      payload: {
        role,
        successor_reason: reason ?? null,
        owner_launcher: {
          pid: ownerIdentity.pid, starttime: ownerIdentity.starttime, boot_id: ownerIdentity.boot_id
        },
        reserved_at: { uptime: reservedAt.uptime, boot_id: reservedAt.boot_id }
      },
      generationDigest: frozen.generationDigest,
      wkTip: frozen.wkTip,
      liveness
    });
    if (claimed.admitted !== true) {
      return {
        retired: false, may_launch: false,
        verdict: MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.RESERVED,
        reason: "the successor reservation could not be claimed for this unit",
        subject, reservation: null
      };
    }

    publishAttemptJournalEvents({ mainRepo, repository, subject, events: claimed.events });
    return {
      retired,
      may_launch: true,
      verdict: MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.ABSENT,
      reason: "a successor reservation was established for this unit",
      subject,
      reservation: Object.freeze({
        schema_version: MANAGED_RUN_SUBJECT_RESERVATION_SCHEMA_VERSION,
        subject,
        reservation_id: reservationId,
        role,
        owner_launcher: {
          pid: ownerIdentity.pid, starttime: ownerIdentity.starttime, boot_id: ownerIdentity.boot_id
        },
        reserved_at: { uptime: reservedAt.uptime, boot_id: reservedAt.boot_id },
        tuple: null,
        attempt,
        file_path: managedRunSubjectReservationFilePath(mainRepo, subject)
      })
    };
  });

  if (locked.acquired !== true) {
    return Object.freeze({
      retired: false, may_launch: false,
      verdict: MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.RESERVED,
      reason: "another launcher is reserving a successor for this unit",
      subject, reservation: null
    });
  }
  return Object.freeze(locked.result);
}

export function retireProvenDeadAndReserveSuccessor({
  mainRepo,
  tuple,
  subject,
  role,
  reason,
  evidence,
  provenDeadSet = null,
  deps = defaultLivenessDeps,
  liveness = ATTEMPT_EXECUTION_LIVENESS.INDETERMINATE
} = {}) {
  if (provenDeadSet !== null) {
    return retireAndReserveSuccessorViaJournal({
      mainRepo, subject, role, priorTuple: null, reason, evidence, deps, liveness
    });
  }
  const normalized = normalizeManagedRunIdentityTuple(tuple);
  if (normalized.assigned_unit !== subject || typeof role !== "string" || role.length === 0) {
    fail(
      MANAGED_RUN_PROCESS_IDENTITY_CODES.INVALID_ARG,
      "a proven-dead successor requires the exact prior subject and a non-empty role"
    );
  }
  return retireAndReserveSuccessorViaJournal({
    mainRepo, subject, role, priorTuple: normalized, reason, evidence, deps, liveness
  });
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

function journalRepositoryFor(mainRepo) {
  return mainRepo;
}

function reservationAttemptTuple(subject, reservationId) {
  return Object.freeze({
    assigned_unit: subject,
    launch_ref: "managed-run-subject-reservation",
    run_id: reservationId,
    retry_id: 0
  });
}

function frozenFactsFor({ generationDigest = null, wkTip = null, reservationId }) {
  return {
    generationDigest: generationDigest ?? `reservation-generation:${reservationId}`,
    wkTip: wkTip ?? `reservation-tip:${reservationId}`
  };
}

function loadJournal(mainRepo, subject) {
  const repository = journalRepositoryFor(mainRepo);
  const read = readAttemptJournalEvents({ mainRepo, repository, subject });
  return { repository, ...read };
}

function reduceSubject(mainRepo, subject, liveness = ATTEMPT_EXECUTION_LIVENESS.INDETERMINATE) {
  const { repository, events, refusal } = loadJournal(mainRepo, subject);
  if (refusal !== null) return { repository, events, refusal, reduced: null };
  return {
    repository,
    events,
    refusal: null,
    reduced: reduceAttemptJournal({ repository, subject, events, liveness })
  };
}

function submitCommand({ mainRepo, subject, attempt, kind, payload = {}, generationDigest = null, wkTip = null, liveness = ATTEMPT_EXECUTION_LIVENESS.INDETERMINATE }) {
  const repository = journalRepositoryFor(mainRepo);
  const locked = withAttemptPartitionLock({ mainRepo, repository, subject }, () => {
    const read = readAttemptJournalEvents({ mainRepo, repository, subject });
    if (read.refusal !== null) return { admitted: false, refusal: read.refusal };
    const admitted = admitAttemptCommand({
      repository, subject, events: read.events, attempt, kind, payload,
      generationDigest, wkTip, liveness
    });
    if (admitted.admitted !== true) return { admitted: false, refusal: admitted.refusal };
    publishAttemptJournalEvents({ mainRepo, repository, subject, events: admitted.events });
    return { admitted: true, refusal: null, event: admitted.event, events: admitted.events };
  });
  if (locked.acquired !== true) {
    return { admitted: false, contended: true, refusal: null };
  }
  return { ...locked.result, contended: false };
}

function resolveAttempt({ events, reservationId = null, tuple = null }) {
  let byReservation = null;
  let byDispatch = null;
  for (const event of events) {
    if (reservationId !== null && event.attempt.run_id === reservationId) byReservation = event.attempt;
    if (tuple !== null && event.kind === ATTEMPT_EVENT_KINDS.PENDING_PUBLISHED) {
      const bound = event.payload?.dispatch_tuple ?? null;
      if (bound !== null && sameAttemptTuple(normalizeManagedRunIdentityTuple(bound), normalizeManagedRunIdentityTuple(tuple))) {
        byDispatch = event.attempt;
      }
    }
  }
  return byReservation ?? byDispatch;
}

const PRE_SPAWN_KINDS = new Set([
  ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED,
  ATTEMPT_EVENT_KINDS.PENDING_PUBLISHED,
  ATTEMPT_EVENT_KINDS.SUPERVISOR_BOUND
]);

function holderOwnerVerdict(events, reduced, deps) {
  const holder = reduced.reservation.holder;
  const claim = events.find((event) =>
    event.kind === ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED && sameAttemptTuple(event.attempt, holder));
  const owner = claim?.payload?.owner_launcher ?? null;
  if (owner === null || !isValidProcessIdentity(owner)) {
    return MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.UNRESOLVED;
  }
  try {
    const verdict = assessLiveness(owner, deps);
    if (verdict.state === "alive") return MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.LIVE;
    if (verdict.state === "dead") return MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.ABSENT;
    return MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.UNRESOLVED;
  } catch {
    return MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.UNREADABLE;
  }
}

function reclaimAbandonedPreSpawnAttempt({ mainRepo, subject, events, reduced, deps }) {
  if (reduced.reservation.held !== true) return { reclaimed: false };
  const holder = reduced.reservation.holder;
  if (!PRE_SPAWN_KINDS.has(reduced.current_attempt.last_kind)) return { reclaimed: false };
  const claim = events.find((event) =>
    event.kind === ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED && sameAttemptTuple(event.attempt, holder));
  const owner = claim?.payload?.owner_launcher ?? null;
  if (owner === null || !isValidProcessIdentity(owner)) return { reclaimed: false };
  let verdict;
  try {
    verdict = assessLiveness(owner, deps);
  } catch {
    return { reclaimed: false };
  }
  if (verdict.state !== "dead") return { reclaimed: false };

  const terminal = submitCommand({
    mainRepo, subject, attempt: holder,
    kind: ATTEMPT_EVENT_KINDS.ATTEMPT_TERMINAL,
    payload: { reason: "abandoned_before_spawn", owner_verdict: "dead" }
  });
  if (terminal.admitted !== true) return { reclaimed: false };
  const released = submitCommand({
    mainRepo, subject, attempt: holder,
    kind: ATTEMPT_EVENT_KINDS.RESERVATION_RELEASED, payload: {}
  });
  return { reclaimed: released.admitted === true };
}

export function acquireManagedRunSubjectReservation({
  mainRepo,
  subject,
  role,
  deps = defaultLivenessDeps,
  generationDigest = null,
  wkTip = null
} = {}) {
  if (typeof role !== "string" || role.length === 0) {
    fail(MANAGED_RUN_PROCESS_IDENTITY_CODES.INVALID_ARG, "role must be a non-empty string");
  }
  const { events, refusal, reduced } = reduceSubject(mainRepo, subject);
  if (refusal !== null || reduced === null || reduced.refusal !== null) {

    return Object.freeze({
      may_launch: false,
      verdict: MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.UNREADABLE,
      reason: "the managed-run attempt journal for this subject could not be read as a valid sequence",
      subject,
      reservation: null
    });
  }

  const currentTuple = reduced.current_attempt === null
    ? null
    : (resolveDispatchTupleFor(events, reduced.current_attempt.attempt) ?? null);
  const priorAttempt = assessPriorManagedAttemptsForSubject({ mainRepo, subject, currentTuple, deps });
  if (priorAttempt.may_launch !== true) {
    return Object.freeze({ ...priorAttempt, reservation: null });
  }
  let effective = reduced;
  if (effective.reservation.held === true) {

    const reclaim = reclaimAbandonedPreSpawnAttempt({ mainRepo, subject, events, reduced: effective, deps });
    if (reclaim.reclaimed === true) {
      const rereduced = reduceSubject(mainRepo, subject);
      if (rereduced.reduced !== null && rereduced.reduced.refusal === null) effective = rereduced.reduced;
    }
  }
  if (effective.reservation.held === true) {
    return Object.freeze({
      may_launch: false,
      verdict: MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.RESERVED,
      reason: "another launcher holds the managed-run subject reservation for this unit",
      subject,
      holder: Object.freeze({
        reservation_id: effective.reservation.holder.run_id,
        owner_verdict: holderOwnerVerdict(events, effective, deps),
        tuple: resolveDispatchTupleFor(events, effective.reservation.holder)
      }),
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
      "cannot capture the reserving launcher's own identity; refusing to reserve (fail closed)",
      { source_code: error?.code ?? null },
      error
    );
  }
  const reservationId = randomUUID();
  const attempt = reservationAttemptTuple(subject, reservationId);
  const frozen = frozenFactsFor({ generationDigest, wkTip, reservationId });
  const submitted = submitCommand({
    mainRepo, subject, attempt,
    kind: ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED,
    payload: {
      role,
      owner_launcher: {
        pid: ownerIdentity.pid,
        starttime: ownerIdentity.starttime,
        boot_id: ownerIdentity.boot_id
      },
      reserved_at: { uptime: reservedAt.uptime, boot_id: reservedAt.boot_id }
    },
    generationDigest: frozen.generationDigest,
    wkTip: frozen.wkTip
  });
  if (submitted.contended === true || submitted.admitted !== true) {
    return Object.freeze({
      may_launch: false,
      verdict: MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.RESERVED,
      reason: "another launcher holds the managed-run subject reservation for this unit",
      subject,
      reservation: null
    });
  }
  return Object.freeze({
    may_launch: true,
    verdict: MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.ABSENT,
    reason: "no prior managed attempt is recorded for this unit",
    subject,
    reservation: Object.freeze({
      schema_version: MANAGED_RUN_SUBJECT_RESERVATION_SCHEMA_VERSION,
      subject,
      reservation_id: reservationId,
      role,
      owner_launcher: {
        pid: ownerIdentity.pid,
        starttime: ownerIdentity.starttime,
        boot_id: ownerIdentity.boot_id
      },
      reserved_at: { uptime: reservedAt.uptime, boot_id: reservedAt.boot_id },
      tuple: null,
      attempt,
      file_path: managedRunSubjectReservationFilePath(mainRepo, subject)
    })
  });
}

function resolveDispatchTupleFor(events, attempt) {
  for (const event of events) {
    if (event.kind !== ATTEMPT_EVENT_KINDS.PENDING_PUBLISHED) continue;
    if (!sameAttemptTuple(event.attempt, attempt)) continue;
    const bound = event.payload?.dispatch_tuple ?? null;
    if (bound !== null) return bound;
  }
  return null;
}

export function attachTupleToManagedRunSubjectReservation({ mainRepo, reservation, tuple } = {}) {
  const normalized = normalizeManagedRunIdentityTuple(tuple);
  const subject = reservation?.subject;
  const attempt = reservation?.attempt ?? reservationAttemptTuple(subject, reservation?.reservation_id);
  const submitted = submitCommand({
    mainRepo, subject, attempt,
    kind: ATTEMPT_EVENT_KINDS.PENDING_PUBLISHED,
    payload: { dispatch_tuple: { ...normalized } }
  });
  if (submitted.admitted !== true) {
    fail(
      MANAGED_RUN_PROCESS_IDENTITY_CODES.RESERVATION_UNREADABLE,
      "the managed-run subject reservation is no longer held by this launcher",
      { subject: subject ?? null, refusal: submitted.refusal?.code ?? null }
    );
  }
  return Object.freeze({ ...reservation, tuple: normalized });
}

export function releaseManagedRunSubjectReservation({
  mainRepo,
  subject,
  reservationId = null,
  tuple = null,
  liveness = ATTEMPT_EXECUTION_LIVENESS.INDETERMINATE
} = {}) {
  const { events, refusal, reduced } = reduceSubject(mainRepo, subject, liveness);
  if (refusal !== null) return Object.freeze({ released: false, reason: "unreadable" });
  if (reduced === null || reduced.refusal !== null) return Object.freeze({ released: false, reason: "unreadable" });
  if (reduced.reservation.held !== true) return Object.freeze({ released: false, reason: "absent" });

  const addressed = resolveAttempt({ events, reservationId, tuple });
  if (addressed === null || !sameAttemptTuple(addressed, reduced.reservation.holder)) {
    return Object.freeze({ released: false, reason: "held_by_another_attempt" });
  }

  let working = events;
  if (reduced.current_attempt.terminal !== true) {
    const terminal = submitCommand({
      mainRepo, subject, attempt: addressed,
      kind: ATTEMPT_EVENT_KINDS.ATTEMPT_TERMINAL,
      payload: { reason: reservationId !== null ? "reservation_released_by_owner" : "retired_by_tuple" },
      liveness
    });
    if (terminal.admitted !== true) {
      return Object.freeze({
        released: false,
        reason: "retained_without_release_proof",
        refusal: terminal.refusal?.code ?? null
      });
    }
    working = terminal.events;
  }

  const released = submitCommand({
    mainRepo, subject, attempt: addressed,
    kind: ATTEMPT_EVENT_KINDS.RESERVATION_RELEASED,
    payload: {},
    liveness
  });
  if (released.admitted !== true) {
    return Object.freeze({
      released: false,
      reason: "retained_without_release_proof",
      refusal: released.refusal?.code ?? null
    });
  }
  return Object.freeze({
    released: true,
    reason: reservationId !== null ? "reservation_id" : "tuple",
    release_proof: released.event.payload.release_proof
  });
}
