import path from "node:path";
import { realpath } from "node:fs/promises";

import {
  readRepoLocalWorkspaceDeclaration
} from "./workspace-config.mjs";

const WORKSPACE_ALIAS_PATTERN = /^[A-Za-z0-9._-]+$/;
const WORKSPACE_REPO_RESOLUTION_SCHEMA_VERSION = "workspace-repo-resolution.v1";
const WORKSPACE_DECLARATION_RELATIVE_PATH = "wiki/.wiki-mcp.json";

function checkWorkspaceAlias(alias) {
  const normalized = String(alias || "").trim();
  if (!normalized) {
    return { rule: "non_empty", message: "Workspace repo alias cannot be empty" };
  }
  if (!WORKSPACE_ALIAS_PATTERN.test(normalized)) {
    return {
      rule: `pattern ${WORKSPACE_ALIAS_PATTERN}`,
      message: `Workspace repo alias must match ${WORKSPACE_ALIAS_PATTERN}: ${normalized}`
    };
  }
  return { alias: normalized };
}

function normalizeWorkspaceAlias(alias) {
  const checked = checkWorkspaceAlias(alias);
  if (checked.alias === undefined) throw new Error(checked.message);
  return checked.alias;
}

function normalizeWorkspaceRoot(dir) {
  return path.resolve(String(dir || ""));
}

async function canonicalizeWorkspaceRoot(dir) {
  const normalized = normalizeWorkspaceRoot(dir);
  try {
    return await realpath(normalized);
  } catch {
    return normalized;
  }
}

const OWNED_RESOLUTION_ERRORS = new WeakSet();

function workspaceRepoResolutionRefusalOf(error) {
  if (error === null || typeof error !== "object" || !OWNED_RESOLUTION_ERRORS.has(error)) {
    return null;
  }
  return error.envelope;
}

function createWorkspaceRepoResolutionError(
  message,
  currentWorkspaceRepo,
  configuredWorkspaceRepos,
  diagnostics = []
) {
  const error = new Error(message);
  OWNED_RESOLUTION_ERRORS.add(error);
  error.schema_version = WORKSPACE_REPO_RESOLUTION_SCHEMA_VERSION;
  error.diagnostics = Array.isArray(diagnostics) ? diagnostics : [];
  error.envelope = {
    schema_version: WORKSPACE_REPO_RESOLUTION_SCHEMA_VERSION,
    refused: true,
    refusal: {
      category: "not_in_repo",
      reason: "wrong_session",
      message,
      detail: {
        current_workspace_repo: currentWorkspaceRepo,
        configured_workspace_repos: configuredWorkspaceRepos,
        diagnostics: error.diagnostics
      }
    }
  };
  return error;
}

function createWorkspaceRepoAliasSyntaxError(requestedAlias, violation, workspaces) {
  const error = createWorkspaceRepoResolutionError(
    violation.message,
    workspaces.currentAlias ?? null,
    [...workspaces.repos.keys()],
    [
      {
        code: "workspace_repo_alias_invalid",
        severity: "error",
        message: violation.message,
        path: "repo",
        source: "request"
      }
    ]
  );
  error.envelope.refusal.category = "invalid_request";
  error.envelope.refusal.reason = "invalid_alias";
  error.envelope.refusal.detail.requested_alias = requestedAlias;
  error.envelope.refusal.detail.violated_rule = violation.rule;
  return error;
}

function createWorkspaceRepoCollisionError(
  message,
  currentWorkspaceRepo,
  configuredWorkspaceRepos,
  diagnostics = []
) {
  const error = createWorkspaceRepoResolutionError(
    message,
    currentWorkspaceRepo,
    configuredWorkspaceRepos,
    diagnostics
  );
  error.envelope.refusal.category = "invalid_request";
  error.envelope.refusal.reason = "conflict";
  return error;
}

async function addWorkspaceRepo(workspaces, alias, dir, { source = "env" } = {}) {
  const normalizedAlias = normalizeWorkspaceAlias(alias);
  const normalizedDir = normalizeWorkspaceRoot(dir);
  const canonicalDir = await canonicalizeWorkspaceRoot(normalizedDir);

  const existingDir = workspaces.repos.get(normalizedAlias);
  if (existingDir && existingDir !== normalizedDir) {
    throw createWorkspaceRepoCollisionError(
      `Workspace repo alias configured more than once: ${normalizedAlias}`,
      workspaces.currentAlias,
      [...workspaces.repos.keys()],
      [
        {
          code: "workspace_repo_alias_collision",
          severity: "error",
          message: `Alias ${normalizedAlias} already maps to ${existingDir}`,
          path: normalizedAlias,
          source
        }
      ]
    );
  }

  const existingAliasForRoot = workspaces.rootAliases.get(canonicalDir);
  if (existingAliasForRoot && existingAliasForRoot !== normalizedAlias) {
    throw createWorkspaceRepoCollisionError(
      `Workspace repo directory configured more than once: ${canonicalDir}`,
      workspaces.currentAlias,
      [...workspaces.repos.keys()],
      [
        {
          code: "workspace_repo_duplicate_root",
          severity: "error",
          message: `Directory ${canonicalDir} already maps to ${existingAliasForRoot}`,
          path: normalizedAlias,
          source
        }
      ]
    );
  }

  workspaces.repos.set(normalizedAlias, normalizedDir);
  workspaces.rootAliases.set(canonicalDir, normalizedAlias);
}

