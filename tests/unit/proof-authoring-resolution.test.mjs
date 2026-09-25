import test from 'node:test';
import assert from 'node:assert/strict';
import { pinProofSelection, loadPinnedProofSelection } from '@agent-chassis/controlled-contract';
import { resolveProofAuthoring } from '@agent-chassis/controlled-contract/proof-authoring';
import { loadCurrentParameterPopulation, validatePackParameterContract, describePackParameters } from '@agent-chassis/controlled-contract/pack-parameters';
import { canonicalDigest } from '../../packages/controlled-contract/lib/deterministic-projection-primitives.mjs';
const context = { source_digest: `sha256:${'a'.repeat(64)}` };
const SELECTED_FAMILIES = Object.freeze([
  'proof.authentication.direct-source-provenance',
  'proof.operation.forbidden-noninvocation',
  'proof.readiness.before-success',
  'proof.result-shape.conformance',
  'proof.verification.test-validity'
]);
const durable = name => ({ kind: 'durable_id', domain: 'wk2567-fixture', value: name });
const parametersFor = contract => Object.fromEntries(contract.parameters.map(parameter =>
  [parameter.name, parameter.value_kind === 'complete_population'
    ? [durable(parameter.name)] : durable(parameter.name)]));
const pin = pack => ({ proof_name: pack.profile.profile_id, proof_version: pack.profile.profile_version,
  profile_digest: pack.profile_digest, parameter_contract_digest: pack.parameter_contract_digest, admission_digest: pack.admission_digest });
const source = packs => ({ schema_version: 'controlled-contract-obligation-coverage.v3', wk_id: 'WK-0001', selected_unit: null, focus: null,
  obligations: packs.map((pack, i) => ({ obligation_id: `OBL-${i}`, selection: { ...pin(pack), parameters: {} } })) });
test('every current catalog and evaluator descriptor retains owner constraints and unavailable construction', async () => {
  const population = await loadCurrentParameterPopulation();
  const { readProofPackCatalog } = await import('@agent-chassis/controlled-contract/proof-packs');
  const { exactProofEvaluatorIdentities } = await import('../../packages/controlled-contract/lib/proof-evaluator-registry.mjs');
  const expected = new Set([...(await readProofPackCatalog()).packs, ...exactProofEvaluatorIdentities()]
    .map(row => `${row.profile_id}@${row.profile_version}`));
  assert.deepEqual(new Set(population.map(({ contract }) => `${contract.profile_id}@${contract.profile_version}`)), expected);
  const result = await resolveProofAuthoring(source(population.map(p => p.pack)), context);
  assert.equal(result.rows.length, population.length); assert.equal(result.definition_identities.length, population.length);
  assert.equal(result.counts.valid, 0); assert.equal(result.mapping.obligations.length, population.length);
  for (const { contract } of population) {
    const detail = describePackParameters(contract);
    assert.equal(detail.total, detail.returned); assert.equal(detail.omitted, 0);
    const row = result.rows.find(r => r.definition.proof_name === contract.profile_id && r.definition.proof_version === contract.profile_version);
    assert.ok(row.diagnostics.some(d => d.code === 'obligation_coverage_dependencies_unresolved'));
    assert.ok(row.diagnostics.some(d => ['obligation_coverage_construction_unavailable', 'obligation_coverage_construction_sources_missing'].includes(d.code)));
  }
  assert.equal(Object.isFrozen(result.dependencies), true);
});
test('a saved selection of the deactivated write-confinement proof reports its unavailable definition without substitution or credit', async () => {
  const { loadExactAdmittedProofPack, readProofPackCatalog } =
    await import('../../packages/controlled-contract/lib/admitted-proof-packs.mjs');
  const { discoverProofIntents } = await import('@agent-chassis/controlled-contract');
  const proofName = 'proof.scope.write-confinement';

  const savedPin = { proof_name: proofName, proof_version: '4.0.0',
    profile_digest: '5eaea9dd397823f7cf906060d658f3ce858fde930c98e730d448c8a8e6f3cd92',
    parameter_contract_digest: 'd328351786abf903601a10d65e9a6aed72307128ce8c6700e393930f07f396aa',
    admission_digest: '1f288b3dc8369fda7d68e2e4da0860d549a6e25a5436c88e3fad281ba3fb0507' };
  assert.equal((await readProofPackCatalog()).packs.some(pack => pack.profile_id === proofName), false);
  await assert.rejects(loadExactAdmittedProofPack({ profileId: proofName, profileVersion: '4.0.0' }),
    { code: 'proof_pack_not_found', details: { profile_id: proofName } });
  assert.throws(() => discoverProofIntents({ proof_name: proofName }), { code: 'proof_discovery_identity_unknown' });
  assert.equal(discoverProofIntents({ query: 'write confinement' }).candidates
    .some(candidate => candidate.proof_name === proofName), false);

  const saved = { schema_version: 'controlled-contract-obligation-coverage.v3', wk_id: 'WK-0001', selected_unit: null,
    focus: null, obligations: [{ obligation_id: 'OBL-SCOPE', statement: 'Writes stay inside the declared scope',
      selection: { ...savedPin, parameters: { execution: durable('execution') } } }] };
  const before = structuredClone(saved);
  const result = await resolveProofAuthoring(saved, context);
  assert.deepEqual(saved, before);
  assert.equal(result.status, 'invalid');
  assert.equal(result.mapping, null);
  assert.deepEqual(result.definition_identities, []);

  assert.deepEqual([result.counts.obligations, result.counts.valid,
    result.counts.invalid, result.counts.resolved_selections], [1, 0, 1, 0]);
  const [row] = result.rows;
  assert.deepEqual([row.obligation_id, row.status, row.semantic_status, row.disposition],
    ['OBL-SCOPE', 'valid', 'valid', 'selected']);
  assert.equal(result.semantic_status, 'valid');
  assert.deepEqual(row.definition, savedPin);
  assert.equal(row.selected_proof_assessment, null);
  assert.deepEqual(row.diagnostics.map(entry => [entry.code, entry.path, entry.profile_id]),
    [['proof_pack_not_found', '/obligations/0/selection', proofName]]);

  await assert.rejects(pinProofSelection(proofName), { code: 'obligation_coverage_proof_name_unknown',
    details: { limb: 'mechanical_failure', changed: false, phase: 'request', field: 'proof_name', proof_name: proofName } });
});
test('declared dependency sharing preserves output occurrences and detects exact cycles', async () => {
  const population = (await loadCurrentParameterPopulation()).slice(0, 2), [a, b] = population;
  const recipe = (from, to) => ({ profile_id: to.contract.profile_id, profile_version: to.contract.profile_version,
    profile_digest: to.contract.profile_digest, applicability_refs: [], input_mappings: to.contract.parameters.filter(p => p.source.policy === 'configurable')
      .map(p => ({ input: p.name, parameter: from.contract.parameters[0].name })), output_uses: [from.contract.role_producers[0].role, from.contract.role_producers[0].role] });
  const contracts = new Map();
  const make = (entry, packs) => validatePackParameterContract({ ...structuredClone(entry.contract), dependencies: { state: 'complete', packs } }, entry.pack.profile);
  contracts.set(a.contract.profile_id, make(a, [recipe(a, b)])); contracts.set(b.contract.profile_id, make(b, []));
  const owners = { loadExact: async ({ profileId }) => population.find(p => p.contract.profile_id === profileId).pack,
    loadContract: pack => contracts.get(pack.profile.profile_id) };
  const s = source([a.pack, a.pack]);
  const r = await resolveProofAuthoring(s, context, owners);
  assert.equal(r.dependencies.length, 2); assert.equal(r.rows[0].resolved_identity, r.rows[1].resolved_identity);
  assert.equal(r.dependencies[0].dependencies[0].output_uses.length, 2);
  contracts.set(b.contract.profile_id, make(b, [recipe(b, a)]));
  const cyclic = await resolveProofAuthoring(s, context, owners);
  assert.ok(cyclic.rows.every(row => row.diagnostics.some(d => d.code === 'pack_parameter_dependency_cycle')));
});

