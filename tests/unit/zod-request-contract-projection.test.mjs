

import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import {
  projectZodRequestContract,
  projectZodDiscriminatedUnionMembers,
  zodDiscriminatedUnionDiscriminatorValues,
  ZOD_REQUEST_CONTRACT_SCHEMA_VERSION
} from "../../packages/wiki-mcp/src/lib/zod-request-contract-projection.mjs";
import {
  allOrNone,
  declareRequestConstraints,
  withDeclaredCrossFieldRules
} from "../../packages/wiki-mcp/src/lib/zod-request-constraint-declarations.mjs";
import { createRegisteredToolRequestContractStore } from
  "../../packages/wiki-mcp/src/lib/registered-tool-request-contracts.mjs";

test("a projected object reports its fields, which of them are required, and whether unknown keys are refused", () => {
  const schema = z.object({
    unit: z.string(),
    focus: z.string().optional()
  }).strict();

  const { contract } = projectZodRequestContract(schema);

  assert.equal(contract.type, "object");
  assert.deepEqual(contract.required, ["unit"], "an optional field must not be reported as required");
  assert.equal(
    contract.additionalProperties,
    false,
    "a strict object refuses unknown keys and the contract must say so"
  );
});

test("a passthrough object and a stripping object are distinguished, because they behave differently", () => {
  assert.equal(
    projectZodRequestContract(z.object({ a: z.string() }).passthrough()).contract.additionalProperties,
    true
  );
  assert.deepEqual(
    projectZodRequestContract(z.object({ a: z.string() })).contract.additionalProperties,
    { stripped: true },
    "a default object silently drops unknown keys; that is neither 'refused' nor 'kept'"
  );
});

test("string, number and array constraints survive the projection", () => {
  const { contract } = projectZodRequestContract(z.object({
    identity: z.string().min(1).max(512).regex(/^sha256:[0-9a-f]{64}$/u),
    offset: z.number().int().nonnegative(),
    weight: z.number().min(0.5).max(2),
    rows: z.array(z.string()).min(1).max(64),
    axes: z.array(z.string()).length(10)
  }).strict());

  assert.deepEqual(contract.properties.identity, {
    type: "string", minLength: 1, maxLength: 512, pattern: "^sha256:[0-9a-f]{64}$"
  });
  assert.deepEqual(contract.properties.offset, { type: "integer", minimum: 0 });
  assert.deepEqual(contract.properties.weight, { type: "number", minimum: 0.5, maximum: 2 });
  assert.equal(contract.properties.rows.minItems, 1);
  assert.equal(contract.properties.rows.maxItems, 64);
  assert.deepEqual(
    { min: contract.properties.axes.minItems, max: contract.properties.axes.maxItems },
    { min: 10, max: 10 },
    "an exact-length array is a floor and a ceiling, not one or the other"
  );
});

function sdkPublishedSchema(schema) {
  const store = createRegisteredToolRequestContractStore();
  store.retain("numeric_bounds_fixture", { inputSchema: schema, publishedInputSchema: schema });
  return store.lookup.contractFor("numeric_bounds_fixture").publishedRequestSchema();
}

function numericNodeAdmits(node, value) {
  if (node.type === "integer" && !Number.isInteger(value)) return false;
  if (node.minimum !== undefined && value < node.minimum) return false;
  if (node.exclusiveMinimum !== undefined && value <= node.exclusiveMinimum) return false;
  if (node.maximum !== undefined && value > node.maximum) return false;
  if (node.exclusiveMaximum !== undefined && value >= node.exclusiveMaximum) return false;
  return true;
}

function assertZodParity(label, schema, node, bounds) {
  const probes = [...new Set(bounds.flatMap((bound) =>
    [bound - 1, bound - 0.5, bound - Number.EPSILON * 8, bound, bound + Number.EPSILON * 8, bound + 0.5, bound + 1]))];
  for (const value of probes) {
    assert.equal(numericNodeAdmits(node, value), schema.safeParse(value).success, `${label} at ${value}`);
  }
}

