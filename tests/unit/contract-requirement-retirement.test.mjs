import assert from 'node:assert/strict';
import test from 'node:test';

import { compileControlledContractRequirements } from
  '../../packages/wiki-core/src/operations/controlled-contract/contract-requirement-authoring.mjs';
import { applyRequirementCorrections, requirementCorrectionTargets, requirementRetirementTargets } from
  '../../packages/wiki-core/src/operations/controlled-contract/contract-requirement-corrections.mjs';
import { planProofAuthoringRequirementRetirement, reconcileProofAuthoringRequirementRetirement } from
  '../../packages/wiki-core/src/operations/controlled-contract/proof-authoring-requirement-retirement.mjs';

const GUIDANCE = ['required_object_shapes', 'requirement_retirement'];
const TARGET_INVALID = 'controlled_contract_requirement_correction_target_invalid';
const CONFLICTING = 'controlled_contract_requirement_correction_conflicting';
const claim = (id, kind = 'behavior') => ({ claim_id: `claim-${id}`, kind, modality: 'MUST', proposition_id: `prop-${id}` });
const relation = (source, target, role = 'verifies') => ({ relation_id: `rel-${role}-${source}-${target}`, role,
  source_claim_id: `claim-${source}`, target_claim_id: `claim-${target}` });

function stored({ claims = [], relations = [], collections = [] } = {}) {
  const all = [claim('r-old'), claim('r-kept'), claim('v-only', 'verification'), claim('v-shared', 'verification'), ...claims];
  return { claims: all, collections,
    relations: [relation('v-only', 'r-old'), relation('v-shared', 'r-old'), relation('v-shared', 'r-kept'), ...relations],
    propositions: all.map(({ proposition_id: id }) => ({ proposition_id: id, subject_reference_id: `ref-${id}` })),
    references: all.map(({ proposition_id: id }) => ({ reference_id: `ref-${id}` })),
    test_proofs: ['claim-v-only', 'claim-v-shared'].map(id => ({ verification_claim_id: id })) };
}
function retire(content, retireIds, { requirements = [], compiled = [] } = {}) {
  const corrections = requirementCorrectionTargets(content, requirements);
  return applyRequirementCorrections(content, requirements, compiled, corrections, [],
    requirementRetirementTargets(content, retireIds, corrections));
}
const refuses = (attempt, code, expected) => assert.throws(attempt, error => {
  assert.equal(error.code, code);
  assert.equal(error.details.changed, false);
  for (const [key, value] of Object.entries(expected)) assert.deepEqual(error.details[key], value, key);
  return true;
});

test('explicit retirement retires only verifications no remaining requirement uses', () => {
  const { content, corrections, retirements } = retire(stored(), ['claim-r-old']);
  assert.deepEqual(corrections, []);
  assert.deepEqual(retirements.map(fact => ({ ...fact })), [{ retire_index: 0, claim_id: 'claim-r-old',
    prior_verification_ids: ['claim-v-only', 'claim-v-shared'], retired_verification_ids: ['claim-v-only'],
    surviving_verification_ids: ['claim-v-shared'] }]);
  assert.deepEqual(content.claims.map(({ claim_id: id }) => id), ['claim-r-kept', 'claim-v-shared']);
  assert.deepEqual(content.relations, [relation('v-shared', 'r-kept')]);
  assert.deepEqual(content.test_proofs, [{ verification_claim_id: 'claim-v-shared' }]);
  assert.deepEqual(content.references.map(({ reference_id: id }) => id), ['ref-prop-r-kept', 'ref-prop-v-shared']);

  const compiledUse = retire(stored({ claims: [claim('r-new')], relations: [relation('v-only', 'r-new')] }),
    ['claim-r-old'], { requirements: [{}], compiled: [{ claim_id: 'claim-r-new', verification_claim_id: 'claim-v-only' }] });
  assert.deepEqual(compiledUse.retirements[0].retired_verification_ids, [],
    'a verification a requirement compiled in the same answer still uses survives');
  const internal = retire(stored({ relations: [relation('v-only', 'r-old', 'traces')] }), ['claim-r-old']);
  assert.equal(internal.content.relations.some(({ role }) => role === 'traces'), false,
    'a relation between two removed claims leaves with them');
});

test('retirement selections and retained semantic dependencies refuse before any change', () => {
  const content = stored();
  const before = structuredClone(content);
  refuses(() => retire(content, ['claim-missing']), TARGET_INVALID,
    { field: 'retire_claim_ids[0]', retire_claim_id: 'claim-missing', guidance_path: GUIDANCE });
  refuses(() => retire(content, ['claim-r-kept', 'claim-v-only']), TARGET_INVALID, { field: 'retire_claim_ids[1]' });
  refuses(() => retire(content, ['claim-r-old', 'claim-r-old']), CONFLICTING, { retire_indexes: [0, 1] });
  refuses(() => retire(content, ['claim-r-old'], { requirements: [{ replace_claim_id: 'claim-r-old' }] }), CONFLICTING,
    { field: 'retire_claim_ids[0]', requirement_index: 0 });
  refuses(() => retire(content, ['claim-r-old'], { requirements: [{}],
    compiled: [{ claim_id: 'claim-r-old', verification_claim_id: null }] }), CONFLICTING, { requirement_index: 0 });
  assert.deepEqual(content, before);

  const dependent = stored({ relations: [relation('r-kept', 'r-old', 'depends_on')], collections: [
    { collection_id: 'set-scope', collection_kind: 'closed_set', member_claim_ids: ['claim-r-kept', 'claim-v-only'] }] });
  const dependentBefore = structuredClone(dependent);
  refuses(() => retire(dependent, ['claim-r-old']), 'controlled_contract_requirement_retirement_dependency_conflict', {
    field: 'retire_claim_ids[0]', retire_claim_id: 'claim-r-old', retired_claim_ids: ['claim-r-old', 'claim-v-only'],
    dependency_count: 2, guidance_path: GUIDANCE, dependencies: [
      { kind: 'relation', relation_id: 'rel-depends_on-r-kept-r-old', role: 'depends_on', source_claim_id: 'claim-r-kept',
        target_claim_id: 'claim-r-old', retired_claim_ids: ['claim-r-old'] },
      { kind: 'collection', collection_id: 'set-scope', collection_kind: 'closed_set', retired_claim_ids: ['claim-v-only'] }] });
  assert.deepEqual(dependent, dependentBefore);
});