test('a real current selection resolves without locator, selector, nodes or plans and retains real gaps', async () => {
  const selection = { ...await pinProofSelection('proof.verification.test-validity'), parameters: {} };
  const draft = { ...source([]), obligations: [{ obligation_id: 'OBL-SELECTED', statement: 'Preserve the authored association', selection }] };
  const result = await resolveProofAuthoring(draft, context);
  assert.deepEqual(result.mapping.obligations[0].selection, selection);
  assert.equal(result.counts.resolved_selections, 1);
  assert.equal(result.status, 'invalid');
  const codes = result.rows[0].diagnostics.map(d => d.code);
  assert.ok(codes.includes('obligation_coverage_parameter_missing'));
  assert.ok(codes.includes('obligation_coverage_construction_unavailable'));
  assert.ok(codes.includes('obligation_coverage_dependencies_unresolved'));
  assert.ok(!codes.some(code => /mapping_unavailable|nodes_missing|mechanism_missing/.test(code)));
  assert.ok(!('proof' in result.mapping.obligations[0]));
  const stale = structuredClone(draft); stale.obligations[0].selection.proof_version = '999.0.0';
  const invalid = await resolveProofAuthoring(stale, context);
  assert.equal(invalid.mapping, null);
  let ownerCode;
  await assert.rejects(loadPinnedProofSelection(stale.obligations[0].selection), error => { ownerCode = error.code; return true; });
  assert.ok(invalid.rows[0].diagnostics.some(d => d.code === ownerCode));
  const empty = await resolveProofAuthoring(source([]), context);
  assert.equal(empty.mapping, null); assert.equal(empty.status, 'invalid');
});

test('omitted configurable route parameters do not invalidate authored meaning', async () => {
  const selected = (await loadCurrentParameterPopulation()).find(({ contract }) =>
    contract.parameters.some(parameter => parameter.source.policy === 'configurable'));
  assert.ok(selected);
  const draft = { ...source([]), obligations: [{
    obligation_id: 'OBL-CONFIGURABLE-OMITTED',
    statement: 'Preserve authored meaning while execution inputs remain omitted.',
    selection: { ...pin(selected.pack), parameters: {} }
  }] };
  const result = await resolveProofAuthoring(draft, context);
  const [row] = result.rows;
  const missing = row.diagnostics.filter(diagnostic =>
    diagnostic.code === 'obligation_coverage_parameter_missing' &&
    diagnostic.problem?.cause?.source_policy?.policy === 'configurable');
  assert.ok(missing.length > 0);
  assert.deepEqual([row.semantic_status, row.authoring_status, row.status],
    ['valid', 'complete', 'valid']);
  assert.equal(row.selected_proof_assessment.readiness_status, 'incomplete');
  assert.equal(row.selected_proof_assessment.prevents_selected_route, true);
  assert.equal(result.status, 'invalid', 'the strict executable map remains unresolved');
});

test('WK-2567 unknown authored node references share set-level upsert recovery', async () => {
  const definition = (await loadCurrentParameterPopulation()).find(({ contract }) =>
    contract.profile_id === 'proof.atomicity.failure-boundary');
  assert.ok(definition);
  const obligations = ['A', 'B'].map(suffix => ({
    obligation_id: `OBL-NODE-${suffix}`,
    statement: `Correct authored node ${suffix}`,
    controlled_contract_node_ids: [`claim-${'f'.repeat(40)}`],
    selection: { ...pin(definition.pack),
      parameters: parametersFor(definition.contract) }
  }));
  const result = await resolveProofAuthoring({ ...source([]), obligations },
    { ...context, contract_nodes: [] });
  const unknown = result.rows.map(row => row.diagnostics.find(diagnostic =>
    diagnostic.code === 'obligation_coverage_node_unknown'));
  assert.ok(unknown.every(Boolean));
  assert.ok(unknown.every(diagnostic =>
    diagnostic.problem.category === 'author_input' &&
    diagnostic.problem.route_assessment.stage === 'authored_inputs' &&
    diagnostic.problem.route_assessment.recovery.status === 'operator_action'));
  assert.equal(unknown[0].problem.route_assessment.recovery.operator_action,
    unknown[1].problem.route_assessment.recovery.operator_action);
  assert.doesNotMatch(unknown[0].problem.route_assessment.recovery.operator_action,
    /OBL-NODE/u);
});

