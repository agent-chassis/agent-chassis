import path from "node:path";
import {
  accessSync,
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync
} from "node:fs";

import {
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES,
  assertAbsoluteSafePath,
  fail,
  isWithinRepo
} from "./launch-isolation-errors.mjs";

const IDENTITY_KEYS = Object.freeze([
  "dev",
  "ino",
  "size",
  "mode",
  "mtimeNs",
  "ctimeNs"
]);

function identityFromStats(stats) {
  return Object.freeze({
    dev: stats.dev.toString(),
    ino: stats.ino.toString(),
    size: stats.size.toString(),
    mode: stats.mode.toString(),
    mtimeNs: stats.mtimeNs.toString(),
    ctimeNs: stats.ctimeNs.toString()
  });
}

function sameIdentity(left, right) {
  return IDENTITY_KEYS.every(
    (key) => typeof left?.[key] === "string" && left[key] === right?.[key]
  );
}

function samePinnedPathObject(kind, left, right) {
  const keys = kind === "directory"
    ? ["dev", "ino", "mode"]
    : IDENTITY_KEYS;
  return keys.every(
    (key) => typeof left?.[key] === "string" && left[key] === right?.[key]
  );
}

function refuseInvalid(message, detail = null) {
  fail(
    BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.FINDINGS_GIT_METADATA_INVALID,
    message,
    detail
  );
}

function inspectExactPath(lexicalInput, kind, label) {
  const lexical = assertAbsoluteSafePath(lexicalInput, label);
  let lst;
  try {
    lst = lstatSync(lexical);
  } catch (error) {
    refuseInvalid(`${label} is missing or inaccessible: ${lexical}`, {
      path: lexical,
      expected_type: kind,
      errno: error?.code ?? null
    });
  }
  if (lst.isSymbolicLink() || (kind === "file" ? !lst.isFile() : !lst.isDirectory())) {
    refuseInvalid(`${label} must be a real ${kind}, never a symlink: ${lexical}`, {
      path: lexical,
      expected_type: kind
    });
  }
  let real;
  try {
    real = realpathSync(lexical);
  } catch (error) {
    refuseInvalid(`${label} could not be canonically resolved: ${lexical}`, {
      path: lexical,
      expected_type: kind,
      errno: error?.code ?? null
    });
  }
  if (real !== lexical) {
    refuseInvalid(`${label} may not contain symlink-substituted components: ${lexical} -> ${real}`, {
      path: lexical,
      real
    });
  }
  try {
    accessSync(
      lexical,
      kind === "directory" ? fsConstants.R_OK | fsConstants.X_OK : fsConstants.R_OK
    );
  } catch (error) {
    refuseInvalid(`${label} must be readable: ${lexical}`, {
      path: lexical,
      expected_type: kind,
      errno: error?.code ?? null
    });
  }
  let identityStats;
  try {
    identityStats = statSync(lexical, { bigint: true });
  } catch (error) {
    refuseInvalid(`${label} identity could not be read: ${lexical}`, {
      path: lexical,
      expected_type: kind,
      errno: error?.code ?? null
    });
  }
  return Object.freeze({
    path: lexical,
    kind,
    identity: identityFromStats(identityStats)
  });
}

function readPinnedTextFile(lexical, label) {
  const inspected = inspectExactPath(lexical, "file", label);
  let fd;
  try {
    fd = openSync(lexical, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const before = identityFromStats(fstatSync(fd, { bigint: true }));
    const text = readFileSync(fd, "utf8");
    const after = identityFromStats(fstatSync(fd, { bigint: true }));
    if (!sameIdentity(inspected.identity, before) || !sameIdentity(before, after)) {
      refuseInvalid(`${label} changed while it was being resolved: ${lexical}`, {
        path: lexical
      });
    }
    return Object.freeze({ pin: inspected, text });
  } catch (error) {
    if (error?.code === BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.FINDINGS_GIT_METADATA_INVALID) {
      throw error;
    }
    refuseInvalid(`${label} could not be read from its pinned object: ${lexical}`, {
      path: lexical,
      errno: error?.code ?? null
    });
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return null;
}

function resolveReference(reference, baseDir, label) {
  if (typeof reference !== "string" || reference.length === 0 || reference.includes("\0")) {
    refuseInvalid(`${label} must name one non-empty filesystem path`);
  }
  const resolved = path.isAbsolute(reference)
    ? path.normalize(reference)
    : path.resolve(baseDir, reference);
  return assertAbsoluteSafePath(resolved, label);
}

function parseSingleLine(text, label) {
  const withoutFinalNewline = text.endsWith("\n") ? text.slice(0, -1) : text;
  const normalized = withoutFinalNewline.endsWith("\r")
    ? withoutFinalNewline.slice(0, -1)
    : withoutFinalNewline;
  if (normalized.length === 0 || normalized.includes("\n") || normalized.includes("\r")) {
    refuseInvalid(`${label} must contain exactly one non-empty line`);
  }
  return normalized;
}

function parseGitdirPointer(text, label) {
  const line = parseSingleLine(text, label);
  const match = /^gitdir:\s*(.+)$/u.exec(line);
  if (!match || match[1].length === 0) {
    refuseInvalid(`${label} must contain one gitdir pointer`);
  }
  return match[1];
}

function maybeLstat(lexical, label) {
  try {
    return lstatSync(lexical);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    refuseInvalid(`${label} could not be inspected: ${lexical}`, {
      path: lexical,
      errno: error?.code ?? null
    });
  }
  return null;
}

function addPin(pins, seenPins, pin) {
  if (seenPins.has(pin.path)) return;
  seenPins.add(pin.path);
  pins.push(pin);
}

function addBind(binds, seenBinds, source) {
  if (seenBinds.has(source)) return;
  seenBinds.add(source);
  binds.push(Object.freeze({ src: source, dst: source }));
}

function parseAlternates(text, objectDirectory, label) {
  const out = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.length === 0) continue;
    if (line.includes("\0")) refuseInvalid(`${label} contains a NUL byte`);
    out.push(resolveReference(line, objectDirectory, `${label} entry`));
  }
  return out;
}

