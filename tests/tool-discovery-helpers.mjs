

export function makeTool(tool_name, overrides = {}) {
  return {
    tool_name,
    display_name: `Fixture ${tool_name}`,
    kind: "cli_command",
    entrypoint: `run ${tool_name}`,
    priority: 10,
    ...overrides
  };
}
