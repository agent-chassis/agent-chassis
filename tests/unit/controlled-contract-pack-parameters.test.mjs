import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validatePackParameterContract, describePackParameters, inspectParameterSource,
  deriveParameterRole } from '../../packages/controlled-contract/lib/pack-parameter-contract.mjs';
import { inspectPackParameterCoverage, validateParameterDependencies } from
  '../../packages/controlled-contract/lib/pack-parameter-coverage.mjs';
import { profileDigest } from '../../packages/controlled-contract/lib/profile-digest.mjs';
import { loadCurrentParameterPopulation, loadPackParameterContract } from
  '../../packages/controlled-contract/lib/pack-parameter-loader.mjs';
import { loadExactAdmittedProofPack } from '../../packages/controlled-contract/lib/admitted-proof-packs.mjs';

const packageRoot = new URL('../../packages/controlled-contract/', import.meta.url);
const read = async path => JSON.parse(await readFile(new URL(path, packageRoot), 'utf8'));
const catalog = await read('profiles/catalog.json');
const identity = (id, version) => `${id}@${version}`;
async function fixture(id) {
  const row = catalog.packs.find(row => row.profile_id === id);
  const directory = row.path;
  const [profile, raw] = await Promise.all([read(`${directory}/profile.json`), read(`${directory}/parameter-contract.json`)]);
  return { profile, raw, contract: validatePackParameterContract(raw, profile) };
}
function rejectsMutation(raw, profile, change, code) {
  const mutant = structuredClone(raw); change(mutant);
  assert.throws(() => validatePackParameterContract(mutant, profile), error =>
    error.code === code && error.details.limb === 'mechanical_failure');
}

test('P1 exact profile, companion and admission identities round trip without substitutions', async () => {
  const population = await loadCurrentParameterPopulation();
  assert.deepEqual(population.map(({ contract }) => identity(contract.profile_id, contract.profile_version)),
    catalog.packs.map(row => identity(row.profile_id, row.profile_version)).sort());
  assert.equal(new Set(population.map(({ contract }) => contract.profile_id)).size, population.length);
  for (const { pack, contract } of population) {
    assert.equal(pack.admission_version, 3);
    assert.equal(pack.parameter_contract_digest, pack.admission.parameter_contract_digest);
    assert.equal(contract.profile_digest, profileDigest(pack.profile));
    assert.equal(contract.profile_id, pack.profile.profile_id);
    const coverage = inspectPackParameterCoverage(contract, pack.profile);
    assert.equal(coverage.accounted, coverage.total);
    assert.equal(coverage.omitted, 0);
    assert.equal(loadPackParameterContract(pack).profile_version, pack.profile.profile_version);
    assert.throws(() => loadPackParameterContract({ ...pack }), { code: 'proof_pack_snapshot_unrecognized' });
  }
  const { raw, profile } = await fixture('proof.atomicity.failure-boundary');
  for (const field of ['profile_id', 'profile_version', 'profile_digest']) rejectsMutation(raw, profile,
    c => { c[field] = field === 'profile_digest' ? '0'.repeat(64) : field === 'profile_version' ? '999.0.0' : 'proof.wrong.pack'; },
    'pack_parameter_identity_mismatch');
  await assert.rejects(loadExactAdmittedProofPack({ profileId: profile.profile_id, profileVersion: '999.0.0' }),
    { code: 'proof_pack_exact_version_not_current' });
  await assert.rejects(loadExactAdmittedProofPack({ profileId: profile.profile_id, profileVersion: '3.0.0' }),
    { code: 'proof_pack_exact_version_not_current' });
});

test('P2 closed schema and exact refinements reject widening, duplicates and dangling references', async () => {
  const { raw, profile, contract } = await fixture('proof.atomicity.failure-boundary');
  assert.equal(describePackParameters(contract).omitted, 0);
  for (const mutate of [c => { c.command = 'execute'; }, c => { c.parameters[0].value_kind = 'dictionary'; },
    c => { c.parameters[0].source.policy = 'guess'; }, c => { c.parameters[0].source.extra = true; }]) {
    rejectsMutation(raw, profile, mutate, 'pack_parameter_schema_invalid');
  }
  rejectsMutation(raw, profile, c => c.parameters.push(c.parameters[0]), 'pack_parameter_coverage_mismatch');
  rejectsMutation(raw, profile, c => { c.parameters[0].value_kind = 'test_assertion_selector'; }, 'pack_parameter_value_kind_invalid');
  rejectsMutation(raw, profile, c => { c.parameters[0].refinement_refs = ['/reference_roles/999']; },
    'pack_parameter_coverage_mismatch');
  assert.throws(() => describePackParameters(structuredClone(contract)), { code: 'pack_parameter_snapshot_unrecognized' });
});

