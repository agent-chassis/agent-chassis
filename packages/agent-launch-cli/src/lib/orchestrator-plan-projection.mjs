
export function publicOrchestratorPlan(plan, environment) {
  return {
    schema_version: plan.schema_version,
    planner_kind: plan.planner_kind,
    mode: plan.mode,
    role: plan.role,
    subject: plan.subject,
    repo: plan.repo,
    repo_name: plan.repo_name,
    runtime_dir: plan.runtimeDir,

    isolation: plan.isolation,

    headless: plan.headless === true,
    headless_log_target: plan.headlessLogTarget ?? null,
    headless_settings: plan.headlessSettings ?? null,
    thread_name: plan.threadName,
    title: plan.title,
    command: plan.command,
    args: plan.args,
    settings: plan.settings,
    mcp_config_path: plan.mcpConfigPath,
    wiki_mcp_transport: "launcher_named_fifo_stdio",
    env: environment
  };
}

export function writeOrchestratorMcpConfig(plan, buildConfig, relayRegistration = null) {
  const nextConfig = buildConfig({
    repo: plan.repo,
    workspaceAlias: plan.env.WIKI_MCP_WORKSPACE_ALIAS ?? null,
    workspaceDir: plan.env.WIKI_MCP_WORKSPACE_DIR,
    dispatchWorktreeRoot: plan.dispatchWorktreeRoot,
    responseStateDir: plan.env.WIKI_MCP_RESPONSE_STATE_DIR,
    relayRegistration,
    initiative: plan.subject,
    threadName: plan.threadName,
    model: plan.settings?.model ?? null,
    effort: plan.settings?.effort ?? null
  });
  plan.mcpConfig = nextConfig;
  return nextConfig;
}

export function orchestratorSessionDescriptor(plan, schemaVersion) {
  return {
    schema_version: schemaVersion,
    planner_kind: plan.planner_kind,
    mode: plan.mode,
    role: plan.role,
    subject: plan.subject,
    repo: plan.repo,
    repo_name: plan.repo_name,
    runtime_dir: plan.runtimeDir,
    thread_name: plan.threadName,
    title: plan.title,
    command: plan.command,
    args: plan.args,
    settings: plan.settings
  };
}
