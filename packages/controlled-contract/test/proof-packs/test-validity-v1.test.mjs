import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runTestValidityCertification } from '../support/test-validity-certification.mjs';
import { loadAdmittedProofPack } from '../../lib/admitted-proof-packs.mjs';
const root = new URL('../certification/profiles/proof.verification.test-validity/10.0.0/', import.meta.url);
const read = async name => JSON.parse(await readFile(new URL(name, root)));
test('current test-validity certifies the full authenticated execution controls', async () => {
  const [profile, adequacy, corpus] = await Promise.all(['profile.json', 'adequacy.json', 'corpus.json'].map(read));
  const result = runTestValidityCertification(profile, adequacy, corpus);
  assert.equal(result.passed, true);
  assert.equal(result.positive_control_count, 1);
  assert.equal(result.mutant_control_count, 9);
  assert.deepEqual(result.passed_single_axis_weakenings, (await read('result.json')).passed_single_axis_weakenings);
});
test('current named test-validity selection binds exact v10 and its execution evaluator', async () => {
  const pack = await loadAdmittedProofPack('proof.verification.test-validity');
  assert.equal(pack.profile.profile_version, '10.0.0');
  assert.equal(pack.test_validity_evaluator.implementation_id, 'proof.verification.test-validity.execution-evaluator');
  assert.equal(pack.test_validity_evaluator.implementation_version, '8.0.0');
});