test('P3 every current parameter contract accounts for exactly its profile roles', async () => {
  let roles = 0;
  let parameters = 0;
  for (const row of catalog.packs) {
    const { profile, raw, contract } = await fixture(row.profile_id);
    const coverage = inspectPackParameterCoverage(contract, profile);
    assert.equal(coverage.total, [...profile.reference_roles, ...profile.number_roles].length,
      row.profile_id);
    assert.equal(coverage.total, coverage.accounted);
    assert.equal(coverage.omitted, 0);
    roles += coverage.total;
    parameters += raw.parameters.length;
    rejectsMutation(raw, profile, c => c.role_producers.pop(), 'pack_parameter_coverage_mismatch');
    rejectsMutation(raw, profile, c => c.role_producers.push(c.role_producers[0]), 'pack_parameter_coverage_mismatch');
    rejectsMutation(raw, profile, c => { c.role_producers[0].role = 'invented_role'; }, 'pack_parameter_coverage_mismatch');
    const withRule = raw.role_producers.findIndex(r => r.rule_refs.length);
    if (withRule >= 0) rejectsMutation(raw, profile, c => c.role_producers[withRule].rule_refs.pop(),
      'pack_parameter_coverage_mismatch');
  }
  const population = await loadCurrentParameterPopulation();
  assert.deepEqual([catalog.packs.length, roles, parameters], [population.length,
    population.reduce((sum, { contract }) => sum + contract.role_producers.length, 0),
    population.reduce((sum, { contract }) => sum + contract.parameters.length, 0)]);
  assert.deepEqual([population.length, roles, parameters], [37, 959, 735]);
});

test('P4 explicit, missing and canonical sources remain distinct without materialized defaults', async () => {
  const { contract } = await fixture('proof.atomicity.failure-boundary');
  const before = JSON.stringify(contract);
  const value = { kind: 'code_symbol', repository: 'org/repo', path: 'src/operation.mjs', symbol: 'run' };
  assert.equal(inspectParameterSource(contract, 'compound_operation').status, 'missing');
  assert.equal(inspectParameterSource(contract, 'compound_operation', { canonical: value }).status, 'missing');
  assert.equal(inspectParameterSource(contract, 'compound_operation', { explicit: value }).status, 'available');
  assert.equal(inspectParameterSource(contract, 'compound_operation', { explicit: 'ref-generated' }).status, 'incompatible');
  assert.equal(inspectParameterSource(contract, 'compound_operation', { explicit: { ...value, complete: true } }).status, 'incompatible');
  assert.equal(JSON.stringify(contract), before);
  const special = await fixture('proof.verification.test-validity');
  assert.equal(inspectParameterSource(special.contract, 'suite', { explicit: {} }).status, 'canonical_conflict');
});

test('P5 count joins, definition expectations and same-reference aliases preserve independent conditions', async () => {
  const parity = await fixture('proof.result-shape.cross-representation-parity');
  assert.equal(deriveParameterRole(parity.contract, 'member_count').status, 'missing');
  assert.equal(deriveParameterRole(parity.contract, 'member_count', { left_members: [], right_members: [] }).value, 0);
  assert.equal(deriveParameterRole(parity.contract, 'member_count', { left_members: ['ref-occurrence-one', 'ref-occurrence-two'], right_members: ['ref-occurrence-one', 'ref-occurrence-two'] }).value, 2);
  assert.equal(deriveParameterRole(parity.contract, 'member_count', { left_members: ['ref-occurrence-one'], right_members: ['ref-occurrence-one', 'ref-occurrence-two'] }).status, 'incompatible');
  const idempotency = await fixture('proof.idempotency.effect-nonduplication');
  assert.deepEqual(deriveParameterRole(idempotency.contract, 'second_input', { first_input: ['ref-input'] }).value, ['ref-input']);
  assert.equal(deriveParameterRole(idempotency.contract, 'second_input', { first_input: ['ref-input', 'ref-other'] }).status, 'incompatible');
  assert.equal(deriveParameterRole(parity.contract, 'member_count', { left_members: ['ref-duplicate', 'ref-duplicate'],
    right_members: ['ref-duplicate', 'ref-duplicate'] }).status, 'incompatible');
  rejectsMutation(idempotency.raw, idempotency.profile, c => {
    c.role_producers.find(r => r.role === 'second_input').inputs = ['state_after_first'];
  }, 'pack_parameter_derivation_invalid');
  const failure = await fixture('proof.failure.settlement-and-cleanup');
  assert.equal(deriveParameterRole(failure.contract, 'residue_count', {}).status, 'capability_gap');
  const winner = await fixture('proof.concurrency.single-winner-effect');
  assert.equal(deriveParameterRole(winner.contract, 'attempt_count').value, 2);
  assert.equal(deriveParameterRole(winner.contract, 'attempt_count', { attempts: ['ref-one'] }).status, 'incompatible');
});

