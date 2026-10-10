

import { accessSync, constants, existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { runGitAsync } from "../../../agent-launch-core/src/lib/git.mjs";

export const OWNED_WORKTREE_CHECKOUT_SCHEMA_VERSION = "owned-worktree-checkout.v1";
export const OWNED_WORKTREE_CHECKOUT_MUTATIONS = Object.freeze({
  INDEX_ONLY: "index_only",
  INDEX_AND_FILES: "index_and_files"
});
export const OWNED_WORKTREE_CHECKOUT_STATES = Object.freeze({
  CURRENT: "current",
  SYNCHRONIZED: "synchronized",
  SUPERSEDED: "superseded"
});
export const OWNED_WORKTREE_CHECKOUT_CODES = Object.freeze({
  INVALID_ARG: "agent_launch.owned_worktree_checkout.invalid_arg.v1",
  WORKTREE_MOVED: "agent_launch.owned_worktree_checkout.worktree_moved.v1",
  REPOSITORY_MISMATCH: "agent_launch.owned_worktree_checkout.repository_mismatch.v1",
  WORKTREE_UNREGISTERED: "agent_launch.owned_worktree_checkout.worktree_unregistered.v1",
  BRANCH_MISMATCH: "agent_launch.owned_worktree_checkout.branch_mismatch.v1",
  TARGET_NOT_ON_BRANCH: "agent_launch.owned_worktree_checkout.target_not_on_branch.v1",
  NOT_FULL: "agent_launch.owned_worktree_checkout.not_full_checkout.v1",
  SUPERSEDED: "agent_launch.owned_worktree_checkout.superseded_by_newer_commit.v1",
  UNEXPECTED_LOCAL_CHANGES: "agent_launch.owned_worktree_checkout.unexpected_local_changes.v1",
  PREVIOUS_UNAUTHENTICATED: "agent_launch.owned_worktree_checkout.previous_materialization_unauthenticated.v1",
  IGNORED_OBSTRUCTION: "agent_launch.owned_worktree_checkout.ignored_file_obstructs.v1",
  PATH_NOT_WRITABLE: "agent_launch.owned_worktree_checkout.path_not_writable.v1",
  INDEX_LOCKED: "agent_launch.owned_worktree_checkout.index_locked.v1",
  INDEX_NOT_WRITABLE: "agent_launch.owned_worktree_checkout.index_not_writable.v1",
  UPDATE_REFUSED: "agent_launch.owned_worktree_checkout.update_refused.v1",
  GIT_FAILED: "agent_launch.owned_worktree_checkout.git_failed.v1",
  POSTCONDITION_MISMATCH: "agent_launch.owned_worktree_checkout.postcondition_mismatch.v1"
});

const PREVIOUS_MATERIALIZATION_BOUND = 64;
const PATH_SAMPLE = 5;
const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const BRANCH_REF_RE = /^refs\/heads\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/u;

export class OwnedWorktreeCheckoutError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = "OwnedWorktreeCheckoutError";
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

function fail(code, message, detail) {
  throw new OwnedWorktreeCheckoutError(code, message, detail);
}

export function isolatedGitEnvironment({ indexFile = null, objectDirectory = null, alternates = null } = {}) {
  const env = { ...process.env };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES"]) {
    delete env[key];
  }
  if (indexFile !== null) env.GIT_INDEX_FILE = indexFile;
  if (objectDirectory !== null) env.GIT_OBJECT_DIRECTORY = objectDirectory;
  if (alternates !== null) env.GIT_ALTERNATE_OBJECT_DIRECTORIES = alternates;
  return env;
}

export async function defaultOwnedCheckoutRunGit({ repo = null, gitDir = null, workTree = null, args,
  indexFile = null, objectDirectory = null, alternates = null }) {
  const result = await runGitAsync({ repo, gitDir, workTree, args, stderrLimit: 2048,
    env: isolatedGitEnvironment({ indexFile, objectDirectory, alternates }) });
  return { ok: result.ok === true || result.status === 0, status: result.status ?? null,
    stdout: result.stdout ?? "", stderr: result.stderr ?? "",
    ...(result.error ? { error: result.error } : {}) };
}