test("inclusive and exclusive numeric bounds are published on their own keywords", () => {
  const fields = {
    at_least: [z.number().min(-2.5), { type: "number", minimum: -2.5 }, [-2.5]],
    above: [z.number().gt(-2.5), { type: "number", exclusiveMinimum: -2.5 }, [-2.5]],
    at_most: [z.number().int().max(10), { type: "integer", maximum: 10 }, [10]],
    below: [z.number().int().lt(10), { type: "integer", exclusiveMaximum: 10 }, [10]],
    positive: [z.number().int().positive(), { type: "integer", exclusiveMinimum: 0 }, [0]],
    nonnegative: [z.number().int().nonnegative(), { type: "integer", minimum: 0 }, [0]],
    negative: [z.number().negative(), { type: "number", exclusiveMaximum: 0 }, [0]],
    open_interval: [z.number().gt(0.25).lt(0.75),
      { type: "number", exclusiveMinimum: 0.25, exclusiveMaximum: 0.75 }, [0.25, 0.75]],
    closed_interval: [z.number().min(-3).max(3), { type: "number", minimum: -3, maximum: 3 }, [-3, 3]],
    fractional_integer_bound: [z.number().int().gt(1.5), { type: "integer", exclusiveMinimum: 1.5 }, [1.5]]
  };
  const schema = z.object(Object.fromEntries(Object.entries(fields).map(([key, [field]]) => [key, field]))).strict();
  const { contract, unprojected } = projectZodRequestContract(schema);
  const published = sdkPublishedSchema(schema).properties;
  for (const [key, [field, expected, bounds]] of Object.entries(fields)) {
    assert.deepEqual(contract.properties[key], expected, key);
    assert.deepEqual(contract.properties[key], published[key], `${key} matches the SDK's tools/list publication`);
    assertZodParity(key, field, contract.properties[key], bounds);
  }
  assert.equal(unprojected, undefined, "every modelled bound is stated, not omitted");
});

test("repeated numeric bounds keep the strongest, and mixed bounds on one side are both stated", () => {
  const cases = [
    ["repeated minimum", z.number().min(1).min(3).min(2), { type: "number", minimum: 3 }, [1, 2, 3]],
    ["repeated exclusive maximum", z.number().lt(9).lt(5).lt(7), { type: "number", exclusiveMaximum: 5 }, [5, 7, 9]],
    ["exclusive at the inclusive bound", z.number().min(0).gt(0),
      { type: "number", minimum: 0, exclusiveMinimum: 0 }, [0]],
    ["inclusive above the exclusive bound", z.number().gt(1).min(4),
      { type: "number", exclusiveMinimum: 1, minimum: 4 }, [1, 4]],
    ["negative integer upper bounds", z.number().int().max(-1).lt(-1),
      { type: "integer", maximum: -1, exclusiveMaximum: -1 }, [-1]]
  ];
  for (const [label, schema, expected, bounds] of cases) {
    const { contract, unprojected } = projectZodRequestContract(schema);
    assert.deepEqual(contract, expected, label);
    assert.equal(unprojected, undefined, label);
    assertZodParity(label, schema, contract, bounds);
  }
  assert.deepEqual(projectZodRequestContract(z.number().finite().gt(0)).contract, {
    type: "number", exclusiveMinimum: 0, unprojected: [{ reason: "unsupported_check", check: "finite" }]
  }, "an unmodelled check beside a bound is still named");
});

test("literals, enums, nullability and optional-with-default are reported as declared", () => {
  const { contract } = projectZodRequestContract(z.object({
    kind: z.literal("criterion_identity"),
    state: z.enum(["covered", "uncovered"]),
    focus: z.string().nullable(),
    limit: z.number().int().default(10)
  }).strict());

  assert.deepEqual(contract.properties.kind, { const: "criterion_identity" });
  assert.deepEqual(contract.properties.state, { type: "string", enum: ["covered", "uncovered"] });
  assert.equal(contract.properties.focus.nullable, true);
  assert.equal(contract.properties.focus.type, "string");
  assert.ok(!contract.required.includes("limit"), "a defaulted field is not required of the caller");
});

test("a union and a discriminated union both publish their alternatives", () => {
  const { contract } = projectZodRequestContract(z.object({
    selector: z.union([
      z.object({ id: z.string() }).strict(),
      z.object({ code: z.string() }).strict()
    ]),
    operation: z.discriminatedUnion("op", [
      z.object({ op: z.literal("upsert"), row: z.string() }).strict(),
      z.object({ op: z.literal("remove") }).strict()
    ])
  }).strict());

  assert.equal(contract.properties.selector.anyOf.length, 2);
  assert.equal(contract.properties.operation.discriminator, "op");
  assert.deepEqual(
    contract.properties.operation.oneOf.map((member) => member.properties.op.const),
    ["upsert", "remove"]
  );
});

