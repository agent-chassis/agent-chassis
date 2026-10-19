
import { resolveRoleGuideCompactionHook } from "../../packages/agent-launch-cli/src/lib/role-guide-compaction-hook.mjs";
import { buildCodexRoleGuideHookConfigOverrides } from "../../packages/agent-launch-cli/src/lib/codex-role-guide-hook.mjs";
import { buildClaudeRoleGuideCompactionHookSettings } from "../../packages/agent-launch-cli/src/lib/workspace-agent-claude-launch-support.mjs";
export function compactionDelivery(role, { resolveHook = resolveRoleGuideCompactionHook, registeredTier } = {}) {
  const hook = resolveHook(role, { registeredTier });
  return hook === null ? null : { guidePath: hook.guidePath, highPriority: false, hook };
}
export function codexCompactionOverrides(role, options = {}) {
  return buildCodexRoleGuideHookConfigOverrides(compactionDelivery(role, options), options);
}
export function claudeCompactionSettings(role, options = {}) {
  return buildClaudeRoleGuideCompactionHookSettings(compactionDelivery(role, options));
}
