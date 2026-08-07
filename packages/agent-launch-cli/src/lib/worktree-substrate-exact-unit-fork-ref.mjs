

import { fail } from "./worktree-substrate-primitives.mjs";

const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export const WK_FORK_REF_DIAGNOSTIC_CODES = Object.freeze({
  WK_FORK_REF_MISSING: "agent_launch.worktree_substrate.wk_fork_ref_missing.v1",
  WK_FORK_REF_DISAGREEMENT: "agent_launch.worktree_substrate.wk_fork_ref_disagreement.v1",
  WK_FORK_REF_INVALID: "agent_launch.worktree_substrate.wk_fork_ref_invalid.v1"
});

export function wkForkRefName(initiative, wkId) {
  return `refs/agent-launch/wk-forks/${initiative}/${wkId}`;
}

function resolveWkForkRef(runGit, repo, ref) {
  const res = runGit({ repo, args: ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`] });
  if (!res || res.ok !== true) return null;
  const sha = String(res.stdout ?? "").trim();
  return OID_RE.test(sha) ? sha : null;
}

export function ensureWkForkRefAtFork(runGit, repo, ref, forkSha) {
  const existing = resolveWkForkRef(runGit, repo, ref);
  if (existing === forkSha) return { created: false };
  if (existing !== null) {
    fail(
      WK_FORK_REF_DIAGNOSTIC_CODES.WK_FORK_REF_DISAGREEMENT,
      "the launcher-owned WK fork ref disagrees with the fork being recorded",
      { fork_ref: ref, expected_fork: forkSha, actual_fork: existing }
    );
  }
  const res = runGit({ repo, args: ["update-ref", ref, forkSha, ""] });
  if (!res || res.ok !== true) {

    const raced = resolveWkForkRef(runGit, repo, ref);
    if (raced === forkSha) return { created: false };
    fail(
      WK_FORK_REF_DIAGNOSTIC_CODES.WK_FORK_REF_DISAGREEMENT,
      "failed to create the launcher-owned WK fork ref and it does not match the fork",
      { fork_ref: ref, expected_fork: forkSha, actual_fork: raced, status: res?.status ?? null }
    );
  }
  return { created: true };
}

export function rollbackCreatedWkForkRef(runGit, repo, ref, forkSha) {
  try { runGit({ repo, args: ["update-ref", "-d", ref, forkSha] }); } catch {   }
}

export function recoverFixedWkFork(runGit, repo, ref, currentWkTip) {
  const fork = resolveWkForkRef(runGit, repo, ref);
  if (fork === null) {
    fail(
      WK_FORK_REF_DIAGNOSTIC_CODES.WK_FORK_REF_MISSING,
      "the persistent WK branch has no launcher-owned fork ref; the original WK fork must be recorded before this WK can be adopted",
      {
        fork_ref: ref,
        operator_remediation:
          `record the original WK fork commit at ${ref} (git update-ref ${ref} <original-fork-sha>) before re-dispatching; the fork is never inferred from main, the current WK tip, a merge-base, or reflog`
      }
    );
  }
  const ancestor = runGit({ repo, args: ["merge-base", "--is-ancestor", fork, currentWkTip] });
  if (!ancestor || ancestor.ok !== true) {
    fail(
      WK_FORK_REF_DIAGNOSTIC_CODES.WK_FORK_REF_INVALID,
      "the launcher-owned WK fork is not an ancestor of the current WK tip",
      { fork_ref: ref, fork, wk_tip: currentWkTip }
    );
  }
  return fork;
}
