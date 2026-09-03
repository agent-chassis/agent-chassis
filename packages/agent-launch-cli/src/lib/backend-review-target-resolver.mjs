import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

import {
  materializeImmutableCandidate,
  resolveImmutableExactCommitCandidate
} from "./backend-immutable-candidate.mjs";
import { defaultRunGit } from "./worktree-substrate.mjs";

export const ADVISORY_MATERIAL_RESOLUTION_FAILED =
  "agent_launch.advisory_material_resolution.failed.v1";

const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export const CONFIGURED_WORKTREE_SCHEMA_VERSION =
  "workspace-agent-configured-worktree.v1";

function fail(reason, detail = null, cause = undefined) {
  const error = new Error("the advisory material could not be resolved to an exact commit range", {
    cause
  });
  error.name = "AdvisoryMaterialResolutionError";
  error.code = ADVISORY_MATERIAL_RESOLUTION_FAILED;
  error.detail = Object.freeze({ reason, ...(detail ?? {}) });
  throw error;
}

function git(runGit, repo, args, reason, detail = null) {
  const result = runGit({ repo, args });
  if (result?.ok !== true) fail(reason, detail);
  return String(result.stdout ?? "").trim();
}

function digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function exactExistingWorktreeCommit(runGit, repo, value) {
  if (typeof value !== "string" || !OID_RE.test(value) || /^0+$/u.test(value)) {
    fail("existing_worktree_head_unavailable");
  }
  const result = runGit({ repo,
    args: ["--no-replace-objects", "cat-file", "-t", value] });
  if (result?.ok !== true || String(result.stdout ?? "").trim() !== "commit") {
    fail("existing_worktree_head_unavailable");
  }
  return value;
}

function parseRegisteredWorktrees(raw) {
  const entries = [];
  let current = {};
  for (const token of String(raw ?? "").split("\0")) {
    if (token === "") {
      if (Object.keys(current).length > 0) entries.push(current);
      current = {};
      continue;
    }
    const separator = token.indexOf(" ");
    const key = separator === -1 ? token : token.slice(0, separator);
    const value = separator === -1 ? true : token.slice(separator + 1);
    if (Object.hasOwn(current, key)) fail("worktree_registration_malformed");
    current[key] = value;
  }
  if (Object.keys(current).length > 0) entries.push(current);
  return entries;
}

function optionalGit(runGit, repo, args, reason) {
  const result = runGit({ repo, args });
  if (result?.ok === true) return String(result.stdout ?? "").trim();
  if (result?.status === 1) return null;
  fail(reason);
}

export function resolveAuthenticatedConfiguredWorktree({
  mainRepo,
  runGit = defaultRunGit
} = {}) {
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo)) {
    fail("configured_worktree_locator_invalid");
  }
  const repositoryPath = realpathSync(mainRepo);
  if (repositoryPath !== mainRepo || lstatSync(repositoryPath).isSymbolicLink() ||
      git(runGit, mainRepo, ["rev-parse", "--show-toplevel"], "repository_invalid") !==
        repositoryPath) fail("repository_invalid");
  const commonDirectory = realpathSync(git(
    runGit, mainRepo,
    ["rev-parse", "--path-format=absolute", "--git-common-dir"], "repository_invalid"
  ));
  const registrations = parseRegisteredWorktrees(git(
    runGit, mainRepo, ["worktree", "list", "--porcelain", "-z"],
    "worktree_registry_unreadable"
  ));
  const matches = registrations.filter((entry) =>
    path.resolve(String(entry.worktree ?? "")) === repositoryPath);
  if (matches.length !== 1) fail("configured_worktree_registration_invalid", {
    match_count: matches.length
  });
  const registration = matches[0];
  const worktreePath = realpathSync(path.resolve(String(registration.worktree ?? "")));
  if (lstatSync(worktreePath).isSymbolicLink() || registration.bare === true ||
      registration.prunable === true ||
      worktreePath !== repositoryPath) {
    fail("configured_worktree_binding_mismatch");
  }
  const topLevel = git(runGit, worktreePath,
    ["rev-parse", "--show-toplevel"], "existing_worktree_binding_mismatch");
  const worktreeCommonDirectory = realpathSync(git(runGit, worktreePath,
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    "existing_worktree_binding_mismatch"));
  const commit = exactExistingWorktreeCommit(runGit, worktreePath, git(
    runGit, worktreePath, ["--no-replace-objects", "rev-parse", "--verify", "HEAD^{commit}"],
    "existing_worktree_head_unavailable"
  ));
  const tree = git(runGit, worktreePath,
    ["--no-replace-objects", "rev-parse", "--verify", "HEAD^{tree}"],
    "existing_worktree_tree_unavailable");
  const branch = optionalGit(runGit, worktreePath,
    ["symbolic-ref", "-q", "HEAD"], "existing_worktree_branch_unavailable");
  const status = git(runGit, worktreePath,
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    "existing_worktree_status_unavailable");
  if (topLevel !== worktreePath || worktreeCommonDirectory !== commonDirectory ||
      registration.HEAD !== commit || !OID_RE.test(tree) || /^0+$/u.test(tree)) {
    fail("configured_worktree_binding_mismatch");
  }
  const clean = status.length === 0;
  for (const key of ["core.sparseCheckout", "core.sparseCheckoutCone", "index.sparse"]) {
    const sparse = optionalGit(runGit, worktreePath,
      ["config", "--bool", "--get", key], "existing_worktree_sparse_probe_unavailable");
    if (sparse === "true") fail("configured_worktree_not_full");
  }
  const identityBody = Object.freeze({
    schema_version: CONFIGURED_WORKTREE_SCHEMA_VERSION,
    selector: Object.freeze({ kind: "current_main" }),
    repository_path: repositoryPath,
    worktree_path: worktreePath,
    git_common_directory: commonDirectory,
    branch,
    commit,
    tree,
    clean,
    status_digest: digest({ status })
  });
  return Object.freeze({
    ...identityBody,
    authenticated_worktree_identity: digest(identityBody)
  });
}

