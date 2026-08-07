

import {
  STDIO_MCP_CONDUIT_ERROR_CODES,
  STDIO_MCP_LIFECYCLE_PROTOCOL_GENERATION,
  STDIO_MCP_LIFECYCLE_PROTOCOL_RECOVERY,
  STDIO_MCP_READY_FD,
  StdioMcpConduitError
} from "./stdio-mcp-conduit-contract.mjs";

function deferred() {
  const state = { settled: false };
  state.promise = new Promise((resolve, reject) => {
    state.resolve = (value) => { if (!state.settled) { state.settled = true; resolve(value); } };
    state.reject = (error) => { if (!state.settled) { state.settled = true; reject(error); } };
  });
  return state;
}

function createChildTerminationLatch() {
  const settled = deferred();
  let terminal = null;
  let cleanupInitiated = false;
  return {
    get terminal() { return terminal; },
    get settlement() { return settled.promise; },

    get cleanupInitiated() { return cleanupInitiated; },

    markCleanupInitiated() {
      if (terminal !== null) return false;
      cleanupInitiated = true;
      return true;
    },
    finalize(source, code = null, signal = null, spawnError = null) {
      if (terminal !== null) return false;
      terminal = Object.freeze({
        source,
        code: code ?? null,
        signal: signal ?? null,

        spawnFailed: source === "error",
        cleanupInitiated,
        error: spawnError ?? null
      });
      settled.resolve(terminal);
      return true;
    }
  };
}

function compareToolSurfaces(expected, actual) {
  if (!Array.isArray(expected)) return null;
  const actualNames = Array.isArray(actual) ? actual.map((name) => String(name)) : [];
  const duplicates = [...new Set(
    actualNames.filter((name, index) => actualNames.indexOf(name) !== index)
  )].sort();
  const expectedSorted = [...expected].map((name) => String(name)).sort();
  const actualSorted = [...actualNames].sort();
  const missing = expectedSorted.filter((name) => !actualNames.includes(name));
  const unexpected = actualSorted.filter((name) => !expected.includes(name));
  if (duplicates.length === 0 && missing.length === 0 && unexpected.length === 0 &&
      actualSorted.length === expectedSorted.length) {
    return null;
  }
  return {
    expected: expectedSorted,
    actual: actualSorted,
    missing,
    unexpected,
    duplicates
  };
}

const LIFECYCLE_PHASES = Object.freeze({
  AWAITING_SERVER_REGISTRATION: "awaiting_server_registration_generation",
  SERVER_COMPATIBLE: "server_compatible",
  AWAITING_CLIENT_INITIALIZE: "awaiting_client_initialize",
  AWAITING_EXACT_TOOLS_LIST: "awaiting_exact_tools_list",
  READY: "ready",
  CLIENT_CLOSED: "client_closed",
  FAILED: "failed",
  TERMINAL: "terminal"
});

const SERVER_REGISTRATION_SCHEMA = "wiki-mcp-launcher-readiness.v2";
const LEGACY_SERVER_REGISTRATION_SCHEMA = "wiki-mcp-launcher-readiness.v1";
const CLIENT_INITIALIZED_SCHEMA = "wiki-mcp-launcher-client-initialized.v1";
const TOOLS_LISTED_SCHEMA = "wiki-mcp-launcher-tools-listed.v1";
const CLIENT_RESTARTED_SCHEMA = "wiki-mcp-launcher-client-restarted.v1";
const CLIENT_CLOSED_SCHEMA = "wiki-mcp-launcher-client-closed.v1";

function isPlainLifecycleEvent(event) {
  return event !== null && typeof event === "object" && !Array.isArray(event) &&
    (Object.getPrototypeOf(event) === Object.prototype ||
      Object.getPrototypeOf(event) === null);
}

function hasLifecycleEventKeys(event, required, allowed = required) {
  if (!isPlainLifecycleEvent(event)) return false;
  const keys = Object.keys(event);
  return required.every((key) => Object.prototype.hasOwnProperty.call(event, key)) &&
    keys.every((key) => allowed.includes(key));
}

function boundedLifecycleEventDetail(event) {
  const generation = typeof event?.lifecycle_protocol_generation === "string"
    ? event.lifecycle_protocol_generation.slice(0, 128)
    : event?.lifecycle_protocol_generation === undefined
      ? null
      : `<${typeof event.lifecycle_protocol_generation}>`;
  return {
    schema_version: typeof event?.schema_version === "string"
      ? event.schema_version.slice(0, 128)
      : null,
    lifecycle_protocol_generation: generation
  };
}

