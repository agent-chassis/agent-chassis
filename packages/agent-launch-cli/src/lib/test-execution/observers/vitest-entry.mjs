

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import channelModule from "./native-channel.cjs";

const { createChannel, loadConfig } = channelModule;
const config = loadConfig(process.argv[2]);
const channel = createChannel(config, "vitest.entry");
const projectRequire = createRequire(path.join(process.cwd(), "launcher-test-proof.cjs"));
const vitest = await import(pathToFileURL(projectRequire.resolve("vitest/node")).href);
channel.emit("session_start", { runner: { name: "vitest",
  version: JSON.parse((await import("node:fs")).readFileSync(
    projectRequire.resolve("vitest/package.json"), "utf8")).version } });

const options = { run: true, watch: false, cache: false, color: false, configLoader: "runner",
  fileParallelism: false };
const resolved = await vitest.resolveConfig({ ...options });
if (resolved.test?.runner) {
  channel.emit("runtime_error", { code: "test_proof_native_runner_unsupported",
    message: "the project configures its own Vitest runner" });
  process.exitCode = 2;
} else {
  const ctx = await vitest.startVitest("test", [config.test_file], {
    ...options, runner: fileURLToPath(new URL("./vitest-runner.mjs", import.meta.url))
  });
  const files = ctx?.state.getFiles() ?? [];
  const failed = (task) => task.result?.state === "fail" || (task.tasks ?? []).some(failed);
  const unhandled = ctx?.state.getUnhandledErrors?.().length ?? 0;
  channel.emit("session_end");
  process.exitCode = ctx === undefined || files.some(failed) || unhandled > 0 ? 1 : 0;
  await ctx?.close();
}
