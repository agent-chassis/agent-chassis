

import path from "node:path";

import {
  WIKI_MCP_DISPATCH_WORKTREE_ROOT_ENV_VAR,
  WIKI_MCP_WORKSPACE_ALIAS_ENV_VAR,
  resolveLauncherConfiguredWorkspaceAlias
} from "./codex-role-mcp-env.mjs";
import {
  STDIO_MCP_CLIENT_READINESS_TIMEOUT_SEC,
  STDIO_MCP_CONDUIT_ERROR_CODES,
  assertTrustedStdioMcpConduitBinding,
  failStdioMcpConduit,
  normalizeStdioMcpConduitRole
} from "./stdio-mcp-conduit-contract.mjs";
import {
  mintTrustedStdioMcpConduitAuthority
} from "./stdio-mcp-conduit-authority.mjs";

export const CODEX_CONDUIT_BINDING_REFUSAL_REASON = "codex_conduit_binding_not_canonical";

export const CODEX_REQUIRED_MCP_CONDUIT_ABSENT_REASON =
  "codex_required_wiki_mcp_conduit_absent";

export function buildCodexStdioMcpRegistrationOverrides(binding) {
  assertTrustedStdioMcpConduitBinding(binding);
  if (binding.family !== "codex") {
    failStdioMcpConduit(STDIO_MCP_CONDUIT_ERROR_CODES.FIFO_IDENTITY_MISMATCH,
      "Codex registration requires its exact launcher-minted Codex conduit binding");
  }
  const command = JSON.stringify(binding.relay.command);
  const args = [...binding.relay.args].map((value) => JSON.stringify(value)).join(",");
  return Object.freeze([
    `mcp_servers={wiki={enabled=true,command=${command},args=[${args}],startup_timeout_sec=${STDIO_MCP_CLIENT_READINESS_TIMEOUT_SEC}}}`
  ]);
}

export class CodexConduitBindingError extends Error {
  constructor(message, detail = null) {
    super(message);
    this.name = "CodexConduitBindingError";
    this.code = CODEX_CONDUIT_BINDING_REFUSAL_REASON;
    this.detail = detail;
  }
}

function refuse(message, detail = null) {
  throw new CodexConduitBindingError(message, detail);
}

function frozenStringArray(value) {
  return Object.freeze(
    [...new Set((Array.isArray(value) ? value : []).filter(
      (entry) => typeof entry === "string" && entry.length > 0
    ))].sort()
  );
}

function sameStringSet(left, right) {
  const a = frozenStringArray(left);
  const b = frozenStringArray(right);
  return a.length === b.length && a.every((entry, index) => entry === b[index]);
}

function assertHintMatchesCanonical(label, hint, canonical) {
  if (hint === null || hint === undefined) return;
  if (!Array.isArray(hint)) {
    refuse(`request ${label} hint is malformed`, { field: label });
  }
  if (!sameStringSet(hint, canonical)) {
    refuse(`request ${label} hint does not match the launcher-resolved canonical binding`, {
      field: label,
      canonical: [...canonical],
      requested: frozenStringArray(hint)
    });
  }
}

function assertScalarHintMatches(label, hint, canonical) {
  if (hint === null || hint === undefined || hint === "") return;
  if (typeof hint !== "string") {
    refuse(`request ${label} hint is malformed`, { field: label });
  }
  if (canonical === null) {
    refuse(`request ${label} hint has no launcher-resolved canonical counterpart`, {
      field: label,
      requested: hint
    });
  }
  if (path.resolve(hint) !== path.resolve(canonical)) {
    refuse(`request ${label} hint does not match the launcher-resolved canonical binding`, {
      field: label,
      canonical,
      requested: hint
    });
  }
}

export function deriveCanonicalDispatchWorktreeRoot(mainRepo) {
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo)) return null;
  const canonicalMainRepo = path.resolve(mainRepo);
  return path.join(
    path.dirname(canonicalMainRepo),
    ".agent-worktrees",
    path.basename(canonicalMainRepo)
  );
}

