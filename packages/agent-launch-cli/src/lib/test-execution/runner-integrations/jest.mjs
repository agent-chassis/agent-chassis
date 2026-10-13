

import { npmPackageBin, npmPackageDirectory } from "./common.mjs";

export default Object.freeze({
  runner_id: "runner.jest",
  setupProbe: ({ runtime, projectDir }) => ({ command: runtime.executables.node,
    args: [npmPackageBin(runtime, "jest"), "--version"], cwd: projectDir }),
  ordinaryInvocation: ({ runtime, projectDir, file, selector, proof = null }) => {

    const cli = npmPackageBin(runtime, "jest");
    return {
      harness: Object.freeze(proof === null ? { kind: "jest" } : { kind: "jest_launcher_entry" }),
      runnerPackage: npmPackageDirectory(runtime, "jest"),
      invocation: { command: runtime.executables.node,
        args: proof !== null ? [proof.entry, ...proof.entryArgs]
          : [cli, "--runTestsByPath", ...(selector === null ? [] : [`--testNamePattern=${selector}`]), file],
        cwd: projectDir, env: { FORCE_COLOR: "0" },
        ...(proof === null ? {} : { directories: [`${runtime.scratchRoot}/jest-cache`] }) }
    };
  }
});
