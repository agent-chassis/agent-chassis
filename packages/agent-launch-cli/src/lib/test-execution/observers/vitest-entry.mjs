

import channelModule from "./native-channel.cjs";
import { loadProjectVitest, moduleCacheEntries, moduleCacheState, resolveLauncherVitest }
  from "./vitest-config.mjs";

const { createChannel, failureDiagnostic, loadConfig } = channelModule;

const RUNNER_ERROR_LIMIT = 8;
const config = loadConfig(process.argv[2]);
const channel = createChannel(config, "vitest.entry");
const moduleCache = config.runner_options?.module_cache ?? null;
try {
  const { vitest, version } = await loadProjectVitest();
  channel.emit("session_start", { runner: { name: "vitest", version } });

  const route = await resolveLauncherVitest({ vitest, moduleCache });
  if (route.customRunner) {
    channel.emit("runtime_error", { code: "test_proof_native_runner_unsupported",
      message: "the project configures its own Vitest runner" });
    process.exitCode = 2;
  } else {
    const before = moduleCacheEntries(moduleCache);
    const ctx = await vitest.startVitest("test", [config.test_file], route.options, route.viteOverrides);
    const files = ctx?.state.getFiles() ?? [];
    const failed = (task) => task.result?.state === "fail" || (task.tasks ?? []).some(failed);
    const unhandled = ctx?.state.getUnhandledErrors?.() ?? [];
    channel.emit("session_end", unhandled.length === 0 ? {} : {
      runner_error_count: unhandled.length,
      runner_errors: unhandled.slice(0, RUNNER_ERROR_LIMIT).map((error) =>
        failureDiagnostic(error, { display_operands: true })) });
    process.exitCode = ctx === undefined || files.some(failed) || unhandled.length > 0 ? 1 : 0;
    await ctx?.close();
    const state = ctx === undefined ? "off" : moduleCacheState(ctx, moduleCache);
    process.stderr.write(`launcher vitest module cache: ${JSON.stringify(state === "launcher"
      ? { enabled: true, transformed: moduleCacheEntries(moduleCache) - before, bypassed: route.reuse.bypassed ?? 0,
        ...(route.reuse.bypass_reasons === undefined ? {} : { bypass_reasons: route.reuse.bypass_reasons }) }
      : { enabled: state !== "off", reason: route.reuse.reason })}\n`);
  }
} catch (error) {
  process.stderr.write(`${error?.stack ?? error}\n`);
  channel.emit("runtime_error", { code: "test_proof_native_runner_unavailable",
    message: "Vitest could not be loaded or started", failure_diagnostic: failureDiagnostic(error) });
  process.exitCode = 3;
}
