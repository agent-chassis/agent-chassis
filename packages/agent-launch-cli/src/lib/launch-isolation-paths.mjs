

import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  accessSync,
  closeSync,
  constants as fsConstants,
  fchmodSync,
  fstatSync,
  lstatSync,
  openSync,
  realpathSync,
  statSync,
  unlinkSync
} from "node:fs";
import {
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES,
  GLOB_CHARACTERS,
  assertAbsoluteSafePath,
  fail,
  isNonEmptyString,
  isWithinRepo
} from "./launch-isolation-errors.mjs";

export function assertExistingDirectory(p, label, code) {
  let st;
  try {
    st = statSync(p);
  } catch (err) {
    fail(
      code ?? BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_DIRECTORY,
      `${label} stat failed: ${p}`,
      { errno: err?.code ?? null }
    );
  }
  if (!st.isDirectory()) {
    fail(
      code ?? BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_DIRECTORY,
      `${label} must be an existing directory: ${p}`
    );
  }
}

export function assertExistingDirectoryOrSafeParent(p, label) {
  let st = null;
  try {
    st = statSync(p);
  } catch (err) {
    if (!err || (err.code !== "ENOENT" && err.code !== "ENOTDIR")) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_DIRECTORY,
        `${label} stat failed: ${p}`,
        { errno: err?.code ?? null }
      );
    }
  }
  if (st !== null) {
    if (!st.isDirectory()) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_DIRECTORY,
        `${label} exists but is not a directory: ${p}`
      );
    }
    return;
  }
  const parent = path.dirname(p);
  if (!parent || parent === p) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_MISSING_PARENT,
      `${label} has no usable parent: ${p}`
    );
  }
  let parentSt;
  try {
    parentSt = statSync(parent);
  } catch (err) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_MISSING_PARENT,
      `${label} parent missing: ${parent}`,
      { errno: err?.code ?? null }
    );
  }
  if (!parentSt.isDirectory()) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_MISSING_PARENT,
      `${label} parent is not a directory: ${parent}`
    );
  }
}

function assertExactFilePathHasNoSymlinkComponent(lexical, label, repoReal, {
  allowMissingLeaf = false
} = {}) {
  if (!isWithinRepo(lexical, repoReal) || lexical === repoReal) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_OUTSIDE_REPO,
      `${label} must be an exact file below the canonical repo root: ${lexical}`
    );
  }
  const relative = path.relative(repoReal, lexical);
  const components = relative.split(path.sep);
  let current = repoReal;
  for (let i = 0; i < components.length; i += 1) {
    current = path.join(current, components[i]);
    let st;
    try {
      st = lstatSync(current);
    } catch (err) {
      if (allowMissingLeaf && i === components.length - 1 && err?.code === "ENOENT") {
        return;
      }
      fail(
        i === components.length - 1 && err?.code !== "ENOTDIR"
          ? BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_FILE
          : BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_MISSING_PARENT,
        `${label} component could not be inspected: ${current}`,
        { errno: err?.code ?? null }
      );
    }
    if (st.isSymbolicLink()) {
      fail(
        i === components.length - 1
          ? BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_FILE
          : BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_OUTSIDE_REPO,
        `${label} refuses symlink component: ${current}`,
        { component: current }
      );
    }
  }
}

function identityFromStat(st) {
  return Object.freeze({
    dev: st.dev.toString(),
    ino: st.ino.toString(),
    size: st.size.toString(),
    mode: st.mode.toString(),
    mtimeNs: st.mtimeNs.toString(),
    ctimeNs: st.ctimeNs.toString()
  });
}

function fileIdentity(real) {
  return identityFromStat(statSync(real, { bigint: true }));
}

function sameFileIdentity(real, expected) {
  let lst;
  try {
    lst = lstatSync(real);
  } catch (err) {
    if (err?.code === "ENOENT") return false;
    throw err;
  }
  if (!lst.isFile() || lst.isSymbolicLink()) return false;
  const actual = fileIdentity(real);
  return Object.keys(expected).every((key) => actual[key] === expected[key]);
}

function buildWritableFilePrecreationCleanup(createdEntries, attemptBinding = null) {
  const attemptId = randomUUID();
  const owned = Object.freeze(createdEntries.map((entry) => Object.freeze({
    real: entry.real,
    identity: entry.identity
  })));
  let completed = false;
  let result = null;
  const cleanup = () => {
    if (completed) return result;
    const removed = [];
    const preserved = [];
    for (let i = owned.length - 1; i >= 0; i -= 1) {
      const entry = owned[i];
      if (!sameFileIdentity(entry.real, entry.identity)) {
        preserved.push(entry.real);
        continue;
      }
      try {
        unlinkSync(entry.real);
        removed.push(entry.real);
      } catch (err) {
        if (err?.code === "ENOENT") {
          preserved.push(entry.real);
          continue;
        }
        throw err;
      }
    }
    completed = true;
    result = Object.freeze({
      attempt_id: attemptId,
      removed: Object.freeze(removed),
      preserved: Object.freeze(preserved)
    });
    return result;
  };
  return Object.freeze({
    schema_version: "writable-file-precreation-cleanup.v1",
    attempt_id: attemptId,
    attempt_binding: attemptBinding,
    entries: owned,
    cleanup: Object.freeze(cleanup)
  });
}

