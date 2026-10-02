

import { npmPackageBin } from "./common.mjs";

const commandEnvironment = (runtime) => ({
  directories: [`${runtime.scratchRoot}/xdg-data`],
  env: { XDG_DATA_HOME: `${runtime.scratchRoot}/xdg-data`, NO_COLOR: "1" }
});

export default Object.freeze({
  runner_id: "runner.vitest",
  setupProbe: ({ runtime, projectDir }) => ({ command: runtime.executables.node,
    args: [npmPackageBin(runtime, "vitest"), "--version"], cwd: projectDir }),
  invocation: ({ runtime, projectDir, entry, entryArgs }) => ({
    command: runtime.executables.node,
    args: [entry, ...entryArgs],
    cwd: projectDir,
    ...commandEnvironment(runtime)
  }),
  compilerCache: "vitest-module-cache"
});