test("a construct the projector cannot read is named, not rendered as an unconstrained field", () => {
  const projected = projectZodRequestContract(z.object({
    opaque: z.map(z.string(), z.string())
  }));

  assert.deepEqual(projected.contract.properties.opaque, {
    unprojected: [{ reason: "unsupported_schema_construct", construct: "ZodMap" }]
  });
  assert.deepEqual(projected.unprojected, [
    { path: "$.opaque", reason: "unsupported_schema_construct", construct: "ZodMap" }
  ], "the omission is reported by request path so a contract can state its own coverage");
});

test("a genuinely unconstrained input still projects as an empty contract, and is not an omission", () => {
  const projected = projectZodRequestContract(z.object({
    payload: z.unknown(),
    anything: z.any()
  }));
  assert.deepEqual(projected.contract.properties.payload, {});
  assert.deepEqual(projected.contract.properties.anything, {});
  assert.equal(
    projected.unprojected,
    undefined,
    "`z.unknown()` states no constraint because there is none; that is not something the projector failed to read"
  );
});

test("a check the projector does not model is named on the field it constrains", () => {
  const projected = projectZodRequestContract(z.object({
    contact: z.string().email(),
    ratio: z.number().multipleOf(0.5)
  }));

  assert.deepEqual(projected.contract.properties.contact.unprojected,
    [{ reason: "unsupported_check", check: "email" }]);
  assert.equal(projected.contract.properties.contact.type, "string",
    "what the projector COULD read is still reported");
  assert.deepEqual(projected.contract.properties.ratio.unprojected,
    [{ reason: "unsupported_check", check: "multipleOf" }]);
  assert.deepEqual(projected.unprojected.map((entry) => entry.path), ["$.contact", "$.ratio"]);
});

test("a request deeper than the projector walks reports exhaustion rather than an empty contract", () => {

  let deep = z.object({ leaf: z.string().min(3) }).strict();
  for (let level = 0; level < 70; level += 1) deep = z.object({ next: deep }).strict();

  const projected = projectZodRequestContract(deep);

  const exhausted = projected.unprojected.filter(
    (entry) => entry.reason === "max_depth_exceeded");
  assert.ok(exhausted.length > 0, "the walk stopped and the contract must say where");
  assert.equal(exhausted[0].max_depth, 64);
  assert.match(exhausted[0].path, /^\$(\.next)+$/u,
    "the path names exactly where the projection stopped");
});

test("a default the schema supplies is reported, because the caller did not send it", () => {
  const { contract } = projectZodRequestContract(z.object({
    limit: z.number().int().default(10)
  }).strict());
  assert.equal(contract.properties.limit.default, 10);
  assert.ok(!(contract.required ?? []).includes("limit"));
});

test("a record publishes its value shape, which is the only constraint it has", () => {
  const { contract } = projectZodRequestContract(z.object({
    mechanism: z.record(z.string().max(64))
  }));
  assert.deepEqual(contract.properties.mechanism, {
    type: "object", additionalProperties: { type: "string", maxLength: 64 }
  });
});

test("an undeclared refinement is reported, with the owner's own guidance, not unwrapped away", () => {
  const projected = projectZodRequestContract(z.object({
    focus: z.string().regex(/^[a-z-]+$/u)
      .refine((value) => Buffer.byteLength(value, "utf8") <= 128, "too long")
      .describe("at most 128 UTF-8 bytes")
  }).strict());

  const field = projected.contract.properties.focus;
  assert.equal(field.pattern, "^[a-z-]+$", "the readable half is still projected");
  assert.deepEqual(field.unprojected, [{
    reason: "undeclared_refinement",
    effect: "refinement",
    guidance: "at most 128 UTF-8 bytes"
  }], "an unreadable rule with guidance must hand the guidance over, not drop both");
  assert.deepEqual(projected.unprojected.map((entry) => entry.path), ["$.focus"]);
});

test("a refinement with no guidance at all is still reported, so the gap is visible", () => {
  const projected = projectZodRequestContract(z.object({
    token: z.string().refine((value) => value.startsWith("t_"))
  }).strict());
  assert.deepEqual(projected.contract.properties.token.unprojected,
    [{ reason: "undeclared_refinement", effect: "refinement" }]);
});

