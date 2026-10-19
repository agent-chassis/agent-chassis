
import { CONTROLLED_VALUE_OPERATORS } from '../vocabulary/controlled-value-operators.v1.mjs';
import { identityOf } from './canonical-specification.mjs';
import { ControlledValueError, VALUE_KEY_TYPES, literalType, mapValueReferences, normalizeObservation, normalizeValue, normalizeValueType,
  valueCanonicalKey, valueFailure, valueReferences } from './controlled-values-v1.mjs';
const operators = new Map(CONTROLLED_VALUE_OPERATORS.map(row => [row.term, row]));
const identity = entity => valueCanonicalKey(entity.identity);
export const lexicalScopeKey = scope => scope ? valueCanonicalKey(scope) : '';
const equalType = (a, b) => valueCanonicalKey(a) === valueCanonicalKey(b);
export function compatibleValueTypes(a, b) {
  if (equalType(a, b) || a === 'dyn' || b === 'dyn') return true;
  if (a?.one_of) return a.one_of.some(type => compatibleValueTypes(type, b));
  if (b?.one_of) return b.one_of.some(type => compatibleValueTypes(a, type));
  if (a?.list && b?.list) return compatibleValueTypes(a.list, b.list);
  if (a?.map && b?.map) return compatibleValueTypes(a.map.key, b.map.key) && compatibleValueTypes(a.map.value, b.map.value);
  if (a?.record && b?.record) {
    const left = new Map(a.record.fields.map(row => [row.name, row])), right = new Map(b.record.fields.map(row => [row.name, row]));
    return [...new Set([...left.keys(), ...right.keys()])].every(name => left.has(name) && right.has(name)
      ? compatibleValueTypes(left.get(name).type, right.get(name).type)
      : (left.get(name) ?? right.get(name)).presence === 'optional');
  }
  return false;
}