test('WK-2567 exact selected definitions own test and non-test prerequisites', async () => {
  const population = (await loadCurrentParameterPopulation()).filter(({ contract }) =>
    SELECTED_FAMILIES.includes(contract.profile_id));
  assert.deepEqual(population.map(({ contract }) => contract.profile_id),
    [...SELECTED_FAMILIES].sort());
  const obligations = population.map(({ pack, contract }, index) => ({
    obligation_id: `OBL-${String(index).padStart(2, '0')}`,
    statement: `Exercise ${contract.profile_id}`,
    selection: { ...pin(pack), parameters: contract.profile_id ===
      'proof.verification.test-validity' ? {} : parametersFor(contract) }
  }));
  const result = await resolveProofAuthoring({ ...source([]), obligations }, context);
  const testRow = result.rows.find(row => row.definition.proof_name ===
    'proof.verification.test-validity');
  const nonTestRows = result.rows.filter(row => row !== testRow);
  assert.equal(testRow.selected_proof_assessment.execution_family,
    'provider_bound_test_validity');
  assert.deepEqual(testRow.selected_proof_assessment.requirements, {
    authored_case: 'required', native_test_binding: 'required',
    declared_test_target: 'required', test_execution_evidence: 'required'
  });
  assert.equal(testRow.selected_proof_assessment.stages.authored_inputs.status,
    'incomplete');
  assert.ok(testRow.diagnostics.some(diagnostic =>
    diagnostic.code === 'obligation_coverage_parameter_missing'));
  for (const row of nonTestRows) {
    assert.equal(row.input_status, 'valid', row.definition.proof_name);
    assert.equal(row.selected_proof_assessment.execution_family,
      'definition_evaluation');
    assert.deepEqual(row.selected_proof_assessment.requirements, {
      authored_case: 'not_applicable', native_test_binding: 'not_applicable',
      declared_test_target: 'not_applicable',
      test_execution_evidence: 'not_applicable'
    });
    assert.equal(row.selected_proof_assessment.authored_case.status,
      'not_applicable');
    assert.equal(row.selected_proof_assessment.native_test_binding.status,
      'not_applicable');
    assert.equal(row.selected_proof_assessment.declared_test_target.status,
      'not_applicable');
    assert.equal(row.selected_proof_assessment.stages.authored_inputs.status,
      'complete');
    assert.equal(row.selected_proof_assessment.stages.system_capability.status,
      'unavailable');
    assert.deepEqual(row.selected_proof_assessment.stages.system_capability
      .diagnostic_codes, [
      'obligation_coverage_construction_unavailable',
      'obligation_coverage_dependencies_unresolved'
    ]);

    assert.deepEqual(row.selected_proof_assessment.stages.system_capability.blockers
      .map(blocker => [blocker.owner_code, blocker.effect, blocker.recovery.status]), [
      ['obligation_coverage_construction_unavailable', 'blocking', 'unavailable'],
      ['obligation_coverage_dependencies_unresolved', 'blocking', 'unavailable']
    ], row.definition.proof_name);
    assert.equal(row.selected_proof_assessment.readiness_status, 'incomplete');
  }
  assert.deepEqual(await resolveProofAuthoring({ ...source([]), obligations }, context),
    result, 'the same source and exact definitions reproduce stable identities');
  const incompatible = structuredClone(obligations);
  const firstParameter = Object.keys(incompatible[0].selection.parameters)[0];
  incompatible[0].selection.parameters[firstParameter] = 42;
  const rejected = await resolveProofAuthoring({ ...source([]),
    obligations: incompatible }, context);
  const rejectedRow = rejected.rows[0];
  assert.equal(rejectedRow.selected_proof_assessment.stages.authored_inputs.status,
    'incomplete');
  assert.equal(rejectedRow.selected_proof_assessment.stages.system_capability.status,
    'unavailable');
  assert.ok(rejectedRow.diagnostics.some(diagnostic =>
    diagnostic.problem.category === 'author_input'));
  assert.ok(rejectedRow.diagnostics.some(diagnostic =>
    diagnostic.problem.category === 'system_capability'));
});

