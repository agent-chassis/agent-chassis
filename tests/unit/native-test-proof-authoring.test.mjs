import assert from 'node:assert/strict';
import test from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { applyNativeTestProofCase, authorableNativeCaseTarget, projectAuthoredTestCase, deriveAuthoredTestCases,
  resolveNativeCaseTarget, storedNativeCaseTarget, validateCompleteNativeTestProof, validateNativeTestCase,
  NATIVE_TEST_CASE_AMENDMENT_SCHEMA, NATIVE_TEST_CASE_AUTHORING_GUIDANCE, NATIVE_TEST_CASE_SCHEMA } from '../../packages/controlled-contract/lib/native-test-proof-authoring.mjs';
import { TEST_PROOF_PROVIDER_AUTHORING_FACTS } from '../../packages/controlled-contract/lib/test-proof-provider-registry.mjs';
import { buildStableTestProofBindingTemplate } from '@agent-chassis/controlled-contract';
import { isClosedNodeTestTarget } from '../../packages/wiki-core/src/lib/work-record-test-proof-bindings.mjs';
import { CLOSED_NODE_TEST_TARGET_SCHEMA, isClosedNodeTestTarget as packageTargetPredicate } from
  '@agent-chassis/controlled-contract/test-proof';
import { CASE_COMPONENT_REQUEST_PATH, CASE_VERIFICATION_ASSOCIATION_REQUEST_PATH, CONTROLLED_CONTRACT_REQUIREMENT_GUIDANCE_LOCATIONS,
  CONTROLLED_CONTRACT_REQUIREMENT_INPUT_GUIDANCE, CONTROLLED_CONTRACT_REQUIREMENT_REQUEST_GUIDANCE_LOCATIONS } from '../../packages/wiki-core/src/lib/controlled-contract-tools.mjs';
const component = { type_term: 'cc:runtime_component', identity: { kind: 'repository_path', repository: 'fixture/repo', path: 'module.mjs' } };
const create = () => ({ references: [], claims: [], relations: [], test_proofs: [] });
const apply = (contract, row, caseInput) => applyNativeTestProofCase({ contract, row, caseInput, subject: 'WK-9999', buildTemplate: buildStableTestProofBindingTemplate });
test('unqualified target authoring agrees with the closed work-record target owner', () => {
  assert.equal(isClosedNodeTestTarget, packageTargetPredicate, 'the save owner uses the package predicate');
  assert.deepEqual(NATIVE_TEST_CASE_SCHEMA.properties.target.oneOf[0].properties.path, CLOSED_NODE_TEST_TARGET_SCHEMA);
  const invalid = ['test/add.test.js', 'test/add.test.cjs', './test.mjs', 'test//add.mjs',
    '@scope/test.mjs', '-test.mjs', '--test/test.mjs', 'test/./add.mjs', 'test/../add.mjs',
    '../test.mjs', '/test.mjs', 'test\\add.mjs', 'test/add.mjs\0', '',
    `${'a'.repeat(4093)}.mjs`];
  const valid = ['test/add.test.mjs', 'test.mjs', '.hidden/test.mjs', 'test/-add.mjs',
    'test/.../add.mjs', `${'a'.repeat(4092)}.mjs`];
  for (const [paths, expected] of [[invalid, false], [valid, true]]) for (const path of paths) {
    const input = { target: { path, selector: { name: 'add returns the sum' } } };
    assert.equal(isClosedNodeTestTarget(path), expected, path);
    assert.equal(validateNativeTestCase(input), expected, path);
  }

  for (const target of [{}, { selector: {} }, { selector: { name: 'sum' } },
    { path: 'test/add.test.mjs' }]) assert.equal(validateNativeTestCase({ target }), true);
  assert.deepEqual(NATIVE_TEST_CASE_AMENDMENT_SCHEMA.properties.target.oneOf[0],
    NATIVE_TEST_CASE_SCHEMA.properties.target.oneOf[0]);
  assert.equal(NATIVE_TEST_CASE_AUTHORING_GUIDANCE.target_variants.node_test.path_pattern,
    NATIVE_TEST_CASE_SCHEMA.properties.target.oneOf[0].properties.path.pattern);
});

