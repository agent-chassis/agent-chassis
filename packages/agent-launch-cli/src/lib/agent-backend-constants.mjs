

export const AGENT_BACKEND_REQUEST_SCHEMA_VERSION = "agent-backend-request.v1";
export const AGENT_BACKEND_DECISION_SCHEMA_VERSION = "agent-backend-decision.v1";
export const AGENT_BACKEND_HANDSHAKE_REQUEST_SCHEMA_VERSION = "agent-backend-handshake.v1";
export const AGENT_BACKEND_HANDSHAKE_RESULT_SCHEMA_VERSION = "agent-backend-handshake-result.v1";

export const AGENT_BACKEND_KINDS = Object.freeze(["filesystem_mcp", "local_cli"]);
export const AGENT_BACKEND_AGENT_FAMILIES = Object.freeze(["codex", "claude", "agy"]);
export const AGENT_BACKEND_AGENT_ROLES = Object.freeze(["worker", "reviewer", "redteam"]);
export const AGENT_BACKEND_DECISION_MODES = Object.freeze(["local", "advisory", "enforced"]);
export const AGENT_BACKEND_HANDSHAKE_STATUSES = Object.freeze(["available", "unavailable", "misconfigured"]);
export const AGENT_BACKEND_HANDSHAKE_VALIDATION_TRANSPORTS = Object.freeze(["argv", "named", "unsupported"]);
export const AGENT_BACKEND_DECISION_SEVERITIES = Object.freeze(["info", "warning", "error"]);
export const AGENT_BACKEND_DECISION_CODES = Object.freeze([
  "agent_backend.filesystem_mcp.allowed.v1",
  "agent_backend.filesystem_mcp.unavailable.v1",
  "agent_backend.filesystem_mcp.misconfigured.v1",
  "agent_backend.filesystem_mcp.raw_exec_required_but_disabled.v1",
  "agent_backend.local_cli.socket_failure.v1",
  "agent_backend.local_cli.operator_only.v1",
  "agent_backend.profile.unsupported_agent_family.v1",
  "agent_backend.profile.unsupported_agent_profile.v1",
  "agent_backend.filesystem_mcp.verifier_capability_missing.v1",
  "agent_backend.filesystem_mcp.handshake_integrity_invalid.v1",
  "agent_backend.filesystem_mcp.handshake_expired.v1",
  "agent_backend.filesystem_mcp.handshake_future_dated.v1",
  "agent_backend.filesystem_mcp.handshake_schema_invalid.v1",
  "agent_backend.filesystem_mcp.handshake_mutated.v1",
  "agent_backend.filesystem_mcp.handshake_raw_exec_forbidden.v1",
  "agent_backend.filesystem_mcp.handshake_scope_binding_unavailable.v1",
  "agent_backend.filesystem_mcp.handshake_scope_digest_mismatch.v1",
  "agent_backend.filesystem_mcp.handshake_backend_identity_mismatch.v1",
  "agent_backend.filesystem_mcp.handshake_backend_version_mismatch.v1",
  "agent_backend.filesystem_mcp.handshake_mode_invalid.v1",
  "agent_backend.filesystem_mcp.handshake_profile_mismatch.v1",
  "agent_backend.filesystem_mcp.handshake_tool_surface_mismatch.v1",
  "agent_backend.filesystem_mcp.nonce_state_unavailable.v1",
  "agent_backend.filesystem_mcp.handshake_nonce_reused.v1"
]);

export const TOOL_SURFACE_KEYS = Object.freeze(["read", "write", "structured_validation", "final_report"]);

export const DEFAULT_FILESYSTEM_MCP_BACKEND_ID = "portfolio-filesystem-mcp";
export const DEFAULT_FILESYSTEM_MCP_BACKEND_VERSION = "0.1.0";

export const AGENT_BACKEND_FILESYSTEM_MCP_ENDPOINT_KINDS = Object.freeze(["spawn", "unix_socket"]);
export const AGENT_BACKEND_FILESYSTEM_MCP_REGISTRY_MODES = Object.freeze(["advisory", "enforced"]);
export const AGENT_BACKEND_FILESYSTEM_MCP_HANDSHAKE_TRANSPORT_KINDS = Object.freeze([
  "spawn_stdout",
  "unix_socket_reply"
]);
