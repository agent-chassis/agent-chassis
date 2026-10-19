import { resolveClientConfig } from "../node-engine-api-client.mjs";
import { TOOL_DISCOVERY_REGISTERED_TIER_FREE_LOCAL, TOOL_DISCOVERY_REGISTERED_TIER_PAID_CCE,
  resolveToolTierVisibility, tierVisibilityAllows } from "./gating.mjs";

export function resolveSessionProfile(config) {
  if (config === null || typeof config !== "object" || !Object.hasOwn(config, "apiKey") ||
      !(config.apiKey === null || typeof config.apiKey?.value === "string" && config.apiKey.value.trim() !== "")) {
    throw Object.assign(new TypeError("Session configuration was not positively resolved"),
      { code: "orchestrator_guidance_profile_invalid" });
  }
  return Object.freeze({ registeredTier: config.apiKey !== null ? TOOL_DISCOVERY_REGISTERED_TIER_PAID_CCE
    : TOOL_DISCOVERY_REGISTERED_TIER_FREE_LOCAL });
}

export function resolveSessionProfileForEnv(env) {

  return resolveSessionProfile(resolveClientConfig(env));
}

export function sessionProfileAllowsTool(profile, tool) {
  return tool?.kind === "mcp_tool" && tierVisibilityAllows(resolveToolTierVisibility(tool), profile.registeredTier);
}
