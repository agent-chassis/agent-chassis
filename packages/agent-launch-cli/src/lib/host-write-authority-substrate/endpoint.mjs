

import {
  isNonEmptyString,
  isPlainObject
} from "./protocol-constants.mjs";

export const HOST_WRITE_AUTHORITY_BROKER_ERROR_CODES = Object.freeze({
  SOCKET_PATH_REQUIRED: "agent_launch.host_write_authority.broker.socket_path_required.v1",
  SOCKET_PATH_NOT_ABSOLUTE: "agent_launch.host_write_authority.broker.socket_path_not_absolute.v1",
  SOCKET_PARENT_UNUSABLE: "agent_launch.host_write_authority.broker.socket_parent_unusable.v1",
  SOCKET_STALE_REMOVE_FAILED: "agent_launch.host_write_authority.broker.socket_stale_remove_failed.v1",
  SOCKET_LISTEN_FAILED: "agent_launch.host_write_authority.broker.socket_listen_failed.v1",
  SERVER_ALREADY_STARTED: "agent_launch.host_write_authority.broker.server_already_started.v1",
  REQUEST_TOO_LARGE: "agent_launch.host_write_authority.broker.request_too_large.v1",
  ENDPOINT_INVALID: "agent_launch.host_write_authority.broker.endpoint_invalid.v1",
  TRANSPORT_AMBIGUOUS: "agent_launch.host_write_authority.broker.transport_ambiguous.v1",
  TRANSPORT_MISSING: "agent_launch.host_write_authority.broker.transport_missing.v1"
});

export const HOST_WRITE_AUTHORITY_SIDECAR_ENDPOINT_ENV_VAR =
  "AGENT_LAUNCH_HOST_WRITE_AUTHORITY_TCP_ENDPOINT";

function isPositivePortNumber(value) {
  return Number.isInteger(value) && value > 0 && value < 65536;
}

export function normalizeEndpointShape(
  endpoint,
  { allowPortZero = false, requireLoopback = false } = {}
) {
  if (!isPlainObject(endpoint)) return null;
  const host = typeof endpoint.host === "string" ? endpoint.host : null;
  const port = typeof endpoint.port === "number" ? endpoint.port : null;
  if (!isNonEmptyString(host)) return null;
  if (requireLoopback && host !== "127.0.0.1") return null;
  if (port === null || !Number.isInteger(port) || port < 0 || port >= 65536) return null;
  if (port === 0 && !allowPortZero) return null;
  return { host, port };
}

export function formatEndpoint(endpoint) {
  return `${endpoint.host}:${endpoint.port}`;
}

export function parseHostWriteAuthoritySidecarEndpoint(value) {
  if (!isNonEmptyString(value)) return null;
  const idx = value.lastIndexOf(":");
  if (idx <= 0 || idx === value.length - 1) return null;
  const host = value.slice(0, idx);
  const portText = value.slice(idx + 1);
  if (!/^[0-9]+$/.test(portText)) return null;
  const port = Number(portText);
  return normalizeEndpointShape({ host, port }, { requireLoopback: true });
}

export function resolveHostWriteAuthoritySidecarEndpoint(env = process.env) {
  return parseHostWriteAuthoritySidecarEndpoint(
    env?.[HOST_WRITE_AUTHORITY_SIDECAR_ENDPOINT_ENV_VAR]
  );
}

export class HostWriteAuthorityBrokerError extends Error {
  constructor(message, { code, detail = null, cause = null } = {}) {
    super(message);
    this.name = "HostWriteAuthorityBrokerError";
    this.code = code ?? "agent_launch.host_write_authority.broker.error.v1";
    if (detail !== null) this.detail = detail;
    if (cause !== null) this.cause = cause;
  }
}

export function brokerFailServer(code, message, detail = null, cause = null) {
  throw new HostWriteAuthorityBrokerError(
    `agent-launch host write authority broker: ${message}`,
    { code, detail, cause }
  );
}

export { isPositivePortNumber };
