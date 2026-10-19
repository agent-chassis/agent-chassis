import os from "node:os";
import path from "node:path";

export function resolvePnpmDataHome({ env = process.env, home = env.HOME || os.homedir(),
  platform = process.platform } = {}) {
  const paths = platform === "win32" ? path.win32 : path.posix;
  if (env.PNPM_HOME) return env.PNPM_HOME;
  if (env.XDG_DATA_HOME) return paths.join(env.XDG_DATA_HOME, "pnpm");
  if (platform === "darwin") return paths.join(home, "Library/pnpm");
  if (platform !== "win32") return paths.join(home, ".local/share/pnpm");
  if (env.LOCALAPPDATA) return paths.join(env.LOCALAPPDATA, "pnpm");
  return paths.join(home, ".pnpm");
}