async function completeTestRoutes(count) {
  const population = (await loadCurrentParameterPopulation()).find(({ contract }) =>
    contract.profile_id === 'proof.verification.test-validity');
  const referenceId = `ref-${canonicalDigest('wk2553-component').slice(0, 40)}`;
  const suiteId = `ref-${canonicalDigest('wk2553-suite').slice(0, 40)}`;
  const contractReferences = [{ reference_id: referenceId,
    type_term: 'cc:runtime_component', identity: { kind: 'profile_term',
      term: 'component-wk2553' } }, { reference_id: suiteId,
    type_term: 'cc:test', identity: { kind: 'profile_term',
      term: 'suite-wk2553' } }];
  const obligations = [], caseDefinitions = [], testDeclarations = [];
  const executableDeclarations = [];
  for (let index = 0; index < count; index++) {
    const caseId = `case-wk2553-${index}`;
    const verificationId = `claim-${canonicalDigest({ verification: index }).slice(0, 40)}`;
    const propositionId = `prop-${canonicalDigest({ proposition: index }).slice(0, 40)}`;
    const failureId = `prop-${canonicalDigest({ failure: index }).slice(0, 40)}`;
    const testProofId = `test-proof-${canonicalDigest({ case_id: caseId }).slice(0, 40)}`;
    obligations.push({ obligation_id: `OBL-WK2553-${index}`,
      statement: `Exercise selected route ${index}`, case_id: caseId,
      selection: { ...pin(population.pack), parameters: {} } });
    caseDefinitions.push({ case_id: caseId, verification_id: verificationId });
    const binding = { test_proof_id: testProofId,
      verification_claim_id: verificationId,
      system_under_test_boundary: { boundary_id: `sut-boundary-route-${index}`,
        kind: 'module', runtime_module_path: `tests/wk2553-${index}.test.mjs`,
        subject_reference_ids: [referenceId] },
      observable_result: { observable_id: `observable-${index}`,
        kind: 'return_value', proposition_id: propositionId },
      candidate_execution_provider: { provider_id: 'launcher.node-test',
        provider_version: '1.0.0', capability: 'candidate_execution' },
      falsifiers: [{ falsifier_id: `falsifier-${index}`,
        strategy: 'dependency_failure', proposition_id: failureId,
        expected_outcome: 'verification_fails', mutation: {
          mutation_id: `mutation-${index}`, mechanism: 'module_substitution',
          target_kind: 'module', module_path: `dependency-${index}.mjs` },
        execution_provider: { provider_id: 'launcher.node-test-module-fault',
          provider_version: '2.0.0', capability: 'falsifier_execution' } }],
      traversal_provider: { mode: 'provider',
        provider_id: 'launcher.node-test-v8-coverage', provider_version: '1.0.0',
        capability: 'boundary_traversal', boundary_kind: 'module',
        observation_mechanism: 'node_test_v8_coverage',
        observation_seam: 'node_test_structured_assertion',
        evidence_artifact_type: 'boundary_trace' },
      test_selector: { name: `selected route ${index}`, nesting: 0 },
      prohibited_shortcuts: ['source_text_inspection'] };
    testDeclarations.push(binding);
    executableDeclarations.push({ verification_ids: [verificationId],
      target: `tests/wk2553-${index}.test.mjs` });
  }
  const selectedContext = { ...context, case_definitions: caseDefinitions,
    contract_relations: [], test_declarations: testDeclarations,
    contract_references: contractReferences,
    test_target_declarations: { status: 'valid', executable_declarations: executableDeclarations } };
  return { population, obligations, testDeclarations, executableDeclarations, selectedContext };
}

test('WK-2567 eight complete selected test routes retain two generic limitations without blocking', async () => {
  const { population, obligations, testDeclarations, executableDeclarations, selectedContext } =
    await completeTestRoutes(8);
  const result = await resolveProofAuthoring({ ...source([]), obligations }, selectedContext);
  assert.equal(result.status, 'valid', JSON.stringify(result.rows[0].diagnostics));
  assert.deepEqual(result.counts, { obligations: 8, resolved_selections: 8,
    valid: 8, invalid: 0, explicit_gaps: 0, unselected: 0,
    dependency_nodes: 8 });
  assert.equal(result.mapping.obligations.length, 8);
  const retained = result.rows.flatMap(row => row.diagnostics);
  assert.equal(retained.length, 16);
  assert.deepEqual([...new Set(retained.map(row => row.code))].sort(), [
    'obligation_coverage_construction_unavailable',
    'obligation_coverage_dependencies_unresolved'
  ]);
  assert.ok(retained.every(row =>
    row.problem.route_assessment.effect === 'nonblocking' &&
    row.problem.route_assessment.recovery.status === 'not_required'));
  assert.ok(result.rows.every(row =>
    row.selected_proof_assessment.readiness_status === 'complete' &&
    row.selected_proof_assessment.stages.execution_evidence.status === 'not_started'));

  const UPSERT = 'workspace_controlled_contract_obligation_coverage_upsert';
  const WORK_RECORD_EDIT = 'workspace_work_record_edit';
  const blockedBy = async (contextChanges, code, authoring = 'complete',
    route = UPSERT, registered = true) => {
    const blocked = await resolveProofAuthoring({ ...source([]), obligations },
      { ...selectedContext, ...contextChanges });
    assert.equal(blocked.semantic_status, 'valid', code);

    assert.deepEqual([blocked.counts.valid, blocked.counts.invalid], [0, 8], code);
    assert.equal(blocked.rows.every(row => row.authoring_status === authoring), true, code);
    assert.equal(blocked.rows.every(row =>
      row.selected_proof_assessment.readiness_status !== 'complete'), true, code);
    assert.equal(blocked.status, 'invalid', code);
    for (const row of blocked.rows) {
      const authoring = row.diagnostics.find(diagnostic => diagnostic.code === code);
      assert.equal(authoring?.problem.route_assessment.effect, 'blocking', code);
      assert.equal(authoring.problem.route_assessment.stage, 'authored_inputs', code);
      assert.equal(authoring.problem.route_assessment.recovery.status,
        'operator_action', code);
      assert.ok(authoring.problem.route_assessment.recovery.operator_action.includes(route), code);

      if (registered) {

        assert.equal(authoring.problem.route_assessment.recovery.supported_next_call.tool,
          route, code);
        assert.equal(authoring.problem.cause.actor_recovery, 'caller_retry', code);
      }

      const generic = row.diagnostics.filter(diagnostic =>
        ['obligation_coverage_construction_unavailable',
          'obligation_coverage_dependencies_unresolved'].includes(diagnostic.code));
      assert.equal(generic.length, 2, code);
      assert.ok(generic.every(diagnostic =>
        diagnostic.problem.route_assessment.effect === 'nonblocking' &&
        diagnostic.problem.route_assessment.recovery.status === 'not_required'), code);
      const assessment = row.selected_proof_assessment;
      assert.equal(assessment.stages.authored_inputs.status, 'incomplete', code);
      assert.ok(assessment.stages.authored_inputs.blocking_diagnostic_codes
        .includes(code), code);
      assert.equal(assessment.stages.system_capability.status, 'available', code);
      assert.deepEqual(assessment.stages.system_capability.blocking_diagnostic_codes,
        [], code);
      assert.deepEqual(assessment.stages.system_capability.blockers, [], code);
      assert.deepEqual(assessment.stages.system_capability.nonblocking_diagnostic_codes, [
        'obligation_coverage_construction_unavailable',
        'obligation_coverage_dependencies_unresolved'
      ], code);
      assert.equal(assessment.stages.system_capability.satisfied_by, null, code);
      assert.equal(assessment.readiness_status, 'incomplete', code);
      assert.equal(assessment.prevents_selected_route, true, code);
      assert.equal(assessment.stages.execution_evidence.credit_granted, 0, code);
    }
  };
  await blockedBy({ case_definitions: [] },
    'obligation_coverage_authored_case_missing', 'incomplete', UPSERT, false);
  const withoutOptionalCases = obligations.map(({ case_id: _caseId, ...row }) => row);
  const omittedCases = await resolveProofAuthoring({ ...source([]),
    obligations: withoutOptionalCases }, { ...selectedContext, case_definitions: [] });
  assert.equal(omittedCases.status, 'invalid',
    'the executable-map verdict remains strict without executable cases');
  assert.ok(omittedCases.rows.every(row =>
    row.semantic_status === 'valid' && row.authoring_status === 'complete' &&
    row.status === 'valid' &&
    row.selected_proof_assessment.readiness_status === 'incomplete'));
  assert.ok(omittedCases.rows.every(row => row.diagnostics.some(diagnostic =>
    diagnostic.code === 'obligation_coverage_authored_case_missing')),
  'the execution route still reports its exact missing prerequisite');
  await blockedBy({ test_declarations: [] },
    'obligation_coverage_native_binding_missing');
  await blockedBy({ test_declarations: testDeclarations.flatMap(binding =>
    [binding, structuredClone(binding)]) },
  'obligation_coverage_native_binding_ambiguous');
  const invalidBindings = structuredClone(testDeclarations);
  for (const binding of invalidBindings) delete binding.candidate_execution_provider;

  await blockedBy({ test_declarations: invalidBindings },
    'obligation_coverage_native_binding_case_incomplete', 'incomplete');
  await blockedBy({ test_target_declarations: {
    status: 'valid', executable_declarations: [] } },
  'obligation_coverage_declared_test_target_undeclared', 'complete', WORK_RECORD_EDIT);
  await blockedBy({ test_target_declarations: { status: 'valid',
    executable_declarations: executableDeclarations.flatMap(declaration =>
      [declaration, structuredClone(declaration)]) } },
  'obligation_coverage_declared_test_target_ambiguous', 'complete', WORK_RECORD_EDIT);
  await blockedBy({ test_target_declarations: {
    status: 'invalid', executable_declarations: executableDeclarations } },
  'obligation_coverage_declared_test_target_invalid', 'complete', WORK_RECORD_EDIT);

  const cyclic = validatePackParameterContract({
    ...structuredClone(population.contract), dependencies: { state: 'complete', packs: [{
      profile_id: population.contract.profile_id,
      profile_version: population.contract.profile_version,
      profile_digest: population.contract.profile_digest, applicability_refs: [],
      input_mappings: [], output_uses: [population.contract.role_producers[0].role] }] }
  }, population.pack.profile);
  const required = await resolveProofAuthoring({ ...source([]), obligations },
    selectedContext, { loadContract: () => cyclic });
  assert.equal(required.status, 'invalid');
  for (const row of required.rows) {
    const assessment = row.selected_proof_assessment;
    assert.equal(assessment.stages.authored_inputs.status, 'complete');
    assert.equal(assessment.stages.system_capability.status, 'unavailable');
    assert.deepEqual(assessment.stages.system_capability.blocking_diagnostic_codes,
      ['pack_parameter_dependency_cycle']);
    assert.deepEqual(assessment.stages.system_capability.nonblocking_diagnostic_codes,
      ['obligation_coverage_construction_unavailable']);
    assert.deepEqual(assessment.stages.system_capability.blockers.map(blocker =>
      [blocker.effect, blocker.unavailable_operation.kind, blocker.recovery.status]),
    [['blocking', 'dependency_contract', 'unavailable']]);
    assert.equal(assessment.readiness_status, 'incomplete');
    assert.equal(assessment.stages.execution_evidence.credit_granted, 0);
  }
});

