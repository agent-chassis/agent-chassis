import { isOpenCodeNativeSessionId } from "./workspace-agent-opencode-final-result.mjs";
import { randomBytes } from "node:crypto";

export function createOpenCodeSchemaRequestMessageId() {

  const time = ((BigInt(Date.now()) << 12n) & 0xffffffffffffn).toString(16).padStart(12, "0");
  return `msg_${time}${randomBytes(7).toString("hex")}`;
}

export function openCodeSchemaError(code, message, detail = null) {
  return Object.assign(new Error(message), { code, detail });
}

export function decodeOpenCodeSchemaResponse(value, { sessionId, messageId, directory, prompt }) {
  const fail = (code, message) => { throw openCodeSchemaError(code, message); };
  const info = value?.info;
  if (!isOpenCodeNativeSessionId(sessionId) || info?.sessionID !== sessionId ||
      info?.parentID !== messageId || !/^msg_[A-Za-z0-9]+$/u.test(info?.id ?? "") ||
      info.role !== "assistant" || info.path?.cwd !== directory || info.agent !== prompt.agent ||
      info.providerID !== prompt.model.providerID || info.modelID !== prompt.model.modelID ||
      info.variant !== prompt.variant) {
    fail("opencode_schema_identity_mismatch", "Native schema response does not match this session, message, directory, agent and model selection");
  }
  if (info.error !== undefined) {
    throw openCodeSchemaError("opencode_native_error", "OpenCode returned a native error", { error: info.error });
  }
  if (!Number.isFinite(info.time?.completed) || info.finish !== "stop") {
    fail("opencode_schema_completion_missing", "OpenCode did not complete the structured assistant message");
  }
  if (!Array.isArray(value.parts) || value.parts.some(part =>
    part.sessionID !== sessionId || part.messageID !== info.id)) {
    fail("opencode_schema_part_identity_mismatch", "Native response parts do not belong to the returned assistant message");
  }
  if (info.structured === null || typeof info.structured !== "object" || Array.isArray(info.structured)) {
    fail("opencode_schema_report_missing", "OpenCode completed without an object in info.structured");
  }
  return Object.freeze({ report: info.structured, nativeSessionId: sessionId,
    terminalMessageId: info.id, requestMessageId: messageId });
}

export function decodeOpenCodeSchemaUsageParts(messages, sessionId) {
  if (!Array.isArray(messages)) throw openCodeSchemaError(
    "opencode_schema_usage_invalid", "OpenCode usage history must be a message array");
  const parts = [];
  for (const message of messages) {
    if (message?.info?.sessionID !== sessionId || typeof message.info.id !== "string" || !Array.isArray(message.parts) ||
        message.parts.some(part => part.sessionID !== sessionId || part.messageID !== message.info.id)) {
      throw openCodeSchemaError("opencode_schema_usage_identity_mismatch",
        "OpenCode usage history contains a message or part from another session");
    }
    parts.push(...message.parts.filter(part => ["step-start", "step-finish"].includes(part.type)));
  }
  return parts;
}

export async function requestOpenCodeSchemaApi({ endpoint, password, directory, route,
  method = "GET", body, signal, timeoutMs = 30_000, maxBytes = 1024 * 1024 }) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(openCodeSchemaError(
    "opencode_schema_request_timeout", `OpenCode ${method} ${route} exceeded ${timeoutMs}ms`)), timeoutMs);
  try {
    const response = await fetch(new URL(route, endpoint), { method, redirect: "error", signal: controller.signal,
      headers: { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
        "x-opencode-directory": directory, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) throw openCodeSchemaError("opencode_schema_capture_exceeded", `OpenCode ${route} exceeded ${maxBytes} bytes`);
        chunks.push(Buffer.from(value));
      }
    } finally { await reader.cancel(); reader.releaseLock(); }
    if (!response.ok) throw openCodeSchemaError("opencode_schema_http_error", `OpenCode ${method} ${route} returned HTTP ${response.status}`,
      { status: response.status, response: Buffer.concat(chunks).toString("utf8") });
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch (cause) { throw openCodeSchemaError("opencode_schema_json_invalid", `OpenCode ${route} returned invalid JSON`, { message: cause.message }); }
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    if (typeof error.code === "string" && error.code.startsWith("opencode_")) throw error;
    throw openCodeSchemaError("opencode_schema_transport_error", `OpenCode ${method} ${route}: ${error.message}`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
