

import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import {
  OID_RE,
  TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES,
  assertOutsideRepository,
  fail,
  gitStdout,
  requireRunGit,
  resolvedExistingPath
} from "./terminal-materialization-primitives.mjs";

export const TERMINAL_REVIEW_MATERIALIZATION_SCHEMA_VERSION =
  "agent_launch.terminal_review_materialization.v1";

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

function verifyPart(part, actual, expected) {
  if (actual !== expected) {
    fail(TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.VERIFY_FAILED,
      `materialized review checkout failed part ${part}`, { part, expected, actual });
  }
}

export async function verifyTerminalReviewMaterialization({ mainRepo, worktreePath, wkRef, frozenSha, runGit } = {}) {
  assertMaterializationTarget({ mainRepo, worktreePath, wkRef, frozenSha });
  const git = requireRunGit(runGit);

  const probe = (part, args, message) => gitStdout(git, worktreePath, args,
    { code: TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.VERIFY_FAILED, message, part });

  verifyPart(TERMINAL_REVIEW_VERIFY_PARTS[0],
    await probe(TERMINAL_REVIEW_VERIFY_PARTS[0], ["symbolic-ref", "--quiet", "HEAD"],
      "could not read the materialized worktree symbolic HEAD"), wkRef);

  verifyPart(TERMINAL_REVIEW_VERIFY_PARTS[1],
    await probe(TERMINAL_REVIEW_VERIFY_PARTS[1], ["rev-parse", "--verify", `${wkRef}^{commit}`],
      "could not resolve the WK ref from the materialized worktree"), frozenSha);

  verifyPart(TERMINAL_REVIEW_VERIFY_PARTS[2],
    await probe(TERMINAL_REVIEW_VERIFY_PARTS[2], ["rev-parse", "--verify", "HEAD^{commit}"],
      "could not resolve the materialized worktree HEAD"), frozenSha);
  const frozenTree = await probe(TERMINAL_REVIEW_VERIFY_PARTS[3], ["rev-parse", "--verify", `${frozenSha}^{tree}`],
    "could not resolve the frozen reviewed tree");

  verifyPart(TERMINAL_REVIEW_VERIFY_PARTS[3],
    await probe(TERMINAL_REVIEW_VERIFY_PARTS[3], ["rev-parse", "--verify", "HEAD^{tree}"],
      "could not resolve the materialized worktree HEAD tree"), frozenTree);

  verifyPart(TERMINAL_REVIEW_VERIFY_PARTS[4],
    await probe(TERMINAL_REVIEW_VERIFY_PARTS[4], ["write-tree"],
      "could not write the materialized worktree index tree"), frozenTree);

  const indexDiff = await probe(TERMINAL_REVIEW_VERIFY_PARTS[5], ["diff", "--cached", "--name-only", "HEAD", "--"],
    "could not read the materialized worktree index diff");
  const worktreeDiff = await probe(TERMINAL_REVIEW_VERIFY_PARTS[5], ["diff", "--name-only", "--"],
    "could not read the materialized worktree file diff");
  verifyPart(TERMINAL_REVIEW_VERIFY_PARTS[5], `${indexDiff}${worktreeDiff}`, "");

  verifyPart(TERMINAL_REVIEW_VERIFY_PARTS[6],
    await probe(TERMINAL_REVIEW_VERIFY_PARTS[6], ["ls-files", "--others", "--exclude-standard"],
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

async function clearPersistentWorktree({ runGit, mainRepo, worktreePath }) {
  if (existsSync(worktreePath)) {
    await runGit({ repo: mainRepo, args: ["worktree", "remove", "--force", worktreePath] });
  }
  if (existsSync(worktreePath)) {

    rmSync(worktreePath, { recursive: true, force: true });
  }
  if (existsSync(worktreePath)) {
    fail(TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.MATERIALIZE_FAILED,
      "could not clear the persistent review worktree path", { worktree_path: worktreePath });
  }
  await runGit({ repo: mainRepo, args: ["worktree", "prune"] });
}

export async function materializeTerminalReviewWorktree({ mainRepo, worktreePath, wkRef, frozenSha, runGit } = {}) {
  assertMaterializationTarget({ mainRepo, worktreePath, wkRef, frozenSha });
  const git = requireRunGit(runGit);

  const refSha = await gitStdout(git, mainRepo, ["rev-parse", "--verify", `${wkRef}^{commit}`], {
    code: TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.FROZEN_TARGET_MISMATCH,
    message: "could not resolve the canonical WK ref for the frozen review target"
  });
  if (refSha !== frozenSha) {
    fail(TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.FROZEN_TARGET_MISMATCH,
      "the canonical WK ref does not name the frozen reviewed SHA", { wk_ref: wkRef, expected: frozenSha, actual: refSha });
  }

  await clearPersistentWorktree({ runGit: git, mainRepo, worktreePath });

  const branch = wkRef.slice("refs/heads/".length);
  await gitStdout(git, mainRepo, ["worktree", "add", worktreePath, branch], {
    code: TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.MATERIALIZE_FAILED,
    message: "could not re-create the persistent review worktree at the frozen reviewed SHA"
  });

  return await verifyTerminalReviewMaterialization({ mainRepo, worktreePath, wkRef, frozenSha, runGit: git });
}
