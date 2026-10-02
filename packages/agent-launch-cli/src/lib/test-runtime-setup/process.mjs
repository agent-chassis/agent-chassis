

import { spawn } from "node:child_process";

const OUTPUT_CAP_BYTES = 1024 * 1024;
const STREAMS = ["stdout", "stderr"];

function failedOutcome(command, fields) {
  return { ok: false, command, code: null, signal: null, timed_out: false, cancelled: false,
    output_overflow: null, spawn_error: null, stdout: "", stderr: "", ...fields };
}

export function runSetupProcess(command, args, {
  cwd = undefined,
  env = {},
  timeoutMs = 20 * 60 * 1000,
  input = null,
  signal = undefined
} = {}) {

  if (signal?.aborted) return Promise.resolve(failedOutcome(command, { cancelled: true }));
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"], shell: false });
    } catch (error) {
      resolve(failedOutcome(command, { spawn_error: error?.code ?? String(error) }));
      return;
    }
    const chunks = { stdout: [], stderr: [] };
    const sizes = { stdout: 0, stderr: 0 };
    let stopCause = null;
    let spawnError = null;
    let exited = false;

    const closeCapture = () => {
      for (const name of STREAMS) child[name].destroy();
    };
    const stop = (cause) => {
      if (stopCause !== null) return;
      stopCause = cause;
      child.kill("SIGKILL");
      if (exited) closeCapture();
    };

    const capture = (name) => (chunk) => {
      const room = OUTPUT_CAP_BYTES - sizes[name];
      if (chunk.length <= room) {
        chunks[name].push(chunk);
        sizes[name] += chunk.length;
        return;
      }
      if (room > 0) {
        chunks[name].push(chunk.subarray(0, room));
        sizes[name] += room;
      }
      stop({ output_overflow: name });
    };
    const onAbort = () => stop({ cancelled: true });
    const timer = setTimeout(() => stop({ timed_out: true }), timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", capture("stdout"));
    child.stderr.on("data", capture("stderr"));
    child.on("error", (error) => { spawnError ??= error?.code ?? String(error); });
    child.on("exit", () => {
      exited = true;
      if (stopCause !== null) closeCapture();
    });
    child.on("close", (code, exitSignal) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      const text = (name) => Buffer.concat(chunks[name]).toString("utf8");
      resolve({ ...failedOutcome(command, stopCause ?? {}),
        ok: spawnError === null && stopCause === null && code === 0,
        code, signal: exitSignal, spawn_error: spawnError,
        stdout: text("stdout"), stderr: text("stderr") });
    });
    if (input !== null) child.stdin.end(input);
    else child.stdin.end();
  });
}

function outcomeReason(result) {
  const command = `setup process ${result.command ?? "(unknown command)"}`;
  if (result.spawn_error !== null && result.spawn_error !== undefined) {
    return `${command} could not start (${result.spawn_error}); ` +
      "correct the executable path or its permissions, then rerun setup";
  }
  if (result.cancelled) {
    return `${command} was cancelled before it finished and its output was not used; ` +
      "rerun setup to repeat the check";
  }
  if (result.timed_out) {
    return `${command} exceeded its setup timeout and was stopped; make sure it neither ` +
      "waits for input nor hangs on the host, then rerun setup";
  }
  if (result.output_overflow) {
    return `${command} wrote more than ${OUTPUT_CAP_BYTES} bytes to ${result.output_overflow} ` +
      "and was stopped; its truncated output was not used. Confirm the executable is the " +
      "intended tool, then rerun setup";
  }
  if (!result.ok) {
    const ending = result.signal ? `was killed by ${result.signal}` : `exited with code ${result.code}`;
    return `${command} ${ending}; fix the reported error, then rerun setup`;
  }
  return null;
}

export function processDiagnostic(result, limit = 4000) {
  const text = `${result.stderr ?? ""}${result.stdout ? `\n${result.stdout}` : ""}`.trim();
  const reason = outcomeReason(result);
  if (reason === null) {
    if (text.length === 0) return `setup process ${result.command} exited 0 with no output`;
    return text.length <= limit ? text : `...${text.slice(-limit)}`;
  }
  const room = limit - reason.length - 1;
  if (text.length === 0 || room <= 3) return reason;
  return `${reason}\n${text.length <= room ? text : `...${text.slice(-(room - 3))}`}`;
}