export function createValueScopeNormalizer(rows, bindings) {
  const scopes = new Map(), locals = new Set();
  const subject = row => bindings.get(row.subject);
  const register = (declaration, row, parents, path) => {
    if (scopes.has(declaration.scope)) valueFailure('value_scope_duplicate', declaration.scope, 'scope has two declaring rows');
    if (!declaration.bind || typeof declaration.bind.value !== 'string') valueFailure('value_binding_invalid', declaration.scope, 'value binder is required');
    const slots = Object.keys(declaration.bind);
    if (slots.some(slot => !['key', 'index', 'value'].includes(slot)) || (slots.includes('key') && slots.includes('index'))) {
      valueFailure('value_binding_invalid', declaration.scope, 'map key or list index plus value is admitted');
    }
    for (const local of Object.values(declaration.bind)) {
      if (locals.has(local) || bindings.has(local)) valueFailure('value_local_shadowing', local, 'duplicate local or entity shadowing');
      locals.add(local);
    }
    const scope = { owner: structuredClone(subject(row)), path };
    const entry = { scope, bind: declaration.bind, parents, domain: declaration.domain, declaration, row };
    scopes.set(declaration.scope, entry);
    return entry;
  };
  const pending = [...rows];
  while (pending.length) {
    const at = pending.findIndex(row => row.within === undefined || scopes.has(row.within));
    if (at < 0) valueFailure('value_scope_unknown', pending[0].within, 'scope is unknown or cyclic');
    const [row] = pending.splice(at, 1);
    const inherited = row.within === undefined ? [] : [...scopes.get(row.within).parents, scopes.get(row.within)];
    const parents = [...inherited];
    for (const [index, declaration] of (row.for_each ?? []).entries()) parents.push(register(declaration, row, [...parents], Array.from({ length: index + 1 }, (_, i) => i)));
    const op = operators.get(row.behavior?.relation);
    if (op?.signature.positional_payloads.includes('binding')) {
      const declaration = row.behavior.objects[1];
      register({ ...declaration, domain: row.behavior.objects[0].value }, row, inherited, [0]);
    }
  }
  const visible = row => {
    if (row.for_each?.length) {
      const entry = scopes.get(row.for_each.at(-1).scope);
      return [...entry.parents, entry];
    }
    if (row.within !== undefined) {
      const scope = scopes.get(row.within);
      if (!scope) valueFailure('value_scope_unknown', row.within, 'within must select a declared scope');
      return [...scope.parents, scope];
    }
    return (row.for_each ?? []).map(declaration => scopes.get(declaration.scope));
  };
  const rewriteLocals = (value, context, at) => {
    if (Array.isArray(value)) return value.map(row => rewriteLocals(row, context, at));
    if (value === null || typeof value !== 'object' || value.literal || (value.type && Object.keys(value).length === 1)) return structuredClone(value);
    if (Object.hasOwn(value, 'local')) {
      for (let depth = 0; depth < context.length; depth += 1) {
        const binding = context[context.length - depth - 1].bind;
        const slot = Object.keys(binding).find(slot => binding[slot] === value.local);
        if (slot) return { local: { depth, slot } };
      }
      valueFailure('value_local_out_of_scope', at, `local ${value.local} is outside its lexical scope`);
    }
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
      ['type', 'element_type', 'value_type'].includes(key) ? structuredClone(child) : rewriteLocals(child, context, at)]));
  };
  const normalize = (row, mapReference = id => {
    if (!bindings.has(id)) valueFailure('value_reference_unknown', id, 'declare or select the exact entity');
    return structuredClone(bindings.get(id));
  }) => {
    const context = visible(row);
    const convert = (value, active = context) => mapValueReferences(rewriteLocals(value, active, row.subject), mapReference);
    const objects = row.behavior?.objects?.map((operand, index) => {
      const payload = operators.get(row.behavior.relation)?.signature.positional_payloads[index];
      if (!payload) return structuredClone(operand);
      if (payload === 'binding') {
        const entry = scopes.get(operand.scope);
        if (!entry) valueFailure('value_scope_unknown', operand.scope, 'binding scope is not declared');
        return { binding: { scope: entry.scope, bind: Object.fromEntries(Object.keys(entry.bind).map(slot => [slot, slot])) } };
      }
      if (Object.keys(operand).length !== 1 || !Object.hasOwn(operand, payload)) valueFailure('value_operand_payload_invalid', row.subject,
        `position ${index} requires ${payload}`);
      if (payload === 'type') return { type: normalizeValueType(operand.type) };
      if (payload === 'observation') return { observation: convert(normalizeObservation(operand.observation)) };
      return { value: convert(normalizeValue(operand.value)) };
    });
    const forEach = row.for_each?.map(declaration => {
      const entry = scopes.get(declaration.scope);
      return { scope: entry.scope, domain: convert(normalizeValue(declaration.domain), entry.parents),
        bind: Object.fromEntries(Object.keys(entry.bind).map(slot => [slot, slot])) };
    });
    return { ...(objects ? { objects } : {}), ...(forEach ? { for_each: forEach } : {}),
      ...(row.within === undefined ? {} : { within: scopes.get(row.within).scope }) };
  };
  const decorated = new Set(), occurrences = new Map();
  const decorate = entry => {
    if (decorated.has(entry)) return;
    entry.parents.forEach(decorate);
    const row = entry.row;
    const reference = id => structuredClone(bindings.get(id));
    const rowMeaning = row => {
      const normalized = normalize(row), context = visible(row);
      return { subject: subject(row), definition: row.definition === true,
        ...(row.definition ? {} : { modality: row.modality, nature: row.nature ?? 'behavior' }),
        relation: row.behavior?.relation ?? 'closed_membership',
        operands: (normalized.objects ?? []).map((operand, position) => operand.binding
          ? { binding: { position, bind: operand.binding.bind } }
          : operand.referent ? { reference: reference(operand.referent) } : operand),
        ...(row.membership ? { clauses: mapValueReferences(rewriteLocals(row.membership, context, row.subject), reference) } : {}),
        applies: { ...(row.behavior?.applies ?? row.applies ?? { mode: 'unconditional' }),
          context: (row.behavior?.applies?.context ?? row.applies?.context ?? []).map(reference) },
        domains: (normalized.for_each ?? []).map(({ scope: _scope, ...declaration }) => declaration),
      };
    };
    const meaning = { ...rowMeaning(row), ancestry: entry.parents.map(parent => parent.scope), position: entry.scope.path };
    const declaration = identityOf('value_scope', meaning), occurrence = occurrences.get(declaration) ?? 0;
    occurrences.set(declaration, occurrence + 1);
    entry.scope.declaration = identityOf('value_scope', { declaration, occurrence });
    decorated.add(entry);
  };
  for (const entry of scopes.values()) decorate(entry);
  return { normalize, scopes };
}

