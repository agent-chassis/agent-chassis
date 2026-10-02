

import { DEPENDENCY_ECOSYSTEMS } from "../../test-runtime-setup/ecosystems.mjs";

function toolchainEnv(runtime) {
  return DEPENDENCY_ECOSYSTEMS.cargo.toolchainEnv({ rust: { executables: runtime.executables } });
}

const testArgs = (target) => ["test", "--frozen", "--color", "never", "--message-format=json",
  ...(target.kind === "lib" ? ["--lib"] : ["--test", target.name])];

export default Object.freeze({
  runner_id: "runner.cargo-test",

  setupProbe: ({ runtime, projectDir }) => ({ command: runtime.executables.cargo,
    args: ["metadata", "--frozen", "--format-version", "1"], cwd: projectDir,
    env: toolchainEnv(runtime) }),
  invocation: ({ runtime, projectDir, target, exactName }) => ({
    command: runtime.executables.cargo,
    args: [...testArgs(target), "--", "--exact", exactName, "--test-threads", "1"],
    cwd: projectDir,
    env: toolchainEnv(runtime)
  })
});
