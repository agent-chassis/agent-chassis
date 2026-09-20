import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyControlledContractRuntimeEligibility as classify,
  resolveControlledContractDeclarationPopulation as declare } from
  '../../packages/wiki-core/src/lib/controlled-contract-runtime-proof-eligibility.mjs';

const contract = { claims: ['A', 'B', 'C'].map(claim_id => ({ claim_id,
  kind: 'verification', verification_method: 'test_execution' })),
  test_proofs: ['A', 'B', 'C'].map(verification_claim_id => ({ verification_claim_id,
    test_proof_id: `proof-${verification_claim_id}` })) };
function coverage(ids) {
  return { source: { content_digest: 'saved-source' }, sourceCurrent: true,
    rows: ids.map((id, index) => ({ obligation_id: `OBL-${index}`,
      selection: { proof_name: 'test' }, design_status: 'valid', mechanism: { kind: 'test' }, controlled_contract_node_ids: [id] })),
    authoringApplicability: { selection_relationships: ids.map((_, index) => ({ obligation_id: `OBL-${index}` })) } };
}
test('declaration presence is independent of absent and unresolved saved relationships', () => {
  for (const facts of [null, { source: { content_digest: 'saved-source' }, resolution: { mapping: null }, rows: [] }]) {
    const rows = classify(contract, facts);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map(row => row.test_proof_id), ['proof-A', 'proof-B', 'proof-C']);
    assert.ok(rows.every(row => row.classification === 'unresolved' && row.obligation_id === null));
    assert.ok(rows.every(row => row.reason_code === (facts === null
      ? 'obligation_coverage_source_not_found' : 'obligation_coverage_resolution_required')));
  }
  assert.deepEqual(classify({ claims: [], test_proofs: [] }, null), []);
});
test('every admitted current relationship establishes eligibility, including shared verification', () => {
  const rows = classify(contract, coverage(['A']));
  assert.equal(rows.filter(row => row.classification === 'runtime').length, 1);
  assert.equal(rows.filter(row => row.classification === 'unresolved').length, 2);
  const shared = classify(contract, coverage(['A', 'A']));
  assert.deepEqual(shared.filter(row => row.verification_id === 'A').map(row =>
    [row.obligation_id, row.classification, row.reason_code]), [
    ['OBL-0', 'runtime', 'runtime_test_proof_required'],
    ['OBL-1', 'runtime', 'runtime_test_proof_required']]);
  const stale = classify(contract, { ...coverage(['A']), sourceCurrent: false });
  assert.equal(stale.filter(row => row.classification === 'runtime').length, 0);
});

test('a relationship-specific conflict preserves its valid shared sibling', () => {
  const facts = coverage(['A', 'A']);
  facts.rows[1].mechanism = { kind: 'durable_record' };
  const rows = classify(contract, facts).filter(row => row.verification_id === 'A');
  assert.deepEqual(rows.map(row => [row.obligation_id, row.classification, row.reason_code]), [
    ['OBL-0', 'runtime', 'runtime_test_proof_required'],
    ['OBL-1', 'conflicting', 'controlled_contract_cross_owner_verification_method_conflict']
  ]);
});

test('a genuinely duplicated declaration conflicts for every relationship with its actual count', () => {
  const duplicated = { ...contract, test_proofs: [...contract.test_proofs,
    { verification_claim_id: 'A', test_proof_id: 'proof-A-duplicate' }] };
  const rows = classify(duplicated, coverage(['A', 'A']))
    .filter(row => row.verification_id === 'A');
  assert.deepEqual(rows.map(row => [row.obligation_id, row.classification, row.reason_code,
    row.proof_binding_count]), [
    ['OBL-0', 'conflicting', 'runtime_test_proof_binding_ambiguous', 2],
    ['OBL-1', 'conflicting', 'runtime_test_proof_binding_ambiguous', 2]
  ]);
});

