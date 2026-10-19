

const MAPS = new Set(["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"]);
const ARRAYS = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);
const SINGLES = new Set(["additionalProperties", "unevaluatedProperties", "propertyNames", "contains",
  "not", "if", "then", "else", "additionalItems", "unevaluatedItems", "contentSchema"]);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const LITERAL_KEYS = new Set(["type", "const", "description", "title", "default", "examples", "readOnly", "writeOnly", "deprecated", "$comment"]);

export function publishBooleanLiteralSchema(schema) {
  const context = { root: schema, nestedResource: false, literals: new Map([[true, []], [false, []]]) };
  const result = project(schema, context);

  if (context.nestedResource) return result;
  for (const [literal, nodes] of context.literals) {
    if (nodes.length < 2) continue;
    let name = literal ? "t" : "f";
    while (Object.hasOwn(result.$defs ?? {}, name)) name += "_";
    const shared = { $id: name, not: { const: !literal } };

    const anchor = nodes.find(node => Object.keys(node).length === 2);
    const replacements = nodes.map(node => {
      if (node === anchor) return { ...node, $id: name };
      const { not, ...typedAnnotations } = node;
      return { ...typedAnnotations, $ref: name };
    });
    const saving = nodes.reduce((bytes, node, index) => bytes + JSON.stringify(node).length - JSON.stringify(replacements[index]).length, 0);
    const overhead = anchor === undefined ? JSON.stringify({ [name]: shared }).length - 2 +
      (result.$defs === undefined ? ',"$defs":{}'.length : Object.keys(result.$defs).length > 0 ? 1 : 0) : 0;
    if (saving <= overhead) continue;
    for (const [index, node] of nodes.entries()) {
      delete node.not;
      Object.assign(node, replacements[index]);
    }
    if (anchor === undefined) result.$defs = { ...result.$defs, [name]: shared };
  }
  return result;
}

function project(schema, context) {
  if (typeof schema === "boolean") return schema;
  if (!object(schema)) throw new TypeError("A published schema must be an object or boolean schema");
  if (Object.hasOwn(schema, "$id") || ["$ref", "$dynamicRef", "$recursiveRef"].some(key =>
    typeof schema[key] === "string" && schema[key] !== "#" && !schema[key].startsWith("#/"))) context.nestedResource = true;
  const result = { ...schema };
  for (const [key, value] of Object.entries(schema)) {
    if (MAPS.has(key) || key === "dependencies") {
      if (!object(value)) throw new TypeError(`Schema ${key} must be an object`);
      result[key] = Object.fromEntries(Object.entries(value).map(([name, child]) => [name,
        key === "dependencies" && Array.isArray(child) ? child : project(child, context)]));
    } else if (ARRAYS.has(key) || key === "items" && Array.isArray(value)) {
      if (!Array.isArray(value)) throw new TypeError(`Schema ${key} must be an array`);
      result[key] = value.map(child => project(child, context));
    } else if (SINGLES.has(key) || key === "items") result[key] = project(value, context);
  }

  const constrain = literal => {
    const extra = {};
    if (result.type === undefined) result.type = "boolean";
    else if (result.type !== "boolean") extra.type = "boolean";
    if (literal !== undefined) {
      const inverse = { const: !literal };
      if (result.not === undefined) result.not = inverse;
      else extra.not = inverse;
    }
    if (Object.keys(extra).length > 0) result.allOf = [...(result.allOf ?? []), extra];
  };
  if (typeof schema.const === "boolean") {
    delete result.const;
    constrain(schema.const);
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0 && schema.enum.every(value => typeof value === "boolean")) {
    delete result.enum;
    const values = [...new Set(schema.enum)];
    constrain(values.length === 1 ? values[0] : undefined);
  }
  if (typeof schema.const === "boolean" && (schema.type === undefined || schema.type === "boolean") &&
      Object.keys(schema).every(key => LITERAL_KEYS.has(key))) context.literals.get(schema.const).push(result);
  return result;
}
