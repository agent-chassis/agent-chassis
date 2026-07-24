import {
  accessSync,
  constants as fsConstants,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  statSync
} from "node:fs";
import path from "node:path";

import {
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES,
  assertAbsoluteSafePath,
  fail,
  isWithinRepo
} from "./launch-isolation-errors.mjs";

const FILE_IDENTITY_KEYS = Object.freeze([
  "dev",
  "ino",
  "size",
  "mode",
  "mtimeNs",
  "ctimeNs"
]);

function fileIdentity(lexical) {
  const stats = statSync(lexical, { bigint: true });
  return Object.freeze({
    dev: stats.dev.toString(),
    ino: stats.ino.toString(),
    size: stats.size.toString(),
    mode: stats.mode.toString(),
    mtimeNs: stats.mtimeNs.toString(),
    ctimeNs: stats.ctimeNs.toString()
  });
}

function inspectRequiredReadOnlyFile(lexical, label) {
  let stats;
  try {
    stats = lstatSync(lexical);
  } catch (error) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_FILE,
      `${label} must be an existing readable regular file: ${lexical}`,
      { errno: error?.code ?? null }
    );
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_FILE,
      `${label} must be a regular file and may not be a symlink: ${lexical}`
    );
  }
  let real;
  try {
    real = realpathSync(lexical);
  } catch (error) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_FILE,
      `${label} realpath failed: ${lexical}`,
      { errno: error?.code ?? null }
    );
  }
  if (real !== lexical) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_FILE,
      `${label} may not contain symlink-substituted path components: ${lexical} -> ${real}`
    );
  }
  try {
    accessSync(lexical, fsConstants.R_OK);
  } catch (error) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_FILE,
      `${label} must be readable: ${lexical}`,
      { errno: error?.code ?? null }
    );
  }
  return Object.freeze({ path: lexical, identity: fileIdentity(lexical) });
}

function sameIdentity(left, right) {
  return FILE_IDENTITY_KEYS.every(
    (key) => typeof left?.[key] === "string" && left[key] === right?.[key]
  );
}

export function prepareRequiredReadOnlyFiles(requiredReadOnlyFiles, readOnlyBinds) {
  if (!Array.isArray(requiredReadOnlyFiles)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
      "requiredReadOnlyFiles must be an array"
    );
  }
  const readOnly = Array.isArray(readOnlyBinds) ? readOnlyBinds : [];
  const entries = [];
  const seen = new Set();
  for (let i = 0; i < requiredReadOnlyFiles.length; i += 1) {
    const lexical = assertAbsoluteSafePath(
      requiredReadOnlyFiles[i],
      `requiredReadOnlyFiles[${i}]`
    );
    if (seen.has(lexical)) continue;
    if (!readOnly.some(({ src, dst }) => src === lexical && dst === lexical)) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PLAN_INVALID,
        `requiredReadOnlyFiles[${i}] must have one exact read-only bind: ${lexical}`
      );
    }
    seen.add(lexical);
    entries.push(inspectRequiredReadOnlyFile(lexical, `requiredReadOnlyFiles[${i}]`));
  }
  return Object.freeze(entries);
}

export function assertRequiredReadOnlyFilesUnchanged(entries) {
  if (!Array.isArray(entries)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PLAN_INVALID,
      "requiredReadOnlyFiles plan state must be an array"
    );
  }
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (!entry || typeof entry !== "object" || typeof entry.path !== "string") {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PLAN_INVALID,
        `requiredReadOnlyFiles[${i}] has invalid pinned identity state`
      );
    }
    const current = inspectRequiredReadOnlyFile(entry.path, `requiredReadOnlyFiles[${i}]`);
    if (!sameIdentity(entry.identity, current.identity)) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_FILE,
        `requiredReadOnlyFiles[${i}] changed after planning: ${entry.path}`
      );
    }
  }
}

function projectionMountpointIdentity(dst) {
  const stats = statSync(dst, { bigint: true });
  return Object.freeze({
    dev: stats.dev.toString(),
    ino: stats.ino.toString()
  });
}

function inspectProjectionMountpoint(dst) {
  let lst;
  try {
    lst = lstatSync(dst);
  } catch (error) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_DIRECTORY,
      `read-only projection mountpoint must exist as a directory: ${dst}`,
      { errno: error?.code ?? null }
    );
  }
  if (lst.isSymbolicLink() || !lst.isDirectory()) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_DIRECTORY,
      `read-only projection mountpoint must be a real directory and may not be a symlink: ${dst}`
    );
  }
  let real;
  try {
    real = realpathSync(dst);
  } catch (error) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_DIRECTORY,
      `read-only projection mountpoint realpath failed: ${dst}`,
      { errno: error?.code ?? null }
    );
  }
  if (real !== dst) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_OUTSIDE_REPO,
      `read-only projection mountpoint may not contain symlink-substituted components: ${dst} -> ${real}`
    );
  }
  if (readdirSync(dst).length !== 0) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_DIRECTORY,
      `read-only projection mountpoint must be empty: ${dst}`
    );
  }
  return Object.freeze({ path: dst, identity: projectionMountpointIdentity(dst) });
}