test('an unclaimed declaration reports its own gap, not the aggregate resolution', () => {
  const facts = { ...coverage(['A']), resolution: { mapping: null } };
  const rows = classify(contract, facts);
  const unclaimed = rows.filter(row => row.obligation_id === null);
  assert.deepEqual(unclaimed.map(row => row.verification_id), ['B', 'C']);
  assert.ok(unclaimed.every(row => row.reason_code === 'runtime_proof_obligation_missing'),
    JSON.stringify(unclaimed));

  const claimed = rows.find(row => row.verification_id === 'A');
  assert.equal(claimed.classification, 'runtime');
  assert.equal(claimed.obligation_id, 'OBL-0');

  const aggregateOnly = classify(contract, { ...facts, rows: [],
    authoringApplicability: { selection_relationships: [] } });
  assert.ok(aggregateOnly.every(row => row.obligation_id === null &&
    row.reason_code === 'obligation_coverage_resolution_required'),
  JSON.stringify(aggregateOnly));
});

test('an authored mechanism conflicts; an unauthored one is an absent fact', () => {
  const authoredTest = classify(contract, coverage(['A']))
    .find(row => row.verification_id === 'A');
  assert.equal(authoredTest.classification, 'runtime');

  const silent = coverage(['A']);
  const rows = silent.rows.map(({ mechanism: _dropped, ...row }) => row);
  const absent = classify(contract, { ...silent, rows })
    .find(row => row.verification_id === 'A');
  assert.equal(absent.classification, 'runtime', JSON.stringify(absent));
  assert.equal(absent.mechanism_kind, null);

  const disagreeing = coverage(['A']);
  const conflicting = classify(contract, { ...disagreeing,
    rows: disagreeing.rows.map(row => ({ ...row, mechanism: { kind: 'durable_record' } })) })
    .find(row => row.verification_id === 'A');
  assert.equal(conflicting.classification, 'conflicting');
  assert.equal(conflicting.reason_code,
    'controlled_contract_cross_owner_verification_method_conflict');
});

test('an authored explicit gap carries its kind and the author reason', () => {
  const gapCoverage = { source: { content_digest: 'saved-source' }, sourceCurrent: true,
    rows: [{ obligation_id: 'OBL-GAP', design_status: 'invalid',
      mechanism: { kind: 'test' }, controlled_contract_node_ids: ['A'],
      gap: { gap_kind: 'catalog_gap', reason: 'No admitted catalog proof covers it.' },
      diagnostics: [{ code: 'obligation_coverage_explicit_gap' }] }],
    authoringApplicability: { selection_relationships: [{ obligation_id: 'OBL-GAP' }] } };
  const row = classify(contract, gapCoverage)
    .find(entry => entry.obligation_id === 'OBL-GAP');
  assert.equal(row.classification, 'unresolved');
  assert.equal(row.reason_code, 'obligation_coverage_explicit_gap');
  assert.deepEqual(row.gap,
    { gap_kind: 'catalog_gap', reason: 'No admitted catalog proof covers it.' });
});

const binding = (id, proof = `proof-${id}`) => ({ verification_claim_id: id, test_proof_id: proof });
const saved = (obligationId, id, overrides = {}) => ({ obligation_id: obligationId,
  selection: { proof_name: 'test' }, design_status: 'valid', controlled_contract_node_ids: [id],
  ...overrides });
const relation = entry => [entry.verification_id, entry.obligation_id, entry.classification,
  entry.reason_code, entry.test_proof_id];

test('derived applicability preserves relationships while declarations retain their occurrences', () => {
  const bindings = [binding('A'), binding('B'), binding('A', 'proof-A-again')];
  const coverageRows = { rows: [saved('OBL-A', 'A'), saved('OBL-B', 'B')] };
  const before = structuredClone({ bindings, coverageRows });
  const { applicability, population } = declare(bindings, coverageRows, null);
  assert.deepEqual(applicability.map(relation), [
    ['A', 'OBL-A', 'runtime', 'runtime_test_proof_required', undefined],
    ['B', 'OBL-B', 'runtime', 'runtime_test_proof_required', undefined]
  ]);

  assert.deepEqual(population.map(relation), [
    ['A', 'OBL-A', 'runtime', 'runtime_test_proof_required', 'proof-A'],
    ['B', 'OBL-B', 'runtime', 'runtime_test_proof_required', 'proof-B'],
    ['A', 'OBL-A', 'runtime', 'runtime_test_proof_required', 'proof-A-again']
  ]);
  assert.deepEqual(population.map(entry => entry.binding), bindings);
  assert.deepEqual({ bindings, coverageRows }, before, 'inputs are not mutated');
});

