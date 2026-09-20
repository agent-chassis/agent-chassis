

import {
  STDIO_MCP_CONDUIT_ERROR_CODES,
  controlledLifecycleEventClass,
  controlledLifecycleFailureReason,
  controlledLifecyclePhase,
  controlledLifecycleProtocolGeneration,
  controlledLifecycleValidationRule,
  failStdioMcpConduit
} from "./stdio-mcp-conduit-errors.mjs";
import {
  assertStdioMcpConduitChannelAvailable,
  assertStdioMcpConduitChannelBinding
} from "./stdio-mcp-conduit-channel.mjs";

export {
  STDIO_MCP_CONDUIT_ERROR_CODES,
  STDIO_MCP_LIFECYCLE_EVENT_CLASSES,
  STDIO_MCP_LIFECYCLE_FAILURE_REASONS,
  STDIO_MCP_LIFECYCLE_PHASES,
  STDIO_MCP_LIFECYCLE_VALIDATION_RULES,
  StdioMcpConduitError,
  controlledLifecycleEventClass,
  controlledLifecycleFailureReason,
  controlledLifecyclePhase,
  controlledLifecycleProtocolGeneration,
  controlledLifecycleValidationRule,
  failStdioMcpConduit
} from "./stdio-mcp-conduit-errors.mjs";
export {
  STDIO_MCP_CLIENT_TO_SERVER_PATH,
  STDIO_MCP_CONDUIT_BINDING_SCHEMA_VERSION,
  STDIO_MCP_CONDUIT_INPUT_FD,
  STDIO_MCP_CONDUIT_OUTPUT_FD,
  STDIO_MCP_CONDUIT_ROOT,
  STDIO_MCP_CONDUIT_TRANSPORT_FIFO,
  STDIO_MCP_CONDUIT_TRANSPORT_LOCAL,
  STDIO_MCP_LOCAL_ENDPOINT_PATH,
  STDIO_MCP_LOCAL_TOKEN_PATH,
  STDIO_MCP_RELAY_ARGS,
  STDIO_MCP_RELAY_COMMAND,
  STDIO_MCP_SERVER_TO_CLIENT_PATH,
  createStdioMcpChannelRelayRegistration,
  isRegisteredTrustedStdioMcpConduitBinding,
  projectStdioMcpChannelClientRegistration,
  projectStdioMcpChannelNamespaceArgs,
  recordLauncherObservedStdioMcpClientTerminal,
  resolveConduitChildStdio
} from "./stdio-mcp-conduit-channel.mjs";
export {
  countProcessLocalStdioMcpConduits,
  drainProcessLocalStdioMcpConduits,
  registerProcessLocalStdioMcpConduit
} from "./stdio-mcp-conduit-process-registry.mjs";

export const STDIO_MCP_CONDUIT_SCHEMA_VERSION = "launcher-stdio-mcp-conduit.v1";

const LAUNCHER_PRIVATE_STATE_REDACTION_REASON = "launcher_private_state";
const STDIO_MCP_CONDUIT_ERROR_CODE_SET = new Set(
  Object.values(STDIO_MCP_CONDUIT_ERROR_CODES)
);

function controlledConduitErrorCode(value) {
  return STDIO_MCP_CONDUIT_ERROR_CODE_SET.has(value) ? value : null;
}

export const STDIO_MCP_LIFECYCLE_PROTOCOL_GENERATION =
  "stdio-mcp-conduit-lifecycle-vocabulary.v2";
export const STDIO_MCP_LIFECYCLE_PROTOCOL_RECOVERY =
  "deploy one coherent build and restart the long-lived backend";

export const STDIO_MCP_READY_FD = 3;

export const STDIO_MCP_SERVER_STARTUP_TIMEOUT_MS = 30_000;
export const STDIO_MCP_CLIENT_READINESS_TIMEOUT_MS = 180_000;

export const STDIO_MCP_CLIENT_READINESS_TIMEOUT_SEC =
  STDIO_MCP_CLIENT_READINESS_TIMEOUT_MS / 1_000;

