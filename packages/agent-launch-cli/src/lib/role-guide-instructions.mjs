import { resolveLaunchRoleGuideReadReference } from "./launch-isolation-plan.mjs";
import { highPriorityRoleGuideEnabled } from "@agent-chassis/agent-launch-core/src/lib/agent-role-guides.mjs";
import { readAgentLaunchConfigSnapshot, roleGuideDeliveryFromSnapshot } from "./agent-launch-role-config.mjs";
import { resolveRoleGuideCompactionHook, quoteRoleGuideShellWord, ROLE_GUIDE_COMPACTION_HOOK_READER } from "./role-guide-compaction-hook.mjs";

export function resolveRoleGuideInstructions({ role, selection = null, workspaceDir = null,
  registeredTier, publishControlledAcceptanceOptOut = true, highPriority = selection?.high_priority_role_guide ??
    (workspaceDir === null ? highPriorityRoleGuideEnabled(role) :
      roleGuideDeliveryFromSnapshot(role, readAgentLaunchConfigSnapshot({ dir: workspaceDir }))) } = {}) {
  const hook = resolveRoleGuideCompactionHook(role, { registeredTier, publishControlledAcceptanceOptOut });
  if (hook === null) return null;
  return Object.freeze({ guidePath: hook.guidePath, highPriority,
    readReference: resolveLaunchRoleGuideReadReference(role, registeredTier, { publishControlledAcceptanceOptOut }),
    injectedReadReference: resolveLaunchRoleGuideReadReference(role, registeredTier, { highPriority: true, publishControlledAcceptanceOptOut }),
    hook: highPriority
    ? Object.freeze({ ...hook, matcher: "^(startup|compact|clear)$",
        command: `${ROLE_GUIDE_COMPACTION_HOOK_READER} -- ${quoteRoleGuideShellWord(hook.guidePath)}` })
    : hook });
}

export function withRoleGuideInstructionsPrompt(prompt, delivery) {
  if (!delivery?.highPriority || typeof prompt !== "string") return prompt;
  return prompt.split("\n").flatMap(line => line === delivery.readReference
    ? (delivery.injectedReadReference ? [delivery.injectedReadReference] : []) : [line]).join("\n");
}

export function claudeRoleGuideInstructionArgs(delivery) {
  return delivery?.highPriority ? ["--append-system-prompt-file", delivery.guidePath] : [];
}
