
export const SETUP_AGENTS = Object.freeze([
  Object.freeze({ key: "claude", label: "Claude", command: "claude", template: "agent-launch.claude.toml" }),
  Object.freeze({ key: "codex", label: "Codex", command: "codex", template: "agent-launch.codex.toml" }),
  Object.freeze({ key: "opencode", label: "OpenCode", command: "opencode", template: "agent-launch.opencode.toml",
    prerequisites: "Install rg (ripgrep) on PATH and configure direct Vertex authentication: " +
      "set GOOGLE_APPLICATION_CREDENTIALS in the launch environment to an existing service-account JSON file with project_id. " +
      "TOML credentials_file alone does not configure this route. " +
      "Schema-constrained workers remain unsupported (opencode_native_schema_unavailable); " +
      "setup does not enable complete paid-CCE worker support." }),
  Object.freeze({ key: "agy", label: "Agy", command: "agy", template: "agent-launch.agy.toml",
    prerequisites: "Install and authenticate the native agy CLI before launching." })
]);

export function setupAgentChoices() {
  return SETUP_AGENTS.map(agent => agent.key).join("|");
}

export function setupAgentCommands(agents = SETUP_AGENTS) {
  return agents.map(agent => `--agent ${agent.key}`).join(" or ");
}
