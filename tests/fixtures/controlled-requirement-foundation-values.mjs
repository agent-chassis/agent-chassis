
import { normalizeCelValue } from '@agent-chassis/controlled-contract/controlled-values-v1';
export const int = n => ({ literal: { int64Value: String(n) } });
export const dbl = n => ({ literal: { doubleValue: n } });
export const str = s => ({ literal: { stringValue: s } });
export const bool = b => ({ literal: { boolValue: b } });
export const nil = () => ({ literal: { nullValue: null } });
export const ref = referent => ({ referent });
export const local = name => ({ local: name });
export const list = (type, ...items) => ({ list: { element_type: type, items } });
export const record = fields => ({ record: { fields: Object.entries(fields).map(([name, value]) => ({ name, value })) } });
export const recordType = (fields, optional = []) => ({ record: { fields: Object.entries(fields).map(([name, type]) => ({ name, type, presence: optional.includes(name) ? 'optional' : 'required' })) } });
export const select = (from, ...path) => ({ selection: { from, path } });
export const field = name => ({ field: name });
export const index = n => ({ index: typeof n === 'object' ? n : int(n) });
export const key = k => ({ key: typeof k === 'object' ? k : str(k) });
export const definition = (subject, relation, objects, more = {}) => ({ subject, definition: true, behavior: { relation: `value:${relation}`, objects: objects.map(value => ({ value })) }, ...more });
export const observed = (subject, root, path, type, more = {}) => ({ subject, definition: true,
  behavior: { relation: 'value:observed_at', objects: [{ observation: { operation: 'op', occurrence: 'call', root, path, type, ...more } }] } });
export const must = (subject, relation, objects, more = {}) => ({ subject, modality: 'MUST', behavior: { relation: `value:${relation}`, objects: objects.map(value => ({ value })), ...(more.applies ? { applies: more.applies } : {}) },
  ...Object.fromEntries(Object.entries(more).filter(([name]) => name !== 'applies')) });
export const entitiesOf = rows => {
  const names = new Set(['op', 'call']), operations = new Set(['op']), eventNames = new Set(['call']);
  const walk = node => { if (node?.behavior && ['reference:precedes', 'reference:follows'].includes(node.behavior.relation)) { eventNames.add(node.subject); node.behavior.objects.forEach(row => eventNames.add(row.referent)); } if (Array.isArray(node)) node.forEach(walk); else if (node && typeof node === 'object' && !node.literal) for (const [name, value] of Object.entries(node)) {
    if (['subject', 'referent', 'operation', 'occurrence', 'boundary'].includes(name) && typeof value === 'string') { names.add(value); if (name === 'operation') operations.add(value); if (name === 'occurrence') eventNames.add(value); }
    else if (name === 'context') value.forEach(id => names.add(id)); else walk(value);
  } };
  walk(rows);
  return Object.fromEntries([...names].map(name => [name, operations.has(name) ? 'cc:operation' : eventNames.has(name) ? 'cc:event' : 'cc:entity']));
};

export function actual(value) {
  if (value?.$cel) return normalizeCelValue(value.$cel);
  if (typeof value === 'bigint') return { int64Value: String(value) };
  if (typeof value === 'number') return { doubleValue: value };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { boolValue: value };
  if (value === null) return { nullValue: null };
  if (Array.isArray(value)) return { listValue: { values: value.map(actual) } };
  if (value instanceof Map) return { mapValue: { entries: [...value].map(([key, value]) => ({ key: actual(key), value: actual(value) })) } };
  return { mapValue: { entries: Object.entries(value).map(([key, value]) => ({ key: actual(key), value: actual(value) })) } };
}
export const rootValue = data => normalizeCelValue(actual({ data }));
export const time = value => ({ $cel: { objectValue: { '@type': 'type.googleapis.com/google.protobuf.Timestamp', value } } });
export const payload = data => ({ state: 'normal', payload_present: true, payload: data, terminal_at: time('2026-01-01T00:00:01Z') });

export const absentPayload = () => ({ state: 'normal', payload_present: false, terminal_at: time('2026-01-01T00:00:01Z') });