export function normalizeFindingsGitMetadataRole(role) {
  if (role === null || role === undefined) return null;
  if (role === "review" || role === "reviewer") return "reviewer";
  if (role === "redteam") return "redteam";
  refuseInvalid(`findings Git metadata support requires reviewer or redteam role, got: ${String(role)}`);
  return null;
}

export function resolveFindingsRoleGitMetadata({ repoReal, role } = {}) {
  const normalizedRole = normalizeFindingsGitMetadataRole(role);
  if (normalizedRole === null) return null;
  const checkout = assertAbsoluteSafePath(repoReal, "findingsGitMetadata.repoReal");
  const gitPointerFile = path.join(checkout, ".git");
  const gitEntry = maybeLstat(gitPointerFile, "findings checkout .git");

  if (gitEntry === null) return null;

  if (gitEntry.isDirectory() && !gitEntry.isSymbolicLink()) return null;
  if (!gitEntry.isFile() || gitEntry.isSymbolicLink()) {
    refuseInvalid(`findings checkout .git must be a real file or directory: ${gitPointerFile}`, {
      path: gitPointerFile
    });
  }

  const pins = [];
  const seenPins = new Set();
  const binds = [];
  const seenBinds = new Set();
  const pointer = readPinnedTextFile(gitPointerFile, "findings checkout .git pointer");
  addPin(pins, seenPins, pointer.pin);
  const worktreeGitDirPath = resolveReference(
    parseGitdirPointer(pointer.text, "findings checkout .git pointer"),
    checkout,
    "findings checkout worktree gitdir"
  );
  const worktreeGitDir = inspectExactPath(
    worktreeGitDirPath,
    "directory",
    "findings checkout worktree gitdir"
  );
  addPin(pins, seenPins, worktreeGitDir);

  const commonDirFilePath = path.join(worktreeGitDir.path, "commondir");
  const commonDirFileStats = maybeLstat(commonDirFilePath, "findings checkout commondir file");
  let commonGitDirPath = worktreeGitDir.path;
  if (commonDirFileStats !== null) {
    const commonDirFile = readPinnedTextFile(
      commonDirFilePath,
      "findings checkout commondir file"
    );
    addPin(pins, seenPins, commonDirFile.pin);
    commonGitDirPath = resolveReference(
      parseSingleLine(commonDirFile.text, "findings checkout commondir file"),
      worktreeGitDir.path,
      "findings checkout common Git directory"
    );
  }
  const commonGitDir = inspectExactPath(
    commonGitDirPath,
    "directory",
    "findings checkout common Git directory"
  );
  addPin(pins, seenPins, commonGitDir);

  if (commonGitDir.path !== worktreeGitDir.path) {
    const worktreesDir = inspectExactPath(
      path.join(commonGitDir.path, "worktrees"),
      "directory",
      "findings checkout common worktrees directory"
    );
    addPin(pins, seenPins, worktreesDir);
    if (path.dirname(worktreeGitDir.path) !== worktreesDir.path) {
      refuseInvalid("findings checkout worktree gitdir must be a direct child of the resolved common worktrees directory", {
        worktree_gitdir: worktreeGitDir.path,
        common_worktrees_dir: worktreesDir.path
      });
    }
  }

  const backlinkPath = path.join(worktreeGitDir.path, "gitdir");
  const backlink = readPinnedTextFile(backlinkPath, "findings checkout gitdir backlink");
  addPin(pins, seenPins, backlink.pin);
  const backlinkTarget = resolveReference(
    parseSingleLine(backlink.text, "findings checkout gitdir backlink"),
    worktreeGitDir.path,
    "findings checkout gitdir backlink target"
  );
  if (backlinkTarget !== gitPointerFile) {
    refuseInvalid("findings checkout worktree gitdir backlink does not name the checkout .git pointer", {
      backlink_target: backlinkTarget,
      expected: gitPointerFile
    });
  }

  const objectDirectories = [];
  const visitedObjectDirectories = new Set();
  const visitObjectDirectory = (objectDirectoryPath, label) => {
    const objectDirectory = inspectExactPath(objectDirectoryPath, "directory", label);
    addPin(pins, seenPins, objectDirectory);
    if (visitedObjectDirectories.has(objectDirectory.path)) return;
    visitedObjectDirectories.add(objectDirectory.path);
    objectDirectories.push(objectDirectory.path);
    const alternatesPath = path.join(objectDirectory.path, "info", "alternates");
    if (maybeLstat(alternatesPath, `${label} alternates file`) === null) return;
    const alternates = readPinnedTextFile(alternatesPath, `${label} alternates file`);
    addPin(pins, seenPins, alternates.pin);
    for (const alternatePath of parseAlternates(
      alternates.text,
      objectDirectory.path,
      `${label} alternates file`
    )) {
      visitObjectDirectory(alternatePath, "findings checkout alternate object directory");
    }
  };
  visitObjectDirectory(
    path.join(commonGitDir.path, "objects"),
    "findings checkout primary object directory"
  );

  addBind(binds, seenBinds, commonGitDir.path);
  addBind(binds, seenBinds, worktreeGitDir.path);
  addBind(binds, seenBinds, gitPointerFile);
  for (const objectDirectory of objectDirectories) {
    if (
      isWithinRepo(objectDirectory, checkout)
      || isWithinRepo(objectDirectory, commonGitDir.path)
      || isWithinRepo(objectDirectory, worktreeGitDir.path)
    ) {
      continue;
    }
    addBind(binds, seenBinds, objectDirectory);
  }

  return Object.freeze({
    schemaVersion: "findings-role-git-metadata.v1",
    role: normalizedRole,
    checkout,
    gitPointerFile,
    worktreeGitDir: worktreeGitDir.path,
    commonGitDir: commonGitDir.path,
    primaryObjectDirectory: objectDirectories[0],
    objectDirectories: Object.freeze([...objectDirectories]),
    readOnlyBinds: Object.freeze(binds),
    pinnedPaths: Object.freeze(pins)
  });
}

