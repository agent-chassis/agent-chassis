import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

import {
  buildCodexWikiMcpServerOverrides
} from "../packages/agent-launch-cli/src/lib/codex-role-wiki-mcp-override.mjs";
import {
  buildCodexWorkerWikiMcpEnvOverrides,
  buildCodexWorkspaceMcpEnvOverrides,
  CODEX_WIKI_MCP_SERVER_NAME,
  injectCodexConfigOverridesBeforeFinalPositional,
  WIKI_MCP_AGENT_SAFE_TOOL_PROFILE,
  WIKI_MCP_ASSIGNED_UNIT_ENV_VAR,
  WIKI_MCP_TOOL_PROFILE_ENV_VAR,
  WIKI_MCP_WORKER_TOOL_PROFILE,
  WIKI_MCP_WORKSPACE_ALIAS_ENV_VAR,
  WIKI_MCP_WORKSPACE_DIR_ENV_VAR
} from "../packages/agent-launch-cli/src/lib/codex-role-mcp-env.mjs";

function parseOverride(override) {
  const eq = override.indexOf("=");
  assert.notEqual(eq, -1, `override must contain '=': ${override}`);
  return [override.slice(0, eq), override.slice(eq + 1)];
}

function collectCodexConfigOverrides(args) {
  const overrides = [];
  for (let i = 0; i < args.length - 1; i += 1) {
    if (args[i] !== "-c") continue;
    overrides.push(args[i + 1]);
    i += 1;
  }
  return overrides;
}

test("Codex worker wiki MCP env overrides pin launcher-owned worker profile and assigned unit", () => {
  assert.equal(CODEX_WIKI_MCP_SERVER_NAME, "wiki");
  assert.equal(WIKI_MCP_TOOL_PROFILE_ENV_VAR, "WIKI_MCP_TOOL_PROFILE");
  assert.equal(WIKI_MCP_AGENT_SAFE_TOOL_PROFILE, "agent-safe");
  assert.equal(WIKI_MCP_WORKER_TOOL_PROFILE, "worker");

  const overrides = buildCodexWorkerWikiMcpEnvOverrides({
    assignedUnit: "WK-1393#SLICE-015"
  });

  assert.deepEqual(overrides, [
    'mcp_servers.wiki.env.WIKI_MCP_TOOL_PROFILE="worker"',
    'mcp_servers.wiki.env.WIKI_MCP_ASSIGNED_UNIT="WK-1393#SLICE-015"'
  ]);
  assert.ok(
    overrides.every((override) => !override.includes("agent-safe")),
    "launcher-assigned worker sessions must use the restricted worker MCP tool profile"
  );
  assert.throws(
    () => buildCodexWorkerWikiMcpEnvOverrides({ assignedUnit: "" }),
    /launcher-assigned unit/
  );
});

test("Codex workspace MCP env overrides carry canonical repo alias/root facts with agent-safe profile", () => {
  const workspaceDir = path.join(os.tmpdir(), "agent-chassis-wk-1393");
  const overrides = buildCodexWorkspaceMcpEnvOverrides({
    workspaceAlias: "agent-chassis",
    workspaceDir
  });

  assert.deepEqual(overrides, [
    `mcp_servers.wiki.env.${WIKI_MCP_WORKSPACE_ALIAS_ENV_VAR}="agent-chassis"`,
    `mcp_servers.wiki.env.${WIKI_MCP_WORKSPACE_DIR_ENV_VAR}=${JSON.stringify(workspaceDir)}`,
    `mcp_servers.wiki.env.${WIKI_MCP_TOOL_PROFILE_ENV_VAR}="agent-safe"`
  ]);
});