export const STDIO_MCP_TERMINAL_DRAIN_GRACE_MS = 20_000;
export const STDIO_MCP_TERMINAL_KILL_GRACE_MS = 5_000;

export const STDIO_MCP_ABNORMAL_DRAIN_GRACE_MS = 2_000;

export const STDIO_MCP_CONDUIT_RUN_TIMEOUT_MS = 45 * 60_000;

export const STDIO_MCP_CONDUIT_REQUIRES_BUBBLEWRAP_REASON =
  "stdio_mcp_conduit_requires_bubblewrap";
export const STDIO_MCP_CLIENT_READINESS_BLOCKER_REASON =
  "stdio_mcp_client_readiness_failed";
export const STDIO_MCP_CLEANUP_BLOCKER_REASON = "stdio_mcp_cleanup_failed";

export const STDIO_MCP_CONDUIT_ALLOWED_FAMILIES = Object.freeze(new Set(["claude", "codex"]));
export const STDIO_MCP_CONDUIT_ALLOWED_ROLES = Object.freeze(
  new Set(["orchestrator", "worker", "reviewer", "redteam"])
);

export function normalizeStdioMcpConduitRole(role) {
  return role === "review" ? "reviewer" : role;
}

export function assertTrustedStdioMcpConduitBinding(binding) {
  assertStdioMcpConduitChannelBinding(binding);
  if (!STDIO_MCP_CONDUIT_ALLOWED_FAMILIES.has(binding.family) ||
      !STDIO_MCP_CONDUIT_ALLOWED_ROLES.has(binding.role)) {
    failStdioMcpConduit(STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID,
      "launch plan requires one exact launcher-minted stdio MCP conduit binding");
  }
  assertStdioMcpConduitChannelAvailable(binding);
  return binding;
}

export function describeStdioMcpConduitLaunchFailure(conduit) {
  const primary = conduit?.failure ?? conduit?.readinessFailure ?? null;
  if (primary) {
    return {
      reason: STDIO_MCP_CLIENT_READINESS_BLOCKER_REASON,
      detail: {
        conduit_error_code: controlledConduitErrorCode(primary.code),
        ...projectControlledLifecycleDetail(primary.detail),
        redactions: classifyConduitPrivateFields(primary),
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
        conduit_error_code: controlledConduitErrorCode(cleanup.code),
        ...projectControlledLifecycleDetail(cleanup.detail),
        redactions: classifyConduitPrivateFields(cleanup),
        run_id: conduit.runId ?? null
      }
    };
  }
  return null;
}

function classifyConduitPrivateFields(error) {
  const redactions = [];
  if (error?.message !== undefined) {
    redactions.push(Object.freeze({
      field: "message",
      reason: LAUNCHER_PRIVATE_STATE_REDACTION_REASON
    }));
  }
  if (error?.detail !== null && error?.detail !== undefined) {
    redactions.push(Object.freeze({
      field: "detail",
      reason: LAUNCHER_PRIVATE_STATE_REDACTION_REASON
    }));
  }
  return Object.freeze(redactions);
}

function projectControlledLifecycleDetail(detail) {
  return Object.freeze({
    lifecycle_reason: controlledLifecycleFailureReason(detail?.lifecycle_reason),
    lifecycle_phase: controlledLifecyclePhase(detail?.lifecycle_phase),
    lifecycle_event_class: controlledLifecycleEventClass(detail?.lifecycle_event_class),
    lifecycle_validation_rule:
      controlledLifecycleValidationRule(detail?.lifecycle_validation_rule),
    producer_protocol_generation:
      controlledLifecycleProtocolGeneration(detail?.producer_protocol_generation),
    consumer_protocol_generation:
      controlledLifecycleProtocolGeneration(detail?.consumer_protocol_generation)
  });
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
          error: failure?.reason ?? "stdio mcp conduit failed"
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
        code: controlledConduitErrorCode(cleanupFailure.code),
        ...projectControlledLifecycleDetail(cleanupFailure.detail),
        redactions: classifyConduitPrivateFields(cleanupFailure)
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
