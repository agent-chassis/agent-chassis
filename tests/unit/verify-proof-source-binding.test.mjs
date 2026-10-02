import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createNativeVerificationIndex, resolveBehaviorAndVerificationPopulation, applicableMandatoryBehaviors,
  resolveNativeProofBinding }
  from '../../packages/controlled-contract/lib/proof-native-verification-graph.mjs';
import { canonicalDigest } from '../../packages/controlled-contract/lib/deterministic-projection-primitives.mjs';
import { resolveProofAuthoring } from '../../packages/controlled-contract/lib/proof-authoring-resolution.mjs';
import { loadAdmittedProofPack } from '../../packages/controlled-contract/lib/admitted-proof-packs.mjs';
import { prepareProofObligationRuntime, resolveProofObligationRuntime }
  from '../../packages/controlled-contract/lib/proof-obligation-runtime-resolver.mjs';

test('native graph follows exact verifies edges and applicable mandatory collections', () => {
  const contract = { claims: [{ claim_id: 'behavior', kind: 'behavior' }, { claim_id: 'required', kind: 'behavior' },
    { claim_id: 'verification', kind: 'verification', verification_method: 'test_execution' },
    { claim_id: 'other', kind: 'verification', verification_method: 'test_execution' }],
    relations: [{ relation_id: 'rel', role: 'verifies', source_claim_id: 'verification', target_claim_id: 'behavior' },
      { relation_id: 'other-rel', role: 'verifies', source_claim_id: 'other', target_claim_id: 'required' }],
    collections: [{ collection_id: 'mandatory', purpose: 'mandatory_verify_proof_behaviors', member_claim_ids: ['behavior', 'required'] }],
    test_proofs: [] };
  const index = createNativeVerificationIndex(contract);
  const row = { controlled_contract_node_ids: ['verification'] };
  const graph = resolveBehaviorAndVerificationPopulation(row, contract, index);
  assert.deepEqual(graph.qualifying, ['verification']);
  assert.deepEqual(graph.behaviorIds, ['behavior']);
  assert.deepEqual(applicableMandatoryBehaviors(row, contract, graph.claims), []);
  assert.deepEqual(applicableMandatoryBehaviors({ controlled_contract_node_ids: ['behavior'] }, contract, graph.claims), ['behavior', 'required']);
  const disagreement = resolveBehaviorAndVerificationPopulation({ controlled_contract_node_ids: ['verification', 'other-rel'] }, contract, index);
  assert.deepEqual(disagreement.qualifying, ['other', 'verification']);
  assert.deepEqual(disagreement.explicitVerifications, ['verification']);
});

test('selected shared resolution preserves full source identity and excludes unrelated rows', async () => {
  const pack = await loadAdmittedProofPack('proof.verification.test-validity');
  const selection = { proof_name: pack.profile.profile_id, proof_version: pack.profile.profile_version,
    profile_digest: pack.profile_digest, admission_digest: pack.admission_digest,
    parameter_contract_digest: pack.parameter_contract_digest, parameters: {} };
  const source = { schema_version: 'controlled-contract-obligation-coverage.v3', wk_id: 'WK-0001', focus: null,
    selected_unit: null, obligations: [{ obligation_id: 'OBL-A', selection }, { obligation_id: 'OBL-B' }] };
  const context = { source_digest: `sha256:${canonicalDigest(source)}`, obligation_ids: ['OBL-A'] };
  const result = await resolveProofAuthoring(source, context);
  assert.equal(result.total, 1);
  assert.equal(result.source_digest, context.source_digest);
  assert.equal(result.rows[0].obligation_id, 'OBL-A');
  const selectedIdentity = (({ parameters: _parameters, ...identity }) => identity)(selection);
  assert.deepEqual(result.definition_identities, [selectedIdentity]);
  assert.deepEqual(result.rows[0].definition, selectedIdentity);
  assert.deepEqual(result.mapping.obligations.map(({ obligation_id }) => obligation_id), ['OBL-A']);
  for (const obligation_ids of [['UNKNOWN'], ['OBL-A', 'OBL-A']]) await assert.rejects(
    resolveProofAuthoring(source, { ...context, obligation_ids }), { code: 'obligation_coverage_selection_invalid' });
  assert.equal((await resolveProofAuthoring(source, { ...context, obligation_ids: [] })).total, 0);
});

