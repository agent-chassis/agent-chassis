import { createHash } from "node:crypto";
import { lstatSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

import {
  IMMUTABLE_CANDIDATE_FAILURE_CODE,
  materializeImmutableCandidate,
  resolveImmutableExactCommitCandidate
} from "./backend-immutable-candidate.mjs";
import { defaultRunGit, perWkBranchRef, sliceBranchRef } from "./worktree-substrate.mjs";
import { listOwnedWorktreeBindings } from "./worktree-substrate-identity.mjs";
import { SLICE_ID_RE, parseSubject, parseUnitAddress } from "./worktree-substrate-primitives.mjs";

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
    ["--no-optional-locks", "status", "--porcelain=v1", "-z", "--untracked-files=all"],
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

function sha256Like(value) {
  return typeof value === "string" && OID_RE.test(value) && !/^0+$/u.test(value);
}

const EXACT_COMMIT_ABSENT_REASONS = Object.freeze(["locator_malformed", "locator_width_mismatch",
  "commit_object_unavailable", "commit_object_not_commit", "commit_tree_unavailable"]);

export function resolveExactCommitIdentity({ mainRepo, gitSha, runGit = defaultRunGit } = {}) {
  try {
    return resolveImmutableExactCommitCandidate({ mainRepo, gitSha, runGit });
  } catch (error) {
    if (error?.code === IMMUTABLE_CANDIDATE_FAILURE_CODE &&
        EXACT_COMMIT_ABSENT_REASONS.includes(error.detail?.reason)) return null;
    fail("repository_invalid", null, error);
  }
}

function gitOutput(runGit, repo, args) {
  const result = runGit({ repo, args });
  return result?.ok === true ? String(result.stdout ?? "") : null;
}

function physicalWorktreeState(runGit, { worktreePath, commonDirectory, commit, tree }) {
  let real;
  try {
    real = realpathSync(worktreePath);
  } catch {
    return "moved";
  }
  if (real !== worktreePath || lstatSync(real).isSymbolicLink()) return "moved";
  const topLevel = gitOutput(runGit, real, ["rev-parse", "--show-toplevel"])?.trim();
  const common = gitOutput(runGit, real, ["rev-parse", "--path-format=absolute", "--git-common-dir"])?.trim();
  let commonReal = null;
  try {
    commonReal = common ? realpathSync(common) : null;
  } catch {
    commonReal = null;
  }
  if (topLevel !== real || commonReal !== commonDirectory) return "repository_mismatch";
  const head = gitOutput(runGit, real, ["--no-replace-objects", "rev-parse", "--verify", "HEAD^{commit}"])?.trim();
  const headTree = gitOutput(runGit, real, ["--no-replace-objects", "rev-parse", "--verify", "HEAD^{tree}"])?.trim();
  if (head !== commit || headTree !== tree) return "moved";
  for (const key of ["core.sparseCheckout", "core.sparseCheckoutCone", "index.sparse"]) {
    if (optionalGit(runGit, real, ["config", "--bool", "--get", key], "existing_worktree_sparse_probe_unavailable") ===
        "true") return "not_full";
  }
  const status = gitOutput(runGit, real,
    ["--no-optional-locks", "status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (status === null) return "status_unavailable";
  return status.length === 0 ? "clean" : "dirty";
}

export function classifyWorktreeAtCommit({ mainRepo, worktreePath, commit, runGit = defaultRunGit } = {}) {
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo) || !sha256Like(commit)) return "commit_unavailable";
  const repositoryPath = realpathSync(mainRepo);
  const identity = resolveExactCommitIdentity({ mainRepo: repositoryPath, gitSha: commit, runGit });
  if (identity === null) return "commit_unavailable";
  const commonDirectory = realpathSync(git(runGit, repositoryPath,
    ["rev-parse", "--path-format=absolute", "--git-common-dir"], "repository_invalid"));
  return physicalWorktreeState(runGit, { worktreePath, commonDirectory, commit, tree: identity.tree });
}

const EXACT_COMMIT_UNAVAILABLE_ORDER = Object.freeze(["moved", "dirty", "not_full", "status_unavailable",
  "repository_mismatch", "unowned"]);

function physicalCheckoutIdentity(worktreePath) {
  const stat = statSync(worktreePath, { bigint: true });
  return `${stat.dev}:${stat.ino}`;
}

export function resolveOwnedExactCommitWorktree({
  mainRepo,
  gitSha,
  exclude = [],
  owners: authenticatedOwners = [],
  unitAddress = null,
  runGit = defaultRunGit
} = {}) {
  const unavailable = (reason, detail = {}, soleUnit = null) => Object.freeze({ ok: false, reason,
    detail: Object.freeze({ commit: typeof gitSha === "string" ? gitSha : null, ...detail }), sole_unit: soleUnit });
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo)) fail("repository_invalid");
  const repositoryPath = realpathSync(mainRepo);
  if (!sha256Like(gitSha)) return unavailable("commit_unavailable");
  const identity = resolveExactCommitIdentity({ mainRepo: repositoryPath, gitSha, runGit });
  if (identity === null) return unavailable("commit_unavailable");
  const tree = identity.tree;
  const commonDirectory = realpathSync(git(runGit, repositoryPath,
    ["rev-parse", "--path-format=absolute", "--git-common-dir"], "repository_invalid"));
  const owners = new Map(unitAddress === null
    ? [[repositoryPath, Object.freeze({ kind: "configured_worktree" })]] : []);

  const contested = new Set();

  const bound = new Set();
  for (const binding of listOwnedWorktreeBindings(repositoryPath)) {
    if (binding.unit_address === unitAddress) bound.add(binding.worktree_path);
    const recorded = owners.get(binding.worktree_path);
    if (recorded === undefined) {
      owners.set(binding.worktree_path, Object.freeze({ kind: "launcher_binding",
        unit_address: binding.unit_address }));
    } else if (recorded.unit_address !== binding.unit_address) contested.add(binding.worktree_path);
  }
  if (unitAddress === null) {
    for (const { worktree_path: ownedPath, owner } of authenticatedOwners) {
      if (!owners.has(ownedPath)) owners.set(ownedPath, owner);
    }
  }
  const eligible = (worktreePath) => unitAddress === null || bound.has(worktreePath);
  const excluded = new Set(exclude);
  const registrations = parseRegisteredWorktrees(git(runGit, repositoryPath,
    ["worktree", "list", "--porcelain", "-z"], "worktree_registry_unreadable"));
  const clean = new Map();
  const seen = new Map();
  for (const registration of registrations) {
    if (registration.bare === true || registration.HEAD !== gitSha) continue;
    const worktreePath = path.resolve(String(registration.worktree ?? ""));
    if (excluded.has(worktreePath) || !eligible(worktreePath)) continue;
    const owner = owners.get(worktreePath) ?? null;
    const state = owner === null ? "unowned" : registration.prunable !== undefined ? "moved"
      : physicalWorktreeState(runGit, { worktreePath, commonDirectory, commit: gitSha, tree });
    if (state !== "clean") {
      seen.set(state, [...(seen.get(state) ?? []), worktreePath]);
      continue;
    }
    const physical = physicalCheckoutIdentity(worktreePath);
    const selected = clean.get(physical);
    if (selected === undefined ||
        Buffer.compare(Buffer.from(worktreePath, "utf8"), Buffer.from(selected.worktree_path, "utf8")) < 0) {
      clean.set(physical, { worktree_path: worktreePath, owner });
    }
  }
  if (clean.size > 0) {
    const [selected] = [...clean.values()].sort((left, right) =>
      Buffer.compare(Buffer.from(left.worktree_path, "utf8"), Buffer.from(right.worktree_path, "utf8")));
    return Object.freeze({ ok: true, worktree_path: selected.worktree_path, commit: gitSha, tree,
      owner: selected.owner, match_count: clean.size });
  }
  const reason = EXACT_COMMIT_UNAVAILABLE_ORDER.find((candidate) => seen.has(candidate)) ?? "not_materialized";
  const only = seen.size === 1 && seen.get(reason).length === 1 ? seen.get(reason)[0] : null;
  const owner = only === null || contested.has(only) ? null : owners.get(only) ?? null;
  return unavailable(reason, reason === "not_materialized" ? {} : { worktree_count: seen.get(reason).length },
    owner?.kind === "launcher_binding"
      ? Object.freeze({ ...canonicalUnitBranch(owner.unit_address), state: reason }) : null);
}

