import { readFileSync } from "node:fs";

import {
  loadToolDiscoveryDescriptor,
  SESSION_ROLE_TOOL_ACCESS_POLICY_PATH,
  resolveRoleToolGrantsFromPolicy
} from "@agent-chassis/wiki-core/src/lib/tool-discovery.mjs";
import { resolveSessionProfileForEnv, sessionProfileAllowsTool } from "@agent-chassis/wiki-core/src/lib/tool-discovery/session-profile.mjs";

const SUPPORTED_CONFINED_ROLES = Object.freeze(new Set([
  "orchestrator", "reviewer", "worker", "redteam"
]));

let cached = null;

function roleGrants() {
  if (cached !== null) return cached;
  const policy = JSON.parse(readFileSync(SESSION_ROLE_TOOL_ACCESS_POLICY_PATH, "utf8"));
  cached = resolveRoleToolGrantsFromPolicy(policy);
  return cached;
}

export function resolveLauncherRoleToolNames(role) {
  const normalized = role === "review" ? "reviewer" : role;
  if (!SUPPORTED_CONFINED_ROLES.has(normalized)) {
    throw new Error(`unsupported confined wiki-MCP role profile: ${String(role)}`);
  }
  const grants = roleGrants().get(normalized);
  if (!(grants instanceof Set)) {
    throw new Error(`wiki-MCP role profile is absent: ${normalized}`);
  }
  return Object.freeze([...grants].sort());
}

export async function resolveLauncherRoleToolNamesForEnv(role, env) {
  const roleTools = resolveLauncherRoleToolNames(role);
  const profile = resolveSessionProfileForEnv(env ?? {});
  const descriptor = await loadToolDiscoveryDescriptor();
  const visible = new Set(descriptor.tools.filter(tool => sessionProfileAllowsTool(profile, tool)).map(tool => tool.tool_name));
  return Object.freeze(roleTools.filter(name => visible.has(name)));
}
