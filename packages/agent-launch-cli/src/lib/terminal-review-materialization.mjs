

import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";

import { verifyTerminalWkCandidateObjectBinding } from "./terminal-wk-candidate.mjs";

export const TERMINAL_REVIEW_MATERIALIZATION_SCHEMA_VERSION =
  "agent_launch.terminal_review_materialization.v1";

export const TERMINAL_CANDIDATE_MATERIALIZATION_SCHEMA_VERSION =
  "agent_launch.terminal_candidate_materialization.v1";

export const TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES = Object.freeze({
  INVALID_ARG: "agent_launch.terminal_review_materialization.invalid_arg.v1",
  FROZEN_TARGET_MISMATCH: "agent_launch.terminal_review_materialization.frozen_target_mismatch.v1",
  MATERIALIZE_FAILED: "agent_launch.terminal_review_materialization.materialize_failed.v1",
  VERIFY_FAILED: "agent_launch.terminal_review_materialization.verify_failed.v1",
  ATTESTATION_INVALID: "agent_launch.terminal_review_materialization.attestation_invalid.v1"
});

export const TERMINAL_REVIEW_VERIFY_PARTS = Object.freeze([
  "symbolic_head_is_wk_ref",
  "wk_ref_commit_is_frozen_sha",
  "head_is_frozen_sha",
  "head_tree_is_frozen_tree",
  "write_tree_is_frozen_tree",
  "clean_index_and_worktree",
  "no_untracked_files"
]);

const WK_REF_RE = /^refs\/heads\/wk\/IN-\d{4}\/WK-\d{4}$/u;
const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export class TerminalReviewMaterializationError extends Error {
  constructor(message, { code, detail = null, cause = null } = {}) {
    super(`terminal review materialization: ${message}`);
    this.name = "TerminalReviewMaterializationError";
    this.code = code;
    this.detail = detail;
    if (cause != null) this.cause = cause;
  }
}

function fail(code, message, detail = null, cause = null) {
  throw new TerminalReviewMaterializationError(message, { code, detail, cause });
}

function assertOutsideRepository(repo, candidate, reportedPath) {
  const relative = path.relative(repo, candidate);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    fail(TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.INVALID_ARG,
      "persistent worktree path must live outside the canonical repository", { worktree_path: reportedPath });
  }
}

function resolvedExistingPath(candidate) {
  let current = candidate;
  for (;;) {
    if (existsSync(current)) return realpathSync(current);
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function assertMaterializationTarget({ mainRepo, worktreePath, wkRef, frozenSha }) {
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo)) {
    fail(TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.INVALID_ARG, "mainRepo must be an absolute path");
  }
  if (typeof worktreePath !== "string" || !path.isAbsolute(worktreePath)) {
    fail(TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.INVALID_ARG, "persistent worktree path must be absolute");
  }
  const normalizedWorktree = path.normalize(worktreePath);
  if (normalizedWorktree !== worktreePath || path.dirname(normalizedWorktree) === normalizedWorktree) {
    fail(TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.INVALID_ARG,
      "persistent worktree path must be normalized and must not be a filesystem root", { worktree_path: worktreePath });
  }
  assertOutsideRepository(path.normalize(mainRepo), normalizedWorktree, worktreePath);

  const resolvedRepo = resolvedExistingPath(path.normalize(mainRepo));
  const resolvedWorktree = resolvedExistingPath(normalizedWorktree);
  if (resolvedRepo !== null && resolvedWorktree !== null) {
    assertOutsideRepository(resolvedRepo, resolvedWorktree, worktreePath);
  }
  if (typeof wkRef !== "string" || !WK_REF_RE.test(wkRef)) {
    fail(TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.INVALID_ARG, "wkRef must be a canonical WK branch ref", { wk_ref: wkRef ?? null });
  }
  if (typeof frozenSha !== "string" || !OID_RE.test(frozenSha) || /^0+$/u.test(frozenSha)) {
    fail(TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.INVALID_ARG, "frozen reviewed SHA is not a canonical object id", { frozen_sha: frozenSha ?? null });
  }
}

