

import { npmPackageBin, npmPackageDirectory } from "./common.mjs";

function invocation({ runtime, projectDir, file, reporter = null, grep = null }) {
  return {
    command: runtime.executables.node,
    args: [npmPackageBin(runtime, "mocha"), "--no-color", ...(reporter === null ? [] : ["--reporter", reporter]),
      ...(grep === null ? [] : [`--grep=${grep}`]), file],
    cwd: projectDir,

    env: { TSX_DISABLE_CACHE: "1", NO_COLOR: "1" }
  };
}

export default Object.freeze({
  runner_id: "runner.mocha",
  setupProbe: ({ runtime, projectDir }) => ({ command: runtime.executables.node,
    args: [npmPackageBin(runtime, "mocha"), "--version"], cwd: projectDir }),
  ordinaryInvocation: ({ runtime, projectDir, file, selector, proof = null }) => ({
    harness: Object.freeze({ kind: "mocha" }),
    runnerPackage: npmPackageDirectory(runtime, "mocha"),
    invocation: invocation({ runtime, projectDir, file, grep: selector, reporter: proof?.reporter ?? null })
  })
});
