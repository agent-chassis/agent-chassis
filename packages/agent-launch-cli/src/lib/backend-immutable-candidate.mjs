import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync
} from "node:fs";
import path from "node:path";

import { defaultRunGit } from "./worktree-substrate.mjs";

export const IMMUTABLE_CANDIDATE_FAILURE_CODE =
  "agent_launch.immutable_candidate.failed.v1";
export const IMMUTABLE_CANDIDATE_SCHEMA_VERSION =
  "workspace-agent-immutable-candidate.v1";

const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export class ImmutableCandidateError extends Error {
  constructor(reason, detail = null, cause = undefined) {
    super("the immutable exact-commit candidate lifecycle failed",
      cause === undefined ? undefined : { cause });
    this.name = "ImmutableCandidateError";
    this.code = IMMUTABLE_CANDIDATE_FAILURE_CODE;
    this.detail = Object.freeze({ reason, ...(detail ?? {}) });
  }
}

function fail(reason, detail = null, cause = undefined) {
  throw new ImmutableCandidateError(reason, detail, cause);
}

function digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function git(runGit, repo, args, reason, detail = null) {
  const result = runGit({ repo, args });
  if (result?.ok !== true) fail(reason, detail);
  const value = String(result.stdout ?? "").trim();
  if (value.length === 0) fail(reason, detail);
  return value;
}

export function resolveImmutableExactCommitCandidate({
  mainRepo,
  gitSha,
  runGit = defaultRunGit
} = {}) {
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo) ||
      typeof gitSha !== "string" || !OID_RE.test(gitSha) || /^0+$/u.test(gitSha)) {
    fail("locator_malformed");
  }
  let repositoryPath;
  try {
    repositoryPath = realpathSync(mainRepo);
  } catch (error) {
    fail("repository_invalid", null, error);
  }
  if (repositoryPath !== mainRepo || lstatSync(repositoryPath).isSymbolicLink() ||
      git(runGit, mainRepo, ["rev-parse", "--show-toplevel"], "repository_invalid") !==
        repositoryPath) fail("repository_invalid");
  const gitDirectory = git(runGit, mainRepo,
    ["rev-parse", "--absolute-git-dir"], "repository_invalid");
  const format = git(runGit, mainRepo,
    ["--no-replace-objects", "rev-parse", "--show-object-format"],
    "object_format_unavailable");
  if (!["sha1", "sha256"].includes(format)) fail("object_format_unsupported", {
    object_format: format
  });
  const expectedWidth = format === "sha1" ? 40 : 64;
  if (gitSha.length !== expectedWidth) fail("locator_width_mismatch", {
    object_format: format,
    expected_width: expectedWidth,
    actual_width: gitSha.length
  });
  const probe = runGit({ repo: mainRepo,
    args: ["--no-replace-objects", "cat-file", "-t", gitSha] });
  if (probe?.ok !== true) fail("commit_object_unavailable");
  if (String(probe.stdout ?? "").trim() !== "commit") fail("commit_object_not_commit");
  const tree = git(runGit, mainRepo,
    ["--no-replace-objects", "rev-parse", "--verify", `${gitSha}^{tree}`],
    "commit_tree_unavailable");
  if (!OID_RE.test(tree) || /^0+$/u.test(tree)) fail("commit_tree_unavailable");
  const body = Object.freeze({
    schema_version: IMMUTABLE_CANDIDATE_SCHEMA_VERSION,
    repository_identity: Object.freeze({
      repository_path: repositoryPath,
      git_directory: gitDirectory
    }),
    commit: gitSha,
    tree
  });
  return Object.freeze({ ...body, authenticated_candidate_identity: digest(body) });
}

function cleanupFailure({ runGit, repository, actionRoot, checkout, worktreeAdded,
  primaryErrorCode = null }) {
  const registrationState = () => {
    const result = runGit({ repo: repository,
      args: ["worktree", "list", "--porcelain", "-z"] });
    if (result?.ok !== true) return null;
    const registered = String(result.stdout ?? "").split("\0")
      .filter((token) => token.startsWith("worktree "))
      .map((token) => path.resolve(token.slice("worktree ".length)));
    return registered.includes(path.resolve(checkout));
  };
  let registrationRetained = worktreeAdded ? true : registrationState();
  if (registrationRetained === true) {
    const removed = runGit({ repo: repository,
      args: ["worktree", "remove", "--force", checkout] });
    registrationRetained = removed?.ok === true ? registrationState() : true;
  }
  let filesystemRemovalFailed = false;
  if (registrationRetained === false) {
    try {
      rmSync(actionRoot, { recursive: true, force: true });
    } catch {
      filesystemRemovalFailed = true;
    }
  }
  const checkoutRootPresent = existsSync(actionRoot);
  if (registrationRetained !== false || checkoutRootPresent || filesystemRemovalFailed) {
    fail("cleanup_failed", {
      primary_error_code: typeof primaryErrorCode === "string" ? primaryErrorCode : null,
      worktree_registration_retained: registrationRetained !== false,
      checkout_root_present: checkoutRootPresent,
      filesystem_removal_failed: filesystemRemovalFailed
    });
  }
}

