

import {
  CODEX_SESSION_START_EVENT_LABEL,
  buildCodexSessionStartHookOverrides,
  codexSessionFlagsHookStateKey
} from "@agent-chassis/agent-launch-core/src/lib/codex-session-hook-config.mjs";
import { buildCodexUsageHookIdentity } from "@agent-chassis/agent-launch-core/src/lib/native-usage-codex-session.mjs";

export const CODEX_ROLE_GUIDE_HOOK_STATE_KEY = codexSessionFlagsHookStateKey(0);

export function buildCodexRoleGuideHookIdentity(hook) {
  return {
    event_name: CODEX_SESSION_START_EVENT_LABEL,
    matcher: hook.matcher,
    hooks: [{
      type: "command",
      command: hook.command,
      timeout: hook.timeoutSec,
      async: false,
      additionalContextLimit: 0
    }]
  };
}

export function buildCodexRoleGuideHookConfigOverrides(delivery, {
  usageHook = null,
  confined = true
} = {}) {
  const hook = delivery != null && (confined || delivery.highPriority) ? delivery.hook : null;
  return buildCodexSessionStartHookOverrides([
    ...(hook === null ? [] : [buildCodexRoleGuideHookIdentity(hook)]),
    ...(usageHook === null ? [] : [buildCodexUsageHookIdentity(usageHook)])
  ]);
}
