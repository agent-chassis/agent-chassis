

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const LAUNCHER_RUNNER = fileURLToPath(new URL("./vitest-runner.mjs", import.meta.url));

export async function loadProjectVitest(projectDir = process.cwd()) {
  const projectRequire = createRequire(path.join(projectDir, "launcher-test-proof.cjs"));
  const vitest = await import(pathToFileURL(projectRequire.resolve("vitest/node")).href);
  const version = JSON.parse(readFileSync(projectRequire.resolve("vitest/package.json"), "utf8")).version;
  return { vitest, version };
}

const baseOptions = () => ({ run: true, watch: false, cache: false, color: false, configLoader: "runner",
  fileParallelism: false });

function pluginSignature(plugin) {
  return [plugin?.name, ...Object.keys(plugin ?? {}).sort().map((key) => {
    const value = plugin[key];
    const hook = typeof value === "function" ? value : typeof value?.handler === "function" ? value.handler : null;
    return hook === null ? key : `${key}:${hook.toString()}`;
  })].join("\u0000");
}
const pluginSignatures = (config) => JSON.stringify((config.plugins ?? []).map(pluginSignature).sort());

const launcherPlugin = (onResolved, onConfigure = () => {}) => ({ name: "launcher:vitest-transform-reuse",
  enforce: "post", configResolved(config) { onResolved(config); }, configureVitest(context) { onConfigure(context); } });

const digest = (text) => createHash("sha256").update(text).digest("hex");

function resolvedOptionsText(config) {
  let unrepresentable = null;
  const text = JSON.stringify({ define: config.define ?? null, oxc: config.oxc ?? null, env: config.env ?? null,
    resolve: config.resolve ?? null }, (_key, value) => {
    if (typeof value === "function") unrepresentable ??= "function_valued_transform_option";
    if (typeof value === "bigint" || typeof value === "symbol") unrepresentable ??= "unrepresentable_transform_option";
    return value instanceof RegExp ? `RegExp:${value.toString()}` : value;
  });
  return unrepresentable === null ? { text } : { bypass: unrepresentable };
}

async function loadTsconfigResolution(projectDir) {
  try {
    const viteRequire = createRequire(createRequire(path.join(projectDir, "launcher-test-proof.cjs"))
      .resolve("vite/package.json"));
    const rolldown = await import(pathToFileURL(viteRequire.resolve("rolldown/experimental")).href);
    return typeof rolldown.resolveTsconfig === "function" && typeof rolldown.TsconfigCache === "function"
      ? rolldown : null;
  } catch {
    return null;
  }
}

export function launcherCacheKeyGenerator({ reuse, tsconfigResolution }) {
  const environments = new WeakMap();
  const tsconfigCaches = new WeakMap();
  const bypass = (reason) => {
    reuse.bypassed = (reuse.bypassed ?? 0) + 1;
    reuse.bypass_reasons = [...new Set([...(reuse.bypass_reasons ?? []), reason])].sort();
    return false;
  };
  const environmentPart = (config) => {
    let configText = "";
    if (typeof config.configFile === "string") {
      try { configText = readFileSync(config.configFile, "utf8"); } catch { return { bypass: "configuration_unreadable" }; }
    }
    const options = resolvedOptionsText(config);
    return options.bypass !== undefined ? options
      : { key: digest(JSON.stringify([config.configFile ?? null, configText, options.text])) };
  };
  const tsconfigPart = (config, id) => {
    const file = id.split("?")[0];
    if (!path.isAbsolute(file) || id.startsWith("\0")) return { key: "no_file" };
    if (tsconfigResolution === null) return { bypass: "tsconfig_resolution_unavailable" };
    let cache = tsconfigCaches.get(config);
    if (cache === undefined) {
      cache = new tsconfigResolution.TsconfigCache(typeof config.tsconfig === "string" ? config.tsconfig : undefined);
      tsconfigCaches.set(config, cache);
    }
    try {
      const resolved = tsconfigResolution.resolveTsconfig(file, cache);
      return { key: resolved === null ? "no_tsconfig" : digest(JSON.stringify(resolved.tsconfig)) };
    } catch {
      return { bypass: "tsconfig_unresolved" };
    }
  };
  return ({ environment, id }) => {
    const config = environment.config;
    let part = environments.get(environment);
    if (part === undefined) {
      part = environmentPart(config);
      environments.set(environment, part);
    }
    if (part.bypass !== undefined) return bypass(part.bypass);
    const tsconfig = tsconfigPart(config, id);
    if (tsconfig.bypass !== undefined) return bypass(tsconfig.bypass);
    return `launcher:${part.key}:${tsconfig.key}`;
  };
}

export async function resolveLauncherVitest({ vitest, moduleCache = null, projectDir = process.cwd() }) {
  const resolved = await vitest.resolveConfig({ ...baseOptions() });
  if (resolved.test?.runner) return { customRunner: true };
  const options = { ...baseOptions(), runner: LAUNCHER_RUNNER, fsModuleCache: false };
  const reuse = { reason: typeof moduleCache === "string" ? "undecided" : "module_cache_unavailable" };
  if (typeof moduleCache !== "string") return { customRunner: false, options, viteOverrides: {}, reuse };
  let builtIn = null;
  await vitest.resolveConfig({ ...options, config: false },
    { plugins: [launcherPlugin((config) => { builtIn = pluginSignatures(config); })] });
  const tsconfigResolution = await loadTsconfigResolution(projectDir);
  let decided = false;
  let generator = null;
  const plugin = launcherPlugin((config) => {
    if (decided) return;
    decided = true;
    reuse.reason = config.test?.projects !== undefined ? "configured_projects"
      : pluginSignatures(config) !== builtIn ? "configured_plugins" : null;
    if (reuse.reason === null) {
      config.test ??= {};
      config.test.fsModuleCache = true;
      config.test.fsModuleCachePath = moduleCache;
    }
  }, ({ defineCacheKeyGenerator }) => {

    if (reuse.reason !== null || generator !== null) return;
    generator = launcherCacheKeyGenerator({ reuse, tsconfigResolution });
    defineCacheKeyGenerator(generator);
  });
  return { customRunner: false, options, viteOverrides: { plugins: [plugin] }, reuse };
}

export function moduleCacheState(ctx, moduleCache) {
  const enabled = [ctx.config, ...ctx.projects.map((project) => project.config)]
    .filter((config) => config.fsModuleCache === true);
  if (enabled.length === 0) return "off";
  return enabled.every((config) => config.fsModuleCachePath === moduleCache) ? "launcher" : "other";
}

export function moduleCacheEntries(directory) {

  let names;
  try { names = readdirSync(directory); } catch { return 0; }
  return names.filter((name) => name !== "_metadata.json" && !name.startsWith(".")).length;
}