test("a declared cross-field rule is published on the object it constrains, and reports no omission", () => {
  const schema = withDeclaredCrossFieldRules(
    z.object({
      offset: z.number().int().optional(),
      length: z.number().int().optional()
    }).strict(),
    [allOrNone({ fields: ["offset", "length"] })]
  );

  const projected = projectZodRequestContract(schema);

  assert.deepEqual(projected.contract.constraints, [{
    constraint: "all_or_none",
    fields: ["offset", "length"],
    statement: "offset and length must be supplied together."
  }]);
  assert.equal(projected.unprojected, undefined,
    "a rule the contract states is not a rule the contract omitted");
});

test("a declared rule and the refusal it produces come from one definition", () => {
  const rule = allOrNone({ fields: ["offset", "length"] });
  const schema = withDeclaredCrossFieldRules(
    z.object({
      offset: z.number().int().optional(),
      length: z.number().int().optional()
    }).strict(),
    [rule]
  );

  assert.equal(schema.safeParse({ offset: 0 }).success, false);
  assert.equal(schema.safeParse({ offset: 0, length: 8 }).success, true);
  assert.equal(schema.safeParse({}).success, true);
  assert.equal(
    schema.safeParse({ offset: 0 }).error.issues[0].message,
    rule.declaration.statement,
    "the refusal a caller receives is the sentence the contract gave it"
  );
});

test("a described field that also declares its rule machine-readably does not pay for the sentence twice", () => {
  const declared = declareRequestConstraints(
    z.string().refine((value) => value.length <= 8, "too long").describe("at most 8 characters"),
    [{ constraint: "max_length", maximum: 8, statement: "at most 8 characters" }]
  );
  const { contract } = projectZodRequestContract(z.object({ slug: declared }).strict());
  assert.equal(contract.properties.slug.description, undefined);
  assert.deepEqual(contract.properties.slug.constraints,
    [{ constraint: "max_length", maximum: 8, statement: "at most 8 characters" }]);
});

test("a non-schema projects as null rather than as an empty contract", () => {
  assert.equal(projectZodRequestContract(null), null);
  assert.equal(projectZodRequestContract({ type: "object" }), null);
});

test("a definition the schema shares between two places is hoisted once and referenced by a short name", () => {
  const referent = z.object({
    repository: z.string().min(1).max(256),
    path: z.string().min(1).max(1024),
    symbol: z.string().min(1).max(512)
  }).strict();
  const projected = projectZodRequestContract(z.object({
    subject: referent,
    verifier: referent
  }).strict());

  const names = Object.keys(projected.$defs ?? {});
  assert.equal(names.length, 1, "one shared instance must produce exactly one definition");
  assert.deepEqual(projected.contract.properties.subject, { $ref: `#/$defs/${names[0]}` });
  assert.deepEqual(projected.contract.properties.verifier, { $ref: `#/$defs/${names[0]}` });
  assert.ok(
    JSON.stringify(projected.contract.properties.subject).length < 40,
    "the reference must be short; a long pointer path costs more than the definition it replaces"
  );
});

test("hoisting only happens when the reference is genuinely cheaper than repeating the definition", () => {
  const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
  const projected = projectZodRequestContract(z.object({
    expected_unit_digest: digest,
    expected_content_digest: digest
  }).strict());

  assert.equal(projected.$defs, undefined, "a small shared scalar stays inline");
  assert.equal(
    projected.contract.properties.expected_unit_digest.pattern,
    "^sha256:[0-9a-f]{64}$",
    "a caller must learn a field's constraint from that field, not by chasing a reference"
  );
});

test("two distinct instances of the same shape are not merged into one definition", () => {
  const projected = projectZodRequestContract(z.object({
    left: z.object({ a: z.string().min(1).max(256), b: z.string().min(1).max(256) }).strict(),
    right: z.object({ a: z.string().min(1).max(256), b: z.string().min(1).max(256) }).strict()
  }).strict());
  assert.equal(projected.$defs, undefined);
  assert.equal(projected.contract.properties.left.type, "object");
  assert.equal(projected.contract.properties.right.type, "object");
});

const ANSWER_UNION = (() => {
  const referent = z.object({
    kind: z.literal("code_symbol"),
    repository: z.string().min(1).max(256),
    path: z.string().min(1).max(1024),
    symbol: z.string().min(1).max(512)
  }).strict();
  return z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("advance_authoring") }).strict(),
    z.object({ kind: z.literal("obligation_wording"), statement: z.string().min(1).max(16_384) }).strict(),
    z.object({ kind: z.literal("mapping"), subject: referent, verifier: referent }).strict()
  ]);
})();

