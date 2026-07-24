import { readFileSync } from "node:fs";

import {
  loadToolDiscoveryDescriptor,
  resolveToolTierVisibility,
  SESSION_ROLE_TOOL_ACCESS_POLICY_PATH,
  resolveRoleToolGrantsFromPolicy
} from "@agent-chassis/wiki-core/src/lib/tool-discovery.mjs";
import { resolveClientConfig } from "@agent-chassis/wiki-core/src/lib/node-engine-api-client.mjs";

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
  const config = resolveClientConfig(env ?? {});
  if (config?.apiKey) return roleTools;

  const descriptor = await loadToolDiscoveryDescriptor();
  const freeLocal = new Set();
  for (const tool of Array.isArray(descriptor?.tools) ? descriptor.tools : []) {
    if (tool?.kind === "mcp_tool" && typeof tool.tool_name === "string" &&
        resolveToolTierVisibility(tool).includes("free_local")) {
      freeLocal.add(tool.tool_name);
    }
  }
  return Object.freeze(roleTools.filter((name) => freeLocal.has(name)));
}
