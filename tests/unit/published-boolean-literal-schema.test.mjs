import test from "node:test";
import assert from "node:assert/strict";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { publishBooleanLiteralSchema } from "../../packages/wiki-mcp/src/lib/published-boolean-literal-schema.mjs";

const validator = new AjvJsonSchemaValidator();
const accepts = (schema, value) => validator.getValidator(schema)(value).valid;
const values = [true, false, "true", "false", 0, 1, null, {}, []];
function equivalent(schema, candidates = values) {
  const before = structuredClone(schema);
  const published = publishBooleanLiteralSchema(schema);
  assert.deepEqual(schema, before);
  for (const value of candidates) assert.equal(accepts(published, value), accepts(schema, value), JSON.stringify({ schema, value }));
  return published;
}

test("boolean literals and closed boolean enums retain their exact accepted values", () => {
  for (const literal of [true, false]) {
    for (const schema of [{ const: literal }, { type: "boolean", const: literal },
      { type: "boolean", enum: [literal] }, { enum: [literal, literal] }]) {
      const projected = equivalent(schema);
      assert.equal(projected.type, "boolean");
      assert.equal(Object.hasOwn(projected, "const"), false);
      assert.equal(Object.hasOwn(projected, "enum"), false);
      assert.deepEqual(projected.not, { const: !literal });
    }
  }
  assert.deepEqual(equivalent({ enum: [true, false] }), { type: "boolean" });
});

test("existing negation, types, combinations and contradictions remain conjunctive", () => {
  for (const schema of [{ type: "string", const: true }, { type: ["boolean", "string"], const: false },
    { type: "boolean", const: true, not: { const: true } }, { const: true, enum: [false] },
    { const: false, allOf: [{ not: { const: true } }], description: "owner text" },
    { const: true, enum: [true, false] }]) equivalent(schema);
});

test("nested schema maps, arrays, conditionals and references retain closed object meaning", () => {
  const literal = { type: "boolean", const: true };
  const schema = { type: "object", required: ["assigned"], additionalProperties: false,
    definitions: { selected: literal }, properties: { assigned: { $ref: "#/definitions/selected" },
      nested: { type: "array", items: { anyOf: [literal, { type: "string", enum: ["owner"] }] } } } };
  const projected = equivalent(schema, [{ assigned: true }, { assigned: false }, { assigned: "true" }, {},
    { assigned: true, unknown: 1 }, { assigned: true, nested: [true, "owner"] }, { assigned: true, nested: [false] }]);
  assert.equal(projected.properties.assigned.$ref, "#/definitions/selected");
  assert.deepEqual(projected.required, ["assigned"]);
  assert.equal(projected.additionalProperties, false);
  for (const key of ["$defs", "patternProperties", "dependentSchemas"]) {
    assert.deepEqual(publishBooleanLiteralSchema({ [key]: { selected: literal } })[key].selected,
      { type: "boolean", not: { const: false } });
  }
  for (const key of ["items", "prefixItems", "allOf", "anyOf", "oneOf"]) {
    const projected = publishBooleanLiteralSchema({ [key]: [literal] });
    assert.deepEqual(projected[key], [{ type: "boolean", not: { const: false } }]);
  }
  for (const key of ["contains", "additionalItems", "unevaluatedItems", "unevaluatedProperties", "propertyNames",
    "if", "then", "else", "contentSchema"]) assert.deepEqual(publishBooleanLiteralSchema({ [key]: literal })[key],
      { type: "boolean", not: { const: false } });
});

test("annotations, defaults, examples, string enums and boolean schema nodes are not rewritten", () => {
  const data = { const: true, properties: { example: { enum: [false] } } };
  const schema = { type: "object", examples: [data], default: data, enum: ["owner", "other"],
    "x-owner-data": data, properties: { open: true, closed: false }, additionalProperties: false,
    dependencies: { open: ["closed"] } };
  assert.deepEqual(publishBooleanLiteralSchema(schema), schema);
  assert.equal(publishBooleanLiteralSchema(schema).default, data);
  assert.equal(publishBooleanLiteralSchema(true), true);
  assert.equal(publishBooleanLiteralSchema(false), false);
});

test("invalid schema locations fail explicitly rather than traversing instance data", () => {
  for (const schema of [null, [], "true", 1, { properties: [] }, { properties: { selected: null } },
    { anyOf: {} }, { items: "boolean" }]) assert.throws(() => publishBooleanLiteralSchema(schema), TypeError);
});

test("repeated simple literals share collision-free local definitions without changing accepted objects", () => {
  const names = ["a", "b", "c", "d", "e", "f"];
  const schema = { type: "object", additionalProperties: false, required: names,
    $defs: { t: { type: "string", enum: ["owner"] } },
    properties: Object.fromEntries(names.map(name => [name, { type: "boolean", const: true, description: name }])) };
  const valid = Object.fromEntries(names.map(name => [name, true]));
  const projected = equivalent(schema, [valid, { ...valid, a: false }, { ...valid, a: "true" }, {}, { ...valid, extra: true }]);
  assert.deepEqual(projected.$defs.t, schema.$defs.t);
  assert.deepEqual(projected.$defs.t_, { $id: "t_", not: { const: false } });
  assert.ok(JSON.stringify(projected).length < JSON.stringify(schema).length + names.length * 9);
  for (const name of names) assert.deepEqual(projected.properties[name], { type: "boolean", description: name, $ref: "t_" });
  const bare = { ...schema, properties: { ...schema.properties, a: { type: "boolean", const: true } } };
  const anchored = equivalent(bare, [valid, { ...valid, a: false }, { ...valid, b: false }, { ...valid, b: "true" }]);
  assert.deepEqual(anchored.properties.a, { type: "boolean", not: { const: false }, $id: "t_" });
  assert.deepEqual(anchored.$defs, bare.$defs);
  assert.equal(anchored.properties.b.type, "boolean");
  const resource = { ...schema, properties: { ...schema.properties, child: { $id: "nested.json", const: true } } };
  const isolated = publishBooleanLiteralSchema(resource);
  assert.equal(isolated.properties.a.$ref, undefined);
  assert.deepEqual(isolated.properties.child, { $id: "nested.json", type: "boolean", not: { const: false } });
  for (const owner of [{ $id: "https://example.test/t" }, { properties: { ...schema.properties, other: { $ref: "t" } } }]) {
    assert.equal(publishBooleanLiteralSchema({ ...schema, ...owner }).properties.a.$ref, undefined);
  }
});
