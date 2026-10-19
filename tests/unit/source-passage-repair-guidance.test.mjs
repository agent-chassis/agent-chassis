import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRequirementSourceLink } from '../../packages/wiki-core/src/operations/controlled-contract/contract-requirement-source-links.mjs';
import { requirementGuidanceRecoveryCall, resolveRequirementAuthoringGuidance } from '../../packages/wiki-mcp/src/lib/requirement-authoring-guidance.mjs';

test('source refusals select the existing complete-restatement guidance without changing exact matching', () => {
  const refused = (passage, occurrence, field = 'changes.requirements.requirements[0]') => {
    let cause;
    assert.throws(() => resolveRequirementSourceLink({ wkId: 'WK-2728', text: 'A. A.', passage, occurrence, field }), error => {
      cause = error;
      return true;
    });
    return cause;
  };
  for (const [passage, occurrence, code] of [
    ['a.', undefined, 'passage_not_found'], ['A.', undefined, 'occurrence_required'],
    ['A.', 3, 'occurrence_out_of_range'], [undefined, 1, 'occurrence_without_passage']
  ]) {
    const error = refused(passage, occurrence);
    assert.equal(error.code, `controlled_contract_requirement_source_${code}`);
    assert.equal(error.details.changed, false);
    const call = requirementGuidanceRecoveryCall(error.details.guidance_path);
    assert.equal(call.tool, 'workspace_read_wiki');
    const selected = resolveRequirementAuthoringGuidance(call.arguments.subject.topic);
    assert.equal(selected.ok, true);
    assert.match(selected.value.intent, /complete row restatement/u);
    assert.match(selected.value.read, /does not include verification/u);
    assert.match(selected.value.limit, /report that exact gap/u);
    assert.equal(requirementGuidanceRecoveryCall(error.details.guidance_path, 'free_local'), null);
  }
  assert.equal(refused('a.', undefined, 'exception.source_passages[0]').details.guidance_path, undefined,
    'exception correction does not advertise requirement-row authoring');
  assert.equal(resolveRequirementSourceLink({ wkId: 'WK-2728', text: 'A. A.', passage: undefined,
    field: 'changes.requirements.requirements[0]' }), null, 'unlinked drafts stay supported');
  assert.equal(resolveRequirementSourceLink({ wkId: 'WK-2728', text: 'A. A.', passage: 'A.', occurrence: 2,
    field: 'changes.requirements.requirements[0]' }).location.start, 3);
  const addressing = resolveRequirementAuthoringGuidance(['save_record_inputs', 'requirement_batch', 'row_addressing']).value;
  assert.match(addressing.row_id, /complete restatement/u);
  assert.doesNotMatch(addressing.row_id, /or only its source passage/u);
});
