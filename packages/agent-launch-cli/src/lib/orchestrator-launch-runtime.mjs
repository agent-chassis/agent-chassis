

import path from "node:path";
import { writeNativeUsagePointer } from "@agent-chassis/agent-launch-core/src/lib/native-usage-records.mjs";
import { readFile } from "node:fs/promises";
import { openSync, closeSync, writeSync } from "node:fs";

import {
  fileExists,
  writeJsonAtomic
} from "@agent-chassis/agent-launch-core/src/lib/filesystem.mjs";
import {
  deriveTerminalStatus,
  normalizeExitEnvelope,
  LAUNCHER_RUNTIME_STATES,
  isTerminalRuntimeState
} from "./workspace-agent-launch-adapter-contract.mjs";

import { ORCHESTRATOR_ISOLATION_MODES } from "./orchestrator-launch-isolation.mjs";
import {
  STDIO_MCP_CONDUIT_ERROR_CODES,
  controlledLifecycleEventClass,
  controlledLifecycleFailureReason,
  controlledLifecyclePhase,
  controlledLifecycleProtocolGeneration,
  controlledLifecycleValidationRule,
  settleStdioMcpConduitCleanup,
  projectStdioMcpGenerationFailures,
  renderStdioMcpGenerationFailures
} from "./stdio-mcp-conduit-contract.mjs";

import {
  readLauncherConduitTerminationEvidence
} from "./launch-isolation-spawn.mjs";

export const ORCHESTRATOR_LAUNCH_RUNTIME_SCHEMA_VERSION =
  "orchestrator-launch-runtime.v1";

export const ORCHESTRATOR_SESSION_STATE_FILE_NAME = "session.json";

export const ORCHESTRATOR_FORWARDED_SIGNALS = Object.freeze(["SIGINT", "SIGTERM"]);

export const ORCHESTRATOR_INTERACTIVE_STDIO = "inherit";

export const ORCHESTRATOR_HEADLESS_LOG_FILE_NAME = "orchestrator-headless.log";

export const ORCHESTRATOR_STDIO_MCP_DIAGNOSTIC_PERSISTENCE_FAILED =
  "stdio_mcp_session_diagnostic_persistence_failed";

export class OrchestratorStdioMcpDiagnosticPersistenceError extends Error {
  constructor(cause, diagnostic) {
    super("launcher could not persist the orchestrator stdio-MCP diagnostic",
      cause === null ? undefined : { cause });
    this.name = "OrchestratorStdioMcpDiagnosticPersistenceError";
    this.code = ORCHESTRATOR_STDIO_MCP_DIAGNOSTIC_PERSISTENCE_FAILED;
    this.detail = Object.freeze({
      stdio_mcp_reason: diagnostic?.stdio_mcp_reason ?? null,
      cause_code: typeof cause?.code === "string" ? cause.code.slice(0, 64) : null
    });
  }
}

const READINESS_FAILURE_CODES = new Set([
  STDIO_MCP_CONDUIT_ERROR_CODES.SERVER_START_FAILED,
  STDIO_MCP_CONDUIT_ERROR_CODES.SERVER_READINESS_FAILED,
  STDIO_MCP_CONDUIT_ERROR_CODES.SERVER_STARTUP_TIMEOUT,
  STDIO_MCP_CONDUIT_ERROR_CODES.TOOL_SURFACE_MISMATCH,
  STDIO_MCP_CONDUIT_ERROR_CODES.CLIENT_TOOL_SURFACE_MISMATCH,
  STDIO_MCP_CONDUIT_ERROR_CODES.CLIENT_READINESS_TIMEOUT,
  STDIO_MCP_CONDUIT_ERROR_CODES.CLIENT_READINESS_FAILED,
  STDIO_MCP_CONDUIT_ERROR_CODES.SERVER_EXIT
]);

