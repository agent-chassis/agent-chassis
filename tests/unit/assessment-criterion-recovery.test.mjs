import assert from 'node:assert/strict';
import test from 'node:test';
import { assessAcceptanceCriterionCoverage } from '../../packages/wiki-core/src/operations/controlled-contract/acceptance-criterion-coverage.mjs';

test('criterion recovery retains every actual association cause and unknown validity', () => {
  const inventory = Array.from({ length: 13 }, (_, index) => ({ identity: `criterion-${index}`,
    position: index + 1, text: `Preserve property ${index}.`, text_sha256: `current-${index}` }));
  const link = (index, digest = inventory[index].text_sha256) => ({ identity: inventory[index].identity, text_sha256: digest });
  const assessed = assessAcceptanceCriterionCoverage({ inventory, wkId: 'WK-9000', selectedUnit: 'SLICE-003',
    obligations: [
      { obligation_id: 'bad-content', acceptance_criteria: [link(0)] },
      { obligation_id: 'stale-link', acceptance_criteria: [link(1, 'old-text')] },
      { obligation_id: 'unassessed', acceptance_criteria: [link(2)] },
      { obligation_id: 'good', acceptance_criteria: [link(3)] },
      { obligation_id: 'removed-link', acceptance_criteria: [{ identity: 'removed', text_sha256: 'old' }] }
    ], validObligationIds: ['good'], obligationStatuses: [
      { obligation_id: 'bad-content', status: 'invalid' }, { obligation_id: 'stale-link', status: 'valid' }
    ] });
  assert.equal(assessed.status, 'incomplete');
  assert.equal(assessed.criterion_gaps.length, 12, 'no truncation of decision facts beyond the bounded native preview');
  assert.deepEqual(assessed.criterion_gaps.slice(0, 3).map(row => row.associations), [
    [{ obligation_id: 'bad-content', association: 'current', validity: 'invalid' }],
    [{ obligation_id: 'stale-link', association: 'criterion_text_changed', validity: 'valid' }],
    [{ obligation_id: 'unassessed', association: 'current', validity: 'unavailable' }]
  ]);
  assert.deepEqual(assessed.criterion_gaps.at(-1), {
    criterion: { text: inventory.at(-1).text }, associations: [] });
  assert.deepEqual(assessed.removed_criterion_associations, [{ obligation_id: 'removed-link', reason: 'criterion_absent' }]);
  assert.equal(assessed.verification_credit, 0);
});
