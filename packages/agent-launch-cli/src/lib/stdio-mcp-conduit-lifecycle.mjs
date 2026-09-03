

import { performance } from "node:perf_hooks";

import {
  STDIO_MCP_CONDUIT_ERROR_CODES,
  STDIO_MCP_LIFECYCLE_EVENT_CLASSES,
  STDIO_MCP_LIFECYCLE_FAILURE_REASONS,
  STDIO_MCP_LIFECYCLE_PHASES,
  STDIO_MCP_LIFECYCLE_PROTOCOL_GENERATION,
  STDIO_MCP_LIFECYCLE_PROTOCOL_RECOVERY,
  STDIO_MCP_LIFECYCLE_VALIDATION_RULES,
  STDIO_MCP_READY_FD,
  StdioMcpConduitError,
  controlledLifecycleProtocolGeneration
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

const LIFECYCLE_PHASES = STDIO_MCP_LIFECYCLE_PHASES;

const SERVER_REGISTRATION_SCHEMA = "wiki-mcp-launcher-readiness.v2";
const LEGACY_SERVER_REGISTRATION_SCHEMA = "wiki-mcp-launcher-readiness.v1";
const CLIENT_INITIALIZED_SCHEMA = "wiki-mcp-launcher-client-initialized.v1";
const TOOLS_LISTED_SCHEMA = "wiki-mcp-launcher-tools-listed.v1";
const CLIENT_RESTARTED_SCHEMA = "wiki-mcp-launcher-client-restarted.v1";
const CLIENT_CLOSED_SCHEMA = "wiki-mcp-launcher-client-closed.v1";

const CLIENT_DISCOVERY_PROBE_CLOSED_SCHEMA =
  "wiki-mcp-launcher-client-closed.discovery-probe.v1";

const LIFECYCLE_EVENT_CLASS_BY_SCHEMA = new Map([
  [SERVER_REGISTRATION_SCHEMA, STDIO_MCP_LIFECYCLE_EVENT_CLASSES.SERVER_REGISTRATION],
  [LEGACY_SERVER_REGISTRATION_SCHEMA,
    STDIO_MCP_LIFECYCLE_EVENT_CLASSES.LEGACY_SERVER_REGISTRATION],
  [CLIENT_INITIALIZED_SCHEMA, STDIO_MCP_LIFECYCLE_EVENT_CLASSES.CLIENT_INITIALIZED],
  [TOOLS_LISTED_SCHEMA, STDIO_MCP_LIFECYCLE_EVENT_CLASSES.TOOLS_LISTED],
  [CLIENT_RESTARTED_SCHEMA, STDIO_MCP_LIFECYCLE_EVENT_CLASSES.CLIENT_RESTARTED],
  [CLIENT_CLOSED_SCHEMA, STDIO_MCP_LIFECYCLE_EVENT_CLASSES.CLIENT_CLOSED],
  [CLIENT_DISCOVERY_PROBE_CLOSED_SCHEMA,
    STDIO_MCP_LIFECYCLE_EVENT_CLASSES.CLIENT_DISCOVERY_PROBE_CLOSED]
]);

function lifecycleEventClass(event) {
  return LIFECYCLE_EVENT_CLASS_BY_SCHEMA.get(event?.schema_version) ??
    STDIO_MCP_LIFECYCLE_EVENT_CLASSES.UNRECOGNIZED;
}

function isPlainLifecycleEvent(event) {
  return event !== null && typeof event === "object" && !Array.isArray(event) &&
    (Object.getPrototypeOf(event) === Object.prototype ||
      Object.getPrototypeOf(event) === null);
}

function lifecycleEventKeyRule(event, required, allowed = required) {
  if (!isPlainLifecycleEvent(event)) {
    return STDIO_MCP_LIFECYCLE_VALIDATION_RULES.EVENT_NOT_PLAIN_OBJECT;
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(event, key)) {
      return STDIO_MCP_LIFECYCLE_VALIDATION_RULES.MISSING_REQUIRED_EVENT_KEY;
    }
  }
  for (const key of Object.keys(event)) {
    if (!allowed.includes(key)) {
      return STDIO_MCP_LIFECYCLE_VALIDATION_RULES.UNPERMITTED_EVENT_KEY;
    }
  }
  return null;
}