test('closed execution targets leave general JavaScript source modules and qualified targets intact', () => {
  for (const path of ['src/index.js', 'src/index.cjs']) {
    const input = { component: { ...component, identity: { ...component.identity, path } },
      target: { path: 'test/add.test.mjs', selector: { name: 'add returns the sum' } },
      falsification: { support: 'provider', strategy: 'dependency_failure', module_path: path } };
    assert.equal(validateNativeTestCase(input), true, path);
    const derived = apply(create(), { obligation_id: 'OBL-ONE' }, input);
    assert.equal(derived.system_under_test_boundary.runtime_module_path, path);
    assert.equal(derived.falsifiers[0].mutation.module_path, path);
  }
  for (const path of ['test/add.test.js', 'test/add.test.cjs']) {
    const target = { provider: { provider_id: 'launcher.jest', provider_version: '1.0.0' },
      path, selector: { node_id: `${path}::["add returns the sum"]` } };
    assert.equal(validateNativeTestCase({ target }), true, path);
    assert.deepEqual(resolveNativeCaseTarget(target).selection, { title_path: ['add returns the sum'] });
  }
});
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

const nativeTarget = (providerId, path, selector) => ({ provider: { provider_id: providerId, provider_version: '1.0.0' },
  path, selector: { node_id: `${path}::${selector}` } });
const FAMILY_MISMATCHES = [
  ['ava_test_title', nativeTarget('launcher.ava', 'test/a.test.ts', '["case"]'), 'dependency_failure', ['result_inversion']],
  ['ava_test_title', nativeTarget('launcher.ava', 'test/a.test.ts', '["case"]'), 'forced_invocation', ['result_inversion']],
  ['pytest_node_id', nativeTarget('launcher.pytest', 'tests/test_calc.py', 'test_answer'), 'dependency_failure', ['result_inversion']],
  ['go_test_name', nativeTarget('launcher.go-test', 'calc/answer_test.go', 'TestAnswer'), 'dependency_failure', ['result_inversion']],
  ['node_test_name', { selector: { nesting: 0, name: 'answers' } }, 'result_inversion', ['dependency_failure', 'forced_invocation']]
];
const refusesFamily = (kind, strategy, strategies) => error => {
  assert.equal(error.code, 'obligation_coverage_case_falsification_unsupported');
  assert.deepEqual(error.details, { limb: 'mechanical_failure', changed: false, strategy, selector_kind: kind, strategies });
  return true;
};
test('an explicit target whose family does not implement the strategy is refused and no other family is substituted', () => {
  for (const [kind, target, strategy, strategies] of FAMILY_MISMATCHES) {
    assert.throws(() => apply(create(), { obligation_id: 'OBL-ONE' }, { target, falsification: { strategy } }),
      refusesFamily(kind, strategy, strategies), `${kind} ${strategy}`);
    assert.throws(() => deriveAuthoredTestCases({ contract: create(), cases: [{ case_id: 'case-one', target,
      falsification: { strategy } }], buildTemplate: buildStableTestProofBindingTemplate }),
    refusesFamily(kind, strategy, strategies), `derived ${kind} ${strategy}`);
  }
});
test('a strategy amendment the previously bound target family does not implement is refused', () => {
  for (const [kind, target, strategy, strategies] of FAMILY_MISMATCHES) {
    const contract = create(), row = { obligation_id: 'OBL-ONE' };

    apply(contract, row, { target, falsification: { strategy: strategies[0] } });
    assert.throws(() => apply(contract, row, { falsification: { strategy } }),
      refusesFamily(kind, strategy, strategies), `${kind} ${strategy}`);
  }
});
test('a strategy without a target family leaves its mechanics unresolved', () => {
  for (const strategy of NATIVE_TEST_CASE_SCHEMA.properties.falsification.properties.strategy.enum) {
    const proof = apply(create(), { obligation_id: 'OBL-ONE' }, { falsification: { strategy, module_path: 'module.mjs' } });
    assert.deepEqual(proof.falsifiers, [{ falsifier_id: proof.falsifiers[0].falsifier_id, strategy,
      mutation: { mutation_id: proof.falsifiers[0].mutation.mutation_id, module_path: 'module.mjs' } }], strategy);
    for (const key of ['test_selector', 'candidate_execution_provider', 'traversal_provider', 'prohibited_shortcuts',
      'falsification_provider']) assert.equal(proof[key], undefined, `${strategy} ${key}`);
  }
});
test('same-family authoring and an explicit no-falsifier declaration keep the target family', () => {
  const [, ava] = FAMILY_MISMATCHES[0];
  const supported = apply(create(), { obligation_id: 'OBL-ONE' }, { target: ava, falsification: { strategy: 'result_inversion' } });
  assert.equal(supported.candidate_execution_provider.provider_id, 'launcher.ava');
  assert.equal(supported.falsifiers[0].mutation.mechanism, 'scalar_return_substitution');
  const unsupported = apply(create(), { obligation_id: 'OBL-ONE' }, { target: ava, falsification: { support: 'registry_unsupported' } });
  assert.deepEqual(unsupported.falsifiers, []);
  assert.equal(unsupported.falsification_provider.mode, 'registry_unsupported');
  assert.equal(unsupported.candidate_execution_provider.provider_id, 'launcher.ava');
});

