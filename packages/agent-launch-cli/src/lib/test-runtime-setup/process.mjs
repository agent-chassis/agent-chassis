

import { spawn } from "node:child_process";

const OUTPUT_CAP_BYTES = 1024 * 1024;

export function runSetupProcess(command, args, {
  cwd = undefined,
  env = {},
  timeoutMs = 20 * 60 * 1000,
  input = null
} = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"], shell: false });
    } catch (error) {
      resolve({ ok: false, code: null, signal: null, stdout: "", stderr: "",
        spawn_error: error?.code ?? String(error) });
      return;
    }
    const chunks = { stdout: [], stderr: [] };
    const sizes = { stdout: 0, stderr: 0 };
    const capture = (name) => (chunk) => {
      if (sizes[name] >= OUTPUT_CAP_BYTES) return;
      chunks[name].push(chunk);
      sizes[name] += chunk.length;
    };
    child.stdout.on("data", capture("stdout"));
    child.stderr.on("data", capture("stderr"));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    let spawnError = null;
    child.on("error", (error) => { spawnError = error?.code ?? String(error); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const text = (name) => Buffer.concat(chunks[name]).toString("utf8");
      resolve({ ok: spawnError === null && !timedOut && code === 0, code, signal,
        timed_out: timedOut, spawn_error: spawnError, stdout: text("stdout"), stderr: text("stderr") });
    });
    if (input !== null) child.stdin.end(input);
    else child.stdin.end();
  });
}

export function processDiagnostic(result, limit = 4000) {
  const text = `${result.stderr ?? ""}${result.stdout ? `\n${result.stdout}` : ""}`.trim();
  return text.length <= limit ? text : `...${text.slice(-limit)}`;
}
