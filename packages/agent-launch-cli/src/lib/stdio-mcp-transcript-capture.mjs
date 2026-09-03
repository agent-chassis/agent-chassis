

import { spawn } from "node:child_process";
import {
  chmodSync,
  createWriteStream,
  fstatSync,
  lstatSync,
  mkdirSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { Transform } from "node:stream";
import { fileURLToPath } from "node:url";

import {
  LAUNCHER_NO_CCE_AUTHORITY_FD
} from "../../../wiki-mcp/src/lib/launcher-no-cce-authority.mjs";
import {
  STDIO_MCP_READY_FD
} from "./stdio-mcp-conduit-contract.mjs";
import {
  WIKI_MCP_COMMON_PROOF_RESOLVER_FD
} from "./wiki-mcp-common-proof-resolver-capability.mjs";

export const STDIO_MCP_TRANSCRIPT_SCHEMA_VERSION = "launcher-stdio-mcp-transcript.v2";
export const STDIO_MCP_TRANSCRIPT_CAPTURE_BOUNDARY = "stdio-mcp-conduit-generation-spawn";

export const STDIO_MCP_TRANSCRIPT_ROOT_ENV_VAR = "AGENT_CHASSIS_MCP_TRANSCRIPT_ROOT";

export const STDIO_MCP_TRANSCRIPT_CAPTURE_MODULE_PATH = fileURLToPath(import.meta.url);

const FORWARDED_SIGNALS = Object.freeze(["SIGTERM", "SIGINT", "SIGHUP"]);
const MAX_RECORDED_CAPTURE_ERRORS = 32;
const AUXILIARY_DESCRIPTORS = Object.freeze([
  Object.freeze({ fd: STDIO_MCP_READY_FD, optional: false }),
  Object.freeze({ fd: LAUNCHER_NO_CCE_AUTHORITY_FD, optional: true }),
  Object.freeze({ fd: WIKI_MCP_COMMON_PROOF_RESOLVER_FD, optional: false })
]);

function launcherUid() {
  return typeof process.getuid === "function" ? process.getuid() : null;
}

export function resolveStdioMcpTranscriptCaptureRoot(env = process.env, uid = launcherUid()) {
  const candidate = env?.[STDIO_MCP_TRANSCRIPT_ROOT_ENV_VAR];
  if (typeof candidate !== "string" || candidate.length === 0) {
    return { root: null, reason: "not_requested" };
  }
  if (!path.isAbsolute(candidate)) {
    return { root: null, reason: "not_absolute", candidate };
  }
  if (uid === null) {
    return { root: null, reason: "uid_unavailable", candidate };
  }
  let stats;
  try {
    stats = lstatSync(candidate);
  } catch (error) {
    return { root: null, reason: "unreadable", candidate, code: error?.code ?? null };
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    return { root: null, reason: "not_a_real_directory", candidate };
  }
  if (stats.uid !== uid) {
    return { root: null, reason: "not_owned", candidate };
  }
  if ((stats.mode & 0o777) !== 0o700) {
    return { root: null, reason: "not_owner_private", candidate };
  }
  return { root: path.resolve(candidate), reason: "ready" };
}

export function mintStdioMcpTranscriptSession(root, { pid = process.pid, now = new Date() } = {}) {
  const name = `${now.toISOString().replace(/[-:.]/gu, "")}-${pid}`;
  const directory = path.join(root, name);
  mkdirSync(directory, { recursive: false, mode: 0o700 });
  chmodSync(directory, 0o700);
  return directory;
}

class RecordingPassThrough extends Transform {
  constructor(sink, onSinkError) {
    super();
    this.sink = sink ?? null;
    this.onSinkError = onSinkError;
    this.bytes = 0;
    this.sink?.on("error", (error) => {
      this.sink = null;
      this.onSinkError(error);
    });
  }

  _transform(chunk, _encoding, callback) {
    this.bytes += chunk.length;
    const sink = this.sink;
    if (sink === null) {
      callback(null, chunk);
      return;
    }
    sink.write(chunk, (error) => {
      if (error) {
        this.sink = null;
        this.onSinkError(error);
      }
      callback(null, chunk);
    });
  }
}

function endStream(stream) {
  return new Promise((resolve) => {
    if (!stream || stream.writableEnded || stream.destroyed) {
      resolve();
      return;
    }
    stream.once("error", () => resolve());
    stream.end(() => resolve());
  });
}

export function parseTranscriptCaptureArgv(argv) {
  if (argv[0] !== "--transcript-session" || typeof argv[1] !== "string" || argv[1].length === 0) {
    return null;
  }
  if (argv[2] !== "--" || typeof argv[3] !== "string" || argv[3].length === 0) return null;
  return { sessionDirectory: argv[1], serverArgs: argv.slice(3) };
}

export async function runStdioMcpTranscriptCapture({
  sessionDirectory,
  serverArgs,
  execPath = process.execPath,
  input = process.stdin,
  output = process.stdout,
  errorOutput = process.stderr,
  env = process.env,
  cwd = process.cwd(),
  now = () => new Date()
} = {}) {
  const captureErrors = [];
  const noteCaptureError = (stage, error) => {
    const message = `${stage}: ${error?.message ?? error}`;
    if (captureErrors.length < MAX_RECORDED_CAPTURE_ERRORS) captureErrors.push(message);
    try {
      errorOutput.write(`stdio-mcp-transcript-capture degraded (${message})\n`);
    } catch {   }
  };

  const startedAt = now();
  const sessionFile = path.join(sessionDirectory, "session.json");
  const stderrPath = path.join(sessionDirectory, "server.stderr.log");
  let requestSink = null;
  let responseSink = null;
  let stderrSink = null;
  let evidenceOpen = false;
  try {
    requestSink = createWriteStream(path.join(sessionDirectory, "request.bin"), { mode: 0o600 });
    responseSink = createWriteStream(path.join(sessionDirectory, "response.bin"), { mode: 0o600 });
    evidenceOpen = true;
  } catch (error) {
    noteCaptureError("transcript_open", error);
    requestSink = null;
    responseSink = null;
  }

  const stdio = ["pipe", "pipe", "pipe"];
  for (const { fd, optional } of AUXILIARY_DESCRIPTORS) {
    while (stdio.length < fd) stdio.push("ignore");
    try {
      fstatSync(fd);
      stdio.push(fd);
    } catch (error) {
      stdio.push("ignore");
      if (!optional) noteCaptureError(`auxiliary_fd_${fd}_unavailable`, error);
    }
  }

  const child = spawn(execPath, serverArgs, { cwd, env, stdio, detached: false });

  const writeSession = (state) => {
    try {
      writeFileSync(sessionFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
      chmodSync(sessionFile, 0o600);
    } catch (error) {
      noteCaptureError("session_metadata_write", error);
    }
  };

  const requestTee = new RecordingPassThrough(requestSink,
    (error) => noteCaptureError("request_capture", error));
  const responseTee = new RecordingPassThrough(responseSink,
    (error) => noteCaptureError("response_capture", error));

  const stderrTee = new RecordingPassThrough(null,
    (error) => noteCaptureError("server_stderr_capture", error));
  let stderrSinkAttempted = false;
  stderrTee._transform = function transformServerStderr(chunk, _encoding, callback) {
    this.bytes += chunk.length;
    if (!stderrSinkAttempted && evidenceOpen) {
      stderrSinkAttempted = true;
      try {
        stderrSink = createWriteStream(stderrPath, { mode: 0o600 });
        stderrSink.on("error", (error) => {
          stderrSink = null;
          noteCaptureError("server_stderr_capture", error);
        });
      } catch (error) {
        stderrSink = null;
        noteCaptureError("server_stderr_open", error);
      }
    }
    if (stderrSink === null) {
      callback(null, chunk);
      return;
    }
    stderrSink.write(chunk, (error) => {
      if (error) {
        stderrSink = null;
        noteCaptureError("server_stderr_capture", error);
      }
      callback(null, chunk);
    });
  };

  const baseState = () => ({
    schema_version: STDIO_MCP_TRANSCRIPT_SCHEMA_VERSION,
    capture_boundary: STDIO_MCP_TRANSCRIPT_CAPTURE_BOUNDARY,
    session: path.basename(sessionDirectory),
    wrapper_pid: process.pid,
    server_pid: child.pid ?? null,
    server_command: [execPath, ...serverArgs],
    started_at: startedAt.toISOString(),
    request: "request.bin",
    response: "response.bin",
    server_stderr: "server.stderr.log"
  });

  writeSession({
    ...baseState(),
    status: "running",
    completed_at: null,
    exit_code: null,
    exit_signal: null,
    request_bytes: 0,
    response_bytes: 0,
    server_stderr_bytes: 0,
    capture_errors: [...captureErrors]
  });

  child.once("error", (error) => noteCaptureError("server_spawn", error));

  const forwarders = new Map();
  for (const signal of FORWARDED_SIGNALS) {
    const forward = () => {
      try { child.kill(signal); } catch {   }
    };
    forwarders.set(signal, forward);
    process.on(signal, forward);
  }

  input.pipe(requestTee).pipe(child.stdin);
  child.stdout.pipe(responseTee).pipe(output);
  child.stderr.pipe(stderrTee).pipe(errorOutput);

  for (const stream of [input, output, errorOutput, child.stdin, child.stdout, child.stderr]) {
    stream?.on("error", (error) => noteCaptureError("transport_stream", error));
  }

  const exit = await new Promise((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal }));
  });

  for (const [signal, forward] of forwarders) process.off(signal, forward);
  await Promise.all([endStream(requestSink), endStream(responseSink), endStream(stderrSink)]);

  const complete = evidenceOpen && captureErrors.length === 0;
  writeSession({
    ...baseState(),
    status: complete ? "complete" : "capture_degraded",
    completed_at: now().toISOString(),
    exit_code: exit.code,
    exit_signal: exit.signal,
    request_bytes: requestTee.bytes,
    response_bytes: responseTee.bytes,
    server_stderr_bytes: stderrTee.bytes,
    capture_errors: [...captureErrors]
  });

  return {
    sessionDirectory,
    status: complete ? "complete" : "capture_degraded",
    exitCode: exit.code,
    exitSignal: exit.signal,
    requestBytes: requestTee.bytes,
    responseBytes: responseTee.bytes,
    serverStderrBytes: stderrTee.bytes,
    captureErrors: [...captureErrors]
  };
}