test('shared authoring resolution retains a selected sibling with local author-input diagnostics',
  async () => {
    const pack = await loadAdmittedProofPack('proof.verification.test-validity');
    const selection = { proof_name: pack.profile.profile_id,
      proof_version: pack.profile.profile_version,
      profile_digest: pack.profile_digest,
      admission_digest: pack.admission_digest,
      parameter_contract_digest: pack.parameter_contract_digest,
      parameters: {} };
    const source = {
      schema_version: 'controlled-contract-obligation-coverage.v3',
      wk_id: 'WK-0001', focus: null, selected_unit: null,
      obligations: [
        { obligation_id: 'OBL-VALID', selection },
        { obligation_id: 'OBL-MISSING-SELECTION' }
      ]
    };
    const result = await resolveProofAuthoring(source, {
      source_digest: `sha256:${canonicalDigest(source)}`,
      obligation_ids: ['OBL-VALID', 'OBL-MISSING-SELECTION']
    });
    assert.equal(result.total, 2);
    assert.deepEqual(result.rows.map(({ obligation_id: id }) => id),
      ['OBL-VALID', 'OBL-MISSING-SELECTION']);
    assert.equal(result.rows[0].selected_proof_assessment.requirements.test_execution_evidence,
      'required');
    assert.equal(result.rows[1].selected_proof_assessment, null);
    assert.ok(result.rows[1].diagnostics.some(({ problem }) =>
      problem?.category === 'author_input'));
  });

const caseProofId = caseId => `test-proof-${canonicalDigest({ case_id: caseId }).slice(0, 40)}`;
const SHARED = Object.freeze({ behavior: 'claim-component-exists', first: 'claim-suite-covers-component',
  second: 'claim-suite-covers-component-second', firstRelation: 'rel-suite-verifies-component',
  secondRelation: 'rel-second-suite-verifies-component', firstCase: 'case-first', secondCase: 'case-second' });

async function sharedBehaviorContract() {
  const example = JSON.parse(await readFile(new URL(
    '../../packages/controlled-contract/examples/minimal-controlled-acceptance-contract.v1.json', import.meta.url)));
  const verification = example.claims.find(claim => claim.claim_id === SHARED.first);
  const proofOf = (verificationId, caseId, name) => ({ test_proof_id: caseProofId(caseId),
    verification_claim_id: verificationId,
    system_under_test_boundary: { boundary_id: `sut-boundary-${caseId}`, kind: 'module',
      runtime_module_path: 'packages/controlled-contract/lib/example.mjs', subject_reference_ids: ['ref-component'] },
    observable_result: { observable_id: `observable-${caseId}`, kind: 'return_value',
      proposition_id: 'prop-suite-covers-component' },
    candidate_execution_provider: { provider_id: 'launcher.node-test', provider_version: '1.0.0',
      capability: 'candidate_execution' },
    falsifiers: [{ falsifier_id: `falsifier-${caseId}`, strategy: 'dependency_failure',
      proposition_id: 'prop-component-absent', expected_outcome: 'verification_fails',
      mutation: { mutation_id: `mutation-${caseId}`, mechanism: 'module_substitution', target_kind: 'module',
        module_path: 'packages/controlled-contract/lib/example.mjs' },
      execution_provider: { provider_id: 'launcher.node-test-module-fault', provider_version: '2.0.0',
        capability: 'falsifier_execution' } }],
    traversal_provider: { mode: 'provider', provider_id: 'launcher.node-test-v8-coverage', provider_version: '1.0.0',
      capability: 'boundary_traversal', boundary_kind: 'module', observation_mechanism: 'node_test_v8_coverage',
      observation_seam: 'node_test_structured_assertion', evidence_artifact_type: 'boundary_trace' },
    test_selector: { name, nesting: 0 }, prohibited_shortcuts: ['source_text_inspection'] });
  return { ...example,
    claims: [...example.claims, { ...verification, claim_id: SHARED.second }],
    relations: [...example.relations, { relation_id: SHARED.secondRelation, role: 'verifies',
      source_claim_id: SHARED.second, target_claim_id: SHARED.behavior }],
    test_proofs: [proofOf(SHARED.first, SHARED.firstCase, 'first result is returned'),
      proofOf(SHARED.second, SHARED.secondCase, 'second result is returned')] };
}

