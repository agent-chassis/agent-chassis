#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

export const SETUP_AGENTS = Object.freeze([
  Object.freeze({
    key: "claude",
    label: "Claude",
    command: "claude",
    template: "agent-launch.claude.toml",
    guidanceFile: "CLAUDE.md"
  }),
  Object.freeze({
    key: "codex",
    label: "Codex",
    command: "codex",
    template: "agent-launch.codex.toml",
    guidanceFile: "AGENTS.md"
  })
]);

const USAGE = `Usage: agent-chassis setup [--agent claude|codex] [--dry-run]

Runs first-time AgentChassis setup from a consumer repo root:
  - npx wiki bootstrap --profile standard
  - copy the matching launcher template to agent-launch.toml when absent
  - npx agent-launch init-config
  - print the next code-index and orchestrator commands

The selected root guidance file is created only as an empty placeholder/checkpoint
when absent. Setup never copies wiki/templates/AGENTS.md.boilerplate.md into a
root guidance file; review and adapt repo-specific guidance before relying on it.`;

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

function parseArgs(argv) {
  const options = {
    agent: null,
    dryRun: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--agent") {
      options.agent = argv[index + 1];
      index += 1;
    } else if (arg.startsWith("--agent=")) {
      options.agent = arg.slice("--agent=".length);
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

function printStep(message) {
  process.stdout.write(`\n==> ${message}\n`);
}

function runCommand(command, args, { dryRun }) {
  process.stdout.write(`$ ${[command, ...args].join(" ")}\n`);
  if (dryRun) {
    return;
  }

  const result = spawnSync(command, args, {
    stdio: "inherit",
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

function copyLauncherTemplate({ agent, dryRun }) {
  const target = path.resolve(process.cwd(), "agent-launch.toml");
  if (fs.existsSync(target)) {
    process.stdout.write("agent-launch.toml already exists; review it before replacing local launcher defaults.\n");
    return;
  }

  const source = path.join(packageRoot(), "templates", agent.template);
  process.stdout.write(`Copy ${source} -> ${target}\n`);
  if (dryRun) {
    return;
  }

  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
}

export function guidancePlaceholderForAgent(agent) {
  return agent?.guidanceFile ?? null;
}

export function touchGuidancePlaceholder({ agent, dryRun }) {
  const guidanceFile = guidancePlaceholderForAgent(agent);
  if (guidanceFile === null) {
    process.stdout.write("Skipped root guidance placeholder because no launcher template was selected.\n");
    return null;
  }

  const target = path.resolve(process.cwd(), guidanceFile);
  if (fs.existsSync(target)) {
    process.stdout.write(
      `${guidanceFile} already exists; leaving existing root guidance unchanged.\n`
    );
    return guidanceFile;
  }

  process.stdout.write([
    `${guidanceFile} checkpoint:`,
    `  Create an empty ${guidanceFile} placeholder for the selected ${agent.label} setup.`,
    "  This file is only a placeholder/checkpoint until reviewed and adapted for this repo.",
    "  Setup does not copy wiki/templates/AGENTS.md.boilerplate.md into any root guidance file."
  ].join("\n"));
  process.stdout.write("\n");

  if (dryRun) {
    return guidanceFile;
  }

  fs.closeSync(fs.openSync(target, "wx"));
  return guidanceFile;
}

export function renderNextCommands({ guidanceFile }) {
  const guidancePath = guidanceFile ?? "<selected-guidance-file>";
  return [
    "",
    "Next commands:",
    "  git status --short",
    `  git add ${guidancePath} docs/adoption.md wiki .gitignore agent-launch.toml`,
    "  git commit -m \"bootstrap AgentChassis wiki adoption\"",
    "  npx wiki code-index build --json",
    "  npx agent-launch orchestrator IN-0001",
    ""
  ].join("\n");
}

function printNextCommands({ guidanceFile }) {
  process.stdout.write([
    renderNextCommands({ guidanceFile })
  ].join("\n"));
}

export async function runSetup({ argv = process.argv.slice(2) } = {}) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  const detectedAgents = detectAgents();
  const agent = await chooseAgent({
    requestedAgent: options.agent,
    detectedAgents
  });

  printStep("Bootstrap wiki surfaces");
  runCommand("npx", ["wiki", "bootstrap", "--profile", "standard"], options);

  printStep("Create root guidance placeholder");
  const guidanceFile = touchGuidancePlaceholder({ agent, dryRun: options.dryRun });

  printStep("Configure launcher template");
  if (agent === null) {
    process.stdout.write("Skipped agent-launch.toml copy because no launcher template was selected.\n");
  } else {
    copyLauncherTemplate({ agent, dryRun: options.dryRun });
  }

  printStep("Initialize launcher config");
  runCommand("npx", ["agent-launch", "init-config"], options);

  printNextCommands({ guidanceFile });
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  runSetup().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`AgentChassis setup failed: ${message}\n`);
    process.exitCode = 1;
  });
}
