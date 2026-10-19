import { createExceptionPublication } from "@agent-chassis/wiki-core/src/lib/controlled-acceptance-publication-config.mjs";
import { ORCHESTRATOR_GUIDANCE_ARTIFACTS } from "./orchestrator-guidance-generation.mjs";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROLE_GUIDE_DIR = path.resolve(MODULE_DIR, "../../data/role-guides");

export const AGENT_ROLE_GUIDES = Object.freeze([
  "orchestrator",
  "managed-worker",
  "reviewer"
]);

const guideText = new Map();

export function resolveAgentRoleGuideDirectory() {
  return ROLE_GUIDE_DIR;
}

export function resolveAgentRoleGuidePath(guide, registeredTier, publishControlledAcceptanceOptOut = true) {
  if (!AGENT_ROLE_GUIDES.includes(guide)) {
    throw new TypeError(`unknown agent role guide: ${guide}`);
  }
  return guide === "orchestrator" ? resolveOrchestratorGuidancePair(registeredTier, publishControlledAcceptanceOptOut).guide : path.join(ROLE_GUIDE_DIR, `${guide}.md`);
}

export function resolveOrchestratorGuidancePair(registeredTier, publishControlledAcceptanceOptOut = true) {
  const publication = createExceptionPublication(publishControlledAcceptanceOptOut);
  const selected = ORCHESTRATOR_GUIDANCE_ARTIFACTS.filter(artifact => artifact.registeredTier === registeredTier && publication.guidance(artifact));
  if (selected.length !== 2) throw Object.assign(new TypeError("Host-selected orchestrator guidance profile is invalid; correct host configuration or deploy one coherent package build"),
    { code: "orchestrator_guidance_profile_invalid" });
  const absolute = artifact => path.join(ROLE_GUIDE_DIR, "orchestrator", artifact.path.split("/").slice(-2).join("/"));
  const guide = selected.find(artifact => artifact.document === "guide");
  const vignette = selected.find(artifact => artifact.document === "authoring-vignette");
  return Object.freeze({ guide: absolute(guide), vignette: absolute(vignette),
    directory: path.dirname(absolute(guide)), references: Object.freeze(selected.map(artifact => artifact.path)) });
}

export function resolveOrchestratorAuthoringVignettePath(registeredTier, publishControlledAcceptanceOptOut = true) {
  return resolveOrchestratorGuidancePair(registeredTier, publishControlledAcceptanceOptOut).vignette;
}

export function renderAgentRoleGuideReadReference(guide, registeredTier, { highPriority = false, publishControlledAcceptanceOptOut = true } = {}) {
  const guidePath = resolveAgentRoleGuidePath(guide, registeredTier, publishControlledAcceptanceOptOut);
  if (highPriority) return guide === "orchestrator"
    ? `Read the authoring vignette at ${resolveOrchestratorAuthoringVignettePath(registeredTier, publishControlledAcceptanceOptOut)} before authoring.` : "";
  return guide === "orchestrator"
    ? `Read your orchestrator guide at ${guidePath} and the authoring vignette at ` +
      `${resolveOrchestratorAuthoringVignettePath(registeredTier, publishControlledAcceptanceOptOut)} before authoring.`
    : `Read your ${guide} guide before acting: ${guidePath}`;
}

export function readAgentRoleGuide(guide, registeredTier) {
  const guidePath = resolveAgentRoleGuidePath(guide, registeredTier);
  if (!guideText.has(guidePath)) guideText.set(guidePath, readFileSync(guidePath, "utf8").trim());
  return guideText.get(guidePath);
}

export function highPriorityRoleGuideEnabled(role, settings = {}) {
  const aliases = { review: "reviewer", resume: "orchestrator", orch: "orchestrator",
    "orch-resume": "orchestrator" };
  const key = Object.hasOwn(aliases, role) ? aliases[role] : role;
  return settings[key] ?? (key === "worker");
}
