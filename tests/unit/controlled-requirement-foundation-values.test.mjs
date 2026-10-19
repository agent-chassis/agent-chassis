import { resolveValueDefinitions } from '@agent-chassis/controlled-contract/controlled-value-definitions-v1';
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCelValue, normalizeValue, normalizeValueType, normalizeObservation, valueReferences } from '@agent-chassis/controlled-contract/controlled-values-v1';
import { celTypeDescriptor, observationValue } from '@agent-chassis/controlled-contract/cel-observation-model';
import { int, record, list, str, ref, select, index } from '../fixtures/controlled-requirement-foundation-values.mjs';
test('restricted standard values preserve precision, structure and presence', () => {
  for (const n of ['-9223372036854775808', '9223372036854775807', '9007199254740993']) assert.deepEqual(observationValue(n, 'int'), normalizeCelValue({ int64Value: n }));
  for (const n of ['-0', '01', '+1', '9223372036854775808', '-9223372036854775809']) assert.throws(() => normalizeCelValue({ int64Value: n }));
  assert.notDeepEqual(normalizeCelValue({ int64Value: '3' }), normalizeCelValue({ doubleValue: 3 }));
  assert.deepEqual(normalizeCelValue({ nullValue: null }), { nullValue: null });
  assert.throws(() => normalizeCelValue({}));
  for (const value of [NaN, Infinity, -Infinity]) assert.throws(() => normalizeCelValue({ doubleValue: value }));
  const text = '😀e\u0301"\\\n';
  assert.equal(normalizeCelValue({ stringValue: text }).stringValue, text);
  assert.throws(() => normalizeCelValue({ stringValue: '\ud800' }));
  assert.deepEqual(normalizeValue(record({ b: int(2), a: int(1) })), normalizeValue(record({ a: int(1), b: int(2) })));
  assert.notDeepEqual(normalizeValue(list('int', int(1), int(2))), normalizeValue(list('int', int(2), int(1))));
  assert.throws(() => normalizeValue(select(ref('x'), { index: str('wrong') })));
  assert.throws(() => normalizeValueType({ one_of: ['int', { one_of: ['bool', 'string'] }] }));
  assert.throws(() => normalizeObservation({ operation: 'op', occurrence: 'call', root: 'before', path: [], type: 'int' }));
  assert.deepEqual(valueReferences({ observation: { operation: 'op', occurrence: 'call', root: 'after', snapshot: { subject: 'state', boundary: 'edit' }, path: [index(ref('idx'))], type: 'int' } }), ['op', 'call', 'state', 'edit', 'idx']);
  assert.deepEqual(celTypeDescriptor({ list: 'int' }), { listType: { elemType: { primitive: 'INT64' } } });
  const timestamp = { objectValue: { '@type': 'type.googleapis.com/google.protobuf.Timestamp', value: '2026-01-01T00:00:00.123456789Z' } };
  assert.deepEqual(normalizeCelValue(timestamp), timestamp);
  const duration = { objectValue: { '@type': 'type.googleapis.com/google.protobuf.Duration', value: '1.5s' } };
  assert.deepEqual(normalizeCelValue(duration), duration);
  for (const value of ['1.5', 'seconds']) assert.throws(() => normalizeCelValue({ objectValue: { ...duration.objectValue, value } }));
  assert.deepEqual(normalizeCelValue({ listValue: {} }), { listValue: { values: [] } });
  assert.deepEqual(normalizeCelValue({ mapValue: {} }), { mapValue: { entries: [] } });
  assert.throws(() => normalizeCelValue({ mapValue: { entries: [
    { key: { int64Value: '1' }, value: { nullValue: null } },
    { key: { int64Value: '1' }, value: { boolValue: true } }
  ] } }), /value_duplicate_key/u);
  assert.throws(() => normalizeCelValue({ objectValue: { '@type': 'type.googleapis.com/other', value: 'x' } }));
});

test('recursive selection paths retain typed keys and traverse nested dependencies', () => {
  const nested = select(ref('values'), { key: select(ref('request'), { field: 'name' }) });
  assert.deepEqual(normalizeValue(nested), nested);
  assert.deepEqual(valueReferences(nested), ['values', 'request']);
  assert.deepEqual(normalizeValue(select(ref('values'), index(select(ref('request'), { field: 'offset' })))),
    select(ref('values'), index(select(ref('request'), { field: 'offset' }))));
});


test('list indexes require a provable int declaration, including nested record keys', () => {
  const entity = name => ({ type_term: 'cc:entity', identity: { kind: 'profile_term', term: name } });
  for (const type of [{ one_of: ['int', 'string'] }, 'dyn', { record: { fields: [
    { name: 'i', type: 'int', presence: 'required' }, { name: 's', type: 'string', presence: 'required' }] } }]) {
    const resolver = resolveValueDefinitions([{ identity: 'idx', constraint: { form: 'statement', subject: entity('idx'), definition: true,
      relation: 'value:observed_at', operands: [{ observation: { operation: entity('op'), occurrence: entity('call'), root: 'arguments', path: [], type } }] } }]);
    const idx = type.record ? select({ referent: entity('idx') }, { key: str('i') }) : { referent: entity('idx') };
    assert.throws(() => resolver.typeOf(select(list('int', int(7)), index(idx))), error => error.code === (type === 'dyn' ? 'value_type_unsupported' : 'value_selector_type_invalid'));
  }
});


test('inferred dynamic empty-list element cannot be an integer index', () => {
  const resolver = resolveValueDefinitions([]);
  const dynamicIndex = select({ literal: { listValue: { values: [] } } }, index(0));
  assert.equal(resolver.typeOf(dynamicIndex), 'dyn');
  assert.throws(() => resolver.typeOf(select(list('int', int(7)), index(dynamicIndex))), error =>
    error.code === 'value_selector_type_invalid' && JSON.stringify(error.details.use_path) === JSON.stringify(['selection', 'path', 0, 'index']));
});
