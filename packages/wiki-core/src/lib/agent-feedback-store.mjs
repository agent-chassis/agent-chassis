import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { configureReadableSqlite, configureWritableSqlite, classifySqliteFailure } from './sqlite-runtime.mjs';
import { FeedbackError } from './agent-feedback-schema.mjs';

export const FEEDBACK_SCHEMA_VERSION = 'agent-feedback.v1';
export const FEEDBACK_ACQUISITION_MS = 1000;
export const FEEDBACK_POLL_MS = 25;
const SCHEMA = `
CREATE TABLE feedback_schema (singleton INTEGER PRIMARY KEY CHECK(singleton=1), version TEXT NOT NULL) STRICT;
CREATE TABLE feedback_sessions (session_id TEXT PRIMARY KEY, created_at TEXT NOT NULL) STRICT;
CREATE TABLE feedback_observations (
 feedback_id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES feedback_sessions(session_id),
 created_at TEXT NOT NULL, category TEXT NOT NULL, runtime_name TEXT NOT NULL, runtime_version TEXT NOT NULL,
 record_json TEXT NOT NULL
) STRICT;
CREATE INDEX feedback_order ON feedback_observations(created_at DESC, feedback_id DESC);
CREATE INDEX feedback_session ON feedback_observations(session_id);
`;
function assertSchema(db, initialize = false) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  if (tables.length === 0 && initialize) {
    db.exec(SCHEMA);
    db.prepare('INSERT INTO feedback_schema VALUES (1, ?)').run(FEEDBACK_SCHEMA_VERSION);
  } else {
    const marker = tables.some(row => row.name === 'feedback_schema')
      ? db.prepare('SELECT version FROM feedback_schema WHERE singleton=1').get() : null;
    if (marker?.version !== FEEDBACK_SCHEMA_VERSION) throw new FeedbackError('feedback_schema_unsupported',
      `Feedback schema is absent or unsupported; expected ${FEEDBACK_SCHEMA_VERSION}`);
  }
}
function storageFailure(cause, subject, detail = {}) {
  if (cause instanceof FeedbackError) return cause;
  const kind = classifySqliteFailure(cause);
  const sqliteNumber = typeof cause.errcode === 'number' ? cause.errcode & 0xff : null;
  const code = kind === 'contention' || [5, 6].includes(sqliteNumber) ? 'feedback_busy'
    : kind === 'coordination_unusable' || [11, 26].includes(sqliteNumber) ? 'feedback_corrupt'
      : ['EACCES', 'EPERM', 'EROFS'].includes(cause.code) || [3, 8, 14].includes(sqliteNumber) ||
        /permission denied|readonly|unable to open database/i.test(cause.message) ? 'feedback_permission_denied'
        : 'feedback_storage_failed';
  return new FeedbackError(code, `Feedback storage ${subject}: ${cause.message}`, { subject, ...detail }, cause);
}
async function acquire(db) {
  const deadline = Date.now() + FEEDBACK_ACQUISITION_MS;
  for (;;) {
    try {
      configureReadableSqlite(db);
      configureWritableSqlite(db);
      db.exec('BEGIN EXCLUSIVE'); return;
    } catch (cause) {
      if (storageFailure(cause, 'lock acquisition').code !== 'feedback_busy') throw cause;
      if (Date.now() >= deadline) throw new FeedbackError('feedback_busy',
        'Feedback storage is busy; recording could not acquire access.', { retryable: true }, cause);
      await delay(Math.min(FEEDBACK_POLL_MS, Math.max(0, deadline - Date.now())));
    }
  }
}

export async function appendFeedback(paths, input, context, { faultInjector = null } = {}) {
  const sessionId = input.new_session ? `fbs_${randomUUID()}` : input.session_id;
  const feedbackId = `fbo_${randomUUID()}`;
  const createdAt = new Date().toISOString();
  const record = { feedback_id: feedbackId, session_id: sessionId, created_at: createdAt,
    report: input.report, context,
    numeric_evidence_provenance: input.report.numeric_evidence ? 'agent_reported' : null };
  let db;
  let committing = false;
  let failure = null;
  try {
    mkdirSync(paths.stateRoot, { recursive: true, mode: 0o700 });
    db = new DatabaseSync(paths.databasePath, { timeout: 0 });

    await acquire(db);
    assertSchema(db, true);
    if (input.new_session) {
      db.prepare('INSERT INTO feedback_sessions VALUES (?, ?)').run(sessionId, createdAt);
      await faultInjector?.('after_session', db);
    } else if (!db.prepare('SELECT session_id FROM feedback_sessions WHERE session_id=?').get(sessionId)) {
      throw new FeedbackError('feedback_session_unknown', 'Feedback session is unknown in this repository', { subject: sessionId });
    }
    if (input.report.related_feedback_id && !db.prepare('SELECT feedback_id FROM feedback_observations WHERE feedback_id=?')
      .get(input.report.related_feedback_id)) throw new FeedbackError('feedback_reference_unknown',
        'Related feedback is unknown in this repository', { subject: input.report.related_feedback_id });
    db.prepare('INSERT INTO feedback_observations VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      feedbackId, sessionId, createdAt, input.report.category, context.runtime_package.name,
      context.runtime_package.version, JSON.stringify(record));
    await faultInjector?.('before_commit', db);
    committing = true;
    if (faultInjector) await faultInjector('commit', db);
    db.exec('COMMIT');
    committing = false;
  } catch (cause) {
    const uncertain = committing && db?.isTransaction === false;
    failure = storageFailure(cause, paths.databasePath, { effect: uncertain ? 'possibly_committed' : 'not_committed' });
    failure.detail = { subject: paths.databasePath, directory: paths.primaryRoot, ...failure.detail };
    if (committing) failure = new FeedbackError('feedback_commit_failed',
      `Feedback commit failed at ${paths.databasePath}: ${cause.message}`, {
        effect: uncertain ? 'possibly_committed' : 'not_committed',
        ...(uncertain ? { tentative_session_id: sessionId, tentative_feedback_id: feedbackId } : {}),
        subject: paths.databasePath, directory: paths.primaryRoot, cause_code: storageFailure(cause, paths.databasePath).code
      }, cause);
    if (db?.isTransaction) {
      try { db.exec('ROLLBACK'); } catch (rollbackCause) {
        failure.detail.rollback_failure = rollbackCause.message;
      }
    }
  } finally {
    if (db?.isOpen) {
      try { db.close(); } catch (cause) {
        if (failure) failure.detail.close_failure = cause.message;
        else failure = storageFailure(cause, paths.databasePath, { effect: 'committed',
          session_id: sessionId, feedback_id: feedbackId, directory: paths.primaryRoot });
      }
    }
  }
  if (failure) throw failure;
  return { session_id: sessionId, feedback_id: feedbackId };
}
