import assert from 'node:assert/strict';
import test from 'node:test';

import { applyRequirementCorrections, requirementCorrectionTargets } from
  '../../packages/wiki-core/src/operations/controlled-contract/contract-requirement-corrections.mjs';
import { planProofAuthoringRequirementRebinding, proofAuthoringRebindingIntents,
  remapProofAuthoringObligationLinks } from
  '../../packages/wiki-core/src/operations/controlled-contract/proof-authoring-requirement-rebinding.mjs';
import { rebindWorkRecordTestProofVerificationIds } from
  '../../packages/wiki-core/src/lib/work-record-test-proof-bindings.mjs';

const claim = (claim_id, kind = 'behavior') => ({ claim_id, kind, modality: 'MUST',
  proposition_id: `prop-${claim_id}` });
const verifies = (source, target) => ({ relation_id: `rel-${source}-${target}`, role: 'verifies',
  source_claim_id: source, target_claim_id: target });

function compiledContent(claims, relations) {
  return { claims: claims.map(([id, kind]) => claim(id, kind)), relations,
    propositions: claims.map(([id]) => ({ proposition_id: `prop-${id}`, subject_reference_id: 'ref-subject' })),
    references: [{ reference_id: 'ref-subject' }], test_proofs: [] };
}
const correct = (content, entries) => {
  const requirements = entries.map(({ replace }) => ({ replace_claim_id: replace }));
  const targets = requirementCorrectionTargets(content, requirements);
  return applyRequirementCorrections(content, requirements, entries.map(({ claim_id, verification }) =>
    ({ claim_id, verification_claim_id: verification })), targets, []);
};

test('the compiler reports actual retirement and keeps a verification the replacement still compiles', () => {
  const retiring = correct(compiledContent([['claim-old'], ['claim-v-old', 'verification'],
    ['claim-new'], ['claim-v-new', 'verification']],
  [verifies('claim-v-old', 'claim-old'), verifies('claim-v-new', 'claim-new')]),
  [{ replace: 'claim-old', claim_id: 'claim-new', verification: 'claim-v-new' }]);
  assert.deepEqual(retiring.corrections.map(fact => ({ ...fact })), [{ requirement_index: 0,
    prior_claim_id: 'claim-old', claim_id: 'claim-new', verification_claim_id: 'claim-v-new',
    requirement_retired: true, prior_verification_ids: ['claim-v-old'],
    retired_verification_ids: ['claim-v-old'], surviving_verification_ids: [] }]);
  assert.deepEqual(retiring.content.claims.map(({ claim_id }) => claim_id), ['claim-new', 'claim-v-new']);

  const surviving = correct(compiledContent([['claim-old'], ['claim-v', 'verification'], ['claim-new']],
    [verifies('claim-v', 'claim-old'), verifies('claim-v', 'claim-new')]),
  [{ replace: 'claim-old', claim_id: 'claim-new', verification: 'claim-v' }]);
  assert.deepEqual(surviving.corrections[0].retired_verification_ids, []);
  assert.deepEqual(surviving.corrections[0].surviving_verification_ids, ['claim-v']);
  assert.deepEqual(surviving.content.relations, [verifies('claim-v', 'claim-new')],
    'a surviving verification keeps its identity and verifies only the replacement');

  const verificationOnly = correct(compiledContent([['claim-same'], ['claim-v-old', 'verification'],
    ['claim-v-new', 'verification']],
  [verifies('claim-v-old', 'claim-same'), verifies('claim-v-new', 'claim-same')]),
  [{ replace: 'claim-same', claim_id: 'claim-same', verification: 'claim-v-new' }]);
  assert.equal(verificationOnly.corrections[0].requirement_retired, false);
  assert.deepEqual(verificationOnly.corrections[0].retired_verification_ids, ['claim-v-old'],
    'a replacement keeping its requirement identity still retires the verification it no longer compiles');
  assert.deepEqual(verificationOnly.content.relations, [verifies('claim-v-new', 'claim-same')]);

  const noOp = correct(compiledContent([['claim-same'], ['claim-v', 'verification']],
    [verifies('claim-v', 'claim-same')]), [{ replace: 'claim-same', claim_id: 'claim-same', verification: 'claim-v' }]);
  assert.equal(noOp.corrections[0].requirement_retired, false);
  assert.deepEqual(noOp.corrections[0].retired_verification_ids, []);
});

test('the compiler refuses to drop a verification still serving an unselected requirement', () => {
  const content = compiledContent([['claim-old'], ['claim-other'], ['claim-v-shared', 'verification'],
    ['claim-new'], ['claim-v-new', 'verification']],
  [verifies('claim-v-shared', 'claim-old'), verifies('claim-v-shared', 'claim-other'),
    verifies('claim-v-new', 'claim-new')]);
  const before = structuredClone(content);
  assert.throws(() => correct(content, [{ replace: 'claim-old', claim_id: 'claim-new', verification: 'claim-v-new' }]),
    error => error.code === 'controlled_contract_requirement_correction_shared_verification' &&
      error.details.verification_id === 'claim-v-shared' &&
      JSON.stringify(error.details.requirement_claim_ids) === JSON.stringify(['claim-other']) &&
      error.details.field === 'requirements[0].replace_claim_id' &&
      JSON.stringify(error.details.guidance_path) === JSON.stringify(['required_object_shapes', 'requirement_rebinding']));
  assert.deepEqual(content, before, 'the refused correction removes nothing');
});

