

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  ATTEMPT_EXECUTION_LIVENESS,
  ATTEMPT_IMPORT_CLASSES,
  admitLegacyImport,
  canonicalJson
} from "@agent-chassis/agent-launch-core";

import {
  publishAttemptJournalEvents,
  readAttemptJournalEvents,
  managedRunProcessIdentityStoreDir,
  withAttemptPartitionLock
} from "./managed-run-process-identity-store.mjs";

import { assessLiveness, defaultLivenessDeps } from "./worktree-lease.mjs";

export const MANAGED_RUN_HISTORICAL_RESERVATION_CENSUS_SCHEMA_VERSION =
  "managed-run-historical-reservation-census.v1";

export const CENSUS_RESIDUE_REASONS = Object.freeze({
  UNPARSEABLE: "legacy_artifact_unparseable",
  UNKNOWN_SHAPE: "legacy_artifact_unknown_shape",
  SUBJECT_UNAUTHENTICATED: "legacy_subject_unauthenticated",
  CONFLICTING_SUBJECT_BINDING: "legacy_conflicting_subject_binding",
  IMPORT_REFUSED: "reducer_refused_import"
});

export const CENSUS_MAX_ARTIFACTS = 10000;

function evidenceDigest(parts) {
  return `sha256:${createHash("sha256").update(canonicalJson(parts)).digest("hex")}`;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeLegacyRecord({ repository, filePath, body, deps }) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { residue: CENSUS_RESIDUE_REASONS.UNPARSEABLE, subject: null };
  }
  if (!isPlainObject(parsed)) {
    return { residue: CENSUS_RESIDUE_REASONS.UNKNOWN_SHAPE, subject: null };
  }

  const tuple = isPlainObject(parsed.tuple) ? parsed.tuple : null;
  if (tuple === null) {
    return { residue: CENSUS_RESIDUE_REASONS.SUBJECT_UNAUTHENTICATED, subject: null };
  }
  const subject = typeof parsed.subject === "string" && parsed.subject.length > 0
    ? parsed.subject
    : (typeof tuple.assigned_unit === "string" ? tuple.assigned_unit : null);
  if (subject === null) {
    return { residue: CENSUS_RESIDUE_REASONS.SUBJECT_UNAUTHENTICATED, subject: null };
  }

  if (typeof parsed.subject === "string" && parsed.subject.length > 0 &&
      typeof tuple.assigned_unit === "string" && parsed.subject !== tuple.assigned_unit) {
    return { residue: CENSUS_RESIDUE_REASONS.CONFLICTING_SUBJECT_BINDING, subject: null };
  }

  let liveness = ATTEMPT_EXECUTION_LIVENESS.INDETERMINATE;
  const sandbox = isPlainObject(parsed.sandbox_identity) ? parsed.sandbox_identity : null;
  if (sandbox !== null) {
    try {
      const verdict = assessLiveness(sandbox, deps);
      liveness = verdict.state === "alive"
        ? ATTEMPT_EXECUTION_LIVENESS.LIVE
        : verdict.state === "dead"
          ? ATTEMPT_EXECUTION_LIVENESS.DEAD
          : ATTEMPT_EXECUTION_LIVENESS.INDETERMINATE;
    } catch {
      liveness = ATTEMPT_EXECUTION_LIVENESS.INDETERMINATE;
    }
  }

  const state = typeof parsed.state === "string" ? parsed.state : null;
  const retirement = isPlainObject(parsed.retirement) ? parsed.retirement : null;
  const evidence = {
    evidence_digest: evidenceDigest([MANAGED_RUN_HISTORICAL_RESERVATION_CENSUS_SCHEMA_VERSION, filePath, body]),
    repository,
    subject,
    attempt: {
      assigned_unit: tuple.assigned_unit,
      launch_ref: tuple.launch_ref,
      run_id: tuple.run_id,
      retry_id: Number.isInteger(tuple.retry_id) ? tuple.retry_id : 0
    },

    generation_digest: `legacy-generation:${evidenceDigest([filePath])}`,
    wk_tip: `legacy-tip:${evidenceDigest([filePath])}`,

    reached_spawn: state === "bound" || state === "retired",
    execution_terminated: liveness === ATTEMPT_EXECUTION_LIVENESS.DEAD && sandbox !== null,
    delivery_completed: retirement !== null &&
      retirement.reason === "finalized_integration",
    slice_ref_equals_base: retirement !== null &&
      retirement.reason === "no_commit_base_equal",
    liveness
  };
  return { residue: null, subject, evidence };
}