async function addDeclaredLinkedRepos(workspaces, declaration) {
  const linkedRepos = Array.isArray(declaration?.linked_repos) ? declaration.linked_repos : [];

  for (const linkedRepo of linkedRepos) {
    const linkedAlias = normalizeWorkspaceAlias(linkedRepo.alias);
    const linkedRoot = normalizeWorkspaceRoot(linkedRepo.root);
    const linkedProfile = typeof linkedRepo.profile === "string" && linkedRepo.profile.trim()
      ? linkedRepo.profile.trim()
      : null;

    const targetDeclaration = await readRepoLocalWorkspaceDeclaration(linkedRoot);
    if (!targetDeclaration.ok) {
      throw createWorkspaceRepoResolutionError(
        `Repo-local workspace declaration for linked repo ${linkedAlias} failed validation at ${WORKSPACE_DECLARATION_RELATIVE_PATH}`,
        workspaces.currentAlias,
        [...workspaces.repos.keys()],
        targetDeclaration.diagnostics
      );
    }

    if (targetDeclaration.declaration.alias !== linkedAlias) {
      throw createWorkspaceRepoResolutionError(
        `Repo-local workspace declaration alias mismatch for linked repo ${linkedAlias}`,
        workspaces.currentAlias,
        [...workspaces.repos.keys()],
        [
          {
            code: "workspace_repo_alias_mismatch",
            severity: "error",
            message: `Target declaration alias ${targetDeclaration.declaration.alias} does not match linked alias ${linkedAlias}`,
            path: linkedAlias
          }
        ]
      );
    }

    if (targetDeclaration.declaration.root !== linkedRoot) {
      throw createWorkspaceRepoResolutionError(
        `Repo-local workspace declaration root mismatch for linked repo ${linkedAlias}`,
        workspaces.currentAlias,
        [...workspaces.repos.keys()],
        [
          {
            code: "workspace_repo_root_mismatch",
            severity: "error",
            message: `Target declaration root ${targetDeclaration.declaration.root} does not match linked root ${linkedRoot}`,
            path: linkedAlias
          }
        ]
      );
    }

    if (linkedProfile && targetDeclaration.declaration.profile !== linkedProfile) {
      throw createWorkspaceRepoResolutionError(
        `Repo-local workspace declaration profile mismatch for linked repo ${linkedAlias}`,
        workspaces.currentAlias,
        [...workspaces.repos.keys()],
        [
          {
            code: "workspace_repo_profile_mismatch",
            severity: "error",
            message: `Target declaration profile ${JSON.stringify(targetDeclaration.declaration.profile)} does not match linked profile ${JSON.stringify(linkedProfile)}`,
            path: linkedAlias
          }
        ]
      );
    }

    await addWorkspaceRepo(workspaces, linkedAlias, linkedRoot, { source: "declaration" });
  }
}

