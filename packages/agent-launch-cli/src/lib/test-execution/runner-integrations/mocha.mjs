

import { npmPackageBin } from "./common.mjs";

export default Object.freeze({
  runner_id: "runner.mocha",
  setupProbe: ({ runtime, projectDir }) => ({ command: runtime.executables.node,
    args: [npmPackageBin(runtime, "mocha"), "--version"], cwd: projectDir }),
  invocation: ({ runtime, projectDir, file, reporter }) => ({
    command: runtime.executables.node,
    args: [npmPackageBin(runtime, "mocha"), "--no-color", "--reporter", reporter, file],
    cwd: projectDir,

    env: { TSX_DISABLE_CACHE: "1", NO_COLOR: "1" }
  })
});
