

import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { findSelectedResponseSources, readSelectedResponseSource, retainSelectedResponseSource } from './selected-response-snapshot.mjs';
import { jsonContent } from './mcp-response.mjs';

export const mutationRecoverySchema = z => z.object({ request: z.record(z.unknown()),
  unit: z.string().min(1).optional().describe('An issued subject selected from recovery choices; never guessed from a title or row order.') }).strict()
  .describe('Read retained state for the exact original mutation request, including its original revision and authored values. Never executes that request. Multiple identical operations remain ambiguous.');
export const mutationAuthorityIdentity = (workspace, identity) => ({ ...identity, workspace_root: realpathSync(workspace.dir) });

export function createMutationRecovery({ route, workspace, responseEnv, authorityIdentity }) {
  const binding = request => ({ route, repository: workspace.repo, unit: request.unit ?? null,
    query_identity: { operation: 'mutation_request', request },
    authority_identity: mutationAuthorityIdentity(workspace, { ...authorityIdentity(request.unit ?? null), route }) });
  const responseOwner = (value, options) => jsonContent(value, { env: responseEnv, ...options,
    selectedAccess: () => ({ operator_only: true }) });

  function start(request) {
    const operation = randomUUID();
    let sequence = 0, retained = null, retentionFailure = null;
    const record = body => {
      try {
        retained = retainSelectedResponseSource({ binding: binding(request),
          carrier: { operation, sequence: sequence++, body } }, { responseOwner });
        retentionFailure = null;
      } catch (error) {

        retentionFailure = error;
      }
    };
    record({ outcome: 'mutation_outcome_unknown', unit: request.unit ?? null,
      effects: { published: 'unknown' }, cause: { code: 'mutation_not_settled',
        message: 'This operation was admitted, but no publication outcome has been retained.' },
      recovery: { missing_capability: 'settled_mutation_outcome',
        correction: 'The operation may still be running or may have been interrupted. Observe this same request again after progress; do not repeat the mutation.' } });
    return { record, read: () => readSelectedResponseSource(retained, { env: responseEnv, route, expected: binding(request) }),
      get retained() { return retained; }, get retentionFailure() { return retentionFailure; } };
  }

  function observe(request, selectedUnit) {
    const stop = (code, message, details = {}) => ({ body: { outcome: 'mutation_outcome_unavailable',
      unit: request.unit ?? null, effects: { published: 'unknown' }, cause: { code, message, ...details },
      recovery: { missing_capability: 'exact_mutation_outcome',
        correction: 'This read cannot establish the original operation outcome or its key mappings. Do not repeat the mutation or reconstruct associations from current rows or prose.' } } });
    let candidates;
    try { candidates = findSelectedResponseSources({ env: responseEnv, expected: binding(request) }); }
    catch (error) { return stop(error.code ?? 'mutation_recovery_source_unavailable', error.message); }
    const latest = new Map();
    for (const candidate of candidates) {
      const previous = latest.get(candidate.carrier.operation);
      if (previous === undefined || previous.carrier.sequence < candidate.carrier.sequence) latest.set(candidate.carrier.operation, candidate);
    }
    if (latest.size === 0) return stop('mutation_recovery_not_recorded',
      'No authenticated retained operation matches this exact request. Missing evidence does not establish that nothing was published.');
    const selected = [...latest.values()].filter(candidate => selectedUnit === undefined || candidate.carrier.body.unit === selectedUnit);
    if (selected.length === 0) return stop('mutation_recovery_subject_mismatch', 'The selected subject does not belong to this retained request.');
    if (selected.length !== 1) {
      const result = stop('mutation_recovery_ambiguous', 'More than one operation has this request. Choose the intended issued subject where that distinguishes one operation.');
      const counts = new Map();
      for (const candidate of selected) counts.set(candidate.carrier.body.unit, (counts.get(candidate.carrier.body.unit) ?? 0) + 1);
      result.body.recovery.choices = selected.map(({ carrier: { body } }) => ({ unit: body.unit, outcome: body.outcome,
        published: body.effects?.published ?? (body.outcome === 'saved' ? true : 'unknown') }));
      result.body.next_calls = selected.filter(candidate => typeof candidate.carrier.body.unit === 'string' &&
        counts.get(candidate.carrier.body.unit) === 1).map(candidate => ({ tool: route === 'workspace_save_record' ? 'save_record' : route,
        arguments: { recover: { request, unit: candidate.carrier.body.unit } }, recommended: false }));
      result.body.recovery.correction = result.body.next_calls.length
        ? 'Choose an issued subject only if it identifies the operation you intend. These calls only observe; they never repeat creation or a save.'
        : 'The request and subject do not distinguish these operations. Exact operation identity is unavailable; do not repeat the mutation or infer lost associations.';
      if (result.body.next_calls.length) delete result.body.recovery.missing_capability;
      const evidence = selected.find(candidate => candidate.current);
      if (evidence) { result.source = evidence.result; result.retained = readSelectedResponseSource(result.source,
        { env: responseEnv, route, expected: binding(request) }); }
      return result;
    }
    if (!selected[0].current) return stop('mutation_recovery_source_unavailable', 'The retained operation has no usable current locator.');
    const retained = readSelectedResponseSource(selected[0].result, { env: responseEnv, route, expected: binding(request) });
    return { body: retained.carrier.body, retained, source: selected[0].result };
  }
  return Object.freeze({ start, observe });
}
