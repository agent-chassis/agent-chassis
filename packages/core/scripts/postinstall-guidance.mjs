import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DETECTED_AGENTS = Object.freeze([
  Object.freeze({
    key: "claude",
    label: "Claude",
    command: "claude"
  }),
  Object.freeze({
    key: "codex",
    label: "Codex",
    command: "codex"
  })
]);

function defaultCommandAvailable(command) {
  try {
    const result = spawnSync(command, ["--version"], {
      stdio: "ignore",
      timeout: 1500,
      windowsHide: true
    });

    if (result.error) {
      return result.error.code !== "ENOENT" && result.error.code !== "ETIMEDOUT";
    }
    return true;
  } catch {
    return false;
  }
}

export function detectAvailableAgents({ commandAvailable = defaultCommandAvailable } = {}) {
  const availability = {};
  for (const agent of DETECTED_AGENTS) {
    try {
      availability[agent.key] = commandAvailable(agent.command) === true;
    } catch {
      availability[agent.key] = false;
    }
  }
  return availability;
}

export function renderPostinstallGuidance(availability = {}) {
  const availableAgents = DETECTED_AGENTS.filter((agent) => availability[agent.key] === true);
  const lines = [
    "AgentChassis installed.",
    "Run first-time setup from your consumer repo root:",
    "  npx agent-chassis setup"
  ];

  if (availableAgents.length === 0) {
    lines.push(
      "No supported agent CLI was detected on PATH (checked: claude, codex).",
      "After installing one, rerun setup or pass --agent claude|codex."
    );
    return lines.join("\n");
  }

  lines.push(`Detected agent CLIs: ${availableAgents.map((agent) => agent.label).join(", ")}.`);
  if (availableAgents.length > 1) {
    lines.push("Use --agent claude or --agent codex to choose non-interactively.");
  }
  return lines.join("\n");
}

export function printPostinstallGuidance({
  commandAvailable = defaultCommandAvailable,
  stdout = process.stdout
} = {}) {
  const guidance = renderPostinstallGuidance(detectAvailableAgents({ commandAvailable }));
  stdout.write(`${guidance}\n`);
}

function isDirectInvocation(metaUrl, argvPath) {
  if (typeof argvPath !== "string" || argvPath.length === 0) {
    return false;
  }
  return path.resolve(fileURLToPath(metaUrl)) === path.resolve(argvPath);
}

async function main() {
  printPostinstallGuidance();
}

if (isDirectInvocation(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`AgentChassis postinstall guidance skipped: ${message}\n`);
  });
}
