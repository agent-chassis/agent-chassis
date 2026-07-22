

import path from "node:path";
import { RUNTIME_BLOCKER_CODES } from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";

export const WORKTREE_PROVISIONING_DISPATCH_SCHEMA_VERSION =
  "worktree-provisioning-dispatch.v1";

if (typeof RUNTIME_BLOCKER_CODES.MANAGED_WORKTREE_PROVISIONING_UNAVAILABLE !== "string") {
  throw new Error("WK-1471 managed_worktree_provisioning_unavailable capability interface is absent or incompatible");
}

export const DEFAULT_EXPECTED_ENVELOPE_FIELD = "expected";

export const WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES = Object.freeze({
  INVALID_ARG: "agent_launch.worktree_provisioning_dispatch.invalid_arg.v1",
  INVALID_SUBJECT: "agent_launch.worktree_provisioning_dispatch.invalid_subject.v1",

  INTEGRATION_BRANCH_MISSING:
    "agent_launch.worktree_provisioning_dispatch.integration_branch_missing.v1",

  INTEGRATION_BRANCH_UNBORN:
    "agent_launch.worktree_provisioning_dispatch.integration_branch_unborn.v1",

  WK_RECORD_UNREADABLE_IN_TREE:
    "agent_launch.worktree_provisioning_dispatch.wk_record_unreadable_in_tree.v1",

  EXPECTED_ENVELOPE_MISSING:
    "agent_launch.worktree_provisioning_dispatch.expected_envelope_missing.v1",

  RE_PROVISION_NOT_FAST_FORWARD:
    "agent_launch.worktree_provisioning_dispatch.re_provision_not_fast_forward.v1",

  BASE_SHA_RACED:
    "agent_launch.worktree_provisioning_dispatch.base_sha_raced.v1",
  GIT_FAILED: "agent_launch.worktree_provisioning_dispatch.git_failed.v1",
  ROOT_REFUSED: "agent_launch.worktree_provisioning_dispatch.root_refused.v1",
  BINDING_INCOMPLETE: RUNTIME_BLOCKER_CODES.MANAGED_WORKTREE_PROVISIONING_UNAVAILABLE,
  REISSUE_REFUSED: "agent_launch.worktree_provisioning_dispatch.reissue_refused.v1",
  ROLLBACK_FAILED: "agent_launch.worktree_provisioning_dispatch.rollback_failed.v1",

  REPLAY_CONFLICT: "agent_launch.worktree_provisioning_dispatch.replay_conflict.v1",

  REPLAY_CAS_EXHAUSTED: "agent_launch.worktree_provisioning_dispatch.replay_cas_exhausted.v1",

  REPLAY_SCRATCH_FAILED: "agent_launch.worktree_provisioning_dispatch.replay_scratch_failed.v1"
});

export const WORKTREE_PROVISIONING_ISOLATION_INVARIANT = Object.freeze({

  shared_git_non_worker_writable: true,

  worktree_pointer_file_non_worker_writable: true,

  trusted_committer_gitdir_server_side: true,

  content_inert_populate: true
});

export class WorktreeProvisioningDispatchError extends Error {
  constructor(message, { code, detail = null, cause = null } = {}) {
    super(message);
    this.name = "WorktreeProvisioningDispatchError";
    this.code = code ?? "agent_launch.worktree_provisioning_dispatch.error.v1";
    if (detail !== null) this.detail = detail;
    if (cause !== null) this.cause = cause;
  }
}

export function fail(code, message, detail = null, cause = null) {
  throw new WorktreeProvisioningDispatchError(
    `agent-launch worktree-provisioning-dispatch: ${message}`,
    { code, detail, cause }
  );
}

export const SUBJECT_RE = /^WK-\d{4}(#[A-Za-z0-9._-]+)?$/;
export const WK_ID_RE = /^WK-\d{4}$/;
export const INITIATIVE_ID_RE = /^IN-\d{4}$/;

export function parseSubject(subject) {
  if (typeof subject !== "string" || !SUBJECT_RE.test(subject)) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.INVALID_SUBJECT,
      `subject must match ^WK-\\d{4}(#<slice>)?$, got: ${JSON.stringify(subject)}`
    );
  }
  const hashIdx = subject.indexOf("#");
  if (hashIdx === -1) return { wkId: subject, sliceId: null };
  return { wkId: subject.slice(0, hashIdx), sliceId: subject.slice(hashIdx + 1) };
}

export function assertInitiativeId(initiative) {
  if (typeof initiative !== "string" || !INITIATIVE_ID_RE.test(initiative)) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.INVALID_ARG,
      `initiative must match ^IN-\\d{4}$, got: ${JSON.stringify(initiative)}`
    );
  }
  return initiative;
}

export function assertAbsolutePath(p, label) {
  if (typeof p !== "string" || p.length === 0 || !path.isAbsolute(p)) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.INVALID_ARG,
      `${label} must be a non-empty absolute path, got: ${JSON.stringify(p)}`
    );
  }
  return p;
}

function gitOrThrow(runGit, repo, args, whatFailed, code = WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.GIT_FAILED) {
  const res = runGit({ repo, args });
  if (!res || res.ok !== true) {
    fail(
      code,
      `${whatFailed} (git ${args.join(" ")})`,
      {
        status: res?.status ?? null,
        signal: res?.signal ?? null,
        error: res?.error ?? null,
        stderr: res?.stderr ?? null
      }
    );
  }
  return res;
}
