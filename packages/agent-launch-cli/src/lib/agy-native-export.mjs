

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
    async complete({ stderr = "", logPath = null, sessionFacts } = {}) {
      let timer;
      try {
        if (!await Promise.race([drained.then(() => true), new Promise(resolve => {
          timer = setTimeout(() => resolve(false), 2000);
        })])) fail("agy_native_export_incomplete");
      } finally { clearTimeout(timer); close(); }
      if (logPath !== null) try { await pipeline(createReadStream(file), createWriteStream(logPath, { flags: "a", mode: 0o600 })); }
      catch (error) { fail("agy_native_export_log_failed", error); }
      if (failure) return failure;
      if (/\[agy\] print timeout after /.test(stderr)) return decodeAgyFinalResult({ stdout: "", stderr });
      try { return await decodeExport(file, stderr, sessionFacts); }
      catch (error) { return { ok: false, reason: error.code === "agy_result_malformed" || error instanceof TypeError
        ? "agy_result_malformed" : "agy_native_export_read_failed",
        extra: { native_export_path: file, native_export_detail: { code: error.code ?? null, message: error.message } } }; }
    },
    close
  };
}

const DIAGNOSTIC_STEP_LIMIT = 16;

async function decodeExport(file, stderr, sessionFacts) {
  let init = null, result = null, last = null, count = 0, eventIndex = 0;
  const rows = sessionFacts ? new Map(sessionFacts.steps.map(row => [row.idx, row])) : null;
  const observed = new Map(), recoveries = new Map();
  const diagnostics = { recovered_count: 0, unresolved_count: 0, recovered_steps: [], unresolved_steps: [] };
  let streamFailure = null;
  const failStep = (step, reason) => {
    streamFailure ??= reason;
    diagnostics.unresolved_count++;
    if (diagnostics.unresolved_steps.length < DIAGNOSTIC_STEP_LIMIT) diagnostics.unresolved_steps.push({
      step_index: Number.isSafeInteger(step?.step_index) ? step.step_index : null, reason });
  };
  for await (const event of readAgyNativeExport(file)) {
    if (!event || typeof event !== "object" || Array.isArray(event)) return { ok: false, reason: "agy_result_malformed" };
    if (init === null) {
      if (event.event !== "init") return { ok: false, reason: "agy_result_incomplete" };
      init = event;
    } else if (event.event === "init") return { ok: false, reason: "agy_session_id_conflict" };
    last = event.event;
    if (!["init", "step_update", "result"].includes(last)) return { ok: false, reason: "agy_event_type_invalid" };
    const step = event.step_update;
    if (last === "step_update" && (!step || typeof step !== "object" || Array.isArray(step))) {
      return { ok: false, reason: "agy_result_malformed" };
    }
    if (step && step.conversation_id !== init.conversation_id) return { ok: false, reason: "agy_session_id_conflict" };
    if (last === "result") { count++; result = event.result; }
    if (step) {
      if (rows && (!Number.isSafeInteger(step.step_index) || step.step_index < 0)) {
        failStep(step, "stream_step_identity_invalid");
      } else if (!rows || step.step_index > sessionFacts.afterStepIndex) {
        const row = rows?.get(step.step_index);
        if (rows && !row) failStep(step, "stream_step_identity_invalid");
        const previous = observed.get(step.step_index);
        if (rows && previous && previous.step.step_type !== step.step_type) failStep(step, "stream_step_category_conflict");
        if (rows && row) observed.set(step.step_index, { step, position: eventIndex });
        const toolError = step.state === "ERROR" && step.step_type === "tool";
        const hasError = step.error || step.tool_info?.error;
        if (toolError) {
          if (!toolFailure(step) || (rows && !sqliteToolError(row))) {
            failStep(step, "unclassified_tool_error");
          } else {
            const recovery = await hasLaterRecovery(file, eventIndex, step, sessionFacts);
            if (recovery === null) failStep(step, "unresolved_tool_error");
            else {
              diagnostics.recovered_count++;
              const fact = { step_index: step.step_index ?? null, recovery_step_index: recovery.stepIndex,
                tool_name: step.tool_name.slice(0, 128) };
              if (diagnostics.recovered_steps.length < DIAGNOSTIC_STEP_LIMIT) diagnostics.recovered_steps.push(fact);

              if (rows) recoveries.set(step.step_index, { errorPosition: eventIndex, recoveryPosition: recovery.position });
            }
          }
        } else if (step.state === "ERROR" || hasError) failStep(step, "unclassified_step_error");
      }
    }
    eventIndex++;
  }
  if (init === null) return { ok: false, reason: "agy_result_missing" };
  if (last !== "result" || count !== 1) return { ok: false, reason: "agy_result_incomplete" };
  if (!result || result.conversation_id !== init.conversation_id ||
      (sessionFacts && init.conversation_id !== sessionFacts.nativeSessionId)) return { ok: false, reason: "agy_session_id_conflict" };
  const extra = { native_recovery: diagnostics };
  const decoded = decodeAgyFinalResult({ stdout: JSON.stringify(result), stderr });
  if (!decoded.ok) return { ...decoded, extra };
  let stateCompletion;
  if (rows) {
    const terminal = observed.get(sessionFacts.lastStepIndex);
    const terminalOk = sessionFacts.completion.terminalOk && terminal?.step.step_type === "agent_response" &&
      terminal.step.state === "DONE" && !terminal.step.error && !terminal.step.tool_info;
    let stateOk = terminalOk;
    for (const row of rows.values()) {
      const observation = observed.get(row.idx);
      const step = observation?.step;
      if (row.status === 3 && !row.error_bytes) {
        if (step && (step.state !== "DONE" || step.error || step.tool_info?.error)) {
          stateOk = false; failStep(step, "stream_and_sqlite_step_state_conflict");
        }
      } else if (!sqliteToolError(row) || !toolFailure(step) || row.idx >= sessionFacts.lastStepIndex ||
          observation.position >= (terminal?.position ?? -1)) {
        stateOk = false; failStep({ step_index: row.idx }, "unmatched_sqlite_error");
      }
    }
    if ([...recoveries.values()].some(item => item.errorPosition >= (terminal?.position ?? -1) ||
        item.recoveryPosition >= (terminal?.position ?? -1))) {
      stateOk = false; failStep(null, "recovery_after_terminal_response");
    }
    stateCompletion = { ok: Boolean(stateOk && !streamFailure), reason: sessionFacts.completion.reason };
  }
  if (streamFailure) return { ok: false, reason: "agy_native_tool_error", extra, stateCompletion };

  return { ok: true, nativeSessionId: decoded.nativeSessionId, extra, stateCompletion };
}