export function enumerateLegacyReservationArtifacts(mainRepo) {
  const dir = managedRunProcessIdentityStoreDir(mainRepo);
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (error) {
    if (error && error.code === "ENOENT") return { artifacts: [], unreadable: [], truncated: false };
    return { artifacts: [], unreadable: [{ file_path: dir, errno: error?.code ?? null }], truncated: false };
  }
  const artifacts = [];
  const unreadable = [];
  let truncated = false;
  for (const entry of entries.slice().sort()) {
    if (!entry.endsWith(".json") && !entry.endsWith(".successor")) continue;
    if (artifacts.length + unreadable.length >= CENSUS_MAX_ARTIFACTS) { truncated = true; break; }
    const filePath = path.join(dir, entry);
    try {
      artifacts.push({ file_path: filePath, body: readFileSync(filePath, "utf8") });
    } catch (error) {
      unreadable.push({ file_path: filePath, errno: error?.code ?? null });
    }
  }
  return { artifacts, unreadable, truncated };
}

export function runHistoricalReservationCensus({
  mainRepo,
  repository = mainRepo,
  apply = false,
  deps = defaultLivenessDeps
} = {}) {
  const { artifacts, unreadable, truncated } = enumerateLegacyReservationArtifacts(mainRepo);

  const classes = Object.fromEntries(Object.values(ATTEMPT_IMPORT_CLASSES).map((name) => [name, 0]));
  const residue = [];
  const subjects = new Set();
  const attempts = new Set();
  const perSubject = new Map();

  for (const record of unreadable) {
    residue.push(Object.freeze({
      file_path: record.file_path,
      reason: CENSUS_RESIDUE_REASONS.UNPARSEABLE,
      subject: null,
      errno: record.errno ?? null
    }));
  }

  for (const artifact of artifacts) {
    const normalized = normalizeLegacyRecord({
      repository, filePath: artifact.file_path, body: artifact.body, deps
    });
    if (normalized.residue !== null) {

      residue.push(Object.freeze({
        file_path: artifact.file_path,
        reason: normalized.residue,
        subject: normalized.subject,
        errno: null
      }));
      classes[ATTEMPT_IMPORT_CLASSES.OPERATOR_ONLY_RESIDUE] += 1;
      continue;
    }
    const { evidence, subject } = normalized;
    subjects.add(subject);
    attempts.add(canonicalJson(evidence.attempt));
    if (!perSubject.has(subject)) perSubject.set(subject, []);
    perSubject.get(subject).push({ evidence, file_path: artifact.file_path });
  }

  const subjectResults = [];
  for (const [subject, records] of perSubject) {
    const outcome = { subject, imported: 0, classes: {}, refusals: [] };
    const mutate = () => {
      const read = readAttemptJournalEvents({ mainRepo, repository, subject });
      if (read.refusal !== null) {
        outcome.refusals.push(read.refusal.code);
        for (const record of records) {
          residue.push(Object.freeze({
            file_path: record.file_path,
            reason: CENSUS_RESIDUE_REASONS.IMPORT_REFUSED,
            subject,
            errno: null
          }));
          classes[ATTEMPT_IMPORT_CLASSES.OPERATOR_ONLY_RESIDUE] += 1;
        }
        return;
      }
      let events = read.events;
      let changed = false;
      for (const record of records) {
        const admitted = admitLegacyImport({ repository, subject, events, evidence: record.evidence });
        const name = admitted.class;
        classes[name] = (classes[name] ?? 0) + 1;
        outcome.classes[name] = (outcome.classes[name] ?? 0) + 1;
        if (admitted.admitted !== true) {
          outcome.refusals.push(admitted.refusal?.code ?? "import_refused");
          residue.push(Object.freeze({
            file_path: record.file_path,
            reason: CENSUS_RESIDUE_REASONS.IMPORT_REFUSED,
            subject,
            errno: null
          }));
          continue;
        }
        if (admitted.imported === true) {
          events = admitted.events;
          changed = true;
          outcome.imported += 1;
        }
      }
      if (apply && changed) {
        publishAttemptJournalEvents({ mainRepo, repository, subject, events });
      }
    };
    const locked = withAttemptPartitionLock({ mainRepo, repository, subject }, mutate);
    if (locked.acquired !== true) outcome.refusals.push("partition_contended");
    subjectResults.push(Object.freeze({ ...outcome, classes: Object.freeze({ ...outcome.classes }) }));
  }

  return Object.freeze({
    schema_version: MANAGED_RUN_HISTORICAL_RESERVATION_CENSUS_SCHEMA_VERSION,
    applied: apply === true,
    denominators: Object.freeze({
      total_artifacts: artifacts.length + unreadable.length,
      total_subjects: subjects.size,
      total_attempts: attempts.size,
      classes: Object.freeze({ ...classes }),
      operator_only_residue: residue.length,
      truncated
    }),
    subjects: Object.freeze(subjectResults),

    residue: Object.freeze(residue.slice(0, CENSUS_MAX_ARTIFACTS))
  });
}
