import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { requestSchema } from '../../packages/wiki-mcp/src/lib/proof-request-schema.mjs';
import { buildPublicSelectionSchema } from '../../packages/wiki-core/src/operations/controlled-contract/public-selection-schema.mjs';
import { projectZodRequestContract } from '../../packages/wiki-mcp/src/lib/zod-request-contract-projection.mjs';

const convert = schema => requestSchema(z, schema, schema.$defs, { memoize: true });
test('authored JSON value unions preserve nested objects, arrays, scalar values and null without widening strict selectors', () => {
  const value = { type: ['object', 'array', 'string', 'number', 'boolean', 'null'] };
  const converted = convert(value);
  for (const input of [{ a: [null, true, 2, 'meaning', { nested: ['kept'] }] }, [null, false, ['nested']], 'text', 3, true, null])
    assert.deepEqual(converted.parse(input), input);
  assert.deepEqual(convert({ type: 'array', items: true }).parse([null, { nested: true }]), [null, { nested: true }]);
  assert.equal(convert({ type: 'array', items: false }).safeParse([1]).success, false);
  assert.deepEqual(convert({ type: 'array', items: false }).parse([]), []);
  const closed = convert({ type: 'object', additionalProperties: false, properties: { value }, required: ['value'] });
  assert.equal(closed.safeParse({ value: null, extra: true }).success, false);
  assert.equal(closed.safeParse({}).success, false);
});

test('actual shared public selection schema converts and enforces nonempty patterns and closed selector fields', () => {
  const schema = buildPublicSelectionSchema({ kinds: ['requirement', 'claim', 'verification', 'collection'], allowLocalKeys: true });
  const converted = convert(schema);
  for (const input of [
    { kind: 'requirement', match: { subject: { identity: { kind: 'durable_id', domain: 'task', value: 'requested' } } } },
    { kind: 'requirement', match: { behavior: { objects: [{ boolean: true }], applies: { context: [] } } } },
    { kind: 'collection', match: { purpose: 'execution_order', members: [{ kind: 'requirement', obligation: 'OBL-001' }] } },
    { kind: 'verification', case: 'case-001' }, '$authored'
  ]) assert.deepEqual(converted.parse(input), input);
  for (const input of [{ kind: 'requirement', match: {} }, { kind: 'collection', match: {} },
    { kind: 'requirement', match: { modality: 'MUST' }, row_id: 'private' },
    { kind: 'verification', case: 'case-001', extra: true }, { kind: 'requirement' }])
    assert.equal(converted.safeParse(input).success, false, JSON.stringify(input));
});

test('authored property bounds remain enforced and discoverable through conversion', () => {
  const converted = convert({ type: 'object', additionalProperties: true, minProperties: 1, maxProperties: 2 });
  assert.equal(converted.safeParse({}).success, false);
  assert.deepEqual(converted.parse({ first: { nested: [null, 1] } }), { first: { nested: [null, 1] } });
  assert.equal(converted.safeParse({ a: 1, b: 2, c: 3 }).success, false);
  const { contract } = projectZodRequestContract(converted);
  assert.match(JSON.stringify(contract), /object_property_count/u);
});

test('save admits semantic criterion/grammar targets and refuses generated-address inputs', async () => {
  const { createSaveRecordInputContract } = await import('../../packages/wiki-mcp/src/lib/task-save-record-tools.mjs');
  const { normalizeAcceptanceCriteria } = await import('../../packages/wiki-core/src/lib/work-record-ready-slice-contract.mjs');
  const { readyAcceptanceCriterion } = await import('../../packages/wiki-mcp/src/lib/work-record-write-tool-schema-vocabulary.mjs');
  const contract = createSaveRecordInputContract(z).inputSchema;
  const wrap = changes => ({ unit: 'WK-0001', revision: 'revision', changes });
  const selected = { kind: 'criterion', match: { text: 'Saved criterion.' } };
  for (const changes of [{ criteria: [{ target: selected, text: 'Correction.' }] },
    { criteria: [{ key: 'new', text: 'New criterion.' }], obligations: [{ key: 'uses', criteria: ['$new', selected] }] },
    { remove: { criteria: [selected] } }]) assert.equal(contract.safeParse(wrap(changes)).success, true);
  for (const changes of [{ criteria: [{ id: 'derived:private', text: 'Correction.' }] },
    { criteria: [{ key: 'new', target: selected, text: 'Correction.' }] },
    { obligations: [{ key: 'uses', criteria: ['derived:private'] }] }, { remove: { criteria: ['derived:private'] } }])
    assert.equal(contract.safeParse(wrap(changes)).success, false);
  const grammar = subject => ({ unit: 'WK-0001', revision: 'revision', exception: { kind: 'grammar', action: 'withdraw', subject } });
  assert.equal(contract.safeParse(grammar({ kind: 'unresolved', match: { text: 'Saved fragment.', absent: ['reason'] } })).success, true);
  assert.equal(contract.safeParse(grammar('u1')).success, false);
  const typed = { text: 'Saved criterion.', typed_identity: ' authored exact identity ' };
  assert.deepEqual(normalizeAcceptanceCriteria([typed]).value, [typed]);
  assert.deepEqual(readyAcceptanceCriterion(z).parse(typed), typed);
  for (const value of ['', null, 42, {}]) {
    const malformed = { ...typed, typed_identity: value };
    assert.equal(normalizeAcceptanceCriteria([malformed]).ok, false);
    assert.equal(readyAcceptanceCriterion(z).safeParse(malformed).success, false);
  }
  assert.equal(normalizeAcceptanceCriteria([{ ...typed, unexpected: 'field' }]).ok, false);
});
