

import path from "node:path";
import {
  accessSync,
  closeSync,
  constants as fsConstants,
  fchmodSync,
  lstatSync,
  openSync,
  realpathSync,
  statSync
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

function resolveWritableFileEntry(lexical, label, repoReal) {
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
  try {
    fchmodSync(fd, 0o644);
  } catch {

  }
  try { closeSync(fd); } catch {   }
  try {
    accessSync(real, fsConstants.W_OK);
  } catch (err) {
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
  return { real, precreated: true };
}

export function prepareWritableFiles(writableFiles, repoReal) {
  if (!Array.isArray(writableFiles)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
      "writableFiles must be an array"
    );
  }
  const out = [];
  const seen = new Set();
  for (let i = 0; i < writableFiles.length; i += 1) {
    const lexical = assertAbsoluteSafePath(writableFiles[i], `writableFiles[${i}]`);
    const entry = resolveWritableFileEntry(lexical, `writableFiles[${i}]`, repoReal);
    if (seen.has(entry.real)) continue;
    seen.add(entry.real);
    out.push(entry);
  }
  return out;
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