test('multiple obligation relationships share one declaration without collapsing', () => {
  const bindings = [binding('A')];
  const { applicability, population } = declare(bindings,
    { rows: [saved('OBL-1', 'A'), saved('OBL-2', 'A')] }, null);
  assert.deepEqual(applicability.map(relation), [
    ['A', 'OBL-1', 'runtime', 'runtime_test_proof_required', undefined],
    ['A', 'OBL-2', 'runtime', 'runtime_test_proof_required', undefined]]);
  assert.deepEqual(population.map(relation), [
    ['A', 'OBL-1', 'runtime', 'runtime_test_proof_required', 'proof-A'],
    ['A', 'OBL-2', 'runtime', 'runtime_test_proof_required', 'proof-A']
  ]);
});

test('absent or invalid selections never establish a derived relationship', () => {
  for (const row of [saved('OBL-A', 'A', { selection: null }), saved('OBL-A', 'A', { design_status: 'invalid' }),
    saved('OBL-A', 'B')]) {
    const { applicability, population } = declare([binding('A')], { rows: [row] }, null);
    assert.deepEqual(applicability.map(relation), [
      ['A', null, 'unresolved', 'runtime_proof_obligation_missing', undefined]], JSON.stringify(row));
    assert.deepEqual(population.map(relation), [
      ['A', null, 'unresolved', 'runtime_proof_obligation_missing', 'proof-A']], JSON.stringify(row));
  }
  assert.deepEqual(declare([binding('A')], null, null).population.map(relation), [
    ['A', null, 'unresolved', 'runtime_proof_obligation_missing', 'proof-A']]);
});

test('supplied eligibility is used as given, including multiple rows and undeclared obligations', () => {
  const supplied = Object.freeze([
    Object.freeze({ verification_id: 'A', obligation_id: 'OBL-1', classification: 'runtime', reason_code: 'runtime_test_proof_required' }),
    Object.freeze({ verification_id: 'A', obligation_id: 'OBL-2', classification: 'runtime', reason_code: 'runtime_test_proof_required' }),
    Object.freeze({ verification_id: 'B', obligation_id: 'OBL-3', classification: 'conflicting', reason_code: 'runtime_test_proof_binding_ambiguous' }),
    Object.freeze({ verification_id: 'C', obligation_id: 'OBL-4', classification: 'runtime', reason_code: 'runtime_test_proof_required' })
  ]);
  const before = structuredClone(supplied);
  const bindings = [binding('A'), binding('B'), binding('B', 'proof-B-again')];

  const { applicability, population } = declare(bindings, { rows: [saved('OBL-X', 'A')] }, supplied);
  assert.equal(applicability, supplied);
  assert.deepEqual(structuredClone(supplied), before);
  assert.deepEqual(population.map(relation), [
    ['A', 'OBL-1', 'runtime', 'runtime_test_proof_required', 'proof-A'],
    ['A', 'OBL-2', 'runtime', 'runtime_test_proof_required', 'proof-A'],
    ['B', 'OBL-3', 'conflicting', 'runtime_test_proof_binding_ambiguous', 'proof-B'],
    ['B', 'OBL-3', 'conflicting', 'runtime_test_proof_binding_ambiguous', 'proof-B-again'],
    ['C', 'OBL-4', 'runtime', 'runtime_test_proof_required', undefined]
  ]);
  assert.equal(population[4], supplied[3], 'an undeclared supplied relationship is retained as given');
});