async function sharedBehaviorRuntime(obligations, { contract: contractOverride } = {}) {
  const pack = await loadAdmittedProofPack('proof.verification.test-validity');
  const definition = { proof_name: pack.profile.profile_id, proof_version: pack.profile.profile_version,
    profile_digest: pack.profile_digest, admission_digest: pack.admission_digest,
    parameter_contract_digest: pack.parameter_contract_digest };
  const controlledContract = contractOverride ?? await sharedBehaviorContract();
  const obligationCoverage = { schema_version: 'controlled-contract-obligation-coverage.v3', wk_id: 'WK-2670',
    selected_unit: null, focus: null, obligations: obligations.map(row => ({
      statement: 'The selected test proves the shared behavior.',
      mechanism: { owner: 'packages/controlled-contract/test/example.test.mjs', kind: 'test', selector: 'selected' },
      selection: { ...definition, parameters: {} }, ...row })) };
  const prepared = prepareProofObligationRuntime({ wkId: 'WK-2670', obligationCoverage, controlledContract,
    contractGeneration: `sha256:${'a'.repeat(64)}` });
  const resolve = (obligationId, targetVerification = null) => resolveProofObligationRuntime({ prepared, obligationId,
    resolvedRow: { definition, input_status: 'valid', resolved_identity: 'b'.repeat(64),
      selected_proof_assessment: { requirements: { test_execution_evidence: 'required' } } },
    resolvedNode: { identity: 'b'.repeat(64), dependencies: [] },
    executionSourceBinding: { binding_digest: `sha256:${'c'.repeat(64)}`,
      cases: [SHARED.firstCase, SHARED.secondCase].map(case_id => ({ case_id })) },
    declaredTargetProjection: targetVerification === null ? null : { status: 'resolved',
      verification_id: targetVerification, unit: 'WK-2670', operation: 'node_test',
      target: 'packages/controlled-contract/test/example.test.mjs',
      target_id: `declared-target:WK-2670:${targetVerification}:example`,
      controlled_contract_generation: `sha256:${'a'.repeat(64)}`, source_snapshot_digest: `sha256:${'a'.repeat(64)}` },
    executionPack: pack });
  return { controlledContract, prepared, resolve,
    graph: id => resolveBehaviorAndVerificationPopulation(prepared.rows.get(id), controlledContract,
      prepared.nativeIndex) };
}

test('a saved case selects its own verification among verifications of one shared behavior', async () => {
  const runtime = await sharedBehaviorRuntime([
    { obligation_id: 'OBL-FIRST', case_id: SHARED.firstCase, controlled_contract_node_ids: [SHARED.behavior, SHARED.first] },
    { obligation_id: 'OBL-SECOND', case_id: SHARED.secondCase, controlled_contract_node_ids: [SHARED.behavior, SHARED.second] },

    { obligation_id: 'OBL-BOTH-LINKED', case_id: SHARED.firstCase,
      controlled_contract_node_ids: [SHARED.behavior, SHARED.first, SHARED.second] },

    { obligation_id: 'OBL-NO-CASE', controlled_contract_node_ids: [SHARED.behavior] }]);
  for (const [id, selected, relation] of [['OBL-FIRST', SHARED.first, SHARED.firstRelation],
    ['OBL-SECOND', SHARED.second, SHARED.secondRelation], ['OBL-BOTH-LINKED', SHARED.first, SHARED.firstRelation]]) {
    const graph = runtime.graph(id);
    assert.deepEqual(graph.behaviorIds, [SHARED.behavior], id);
    assert.deepEqual(graph.qualifying, [selected], id);
    assert.deepEqual(graph.eligible, [SHARED.first, SHARED.second], `${id}: eligibility is not narrowed`);
    assert.deepEqual(graph.relationIds, [relation], id);
    const resolved = runtime.resolve(id, selected);
    assert.equal(resolved.status, 'executable', JSON.stringify(resolved));
    assert.equal(resolved.verification_id, selected, id);
    assert.deepEqual(resolved.behavior_claim_ids, [SHARED.behavior], id);
    assert.deepEqual(resolved.relation_ids, [relation], id);
    assert.equal(resolved.test_proof.verification_claim_id, selected, id);
    assert.equal(resolved.authored_case.case_id, runtime.prepared.rows.get(id).case_id, id);
  }
  assert.notEqual(runtime.resolve('OBL-FIRST', SHARED.first).test_proof.test_proof_id,
    runtime.resolve('OBL-SECOND', SHARED.second).test_proof.test_proof_id);
  const ambiguous = runtime.resolve('OBL-NO-CASE', SHARED.first);
  assert.equal(ambiguous.reason_code, 'verify_proof.qualifying_verification_ambiguous.v1');
  assert.deepEqual(ambiguous.details.verification_ids, [SHARED.first, SHARED.second]);
});

