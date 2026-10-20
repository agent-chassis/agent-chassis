

import path from 'node:path';
import { defaultRunGitAsync } from '../../../agent-launch-cli/src/lib/worktree-substrate.mjs';
import { readLiteralCommitOutcome, readParentRelativeStructuralDelta, distillGitReadFailure }
  from '../../../agent-launch-cli/src/lib/slice-integration-authorization.mjs';
import { readManagedReviewOriginal } from '../../../agent-launch-cli/src/lib/managed-run-process-identity-store.mjs';
import { managedObservationFailureFacts } from '../../../agent-launch-core/src/lib/managed-run-observation.mjs';
import { selectedResponseQueryInvalidError } from './selected-response-snapshot.mjs';
import { retainedRunSourceFailure } from './get-run-result-source-failure.mjs';
import { admitResultContinuations } from './get-run-result-callability.mjs';
import { runResultMeaning } from './get-run-result-final-result.mjs';

const selection = carrier => ({ subject: carrier.identity.unit,
  selected_delivery: { base: carrier.outcome?.response?.transaction?.base_sha,
    commit: carrier.outcome?.response?.transaction?.delivery_commit } });
const stop = (carrier, cause) => {
  throw selectedResponseQueryInvalidError('get_run_result', 'delivery_change_source_unavailable', {
    ...selection(carrier), cause,
    stopping_condition: 'The selected delivery change could not be read. No current checkout or newer delivery can replace it.' });
};

export async function readDeliveryChanges({ workspace, carrier }) {
  const selected = selection(carrier), { base, commit } = selected.selected_delivery;
  const mainRepo = path.resolve(workspace.dir);
  const runGit = input => defaultRunGitAsync({ ...input, timeoutMs: 30000 });
  const cache = new Map();
  for (const oid of [base, commit]) {
    const outcome = await readLiteralCommitOutcome(runGit, mainRepo, oid, cache);
    if (outcome.failure !== null) stop(carrier, outcome.failure);
  }
  const delta = await readParentRelativeStructuralDelta(runGit, mainRepo, base, commit);
  if (delta.failure !== null) stop(carrier, delta.failure);
  const files = delta.delta.map(row => {
    const fields = row.split(' ');
    let name;
    try { name = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(fields[5], 'hex')); }
    catch { stop(carrier, { reason: 'delivery_path_not_utf8' }); }
    return { path: name, change: { A: 'added', D: 'deleted', M: 'modified', T: 'type_changed' }[fields[4]] };
  });

  const options = ['--no-replace-objects', `--attr-source=${commit}`, '-c', 'core.quotePath=true', 'diff', '--no-ext-diff',
    '--no-textconv', '--no-renames', '--no-color', '--diff-algorithm=myers', '--no-indent-heuristic',
    '--no-relative', '--src-prefix=a/', '--dst-prefix=b/', '--ignore-submodules=none', '--submodule=short'];
  const patch = await runGit({ repo: mainRepo, args: [...options, '--patch', '--unified=3', base, commit, '--'] });
  if (!patch.ok) stop(carrier, distillGitReadFailure('diff', commit, patch));

  if (patch.stdout.includes('\uFFFD')) stop(carrier, { reason: 'delivery_text_encoding_unverified' });
  const stats = await runGit({ repo: mainRepo, args: [...options, '--numstat', '-z', base, commit, '--'] });
  if (!stats.ok) stop(carrier, distillGitReadFailure('diff --numstat', commit, stats));
  const binary = [];
  for (const row of stats.stdout.split('\0').filter(Boolean)) {
    const matched = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/u.exec(row);
    if (matched === null) stop(carrier, { reason: 'delivery_change_statistics_malformed' });
    if (matched[1] === '-' || matched[2] === '-') binary.push(matched[3]);
  }
  return { ...selected, files, patch: patch.stdout,
    ...(binary.length === 0 ? {} : { limitation: { code: 'binary_delivery_content_not_rendered', paths: binary,
      message: 'The patch identifies these changed binary files but does not supply their contents. A decision requiring those contents is unsupported by this read.' } }) };
}

export async function readDeliveryReviews({ workspace, carrier, readOriginal, taskChoice, detailCall, requestContracts }) {
  const selected = selection(carrier), { base, commit } = selected.selected_delivery;
  const bound = readManagedReviewOriginal({ mainRepo: path.resolve(workspace.dir), subject: selected.subject });
  if (!bound.ok && !['attempt_selection_ambiguous', 'attempt_observation_unavailable'].includes(bound.code)) {
    return { ...selected, state: 'unavailable', cause: managedObservationFailureFacts(bound),
      limitation: 'The retained review bindings could not be read; review coverage of this delivery is unknown.' };
  }
  const candidates = bound.ok ? [bound.review] : bound.candidates ?? [];
  const matched = [], unavailable = [];
  for (const candidate of candidates) {
    const attempt_id = candidate.run_id ?? candidate.attempt_id;
    let original;
    try { original = readOriginal(candidate.original_result, selected.subject).carrier; }
    catch (error) { unavailable.push({ attempt_id, cause: retainedRunSourceFailure(error) }); continue; }
    if (original.subject !== selected.subject || original.run_id !== attempt_id || original.role !== candidate.role) {
      throw selectedResponseQueryInvalidError('get_run_result', 'observation_original_attempt_mismatch', {
        subject: selected.subject, attempt_id });
    }
    const target = original.review_task;
    if (target !== undefined && (target.base_sha !== base || target.reviewed_sha !== commit)) continue;
    if (['canonical_design', 'launcher_terminal_candidate'].includes(target?.material_kind)) continue;
    if (!['explicit_sha_range', 'canonical_implementation_slice'].includes(target?.material_kind)) {
      unavailable.push({ attempt_id, cause: { code: 'review_delivery_binding_unavailable' } }); continue;
    }
    matched.push({ attempt_id, role: original.role, status: original.status, terminal: original.terminal,
      review_task: target, meaning: runResultMeaning(original.final_result), result: { ref_id: candidate.original_result.ref_id } });
  }
  const { next_calls: _calls, ...answer } = await admitResultContinuations({ ...selected,
    state: unavailable.length > 0 ? 'partial' : matched.length > 0 ? 'linked' : 'none_linked',
    attempt_choices: matched.map(item => ({ attempt_id: item.attempt_id, role: item.role, status: item.status,
      ...taskChoice(item, matched), ...item.meaning.facts,
      ...(item.meaning.unavailable ? {} : { call: detailCall(item.result) }) })),
    ...(unavailable.length === 0 ? {} : { unavailable }), next_calls: [] }, requestContracts);
  if (answer.state === 'none_linked') answer.limitation = 'No retained review is linked to this exact delivery. This does not establish that no review ran or that the change has no findings.';
  if (answer.state === 'partial') answer.limitation = 'Some review bindings are unavailable; the readable reviews do not establish complete review coverage of this delivery.';
  return answer;
}
