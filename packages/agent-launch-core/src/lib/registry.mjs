import { readFile } from "node:fs/promises";

import {
  ensureLauncherConfigDir,
  getLauncherRegistryPath,
  resolveLauncherRegistryPath
} from "./config.mjs";
import { fileExists, sha256, writeJsonAtomic } from "./filesystem.mjs";

const INSTRUCTION_TRANSPORTS = new Set(["argv_path", "argv_content", "stdin"]);
const RESPONSE_TRANSPORTS = new Set(["file", "stdout_capture"]);

export function createDefaultRegistry() {
  return {
    schema_version: 1,
    agents: {
      claude: {
        base_argv: ["claude"],
        noninteractive_argv: ["--print", "--output-format", "text", "--no-session-persistence"],
        instruction_transport: { kind: "argv_content" },
        wrapper_arg: ["{wrapper_content}"],
        response_transport: { kind: "stdout_capture" },
        timeout_seconds: 1800,
        read_only: {
          supported: true,
          argv_suffix: [
            "--permission-mode",
            "default",
            "--disallowedTools",
            "Edit Write NotebookEdit"
          ],
          response_writable: true
        }
      },
      codex: {
        base_argv: ["codex", "exec"],
        noninteractive_argv: [],
        instruction_transport: { kind: "argv_content" },
        wrapper_arg: ["{wrapper_content}"],
        response_transport: { kind: "file" },
        response_arg: ["-o", "{response_path}"],
        timeout_seconds: 1800,
        read_only: {
          supported: true,
          argv_suffix: ["--sandbox", "read-only"],
          response_writable: true
        }
      }
    }
  };
}

export async function initializeDefaultRegistry({ force = false, workspaceDir } = {}) {
  await ensureLauncherConfigDir(workspaceDir);
  const registryPath = getLauncherRegistryPath(workspaceDir);
  if (!force && await fileExists(registryPath)) {
    throw new Error(`Launcher registry already exists at ${registryPath}`);
  }
  const registry = createDefaultRegistry();
  await writeJsonAtomic(registryPath, registry);
  return registryPath;
}

export async function loadRegistry({ registryPath: overridePath, workspaceDir } = {}) {
  const registryPath = resolveLauncherRegistryPath(overridePath, { workspaceDir });
  if (!(await fileExists(registryPath))) {
    throw new Error(`Launcher registry not found at ${registryPath}. Run "agent-launch init-config" first.`);
  }
  const raw = await readFile(registryPath, "utf8");
  const parsed = JSON.parse(raw);
  if (parsed.schema_version !== 1) {
    throw new Error("Unsupported launcher registry schema_version");
  }
  return {
    path: registryPath,
    hash: sha256(raw),
    data: parsed
  };
}

export const AGENT_EXECUTABLE_TOKEN_INVALID_REASON = "agent_executable_token_invalid";

export function resolveAgentExecutable(agentConfig, agentName) {
  const token = agentConfig?.base_argv?.[0];
  if (typeof token !== "string" || token.trim().length === 0) {
    const error = new Error(
      `Agent ${agentName} base_argv[0] must be a non-blank executable string; `
        + `got ${token === undefined ? "undefined" : JSON.stringify(token)}. `
        + `Set agents.${agentName}.base_argv[0] in the launcher registry.`
    );
    error.code = AGENT_EXECUTABLE_TOKEN_INVALID_REASON;
    error.detail = {
      agent: agentName,
      configuration_key: `agents.${agentName}.base_argv[0]`,
      received_type: token === null ? "null" : typeof token,
      operator_recovery:
        `set agents.${agentName}.base_argv[0] to the executable to launch `
        + "(a bare basename resolved on the launcher-trusted PATH, or an absolute path)"
    };
    throw error;
  }
  return {
    executable: token,
    leadingArgs: Object.freeze(agentConfig.base_argv.slice(1).map((value) => String(value)))
  };
}

export async function resolveConfiguredAgentExecutable({
  agentName,
  mode = null,
  registryPath = null,
  workspaceDir = undefined
} = {}) {
  const registry = await loadRegistry({ registryPath, workspaceDir });
  const agentConfig = resolveAgentConfig(registry, agentName, mode);
  const { executable, leadingArgs } = resolveAgentExecutable(agentConfig, agentName);
  return { executable, leadingArgs, registryPath: registry.path, agentConfig };
}

export function resolveAgentConfig(registry, agentName, mode) {
  const agent = registry.data?.agents?.[agentName];
  if (!agent) {
    throw new Error(`Unknown agent in launcher registry: ${agentName}`);
  }
  if (!Array.isArray(agent.base_argv) || agent.base_argv.length === 0) {
    throw new Error(`Agent ${agentName} must declare base_argv`);
  }
  if (!Array.isArray(agent.noninteractive_argv)) {
    throw new Error(`Agent ${agentName} must declare noninteractive_argv`);
  }
  if (!INSTRUCTION_TRANSPORTS.has(agent.instruction_transport?.kind)) {
    throw new Error(`Agent ${agentName} must declare a supported instruction_transport`);
  }
  if (agent.instruction_transport.kind !== "stdin" && !Array.isArray(agent.wrapper_arg)) {
    throw new Error(`Agent ${agentName} must declare wrapper_arg for ${agent.instruction_transport.kind}`);
  }
  if (!RESPONSE_TRANSPORTS.has(agent.response_transport?.kind)) {
    throw new Error(`Agent ${agentName} must declare a supported response_transport`);
  }
  if (agent.response_transport.kind === "file" && !Array.isArray(agent.response_arg)) {
    throw new Error(`Agent ${agentName} must declare response_arg for file transport`);
  }
  if (mode === "redteam" || mode === "code_review") {
    if (!agent.read_only?.supported || !Array.isArray(agent.read_only?.argv_suffix) || agent.read_only.argv_suffix.length === 0 || agent.read_only.response_writable !== true) {
      throw new Error(`Agent ${agentName} does not satisfy ${mode} read-only requirements`);
    }
  }
  return agent;
}
