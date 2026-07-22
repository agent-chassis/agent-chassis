

import path from "node:path";

export const WORKTREE_REAPER_DIAGNOSTIC_CODES = Object.freeze({
  INVALID_ARG: "agent_launch.worktree_reaper.invalid_arg.v1",
  INVALID_REASON: "agent_launch.worktree_reaper.invalid_reason.v1",
  BINDING_INVALID: "agent_launch.worktree_reaper.binding_invalid.v1",
  PROTECTED_REF: "agent_launch.worktree_reaper.protected_ref.v1",
  PROTECTED_WORKTREE: "agent_launch.worktree_reaper.protected_worktree.v1",
  ALIVE_OR_INDETERMINATE: "agent_launch.worktree_reaper.alive_or_indeterminate.v1",
  WORKER_NOT_TERMINATED: "agent_launch.worktree_reaper.worker_not_terminated.v1",
  REVIEW_UNRESOLVED: "agent_launch.worktree_reaper.review_unresolved.v1",
  DIRTY_WORKTREE: "agent_launch.worktree_reaper.dirty_worktree.v1",
  MISSING_OR_MISMATCHED_BINDING: "agent_launch.worktree_reaper.missing_or_mismatched_binding.v1",
  AUDIT_CAPTURE_FAILED: "agent_launch.worktree_reaper.audit_capture_failed.v1",
  AUDIT_WRITE_FAILED: "agent_launch.worktree_reaper.audit_write_failed.v1",
  REAP_FAILED: "agent_launch.worktree_reaper.reap_failed.v1"
});

export class WorktreeReaperError extends Error {
  constructor(message, { code, detail = null, cause = null } = {}) {
    super(message);
    this.name = "WorktreeReaperError";
    this.code = code ?? "agent_launch.worktree_reaper.error.v1";
    if (detail !== null) this.detail = detail;
    if (cause !== null) this.cause = cause;
  }
}

export function fail(code, message, detail = null, cause = null) {
  throw new WorktreeReaperError(`agent-launch worktree-reaper: ${message}`, { code, detail, cause });
}

export function assertAbsolutePath(p, label) {
  if (typeof p !== "string" || p.length === 0) {
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.INVALID_ARG, `${label} must be a non-empty string`);
  }
  if (!path.isAbsolute(p)) {
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.INVALID_ARG, `${label} must be absolute: ${p}`);
  }
  return p;
}