test('WK-2653 missing binding-derived parameters name their authored prerequisite, not a canonical failure', async () => {
  const { population, obligations, testDeclarations, selectedContext } = await completeTestRoutes(2);
  const draft = { ...source([]), obligations };
  const resolve = changes => resolveProofAuthoring(draft, { ...selectedContext, ...changes });
  const complete = await resolve({});
  assert.equal(complete.status, 'valid');
  assert.ok(complete.rows.every(row => !row.diagnostics.some(diagnostic =>
    diagnostic.code.startsWith('obligation_coverage_parameter_'))));
  assert.deepEqual(await resolve({}), complete, 'complete identities are unchanged');
  const parameters = row => row.diagnostics.filter(diagnostic =>
    diagnostic.code === 'obligation_coverage_parameter_missing');

  const assertAttributed = (row, expected, label, authoring = 'complete') => {
    const missing = parameters(row);
    assert.deepEqual(missing.map(diagnostic => diagnostic.problem.cause.parameter).sort(),
      Object.keys(expected).sort(), label);
    for (const diagnostic of missing) {
      const { parameter, authored_prerequisite: fact } = diagnostic.problem.cause;
      assert.equal(diagnostic.problem.category, 'author_input', label);
      assert.equal(diagnostic.problem.cause.kind, 'derived_parameter_prerequisite_missing', label);
      assert.deepEqual(fact, expected[parameter], label);
      assert.match(diagnostic.reason, new RegExp(`${fact.prerequisite} is ${fact.status}`, 'u'), label);
      const route = diagnostic.problem.route_assessment;
      assert.deepEqual([route.effect, route.stage, route.unavailable_operation, route.recovery.status],
        ['blocking', 'authored_inputs', null, 'operator_action'], label);
      assert.equal(route.recovery.supported_next_call, null, label);
      assert.match(route.recovery.operator_action,
        /^Query the current saved selection, then through workspace_controlled_contract_obligation_coverage_upsert with its returned content digest /u, label);
      assert.match(route.recovery.operator_action, /never edit the binding or supply the parameter directly/u, label);
      assert.doesNotMatch(`${route.reason} ${route.recovery.explanation}`,
        /No supported recovery|cannot repair canonical sources|system capabilit/u, label);
      assert.doesNotMatch(route.recovery.operator_action, /OBL-|case-wk2553/u, label);
    }
    const assessment = row.selected_proof_assessment;
    assert.equal(assessment.stages.canonical_sources.status, 'current', label);
    assert.deepEqual(assessment.stages.canonical_sources.blocking_diagnostic_codes, [], label);
    assert.equal(assessment.stages.system_capability.status, 'available', label);
    assert.equal(assessment.stages.authored_inputs.status, 'incomplete', label);
    assert.ok(assessment.stages.authored_inputs.blocking_diagnostic_codes
      .includes('obligation_coverage_parameter_missing'), label);
    assert.deepEqual([assessment.readiness_status, assessment.prevents_selected_route,
      assessment.stages.execution_evidence.credit_granted], ['incomplete', true, 0], label);

    assert.equal(row.semantic_status, 'valid', label);
    assert.equal(row.authoring_status, authoring, label);
    assert.equal(row.status, authoring === 'complete' ? 'valid' : 'invalid', label);
  };
  const componentSource = { binding_field: 'system_under_test_boundary.subject_reference_ids',
    authored_case_field: 'component' };
  const suiteSource = { binding_field: 'test_selector', authored_case_field: 'target' };
  const bindingFact = (status, count) => ({ prerequisite: 'native_test_binding', status, binding_count: count });

  const missing = await resolve({ test_declarations: [] });
  for (const row of missing.rows) {
    assert.ok(row.diagnostics.some(diagnostic => diagnostic.code === 'obligation_coverage_native_binding_missing'));
    assertAttributed(row, { component: { ...bindingFact('missing', 0), ...componentSource },
      suite: { ...bindingFact('missing', 0), ...suiteSource } }, 'missing binding');
    assert.match(parameters(row)[0].problem.route_assessment.recovery.operator_action,
      /link this obligation to one authored case/u);
  }
  const ambiguous = await resolve({ test_declarations: testDeclarations.flatMap(binding =>
    [binding, structuredClone(binding)]) });
  for (const row of ambiguous.rows) assertAttributed(row, {
    component: { ...bindingFact('ambiguous', 2), ...componentSource },
    suite: { ...bindingFact('ambiguous', 2), ...suiteSource } }, 'ambiguous binding');

  const withoutCaseFields = structuredClone(testDeclarations);
  delete withoutCaseFields[0].system_under_test_boundary.subject_reference_ids;
  delete withoutCaseFields[1].test_selector;
  const partial = await resolve({ test_declarations: withoutCaseFields });
  const caseFact = { prerequisite: 'authored_case', status: 'incomplete' };
  assertAttributed(partial.rows[0], { component: { ...caseFact, ...componentSource } },
    'no component', 'incomplete');
  assertAttributed(partial.rows[1], { suite: { ...caseFact, ...suiteSource } },
    'no target selector', 'incomplete');
  assert.match(parameters(partial.rows[0])[0].problem.route_assessment.recovery.operator_action,
    /author the 'component' field of the case this obligation uses/u);
  assert.match(parameters(partial.rows[1])[0].problem.route_assessment.recovery.operator_action,
    /author the 'target' field of the case this obligation uses/u);

  for (const changes of [{ test_target_declarations: { status: 'valid', executable_declarations: [] } },
    { test_declarations: testDeclarations.map(binding => {
      const { candidate_execution_provider: omitted, ...rest } = binding; return rest; }) }]) {
    const blocked = await resolve(changes);
    assert.ok(blocked.rows.every(row =>
      row.selected_proof_assessment.readiness_status === 'incomplete' &&
      parameters(row).length === 0));
  }

  const assertCanonical = (row, label) => {
    const missingParameters = parameters(row);
    assert.ok(missingParameters.length > 0, label);
    for (const diagnostic of missingParameters) {
      assert.equal(diagnostic.problem.category, 'canonical_source', label);
      assert.equal(diagnostic.problem.cause.kind, 'parameter_source', label);
      assert.equal(Object.hasOwn(diagnostic.problem.cause, 'authored_prerequisite'), false, label);
      assert.deepEqual([diagnostic.problem.route_assessment.stage, diagnostic.problem.route_assessment.recovery.status],
        ['canonical_sources', 'unavailable'], label);
    }
    assert.equal(row.selected_proof_assessment.stages.canonical_sources.status, 'unresolved', label);
    assert.equal(row.selected_proof_assessment.readiness_status, 'incomplete', label);
  };
  const unknownReference = await resolve({ contract_references: [] });
  for (const row of unknownReference.rows) assertCanonical(row, 'unknown boundary reference');
  const suppliedCanonical = await resolve({ canonical_parameters: { [obligations[0].obligation_id]: {} } });
  assertCanonical(suppliedCanonical.rows[0], 'supplied canonical source');
  assert.equal(suppliedCanonical.rows[1].status, 'valid');
  const nodeLinked = obligations.map(({ case_id: omitted, ...row }, index) => ({ ...row,
    controlled_contract_node_ids: [testDeclarations[index].verification_claim_id] }));
  const nonCaseBindings = structuredClone(testDeclarations);
  for (const binding of nonCaseBindings) delete binding.test_selector;
  const nonCase = await resolveProofAuthoring({ ...draft, obligations: nodeLinked },
    { ...selectedContext, test_declarations: nonCaseBindings, contract_nodes: nonCaseBindings.map(binding => binding.verification_claim_id) });
  for (const row of nonCase.rows) assertCanonical(row, 'non-case native binding');

  const mixedBindings = structuredClone(testDeclarations);
  mixedBindings[1].system_under_test_boundary.subject_reference_ids = [`ref-${'e'.repeat(40)}`];
  const mixed = await resolve({ test_declarations: mixedBindings.slice(1) });
  assertAttributed(mixed.rows[0], { component: { ...bindingFact('missing', 0), ...componentSource },
    suite: { ...bindingFact('missing', 0), ...suiteSource } }, 'mixed attributed');
  assertCanonical(mixed.rows[1], 'mixed canonical');

  const definitionRoute = { ...population.pack, profile: { ...population.pack.profile,
    stable_capabilities: { ...population.pack.profile.stable_capabilities, test_validity: 'none' } } };
  const evaluated = await resolveProofAuthoring(draft, { ...selectedContext, test_declarations: [] },
    { loadExact: async () => definitionRoute, loadContract: () => population.contract });
  for (const row of evaluated.rows) {
    assert.equal(row.selected_proof_assessment.execution_family, 'definition_evaluation');
    assertCanonical(row, 'definition evaluation route');
  }
});

