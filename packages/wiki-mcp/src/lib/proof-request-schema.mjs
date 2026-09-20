

function convertRequestSchema(z, schema, defs, context) {
  if (context.defs !== defs) {
    throw new Error('Authored request-schema conversion cannot cross definition environments');
  }
  if (context.memoize && context.completed.has(schema)) return context.completed.get(schema);
  if (context.active.has(schema)) {
    throw new Error('Recursive authored request schemas are unsupported');
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
  if (schema.$ref) {
    const target = defs?.[schema.$ref.split('/').at(-1)];
    if (target === undefined) throw new Error(`Unknown authored request-schema reference: ${schema.$ref}`);
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
    result = z.array(convert(schema.items));
    if (schema.minItems !== undefined) result = result.min(schema.minItems);
    if (schema.maxItems !== undefined) result = result.max(schema.maxItems);
    if (schema.uniqueItems) result = result.refine(items => new Set(items.map(value => JSON.stringify(value))).size === items.length,
      'Values must be unique');
  }
  else if (schema.type === 'object') {
    if (!schema.properties && schema.additionalProperties === true) result = z.record(z.unknown());
    else result = z.object(Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => {
      const field = convert(value);
      return [key, schema.required?.includes(key) ? field : optional(field)];
    }))).strict();
  }
  else throw new Error('Unsupported authored request-schema declaration');
  context.active.delete(schema);
  if (context.memoize) context.completed.set(schema, result);
  return result;
}

export function requestSchema(z, schema, defs, { memoize = false } = {}) {
  return convertRequestSchema(z, schema, defs, {
    memoize,
    completed: new WeakMap(),
    optional: new WeakMap(),
    active: new WeakSet(),
    defs
  });
}
