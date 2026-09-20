import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveAuthoredTestCases, emptyCaseContract, projectAuthoredTestCase,
  buildStableTestProofBindingTemplate, NATIVE_TEST_CASE_SCHEMA,
  NATIVE_TEST_CASE_AMENDMENT_SCHEMA, validateObligationCoverageDraft,
  validateStableTestProofContract } from '@agent-chassis/controlled-contract';
const derive = (contract, cases) => deriveAuthoredTestCases({ contract, cases, buildTemplate: buildStableTestProofBindingTemplate });
const source = cases => ({ schema_version: 'controlled-contract-obligation-coverage.v3', wk_id: 'WK-9999', focus: null,
  selected_unit: null, obligations: [{ obligation_id: 'OBL-ONE', case_id: 'case-one' }], cases });

const verificationClaim = id => ({ claim_id: id, kind: 'verification', verification_method: 'test_execution',
  proposition_id: `prop-${id}`, falsifying_proposition_id: `prop-${id}-false` });
const carrying = (...ids) => { const contract = emptyCaseContract();
  contract.claims.push(...ids.map(verificationClaim)); return contract; };

test('canonical case schema keeps partial meaning once and target paths with their incumbent owner', () => {
  const definition = { case_id: 'case-one', component: { reference_id: 'ref-component' }, target: { owner_unit: 'WK-9999' } };
  assert.equal(validateObligationCoverageDraft(source([definition])).valid, true);
  assert.equal(validateObligationCoverageDraft(source([definition, definition])).valid, false);
  assert.equal(validateObligationCoverageDraft({ ...source([definition]), selected_unit: 'SLICE-001' }).valid, false);
  assert.equal(validateObligationCoverageDraft(source([{ ...definition, target: { path: 'copy.mjs' } }])).valid, false);
  assert.equal(validateObligationCoverageDraft(source([{ case_id: 'case-one',
    falsification: { strategy: null } }])).valid, false,
  'saved case definitions remain non-nullable');
});

test('case amendment schema derives patch-only nulls from strict native field definitions', () => {
  const savedFalsification = NATIVE_TEST_CASE_SCHEMA.properties.falsification;
  const amendmentFalsification = NATIVE_TEST_CASE_AMENDMENT_SCHEMA.properties.falsification;
  const amendmentObject = amendmentFalsification.anyOf.find(value => value.type === 'object');
  const nullable = node => node.anyOf?.some(value => value.type === 'null') === true;
  assert.equal(nullable(amendmentFalsification), true);
  for (const name of ['strategy', 'module_path', 'entry_export', 'operation']) {
    assert.equal(nullable(amendmentObject.properties[name]), true, name);
    assert.equal(nullable(savedFalsification.properties[name]), false, name);
  }
  const operation = amendmentObject.properties.operation.anyOf.find(value => value.type === 'object');
  assert.equal(nullable(operation.properties.module_path), true);
  assert.equal(nullable(operation.properties.export_name), true);
  for (const name of ['case_id', 'verification_id', 'component', 'target', 'observation']) {
    assert.equal(nullable(NATIVE_TEST_CASE_AMENDMENT_SCHEMA.properties[name]), false, name);
  }
});

test('derivation is deterministic and cannot fill missing authored fields from native bindings', () => {

  const definition = { case_id: 'case-one', verification_id: 'claim-one', observation: { kind: 'return_value' },
    falsification: { module_path: 'module.mjs' } };
  const canonical = carrying('claim-one');
  const first = derive(canonical, [definition]);

  assert.equal(first.test_proofs[0].observable_result.proposition_id, 'prop-claim-one');
  assert.equal(first.test_proofs[0].falsifiers[0].proposition_id, 'prop-claim-one-false');
  first.test_proofs[0].test_selector = { name: 'must never be borrowed', nesting: 0 };
  const next = derive(first, [definition]);
  assert.equal(next.test_proofs[0].test_selector, undefined);
  assert.deepEqual(next, derive(canonical, [definition]));
  assert.equal(validateStableTestProofContract(next).valid, false);
  assert.deepEqual(projectAuthoredTestCase([], { controlled_contract_node_ids: [next.test_proofs[0].verification_claim_id] }), []);
});

test('case revision attributes referenced facts and distinct cases do not share mutable inline values', () => {
  const definition = { case_id: 'case-one', component: { reference_id: 'ref-component' }, target: { owner_unit: 'WK-9999' } };
  const canonical = emptyCaseContract();
  canonical.references.push({ reference_id: 'ref-component', type_term: 'cc:runtime_component', identity: { kind: 'profile_term', term: 'one' } });
  const row = { case_id: 'case-one' };
  const original = projectAuthoredTestCase([definition], row, { references: canonical.references })[0];
  canonical.references[0].identity.term = 'corrected';
  const corrected = projectAuthoredTestCase([definition], row, { references: canonical.references })[0];
  assert.notEqual(corrected.case_revision, original.case_revision);
  assert.deepEqual(corrected.component, { reference_id: 'ref-component' });
  const component = { type_term: 'cc:runtime_component', identity: { kind: 'profile_term', term: 'same' } };
  const projected = derive(emptyCaseContract(), [{ case_id: 'case-a', component },
    { case_id: 'case-b', component: { ...component, type_term: 'cc:test' } }]);
  assert.equal(projected.references.length, 2);
  assert.deepEqual(new Set(projected.references.map(reference => reference.type_term)), new Set(['cc:runtime_component', 'cc:test']));
});

test('an unfinished draft keeps its placeholder and a stated absent identity is refused', () => {

  const draft = derive(emptyCaseContract(), [{ case_id: 'case-one', observation: { kind: 'return_value' } }]);
  assert.equal(draft.test_proofs.length, 1);
  assert.equal(draft.test_proofs[0].observable_result.proposition_id, undefined);
  assert.equal(validateStableTestProofContract(draft).valid, false);

  assert.throws(() => derive(carrying('claim-one'), [{ case_id: 'case-one', verification_id: 'claim-absent' }]),
    error => error.code === 'obligation_coverage_case_verification_unlinked' &&
      error.details.case_id === 'case-one' && error.details.verification_claim_id === 'claim-absent');
});