const REGISTERED_PREREQUISITE_CODES = Object.freeze({
  'native_test_binding/missing': 'obligation_coverage_native_binding_missing',
  'native_test_binding/ambiguous': 'obligation_coverage_native_binding_ambiguous',
  'native_test_binding/case_incomplete': 'obligation_coverage_native_binding_case_incomplete',
  'native_test_binding/provider_unresolved':
    'obligation_coverage_native_binding_provider_unresolved',
  'declared_test_target/verification_unresolved':
    'obligation_coverage_declared_test_target_verification_unresolved',
  'declared_test_target/undeclared': 'obligation_coverage_declared_test_target_undeclared',
  'declared_test_target/ambiguous': 'obligation_coverage_declared_test_target_ambiguous',
  'declared_test_target/invalid': 'obligation_coverage_declared_test_target_invalid'
});

const RETIRED_PREREQUISITE_CODES = Object.freeze([
  'obligation_coverage_native_binding_invalid',
  'obligation_coverage_declared_test_target_missing'
]);

const prerequisiteFacts = (overrides = {}) => ({
  verification_id: 'VC-1', binding_count: 1, case_id: 'CASE-1',
  prerequisite: 'native_test_binding', status: 'invalid',
  owner_code: null, owner_details: null, ...overrides
});

