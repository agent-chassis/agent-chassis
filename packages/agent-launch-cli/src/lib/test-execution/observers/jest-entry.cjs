"use strict";

const path = require("node:path");

const { createChannel, failureDiagnostic, loadConfig } = require("./native-channel.cjs");

const config = loadConfig(process.argv[2]);
const channel = createChannel(config, "jest.entry");

async function main() {
  const projectDir = process.cwd();
  const jestEntry = require.resolve("jest", { paths: [projectDir] });
  const { readConfig } = require(require.resolve("jest-config",
    { paths: [path.dirname(jestEntry), projectDir] }));
  const jest = require(jestEntry);
  const jestVersion = typeof jest.getVersion === "function" ? jest.getVersion() : null;
  channel.emit("session_start", { runner: { name: "jest", version: jestVersion } });
  const argv = { _: [config.test_file], $0: "jest" };
  const { projectConfig } = await readConfig(argv, projectDir);
  if (!/[\\/]jest-circus[\\/]/u.test(String(projectConfig.testRunner))) {
    channel.emit("runtime_error", { code: "test_proof_native_runner_unsupported",
      message: "the Jest proof observer requires the jest-circus test runner" });
    process.exitCode = 2;
    return;
  }
  const { results } = await jest.runCLI({
    ...argv,
    ci: true,
    runInBand: true,
    runTestsByPath: true,
    watchman: false,
    cache: true,
    cacheDirectory: config.runner_options.cache_directory,
    setupFilesAfterEnv: [...projectConfig.setupFilesAfterEnv, path.join(__dirname, "jest-setup.cjs")]
  }, [projectDir]);
  channel.emit("session_end");
  process.exitCode = results.success ? 0 : 1;
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  channel.emit("runtime_error", { code: "test_proof_native_runner_unavailable",
    message: "Jest could not be loaded or started",
    failure_diagnostic: failureDiagnostic(error) });
  process.exitCode = 3;
});
