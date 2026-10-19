

import path from "node:path";
import { createHash } from "node:crypto";

export const LAUNCHER_RUNTIME_STATE_DIR_ENV = "AGENT_LAUNCH_RUNTIME_STATE_DIR";
export const LAUNCHER_RUNTIME_STATE_DIRNAME = "agent-launch-runtime";
export const LAUNCHER_RUNTIME_STATE_UNAVAILABLE_CODE =
  "launcher_runtime_state_unavailable";

export function resolveLauncherRuntimeStateDirForWorkspace({ workspaceBasis, env = process.env } = {}) {
  if (typeof workspaceBasis !== "string" || !path.isAbsolute(workspaceBasis)) {
    return {
      ok: false,
      code: LAUNCHER_RUNTIME_STATE_UNAVAILABLE_CODE,
      reason: "the launcher runtime state directory requires an absolute workspace directory"
    };
  }
  const provided = env?.[LAUNCHER_RUNTIME_STATE_DIR_ENV];
  let root;
  let source;
  if (typeof provided === "string" && provided.trim().length > 0) {
    const trimmed = provided.trim();
    if (!path.isAbsolute(trimmed)) {
      return {
        ok: false,
        code: LAUNCHER_RUNTIME_STATE_UNAVAILABLE_CODE,
        reason: `${LAUNCHER_RUNTIME_STATE_DIR_ENV} must be an absolute path; received a relative value`
      };
    }
    root = trimmed;
    source = "env";
  } else {
    root = path.join("/tmp", LAUNCHER_RUNTIME_STATE_DIRNAME);
    source = "tmpdir_default";
  }
  return {
    ok: true,
    dir: path.join(root, createHash("sha256").update(workspaceBasis).digest("hex").slice(0, 16)),
    source
  };
}