test('WK-2664 the registry declares one code per condition and no retired string', async () => {
  const { PROOF_PREREQUISITE_CODES } = await import(
    '@agent-chassis/controlled-contract/proof-contract');
  assert.deepEqual([...PROOF_PREREQUISITE_CODES.byCondition.keys()].sort(),
    Object.keys(REGISTERED_PREREQUISITE_CODES).sort());
  for (const [condition, code] of Object.entries(REGISTERED_PREREQUISITE_CODES)) {
    assert.equal(PROOF_PREREQUISITE_CODES.byCondition.get(condition).code, code, condition);
  }
  for (const retired of RETIRED_PREREQUISITE_CODES) {
    assert.equal(PROOF_PREREQUISITE_CODES.byCode.has(retired), false, retired);
  }

  for (const family of ['native_test_binding', 'declared_test_target']) {
    for (const condition of ['complete', 'not_applicable']) {
      assert.equal(PROOF_PREREQUISITE_CODES.byCondition.has(`${family}/${condition}`), false,
        `${family}/${condition}`);
    }
  }
  const enumerated = new Set(['operator', 'coordinator', 'worker_split',
    'automatic_proceed', 'none', 'caller_retry']);
  for (const code of PROOF_PREREQUISITE_CODES.codes) {
    const entry = PROOF_PREREQUISITE_CODES.byCode.get(code);
    assert.equal(enumerated.has(entry.actor_recovery), true, code);
    assert.equal(entry.category, 'controlled_contract', code);
    assert.equal(entry.blocking, true, code);

    assert.doesNotMatch(entry.summary, /found \d/u, code);

    assert.equal(entry.recovery === null, entry.actor_recovery !== 'caller_retry', code);
  }
});

test('WK-2664 each registered condition raises its exact code with the declared facts', async () => {
  const { PROOF_PREREQUISITE_CODES, raiseErrorCode } = await import(
    '@agent-chassis/controlled-contract/proof-contract');
  for (const [key, code] of Object.entries(REGISTERED_PREREQUISITE_CODES)) {
    const [family, condition] = key.split('/');

    const raised = raiseErrorCode(PROOF_PREREQUISITE_CODES, { family, condition }, {
      path: '/obligations/0/case_id',
      facts: prerequisiteFacts({ prerequisite: family, binding_count: 2,
        owner_code: 'owner_diagnostic_code', owner_details: { field: 'x' } })
    });
    assert.equal(raised.code, code, key);
    assert.equal(raised.path, '/obligations/0/case_id', key);
    assert.equal(raised.owner, '@agent-chassis/controlled-contract', key);
    assert.equal(raised.problem.cause.kind, 'selected_route_prerequisite', key);
    assert.equal(raised.problem.cause.prerequisite, family, key);

    assert.equal(raised.problem.cause.actor_recovery,
      PROOF_PREREQUISITE_CODES.byCode.get(code).actor_recovery, key);

    for (const fact of ['owner_code', 'owner_details']) {
      assert.equal(Object.hasOwn(raised, fact), true, `${key} details.${fact}`);
      assert.equal(Object.hasOwn(raised.problem.cause, fact), true, `${key} cause.${fact}`);
    }
  }
});

test('WK-2664 the two split statuses select their code from the discriminating fact', async () => {
  const { PROOF_PREREQUISITE_CODES, raiseErrorCode, registeredRecoveryTemplate } =
    await import('@agent-chassis/controlled-contract/proof-contract');
  const raise = (family, condition, facts) => raiseErrorCode(PROOF_PREREQUISITE_CODES,
    { family, condition }, { path: '/obligations/0/case_id', facts });

  const authored = raise('native_test_binding', 'case_incomplete',
    prerequisiteFacts({ owner_code: 'stable_test_proof_incomplete',
      owner_details: { diagnostics: [] } }));
  assert.equal(authored.code, 'obligation_coverage_native_binding_case_incomplete');
  assert.equal(authored.problem.cause.actor_recovery, 'caller_retry');
  const authoredRecovery = registeredRecoveryTemplate(PROOF_PREREQUISITE_CODES, authored.code);
  assert.equal(authoredRecovery.route,
    'workspace_controlled_contract_obligation_coverage_upsert');

  assert.match(authoredRecovery.summary,
    /never supply or edit the derived binding itself/u);

  const provider = raise('native_test_binding', 'provider_unresolved',
    prerequisiteFacts({ owner_code: 'stable_test_proof_provider_unknown' }));
  assert.equal(provider.code, 'obligation_coverage_native_binding_provider_unresolved');
  assert.equal(provider.problem.cause.actor_recovery, 'operator');
  assert.equal(registeredRecoveryTemplate(PROOF_PREREQUISITE_CODES, provider.code), null);

  const unresolved = raise('declared_test_target', 'verification_unresolved',
    prerequisiteFacts({ prerequisite: 'declared_test_target', verification_id: null,
      binding_count: 0, status: 'missing' }));
  assert.equal(unresolved.code,
    'obligation_coverage_declared_test_target_verification_unresolved');
  assert.equal(registeredRecoveryTemplate(PROOF_PREREQUISITE_CODES, unresolved.code).route,
    'workspace_controlled_contract_obligation_coverage_upsert');
  const undeclared = raise('declared_test_target', 'undeclared',
    prerequisiteFacts({ prerequisite: 'declared_test_target', binding_count: 0,
      status: 'missing' }));
  assert.equal(undeclared.code, 'obligation_coverage_declared_test_target_undeclared');
  assert.equal(registeredRecoveryTemplate(PROOF_PREREQUISITE_CODES, undeclared.code).route,
    'workspace_work_record_edit');
});