const observationGuideAgrees = (guide, ownerSchema, observableKinds) =>
  isDeepStrictEqual(guide?.input_schema, ownerSchema) &&
  isDeepStrictEqual(guide?.input_schema?.properties?.kind?.enum, observableKinds);
test('the observation guide projects the enforced observation schema and the published observable kinds', () => {
  const guide = NATIVE_TEST_CASE_AUTHORING_GUIDANCE.observation;
  const owner = NATIVE_TEST_CASE_SCHEMA.properties.observation;
  const kinds = CONTROLLED_CONTRACT_REQUIREMENT_INPUT_GUIDANCE.native_runtime_test_vocabulary.observable_kinds;
  assert.equal(guide?.field, 'obligations[].case.observation');
  assert.equal(observationGuideAgrees(guide, owner, kinds), true, JSON.stringify(guide));
  assert.equal(guide.input_schema.additionalProperties, false);
  assert.equal(Object.hasOwn(guide.input_schema, 'required'), false, 'guidance adds no requiredness');

  assert.deepEqual(NATIVE_TEST_CASE_AMENDMENT_SCHEMA.properties.observation, owner);

  const altered = mutate => { const copy = structuredClone(guide); mutate(copy.input_schema); return copy; };
  for (const [label, copy] of [
    ['a dropped kind', altered(schema => { schema.properties.kind.enum = schema.properties.kind.enum.slice(1); })],
    ['an invented kind', altered(schema => { schema.properties.kind.enum.push('assertion_text'); })],
    ['added requiredness', altered(schema => { schema.required = ['kind']; })],
    ['an extra-member allowance', altered(schema => { schema.additionalProperties = true; })]]) {
    assert.equal(observationGuideAgrees(copy, owner, kinds), false, label);
  }

  assert.notEqual(guide.input_schema, owner);
  assert.equal(Object.isFrozen(guide.input_schema), true);
  assert.equal(Object.isFrozen(owner), false);
  assert.equal(Object.isFrozen(owner.properties.kind.enum), false);

  assert.match(guide.purpose, /object/u);
  assert.match(guide.purpose, /prose/u);
  for (const kind of kinds) assert.equal(guide.purpose.includes(kind), false, `${kind} is not prescribed`);
});
test('the enforced observation shape accepts each published kind and refuses prose, unknown kinds, extra members and null', () => {
  const kinds = NATIVE_TEST_CASE_AUTHORING_GUIDANCE.observation.input_schema.properties.kind.enum;
  for (const kind of ['return_value', 'state_transition']) {
    assert.ok(kinds.includes(kind));
    assert.equal(validateNativeTestCase({ observation: { kind } }), true, kind);
  }
  for (const observation of ['returns the lower bound for a value below it', { kind: 'assertion_text' },
    { kind: 'return_value', expected: 'the lower bound' }, null]) {
    assert.equal(validateNativeTestCase({ observation }), false, JSON.stringify(observation));
  }

  assert.equal(validateNativeTestCase({}), true);
  assert.equal(validateNativeTestCase({ observation: {} }), true);
});
test('authority and the request-location registry route obligations[].case.observation to its own guide', () => {
  const authority = CONTROLLED_CONTRACT_REQUIREMENT_INPUT_GUIDANCE.authority.case_observation;
  assert.deepEqual(authority?.arguments?.input_contract, { kind: 'guidance', path: ['case_authoring', 'observation'] });
  assert.deepEqual(CONTROLLED_CONTRACT_REQUIREMENT_GUIDANCE_LOCATIONS.case_observation, ['case_authoring', 'observation']);
  const bound = path => CONTROLLED_CONTRACT_REQUIREMENT_REQUEST_GUIDANCE_LOCATIONS.find(location =>
    isDeepStrictEqual([...location.path], path));
  assert.deepEqual([...bound(['obligations', '[]', 'case', 'observation'])?.guidance_path ?? []],
    ['case_authoring', 'observation']);

  assert.deepEqual([...CASE_VERIFICATION_ASSOCIATION_REQUEST_PATH], ['obligations', '[]', 'case', 'verification_id']);
  assert.deepEqual([...CASE_COMPONENT_REQUEST_PATH], ['obligations', '[]', 'case', 'component']);
  assert.deepEqual([...bound([...CASE_VERIFICATION_ASSOCIATION_REQUEST_PATH]).guidance_path],
    ['case_authoring', 'verification_association']);
  assert.deepEqual([...bound([...CASE_COMPONENT_REQUEST_PATH]).guidance_path], ['case_authoring', 'component']);

  for (const path of [['obligations', '[]', 'case'], ['obligations', '[]', 'case', 'target'], ['obligations', '[]']]) {
    assert.equal(bound(path), undefined, path.join('.'));
  }
});

