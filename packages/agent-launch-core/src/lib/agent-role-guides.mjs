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

export function resolveAgentRoleGuidePath(guide) {
  if (!AGENT_ROLE_GUIDES.includes(guide)) {
    throw new TypeError(`unknown agent role guide: ${guide}`);
  }
  return path.join(ROLE_GUIDE_DIR, `${guide}.md`);
}

export function resolveOrchestratorAuthoringVignettePath() {
  return path.join(ROLE_GUIDE_DIR, "orchestrator-authoring-vignette.md");
}

export function renderAgentRoleGuideReadReference(guide) {
  const guidePath = resolveAgentRoleGuidePath(guide);
  return guide === "orchestrator"
    ? `Read your orchestrator guide at ${guidePath} and the authoring vignette at ` +
      `${resolveOrchestratorAuthoringVignettePath()} before authoring.`
    : `Read your ${guide} guide before acting: ${guidePath}`;
}

export function readAgentRoleGuide(guide) {
  if (!guideText.has(guide)) {
    guideText.set(guide, readFileSync(resolveAgentRoleGuidePath(guide), "utf8").trim());
  }
  return guideText.get(guide);
}
