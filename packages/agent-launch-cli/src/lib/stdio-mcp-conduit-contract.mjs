

import { fstatSync } from "node:fs";

export const STDIO_MCP_CONDUIT_SCHEMA_VERSION = "launcher-stdio-mcp-conduit.v1";
export const STDIO_MCP_CONDUIT_BINDING_SCHEMA_VERSION =
  "launcher-stdio-mcp-conduit-binding.v1";

export const STDIO_MCP_CONDUIT_ROOT = "/run/agent-launch/wiki-mcp";
export const STDIO_MCP_CLIENT_TO_SERVER_PATH = `${STDIO_MCP_CONDUIT_ROOT}/client-to-server`;
export const STDIO_MCP_SERVER_TO_CLIENT_PATH = `${STDIO_MCP_CONDUIT_ROOT}/server-to-client`;

export const STDIO_MCP_CONDUIT_INPUT_FD = 3;
export const STDIO_MCP_CONDUIT_OUTPUT_FD = 4;

export const STDIO_MCP_READY_FD = 3;

export const STDIO_MCP_RELAY_COMMAND = "/usr/bin/sh";
export const STDIO_MCP_RELAY_ARGS = Object.freeze([
  "-c",
  `exec 3>${STDIO_MCP_CLIENT_TO_SERVER_PATH}; exec 4<${STDIO_MCP_SERVER_TO_CLIENT_PATH}; exec 5<&0; /usr/bin/cat <&4 3>&- 5<&- & relay_out=$!; /usr/bin/cat >&3 4<&- 0<&5 5<&- & relay_in=$!; exec 0<&- 1>&- 3>&- 4<&- 5<&-; wait "$relay_out"; kill "$relay_in" 2>/dev/null; wait "$relay_in" 2>/dev/null; exit 0`
]);

export const STDIO_MCP_SERVER_STARTUP_TIMEOUT_MS = 30_000;
export const STDIO_MCP_CLIENT_READINESS_TIMEOUT_MS = 180_000;

export const STDIO_MCP_CLIENT_READINESS_TIMEOUT_SEC =
  STDIO_MCP_CLIENT_READINESS_TIMEOUT_MS / 1_000;

export const STDIO_MCP_TERMINAL_DRAIN_GRACE_MS = 20_000;
export const STDIO_MCP_TERMINAL_KILL_GRACE_MS = 5_000;

export const STDIO_MCP_ABNORMAL_DRAIN_GRACE_MS = 2_000;

export const STDIO_MCP_CONDUIT_RUN_TIMEOUT_MS = 45 * 60_000;

export const STDIO_MCP_CONDUIT_ERROR_CODES = Object.freeze({
  INPUT_INVALID: "stdio_mcp_conduit_input_invalid",
  FAMILY_UNSUPPORTED: "stdio_mcp_conduit_family_unsupported",
  DIRECTORY_INVALID: "stdio_mcp_conduit_directory_invalid",
  ROOT_UNAVAILABLE: "stdio_mcp_conduit_private_root_unavailable",
  FIFO_CREATE_FAILED: "stdio_mcp_conduit_fifo_create_failed",
  FIFO_INVALID: "stdio_mcp_conduit_fifo_invalid",
  FIFO_IDENTITY_MISMATCH: "stdio_mcp_conduit_fifo_identity_mismatch",
  BINDING_CONSUMED: "stdio_mcp_conduit_binding_consumed",
  SERVER_UNAVAILABLE: "stdio_mcp_host_server_unavailable",
  SERVER_START_FAILED: "stdio_mcp_host_server_start_failed",
  SERVER_READINESS_FAILED: "stdio_mcp_host_server_readiness_failed",
  SERVER_STARTUP_TIMEOUT: "stdio_mcp_host_server_startup_timeout",
  TOOL_SURFACE_MISMATCH: "stdio_mcp_tool_surface_mismatch",
  CLIENT_TOOL_SURFACE_MISMATCH: "stdio_mcp_client_tool_surface_mismatch",
  CLIENT_READINESS_TIMEOUT: "stdio_mcp_client_readiness_timeout",
  CLIENT_READINESS_FAILED: "stdio_mcp_client_readiness_failed",
  CLIENT_RELAY_RESTARTED: "stdio_mcp_client_relay_restarted",
  STDIO_SHAPE_UNSUPPORTED: "stdio_mcp_conduit_stdio_shape_unsupported",

  SERVER_EXIT: "stdio_mcp_conduit_server_exit",
  CANCELLED: "stdio_mcp_conduit_cancelled",
  CLEANUP_FAILED: "stdio_mcp_conduit_cleanup_failed",
  REAP_FAILED: "stdio_mcp_conduit_reap_failed"
});

export const STDIO_MCP_CONDUIT_REQUIRES_BUBBLEWRAP_REASON =
  "stdio_mcp_conduit_requires_bubblewrap";
