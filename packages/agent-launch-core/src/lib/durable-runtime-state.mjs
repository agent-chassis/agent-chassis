

import path from "node:path";
import { lstatSync, realpathSync, statSync } from "node:fs";
import { mkdir, open, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";

import { LAUNCHER_CONFIG_DIRNAME } from "./config.mjs";

export const LAUNCHER_DURABLE_STATE_DIRNAME = "durable-state";
export const LAUNCHER_DURABLE_STATE_LAYOUT_VERSION = "v1";

export const LAUNCHER_DURABLE_STATE_CODES = Object.freeze({

  CALLER_AUTHORITY_REJECTED: "launcher_durable_state_caller_authority_rejected",

  WORKSPACE_INPUT_INVALID: "launcher_durable_state_workspace_input_invalid",

  WORKSPACE_INPUT_AMBIGUOUS: "launcher_durable_state_workspace_input_ambiguous",

  WORKSPACE_UNAUTHENTICATED: "launcher_durable_state_workspace_unauthenticated",

  WORKSPACE_REDIRECTED: "launcher_durable_state_workspace_redirected",

  MANAGED_WORKTREE_ROOT: "launcher_durable_state_managed_worktree_root",

  ROOT_REDIRECTED: "launcher_durable_state_root_redirected",

  ROOT_UNWRITABLE: "launcher_durable_state_root_unwritable"
});

const RESOLVER_OPTION_KEYS = Object.freeze(["workspaceDir"]);

function refuse(code, reason) {
  return Object.freeze({ ok: false, code, reason });
}

function rejectUnownedOptions(options) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    return refuse(
      LAUNCHER_DURABLE_STATE_CODES.CALLER_AUTHORITY_REJECTED,
      "launcher durable state options must be a plain object"
    );
  }
  const unowned = Object.keys(options).filter((key) => !RESOLVER_OPTION_KEYS.includes(key));
  if (unowned.length > 0) {
    return refuse(
      LAUNCHER_DURABLE_STATE_CODES.CALLER_AUTHORITY_REJECTED,
      `launcher durable state root is not caller-selectable; unowned option(s): ${unowned.sort().join(", ")}`
    );
  }
  return null;
}

function authenticateWorkspaceIdentity(workspaceDir) {
  if (typeof workspaceDir !== "string" || workspaceDir.length === 0) {
    return refuse(
      LAUNCHER_DURABLE_STATE_CODES.WORKSPACE_INPUT_INVALID,
      "launcher durable state requires an authenticated workspace root"
    );
  }
  if (!path.isAbsolute(workspaceDir)) {
    return refuse(
      LAUNCHER_DURABLE_STATE_CODES.WORKSPACE_INPUT_INVALID,
      "launcher durable state workspace root must be absolute; a relative path resolves against caller-controlled cwd"
    );
  }
  if (path.normalize(workspaceDir) !== workspaceDir || path.resolve(workspaceDir) !== workspaceDir) {
    return refuse(
      LAUNCHER_DURABLE_STATE_CODES.WORKSPACE_INPUT_AMBIGUOUS,
      "launcher durable state workspace root must be normalized; two spellings must not name one workspace"
    );
  }
  let info;
  try {
    info = statSync(workspaceDir);
  } catch {
    return refuse(
      LAUNCHER_DURABLE_STATE_CODES.WORKSPACE_UNAUTHENTICATED,
      "launcher durable state workspace root does not exist"
    );
  }
  if (!info.isDirectory()) {
    return refuse(
      LAUNCHER_DURABLE_STATE_CODES.WORKSPACE_UNAUTHENTICATED,
      "launcher durable state workspace root is not a directory"
    );
  }
  let realWorkspaceDir;
  try {
    realWorkspaceDir = realpathSync(workspaceDir);
  } catch {
    return refuse(
      LAUNCHER_DURABLE_STATE_CODES.WORKSPACE_REDIRECTED,
      "launcher durable state workspace root could not be canonicalized"
    );
  }
  if (realWorkspaceDir !== workspaceDir) {
    return refuse(
      LAUNCHER_DURABLE_STATE_CODES.WORKSPACE_REDIRECTED,
      "launcher durable state workspace root is redirected through a symbolic link"
    );
  }
  let gitInfo;
  try {
    gitInfo = lstatSync(path.join(workspaceDir, ".git"));
  } catch {
    return refuse(
      LAUNCHER_DURABLE_STATE_CODES.WORKSPACE_UNAUTHENTICATED,
      "launcher durable state workspace root is not a repository checkout"
    );
  }
  if (gitInfo.isSymbolicLink()) {
    return refuse(
      LAUNCHER_DURABLE_STATE_CODES.WORKSPACE_REDIRECTED,
      "launcher durable state workspace repository metadata is redirected through a symbolic link"
    );
  }
  if (!gitInfo.isDirectory()) {
    return refuse(
      LAUNCHER_DURABLE_STATE_CODES.MANAGED_WORKTREE_ROOT,
      "launcher durable state workspace root is a linked (managed) worktree checkout, not the primary repository"
    );
  }
  return Object.freeze({ ok: true, workspace_root: workspaceDir });
}

