

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
  LIFECYCLE_PROTOCOL_INCOMPATIBLE: "stdio_mcp_lifecycle_protocol_incompatible",
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

export const STDIO_MCP_LIFECYCLE_FAILURE_REASONS = Object.freeze({
  MALFORMED_LIFECYCLE_EVENT: "malformed_lifecycle_event",
  EVIDENCE_AFTER_TERMINAL_CLOSE: "lifecycle_evidence_after_terminal_close",
  DUPLICATE_SERVER_REGISTRATION: "duplicate_server_registration",
  MALFORMED_CLIENT_INITIALIZE: "malformed_client_initialize_evidence",
  DUPLICATE_CLIENT_INITIALIZE: "duplicate_client_initialize_evidence",
  MALFORMED_TOOLS_LISTED: "malformed_tools_listed_evidence",
  TOOLS_LIST_BEFORE_INITIALIZE: "tools_list_before_client_initialize",
  DUPLICATE_TOOLS_LISTED: "duplicate_tools_listed_evidence",
  MALFORMED_CLIENT_RESTARTED: "malformed_client_restart_evidence",
  MALFORMED_CLIENT_CLOSED: "malformed_client_close_evidence",
  DUPLICATE_CLIENT_CLOSED: "duplicate_client_close_evidence",
  CLIENT_CLOSED_BEFORE_READINESS: "client_closed_before_lifecycle_readiness",

  MALFORMED_CLIENT_DISCOVERY_PROBE_CLOSED: "malformed_client_discovery_probe_close_evidence",
  UNEXPECTED_CLIENT_DISCOVERY_PROBE_CLOSED: "unexpected_client_discovery_probe_close",
  UNKNOWN_LIFECYCLE_SCHEMA: "unknown_lifecycle_schema"
});

export const STDIO_MCP_LIFECYCLE_VALIDATION_RULES = Object.freeze({
  EVENT_NOT_PLAIN_OBJECT: "event_not_plain_object",
  SCHEMA_VERSION_NOT_STRING: "schema_version_not_string",

  UNPERMITTED_EVENT_KEY: "unpermitted_event_key",
  MISSING_REQUIRED_EVENT_KEY: "missing_required_event_key",

  FIELD_VALUE_NOT_EXACT: "field_value_not_exact",

  PHASE_NOT_PERMITTED: "phase_not_permitted"
});

export const STDIO_MCP_LIFECYCLE_PHASES = Object.freeze({

  AWAITING_CLIENT_AUTHENTICATION: "awaiting_client_authentication",
  AWAITING_SERVER_REGISTRATION: "awaiting_server_registration_generation",
  SERVER_COMPATIBLE: "server_compatible",
  AWAITING_CLIENT_INITIALIZE: "awaiting_client_initialize",
  AWAITING_EXACT_TOOLS_LIST: "awaiting_exact_tools_list",
  READY: "ready",
  CLIENT_CLOSED: "client_closed",
  FAILED: "failed",
  TERMINAL: "terminal"
});

export const STDIO_MCP_LIFECYCLE_EVENT_CLASSES = Object.freeze({
  SERVER_REGISTRATION: "server_registration",
  LEGACY_SERVER_REGISTRATION: "legacy_server_registration",
  CLIENT_INITIALIZED: "client_initialized",
  TOOLS_LISTED: "tools_listed",
  CLIENT_RESTARTED: "client_restarted",
  CLIENT_CLOSED: "client_closed",
  CLIENT_DISCOVERY_PROBE_CLOSED: "client_discovery_probe_closed",
  UNRECOGNIZED: "unrecognized"
});

const LIFECYCLE_FAILURE_REASON_SET = new Set(
  Object.values(STDIO_MCP_LIFECYCLE_FAILURE_REASONS));
const LIFECYCLE_PHASE_SET = new Set(Object.values(STDIO_MCP_LIFECYCLE_PHASES));
const LIFECYCLE_EVENT_CLASS_SET = new Set(
  Object.values(STDIO_MCP_LIFECYCLE_EVENT_CLASSES));
const LIFECYCLE_VALIDATION_RULE_SET = new Set(
  Object.values(STDIO_MCP_LIFECYCLE_VALIDATION_RULES));

export function controlledLifecycleFailureReason(value) {
  return LIFECYCLE_FAILURE_REASON_SET.has(value) ? value : null;
}

export function controlledLifecyclePhase(value) {
  return LIFECYCLE_PHASE_SET.has(value) ? value : null;
}

export function controlledLifecycleEventClass(value) {
  return LIFECYCLE_EVENT_CLASS_SET.has(value) ? value : null;
}

export function controlledLifecycleValidationRule(value) {
  return LIFECYCLE_VALIDATION_RULE_SET.has(value) ? value : null;
}

const LIFECYCLE_PROTOCOL_GENERATION_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/u;

export function controlledLifecycleProtocolGeneration(value) {
  return typeof value === "string" && LIFECYCLE_PROTOCOL_GENERATION_RE.test(value)
    ? value
    : null;
}

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