test("the discriminator values are read from the union that is actually enforced", () => {
  assert.deepEqual(
    zodDiscriminatedUnionDiscriminatorValues(ANSWER_UNION),
    ["advance_authoring", "obligation_wording", "mapping"]
  );
  assert.equal(zodDiscriminatedUnionDiscriminatorValues(z.object({ a: z.string() })), null);
});

test("a question receives the contract for exactly the answers it admits", () => {
  const projected = projectZodDiscriminatedUnionMembers(ANSWER_UNION, ["obligation_wording"]);

  assert.equal(projected.schema_version, ZOD_REQUEST_CONTRACT_SCHEMA_VERSION);
  assert.equal(projected.discriminator, "kind");
  assert.deepEqual(Object.keys(projected.members), ["obligation_wording"]);
  assert.deepEqual(projected.members.obligation_wording.properties.statement, {
    type: "string", minLength: 1, maxLength: 16_384
  });
  assert.equal(
    JSON.stringify(projected).includes("advance_authoring"),
    false,
    "the answers this question does not admit must not be delivered with it"
  );
});

test("a two-answer question pays once for a definition its answers share", () => {
  const projected = projectZodDiscriminatedUnionMembers(ANSWER_UNION, ["mapping", "advance_authoring"]);
  assert.deepEqual(Object.keys(projected.members).sort(), ["advance_authoring", "mapping"]);
  const definitionNames = Object.keys(projected.$defs ?? {});
  assert.equal(definitionNames.length, 1, "subject and verifier share one referent instance");
  assert.deepEqual(
    projected.members.mapping.properties.subject,
    projected.members.mapping.properties.verifier
  );
});

test("selecting no known answer projects nothing rather than the whole union", () => {
  assert.equal(projectZodDiscriminatedUnionMembers(ANSWER_UNION, []), null);
  assert.equal(projectZodDiscriminatedUnionMembers(ANSWER_UNION, ["not_a_kind"]), null);
  assert.equal(projectZodDiscriminatedUnionMembers(z.object({ a: z.string() }), ["a"]), null);
});

test("WK-2589 projection-equivalence", () => {
  const shared = z.object({
    identity: z.string().min(1).max(512).describe("Stable repository identity"),
    values: z.array(z.number().int().min(0).max(64)).min(1).max(8)
  }).strict();
  const projected = projectZodRequestContract(z.object({ left: shared, right: shared }).strict());
  const name = Object.keys(projected.$defs ?? {})[0];
  assert.ok(name);
  assert.deepEqual(projected.contract.properties.left, { $ref: `#/$defs/${name}` });
  assert.deepEqual(projected.contract.properties.right, { $ref: `#/$defs/${name}` });
  assert.equal(projected.$defs[name].properties.identity.description,
    "Stable repository identity");
  assert.deepEqual(projected.$defs[name].properties.values.items,
    { type: "integer", minimum: 0, maximum: 64 });
});

test("WK-2589 omission-completeness", () => {
  const incomplete = z.object({
    address: z.string().email().describe("A validated address"),
    nested: z.object({ ratio: z.number().multipleOf(0.5) }).strict()
  }).strict();
  const projected = projectZodRequestContract(z.object({ left: incomplete, right: incomplete }).strict());
  assert.equal(projected.$defs, undefined, "a subtree containing any omission stays inline");
  assert.deepEqual(projected.unprojected.map(({ path, reason }) => ({ path, reason })), [
    { path: "$.left.address", reason: "unsupported_check" },
    { path: "$.left.nested.ratio", reason: "unsupported_check" },
    { path: "$.right.address", reason: "unsupported_check" },
    { path: "$.right.nested.ratio", reason: "unsupported_check" }
  ]);
  assert.equal(projected.contract.properties.left.properties.address.unprojected[0].check,
    "email");
  assert.equal(projected.contract.properties.right.properties.nested.properties.ratio
    .unprojected[0].check, "multipleOf");
});

test("WK-2589 termination-serialization", () => {
  let deep = z.object({ leaf: z.string().min(3) }).strict();
  for (let level = 0; level < 70; level += 1) deep = z.object({ next: deep }).strict();
  const projected = projectZodRequestContract(z.object({ first: deep, second: deep }).strict());
  assert.doesNotThrow(() => JSON.stringify(projected));
  assert.equal(projected.$defs, undefined,
    "depth-sensitive incomplete occurrences cannot be hidden behind a definition");
  assert.equal(projected.unprojected.filter(({ reason }) =>
    reason === "max_depth_exceeded").length, 2);
  assert.notEqual(projected.unprojected[0].path, projected.unprojected[1].path);
});