export function assertFindingsRoleGitMetadataUnchanged(metadata) {
  if (metadata === null || metadata === undefined) return;
  if (
    typeof metadata !== "object"
    || metadata.schemaVersion !== "findings-role-git-metadata.v1"
    || !Array.isArray(metadata.pinnedPaths)
  ) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PLAN_INVALID,
      "findings Git metadata plan state is invalid"
    );
  }
  for (const pin of metadata.pinnedPaths) {
    let current;
    try {
      current = inspectExactPath(pin.path, pin.kind, "pinned findings Git metadata source");
    } catch (error) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.FINDINGS_GIT_METADATA_CHANGED,
        `findings Git metadata source changed before spawn: ${pin?.path ?? "<invalid>"}`,
        {
          path: pin?.path ?? null,
          cause_code: error?.code ?? null,
          cause_detail: error?.detail ?? null
        }
      );
    }
    if (pin.kind === "file") {

      const reopened = readPinnedTextFile(pin.path, "pinned findings Git metadata file");
      current = reopened.pin;
    }
    if (!samePinnedPathObject(pin.kind, pin.identity, current.identity)) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.FINDINGS_GIT_METADATA_CHANGED,
        `findings Git metadata source was replaced before spawn: ${pin.path}`,
        { path: pin.path, expected: pin.identity, actual: current.identity }
      );
    }
  }
}

export function assertFindingsRoleGitMetadataReadOnly(metadata, {
  writableRoots = [],
  writableFiles = [],
  runtimeRoots = [],
  homeWritableFiles = [],
  familyRuntimeWritableRoots = []
} = {}) {
  if (metadata === null || metadata === undefined) return;
  if (writableRoots.length > 0 || writableFiles.length > 0) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.FINDINGS_GIT_METADATA_INVALID,
      "findings-role repository writable roots and writable files must remain empty",
      { writable_roots: writableRoots, writable_files: writableFiles }
    );
  }
  const mutablePaths = [
    ...runtimeRoots,
    ...homeWritableFiles.map(({ dst }) => dst),
    ...familyRuntimeWritableRoots.map(({ dst }) => dst)
  ];
  const metadataPaths = metadata.pinnedPaths.map(({ path: pinnedPath }) => pinnedPath);
  for (const mutablePath of mutablePaths) {
    for (const metadataPath of metadataPaths) {
      if (
        mutablePath === metadataPath
        || isWithinRepo(metadataPath, mutablePath)
        || isWithinRepo(mutablePath, metadataPath)
      ) {
        fail(
          BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.SANDBOX_WRITE_DENIAL,
          `findings-role mutable runtime bind overlaps pinned Git metadata: ${mutablePath}`,
          { mutable_path: mutablePath, metadata_path: metadataPath }
        );
      }
    }
  }
}
