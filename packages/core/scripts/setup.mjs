#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { parseExecutableSelector, parseRunnerSelector } from "./test-runtime-setup/cli.mjs";

export const SETUP_AGENTS = Object.freeze([
  Object.freeze({
    key: "claude",
    label: "Claude",
    command: "claude",
    template: "agent-launch.claude.toml"
  }),
  Object.freeze({
    key: "codex",
    label: "Codex",
    command: "codex",
    template: "agent-launch.codex.toml"
  })
]);

const USAGE = `Usage: agent-chassis setup [--agent claude|codex] [--dry-run]
              [--language <name>] [--runner <name>[@<project>]]...
              [--executable <toolchain>=<absolute-path>]...
       agent-chassis setup --test-runtimes [options]

Runs first-time AgentChassis setup from a consumer repo root:
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
  - print operator-owned root-guidance, staging, code-index, and orchestrator commands

This command is for a new repository. Setup never creates, reads, modifies, or
deletes root AGENTS.md or CLAUDE.md. Run the printed commands to create them.

Test-runtime options (all optional; setup asks only where a toolchain is
installed when PATH has none, and says exactly which option to pass when it
cannot ask):
  --language <name>             detect only the environments of this language
  --runner <name>[@<project>]   detect exactly this runner's environment
                                instead of the repository inventory
  --executable <toolchain>=<absolute-path>
                                where a toolchain is installed, when PATH has
                                none or the wrong one (repeatable)

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

function valueOf(argv, index, name) {
  const arg = argv[index];
  if (arg.startsWith(`${name}=`)) return { value: arg.slice(name.length + 1), next: index };
  if (index + 1 >= argv.length) throw new Error(`${name} requires a value`);
  return { value: argv[index + 1], next: index + 1 };
}

function parseArgs(argv) {
  const options = {
    agent: null,
    dryRun: false,
    language: null,
    runners: [],
    executables: {}
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const name = arg.split("=")[0];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (name === "--agent") {
      const { value, next } = valueOf(argv, index, name);
      options.agent = value;
      index = next;
    } else if (name === "--language") {
      const { value, next } = valueOf(argv, index, name);
      options.language = value;
      index = next;
    } else if (name === "--runner") {
      const { value, next } = valueOf(argv, index, name);
      options.runners.push(parseRunnerSelector(value));
      index = next;
    } else if (name === "--executable") {
      const { value, next } = valueOf(argv, index, name);
      const { name: toolchain, executable } = parseExecutableSelector(value);
      options.executables[toolchain] = executable;
      index = next;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.agent !== null && !SETUP_AGENTS.some((agent) => agent.key === options.agent)) {
    throw new Error(`Unsupported --agent value: ${options.agent}`);
  }

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

async function chooseAgent({ requestedAgent, detectedAgents, input = process.stdin, output = process.stdout }) {
  if (requestedAgent !== null) {
    return SETUP_AGENTS.find((agent) => agent.key === requestedAgent);
  }

  if (detectedAgents.length === 1) {
    return detectedAgents[0];
  }

  if (detectedAgents.length === 0) {
    output.write("No supported agent CLI was detected on PATH (checked: claude, codex).\n");
    output.write("Install Claude Code or Codex CLI, then rerun setup with --agent claude or --agent codex.\n");
    return null;
  }

  output.write("Detected multiple supported agent CLIs:\n");
  detectedAgents.forEach((agent, index) => {
    output.write(`  ${index + 1}. ${agent.label} (${agent.key})\n`);
  });

  if (!input.isTTY) {
    output.write("Rerun with --agent claude or --agent codex to choose a launcher template.\n");
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
    "Next commands for a new repository with no existing root agent guidance:",
    "  cat wiki/templates/AGENTS.md.boilerplate.md >> AGENTS.md",
    "  printf '@AGENTS.md\\n' > CLAUDE.md",
    "  git status --short",
    "  git add AGENTS.md CLAUDE.md wiki .gitignore agent-launch.toml",
    "  git commit -m \"bootstrap AgentChassis wiki adoption\"",
    "  npx wiki code-index build --json",
    "  npx agent-launch orchestrator IN-0001",
    ""
  ].join("\n");
}

function printNextCommands(output) {
  output.write(renderNextCommands());
}

async function prepareTestRuntimes({ options, cwd, input, output, env }) {
  const { prepareRepositoryTestRuntimes } = await import("./test-runtime-setup/prepare.mjs");
  try {
    return await prepareRepositoryTestRuntimes({ repositoryRoot: cwd, runners: options.runners,
      language: options.language, executables: options.executables, dryRun: options.dryRun,
      input, output, env });
  } catch (error) {
    output.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return { ok: false, status: "failed" };
  }
}

export async function runSetup({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  input = process.stdin,
  output = process.stdout,
  env = process.env
} = {}) {
  if (argv.includes("--test-runtimes")) {
    const { runTestRuntimesSetup } = await import("./test-runtime-setup/cli.mjs");
    const result = await runTestRuntimesSetup({ argv, cwd, input, output, env });
    if (!result.ok) process.exitCode = 1;
    return;
  }
  const options = parseArgs(argv);
  if (options.help) {
    output.write(`${USAGE}\n`);
    return;
  }

  const detectedAgents = detectAgents();
  const agent = await chooseAgent({
    requestedAgent: options.agent,
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
    copyLauncherTemplate({ agent, dryRun: options.dryRun, cwd, output });
  }

  printStep(output, "Initialize launcher config");
  runCommand("npx", ["agent-launch", "init-config"], step);

  printStep(output, "Detect local test runtimes");
  const prepared = await prepareTestRuntimes({ options, cwd, input, output, env });
  if (!prepared.ok) process.exitCode = 1;

  printNextCommands(output);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  runSetup().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`AgentChassis setup failed: ${message}\n`);
    process.exitCode = 1;
  });
}
