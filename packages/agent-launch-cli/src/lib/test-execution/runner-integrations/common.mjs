

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { resolveInstalledPackage } from "../../test-runtime-setup/npm-installation.mjs";

export class RunnerIntegrationPreconditionError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = "RunnerIntegrationPreconditionError";
    this.code = code;
    this.detail = detail;
  }
}

export function escapeRegExp(text) {
  return text.replace(/[\\^$.*+?()[\]{}|/]/gu, "\\$&");
}

function npmPackageLocation(runtime, packageName) {
  const context = runtime.values.package_context ?? ".";
  const trees = (runtime.values.node_modules_trees ?? []).map(({ owner, source, path: attempt }) =>
    ({ owner, dir: source, attempt }));
  const found = resolveInstalledPackage(trees, context, packageName);
  if (found.status === "found") {
    return { host: found.dir, attempt: path.join(found.tree.attempt, packageName) };
  }
  if (found.status === "inaccessible") {
    throw new RunnerIntegrationPreconditionError("test_runtime_runner_package_inaccessible",
      `the installed ${packageName} at ${found.path} cannot be read (${found.errno})`,
      { package: packageName, declaring_package: context, path: found.path, errno: found.errno });
  }
  throw new RunnerIntegrationPreconditionError("test_runtime_runner_package_missing",
    found.status === "broken"
      ? `the installed ${packageName} at ${found.path} links ${found.target}, which does not exist`
      : `the prepared project dependencies do not include ${packageName}`,
    { package: packageName, declaring_package: context,
      ...(found.status === "broken" ? { path: found.path, link_target: found.target }
        : { searched: found.searched }) });
}

export function npmPackageBin(runtime, packageName, binName = packageName) {
  const location = npmPackageLocation(runtime, packageName);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path.join(location.host, "package.json"), "utf8"));
  } catch (error) {
    const missing = error?.code === "ENOENT" || error instanceof SyntaxError;
    throw new RunnerIntegrationPreconditionError(
      missing ? "test_runtime_runner_package_missing" : "test_runtime_runner_package_inaccessible",
      missing ? `the prepared project dependencies do not include ${packageName}`
        : `the manifest of the installed ${packageName} at ${location.host} cannot be read (${error?.code})`,
      { package: packageName, path: location.host, errno: error?.code ?? null });
  }
  const relative = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[binName];
  if (typeof relative !== "string") {
    throw new RunnerIntegrationPreconditionError("test_runtime_runner_package_missing",
      `${packageName} declares no ${binName} executable`, { package: packageName });
  }
  return path.join(location.attempt, relative);
}

export function npmPackageDirectory(runtime, packageName) {
  return npmPackageLocation(runtime, packageName).attempt;
}

export function npmPackageAsset(runtime, packageName, relative) {
  const location = npmPackageLocation(runtime, packageName);
  return existsSync(path.join(location.host, relative)) ? path.join(location.attempt, relative) : null;
}
