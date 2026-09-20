import assert from 'node:assert/strict';
import test from 'node:test';

import { groupProofAuthoringDiagnostics } from '@agent-chassis/controlled-contract';

const pin = version => ({ proof_name: 'proof.example', proof_version: version,
  profile_digest: `profile-${version}`, parameter_contract_digest: `parameters-${version}`,
  admission_digest: `admission-${version}` });
const diagnostic = ({ category = 'author_input', kind = 'missing_slot', code = 'missing',
  severity = 'unspecified', reason = 'Supply a value', facts = {}, definitionSensitive = false,
  path = '/parameters/value', routeEffect = 'blocking' } = {}) => ({ code, path, reason, owner: 'package-owner',
  problem: { category, severity, cause: { kind, ...facts },
    ...(definitionSensitive ? { definition_sensitive: true } : {}),
    route_assessment: { schema_version: 'selected-proof-diagnostic-route-assessment.v1',
      effect: routeEffect, stage: category === 'author_input' ? 'authored_inputs'
        : category === 'canonical_source' ? 'canonical_sources' : 'system_capability',
      selected_route: 'definition_evaluation', owner_code: code, reason,
      unavailable_operation: null, responsible_owner: 'package-owner', recovery: null } } });
const resolved = (rows, diagnostics = []) => ({ identity_digest: 'resolved-snapshot', diagnostics, rows });

test('P10 groups only equivalent causes across bindings pins severity and global attribution', () => {
  const shared = diagnostic({ facts: { parameter: 'value', source_policy: { policy: 'configurable' } },
    definitionSensitive: true });
  const grouped = groupProofAuthoringDiagnostics(resolved([
    { obligation_id: 'OBL-A', definition: pin('1.0.0'), diagnostics: [shared, shared] },
    { obligation_id: 'OBL-B', definition: pin('1.0.0'), diagnostics: [shared] },
    { obligation_id: 'OBL-C', definition: pin('2.0.0'), diagnostics: [shared] },
    { obligation_id: 'OBL-D', definition: pin('1.0.0'), diagnostics: [
      diagnostic({ facts: { parameter: 'other', source_policy: { policy: 'configurable' } }, definitionSensitive: true }),
      diagnostic({ facts: { parameter: 'value', source_policy: { policy: 'canonical' } },
        category: 'canonical_source', definitionSensitive: true }),
      diagnostic({ facts: { parameter: 'value', source_policy: { policy: 'configurable' } },
        severity: 'warning', definitionSensitive: true }),
      { code: 'unknown-owner-cause', path: '/opaque', reason: 'Opaque owner fact',
        owner: 'another-owner', binding: { identity: 'binding-D' } }
    ] }
  ], [diagnostic({ category: 'system_capability', kind: 'global_capability', code: 'offline',
    reason: 'Backend unavailable', path: '/global' })]));

  assert.equal(grouped.groups.find(group => group.occurrence_count === 3).affected_obligation_count, 2);
  assert.equal(grouped.groups.filter(group => group.code === 'missing').length, 5);
  assert.equal(grouped.groups.find(group => group.code === 'unknown-owner-cause').category, 'unclassified');
  assert.equal(grouped.groups.find(group => group.code === 'offline').global_occurrence_count, 1);
  assert.equal(grouped.groups.flatMap(group => group.occurrences).length, 9);
  assert.deepEqual(groupProofAuthoringDiagnostics(resolved([
    { obligation_id: 'OBL-A', definition: pin('1.0.0'), diagnostics: [shared] }
  ])), groupProofAuthoringDiagnostics(resolved([
    { obligation_id: 'OBL-A', definition: pin('1.0.0'), diagnostics: [shared] }
  ])));
});

test('P11 counts occurrences groups and distinct affected-obligation unions exactly', () => {
  const author = diagnostic();
  const system = diagnostic({ category: 'system_capability', kind: 'constructor', code: 'unavailable',
    reason: 'Constructor unavailable' });
  const projection = groupProofAuthoringDiagnostics(resolved([
    { obligation_id: 'OBL-A', definition: null, diagnostics: [author, author, system] },
    { obligation_id: 'OBL-B', definition: null, diagnostics: [author, system] }
  ], [system]));
  assert.deepEqual(projection.counts, { diagnostic_occurrences: 6, diagnostic_groups: 2,
    affected_obligations: 2, global_occurrences: 1,
    blocking_occurrences: 6, blocking_affected_obligations: 2,
    nonblocking_occurrences: 0, nonblocking_affected_obligations: 0,
    unresolved_occurrences: 0, unresolved_affected_obligations: 0 });
  assert.deepEqual(projection.categories, [
    { category: 'author_input', group_count: 1, occurrence_count: 3,
      affected_obligation_count: 2, global_occurrence_count: 0,
      blocking_group_count: 1, blocking_occurrence_count: 3,
      nonblocking_group_count: 0, nonblocking_occurrence_count: 0,
      unresolved_group_count: 0, unresolved_occurrence_count: 0 },
    { category: 'system_capability', group_count: 1, occurrence_count: 3,
      affected_obligation_count: 2, global_occurrence_count: 1,
      blocking_group_count: 1, blocking_occurrence_count: 3,
      nonblocking_group_count: 0, nonblocking_occurrence_count: 0,
      unresolved_group_count: 0, unresolved_occurrence_count: 0 }
  ]);
  const systemGroup = projection.groups.find(group => group.category === 'system_capability');
  assert.equal(systemGroup.occurrence_count, 3);
  assert.equal(systemGroup.affected_obligation_count, 2);
  assert.equal(systemGroup.global_occurrence_count, 1);
  assert.deepEqual(systemGroup.affected_obligation_ids, ['OBL-A', 'OBL-B']);
  assert.equal(Object.isFrozen(projection), true);
  assert.deepEqual(groupProofAuthoringDiagnostics(resolved([])).counts,
    { diagnostic_occurrences: 0, diagnostic_groups: 0, affected_obligations: 0,
      global_occurrences: 0, blocking_occurrences: 0,
      blocking_affected_obligations: 0, nonblocking_occurrences: 0,
      nonblocking_affected_obligations: 0, unresolved_occurrences: 0,
      unresolved_affected_obligations: 0 });
});

test('WK-2567 grouping keeps blocking and nonblocking selected-route effects distinct', () => {
  const base = { category: 'system_capability', kind: 'constructor',
    code: 'unavailable', reason: 'Constructor unavailable' };
  const grouped = groupProofAuthoringDiagnostics(resolved([
    { obligation_id: 'OBL-TEST', definition: pin('1.0.0'), diagnostics: [
      diagnostic({ ...base, routeEffect: 'nonblocking' })] },
    { obligation_id: 'OBL-NONTEST', definition: pin('1.0.0'), diagnostics: [
      diagnostic({ ...base, routeEffect: 'blocking' })] }
  ]));
  assert.equal(grouped.groups.length, 2);
  assert.deepEqual(grouped.groups.map(group => group.route_effect).sort(),
    ['blocking', 'nonblocking']);
  assert.equal(grouped.counts.blocking_affected_obligations, 1);
  assert.equal(grouped.counts.nonblocking_affected_obligations, 1);
});
