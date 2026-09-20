

import { BACKEND_REFUSAL_CODES } from "@agent-chassis/agent-launch-core";

export const WORKER_ASSIGNMENT_SCHEMA_VERSION = "managed-worker-assignment.v1";

export const WORKER_ASSIGNMENT_DIAGNOSTICS = Object.freeze({
  MISSING: "worker_assignment_missing",
  UNTRUSTED: "worker_assignment_untrusted",
  BINDING_MISMATCH: "worker_assignment_binding_mismatch",
  PROJECTION_INVALID: "worker_assignment_projection_invalid"
});

export const WORKER_ASSIGNMENT_DIAGNOSTIC_CODES = Object.freeze(
  Object.values(WORKER_ASSIGNMENT_DIAGNOSTICS)
);

const registeredAssignments = new WeakSet();

export class WorkerAssignmentError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = "WorkerAssignmentError";
    this.code = code;
    this.authority_limb = "mechanical_failure";
    this.detail = detail;
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

export function mintManagedWorkerAssignment({
  presentation,
  role,
  subject,
  runId,
  monitorHandle,
  worktreePath,
  terminalResultMode
} = {}) {
  if (presentation?.ok !== true || !isNonEmptyString(presentation.prompt)) {
    throw new WorkerAssignmentError(
      WORKER_ASSIGNMENT_DIAGNOSTICS.PROJECTION_INVALID,
      "managed worker assignment requires a composed presentation",
      presentation?.diagnostic ?? null
    );
  }
  if (!isNonEmptyString(role) || !isNonEmptyString(subject) || !isNonEmptyString(worktreePath)) {
    throw new WorkerAssignmentError(
      WORKER_ASSIGNMENT_DIAGNOSTICS.BINDING_MISMATCH,
      "managed worker assignment requires the launcher-owned launch identity"
    );
  }
  if (presentation.unit_address !== subject || presentation.role !== role) {
    throw new WorkerAssignmentError(
      WORKER_ASSIGNMENT_DIAGNOSTICS.BINDING_MISMATCH,
      `prepared assignment does not bind ${role} ${subject}`
    );
  }
  const assignment = Object.freeze({
    schema_version: WORKER_ASSIGNMENT_SCHEMA_VERSION,
    role,
    unit_address: presentation.unit_address,
    record_id: presentation.record_id,
    slice_id: presentation.slice_id,
    source_digest: presentation.source_digest,
    run_id: runId ?? null,
    monitor_handle: monitorHandle ?? null,
    worktree_path: worktreePath,
    terminal_result_mode: terminalResultMode ?? null,
    prompt: presentation.prompt,
    canonical_summary: presentation.canonical_summary,
    agent_brief: presentation.agent_brief,
    launch_packet: presentation.launch_packet
  });
  registeredAssignments.add(assignment);
  return assignment;
}

export function assertManagedWorkerAssignment(value, {
  role,
  subject,
  runId = undefined,
  monitorHandle = undefined,
  worktreePath = undefined
} = {}) {
  if (value === null || value === undefined) {
    throw new WorkerAssignmentError(
      WORKER_ASSIGNMENT_DIAGNOSTICS.MISSING,
      `managed ${role} launch received no launcher-prepared assignment for ${subject}`
    );
  }
  if (typeof value !== "object" || !Object.isFrozen(value) || !registeredAssignments.has(value)) {
    throw new WorkerAssignmentError(
      WORKER_ASSIGNMENT_DIAGNOSTICS.UNTRUSTED,
      "worker assignment is not the launcher-minted value"
    );
  }
  const mismatch = [
    ["role", value.role, role],
    ["unit_address", value.unit_address, subject],
    ...(runId === undefined ? [] : [["run_id", value.run_id, runId]]),
    ...(monitorHandle === undefined ? [] : [["monitor_handle", value.monitor_handle, monitorHandle]]),
    ...(worktreePath === undefined ? [] : [["worktree_path", value.worktree_path, worktreePath]])
  ].find(([, actual, expected]) => actual !== expected);
  if (mismatch !== undefined) {
    throw new WorkerAssignmentError(
      WORKER_ASSIGNMENT_DIAGNOSTICS.BINDING_MISMATCH,
      `worker assignment ${mismatch[0]} does not bind this launch`,
      { field: mismatch[0] }
    );
  }
  if (!isNonEmptyString(value.prompt)) {
    throw new WorkerAssignmentError(
      WORKER_ASSIGNMENT_DIAGNOSTICS.PROJECTION_INVALID,
      "worker assignment carries no composed task"
    );
  }
  return value;
}

export function workerAssignmentRefusal(makeRefusal, error, { role, subject }) {
  return makeRefusal(
    BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
    error?.code ?? WORKER_ASSIGNMENT_DIAGNOSTICS.MISSING,
    {
      role,
      subject,
      authority_limb: "mechanical_failure",
      message: error?.message ?? String(error),
      ...(error?.detail ? { detail: error.detail } : {})
    }
  );
}
