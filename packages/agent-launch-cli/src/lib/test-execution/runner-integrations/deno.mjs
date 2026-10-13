

import { readFileSync } from "node:fs";
import path from "node:path";

import { denoConfigName, denoLockSelection } from "../../test-runtime-setup/deno-config.mjs";

function projectConfig(hostProjectDir, projectDir) {
  const name = denoConfigName(hostProjectDir);
  return name === undefined ? [] : ["--config", path.join(projectDir, name)];
}

function lockFailure(code, message) {
  return Object.assign(new Error(message), { code });
}

const recordedCount = (value) => Object.keys(value ?? {}).length;

function lockedDependencies(file) {
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
    const lock = denoLockSelection(projectDir);
    if (lock.disabled) {
      return { command: runtime.executables.deno, cwd: projectDir,
        args: ["test", "--no-run", "--no-check", "--cached-only", "--no-prompt", "--permit-no-files",
          ...projectConfig(projectDir, projectDir)] };
    }
    const dependencies = lockedDependencies(lock.file);
    return { command: runtime.executables.deno, cwd: projectDir,
      args: dependencies.length === 0 ? ["info", "--json"]
        : ["check", "--cached-only", "--frozen", ...projectConfig(projectDir, projectDir), ...dependencies] };
  },
  invocation,

  ordinaryInvocation: ({ runtime, projectDir, file, selector, proof = null }) => ({
    harness: Object.freeze({ kind: "deno" }),
    invocation: invocation({ runtime, hostProjectDir: projectDir, projectDir, entry: proof?.entry ?? file,
      writablePaths: proof?.writablePaths ?? [], filter: selector })
  })
});

function invocation({ runtime, hostProjectDir, projectDir, entry, writablePaths, filter = null }) {
  return {
    command: runtime.executables.deno,
    args: ["test", "--frozen", "--cached-only", "--no-prompt", ...projectConfig(hostProjectDir, projectDir),
      ...(writablePaths.length === 0 ? [] : [`--allow-write=${writablePaths.join(",")}`]),
      ...(filter === null ? [] : [`--filter=${filter}`]), entry],
    cwd: projectDir
  };
}
