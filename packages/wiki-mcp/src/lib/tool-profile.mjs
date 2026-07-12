

import { readFileSync } from "node:fs";

import { resolveClientConfig } from "@agent-chassis/wiki-core/src/lib/node-engine-api-client.mjs";
import {
  SESSION_ROLE_TOOL_ACCESS_POLICY_PATH,
  resolveRoleToolGrantsFromPolicy
} from "@agent-chassis/wiki-core/src/lib/tool-discovery.mjs";

const TOOL_PROFILE_ORCHESTRATOR = "orchestrator";
const TOOL_PROFILE_REVIEWER = "reviewer";
const TOOL_PROFILE_WORKER = "worker";
const TOOL_PROFILE_REDTEAM = "redteam";
const TOOL_PROFILE_OPERATOR = "operator";

export const SESSION_ROLE_VALUES = Object.freeze([
  TOOL_PROFILE_ORCHESTRATOR,
  TOOL_PROFILE_REVIEWER,
  TOOL_PROFILE_WORKER,
  TOOL_PROFILE_REDTEAM,
  TOOL_PROFILE_OPERATOR
]);

const TOOL_PROFILE_FULL = "full";
const TOOL_PROFILE_AGENT_SAFE = "agent-safe";

export const REGISTERED_TIER_FREE_LOCAL = "free_local";
export const REGISTERED_TIER_PAID_CCE = "paid_cce";

let cachedRoleToolGrants = null;

function loadRoleToolGrants() {
  if (cachedRoleToolGrants) {
    return cachedRoleToolGrants;
  }
  const raw = readFileSync(SESSION_ROLE_TOOL_ACCESS_POLICY_PATH, "utf8");
  const policy = JSON.parse(raw);
  cachedRoleToolGrants = resolveRoleToolGrantsFromPolicy(policy);
  return cachedRoleToolGrants;
}

export function parseToolProfile(env = process.env) {
  const raw = env?.WIKI_MCP_TOOL_PROFILE;
  const profile = typeof raw === "string" ? raw.trim() : "";
  if (profile === "") {
    throw new Error(
      "WIKI_MCP_TOOL_PROFILE is required and must name a session role " +
        `(one of ${SESSION_ROLE_VALUES.join(", ")}); refusing to start with an ` +
        "absent or empty profile (no fail-open default to the full/operator surface)."
    );
  }
  if (SESSION_ROLE_VALUES.includes(profile)) {
    return profile;
  }

  if (profile === TOOL_PROFILE_FULL || profile === TOOL_PROFILE_AGENT_SAFE) {
    return profile;
  }
  throw new Error(
    `Unsupported WIKI_MCP_TOOL_PROFILE: ${profile}. Expected one of ` +
      `${SESSION_ROLE_VALUES.join(", ")} ` +
      `(transition aliases: ${TOOL_PROFILE_FULL}, ${TOOL_PROFILE_AGENT_SAFE}).`
  );
}

export function shouldExposeTool(toolProfile, name  ) {
  if (toolProfile === TOOL_PROFILE_FULL || toolProfile === TOOL_PROFILE_OPERATOR) {
    return true;
  }
  const role =
    toolProfile === TOOL_PROFILE_AGENT_SAFE ? TOOL_PROFILE_ORCHESTRATOR : toolProfile;
  if (!SESSION_ROLE_VALUES.includes(role)) {
    return false;
  }
  const grants = loadRoleToolGrants();
  const roleTools = grants.get(role);
  return roleTools instanceof Set ? roleTools.has(name) : false;
}

export function resolveRegisteredTier(env = process.env) {
  try {
    const config = resolveClientConfig(env);
    return config && config.apiKey ? REGISTERED_TIER_PAID_CCE : REGISTERED_TIER_FREE_LOCAL;
  } catch {
    return REGISTERED_TIER_FREE_LOCAL;
  }
}

export function isToolTierRegistrable(registeredTier, name, paidOnlyToolNames) {
  if (registeredTier === REGISTERED_TIER_PAID_CCE) {
    return true;
  }
  return !(paidOnlyToolNames instanceof Set && paidOnlyToolNames.has(name));
}