function boundedToken(value, max = 128) {
  return typeof value === "string" && /^[a-zA-Z0-9_.:#-]+$/u.test(value)
    ? value.slice(0, max)
    : null;
}

export const STDIO_MCP_LAUNCHER_TERMINATION_REASON =
  "stdio_mcp_launcher_terminated_client";

export function buildOrchestratorStdioMcpDiagnostic(conduit) {
  const primary = conduit?.failure ?? conduit?.readinessFailure ?? null;
  const cleanup = conduit?.cleanupFailure ?? null;

  const termination = readLauncherConduitTerminationEvidence(conduit ?? null);
  if (primary === null && cleanup === null && termination === null) return null;

  const primaryCode = boundedToken(primary?.code);
  const cleanupCode = boundedToken(cleanup?.code);
  const cleanupFailures = Array.isArray(cleanup?.detail?.failures)
    ? cleanup.detail.failures.slice(0, 8).map((entry) => Object.freeze({
        resource: boundedToken(entry?.resource, 64),
        code: boundedToken(entry?.code, 64)
      }))
    : [];
  const reaping = cleanupFailures.some(
    (entry) => entry.code === STDIO_MCP_CONDUIT_ERROR_CODES.REAP_FAILED);
  let phase;
  if (primaryCode === STDIO_MCP_CONDUIT_ERROR_CODES.CLIENT_RELAY_RESTARTED) {
    phase = "relay_restart";
  } else if (primaryCode === STDIO_MCP_CONDUIT_ERROR_CODES.SERVER_EXIT &&
      conduit?.clientReadyCompleted === true) {
    phase = "mid_session_server_loss";
  } else if (primaryCode !== null && READINESS_FAILURE_CODES.has(primaryCode)) {
    phase = "readiness";
  } else if (primaryCode !== null) {
    phase = "lifecycle";
  } else if (reaping) {
    phase = "reaping";
  } else if (cleanup !== null) {
    phase = "cleanup";
  } else {

    phase = "launcher_termination";
  }

  return Object.freeze({
    stdio_mcp_reason: primaryCode ?? cleanupCode ??
      (cleanup === null
        ? STDIO_MCP_LAUNCHER_TERMINATION_REASON
        : STDIO_MCP_CONDUIT_ERROR_CODES.CLEANUP_FAILED),
    stdio_mcp_detail: Object.freeze({
      phase,
      run_id: boundedToken(conduit?.runId, 128),
      conduit_error_code: primaryCode,
      cleanup_error_code: cleanupCode,
      cleanup_phase: cleanup === null ? null : reaping ? "reaping" : "cleanup",
      cleanup_failures: Object.freeze(cleanupFailures),

      lifecycle_reason: controlledLifecycleFailureReason(primary?.detail?.lifecycle_reason),
      lifecycle_phase: controlledLifecyclePhase(primary?.detail?.lifecycle_phase),
      lifecycle_event_class: controlledLifecycleEventClass(
        primary?.detail?.lifecycle_event_class),

      lifecycle_validation_rule: controlledLifecycleValidationRule(
        primary?.detail?.lifecycle_validation_rule),

      producer_protocol_generation: controlledLifecycleProtocolGeneration(
        primary?.detail?.producer_protocol_generation),
      consumer_protocol_generation: controlledLifecycleProtocolGeneration(
        primary?.detail?.consumer_protocol_generation),

      launcher_terminated_client: termination !== null,

      ...(termination === null ? {} : { launcher_termination: termination })
    })
  });
}

export function renderOrchestratorStdioMcpDiagnostic(stream, diagnostic, generationFailures = []) {
  if ((diagnostic === null || diagnostic === undefined) && generationFailures.length === 0) return [];
  const detail = diagnostic?.stdio_mcp_detail ?? null;
  const termination = detail?.launcher_termination ?? null;
  const lines = diagnostic == null ? [] : [
    `agent-launch: wiki-MCP conduit diagnostic reason=${diagnostic.stdio_mcp_reason} ` +
      `phase=${detail?.phase ?? "unknown"} run_id=${detail?.run_id ?? "unknown"}`
  ];

  if (detail?.lifecycle_reason !== null && detail?.lifecycle_reason !== undefined) {
    lines.push(
      `agent-launch: the confined client's MCP lifecycle failed ` +
      `(lifecycle_reason=${detail.lifecycle_reason} ` +
      `lifecycle_phase=${detail.lifecycle_phase ?? "unknown"} ` +
      `event_class=${detail.lifecycle_event_class ?? "unknown"} ` +
      `validation_rule=${detail.lifecycle_validation_rule ?? "none"})`);
  }

  if (detail?.producer_protocol_generation !== null &&
        detail?.producer_protocol_generation !== undefined ||
      detail?.consumer_protocol_generation !== null &&
        detail?.consumer_protocol_generation !== undefined) {
    lines.push(
      `agent-launch: conduit lifecycle generations ` +
      `producer=${detail.producer_protocol_generation ?? "unnegotiated"} ` +
      `consumer=${detail.consumer_protocol_generation ?? "unknown"}`);
  }
  if (termination !== null) {
    const cause = termination.cause_available === true
      ? `cause=${termination.cause_code}`
      : `cause=unavailable boundary=${termination.cause_boundary}`;
    const attribution =
      `initiated_by=${termination.initiated_by} fact=${termination.initiating_fact} ${cause}`;
    if (termination.sigterm !== null && termination.sigterm !== undefined) {
      lines.push(
        `agent-launch: the launcher terminal supervisor issued SIGTERM to the confined client ` +
        `(${attribution} delivered=${termination.sigterm.delivered})`);
    }
    if (termination.sigkill !== null && termination.sigkill !== undefined) {

      lines.push(termination.sigterm === null || termination.sigterm === undefined
        ? `agent-launch: the launcher terminal supervisor issued SIGKILL to the confined client ` +
          `(${attribution} delivered=${termination.sigkill.delivered})`
        : `agent-launch: the launcher terminal supervisor escalated to SIGKILL ` +
          `(delivered=${termination.sigkill.delivered})`);
    }
  }
  lines.push(...renderStdioMcpGenerationFailures(generationFailures));
  if (stream !== null && stream !== undefined && typeof stream.write === "function") {
    for (const line of lines) {
      try {
        stream.write(`${line}\n`);
      } catch {

      }
    }
  }
  return lines;
}

export const HEADLESS_REQUIRES_BUBBLEWRAP_REASON =
  "headless orchestrator launch requires bubblewrap isolation; the DEC-0060 " +
  "direct (non-bwrap) operator mode is not supported under --headless";

export class HeadlessDirectModeError extends Error {
  constructor(reason = HEADLESS_REQUIRES_BUBBLEWRAP_REASON) {
    super(reason);
    this.name = "HeadlessDirectModeError";
    this.code = "HEADLESS_DIRECT_MODE_UNSUPPORTED";
    this.reason = reason;
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

export const ORCHESTRATOR_LEGACY_TERMINAL_STATE = "completed";
export const ORCHESTRATOR_RESUMABLE_RUNTIME_STATES = Object.freeze([
  ...LAUNCHER_RUNTIME_STATES,
  ORCHESTRATOR_LEGACY_TERMINAL_STATE
]);
const RESUMABLE_RUNTIME_STATE_SET = new Set(ORCHESTRATOR_RESUMABLE_RUNTIME_STATES);

function sessionStatePath(runtimeDir) {
  return path.join(runtimeDir, ORCHESTRATOR_SESSION_STATE_FILE_NAME);
}

export async function readOrchestratorSessionState(runtimeDir) {
  try {
    const filePath = sessionStatePath(runtimeDir);
    if (!(await fileExists(filePath))) return null;
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

export async function hasResumableOrchestratorSession(runtimeDir) {
  const existing = await readOrchestratorSessionState(runtimeDir);
  if (!existing || typeof existing !== "object") return false;
  return RESUMABLE_RUNTIME_STATE_SET.has(existing.status);
}

export async function recordOrchestratorSessionState({
  runtimeDir,
  descriptor = {},
  status,
  extra = {},
  mergeExisting = false
} = {}) {
  const existing = mergeExisting ? await readOrchestratorSessionState(runtimeDir) : null;
  const record = {
    ...(existing && typeof existing === "object" ? existing : {}),
    ...descriptor,
    status,
    updated_at: new Date().toISOString(),
    ...extra
  };
  await writeJsonAtomic(sessionStatePath(runtimeDir), record);
  return record;
}

export const ORCHESTRATOR_HEADLESS_STREAM_DRAIN_TIMEOUT_MS = 2000;

const HEADLESS_PLAIN_STDOUT_BYTES = 64 * 1024;

function attachHeadlessNativeUsage({ child, tap, logPath }) {
  if (!child?.stdout || typeof child.stdout.on !== "function") return null;
  tap.started?.();
  const fd = openSync(logPath, "a");
  const append = (text) => {
    try {
      writeSync(fd, text);
    } catch {

    }
  };
  tap.bind(append);
  const plain = [];
  let plainBytes = 0;
  const closed = new Promise((resolve) => {
    for (const event of ["end", "close", "error"]) child.stdout.once(event, resolve);
  });
  child.stdout.on("data", (chunk) => {
    try {
      if (tap.events() === 0 && plainBytes < HEADLESS_PLAIN_STDOUT_BYTES) {
        plain.push(chunk);
        plainBytes += chunk.length;
      }
      tap.push(chunk);
      if (tap.preserveProtocol === true) append(chunk);
    } catch {

    }
  });
  return {
    async settle(exit) {
      let timer;
      const drained = await Promise.race([
        closed.then(() => true),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(false), ORCHESTRATOR_HEADLESS_STREAM_DRAIN_TIMEOUT_MS);
          timer.unref?.();
        })
      ]);
      clearTimeout(timer);
      let settlement = null;
      try {
        tap.end({ drained });
        if (tap.preserveProtocol !== true && tap.events() === 0) for (const chunk of plain) append(chunk);
        settlement = await tap.settle({ exit });
      } catch {
        settlement = null;
      }
      try {
        closeSync(fd);
      } catch {

      }
      return settlement;
    }
  };
}

function nativeUsageSessionExtra(settlement) {
  if (settlement === null) return {};
  return { native_usage: {
    invocation_id: settlement.record?.invocation_id ?? null,
    status: settlement.record?.status ?? null,
    record_path: settlement.retention?.ok === true ? settlement.retention.path : null,
    retention_cause: settlement.retention?.ok === true ? null : settlement.retention?.cause?.code ?? null
  } };
}

export async function superviseInteractiveOrchestratorLaunch({
  runtimeDir,
  descriptor = {},
  spawnChild,
  stdioMcpConduit = null,
  recordSessionState = recordOrchestratorSessionState,

  stderr = process.stderr,

  nativeUsage = null,
  nativeCompletion = null,
  signals = ORCHESTRATOR_FORWARDED_SIGNALS
} = {}) {
  if (typeof spawnChild !== "function") {
    throw new TypeError(
      "superviseInteractiveOrchestratorLaunch requires a spawnChild thunk"
    );
  }
  if (typeof recordSessionState !== "function") {
    throw new TypeError("superviseInteractiveOrchestratorLaunch requires a recordSessionState function");
  }

  if (nativeCompletion !== null && (typeof nativeCompletion.complete !== "function" ||
      ["captureStdout", "captureStderr"].some(key => nativeCompletion[key] !== undefined &&
        typeof nativeCompletion[key] !== "boolean") ||
      (nativeCompletion.stderrLogPath != null && (nativeCompletion.captureStderr !== true ||
        !isNonEmptyString(nativeCompletion.stderrLogPath))))) {
    throw new TypeError("Native completion requires a semantic completion function");
  }
  let child = null;
  let releaseChildObservation = null;
  let completionStderrLog = null;
  const signalForwarder = (signal) => {
    if (child?.pid) {
      try {
        child.kill(signal);
      } catch {

      }
    }
  };
  for (const signal of signals) {
    process.once(signal, signalForwarder);
  }

  try {
    await recordSessionState({
      runtimeDir,
      descriptor,
      status: "launching",
      extra: { pid: null }
    });

    child = spawnChild();

    let spawnError = null;
    const childTerminal = new Promise(resolve => {
      let exitSeen = false;
      let closed = false;
      let released = false;
      const detach = () => {
        child.removeListener("exit", onExit);
        child.removeListener("error", onError);
        child.removeListener("close", onClose);
      };
      const onExit = (exitCode, signal) => {
        exitSeen = true;
        resolve({ exitCode, signal });
      };
      const onError = error => {
        if (spawnError === null) spawnError = error;
        resolve({ error: spawnError });
      };
      const onClose = () => {
        closed = true;
        if (released) detach();
      };
      child.once("exit", onExit);
      child.on("error", onError);
      child.once("close", onClose);
      releaseChildObservation = () => {
        released = true;
        child.removeListener("exit", onExit);

        resolve({ abandoned: true });
        if (exitSeen || closed) detach();

      };
    });

    const completionStreams = {};
    let completionCaptureFailed = false;
    if (nativeCompletion?.stderrLogPath != null) {
      completionStderrLog = openSync(nativeCompletion.stderrLogPath, "a");
    }
    for (const [name, limit] of [["stdout", 1024 * 1024], ["stderr", 64 * 1024]]) {
      if (nativeCompletion?.[name === "stdout" ? "captureStdout" : "captureStderr"] !== true) continue;
      const stream = child[name];
      if (!stream) throw new TypeError(`Native completion requires piped ${name}`);
      const capture = { chunks: [], bytes: 0, closed: null };
      completionStreams[name] = capture;
      capture.closed = new Promise(resolve => {
        stream.once("end", resolve);
        stream.once("close", () => {
          if (!stream.readableEnded) completionCaptureFailed = true;
          resolve();
        });
        stream.once("error", () => { completionCaptureFailed = true; resolve(); });
      });
      stream.on("data", chunk => {
        const bytes = Buffer.from(chunk);
        capture.bytes += bytes.length;
        if (capture.bytes <= limit) capture.chunks.push(bytes);
        else completionCaptureFailed = true;
        if (name === "stderr" && completionStderrLog !== null) {
          try {
            if (writeSync(completionStderrLog, bytes) !== bytes.length) completionCaptureFailed = true;
          }
          catch { completionCaptureFailed = true; }
        }
      });
    }
    const usageSink = nativeUsage === null ? null
      : attachHeadlessNativeUsage({ child, tap: nativeUsage.tap, logPath: nativeUsage.logPath });

    if (nativeUsage !== null && typeof nativeUsage.tap.recordsDir === "string") {
      await writeNativeUsagePointer(runtimeDir, nativeUsage.tap.recordsDir).catch(() => {});
    }

    await recordSessionState({
      runtimeDir,
      descriptor,
      status: "running",
      extra: { pid: child.pid ?? null },
      mergeExisting: true
    });

    const observed = await childTerminal;
    if (spawnError !== null) throw spawnError;
    const { exitCode, signal } = observed;

    const usageExtra = nativeUsageSessionExtra(
      usageSink === null ? null : await usageSink.settle({ code: exitCode, signal }));

    if (stdioMcpConduit !== null) {

      await settleStdioMcpConduitCleanup(stdioMcpConduit);
    }
    const generationFailures = projectStdioMcpGenerationFailures(stdioMcpConduit);
    const generationExtra = generationFailures.length === 0 ? {} : {
      conduit_generation_failures: generationFailures
    };
    const stdioMcpDiagnostic = buildOrchestratorStdioMcpDiagnostic(stdioMcpConduit);
    renderOrchestratorStdioMcpDiagnostic(stderr, stdioMcpDiagnostic, generationFailures);
    if (stdioMcpDiagnostic !== null) {

      try {
        await recordSessionState({
          runtimeDir,
          descriptor,
          status: "running",
          extra: stdioMcpDiagnostic,
          mergeExisting: true
        });
      } catch (error) {
        throw new OrchestratorStdioMcpDiagnosticPersistenceError(
          error, stdioMcpDiagnostic);
      }
    }

    let completion = null;
    if (nativeCompletion !== null) {
      let drained = true;
      if (Object.keys(completionStreams).length > 0) {
        let timer;
        drained = await Promise.race([Promise.all(Object.values(completionStreams).map(capture => capture.closed))
          .then(() => true), new Promise(resolve => {
          timer = setTimeout(() => resolve(false), ORCHESTRATOR_HEADLESS_STREAM_DRAIN_TIMEOUT_MS);
        })]);
        clearTimeout(timer);
      }
      completion = completionCaptureFailed || !drained
        ? { ok: false, reason: "native_completion_capture_incomplete" }
        : await nativeCompletion.complete({ exitCode, signal,
          stdout: Buffer.concat(completionStreams.stdout?.chunks ?? []).toString("utf8"),
          ...(nativeCompletion.captureStderr === true ? {
            stderr: Buffer.concat(completionStreams.stderr.chunks).toString("utf8") } : {}) });
    }
    if (completion !== null && (typeof completion !== "object" || Array.isArray(completion) || typeof completion.ok !== "boolean" ||
        (completion.extra !== undefined && (!completion.extra || Array.isArray(completion.extra) || typeof completion.extra !== "object")))) {
      throw new TypeError("Invalid native orchestrator completion facts");
    }
    if (completion?.extra && ["status", "updated_at", "pid", "exit_code", "exit_signal", "launch_error",
      "stdio_mcp_reason", "stdio_mcp_detail", "conduit_generation_failures"].some(key => Object.hasOwn(completion.extra, key))) {
      throw new TypeError("Native completion cannot override shared lifecycle fields");
    }
    const status = completion?.ok === false ? "failed" : stdioMcpDiagnostic === null
      ? deriveTerminalStatus({ code: exitCode, signal })
      : "failed";
    const exit = { ...normalizeExitEnvelope({ code: exitCode, signal }), ...generationExtra };

    try {
      await recordSessionState({
        runtimeDir,
        descriptor,
        status,
        extra: {
          ...(stdioMcpDiagnostic ?? {}),
          ...generationExtra,
          ...usageExtra,
          ...(completion?.extra ?? {}),
          ...(completion?.ok === false ? { native_completion_reason: completion.reason } : {}),
          pid: child.pid ?? null,
          exit_code: exit.code,
          exit_signal: exit.signal
        },
        mergeExisting: true
      });
    } catch (error) {
      if (stdioMcpDiagnostic !== null) {
        throw new OrchestratorStdioMcpDiagnosticPersistenceError(
          error, stdioMcpDiagnostic);
      }
      throw error;
    }

    return { status, exit, exitCode, signal };
  } catch (error) {
    if (error instanceof OrchestratorStdioMcpDiagnosticPersistenceError) {
      throw error;
    }
    await recordSessionState({
      runtimeDir,
      descriptor,
      status: "failed",
      extra: {
        launch_error: {
          message: error?.message ?? String(error),
          code: error?.code ?? null
        }
      },
      mergeExisting: true
    }).catch(() => {});
    throw error;
  } finally {
    if (completionStderrLog !== null) {
      const fd = completionStderrLog;
      completionStderrLog = null;
      closeSync(fd);
    }
    releaseChildObservation?.();
    for (const signal of signals) {
      process.removeListener(signal, signalForwarder);
    }
  }
}

export async function spawnOrchestratorAndWait({
  runtimeDir,
  descriptor = {},
  bwrapPlan,
  spawnLaunch,
  spawnOptions = {},
  stdio = ORCHESTRATOR_INTERACTIVE_STDIO,
  nativeUsage = null,
  signals = ORCHESTRATOR_FORWARDED_SIGNALS
} = {}) {
  if (typeof spawnLaunch !== "function") {
    throw new TypeError("spawnOrchestratorAndWait requires a spawnLaunch function");
  }
  if (!bwrapPlan || typeof bwrapPlan !== "object") {
    throw new TypeError("spawnOrchestratorAndWait requires a bwrapPlan object");
  }

  return superviseInteractiveOrchestratorLaunch({
    runtimeDir,
    descriptor,
    signals,
    nativeUsage,

    stdioMcpConduit: bwrapPlan.stdioMcpConduit ?? null,
    spawnChild: () =>
      spawnLaunch(bwrapPlan, {
        ...spawnOptions,
        stdio
      })
  });
}

export function resolveHeadlessLogTarget({
  runtimeDir,
  logFileOverride = null,
  isolationMode = ORCHESTRATOR_ISOLATION_MODES.BUBBLEWRAP
} = {}) {
  if (isolationMode === ORCHESTRATOR_ISOLATION_MODES.DIRECT) {
    throw new HeadlessDirectModeError();
  }
  if (!isNonEmptyString(runtimeDir)) {
    throw new TypeError("resolveHeadlessLogTarget requires a runtimeDir string");
  }
  const logPath = isNonEmptyString(logFileOverride)
    ? path.resolve(logFileOverride)
    : path.join(runtimeDir, ORCHESTRATOR_HEADLESS_LOG_FILE_NAME);
  return { logPath, tty: false };
}

export function openHeadlessStdio(target) {
  const logPath = typeof target === "string" ? target : target?.logPath;
  if (!isNonEmptyString(logPath)) {
    throw new TypeError("openHeadlessStdio requires a resolved headless log path");
  }
  const fd = openSync(logPath, "a");
  return {
    logPath,
    stdio: ["ignore", fd, fd],
    close() {
      try {
        closeSync(fd);
      } catch {

      }
    }
  };
}

export { isTerminalRuntimeState };
