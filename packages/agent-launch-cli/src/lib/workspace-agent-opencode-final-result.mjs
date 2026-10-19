

import { BACKEND_MISSING_RESULT_CODES } from "@agent-chassis/agent-launch-core";
import { buildMissingResultPayload } from "./workspace-agent-launch-core.mjs";
import { buildFinalResultEnvelope, buildFindingsPayload } from "./workspace-agent-family-adapter-core.mjs";
import { normalizeFinalResultWithStructuredRoleResult } from "./workspace-agent-dispatch-final-result-evidence.mjs";

export const OPENCODE_EVENT_PROTOCOL_VERSION = "1.19.3";

export async function captureOpenCodeSchemaFinalResult({ sessionState, exit, role, subject }) {
  await sessionState.work;
  const missing = (reason, detail) => buildMissingResultPayload(
    BACKEND_MISSING_RESULT_CODES.FINAL_REPORT_NOT_CAPTURED, reason, detail);
  if (sessionState.error !== null) return missing(sessionState.error.code ?? "opencode_schema_session_failed",
    { message: sessionState.error.message, detail: sessionState.error.detail ?? null });
  if (!sessionState.teardownRequested || exit?.code !== null || exit?.signal !== "SIGTERM" || exit?.error) {
    return missing("opencode_schema_service_failed", { exit });
  }
  const result = sessionState.result;
  if (!result) return missing("opencode_schema_report_missing", null);
  const raw = buildFinalResultEnvelope({ kind: "findings", payload: buildFindingsPayload({
    schemaVersion: "opencode-schema-message.v1", format: "json", role, subject,
    source: { native_session_id: result.nativeSessionId, native_message_id: result.terminalMessageId,
      native_request_message_id: result.requestMessageId, native_version: OPENCODE_EVENT_PROTOCOL_VERSION,
      native_completion: "structured", service_teardown: "SIGTERM",
      ...(sessionState.usageError ? { native_usage_error: {
        code: sessionState.usageError.code ?? "opencode_schema_usage_failed", message: sessionState.usageError.message } } : {})
    }, text: JSON.stringify(result.report) }) });
  const validated = normalizeFinalResultWithStructuredRoleResult(raw, { role, subject,
    terminal_structured_role_result_mode: "schema_constrained" });
  if (validated.structured_role_result?.valid !== true) return missing("opencode_schema_report_invalid",
    { diagnostics: validated.structured_role_result?.diagnostics ?? null });

  return raw;
}
const SESSION_ID = /^ses_[A-Za-z0-9]{1,124}$/u;
const EVENT_TYPES = new Set(["step_start", "step_finish", "text", "reasoning", "tool_use", "error"]);

export function isOpenCodeNativeSessionId(value) {
  return typeof value === "string" && SESSION_ID.test(value);
}

export function decodeOpenCodeEventStream(stdout, { maxBytes = 1024 * 1024 } = {}) {
  let sessionId = null;
  const fail = (reason, detail = null) => Object.freeze({
    ok: false, reason, detail, nativeSessionId: sessionId
  });
  if (typeof stdout !== "string" || stdout.trim().length === 0) return fail("opencode_stdout_empty");
  if (Buffer.byteLength(stdout, "utf8") > maxBytes) return fail("opencode_stream_too_large", { max_bytes: maxBytes });
  const parts = new Map();
  const messages = new Map();
  const tools = [];
  let lastMessage = null;
  let terminalMessage = null;
  let nativeFailure = null;
  for (const [index, line] of stdout.trimEnd().split(/\r?\n/u).entries()) {
    let event;
    try { event = JSON.parse(line); }
    catch { return fail("opencode_event_json_invalid", { line: index + 1 }); }
    if (!event || typeof event !== "object" || !EVENT_TYPES.has(event.type)) {
      return fail("opencode_event_type_invalid", { line: index + 1 });
    }
    if (!isOpenCodeNativeSessionId(event.sessionID)) return fail("opencode_session_id_missing", { line: index + 1 });
    if (sessionId !== null && sessionId !== event.sessionID) return fail("opencode_session_id_conflict");
    sessionId = event.sessionID;
    if (event.type === "error") {
      if (typeof event.error?.name !== "string") return fail("opencode_error_event_invalid");
      nativeFailure = { reason: "opencode_native_error", detail: {
        name: event.error.name, message: event.error.data?.message ?? null
      } };
      continue;
    }
    const part = event.part;
    if (!part || typeof part !== "object" || part.sessionID !== sessionId ||
        typeof part.messageID !== "string" || !part.messageID.startsWith("msg_") ||
        typeof part.id !== "string" || part.id.length === 0) {
      return fail("opencode_part_identity_invalid", { line: index + 1 });
    }
    const expectedType = { step_start: "step-start", step_finish: "step-finish", tool_use: "tool" }[event.type] ?? event.type;
    if (part.type !== expectedType) return fail("opencode_part_type_invalid", { line: index + 1 });
    const serialized = JSON.stringify(part);
    if (parts.has(part.id)) {
      if (parts.get(part.id) !== serialized) return fail("opencode_part_conflict", { part_id: part.id });
      continue;
    }
    parts.set(part.id, serialized);
    if (lastMessage !== part.messageID && messages.has(part.messageID)) return fail("opencode_message_order_invalid");
    lastMessage = part.messageID;
    const message = messages.get(part.messageID) ?? { started: false, finished: false, text: [] };
    messages.set(part.messageID, message);
    if (event.type === "step_start") {
      if (message.started || message.finished) return fail("opencode_step_order_invalid");
      message.started = true;
      terminalMessage = null;
    } else if (!message.started) {
      return fail("opencode_step_start_missing");
    } else if (event.type === "text" || event.type === "reasoning") {
      if (typeof part.text !== "string" || typeof part.time?.end !== "number") return fail("opencode_text_incomplete");
      if (event.type === "text") message.text.push(part.text);
    } else if (event.type === "tool_use") {
      if (message.finished || typeof part.tool !== "string" || part.tool.length === 0 ||
          typeof part.callID !== "string" || part.callID.length === 0 ||
          !["completed", "error"].includes(part.state?.status)) return fail("opencode_tool_event_invalid");
      tools.push(Object.freeze({ tool: part.tool, status: part.state.status, callId: part.callID }));
      if (part.state.status === "error") nativeFailure = { reason: "opencode_native_tool_error",
        detail: { tool: part.tool, message: part.state.error ?? null } };
    } else if (event.type === "step_finish") {
      if (message.finished) return fail("opencode_step_order_invalid");
      message.finished = true;
      if (part.reason === "stop") terminalMessage = part.messageID;
      else if (part.reason !== "tool-calls") return fail("opencode_completion_incomplete", { reason: part.reason ?? null });
    }
  }
  if (nativeFailure !== null) return fail(nativeFailure.reason, nativeFailure.detail);
  if (terminalMessage === null || terminalMessage !== lastMessage ||
      [...messages.values()].some(message => !message.finished)) return fail("opencode_terminal_completion_missing");
  const text = messages.get(terminalMessage).text.join("\n");
  if (text.trim().length === 0) return fail("opencode_final_text_missing");
  return Object.freeze({ ok: true, nativeSessionId: sessionId, text,
    terminalMessageId: terminalMessage, tools: Object.freeze(tools) });
}