function requireRunGit(runGit) {
  if (typeof runGit !== "function") {
    fail(TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.INVALID_ARG,
      "a caller-supplied runGit is required; this step runs only in the writable host boundary");
  }
  return runGit;
}

function gitStdout(runGit, repo, args, { code, message, part = null }) {
  const result = runGit({ repo, args });
  if (!result || result.ok !== true) {
    fail(code, message, {
      ...(part === null ? {} : { part }),
      repo,
      args,
      status: result?.status ?? null,
      stderr: result?.stderr ?? result?.error ?? null
    });
  }
  return String(result.stdout ?? "").trim();
}

function verifyPart(part, actual, expected) {
  if (actual !== expected) {
    fail(TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.VERIFY_FAILED,
      `materialized review checkout failed part ${part}`, { part, expected, actual });
  }
}

export function verifyTerminalReviewMaterialization({ mainRepo, worktreePath, wkRef, frozenSha, runGit } = {}) {
  assertMaterializationTarget({ mainRepo, worktreePath, wkRef, frozenSha });
  const git = requireRunGit(runGit);

  const probe = (part, args, message) => gitStdout(git, worktreePath, args,
    { code: TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.VERIFY_FAILED, message, part });

  verifyPart(TERMINAL_REVIEW_VERIFY_PARTS[0],
    probe(TERMINAL_REVIEW_VERIFY_PARTS[0], ["symbolic-ref", "--quiet", "HEAD"],
      "could not read the materialized worktree symbolic HEAD"), wkRef);

  verifyPart(TERMINAL_REVIEW_VERIFY_PARTS[1],
    probe(TERMINAL_REVIEW_VERIFY_PARTS[1], ["rev-parse", "--verify", `${wkRef}^{commit}`],
      "could not resolve the WK ref from the materialized worktree"), frozenSha);

  verifyPart(TERMINAL_REVIEW_VERIFY_PARTS[2],
    probe(TERMINAL_REVIEW_VERIFY_PARTS[2], ["rev-parse", "--verify", "HEAD^{commit}"],
      "could not resolve the materialized worktree HEAD"), frozenSha);
  const frozenTree = probe(TERMINAL_REVIEW_VERIFY_PARTS[3], ["rev-parse", "--verify", `${frozenSha}^{tree}`],
    "could not resolve the frozen reviewed tree");

  verifyPart(TERMINAL_REVIEW_VERIFY_PARTS[3],
    probe(TERMINAL_REVIEW_VERIFY_PARTS[3], ["rev-parse", "--verify", "HEAD^{tree}"],
      "could not resolve the materialized worktree HEAD tree"), frozenTree);

  verifyPart(TERMINAL_REVIEW_VERIFY_PARTS[4],
    probe(TERMINAL_REVIEW_VERIFY_PARTS[4], ["write-tree"],
      "could not write the materialized worktree index tree"), frozenTree);

  const indexDiff = probe(TERMINAL_REVIEW_VERIFY_PARTS[5], ["diff", "--cached", "--name-only", "HEAD", "--"],
    "could not read the materialized worktree index diff");
  const worktreeDiff = probe(TERMINAL_REVIEW_VERIFY_PARTS[5], ["diff", "--name-only", "--"],
    "could not read the materialized worktree file diff");
  verifyPart(TERMINAL_REVIEW_VERIFY_PARTS[5], `${indexDiff}${worktreeDiff}`, "");

  verifyPart(TERMINAL_REVIEW_VERIFY_PARTS[6],
    probe(TERMINAL_REVIEW_VERIFY_PARTS[6], ["ls-files", "--others", "--exclude-standard"],
      "could not read the materialized worktree untracked files"), "");

  return Object.freeze({
    schema_version: TERMINAL_REVIEW_MATERIALIZATION_SCHEMA_VERSION,
    worktree_path: worktreePath,
    wk_ref: wkRef,
    reviewed_sha: frozenSha,
    reviewed_tree: frozenTree,
    verified: true,
    verified_parts: TERMINAL_REVIEW_VERIFY_PARTS
  });
}