export const STDIO_MCP_CLIENT_READINESS_BLOCKER_REASON =
  "stdio_mcp_client_readiness_failed";
export const STDIO_MCP_CLEANUP_BLOCKER_REASON = "stdio_mcp_cleanup_failed";

export const STDIO_MCP_CONDUIT_ALLOWED_FAMILIES = Object.freeze(new Set(["claude", "codex"]));
export const STDIO_MCP_CONDUIT_ALLOWED_ROLES = Object.freeze(
  new Set(["orchestrator", "worker", "reviewer", "redteam"])
);

export class StdioMcpConduitError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = "StdioMcpConduitError";
    this.code = code;
    this.detail = detail;
  }
}

export function failStdioMcpConduit(code, message, detail = null) {
  throw new StdioMcpConduitError(code, message, detail);
}

export function normalizeStdioMcpConduitRole(role) {
  return role === "review" ? "reviewer" : role;
}

const TRUSTED_BINDINGS = new WeakSet();

export function registerTrustedStdioMcpConduitBinding(binding) {
  TRUSTED_BINDINGS.add(binding);
  return binding;
}

export function assertTrustedStdioMcpConduitBinding(binding) {
  if (!binding || typeof binding !== "object" ||
      binding.schemaVersion !== STDIO_MCP_CONDUIT_BINDING_SCHEMA_VERSION ||
      !Object.isFrozen(binding) || !TRUSTED_BINDINGS.has(binding) || binding.fifoCount !== 2 ||
      !STDIO_MCP_CONDUIT_ALLOWED_FAMILIES.has(binding.family) ||
      !STDIO_MCP_CONDUIT_ALLOWED_ROLES.has(binding.role) ||
      !Array.isArray(binding.pathFds) || binding.pathFds.length !== 2 ||
      JSON.stringify(binding.bindTargets) !== JSON.stringify([
        STDIO_MCP_CLIENT_TO_SERVER_PATH, STDIO_MCP_SERVER_TO_CLIENT_PATH
      ]) || binding.relay?.command !== STDIO_MCP_RELAY_COMMAND ||
      JSON.stringify(binding.relay?.args) !== JSON.stringify(STDIO_MCP_RELAY_ARGS)) {
    failStdioMcpConduit(STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID,
      "launch plan requires one exact launcher-minted stdio MCP conduit binding");
  }

  if (binding.namespaceReady === true || binding.cleaned === true) {
    failStdioMcpConduit(STDIO_MCP_CONDUIT_ERROR_CODES.BINDING_CONSUMED,
      "stdio MCP conduit binding was already projected into a namespace",
      { run_id: binding.runId ?? null });
  }
  for (const fd of binding.pathFds) {
    let stats;
    try {
      stats = fstatSync(fd);
    } catch (error) {
      failStdioMcpConduit(STDIO_MCP_CONDUIT_ERROR_CODES.FIFO_INVALID,
        "stdio MCP conduit O_PATH binding is no longer open",
        { code: error?.code ?? null });
    }
    if (!stats.isFIFO()) {
      failStdioMcpConduit(STDIO_MCP_CONDUIT_ERROR_CODES.FIFO_INVALID,
        "stdio MCP conduit O_PATH binding no longer identifies a FIFO");
    }
  }
  return binding;
}

export function describeStdioMcpConduitLaunchFailure(conduit) {
  const readiness = conduit?.readinessFailure ?? null;
  if (readiness) {
    return {
      reason: STDIO_MCP_CLIENT_READINESS_BLOCKER_REASON,
      detail: {
        conduit_error_code: readiness.code ?? null,
        message: readiness.message ?? String(readiness),
        detail: readiness.detail ?? null,
        run_id: conduit.runId ?? null,
        unenforced_fallback_permitted: false
      }
    };
  }
  const cleanup = conduit?.cleanupFailure ?? null;
  if (cleanup) {
    return {
      reason: STDIO_MCP_CLEANUP_BLOCKER_REASON,
      detail: {
        conduit_error_code: cleanup.code ?? null,
        message: cleanup.message ?? String(cleanup),
        detail: cleanup.detail ?? null,
        run_id: conduit.runId ?? null
      }
    };
  }
  return null;
}

export const STDIO_MCP_CONDUIT_TERMINAL_PROBE_SCHEMA_VERSION =
  "launcher-stdio-mcp-conduit-terminal-probe.v1";

export async function settleStdioMcpConduitCleanup(conduit) {
  try {
    if (typeof conduit?.settleCleanup === "function") {
      await conduit.settleCleanup();
    } else if (typeof conduit?.cleanup === "function") {
      await conduit.cleanup();
    }
  } catch {

  }
  return conduit?.cleanupFailure ?? null;
}

