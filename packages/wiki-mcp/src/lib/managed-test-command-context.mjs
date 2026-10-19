

import { readManagedAssignmentPresentation } from './managed-assignment-read.mjs';
import { authenticateManagedWorkerSliceBinding } from './managed-test-source-context.mjs';
import { captureRepositoryDefinitionSnapshot, repositorySnapshotDigest } from
  '../../../agent-launch-cli/src/lib/repository-source-snapshot.mjs';

function refuse(reason, message, detail = {}) {
  throw Object.assign(new Error(message), { code: `run_test.${reason}.v1`, detail });
}

export function resolveWorkerRepositoryCommand({ request, state, env, mainRepo }) {
  if (request.harness !== undefined || request.source !== null || request.environment !== null ||
      request.entrypoint === undefined) refuse('worker_executable_controls_forbidden',
    'Workers select only frozen entrypoint/selection IDs and timeout. Request an assignment change for a missing command.');
  const assignment = readManagedAssignmentPresentation({ env });
  const identity = assignment.presentation.identity;
  const binding = authenticateManagedWorkerSliceBinding({ mainRepo, state, wkId: state.assignedUnit.split('#')[0] });
  const grant = assignment.presentation.repository_test_binding;
  if (identity.worktree_path !== binding.worktree_path || identity.canonical_source_digest !== binding.source_digest ||
      identity.launch_ref !== binding.launch_ref || identity.binding_run_id !== binding.run_id ||
      identity.retry_id !== String(binding.retry_id) || assignment.assignedUnit !== state.assignedUnit) {
    refuse('command_binding_mismatch', 'The frozen assignment does not bind this worker attempt.');
  }
  if (grant === null) refuse('entrypoint_unavailable', 'This selected unit has no frozen repository commands. Request an assignment change.');
  const { digest, ...body } = grant;
  if (repositorySnapshotDigest(body) !== digest || grant.launch_base_sha !== binding.base_sha) {
    refuse('command_binding_mismatch', 'The command projection digest or authenticated launch base disagrees.');
  }
  const calls = grant.commands.flatMap(command => command.selections.map(selection => ({
    tool: 'workspace_run_test', information: command.purpose,
    arguments: { entrypoint: command.id, selection: selection.id } })));
  const command = grant.commands.find(command => command.id === request.entrypoint);
  if (!command) refuse('entrypoint_unknown', 'The entrypoint is not assigned. Choose a permitted command.',
    { entrypoint: request.entrypoint, permitted_calls: calls });
  const selected = request.selection ?? command.default_selection;
  if (selected === undefined) refuse('selection_required', 'Choose an explicit assigned selection; this command has no authored default.',
    { entrypoint: command.id, permitted_calls: calls.filter(call => call.arguments.entrypoint === command.id) });
  const selection = command.selections.find(selection => selection.id === selected);
  if (!selection) refuse('selection_unknown', 'The selection is not assigned. Choose a permitted selection.',
    { entrypoint: command.id, selection: request.selection,
      permitted_calls: calls.filter(call => call.arguments.entrypoint === command.id) });
  const current = captureRepositoryDefinitionSnapshot({ root: binding.worktree_path, paths: selection.definition_paths });
  if (current.digest !== selection.definition_identity.digest) refuse('definition_changed',
    'Listed command definitions changed. Request an assignment change; revised committed definitions require a successor.',
    { entrypoint: command.id, selection: selection.id, expected: selection.definition_identity.digest, observed: current.digest });
  return Object.freeze({ binding, grant, selection, command, calls });
}

export function checkRepositoryCommandDefinitions(context, root, { baseline = false } = {}) {
  const selected = context.selection;
  const current = captureRepositoryDefinitionSnapshot({ root, paths: selected.definition_paths });
  const approved = baseline ? [selected.definition_identity,
    ...(selected.parent_definition_identity.status === 'available' ? [selected.parent_definition_identity.identity] : []),
    ...selected.additional_baseline_definitions.map(row => row.identity)] : [selected.definition_identity];
  if (!approved.some(identity => identity.digest === current.digest)) refuse(baseline ? 'baseline_definition_unapproved' : 'definition_changed',
    baseline ? 'Baseline listed definitions match no frozen launch-start, parent or explicit extra identity.' :
      'Listed definitions moved after authorization; this observation claims no immutable execution inputs.',
    { observed: current.digest, expected: selected.definition_identity.digest,
      approved_definition_count: approved.length, launch_parent_status: selected.parent_definition_identity.status });
  return current;
}
