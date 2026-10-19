
import { mapValueReferences, normalizeValueOperand, projectValueDefinitions } from '@agent-chassis/controlled-contract/controlled-values-v1';
export function publicValueDefinitions(nativeSchema, reference) {
  const definitions = projectValueDefinitions(nativeSchema.$defs, { reference });
  definitions.value_operand = { description: definitions.value_operand.description, oneOf: [
    { type: 'object', required: ['value'], additionalProperties: false, properties: { value: { $ref: '#/$defs/typed_value' } } },
    { type: 'object', required: ['type'], additionalProperties: false, properties: { type: { $ref: '#/$defs/value_type' } } },
    { type: 'object', required: ['observation'], additionalProperties: false, properties: { observation: { $ref: '#/$defs/value_observation' } } },
    definitions.value_binding
  ] };

  definitions.value_for_each.items.properties.bind = definitions.value_binding.properties.bind;
  return definitions;
}
export function nativeValueOperand(operand, referent, field) {
  const normalized = normalizeValueOperand(operand, field);
  return { kind: 'value', ...mapValueReferences(normalized, entity => referent({ declare: entity }, field)) };
}
export function publicNativeValueOperand(operand, referent) {
  const { kind, ...payload } = operand;
  if (kind !== 'value') throw new TypeError('expected one native value operand');
  const projected = mapValueReferences(payload, referent);
  return projected.binding ?? projected;
}
export function valueRowMetadata(row, map = reference => reference) {
  return { ...(row.definition === undefined ? {} : { definition: row.definition }),
    ...(row.for_each === undefined ? {} : { for_each: mapValueReferences(row.for_each, map) }),
    ...(row.within === undefined ? {} : { within: mapValueReferences(row.within, map) }) };
}
