
import { createHash } from 'node:crypto';
import { literalType, valueCanonicalKey, valueFailure } from './controlled-values-v1.mjs';
export const valueName = value => `value_${createHash('sha256').update(valueCanonicalKey(value)).digest('hex').slice(0, 16)}`;
export const celString = value => JSON.stringify(value);
const double = value => /[.eE]/u.test(String(value)) ? String(value) : `${value}.0`;
const conjunction = parts => parts.length ? parts.map(part => `(${part})`).join(' && ') : 'true';
export function celLiteral(literal) {
  const [kind] = Object.keys(literal), value = literal[kind];
  switch (kind) {
    case 'boolValue': return String(value);
    case 'int64Value': return value;
    case 'doubleValue': return double(value);
    case 'stringValue': return celString(value);
    case 'nullValue': return 'null';
    case 'listValue': return `[${(value.values ?? []).map(celLiteral).join(', ')}]`;
    case 'mapValue': return `{${(value.entries ?? []).map(row => `${celLiteral(row.key)}: ${celLiteral(row.value)}`).join(', ')}}`;
    case 'objectValue': return `${literalType(literal)}(${celString(value.value)})`;
    default: throw new TypeError(`unhandled admitted CEL Value ${kind}`);
  }
}
export function celTypePredicate(expression, type, depth = 0) {
  expression = `dyn(${expression})`;
  if (type === 'dyn') return 'true';
  if (typeof type === 'string') return `type(${expression}) == ${type === 'timestamp' ? 'type(timestamp("1970-01-01T00:00:00Z"))' : type === 'duration' ? 'type(duration("0s"))' : type}`
    + (type === 'double' ? ` && math.isFinite(${expression})` : '');
  const key = `tk${depth}`, value = `tv${depth}`;
  if (type.one_of) return type.one_of.map(row => `(${celTypePredicate(expression, row, depth)})`).join(' || ');
  if (type.list) return `type(${expression}) == list ? ${expression}.all(${value}, ${celTypePredicate(value, type.list, depth + 1)}) : false`;
  if (type.map) return `type(${expression}) == map ? ${expression}.all(${key}, (${celTypePredicate(key, type.map.key, depth + 1)}) ? `
    + `(${celTypePredicate(`${expression}[${key}]`, type.map.value, depth + 1)}) : false) : false`;
  const names = type.record.fields.map(row => celString(row.name));
  const fields = type.record.fields.map(row => row.presence === 'required'
    ? `${celString(row.name)} in ${expression} ? (${celTypePredicate(`${expression}[${celString(row.name)}]`, row.type, depth + 1)}) : false`
    : `${celString(row.name)} in ${expression} ? (${celTypePredicate(`${expression}[${celString(row.name)}]`, row.type, depth + 1)}) : true`);
  return `type(${expression}) == map ? (${expression}.all(${key}, ${key} in [${names.join(', ')}]) && ${conjunction(fields)}) : false`;
}
export function celTypedEquality(a, b, type, depth = 0) {
  a = `dyn(${a})`; b = `dyn(${b})`;
  const shape = conjunction([celTypePredicate(a, type, depth), celTypePredicate(b, type, depth)]);
  if (type === 'dyn') return `type(${a}) == type(${b}) && ${a} == ${b}`;
  if (typeof type === 'string') return `(${shape}) ? ${a} == ${b} : false`;
  if (type.one_of) return type.one_of.map(row => `(${celTypedEquality(a, b, row, depth)})`).join(' || ');
  const key = `ek${depth}`, value = `ev${depth}`;
  if (type.list) return `(${shape}) ? (size(${a}) == size(${b}) ? ${a}.all(${key}, ${value}, ${celTypedEquality(value, `${b}[${key}]`, type.list, depth + 1)}) : false) : false`;
  if (type.map) return `(${shape}) ? (size(${a}) == size(${b}) ? ${a}.all(${key}, ${key} in ${b} ? (${celTypedEquality(`${a}[${key}]`, `${b}[${key}]`, type.map.value, depth + 1)}) : false) : false) : false`;
  const fields = type.record.fields.map(row => {
    const k = celString(row.name);
    return `(${k} in ${a}) == (${k} in ${b}) ? (${k} in ${a} ? (${celTypedEquality(`${a}[${k}]`, `${b}[${k}]`, row.type, depth + 1)}) : true) : false`;
  });
  return `(${shape}) ? (${conjunction(fields)}) : false`;
}
const pack = (value, valid = 'true', present = 'true') => `dyn({"value": (${valid}) ? ((${present}) ? dyn(${value}) : null) : null, "valid": (${valid}), "present": (${present})})`;
const unpack = (name, type, provenance = null) => ({ expression: `${name}.value`, valid: `${name}.valid`, present: `${name}.present`, type, provenance });
export function createValueLowering(resolved, { rootBinding, scopeBody, locals, bindAux }) {
  const select = (from, path, scope) => {
    let current = from;
    for (const step of path) {
      const key = step.field !== undefined ? { expression: celString(step.field), present: 'true', valid: 'true' }
        : value(step.index ?? step.key, scope);
      const isList = step.index !== undefined;
      const correctShape = `type(${current.expression}) == ${isList ? 'list' : 'map'}`;
      const exists = isList ? `${key.expression} >= 0 && ${key.expression} < size(${current.expression})`
        : `${key.expression} in ${current.expression}`;
      const valid = conjunction([current.valid, key.valid]);
      const present = `(${valid}) ? ((${current.present}) && (${key.present}) ? (${correctShape} ? (${exists}) : false) : false) : false`;
      const type = resolved.selectType(current.type, [step], scope);
      const token = pack(`(${present}) ? dyn(${current.expression}[${key.expression}]) : null`, valid, present);
      current = unpack(bindAux(scope, token), type, current.provenance);
    }
    return current;
  };
  function value(input, scope) {
    if (input.literal) return { expression: celLiteral(input.literal), type: literalType(input.literal), valid: 'true', present: 'true', provenance: null };
    if (input.referent) {
      const definition = resolved.lookup(input.referent, scope);
      if (!definition) valueFailure('value_definition_missing', input.referent, 'referent has no visible typed definition');
      return unpack(valueName(definition.key), definition.type, definition.provenance ?? provenance(definition.constraint, definition.scope));
    }
    if (input.local) {
      const binding = locals(scope, input.local);
      return { expression: `dyn(${binding.name})`, type: resolved.typeOf(input, scope), valid: 'true', present: 'true', provenance: binding.provenance ?? null };
    }
    if (input.selection) return select(value(input.selection.from, scope), input.selection.path, scope);
    const children = input.list ? input.list.items.map(row => value(row, scope))
      : input.record ? input.record.fields.map(row => value(row.value, scope))
        : input.map.entries.flatMap(row => [value(row.key, scope), value(row.value, scope)]);
    const expression = input.list ? `[${children.map(row => row.expression).join(', ')}]`
      : input.record ? `{${input.record.fields.map((row, i) => `${celString(row.name)}: ${children[i].expression}`).join(', ')}}`
        : `{${input.map.entries.map((_, i) => `${children[i * 2].expression}: ${children[i * 2 + 1].expression}`).join(', ')}}`;
    return { expression, type: resolved.typeOf(input, scope), valid: conjunction(children.flatMap(row => [row.valid, row.present])), present: 'true', provenance: null };
  }
  function provenance(row, scope) {
    if (row.relation === 'value:filter_over') return value(row.operands[0].value, scope).provenance;
    if (row.relation === 'value:map_over') return value(row.operands[2].value, row.operands[1].binding.scope).provenance;
    if (row.relation === 'value:observed_at' && row.operands[0].observation.root === 'events') {
      const o = row.operands[0].observation;
      return { operation: o.operation, occurrence: o.occurrence, root: o.root };
    }
    if (row.relation === 'value:equals') {
      const input = row.operands[0].value;
      if (input.local) return locals(scope, input.local).provenance ?? null;
      if (input.selection) return value(input.selection.from, scope).provenance;
      if (input.referent) {
        const definition = resolved.lookup(input.referent, scope);
        return definition ? provenance(definition.constraint, definition.scope) : null;
      }
    }
    return null;
  }
  function result(row, scope = row.within ?? null) {
    if (row.relation === 'value:observed_at') {
      const o = row.operands[0].observation;
      const binding = rootBinding(o);

      let selected = { expression: `${binding.name}.data`, valid: 'true', present: 'true',
        type: binding.root_type, provenance: provenance(row, scope) };
      selected = select(selected, o.path, scope);
      return { ...selected, type: o.type, valid: `(${selected.present}) ? (${celTypePredicate(selected.expression, o.type)}) : true` };
    }
    const op = row.relation.slice(6);
    if (['exists_in', 'map_over', 'filter_over'].includes(op)) {
      const domain = value(row.operands[0].value, scope), b = row.operands[1].binding;
      const body = value(row.operands[2].value, b.scope);
      const slots = locals(b.scope, null);
      const inside = scopeBody(b.scope, pack(body.expression, body.valid, body.present), { capture: true });
      const mapped = `${domain.expression}.transformList(${slots.first}, ${slots.value}, dyn({"body": ${inside}, "member": ${domain.type.list ? slots.value : slots.first}}))`;
      const name = bindAux(scope, pack(mapped, conjunction([domain.valid, domain.present])));
      const items = `${name}.value`;
      const expression = op === 'exists_in' ? `${items}.exists(mt, mt.body.value)`
        : op === 'map_over' ? `${items}.map(mt, mt.body.value)`
          : `${items}.filter(mt, mt.body.value).map(mt, mt.member)`;
      return { expression, type: resolved.resultType(row),
        valid: `(${name}.valid) ? ${items}.all(mt, mt.body.valid && mt.body.present && mt.body.obligations) : false`,
        present: 'true', provenance: op === 'filter_over' ? domain.provenance : op === 'map_over' ? body.provenance : null };
    }
    const values = row.operands.filter(operand => operand.value).map(operand => value(operand.value, scope));
    const [a, b, c] = values;
    const type = resolved.resultType(row);
    let expression, valid = conjunction(values.flatMap(row => [row.valid, row.present]));
    const binary = { add: '+', subtract: '-', multiply: '*', divide: '/', remainder: '%', less_than: '<',
      less_or_equal: '<=', greater_than: '>', greater_or_equal: '>=', all_true: '&&', any_true: '||',
      timestamp_difference: '-', duration_add: '+' };
    if (binary[op]) expression = `(${a.expression}) ${binary[op]} (${b.expression})`;
    else if (op === 'contains') expression = `${a.expression}.contains(${b.expression})`;
    else if (op === 'equal_to') expression = celTypedEquality(a.expression, b.expression, a.type);
    else if (op === 'equals' || op === 'not_equals') expression = a.expression;
    else if (op === 'negate' || op === 'not') expression = `${op === 'not' ? '!' : '-'}(${a.expression})`;
    else if (op === 'choose') {
      expression = `(${a.expression}) ? (${b.expression}) : (${c.expression})`;
      valid = `(${a.valid}) && (${a.present}) ? ((${a.expression}) ? ((${b.valid}) && (${b.present})) : ((${c.valid}) && (${c.present}))) : false`;
    } else if (op === 'size') expression = `size(${a.expression})`;
    else if (op === 'present') { expression = a.present; valid = a.valid; }
    else if (op === 'type_is') { expression = `(${a.present}) ? (${celTypePredicate(a.expression, row.operands[1].type)}) : false`; valid = a.valid; }
    else if (op === 'substring') expression = `${a.expression}.substring(${b.expression}, ${c.expression})`;
    else if (op === 'sum') expression = `size(${a.expression}) == 0 ? ${type === 'double' ? '0.0' : '0'} : ${a.expression}.map(sum_value, ${type}(sum_value)).sum()`;
    else throw new TypeError(`no fixed lowering for ${row.relation}`);
    if (op === 'divide' && type === 'double') valid = `(${valid}) ? math.isFinite(${expression}) : false`;
    return { expression, valid, present: 'true', type, provenance: provenance(row, scope) };
  }
  const token = row => { const lowered = result(row); return pack(lowered.expression, lowered.valid, lowered.present); };
  return { value, result, token, provenance, pack, unpack };
}
