

import { escapeRegExp } from "./common.mjs";

export default Object.freeze({
  runner_id: "runner.go-test",
  setupProbe: ({ runtime, projectDir }) => ({ command: runtime.executables.go,
    args: ["list", "-deps", "-test", "./..."], cwd: projectDir }),
  invocation: ({ runtime, projectDir, packagePath, testName }) => ({
    command: runtime.executables.go,
    args: ["test", "-count=1", "-v", "-run", `^${escapeRegExp(testName)}$`, packagePath],
    cwd: projectDir
  })
});