test('a saved case selection never falls back to a sibling and keeps authored checks', async () => {
  const rows = [
    { obligation_id: 'OBL-FIRST', case_id: SHARED.firstCase, controlled_contract_node_ids: [SHARED.behavior, SHARED.first] },

    { obligation_id: 'OBL-UNLINKED', case_id: SHARED.firstCase, controlled_contract_node_ids: [SHARED.behavior, SHARED.second] },
  ];
  const withoutFirstCase = await sharedBehaviorContract();
  withoutFirstCase.test_proofs = withoutFirstCase.test_proofs.filter(proof =>
    proof.test_proof_id !== caseProofId(SHARED.firstCase));

  const missing = await sharedBehaviorRuntime(rows.slice(0, 1), { contract: withoutFirstCase });
  const unbound = missing.resolve('OBL-FIRST', SHARED.first);
  assert.equal(unbound.status, 'not_executable');
  assert.equal(unbound.reason_code, 'verify_proof.test_proof_binding_missing.v1');
  assert.deepEqual(unbound.details, { case_id: SHARED.firstCase, selected_verification_ids: [],
    eligible_verification_ids: [SHARED.first, SHARED.second], verification_id: null, arity: 0,
    owner_code: 'stable_test_proof_missing', join_kind: 'test_proof', path: '/test_proofs' });
  assert.deepEqual(missing.graph('OBL-FIRST').qualifying, []);
  assert.deepEqual(missing.graph('OBL-FIRST').selected, []);
  const runtime = await sharedBehaviorRuntime(rows);
  assert.throws(() => runtime.resolve('OBL-UNLINKED', SHARED.first),
    { code: 'verify_proof.explicit_verification_disagreement.v1' });

  const conflicting = await sharedBehaviorContract();
  conflicting.claims.push({ ...conflicting.claims.find(claim => claim.claim_id === SHARED.first),
    claim_id: 'claim-inspected', verification_method: 'inspection' });
  conflicting.relations.push({ relation_id: 'rel-other', role: 'verifies', source_claim_id: 'claim-inspected',
    target_claim_id: SHARED.behavior });
  const relation = await sharedBehaviorRuntime([{ obligation_id: 'OBL-RELATION', case_id: SHARED.firstCase,
    controlled_contract_node_ids: [SHARED.behavior, SHARED.first, 'rel-other'] }], { contract: conflicting });
  assert.throws(() => relation.resolve('OBL-RELATION', SHARED.first),
    { code: 'verify_proof.explicit_relation_disagreement.v1' });
  const duplicate = await sharedBehaviorContract();
  duplicate.test_proofs.push({ ...duplicate.test_proofs[0], test_proof_id: 'test-proof-duplicate' });

  await assert.rejects(sharedBehaviorRuntime(rows.slice(0, 1), { contract: duplicate }), error => {
    assert.equal(error.code, 'verify_proof.controlled_contract_invalid.v1');
    assert.ok(error.details.diagnostics.diagnostics.some(({ code }) => code === 'stable_test_proof_claim_duplicate'));
    return true;
  });
  const duplicateIndex = createNativeVerificationIndex(duplicate);
  const duplicateGraph = resolveBehaviorAndVerificationPopulation(rows[0], duplicate, duplicateIndex);
  assert.deepEqual(duplicateGraph.qualifying, [SHARED.first]);
  assert.deepEqual((({ proof, ...join }) => join)(resolveNativeProofBinding(duplicateGraph, duplicateIndex)), {
    verification_id: SHARED.first, arity: 2, reason_code: 'verify_proof.test_proof_binding_ambiguous.v1',
    owner_code: 'stable_test_proof_claim_duplicate', join_kind: 'test_proof', path: '/test_proofs' });

  const mandatory = await sharedBehaviorContract();
  mandatory.claims.push({ claim_id: 'claim-required-elsewhere', kind: 'behavior', modality: 'SHOULD',
    proposition_id: 'prop-component-exists' });
  mandatory.claims.sort((left, right) => left.claim_id.localeCompare(right.claim_id));
  mandatory.collections.push({ collection_id: 'set-mandatory-verify-proof-behaviors', collection_kind: 'closed_set',
    purpose: 'mandatory_verify_proof_behaviors', member_claim_ids: [SHARED.behavior, 'claim-required-elsewhere'] });
  const required = await sharedBehaviorRuntime(rows.slice(0, 1), { contract: mandatory });
  const incomplete = required.resolve('OBL-FIRST', SHARED.first);
  assert.equal(incomplete.reason_code, 'verify_proof.mandatory_behavior_coverage_incomplete.v1');
  assert.deepEqual(incomplete.details.missing_behavior_claim_ids, ['claim-required-elsewhere']);
});
