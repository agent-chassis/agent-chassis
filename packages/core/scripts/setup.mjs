#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { parseRunnerSelector } from "./test-runtime-setup/cli.mjs";
import { optionValue, readSetupParameterOption, parseSetupParameterInputs, reportIgnoredSetupParameters } from './test-runtime-setup/parameter-inputs.mjs';
import { SETUP_PARAMETER_HELP } from './test-runtime-setup/parameter-adapters.mjs';
import { testRuntimeEnvironmentId } from '@agent-chassis/agent-launch-cli/src/lib/test-runtime-setup/readiness.mjs';
import { SETUP_AGENTS, setupAgentChoices, setupAgentCommands } from "./setup-agent-catalog.mjs";

export { SETUP_AGENTS } from "./setup-agent-catalog.mjs";

const TEST_RUNTIME_SETUP_MODULE = "@agent-chassis/agent-launch-cli/src/lib/test-runtime-setup/index.mjs";

const USAGE = `Usage: agent-chassis setup [--agent ${setupAgentChoices()}] [--dry-run]
              [--language <name>] [--runner <name>[@<project>]]...
              [--executable <toolchain>=<absolute-path>]...
              [--test-runtime-report <path>]
       agent-chassis setup --test-runtimes [options]

Runs AgentChassis setup from a consumer repo root:
  - npx wiki bootstrap --profile standard
  - copy the matching launcher template to agent-launch.toml when absent
  - npx agent-launch init-config
  - detect this repository's local test runtimes: find every dependency
    environment the repository's own manifests declare (all languages,
    workspace members included, ignored paths and test fixtures skipped),
    locate each needed toolchain on PATH, save the toolchain locations in
    ${"`"}agent-chassis-runtime.json${"`"}, then detect and validate the dependencies
    you installed for each environment, prove them in the sandbox and publish
    readiness through the launcher-owned setup; nothing is downloaded or
    installed
  - print remaining operator-owned guidance, commit, and launch steps

Use this in a new or existing repository. Setup never creates, reads, modifies,
or deletes root AGENTS.md or CLAUDE.md. Follow the printed guidance steps while
preserving existing instructions. Setup does not merge guidance or perform a
general migration of obsolete AgentChassis state.

Test-runtime options (all optional; setup asks only where a toolchain is
installed when PATH has none, and says exactly which option to pass when it
cannot ask):
  --language <name>             detect only the environments of this language
  --runner <name>[@<project>]   detect exactly this runner's environment
                                instead of the repository inventory
${SETUP_PARAMETER_HELP}

--test-runtime-report <path> writes compact diagnostic facts for this invocation's
last step, separately from readiness history. A requested report must be preserved.

Exit status: 0 when setup succeeded, which includes a repository with no test
project and is not by itself runtime readiness; 3 when every earlier step
succeeded and the local test runtimes are not ready or could not be resolved;
any other nonzero status when setup failed otherwise.

--test-runtimes reruns only that last step for an already-configured
repository, with the same resolution and the same saved configuration. Run
"agent-chassis setup --test-runtimes --help" for its options.`;

function packageRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function commandAvailable(command) {
  const result = spawnSync(command, ["--version"], {
    stdio: "ignore",
    timeout: 1500,
    windowsHide: true
  });
  return result.error ? result.error.code !== "ENOENT" && result.error.code !== "ETIMEDOUT" : true;
}

function detectAgents() {
  return SETUP_AGENTS.filter((agent) => commandAvailable(agent.command));
}

