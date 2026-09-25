

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function projectConfig(hostProjectDir, projectDir) {
  const name = ["deno.json", "deno.jsonc"].find((candidate) =>
    existsSync(path.join(hostProjectDir, candidate)));
  return name === undefined ? [] : ["--config", path.join(projectDir, name)];
}

function lockFailure(code, message) {
  return Object.assign(new Error(message), { code });
}

const recordedCount = (value) => Object.keys(value ?? {}).length;

function lockedDependencies(hostProjectDir) {
  const file = path.join(hostProjectDir, "deno.lock");
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    throw lockFailure(error?.code === "ENOENT" ? "test_runtime_dependency_lock_missing"
      : "test_runtime_manifest_invalid", `${file} could not be read: ${error?.message ?? String(error)}`);
  }
  let lock;
  try {
    lock = JSON.parse(text);
  } catch (error) {
    throw lockFailure("test_runtime_manifest_invalid", `${file} is not valid JSON: ${error.message}`);
  }
  if (lock === null || typeof lock !== "object" || Array.isArray(lock)) {
    throw lockFailure("test_runtime_manifest_invalid", `${file} is not a JSON object`);
  }
  const dependencies = [...new Set([...(lock.workspace?.dependencies ?? []),
    ...(lock.workspace?.packageJson?.dependencies ?? []), ...Object.keys(lock.remote ?? {})])].sort();
  const packages = recordedCount(lock.jsr) + recordedCount(lock.npm) + recordedCount(lock.packages?.jsr) +
    recordedCount(lock.packages?.npm);
  if (dependencies.length === 0 && packages > 0) {
    throw lockFailure("test_runtime_runner_probe_unsupported",
      `the Deno setup probe has no supported check target: ${file} records ${packages} package(s) but no ` +
      "direct dependency specifier; this is a limitation of the probe, not a finding that the lock is invalid");
  }
  return dependencies;
}

export default Object.freeze({
  runner_id: "runner.deno",

  setupProbe: ({ runtime, projectDir }) => {
    const dependencies = lockedDependencies(projectDir);
    return { command: runtime.executables.deno, cwd: projectDir,
      args: dependencies.length === 0 ? ["info", "--json"]
        : ["check", "--cached-only", "--frozen", ...projectConfig(projectDir, projectDir), ...dependencies] };
  },
  invocation: ({ runtime, hostProjectDir, projectDir, entry, writablePaths }) => ({
    command: runtime.executables.deno,
    args: ["test", "--frozen", "--cached-only", "--no-prompt", ...projectConfig(hostProjectDir, projectDir),
      `--allow-write=${writablePaths.join(",")}`, entry],
    cwd: projectDir
  })
});