export function resolveCodexConduitServerEnvironment({
  role,
  workspaceDir,
  launcherEnv = process.env,
  responseStateDir = null,
  requestedWorkspaceAlias = null,
  requestedDispatchWorktreeRoot = null
}) {
  const workspaceAlias = resolveLauncherConfiguredWorkspaceAlias({
    env: launcherEnv,
    repo: workspaceDir
  });

  if (typeof requestedWorkspaceAlias === "string" && requestedWorkspaceAlias.length > 0 &&
      workspaceAlias !== null && requestedWorkspaceAlias !== workspaceAlias) {
    refuse("request workspace alias does not match the launcher-configured alias", {
      field: WIKI_MCP_WORKSPACE_ALIAS_ENV_VAR,
      canonical: workspaceAlias,
      requested: requestedWorkspaceAlias
    });
  }
  const dispatchWorktreeRoot = deriveCanonicalDispatchWorktreeRoot(workspaceDir);
  assertScalarHintMatches(
    WIKI_MCP_DISPATCH_WORKTREE_ROOT_ENV_VAR,
    requestedDispatchWorktreeRoot,
    dispatchWorktreeRoot
  );

  const effectiveResponseStateDir = role === "orchestrator" &&
    typeof responseStateDir === "string" && path.isAbsolute(responseStateDir)
    ? responseStateDir
    : null;
  return Object.freeze({
    workspaceAlias: workspaceAlias ?? null,
    dispatchWorktreeRoot,
    responseStateDir: effectiveResponseStateDir
  });
}

export function resolveCodexConduitInput({
  role,
  assignedUnit,
  workspaceDir,
  workerScopeAuthority = null,
  worktreeProvisioning = null,
  commitTuple = null,
  launcherEnv = process.env,
  responseStateDir = null,
  requested = null
}) {
  const conduitRole = normalizeStdioMcpConduitRole(role);
  if (typeof assignedUnit !== "string" || assignedUnit.length === 0) {
    refuse("a Codex conduit binding requires a launcher-resolved assigned unit");
  }
  if (typeof workspaceDir !== "string" || !path.isAbsolute(workspaceDir)) {
    refuse("a Codex conduit binding requires an absolute launcher-resolved workspace");
  }
  const provisioning = worktreeProvisioning ?? null;

  const authority = mintTrustedStdioMcpConduitAuthority({
    family: "codex",
    role: conduitRole,
    assignedUnit,
    workspaceDir,
    workerScopeAuthority: conduitRole === "worker" ? workerScopeAuthority : null,
    provisioning,
    commitTuple
  });

  assertHintMatchesCanonical("write_scope", requested?.write_scope ?? null,
    authority.writeScope);
  assertHintMatchesCanonical("read_scope", requested?.read_scope ?? null,
    authority.readScope);

  const serverEnvironment = resolveCodexConduitServerEnvironment({
    role: conduitRole,
    workspaceDir,
    launcherEnv,
    responseStateDir,
    requestedWorkspaceAlias: requested?.workspace_alias ?? null,
    requestedDispatchWorktreeRoot: requested?.dispatch_worktree_root ?? null
  });

  const conduitInput = {
    family: "codex",
    role: conduitRole,
    assignedUnit,
    workspaceDir: path.resolve(workspaceDir),

    authority,
    dispatchWorktreeRoot: serverEnvironment.dispatchWorktreeRoot
  };
  if (serverEnvironment.workspaceAlias !== null) {
    conduitInput.workspaceAlias = serverEnvironment.workspaceAlias;
  }
  if (serverEnvironment.responseStateDir !== null) {
    conduitInput.responseStateDir = serverEnvironment.responseStateDir;
  }
  if (commitTuple !== null && commitTuple !== undefined) {
    conduitInput.commitTuple = commitTuple;
  }
  return conduitInput;
}
