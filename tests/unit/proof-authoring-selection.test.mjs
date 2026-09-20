import test from 'node:test';
import assert from 'node:assert/strict';
import { upsertProofAuthoringSelection as upsert, removeProofAuthoringSelection as remove,
  loadPinnedProofSelection, pinProofSelection } from '@agent-chassis/controlled-contract';
const empty = () => ({ schema_version: 'controlled-contract-obligation-coverage.v3', wk_id: 'WK-0001', selected_unit: null, focus: null, obligations: [] });
test('P04 preserves exact pins and refreshes only explicitly selected definitions', async () => {
  let version = '4.0.0', loads = 0, admitted = true;
  const owners = { catalog: async () => ({ packs: admitted ? [{ profile_id: 'proof.test' }] : [] }), load: async () => {
    loads++; return { profile: { profile_id: 'proof.test', profile_version: version }, profile_digest: 'a'.repeat(64),
      parameter_contract_digest: 'b'.repeat(64), admission_digest: 'c'.repeat(64) };
  } };
  const a = await upsert(empty(), [{ obligation_id: 'OBL-ONE',  proof_name: 'proof.test', parameters: { x: [1, 1], y: null }  }], owners);
  version = '5.0.0';
  const b = await upsert(a, [{ obligation_id: 'OBL-ONE',  proof_name: 'proof.test', parameters: { x: [] }  }], owners);
  assert.equal(loads, 1); assert.equal(b.obligations[0].selection.proof_version, '4.0.0');
  assert.deepEqual(a.obligations[0].selection.parameters.x, [1, 1]);
  const c = await upsert(b, [{ obligation_id: 'OBL-ONE',  refresh_proof_version: true  }], owners);
  assert.equal(c.obligations[0].selection.proof_version, '5.0.0'); assert.equal(loads, 2);
  assert.equal(Object.isFrozen(c.obligations[0].selection), true);

  admitted = false;
  const d = await upsert(c, [{ obligation_id: 'OBL-ONE', proof_name: 'proof.test', parameters: { z: 1 } }], owners);
  assert.equal(d.obligations[0].selection.proof_version, '5.0.0'); assert.equal(loads, 2);
  await assert.rejects(upsert(c, [{ obligation_id: 'OBL-ONE', refresh_proof_version: true }], owners),
    { code: 'obligation_coverage_proof_name_unknown', details: { limb: 'mechanical_failure', changed: false,
      phase: 'request', field: 'proof_name', proof_name: 'proof.test' } });
});
test('P04 omitted proof names keep drafts incomplete and preserve saved selections', async () => {
  const owners = { catalog: async () => ({ packs: [{ profile_id: 'proof.test' }] }), load: async () => ({
    profile: { profile_id: 'proof.test', profile_version: '4.0.0' }, profile_digest: 'a'.repeat(64),
    parameter_contract_digest: 'b'.repeat(64), admission_digest: 'c'.repeat(64) }) };
  const draft = await upsert(empty(), [{ obligation_id: 'OBL-DRAFT', statement: 'Incomplete' },
    { obligation_id: 'OBL-PARAMS', parameters: { x: 1 } }], owners);
  assert.deepEqual(draft.obligations[0], { obligation_id: 'OBL-DRAFT', statement: 'Incomplete' });
  assert.equal(draft.obligations[1].selection.proof_name, null);
  const selected = await upsert(draft, [{ obligation_id: 'OBL-DRAFT', proof_name: 'proof.test' }], owners);
  const kept = await upsert(selected, [{ obligation_id: 'OBL-DRAFT', statement: 'Amended', parameters: { y: 2 } }], owners);
  assert.deepEqual({ ...kept.obligations[0].selection, parameters: undefined },
    { ...selected.obligations[0].selection, parameters: undefined });
  assert.equal(kept.obligations[0].selection.proof_version, '4.0.0');
});
test('P04 an explicitly supplied unknown proof name refuses the whole amendment', async () => {
  const owners = { catalog: async () => ({ packs: [{ profile_id: 'proof.test' }] }), load: async () => ({
    profile: { profile_id: 'proof.test', profile_version: '4.0.0' }, profile_digest: 'a'.repeat(64),
    parameter_contract_digest: 'b'.repeat(64), admission_digest: 'c'.repeat(64) }) };
  const refusal = { name: 'ProofAuthoringError', code: 'obligation_coverage_proof_name_unknown',
    details: { limb: 'mechanical_failure', changed: false, phase: 'request', field: 'proof_name',
      proof_name: 'proof.invented' } };
  await assert.rejects(upsert(empty(), [{ obligation_id: 'OBL-NEW', proof_name: 'proof.invented' }], owners), refusal);
  const saved = await upsert(empty(), [{ obligation_id: 'OBL-ONE', proof_name: 'proof.test' }], owners);
  const before = structuredClone(saved);
  await assert.rejects(upsert(saved, [{ obligation_id: 'OBL-ONE', proof_name: 'proof.invented' }], owners), refusal);
  await assert.rejects(upsert(saved, [
    { obligation_id: 'OBL-ONE', statement: 'Valid amendment', parameters: { x: 1 } },
    { obligation_id: 'OBL-TWO', proof_name: 'proof.test' },
    { obligation_id: 'OBL-THREE', proof_name: 'proof.invented' }
  ], owners), refusal);
  assert.deepEqual(saved, before);

  const unpinned = { ...empty(), obligations: [{ obligation_id: 'OBL-OLD', selection: { proof_name: 'proof.invented',
    proof_version: null, profile_digest: null, parameter_contract_digest: null, admission_digest: null, parameters: {} } }] };
  await assert.rejects(upsert(unpinned, [{ obligation_id: 'OBL-OLD', proof_name: 'proof.invented' }], owners), refusal);
  await assert.rejects(loadPinnedProofSelection(unpinned.obligations[0].selection),
    { code: 'obligation_coverage_proof_unpinned', message: /upsert an exact catalog name or remove the selection/u });
  const repaired = await upsert(unpinned, [{ obligation_id: 'OBL-OLD', proof_name: 'proof.test' }], owners);
  assert.equal(repaired.obligations[0].selection.proof_version, '4.0.0');
});
test('P03 preserves omitted fields and unrelated obligations while applying explicit clears', async () => {
  const a = await upsert(empty(), [{ obligation_id: 'OBL-ONE',  statement: 'Meaning', parameters: { x: 1, y: null }  }]);
  await assert.rejects(upsert(a, [{ obligation_id: 'OBL-ONE',  parameters: { x: 2 }, clear_parameters: ['x']  }]), { code: 'obligation_coverage_request_invalid' });
  await assert.rejects(upsert(a, [{ obligation_id: 'OBL-ONE',  clear_parameters: ['x', 'x']  }]), { code: 'obligation_coverage_request_invalid' });
  const b = await upsert(a, [{ obligation_id: 'OBL-ONE',  clear_parameters: ['x']  }]);
  assert.deepEqual(b.obligations[0].selection.parameters, { y: null });
  assert.deepEqual(remove(b, 'OBL-ONE').obligations, [{ obligation_id: 'OBL-ONE', statement: 'Meaning' }]);
});
test('P04 refuses unavailable or corrupt admitted definitions instead of replacing their pins', async () => {
  await assert.rejects(pinProofSelection('proof.test', { catalog: async () => ({ packs: [{ profile_id: 'proof.test' }] }),
    load: async () => { throw Object.assign(new Error('bad admission'), { code: 'proof_pack_integrity_invalid' }); } }), { code: 'proof_pack_integrity_invalid' });
  await assert.rejects(upsert(empty(), [{ obligation_id: 'OBL-ONE', proof_name: 'proof.test' }], {
    catalog: async () => { throw Object.assign(new Error('bad catalog'), { code: 'proof_pack_catalog_invalid' }); } }),
  { code: 'proof_pack_catalog_invalid' });
  await assert.rejects(upsert(empty(), [{ obligation_id: 'OBL-ONE', proof_name: 'proof.test' }], {
    catalog: async () => ({ packs: [{ profile_id: 'proof.test' }] }),
    load: async () => { throw Object.assign(new Error('missing admission'), { code: 'proof_pack_admission_missing' }); } }),
  { code: 'proof_pack_admission_missing' });
  const pin = await pinProofSelection('proof.atomicity.failure-boundary');
  await assert.rejects(loadPinnedProofSelection({ ...pin, admission_digest: '0'.repeat(64) }), { code: 'obligation_coverage_definition_integrity_mismatch' });
});

