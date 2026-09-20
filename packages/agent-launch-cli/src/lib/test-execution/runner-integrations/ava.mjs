

import { npmPackageBin } from "./common.mjs";

export default Object.freeze({
  runner_id: "runner.ava",
  setupProbe: ({ runtime, projectDir }) => ({ command: runtime.executables.node,
    args: [npmPackageBin(runtime, "ava"), "--version"], cwd: projectDir }),
  invocation: ({ runtime, projectDir, file, nodeArguments }) => ({
    command: runtime.executables.node,
    args: [npmPackageBin(runtime, "ava"), "--no-color", "--no-worker-threads", "--serial",
      "--timeout=10m", `--node-arguments=${nodeArguments.join(" ")}`, file],
    cwd: projectDir,
    env: { NO_COLOR: "1" }
  })
});