test('P6 intervals, selected values, policies and exclusions retain exact profile semantics', async () => {
  for (const id of ['proof.state.bounded-interval-nonmutation', 'proof.result-shape.cross-representation-parity',
    'proof.ordering.lexicographic-conformance', 'proof.ownership.fenced-handoff']) {
    const { raw, profile, contract } = await fixture(id);
    const description = describePackParameters(contract);
    for (const row of description.constraints) {
      let value = profile;
      for (const key of row.ref.slice(1).split('/')) value = value[key];
      assert.deepEqual(row.constraint, value);
    }
    const changed = structuredClone(profile);
    changed.reference_roles[0].cardinality = 'zero_or_more';
    assert.throws(() => validatePackParameterContract(raw, changed), { code: 'pack_parameter_identity_mismatch' });
  }
});

test('P7 construction capabilities name actual owners and never execute metadata recipes', async () => {
  const { raw, profile, contract } = await fixture('proof.atomicity.failure-boundary');
  assert.equal(contract.capabilities.find(c => c.id === 'construction').state, 'unavailable');
  rejectsMutation(raw, profile, c => {
    Object.assign(c.capabilities[0], { state: 'implemented', identity: 'sh -c true',
      implementation_version: '1.0.0', evidence_kind: 'executed', gap: null });
  }, 'pack_parameter_capability_invalid');
  const integration = await fixture('proof.integration.prefix-safety');
  assert.equal(integration.contract.construction.declaration_outputs.length, 11);
  assert.equal(integration.contract.construction.canonical_inputs.length, 2);
  assert.equal(integration.contract.capabilities[0].implementation_version, '1.0.0');
  const owner = await import('../../packages/controlled-contract/lib/proof-authoring-skeleton.mjs');
  assert.equal(typeof owner.buildProofAuthoringSkeleton, 'function');
  assert.equal(integration.contract.capabilities[0].evidence_kind, 'static');
});

test('P7a implemented capability versions are independent of the shipping package version', async () => {
  const { raw, profile } = await fixture('proof.integration.prefix-safety');
  const mutant = structuredClone(raw);
  for (const cap of mutant.capabilities.filter(cap => cap.state === 'implemented')) {
    cap.implementation_version = '9.9.9';
  }

  assert.notEqual('9.9.9', (await read('package.json')).version);
  assert.deepEqual(validatePackParameterContract(mutant, profile).capabilities
    .map(cap => cap.implementation_version), ['9.9.9', null, null, '9.9.9']);
  rejectsMutation(raw, profile, c => {
    c.capabilities.find(cap => cap.state === 'implemented').implementation_version = null;
  }, 'pack_parameter_capability_invalid');
  rejectsMutation(raw, profile, c => {
    c.capabilities.find(cap => cap.state === 'unavailable').implementation_version = '2.0.0';
  }, 'pack_parameter_capability_invalid');
  rejectsMutation(raw, profile, c => {
    c.capabilities.find(cap => cap.state === 'declared_requirement').implementation_version = '2.0.0';
  }, 'pack_parameter_capability_invalid');
});

test('P8 dependency completeness, exact identities, mappings and cycles fail explicitly', async () => {
  const { contract } = await fixture('proof.atomicity.failure-boundary');
  assert.equal(contract.dependencies.state, 'unresolved');
  assert.equal(validateParameterDependencies([contract]), true);
  const none = structuredClone(contract); none.dependencies = { state: 'complete', packs: [] };
  assert.equal(validateParameterDependencies([none]), true);
  const dependent = structuredClone(contract);
  const self = { profile_id: contract.profile_id, profile_version: contract.profile_version,
    profile_digest: contract.profile_digest,
    input_mappings: contract.parameters.filter(p => p.source.policy === 'configurable').map(p => ({ input: p.name, parameter: p.name })),
    applicability_refs: [], output_uses: [] };
  dependent.dependencies = { state: 'complete', packs: [self] };
  assert.throws(() => validateParameterDependencies([dependent]), { code: 'pack_parameter_dependency_cycle' });
  self.profile_version = '999.0.0';
  assert.throws(() => validateParameterDependencies([dependent]), { code: 'pack_parameter_dependency_identity' });
  assert.throws(() => validateParameterDependencies([contract, contract]), { code: 'pack_parameter_coverage_mismatch' });
});
