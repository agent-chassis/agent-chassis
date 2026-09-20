import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeVerificationIndex, resolveBehaviorAndVerificationPopulation, applicableMandatoryBehaviors }
  from '../../packages/controlled-contract/lib/proof-native-verification-graph.mjs';
import { canonicalDigest } from '../../packages/controlled-contract/lib/deterministic-projection-primitives.mjs';
import { resolveProofAuthoring } from '../../packages/controlled-contract/lib/proof-authoring-resolution.mjs';
import { loadAdmittedProofPack } from '../../packages/controlled-contract/lib/admitted-proof-packs.mjs';

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
