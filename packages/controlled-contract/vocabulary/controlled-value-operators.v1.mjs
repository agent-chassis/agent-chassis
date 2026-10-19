

const V = 'value';
const rows = [
  ['equals', [V], 'same_subject', 'The subject has exactly the operand value, including type and presence.', 'cel.eq'],
  ['contains', [V, V], 'string_contains', 'The Boolean subject states whether the string haystack contains the string needle as an exact case-sensitive substring, without normalization.', 'cel.contains'],
  ['equal_to', [V, V], 'typed_equality', 'The Boolean subject compares the two operands by typed equality, including complete structure, list order and repetition, and optional-field presence; required missing operands are unavailable.', 'cel.eq'],
  ['not_equals', [V], 'same_subject', 'The subject differs from the operand by typed value equality.', 'cel.ne'],
  ...[['add', '+'], ['subtract', '-'], ['multiply', '*'], ['divide', '/'], ['remainder', '%']]
    .map(([name, op]) => [name, [V, V], name, `The subject is the ordered CEL ${op} result of the two operands.`, `cel.${name}`]),
  ['negate', [V], 'numeric_unary', 'The subject is the signed numeric negation of the operand.', 'cel.negate'],
  ...['less_than', 'less_or_equal', 'greater_than', 'greater_or_equal'].map(name =>
    [name, [V, V], 'comparison', `The Boolean subject is the CEL ${name} comparison of the ordered operands.`, `cel.${name}`]),
  ['all_true', [V, V], 'boolean_binary', 'The Boolean subject is the conjunction of the two Boolean operands.', 'cel.and'],
  ['any_true', [V, V], 'boolean_binary', 'The Boolean subject is the disjunction of the two Boolean operands.', 'cel.or'],
  ['not', [V], 'boolean_unary', 'The Boolean subject is the logical negation of the Boolean operand.', 'cel.not'],
  ['choose', [V, V, V], 'choose', 'The subject is the second operand if the Boolean first operand holds, otherwise the third; only the selected branch is evaluated.', 'cel.conditional'],
  ['size', [V], 'size', 'The int subject counts list elements, map entries or Unicode scalars in the string.', 'cel.size'],
  ['present', [V], 'presence', 'The Boolean subject states whether the selected value is present; absence is distinct from null.', 'cel.has'],
  ['type_is', [V, 'type'], 'type_test', 'The Boolean subject states whether the operand satisfies the refined declared type, including closed fields and presence.', 'cel.type'],
  ['substring', [V, V, V], 'substring', 'The string subject is the Unicode-scalar substring at zero-based inclusive start and exclusive end; invalid bounds are errors.', 'cel_java.strings.substring'],
  ['sum', [V], 'sum', 'The subject is the ordered homogeneous int or double list sum, with typed zero on the empty list and CEL integer overflow errors.', 'kubernetes.lists.sum'],
  ['timestamp_difference', [V, V], 'timestamp_difference', 'The duration subject is the first timestamp minus the second.', 'cel.subtract'],
  ['duration_add', [V, V], 'duration_add', 'The duration subject is the sum of the two durations.', 'cel.add'],
  ['observed_at', ['observation'], 'observation', 'The subject denotes the declared operation occurrence, root, boundary and ordered selection; the expected type is a conformity predicate.', 'cel.observation'],
  ...['exists_in', 'map_over', 'filter_over'].map(name => [name, [V, 'binding', V], name,
    `The subject is ${name === 'exists_in' ? 'existential Boolean truth' : name === 'map_over' ? 'the list of body values' : 'the retained list values or map keys'} over the complete lexical domain, with the body defined in its owned scope.`,
    `cel_java.comprehensions.${name}`])
];
export const CONTROLLED_VALUE_OPERATORS = Object.freeze(rows.map(([name, payloads, typeRule, definition, semanticReference]) => Object.freeze({
  term: `value:${name}`, definition,
  signature: { subject_types: { kind: 'unrestricted' }, operand_kind: 'value',
    operand_cardinality: { minimum: payloads.length, maximum: payloads.length },
    positional_payloads: payloads, type_rule: typeRule },
  definition_capability: name === 'not_equals' ? [] : ['value', 'subject', 'condition', 'structure'],
  authoring_roles: name === 'observed_at' ? ['definition'] : name === 'not_equals' ? ['normative'] : ['definition', 'normative'],
  semantic_reference: semanticReference,
  operand_semantics: { ordering: 'significant', duplicates: 'significant' }, multiplicity: 'conjunctive_constraint',
  controlled_complement: { kind: 'none' }, inverse: { kind: 'none' }, controlled_entailments: { kind: 'none' },
  population_semantics: { kind: 'not_applicable' },
  algebraic_traits: { symmetric: false, transitive: false, irreflexive: false },
  mechanical_support: { operand_semantics: 'enforced', multiplicity: 'enforced', controlled_complement: 'not_applicable',
    inverse: 'not_applicable', controlled_entailments: 'enforced', population_semantics: 'not_applicable',
    algebraic_traits: { symmetric: 'not_applicable', transitive: 'not_applicable', irreflexive: 'not_applicable' }, applicability: 'enforced' },
  applicability: { kind: 'all_declared_modes' }
})));
