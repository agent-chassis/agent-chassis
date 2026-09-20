

import { readFileSync } from "node:fs";
import path from "node:path";

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

export function npmPackageBin(runtime, packageName, binName = packageName) {
  const source = runtime.values.node_modules_source;
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path.join(source, packageName, "package.json"), "utf8"));
  } catch {
    throw new RunnerIntegrationPreconditionError("test_runtime_runner_package_missing",
      `the prepared project dependencies do not include ${packageName}`,
      { package: packageName });
  }
  const relative = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[binName];
  if (typeof relative !== "string") {
    throw new RunnerIntegrationPreconditionError("test_runtime_runner_package_missing",
      `${packageName} declares no ${binName} executable`, { package: packageName });
  }
  return path.join(runtime.values.node_modules, packageName, relative);
}
