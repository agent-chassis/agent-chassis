

import { DatabaseSync } from "node:sqlite";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { isOpenCodeNativeSessionId, decodeOpenCodeEventStream } from "./workspace-agent-opencode-final-result.mjs";

export function openCodeDatabasePath(stateRoot) {
  return path.join(stateRoot, "data", "opencode", "opencode.db");
}

export function readOpenCodeSessionFacts({ stateRoot, repo, nativeSessionId = null, afterMessageId = null }) {
  const file = openCodeDatabasePath(stateRoot);
  if (!existsSync(file)) throw new Error("opencode_native_session_state_missing");
  if (!realpathSync(file).startsWith(`${realpathSync(stateRoot)}${path.sep}`)) {
    throw new Error("opencode_native_session_state_mismatched");
  }
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const sessions = db.prepare("SELECT id, directory FROM session WHERE parent_id IS NULL LIMIT 3").all();
    if (sessions.length !== 1 || !isOpenCodeNativeSessionId(sessions[0].id) ||
        realpathSync(sessions[0].directory) !== realpathSync(repo) ||
        (nativeSessionId !== null && sessions[0].id !== nativeSessionId)) {
      throw new Error("opencode_native_session_identity_ambiguous_or_mismatched");
    }
    const id = sessions[0].id;
    const rows = db.prepare("SELECT id, substr(data, 1, 1048577) AS data FROM message WHERE session_id = ? ORDER BY id LIMIT 2049").all(id);
    if (rows.length > 2048) throw new Error("opencode_native_session_capture_limit");
    if (rows.reduce((bytes, row) => bytes + Buffer.byteLength(row.data), 0) > 1024 * 1024) {
      throw new Error("opencode_native_session_capture_limit");
    }
    const messages = rows.filter(row => afterMessageId === null || row.id > afterMessageId);
    const events = [];
    let totalBytes = 0;
    for (const row of messages) {
      const info = JSON.parse(row.data);
      if (info.error) events.push({ type: "error", sessionID: id, error: info.error });
      if (info.role !== "assistant") continue;
      const parts = db.prepare("SELECT id, substr(data, 1, 1048577) AS data FROM part WHERE message_id = ? ORDER BY id LIMIT 2049").all(row.id);
      if (parts.length > 2048) throw new Error("opencode_native_session_capture_limit");
      for (const part of parts) {
        totalBytes += Buffer.byteLength(part.data);
        if (totalBytes > 1024 * 1024) throw new Error("opencode_native_session_capture_limit");
        const data = JSON.parse(part.data);
        const type = { "step-start": "step_start", "step-finish": "step_finish", tool: "tool_use",
          text: "text", reasoning: "reasoning" }[data.type];
        if (type) events.push({ type, sessionID: id, part: { ...data, id: part.id, messageID: row.id, sessionID: id } });
      }
    }
    return { nativeSessionId: id, lastMessageId: rows.at(-1)?.id ?? null,
      messages, events, completion: decodeOpenCodeEventStream(events.map(event => JSON.stringify(event)).join("\n")) };
  } finally { db.close(); }
}

export function validateOpenCodeResumeState(record, { repo, initiative, runtimeDir }) {
  if (!record || record.family !== "opencode" || record.repo !== repo || record.subject !== initiative ||
      !isOpenCodeNativeSessionId(record.native_session_id) || !path.isAbsolute(record.native_state_root ?? "") ||
      !record.native_state_root.startsWith(`${runtimeDir}${path.sep}`) || !record.native_last_message_id) {
    throw new Error("opencode_native_session_record_missing_or_mismatched");
  }

  const facts = readOpenCodeSessionFacts({ stateRoot: record.native_state_root, repo,
    nativeSessionId: record.native_session_id });
  if (facts.lastMessageId !== record.native_last_message_id) {
    throw new Error("opencode_native_session_record_stale");
  }

  const db = new DatabaseSync(openCodeDatabasePath(record.native_state_root), { readOnly: true });
  try {
    const row = db.prepare("SELECT substr(permission, 1, 65537) AS permission FROM session WHERE id = ?")
      .get(record.native_session_id);
    if (row.permission !== null) {
      if (row.permission.length > 65536) throw new Error("opencode_native_session_permissions_invalid");
      let rules;
      try { rules = JSON.parse(row.permission); }
      catch (cause) { throw new Error("opencode_native_session_permissions_invalid", { cause }); }
      if (!Array.isArray(rules) || rules.some(rule => typeof rule?.permission !== "string" ||
          typeof rule?.pattern !== "string" || rule.action !== "deny")) {
        throw new Error("opencode_native_session_permissions_override_launcher");
      }
    }
  } finally { db.close(); }
  return record;
}