export function assertTerminalReviewMaterializationAttestation(attestation, { worktreePath, wkRef, wkSha } = {}) {
  const isObject = typeof attestation === "object" && attestation !== null && !Array.isArray(attestation);
  if (!isObject ||
      attestation.schema_version !== TERMINAL_REVIEW_MATERIALIZATION_SCHEMA_VERSION ||
      attestation.verified !== true ||
      !Array.isArray(attestation.verified_parts) ||
      attestation.verified_parts.length !== TERMINAL_REVIEW_VERIFY_PARTS.length ||
      attestation.verified_parts.some((part, index) => part !== TERMINAL_REVIEW_VERIFY_PARTS[index])) {
    fail(TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.ATTESTATION_INVALID,
      "attestation is absent, incomplete, or incompatible");
  }
  const mismatch = [
    ["worktree_path", attestation.worktree_path, worktreePath],
    ["wk_ref", attestation.wk_ref, wkRef],
    ["reviewed_sha", attestation.reviewed_sha, wkSha]
  ].find(([, actual, expected]) => actual !== expected);
  if (mismatch) {
    fail(TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.ATTESTATION_INVALID,
      `attestation is not bound to the frozen review target at ${mismatch[0]}`,
      { field: mismatch[0], expected: mismatch[2], actual: mismatch[1] });
  }
  return attestation;
}

function clearPersistentWorktree({ runGit, mainRepo, worktreePath }) {
  if (existsSync(worktreePath)) {
    runGit({ repo: mainRepo, args: ["worktree", "remove", "--force", worktreePath] });
  }
  if (existsSync(worktreePath)) {

    rmSync(worktreePath, { recursive: true, force: true });
  }
  if (existsSync(worktreePath)) {
    fail(TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.MATERIALIZE_FAILED,
      "could not clear the persistent review worktree path", { worktree_path: worktreePath });
  }
  runGit({ repo: mainRepo, args: ["worktree", "prune"] });
}

export function materializeTerminalReviewWorktree({ mainRepo, worktreePath, wkRef, frozenSha, runGit } = {}) {
  assertMaterializationTarget({ mainRepo, worktreePath, wkRef, frozenSha });
  const git = requireRunGit(runGit);

  const refSha = gitStdout(git, mainRepo, ["rev-parse", "--verify", `${wkRef}^{commit}`], {
    code: TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.FROZEN_TARGET_MISMATCH,
    message: "could not resolve the canonical WK ref for the frozen review target"
  });
  if (refSha !== frozenSha) {
    fail(TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.FROZEN_TARGET_MISMATCH,
      "the canonical WK ref does not name the frozen reviewed SHA", { wk_ref: wkRef, expected: frozenSha, actual: refSha });
  }

  clearPersistentWorktree({ runGit: git, mainRepo, worktreePath });

  const branch = wkRef.slice("refs/heads/".length);
  gitStdout(git, mainRepo, ["worktree", "add", worktreePath, branch], {
    code: TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.MATERIALIZE_FAILED,
    message: "could not re-create the persistent review worktree at the frozen reviewed SHA"
  });

  return verifyTerminalReviewMaterialization({ mainRepo, worktreePath, wkRef, frozenSha, runGit: git });
}

function assertPrivateCandidateRoot({ binding, candidateRoot }) {
  if (!binding || typeof binding !== "object" ||
      typeof candidateRoot !== "string" || !path.isAbsolute(candidateRoot) ||
      path.normalize(candidateRoot) !== candidateRoot || path.dirname(candidateRoot) === candidateRoot) {
    fail(TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.INVALID_ARG,
      "candidate root must be an absolute normalized non-root path");
  }
  assertOutsideRepository(binding.main_repo, candidateRoot, candidateRoot);
  const resolvedRepo = resolvedExistingPath(binding.main_repo);
  const resolvedCandidate = resolvedExistingPath(candidateRoot);
  if (resolvedRepo !== null && resolvedCandidate !== null) {
    assertOutsideRepository(resolvedRepo, resolvedCandidate, candidateRoot);
  }
}