export function resolveLauncherOwnedWorkspaceDurableStateRoot(options = {}) {
  const rejected = rejectUnownedOptions(options);
  if (rejected !== null) return rejected;
  const authenticated = authenticateWorkspaceIdentity(options.workspaceDir);
  if (authenticated.ok !== true) return authenticated;
  const workspaceRoot = authenticated.workspace_root;

  const root = path.join(
    workspaceRoot,
    LAUNCHER_CONFIG_DIRNAME,
    LAUNCHER_DURABLE_STATE_DIRNAME,
    LAUNCHER_DURABLE_STATE_LAYOUT_VERSION
  );
  return Object.freeze({
    ok: true,
    root,
    workspace_root: workspaceRoot,
    source: "launcher_workspace_identity"
  });
}

function assertUnredirectedRootChain(workspaceRoot, root) {
  let current = workspaceRoot;
  for (const segment of path.relative(workspaceRoot, root).split(path.sep)) {
    current = path.join(current, segment);
    let info;
    try {
      info = lstatSync(current);
    } catch {

      return null;
    }
    if (info.isSymbolicLink()) {
      return refuse(
        LAUNCHER_DURABLE_STATE_CODES.ROOT_REDIRECTED,
        "launcher durable state root chain is redirected through a symbolic link"
      );
    }
    if (!info.isDirectory()) {
      return refuse(
        LAUNCHER_DURABLE_STATE_CODES.ROOT_REDIRECTED,
        "launcher durable state root chain is occupied by a non-directory"
      );
    }
  }
  return null;
}

export async function ensureLauncherOwnedWorkspaceDurableStateRoot(options = {}) {
  const resolved = resolveLauncherOwnedWorkspaceDurableStateRoot(options);
  if (resolved.ok !== true) return resolved;
  const redirected = assertUnredirectedRootChain(resolved.workspace_root, resolved.root);
  if (redirected !== null) return Object.freeze({ ...redirected, root: resolved.root });
  try {
    await mkdir(resolved.root, { recursive: true, mode: 0o700 });
    const probe = path.join(resolved.root, `.write-probe-${randomBytes(8).toString("hex")}`);
    const handle = await open(probe, "wx", 0o600);
    await handle.close();
    await rm(probe, { force: true });
  } catch (error) {
    return Object.freeze({
      ok: false,
      code: LAUNCHER_DURABLE_STATE_CODES.ROOT_UNWRITABLE,
      reason: `launcher durable state root is not writable (${error?.code ?? error?.message ?? error})`,
      root: resolved.root
    });
  }
  return Object.freeze({
    ok: true,
    dir: resolved.root,
    root: resolved.root,
    workspace_root: resolved.workspace_root,
    source: resolved.source
  });
}
