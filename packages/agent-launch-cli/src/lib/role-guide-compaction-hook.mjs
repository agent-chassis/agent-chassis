

import path from "node:path";

import { resolveLaunchRoleGuidePath } from "./launch-isolation-plan.mjs";

export const ROLE_GUIDE_COMPACTION_HOOK_EVENT = "SessionStart";

export const ROLE_GUIDE_COMPACTION_HOOK_MATCHER = "^compact$";
export const ROLE_GUIDE_COMPACTION_HOOK_TIMEOUT_SEC = 30;

export const ROLE_GUIDE_COMPACTION_HOOK_READER = "/bin/cat";

export const ROLE_GUIDE_COMPACTION_HOOK_INTRODUCTION =
  "Role reminder: the following is your role guide. Use it to remember your role and relevant working "
  + "guidance. Explicit operator instructions and repository policy take precedence over this guide, "
  + "including its mandatory wording. This reminder grants no additional tool or filesystem permissions.";

export const ROLE_GUIDE_COMPACTION_HOOK_GUIDE_OPEN = "<role-guide>";
export const ROLE_GUIDE_COMPACTION_HOOK_GUIDE_CLOSE = "</role-guide>";

export const ROLE_GUIDE_COMPACTION_HOOK_INVALID_REASON = "role_guide_compaction_hook_invalid";

export class RoleGuideCompactionHookError extends Error {
  constructor(message, detail) {
    super(`role guide compaction hook: ${message}`);
    this.name = "RoleGuideCompactionHookError";
    this.code = ROLE_GUIDE_COMPACTION_HOOK_INVALID_REASON;
    this.detail = Object.freeze({ ...detail });
  }
}

export function quoteRoleGuideShellWord(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function composeRoleGuideCompactionContext(guide) {
  return `${ROLE_GUIDE_COMPACTION_HOOK_INTRODUCTION}\n${ROLE_GUIDE_COMPACTION_HOOK_GUIDE_OPEN}\n`
    + `${guide}\n${ROLE_GUIDE_COMPACTION_HOOK_GUIDE_CLOSE}\n`;
}

function buildRoleGuideCompactionHookCommand(guidePath) {
  const read = `${ROLE_GUIDE_COMPACTION_HOOK_READER} -- ${quoteRoleGuideShellWord(guidePath)}`;
  const fixed = [ROLE_GUIDE_COMPACTION_HOOK_INTRODUCTION, ROLE_GUIDE_COMPACTION_HOOK_GUIDE_OPEN]
    .map(quoteRoleGuideShellWord).join(" ");
  return `guide=$(${read} && printf .) && printf '%s\\n%s\\n%s\\n%s\\n' ${fixed} "\${guide%.}" `
    + quoteRoleGuideShellWord(ROLE_GUIDE_COMPACTION_HOOK_GUIDE_CLOSE);
}

function refuseGuidePath(launchRole, guidePath, cause) {
  const subject = typeof guidePath === "string" ? guidePath : null;
  const effects = "the confined session is not launched; no hook configuration was emitted";
  const repair = Object.freeze({
    actor: "operator",
    action: "reinstall the launcher package so its role guides resolve to absolute paths without control characters"
  });
  throw new RoleGuideCompactionHookError(
    `the guide selected for launch role ${JSON.stringify(launchRole)} cannot be named in a hook command: `
      + `${cause} (guide: ${JSON.stringify(subject)}); ${effects}; ${repair.actor} action: ${repair.action}`,
    { subject, launch_role: launchRole, cause, effects, repair }
  );
}

export function resolveRoleGuideCompactionHook(launchRole, {
  resolveGuidePath = resolveLaunchRoleGuidePath
} = {}) {
  const guidePath = resolveGuidePath(launchRole);
  if (guidePath === null) return null;
  if (typeof guidePath !== "string" || !path.isAbsolute(guidePath)) {
    refuseGuidePath(launchRole, guidePath, "the selected guide path is not absolute");
  }
  if (path.normalize(guidePath) !== guidePath) {
    refuseGuidePath(launchRole, guidePath, "the selected guide path is not normalized");
  }
  if (/[\u0000-\u001f\u007f]/u.test(guidePath)) {
    refuseGuidePath(launchRole, guidePath, "the selected guide path contains a control character");
  }
  return Object.freeze({
    event: ROLE_GUIDE_COMPACTION_HOOK_EVENT,
    matcher: ROLE_GUIDE_COMPACTION_HOOK_MATCHER,
    guidePath,
    command: buildRoleGuideCompactionHookCommand(guidePath),
    timeoutSec: ROLE_GUIDE_COMPACTION_HOOK_TIMEOUT_SEC
  });
}
