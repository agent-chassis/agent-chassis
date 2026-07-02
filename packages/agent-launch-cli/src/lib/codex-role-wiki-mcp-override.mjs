

import path from "node:path";
import { realpathSync, statSync } from "node:fs";

import { readCodexConfigText } from "./launch-isolation.mjs";
import {
  CODEX_WIKI_MCP_SERVER_NAME,
  buildWikiMcpServerNodeCommand,
  quoteTomlString
} from "./codex-role-mcp-env.mjs";

export function detectCodexWikiMcpServerPosture({ env, mcpServerName } = {}) {
  const serverName = typeof mcpServerName === "string" && mcpServerName.length > 0
    ? mcpServerName
    : CODEX_WIKI_MCP_SERVER_NAME;
  const configText = readCodexConfigText(env);
  if (typeof configText !== "string" || configText.length === 0) {
    return "absent";
  }
  const scan = scanCodexConfigWikiServerTable(configText, serverName);
  if (scan.hasUrl) return "url";
  if (scan.hasCommand) return "command";
  return "absent";
}

function scanCodexConfigWikiServerTable(configText, serverName) {
  const header = `[mcp_servers.${serverName}]`;
  const result = { present: false, hasCommand: false, hasUrl: false };
  let inSection = false;
  for (const rawLine of String(configText || "").split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (line.length === 0) continue;
    if (line.startsWith("[")) {
      inSection = line === header;
      if (inSection) result.present = true;
      continue;
    }
    if (!inSection) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (key === "command") result.hasCommand = true;
    else if (key === "url") result.hasUrl = true;
  }
  return result;
}

export function buildCodexWikiMcpServerOverrides({ mcpServerName, serverPath, repo = null } = {}) {
  const serverName = typeof mcpServerName === "string" && mcpServerName.length > 0
    ? mcpServerName
    : CODEX_WIKI_MCP_SERVER_NAME;
  const { command, args } = buildWikiMcpServerNodeCommand({ repo, serverPath });
  return [
    `mcp_servers.${serverName}.command=${quoteTomlString(command)}`,
    `mcp_servers.${serverName}.args=${JSON.stringify(args)}`
  ];
}

export function collectCodexSynthesizedWikiMcpReadOnlyRoots(serverPath) {
  const roots = [];
  try {
    const nodeDir = path.dirname(realpathSync(process.execPath));
    if (path.isAbsolute(nodeDir)) roots.push(nodeDir);
  } catch {

  }
  let containerSource = serverPath;
  try {
    containerSource = realpathSync(serverPath);
  } catch {

  }
  const container = findPackageContainerDir(containerSource) ?? path.dirname(containerSource);
  if (typeof container === "string" && path.isAbsolute(container)) {
    roots.push(container);
  }
  return roots;
}

function findPackageContainerDir(filePath) {
  let dir = path.dirname(filePath);
  const root = path.parse(dir).root;
  for (let i = 0; i < 32; i += 1) {
    try {
      if (statSync(path.join(dir, "package.json")).isFile()) return dir;
    } catch {

    }
    if (dir === root) break;
    dir = path.dirname(dir);
  }
  return null;
}

export function rebuildCodexPlanIsolationWithReadOnlyRoot(plan, additionalRoots) {
  const isolation = plan && typeof plan === "object" ? plan.isolation : null;
  if (!isolation || typeof isolation !== "object") return null;
  const additions = Array.isArray(additionalRoots)
    ? additionalRoots.filter((r) => typeof r === "string" && r.length > 0 && path.isAbsolute(r))
    : [];
  if (additions.length === 0) return null;
  const existing = Array.isArray(isolation.read_only_roots)
    ? [...isolation.read_only_roots]
    : [];
  const seen = new Set(existing);
  const merged = [...existing];
  for (const root of additions) {
    if (seen.has(root)) continue;
    seen.add(root);
    merged.push(root);
  }
  if (merged.length === existing.length) return null;
  const originalIsolation = isolation;
  plan.isolation = Object.freeze({
    ...isolation,
    read_only_roots: Object.freeze(merged)
  });
  return originalIsolation;
}
