

import path from "node:path";

import {
  cloneJson,
  hasOwn,
  isObject,
  isNonEmptyString,
  TOOL_DISCOVERY_FRAGMENT_DIR,
  TOOL_DISCOVERY_AUDIENCE_VALUES,
  TOOL_DISCOVERY_TIER_VISIBILITY_VALUES,
  TOOL_DISCOVERY_TIER_TEXT_FIELDS
} from "./descriptor.mjs";

export const SESSION_ROLE_TOOL_ACCESS_POLICY_FILENAME = "session-role-tool-access.json";
export const SESSION_ROLE_TOOL_ACCESS_POLICY_PATH = path.join(
  TOOL_DISCOVERY_FRAGMENT_DIR,
  SESSION_ROLE_TOOL_ACCESS_POLICY_FILENAME
);
export const SESSION_ROLE_TOOL_ACCESS_POLICY_RELATIVE_PATH =
  "packages/wiki-core/data/tool-discovery/session-role-tool-access.json";

export const TOOL_DISCOVERY_DEFAULT_AUDIENCE = Object.freeze(["agent", "operator"]);
export const TOOL_DISCOVERY_DEFAULT_TIER_VISIBILITY = Object.freeze([]);
export const TOOL_DISCOVERY_REGISTERED_TIER_FREE_LOCAL = "free_local";
export const TOOL_DISCOVERY_REGISTERED_TIER_PAID_CCE = "paid_cce";

export function resolveRoleToolGrantsFromPolicy(policy) {
  const grants = new Map();
  const access =
    policy && typeof policy === "object" && !Array.isArray(policy) ? policy.access : null;
  if (!access || typeof access !== "object" || Array.isArray(access)) {
    return grants;
  }
  for (const [toolName, roles] of Object.entries(access)) {
    if (typeof toolName !== "string" || toolName.trim() === "" || !Array.isArray(roles)) {
      continue;
    }
    for (const role of roles) {
      if (typeof role !== "string" || role.trim() === "") {
        continue;
      }
      if (!grants.has(role)) {
        grants.set(role, new Set());
      }
      grants.get(role).add(toolName);
    }
  }
  return grants;
}

export function normalizeDiscoveryQuery(query = {}) {
  if (!isObject(query)) {
    return {};
  }

  const normalized = {};
  if (isNonEmptyString(query.task_id)) {
    normalized.task_id = query.task_id;
  }
  if (isNonEmptyString(query.tool_name)) {
    normalized.tool_name = query.tool_name;
  }
  if (isNonEmptyString(query.audience) && TOOL_DISCOVERY_AUDIENCE_VALUES.includes(query.audience)) {
    normalized.audience = query.audience;
  }
  if (
    isNonEmptyString(query.registered_tier) &&
    TOOL_DISCOVERY_TIER_VISIBILITY_VALUES.includes(query.registered_tier)
  ) {
    normalized.registered_tier = query.registered_tier;
  }
  if (hasOwn(query, "limit") && Number.isInteger(query.limit) && query.limit > 0) {
    normalized.limit = query.limit;
  }
  return normalized;
}

export function resolveToolAudience(tool) {
  if (!isObject(tool)) {
    return TOOL_DISCOVERY_DEFAULT_AUDIENCE.slice();
  }
  if (!Array.isArray(tool.audience) || tool.audience.length === 0) {
    return TOOL_DISCOVERY_DEFAULT_AUDIENCE.slice();
  }
  return tool.audience.filter((entry) => TOOL_DISCOVERY_AUDIENCE_VALUES.includes(entry));
}

export function resolveToolTierVisibility(tool) {
  if (!isObject(tool) || !Array.isArray(tool.tier_visibility) || tool.tier_visibility.length === 0) {
    return TOOL_DISCOVERY_DEFAULT_TIER_VISIBILITY.slice();
  }
  return tool.tier_visibility.filter((entry) => TOOL_DISCOVERY_TIER_VISIBILITY_VALUES.includes(entry));
}

export function tierVisibilityAllows(visibility, registeredTier) {
  const set = Array.isArray(visibility)
    ? visibility.filter((entry) => TOOL_DISCOVERY_TIER_VISIBILITY_VALUES.includes(entry))
    : [];
  if (set.length === 0) {
    return false;
  }
  if (registeredTier === TOOL_DISCOVERY_REGISTERED_TIER_PAID_CCE) {

    return true;
  }
  if (registeredTier === TOOL_DISCOVERY_REGISTERED_TIER_FREE_LOCAL) {
    return set.includes(TOOL_DISCOVERY_REGISTERED_TIER_FREE_LOCAL);
  }
  if (registeredTier === "operator_only") {
    return set.includes("operator_only");
  }
  return false;
}

export function projectToolDiscoveryEntryForTier(tool, registeredTier) {
  if (!isObject(tool)) {
    return tool;
  }
  const projected = cloneJson(tool);
  const tierText = isObject(tool.tier_text) ? tool.tier_text : null;
  if (hasOwn(projected, "tier_text")) {
    delete projected.tier_text;
  }
  const tier = TOOL_DISCOVERY_TIER_VISIBILITY_VALUES.includes(registeredTier)
    ? registeredTier
    : TOOL_DISCOVERY_REGISTERED_TIER_FREE_LOCAL;
  const overrides = tierText && isObject(tierText[tier]) ? tierText[tier] : null;
  if (overrides) {
    for (const field of TOOL_DISCOVERY_TIER_TEXT_FIELDS) {
      if (isNonEmptyString(overrides[field])) {
        projected[field] = overrides[field];
      }
    }
  }
  return projected;
}