export function materializeImmutableCandidate({
  candidate,
  worktreeRoot,
  runGit = defaultRunGit
} = {}) {
  const repository = candidate?.repository_identity?.repository_path;
  if (candidate?.schema_version !== IMMUTABLE_CANDIDATE_SCHEMA_VERSION ||
      typeof candidate?.authenticated_candidate_identity !== "string" ||
      typeof repository !== "string" || !path.isAbsolute(repository) ||
      typeof worktreeRoot !== "string" || !path.isAbsolute(worktreeRoot)) {
    fail("materialization_input_invalid");
  }
  const authenticatedBody = {
    schema_version: candidate.schema_version,
    repository_identity: candidate.repository_identity,
    commit: candidate.commit,
    tree: candidate.tree
  };
  if (digest(authenticatedBody) !== candidate.authenticated_candidate_identity) {
    fail("materialization_input_invalid");
  }
  const root = path.join(worktreeRoot, ".immutable-candidates");
  try {
    mkdirSync(root, { recursive: true, mode: 0o700 });
  } catch (error) {
    fail("materialization_root_unavailable", null, error);
  }
  let actionRoot;
  try {
    actionRoot = mkdtempSync(path.join(root, "candidate-"));
  } catch (error) {
    fail("materialization_root_unavailable", null, error);
  }
  const checkout = path.join(actionRoot, "checkout");
  let worktreeAdded = false;
  let observedCommit;
  let observedTree;
  try {
    const added = runGit({ repo: repository,
      args: ["worktree", "add", "--detach", checkout, candidate.commit] });
    if (added?.ok !== true) fail("materialization_failed");
    worktreeAdded = true;
    observedCommit = git(runGit, checkout,
      ["--no-replace-objects", "rev-parse", "--verify", "HEAD^{commit}"],
      "materialized_identity_unavailable");
    observedTree = git(runGit, checkout,
      ["--no-replace-objects", "rev-parse", "--verify", "HEAD^{tree}"],
      "materialized_identity_unavailable");
    if (observedCommit !== candidate.commit || observedTree !== candidate.tree) fail(
      "materialized_identity_mismatch", {
        expected_commit: candidate.commit,
        observed_commit: observedCommit,
        expected_tree: candidate.tree,
        observed_tree: observedTree
      }
    );
  } catch (error) {
    cleanupFailure({ runGit, repository, actionRoot, checkout, worktreeAdded,
      primaryErrorCode: error?.code ?? null });
    throw error;
  }
  let cleaned = false;
  const cleanup = ({ primaryErrorCode = null } = {}) => {
    if (cleaned) return;
    cleanupFailure({ runGit, repository, actionRoot, checkout, worktreeAdded,
      primaryErrorCode });
    cleaned = true;
  };
  return Object.freeze({
    schema_version: "workspace-agent-materialized-immutable-candidate.v1",
    candidate,
    repository,
    checkout: Object.freeze({
      worktree_path: checkout,
      commit: observedCommit,
      tree: observedTree,
      read_only: true
    }),
    cleanup
  });
}

export function assertMaterializedImmutableCandidateCurrent({
  materialized,
  runGit = defaultRunGit
} = {}) {
  const checkout = materialized?.checkout?.worktree_path;
  const candidate = materialized?.candidate;
  if (typeof checkout !== "string" || !path.isAbsolute(checkout) ||
      candidate?.schema_version !== IMMUTABLE_CANDIDATE_SCHEMA_VERSION) {
    fail("materialized_identity_unavailable");
  }
  let canonicalCheckout;
  try {
    canonicalCheckout = realpathSync(checkout);
  } catch (error) {
    fail("materialized_identity_unavailable", null, error);
  }
  if (canonicalCheckout !== checkout || lstatSync(checkout).isSymbolicLink()) {
    fail("materialized_identity_unavailable");
  }
  const observedCommit = git(runGit, checkout,
    ["--no-replace-objects", "rev-parse", "--verify", "HEAD^{commit}"],
    "materialized_identity_unavailable");
  const observedTree = git(runGit, checkout,
    ["--no-replace-objects", "rev-parse", "--verify", "HEAD^{tree}"],
    "materialized_identity_unavailable");
  if (observedCommit !== candidate.commit || observedTree !== candidate.tree) fail(
    "materialized_identity_mismatch", {
      expected_commit: candidate.commit,
      observed_commit: observedCommit,
      expected_tree: candidate.tree,
      observed_tree: observedTree
    }
  );
  return Object.freeze({ commit: observedCommit, tree: observedTree });
}
