

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
