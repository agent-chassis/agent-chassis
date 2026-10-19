

import { openSync, writeSync, fsyncSync, closeSync, createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { readAgyNativeExport } from "./agy-native-export-reader.mjs";
import { decodeAgyFinalResult } from "./workspace-agent-agy-final-result.mjs";

export const AGY_NATIVE_EXPORT_MAX_BYTES = 1024 ** 3;

export function createAgyNativeExport(runtimeDir, { limit = AGY_NATIVE_EXPORT_MAX_BYTES } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > AGY_NATIVE_EXPORT_MAX_BYTES) throw new TypeError("Invalid Agy export ceiling");
  const file = path.join(runtimeDir, `agy-native-${randomUUID()}.jsonl`);
  let fd = openSync(file, "wx", 0o600), bytes = 0, failure = null, attached = false;
  let drained = Promise.resolve();
  const fail = (reason, error) => { failure ??= { ok: false, reason, extra: {
    native_export_path: file, native_export_detail: { code: error?.code ?? null, message: error?.message ?? null, limit_bytes: limit } } }; };
  function close() {
    if (fd === null) return;
    const held = fd; fd = null;
    try { fsyncSync(held); } catch (error) { fail("agy_native_export_write_failed", error); }
    try { closeSync(held); } catch (error) { fail("agy_native_export_write_failed", error); }
  }
  return {
    file,
    attach(stream) {
      if (attached || !stream) throw new TypeError("Agy export requires one piped stdout");
      attached = true;
      drained = new Promise(resolve => {
        stream.once("end", resolve);
        stream.once("close", () => { if (!stream.readableEnded) fail("agy_native_export_incomplete"); resolve(); });
        stream.once("error", error => { fail("agy_native_export_stream_failed", error); resolve(); });
      });
      stream.on("data", chunk => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const length = Math.min(buffer.length, Math.max(0, limit - bytes)); bytes += buffer.length;
        if (fd !== null && failure === null) try {
          for (let offset = 0; offset < length;) {
            const written = writeSync(fd, buffer, offset, length - offset);
            if (written <= 0) throw new Error("Agy export write made no progress");
            offset += written;
          }
        } catch (error) { fail("agy_native_export_write_failed", error); }
        if (bytes > limit) fail("agy_native_export_size_limit_exceeded");
      });
    },
    async complete({ stderr = "", logPath = null } = {}) {
      let timer;
      try {
        if (!await Promise.race([drained.then(() => true), new Promise(resolve => {
          timer = setTimeout(() => resolve(false), 2000);
        })])) fail("agy_native_export_incomplete");
      } finally { clearTimeout(timer); close(); }
      if (logPath !== null) try { await pipeline(createReadStream(file), createWriteStream(logPath, { flags: "a", mode: 0o600 })); }
      catch (error) { fail("agy_native_export_log_failed", error); }
      if (failure) return failure;
      try { return await decodeExport(file, stderr); }
      catch (error) { return { ok: false, reason: error.code === "agy_result_malformed" || error instanceof TypeError
        ? "agy_result_malformed" : "agy_native_export_read_failed" }; }
    },
    close
  };
}

async function decodeExport(file, stderr) {
  let init = null, result = null, last = null, count = 0;
  const pending = new Map();
  for await (const event of readAgyNativeExport(file)) {
    if (!event || typeof event !== "object" || Array.isArray(event)) return { ok: false, reason: "agy_result_malformed" };
    if (init === null) {
      if (event.event !== "init") return { ok: false, reason: "agy_result_incomplete" };
      init = event;
    }
    last = event.event;
    if (!["init", "step_update", "result"].includes(last)) return { ok: false, reason: "agy_event_type_invalid" };
    const step = event.step_update;
    if (step && step.conversation_id !== init.conversation_id) return { ok: false, reason: "agy_session_id_conflict" };
    if (last === "result") { count++; result = event.result; }
    if (step?.step_type === "tool") {
      const parameters = step.tool_info?.parameters;
      const operation = JSON.stringify([step.tool_name, step.tool_name === "call_mcp_tool"
        ? [parameters?.ServerName, parameters?.ToolName] : parameters?.native_parameters_digest]);
      if (step.state === "ERROR") pending.set(operation, { event: "step_update", step_update: {
        ...step, tool_info: { parameters: { ServerName: parameters?.ServerName, ToolName: parameters?.ToolName } } } });
      else if (step.state === "DONE") pending.delete(operation);
    }
  }
  if (init === null) return { ok: false, reason: "agy_result_missing" };
  if (last !== "result" || count !== 1) return { ok: false, reason: "agy_result_incomplete" };
  if (!result || result.conversation_id !== init.conversation_id) return { ok: false, reason: "agy_session_id_conflict" };
  const decoded = decodeAgyFinalResult({ stdout: JSON.stringify(result), stderr });
  if (!decoded.ok) return decoded;
  if (pending.size) return { ok: false, reason: "agy_native_tool_error" };

  return { ok: true, nativeSessionId: decoded.nativeSessionId };
}