export function canonicalSliceMaterialRef(materialUnit) {
  if (typeof materialUnit?.initiative !== "string" ||
      typeof materialUnit?.record_id !== "string" ||
      typeof materialUnit?.slice_id !== "string") {
    fail("canonical_subject_unavailable");
  }
  return `refs/heads/slice/${materialUnit.initiative}/${materialUnit.record_id}/${materialUnit.slice_id}`;
}

function proveAncestry(runGit, repo, base, reviewed) {
  const forward = runGit({ repo, args: ["merge-base", "--is-ancestor", base, reviewed] });
  if (forward?.ok === true) return;
  if (forward?.status !== 1) fail("ancestry_probe_unavailable");
  const reverse = runGit({ repo, args: ["merge-base", "--is-ancestor", reviewed, base] });
  if (reverse?.ok === true) fail("diff_range_reversed");
  if (reverse?.status === 1) fail("diff_range_disjoint");
  fail("ancestry_probe_unavailable");
}

export function resolveImmutableAdvisoryReviewTarget({
  mainRepo,
  subject,
  reviewUnit,
  reviewedSha,
  diffBaseSha,
  allowEmpty = false,
  runGit = defaultRunGit
} = {}) {
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo) ||
      reviewUnit?.subject !== subject) {
    fail("repository_or_subject_invalid");
  }

  const hasReviewed = reviewedSha !== undefined && reviewedSha !== null;
  const hasBase = diffBaseSha !== undefined && diffBaseSha !== null;
  if (hasReviewed !== hasBase) fail("locator_pair_incomplete");

  const expectedRef = hasReviewed ? null : canonicalSliceMaterialRef(reviewUnit);
  let target;
  if (hasReviewed) {
    target = Object.freeze({ sha: reviewedSha, diff_base_sha: diffBaseSha });
  } else {
    const sha = git(runGit, mainRepo,
      ["rev-parse", "--verify", `${expectedRef}^{commit}`], "commit_object_unavailable");
    const base = git(runGit, mainRepo,
      ["rev-parse", "--verify", `${sha}^`], "diff_base_commit_unavailable");
    target = Object.freeze({ sha, diff_base_sha: base });
  }

  const repositoryPath = git(runGit, mainRepo, ["rev-parse", "--show-toplevel"],
    "repository_invalid");
  const gitDirectory = git(runGit, mainRepo, ["rev-parse", "--absolute-git-dir"],
    "repository_invalid");
  if (!path.isAbsolute(repositoryPath) || path.resolve(repositoryPath) !== path.resolve(mainRepo) ||
      !path.isAbsolute(gitDirectory)) {
    fail("repository_invalid");
  }
  const reviewedCandidate = resolveImmutableExactCommitCandidate({
    mainRepo, gitSha: target.sha, runGit
  });
  const baseCandidate = resolveImmutableExactCommitCandidate({
    mainRepo, gitSha: target.diff_base_sha, runGit
  });
  const reviewed = reviewedCandidate.commit;
  const base = baseCandidate.commit;
  if (reviewed === base && !allowEmpty) fail("range_empty");
  if (reviewed !== base) proveAncestry(runGit, mainRepo, base, reviewed);
  const reviewedTree = reviewedCandidate.tree;
  const diffBaseTree = baseCandidate.tree;

  if (!hasReviewed) {
    const finalReviewed = git(runGit, mainRepo,
      ["rev-parse", "--verify", `${expectedRef}^{commit}`], "selected_delivery_moved");
    if (finalReviewed !== reviewed) fail("selected_delivery_moved", { field: "reviewed_sha" });
  }

  const repositoryIdentity = Object.freeze({
    repository_path: repositoryPath,
    git_directory: gitDirectory
  });
  const immutableIdentityBody = Object.freeze({
    schema_version: "workspace-agent-normalized-advisory-material.v1",
    repository_identity: repositoryIdentity,
    diff_base_sha: base,
    diff_base_tree_sha: diffBaseTree,
    reviewed_sha: reviewed,
    reviewed_tree_sha: reviewedTree
  });
  const immutableSourceIdentity = digest(immutableIdentityBody);
  return Object.freeze({
    ...immutableIdentityBody,
    immutable_candidate: reviewedCandidate,
    empty_diff: diffBaseTree === reviewedTree,
    immutable_source_identity: immutableSourceIdentity,
    snapshot_identity: immutableSourceIdentity
  });
}

export function materializeImmutableAdvisoryReviewTarget({
  normalizedTarget,
  worktreeRoot,
  runGit = defaultRunGit
} = {}) {
  const materialized = materializeImmutableCandidate({
    candidate: normalizedTarget?.immutable_candidate,
    worktreeRoot,
    runGit
  });
  return Object.freeze({
    ...normalizedTarget,
    repository: materialized.repository,
    reviewed_tree: normalizedTarget.reviewed_tree_sha,
    private_snapshot: Object.freeze({
      worktree_path: materialized.checkout.worktree_path,
      reviewed_sha: materialized.checkout.commit,
      reviewed_tree: materialized.checkout.tree,
      read_only: true
    }),
    cleanup: materialized.cleanup
  });
}
