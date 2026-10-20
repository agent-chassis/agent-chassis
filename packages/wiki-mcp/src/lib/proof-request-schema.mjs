

import { declareRequestConstraints } from './zod-request-constraint-declarations.mjs';

function referenceTarget(schema, defs) {
  const seen = new Set();
  while (schema?.$ref) {
    if (seen.has(schema)) throw new Error(`Nonproductive authored request-schema reference cycle: ${schema.$ref}`);
    seen.add(schema);
    const match = /^#\/\$defs\/([^/]+)$/u.exec(schema.$ref);
    const target = match && defs?.[match[1].replaceAll('~1', '/').replaceAll('~0', '~')];
    if (target === undefined || target === null || target === false) throw new Error(`Unknown authored request-schema reference: ${schema.$ref}`);
    schema = target;
  }
  return schema;
}

function convertRequestSchema(z, schema, defs, context) {
  if (schema === true) return z.unknown();
  if (schema === false) return z.never();
  if (context.defs !== defs) {
    throw new Error('Authored request-schema conversion cannot cross definition environments');
  }
  if (context.memoize && context.completed.has(schema)) return context.completed.get(schema);
  if (context.active.has(schema)) {
    if (!context.recursive.has(schema)) context.recursive.set(schema, z.lazy(() => {
      const completed = context.completed.get(schema);
      if (completed === undefined) throw new Error('Recursive authored request schema was not completely converted');
      return completed;
    }));
    return context.recursive.get(schema);
  }
  context.active.add(schema);
  const convert = (child) => convertRequestSchema(z, child, defs, context);
  const optional = (converted) => {
    if (!context.memoize) return converted.optional();
    const existing = context.optional.get(converted);
    if (existing !== undefined) return existing;
    const wrapper = converted.optional();
    context.optional.set(converted, wrapper);
    return wrapper;
  };
  let result;
  if (Array.isArray(schema.type)) {
    const alternatives = schema.type.map(type => convert({ ...schema, type }));
    result = alternatives.length === 1 ? alternatives[0] : z.union(alternatives);
  }
  else if (schema.$ref) {
    const target = referenceTarget(schema, defs);
    result = convert(target);
  }
  else if (schema.anyOf || schema.oneOf) result = z.union((schema.anyOf ?? schema.oneOf).map(convert));
  else if (schema.const !== undefined) result = z.literal(schema.const);
  else if (schema.enum) result = z.enum(schema.enum);
  else if (schema.type === 'null') result = z.null();
  else if (schema.type === 'integer' || schema.type === 'number') {
    result = z.number();
    if (schema.type === 'integer') result = result.int();
    if (schema.minimum !== undefined) result = result.min(schema.minimum);
    if (schema.maximum !== undefined) result = result.max(schema.maximum);
  }
  else if (schema.type === 'boolean') result = z.boolean();
  else if (schema.type === 'string') {
    result = z.string();
    if (schema.minLength !== undefined) result = result.min(schema.minLength);
    if (schema.maxLength !== undefined) result = result.max(schema.maxLength);
    if (schema.pattern) result = result.regex(new RegExp(schema.pattern));
    if (schema.description) result = result.describe(schema.description);
  }
  else if (schema.type === 'array') {
    if (schema.prefixItems) {
      const prefix = schema.prefixItems.map(convert);
      const minimum = schema.minItems ?? 0;
      const maximum = schema.maxItems ?? (schema.items === false ? prefix.length : Infinity);
      const alternatives = [];
      for (let count = minimum; count < prefix.length && count <= maximum; count++) alternatives.push(z.tuple(prefix.slice(0, count)));
      if (maximum >= prefix.length) {
        let full = z.tuple(prefix);
        if (schema.items !== false && maximum > prefix.length) full = full.rest(schema.items === undefined || schema.items === true ? z.unknown() : convert(schema.items));
        alternatives.push(full);
      }
      if (!alternatives.length) throw new Error('Unsatisfiable authored positional operand bounds');
      result = alternatives.length === 1 ? alternatives[0] : z.union(alternatives);
      if (minimum > prefix.length || (Number.isFinite(maximum) && maximum > prefix.length)) {
        result = declareRequestConstraints(result.refine(items => items.length >= minimum && items.length <= maximum, 'Wrong positional operand count'),
          [{ constraint: 'array_length', min_items: minimum, ...(Number.isFinite(maximum) ? { max_items: maximum } : {}) }]);
      }
    } else {
      result = z.array(schema.items === undefined ? z.unknown() : convert(schema.items));
      if (schema.minItems !== undefined) result = result.min(schema.minItems);
      if (schema.maxItems !== undefined) result = result.max(schema.maxItems);
    }
    if (schema.uniqueItems) result = result.refine(items => new Set(items.map(value => JSON.stringify(value))).size === items.length,
      'Values must be unique');
    if (schema.description) result = result.describe(schema.description);
  }
  else if (schema.type === 'object') {
    if (!schema.properties && (schema.additionalProperties === undefined || schema.additionalProperties === true)) result = z.record(z.unknown());

    else if (!schema.properties && schema.additionalProperties !== null && typeof schema.additionalProperties === 'object') {
      const value = convert(schema.additionalProperties);
      result = schema.propertyNames ? z.record(convert(schema.propertyNames), value) : z.record(value);
      if (schema.description) result = result.describe(schema.description);
    }
    else {
      const declared = z.object(Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => {
        const field = convert(value);
        return [key, schema.required?.includes(key) ? field : optional(field)];
      })));

      result = schema.additionalProperties === true ? declared.passthrough() : declared.strict();
    }
    if (schema.minProperties !== undefined || schema.maxProperties !== undefined) {
      const minimum = schema.minProperties ?? 0, maximum = schema.maxProperties ?? Infinity;
      result = declareRequestConstraints(result.refine(value => {
        const count = Object.keys(value).length;
        return count >= minimum && count <= maximum;
      }, 'Wrong number of authored object properties'), [{ constraint: 'object_property_count',
        min_properties: minimum, ...(Number.isFinite(maximum) ? { max_properties: maximum } : {}) }]);
    }
  }
  else throw new Error('Unsupported authored request-schema declaration');
  if (schema.description) result = result.describe(schema.description);
  context.active.delete(schema);
  context.completed.set(schema, result);
  return result;
}

export function requestSchema(z, schema, defs, { memoize = false } = {}) {
  return convertRequestSchema(z, schema, defs, {
    memoize,
    completed: new WeakMap(),
    optional: new WeakMap(),
    recursive: new WeakMap(),
    active: new WeakSet(),
    defs
  });
}