test('the rebinding plan transports simultaneous and ambiguous mappings without choosing between them', () => {
  const fact = (index, prior, next, verification, retired) => ({ requirement_index: index,
    prior_claim_id: prior, claim_id: next, verification_claim_id: verification, requirement_retired: true,
    prior_verification_ids: retired, retired_verification_ids: retired, surviving_verification_ids: [] });
  const cycle = planProofAuthoringRequirementRebinding({
    corrections: [fact(0, 'claim-a', 'claim-b', 'claim-v-b', ['claim-v-a']),
      fact(1, 'claim-b', 'claim-a', 'claim-v-a', ['claim-v-b'])],
    requirements: [{ rebind_case_ids: ['case-a'] }, { rebind_case_ids: ['case-b', 'case-c'] }] });
  assert.equal(cycle.rebindOperationCount, 3);
  const remapped = remapProofAuthoringObligationLinks({ obligations: [
    { obligation_id: 'OBL-A', controlled_contract_node_ids: ['claim-a', 'claim-v-a', 'claim-unrelated'] },
    { obligation_id: 'OBL-B', controlled_contract_node_ids: ['claim-b', 'claim-a'] },
    { obligation_id: 'OBL-C', statement: 'untouched' }] }, cycle);
  assert.deepEqual(remapped.obligations, [
    { obligation_id: 'OBL-A', controlled_contract_node_ids: ['claim-b', 'claim-v-b', 'claim-unrelated'] },
    { obligation_id: 'OBL-B', controlled_contract_node_ids: ['claim-a', 'claim-b'] },
    { obligation_id: 'OBL-C', statement: 'untouched' }], 'a cycle applies once, simultaneously');
  const current = new Map([['case-a', 'claim-v-a'], ['case-b', 'claim-v-b'], ['case-c', 'claim-v-surviving']]);
  assert.deepEqual(proofAuthoringRebindingIntents(cycle, id => current.get(id)), [
    { case_id: 'case-a', path: '/verification_id', value: 'claim-v-b', obligation_id: 'requirements[0].rebind_case_ids' },
    { case_id: 'case-b', path: '/verification_id', value: 'claim-v-a', obligation_id: 'requirements[1].rebind_case_ids' }]);

  const ambiguous = planProofAuthoringRequirementRebinding({ corrections: [
    fact(1, 'claim-b', 'claim-b2', 'claim-v-2', ['claim-v-shared']),
    fact(0, 'claim-a', 'claim-a2', 'claim-v-1', ['claim-v-shared'])] });
  assert.deepEqual([...ambiguous.ambiguousLinks], [['claim-v-shared', ['claim-v-1', 'claim-v-2']]]);
  assert.equal(ambiguous.exactLinks.has('claim-v-shared'), false,
    'a conflicting mapping is reported for refusal, never resolved by position');
});

test('target rebinding changes identities only and refuses before any unit changes', () => {
  const record = { id: 'WK-9000', acceptance: { validation: [
    'Run the focused suite',
    { operation: 'node_test', target: 'tests/a.test.mjs', verification_ids: ['claim-z', 'claim-old'] },
    { note: 'History', verification_ids: ['claim-old'] }] },
  slices: [{ id: 'SLICE-001', acceptance: { validation: [
    { operation: 'node_test', target: 'tests/b.test.mjs', verification_ids: ['claim-slice-old'] }] } }] };
  const changed = rebindWorkRecordTestProofVerificationIds(record,
    new Map([['claim-old', 'claim-new'], ['claim-slice-old', 'claim-slice-new']]));
  assert.deepEqual(changed, ['WK-9000', 'WK-9000#SLICE-001']);
  assert.deepEqual(record.acceptance.validation, ['Run the focused suite',
    { operation: 'node_test', target: 'tests/a.test.mjs', verification_ids: ['claim-z', 'claim-new'] },
    { note: 'History', verification_ids: ['claim-old'] }]);
  assert.deepEqual(record.slices[0].acceptance.validation, [
    { operation: 'node_test', target: 'tests/b.test.mjs', verification_ids: ['claim-slice-new'] }]);
  assert.deepEqual(rebindWorkRecordTestProofVerificationIds(record, new Map([['claim-native', 'claim-x']])), [],
    'a verification without an ordinary declaration gains none');

  const duplicate = structuredClone(record);
  assert.throws(() => rebindWorkRecordTestProofVerificationIds(duplicate, new Map([['claim-new', 'claim-z']])),
    error => error.code === 'obligation_coverage_case_target_invalid');
  assert.deepEqual(duplicate, record, 'an invalid prospective declaration mutates no unit');
  const crossUnit = structuredClone(record);
  assert.throws(() => rebindWorkRecordTestProofVerificationIds(crossUnit, new Map([['claim-slice-new', 'claim-new']])),
    error => error.code === 'obligation_coverage_case_selector_cross_unit' &&
      JSON.stringify(error.details.owner_units) === JSON.stringify(['WK-9000', 'WK-9000#SLICE-001']));
  assert.deepEqual(crossUnit, record);
});
