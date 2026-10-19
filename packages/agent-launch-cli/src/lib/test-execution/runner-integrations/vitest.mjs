

import { RunnerIntegrationPreconditionError, npmPackageBin, npmPackageDirectory } from "./common.mjs";

const commandEnvironment = (runtime) => ({
  directories: [`${runtime.scratchRoot}/xdg-data`],
  env: { XDG_DATA_HOME: `${runtime.scratchRoot}/xdg-data`, NO_COLOR: "1" }
});

export default Object.freeze({
  runner_id: "runner.vitest",
  setupProbe: ({ runtime, projectDir }) => ({ command: runtime.executables.node,
    args: [npmPackageBin(runtime, "vitest"), "--version"], cwd: projectDir }),
  ordinaryInvocation: async ({ runtime, projectDir, absoluteFile, selector, metadata, proof = null }) => {

    const cli = npmPackageBin(runtime, "vitest");
    if (proof !== null) {
      return { harness: Object.freeze({ kind: "vitest_launcher_entry" }),
        runnerPackage: npmPackageDirectory(runtime, "vitest"),
        invocation: { command: runtime.executables.node, args: [proof.entry, ...proof.entryArgs], cwd: projectDir,
          ...commandEnvironment(runtime) } };
    }

    const listed = await metadata({ command: runtime.executables.node,
      args: [cli, "list", "--filesOnly", absoluteFile, "--json"], cwd: projectDir });
    let files;
    try {
      files = JSON.parse(listed.stdout).map(({ file }) => file);
    } catch (error) {
      throw new RunnerIntegrationPreconditionError("ordinary_test_selection_unresolved",
        `vitest list did not print its JSON file listing: ${error.message}`, { reason: "listing_unreadable" });
    }
    return {
      harness: Object.freeze({ kind: "vitest" }),
      selection: Object.freeze({ file_filter: absoluteFile, listed_files: Object.freeze(files) }),
      invocation: { command: runtime.executables.node,
        args: [cli, "run", ...(selector === null ? [] : [`--testNamePattern=${selector}`]), absoluteFile],
        cwd: projectDir }
    };
  },
  compilerCache: "vitest-module-cache"
});
