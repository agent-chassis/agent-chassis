

export const REQUIREMENT_CAPABILITIES = Object.freeze({
  relationships: { dependencies: [], description: 'Ordinary reference, boolean and numeric statements, independent verification, named membership, collections and source links.' },
  scalar_values: { dependencies: [], description: 'Primitive named value definitions, literals, references, observations and scalar operators.' },
  typed_values: { dependencies: ['scalar_values'], description: 'Structured recursive values and types, nested selections, bindings, for_each, within and typed membership domains.' }
});
const fail = (code, cause) => { throw Object.assign(new TypeError(`${code}: ${cause}`), { code }); };
export function requirementCapabilities(requested) {
  if (!Array.isArray(requested) || !requested.length || requested.some(key => !Object.hasOwn(REQUIREMENT_CAPABILITIES, key)) ||
      new Set(requested).size !== requested.length) fail('requirements_capability_selection_invalid', 'select nonempty, distinct published capability keys');
  const effective = new Set(requested);
  for (const key of effective) for (const dependency of REQUIREMENT_CAPABILITIES[key].dependencies) effective.add(dependency);
  return { requested: [...requested], effective: Object.keys(REQUIREMENT_CAPABILITIES).filter(key => effective.has(key)),
    dependencies_added: [...effective].filter(key => !requested.includes(key)),
    excluded: Object.keys(REQUIREMENT_CAPABILITIES).filter(key => !effective.has(key)) };
}

export function relationCapability(operator) {
  if (['reference', 'boolean', 'number', 'range'].includes(operator.signature.operand_kind)) return 'relationships';
  if (operator.signature.operand_kind !== 'value') fail('requirements_capability_unclassified_operator', operator.term);
  switch (operator.signature.type_rule) {
    case 'same_subject': case 'string_contains': case 'typed_equality': case 'add': case 'subtract':
    case 'multiply': case 'divide': case 'remainder': case 'numeric_unary': case 'comparison':
    case 'boolean_binary': case 'boolean_unary': case 'choose': case 'size': case 'presence':
    case 'type_test': case 'substring': case 'timestamp_difference': case 'duration_add': case 'observation':
      return 'scalar_values';
    case 'sum': case 'exists_in': case 'map_over': case 'filter_over': return 'typed_values';
    default: return fail('requirements_capability_unclassified_operator', operator.term);
  }
}
const classifyAlternatives = (node, classify, allowed, name) => ({ ...node, oneOf: node.oneOf.filter(branch => {
  const key = branch.required?.[0] ?? (branch.enum ? 'primitive' : null);
  if (!Object.hasOwn(classify, key)) fail('requirements_capability_unclassified_syntax', `${name}.${key}`);
  return allowed.has(classify[key]);
}) });

export function scopePrimitiveValueDefinitions(values) {
  const scalar = new Set(['scalar_values']);
  return { ...values,
    typed_value: classifyAlternatives(values.typed_value, { literal: 'scalar_values', referent: 'scalar_values',
      local: 'typed_values', list: 'typed_values', record: 'typed_values', map: 'typed_values', selection: 'typed_values' }, scalar, 'typed_value'),
    value_type: classifyAlternatives(values.value_type, { primitive: 'scalar_values', list: 'typed_values', map: 'typed_values',
      record: 'typed_values', one_of: 'typed_values' }, scalar, 'value_type'),
    value_literal: classifyAlternatives(values.value_literal, { boolValue: 'scalar_values', stringValue: 'scalar_values',
      nullValue: 'scalar_values', int64Value: 'scalar_values', doubleValue: 'scalar_values', objectValue: 'scalar_values',
      listValue: 'typed_values', mapValue: 'typed_values' }, scalar, 'value_literal'),
    value_operand: { ...values.value_operand, oneOf: values.value_operand.oneOf.filter(branch => !branch.properties?.bind) }
  };
}
