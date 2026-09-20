import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverCompleteProofIntents, discoverProofIntents,
  PROOF_INTENT_DISCOVERY_CATALOG } from '../../packages/controlled-contract/lib/proof-intent-discovery.mjs';
import { loadAdmittedProofPack } from '../../packages/controlled-contract/lib/admitted-proof-packs.mjs';
import { loadPackParameterContract, describePackParameters } from '@agent-chassis/controlled-contract/pack-parameters';
import { projectProofDiscoveryScope, renderDiscoveryConstraint, loadProofDiscoveryPopulation } from '../../packages/controlled-contract/lib/proof-discovery-scope.mjs';

const population = discoverProofIntents().candidates;

test('complete search bypasses the ordinary 256-result default without changing bounded search semantics', () => {
  const query='proof';
  const ordinary=discoverProofIntents({query});
  const complete=discoverCompleteProofIntents({query});
  assert.equal(ordinary.result_limit,256);
  assert.equal(complete.result_limit,null);
  assert.equal(complete.returned_count,complete.total_match_count);
  assert.equal(complete.omitted_count,0);
  assert.equal(complete.truncated,false);
  assert.deepEqual(complete.candidates.slice(0,ordinary.returned_count),ordinary.candidates);
});

test('every admitted search identity retains every supplied constraint and refinement without reinterpretation', async t => {
  const identities = new Set(PROOF_INTENT_DISCOVERY_CATALOG.intents.flatMap(intent =>
    intent.capable_packs.map(pack => `${pack.profile_id}@${pack.profile_version}`)));
  assert.deepEqual(new Set(population.map(x => x.id)), identities);
  let clauses = 0, iterations = 0, alternatives = 0, exactBranches = 0;
  for (const candidate of population) {
    const pack = await loadAdmittedProofPack(candidate.proof_name);
    const description = describePackParameters(loadPackParameterContract(pack));
    const scope = projectProofDiscoveryScope(pack);
    assert.equal(candidate.profile_version, pack.profile.profile_version);
    assert.equal(candidate.assertion, pack.admission.guarantee);
    assert.equal(candidate.matching_assertion, pack.admission.guarantee);
    assert.deepEqual(candidate.exclusions, pack.admission.explicit_exclusions);
    assert.deepEqual(scope.constraints.map(({ ref, constraint }) => ({ ref, constraint })), description.constraints);
    assert.equal(new Set(scope.constraints.map(x => x.ref)).size, scope.constraints.length);
    assert.deepEqual(scope.refinements, description.parameters.map(parameter => ({
      name: parameter.name, refinements: parameter.refinements, applicability: parameter.constraints
    })));
    assert.deepEqual(scope.observations, description.construction.required_observations);
    assert.deepEqual(scope.capabilities, description.capabilities.map(({ kind, state, evidence_kind }) =>
      ({ kind, state, evidence_kind })));
    assert.equal(scope.provenance.parameter_contract_digest, pack.parameter_contract_digest);
    for (const clause of scope.constraints) {
      if (clause.constraint.claim_kind) {
        clauses++;
        assert.match(clause.reading, new RegExp(`^${clause.constraint.claim_kind}:`));
        for (const modality of clause.constraint.allowed_modalities) assert.ok(clause.reading.includes(modality));
      }
      if (clause.constraint.for_each) iterations++;
      const text = JSON.stringify(clause.constraint);
      alternatives += text.includes('"any_of"') ? 1 : 0;
      exactBranches += text.includes('"exactly_one"') ? 1 : 0;
    }
    assert.ok(!Object.hasOwn(scope, 'stage'));
  }
  assert.ok(clauses > 700 && iterations > 80 && alternatives > 0 && exactBranches > 0);
  t.diagnostic(JSON.stringify({ admitted_candidates: population.length, clauses, iterations, alternatives, exactBranches }));
});

test('bounded-state scope preserves strict interior, nonempty population, baseline equality and transient exclusion', () => {
  const candidate = population.find(x => x.proof_name === 'proof.lifecycle.bounded-state-stability');
  for (const pattern of [/without asserting terminality/, /complete nonempty/, /strictly inside/, /same subject/, /singleton baseline/])
    assert.match(candidate.assertion, pattern);
  assert.ok(candidate.exclusions.includes('transient-state-between-declared-observations'));
  const search = discoverProofIntents({query:'bounded interval baseline observations'});
  assert.equal(search.candidates.find(x => x.id === candidate.id).essential_limitation,
    'Excluded: transient state between declared observations.');
  assert.equal(candidate.provenance.profile_digest, 'b4eb7cd57b344d8dec861f7231ae4b0e4b39917581078aec6ea5651378aa5cae');
  assert.equal(candidate.provenance.parameter_contract_digest, '07485182dab6b90eb077ca3b91268e58d0552f4246db4dd3f8bced76f64bd023');
  const intent = PROOF_INTENT_DISCOVERY_CATALOG.intents.find(x => x.intent_id.endsWith('.bounded-state-stability'));
  assert.doesNotMatch(JSON.stringify(intent), /endpoint equality|equal across the endpoints/);
  for (const source of PROOF_INTENT_DISCOVERY_CATALOG.intents) for (const distinction of source.distinctions)
    if (distinction.from_intent_id === intent.intent_id) assert.doesNotMatch(distinction.explanation, /across interval endpoints/);
});

test('selected canonical pair never denies descriptor population equality or exact shared counts', () => {
  const candidate = discoverProofIntents({ query: 'canonical value pair arbitrary' }).candidates
    .find(x => x.proof_name === 'proof.result-shape.cross-representation-parity');
  assert.match(candidate.matching_assertion, /one explicitly selected canonical value pair/);
  assert.match(candidate.matching_assertion, /equal complete populations of typed member descriptors/);
  assert.match(candidate.matching_assertion, /shared exact nonnegative member count/);
  assert.match(candidate.essential_limitation, /automatic or arbitrary multi value pairing/);
});

test('unknown vocabulary or modality is an explicit capability defect, never omitted or guessed', () => {
  const original = population.flatMap(x => x.constraints).find(x => x.constraint.proposition_template);
  for (const mutate of [x => { x.constraint.proposition_template.operator = 'reference:invented'; },
    x => { x.constraint.proposition_template.applicability_context.mode = 'invented'; },
    x => { x.constraint.allowed_modalities = ['SHOULD']; }]) {
    const clause = structuredClone(original); mutate(clause);
    assert.throws(() => renderDiscoveryConstraint(clause), error =>
      error.code === 'proof_discovery_scope_unsupported' && error.details.ref === original.ref);
  }
});

test('metadata population does not admit evaluator-only test-validity or conflate construction with guarantees', () => {
  const candidate = population.find(x => x.proof_name === 'proof.verification.test-validity');
  const owner = PROOF_INTENT_DISCOVERY_CATALOG.intents.flatMap(x => x.capable_packs)
    .find(x => x.profile_id === candidate.proof_name);
  assert.equal(candidate.profile_version, owner.profile_version);
  assert.equal(population.filter(x => x.proof_name === candidate.proof_name).length, 1);
  assert.ok(population.some(x => x.capabilities.some(c => c.kind === 'constructor' && c.state === 'unavailable')));
  assert.ok(population.some(x => x.observations.length));
});


test('initial loading refuses a catalog generation different from the already-read search owner', async () => {
  await assert.rejects(() => loadProofDiscoveryPopulation(PROOF_INTENT_DISCOVERY_CATALOG, '0'.repeat(64)),
    error => error.details.construct === 'catalog moved during discovery initialization');
});