function assertMode0700(target, label) {
  const stat = lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700) {
    fail(TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.VERIFY_FAILED,
      `${label} must be a real mode-0700 directory`, {
        path: target,
        mode: stat.mode & 0o777,
        directory: stat.isDirectory(),
        symlink: stat.isSymbolicLink()
      });
  }
}

export function verifyTerminalCandidateCheckout({ binding, candidateRoot, runGit } = {}) {
  assertPrivateCandidateRoot({ binding, candidateRoot });
  const git = requireRunGit(runGit);
  verifyTerminalWkCandidateObjectBinding({ binding, runGit: git });
  const checkoutPath = path.join(candidateRoot, "checkout");
  if (!existsSync(candidateRoot) || !existsSync(checkoutPath)) {
    fail(TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.VERIFY_FAILED,
      "terminal candidate checkout is absent", { candidate_root: candidateRoot, checkout_path: checkoutPath });
  }
  assertMode0700(candidateRoot, "candidate root");
  assertMode0700(checkoutPath, "candidate checkout");
  const symbolic = git({ repo: checkoutPath, args: ["symbolic-ref", "--quiet", "HEAD"] });
  if (symbolic?.ok === true) {
    fail(TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.VERIFY_FAILED,
      "terminal candidate checkout HEAD must be detached", {
        symbolic_head: String(symbolic.stdout ?? "").trim()
      });
  }
  const probe = (args, message) => gitStdout(git, checkoutPath, args, {
    code: TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.VERIFY_FAILED,
    message
  });
  const head = probe(["rev-parse", "--verify", "HEAD^{commit}"], "could not resolve candidate checkout HEAD");
  const tree = probe(["rev-parse", "--verify", "HEAD^{tree}"], "could not resolve candidate checkout tree");
  const indexTree = probe(["write-tree"], "could not resolve candidate checkout index tree");
  const status = probe(["status", "--porcelain=v1", "--untracked-files=all"],
    "could not inspect candidate checkout cleanliness");
  const checks = [
    ["head", head, binding.candidate],
    ["tree", tree, binding.candidate_tree],
    ["index_tree", indexTree, binding.candidate_tree],
    ["status", status, ""]
  ];
  const mismatch = checks.find(([, actual, expected]) => actual !== expected);
  if (mismatch) {
    fail(TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.VERIFY_FAILED,
      `terminal candidate checkout failed ${mismatch[0]} binding`, {
        field: mismatch[0], expected: mismatch[2], actual: mismatch[1]
      });
  }

  const dependencyMountpoint = path.join(checkoutPath, "node_modules");
  let mountpointStat = null;
  try {
    mountpointStat = lstatSync(dependencyMountpoint);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      fail(TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.VERIFY_FAILED,
        "could not inspect candidate checkout dependency mountpoint",
        { path: dependencyMountpoint, errno: error?.code ?? null });
    }
  }
  if (mountpointStat !== null) {
    if (!mountpointStat.isDirectory() || mountpointStat.isSymbolicLink() ||
        realpathSync(dependencyMountpoint) !== dependencyMountpoint) {
      fail(TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.VERIFY_FAILED,
        "candidate checkout dependency mountpoint must be a real non-symlink directory", {
          path: dependencyMountpoint,
          directory: mountpointStat.isDirectory(),
          symlink: mountpointStat.isSymbolicLink()
        });
    }
    if (readdirSync(dependencyMountpoint).length !== 0) {
      fail(TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.VERIFY_FAILED,
        "candidate checkout dependency mountpoint must be empty", { path: dependencyMountpoint });
    }
    const trackedUnderMountpoint = probe(["ls-files", "--", "node_modules"],
      "could not inspect candidate checkout dependency mountpoint tracking");
    if (trackedUnderMountpoint !== "") {
      fail(TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.VERIFY_FAILED,
        "candidate checkout dependency mountpoint must be untracked", { path: dependencyMountpoint });
    }
  }
  return Object.freeze({
    schema_version: TERMINAL_CANDIDATE_MATERIALIZATION_SCHEMA_VERSION,
    candidate_root: candidateRoot,
    checkout_path: checkoutPath,
    repository_digest: binding.repository.digest,
    canonical_wk_id: binding.canonical_wk_id,
    canonical_wk_digest: binding.canonical_wk_digest,
    base_ref: binding.base_ref,
    base: binding.base,
    wk_ref: binding.wk_ref,
    wk_tip: binding.wk_tip,
    candidate_ref: binding.candidate_ref,
    candidate: binding.candidate,
    candidate_tree: binding.candidate_tree,
    candidate_parent: binding.candidate_parent,
    detached: true,
    full_checkout: true,
    mode: 0o700,
    verified: true
  });
}

