

import { spawn } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveWikiMcpHostServerBinding } from "./wiki-mcp-host-server.mjs";
import { resolveLauncherRoleToolNamesForEnv } from "./launcher-role-tool-profile.mjs";
import { createStdioMcpConduitWithTrustedDependencies } from "./stdio-mcp-conduit-core.mjs";
import {
  STDIO_MCP_CLIENT_READINESS_TIMEOUT_MS,
  STDIO_MCP_CONDUIT_ERROR_CODES,
  STDIO_MCP_SERVER_STARTUP_TIMEOUT_MS,
  assertTrustedStdioMcpConduitBinding,
  createStdioMcpChannelRelayRegistration,
  failStdioMcpConduit as fail,
  projectStdioMcpChannelClientRegistration
} from "./stdio-mcp-conduit-contract.mjs";
import {
  bootstrapNodeEngineEnvFromFile,
  resolveNodeEngineEnvFilePath
} from "@agent-chassis/wiki-core/src/lib/node-engine-env-bootstrap.mjs";

export * from "./stdio-mcp-conduit-contract.mjs";

const CONDUIT_DIRECTORY_PREFIX = "agent-launch-wiki-mcp-";

const LAUNCHER_RUNTIME_ROOT = "/run/user";

function launcherUid() {
  return typeof process.getuid === "function" ? process.getuid() : null;
}

export function isOwnedPrivateDirectory(candidate, uid = launcherUid()) {
  if (uid === null) return false;
  let stats;
  try {
    stats = lstatSync(candidate);
  } catch {
    return false;
  }
  return stats.isDirectory() && !stats.isSymbolicLink() && stats.uid === uid &&
    (stats.mode & 0o777) === 0o700;
}

function isOwnedAncestorDirectory(candidate, uid = launcherUid()) {
  if (uid === null) return false;
  let stats;
  try {
    stats = lstatSync(candidate);
  } catch {
    return false;
  }
  return stats.isDirectory() && !stats.isSymbolicLink() && stats.uid === uid &&
    (stats.mode & 0o022) === 0;
}