export function spawnStdioMcpServerWithTranscriptCapture(command, args, options) {
  const resolved = resolveStdioMcpTranscriptCaptureRoot();
  if (resolved.root === null) {
    if (resolved.reason !== "not_requested") {
      process.stderr.write(
        `stdio-mcp-transcript-capture disabled (${resolved.reason}: ${resolved.candidate ?? "unset"})\n`
      );
    }
    return spawn(command, args, options);
  }
  if (!Array.isArray(args) || args.length === 0) return spawn(command, args, options);
  let sessionDirectory;
  try {
    sessionDirectory = mintStdioMcpTranscriptSession(resolved.root);
  } catch (error) {
    process.stderr.write(
      `stdio-mcp-transcript-capture disabled (session_mint_failed: ${error?.message ?? error})\n`
    );
    return spawn(command, args, options);
  }

  return spawn(
    command,
    [
      STDIO_MCP_TRANSCRIPT_CAPTURE_MODULE_PATH,
      "--transcript-session", sessionDirectory,
      "--", ...args
    ],
    options
  );
}

async function main(argv) {
  const parsed = parseTranscriptCaptureArgv(argv);
  if (parsed === null) {
    process.stderr.write(
      "usage: stdio-mcp-transcript-capture.mjs --transcript-session DIR -- SERVER [ARGS...]\n"
    );
    process.exitCode = 64;
    return;
  }
  const result = await runStdioMcpTranscriptCapture(parsed);

  if (typeof result.exitSignal === "string") {
    process.kill(process.pid, result.exitSignal);
    process.exitCode = 128 + (os.constants.signals[result.exitSignal] ?? 0);
    return;
  }
  process.exitCode = typeof result.exitCode === "number" ? result.exitCode : 1;
}

if (process.argv[1] &&
    path.resolve(process.argv[1]) === path.resolve(STDIO_MCP_TRANSCRIPT_CAPTURE_MODULE_PATH)) {
  await main(process.argv.slice(2));
}