test("Codex wiki MCP server overrides use an installed local node module path, not npx", () => {
  const serverPath = path.join(
    os.tmpdir(),
    "agent-chassis-installed",
    "node_modules",
    "@agent-chassis",
    "wiki-mcp",
    "src",
    "server.mjs"
  );
  const overrides = buildCodexWikiMcpServerOverrides({
    serverPath,
    repo: path.join(os.tmpdir(), "agent-chassis")
  });
  const entries = Object.fromEntries(overrides.map(parseOverride));

  assert.equal(entries["mcp_servers.wiki.command"], '"node"');
  assert.deepEqual(
    JSON.parse(entries["mcp_servers.wiki.args"]),
    [serverPath]
  );
  assert.ok(
    overrides.every((override) => !/\bnpx\b/.test(override)),
    `wiki MCP runtime overrides must not use npx: ${JSON.stringify(overrides)}`
  );
});

test("Codex MCP overrides are per-run CLI config arguments and expose no persistent config surface", () => {
  const serverPath = path.join(
    os.tmpdir(),
    "codex-mcp-overrides",
    "node_modules",
    "@agent-chassis",
    "wiki-mcp",
    "src",
    "server.mjs"
  );
  const baseArgs = [
    "--disable",
    "shell_snapshot",
    "-C",
    "/repo",
    "-p",
    "worker",
    "exec",
    "--ignore-rules",
    "final prompt"
  ];
  const args = [...baseArgs];
  const overrides = [
    ...buildCodexWikiMcpServerOverrides({
      serverPath,
      repo: "/repo"
    }),
    ...buildCodexWorkspaceMcpEnvOverrides({
      workspaceAlias: "agent-chassis",
      workspaceDir: "/repo"
    }),
    ...buildCodexWorkerWikiMcpEnvOverrides({
      assignedUnit: "WK-1393#SLICE-015"
    })
  ];
  const expectedInjectedArgs = overrides.flatMap((override) => ["-c", override]);

  injectCodexConfigOverridesBeforeFinalPositional(args, overrides);

  assert.deepEqual(args, [
    ...baseArgs.slice(0, -1),
    ...expectedInjectedArgs,
    baseArgs.at(-1)
  ]);
  assert.deepEqual(collectCodexConfigOverrides(args), overrides);
  assert.equal(args.at(-1), "final prompt");
  assert.equal(
    args.filter((arg) => arg === "-c").length,
    overrides.length,
    "each Codex MCP setting must be emitted only as a per-run -c override"
  );
  assert.deepEqual(overrides.map((override) => parseOverride(override)[0]), [
    "mcp_servers.wiki.enabled",
    "mcp_servers.wiki.command",
    "mcp_servers.wiki.args",
    "mcp_servers.wiki.env.WIKI_MCP_WORKSPACE_ALIAS",
    "mcp_servers.wiki.env.WIKI_MCP_WORKSPACE_DIR",
    "mcp_servers.wiki.env.WIKI_MCP_TOOL_PROFILE",
    "mcp_servers.wiki.env.WIKI_MCP_TOOL_PROFILE",
    "mcp_servers.wiki.env.WIKI_MCP_ASSIGNED_UNIT"
  ]);
  assert.ok(
    overrides.every((override) => parseOverride(override)[0].startsWith("mcp_servers.")),
    `per-run Codex overrides must only target mcp_servers.* keys: ${JSON.stringify(overrides)}`
  );
  assert.ok(
    collectCodexConfigOverrides(args).includes("mcp_servers.wiki.enabled=true"),
    "per-run CLI overrides must explicitly enable the launcher-managed wiki MCP server"
  );
  assert.ok(
    args.every((arg) => !/(?:^|[_.-])config(?:[_.-]|$)|\.codex|toml/i.test(arg)),
    `per-run Codex argv must not expose a persistent config-file path or flag: ${JSON.stringify(args)}`
  );
  assert.ok(
    args.includes('mcp_servers.wiki.env.WIKI_MCP_TOOL_PROFILE="agent-safe"'),
    "per-run CLI overrides must pin WIKI_MCP_TOOL_PROFILE=agent-safe"
  );
  assert.ok(
    args.every((arg) => !/\bnpx\b/.test(arg)),
    `per-run Codex argv must not use an npx wiki MCP runtime path: ${JSON.stringify(args)}`
  );
});
