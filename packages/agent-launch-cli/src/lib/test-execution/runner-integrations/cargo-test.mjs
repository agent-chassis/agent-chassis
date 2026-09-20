

import path from "node:path";

function toolchainEnv(runtime) {
  const bin = path.dirname(runtime.executables.rustc);
  return { RUSTC: runtime.executables.rustc, RUSTDOC: path.join(bin, "rustdoc") };
}

export default Object.freeze({
  runner_id: "runner.cargo-test",
  setupProbe: ({ runtime, projectDir }) => ({ command: runtime.executables.cargo,
    args: ["fetch", "--frozen", ...runtime.values.cargo_source_args], cwd: projectDir,
    env: toolchainEnv(runtime) }),
  invocation: ({ runtime, projectDir, target, exactName }) => ({
    command: runtime.executables.cargo,
    args: ["test", "--frozen", "--color", "never", ...runtime.values.cargo_source_args,
      ...(target.kind === "lib" ? ["--lib"] : ["--test", target.name]),
      "--", "--exact", exactName, "--test-threads", "1"],
    cwd: projectDir,
    env: toolchainEnv(runtime)
  })
});
