import assert from 'node:assert/strict';
import test from 'node:test';
import { applyNativeTestProofCase, projectAuthoredTestCase, deriveAuthoredTestCases, validateCompleteNativeTestProof, validateNativeTestCase } from '../../packages/controlled-contract/lib/native-test-proof-authoring.mjs';
import { buildStableTestProofBindingTemplate } from '@agent-chassis/controlled-contract';
const component = { type_term: 'cc:runtime_component', identity: { kind: 'repository_path', repository: 'fixture/repo', path: 'module.mjs' } };
const create = () => ({ references: [], claims: [], relations: [], test_proofs: [] });
const apply = (contract, row, caseInput) => applyNativeTestProofCase({ contract, row, caseInput, subject: 'WK-9999', buildTemplate: buildStableTestProofBindingTemplate });
test('pure native authoring retains supplied partial values without inventing claims or propositions', () => {
  const contract = create(), row = { obligation_id: 'OBL-ONE' };
  const first = apply(contract, row, { observation: { kind: 'return_value' } });
  const id = first.verification_claim_id;
  apply(contract, row, { component });
  apply(contract, row, { target: { selector: { nesting: 0 } }, falsification: { module_path: 'module.mjs' } });
  assert.equal(contract.test_proofs.length, 1); assert.equal(contract.test_proofs[0].verification_claim_id, id);
  assert.deepEqual(contract.claims, []);
  assert.equal(first.observable_result.proposition_id, undefined);
  assert.equal(first.falsifiers[0].strategy, undefined);
  const definition = { case_id: 'case-one', component, target: { selector: { nesting: 0 } }, falsification: { module_path: 'module.mjs' } };
  const saved = projectAuthoredTestCase([definition], { case_id: 'case-one' })[0];
  assert.deepEqual(saved.component, component); assert.deepEqual(saved.target.selector, { nesting: 0 });
  assert.equal(saved.falsification.module_path, 'module.mjs');
  assert.deepEqual(deriveAuthoredTestCases({ contract, cases: [definition], buildTemplate: buildStableTestProofBindingTemplate }),
    deriveAuthoredTestCases({ contract, cases: [definition], buildTemplate: buildStableTestProofBindingTemplate }));

});
test('native case types refuse caller mechanics, malformed selectors and unknown selectors', () => {
  for (const input of [{ provider: 'forged' }, { target: { selector: { nesting: -1 } } },
    { component: { identity: component.identity } }, { target: { path: '../escape.mjs' } }]) assert.equal(validateNativeTestCase(input), false);
  assert.throws(() => apply(create(), { obligation_id: 'OBL-ONE' }, { verification_id: 'claim-unknown' }), { code: 'obligation_coverage_case_selector_invalid' });
});
test('a stated verification identity must name a claim the contract carries', () => {

  const claim = { claim_id: 'claim-one', kind: 'verification', verification_method: 'test_execution',
    proposition_id: 'prop-one', falsifying_proposition_id: 'prop-one-false' };
  const derive = (contract, definition) => deriveAuthoredTestCases({ contract, cases: [definition],
    buildTemplate: buildStableTestProofBindingTemplate });
  assert.throws(() => derive({ ...create(), claims: [claim] },
    { case_id: 'case-one', verification_id: 'claim-absent', observation: { kind: 'return_value' } }),
  error => error.code === 'obligation_coverage_case_verification_unlinked' &&
      error.details.case_id === 'case-one' && error.details.verification_claim_id === 'claim-absent' &&
      error.details.changed === false);

  assert.throws(() => derive({ ...create(), claims: [{ claim_id: 'claim-one', kind: 'behavior', proposition_id: 'prop-one' }] },
    { case_id: 'case-one', verification_id: 'claim-one' }),
  { code: 'obligation_coverage_case_verification_unlinked' });

  const derived = derive({ ...create(), claims: [claim] }, { case_id: 'case-one', verification_id: 'claim-one',
    observation: { kind: 'return_value' }, falsification: { module_path: 'module.mjs' } });
  assert.equal(derived.test_proofs[0].observable_result.proposition_id, 'prop-one');
  assert.equal(derived.test_proofs[0].falsifiers[0].proposition_id, 'prop-one-false');
});
test('component correction cannot retain an obsolete derived module path', () => {
  const contract = create(), row = { obligation_id: 'OBL-ONE' };
  const proof = apply(contract, row, { component });
  apply(contract, row, { component: { type_term: 'cc:runtime_component', identity: { kind: 'profile_term', term: 'abstract-component' } } });
  assert.equal(proof.system_under_test_boundary.runtime_module_path, undefined);
});
test('an explicitly declared provider falsification carries no support field into its mechanics', () => {

  const claim = { claim_id: 'claim-answers', kind: 'verification', verification_method: 'test_execution',
    proposition_id: 'prop-answers', falsifying_proposition_id: 'prop-answers-false' };
  const contract = { ...create(), claims: [claim] };
  const row = { obligation_id: 'OBL-ONE', controlled_contract_node_ids: ['claim-answers'] };
  const source = { type_term: 'cc:runtime_component', identity: { kind: 'repository_path', repository: 'fixture/repo', path: 'calc/answer.go' } };
  const target = { provider: { provider_id: 'launcher.go-test', provider_version: '1.0.0' },
    path: 'calc/answer_test.go', selector: { node_id: 'calc/answer_test.go::TestAnswer' } };
  const mechanics = { mutation_id: 'mutation-answers', mechanism: 'scalar_return_substitution',
    target_kind: 'function', module_path: 'calc/answer.go', function_name: 'Answer', replacement: 43 };
  const created = apply(contract, row, { component: source, observation: { kind: 'return_value' }, target,
    falsification: { support: 'provider', strategy: 'result_inversion', module_path: 'calc/answer.go', function_name: 'Answer', replacement: 43 } });
  assert.deepEqual(created.falsifiers[0].mutation, mechanics);
  assert.equal(validateCompleteNativeTestProof(created), true, JSON.stringify(validateCompleteNativeTestProof.errors));

  const amended = apply(contract, row, { falsification: { support: 'provider', replacement: 44 } });
  assert.deepEqual(amended.falsifiers[0].mutation, { ...mechanics, replacement: 44 });
  assert.equal(validateCompleteNativeTestProof(amended), true, JSON.stringify(validateCompleteNativeTestProof.errors));

  const moduleFault = apply(create(), { obligation_id: 'OBL-TWO' }, { target: { selector: { nesting: 0, name: 'answers' } },
    falsification: { support: 'provider', strategy: 'dependency_failure', module_path: 'module.mjs' } });
  assert.deepEqual(moduleFault.falsifiers[0].mutation, { mutation_id: moduleFault.falsifiers[0].mutation.mutation_id,
    mechanism: 'module_substitution', target_kind: 'module', module_path: 'module.mjs' });

  const definition = { case_id: 'case-answers', component: source, target, falsification: { support: 'provider',
    strategy: 'result_inversion', module_path: 'calc/answer.go', function_name: 'Answer', replacement: 43 } };
  const derived = deriveAuthoredTestCases({ contract: create(), cases: [definition], buildTemplate: buildStableTestProofBindingTemplate });
  assert.deepEqual(derived.test_proofs[0].falsifiers[0].mutation,
    { ...mechanics, mutation_id: derived.test_proofs[0].falsifiers[0].mutation.mutation_id });
});