function assertNoSymlinkAncestorWithinRepo(dst, repoReal) {
  const relative = path.relative(repoReal, dst);
  const components = relative.split(path.sep);
  let current = repoReal;
  for (let i = 0; i < components.length - 1; i += 1) {
    current = path.join(current, components[i]);
    let st;
    try {
      st = lstatSync(current);
    } catch (error) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_DIRECTORY,
        `read-only projection mountpoint ancestor could not be inspected: ${current}`,
        { errno: error?.code ?? null }
      );
    }
    if (st.isSymbolicLink() || !st.isDirectory()) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_OUTSIDE_REPO,
        `read-only projection mountpoint ancestor is redirected or not a directory: ${current}`
      );
    }
  }
}

function pathsOverlap(a, b) {
  return a === b || isWithinRepo(a, b) || isWithinRepo(b, a);
}

function assertNoWritableRuntimeOverlap(dst, src, repoReal, {
  writableRoots,
  runtimeRoots,
  writableFiles
}) {
  const mutablePaths = [
    ...(Array.isArray(writableRoots) ? writableRoots : []),
    ...(Array.isArray(runtimeRoots) ? runtimeRoots : []),
    ...(Array.isArray(writableFiles)
      ? writableFiles.map((entry) => (typeof entry === "string" ? entry : entry?.real)).filter(Boolean)
      : [])
  ];
  for (const mutable of mutablePaths) {
    if (typeof mutable !== "string" || mutable.length === 0) continue;
    for (const guarded of [repoReal, dst, src]) {
      if (pathsOverlap(mutable, guarded)) {
        fail(
          BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_OUTSIDE_REPO,
          "a writable or runtime bind overlaps the candidate checkout, dependency "
            + `projection destination, or dependency source: ${mutable}`,
          { mutable, guarded }
        );
      }
    }
  }
}

export function prepareReadOnlyProjectionMountpoints(readOnlyBinds, {
  repoReal,
  writableRoots = [],
  runtimeRoots = [],
  writableFiles = [],
  sparseWorkerNamespace = null
} = {}) {
  if (!Array.isArray(readOnlyBinds)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PLAN_INVALID,
      "read-only binds must be an array for projection mountpoint preparation"
    );
  }

  if (typeof repoReal !== "string" || repoReal.length === 0 || sparseWorkerNamespace !== null) {
    return Object.freeze([]);
  }
  const entries = [];
  const createdPaths = [];
  const seen = new Set();
  try {
    for (const bind of readOnlyBinds) {
      const dst = bind?.dst;
      const src = bind?.src;
      if (typeof dst !== "string" || typeof src !== "string") continue;
      if (dst === repoReal || src === dst || !isWithinRepo(dst, repoReal)) continue;

      let srcStat;
      try {
        srcStat = statSync(src);
      } catch {
        continue;
      }
      if (!srcStat.isDirectory()) continue;
      assertAbsoluteSafePath(dst, "readOnlyProjectionMountpoint.dst");
      if (seen.has(dst)) continue;
      seen.add(dst);
      assertNoSymlinkAncestorWithinRepo(dst, repoReal);
      assertNoWritableRuntimeOverlap(dst, src, repoReal, { writableRoots, runtimeRoots, writableFiles });
      let present = true;
      try {
        lstatSync(dst);
      } catch (error) {
        if (error?.code === "ENOENT") {
          present = false;
        } else {
          fail(
            BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_DIRECTORY,
            `read-only projection mountpoint could not be inspected: ${dst}`,
            { errno: error?.code ?? null }
          );
        }
      }
      if (!present) {
        try {
          mkdirSync(dst, { mode: 0o700 });
          createdPaths.push(dst);
        } catch (error) {
          if (error?.code !== "EEXIST") {
            fail(
              BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_DIRECTORY,
              `read-only projection mountpoint could not be created: ${dst}`,
              { errno: error?.code ?? null }
            );
          }
        }
      }

      entries.push(Object.freeze({ ...inspectProjectionMountpoint(dst), src }));
    }
  } catch (error) {
    for (let i = createdPaths.length - 1; i >= 0; i -= 1) {
      try {
        rmdirSync(createdPaths[i]);
      } catch {

      }
    }
    throw error;
  }
  return Object.freeze(entries);
}

export function assertReadOnlyProjectionMountpointsUnchanged(entries) {
  if (!Array.isArray(entries)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PLAN_INVALID,
      "read-only projection mountpoint plan state must be an array"
    );
  }
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || typeof entry.path !== "string" || !entry.identity) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PLAN_INVALID,
        "read-only projection mountpoint has invalid pinned identity state"
      );
    }
    const current = inspectProjectionMountpoint(entry.path);
    if (current.identity.dev !== entry.identity.dev || current.identity.ino !== entry.identity.ino) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_DIRECTORY,
        `read-only projection mountpoint identity changed after planning: ${entry.path}`
      );
    }
  }
}
