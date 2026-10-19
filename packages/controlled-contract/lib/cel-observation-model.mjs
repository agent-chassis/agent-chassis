

export const CEL_REFERENCE = 'https://github.com/cel-expr/cel-spec/blob/cb51b4176013ad19bd00df94be273c322916a620/doc/langdef.md';

export const MEMBER_OBSERVATION = Object.freeze({ type: 'list<string>',
  meaning: 'the members present in the population, as supplied; order and repetition carry no meaning' });

import { VALUE_PRIMITIVES, normalizeCelValue, valueFailure } from './controlled-values-v1.mjs';
export { VALUE_PRIMITIVES };
const primitive = Object.freeze({ bool: 'BOOL', int: 'INT64', double: 'DOUBLE', string: 'STRING' });
export function celTypeDescriptor(type) {
  if (Object.hasOwn(primitive, type)) return { primitive: primitive[type] };
  if (type === 'null_type') return { null: null };
  if (type === 'timestamp' || type === 'duration') return { wellKnown: type.toUpperCase() };
  if (type === 'dyn' || type?.one_of) return { dyn: {} };
  if (typeof type === 'string' && /^list<.*>$/u.test(type)) return celTypeDescriptor({ list: type.slice(5, -1) });
  if (type?.list) return { listType: { elemType: celTypeDescriptor(type.list) } };
  if (type?.record) return { mapType: { keyType: celTypeDescriptor('string'), valueType: celTypeDescriptor('dyn') } };
  if (type?.map) return { mapType: { keyType: celTypeDescriptor(type.map.key), valueType: celTypeDescriptor(type.map.value) } };
  valueFailure('value_cel_type_unsupported', 'type', `no CEL descriptor for ${JSON.stringify(type)}`);
}

export function observationValue(value, actualType) {
  if (typeof actualType === 'string' && /^list<.*>$/u.test(actualType)) actualType = { list: actualType.slice(5, -1) };
  if (actualType?.list) return normalizeCelValue({ listValue: { values: value.map(row => observationValue(row, actualType.list)) } });
  if (actualType?.map) return normalizeCelValue({ mapValue: { entries: [...value].map(([key, entry]) => ({
    key: observationValue(key, actualType.map.key), value: observationValue(entry, actualType.map.value) })) } });
  const kind = { bool: 'boolValue', int: 'int64Value', double: 'doubleValue', string: 'stringValue', null_type: 'nullValue' }[actualType];
  if (kind) return normalizeCelValue({ [kind]: actualType === 'int' ? String(value) : value });
  if (['timestamp', 'duration'].includes(actualType)) return normalizeCelValue({ objectValue: {
    '@type': `type.googleapis.com/google.protobuf.${actualType === 'timestamp' ? 'Timestamp' : 'Duration'}`, value } });
  valueFailure('value_observation_type_unknown', 'fixture', 'declare the actual supplied type or supply CEL Value data directly');
}

export function observationCases(variables, cases) {
  const actual = new Map(variables.map(row => [row.name, row.type]));
  return Object.fromEntries(Object.entries(cases).map(([name, bindings]) => [name,
    Object.fromEntries(Object.entries(bindings).map(([key, value]) => [key, observationValue(value, actual.get(key))]))]));
}

export const VALUE_CEL_ENVIRONMENT = Object.freeze({
  type_format: 'cel.expr.Type ProtoJSON', value_format: 'cel.expr.Value restricted ProtoJSON',
  extension_functions: { bindings: ['bind'], strings: ['substring'], math: ['isFinite'],
    comprehensions: ['all(index,value,predicate)', 'exists(index,value,predicate)', 'transformList(index,value,body)'],
    'kubernetes.lists': ['list_int_sum_int', 'list_double_sum_double'] },
  portability: { minimum_nested_function_calls: 12, authoring_cap: null, host_capacity: 'observed_by_evaluator' }
});
