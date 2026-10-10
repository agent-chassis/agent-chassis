

import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { verifyTerminalWkCandidateObjectBinding } from "./terminal-wk-candidate.mjs";
import {
  TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES,
  assertMode0700,
  assertPrivateCandidateRoot,
  fail,
  gitStdout,
  requireRunGit
} from "./terminal-materialization-primitives.mjs";

export const TERMINAL_CANDIDATE_MATERIALIZATION_SCHEMA_VERSION =
  "agent_launch.terminal_candidate_materialization.v1";

export async function verifyTerminalCandidateCheckout({ binding, candidateRoot, runGit } = {}) {
  assertPrivateCandidateRoot({ binding, candidateRoot });
  const git = requireRunGit(runGit);
  await verifyTerminalWkCandidateObjectBinding({ binding, runGit: git });
  const checkoutPath = path.join(candidateRoot, "checkout");
  if (!existsSync(candidateRoot) || !existsSync(checkoutPath)) {
    fail(TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.VERIFY_FAILED,
      "terminal candidate checkout is absent", { candidate_root: candidateRoot, checkout_path: checkoutPath });
  }
  assertMode0700(candidateRoot, "candidate root");
  assertMode0700(checkoutPath, "candidate checkout");
  const symbolic = await git({ repo: checkoutPath, args: ["symbolic-ref", "--quiet", "HEAD"] });
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
  const head = await probe(["rev-parse", "--verify", "HEAD^{commit}"], "could not resolve candidate checkout HEAD");
  const tree = await probe(["rev-parse", "--verify", "HEAD^{tree}"], "could not resolve candidate checkout tree");

  const indexDelta = await probe(
    ["--no-optional-locks", "diff-index", "--cached", "--name-only", binding.candidate_tree, "--"],
    "could not compare candidate checkout index with the candidate tree");
  const status = await probe(["--no-optional-locks", "status", "--porcelain=v1", "--untracked-files=all"],
    "could not inspect candidate checkout cleanliness");
  const checks = [
    ["head", head, binding.candidate],
    ["tree", tree, binding.candidate_tree],
    ["index_tree", indexDelta, ""],
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

    const trackedUnderMountpoint = await probe(["ls-files", "--", "node_modules"],
      "could not inspect candidate checkout dependency mountpoint tracking");
    if (trackedUnderMountpoint === "") {
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

export async function materializeTerminalCandidateCheckout({ binding, candidateRoot, runGit } = {}) {
  assertPrivateCandidateRoot({ binding, candidateRoot });
  const git = requireRunGit(runGit);
  await verifyTerminalWkCandidateObjectBinding({ binding, runGit: git });
  const checkoutPath = path.join(candidateRoot, "checkout");
  if (existsSync(candidateRoot)) {
    assertMode0700(candidateRoot, "candidate root");
    if (existsSync(checkoutPath)) {
      return await verifyTerminalCandidateCheckout({ binding, candidateRoot, runGit: git });
    }
  } else {
    mkdirSync(candidateRoot, { recursive: true, mode: 0o700 });
    chmodSync(candidateRoot, 0o700);
  }
  await gitStdout(git, binding.main_repo,
    ["worktree", "add", "--detach", checkoutPath, binding.candidate], {
      code: TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.MATERIALIZE_FAILED,
      message: "could not create detached terminal candidate checkout"
    });
  chmodSync(checkoutPath, 0o700);
  return await verifyTerminalCandidateCheckout({ binding, candidateRoot, runGit: git });
}
