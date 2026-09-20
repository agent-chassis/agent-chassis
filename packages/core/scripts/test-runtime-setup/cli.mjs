

import path from "node:path";

import {
  REPOSITORY_RUNTIME_CONFIG_FILE,
  configuredToolchainExecutables,
  configuredToolchainVersions,
  loadTestRuntimeConfig,
  readRepositoryRuntimeConfig
} from "./config.mjs";

export const TEST_RUNTIMES_USAGE = `Usage: agent-chassis setup --test-runtimes [options]

Prepares the local test runtimes that saved test proofs of the selected
runners need, in an existing repository (run from the repository root):
  - installs missing selected toolchains (Node, Python, Go, Rust/Cargo, Deno)
    at supported pinned versions into an explicit toolchain root,
  - prepares the project's lockfile-pinned test dependencies with the standard
    package manager into launcher-owned state,
  - verifies every component inside the launcher sandbox, then publishes
    .agent-launch/test-runtimes/readiness.v1.json.
Proof attempts (workspace_verify_proof) never download or install anything.

Options:
  --runner <name>[@<project>]   select a runner (repeatable); names:
                                <runners>
                                omitted: repeat the published selection
  --toolchain <name>=<version>  request an exact supported toolchain version
  --runtime-config <file>       read the selection, and any explicit toolchain
                                executable locations, from one JSON file
                                (resolved against this directory); not
                                combinable with --runner, --toolchain or
                                --host-toolchains. With neither this nor
                                --runner, the repository's own
                                agent-chassis-runtime.json is used when it
                                exists, then the published selection.
  --toolchain-root <dir>        absolute toolchain installation root
  --state-root <dir>            absolute prepared-dependency state root
  --host-toolchains reuse|ignore
                                reuse compatible host installations (default)
                                or always use the toolchain root
  --dry-run                     report the plan without installing or publishing
  --json                        print the structured result`;

export function parseRunnerSelector(value) {
  const parts = value.split("@");
  const [runner, project] = parts;
  if (!/^[a-z][a-z0-9-]*$/u.test(runner) || parts.length > 2) {
    throw new Error(`invalid --runner value: ${value}`);
  }
  return { runner, project: project ?? "." };
}

export function parseExecutableSelector(value) {
  const separator = value.indexOf("=");
  const name = separator === -1 ? "" : value.slice(0, separator);
  const executable = separator === -1 ? "" : value.slice(separator + 1);
  if (!/^[a-z]+$/u.test(name) || !path.isAbsolute(executable)) {
    throw new Error(`invalid --executable value (expected <toolchain>=<absolute path>): ${value}`);
  }
  return { name, executable };
}

function optionValue(argv, index, name) {
  const arg = argv[index];
  if (arg.startsWith(`${name}=`)) return { value: arg.slice(name.length + 1), next: index };
  if (index + 1 >= argv.length) throw new Error(`${name} requires a value`);
  return { value: argv[index + 1], next: index + 1 };
}