function sqliteToolError(row) {

  return row?.step_type === 132 && row.status === 7 && row.error_bytes > 0;
}

function toolFailure(step) {
  const info = step?.tool_info;
  return step?.step_type === "tool" && step.state === "ERROR" && !step.error &&
    typeof step.tool_name === "string" && step.tool_name.length > 0 && info?.name === step.tool_name &&
    info.error?.type === "TOOL_ERROR" && typeof info.error.message === "string" && info.error.message.trim().length > 0;
}

function operation(step) {
  const parameters = step.tool_info?.parameters;
  if (!parameters || (step.tool_name === "call_mcp_tool" &&
      [parameters.ServerName, parameters.ToolName].some(value => typeof value !== "string" || value.length === 0))) return null;
  return JSON.stringify([step.tool_name, step.tool_name === "call_mcp_tool"
    ? [parameters?.ServerName, parameters?.ToolName] : parameters?.native_parameters_digest]);
}

async function hasLaterRecovery(file, afterIndex, failedStep, sessionFacts) {
  let index = 0;
  const failedOperation = operation(failedStep);
  if (failedOperation === null) return null;
  for await (const event of readAgyNativeExport(file)) {
    const step = event?.step_update, position = index++;
    if (event?.event === "result") return null;
    if (position <= afterIndex || step?.conversation_id !== failedStep.conversation_id ||
        step.step_type !== "tool" || step.state !== "DONE" || step.error || step.tool_info?.error ||
        step.tool_info?.name !== step.tool_name || operation(step) !== failedOperation) continue;
    if (sessionFacts) {
      const row = sessionFacts.steps.find(row => row.idx === step.step_index);
      if (!Number.isSafeInteger(step.step_index) || step.step_index <= sessionFacts.afterStepIndex ||
          step.step_index >= sessionFacts.lastStepIndex || row?.step_type !== 132 || row.status !== 3 || row.error_bytes) continue;
    }
    return { position, stepIndex: step.step_index ?? null };
  }
  return null;
}
