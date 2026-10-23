import assert from 'node:assert/strict';
import test from 'node:test';
import { describeRetainedObservation } from '../../packages/wiki-mcp/src/lib/selected-response-observation.mjs';

test('retained observation distinguishes matching and changed identities', async () => {
  for (const [identity, state] of [['saved:alpha-73', 'current'], ['later:beta-29', 'changed']]) {
    const binding = { observation_identity: 'saved:alpha-73', repository: 'sample/repository' };
    const before = structuredClone(binding);
    let settlement;
    const actual = await describeRetainedObservation(binding, async copy => {
      assert.notEqual(copy, binding);
      assert.equal(Object.isFrozen(copy), true);
      assert.deepEqual(copy, binding);
      assert.throws(() => { copy.repository = 'mutated'; }, TypeError);
      settlement = identity;
      return settlement;
    });
    assert.equal(settlement, identity);
    assert.deepEqual(actual, { kind: 'retained_prior_observation', observation_identity: 'saved:alpha-73', state });
    assert.deepEqual(binding, before);
    assert.equal(Object.isFrozen(binding), false);
  }
});

test('retained observation states missing identity or resolver without invoking it', async () => {
  for (const [binding, resolver, identity] of [
    [{}, () => assert.fail('missing identity cannot resolve'), null],
    [{ observation_identity: 73 }, () => assert.fail('non-string identity cannot resolve'), 73],
    [{ observation_identity: 'saved:gamma-91' }, undefined, 'saved:gamma-91']
  ]) {
    assert.deepEqual(await describeRetainedObservation(binding, resolver), {
      kind: 'retained_prior_observation', observation_identity: identity, state: 'unavailable',
      unavailable_reason: 'observation_identity_unrecorded'
    });
  }
});

test('retained observation preserves typed causes and numeric process exit status', async () => {
  const binding = { observation_identity: 'saved:failure-61' };
  const typed = Object.assign(new Error('Cannot inspect committed revision'), {
    code: 'REVISION_IO_73', cause: Object.assign(new Error('Revision store denied'), { code: 'EACCES' }) });
  assert.deepEqual(await describeRetainedObservation(binding, async () => { throw typed; }), {
    kind: 'retained_prior_observation', observation_identity: 'saved:failure-61', state: 'unavailable',
    unavailable_reason: 'REVISION_IO_73', diagnosis: { name: 'Error', code: 'REVISION_IO_73',
      message: 'Cannot inspect committed revision', cause: { name: 'Error', code: 'EACCES', message: 'Revision store denied' } }
  });
  const processError = Object.assign(new Error('command failed with captured output'), {
    code: 37, stderr: 'private process transcript\nfatal: repository object missing\n' });
  const failure = await describeRetainedObservation(binding, async () => { throw processError; });
  assert.deepEqual(failure, { kind: 'retained_prior_observation', observation_identity: 'saved:failure-61',
    state: 'unavailable', unavailable_reason: 'current_observation_identity_unreadable', exit_code: 37,
    diagnosis: { name: 'Error', code: 37, message: 'command failed with captured output',
      errors: [{ severity: 'fatal', reason: 'repository object missing' }] } });
  assert.equal(JSON.stringify(failure).includes('private process transcript'), false);
});
