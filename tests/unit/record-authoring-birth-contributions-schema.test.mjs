import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { sourceAreaBirthSchema } from '../../packages/wiki-core/src/operations/record-birth-plan.mjs';
import { recordAuthoringChangeSchema } from '../../packages/wiki-core/src/lib/record-authoring-schema.mjs';

const require = createRequire(import.meta.url);
const Ajv = require('ajv');
const sample = schema => schema.type === 'array' ? ['authored']
  : schema.enum?.[0] ?? 'Authored value';
const ownerInput = schema => Object.fromEntries((schema.required ?? []).map(name =>
  [name, sample(schema.properties[name])]));

test('birth schema contributions remain owner supplied and cannot enable existing edits', async () => {
  const fresh = label => import(new URL(`../../packages/wiki-core/src/lib/record-authoring-schema.mjs?${label}`,
    import.meta.url));
  const existingFirst = await fresh('existing-before-contributions');
  const birthFirst = await fresh('contributions-before-existing');
  const kinds = ['work_item', 'initiative', 'decision'];
  const inputs = [{}, { title: 'Ordinary' }, { title: 42 }, { authority: true }, { sections: { unknown: 'No' } }];
  const baseline = kinds.map(kind => ({ schema: structuredClone(existingFirst.recordAuthoringChangeSchema(kind)),
    diagnostics: inputs.map(input => existingFirst.validateRecordAuthoringChanges(kind, 'existing', input)) }));
  for (const kind of ['source', 'area']) {
    const provider = sourceAreaBirthSchema(kind);
    const validate = new Ajv({ strict: false, allErrors: true }).compile(provider);
    const minimal = ownerInput(provider);
    assert.equal(validate(minimal), true);
    assert.equal(validate({}), kind === 'area');
    const corpus = [minimal, {}, { ...minimal, sections: {} }, { ...minimal, sections: { unknown: 'No' } }];
    for (const name of ['id', 'title', 'captured', 'updated', 'context', 'schema', 'producer', 'repo', 'path']) {
      assert.equal(Object.hasOwn(provider.properties, name), false);
      corpus.push({ ...minimal, [name]: 'forged' });
    }
    for (const [name, schema] of Object.entries(provider.properties)) {
      if (schema.type === 'array') corpus.push({ ...minimal, [name]: [42] }, { ...minimal, [name]: 'not a list' });
      if (provider.required?.includes(name)) corpus.push({ ...minimal, [name]: '   ' });
    }
    for (const owner of [existingFirst, birthFirst]) {
      const consumed = owner.recordAuthoringChangeSchema(kind, 'birth');
      assert.deepEqual(consumed, provider);
      assert.equal(owner.recordAuthoringChangeSchema(kind, 'birth'), consumed);
      for (const input of corpus) {
        assert.equal(owner.validateRecordAuthoringChanges(kind, 'birth', input).length === 0,
          validate(input), `${kind}: ${JSON.stringify(input)}`);
      }
      assert.throws(() => owner.recordAuthoringChangeSchema(kind, 'existing'), TypeError);
      assert.throws(() => owner.validateRecordAuthoringChanges(kind, 'existing', minimal), TypeError);
    }
    provider.properties.forged = { type: 'string' };
    assert.equal(Object.hasOwn(recordAuthoringChangeSchema(kind, 'birth').properties, 'forged'), false);
    assert.equal(Object.hasOwn(sourceAreaBirthSchema(kind).properties, 'forged'), false);
  }
  for (const owner of [existingFirst, birthFirst]) {
    for (const [index, kind] of kinds.entries()) {
      assert.deepEqual(owner.recordAuthoringChangeSchema(kind), baseline[index].schema);
      assert.deepEqual(inputs.map(input => owner.validateRecordAuthoringChanges(kind, 'existing', input)),
        baseline[index].diagnostics);
      owner.recordAuthoringChangeSchema(kind, 'birth');
      assert.deepEqual(owner.recordAuthoringChangeSchema(kind), baseline[index].schema);
    }
  }
});
