

import { lstatSync } from "node:fs";
import path from "node:path";

export const MCP_METRICS_ROOT_ENV_VAR = "AGENT_CHASSIS_MCP_METRICS_ROOT";

export const MCP_METRICS_CONFIG_STATES = Object.freeze({
  DISABLED: "disabled",
  ENABLED: "enabled",
  UNAVAILABLE: "unavailable"
});

export const MCP_METRICS_CONFIG_UNAVAILABLE_REASONS = Object.freeze([
  "not_absolute",
  "uid_unavailable",
  "unreadable",
  "not_a_real_directory",
  "not_owned",
  "not_owner_private"
]);

function currentUid() {
  return typeof process.getuid === "function" ? process.getuid() : null;
}

const unavailable = (reason) => Object.freeze({
  state: MCP_METRICS_CONFIG_STATES.UNAVAILABLE,
  root: null,
  reason
});

export function resolveMcpMetricsConfig(env = process.env, {
  uid = currentUid(),
  lstat = lstatSync
} = {}) {
  const candidate = env?.[MCP_METRICS_ROOT_ENV_VAR];
  if (typeof candidate !== "string" || candidate.length === 0) {
    return Object.freeze({ state: MCP_METRICS_CONFIG_STATES.DISABLED, root: null, reason: null });
  }
  if (!path.isAbsolute(candidate)) return unavailable("not_absolute");
  if (uid === null) return unavailable("uid_unavailable");
  let stats;
  try {
    stats = lstat(candidate);
  } catch {
    return unavailable("unreadable");
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) return unavailable("not_a_real_directory");
  if (stats.uid !== uid) return unavailable("not_owned");
  if ((stats.mode & 0o777) !== 0o700) return unavailable("not_owner_private");
  return Object.freeze({
    state: MCP_METRICS_CONFIG_STATES.ENABLED,
    root: path.resolve(candidate),
    reason: null
  });
}

export function mcpMetricsServerEnv(env = process.env, options = {}) {
  const resolved = resolveMcpMetricsConfig(env, options);
  return resolved.state === MCP_METRICS_CONFIG_STATES.ENABLED
    ? { [MCP_METRICS_ROOT_ENV_VAR]: resolved.root }
    : {};
}
