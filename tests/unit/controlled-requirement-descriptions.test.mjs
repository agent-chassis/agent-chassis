import test from 'node:test';
import assert from 'node:assert/strict';
import { describeRequirementObjects, descriptionKey } from
  '../../packages/wiki-core/src/operations/controlled-contract/contract-requirement-descriptions.mjs';
import { profileTerm } from '../helpers/description-coverage-author-oracle.mjs';

test('DESCRIPTION-CLOSURE-RESOLVES-EXACT-DEFINITIONS-AND-PROPAGATES-MISSING-LEAVES', () => {
  const typeOf = id => id === 'condition' ? 'cc:criterion' : ['shared', 'leaf'].includes(id) ? 'cc:resource' : 'cc:operation';
  const entity = id => profileTerm(id, typeOf(id));
  const ref = id => ({ reference_id: `ref-${id}`, ...entity(id) });
  const guarded = ['root', 'child', 'recursive'];
  const prop = (id, subject, operands = [], context = []) => ({ proposition_id: `prop-${id}`,
    operator: operands.length ? 'reference:reads' : id === 'condition' ? 'boolean:exists'
      : typeOf(subject) === 'cc:resource' ? 'number:has_value' : 'number:returns',
    subject_reference_id: `ref-${subject}`, operands: operands.length
      ? operands.map(value => ({ kind: 'reference', reference_id: `ref-${value}` }))
      : [{ kind: id === 'condition' ? 'boolean' : 'number', value: id === 'condition' ? true : 42 }],
    applicability_context: { mode: context.length ? 'if' : 'unconditional', operand_reference_ids: context.map(value => `ref-${value}`) } });
  const claim = (id, modality = 'MUST', kind = 'behavior') => ({ claim_id: `claim-${id}`, proposition_id: `prop-${id}`, kind, modality });
  const propositions = [prop('root', 'root', ['child', 'shared'], ['condition']), prop('other', 'other', ['shared']),
    prop('child', 'child', ['recursive'], ['condition']), prop('recursive', 'recursive', ['child', 'leaf'], ['condition']),
    prop('shared', 'shared'), prop('condition', 'condition'), prop('leaf', 'leaf'), prop('unrelated', 'unrelated')];
  const contract = { references: ['root', 'other', 'child', 'recursive', 'shared', 'condition', 'leaf', 'unrelated'].map(ref),
    propositions, claims: propositions.map(row => claim(row.proposition_id.slice(5), row.proposition_id === 'prop-child' ? 'MAY' : 'MUST')), relations: [] };
  const root = (owner, id) => ({ owner, entity: entity(id), ...(guarded.includes(id)
    ? { applies: { mode: 'if', context: [entity('condition')] } } : {}) });
  const derive = (content, more = {}) => describeRequirementObjects({ specifications: [{ owner: 'owning-specification', contract: content }],
    roots: [root('owning-specification', 'root'), root('owning-specification', 'other'), root('owning-specification', 'recursive')], ...more });
  const complete = derive(contract);
  assert.equal(complete.state, 'complete', JSON.stringify(complete.missing));
  const rootDescription = complete.roots.find(row => row.entity.identity.term === 'root');
  assert.deepEqual(rootDescription.defining_claim_ids, ['child', 'condition', 'leaf', 'recursive', 'root', 'shared'].map(id => `claim-${id}`));
  assert.deepEqual(rootDescription.defining_proposition_ids, ['child', 'condition', 'leaf', 'recursive', 'root', 'shared'].map(id => `prop-${id}`));
  assert.equal(complete.nodes.filter(row => row.entity.identity.term === 'shared').length, 1);
  assert.equal(complete.nodes.some(row => row.entity.identity.term === 'unrelated'), false);
  assert.equal(contract.claims.find(row => row.claim_id === 'claim-child').modality, 'MAY');
  assert.deepEqual(contract.propositions.find(row => row.proposition_id === 'prop-child').applicability_context,
    { mode: 'if', operand_reference_ids: ['ref-condition'] });

  const missingLeaf = structuredClone(contract);
  missingLeaf.claims = missingLeaf.claims.filter(row => row.claim_id !== 'claim-leaf');

  missingLeaf.claims.push(claim('leaf', 'MUST', 'verification'), claim('leaf', 'MUST', 'evidence'));
  missingLeaf.relations.push({ role: 'verifies', source_claim_id: 'claim-leaf', target_claim_id: 'claim-root' });
  const incomplete = derive(missingLeaf);
  assert.equal(incomplete.state, 'incomplete');
  for (const id of ['root', 'recursive']) {
    const description = incomplete.roots.find(row => row.entity.identity.term === id);
    assert.equal(description.state, 'incomplete');
    assert.ok(description.missing.some(row => row.code === 'description_definition_missing'
      && row.key === descriptionKey('owning-specification', entity('leaf'))));
  }
  assert.equal(incomplete.roots.find(row => row.entity.identity.term === 'other').state, 'complete');
  assert.equal(derive(contract).state, 'complete', 'restoring the authored leaf completes both dependent roots');
  const bare = describeRequirementObjects({ specifications: [{ owner: 'owning-specification', contract: { ...contract, claims: [] } }],
    roots: [root('owning-specification', 'root')] });
  assert.equal(bare.state, 'incomplete');
  assert.deepEqual(bare.roots[0].defining_claim_ids, []);
  const twoOwners = describeRequirementObjects({ specifications: [{ owner: 'left', contract }, { owner: 'right', contract: missingLeaf }],
    roots: [root('left', 'root'), root('right', 'root')] });
  assert.deepEqual(twoOwners.roots.map(row => [row.owner, row.state]), [['left', 'complete'], ['right', 'incomplete']]);
  const invisible = describeRequirementObjects({ specifications: [{ owner: 'owning-specification', contract,
    visibleNodeIds: new Set([...contract.references.filter(row => row.reference_id !== 'ref-leaf').map(row => row.reference_id),
      ...contract.claims.map(row => row.claim_id), ...contract.propositions.map(row => row.proposition_id)]) }],
    roots: [root('owning-specification', 'root')] });
  assert.equal(invisible.state, 'incomplete');
  assert.ok(invisible.missing.some(row => row.code === 'description_dependency_not_visible'));
  assert.deepEqual(invisible.nodes.find(row => row.entity.identity.term === 'leaf').definitions, []);
  assert.equal(invisible.roots[0].defining_claim_ids.includes('claim-leaf'), false);
  const missingCondition = structuredClone(contract);
  missingCondition.claims = missingCondition.claims.filter(row => row.claim_id !== 'claim-condition');
  const conditionGap = derive(missingCondition);
  assert.equal(conditionGap.roots.find(row => row.entity.identity.term === 'root').state, 'incomplete');
  assert.ok(conditionGap.missing.some(row => row.code === 'description_definition_missing'
    && row.key === descriptionKey('owning-specification', entity('condition')) && row.required_meaning === 'condition'));
  const inactive = structuredClone(contract);
  inactive.propositions.find(row => row.proposition_id === 'prop-child').applicability_context.mode = 'unless';
  const inactiveGap = derive(inactive);
  assert.equal(inactiveGap.roots.find(row => row.entity.identity.term === 'root').state, 'incomplete');
  assert.equal(inactiveGap.roots.find(row => row.entity.identity.term === 'other').state, 'complete');
  assert.ok(inactiveGap.missing.some(row => row.code === 'description_use_definition_missing'
    && row.key === descriptionKey('owning-specification', entity('child')) && row.required_meaning === 'object'
    && row.applicability.mode === 'if' && row.available_definition_ids.length > 0));
  const aliases = structuredClone(contract);
  aliases.propositions = [prop('child', 'child', ['recursive']), prop('recursive', 'recursive', ['child'])]
    .map(row => ({ ...row, operator: 'reference:equals' }));
  aliases.claims = [claim('child'), claim('recursive')];
  const aliasCycle = describeRequirementObjects({ specifications: [{ owner: 'owning-specification', contract: aliases }],
    roots: [root('owning-specification', 'child')] });
  assert.equal(aliasCycle.state, 'incomplete', 'a revisited identity-only cycle supplies no defining behavior');
  assert.ok(aliasCycle.missing.some(row => row.code === 'description_use_definition_missing'
    && row.key === descriptionKey('owning-specification', entity('child')) && row.required_meaning === 'subject'
    && row.available_definition_ids.length > 0));
  const codeEntity = { type_term: 'cc:configuration', identity: { kind: 'repository_path', repository: 'test/repository', path: 'config.mjs' } };
  const unsupported = describeRequirementObjects({ specifications: [{ owner: 'owning-specification', contract: null }],
    roots: [{ owner: 'owning-specification', entity: codeEntity }], sourceDescriptions: new Map([
      [descriptionKey('owning-specification', codeEntity), { state: 'incomplete', code: 'description_value_binding_unsupported' }]]) });
  assert.equal(unsupported.state, 'incomplete');
  assert.ok(unsupported.missing.some(row => row.code === 'description_value_binding_unsupported'));
  assert.equal(describeRequirementObjects({ specifications: [{ owner: 'owning-specification', contract }],
    roots: [root('owning-specification', 'root')], nodeLimit: 2 }).missing[0].code, 'description_delivery_capacity_exceeded');
});
