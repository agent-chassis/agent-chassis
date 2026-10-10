

import path from "node:path";
import {
  accessSync,
  constants as fsConstants,
  lstatSync,
  readFileSync,
  realpathSync,
  statSync
} from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES,
  GLOB_CHARACTERS,
  fail,
  isNonEmptyString,
  isWithinRepo
} from "./launch-isolation-errors.mjs";
import { resolvePackageAssetExecutable } from "./launch-isolation-package-asset.mjs";

export const GIT_STATUS_WRAPPER_MOUNT_DIR = "/agent-launch-git-status-wrapper";

export const GIT_STATUS_WRAPPER_ASSET_DIR = fileURLToPath(
  new URL("./git-status-wrapper", import.meta.url)
);

export const GIT_STATUS_WRAPPER_COMMAND_DIRECTORIES = Object.freeze([
  "/usr/local/sbin",
  "/usr/local/bin",
  "/usr/sbin",
  "/usr/bin",
  "/sbin",
  "/bin"
]);

const GIT_EXECUTABLE_NAME = "git";
const GIT_STATUS_BUILTIN_NAME = "git-status";

const INSTALLATION_EXECUTABLE_DIRECTORIES = Object.freeze([
  "libexec/git-core",
  "lib/git-core",
  "libexec/git",
  "bin",
  "git"
]);

const INSTALLATION_RESOURCE_DIRECTORIES = Object.freeze([
  "libexec",
  "lib",
  "lib64",
  "share",
  "etc"
]);

const MAX_ORIGINALS = 16;
const EXEC_PATH_PROBE_TIMEOUT_MS = 5000;

const CODES = BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES;

function assetExecutable() {
  return resolvePackageAssetExecutable(GIT_STATUS_WRAPPER_ASSET_DIR, GIT_EXECUTABLE_NAME,
    ({ asset, errno, reason }) => fail(
      CODES.GIT_STATUS_WRAPPER_ASSET_UNAVAILABLE,
      reason === "unavailable"
        ? `launcher Git status wrapper asset is unavailable: ${asset}`
        : `launcher Git status wrapper asset is not a regular executable file: ${asset}`,
      reason === "unavailable" ? { asset, errno } : { asset }
    ));
}

function covers(ancestor, target) {
  return ancestor === path.sep || isWithinRepo(target, ancestor);
}

function namespaceViews(systemRoots) {
  const views = [];
  for (const root of systemRoots) {
    try {
      const real = realpathSync(root);
      if (statSync(real).isDirectory()) views.push({ root, real });
    } catch {

    }
  }
  return views;
}

function hostPathOfNamespacePath(namespacePath, views) {
  let host = null;
  for (const { root, real } of views) {
    if (covers(root, namespacePath)) {
      host = path.join(real, path.relative(root, namespacePath));
    }
  }
  return host;
}

function namespacePathsOf(hostReal, views) {
  const out = [];
  for (const { root, real } of views) {
    if (!covers(real, hostReal)) continue;
    const candidate = path.join(root, path.relative(real, hostReal));
    if (out.includes(candidate)) continue;
    const shown = hostPathOfNamespacePath(candidate, views);
    let shownReal = null;
    try {
      shownReal = shown === null ? null : realpathSync(shown);
    } catch {
      shownReal = null;
    }
    if (shownReal === hostReal) out.push(candidate);
  }
  return out;
}

function commandDirectory(entry) {
  if (!isNonEmptyString(entry) || !path.isAbsolute(entry)) return null;
  if (GLOB_CHARACTERS.test(entry) || entry.includes("\n")) return null;
  const normalized = path.normalize(entry);
  return normalized.length > 1 && normalized.endsWith(path.sep)
    ? normalized.slice(0, -1)
    : normalized;
}