function canonicalUnitBranch(unitAddress) {
  const unit = parseUnitAddress(unitAddress);
  return Object.freeze({ kind: unit.kind, unit_address: unit.unitAddress, wk_id: unit.wkId, slice_id: unit.sliceId,
    branch: unit.kind === "wk" ? perWkBranchRef(unit.initiative, unit.wkId)
      : sliceBranchRef(unit.initiative, unit.wkId, unit.sliceId) });
}

export function parseCanonicalUnitBranch(branch) {
  if (typeof branch !== "string" || !branch.includes("/")) return null;
  try {
    const unit = canonicalUnitBranch(branch.slice(branch.indexOf("/") + 1));
    return unit.branch === branch ? unit : null;
  } catch {
    return null;
  }
}

export function resolveCanonicalUnitBranch({ mainRepo, selector, contextWkId = null, initiativeOf = () => null,
  runGit = defaultRunGit } = {}) {
  const unresolved = (reason, detail = {}) => Object.freeze({ ok: false, reason,
    detail: Object.freeze({ selector: typeof selector === "string" ? selector : null, ...detail }) });
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo)) fail("repository_invalid");
  if (typeof selector !== "string" || selector.length === 0) return unresolved("selector_invalid");
  let unit = parseCanonicalUnitBranch(selector);
  if (unit === null) {
    if (selector.includes("/")) return unresolved("selector_invalid");
    const relative = SLICE_ID_RE.test(selector);
    if (relative && typeof contextWkId !== "string") return unresolved("slice_context_unavailable");
    try {
      const { wkId, sliceId } = parseSubject(relative ? `${contextWkId}#${selector}` : selector);
      const initiative = initiativeOf(wkId);
      if (typeof initiative !== "string") return unresolved("initiative_unavailable", { wk_id: wkId });
      unit = canonicalUnitBranch([initiative, wkId, ...(sliceId === null ? [] : [sliceId])].join("/"));
    } catch {
      return unresolved("selector_invalid");
    }
  }
  const ref = `refs/heads/${unit.branch}`;
  const tip = gitOutput(runGit, mainRepo, ["--no-replace-objects", "rev-parse", "--verify", "--quiet",
    `${ref}^{commit}`])?.trim();
  if (!sha256Like(tip)) return unresolved("branch_missing", { branch: unit.branch });
  const identity = resolveExactCommitIdentity({ mainRepo, gitSha: tip, runGit });
  if (identity === null) return unresolved("branch_commit_unavailable", { branch: unit.branch, commit: tip });
  return Object.freeze({ ok: true, selector, ...unit, ref, commit: identity.commit, tree: identity.tree });
}

export function resolveImmediateParentCommit({ mainRepo, commit, runGit = defaultRunGit } = {}) {
  if (!sha256Like(commit)) return Object.freeze({ ok: false, reason: "commit_unavailable" });
  const line = gitOutput(runGit, mainRepo, ["--no-replace-objects", "rev-list", "--parents", "-n", "1", commit]);
  if (line === null) return Object.freeze({ ok: false, reason: "commit_unavailable" });
  const [, ...parents] = line.trim().split(/\s+/u);
  if (parents.length === 0) return Object.freeze({ ok: false, reason: "candidate_is_root_commit" });
  if (parents.length > 1) return Object.freeze({ ok: false, reason: "candidate_parent_is_merge" });
  return Object.freeze({ ok: true, parent: parents[0] });
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