test('P02 counts unique creates changes and unchanged rows and rejects empty or duplicate items', async () => {
  const source = await upsert(empty(), [
    { obligation_id: 'OBL-A', statement: 'Same' },
    { obligation_id: 'OBL-B', statement: 'Before' }
  ]);
  await assert.rejects(upsert(source, []), { code: 'obligation_coverage_request_invalid' });
  await assert.rejects(upsert(source, [
    { obligation_id: 'OBL-A', statement: 'First' },
    { obligation_id: 'OBL-A', statement: 'Second' }
  ]), { code: 'obligation_coverage_request_invalid' });
  const request = [
    { obligation_id: 'OBL-A', statement: 'Same' },
    { obligation_id: 'OBL-B', statement: 'After' },
    { obligation_id: 'OBL-C', statement: 'Created' }
  ];
  const result = await upsert(source, request);
  const before = new Map(source.obligations.map(row => [row.obligation_id, row]));
  const changed = request.filter(item => JSON.stringify(before.get(item.obligation_id)) !==
    JSON.stringify(result.obligations.find(row => row.obligation_id === item.obligation_id))).length;
  assert.equal(changed, 2);
  assert.equal(request.length - changed, 1);
  assert.deepEqual(source.obligations, [
    { obligation_id: 'OBL-A', statement: 'Same' },
    { obligation_id: 'OBL-B', statement: 'Before' }
  ]);
});

test('clearing absent parameters and setting an empty object preserve selection absence', async () => {
  const source = { schema_version: 'controlled-contract-obligation-coverage.v3', wk_id: 'WK-0001',
    selected_unit: null, focus: null, obligations: [{ obligation_id: 'OBL-ONE' }] };
  const { upsertProofAuthoringSelection } = await import('@agent-chassis/controlled-contract');
  assert.deepEqual(await upsertProofAuthoringSelection(source, [{ obligation_id: 'OBL-ONE',  clear_parameters: ['missing'], parameters: {}  }]), source);
  await assert.rejects(upsertProofAuthoringSelection(source, [{ obligation_id: 'OBL-ONE',  refresh_proof_version: true  }]),
    { code: 'obligation_coverage_proof_unselected' });
});
