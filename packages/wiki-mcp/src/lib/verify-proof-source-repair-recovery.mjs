

import { scopeAllowsPath } from "../../../agent-launch-core/src/lib/role-guard-path-policy.mjs";
import { resolveLauncherRunState } from "./launcher-run-credential.mjs";
import { authenticateManagedWorkerSliceBinding } from "./managed-test-source-context.mjs";
import { captureAssignmentChangeContext } from './task-request-assignment-change-context.mjs';
import { readManagedCompletion, readAttemptJournalEvents } from "../../../agent-launch-cli/src/lib/managed-run-process-identity-store.mjs";
import { selectManagedAttempt } from "../../../agent-launch-core/src/lib/managed-run-observation.mjs";
import { arbitrateCompletion } from "../../../agent-launch-cli/src/lib/managed-run-completion-observation.mjs";

function unavailable(capability, error) {
  return { missing_capability: capability,
    ...(error === undefined ? {} : { cause_code: error.code ?? error.name,
      cause: error.message }) };
}

export async function projectSymlinkSourceRecovery(evidence, { workspace, sessionEnv, requestContracts }) {
  const affected = evidence.recovery?.facts?.path ?? evidence.diagnostics
    .find(row => row.code === evidence.reason_code)?.details?.path;
  const facts = { ...evidence.recovery?.facts, path: affected, entry_kind: "symbolic_link" };

  let recovery = { action: "request_coordinator_source_correction", correction_owner: "coordinator",
    condition: "authenticated_source_correction_required", facts,
    message: `Proof execution is blocked by ${affected}. Request a coordinator correction.` };
  const finish = (call = null) => ({ ...evidence, recovery,
    next_calls: [...(evidence.next_calls ?? []).filter(call =>
      !["request_assignment_change", "verify_proof", "workspace_verify_proof"].includes(call.tool)),
    ...(call === null ? [] : [call])] });
  let state;
  try { state = resolveLauncherRunState(sessionEnv); }
  catch (error) {
    recovery = { ...recovery, ...unavailable("authenticated_reader_assignment", error) };
    return finish();
  }
  if (state.role !== "worker") {
    recovery.missing_capability = "worker_assignment_change_authority";
    recovery.message += ` This ${state.role} session has no worker source-correction or assignment-change authority.`;
    return finish();
  }
  let binding;
  try {
    binding = authenticateManagedWorkerSliceBinding({ mainRepo: workspace.dir, state,
      wkId: state.assignedUnit.split("#")[0] });
  } catch (error) {
    recovery = { ...recovery, ...unavailable("authenticated_worker_source_binding", error) };
    return finish();
  }
  const source = evidence.refused_source;
  const sameSource = source?.kind === "managed_worker" && source.worktree_path === binding.worktree_path &&
    source.selected_unit === state.assignedUnit && source.source_digest === binding.source_digest &&
    source.credential?.launch_ref === binding.launch_ref && source.credential?.run_id === binding.run_id &&
    source.credential?.retry_id === binding.retry_id;

  const writable = typeof affected === "string" && scopeAllowsPath(binding.write_scope, affected) &&
    scopeAllowsPath(state.sessionContract.write_scope, affected);
  if (sameSource && writable) {
    recovery = { ...recovery, action: "correct_the_symlink_in_the_authorized_working_source",
      correction_owner: "worker", condition: "correct_source_before_verification",
      message: `Proof execution is blocked by ${affected}. Your assignment authorizes correcting this symlink in the live assigned worktree. Verify again only after correcting the source.`,
      retry_operation: "verify_proof" };
    return finish();
  }
  recovery.message = writable
    ? `Proof execution is blocked by ${affected}. This source is not your mutable assigned worktree. Request a coordinator correction.`
    : `Proof execution is blocked by ${affected}. Your assignment does not authorize changing it. Request a coordinator correction.`;
  if (!sameSource) {
    recovery.missing_capability = "mutable_source_bound_to_current_worker_attempt";
    return finish();
  }
  const proposed = await projectAssignmentChangeRecovery({ workspace, sessionEnv, requestContracts, state, binding,
    evidence: [{ description: `${evidence.reason_code}; path ${affected}; status ${evidence.status}; zero proof credit.`,
      references: [affected, source.selected_unit] }] });
  recovery = { ...recovery, ...proposed.recovery };
  return finish(proposed.call);
}

export async function projectAssignmentChangeRecoveryForCaller({ workspace, sessionEnv, requestContracts, state, evidence }) {
  try {
    const binding = authenticateManagedWorkerSliceBinding({ mainRepo: workspace.dir, state,
      wkId: state.assignedUnit.split('#')[0] });
    return await projectAssignmentChangeRecovery({ workspace, sessionEnv, requestContracts, state, binding, evidence });
  } catch (error) {
    return { call: null, recovery: unavailable('authenticated_assignment_change_recovery', error) };
  }
}

export async function projectAssignmentChangeRecovery({ workspace, sessionEnv, requestContracts, state, binding, evidence }) {
  let recovery = {};
  const contract = requestContracts?.contractFor("request_assignment_change");
  if (!contract) {
    recovery.missing_capability = "registered_request_assignment_change_route";
    return { recovery, call: null };
  }
  let missingCapability = "authenticated_frozen_assignment_for_request_assignment_change";
  try {
    missingCapability = "unused_worker_attempt_completion_authority";
    const completion = readManagedCompletion({ mainRepo: workspace.dir, subject: state.assignedUnit, sliceBinding: binding });
    if (!completion.ok || (completion.completion !== null && completion.completion !== undefined)) {
      recovery = { ...recovery, ...unavailable("unused_worker_attempt_completion_authority"),
        cause_code: completion.code ?? "worker_attempt_completion_already_claimed" };
      return { recovery, call: null };
    }
    const journal = readAttemptJournalEvents({ mainRepo: workspace.dir, repository: workspace.dir, subject: state.assignedUnit });
    const selected = journal.refusal === null ? selectManagedAttempt({ repository: workspace.dir,
      subject: state.assignedUnit, events: journal.events, attemptId: completion.dispatch_tuple.run_id }) : null;

    const availability = selected?.ok ? arbitrateCompletion({ events: journal.events, selected: selected.selected,
      completion: { alternative: "assignment_change_requested" } }) : null;
    if (!availability?.ok) {
      recovery = { ...recovery, missing_capability: "unused_worker_attempt_completion_authority",
        cause_code: journal.refusal?.code ?? selected?.code ?? availability?.code,
        ...(availability?.cause === undefined ? {} : { cause: availability.cause }) };
      return { recovery, call: null };
    }
    missingCapability = "authenticated_frozen_assignment_for_request_assignment_change";
    const context = captureAssignmentChangeContext({ env: sessionEnv, session: state, binding,
      dispatchTuple: completion.dispatch_tuple });

    if (context.assignment.state === 'unavailable') recovery.assignment = context.assignment;
  } catch (error) {
    recovery = { ...recovery, ...unavailable(missingCapability, error) };
    return { recovery, call: null };
  }

  recovery.assignment_change = {
    tool: "request_assignment_change", executable: false,
    known_arguments: { evidence },
    missing_caller_input: ["assignment_fact", "prevents", "requested_change", "completed_work", "remaining_work"],
    effect: "Acceptance ends this worker attempt as blocked; no further report or delivery. It does not expand scope or repair the source."
  };
  return { recovery, call: null };
}
