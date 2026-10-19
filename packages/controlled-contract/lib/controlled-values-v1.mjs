
import { fromJson, protoInt64 } from '@bufbuild/protobuf';
import { DurationSchema, TimestampSchema } from '@bufbuild/protobuf/wkt';

export const VALUE_PRIMITIVES = Object.freeze(['bool', 'string', 'null_type', 'int', 'double', 'timestamp', 'duration']);
export const VALUE_KEY_TYPES = Object.freeze(['bool', 'int', 'string']);
export const OBSERVATION_ROOTS = Object.freeze(['arguments', 'completion', 'settlement', 'before', 'after', 'events', 'timing']);
export const VALUE_SCHEMA_DEFINITIONS = Object.freeze(['value_reference', 'value_local', 'value_scope', 'value_binding',
  'value_type', 'value_literal', 'typed_value', 'value_path', 'value_observation', 'value_operand', 'value_for_each']);

export function projectValueDefinitions(definitions, { reference, prefix = '', lexicalNames = true } = {}) {
  const project = node => Array.isArray(node) ? node.map(project) : node && typeof node === 'object'
    ? Object.fromEntries(Object.entries(node).map(([key, value]) => [key,
      key === '$ref' && VALUE_SCHEMA_DEFINITIONS.includes(value.split('/').at(-1))
        ? `#/$defs/${prefix}${value.split('/').at(-1)}` : project(value)])) : node;
  const projected = Object.fromEntries(VALUE_SCHEMA_DEFINITIONS.map(name => [prefix + name, project(definitions[name])]));
  projected[prefix + 'value_reference'] = { ...structuredClone(reference),
    description: definitions.value_reference.description };
  if (lexicalNames) {
    projected[prefix + 'value_local'] = { type: 'string', minLength: 1,
      description: 'A local name resolved in the current lexical scope or its ancestors to a bound iteration value.' };
    projected[prefix + 'value_scope'] = { type: 'string', minLength: 1,
      description: 'A lexical scope label. A definition uses within to select this scope, making its locals and ancestor locals visible.' };
    const bind = { type: 'object', additionalProperties: false, required: ['value'],
      description: definitions.value_binding.properties.bind.description, properties: {
        key: { type: 'string', minLength: 1, description: 'Local name for each map key.' },
        index: { type: 'string', minLength: 1, description: 'Local name for each zero-based list index.' },
        value: { type: 'string', minLength: 1, description: 'Local name for each element value.' } } };
    projected[prefix + 'value_binding'].properties.bind = structuredClone(bind);
    projected[prefix + 'value_for_each'].items.properties.bind = structuredClone(bind);
  }
  return projected;
}
export class ControlledValueError extends TypeError {
  constructor(code, subject, cause, recovery) {
    super(`${code} at ${typeof subject === 'string' ? subject : JSON.stringify(subject)}: ${cause}`);
    this.code = code;
    this.details = { subject, cause, effects: { changed: false }, actor: 'requirement_author', recovery };
  }
}
export const valueFailure = (code, subject, cause, recovery = 'Correct this declared value or type and resubmit the requirement.') => {
  throw new ControlledValueError(code, subject, cause, recovery);
};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const valueCanonicalKey = value => JSON.stringify(canonical(value));
function canonical(value) {
  return Array.isArray(value) ? value.map(canonical) : object(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
}
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function fields(value, allowed, required, at) {
  if (!object(value)) valueFailure('value_shape_invalid', at, 'expected an object');
  const extra = Object.keys(value).filter(key => !allowed.includes(key));
  const absent = required.filter(key => !Object.hasOwn(value, key));
  if (extra.length || absent.length) valueFailure('value_shape_invalid', at, `extra [${extra}], missing [${absent}]`);
}
export function scalarString(value, at = 'string') {
  if (typeof value !== 'string' || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) {
    valueFailure('value_string_invalid', at, 'expected a Unicode scalar sequence');
  }
  return value;
}
const unique = (values, at) => {
  if (new Set(values).size !== values.length) valueFailure('value_duplicate_key', at, 'duplicate semantic keys or field names');
};
export function normalizeValueType(type, at = 'type') {
  if (typeof type === 'string') {
    if (!VALUE_PRIMITIVES.includes(type)) valueFailure('value_type_unsupported', at, `unsupported type ${type}`);
    return type;
  }
  fields(type, ['list', 'map', 'record', 'one_of'], [], at);
  if (Object.keys(type).length !== 1) valueFailure('value_type_invalid', at, 'exactly one type constructor is required');
  if (Object.hasOwn(type, 'list')) return { list: normalizeValueType(type.list, `${at}.list`) };
  if (type.map) {
    fields(type.map, ['key', 'value'], ['key', 'value'], at);
    if (!VALUE_KEY_TYPES.includes(type.map.key)) valueFailure('value_map_key_type_invalid', at, 'map keys must be bool, int or string');
    return { map: { key: type.map.key, value: normalizeValueType(type.map.value, `${at}.map.value`) } };
  }
  if (type.record) {
    fields(type.record, ['fields'], ['fields'], at);
    if (!Array.isArray(type.record.fields)) valueFailure('value_type_invalid', at, 'record fields must be an array');
    const rows = type.record.fields.map((row, i) => {
      fields(row, ['name', 'type', 'presence'], ['name', 'type', 'presence'], `${at}.fields[${i}]`);
      if (!['required', 'optional'].includes(row.presence)) valueFailure('value_presence_invalid', at, 'required or optional presence is required');
      return { name: scalarString(row.name, at), type: normalizeValueType(row.type, `${at}.${row.name}`), presence: row.presence };
    });
    unique(rows.map(row => row.name), at);
    return { record: { fields: rows.sort((a, b) => compare(a.name, b.name)) } };
  }
  if (!Array.isArray(type.one_of) || type.one_of.length < 2) valueFailure('value_union_invalid', at, 'a union needs at least two distinct alternatives');
  const alternatives = type.one_of.map((row, i) => {
    const normalized = normalizeValueType(row, `${at}.one_of[${i}]`);
    if (normalized?.one_of) valueFailure('value_union_redundant', at, 'nested unions are not admitted');
    return normalized;
  });
  unique(alternatives.map(valueCanonicalKey), at);
  return { one_of: alternatives.sort((a, b) => compare(valueCanonicalKey(a), valueCanonicalKey(b))) };
}

const LITERAL_KINDS = Object.freeze({ boolValue: 'bool', stringValue: 'string', nullValue: 'null_type',
  int64Value: 'int', doubleValue: 'double', listValue: 'list', mapValue: 'map', objectValue: 'object' });
export function normalizeCelValue(value, at = 'literal') {
  fields(value, Object.keys(LITERAL_KINDS), [], at);
  const names = Object.keys(value);
  if (names.length !== 1) valueFailure('value_kind_missing_or_ambiguous', at, 'exactly one admitted lowerCamelCase CEL Value kind is required');
  const [kind] = names, payload = value[kind];
  if (kind === 'int64Value') {
    if (typeof payload !== 'string' || !/^(0|-?[1-9][0-9]*)$/u.test(payload)) valueFailure('value_int64_invalid', at, 'int64 must be a canonical decimal string');
    try {
      const parsed = protoInt64.parse(payload);
      if (BigInt(parsed) < -9223372036854775808n || BigInt(parsed) > 9223372036854775807n) throw new RangeError('outside signed int64');
    } catch (cause) { valueFailure('value_int64_out_of_range', at, cause.message); }
  } else if (kind === 'doubleValue') {
    if (typeof payload !== 'number' || !Number.isFinite(payload)) valueFailure('value_double_non_finite', at, 'double must be a finite binary64 number');
  } else if (kind === 'boolValue') {
    if (typeof payload !== 'boolean') valueFailure('value_bool_invalid', at, 'boolValue must be Boolean');
  } else if (kind === 'stringValue') scalarString(payload, at);
  else if (kind === 'nullValue') {
    if (payload !== null) valueFailure('value_null_invalid', at, 'the admitted NullValue spelling is null');
  } else if (kind === 'listValue') {
    fields(payload, ['values'], [], at);
    if (payload.values !== undefined && !Array.isArray(payload.values)) valueFailure('value_list_invalid', at, 'values must be an array');
    return { listValue: { values: (payload.values ?? []).map((v, i) => normalizeCelValue(v, `${at}[${i}]`)) } };
  } else if (kind === 'mapValue') {
    fields(payload, ['entries'], [], at);
    if (payload.entries !== undefined && !Array.isArray(payload.entries)) valueFailure('value_map_invalid', at, 'entries must be an array');
    const entries = (payload.entries ?? []).map((entry, i) => {
      fields(entry, ['key', 'value'], ['key', 'value'], `${at}[${i}]`);
      const key = normalizeCelValue(entry.key, `${at}[${i}].key`);
      if (!VALUE_KEY_TYPES.includes(literalType(key))) valueFailure('value_map_key_type_invalid', at, 'map key must be bool, int or string');
      return { key, value: normalizeCelValue(entry.value, `${at}[${i}].value`) };
    });
    unique(entries.map(entry => valueCanonicalKey(entry.key)), at);
    return { mapValue: { entries: entries.sort((a, b) => compare(valueCanonicalKey(a.key), valueCanonicalKey(b.key))) } };
  } else if (kind === 'objectValue') {
    fields(payload, ['@type', 'value'], ['@type', 'value'], at);
    const schema = payload['@type'] === 'type.googleapis.com/google.protobuf.Timestamp' ? TimestampSchema
      : payload['@type'] === 'type.googleapis.com/google.protobuf.Duration' ? DurationSchema : null;
    if (!schema) valueFailure('value_any_type_unsupported', at, `unsupported Any ${payload['@type']}`);
    try { fromJson(schema, payload.value); } catch (cause) { valueFailure('value_time_literal_invalid', at, cause.message); }
  }
  return structuredClone(value);
}
const union = types => {
  const distinct = [...new Map(types.map(type => [valueCanonicalKey(type), type])).values()];
  return distinct.length === 0 ? 'dyn' : distinct.length === 1 ? distinct[0] : { one_of: distinct };
};
export function literalType(value) {
  const [kind] = Object.keys(value);
  if (kind === 'listValue') return { list: union((value.listValue.values ?? []).map(literalType)) };
  if (kind === 'mapValue') return { map: { key: union((value.mapValue.entries ?? []).map(row => literalType(row.key))),
    value: union((value.mapValue.entries ?? []).map(row => literalType(row.value))) } };
  if (kind === 'objectValue') return value.objectValue['@type'].endsWith('Timestamp') ? 'timestamp' : 'duration';
  return LITERAL_KINDS[kind];
}

export function mapValueReferences(value, map) {
  if (Array.isArray(value)) return value.map(row => mapValueReferences(row, map));
  if (!object(value)) return value;
  if (Object.hasOwn(value, 'literal') || (Object.hasOwn(value, 'type') && Object.keys(value).length === 1)) return structuredClone(value);
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
    ['type', 'element_type', 'value_type'].includes(key) ? structuredClone(child) : ['referent', 'operation', 'occurrence', 'subject', 'boundary', 'owner'].includes(key)
      ? map(child) : key === 'record' ? { fields: child.fields.map(row => ({ name: row.name, value: mapValueReferences(row.value, map) })) }
        : mapValueReferences(child, map)]));
}
export function valueReferences(value) {
  const references = [];
  mapValueReferences(value, reference => { references.push(reference); return reference; });
  return references;
}
export function normalizeValue(value, at = 'value') {
  fields(value, ['literal', 'referent', 'local', 'list', 'record', 'map', 'selection'], [], at);
  if (Object.keys(value).length !== 1) valueFailure('value_shape_invalid', at, 'exactly one value form is required');
  if (Object.hasOwn(value, 'literal')) return { literal: normalizeCelValue(value.literal, at) };
  if (Object.hasOwn(value, 'referent') || Object.hasOwn(value, 'local')) return structuredClone(value);
  if (value.list) {
    fields(value.list, ['element_type', 'items'], ['element_type', 'items'], at);
    if (!Array.isArray(value.list.items)) valueFailure('value_list_invalid', at, 'items must be an array');
    return { list: { element_type: normalizeValueType(value.list.element_type, at), items: value.list.items.map((row, i) => normalizeValue(row, `${at}[${i}]`)) } };
  }
  if (value.record) {
    fields(value.record, ['fields'], ['fields'], at);
    if (!Array.isArray(value.record.fields)) valueFailure('value_shape_invalid', at, 'record fields must be an array');
    const rows = value.record.fields.map(row => { fields(row, ['name', 'value'], ['name', 'value'], at);
      return { name: scalarString(row.name, at), value: normalizeValue(row.value, `${at}.${row.name}`) }; });
    unique(rows.map(row => row.name), at);
    return { record: { fields: rows.sort((a, b) => compare(a.name, b.name)) } };
  }
  if (value.map) {
    fields(value.map, ['key_type', 'value_type', 'entries'], ['key_type', 'value_type', 'entries'], at);
    if (!VALUE_KEY_TYPES.includes(value.map.key_type)) valueFailure('value_map_key_type_invalid', at, 'map keys must be bool, int or string');
    if (!Array.isArray(value.map.entries)) valueFailure('value_shape_invalid', at, 'map entries must be an array');
    const entries = value.map.entries.map(row => { fields(row, ['key', 'value'], ['key', 'value'], at);
      return { key: normalizeValue(row.key, `${at}.key`), value: normalizeValue(row.value, `${at}.value`) }; });
    unique(entries.map(row => valueCanonicalKey(row.key)), at);
    return { map: { key_type: value.map.key_type, value_type: normalizeValueType(value.map.value_type, at),
      entries: entries.sort((a, b) => compare(valueCanonicalKey(a.key), valueCanonicalKey(b.key))) } };
  }
  fields(value.selection, ['from', 'path'], ['from', 'path'], at);
  return { selection: { from: normalizeValue(value.selection.from, at), path: normalizeValuePath(value.selection.path, at) } };
}
export function normalizeValuePath(path, at = 'path') {
  if (!Array.isArray(path)) valueFailure('value_selector_invalid', at, 'selection path must be an ordered array');
  return path.map((step, i) => {
    fields(step, ['field', 'key', 'index'], [], `${at}[${i}]`);
    const [kind] = Object.keys(step);
    if (Object.keys(step).length !== 1) valueFailure('value_selector_invalid', at, 'one selector kind is required');
    if (kind === 'field') return { field: scalarString(step.field, at) };
    const selected = normalizeValue(step[kind], at);
    if (selected.literal && (kind === 'index' ? literalType(selected.literal) !== 'int' : !VALUE_KEY_TYPES.includes(literalType(selected.literal)))) {
      valueFailure('value_selector_type_invalid', at, kind === 'index' ? 'index must be int' : 'key must be bool, int or string');
    }
    return { [kind]: selected };
  });
}
export function normalizeObservation(observation, at = 'observation') {
  fields(observation, ['operation', 'occurrence', 'root', 'snapshot', 'path', 'type'], ['operation', 'occurrence', 'root', 'path', 'type'], at);
  if (!OBSERVATION_ROOTS.includes(observation.root)) valueFailure('value_observation_root_invalid', at, `unknown root ${observation.root}`);
  if (['before', 'after'].includes(observation.root) !== Object.hasOwn(observation, 'snapshot')) valueFailure('value_snapshot_metadata_invalid', at,
    'snapshot subject/boundary are required exactly for before/after');
  if (observation.snapshot) fields(observation.snapshot, ['subject', 'boundary'], ['subject', 'boundary'], at);
  return { ...structuredClone(observation), path: normalizeValuePath(observation.path, at), type: normalizeValueType(observation.type, at) };
}
export function normalizeValueOperand(operand, at = 'operand') {
  const keys = Object.keys(operand);
  if (keys.length !== 1) valueFailure('value_operand_payload_invalid', at, 'exactly one positional payload is required');
  if (operand.value !== undefined) return { value: normalizeValue(operand.value, at) };
  if (operand.type !== undefined) return { type: normalizeValueType(operand.type, at) };
  if (operand.observation !== undefined) return { observation: normalizeObservation(operand.observation, at) };
  if (operand.binding !== undefined) return { binding: structuredClone(operand.binding) };
  valueFailure('value_operand_payload_invalid', at, `unsupported payload ${keys[0]}`);
}
