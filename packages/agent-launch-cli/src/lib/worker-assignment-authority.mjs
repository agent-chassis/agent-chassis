

import { BACKEND_REFUSAL_CODES } from "@agent-chassis/agent-launch-core";
import { projectWorkRecordTestProofValidation } from "@agent-chassis/wiki-core/src/lib/work-record-test-proof-bindings.mjs";
import { captureRepositoryDefinitionSnapshot, repositorySnapshotDigest } from "./repository-source-snapshot.mjs";
import { resolveImmediateParentCommit } from "./backend-review-target-resolver.mjs";

function freezeValue(value) {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freezeValue); Object.freeze(value);
  }
  return value;
}

export function freezeWorkerRepositoryTestBinding({ presentation, root, launchBaseSha, runGit }) {
  return freezeSelectedUnitRepositoryTestBinding({ selectedUnit: {
    acceptance: { validation: presentation.canonical_summary.validation_commands }
  }, root, launchBaseSha, runGit });
}

export function freezeSelectedUnitRepositoryTestBinding({ selectedUnit, root, launchBaseSha, runGit }) {
  const projection = projectWorkRecordTestProofValidation({ selectedUnit });
  if (projection.status !== "valid") throw new WorkerAssignmentError(
    WORKER_ASSIGNMENT_DIAGNOSTICS.PROJECTION_INVALID, "repository test declarations are invalid", projection.diagnostics);
  if (projection.repository_tests.length === 0) return null;
  const parent = resolveImmediateParentCommit({ mainRepo: root, commit: launchBaseSha,
    ...(runGit === undefined ? {} : { runGit }) });
  const captureParent = paths => {
    if (!parent.ok) return { status: "unavailable", reason: parent.reason };
    try {
      return { status: "available", commit: parent.parent,
        identity: captureRepositoryDefinitionSnapshot({ root, paths, commit: parent.parent,
          ...(runGit === undefined ? {} : { runGit }) }) };
    } catch (error) {
      if (typeof error.code !== "string") throw error;
      return { status: "unavailable", commit: parent.parent, reason: error.code,
        message: error.message, detail: error.detail ?? null };
    }
  };
  const capture = options => {
    try { return captureRepositoryDefinitionSnapshot(options); }
    catch (error) {
      if (typeof error.code !== "string") throw error;
      throw new WorkerAssignmentError(error.code, error.message, error.detail ?? null);
    }
  };
  const commands = projection.repository_tests.map(command => ({ ...command,
    selections: command.selections.map(selection => ({ ...selection,
      definition_identity: capture({ root, paths: selection.definition_paths,
        commit: launchBaseSha, ...(runGit === undefined ? {} : { runGit }) }),

      parent_definition_identity: captureParent(selection.definition_paths),
      additional_baseline_definitions: (selection.additional_baseline_commits ?? []).map(commit => ({ commit,
        identity: capture({ root, paths: selection.definition_paths, commit,
          ...(runGit === undefined ? {} : { runGit }) }) }))
    })) }));
  const body = { launch_base_sha: launchBaseSha, commands };
  return freezeValue({ ...body, digest: repositorySnapshotDigest(body) });
}

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
  terminalResultMode,
  retryId = null,
  bindingRunId = null,
  repositoryTestBinding = null
} = {}) {
  if (presentation?.ok !== true || !isNonEmptyString(presentation.prompt) ||
      !isNonEmptyString(presentation.assignment_guidance)) {
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
    retry_id: retryId === null ? null : String(retryId),
    binding_run_id: bindingRunId,
    repository_test_binding: repositoryTestBinding,

    prompt: presentation.prompt,
    assignment_delivery: presentation.assignment_delivery,
    assignment_guidance: presentation.assignment_guidance + (repositoryTestBinding === null ? "" :
      "\n\nRepository command calls (frozen selected-unit grant):\n" +
      repositoryTestBinding.commands.flatMap(command => command.selections.map(selection =>
        JSON.stringify({ tool: "workspace_run_test", arguments: { entrypoint: command.id, selection: selection.id } }))).join("\n")),
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