function resolveWritableFileEntry(lexical, label, repoReal, { refuseSymlinks = false } = {}) {
  if (refuseSymlinks) {
    assertExactFilePathHasNoSymlinkComponent(lexical, label, repoReal, {
      allowMissingLeaf: true
    });
  }
  let lst = null;
  try {
    lst = lstatSync(lexical);
  } catch (err) {
    if (!err || (err.code !== "ENOENT" && err.code !== "ENOTDIR")) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_FILE,
        `${label} lstat failed: ${lexical}`,
        { errno: err?.code ?? null }
      );
    }
  }
  if (lst !== null) {

    let real;
    try {
      real = realpathSync(lexical);
    } catch (err) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_FILE,
        `${label} leaf could not be safely resolved (dangling symlink?): ${lexical}`,
        { errno: err?.code ?? null }
      );
    }
    if (!isWithinRepo(real, repoReal)) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_OUTSIDE_REPO,
        `${label} must resolve to repo or a repo descendant: lexical ${lexical} -> real ${real} (repo real ${repoReal})`
      );
    }
    let st;
    try {
      st = statSync(real);
    } catch (err) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_FILE,
        `${label} stat failed: ${real}`,
        { errno: err?.code ?? null }
      );
    }
    if (st.isDirectory()) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_FILE,
        `${label} must be a regular file, got directory: ${real}`
      );
    }
    if (!st.isFile()) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_FILE,
        `${label} must be a regular file: ${real}`
      );
    }
    try {
      accessSync(real, fsConstants.W_OK);
    } catch (err) {

      if (err && err.code === "EROFS") {
        fail(
          BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.WRITABLE_FILE_NAMESPACE_READ_ONLY,
          `${label} host file is not writable through the launcher's mount namespace (EROFS): ${real}`,
          { errno: err?.code ?? null, real, label }
        );
      }
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_FILE,
        `${label} host file is not writable by launcher: ${real}`,
        { errno: err?.code ?? null }
      );
    }
    return { real, precreated: false };
  }

  const parent = path.dirname(lexical);
  if (!parent || parent === lexical) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_MISSING_PARENT,
      `${label} has no usable parent: ${lexical}`
    );
  }
  let parentReal;
  try {
    parentReal = realpathSync(parent);
  } catch (err) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_MISSING_PARENT,
      `${label} parent could not be resolved: ${parent}`,
      { errno: err?.code ?? null }
    );
  }
  if (parentReal !== parent) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_OUTSIDE_REPO,
      `${label} parent aliases the canonical repository path: ${parent} -> ${parentReal}`
    );
  }
  let parentSt;
  try {
    parentSt = statSync(parentReal);
  } catch (err) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_MISSING_PARENT,
      `${label} parent stat failed: ${parentReal}`,
      { errno: err?.code ?? null }
    );
  }
  if (!parentSt.isDirectory()) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_MISSING_PARENT,
      `${label} parent is not a directory: ${parentReal}`
    );
  }
  const real = path.join(parentReal, path.basename(lexical));
  if (!isWithinRepo(real, repoReal)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_OUTSIDE_REPO,
      `${label} must resolve to repo or a repo descendant: lexical ${lexical} -> real ${real} (repo real ${repoReal})`
    );
  }

  let fd;
  try {
    fd = openSync(
      real,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
      0o644
    );
  } catch (err) {

    if (err && err.code === "EROFS") {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.WRITABLE_FILE_NAMESPACE_READ_ONLY,
        `${label} cannot be precreated through the launcher's mount namespace (EROFS): ${real}`,
        { errno: err?.code ?? null, real, label }
      );
    }
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_FILE,
      `${label} could not be precreated: ${real}`,
      { errno: err?.code ?? null }
    );
  }
  let identity;
  try {
    fchmodSync(fd, 0o644);
    identity = identityFromStat(fstatSync(fd, { bigint: true }));
    closeSync(fd);
    fd = undefined;
  } catch (err) {
    try { if (fd !== undefined) closeSync(fd); } catch {   }
    try {
      if (identity === undefined || sameFileIdentity(real, identity)) unlinkSync(real);
    } catch {   }
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_FILE,
      `${label} precreation finalization failed: ${real}`,
      { errno: err?.code ?? null }
    );
  }
  try {
    accessSync(real, fsConstants.W_OK);
    if (!sameFileIdentity(real, identity)) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_FILE,
        `${label} precreated file identity changed during planning: ${real}`
      );
    }
  } catch (err) {
    try {
      if (sameFileIdentity(real, identity)) unlinkSync(real);
    } catch {   }
    if (err instanceof Error && err.code === BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_FILE) {
      throw err;
    }
    if (err && err.code === "EROFS") {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.WRITABLE_FILE_NAMESPACE_READ_ONLY,
        `${label} precreated file is not writable through the launcher's mount namespace (EROFS): ${real}`,
        { errno: err?.code ?? null, real, label }
      );
    }
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_FILE,
      `${label} precreated file is not writable by launcher: ${real}`,
      { errno: err?.code ?? null }
    );
  }
  return { real, precreated: true, identity };
}

