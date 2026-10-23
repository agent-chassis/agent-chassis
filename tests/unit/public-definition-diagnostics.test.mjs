import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePublicSelections, projectPublicSelection } from '../../packages/wiki-core/src/operations/controlled-contract/public-selection.mjs';

function source({ missingIdentity = 'constraint-private', duplicate = false } = {}) {
  const subject = { type_term: 'cc:capability', identity: { kind: 'profile_term', term: 'feature' } };
  const declaration = { subject, definition: true, behavior: { relation: 'reference:includes', objects: [] } };
  const failure = { code: 'value_relation_unknown', cause: 'reference:includes', subject,
    definition_identity: missingIdentity, root_cause: { reason: 'value_relation_unknown', definition_identity: missingIdentity } };
  const row = { row_id: 'row-private', claim_ids: [], constraint_ids: ['constraint-private'], input: declaration, state: 'complete' };
  return { authoringIdentity: 'captured-revision', coverage: {
    unit: 'WK-1234', view: 'complete', population: { mode: 'all' }, notes: [], residue: [],
    references: [], requirements: [], cases: [], obligations: [], acceptance_criteria: [],
    authored_requirements: { status: 'incomplete', rows: [row, ...(duplicate ? [{ ...row, row_id: 'row-other' }] : [])], collections: [],
      descriptions: { roots: [{ key: 'native-feature', entity: subject, state: 'incomplete', dependency_keys: [],
        defining_constraint_ids: ['constraint-private'], missing: [failure] }], missing: [failure],
      nodes: [{ key: 'native-feature', entity: subject, definitions: [{ constraint: declaration }],
        uses: [{ required_meaning: 'subject', established: false, missing: [failure] }] }] } }
  } };
}

for (const [name, options, status] of [
  ['mapped', {}, 'mapped'], ['unmapped', { missingIdentity: 'constraint-unknown' }, 'unavailable'],
  ['indistinguishable', { duplicate: true }, 'ambiguous']
]) test(`definition diagnostic ${name} correspondence preserves cause and uncertainty without compiler identities`, async () => {
  const captured = source(options);
  const before = structuredClone(captured);
  const { results: [resolved] } = await resolvePublicSelections({ source: captured, population: 'requirements', intent: 'read' });
  const projected = projectPublicSelection(resolved, { include: ['dependencies'] });
  assert.equal(projected.status, 'ok', JSON.stringify(projected));
  assert.equal(projected.value.members[0].state, 'incomplete');
  const dependencies = projected.value.members[0].dependencies;
  assert.equal(dependencies.state, 'incomplete');
  assert.equal(dependencies.nodes[0].state, 'incomplete');
  const failure = dependencies.nodes[0].uses[0].missing[0];
  assert.equal(failure.code, 'value_relation_unknown');
  assert.equal(failure.cause, 'reference:includes');
  assert.equal(failure.root_cause.reason, 'value_relation_unknown');
  assert.equal(failure.subject.identity.term, 'feature');
  assert.equal(failure.attribution.status, status);
  if (status === 'mapped') assert.deepEqual(failure.attribution.subject, projected.value.members[0].selector);
  else {
    assert.equal(failure.attribution.subject, undefined);
    assert.equal(typeof failure.attribution.uncertainty, 'string');
  }
  assert.doesNotMatch(JSON.stringify(projected), /definition_identity|constraint-private|constraint-unknown|row-private|row-other/u);
  assert.deepEqual(captured, before, 'retained source projection is pure');
});
