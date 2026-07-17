import path from "node:path";
import { lstatSync, readFileSync } from "node:fs";
import {
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES,
  BubblewrapIsolationError,
  assertAbsoluteSafePath,
  fail,
  isWithinRepo
} from "./launch-isolation-errors.mjs";
import {
  assertExistingDirectory,
  realpathExisting
} from "./launch-isolation-paths.mjs";

function resolveGitFileReference({ filePath, baseDir, label, requireGitdirPrefix = false }) {
  let raw;
  try {
    raw = readFileSync(filePath, "utf8").trim();
  } catch (err) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_FILE,
      `${label} could not be read: ${filePath}`,
      { errno: err?.code ?? null }
    );
  }
  let target = raw;
  if (requireGitdirPrefix) {
    const match = /^gitdir:\s*(.+)$/u.exec(raw);
    if (!match) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
        `${label} must contain a gitdir pointer`,
        { filePath }
      );
    }
    target = match[1].trim();
  }
  if (target.length === 0) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
      `${label} must not be empty`,
      { filePath }
    );
  }
  return path.isAbsolute(target)
    ? path.normalize(target)
    : path.resolve(baseDir, target);
}

export function normalizeProvisionedWorktreeGitIsolation(identity, repoReal, {
  projectReadOnlyBinds = true
} = {}) {
  if (identity === null || identity === undefined) return null;
  if (typeof identity !== "object" || Array.isArray(identity)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
      "provisionedWorktreeGitIdentity/provisionedWorktreeGitBinding must be a plain object"
    );
  }
  const field = (label, names, optional = false) => {
    const value = names.map((name) => identity[name]).find((v) => typeof v === "string" && v.length > 0);
    if (value !== undefined || optional) return value;
    return { missing: label };
  };
  const worktreePath = field("worktreePath", ["worktreePath", "worktree_path"]);
  const gitDirPath = field("gitDir", ["gitDir", "git_dir", "worktreeGitDir", "worktree_git_dir"]);
  const mainGitDirPath = field("mainGitDir", ["mainGitDir", "main_git_dir", "sharedGitDir", "shared_git_dir"]);
  const gitFilePath = field("gitPointerFile", ["gitPointerFile", "git_pointer_file", "worktreeGitPointerFile", "worktree_git_pointer_file"], true);
  const missing = [worktreePath, gitDirPath, mainGitDirPath]
    .filter((value) => typeof value === "object")
    .map((value) => value.missing);
  if (missing.length > 0) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
      `provisionedWorktreeGitIdentity missing required server-side path(s): ${missing.join(", ")}`,
      { missing }
    );
  }
  const dirPath = (value, label) => {
    const real = realpathExisting(
      assertAbsoluteSafePath(value, `provisionedWorktreeGitIdentity.${label}`),
      `provisionedWorktreeGitIdentity.${label}`,
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_DIRECTORY
    );
    assertExistingDirectory(real, `provisionedWorktreeGitIdentity.${label}`, BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_DIRECTORY);
    return real;
  };
  const workTree = dirPath(worktreePath, "worktreePath");
  if (workTree !== repoReal) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
      "provisioned worktree git identity must be bound to the sandbox repo realpath",
      { workTree, repoReal }
    );
  }
  const gitDir = dirPath(gitDirPath, "gitDir");
  const mainGitDir = dirPath(mainGitDirPath, "mainGitDir");
  if (gitDir === mainGitDir || !isWithinRepo(gitDir, mainGitDir)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
      "provisioned worktree gitDir must be inside the server-supplied shared main gitdir and must not be the shared main gitdir",
      { gitDir, mainGitDir }
    );
  }
  const worktreesDir = dirPath(path.join(mainGitDir, "worktrees"), "mainGitDir.worktrees");
  if (path.dirname(gitDir) !== worktreesDir) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
      "provisioned worktree gitDir must be the selected per-worktree gitdir directly under the shared main gitdir worktrees directory",
      { gitDir, expectedParent: worktreesDir }
    );
  }
  const worktreeGitFile = gitFilePath === undefined
    ? path.join(workTree, ".git")
    : realpathExisting(
        assertAbsoluteSafePath(gitFilePath, "provisionedWorktreeGitIdentity.gitPointerFile"),
        "provisionedWorktreeGitIdentity.gitPointerFile",
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_FILE
      );
  if (worktreeGitFile !== path.join(workTree, ".git")) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
      "provisioned worktree .git pointer must be the root .git file",
      { worktreeGitFile, expected: path.join(workTree, ".git") }
    );
  }
  try {
    if (!lstatSync(worktreeGitFile).isFile()) throw new Error("not a file");
  } catch (err) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_FILE,
      `provisionedWorktreeGitIdentity.worktree .git pointer must be an existing regular file: ${worktreeGitFile}`,
      { errno: err?.code ?? null }
    );
  }
  const gitPointerTarget = resolveGitFileReference({
    filePath: worktreeGitFile,
    baseDir: workTree,
    label: "provisionedWorktreeGitIdentity.worktree .git pointer",
    requireGitdirPrefix: true
  });
  const gitPointerTargetReal = realpathExisting(
    gitPointerTarget,
    "provisionedWorktreeGitIdentity.worktree .git pointer target",
    BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_DIRECTORY
  );
  assertExistingDirectory(
    gitPointerTargetReal,
    "provisionedWorktreeGitIdentity.worktree .git pointer target",
    BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_DIRECTORY
  );
  if (gitPointerTargetReal !== gitDir) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
      "provisioned worktree root .git pointer must resolve to the server-supplied per-worktree gitDir",
      { worktreeGitFile, gitPointerTarget: gitPointerTargetReal, expected: gitDir }
    );
  }
  const gitDirBacklink = path.join(gitDir, "gitdir");
  try {
    if (!lstatSync(gitDirBacklink).isFile()) throw new Error("not a file");
    const backlinkPath = resolveGitFileReference({
      filePath: gitDirBacklink,
      baseDir: gitDir,
      label: "provisionedWorktreeGitIdentity.gitDir gitdir backlink"
    });
    const backlinkPathReal = realpathExisting(
      backlinkPath,
      "provisionedWorktreeGitIdentity.gitDir gitdir backlink target",
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_FILE
    );
    if (backlinkPathReal !== worktreeGitFile) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
        "provisioned worktree gitDir must belong to the selected worktree root .git pointer",
        { gitDir, gitDirBacklink, backlinkPath: backlinkPathReal, expected: worktreeGitFile }
      );
    }
  } catch (err) {
    if (err instanceof BubblewrapIsolationError) throw err;
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_FILE,
      `provisionedWorktreeGitIdentity.gitDir must contain an existing gitdir backlink file: ${gitDirBacklink}`,
      { errno: err?.code ?? null }
    );
  }

  const readOnlyBinds = projectReadOnlyBinds
    ? [...new Set([mainGitDir, gitDir, worktreeGitFile])]
        .map((src) => Object.freeze({ src, dst: src }))
    : [];

  return Object.freeze({
    schemaVersion: "provisioned-worktree-git-isolation.v1",
    worktreePath: workTree,
    workTree,
    worktreeGitDir: gitDir,
    gitDir,
    sharedGitDir: mainGitDir,
    mainGitDir,
    gitPointerFile: worktreeGitFile,
    worktreeGitFile,
    readOnlyBinds: Object.freeze(readOnlyBinds)
  });
}
