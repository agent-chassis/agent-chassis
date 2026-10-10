

import { existsSync, lstatSync, realpathSync } from "node:fs";
import path from "node:path";

export const TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES = Object.freeze({
  INVALID_ARG: "agent_launch.terminal_review_materialization.invalid_arg.v1",
  FROZEN_TARGET_MISMATCH: "agent_launch.terminal_review_materialization.frozen_target_mismatch.v1",
  MATERIALIZE_FAILED: "agent_launch.terminal_review_materialization.materialize_failed.v1",
  VERIFY_FAILED: "agent_launch.terminal_review_materialization.verify_failed.v1",
  ATTESTATION_INVALID: "agent_launch.terminal_review_materialization.attestation_invalid.v1"
});

export const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export class TerminalReviewMaterializationError extends Error {
  constructor(message, { code, detail = null, cause = null } = {}) {
    super(`terminal review materialization: ${message}`);
    this.name = "TerminalReviewMaterializationError";
    this.code = code;
    this.detail = detail;
    if (cause != null) this.cause = cause;
  }
}

export function fail(code, message, detail = null, cause = null) {
  throw new TerminalReviewMaterializationError(message, { code, detail, cause });
}

export function assertOutsideRepository(repo, candidate, reportedPath) {
  const relative = path.relative(repo, candidate);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    fail(TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.INVALID_ARG,
      "persistent worktree path must live outside the canonical repository", { worktree_path: reportedPath });
  }
}

export function resolvedExistingPath(candidate) {
  let current = candidate;
  for (;;) {
    if (existsSync(current)) return realpathSync(current);
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function requireRunGit(runGit) {
  if (typeof runGit !== "function") {
    fail(TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.INVALID_ARG,
      "a caller-supplied runGit is required; this step runs only in the writable host boundary");
  }
  return runGit;
}

export async function gitStdout(runGit, repo, args, { code, message, part = null }) {
  const result = await runGit({ repo, args });
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

export function assertPrivateCandidateRoot({ binding, candidateRoot }) {
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

export function assertMode0700(target, label) {
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
