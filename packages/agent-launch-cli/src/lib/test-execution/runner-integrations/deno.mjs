

import { existsSync } from "node:fs";
import path from "node:path";

function projectConfig(hostProjectDir, projectDir) {
  const name = ["deno.json", "deno.jsonc"].find((candidate) =>
    existsSync(path.join(hostProjectDir, candidate)));
  return name === undefined ? [] : ["--config", path.join(projectDir, name)];
}

export default Object.freeze({
  runner_id: "runner.deno",
  setupProbe: ({ runtime, projectDir }) => ({ command: runtime.executables.deno,
    args: ["install", "--frozen", "--cached-only"], cwd: projectDir }),
  invocation: ({ runtime, hostProjectDir, projectDir, entry, writablePaths }) => ({
    command: runtime.executables.deno,
    args: ["test", "--frozen", "--cached-only", "--no-prompt", ...projectConfig(hostProjectDir, projectDir),
      `--allow-write=${writablePaths.join(",")}`, entry],
    cwd: projectDir
  })
});
