

import path from "node:path";

import { loadTestRuntimeConfig } from "./config.mjs";

export const TEST_RUNTIMES_USAGE = `Usage: agent-chassis setup --test-runtimes [options]

Detects every local test environment this repository declares, in an
existing repository (run from the repository root):
  - finds each dependency environment from the repository's own manifests
    (npm packages and their workspace members, Python projects, Go modules,
    Cargo packages, Deno projects), in every language at once, skipping
    ignored paths and test fixtures,
  - finds the toolchains you installed (Node, Python, Go, Rust/Cargo, Deno)
    at their configured locations or on PATH and checks any version the
    repository pins,
  - finds the dependencies you installed for each environment (its
    node_modules, virtual environment, Go module cache, Cargo registry or
    Deno cache) and checks they hold what the project declares,
  - proves each environment's toolchains and every test runner it declares or
    its toolchain provides inside the launcher sandbox, then publishes
    .agent-launch/test-runtimes/readiness.json as ready with one ID per
    environment (for example npm@. or python@services/api); a failed run is
    published there as failed with its complete result, never as ready.
It never downloads or installs a toolchain or dependency: install or repair
what a failure names yourself, then rerun it. Several environments and runners
coexist; nothing is chosen from a list. Proof attempts (workspace_verify_proof)
never download or install anything either; they route each saved test to its
environment, or to one named with their optional environment parameter.

Options:
  --runner <name>[@<project>]   detect exactly this runner's environment
                                instead of the repository inventory
                                (repeatable); names: <runners>
  --toolchain <name>=<version>  require an exact installed toolchain version
  --runtime-config <file>       read an explicit runner selection and/or
                                toolchain executable locations from one JSON
                                file (resolved against this directory); not
                                combinable with --runner or --toolchain, and
                                never saved
  --dry-run                     detect and validate without the sandbox proof
                                or publishing
  --json                        print the structured result (progress goes to stderr)`;

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
  const options = { runners: [], toolchainVersions: {}, runtimeConfig: null,
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
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.runtimeConfig !== null && !options.help) {
    for (const [flag, supplied] of [["--runner", options.runners.length > 0],
      ["--toolchain", Object.keys(options.toolchainVersions).length > 0]]) {
      if (supplied) throw new Error(`--runtime-config cannot be combined with ${flag}`);
    }
  }
  return options;
}

function renderComponent(component) {
  const label = component.kind === "toolchain" ? component.name
    : `${component.environment ?? `${component.ecosystem}@${component.project}`} dependencies`;
  const detail = component.status === "ready"
    ? [component.version && `${component.version} [${component.version_source}]`,
      component.source && `source ${component.source}`, component.dir && `at ${component.dir}`]
      .filter(Boolean).join(", ")
    : `${component.code}: ${component.message}`;
  return `  ${component.status.padEnd(8)} ${label}${detail ? ` - ${detail}` : ""}`;
}

export function renderTestRuntimeSetupResult(result) {
  const lines = [`test runtime setup: ${result.status}`];
  for (const component of result.components ?? []) lines.push(renderComponent(component));
  for (const check of result.verification ?? []) {
    lines.push(`  ${check.ok ? "verified" : "FAILED  "} ${[check.environment, check.provider_id, check.check]
      .filter(Boolean).join(" ")}` +
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

function collectedOutput() {
  const lines = [];
  return { sink: { write: (text) => { lines.push(text); return true; } },
    read: () => lines.join("").split("\n").filter((line) => line !== "") };
}

export async function runTestRuntimesSetup({ argv, cwd = process.cwd(),
  input = process.stdin, output = process.stdout, errorOutput = process.stderr, env = process.env } = {}) {
  const options = parseTestRuntimesArgs(argv);
  if (options.help) {
    const setup = await import("@agent-chassis/agent-launch-cli/src/lib/test-runtime-setup/index.mjs");
    output.write(`${TEST_RUNTIMES_USAGE.replace("<runners>",
      setup.testRuntimeRunnerNames().join(", "))}\n`);
    return { ok: true };
  }

  const config = options.runtimeConfig === null ? null
    : loadTestRuntimeConfig(options.runtimeConfig, { cwd });
  const { prepareRepositoryTestRuntimes } = await import("./prepare.mjs");
  const collected = options.json ? collectedOutput() : null;
  const prepared = await prepareRepositoryTestRuntimes({
    repositoryRoot: cwd,
    runners: options.runners,
    toolchainVersions: options.toolchainVersions,
    runtimeConfig: config,

    locatePathToolchains: false,
    command: { invocation: "setup --test-runtimes" },

    ...(options.json ? { interactive: false } : {}),
    dryRun: options.dryRun,
    input,
    output: collected === null ? output : collected.sink,

    progressOutput: collected === null ? output : errorOutput,
    env
  });
  if (collected !== null) {
    output.write(`${JSON.stringify({ ...(prepared.result ?? { status: prepared.status }),
      setup_status: prepared.status, excluded: prepared.excluded ?? [],
      report: collected.read() }, null, 2)}\n`);
  }
  return prepared;
}
