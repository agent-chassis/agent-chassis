

import {
  neutralEffortMapping,
  resolveEffectiveRoleEffort
} from "./agent-launch-profiles.mjs";

export function codexModelArgs(resolvedProfile) {
  const model = typeof resolvedProfile?.model === "string" ? resolvedProfile.model.trim() : "";
  return model.length > 0 ? ["-m", model] : [];
}

export function buildCodexReasoningEffortConfigOverrides({
  role,
  repo,
  model
} = {}) {
  const selectedModel = typeof model === "string" && model.trim().length > 0
    ? model.trim()
    : null;
  if (selectedModel === null && (typeof repo !== "string" || repo.length === 0)) {
    return [];
  }
  const effortResolution = resolveEffectiveRoleEffort({
    role,
    selectedModel,
    dir: repo
  });
  if (!effortResolution.ok) {
    return [];
  }
  const mapped = neutralEffortMapping({
    family: "codex",
    effort: effortResolution.effort
  });
  const reasoningEffort = typeof mapped?.model_reasoning_effort === "string"
    ? mapped.model_reasoning_effort
    : null;
  return reasoningEffort ? [`model_reasoning_effort=${reasoningEffort}`] : [];
}