function isInsideGitCheckout(candidate) {
  let current = path.resolve(candidate);
  for (;;) {
    try {
      lstatSync(path.join(current, ".git"));
      return true;
    } catch {   }
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

export function resolveLauncherPrivateConduitRootFrom({
  uid = launcherUid(),
  runtimeRoot = null,
  passwdHome = null,
  workspaceDir = null
} = {}) {
  const candidates = [];
  if (uid !== null && typeof runtimeRoot === "string" && path.isAbsolute(runtimeRoot)) {
    candidates.push(path.join(runtimeRoot, String(uid), "agent-launch"));
  }
  if (typeof passwdHome === "string" && path.isAbsolute(passwdHome)) {
    candidates.push(path.join(passwdHome, ".cache", "agent-launch", "wiki-mcp-conduit"));
  }
  const rejected = [];
  const workspace = typeof workspaceDir === "string" && path.isAbsolute(workspaceDir)
    ? path.resolve(workspaceDir)
    : null;
  for (const candidate of candidates) {

    if (workspace !== null &&
        (candidate === workspace || candidate.startsWith(`${workspace}${path.sep}`))) {
      rejected.push({ candidate, reason: "inside_workspace" });
      continue;
    }
    if (isInsideGitCheckout(candidate)) {
      rejected.push({ candidate, reason: "inside_git_checkout" });
      continue;
    }

    let ancestor = candidate;
    while (ancestor !== path.dirname(ancestor) && !isOwnedAncestorDirectory(ancestor, uid)) {
      ancestor = path.dirname(ancestor);
    }
    if (!isOwnedAncestorDirectory(ancestor, uid)) {
      rejected.push({ candidate, reason: "no_owned_ancestor" });
      continue;
    }
    try {
      mkdirSync(candidate, { recursive: true, mode: 0o700 });
    } catch (error) {
      if (error?.code !== "EEXIST") {
        rejected.push({ candidate, reason: "create_failed", code: error?.code ?? null });
        continue;
      }
    }
    if (isOwnedPrivateDirectory(candidate, uid)) return candidate;
    rejected.push({ candidate, reason: "not_owner_private" });
  }
  fail(STDIO_MCP_CONDUIT_ERROR_CODES.ROOT_UNAVAILABLE,
    "launcher could not resolve a private per-user conduit root",
    { candidates, rejected });
}

export function resolveLauncherPrivateConduitRoot({ workspaceDir = null } = {}) {
  let passwdHome = null;
  try {
    passwdHome = os.userInfo().homedir;
  } catch {
    passwdHome = null;
  }
  return resolveLauncherPrivateConduitRootFrom({
    uid: launcherUid(),
    runtimeRoot: LAUNCHER_RUNTIME_ROOT,
    passwdHome,
    workspaceDir
  });
}

function makeLauncherPrivateDirectory(workspaceDir = null) {
  const root = resolveLauncherPrivateConduitRoot({ workspaceDir });
  const directory = mkdtempSync(path.join(root, CONDUIT_DIRECTORY_PREFIX));

  chmodSync(directory, 0o700);
  return directory;
}

export function resolveTrustedStdioMcpConduitDependencies({ workspaceDir = null } = {}) {
  const hostServerBinding = resolveWikiMcpHostServerBinding();
  return Object.freeze({

    serverPath: hostServerBinding.entrypoint,
    execPath: process.execPath,
    spawnServer: spawn,
    makePrivateDirectory: () => makeLauncherPrivateDirectory(workspaceDir),
    resolveRoleToolNames: resolveLauncherRoleToolNamesForEnv,
    bootstrapNodeEngineEnv: (env, workspaceDir) => bootstrapNodeEngineEnvFromFile({
      env,
      envFilePath: resolveNodeEngineEnvFilePath(workspaceDir)
    }),
    serverStartupTimeoutMs: STDIO_MCP_SERVER_STARTUP_TIMEOUT_MS,
    clientReadinessTimeoutMs: STDIO_MCP_CLIENT_READINESS_TIMEOUT_MS
  });
}

export async function createStdioMcpConduit(input = {}) {
  return createStdioMcpConduitWithTrustedDependencies(
    input,
    resolveTrustedStdioMcpConduitDependencies({
      workspaceDir: typeof input?.workspaceDir === "string" ? input.workspaceDir : null
    })
  );
}

export function createStdioMcpRelayRegistration() {
  return createStdioMcpChannelRelayRegistration();
}

function assertClaudeConduitBinding(binding) {
  assertTrustedStdioMcpConduitBinding(binding);
  if (binding.family !== "claude") {
    fail(STDIO_MCP_CONDUIT_ERROR_CODES.FIFO_IDENTITY_MISMATCH,
      "Claude registration requires its exact launcher-minted Claude conduit binding");
  }
  return binding;
}

export function buildClaudeStdioMcpAllowedToolsArgs(binding, toolNames = [], nativeToolNames = []) {
  assertClaudeConduitBinding(binding);
  const mcpAllowed = [...new Set(toolNames)]
    .filter((name) => typeof name === "string" && /^[a-z0-9_]+$/u.test(name))
    .sort()
    .map((name) => `mcp__wiki__${name}`);
  const nativeAllowed = [...new Set(nativeToolNames)]
    .filter((name) => typeof name === "string" && /^[A-Za-z][A-Za-z0-9_]*$/u.test(name))
    .sort();
  const allowed = [...nativeAllowed, ...mcpAllowed];
  return Object.freeze(allowed.length > 0 ? ["--allowedTools", ...allowed] : []);
}

export function buildClaudeStdioMcpRegistrationArgs(binding, toolNames = [], nativeToolNames = []) {
  assertClaudeConduitBinding(binding);

  const relay = projectStdioMcpChannelClientRegistration(binding);
  const config = JSON.stringify({
    mcpServers: {
      wiki: {
        command: relay.command,
        args: [...relay.args],
        env: {}
      }
    }
  });
  return Object.freeze([
    "--mcp-config", config,
    "--strict-mcp-config",
    ...buildClaudeStdioMcpAllowedToolsArgs(binding, toolNames, nativeToolNames)
  ]);
}