async function parseWorkspaceRepos(env = process.env) {
  const workspaces = {
    repos: new Map(),
    rootAliases: new Map(),
    currentAlias: null
  };

  if (env.WIKI_MCP_REPOS) {
    let parsed;
    try {
      parsed = JSON.parse(env.WIKI_MCP_REPOS);
    } catch (error) {
      throw createWorkspaceRepoResolutionError(
        `WIKI_MCP_REPOS must be a JSON object: ${error.message}`,
        null,
        []
      );
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw createWorkspaceRepoResolutionError(
        "WIKI_MCP_REPOS must be a JSON object mapping aliases to directories",
        null,
        []
      );
    }
    for (const [alias, dir] of Object.entries(parsed)) {
      await addWorkspaceRepo(workspaces, alias, dir, { source: "env" });
    }
  }

  let declaration = null;
  if (env.WIKI_MCP_WORKSPACE_DIR) {
    const currentWorkspaceDir = normalizeWorkspaceRoot(env.WIKI_MCP_WORKSPACE_DIR);
    const currentAlias = env.WIKI_MCP_WORKSPACE_ALIAS
      ? normalizeWorkspaceAlias(env.WIKI_MCP_WORKSPACE_ALIAS)
      : null;

    if (currentAlias) {
      await addWorkspaceRepo(workspaces, currentAlias, currentWorkspaceDir, {
        source: "env"
      });
      workspaces.currentAlias = currentAlias;
    } else {
      declaration = await readRepoLocalWorkspaceDeclaration(currentWorkspaceDir);
      if (!declaration.ok) {
        if (declaration.not_found) {

          const basename = path.basename(currentWorkspaceDir);
          let derivedAlias;
          try {
            derivedAlias = normalizeWorkspaceAlias(basename);
          } catch {
            throw createWorkspaceRepoResolutionError(
              `WIKI_MCP_WORKSPACE_DIR basename "${basename}" is not a valid workspace alias. ` +
                `Set WIKI_MCP_WORKSPACE_ALIAS explicitly or add wiki/.wiki-mcp.json.`,
              null,
              [...workspaces.repos.keys()],
              [
                {
                  code: "workspace_repo_invalid_derived_alias",
                  severity: "error",
                  message: `Directory basename "${basename}" does not match ${WORKSPACE_ALIAS_PATTERN}`,
                  path: "WIKI_MCP_WORKSPACE_DIR",
                  source: "basename_fallback"
                }
              ]
            );
          }
          await addWorkspaceRepo(workspaces, derivedAlias, currentWorkspaceDir, {
            source: "basename_fallback"
          });
          workspaces.currentAlias = derivedAlias;
        } else {
          throw createWorkspaceRepoResolutionError(
            `Could not derive WIKI_MCP_WORKSPACE_ALIAS from repo-local declaration at ${WORKSPACE_DECLARATION_RELATIVE_PATH}`,
            null,
            [...workspaces.repos.keys()],
            declaration.diagnostics
          );
        }
      } else {
        await addWorkspaceRepo(workspaces, declaration.declaration.alias, currentWorkspaceDir, {
          source: "declaration"
        });
        workspaces.currentAlias = declaration.declaration.alias;
        await addDeclaredLinkedRepos(workspaces, declaration.declaration);
      }
    }
  } else if (env.WIKI_MCP_WORKSPACE_ALIAS) {
    const currentAlias = normalizeWorkspaceAlias(env.WIKI_MCP_WORKSPACE_ALIAS);
    if (!workspaces.repos.has(currentAlias)) {
      throw createWorkspaceRepoResolutionError(
        `WIKI_MCP_WORKSPACE_ALIAS is not a configured workspace repo alias: ${currentAlias}`,
        null,
        [...workspaces.repos.keys()]
      );
    }
    workspaces.currentAlias = currentAlias;
  }

  return {
    repos: workspaces.repos,
    currentAlias: workspaces.currentAlias
  };
}

function resolveWorkspaceRepo(workspaces, alias = null) {
  if (!workspaces || !(workspaces.repos instanceof Map)) {
    throw createWorkspaceRepoResolutionError(
      "Workspace repositories are not initialized.",
      null,
      []
    );
  }

  if (workspaces.repos.size === 0) {
    throw createWorkspaceRepoResolutionError(
      "No workspace repositories are configured. Set WIKI_MCP_WORKSPACE_DIR or WIKI_MCP_REPOS.",
      null,
      []
    );
  }

  let requestedAlias = null;
  if (alias) {
    const checked = checkWorkspaceAlias(alias);
    if (checked.alias === undefined) {
      throw createWorkspaceRepoAliasSyntaxError(alias, checked, workspaces);
    }
    requestedAlias = checked.alias;
  }
  if (!requestedAlias) {
    const currentAlias = workspaces.currentAlias;
    if (!currentAlias) {
      throw createWorkspaceRepoResolutionError(
        "Repo-scoped MCP tools require a repo-attached session. Pass repo explicitly, or start the MCP server with WIKI_MCP_WORKSPACE_DIR (attached via explicit WIKI_MCP_WORKSPACE_ALIAS, a repo-local wiki/.wiki-mcp.json, or the workspace directory basename fallback).",
        null,
        [...workspaces.repos.keys()]
      );
    }
    const currentDir = workspaces.repos.get(currentAlias);
    if (!currentDir) {
      throw createWorkspaceRepoResolutionError(
        `Launcher-minted current workspace repo alias is not configured: ${currentAlias}`,
        currentAlias,
        [...workspaces.repos.keys()]
      );
    }
    return { repo: currentAlias, dir: currentDir };
  }

  const dir = workspaces.repos.get(requestedAlias);
  if (!dir) {
    throw createWorkspaceRepoResolutionError(
      `Unknown workspace repo alias: ${requestedAlias}`,
      workspaces.currentAlias,
      [...workspaces.repos.keys()]
    );
  }

  return { repo: requestedAlias, dir };
}

export {
  WORKSPACE_REPO_RESOLUTION_SCHEMA_VERSION,
  addWorkspaceRepo,
  canonicalizeWorkspaceRoot,
  createWorkspaceRepoCollisionError,
  createWorkspaceRepoResolutionError,
  normalizeWorkspaceAlias,
  normalizeWorkspaceRoot,
  parseWorkspaceRepos,
  resolveWorkspaceRepo,
  workspaceRepoResolutionRefusalOf
};

export default {
  WORKSPACE_REPO_RESOLUTION_SCHEMA_VERSION,
  addWorkspaceRepo,
  canonicalizeWorkspaceRoot,
  createWorkspaceRepoCollisionError,
  createWorkspaceRepoResolutionError,
  normalizeWorkspaceAlias,
  normalizeWorkspaceRoot,
  parseWorkspaceRepos,
  resolveWorkspaceRepo,
  workspaceRepoResolutionRefusalOf
};
