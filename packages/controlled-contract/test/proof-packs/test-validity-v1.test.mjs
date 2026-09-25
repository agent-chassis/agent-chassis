import assert from 'node:assert/strict';
import test from 'node:test';
import { runTestValidityCertification } from '../support/test-validity-certification.mjs';
import { loadAdmittedProofPack } from '../../lib/admitted-proof-packs.mjs';
import { readDefinitionDocument } from '../support/certification-artifact.mjs';
const identity = { profile_id: 'proof.verification.test-validity', profile_version: '11.0.0' };
const read = name => readDefinitionDocument(identity, name);
test('current test-validity certifies the full authenticated execution controls', async () => {
  const [profile, adequacy, corpus] = await Promise.all(['profile.json', 'adequacy.json', 'corpus.json'].map(read));
  const result = runTestValidityCertification(profile, adequacy, corpus);
  assert.equal(result.passed, true);
  assert.equal(result.positive_control_count, 3);
  assert.equal(result.mutant_control_count, 9);
  assert.equal(result.rejection_control_count, 2);
  assert.deepEqual(result, await read('certification-result.full-census.json'));
});
test('current named test-validity selection binds exact v11 and its execution evaluator', async () => {
  const pack = await loadAdmittedProofPack('proof.verification.test-validity');
  assert.equal(pack.profile.profile_version, '11.0.0');
  assert.equal(pack.test_validity_evaluator.implementation_id, 'proof.verification.test-validity.execution-evaluator');
  assert.equal(pack.test_validity_evaluator.implementation_version, '9.0.0');
});
