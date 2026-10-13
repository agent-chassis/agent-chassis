

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { AVA_LOAD_CONFIG_ENV, AVA_TMPDIR_ENV } from "./ava-config.mjs";
import { RunnerIntegrationPreconditionError, npmPackageAsset, npmPackageBin } from "./common.mjs";

export const AVA_ATTEMPT_CONFIG = fileURLToPath(new URL("./ava-config.mjs", import.meta.url));
const LOAD_CONFIG = path.join("lib", "load-config.js");

function avaConfigLoader(runtime) {
  const loader = npmPackageAsset(runtime, "ava", LOAD_CONFIG);
  if (loader === null) {
    throw new RunnerIntegrationPreconditionError("test_runtime_runner_package_missing",
      `the prepared ava installation has no configuration loader at ${path.join("ava", LOAD_CONFIG)}`,
      { package: "ava", missing: path.join("ava", LOAD_CONFIG) });
  }
  return loader;
}

export default Object.freeze({
  runner_id: "runner.ava",
  setupProbe: ({ runtime, projectDir }) => {
    const cli = npmPackageBin(runtime, "ava");
    avaConfigLoader(runtime);
    return { command: runtime.executables.node, args: [cli, "--version"], cwd: projectDir };
  },

  ordinaryInvocation: ({ runtime, projectDir, file, selector, proof = null }) => ({
    harness: Object.freeze({ kind: "ava" }),
    invocation: { ...attemptInvocation({ runtime, projectDir,
      options: proof !== null ? ["--no-worker-threads", "--serial", "--timeout=10m",
        `--node-arguments=${proof.nodeArguments.join(" ")}`]
        : selector === null ? [] : [`--match=${selector}`], file }),
    readOnlyBinds: [{ src: AVA_ATTEMPT_CONFIG, dst: AVA_ATTEMPT_CONFIG }] }
  })
});

function attemptInvocation({ runtime, projectDir, options, file }) {
  const cli = npmPackageBin(runtime, "ava");
  const tmpdir = `${runtime.scratchRoot}/ava-tmp`;
  return {
    command: runtime.executables.node,
    args: [`--import=${pathToFileURL(AVA_ATTEMPT_CONFIG).href}`, cli, `--config=${AVA_ATTEMPT_CONFIG}`,
      "--no-color", ...options, file],
    cwd: projectDir,
    directories: [tmpdir],
    env: { NO_COLOR: "1", [AVA_LOAD_CONFIG_ENV]: avaConfigLoader(runtime), [AVA_TMPDIR_ENV]: tmpdir }
  };
}