const PROCESS_LOCAL_CONDUIT_CLEANUPS = new Set();
const DRAINED_LAUNCHER_SIGNALS = Object.freeze(["SIGINT", "SIGTERM", "SIGHUP"]);
let processLocalSignalHandlers = null;
let processLocalDrain = null;

export async function drainProcessLocalStdioMcpConduits() {

  const pending = [...PROCESS_LOCAL_CONDUIT_CLEANUPS];
  const settled = await Promise.allSettled(pending.map((settle) => settle()));
  return settled.filter((entry) => entry.status === "fulfilled" && entry.value)
    .map((entry) => entry.value);
}

function disarmProcessLocalStdioMcpConduitSignals() {
  if (processLocalSignalHandlers === null) return;
  for (const [signal, handler] of processLocalSignalHandlers) {
    process.removeListener(signal, handler);
  }
  processLocalSignalHandlers = null;
}

function armProcessLocalStdioMcpConduitSignals() {
  if (processLocalSignalHandlers !== null) return;
  processLocalSignalHandlers = new Map();
  for (const signal of DRAINED_LAUNCHER_SIGNALS) {
    const handler = () => {

      if (processLocalDrain === null) {
        processLocalDrain = drainProcessLocalStdioMcpConduits()
          .catch(() => [])
          .then(() => {

            disarmProcessLocalStdioMcpConduitSignals();
            process.kill(process.pid, signal);
          });
      }
      void processLocalDrain;
    };
    process.on(signal, handler);
    processLocalSignalHandlers.set(signal, handler);
  }
}

export function registerProcessLocalStdioMcpConduit(settle) {
  if (typeof settle !== "function") return () => {};
  PROCESS_LOCAL_CONDUIT_CLEANUPS.add(settle);
  armProcessLocalStdioMcpConduitSignals();
  return () => {
    PROCESS_LOCAL_CONDUIT_CLEANUPS.delete(settle);
    if (PROCESS_LOCAL_CONDUIT_CLEANUPS.size === 0) {
      disarmProcessLocalStdioMcpConduitSignals();
    }
  };
}

export function countProcessLocalStdioMcpConduits() {
  return PROCESS_LOCAL_CONDUIT_CLEANUPS.size;
}

function isCleanupOnlyTerminalProjection(failure, observedExit) {
  if (failure?.reason !== STDIO_MCP_CLEANUP_BLOCKER_REASON) return false;
  if (!observedExit || typeof observedExit !== "object" || Array.isArray(observedExit)) return false;
  if (observedExit.code !== 0) return false;
  return observedExit.signal === null || observedExit.signal === undefined;
}

export function buildStdioMcpConduitTerminalProbe(failure, probed = null) {
  const observed = probed !== null && typeof probed === "object" && !Array.isArray(probed)
    ? probed
    : null;
  const observedExit = observed?.exit ?? null;
  return Object.freeze({
    schema_version: STDIO_MCP_CONDUIT_TERMINAL_PROBE_SCHEMA_VERSION,
    status: "failed",
    terminal: true,

    exit: observedExit === null
      ? Object.freeze({
          code: null,
          signal: null,
          error: failure?.detail?.message ?? failure?.reason ?? "stdio mcp conduit failed"
        })
      : observedExit,
    final_result: observed?.final_result ?? null,
    conduit_failure: Object.freeze({
      reason: failure?.reason ?? null,
      detail: failure?.detail ?? null,
      cleanup_only: isCleanupOnlyTerminalProjection(failure, observedExit)
    })
  });
}

export function readStdioMcpConduitTerminalFailure(probed) {
  if (!probed || typeof probed !== "object" || Array.isArray(probed) ||
      probed.schema_version !== STDIO_MCP_CONDUIT_TERMINAL_PROBE_SCHEMA_VERSION) {
    return null;
  }
  const failure = probed.conduit_failure;
  if (!failure || typeof failure !== "object" || Array.isArray(failure) ||
      typeof failure.reason !== "string" || failure.reason.length === 0) {
    return null;
  }
  const cleanupOnly = failure.cleanup_only === true &&
    failure.reason === STDIO_MCP_CLEANUP_BLOCKER_REASON;
  return Object.freeze({
    reason: failure.reason,
    detail: failure.detail ?? null,
    cleanup_only: cleanupOnly
  });
}

const TERMINAL_PROBE_STATUSES = Object.freeze(new Set(["succeeded", "failed", "cancelled"]));

export function isTerminalStdioMcpConduitProbeResult(probed) {
  if (probed === null || typeof probed !== "object" || Array.isArray(probed)) return false;
  if (probed.terminal === true) return true;
  return typeof probed.status === "string" &&
    TERMINAL_PROBE_STATUSES.has(probed.status.trim().toLowerCase());
}

