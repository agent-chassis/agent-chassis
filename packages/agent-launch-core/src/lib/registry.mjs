import { readFile } from "node:fs/promises";

import {
  ensureLauncherConfigDir,
  getLauncherRegistryPath,
  resolveLauncherRegistryPath
} from "./config.mjs";
import { fileExists, sha256, writeJsonAtomic } from "./filesystem.mjs";

const INSTRUCTION_TRANSPORTS = new Set(["argv_path", "argv_content", "stdin"]);
const RESPONSE_TRANSPORTS = new Set(["file", "stdout_capture"]);

const FILESYSTEM_MCP_BACKEND_MODES = new Set(["advisory", "enforced"]);
const FILESYSTEM_MCP_ENDPOINT_KINDS = new Set(["spawn", "unix_socket"]);
const FILESYSTEM_MCP_HANDSHAKE_SOURCE_KINDS = new Set([
  "spawn_stdout",
  "unix_socket_reply"
]);
const FILESYSTEM_MCP_AGENT_FAMILIES = new Set(["claude", "codex", "gemini"]);
const FILESYSTEM_MCP_PROFILE_ROLES = new Set([
  "worker",
  "code_review",
  "redteam"
]);
const ENDPOINT_TO_HANDSHAKE_SOURCE = new Map([
  ["spawn", "spawn_stdout"],
  ["unix_socket", "unix_socket_reply"]
]);

const DEFAULT_FILESYSTEM_MCP_BACKEND_KEY = "default";

