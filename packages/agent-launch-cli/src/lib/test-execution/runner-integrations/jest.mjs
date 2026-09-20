

import { npmPackageBin } from "./common.mjs";

export default Object.freeze({
  runner_id: "runner.jest",
  setupProbe: ({ runtime, projectDir }) => ({ command: runtime.executables.node,
    args: [npmPackageBin(runtime, "jest"), "--version"], cwd: projectDir }),
  invocation: ({ runtime, projectDir, entry, entryArgs }) => ({
    command: runtime.executables.node,
    args: [entry, ...entryArgs],
    cwd: projectDir,
    directories: [`${runtime.scratchRoot}/jest-cache`],
    env: { FORCE_COLOR: "0" }
  })
});
