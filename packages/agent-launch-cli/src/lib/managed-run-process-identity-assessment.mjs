

import { assessLiveness, defaultLivenessDeps } from "./worktree-lease.mjs";

import {
  MANAGED_RUN_PROCESS_IDENTITY_CODES,
  MANAGED_RUN_PROCESS_IDENTITY_STATES,
  MANAGED_RUN_PROCESS_IDENTITY_VERDICTS,
  SPAWN_PERMISSIVE_VERDICTS,
  fail,
  isPlainObject,
  normalizeManagedRunIdentityTuple,
  sameTuple
} from "./managed-run-process-identity-contract.mjs";

import {
  enumerateStoredRecords,
  readManagedRunProcessIdentity
} from "./managed-run-process-identity-store.mjs";

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
  if (sandbox.state === "alive") {
    return verdict(
      MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.LIVE,
      sandbox.reason,
      { liveness }
    );
  }
  if (sandbox.state !== "dead") {

    return verdict(
      MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.UNRESOLVED,
      sandbox.reason,
      { liveness }
    );
  }

  return verdict(
    MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.PROVEN_DEAD,
    "the bound outer sandbox identity is provably dead",
    { liveness, boot_changed: sandbox.reason.includes("boot_id changed") }
  );
}

export function assessManagedRunProcessIdentity({ mainRepo, tuple, deps = defaultLivenessDeps } = {}) {
  const normalized = normalizeManagedRunIdentityTuple(tuple);
  const record = readManagedRunProcessIdentity({ mainRepo, tuple: normalized });
  const assessed = assessManagedRunProcessIdentityRecord(record, { expectedTuple: normalized, deps });
  return Object.freeze({ ...assessed, tuple: normalized });
}

export function assessPriorManagedAttemptsForSubject({
  mainRepo,
  subject,
  currentTuple = null,
  deps = defaultLivenessDeps,

  enumerate = enumerateStoredRecords
} = {}) {
  if (typeof subject !== "string" || subject.length === 0) {
    fail(MANAGED_RUN_PROCESS_IDENTITY_CODES.INVALID_ARG, "subject must be a non-empty string");
  }
  const V = MANAGED_RUN_PROCESS_IDENTITY_VERDICTS;

  const projectAssessed = (record, assessed, extra = null) => Object.freeze({
    may_launch: SPAWN_PERMISSIVE_VERDICTS.has(assessed.verdict),
    ...assessed,
    subject,
    tuple: normalizeManagedRunIdentityTuple(record.tuple),
    ...(extra ?? {})
  });

  if (currentTuple !== null) {
    let normalizedCurrent = null;
    try {
      normalizedCurrent = normalizeManagedRunIdentityTuple(currentTuple);
    } catch {
      normalizedCurrent = null;
    }
    if (normalizedCurrent !== null && normalizedCurrent.assigned_unit === subject) {
      const currentRecord = readManagedRunProcessIdentity({ mainRepo, tuple: normalizedCurrent });
      if (currentRecord !== null && currentRecord.unreadable === true) {
        return Object.freeze({
          may_launch: false,
          ...verdict(
            V.UNREADABLE,
            "the current managed attempt's durable identity record could not be read",
            { file_path: currentRecord.file_path ?? null }
          ),
          subject
        });
      }
      if (currentRecord !== null &&
          currentRecord.state !== MANAGED_RUN_PROCESS_IDENTITY_STATES.RETIRED) {
        const assessed = assessManagedRunProcessIdentityRecord(currentRecord, {
          expectedTuple: normalizedCurrent,
          deps
        });
        return projectAssessed(currentRecord, assessed, { current_attempt: true });
      }

    }
  }

  const { records, unreadable } = enumerate(mainRepo);
  if (unreadable.length > 0) {
    return Object.freeze({
      may_launch: false,
      ...verdict(
        V.UNREADABLE,
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
      ...verdict(V.ABSENT, "no prior managed attempt is recorded for this unit"),
      subject
    });
  }

  const assessedRecords = forSubject.map((record) => ({
    record,
    assessed: assessManagedRunProcessIdentityRecord(record, { deps })
  }));
  const byVerdict = (state) => assessedRecords.filter((entry) => entry.assessed.verdict === state);

  const live = byVerdict(V.LIVE);
  if (live.length === 1) return projectAssessed(live[0].record, live[0].assessed);
  if (live.length > 1) {

    return Object.freeze({
      may_launch: false,
      ...verdict(
        V.AMBIGUOUS,
        "more than one durable managed attempt is provably live for this unit",
        { live_attempt_count: live.length }
      ),
      subject
    });
  }

  for (const state of [V.PARTIAL, V.UNRESOLVED, V.UNREADABLE]) {
    const matched = byVerdict(state);
    if (matched.length === 1) return projectAssessed(matched[0].record, matched[0].assessed);
    if (matched.length > 1) {
      return Object.freeze({
        may_launch: false,
        ...verdict(
          state,
          `more than one durable managed attempt for this unit is ${state}`,
          { attempt_count: matched.length }
        ),
        subject
      });
    }
  }

  const dead = byVerdict(V.PROVEN_DEAD);
  if (dead.length === 1) return projectAssessed(dead[0].record, dead[0].assessed);
  if (dead.length > 1) {
    const provenDeadTuples = dead
      .map((entry) => normalizeManagedRunIdentityTuple(entry.record.tuple))
      .sort((a, b) => (a.run_id < b.run_id ? -1 : a.run_id > b.run_id ? 1 : 0));
    return Object.freeze({
      may_launch: false,
      ...verdict(
        V.PROVEN_DEAD,
        "every durable managed attempt for this unit is provably dead",
        { proven_dead_attempt_count: dead.length }
      ),
      subject,
      tuple: null,
      proven_dead_tuples: Object.freeze(provenDeadTuples)
    });
  }

  return Object.freeze({
    may_launch: false,
    ...verdict(V.UNREADABLE, "the managed attempts for this unit could not be mechanically classified"),
    subject
  });
}

export function deriveOuterSandboxKillShape({ pid, enforcement = undefined }) {
  const unenforcedPlainLaunch = isPlainObject(enforcement) && enforcement.enforced === false;
  return Object.freeze({ kind: unenforcedPlainLaunch ? "interactive-pid" : "bwrap-pid", pid });
}