function composeCleanupResidue(failure, cleanupFailure) {
  if (failure === null || cleanupFailure === null ||
      failure.reason === STDIO_MCP_CLEANUP_BLOCKER_REASON) {
    return failure;
  }
  return {
    reason: failure.reason,
    detail: {
      ...(failure.detail ?? {}),
      cleanup_failure: {
        code: cleanupFailure.code ?? null,
        message: cleanupFailure.message ?? String(cleanupFailure),
        detail: cleanupFailure.detail ?? null
      }
    }
  };
}

export function attachStdioMcpConduitLaunchOutcome(supervised, conduit, legacyBuildRefusal) {
  void legacyBuildRefusal;
  if (!conduit || !supervised || typeof supervised.probe !== "function") {
    return supervised;
  }
  const innerProbe = supervised.probe;

  let published = null;
  let publication = null;
  const publishTerminal = (probed) => {
    if (published !== null) return published;
    if (publication === null) {
      publication = (async () => {
        const cleanupFailure = await settleStdioMcpConduitCleanup(conduit);

        const failure = composeCleanupResidue(
          describeStdioMcpConduitLaunchFailure(conduit),
          cleanupFailure
        );
        published = failure === null
          ? probed
          : buildStdioMcpConduitTerminalProbe(failure, probed);
        return published;
      })();
    }
    return publication;
  };
  return {
    ...supervised,
    probe: async () => {
      if (published !== null) return published;
      const probed = await innerProbe();
      const conduitFailed = describeStdioMcpConduitLaunchFailure(conduit) !== null;
      if (!conduitFailed && !isTerminalStdioMcpConduitProbeResult(probed)) return probed;
      return publishTerminal(probed);
    }
  };
}

const SUPPORTED_STDIO_SHORTHANDS = Object.freeze(new Set(["ignore", "inherit", "pipe", "overlapped"]));
const SUPPORTED_STDIO_SLOT_STRINGS = Object.freeze(
  new Set(["ignore", "inherit", "pipe", "overlapped", "ipc"])
);

export function resolveConduitChildStdio(binding, requested) {
  let base;
  if (requested === undefined || requested === null) {
    base = ["inherit", "inherit", "inherit"];
  } else if (typeof requested === "string") {
    if (!SUPPORTED_STDIO_SHORTHANDS.has(requested)) {
      failStdioMcpConduit(STDIO_MCP_CONDUIT_ERROR_CODES.STDIO_SHAPE_UNSUPPORTED,
        "stdio MCP conduit launch received an unsupported stdio shorthand",
        { requested, supported: [...SUPPORTED_STDIO_SHORTHANDS].sort() });
    }
    base = [requested, requested, requested];
  } else if (Array.isArray(requested)) {
    if (requested.length < 3) {
      failStdioMcpConduit(STDIO_MCP_CONDUIT_ERROR_CODES.STDIO_SHAPE_UNSUPPORTED,
        "stdio MCP conduit launch requires stdin, stdout, and stderr slots",
        { length: requested.length });
    }
    if (requested.length > 5) {
      failStdioMcpConduit(STDIO_MCP_CONDUIT_ERROR_CODES.STDIO_SHAPE_UNSUPPORTED,
        "stdio MCP conduit launch cannot extend a child stdio array beyond slot 4",
        { length: requested.length });
    }
    for (let index = 3; index < requested.length; index += 1) {

      if (requested[index] !== "ignore" && requested[index] !== undefined &&
          requested[index] !== null) {
        failStdioMcpConduit(STDIO_MCP_CONDUIT_ERROR_CODES.STDIO_SHAPE_UNSUPPORTED,
          "stdio MCP conduit reserves child descriptors 3 and 4",
          { slot: index, requested: String(requested[index]) });
      }
    }
    for (let index = 0; index < 3; index += 1) {
      const slot = requested[index];
      const acceptable = Number.isInteger(slot) ||
        (typeof slot === "string" && SUPPORTED_STDIO_SLOT_STRINGS.has(slot)) ||
        (slot !== null && typeof slot === "object");
      if (!acceptable) {
        failStdioMcpConduit(STDIO_MCP_CONDUIT_ERROR_CODES.STDIO_SHAPE_UNSUPPORTED,
          "stdio MCP conduit launch received an unsupported stdio slot",
          { slot: index, requested: slot === null ? "null" : String(slot) });
      }
    }
    base = [...requested];
  } else {
    failStdioMcpConduit(STDIO_MCP_CONDUIT_ERROR_CODES.STDIO_SHAPE_UNSUPPORTED,
      "stdio MCP conduit launch received an unsupported stdio option",
      { type: typeof requested });
  }
  while (base.length <= STDIO_MCP_CONDUIT_OUTPUT_FD) base.push("ignore");
  base[STDIO_MCP_CONDUIT_INPUT_FD] = binding.pathFds[0];
  base[STDIO_MCP_CONDUIT_OUTPUT_FD] = binding.pathFds[1];
  return base;
}