export function prepareWritableFiles(writableFiles, repoReal, {
  refuseSymlinks = false,
  attemptBinding = null
} = {}) {
  if (!Array.isArray(writableFiles)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
      "writableFiles must be an array"
    );
  }
  const out = [];
  const seen = new Set();
  const created = [];
  try {
    for (let i = 0; i < writableFiles.length; i += 1) {
      const lexical = assertAbsoluteSafePath(writableFiles[i], `writableFiles[${i}]`);
      const entry = resolveWritableFileEntry(lexical, `writableFiles[${i}]`, repoReal, {
        refuseSymlinks
      });
      if (seen.has(entry.real)) {
        if (entry.precreated) {
          created.push(entry);
        }
        continue;
      }
      seen.add(entry.real);
      out.push(entry);
      if (entry.precreated) created.push(entry);
    }
  } catch (error) {
    buildWritableFilePrecreationCleanup(created, attemptBinding).cleanup();
    throw error;
  }
  return Object.freeze({
    entries: Object.freeze(out),
    cleanup: buildWritableFilePrecreationCleanup(created, attemptBinding)
  });
}

export function realpathExisting(p, label, code) {
  try {
    return realpathSync(p);
  } catch (err) {
    fail(code, `${label} realpath failed: ${p}`, { errno: err?.code ?? null });
  }
  return null;
}

export function realpathExistingOrSafeParent(p, label, primaryCode = BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_DIRECTORY) {
  try {
    return realpathSync(p);
  } catch (err) {
    if (err && err.code !== "ENOENT" && err.code !== "ENOTDIR") {
      fail(primaryCode, `${label} realpath failed: ${p}`, { errno: err?.code ?? null });
    }
  }
  const parent = path.dirname(p);
  if (!parent || parent === p) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_MISSING_PARENT,
      `${label} has no usable parent: ${p}`
    );
  }
  let parentReal;
  try {
    parentReal = realpathSync(parent);
  } catch (err) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_MISSING_PARENT,
      `${label} parent could not be resolved: ${parent}`,
      { errno: err?.code ?? null }
    );
  }
  return path.join(parentReal, path.basename(p));
}

export function validateAndResolveCwd(cwd, repoReal) {
  if (!isNonEmptyString(cwd)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.CWD_INVALID,
      `cwd must be a non-empty string, got: ${typeof cwd}`
    );
  }
  if (!path.isAbsolute(cwd)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.CWD_INVALID,
      `cwd must be an absolute path: ${cwd}`
    );
  }
  if (GLOB_CHARACTERS.test(cwd)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.CWD_INVALID,
      `cwd must not contain glob characters: ${cwd}`
    );
  }
  for (const seg of cwd.split(path.sep)) {
    if (seg === "..") {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.CWD_INVALID,
        `cwd must not contain ".." segments: ${cwd}`
      );
    }
  }
  const normalized = path.normalize(cwd);
  if (normalized !== cwd && normalized + path.sep !== cwd) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.CWD_INVALID,
      `cwd must be in canonical form (got ${cwd}, normalized ${normalized})`
    );
  }
  const lexical = normalized.length > 1 && normalized.endsWith(path.sep)
    ? normalized.slice(0, -1)
    : normalized;
  let real;
  try {
    real = realpathSync(lexical);
  } catch (err) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.CWD_INVALID,
      `cwd could not be resolved: ${lexical}`,
      { errno: err?.code ?? null }
    );
  }
  let st;
  try {
    st = statSync(real);
  } catch (err) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.CWD_INVALID,
      `cwd stat failed: ${real}`,
      { errno: err?.code ?? null }
    );
  }
  if (!st.isDirectory()) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.CWD_INVALID,
      `cwd must resolve to a directory: ${real}`
    );
  }
  if (!isWithinRepo(real, repoReal)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.CWD_INVALID,
      `cwd must resolve to a path inside repo: lexical ${lexical} -> real ${real} (repo real ${repoReal})`
    );
  }
  return real;
}

export function normalizeBindEntry(entry, label) {
  if (typeof entry === "string") {
    const src = assertAbsoluteSafePath(entry, `${label}.src`);
    return { src, dst: src };
  }
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const allowedKeys = new Set(["src", "dst"]);
    for (const key of Object.keys(entry)) {
      if (!allowedKeys.has(key)) {
        fail(
          BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
          `${label} has unknown key: ${key}`
        );
      }
    }
    const src = assertAbsoluteSafePath(entry.src, `${label}.src`);
    const dst = entry.dst === undefined || entry.dst === null
      ? src
      : assertAbsoluteSafePath(entry.dst, `${label}.dst`);
    return { src, dst };
  }
  fail(
    BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
    `${label} must be an absolute path string or a { src, dst } object`
  );
  return null;
}
