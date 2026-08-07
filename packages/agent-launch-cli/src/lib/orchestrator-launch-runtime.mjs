

import path from "node:path";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { openSync, closeSync } from "node:fs";

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
  settleStdioMcpConduitCleanup
} from "./stdio-mcp-conduit-contract.mjs";

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

export function buildOrchestratorStdioMcpDiagnostic(conduit) {
  const primary = conduit?.failure ?? conduit?.readinessFailure ?? null;
  const cleanup = conduit?.cleanupFailure ?? null;
  if (primary === null && cleanup === null) return null;

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
  } else {
    phase = "cleanup";
  }

  return Object.freeze({
    stdio_mcp_reason: primaryCode ?? cleanupCode ?? STDIO_MCP_CONDUIT_ERROR_CODES.CLEANUP_FAILED,
    stdio_mcp_detail: Object.freeze({
      phase,
      run_id: boundedToken(conduit?.runId, 128),
      conduit_error_code: primaryCode,
      cleanup_error_code: cleanupCode,
      cleanup_phase: cleanup === null ? null : reaping ? "reaping" : "cleanup",
      cleanup_failures: Object.freeze(cleanupFailures)
    })
  });
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

export async function superviseInteractiveOrchestratorLaunch({
  runtimeDir,
  descriptor = {},
  spawnChild,
  stdioMcpConduit = null,
  recordSessionState = recordOrchestratorSessionState,
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

  let child = null;
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
    child.once("error", (error) => {
      spawnError = error;
    });

    await recordSessionState({
      runtimeDir,
      descriptor,
      status: "running",
      extra: { pid: child.pid ?? null },
      mergeExisting: true
    });

    const [exitCode, signal] = await once(child, "exit");
    if (spawnError) {
      throw spawnError;
    }

    if (stdioMcpConduit !== null) {

      await settleStdioMcpConduitCleanup(stdioMcpConduit);
    }
    const stdioMcpDiagnostic = buildOrchestratorStdioMcpDiagnostic(stdioMcpConduit);
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

    const status = stdioMcpDiagnostic === null
      ? deriveTerminalStatus({ code: exitCode, signal })
      : "failed";
    const exit = normalizeExitEnvelope({ code: exitCode, signal });

    try {
      await recordSessionState({
        runtimeDir,
        descriptor,
        status,
        extra: {
          ...(stdioMcpDiagnostic ?? {}),
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