let synchronizationHookForTest = null;
export function setOwnedWorktreeCheckoutSynchronizationHookForTest(hook) {
  synchronizationHookForTest = typeof hook === "function" ? hook : null;
}

const firstLine = (value) => typeof value === "string"
  ? value.split(/\r?\n/u).map((line) => line.trim()).find((line) => line.length > 0)?.slice(0, 240) ?? null
  : null;
const output = (result) => String(result?.stdout ?? "").trim();
const names = (result) => String(result?.stdout ?? "").split("\0").filter(Boolean);

async function git(runGit, repo, args, operation, { allowStatus = [] } = {}) {
  const result = await runGit({ repo, args });
  if (result?.ok === true || allowStatus.includes(result?.status)) return result;
  fail(OWNED_WORKTREE_CHECKOUT_CODES.GIT_FAILED, `git could not ${operation}`, {
    operation, status: result?.status ?? null, stderr_line: firstLine(result?.stderr),
    error: firstLine(result?.error)
  });
}

export async function measurePhysicalCheckoutTree({ runGit, gitContext, seedCommit, objectDirectory,
  refuse = [], listDifferences = false, report }) {
  const tempRoot = mkdtempSync(path.join(tmpdir(), "owned-checkout-surface-"));
  const temporaryObjects = path.join(tempRoot, "objects");
  mkdirSync(temporaryObjects);
  const isolated = { ...gitContext, indexFile: path.join(tempRoot, "index"), objectDirectory: temporaryObjects,
    alternates: objectDirectory };
  const run = async (step, args, allow = []) => {
    const result = await runGit({ ...isolated, args });
    if (result?.ok === true || allow.includes(result?.status)) return result;
    return report(step, { args, status: result?.status ?? null, stderr: result?.stderr ?? result?.error ?? null });
  };
  try {
    await run("seed", ["read-tree", seedCommit]);
    for (const [kind, args] of [
      ["untracked", ["ls-files", "--others", "--exclude-standard", "--directory", "--no-empty-directory"]],
      ["ignored", ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "--no-empty-directory"]]
    ]) {
      if (!refuse.includes(kind)) continue;
      const unexpected = output(await run("inspect", args));
      if (unexpected.length > 0) report("unexpected_content", { path: unexpected.split("\n", 1)[0] });
    }
    await run("measure", ["add", "-A", "--"]);
    const tree = output(await run("write_tree", ["write-tree"]));
    if (!OID_RE.test(tree) || /^0+$/u.test(tree)) report("tree_invalid", { value: tree });
    const differing = listDifferences
      ? names(await run("measure", ["diff-index", "--cached", "--no-renames", "--name-only", "-z", seedCommit, "--"]))
      : [];
    return { tree, differing };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

export async function applyCheckoutMutation({ runGit, gitContext, mutation, target, previous = null }) {
  const args = mutation === OWNED_WORKTREE_CHECKOUT_MUTATIONS.INDEX_ONLY
    ? ["read-tree", target]
    : ["--no-replace-objects", "read-tree", "-m", "-u", previous, target];
  return { args, result: await runGit({ ...gitContext, args }) };
}

async function commonDirectory(runGit, repo, operation) {
  const common = output(await git(runGit, repo,
    ["rev-parse", "--path-format=absolute", "--git-common-dir"], operation));
  try {
    return realpathSync(common);
  } catch {
    return null;
  }
}

async function realGitPath(runGit, worktree, name, operation) {
  const located = output(await git(runGit, worktree,
    ["rev-parse", "--path-format=absolute", "--git-path", name], operation));
  return path.isAbsolute(located) ? located : null;
}

async function proveBoundCheckout(runGit, { repository, worktreePath, branchRef }) {
  let real;
  try {
    real = realpathSync(worktreePath);
  } catch {
    real = null;
  }
  if (real !== worktreePath || lstatSync(real).isSymbolicLink()) {
    fail(OWNED_WORKTREE_CHECKOUT_CODES.WORKTREE_MOVED,
      "the bound worktree path is missing, moved or not canonical", { worktree_path: worktreePath });
  }
  const repositoryCommon = await commonDirectory(runGit, repository, "resolve the repository's Git directory");
  const topLevel = output(await git(runGit, real, ["rev-parse", "--show-toplevel"],
    "resolve the bound worktree's top level"));
  if (topLevel !== real || repositoryCommon === null ||
      await commonDirectory(runGit, real, "resolve the bound worktree's Git directory") !== repositoryCommon) {
    fail(OWNED_WORKTREE_CHECKOUT_CODES.REPOSITORY_MISMATCH,
      "the bound worktree is not a checkout of the configured repository", { worktree_path: worktreePath });
  }
  const registrations = String((await git(runGit, repository, ["worktree", "list", "--porcelain", "-z"],
    "list the repository's registered worktrees")).stdout ?? "").split("\0\0")
    .map((block) => Object.fromEntries(block.split("\0").filter(Boolean).map((line) => {
      const space = line.indexOf(" ");
      return space === -1 ? [line, true] : [line.slice(0, space), line.slice(space + 1)];
    })));
  const registration = registrations.find((entry) => entry.worktree === real) ?? null;
  if (registration === null || registration.bare === true || registration.prunable !== undefined) {
    fail(OWNED_WORKTREE_CHECKOUT_CODES.WORKTREE_UNREGISTERED,
      "the bound worktree is not a live registered worktree of the configured repository",
      { worktree_path: worktreePath });
  }
  const head = await git(runGit, real, ["symbolic-ref", "--quiet", "HEAD"], "read the bound worktree's HEAD",
    { allowStatus: [1] });
  if (head.ok !== true || output(head) !== branchRef || registration.branch !== branchRef) {
    fail(OWNED_WORKTREE_CHECKOUT_CODES.BRANCH_MISMATCH,
      "the bound worktree is not checked out on its own branch",
      { worktree_path: worktreePath, expected: branchRef, actual: head.ok === true ? output(head) : null });
  }
  for (const key of ["core.sparseCheckout", "core.sparseCheckoutCone", "index.sparse"]) {
    const probe = await git(runGit, real, ["config", "--bool", "--get", key], `read ${key}`, { allowStatus: [1] });
    if (probe.ok === true && output(probe) === "true") {
      fail(OWNED_WORKTREE_CHECKOUT_CODES.NOT_FULL, "the bound worktree is not a full checkout",
        { worktree_path: worktreePath, setting: key });
    }
  }
  const tip = output(await git(runGit, repository,
    ["--no-replace-objects", "rev-parse", "--verify", `${branchRef}^{commit}`], "resolve the branch tip"));
  return { worktree: real, branchRef, tip };
}

async function indexDifference(runGit, worktree, commit) {
  return names(await git(runGit, worktree,
    ["--no-replace-objects", "diff-index", "--cached", "--no-renames", "--name-only", "-z", commit, "--"],
    "compare the bound worktree's index with a branch commit"));
}

async function observeLocalChanges(runGit, worktree) {
  const status = await git(runGit, worktree,
    ["--no-optional-locks", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"],
    "read the bound worktree's status");
  const unstaged = [];
  const untracked = [];
  for (const entry of names(status)) {
    if (entry.startsWith("?? ")) untracked.push(entry.slice(3));
    else if (entry[1] !== " ") unstaged.push(entry.slice(3));
  }
  return { unstaged, untracked };
}

function failUnexpectedLocalChanges(facts, { staged = false, unstaged = [], untracked = [], physical = [] }) {
  fail(OWNED_WORKTREE_CHECKOUT_CODES.UNEXPECTED_LOCAL_CHANGES,
    "the owned worktree holds local changes; it was not updated", {
      target_sha: facts.target_sha, worktree_path: facts.worktree_path, mutation: facts.mutation,
      staged_index_unauthenticated: staged, unstaged_paths: unstaged.length, untracked_paths: untracked.length,
      physical_paths: physical.length, unstaged_sample: unstaged.slice(0, PATH_SAMPLE),
      untracked_sample: untracked.slice(0, PATH_SAMPLE), physical_sample: physical.slice(0, PATH_SAMPLE)
    });
}

async function authenticatePreviousMaterialization(runGit, { repository, worktree, facts, floorSha }) {
  const ancestors = output(await git(runGit, repository,
    ["--no-replace-objects", "rev-list", "--first-parent", `--max-count=${PREVIOUS_MATERIALIZATION_BOUND + 1}`,
      facts.target_sha], "read the branch's first-parent history")).split("\n").filter(Boolean).slice(1);
  let complete = ancestors.length < PREVIOUS_MATERIALIZATION_BOUND;
  for (const commit of ancestors) {
    if ((await indexDifference(runGit, worktree, commit)).length === 0) return commit;
    if (commit === floorSha) {
      complete = true;
      break;
    }
  }
  if (!complete) {
    fail(OWNED_WORKTREE_CHECKOUT_CODES.PREVIOUS_UNAUTHENTICATED,
      "the owned worktree's previous materialization could not be established within the examined history",
      { target_sha: facts.target_sha, ancestors_examined: ancestors.length, bound: PREVIOUS_MATERIALIZATION_BOUND });
  }
  return failUnexpectedLocalChanges(facts, { staged: true });
}

function assertNoIgnoredObstruction(worktree, added, facts) {
  for (const relative of added) {
    let present = true;
    try {
      lstatSync(path.join(worktree, relative));
    } catch {
      present = false;
    }
    if (present) {
      fail(OWNED_WORKTREE_CHECKOUT_CODES.IGNORED_OBSTRUCTION,
        "an ignored file stands where the target tree adds a path; it was not overwritten",
        { target_sha: facts.target_sha, path: relative });
    }
  }
}

function assertChangedPathsWritable(worktree, changed) {
  const checked = new Set();
  for (const relative of changed) {
    let directory = path.dirname(path.join(worktree, relative));
    for (;;) {
      let stat = null;
      try {
        stat = lstatSync(directory);
      } catch {
        stat = null;
      }
      if (stat !== null || directory === worktree) break;
      directory = path.dirname(directory);
    }
    if (checked.has(directory)) continue;
    checked.add(directory);
    try {
      accessSync(directory, constants.W_OK | constants.X_OK);
    } catch (error) {
      fail(OWNED_WORKTREE_CHECKOUT_CODES.PATH_NOT_WRITABLE,
        "a directory the target tree changes is not writable in the owned worktree",
        { path: path.relative(worktree, directory) || ".", errno: error?.code ?? null });
    }
  }
}

function failIndexFault(result, facts, fallback) {
  const stderr = String(result?.stderr ?? "");
  const detail = { target_sha: facts.target_sha, status: result?.status ?? null, stderr_line: firstLine(stderr),
    error: firstLine(result?.error) };
  if (/index\.lock/u.test(stderr)) {
    fail(OWNED_WORKTREE_CHECKOUT_CODES.INDEX_LOCKED, "the owned worktree's index is locked by another Git operation",
      detail);
  }
  if (/permission denied|read-only file system/iu.test(stderr)) {
    fail(OWNED_WORKTREE_CHECKOUT_CODES.INDEX_NOT_WRITABLE, "the owned worktree's index is not writable", detail);
  }
  return fallback(detail);
}

async function refreshIndexStat(runGit, worktree, facts) {

  const refreshed = await runGit({ repo: worktree, args: ["update-index", "--refresh"] });
  if (refreshed?.ok === true) return;
  await failIndexFault(refreshed, facts, async (detail) => {
    if (refreshed?.status === 1) {
      return failUnexpectedLocalChanges(facts, { unstaged: (await observeLocalChanges(runGit, worktree)).unstaged });
    }
    return fail(OWNED_WORKTREE_CHECKOUT_CODES.GIT_FAILED, "git could not refresh the owned worktree's index", {
      operation: "refresh the owned worktree's index", ...detail });
  });
}

async function assertIndexAdmitsAlignment(runGit, worktree, facts) {
  const indexPath = await realGitPath(runGit, worktree, "index", "locate the owned worktree's index");
  if (indexPath === null) return;
  if (existsSync(`${indexPath}.lock`)) {
    fail(OWNED_WORKTREE_CHECKOUT_CODES.INDEX_LOCKED, "the owned worktree's index is locked by another Git operation",
      { target_sha: facts.target_sha, stderr_line: `${indexPath}.lock exists` });
  }
  try {
    accessSync(path.dirname(indexPath), constants.W_OK | constants.X_OK);
  } catch (error) {
    fail(OWNED_WORKTREE_CHECKOUT_CODES.INDEX_NOT_WRITABLE, "the owned worktree's index is not writable",
      { target_sha: facts.target_sha, errno: error?.code ?? null });
  }
}

async function assertPhysicalCheckoutIsTarget(runGit, worktree, facts) {
  const objects = await realGitPath(runGit, worktree, "objects", "locate the repository's object directory");
  let objectDirectory;
  try {
    objectDirectory = realpathSync(objects);
  } catch {
    objectDirectory = null;
  }
  if (objectDirectory === null) {
    fail(OWNED_WORKTREE_CHECKOUT_CODES.GIT_FAILED, "git could not locate the repository's object directory",
      { operation: "locate the repository's object directory" });
  }
  const measured = await measurePhysicalCheckoutTree({ runGit, gitContext: { repo: worktree },
    seedCommit: facts.target_sha, objectDirectory, listDifferences: true,
    report: (step, detail) => fail(OWNED_WORKTREE_CHECKOUT_CODES.GIT_FAILED,
      "git could not measure the owned worktree's physical checkout",
      { operation: `measure the physical checkout (${step})`, status: detail?.status ?? null,
        stderr_line: firstLine(detail?.stderr) }) });
  if (measured.tree !== facts.target_tree) failUnexpectedLocalChanges(facts, { physical: measured.differing });
}

async function synchronize(runGit, { repository, worktreePath, branchRef, targetSha, mutation, floorSha }) {
  const indexOnly = mutation === OWNED_WORKTREE_CHECKOUT_MUTATIONS.INDEX_ONLY;
  const bound = await proveBoundCheckout(runGit, { repository, worktreePath, branchRef });
  const { worktree } = bound;
  const tree = output(await git(runGit, repository,
    ["--no-replace-objects", "rev-parse", "--verify", `${targetSha}^{tree}`], "resolve the target tree"));
  const facts = { schema_version: OWNED_WORKTREE_CHECKOUT_SCHEMA_VERSION, worktree_path: worktree,
    branch_ref: branchRef, mutation, target_sha: targetSha, target_tree: tree };
  if (bound.tip !== targetSha) {
    const descends = await git(runGit, repository,
      ["merge-base", "--is-ancestor", targetSha, bound.tip], "relate the target commit to the branch tip",
      { allowStatus: [1] });
    if (descends.ok !== true) {
      fail(OWNED_WORKTREE_CHECKOUT_CODES.TARGET_NOT_ON_BRANCH,
        "the target commit is not on the owned worktree's branch", { branch_ref: branchRef, tip_sha: bound.tip,
          target_sha: targetSha });
    }

    return Object.freeze({ ...facts, state: OWNED_WORKTREE_CHECKOUT_STATES.SUPERSEDED, tip_sha: bound.tip,
      code: OWNED_WORKTREE_CHECKOUT_CODES.SUPERSEDED,
      message: "a newer commit moved the branch; its checkout is not this commit's" });
  }

  if (indexOnly) await assertPhysicalCheckoutIsTarget(runGit, worktree, facts);
  else {
    const local = await observeLocalChanges(runGit, worktree);
    if (local.unstaged.length > 0 || local.untracked.length > 0) failUnexpectedLocalChanges(facts, local);
  }
  const pending = await indexDifference(runGit, worktree, targetSha);
  if (pending.length === 0) {
    if (indexOnly) {

      const settled = await observeLocalChanges(runGit, worktree);
      if (settled.unstaged.length > 0 || settled.untracked.length > 0) failUnexpectedLocalChanges(facts, settled);
    }
    return Object.freeze({ ...facts, state: OWNED_WORKTREE_CHECKOUT_STATES.CURRENT, tip_sha: bound.tip, clean: true });
  }
  const previous = await authenticatePreviousMaterialization(runGit, { repository, worktree, facts, floorSha });
  let changed = pending;
  if (indexOnly) await assertIndexAdmitsAlignment(runGit, worktree, facts);
  else {
    const delta = String((await git(runGit, repository,
      ["--no-replace-objects", "diff-tree", "-r", "--no-renames", "--name-status", "-z", previous, targetSha],
      "list the paths the target tree changes")).stdout ?? "").split("\0").filter(Boolean);
    changed = [];
    const added = [];
    for (let index = 0; index + 1 < delta.length; index += 2) {
      changed.push(delta[index + 1]);
      if (delta[index] === "A") added.push(delta[index + 1]);
    }
    assertNoIgnoredObstruction(worktree, added, facts);
    assertChangedPathsWritable(worktree, changed);
    await refreshIndexStat(runGit, worktree, facts);
  }

  const before = await proveBoundCheckout(runGit, { repository, worktreePath, branchRef });
  if (before.tip !== targetSha) {
    fail(OWNED_WORKTREE_CHECKOUT_CODES.TARGET_NOT_ON_BRANCH,
      "the branch moved while its checkout was being synchronized",
      { branch_ref: branchRef, tip_sha: before.tip, target_sha: targetSha });
  }
  const applied = await applyCheckoutMutation({ runGit, gitContext: { repo: worktree }, mutation,
    target: targetSha, previous });
  if (applied.result?.ok !== true) {
    await failIndexFault(applied.result, { ...facts, previous_sha: previous },
      (detail) => fail(OWNED_WORKTREE_CHECKOUT_CODES.UPDATE_REFUSED,
        "Git refused to update the owned worktree to the target tree", { previous_sha: previous, ...detail }));
  }
  const after = await proveBoundCheckout(runGit, { repository, worktreePath, branchRef });
  const remaining = await indexDifference(runGit, worktree, targetSha);
  const left = await observeLocalChanges(runGit, worktree);
  if (after.tip !== targetSha || remaining.length > 0 || left.unstaged.length > 0 || left.untracked.length > 0) {
    fail(OWNED_WORKTREE_CHECKOUT_CODES.POSTCONDITION_MISMATCH,
      "the owned worktree is not a clean checkout of the target tree after its update",
      { tip_sha: after.tip, target_sha: targetSha, index_paths: remaining.length,
        file_paths: left.unstaged.length, untracked_paths: left.untracked.length });
  }
  return Object.freeze({ ...facts, state: OWNED_WORKTREE_CHECKOUT_STATES.SYNCHRONIZED, tip_sha: after.tip,
    previous_sha: previous, updated_paths: changed.length, clean: true });
}

export async function synchronizeOwnedWorktreeCheckout({ mainRepo, worktreePath, branchRef, targetSha, mutation,
  floorSha = null, deps = {} } = {}) {
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo) || path.resolve(mainRepo) !== mainRepo ||
      typeof worktreePath !== "string" || !path.isAbsolute(worktreePath) ||
      typeof branchRef !== "string" || !BRANCH_REF_RE.test(branchRef) ||
      typeof targetSha !== "string" || !OID_RE.test(targetSha) ||
      !Object.values(OWNED_WORKTREE_CHECKOUT_MUTATIONS).includes(mutation) ||
      !(floorSha === null || (typeof floorSha === "string" && OID_RE.test(floorSha)))) {
    fail(OWNED_WORKTREE_CHECKOUT_CODES.INVALID_ARG,
      "checkout synchronization requires the configured repository, the bound checkout and branch, the target " +
        "commit and the permitted mutation");
  }
  const input = Object.freeze({ mainRepo, worktreePath, branchRef, targetSha, mutation, floorSha });
  const proceed = () => synchronize(deps.runGit ?? defaultOwnedCheckoutRunGit,
    { repository: realpathSync(mainRepo), worktreePath, branchRef, targetSha, mutation, floorSha });
  return synchronizationHookForTest === null ? proceed() : synchronizationHookForTest(input, proceed);
}