export function resolveValueDefinitions(rows) {
  const definitions = new Map(), scopes = new Map(), diagnostics = [], ordered = [], visited = new Set(), visiting = new Set();
  const diagnose = (reason, subject, cause) => {
    diagnostics.push({ reason, subject, cause, effects: { changed: false }, actor: 'requirement_author',
      recovery: 'Correct the named definition or lexical domain through the existing requirement batch.' });
  };
  const scopeOf = row => row.for_each?.at(-1)?.scope ?? row.within ?? null;
  const key = (entity, scope) => valueCanonicalKey([identity(entity), lexicalScopeKey(scope)]);
  for (const { constraint: row, identity: constraintId } of rows) {
    for (const [index, entry] of (row.for_each ?? []).entries()) scopes.set(lexicalScopeKey(entry.scope), { ...entry, parent: index ? row.for_each[index - 1].scope : row.within ?? null });
    for (const operand of row.operands ?? []) if (operand.binding) scopes.set(lexicalScopeKey(operand.binding.scope),
      { ...operand.binding, domain: row.operands[0].value, parent: row.within ?? null });
    if (!row.definition) continue;
    const id = key(row.subject, row.within ?? null);
    if (definitions.has(id)) diagnose('value_definition_ambiguous', row.subject, 'more than one defining row');
    else definitions.set(id, { key: id, identity: constraintId, constraint: row, scope: row.within ?? null });
  }
  const parentScope = scope => scopes.get(lexicalScopeKey(scope))?.parent ?? null;
  const lookup = (entity, scope) => {
    const exact = definitions.get(key(entity, scope));
    if (exact) return exact;
    if (scope) {
      const ancestor = parentScope(scope);
      return lookup(entity, ancestor);
    }
    return null;
  };
  for (const definition of definitions.values()) if (definition.scope && lookup(definition.constraint.subject, parentScope(definition.scope))) {
    diagnose('value_definition_shadowing', definition.constraint.subject, 'inner definition replaces a visible ancestor definition or observation');
  }
  const selectType = (type, path, scope, usePath = []) => {
    let selected = type;
    for (const [position, step] of path.entries()) {
      if (step.index) {
        const indexType = typeOf(step.index, scope, [...usePath, position, 'index']);
        if (indexType !== 'int') {
          const error = new ControlledValueError('value_selector_type_invalid', 'index', 'list index must be provably int; mixed or dynamic types cannot be narrowed implicitly', 'Declare or compute an integer index.');
          Object.assign(error.details, { use_path: [...usePath, position, 'index'], scope });
          throw error;
        }
      }
      if (step.key) typeOf(step.key, scope, [...usePath, position, 'key']);
      if (selected === 'dyn') continue;
      if (step.field !== undefined) {
        const field = selected?.record?.fields.find(row => row.name === step.field);
        if (!field) valueFailure('value_selector_type_invalid', step.field, 'field selector requires a declared record field');
        selected = field.type;
      } else if (step.index) {
        if (!selected?.list) valueFailure('value_selector_type_invalid', 'index', 'index selection requires a list and int index');
        selected = selected.list;
      } else {
        const keyType = typeOf(step.key, scope);
        if (selected?.record) {
          if (keyType !== 'string') valueFailure('value_selector_type_invalid', 'key', 'record key selection requires string');
          const possible = [...new Map(selected.record.fields.map(row => [valueCanonicalKey(row.type), row.type])).values()];
          selected = possible.length === 1 ? possible[0] : { one_of: possible };
        } else {
          if (!selected?.map || !VALUE_KEY_TYPES.includes(keyType) || !compatibleValueTypes(keyType, selected.map.key)) valueFailure('value_selector_type_invalid', 'key', 'map selector has the wrong key type');
          selected = selected.map.value;
        }
      }
    }
    return selected;
  };
  const localType = (local, scope) => {
    let selected = scope;
    for (let i = 0; i < local.depth; i += 1) selected = parentScope(selected);
    const entry = scopes.get(lexicalScopeKey(selected));
    if (!entry?.bind[local.slot]) valueFailure('value_local_out_of_scope', valueCanonicalKey(local), 'local slot is not visible');
    const outer = parentScope(selected);
    const domain = typeOf(entry.domain, outer);
    if (local.slot === 'index') {
      if (!domain?.list) valueFailure('value_binding_domain_invalid', 'index', 'index binder requires a list');
      return 'int';
    }
    if (local.slot === 'key') {
      if (!domain?.map && !domain?.record) valueFailure('value_binding_domain_invalid', 'key', 'key binder requires a map');
      return domain.map?.key ?? 'string';
    }
    if (domain?.list) return domain.list;
    if (domain?.map) return domain.map.value;
    if (domain?.record) { const types = [...new Map(domain.record.fields.map(field => [valueCanonicalKey(field.type), field.type])).values()]; return types.length === 1 ? types[0] : { one_of: types }; }
    valueFailure('value_binding_domain_invalid', 'value', 'binder requires a complete list or typed map');
  };
  function typeOf(value, scope = null, usePath = []) {
    try {
    if (value.literal) return literalType(value.literal);
    if (value.referent) {
      const definition = lookup(value.referent, scope);
      if (!definition) {
        const error = new ControlledValueError('value_definition_missing', value.referent, 'referent has no visible typed definition', 'Define this exact referent in its visible lexical scope.');
        Object.assign(error.details, { use_path: [...usePath, 'referent'], scope });
        throw error;
      }
      return visit(definition);
    }
    if (value.local) return localType(value.local, scope);
    if (value.selection) return selectType(typeOf(value.selection.from, scope, [...usePath, 'selection', 'from']), value.selection.path, scope, [...usePath, 'selection', 'path']);
    if (value.list) {
      for (const [index, item] of value.list.items.entries()) if (!compatibleValueTypes(typeOf(item, scope, [...usePath, 'list', 'items', index]), value.list.element_type)) valueFailure('value_constructor_type_invalid', 'list', 'item has an incompatible element type');
      return { list: value.list.element_type };
    }
    if (value.record) return { record: { fields: value.record.fields.map((row, index) => ({ name: row.name, type: typeOf(row.value, scope, [...usePath, 'record', 'fields', index, 'value']), presence: 'required' })) } };
    if (value.map) {
      for (const [index, row] of value.map.entries.entries()) if (!compatibleValueTypes(typeOf(row.key, scope, [...usePath, 'map', 'entries', index, 'key']), value.map.key_type) || !compatibleValueTypes(typeOf(row.value, scope, [...usePath, 'map', 'entries', index, 'value']), value.map.value_type)) valueFailure('value_constructor_type_invalid', 'map', 'entry has incompatible key/value type');
      return { map: { key: value.map.key_type, value: value.map.value_type } };
    }
    valueFailure('value_shape_invalid', 'value', 'unsupported value form');
    } catch (error) {
      if (!(error instanceof ControlledValueError)) throw error;
      error.details.use_path ??= usePath;
      error.details.scope ??= scope;
      throw error;
    }
  }
  function resultType(row) {
    const op = operators.get(row.relation);
    if (!op) valueFailure('value_relation_unknown', row.subject, row.relation);
    const scope = scopeOf(row);
    const scopedBody = ['exists_in', 'map_over', 'filter_over'].includes(op.signature.type_rule);
    const atOperand = (index, resolve) => {
      try { return resolve(); } catch (error) {
        if (!(error instanceof ControlledValueError)) throw error;
        error.details.use_path = ['operands', index, 'value', ...(error.details.use_path ?? [])];
        throw error;
      }
    };
    const types = row.operands.map((operand, index) => scopedBody && index === 2 ? null
      : atOperand(index, () => operand.value ? typeOf(operand.value, scope) : operand.type ?? null));
    const [a, b, c] = types;
    const same = () => { if (!compatibleValueTypes(a, b)) valueFailure('value_overload_incompatible', row.subject, 'operand types differ'); return a; };
    const numeric = type => ['int', 'double'].includes(type);
    const require = valid => { if (!valid) valueFailure('value_overload_unsupported', row.subject, `no ${row.relation} overload for ${valueCanonicalKey(types)}`); };
    switch (op.signature.type_rule) {
      case 'observation': return normalizeValueType(row.operands[0].observation.type);
      case 'same_subject': return a;
      case 'add': if ((a === 'timestamp' && b === 'duration') || (a === 'duration' && b === 'timestamp')) return 'timestamp'; same(); require(numeric(a) || a === 'string' || a?.list || a === 'duration'); return a;
      case 'subtract': if (a === 'timestamp' && b === 'timestamp') return 'duration'; if (a === 'timestamp' && b === 'duration') return 'timestamp'; same(); require(numeric(a) || a === 'duration'); return a;
      case 'multiply': case 'divide': same(); require(numeric(a)); return a;
      case 'remainder': same(); require(a === 'int'); return a;
      case 'numeric_unary': require(numeric(a)); return a;
      case 'string_contains': require(a === 'string' && b === 'string'); return 'bool';
      case 'typed_equality': same(); return 'bool';
      case 'comparison': same(); require(['bool', 'int', 'double', 'string', 'timestamp', 'duration'].includes(a)); return 'bool';
      case 'boolean_binary': require(a === 'bool' && b === 'bool'); return 'bool';
      case 'boolean_unary': require(a === 'bool'); return 'bool';
      case 'choose': require(a === 'bool' && compatibleValueTypes(b, c)); return b;
      case 'size': require(a?.list || a?.map || a?.record || a === 'string'); return 'int';
      case 'presence': require(Boolean(row.operands[0].value.selection)); return 'bool';
      case 'type_test': return 'bool';
      case 'substring': require(a === 'string' && b === 'int' && c === 'int'); return 'string';
      case 'sum': require(a?.list && numeric(a.list)); return a.list;
      case 'timestamp_difference': require(a === 'timestamp' && b === 'timestamp'); return 'duration';
      case 'duration_add': require(a === 'duration' && b === 'duration'); return 'duration';
      case 'exists_in': case 'map_over': case 'filter_over': {
        const binding = row.operands[1].binding;
        const body = row.operands[2].value;
        require((a?.list || a?.map) && body?.referent);
        const definition = lookup(body.referent, binding.scope);
        if (!definition || lexicalScopeKey(definition.scope) !== lexicalScopeKey(binding.scope)) {
          const error = new ControlledValueError('value_definition_missing', body.referent, 'comprehension body has no definition in its owned lexical scope', 'Define this exact body referent within the named lexical scope.');
          Object.assign(error.details, { use_path: ['operands', 2, 'value', 'referent'], scope: binding.scope });
          throw error;
        }
        const bodyType = atOperand(2, () => visit(definition));
        if (op.signature.type_rule !== 'map_over' && bodyType !== 'bool') {
          const error = new ControlledValueError('value_overload_unsupported', body.referent,
            `${row.relation} requires a bool body; received ${valueCanonicalKey(bodyType)}`,
            'Define this body as Boolean in its owned lexical scope.');
          Object.assign(error.details, { use_path: ['operands', 2, 'value', 'referent'], scope: binding.scope });
          throw error;
        }
        return op.signature.type_rule === 'exists_in' ? 'bool' : { list: op.signature.type_rule === 'map_over' ? bodyType : a.list ?? a.map.key };
      }
      default: valueFailure('value_overload_unsupported', row.subject, op.signature.type_rule);
    }
  }
  function visit(definition) {
    if (definition.failure) {
      const root = definition.failure;
      const error = new ControlledValueError(root.code, root.details.subject, root.details.cause, root.details.recovery);
      Object.assign(error.details, structuredClone(root.details));
      throw error;
    }
    if (visited.has(definition.key)) return definition.type;
    if (visiting.has(definition.key)) valueFailure('value_definition_cycle', definition.constraint.subject, 'finite acyclic definitions are required');
    visiting.add(definition.key);
    try {
      definition.type = resultType(definition.constraint);
      definition.dependencies = valueReferences(definition.constraint.operands).map(entity => lookup(entity, definition.scope)).filter(Boolean).map(row => row.key);
      ordered.push(definition);
      visited.add(definition.key);
      return definition.type;
    } catch (error) {
      if (!(error instanceof ControlledValueError)) throw error;
      error.details.root_cause ??= { reason: error.code, referent: error.details.subject,
        definition_identity: definition.identity, scope: error.details.scope ?? definition.scope, use_path: error.details.use_path };
      definition.failure = { code: error.code, details: structuredClone(error.details) };
      throw error;
    } finally { visiting.delete(definition.key); }
  }
  for (const definition of definitions.values()) {
    try { visit(definition); } catch (error) {
      if (!(error instanceof ControlledValueError)) throw error;
      diagnose(error.code, definition.constraint.subject, error.details.cause);
      Object.assign(diagnostics.at(-1), { referent: error.details.subject, scope: error.details.root_cause?.definition_identity === definition.identity
          ? error.details.scope ?? definition.scope : definition.scope,
        definition_identity: definition.identity, use_path: error.details.use_path ?? ['operands'],
        ...(error.details.root_cause ? { root_cause: error.details.root_cause } : {}) });
    }
  }
  return { definitions, scopes, parentScope, lookup, typeOf, resultType, scopeOf, selectType, ordered, diagnostics };
}
