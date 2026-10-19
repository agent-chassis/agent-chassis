import { StringDecoder } from "node:string_decoder";
import { projectFailureDiagnosis, projectProcessDiagnosticLine } from "./diagnostic-projection.mjs";

export const SIDECAR_REFRESH_STDERR_BYTES = 4096;
export const SIDECAR_REFRESH_STDOUT_BYTES = 1024;

export class SidecarRefreshError extends Error {
  constructor(message, { code, details = {} } = {}) {
    super(message);
    this.name = "SidecarRefreshError";
    this.code = code;
    this.details = details;
  }
}

function diagnosticCapture(limit) {
  const headLimit = Math.floor(limit / 4);
  const tailLimit = limit - headLimit;
  let head = Buffer.alloc(0);
  let tail = Buffer.alloc(0);
  let bytes = 0;
  const text = (buffer) => {
    let start = 0;
    while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) start += 1;
    return new StringDecoder("utf8").write(buffer.subarray(start));
  };
  return {
    append(chunk) {
      const next = Buffer.from(chunk);
      bytes += next.length;
      if (head.length < headLimit) {
        head = Buffer.concat([head, next.subarray(0, headLimit - head.length)]);
      }
      tail = next.length >= tailLimit
        ? Buffer.from(next.subarray(next.length - tailLimit))
        : Buffer.concat([tail, next]).subarray(-tailLimit);
    },
    read() {
      const overlap = Math.max(0, head.length + tail.length - bytes);
      return { text: bytes <= limit ? text(Buffer.concat([head, tail.subarray(overlap)]))
        : text(head) + text(tail), bytes,
        truncated: bytes > limit };
    }
  };
}

export function observeSidecarRefreshWorker(child) {
  const stdout = diagnosticCapture(SIDECAR_REFRESH_STDOUT_BYTES);
  const stderr = diagnosticCapture(SIDECAR_REFRESH_STDERR_BYTES);
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => stdout.append(chunk));
  child.stderr.on("data", (chunk) => stderr.append(chunk));

  const reasons = new Map();
  let pending = "";
  const accept = line => {
    const reason = projectProcessDiagnosticLine(line);
    if (reason !== null) reasons.set(JSON.stringify(reason), reason);
  };
  let ignoredLine = false;
  child.stderr.on("data", chunk => {
    const parts = String(chunk).split("\n");
    for (let index = 0; index < parts.length; index += 1) {
      if (!ignoredLine) {
        pending = (pending + parts[index]).trimStart();
        const prefixes = ["fatal:", "error:"];
        if (!prefixes.some(prefix => prefix.startsWith(pending) || pending.startsWith(prefix))) {
          ignoredLine = true;
          pending = "";
        }
      }
      if (index < parts.length - 1) {
        if (!ignoredLine) accept(pending.replace(/\r$/u, ""));
        pending = "";
        ignoredLine = false;
      }
    }
  });
  let response = null;
  let processError = null;
  const pipeFailed = (error) => {
    processError ??= error;
    child.kill("SIGTERM");
  };
  child.stdout.once("error", pipeFailed);
  child.stderr.once("error", pipeFailed);
  const done = new Promise((resolve, reject) => {
    child.once("message", (message) => { response = message; });
    child.once("error", (error) => { processError ??= error; });
    child.once("close", (exitCode, signal) => {
      accept(pending);
      const processDiagnosis = { exit_code: exitCode, signal, errors: [...reasons.values()] };
      const exit = { exit_code: exitCode, signal };
      const diagnostics = { stdout: stdout.read(), stderr: stderr.read() };
      if (processError) {
        reject(new SidecarRefreshError(
          `the refresh worker could not run: ${projectFailureDiagnosis(processError).message}`,
          { code: "sidecar_refresh_worker_unavailable", details: {
            ...exit, cause_code: processError.code ?? null, diagnosis: projectFailureDiagnosis(processError), process_diagnosis: processDiagnosis, diagnostics } }));
      } else if (response?.type === "completed" && exitCode === 0 && signal === null) {
        resolve({ ...response, worker_exit: exit });
      } else if (response && response.type !== "completed") {
        reject(new SidecarRefreshError(
          String(response.message ?? "the refresh worker reported a failure"),
          { code: typeof response.code === "string" ? response.code : "sidecar_refresh_failed",
            details: { ...exit, cause_code: response.cause_code ?? null,
              publication_outcome: response.publication_outcome ?? null, diagnosis: response.diagnosis ?? null, process_diagnosis: processDiagnosis, diagnostics } }));
      } else {
        reject(new SidecarRefreshError(
          `the refresh worker ${response ? "reported completion but exited unsuccessfully" :
            "exited before reporting an outcome"} (${signal ?? `exit code ${exitCode}`})`,
          { code: "sidecar_refresh_worker_exited", details: { ...exit, diagnostics, process_diagnosis: processDiagnosis,
            correction: "The worker exited without a structured outcome. Restore the worker runtime before retrying; publication effects are unconfirmed." } }));
      }
    });
  });
  return { done, pid: child.pid, terminate: () => { child.kill("SIGTERM"); },
    send(request) {
      const failed = (error) => {
        processError ??= error;
        child.kill("SIGTERM");
      };
      try { child.send(request, (error) => { if (error) failed(error); }); }
      catch (error) { failed(error); }
    }
  };
}