test('WK-2664 misusing the raise function throws instead of building a refusal', async () => {
  const { PROOF_PREREQUISITE_CODES, ProofDiagnosticCodeError, raiseErrorCode } =
    await import('@agent-chassis/controlled-contract/proof-contract');
  const occurrence = { path: '/obligations/0/case_id', facts: prerequisiteFacts() };

  for (const retired of ['obligation_coverage_native_binding_invalid',
    'obligation_coverage_declared_test_target_missing',
    'obligation_coverage_native_binding_not_applicable']) {
    assert.throws(() => raiseErrorCode(PROOF_PREREQUISITE_CODES, retired, occurrence),
      error => error instanceof ProofDiagnosticCodeError &&
        /unregistered diagnostic code/u.test(error.message), retired);
  }
  for (const selector of [{ family: 'native_test_binding', condition: 'invalid' },
    { family: 'declared_test_target', condition: 'missing' },
    { family: 'native_test_binding', condition: 'complete' },
    { family: 'invented_family', condition: 'missing' }]) {
    assert.throws(() => raiseErrorCode(PROOF_PREREQUISITE_CODES, selector, occurrence),
      error => error instanceof ProofDiagnosticCodeError, JSON.stringify(selector));
  }

  for (const fact of ['verification_id', 'case_id', 'owner_code', 'owner_details']) {
    const { [fact]: _omitted, ...withoutFact } = prerequisiteFacts();
    assert.throws(() => raiseErrorCode(PROOF_PREREQUISITE_CODES,
      { family: 'native_test_binding', condition: 'missing' },
      { path: '/x', facts: withoutFact }),
    error => error instanceof ProofDiagnosticCodeError &&
        error.message.includes(`declared fact ${fact}`), fact);
    assert.throws(() => raiseErrorCode(PROOF_PREREQUISITE_CODES,
      { family: 'native_test_binding', condition: 'missing' },
      { path: '/x', facts: prerequisiteFacts({ [fact]: undefined }) }),
    error => error instanceof ProofDiagnosticCodeError, fact);
  }

  assert.throws(() => raiseErrorCode(PROOF_PREREQUISITE_CODES,
    { family: 'declared_test_target', condition: 'undeclared' },
    { path: '/x', facts: prerequisiteFacts({ verification_id: null }) }),
  error => error instanceof ProofDiagnosticCodeError && /is null in this occurrence/u.test(error.message));

  assert.throws(() => raiseErrorCode(PROOF_PREREQUISITE_CODES,
    { family: 'native_test_binding', condition: 'missing' }, { facts: prerequisiteFacts() }),
  error => error instanceof ProofDiagnosticCodeError && /occurrence path/u.test(error.message));
  assert.throws(() => raiseErrorCode(PROOF_PREREQUISITE_CODES,
    { family: 'native_test_binding', condition: 'missing' }, { path: '/x' }),
  error => error instanceof ProofDiagnosticCodeError && /declared facts/u.test(error.message));
});

test('WK-2664 a malformed registry entry throws when the registry is composed', async () => {
  const { createDiagnosticCodeRegistry, ProofDiagnosticCodeError } = await import(
    '@agent-chassis/controlled-contract/proof-contract');
  const recovery = { kind: 'structured_route', route: 'r', success_condition: 'c' };
  const base = {
    code: 'fixture_code', family: 'fixture', condition: 'missing',
    category: 'controlled_contract', actor_recovery: 'caller_retry', blocking: true,
    problem_category: 'author_input', cause_kind: 'fixture_prerequisite',
    required_facts: ['case_id'], detail_facts: ['case_id'], summary: 'A fixture condition.',
    recovery
  };
  const refuses = (entries, pattern, label) => assert.throws(
    () => createDiagnosticCodeRegistry({ owner: 'fixture', entries }),
    error => error instanceof ProofDiagnosticCodeError && pattern.test(error.message), label);

  refuses([{ ...base, actor_recovery: 'somebody_else' }], /actor_recovery must be one of/u,
    'unenumerated actor_recovery');
  refuses([{ ...base, category: 'invented_category' }], /category must be/u, 'wrong category');
  refuses([{ ...base, problem_category: 'invented' }], /problem_category must be/u,
    'unknown problem category');
  refuses([base, { ...base, condition: 'ambiguous' }], /duplicate code/u, 'duplicate code');
  refuses([base, { ...base, code: 'other_code' }], /duplicate family\/condition/u,
    'two codes claiming one condition');
  refuses([{ ...base, detail_facts: ['not_declared'] }], /detail_facts must be declared facts/u,
    'detail fact the entry never requires');

  refuses([{ ...base, recovery: { ...recovery, argument_bindings: { unit: 'undeclared_fact' } } }],
    /does not require/u, 'binding to an undeclared fact');
  refuses([{ ...base, recovery: { kind: 'structured_route', route: 'r' } }],
    /must name a kind and success_condition/u, 'recovery without a success condition');

  refuses([{ ...base, recovery: null }], /must declare its recovery/u,
    'caller_retry without a recovery');
});
