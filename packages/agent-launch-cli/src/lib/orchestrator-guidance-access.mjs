import path from "node:path";
import { existsSync } from "node:fs";
import { resolveOrchestratorGuidancePair, resolveAgentRoleGuideDirectory } from
  "@agent-chassis/agent-launch-core/src/lib/agent-role-guides.mjs";
import { ORCHESTRATOR_GUIDANCE_ARTIFACTS } from
  "@agent-chassis/agent-launch-core/src/lib/orchestrator-guidance-generation.mjs";

export function orchestratorGuidanceGrant(registeredTier, publishControlledAcceptanceOptOut = true) {
  const pair = resolveOrchestratorGuidancePair(registeredTier, publishControlledAcceptanceOptOut);
  return { requiredFiles: [pair.guide, pair.vignette],
    binds: [pair.directory, pair.guide, pair.vignette].map(file => Object.freeze({ src: file, dst: file })) };
}

export function orchestratorGuidanceMasks(registeredTier, precedingBinds, publishControlledAcceptanceOptOut = true) {
  const pair = resolveOrchestratorGuidancePair(registeredTier, publishControlledAcceptanceOptOut);
  const roleDir = resolveAgentRoleGuideDirectory();
  const mirrorRoot = path.resolve(roleDir, "../../../core/docs/_refs");
  const hidden = new Set(ORCHESTRATOR_GUIDANCE_ARTIFACTS.filter(artifact =>
    !pair.references.includes(artifact.path)).flatMap(artifact => [
      path.join(roleDir, "orchestrator", artifact.path.split("/").at(-2)),
      path.dirname(path.join(mirrorRoot, artifact.path))
    ]));
  const masks = new Set();
  for (const { src, dst } of precedingBinds) {
    for (const directory of hidden) {
      if (!existsSync(directory)) continue;
      if (directory === src || directory.startsWith(`${src}${path.sep}`)) {
        masks.add(path.join(dst, path.relative(src, directory)));
      }
    }
  }
  return [...masks].sort();
}