function parseArgs(argv, env) {
  const options = {
    agent: null,
    dryRun: false,
    testRuntimeReport: null,
    language: null,
    runners: [],
    parameterInputs: [],
    nonInteractive: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const name = arg.split("=")[0];
    const parameterNext = readSetupParameterOption(argv, index, options.parameterInputs);
    if (parameterNext !== null) {
      index = parameterNext;
    } else if (arg === "--non-interactive") {
      options.nonInteractive = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (name === "--agent") {
      const { value, next } = optionValue(argv, index, name);
      options.agent = value;
      index = next;
    } else if (name === "--test-runtime-report") {
      const { value, next } = optionValue(argv, index, name);
      if (!value || value.startsWith("--")) throw new Error(`${name} requires a path`);
      options.testRuntimeReport = value;
      index = next;
    } else if (name === "--language") {
      const { value, next } = optionValue(argv, index, name);
      options.language = value;
      index = next;
    } else if (name === "--runner") {
      const { value, next } = optionValue(argv, index, name);
      options.runners.push(parseRunnerSelector(value));
      index = next;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.agent !== null && !SETUP_AGENTS.some((agent) => agent.key === options.agent)) {
    throw new Error(`Unsupported --agent value: ${options.agent}. Use ${setupAgentCommands()}.`);
  }

  options.parameters = parseSetupParameterInputs({ inputs: options.parameterInputs, env, testRuntimeEnvironmentId });
  return options;
}

function printStep(output, message) {
  output.write(`\n==> ${message}\n`);
}

function runCommand(command, args, { dryRun, cwd, env, output }) {
  output.write(`$ ${[command, ...args].join(" ")}\n`);
  if (dryRun) {
    return;
  }

  const result = spawnSync(command, args, {
    stdio: "inherit",
    cwd,
    env,
    shell: process.platform === "win32",
    windowsHide: true
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with status ${result.status}`);
  }
}

async function chooseAgent({ requestedAgent, detectedAgents, interactive, input = process.stdin, output = process.stdout }) {
  if (requestedAgent !== null) {
    return SETUP_AGENTS.find((agent) => agent.key === requestedAgent);
  }

  if (detectedAgents.length === 1) {
    return detectedAgents[0];
  }

  if (detectedAgents.length === 0) {
    output.write(`No supported agent CLI was detected on PATH (checked: ${SETUP_AGENTS.map(agent => agent.command).join(", ")}).\n`);
    output.write(`Install a supported CLI, then rerun setup with ${setupAgentCommands()}.\n`);
    return null;
  }

  output.write("Detected multiple supported agent CLIs:\n");
  detectedAgents.forEach((agent, index) => {
    output.write(`  ${index + 1}. ${agent.label} (${agent.key})\n`);
  });

  if (!interactive) {
    output.write(`Rerun with ${setupAgentCommands()} to choose a launcher template.\n`);
    return null;
  }

  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question("Select launcher template [1]: ");
    const selectedIndex = answer.trim() === "" ? 0 : Number.parseInt(answer.trim(), 10) - 1;
    if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= detectedAgents.length) {
      throw new Error(`Invalid selection: ${answer}`);
    }
    return detectedAgents[selectedIndex];
  } finally {
    rl.close();
  }
}

function copyLauncherTemplate({ agent, dryRun, cwd, output }) {
  const target = path.resolve(cwd, "agent-launch.toml");
  if (fs.existsSync(target)) {
    output.write("agent-launch.toml already exists; review it before replacing local launcher defaults.\n");
    return;
  }

  const source = path.join(packageRoot(), "templates", agent.template);
  output.write(`Copy ${source} -> ${target}\n`);
  if (dryRun) {
    return;
  }

  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
}

export function renderNextCommands() {
  return [
    "",
    "Remaining setup steps (also on reruns):",
    "  Open wiki/templates/AGENTS.md.boilerplate.md.",
    "  If root AGENTS.md is absent, create it from that template.",
    "  Otherwise, add only missing AgentChassis guidance; keep existing content",
    "  and reconcile conflicting rules. Do not append the whole template again.",
    "  For Claude, add @AGENTS.md on its own line in root CLAUDE.md only if",
    "  that include is missing. Create the file if needed; keep existing instructions.",
    "  Review agent-launch.toml: select registered models your authenticated CLI can use.",
    "  If test-runtime preparation failed, follow its correction and rerun:",
    "    npx agent-chassis setup --test-runtimes",
    "  Review and stage only the setup files you intend to track, including",
    "  package.json and its lockfile, then commit before launching:",
    "    git status --short",
    "    git commit -m \"set up AgentChassis\"",
    "    npx agent-launch orchestrator IN-0001",
    "  Fresh setup seeds IN-0001; an existing valid initiative is preserved.",
    ""
  ].join("\n");
}

function printNextCommands(output) {
  output.write(renderNextCommands());
}

export const TEST_RUNTIMES_UNAVAILABLE_EXIT_CODE = 3;

async function prepareTestRuntimes({ prepare, options, cwd, input, output, env }) {
  const prepareRepositoryTestRuntimes = prepare ??
    (await import("./test-runtime-setup/prepare.mjs")).prepareRepositoryTestRuntimes;
  try {
    return await prepareRepositoryTestRuntimes({ repositoryRoot: cwd, runners: options.runners,
      language: options.language, parameters: options.parameters, interactive: options.interactive, dryRun: options.dryRun,
      input, output, env });
  } catch (error) {
    const { TestRuntimeSetupError } = await import(TEST_RUNTIME_SETUP_MODULE);
    if (!(error instanceof TestRuntimeSetupError)) throw error;
    output.write(`${error.message}\n`);
    return { ok: false, status: "failed", phase: "preparation",
      failure: { code: error.code, message: error.message, detail: error.detail },
      correction: error.detail.correction ?? null };
  }
}

export async function runSetup({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  input = process.stdin,
  output = process.stdout,
  env = process.env,

  prepare = null
} = {}) {
  if (argv.includes("--test-runtimes")) {
    const { runTestRuntimesSetup } = await import("./test-runtime-setup/cli.mjs");
    const result = await runTestRuntimesSetup({ argv, cwd, input, output, env });
    if (!result.ok) process.exitCode = 1;
    return;
  }
  const options = parseArgs(argv, env);
  options.interactive = !options.nonInteractive && input.isTTY === true;
  if (options.help) {
    output.write(`${USAGE}\n`);
    return;
  }

  reportIgnoredSetupParameters(options.parameters, output);
  const reportPath = options.testRuntimeReport === null ? null : path.resolve(cwd, options.testRuntimeReport);

  if (reportPath !== null) {
    try {
      fs.rmSync(reportPath, { force: true });
    } catch (error) {
      throw new Error(`Could not clear prior test-runtime report at ${reportPath}: ${error.message}`, { cause: error });
    }
  }

  const detectedAgents = options.agent === null ? detectAgents() : [];
  const agent = await chooseAgent({
    requestedAgent: options.agent,
    interactive: options.interactive,
    detectedAgents,
    input,
    output
  });

  const step = { dryRun: options.dryRun, cwd, env, output };
  printStep(output, "Bootstrap wiki surfaces");
  runCommand("npx", ["wiki", "bootstrap", "--profile", "standard"], step);

  printStep(output, "Configure launcher template");
  if (agent === null) {
    output.write("Skipped agent-launch.toml copy because no launcher template was selected.\n");
  } else {
    if (agent.prerequisites) output.write(`${agent.label}: ${agent.prerequisites}\n`);
    copyLauncherTemplate({ agent, dryRun: options.dryRun, cwd, output });
  }

  printStep(output, "Initialize launcher config");
  runCommand("npx", ["agent-launch", "init-config"], step);

  printStep(output, "Detect local test runtimes");
  const prepared = await prepareTestRuntimes({ prepare, options, cwd, input, output, env });
  if (reportPath !== null) {
    const { testRuntimePreparationReport } = await import("./test-runtime-setup/prepare.mjs");
    try {
      fs.writeFileSync(reportPath, `${JSON.stringify(testRuntimePreparationReport(prepared))}\n`, { flag: "wx" });
    } catch (error) {
      throw new Error(`Could not preserve test-runtime report at ${reportPath}: ${error.message}`, { cause: error });
    }
  }
  if (!prepared.ok) process.exitCode = TEST_RUNTIMES_UNAVAILABLE_EXIT_CODE;

  printNextCommands(output);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  runSetup().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`AgentChassis setup failed: ${message}\n`);
    process.exitCode = 1;
  });
}
