import { realpathSync } from "node:fs";
import { userInfo } from "node:os";
import path from "node:path";

function canonicalExistingPath(value, label) {
  if (typeof value !== "string" || value.length === 0 || !path.isAbsolute(value)) {
    throw new TypeError(`${label} must be a non-empty absolute path`);
  }
  return realpathSync(path.resolve(value));
}

function resolveEffectiveUserHome() {

  return canonicalExistingPath(userInfo().homedir, "effective OS user home");
}

export function deriveLauncherOwnedDispatchWorktreeRoot(repo) {
  const realRepo = canonicalExistingPath(repo, "launcher repository");
  return path.join(
    resolveEffectiveUserHome(),
    ".agent-worktrees",
    path.basename(realRepo)
  );
}