function lifecycleEventRule(event, required, allowed, exact = []) {
  const shape = lifecycleEventKeyRule(event, required, allowed);
  if (shape !== null) return shape;
  for (const holds of exact) {
    if (!holds(event)) return STDIO_MCP_LIFECYCLE_VALIDATION_RULES.FIELD_VALUE_NOT_EXACT;
  }
  return null;
}

function boundedEventSchemaVersion(event) {
  return typeof event?.schema_version === "string"
    ? event.schema_version.slice(0, 128)
    : null;
}

function observeConduitLifecycle({
  child,
  role,
  serverStartupTimeoutMs,
  clientReadinessTimeoutMs,
  expectedToolNames,
  getStderr = () => "",
  readinessMeasurements = null,

  termination = createChildTerminationLatch()
}) {
  const serverReady = deferred();
  const clientReady = deferred();
  const discoveryProbeClosed = deferred();

  const failureSettlement = deferred();

  const serverExit = deferred();
  let buffer = "";
  let clientReadyResolved = false;

  let clientProcessTerminal = false;

  let clientTransportEof = false;
  let clientDiscoveryProbeClosed = false;
  let readinessEvent = null;
  let failure = null;
  let serverTimer = null;
  let clientTimer = null;
  let phase = LIFECYCLE_PHASES.AWAITING_SERVER_REGISTRATION;
  const phaseHistory = [phase];

  let negotiatedProducerGeneration = null;

  const retainedGenerations = () => ({
    producer_protocol_generation: negotiatedProducerGeneration,
    consumer_protocol_generation: STDIO_MCP_LIFECYCLE_PROTOCOL_GENERATION,

    lifecycle_protocol_generation: negotiatedProducerGeneration
  });
  const snapshotReadinessMeasurements = () => Object.freeze({
    spawn_to_registration_elapsed_ms:
      Number.isFinite(readinessMeasurements?.spawn_to_registration_elapsed_ms) &&
        readinessMeasurements.spawn_to_registration_elapsed_ms >= 0
        ? readinessMeasurements.spawn_to_registration_elapsed_ms
        : null,
    authenticated_client_payload_bytes_before_close:
      Number.isInteger(readinessMeasurements?.authenticated_client_payload_bytes_before_close) &&
        readinessMeasurements.authenticated_client_payload_bytes_before_close >= 0
        ? readinessMeasurements.authenticated_client_payload_bytes_before_close
        : 0
  });
  const closeReadinessMeasurements = (event) =>
    event?.schema_version === CLIENT_CLOSED_SCHEMA ||
    event?.schema_version === CLIENT_DISCOVERY_PROBE_CLOSED_SCHEMA
      ? snapshotReadinessMeasurements()
      : {};

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

    const expected = code === 0 && signal === null && (
      clientDiscoveryProbeClosed ||
      (clientReadyResolved &&
        (role !== "orchestrator" || clientProcessTerminal || clientTransportEof))
    );
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
      { code, signal, stderr: getStderr(), ...retainedGenerations() }
    ));
  };

  const markClientTransportEof = () => {
    if (clientTransportEof) return false;
    clientTransportEof = true;
    return true;
  };

  const buildLifecycleFacade = (beginClientReadiness) => ({
    serverReady: serverReady.promise,
    clientReady: clientReady.promise,
    discoveryProbeClosed: discoveryProbeClosed.promise,
    failureSettlement: failureSettlement.promise,
    serverExit: serverExit.promise,
    beginClientReadiness,
    markClientProcessTerminal: () => { clientProcessTerminal = true; },
    markClientTransportEof,
    isClientTransportEof: () => clientTransportEof,
    isClientProcessTerminal: () => clientProcessTerminal,
    currentFailure: () => failure,
    isClientReady: () => clientReadyResolved,
    currentPhase: () => phase,
    phaseHistory: () => Object.freeze([...phaseHistory]),

    negotiatedProtocolGenerations: () => Object.freeze({
      producer: negotiatedProducerGeneration,
      consumer: STDIO_MCP_LIFECYCLE_PROTOCOL_GENERATION
    }),
    termination
  });

  child.once?.("error", (error) => finalizeChild("error", null, null, error));
  child.once?.("exit", (code, signal) => finalizeChild("exit", code, signal, null));
  child.once?.("close", (code, signal) => finalizeChild("close", code, signal, null));

  const readyStream = child.stdio?.[STDIO_MCP_READY_FD];
  if (!readyStream) {
    recordFailure(new StdioMcpConduitError(
      STDIO_MCP_CONDUIT_ERROR_CODES.SERVER_READINESS_FAILED,
      "host wiki-MCP server readiness pipe is unavailable"
    ));

    return buildLifecycleFacade(() => {});
  }

  const invalidTransition = (reason, message, event, validationRule = null) => recordFailure(
    new StdioMcpConduitError(
      STDIO_MCP_CONDUIT_ERROR_CODES.CLIENT_READINESS_FAILED,
      message,
      {
        lifecycle_reason: reason,
        lifecycle_phase: phase,
        lifecycle_event_class: lifecycleEventClass(event),

        lifecycle_validation_rule: validationRule,
        phase,
        schema_version: boundedEventSchemaVersion(event),
        ...retainedGenerations(),
        ...closeReadinessMeasurements(event)
      }
    ));

  const incompatibleGeneration = (reason, event) => recordFailure(new StdioMcpConduitError(
    STDIO_MCP_CONDUIT_ERROR_CODES.LIFECYCLE_PROTOCOL_INCOMPATIBLE,
    "spawned host wiki-MCP server lifecycle generation is incompatible with the launcher",
    {
      reason,
      producer_protocol_generation:
        controlledLifecycleProtocolGeneration(event?.lifecycle_protocol_generation),
      consumer_protocol_generation: STDIO_MCP_LIFECYCLE_PROTOCOL_GENERATION,
      lifecycle_event_class: lifecycleEventClass(event),
      schema_version: boundedEventSchemaVersion(event),
      recovery: STDIO_MCP_LIFECYCLE_PROTOCOL_RECOVERY,
      ...closeReadinessMeasurements(event)
    }
  ));

  const handleEvent = (event) => {
    if (!isPlainLifecycleEvent(event)) {
      invalidTransition(STDIO_MCP_LIFECYCLE_FAILURE_REASONS.MALFORMED_LIFECYCLE_EVENT,
        "host wiki-MCP server emitted a malformed lifecycle event", event,
        STDIO_MCP_LIFECYCLE_VALIDATION_RULES.EVENT_NOT_PLAIN_OBJECT);
      return;
    }
    if (typeof event.schema_version !== "string") {
      invalidTransition(STDIO_MCP_LIFECYCLE_FAILURE_REASONS.MALFORMED_LIFECYCLE_EVENT,
        "host wiki-MCP server emitted a malformed lifecycle event", event,
        STDIO_MCP_LIFECYCLE_VALIDATION_RULES.SCHEMA_VERSION_NOT_STRING);
      return;
    }
    if (phase === LIFECYCLE_PHASES.TERMINAL ||
        (phase === LIFECYCLE_PHASES.CLIENT_CLOSED &&
          event.schema_version !== CLIENT_CLOSED_SCHEMA)) {
      invalidTransition(STDIO_MCP_LIFECYCLE_FAILURE_REASONS.EVIDENCE_AFTER_TERMINAL_CLOSE,
        "host wiki-MCP server emitted lifecycle evidence after terminal close", event,
        STDIO_MCP_LIFECYCLE_VALIDATION_RULES.PHASE_NOT_PERMITTED);
      return;
    }

    if (event.schema_version === SERVER_REGISTRATION_SCHEMA ||
        event.schema_version === LEGACY_SERVER_REGISTRATION_SCHEMA) {
      if (phase !== LIFECYCLE_PHASES.AWAITING_SERVER_REGISTRATION) {
        invalidTransition(STDIO_MCP_LIFECYCLE_FAILURE_REASONS.DUPLICATE_SERVER_REGISTRATION,
          "host wiki-MCP server emitted duplicate server registration", event,
          STDIO_MCP_LIFECYCLE_VALIDATION_RULES.PHASE_NOT_PERMITTED);
        return;
      }
      if (event.schema_version !== SERVER_REGISTRATION_SCHEMA) {
        incompatibleGeneration("legacy_server_registration_schema", event);
        return;
      }
      if (lifecycleEventRule(event,
        ["schema_version", "lifecycle_protocol_generation", "ready", "tools"],
        ["schema_version", "lifecycle_protocol_generation", "ready", "tool_profile",
          "registered_tier", "tools"],
        [(e) => e.ready === true, (e) => Array.isArray(e.tools)]) !== null) {
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

      negotiatedProducerGeneration = STDIO_MCP_LIFECYCLE_PROTOCOL_GENERATION;
      const mismatch = compareToolSurfaces(expectedToolNames, event.tools);
      if (mismatch) {
        recordFailure(new StdioMcpConduitError(
          STDIO_MCP_CONDUIT_ERROR_CODES.TOOL_SURFACE_MISMATCH,
          "host wiki-MCP registered tool surface does not match the launcher-derived role profile",
          { ...mismatch, ...retainedGenerations() }));
        return;
      }
      if (readinessMeasurements !== null) {
        readinessMeasurements.spawn_to_registration_elapsed_ms = Math.max(
          0,
          performance.now() - readinessMeasurements.spawnStartedAt
        );
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
      const initializedRule = lifecycleEventRule(event,
        ["schema_version", "initialized"], ["schema_version", "initialized"],
        [(e) => e.initialized === true]);
      if (initializedRule !== null) {
        invalidTransition(STDIO_MCP_LIFECYCLE_FAILURE_REASONS.MALFORMED_CLIENT_INITIALIZE,
          "host wiki-MCP server emitted malformed client initialize evidence", event,
          initializedRule);
        return;
      }
      if (phase !== LIFECYCLE_PHASES.AWAITING_CLIENT_INITIALIZE) {
        invalidTransition(STDIO_MCP_LIFECYCLE_FAILURE_REASONS.DUPLICATE_CLIENT_INITIALIZE,
          "host wiki-MCP server emitted duplicate or impossible client initialize evidence", event,
          STDIO_MCP_LIFECYCLE_VALIDATION_RULES.PHASE_NOT_PERMITTED);
        return;
      }
      transitionTo(LIFECYCLE_PHASES.AWAITING_EXACT_TOOLS_LIST);
      return;
    }
    if (event.schema_version === TOOLS_LISTED_SCHEMA) {
      const toolsListedRule = lifecycleEventRule(event,
        ["schema_version", "tools_listed", "tools"],
        ["schema_version", "tools_listed", "tools"],
        [(e) => e.tools_listed === true, (e) => Array.isArray(e.tools)]);
      if (toolsListedRule !== null) {
        invalidTransition(STDIO_MCP_LIFECYCLE_FAILURE_REASONS.MALFORMED_TOOLS_LISTED,
          "host wiki-MCP server emitted malformed tools/list evidence", event,
          toolsListedRule);
        return;
      }
      if (phase !== LIFECYCLE_PHASES.AWAITING_EXACT_TOOLS_LIST) {
        const toolsListBeforeInitialize =
          phase === LIFECYCLE_PHASES.AWAITING_CLIENT_INITIALIZE;
        invalidTransition(
          toolsListBeforeInitialize
            ? STDIO_MCP_LIFECYCLE_FAILURE_REASONS.TOOLS_LIST_BEFORE_INITIALIZE
            : STDIO_MCP_LIFECYCLE_FAILURE_REASONS.DUPLICATE_TOOLS_LISTED,
          toolsListBeforeInitialize
            ? "confined client requested tools/list before completing MCP initialize"
            : "host wiki-MCP server emitted duplicate or impossible tools/list evidence",
          event,
          STDIO_MCP_LIFECYCLE_VALIDATION_RULES.PHASE_NOT_PERMITTED
        );
        return;
      }

      const mismatch = compareToolSurfaces(expectedToolNames, event.tools);
      if (mismatch) {
        recordFailure(new StdioMcpConduitError(
          STDIO_MCP_CONDUIT_ERROR_CODES.CLIENT_TOOL_SURFACE_MISMATCH,
          "tool surface returned to the confined client does not match the launcher-derived role profile",
          { ...mismatch, ...retainedGenerations() }));
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
      const restartedRule = lifecycleEventRule(event,
        ["schema_version", "restarted", "restart_count"],
        ["schema_version", "restarted", "restart_count"],
        [(e) => e.restarted === true,
          (e) => Number.isInteger(e.restart_count) && e.restart_count >= 1]);
      if (restartedRule !== null) {
        invalidTransition(STDIO_MCP_LIFECYCLE_FAILURE_REASONS.MALFORMED_CLIENT_RESTARTED,
          "host wiki-MCP server emitted malformed client restart evidence", event,
          restartedRule);
        return;
      }

      recordFailure(new StdioMcpConduitError(
        STDIO_MCP_CONDUIT_ERROR_CODES.CLIENT_RELAY_RESTARTED,
        "confined client restarted its MCP relay; the per-dispatch conduit cannot be resumed",
        {
          restart_count: Number.isInteger(event.restart_count) ? event.restart_count : null,
          ...retainedGenerations()
        }));
      return;
    }

    if (event.schema_version === CLIENT_DISCOVERY_PROBE_CLOSED_SCHEMA) {
      const probeRule = lifecycleEventRule(event,
        ["schema_version", "closed", "discovery_probe"],
        ["schema_version", "closed", "discovery_probe"],
        [(e) => e.closed === true, (e) => e.discovery_probe === true]);
      if (probeRule !== null) {
        invalidTransition(
          STDIO_MCP_LIFECYCLE_FAILURE_REASONS.MALFORMED_CLIENT_DISCOVERY_PROBE_CLOSED,
          "host wiki-MCP server emitted malformed client discovery-probe close evidence",
          event, probeRule);
        return;
      }

      if (phase !== LIFECYCLE_PHASES.AWAITING_CLIENT_INITIALIZE) {
        invalidTransition(
          STDIO_MCP_LIFECYCLE_FAILURE_REASONS.UNEXPECTED_CLIENT_DISCOVERY_PROBE_CLOSED,
          "host wiki-MCP server reported a client discovery probe outside the pre-initialize phase",
          event, STDIO_MCP_LIFECYCLE_VALIDATION_RULES.PHASE_NOT_PERMITTED);
        return;
      }
      clientDiscoveryProbeClosed = true;
      clearClientTimer();
      transitionTo(LIFECYCLE_PHASES.TERMINAL);
      discoveryProbeClosed.resolve(Object.freeze({ discoveryProbe: true }));
      return;
    }
    if (event.schema_version === CLIENT_CLOSED_SCHEMA) {

      const closedRule = lifecycleEventRule(event,
        ["schema_version", "closed"], ["schema_version", "closed"],
        [(e) => e.closed === true]);
      if (closedRule !== null) {
        invalidTransition(STDIO_MCP_LIFECYCLE_FAILURE_REASONS.MALFORMED_CLIENT_CLOSED,
          "host wiki-MCP server emitted malformed client-close evidence", event,
          closedRule);
        return;
      }
      if (phase !== LIFECYCLE_PHASES.READY) {
        const duplicateClose = phase === LIFECYCLE_PHASES.CLIENT_CLOSED;
        invalidTransition(
          duplicateClose
            ? STDIO_MCP_LIFECYCLE_FAILURE_REASONS.DUPLICATE_CLIENT_CLOSED
            : STDIO_MCP_LIFECYCLE_FAILURE_REASONS.CLIENT_CLOSED_BEFORE_READINESS,
          duplicateClose
            ? "host wiki-MCP server emitted duplicate client-close evidence"
            : "confined client closed before completing lifecycle readiness",
          event,
          STDIO_MCP_LIFECYCLE_VALIDATION_RULES.PHASE_NOT_PERMITTED
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
      {
        lifecycle_reason: STDIO_MCP_LIFECYCLE_FAILURE_REASONS.UNKNOWN_LIFECYCLE_SCHEMA,
        lifecycle_phase: phase,
        lifecycle_event_class: lifecycleEventClass(event),
        lifecycle_validation_rule: null,
        phase,
        schema_version: boundedEventSchemaVersion(event),
        ...retainedGenerations()
      }));
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
      {
        reason: "unterminated_frame_at_eof",
        buffered_characters: bufferedCharacters,
        ...retainedGenerations()
      }
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

  return buildLifecycleFacade(() => {
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
        lifecycle_phase: phase,
        phase,
        ...retainedGenerations()
      }
    )), clientReadinessTimeoutMs);
  });
}

export {
  compareToolSurfaces,
  createChildTerminationLatch,
  observeConduitLifecycle
};