function isExecutableFile(real) {
  try {
    if (!statSync(real).isFile()) return false;
    accessSync(real, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function probeExecPath(real) {
  const probe = spawnSync(real, ["--exec-path"], {
    cwd: path.sep,
    env: { PATH: "/usr/bin:/bin", LC_ALL: "C" },
    stdio: ["ignore", "pipe", "ignore"],
    timeout: EXEC_PATH_PROBE_TIMEOUT_MS,
    killSignal: "SIGKILL",
    maxBuffer: 64 * 1024
  });
  const answer = probe.error || probe.status !== 0
    ? null
    : probe.stdout.toString("utf8").replace(/\n$/u, "");
  if (answer === null || commandDirectory(answer) === null) {
    fail(
      CODES.GIT_STATUS_WRAPPER_ORIGINAL_INVALID,
      `Git executable did not report an absolute exec path for \`--exec-path\`: ${real}; `
        + "remove or repair that executable, or take its directory off the launch PATH",
      {
        git: real,
        errno: probe.error?.code ?? null,
        status: probe.status ?? null,
        signal: probe.signal ?? null
      }
    );
  }
  return commandDirectory(answer);
}

function isWrapperAsset(real, asset) {
  if (real === asset.path || isWithinRepo(real, GIT_STATUS_WRAPPER_ASSET_DIR)) return true;
  if (isWithinRepo(real, GIT_STATUS_WRAPPER_MOUNT_DIR)) return true;
  let stat;
  try {
    stat = statSync(real);
  } catch {
    return false;
  }
  if (stat.dev === asset.stat.dev && stat.ino === asset.stat.ino) return true;
  if (stat.size !== asset.stat.size) return false;
  try {
    return readFileSync(real).equals(asset.bytes);
  } catch {
    return false;
  }
}

function preservationLayout(id, real) {
  const directory = path.dirname(real);
  const base = path.join(GIT_STATUS_WRAPPER_MOUNT_DIR, "originals", String(id));
  for (const suffix of INSTALLATION_EXECUTABLE_DIRECTORIES) {
    const tail = path.sep + suffix;
    if (!directory.endsWith(tail)) continue;
    const prefix = directory.slice(0, -tail.length) || path.sep;
    const resources = [];
    for (const name of INSTALLATION_RESOURCE_DIRECTORIES) {
      const target = path.join(prefix, name);
      try {
        lstatSync(target);
      } catch {
        continue;
      }
      resources.push(Object.freeze({ link: path.join(base, name), target }));
    }
    return { prefix, directory: path.join(base, "bin"), resources };
  }
  return { prefix: null, directory: base, resources: [] };
}

function inventory({ env, repoReal, views, asset }) {
  const originals = new Map();
  const mounts = new Map();
  const entrypoints = new Map();
  const queued = [];
  const enqueue = (entry) => {
    const directory = commandDirectory(entry);
    if (directory !== null && !queued.includes(directory)) queued.push(directory);
  };

  if (isNonEmptyString(env?.PATH)) {
    for (const entry of env.PATH.split(path.delimiter)) enqueue(entry);
  }
  if (isNonEmptyString(env?.GIT_EXEC_PATH)) enqueue(env.GIT_EXEC_PATH);
  for (const entry of GIT_STATUS_WRAPPER_COMMAND_DIRECTORIES) enqueue(entry);

  const resolveEntry = (directory, name) => {
    if (hostPathOfNamespacePath(directory, views) === null) return null;
    const candidate = path.join(directory, name);
    let real;
    try {
      real = realpathSync(candidate);
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
      fail(
        CODES.GIT_STATUS_WRAPPER_ORIGINAL_INVALID,
        `Git executable entrypoint cannot be resolved to a real file: ${candidate}; `
          + "repair that path or take its directory off the launch PATH",
        { entrypoint: candidate, errno: error?.code ?? null }
      );
    }
    if (!isExecutableFile(real) || isWithinRepo(real, repoReal)) return null;
    if (GLOB_CHARACTERS.test(real) || real.includes("\n")) {
      fail(
        CODES.GIT_STATUS_WRAPPER_ORIGINAL_INVALID,
        `Git executable path cannot be bound safely (glob or newline characters): ${real}`,
        { entrypoint: candidate, git: real }
      );
    }
    if (isWrapperAsset(real, asset)) {
      fail(
        CODES.GIT_STATUS_WRAPPER_RECURSION,
        `Git executable entrypoint is the launcher wrapper itself: ${candidate} resolves to ${real}; `
          + "the launcher cannot preserve an original Git behind its own wrapper",
        { entrypoint: candidate, git: real }
      );
    }
    return namespacePathsOf(real, views).length === 0 ? null : real;
  };

  const entrypointPaths = (directory) => {
    let directoryReal;
    try {
      directoryReal = realpathSync(directory);
    } catch {
      return [];
    }
    return namespacePathsOf(directoryReal, views)
      .map((shown) => path.join(shown, GIT_EXECUTABLE_NAME));
  };

  for (let index = 0; index < queued.length; index += 1) {
    const directory = queued[index];
    const real = resolveEntry(directory, GIT_EXECUTABLE_NAME);
    if (real === null) continue;
    let original = originals.get(real);
    if (original === undefined) {
      if (originals.size >= MAX_ORIGINALS) {
        fail(
          CODES.GIT_STATUS_WRAPPER_ORIGINAL_INVALID,
          `more than ${MAX_ORIGINALS} distinct Git executables are reachable from the launch PATH `
            + "and the system command directories; shorten the launch PATH",
          { originals: [...originals.keys()] }
        );
      }
      const stat = statSync(real);
      const id = originals.size;
      const layout = preservationLayout(id, real);
      original = {
        id,
        source: real,
        device: stat.dev,
        inode: stat.ino,
        execPath: probeExecPath(real),
        prefix: layout.prefix,
        directory: layout.directory,
        preserved: path.join(layout.directory, GIT_EXECUTABLE_NAME),
        resources: layout.resources
      };
      originals.set(real, original);
      enqueue(original.execPath);
    }
    for (const shown of namespacePathsOf(real, views)) mounts.set(shown, original);
    for (const entrypoint of [...namespacePathsOf(real, views), ...entrypointPaths(directory)]) {
      if (!entrypoints.has(entrypoint)) entrypoints.set(entrypoint, original);
    }
  }

  for (const original of [...originals.values()]) {
    const beside = entrypointPaths(original.execPath).find((entry) => entrypoints.has(entry));
    if (beside === undefined) continue;
    const real = resolveEntry(original.execPath, GIT_STATUS_BUILTIN_NAME);
    if (real === null || originals.has(real)) continue;
    for (const shown of namespacePathsOf(real, views)) {
      if (!mounts.has(shown)) mounts.set(shown, entrypoints.get(beside));
    }
  }

  return { originals: [...originals.values()], mounts, entrypoints };
}

function assertNoMountCollision({ mounts, precedingBinds, maskDestinations, reservedDestinations }) {
  const collide = (message, detail) => fail(
    CODES.GIT_STATUS_WRAPPER_MOUNT_COLLISION,
    `${message}; remove the conflicting mount from the launch or take the Git executable's `
      + "directory off the launch PATH",
    detail
  );
  const others = [
    ...precedingBinds.map(({ dst }) => dst),
    ...maskDestinations,
    ...reservedDestinations
  ];
  for (const destination of others) {
    if (
      isWithinRepo(destination, GIT_STATUS_WRAPPER_MOUNT_DIR)
      || (destination !== path.sep && isWithinRepo(GIT_STATUS_WRAPPER_MOUNT_DIR, destination))
    ) {
      collide(
        `a launch mount overlaps the launcher-owned Git root ${GIT_STATUS_WRAPPER_MOUNT_DIR}: ${destination}`,
        { root: GIT_STATUS_WRAPPER_MOUNT_DIR, mount: destination }
      );
    }
  }
  for (const entrypoint of mounts.keys()) {
    for (const { src, dst } of precedingBinds) {
      if (covers(dst, entrypoint) && src !== dst) {
        collide(
          `the Git executable entrypoint ${entrypoint} is replaced by a launch mount of ${src} at ${dst}, `
            + "so the host executable at that path is not what the namespace shows",
          { entrypoint, mount: dst, source: src }
        );
      }
    }
    for (const mask of maskDestinations) {
      if (covers(mask, entrypoint)) {
        collide(
          `the Git executable entrypoint ${entrypoint} lies under the final confidentiality mask ${mask}, `
            + "which takes precedence over the wrapper",
          { entrypoint, mask }
        );
      }
    }
  }
}

export function prepareGitStatusWrapperProjection({
  requested = false,
  repoReal,
  privateReadOnlyMaskDirs = [],
  sparseWorkerNamespace = null,
  env = null,
  systemRoots = [],
  precedingBinds = [],
  maskDestinations = [],
  reservedDestinations = []
} = {}) {
  if (requested !== true) return null;
  if (!Array.isArray(privateReadOnlyMaskDirs) || privateReadOnlyMaskDirs.length === 0) {
    return null;
  }
  if (sparseWorkerNamespace !== null) return null;

  const assetPath = assetExecutable();
  const asset = { path: assetPath, stat: statSync(assetPath), bytes: readFileSync(assetPath) };
  const childEnv = env !== null && typeof env === "object" && !Array.isArray(env) ? env : null;
  const views = namespaceViews(systemRoots);
  const { originals, mounts, entrypoints } = inventory({ env: childEnv, repoReal, views, asset });
  if (originals.length === 0) return null;

  for (const excluded of privateReadOnlyMaskDirs) {
    if (excluded === repoReal || !isWithinRepo(excluded, repoReal)) {
      fail(
        CODES.GIT_STATUS_WRAPPER_MOUNT_COLLISION,
        `the private-family overlay ${excluded} is not below the designated repository ${repoReal}, `
          + "so it cannot be excluded from that repository's status",
        { excluded, repository: repoReal }
      );
    }
  }
  assertNoMountCollision({
    mounts,
    precedingBinds,
    maskDestinations: [...maskDestinations, ...privateReadOnlyMaskDirs],
    reservedDestinations: [...systemRoots, ...reservedDestinations]
  });

  return Object.freeze({
    mountDir: GIT_STATUS_WRAPPER_MOUNT_DIR,
    asset: assetPath,
    repo: repoReal,
    excluded: Object.freeze([...privateReadOnlyMaskDirs]),
    originals: Object.freeze(originals.map((original) => Object.freeze({
      source: original.source,
      device: original.device,
      inode: original.inode,
      execPath: original.execPath,
      prefix: original.prefix,
      preserved: original.preserved,
      resources: Object.freeze(original.resources)
    }))),

    mounts: Object.freeze([...mounts].map(([entrypoint, original]) => Object.freeze({
      entrypoint,
      original: original.preserved
    }))),

    entrypoints: Object.freeze([...entrypoints].map(([entrypoint, original]) => Object.freeze({
      entrypoint,
      original: original.preserved,
      directory: original.directory
    })))
  });
}

export function projectGitStatusWrapperNamespaceArgs(projection) {
  if (projection === null) return [];
  const root = projection.mountDir;
  const args = ["--tmpfs", root, "--symlink", projection.repo, path.join(root, "repository")];
  projection.excluded.forEach((excluded, index) => {
    args.push("--symlink", excluded, path.join(root, "excluded", String(index)));
  });
  for (const original of projection.originals) {
    args.push("--ro-bind", original.source, original.preserved);
    for (const { link, target } of original.resources) {
      args.push("--symlink", target, link);
    }
  }
  for (const { entrypoint, directory } of projection.entrypoints) {
    args.push("--symlink", directory, path.join(root, "entrypoints", entrypoint));
  }
  args.push("--remount-ro", root);
  for (const { entrypoint } of projection.mounts) {
    args.push("--ro-bind", projection.asset, entrypoint);
  }
  return args;
}
