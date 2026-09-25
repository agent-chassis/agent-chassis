

import path from "node:path";
import {
  accessSync,
  constants as fsConstants,
  realpathSync,
  statSync
} from "node:fs";
import { fileURLToPath } from "node:url";

import {
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES,
  fail,
  isNonEmptyString,
  isWithinRepo
} from "./launch-isolation-errors.mjs";
import { resolveBasenameOnPath } from "./launch-isolation-executable.mjs";
import {
  prependPathEntry,
  resolvePackageAssetExecutable
} from "./launch-isolation-package-asset.mjs";
import {
  CONTROLLED_CONTRACT_PRIVATE_PATH_ROOT
} from "@agent-chassis/wiki-core/src/lib/controlled-contract-private-path-policy.mjs";

export const GIT_STATUS_WRAPPER_MOUNT_DIR = "/agent-launch-git-status-wrapper";

export const GIT_STATUS_WRAPPER_REAL_GIT_ENV_KEY = "AGENT_LAUNCH_GIT_REAL";
export const GIT_STATUS_WRAPPER_REPO_ENV_KEY = "AGENT_LAUNCH_GIT_STATUS_FILTER_REPO";
export const GIT_STATUS_WRAPPER_PATHSPEC_ENV_KEY =
  "AGENT_LAUNCH_GIT_STATUS_FILTER_PATHSPEC";

export const GIT_STATUS_WRAPPER_PATHSPEC =
  `:(top,exclude)${CONTROLLED_CONTRACT_PRIVATE_PATH_ROOT}`;

export const GIT_STATUS_WRAPPER_ASSET_DIR = fileURLToPath(
  new URL("./git-status-wrapper", import.meta.url)
);

const GIT_EXECUTABLE_NAME = "git";

function assetExecutable() {
  return resolvePackageAssetExecutable(GIT_STATUS_WRAPPER_ASSET_DIR, GIT_EXECUTABLE_NAME,
    ({ asset, errno, reason }) => fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.GIT_STATUS_WRAPPER_ASSET_UNAVAILABLE,
      reason === "unavailable"
        ? `launcher Git status wrapper asset is unavailable: ${asset}`
        : `launcher Git status wrapper asset is not a regular executable file: ${asset}`,
      reason === "unavailable" ? { asset, errno } : { asset }
    ));
}

function resolveRealGit(pathEnv, systemRoots) {
  const candidate = resolveBasenameOnPath(GIT_EXECUTABLE_NAME, pathEnv);
  if (candidate === null) return null;
  let real;
  try {
    real = realpathSync(candidate);
    if (!statSync(real).isFile()) return null;
    accessSync(real, fsConstants.X_OK);
  } catch {
    return null;
  }
  const visible = systemRoots.some(
    (root) => real === root || isWithinRepo(real, root)
  );
  if (!visible) return null;
  if (
    real === path.join(GIT_STATUS_WRAPPER_ASSET_DIR, GIT_EXECUTABLE_NAME)
    || isWithinRepo(real, GIT_STATUS_WRAPPER_ASSET_DIR)
    || isWithinRepo(real, GIT_STATUS_WRAPPER_MOUNT_DIR)
  ) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.GIT_STATUS_WRAPPER_ASSET_UNAVAILABLE,
      `resolved Git executable is the launcher wrapper itself: ${real}`,
      { realGit: real }
    );
  }
  return real;
}

export function prepareGitStatusWrapperProjection({
  requested = false,
  repoReal,
  privateReadOnlyMaskDirs = [],
  sparseWorkerNamespace = null,
  env = null,
  envPolicy = null,
  systemRoots = []
} = {}) {
  if (requested !== true) return null;
  if (!Array.isArray(privateReadOnlyMaskDirs) || privateReadOnlyMaskDirs.length === 0) {
    return null;
  }
  if (sparseWorkerNamespace !== null) return null;
  if (env === null || env === undefined || typeof env !== "object" || Array.isArray(env)) {
    return null;
  }
  if (!isNonEmptyString(env.PATH)) return null;
  const allow = envPolicy === null || envPolicy === undefined ? null : envPolicy.allow;
  if (Array.isArray(allow) && !allow.includes("PATH")) return null;

  const realGit = resolveRealGit(env.PATH, systemRoots);
  if (realGit === null) return null;

  const asset = assetExecutable();
  const wrapperEnv = {
    ...env,
    PATH: prependPathEntry(env.PATH, GIT_STATUS_WRAPPER_MOUNT_DIR),
    [GIT_STATUS_WRAPPER_REAL_GIT_ENV_KEY]: realGit,
    [GIT_STATUS_WRAPPER_REPO_ENV_KEY]: repoReal,
    [GIT_STATUS_WRAPPER_PATHSPEC_ENV_KEY]: GIT_STATUS_WRAPPER_PATHSPEC
  };

  const wrapperEnvPolicy = Array.isArray(allow)
    ? {
        ...envPolicy,
        allow: [
          ...allow,
          GIT_STATUS_WRAPPER_REAL_GIT_ENV_KEY,
          GIT_STATUS_WRAPPER_REPO_ENV_KEY,
          GIT_STATUS_WRAPPER_PATHSPEC_ENV_KEY
        ]
      }
    : envPolicy;

  return Object.freeze({
    readOnlyBinds: Object.freeze([
      Object.freeze({ src: GIT_STATUS_WRAPPER_ASSET_DIR, dst: GIT_STATUS_WRAPPER_MOUNT_DIR })
    ]),
    env: wrapperEnv,
    envPolicy: wrapperEnvPolicy,
    mountDir: GIT_STATUS_WRAPPER_MOUNT_DIR,
    asset,
    realGit,
    repo: repoReal,
    pathspec: GIT_STATUS_WRAPPER_PATHSPEC
  });
}