export function assertTerminalCandidateMaterialization(materialization, binding) {
  const expected = {
    repository_digest: binding?.repository?.digest,
    canonical_wk_id: binding?.canonical_wk_id,
    canonical_wk_digest: binding?.canonical_wk_digest,
    base_ref: binding?.base_ref,
    base: binding?.base,
    wk_ref: binding?.wk_ref,
    wk_tip: binding?.wk_tip,
    candidate_ref: binding?.candidate_ref,
    candidate: binding?.candidate,
    candidate_tree: binding?.candidate_tree,
    candidate_parent: binding?.candidate_parent
  };
  if (!materialization || typeof materialization !== "object" ||
      materialization.schema_version !== TERMINAL_CANDIDATE_MATERIALIZATION_SCHEMA_VERSION ||
      materialization.verified !== true || materialization.detached !== true ||
      materialization.full_checkout !== true || materialization.mode !== 0o700 ||
      typeof materialization.candidate_root !== "string" || !path.isAbsolute(materialization.candidate_root) ||
      materialization.checkout_path !== path.join(materialization.candidate_root, "checkout")) {
    fail(TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.ATTESTATION_INVALID,
      "terminal candidate materialization is absent or incompatible");
  }
  const mismatch = Object.entries(expected).find(([field, value]) => materialization[field] !== value);
  if (mismatch) {
    fail(TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.ATTESTATION_INVALID,
      `terminal candidate materialization disagrees at ${mismatch[0]}`, {
        field: mismatch[0], expected: mismatch[1], actual: materialization[mismatch[0]]
      });
  }
  return materialization;
}

export function materializeTerminalCandidateCheckout({ binding, candidateRoot, runGit } = {}) {
  assertPrivateCandidateRoot({ binding, candidateRoot });
  const git = requireRunGit(runGit);
  verifyTerminalWkCandidateObjectBinding({ binding, runGit: git });
  const checkoutPath = path.join(candidateRoot, "checkout");
  if (existsSync(candidateRoot)) {
    assertMode0700(candidateRoot, "candidate root");
    if (existsSync(checkoutPath)) {
      return verifyTerminalCandidateCheckout({ binding, candidateRoot, runGit: git });
    }
  } else {
    mkdirSync(candidateRoot, { recursive: true, mode: 0o700 });
    chmodSync(candidateRoot, 0o700);
  }
  gitStdout(git, binding.main_repo,
    ["worktree", "add", "--detach", checkoutPath, binding.candidate], {
      code: TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.MATERIALIZE_FAILED,
      message: "could not create detached terminal candidate checkout"
    });
  chmodSync(checkoutPath, 0o700);
  return verifyTerminalCandidateCheckout({ binding, candidateRoot, runGit: git });
}
