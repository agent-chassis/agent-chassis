

import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";

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
  if (scan.disabled) return "absent";
  if (scan.hasUrl) return "url";
  if (scan.hasCommand) return "command";
  return "absent";
}

function scanCodexConfigWikiServerTable(configText, serverName) {
  const header = `[mcp_servers.${serverName}]`;
  const result = { present: false, disabled: false, hasCommand: false, hasUrl: false };
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
    const value = line.slice(eq + 1).trim();
    if (key === "enabled" && value === "false") result.disabled = true;
    else if (key === "command") result.hasCommand = true;
    else if (key === "url") result.hasUrl = true;
  }
  return result;
}

export function buildCodexWikiMcpServerOverrides({ mcpServerName, serverPath, repo = null } = {}) {
  const serverName = typeof mcpServerName === "string" && mcpServerName.length > 0
    ? mcpServerName
    : CODEX_WIKI_MCP_SERVER_NAME;
  if (typeof serverPath !== "string" || !path.isAbsolute(serverPath)) {
    throw new Error("Codex wiki MCP overrides require an absolute installed server module path");
  }
  const { command, args } = buildWikiMcpServerNodeCommand({ repo, serverPath });
  return [
    `mcp_servers.${serverName}.enabled=true`,
    `mcp_servers.${serverName}.command=${quoteTomlString(command)}`,
    `mcp_servers.${serverName}.args=${JSON.stringify(args)}`
  ];
}

function resolveNodeInterpreterDirRoot() {
  try {
    const nodeDir = path.dirname(realpathSync(process.execPath));
    return path.isAbsolute(nodeDir) ? nodeDir : null;
  } catch {
    return null;
  }
}

export function collectCodexSynthesizedWikiMcpReadOnlyRoots(serverPath) {
  const roots = [];
  const nodeDir = resolveNodeInterpreterDirRoot();
  if (nodeDir) roots.push(nodeDir);
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

export const MANAGED_WORKER_WIKI_MCP_CLOSURE_PACKAGES = Object.freeze([
  "@agent-chassis/wiki-mcp",
  "@agent-chassis/wiki-core",
  "@agent-chassis/agent-launch-cli",
  "@agent-chassis/agent-launch-core"
]);

const requireFromWikiMcpOverride = createRequire(import.meta.url);

function closureFailClosed(message) {
  return new Error(`DEC-0160 managed-worker wiki-MCP runtime closure fail-closed: ${message}`);
}

function readPackageJsonName(dir) {
  try {
    return JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"))?.name ?? null;
  } catch {
    return null;
  }
}

function findNamedPackageDir(filePath, packageName) {
  let dir = path.dirname(filePath);
  const root = path.parse(dir).root;
  for (let i = 0; i < 40; i += 1) {
    if (readPackageJsonName(dir) === packageName) return dir;
    if (dir === root) break;
    dir = path.dirname(dir);
  }
  return null;
}

function resolveClosurePackageDir(packageName) {
  for (const spec of [`${packageName}/package.json`, packageName]) {
    let resolvedReal;
    try {
      resolvedReal = realpathSync(requireFromWikiMcpOverride.resolve(spec));
    } catch {
      continue;
    }
    const dir = spec.endsWith("/package.json")
      ? path.dirname(resolvedReal)
      : findNamedPackageDir(resolvedReal, packageName);
    if (dir && readPackageJsonName(dir) === packageName) return dir;
  }
  throw closureFailClosed(`cannot resolve import-graph package ${packageName}`);
}

function listTrackedPackageFiles(gitRoot, packageDir) {
  const relDir = path.relative(gitRoot, packageDir);
  let stdout;
  try {
    stdout = execFileSync("git", ["-C", gitRoot, "ls-files", "-z", "--", relDir], {
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024
    });
  } catch (error) {
    throw closureFailClosed(`git ls-files failed for ${relDir}: ${error?.message ?? error}`);
  }
  const files = [];
  for (const rel of stdout.toString("utf8").split("\0")) {
    if (rel.length === 0) continue;
    const abs = path.join(gitRoot, rel);
    try {
      if (lstatSync(abs).isFile()) files.push(abs);
    } catch {

    }
  }
  if (files.length === 0) {
    throw closureFailClosed(`no tracked files resolved for ${relDir}`);
  }
  return files;
}

export function collectManagedWorkerWikiMcpRuntimeClosureRoots(serverPath) {
  if (typeof serverPath !== "string" || !path.isAbsolute(serverPath)) {
    throw closureFailClosed("requires an absolute installed wiki-MCP server module path");
  }
  const roots = [];
  const seen = new Set();
  const add = (root) => {
    if (typeof root === "string" && root.length > 0 && path.isAbsolute(root) && !seen.has(root)) {
      seen.add(root);
      roots.push(root);
    }
  };

  const nodeDir = resolveNodeInterpreterDirRoot();
  if (!nodeDir) {
    throw closureFailClosed("cannot resolve the node interpreter directory");
  }
  add(nodeDir);

  let serverReal;
  try {
    serverReal = realpathSync(serverPath);
  } catch {
    throw closureFailClosed(`wiki-MCP server module path does not resolve: ${serverPath}`);
  }
  const wikiMcpPackageDir = findPackageContainerDir(serverReal);
  if (!wikiMcpPackageDir) {
    throw closureFailClosed("cannot resolve the wiki-MCP package directory");
  }
  const packagesDir = path.dirname(wikiMcpPackageDir);
  const repositoryRoot = path.dirname(packagesDir);
  if (path.basename(packagesDir) !== "packages") {
    throw closureFailClosed(
      `wiki-MCP package is not under a workspace 'packages' directory: ${wikiMcpPackageDir}`
    );
  }

  const nodeModulesDir = path.join(repositoryRoot, "node_modules");
  try {
    if (!statSync(nodeModulesDir).isDirectory()) throw new Error("not a directory");
  } catch {
    throw closureFailClosed(`repository-root node_modules is missing: ${nodeModulesDir}`);
  }
  add(nodeModulesDir);

  for (const packageName of MANAGED_WORKER_WIKI_MCP_CLOSURE_PACKAGES) {
    const packageDir = resolveClosurePackageDir(packageName);
    const relToRoot = path.relative(repositoryRoot, packageDir);
    if (relToRoot === "" || relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
      throw closureFailClosed(
        `import-graph package ${packageName} resolves outside the repository root: ${packageDir}`
      );
    }
    for (const trackedFile of listTrackedPackageFiles(repositoryRoot, packageDir)) {
      add(trackedFile);
    }
  }

  return roots;
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