// The default registry endpoint argv intentionally names the repo-owned
// `agent-launch-filesystem-mcp-backend` executable shipped under
// `packages/agent-launch-cli/bin/`. The endpoint speaks the documented
// `spawn_stdout` handshake protocol and reports `status: "unavailable"`
// until an operator registers an enforced backend (see WK-0424 / IN-0015).
// Exported so consumers and tests can pin the repo-owned default without
// coupling to a literal.
export const DEFAULT_FILESYSTEM_MCP_BACKEND_ENDPOINT_COMMAND =
  "agent-launch-filesystem-mcp-backend";

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
            "Edit Write NotebookEdit Bash"
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
    },
    filesystem_mcp_backend_default: DEFAULT_FILESYSTEM_MCP_BACKEND_KEY,
    filesystem_mcp_backends: {
      [DEFAULT_FILESYSTEM_MCP_BACKEND_KEY]: {
        backend_id: "agent-launch.filesystem-mcp.default",
        backend_version: "0.1.0-advisory",
        mode: "advisory",
        endpoint: {
          kind: "spawn",
          argv: [DEFAULT_FILESYSTEM_MCP_BACKEND_ENDPOINT_COMMAND]
        },
        supported_profiles: [
          {
            agent_family: "claude",
            profile: "filesystem-mcp-default",
            roles: ["worker", "code_review", "redteam"]
          },
          {
            agent_family: "codex",
            profile: "filesystem-mcp-default",
            roles: ["worker", "code_review", "redteam"]
          },
          {
            agent_family: "gemini",
            profile: "filesystem-mcp-default",
            roles: ["worker", "code_review", "redteam"]
          }
        ],
        handshake_source: { kind: "spawn_stdout" }
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

// `loadRegistry` itself is path-driven and does not pick an authority source on
// its own. Worker-family `agent-role` callers must resolve the path through
// `resolveWorkerFamilyLauncherRegistryPath` before invoking this helper so
// `--operator-config` cannot redirect the loaded registry. Both that helper and
// the operator-only `resolveLauncherRegistryPath` now resolve to the
// workspace-local `<workspace>/.agent-launch` root rather than a machine-global
// `HOME`/`XDG` location, so launcher state survives launcher/session restarts
// and ambient env cannot redirect authority.
export async function loadRegistry({ registryPath: overridePath } = {}) {
  const registryPath = resolveLauncherRegistryPath(overridePath);
  if (!(await fileExists(registryPath))) {
    throw new Error(`Launcher registry not found at ${registryPath}. Run "agent-launch init-config" first.`);
  }
  const raw = await readFile(registryPath, "utf8");
  const parsed = JSON.parse(raw);
  if (parsed.schema_version !== 1) {
    throw new Error("Unsupported launcher registry schema_version");
  }
  validateFilesystemMcpBackends(parsed);
  return {
    path: registryPath,
    hash: sha256(raw),
    data: parsed
  };
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

export function resolveFilesystemMcpBackend(registry, { key } = {}) {
  const backends = registry.data?.filesystem_mcp_backends;
  if (!backends || typeof backends !== "object" || Object.keys(backends).length === 0) {
    throw new Error("Launcher registry has no filesystem_mcp_backends configured");
  }
  const resolvedKey = key ?? registry.data?.filesystem_mcp_backend_default;
  if (typeof resolvedKey !== "string" || resolvedKey.length === 0) {
    throw new Error("Launcher registry filesystem_mcp_backend_default is missing or invalid");
  }
  const entry = backends[resolvedKey];
  if (!entry) {
    throw new Error(`Launcher registry filesystem_mcp_backends has no entry for ${resolvedKey}`);
  }
  return { key: resolvedKey, entry };
}

function validateFilesystemMcpBackends(parsed) {
  const defaultKey = parsed.filesystem_mcp_backend_default;
  const backends = parsed.filesystem_mcp_backends;
  const hasDefault = Object.prototype.hasOwnProperty.call(parsed, "filesystem_mcp_backend_default");
  const hasBackends = Object.prototype.hasOwnProperty.call(parsed, "filesystem_mcp_backends");
  if (!hasDefault && !hasBackends) {
    return;
  }
  if (!hasBackends || backends === null || typeof backends !== "object" || Array.isArray(backends)) {
    throw new Error("Launcher registry filesystem_mcp_backends must be an object map");
  }
  const keys = Object.keys(backends);
  if (keys.length === 0) {
    throw new Error("Launcher registry filesystem_mcp_backends must declare at least one entry");
  }
  for (const key of keys) {
    validateFilesystemMcpBackendEntry(key, backends[key]);
  }
  if (typeof defaultKey !== "string" || defaultKey.length === 0) {
    throw new Error("Launcher registry filesystem_mcp_backend_default must be a non-empty string");
  }
  if (!Object.prototype.hasOwnProperty.call(backends, defaultKey)) {
    throw new Error(`Launcher registry filesystem_mcp_backend_default references unknown backend ${defaultKey}`);
  }
}

function validateFilesystemMcpBackendEntry(key, entry) {
  const where = `filesystem_mcp_backends.${key}`;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`${where} must be an object`);
  }
  if (typeof entry.backend_id !== "string" || entry.backend_id.length === 0) {
    throw new Error(`${where}.backend_id must be a non-empty string`);
  }
  if (typeof entry.backend_version !== "string" || entry.backend_version.length === 0) {
    throw new Error(`${where}.backend_version must be a non-empty string`);
  }
  if (!FILESYSTEM_MCP_BACKEND_MODES.has(entry.mode)) {
    throw new Error(`${where}.mode must be one of: ${[...FILESYSTEM_MCP_BACKEND_MODES].join(", ")}`);
  }
  validateFilesystemMcpEndpoint(`${where}.endpoint`, entry.endpoint);
  validateFilesystemMcpSupportedProfiles(`${where}.supported_profiles`, entry.supported_profiles);
  validateFilesystemMcpHandshakeSource(
    `${where}.handshake_source`,
    entry.handshake_source,
    entry.endpoint?.kind
  );
}

function validateFilesystemMcpEndpoint(where, endpoint) {
  if (!endpoint || typeof endpoint !== "object" || Array.isArray(endpoint)) {
    throw new Error(`${where} must be an object`);
  }
  if (!FILESYSTEM_MCP_ENDPOINT_KINDS.has(endpoint.kind)) {
    throw new Error(`${where}.kind must be one of: ${[...FILESYSTEM_MCP_ENDPOINT_KINDS].join(", ")}`);
  }
  if (endpoint.kind === "spawn") {
    if (!Array.isArray(endpoint.argv) || endpoint.argv.length === 0) {
      throw new Error(`${where}.argv must be a non-empty array for spawn endpoints`);
    }
    for (const arg of endpoint.argv) {
      if (typeof arg !== "string" || arg.length === 0) {
        throw new Error(`${where}.argv entries must be non-empty strings`);
      }
    }
  } else if (endpoint.kind === "unix_socket") {
    if (typeof endpoint.path !== "string" || endpoint.path.length === 0) {
      throw new Error(`${where}.path must be a non-empty string for unix_socket endpoints`);
    }
  }
}

function validateFilesystemMcpSupportedProfiles(where, supportedProfiles) {
  if (!Array.isArray(supportedProfiles) || supportedProfiles.length === 0) {
    throw new Error(`${where} must be a non-empty array`);
  }
  const seen = new Set();
  for (let index = 0; index < supportedProfiles.length; index += 1) {
    const row = supportedProfiles[index];
    const rowWhere = `${where}[${index}]`;
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`${rowWhere} must be an object`);
    }
    if (!FILESYSTEM_MCP_AGENT_FAMILIES.has(row.agent_family)) {
      throw new Error(
        `${rowWhere}.agent_family must be one of: ${[...FILESYSTEM_MCP_AGENT_FAMILIES].join(", ")}`
      );
    }
    if (typeof row.profile !== "string" || row.profile.length === 0) {
      throw new Error(`${rowWhere}.profile must be a non-empty string`);
    }
    if (!Array.isArray(row.roles) || row.roles.length === 0) {
      throw new Error(`${rowWhere}.roles must be a non-empty array`);
    }
    const roleSet = new Set();
    for (const role of row.roles) {
      if (!FILESYSTEM_MCP_PROFILE_ROLES.has(role)) {
        throw new Error(
          `${rowWhere}.roles entries must be one of: ${[...FILESYSTEM_MCP_PROFILE_ROLES].join(", ")}`
        );
      }
      if (roleSet.has(role)) {
        throw new Error(`${rowWhere}.roles must be unique`);
      }
      roleSet.add(role);
    }
    const dedupKey = `${row.agent_family} ${row.profile}`;
    if (seen.has(dedupKey)) {
      throw new Error(`${where} has duplicate (agent_family, profile) tuple for ${row.agent_family}/${row.profile}`);
    }
    seen.add(dedupKey);
  }
}

function validateFilesystemMcpHandshakeSource(where, handshakeSource, endpointKind) {
  if (!handshakeSource || typeof handshakeSource !== "object" || Array.isArray(handshakeSource)) {
    throw new Error(`${where} must be an object`);
  }
  if (!FILESYSTEM_MCP_HANDSHAKE_SOURCE_KINDS.has(handshakeSource.kind)) {
    throw new Error(
      `${where}.kind must be one of: ${[...FILESYSTEM_MCP_HANDSHAKE_SOURCE_KINDS].join(", ")}`
    );
  }
  const expected = ENDPOINT_TO_HANDSHAKE_SOURCE.get(endpointKind);
  if (expected && handshakeSource.kind !== expected) {
    throw new Error(
      `${where}.kind ${handshakeSource.kind} is not compatible with endpoint.kind ${endpointKind}`
    );
  }
}