function observeConduitLifecycle({
  child,
  role,
  serverStartupTimeoutMs,
  clientReadinessTimeoutMs,
  expectedToolNames,
  getStderr = () => "",

  termination = createChildTerminationLatch()
}) {
  const serverReady = deferred();
  const clientReady = deferred();

  const failureSettlement = deferred();

  const serverExit = deferred();
  let buffer = "";
  let clientReadyResolved = false;

  let clientProcessTerminal = false;
  let readinessEvent = null;
  let failure = null;
  let serverTimer = null;
  let clientTimer = null;
  let phase = LIFECYCLE_PHASES.AWAITING_SERVER_REGISTRATION;
  const phaseHistory = [phase];

  const transitionTo = (next) => {
    phase = next;
    phaseHistory.push(next);
  };

  const clearServerTimer = () => {
    if (serverTimer !== null) { clearTimeout(serverTimer); serverTimer = null; }
  };
  const clearClientTimer = () => {
    if (clientTimer !== null) { clearTimeout(clientTimer); clientTimer = null; }
  };
  const recordFailure = (error) => {
    if (failure !== null) return failure;
    failure = error;
    transitionTo(LIFECYCLE_PHASES.FAILED);
    failureSettlement.resolve(error);
    clearServerTimer();
    clearClientTimer();
    serverReady.reject(error);
    clientReady.reject(error);
    return error;
  };

  serverTimer = setTimeout(() => recordFailure(new StdioMcpConduitError(
    STDIO_MCP_CONDUIT_ERROR_CODES.SERVER_STARTUP_TIMEOUT,
    "host wiki-MCP server did not report readiness within the launcher startup budget",
    { timeout_ms: serverStartupTimeoutMs }
  )), serverStartupTimeoutMs);

  const finalizeChild = (source, code, signal, spawnError) => {

    const cleanupOwned = termination.cleanupInitiated;
    if (!termination.finalize(source, code, signal, spawnError)) return;
    clearServerTimer();
    clearClientTimer();
    if (source === "error") {

      serverExit.resolve(Object.freeze({
        code: null, signal: null, expected: false, spawnFailed: true
      }));
      recordFailure(new StdioMcpConduitError(
        STDIO_MCP_CONDUIT_ERROR_CODES.SERVER_START_FAILED,
        "host wiki-MCP server failed to spawn",
        { message: spawnError?.message ?? String(spawnError), code: spawnError?.code ?? null }
      ));
      return;
    }

    const expected = clientReadyResolved && code === 0 && signal === null &&
      (role !== "orchestrator" || clientProcessTerminal);
    serverExit.resolve(Object.freeze({
      code, signal, expected, cleanupInitiated: cleanupOwned
    }));
    if (expected) {
      transitionTo(LIFECYCLE_PHASES.TERMINAL);
      return;
    }

    if (cleanupOwned) return;
    recordFailure(new StdioMcpConduitError(
      STDIO_MCP_CONDUIT_ERROR_CODES.SERVER_EXIT,
      clientReadyResolved
        ? "host wiki-MCP server exited abnormally while the confined client was running"
        : serverReady.settled
          ? "host wiki-MCP server exited before the confined client became ready"
          : "host wiki-MCP server exited before reporting readiness",
      { code, signal, stderr: getStderr() }
    ));
  };
  child.once?.("error", (error) => finalizeChild("error", null, null, error));
  child.once?.("exit", (code, signal) => finalizeChild("exit", code, signal, null));
  child.once?.("close", (code, signal) => finalizeChild("close", code, signal, null));

  const readyStream = child.stdio?.[STDIO_MCP_READY_FD];
  if (!readyStream) {
    recordFailure(new StdioMcpConduitError(
      STDIO_MCP_CONDUIT_ERROR_CODES.SERVER_READINESS_FAILED,
      "host wiki-MCP server readiness pipe is unavailable"
    ));
    return {
      serverReady: serverReady.promise,
      clientReady: clientReady.promise,
      failureSettlement: failureSettlement.promise,
      serverExit: serverExit.promise,
      beginClientReadiness: () => {},
      markClientProcessTerminal: () => { clientProcessTerminal = true; },
      currentFailure: () => failure,
      isClientReady: () => clientReadyResolved,
      termination
    };
  }

  const invalidTransition = (message, event) => recordFailure(new StdioMcpConduitError(
    STDIO_MCP_CONDUIT_ERROR_CODES.CLIENT_READINESS_FAILED,
    message,
    { phase, ...boundedLifecycleEventDetail(event) }
  ));
  const incompatibleGeneration = (reason, event) => recordFailure(new StdioMcpConduitError(
    STDIO_MCP_CONDUIT_ERROR_CODES.LIFECYCLE_PROTOCOL_INCOMPATIBLE,
    "spawned host wiki-MCP server lifecycle generation is incompatible with the launcher",
    {
      reason,
      producer_protocol_generation:
        typeof event?.lifecycle_protocol_generation === "string"
          ? event.lifecycle_protocol_generation.slice(0, 128)
          : null,
      consumer_protocol_generation: STDIO_MCP_LIFECYCLE_PROTOCOL_GENERATION,
      recovery: STDIO_MCP_LIFECYCLE_PROTOCOL_RECOVERY
    }
  ));

  const handleEvent = (event) => {
    if (!isPlainLifecycleEvent(event) || typeof event.schema_version !== "string") {
      invalidTransition("host wiki-MCP server emitted a malformed lifecycle event", event);
      return;
    }
    if (phase === LIFECYCLE_PHASES.TERMINAL ||
        (phase === LIFECYCLE_PHASES.CLIENT_CLOSED &&
          event.schema_version !== CLIENT_CLOSED_SCHEMA)) {
      invalidTransition("host wiki-MCP server emitted lifecycle evidence after terminal close", event);
      return;
    }

    if (event.schema_version === SERVER_REGISTRATION_SCHEMA ||
        event.schema_version === LEGACY_SERVER_REGISTRATION_SCHEMA) {
      if (phase !== LIFECYCLE_PHASES.AWAITING_SERVER_REGISTRATION) {
        invalidTransition("host wiki-MCP server emitted duplicate server registration", event);
        return;
      }
      if (event.schema_version !== SERVER_REGISTRATION_SCHEMA) {
        incompatibleGeneration("legacy_server_registration_schema", event);
        return;
      }
      if (!hasLifecycleEventKeys(event,
        ["schema_version", "lifecycle_protocol_generation", "ready", "tools"],
        ["schema_version", "lifecycle_protocol_generation", "ready", "tool_profile",
          "registered_tier", "tools"]) || event.ready !== true || !Array.isArray(event.tools)) {
        incompatibleGeneration("malformed_server_registration", event);
        return;
      }
      if (typeof event.lifecycle_protocol_generation !== "string" ||
          event.lifecycle_protocol_generation.length === 0) {
        incompatibleGeneration("missing_or_malformed_producer_generation", event);
        return;
      }
      if (event.lifecycle_protocol_generation !== STDIO_MCP_LIFECYCLE_PROTOCOL_GENERATION) {
        incompatibleGeneration("producer_consumer_generation_mismatch", event);
        return;
      }
      const mismatch = compareToolSurfaces(expectedToolNames, event.tools);
      if (mismatch) {
        recordFailure(new StdioMcpConduitError(
          STDIO_MCP_CONDUIT_ERROR_CODES.TOOL_SURFACE_MISMATCH,
          "host wiki-MCP registered tool surface does not match the launcher-derived role profile",
          mismatch));
        return;
      }
      readinessEvent = Object.freeze({
        ...event,
        tools: Object.freeze([...(event.tools ?? [])].sort())
      });

      clearServerTimer();
      transitionTo(LIFECYCLE_PHASES.SERVER_COMPATIBLE);
      serverReady.resolve(readinessEvent);
      transitionTo(LIFECYCLE_PHASES.AWAITING_CLIENT_INITIALIZE);
      return;
    }
    if (event.schema_version === CLIENT_INITIALIZED_SCHEMA) {
      if (!hasLifecycleEventKeys(event, ["schema_version", "initialized"]) ||
          event.initialized !== true) {
        invalidTransition("host wiki-MCP server emitted malformed client initialize evidence", event);
        return;
      }
      if (phase !== LIFECYCLE_PHASES.AWAITING_CLIENT_INITIALIZE) {
        invalidTransition("host wiki-MCP server emitted duplicate or impossible client initialize evidence", event);
        return;
      }
      transitionTo(LIFECYCLE_PHASES.AWAITING_EXACT_TOOLS_LIST);
      return;
    }
    if (event.schema_version === TOOLS_LISTED_SCHEMA) {
      if (!hasLifecycleEventKeys(event,
        ["schema_version", "tools_listed", "tools"]) ||
          event.tools_listed !== true || !Array.isArray(event.tools)) {
        invalidTransition("host wiki-MCP server emitted malformed tools/list evidence", event);
        return;
      }
      if (phase !== LIFECYCLE_PHASES.AWAITING_EXACT_TOOLS_LIST) {
        invalidTransition(
          phase === LIFECYCLE_PHASES.AWAITING_CLIENT_INITIALIZE
            ? "confined client requested tools/list before completing MCP initialize"
            : "host wiki-MCP server emitted duplicate or impossible tools/list evidence",
          event
        );
        return;
      }

      const mismatch = compareToolSurfaces(expectedToolNames, event.tools);
      if (mismatch) {
        recordFailure(new StdioMcpConduitError(
          STDIO_MCP_CONDUIT_ERROR_CODES.CLIENT_TOOL_SURFACE_MISMATCH,
          "tool surface returned to the confined client does not match the launcher-derived role profile",
          mismatch));
        return;
      }
      clearClientTimer();
      clientReadyResolved = true;
      transitionTo(LIFECYCLE_PHASES.READY);
      clientReady.resolve(Object.freeze({
        initialized: true,
        toolsListed: true,
        tools: Object.freeze([...(event.tools ?? [])].map(String).sort())
      }));
      return;
    }
    if (event.schema_version === CLIENT_RESTARTED_SCHEMA) {
      if (!hasLifecycleEventKeys(event,
        ["schema_version", "restarted", "restart_count"]) ||
          event.restarted !== true || !Number.isInteger(event.restart_count) ||
          event.restart_count < 1) {
        invalidTransition("host wiki-MCP server emitted malformed client restart evidence", event);
        return;
      }

      recordFailure(new StdioMcpConduitError(
        STDIO_MCP_CONDUIT_ERROR_CODES.CLIENT_RELAY_RESTARTED,
        "confined client restarted its MCP relay; the per-dispatch conduit cannot be resumed",
        { restart_count: Number.isInteger(event.restart_count) ? event.restart_count : null }));
      return;
    }
    if (event.schema_version === CLIENT_CLOSED_SCHEMA) {
      if (!hasLifecycleEventKeys(event, ["schema_version", "closed"]) ||
          event.closed !== true) {
        invalidTransition("host wiki-MCP server emitted malformed client-close evidence", event);
        return;
      }
      if (phase !== LIFECYCLE_PHASES.READY) {
        invalidTransition(
          phase === LIFECYCLE_PHASES.CLIENT_CLOSED
            ? "host wiki-MCP server emitted duplicate client-close evidence"
            : "confined client closed before completing lifecycle readiness",
          event
        );
        return;
      }

      transitionTo(LIFECYCLE_PHASES.CLIENT_CLOSED);
      return;
    }
    if (phase === LIFECYCLE_PHASES.AWAITING_SERVER_REGISTRATION) {
      incompatibleGeneration("unknown_server_registration_schema", event);
      return;
    }
    recordFailure(new StdioMcpConduitError(
      STDIO_MCP_CONDUIT_ERROR_CODES.SERVER_READINESS_FAILED,
      "host wiki-MCP server emitted an unknown lifecycle schema",
      { phase, ...boundedLifecycleEventDetail(event) }));
  };

  readyStream.setEncoding("utf8");
  let readinessStreamTerminalObserved = false;
  const finalizeReadinessStream = () => {
    if (readinessStreamTerminalObserved) return;
    readinessStreamTerminalObserved = true;
    if (buffer.length === 0) return;
    const bufferedCharacters = buffer.length;
    buffer = "";
    recordFailure(new StdioMcpConduitError(
      STDIO_MCP_CONDUIT_ERROR_CODES.SERVER_READINESS_FAILED,
      "host wiki-MCP server emitted malformed readiness",
      { reason: "unterminated_frame_at_eof", buffered_characters: bufferedCharacters }
    ));
  };
  readyStream.on("data", (chunk) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      let event;
      try {
        event = JSON.parse(line);
      } catch (error) {
        buffer = "";
        recordFailure(new StdioMcpConduitError(
          STDIO_MCP_CONDUIT_ERROR_CODES.SERVER_READINESS_FAILED,
          "host wiki-MCP server emitted malformed readiness",
          { message: error?.message ?? String(error) }));
        return;
      }
      handleEvent(event);
      if (failure !== null) return;
    }
  });
  readyStream.on("end", finalizeReadinessStream);
  readyStream.on("close", finalizeReadinessStream);

  return {
    serverReady: serverReady.promise,
    clientReady: clientReady.promise,
    failureSettlement: failureSettlement.promise,
    serverExit: serverExit.promise,
    beginClientReadiness: () => {
      if (clientReady.settled || clientTimer !== null) return;
      clientTimer = setTimeout(() => recordFailure(new StdioMcpConduitError(
        STDIO_MCP_CONDUIT_ERROR_CODES.CLIENT_READINESS_TIMEOUT,
        "confined client did not complete MCP initialize and tools/list within the launcher budget",
        {
          timeout_ms: clientReadinessTimeoutMs,
          initialized: phase === LIFECYCLE_PHASES.AWAITING_EXACT_TOOLS_LIST ||
            phase === LIFECYCLE_PHASES.READY ||
            phase === LIFECYCLE_PHASES.CLIENT_CLOSED ||
            phase === LIFECYCLE_PHASES.TERMINAL,
          phase
        }
      )), clientReadinessTimeoutMs);
    },
    markClientProcessTerminal: () => { clientProcessTerminal = true; },
    currentFailure: () => failure,
    isClientReady: () => clientReadyResolved,
    currentPhase: () => phase,
    phaseHistory: () => Object.freeze([...phaseHistory]),
    termination
  };
}

export {
  compareToolSurfaces,
  createChildTerminationLatch,
  observeConduitLifecycle
};