test('structured authoring and stored native case validation share provider meaning without sharing wire shape', () => {
  const jest = { provider_id: 'launcher.jest', provider_version: '1.0.0' };
  const titles = ['clamp', 'says "hi" \\ caf\u00e9'];
  const authored = { provider: jest, path: 'src/clamp.test.ts', selector: { title_path: titles } };
  const stored = storedNativeCaseTarget(authored);
  assert.deepEqual(stored, { provider: jest, path: 'src/clamp.test.ts',
    selector: { node_id: `src/clamp.test.ts::${JSON.stringify(titles)}` } });
  assert.deepEqual(authored.selector, { title_path: titles }, 'the authored input is not changed in place');

  const nativeArm = schema => schema.properties.target.oneOf.find(arm => arm.properties.provider !== undefined);
  assert.deepEqual(Object.keys(nativeArm(NATIVE_TEST_CASE_SCHEMA).properties.selector.properties), ['node_id']);
  assert.deepEqual(nativeArm(NATIVE_TEST_CASE_SCHEMA).properties.selector.required, ['node_id']);
  assert.deepEqual(Object.keys(nativeArm(NATIVE_TEST_CASE_AMENDMENT_SCHEMA).properties.selector.properties).sort(),
    ['node_id', 'title_path']);
  assert.equal(NATIVE_TEST_CASE_SCHEMA.properties.target.oneOf.length, 2);
  assert.equal(NATIVE_TEST_CASE_AMENDMENT_SCHEMA.properties.target.oneOf.length, 2);
  assert.deepEqual(NATIVE_TEST_CASE_AMENDMENT_SCHEMA.properties.target.oneOf[0],
    NATIVE_TEST_CASE_SCHEMA.properties.target.oneOf[0], 'partial node:test authoring keeps its arm');
  assert.equal(validateNativeTestCase({ target: authored }), false);
  assert.equal(validateNativeTestCase({ target: stored }), true);

  assert.deepEqual(resolveNativeCaseTarget(stored).selection, { title_path: titles });
  assert.deepEqual(authorableNativeCaseTarget({ ...stored, owner_unit: 'WK-9999' }), { ...authored, owner_unit: 'WK-9999' });
  assert.deepEqual(storedNativeCaseTarget(authorableNativeCaseTarget(stored)), stored, 'read back and saved again is the same stored value');

  const definition = { case_id: 'case-clamp', target: stored };
  const derived = deriveAuthoredTestCases({ contract: create(), cases: [definition], buildTemplate: buildStableTestProofBindingTemplate });
  assert.deepEqual(derived.test_proofs[0].test_selector, { ...jest, node_id: stored.selector.node_id });
  assert.deepEqual(projectAuthoredTestCase([definition], { case_id: 'case-clamp' })[0].target, stored);
  assert.throws(() => deriveAuthoredTestCases({ contract: create(), cases: [{ case_id: 'case-clamp', target: authored }],
    buildTemplate: buildStableTestProofBindingTemplate }), { code: 'obligation_coverage_case_invalid' });

  const ava = { provider: { provider_id: 'launcher.ava', provider_version: '1.0.0' }, path: 'test/a.test.ts' };
  const form = NATIVE_TEST_CASE_AUTHORING_GUIDANCE.families.ava.title_path_form;
  assert.equal(form, TEST_PROOF_PROVIDER_AUTHORING_FACTS.find(family => family.family_id === 'ava').selector.authored.form);
  assert.throws(() => storedNativeCaseTarget({ ...ava, selector: { title_path: ['suite', 'case'] } }), error =>
    error.code === 'obligation_coverage_case_target_invalid' && error.details.changed === false &&
    error.details.field === 'obligations[].case.target.selector.title_path' && error.details.expected === form &&
    !/node_id|JSON/u.test(JSON.stringify([error.message, error.details.expected, error.details.correction])));
  assert.throws(() => resolveNativeCaseTarget({ ...ava, selector: { node_id: 'test/a.test.ts::["suite","case"]' } }),
    { code: 'obligation_coverage_case_target_invalid' });
  assert.deepEqual(storedNativeCaseTarget({ ...ava, selector: { title_path: ['case'] } }).selector,
    { node_id: 'test/a.test.ts::["case"]' });

  assert.throws(() => storedNativeCaseTarget({ ...ava, selector: { node_id: 'test/a.test.ts::["case"]' } }), error =>
    error.code === 'obligation_coverage_case_target_invalid' &&
    error.details.field === 'obligations[].case.target.selector.node_id' &&
    error.details.correction_field === 'obligations[].case.target.selector.title_path' &&
    error.details.correction.includes('selector.title_path'));

  const go = { provider: { provider_id: 'launcher.go-test', provider_version: '1.0.0' },
    path: 'calc/answer_test.go', selector: { node_id: 'calc/answer_test.go::TestAnswer' } };
  assert.deepEqual(storedNativeCaseTarget(go), go);
  assert.deepEqual(authorableNativeCaseTarget(go), go);
  for (const partial of [{ selector: { nesting: 0 } }, { path: 'tests/a.test.mjs', selector: { name: 'answers', nesting: 0 } }]) {
    assert.deepEqual(storedNativeCaseTarget(partial), partial);
    assert.deepEqual(authorableNativeCaseTarget(partial), partial);
  }
});
