

import { DatabaseSync } from "node:sqlite";
import { realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function isAgyConversationId(id) {
  return typeof id === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id);
}

export function readAgySessionFacts({ stateRoot, repo, nativeSessionId = null, afterStepIndex = -1 }) {
  const file = path.join(stateRoot, "conversation_summaries.db");
  const root = realpathSync(stateRoot);
  if (!realpathSync(file).startsWith(`${root}${path.sep}`)) throw new Error("agy_native_state_mismatched");
  const db = new DatabaseSync(file, { readOnly: true });
  let sessions;
  try {
    sessions = nativeSessionId === null
      ? db.prepare("SELECT conversation_id, workspace_uris, status FROM conversation_summaries LIMIT 2").all()
      : db.prepare("SELECT conversation_id, workspace_uris, status FROM conversation_summaries WHERE conversation_id = ?").all(nativeSessionId);
  } finally { db.close(); }
  if (sessions.length !== 1 || !isAgyConversationId(sessions[0].conversation_id) ||
      !sessions[0].workspace_uris ||
      JSON.stringify(JSON.parse(sessions[0].workspace_uris)) !== JSON.stringify([pathToFileURL(realpathSync(repo)).href])) {
    throw new Error("agy_native_conversation_identity_missing_or_mismatched");
  }
  const id = sessions[0].conversation_id;
  const conversation = path.join(stateRoot, "conversations", `${id}.db`);
  if (!realpathSync(conversation).startsWith(`${root}${path.sep}`)) throw new Error("agy_native_state_mismatched");
  const steps = new DatabaseSync(conversation, { readOnly: true });
  try {
    const identity = steps.prepare("SELECT cascade_id FROM trajectory_meta LIMIT 2").all();
    if (identity.length !== 1 || identity[0].cascade_id !== id) throw new Error("agy_native_conversation_identity_conflict");
    const rows = steps.prepare("SELECT idx, step_type, status, length(error_details) AS error_bytes FROM steps WHERE idx > ? ORDER BY idx LIMIT 2049").all(afterStepIndex);
    if (rows.length > 2048) throw new Error("agy_native_session_capture_limit");
    return { nativeSessionId: id, lastStepIndex: rows.at(-1)?.idx ?? afterStepIndex,
      completion: { ok: rows.length > 0 && sessions[0].status === "CASCADE_RUN_STATUS_IDLE" &&
        rows.at(-1)?.step_type === 15 && rows.every(row => row.status === 3 && !row.error_bytes),
        reason: "agy_native_state_incomplete_or_error" } };
  } finally { steps.close(); }
}

export function validateAgyResumeState(record, { repo, initiative, runtimeDir }) {
  if (!record || record.schema_version !== "agy-orchestrator-session.v1" || record.repo !== repo || record.subject !== initiative ||
      !isAgyConversationId(record.native_session_id) || !path.isAbsolute(record.native_state_root ?? "") ||
      !record.native_state_root.startsWith(`${runtimeDir}${path.sep}`) || !Number.isSafeInteger(record.native_last_step_index)) {
    throw new Error("agy_native_session_record_missing_or_mismatched");
  }
  if (!realpathSync(record.native_state_root).startsWith(`${realpathSync(runtimeDir)}${path.sep}`)) {
    throw new Error("agy_native_session_record_missing_or_mismatched");
  }
  const facts = readAgySessionFacts({ stateRoot: record.native_state_root, repo, nativeSessionId: record.native_session_id });
  if (facts.lastStepIndex !== record.native_last_step_index) throw new Error("agy_native_session_record_stale");
  return record;
}