export function parseTestRuntimesArgs(argv) {
  const options = { runners: [], toolchainVersions: {}, toolchainRoot: null, stateRoot: null,
    hostToolchains: "reuse", hostToolchainsExplicit: false, runtimeConfig: null,
    dryRun: false, json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const name = arg.split("=")[0];
    if (arg === "--test-runtimes") continue;
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (name === "--runner") {
      const { value, next } = optionValue(argv, index, name);
      options.runners.push(parseRunnerSelector(value));
      index = next;
    } else if (name === "--toolchain") {
      const { value, next } = optionValue(argv, index, name);
      const match = /^([a-z]+)=(\d+\.\d+\.\d+)$/u.exec(value);
      if (!match) throw new Error(`invalid --toolchain value (expected <name>=<x.y.z>): ${value}`);
      options.toolchainVersions[match[1]] = match[2];
      index = next;
    } else if (name === "--runtime-config") {
      const { value, next } = optionValue(argv, index, name);
      if (value === "") throw new Error("--runtime-config requires a file path");
      options.runtimeConfig = value;
      index = next;
    } else if (name === "--toolchain-root" || name === "--state-root") {
      const { value, next } = optionValue(argv, index, name);
      if (!path.isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
      options[name === "--toolchain-root" ? "toolchainRoot" : "stateRoot"] = value;
      index = next;
    } else if (name === "--host-toolchains") {
      const { value, next } = optionValue(argv, index, name);
      if (!["reuse", "ignore"].includes(value)) throw new Error(`invalid --host-toolchains value: ${value}`);
      options.hostToolchains = value;
      options.hostToolchainsExplicit = true;
      index = next;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.runtimeConfig !== null && !options.help) {
    for (const [flag, supplied] of [["--runner", options.runners.length > 0],
      ["--toolchain", Object.keys(options.toolchainVersions).length > 0],
      ["--host-toolchains", options.hostToolchainsExplicit]]) {
      if (supplied) throw new Error(`--runtime-config cannot be combined with ${flag}`);
    }
  }
  return options;
}

function renderComponent(component) {
  const label = component.kind === "toolchain" ? component.name
    : `${component.ecosystem} dependencies (${component.project})`;
  const detail = component.status === "ready" || component.status === "planned"
    ? [component.version && `${component.version} [${component.version_source}]`,
      component.source && `source ${component.source}`, component.reused ? "reused" : null]
      .filter(Boolean).join(", ")
    : `${component.code}: ${component.message}`;
  return `  ${component.status.padEnd(8)} ${label}${detail ? ` - ${detail}` : ""}`;
}

export function renderTestRuntimeSetupResult(result) {
  const lines = [`test runtime setup: ${result.status}`];
  for (const component of result.components ?? []) lines.push(renderComponent(component));
  for (const check of result.verification ?? []) {
    lines.push(`  ${check.ok ? "verified" : "FAILED  "} ${check.provider_id} (${check.project}) ${check.check}` +
      (check.ok ? "" : ` - ${check.code}${check.diagnostic ? `: ${check.diagnostic}` : ""}`));
  }
  if (result.failure) {
    lines.push(`${result.failure.code}: ${result.failure.message}`);
    const available = result.failure.detail?.available_runners;
    if (Array.isArray(available)) lines.push(`available runners: ${available.join(", ")}`);
  }
  if (result.status === "ready") lines.push(`published ${result.readiness_path}`);
  return `${lines.join("\n")}\n`;
}

export async function runTestRuntimesSetup({ argv, cwd = process.cwd(),
  output = process.stdout } = {}) {
  const setup = await import("@agent-chassis/agent-launch-cli/src/lib/test-runtime-setup/index.mjs");
  const options = parseTestRuntimesArgs(argv);
  if (options.help) {
    output.write(`${TEST_RUNTIMES_USAGE.replace("<runners>",
      setup.testRuntimeRunnerNames().join(", "))}\n`);
    return { ok: true };
  }

  const saved = options.runtimeConfig === null && options.runners.length === 0
    ? readRepositoryRuntimeConfig(cwd) : { present: false };
  const config = options.runtimeConfig !== null
    ? loadTestRuntimeConfig(options.runtimeConfig, { cwd })
    : saved.present ? { ...saved, source: REPOSITORY_RUNTIME_CONFIG_FILE } : null;
  const result = await setup.runTestRuntimeSetup({
    repositoryRoot: cwd,
    runners: config !== null ? config.runners
      : options.runners.length > 0 ? options.runners : null,
    toolchainVersions: config !== null ? configuredToolchainVersions(config)
      : options.toolchainVersions,
    toolchainExecutables: config !== null ? configuredToolchainExecutables(config) : {},
    toolchainRoot: options.toolchainRoot,
    stateRoot: options.stateRoot,
    hostToolchains: options.hostToolchains,
    dryRun: options.dryRun
  });
  output.write(options.json ? `${JSON.stringify(result, null, 2)}\n`
    : renderTestRuntimeSetupResult(result));
  return result;
}
