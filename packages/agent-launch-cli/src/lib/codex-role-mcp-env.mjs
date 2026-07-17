

import path from "node:path";
import { mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";

import { parseCodexMcpConfig, readCodexConfigText } from "./launch-isolation.mjs";
import { isNonEmptyStringInternal } from "./codex-role-io.mjs";

import {
  HOST_WRITE_AUTHORITY_SIDECAR_ENDPOINT_ENV_VAR
} from "./host-write-authority-substrate/endpoint.mjs";

export const WIKI_MCP_REPO_ENV_FILE_NAME = ".env";

export function resolveWikiMcpRepoEnvFilePath(repo) {
  if (typeof repo !== "string" || repo.length === 0 || !path.isAbsolute(repo)) {
    return null;
  }
  const envFilePath = path.join(repo, WIKI_MCP_REPO_ENV_FILE_NAME);
  try {
    return statSync(envFilePath).isFile() ? envFilePath : null;
  } catch {
    return null;
  }
}

export function buildWikiMcpServerNodeArgs({ repo = null, serverPath } = {}) {
  if (!isNonEmptyStringInternal(serverPath)) {
    throw new Error("buildWikiMcpServerNodeArgs requires a resolved server path");
  }
  const envFilePath = resolveWikiMcpRepoEnvFilePath(repo);
  return isNonEmptyStringInternal(envFilePath)
    ? [`--env-file=${envFilePath}`, serverPath]
    : [serverPath];
}

export function buildWikiMcpServerNodeCommand({ repo = null, serverPath } = {}) {
  return {
    command: "node",
    args: buildWikiMcpServerNodeArgs({ repo, serverPath })
  };
}

export const WIKI_MCP_SERVER_PACKAGE_SUBPATH =
  "@agent-chassis/wiki-mcp/src/server.mjs";

const requireFromMcpEnvHelper = createRequire(import.meta.url);

export function resolveWikiMcpServerPath() {
  try {
    return requireFromMcpEnvHelper.resolve(WIKI_MCP_SERVER_PACKAGE_SUBPATH);
  } catch {
    return null;
  }
}

export const WIKI_MCP_WORKSPACE_DIR_ENV_VAR = "WIKI_MCP_WORKSPACE_DIR";
export const WIKI_MCP_WORKSPACE_ALIAS_ENV_VAR = "WIKI_MCP_WORKSPACE_ALIAS";
export const WIKI_MCP_DISPATCH_WORKTREE_ROOT_ENV_VAR = "WIKI_MCP_DISPATCH_WORKTREE_ROOT";
export const WIKI_MCP_RESPONSE_STATE_DIR_ENV_VAR = "WIKI_MCP_RESPONSE_STATE_DIR";
export const WIKI_MCP_TOOL_PROFILE_ENV_VAR = "WIKI_MCP_TOOL_PROFILE";
export const WIKI_MCP_ASSIGNED_UNIT_ENV_VAR = "WIKI_MCP_ASSIGNED_UNIT";
export const WIKI_MCP_COMMIT_BINDING_ENV_VAR = "WIKI_MCP_COMMIT_BINDING";
export const WIKI_MCP_COMMIT_LAUNCH_REF_ENV_VAR = "WIKI_MCP_COMMIT_LAUNCH_REF";
export const WIKI_MCP_COMMIT_RUN_ID_ENV_VAR = "WIKI_MCP_COMMIT_RUN_ID";
export const WIKI_MCP_COMMIT_RETRY_ID_ENV_VAR = "WIKI_MCP_COMMIT_RETRY_ID";
export const WIKI_MCP_RESPONSE_STATE_DIR_NAME = "wiki-mcp-response-state";
export const WIKI_MCP_AGENT_SAFE_TOOL_PROFILE = "agent-safe";
export const WIKI_MCP_WORKER_TOOL_PROFILE = "worker";
export const WIKI_MCP_REVIEWER_TOOL_PROFILE = "reviewer";
export const WIKI_MCP_REDTEAM_TOOL_PROFILE = "redteam";

function pathContainsOrEquals(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function resolveWikiMcpResponseStateDir({
  runtimeDir = null,
  workspaceDir = null
} = {}) {
  if (!isNonEmptyStringInternal(runtimeDir) || !path.isAbsolute(runtimeDir)) {
    throw new Error(
      "launcher-owned MCP response state dir requires an absolute orchestrator runtimeDir"
    );
  }
  const stateDir = path.join(path.resolve(runtimeDir), WIKI_MCP_RESPONSE_STATE_DIR_NAME);
  if (
    isNonEmptyStringInternal(workspaceDir) &&
    path.isAbsolute(workspaceDir) &&
    pathContainsOrEquals(workspaceDir, stateDir)
  ) {
    throw new Error(
      "launcher-owned MCP response state dir must not live inside the workspace repo"
    );
  }
  return stateDir;
}

export function ensureWikiMcpResponseStateDir({
  runtimeDir = null,
  workspaceDir = null
} = {}) {
  const stateDir = resolveWikiMcpResponseStateDir({ runtimeDir, workspaceDir });
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const stateDirStats = statSync(stateDir);
  if (!stateDirStats.isDirectory()) {
    throw new Error("launcher-owned MCP response state path is not a directory");
  }
  return stateDir;
}

export function selectWikiMcpServerEnv({
  workspaceAlias = null,
  workspaceDir = null,
  dispatchWorktreeRoot = null,
  responseStateDir = null,
  endpointEnvVar = null,
  endpointValue = null
} = {}) {
  const env = {};
  if (isNonEmptyStringInternal(workspaceAlias)) {
    env[WIKI_MCP_WORKSPACE_ALIAS_ENV_VAR] = workspaceAlias;
  }
  if (isNonEmptyStringInternal(workspaceDir)) {
    env[WIKI_MCP_WORKSPACE_DIR_ENV_VAR] = workspaceDir;
  }
  if (isNonEmptyStringInternal(dispatchWorktreeRoot)) {
    if (!path.isAbsolute(dispatchWorktreeRoot)) {
      throw new Error("launcher-owned dispatch worktree root requires an absolute path");
    }
    env[WIKI_MCP_DISPATCH_WORKTREE_ROOT_ENV_VAR] = dispatchWorktreeRoot;
  }
  env[WIKI_MCP_TOOL_PROFILE_ENV_VAR] = WIKI_MCP_AGENT_SAFE_TOOL_PROFILE;
  if (isNonEmptyStringInternal(responseStateDir) && path.isAbsolute(responseStateDir)) {
    env[WIKI_MCP_RESPONSE_STATE_DIR_ENV_VAR] = responseStateDir;
  }
  if (isNonEmptyStringInternal(endpointEnvVar) && isNonEmptyStringInternal(endpointValue)) {
    env[endpointEnvVar] = endpointValue;
  }
  return env;
}

export const CODEX_WIKI_MCP_SERVER_NAME = "wiki";

export function quoteTomlString(value) {
  return JSON.stringify(String(value));
}

export function buildCodexWikiMcpEnvOverride({ mcpServerName, envVar, value }) {
  const mcpEnvKey = `mcp_servers.${mcpServerName}.env.${envVar}`;
  return `${mcpEnvKey}=${quoteTomlString(value)}`;
}

export function buildCodexWorkspaceMcpEnvOverrides({
  mcpServerName = CODEX_WIKI_MCP_SERVER_NAME,
  workspaceAlias = null,
  workspaceDir = null,
  dispatchWorktreeRoot = null
} = {}) {
  const normalizedAlias = typeof workspaceAlias === "string" && workspaceAlias.trim().length > 0
    ? workspaceAlias.trim()
    : "";
  const normalizedDir = typeof workspaceDir === "string" && workspaceDir.length > 0 && path.isAbsolute(workspaceDir)
    ? workspaceDir
    : "";
  const normalizedDispatchWorktreeRoot =
    typeof dispatchWorktreeRoot === "string" && dispatchWorktreeRoot.length > 0
      ? dispatchWorktreeRoot
      : "";
  if (normalizedDispatchWorktreeRoot && !path.isAbsolute(normalizedDispatchWorktreeRoot)) {
    throw new Error("launcher-owned dispatch worktree root requires an absolute path");
  }

  if (!normalizedDir) {
    return [];
  }
  const overrides = [];
  if (normalizedAlias) {
    overrides.push(buildCodexWikiMcpEnvOverride({
      mcpServerName,
      envVar: WIKI_MCP_WORKSPACE_ALIAS_ENV_VAR,
      value: normalizedAlias
    }));
  }
  overrides.push(buildCodexWikiMcpEnvOverride({
    mcpServerName,
    envVar: WIKI_MCP_WORKSPACE_DIR_ENV_VAR,
    value: normalizedDir
  }));
  if (normalizedDispatchWorktreeRoot) {
    overrides.push(buildCodexWikiMcpEnvOverride({
      mcpServerName,
      envVar: WIKI_MCP_DISPATCH_WORKTREE_ROOT_ENV_VAR,
      value: normalizedDispatchWorktreeRoot
    }));
  }
  overrides.push(buildCodexWikiMcpEnvOverride({
    mcpServerName,
    envVar: WIKI_MCP_TOOL_PROFILE_ENV_VAR,
    value: WIKI_MCP_AGENT_SAFE_TOOL_PROFILE
  }));
  return overrides;
}

function invalidManagedCommitBinding(message) {
  const error = new Error(`managed worker commit credential is invalid: ${message}`);
  error.code = "managed_worker_commit_credential_invalid";
  return error;
}

function assertExactString(value, field) {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw invalidManagedCommitBinding(`${field} must be a non-empty normalized string`);
  }
  return value;
}

function sameStringArray(left, right) {
  return Array.isArray(left) && Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function resolveManagedWorkerCommitTuple({
  assignedUnit,
  worktreeProvisioning,
  sliceBinding
}) {
  if (!worktreeProvisioning || typeof worktreeProvisioning !== "object" ||
      Array.isArray(worktreeProvisioning) || !Object.isFrozen(worktreeProvisioning) ||
      worktreeProvisioning.schema_version !== "managed-worktree-binding.v1" ||
      worktreeProvisioning.complete !== true) {
    throw invalidManagedCommitBinding("validated launcher-owned provisioning result is missing or malformed");
  }
  if (!sliceBinding || typeof sliceBinding !== "object" || Array.isArray(sliceBinding) ||
      !Object.isFrozen(sliceBinding) || worktreeProvisioning.slice_binding !== sliceBinding) {
    throw invalidManagedCommitBinding("slice_binding must be the exact frozen provisioning-owned object");
  }
  for (const alias of ["launchRef", "runId", "retryId"]) {
    if (Object.prototype.hasOwnProperty.call(sliceBinding, alias)) {
      throw invalidManagedCommitBinding(`slice_binding caller alias ${alias} is forbidden`);
    }
  }

  const subjectMatch = /^(WK-\d{4})#(SLICE-\d{3})$/u.exec(assignedUnit);
  if (!subjectMatch) {
    throw invalidManagedCommitBinding("managed implementation subject must select one exact slice");
  }
  const [, recordId, sliceId] = subjectMatch;
  const initiative = assertExactString(worktreeProvisioning.initiative, "provisioning.initiative");
  const exactUnitAddress = `${initiative}/${recordId}/${sliceId}`;
  for (const [field, expected] of [
    ["record_id", recordId],
    ["slice_id", sliceId],
    ["unit_address", exactUnitAddress]
  ]) {
    if (worktreeProvisioning[field] !== expected || sliceBinding[field] !== expected) {
      throw invalidManagedCommitBinding(`${field} mismatches the selected subject`);
    }
  }
  if (sliceBinding.initiative !== initiative) {
    throw invalidManagedCommitBinding("initiative mismatches the selected subject");
  }
  if (sliceBinding.schema_version !== "worktree-identity-binding.v1") {
    throw invalidManagedCommitBinding("slice_binding schema is unsupported");
  }

  const launchRef = assertExactString(sliceBinding.launch_ref, "slice_binding.launch_ref");
  const runId = assertExactString(sliceBinding.run_id, "slice_binding.run_id");
  if (!runId.endsWith(".slice")) {
    throw invalidManagedCommitBinding("slice_binding.run_id is not the selected slice run identity");
  }
  const retryId = sliceBinding.retry_id;
  if (!Number.isInteger(retryId) || retryId < 0 || worktreeProvisioning.retry_id !== retryId) {
    throw invalidManagedCommitBinding("retry_id is malformed or stale");
  }
  assertExactString(worktreeProvisioning.run_authority, "provisioning.run_authority");

  for (const field of [
    "worktree_path",
    "output_branch",
    "base_ref",
    "base_sha",
    "index_sparse"
  ]) {
    if (worktreeProvisioning[field] !== sliceBinding[field]) {
      throw invalidManagedCommitBinding(`provisioning alias ${field} is stale or mismatched`);
    }
  }
  for (const field of ["write_scope", "cone_dirs"]) {
    if (!sameStringArray(worktreeProvisioning[field], sliceBinding[field])) {
      throw invalidManagedCommitBinding(`provisioning alias ${field} is stale or mismatched`);
    }
  }

  return Object.freeze({ launchRef, runId, retryId });
}

export function assertNoConfiguredCodexRoleCommitCredential({
  role,
  env = process.env,
  mcpServerName = CODEX_WIKI_MCP_SERVER_NAME
} = {}) {
  const profile = resolveCodexRoleWikiMcpToolProfile(role);
  const invalidCredential = (message) => {
    if (profile === WIKI_MCP_WORKER_TOOL_PROFILE) {
      return invalidManagedCommitBinding(message);
    }
    const error = new Error(`Codex ${profile} commit credential is invalid: ${message}`);
    error.code = "codex_read_only_commit_credential_invalid";
    return error;
  };
  const configText = readCodexConfigText(env);
  if (!configText) return;
  let servers;
  try {
    servers = parseCodexMcpConfig(configText);
  } catch (error) {
    throw invalidCredential(
      `Codex MCP config could not be checked for caller credential overrides: ${error?.message ?? String(error)}`
    );
  }
  const server = Array.isArray(servers)
    ? servers.find((entry) => entry && entry.name === mcpServerName)
    : null;
  const configuredEnv = server?.env;
  if (!configuredEnv || typeof configuredEnv !== "object") return;
  const forbidden = [
    WIKI_MCP_COMMIT_BINDING_ENV_VAR,
    WIKI_MCP_COMMIT_LAUNCH_REF_ENV_VAR,
    WIKI_MCP_COMMIT_RUN_ID_ENV_VAR,
    WIKI_MCP_COMMIT_RETRY_ID_ENV_VAR
  ].find((key) => Object.prototype.hasOwnProperty.call(configuredEnv, key));
  if (forbidden) {
    const recipient = profile === WIKI_MCP_WORKER_TOOL_PROFILE
      ? "managed workers"
      : `Codex ${profile} sessions`;
    throw invalidCredential(
      `Codex MCP config caller override ${forbidden} is forbidden for ${recipient}`
    );
  }
}

export function assertNoConfiguredCodexWorkerCommitCredential(options = {}) {
  return assertNoConfiguredCodexRoleCommitCredential({ ...options, role: "worker" });
}

export function assertCodexWorkerCommitCredentialBinding({
  assignedUnit,
  managedWorker = false,
  worktreeProvisioning = null,
  sliceBinding = null
} = {}) {
  const managed = managedWorker === true || worktreeProvisioning !== null || sliceBinding !== null;
  return managed
    ? resolveManagedWorkerCommitTuple({ assignedUnit, worktreeProvisioning, sliceBinding })
    : null;
}

export function resolveCodexRoleWikiMcpToolProfile(role) {
  switch (role) {
    case "worker":
      return WIKI_MCP_WORKER_TOOL_PROFILE;
    case "review":
    case "reviewer":
      return WIKI_MCP_REVIEWER_TOOL_PROFILE;
    case "redteam":
      return WIKI_MCP_REDTEAM_TOOL_PROFILE;
    default:
      throw new Error(`unsupported Codex role for launcher-owned wiki MCP profile: ${String(role)}`);
  }
}

function buildCodexAssignedRoleWikiMcpEnvOverrides({
  mcpServerName,
  role,
  assignedUnit
}) {
  if (!isNonEmptyStringInternal(assignedUnit)) {
    throw new Error(`${role} wiki MCP env overrides require a launcher-assigned unit`);
  }
  return [
    buildCodexWikiMcpEnvOverride({
      mcpServerName,
      envVar: WIKI_MCP_TOOL_PROFILE_ENV_VAR,
      value: resolveCodexRoleWikiMcpToolProfile(role)
    }),
    buildCodexWikiMcpEnvOverride({
      mcpServerName,
      envVar: WIKI_MCP_ASSIGNED_UNIT_ENV_VAR,
      value: assignedUnit
    })
  ];
}

export function buildCodexReadOnlyRoleWikiMcpEnvOverrides({
  mcpServerName = CODEX_WIKI_MCP_SERVER_NAME,
  role,
  assignedUnit
} = {}) {
  const profile = resolveCodexRoleWikiMcpToolProfile(role);
  if (profile === WIKI_MCP_WORKER_TOOL_PROFILE) {
    throw new Error("read-only Codex wiki MCP env overrides require review, reviewer, or redteam role");
  }
  return buildCodexAssignedRoleWikiMcpEnvOverrides({
    mcpServerName,
    role,
    assignedUnit
  });
}

export function buildCodexWorkerHostWriteEndpointMcpEnvOverride({
  mcpServerName = CODEX_WIKI_MCP_SERVER_NAME,
  hostWriteAuthorityEndpoint = null
} = {}) {
  if (!isNonEmptyStringInternal(hostWriteAuthorityEndpoint)) {
    return null;
  }
  return buildCodexWikiMcpEnvOverride({
    mcpServerName,
    envVar: HOST_WRITE_AUTHORITY_SIDECAR_ENDPOINT_ENV_VAR,
    value: hostWriteAuthorityEndpoint
  });
}

export function buildCodexWorkerWikiMcpEnvOverrides({
  mcpServerName = CODEX_WIKI_MCP_SERVER_NAME,
  assignedUnit,
  managedWorker = false,
  worktreeProvisioning = null,
  sliceBinding = null,

  hostWriteAuthorityEndpoint = null
} = {}) {
  const overrides = buildCodexAssignedRoleWikiMcpEnvOverrides({
    mcpServerName,
    role: "worker",
    assignedUnit
  });
  const tuple = assertCodexWorkerCommitCredentialBinding({
    assignedUnit,
    managedWorker,
    worktreeProvisioning,
    sliceBinding
  });
  if (tuple === null) {
    return overrides;
  }
  overrides.push(
    buildCodexWikiMcpEnvOverride({
      mcpServerName,
      envVar: WIKI_MCP_COMMIT_LAUNCH_REF_ENV_VAR,
      value: tuple.launchRef
    }),
    buildCodexWikiMcpEnvOverride({
      mcpServerName,
      envVar: WIKI_MCP_COMMIT_RUN_ID_ENV_VAR,
      value: tuple.runId
    }),
    buildCodexWikiMcpEnvOverride({
      mcpServerName,
      envVar: WIKI_MCP_COMMIT_RETRY_ID_ENV_VAR,
      value: String(tuple.retryId)
    })
  );

  const endpointOverride = buildCodexWorkerHostWriteEndpointMcpEnvOverride({
    mcpServerName,
    hostWriteAuthorityEndpoint
  });
  if (endpointOverride !== null) {
    overrides.push(endpointOverride);
  }
  return overrides;
}

export function injectCodexConfigOverridesBeforeFinalPositional(args, overrides) {
  if (!Array.isArray(args) || !Array.isArray(overrides) || overrides.length === 0) {
    return;
  }
  const insertionIndex = args.length > 0 ? args.length - 1 : 0;
  for (const override of [...overrides].reverse()) {
    args.splice(insertionIndex, 0, "-c", override);
  }
}

export function resolveLauncherConfiguredWorkspaceAlias({ env, repo, mcpServerName } = {}) {
  const repoPath = typeof repo === "string" && repo.length > 0
    ? path.resolve(repo)
    : null;
  if (!repoPath) return null;

  const fromInheritedEnv = resolveWorkspaceAliasFromEnvView(env, repoPath);
  if (fromInheritedEnv) return fromInheritedEnv;

  const fromCodexConfig = resolveWorkspaceAliasFromCodexConfig({
    env,
    repoPath,
    mcpServerName
  });
  if (fromCodexConfig) return fromCodexConfig;

  return null;
}

function resolveWorkspaceAliasFromEnvView(envView, repoPath) {
  const view = envView && typeof envView === "object" ? envView : {};

  const configuredRepos = parseConfiguredWorkspaceRepos(view.WIKI_MCP_REPOS);
  for (const [alias, configuredRepo] of configuredRepos) {
    if (path.resolve(configuredRepo) === repoPath) {
      return alias;
    }
  }

  const workspaceAlias = typeof view.WIKI_MCP_WORKSPACE_ALIAS === "string"
    ? view.WIKI_MCP_WORKSPACE_ALIAS.trim()
    : "";
  const workspaceDir = typeof view.WIKI_MCP_WORKSPACE_DIR === "string"
    ? view.WIKI_MCP_WORKSPACE_DIR.trim()
    : "";
  if (workspaceAlias.length > 0 && workspaceDir.length > 0 && path.resolve(workspaceDir) === repoPath) {
    return workspaceAlias;
  }

  return null;
}

function resolveWorkspaceAliasFromCodexConfig({ env, repoPath, mcpServerName } = {}) {
  const configText = readCodexConfigText(env);
  if (!configText) return null;
  const serverName = isNonEmptyStringInternal(mcpServerName)
    ? mcpServerName
    : CODEX_WIKI_MCP_SERVER_NAME;
  let servers;
  try {
    servers = parseCodexMcpConfig(configText);
  } catch {
    return null;
  }
  const server = Array.isArray(servers)
    ? servers.find((entry) => entry && entry.name === serverName)
    : null;
  if (!server || !server.env || typeof server.env !== "object") return null;

  return resolveWorkspaceAliasFromEnvView(server.env, repoPath);
}

function parseConfiguredWorkspaceRepos(rawRepos) {
  if (typeof rawRepos !== "string" || rawRepos.length === 0) {
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(rawRepos);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [];
  }
  return Object.entries(parsed).filter(([alias, repoPath]) => {
    return typeof alias === "string" && alias.length > 0
      && typeof repoPath === "string" && repoPath.length > 0;
  });
}