test('the answer bound counts retirement selections and an empty answer refuses', () => {
  const compile = answer => () => compileControlledContractRequirements({ wkId: 'WK-9000', answer, contract: stored() });
  for (const answer of [{}, { retire_claim_ids: [] }, { requirements: [], retire_claim_ids: ['claim-r-old'] }]) {
    refuses(compile(answer), 'controlled_contract_requirement_invalid', { maximum: 8, guidance_path: GUIDANCE });
  }
  refuses(compile({ requirements: Array.from({ length: 8 }, () => ({})), retire_claim_ids: ['claim-r-old'] }),
    'controlled_contract_requirement_invalid', { requirement_count: 8, retirement_count: 1 });
});

test('dependent uses retire only when their established support is entirely retired', () => {
  const plan = planProofAuthoringRequirementRetirement({ contract: stored(),
    retirements: [{ claim_id: 'claim-r-old', retired_verification_ids: ['claim-v-only'] }] });
  const row = (obligation_id, links, case_id) => ({ obligation_id,
    ...(links ? { controlled_contract_node_ids: links } : {}), ...(case_id ? { case_id } : {}) });
  const unaffected = { obligations: [row('OBL-KEPT', ['claim-r-kept'])] };
  const sources = [
    { selectedUnit: null, unit: 'WK-9000', amended: new Set(['OBL-E-AMENDED']), content: { obligations: [
      row('OBL-A', ['claim-r-old', 'claim-v-only'], 'case-only'), row('OBL-B', ['claim-v-shared']),
      row('OBL-C', ['claim-r-old'], 'case-open'), row('OBL-D'), row('OBL-E-AMENDED', ['claim-r-old']),
      row('OBL-F', ['claim-r-old'], 'case-shared'), row('OBL-G', ['claim-r-old', 'claim-elsewhere'])] } },
    { selectedUnit: 'SLICE-001', unit: 'WK-9000#SLICE-001', amended: new Set(), content: { obligations: [
      row('OBL-SLICE-MIXED', ['claim-r-old', 'claim-r-kept']), row('OBL-SLICE-CASE', undefined, 'case-only')] } },
    { selectedUnit: 'SLICE-002', unit: 'WK-9000#SLICE-002', amended: new Set(), content: unaffected },
    { selectedUnit: 'SLICE-003', unit: 'WK-9000#SLICE-003', amended: new Set(), content: undefined }];
  const verifications = new Map([['case-only', 'claim-v-only'], ['case-shared', 'claim-v-shared'], ['case-open', undefined]]);
  const reconcile = entries => reconcileProofAuthoringRequirementRetirement(plan, { sources: entries,
    caseIds: [...verifications.keys()], verificationIdForCase: caseId => verifications.get(caseId) });
  const result = reconcile(sources);
  assert.deepEqual(result.retiredUses, [
    { unit: 'WK-9000', obligation_id: 'OBL-A', case_id: 'case-only', retired_identities: ['claim-r-old', 'claim-v-only'] },
    { unit: 'WK-9000', obligation_id: 'OBL-C', case_id: 'case-open', retired_identities: ['claim-r-old'] },
    { unit: 'WK-9000#SLICE-001', obligation_id: 'OBL-SLICE-CASE', case_id: 'case-only', retired_identities: ['claim-v-only'] }]);
  const mixed = (unit, obligation_id, extra, links, requirements) => ({ unit, obligation_id, ...extra,
    condition: 'mixed_use', surviving_link_ids: links, surviving_requirement_claim_ids: requirements });
  assert.deepEqual(result.conflicts, [
    { unit: 'WK-9000', obligation_id: 'OBL-E-AMENDED', retired_identities: ['claim-r-old'], condition: 'amended_use_retires' },
    mixed('WK-9000', 'OBL-F', { case_id: 'case-shared', retired_identities: ['claim-r-old'] }, [], ['claim-r-kept']),
    mixed('WK-9000', 'OBL-G', { retired_identities: ['claim-r-old'] }, ['claim-elsewhere'], []),
    mixed('WK-9000#SLICE-001', 'OBL-SLICE-MIXED', { retired_identities: ['claim-r-old'] }, ['claim-r-kept'], ['claim-r-kept'])]);
  assert.deepEqual([...result.retiredCaseIds], ['case-only'], 'unfinished and surviving-verification cases remain');
  assert.deepEqual(result.contents.get(null).obligations.map(({ obligation_id: id }) => id),
    ['OBL-B', 'OBL-D', 'OBL-E-AMENDED', 'OBL-F', 'OBL-G']);
  assert.equal(result.contents.get('SLICE-002'), unaffected, 'an unaffected source is returned unchanged');
  assert.equal(result.contents.get('SLICE-003'), undefined);
  const reversed = reconcile([...sources].reverse());
  assert.deepEqual([reversed.retiredUses, reversed.conflicts], [result.retiredUses, result.conflicts]);
});
