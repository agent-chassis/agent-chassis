

import { neutralEffortMapping } from "./agent-launch-profiles.mjs";
import { isLiteLlmRoute } from "./agent-launch-model-route.mjs";

export const CODEX_LITELLM_KEY_READER = "/usr/bin/cat";

const PROFILE_OWNED_EFFORT_ROLES = new Set(["orch", "orch-resume", "orchestrator", "resume"]);

export function codexModelArgs(resolvedProfile) {
  const selected = resolvedProfile?.model_selection?.model ?? resolvedProfile?.model;
  const model = typeof selected === "string" ? selected.trim() : "";
  return model.length > 0 ? ["-m", model] : [];
}

export function buildCodexReasoningEffortConfigOverrides({ role, modelSelection = null } = {}) {
  if (PROFILE_OWNED_EFFORT_ROLES.has(role) || typeof modelSelection?.effort !== "string") {
    return [];
  }
  const mapped = neutralEffortMapping({ family: "codex", effort: modelSelection.effort });
  return typeof mapped?.model_reasoning_effort === "string"
    ? [`model_reasoning_effort=${mapped.model_reasoning_effort}`]
    : [];
}

function tomlString(value) {

  return JSON.stringify(String(value));
}

export function buildCodexModelProviderOverrides({ modelSelection = null, keyFilePath = null } = {}) {
  const route = modelSelection?.route ?? null;
  if (!isLiteLlmRoute(route)) return [];
  if (typeof keyFilePath !== "string" || keyFilePath.length === 0) {
    throw new Error("a LiteLLM-routed Codex launch requires its acquired per-run key file");
  }
  const provider = [
    `name=${tomlString("agent-launch LiteLLM gateway")}`,
    `base_url=${tomlString(route.base_url)}`,
    `wire_api=${tomlString("responses")}`,
    `auth={command=${tomlString(CODEX_LITELLM_KEY_READER)},args=[${tomlString(keyFilePath)}]}`
  ].join(",");
  return [
    `model_provider=${tomlString(route.provider_id)}`,
    `model_providers.${route.provider_id}={${provider}}`,

    'web_search="disabled"'
  ];
}
