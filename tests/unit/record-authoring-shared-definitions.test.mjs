

import assert from "node:assert/strict";
import test from "node:test";

import { CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_UPSERT_INPUT_SCHEMA } from
  "../../packages/wiki-core/src/lib/controlled-contract-tools.mjs";
import { RECORD_AUTHORING_SLICE_CONTEXT, WORK_ITEM_BIRTH_SHARED_DEFINITIONS, WORK_ITEM_SHARED_DEFINITIONS, recordAuthoringChangeSchema,
  workItemRequirementBatchSchema } from
  "../../packages/wiki-core/src/lib/record-authoring-schema.mjs";
import { WORK_RECORD_READY_SLICE_EXPECTED_EDIT_TARGET_SCHEMA } from
  "../../packages/wiki-core/src/lib/work-record-ready-slice-contract.mjs";
import { RECORD_AUTHORING_SHARED_DEFINITION_CODES as CODES, recordAuthoringDefinitionName,
  recordAuthoringDefinitionReference, resolveRecordAuthoringDefinition, shareRecordAuthoringDefinitions } from
  "../../packages/wiki-core/src/lib/record-authoring-shared-definitions.mjs";

const snapshot = value => JSON.parse(JSON.stringify(value));
const refused = (code, name) => error => error.code === code && error.definition === name && error.message.includes(name);

function dereferenced(schema, node = schema.properties) {
  if (Array.isArray(node)) return node.map(item => dereferenced(schema, item));
  if (node === null || typeof node !== "object") return node;
  if (typeof node.$ref === "string") return dereferenced(schema, schema.$defs[node.$ref.slice("#/$defs/".length)]);
  return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, dereferenced(schema, value)]));
}
const references = value => JSON.stringify(value).match(/"\$ref":"[^"]+"/gu) ?? [];

test("a work item's repeated owner objects are stated once and mean what they did", () => {
  for (const context of ["existing", RECORD_AUTHORING_SLICE_CONTEXT]) {
    const schema = recordAuthoringChangeSchema("work_item", context);
    const { case: obligationCase } = WORK_ITEM_SHARED_DEFINITIONS;

    const shared = Object.values(WORK_ITEM_SHARED_DEFINITIONS);
    assert.deepEqual(shared, ["obligation_case", "case_component", "case_target", "case_falsification", "ready_slice_edit_targets"]);
    assert.deepEqual(Object.keys(schema.$defs).slice(-shared.length), shared, context);
    assert.equal(recordAuthoringChangeSchema("work_item", context), schema, "one schema per variant");
    assert.deepEqual(Object.keys(schema.$defs), [...new Set(Object.keys(schema.$defs))]);

    const [newObligation, savedObligation] = schema.properties.obligations.items.oneOf;
    for (const [row, member, name] of [[newObligation, "case", obligationCase], [savedObligation, "case", obligationCase]]) {
      assert.deepEqual(row.properties[member], { $ref: `#/$defs/${name}` }, `${context}: ${member}`);
      assert.equal(resolveRecordAuthoringDefinition(schema, row.properties[member]), schema.$defs[name]);
    }
    assert.equal(references(schema.properties).filter(ref => ref.endsWith(`${obligationCase}"`)).length, 2);

    const batch = workItemRequirementBatchSchema(context);
    const { $defs: batchDefinitions, ...batchNode } = batch;
    assert.deepEqual(snapshot(schema.properties.requirements), snapshot(batchNode), context);
    for (const [name, body] of Object.entries(batchDefinitions)) assert.equal(schema.$defs[name], body, `${context}: ${name} is the batch owner's node`);
    assert.deepEqual(schema.properties.requirements.properties.requirements.items,
      { oneOf: [{ $ref: "#/$defs/requirement" }, { $ref: "#/$defs/membership_requirement" }] });
    const [statementRow, membershipRow] = [schema.$defs.requirement, schema.$defs.membership_requirement];
    for (const row of [statementRow, membershipRow]) assert.deepEqual(row.properties.verification, { $ref: "#/$defs/requirement_verification" });
    assert.deepEqual([statementRow.properties.behavior, statementRow.properties.subject, membershipRow.properties.subject],
      [{ $ref: "#/$defs/behavior" }, { $ref: "#/$defs/entity_id" }, { $ref: "#/$defs/entity_id" }]);

    const verificationBody = schema.$defs.requirement_verification;
    for (const variant of verificationBody.anyOf) {
      assert.deepEqual([variant.type, variant.additionalProperties, variant.properties.key.pattern, variant.required.includes("method")],
        ["object", false, "^[a-z][a-z0-9-]{0,63}$", true]);
      assert.deepEqual([variant.properties.observes, variant.properties.fails_when, variant.properties.verifier],
        [{ $ref: "#/$defs/observation" }, { $ref: "#/$defs/behavior" }, { $ref: "#/$defs/entity_id" }]);
    }

    assert.equal(/"(?:select|declare|expression|cel)"/u.test(JSON.stringify([batchNode, batchDefinitions])), false);

    const caseBody = schema.$defs[obligationCase];
    assert.deepEqual([caseBody["x-record-authoring-row"], caseBody.oneOf.length, caseBody.oneOf[1].required.includes("id"),
      caseBody.oneOf.every(variant => variant.additionalProperties === false)], ["key_optional", 2, true, true]);

    const order = Object.keys(schema.$defs);
    for (const [name, body] of Object.entries(schema.$defs)) {
      assert.equal(Object.hasOwn(body, "$ref"), false, `${name} is no alias`);
      for (const reference of references(body)) {
        const target = JSON.parse(`{${reference}}`).$ref.slice("#/$defs/".length);
        assert.ok(order.indexOf(target) > order.indexOf(name) || !shared.includes(name),
          `${name} refers only onward, to ${target}`);
        assert.ok(order.includes(target), `${name}: ${target} is defined here`);
      }
    }

    const owner = CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_UPSERT_INPUT_SCHEMA;
    const ownerCase = owner.properties.obligations.items.properties.case.properties;
    const resolved = name => dereferenced(schema, schema.$defs[name]);
    assert.deepEqual([resolved("case_component"), resolved("case_target"), resolved("case_falsification")],
      [snapshot(ownerCase.component), snapshot(ownerCase.target), snapshot(ownerCase.falsification)]);
    assert.deepEqual(resolved("ready_slice_edit_targets"),
      { type: "array", items: snapshot(WORK_RECORD_READY_SLICE_EXPECTED_EDIT_TARGET_SCHEMA) });
    assert.deepEqual(caseBody.oneOf.map(variant => [variant.properties.component, variant.properties.target, variant.properties.falsification]),
      Array(2).fill([{ $ref: "#/$defs/case_component" }, { $ref: "#/$defs/case_target" }, { $ref: "#/$defs/case_falsification" }]));
    assert.deepEqual(schema.properties.ready_slices.items.oneOf.map(row => row.properties.expected_edit_targets),
      Array(2).fill({ $ref: "#/$defs/ready_slice_edit_targets" }));

    const meaning = dereferenced(schema);
    const birth = dereferenced(recordAuthoringChangeSchema("work_item", "birth"));
    assert.deepEqual(meaning.ready_slices.items.oneOf[0], snapshot(birth.ready_slices.items));
    const { case: resolvedCase, ...resolvedObligation } = meaning.obligations.items.oneOf[0].properties;
    const { case: birthCase, ...birthObligation } = snapshot(birth.obligations.items.properties);
    assert.deepEqual([resolvedObligation, resolvedCase.oneOf[0]], [birthObligation, birthCase]);
    assert.deepEqual(meaning.obligations.items.oneOf[0].properties.case, meaning.obligations.items.oneOf[1].properties.case);
    assert.equal(references(meaning).length, 0);
  }
});

test("birth shares repeated content and target provenance while other kinds keep their own schemas", () => {
  const birth = recordAuthoringChangeSchema("work_item", "birth");
  const existing = recordAuthoringChangeSchema("work_item", "existing");
  const names = Object.values(WORK_ITEM_SHARED_DEFINITIONS);
  assert.equal(names.some(name => Object.hasOwn(birth.$defs, name)), false, "birth declares no shared row definition");

  const { contentCarrier } = WORK_ITEM_BIRTH_SHARED_DEFINITIONS;
  assert.deepEqual([contentCarrier, Object.keys(birth.$defs).at(-2), Object.hasOwn(birth.$defs[contentCarrier], "$ref"),
    references(birth.$defs[contentCarrier]).length], ["content_carrier", "content_carrier", false, 0]);
  const carrier = { $ref: "#/$defs/content_carrier" };
  for (const member of ["summary", "user_requirements", "why_it_matters", "notes"]) {
    assert.deepEqual(birth.properties[member], { anyOf: [{ type: "string" }, carrier] }, member);
  }
  assert.deepEqual(birth.properties.entries.items.properties.content, carrier);
  assert.equal(references(birth.properties).filter(ref => ref.endsWith('content_carrier"')).length, 8);

  const inlineCarrier = snapshot(existing.properties.summary.anyOf[1]);
  assert.deepEqual(snapshot(birth.$defs[contentCarrier]), inlineCarrier);
  assert.deepEqual(dereferenced(birth).summary, snapshot(existing.properties.summary));
  const changed = structuredClone(birth);
  changed.$defs[contentCarrier].oneOf[2].properties.parts.minItems = 0;
  assert.notDeepEqual(dereferenced(changed).summary, snapshot(existing.properties.summary));
  const { [contentCarrier]: _withheld, ...remaining } = birth.$defs;
  assert.throws(() => resolveRecordAuthoringDefinition({ ...birth, $defs: remaining }, birth.properties.entries.items.properties.content),
    refused(CODES.REFERENCE_UNRESOLVED, contentCarrier));
  assert.equal(references(birth.properties).some(ref => names.some(name => ref.endsWith(`${name}"`))), false);

  const selectors = ["row_id", "id", "rebind_case_ids"];
  assert.deepEqual(Object.keys(birth.$defs.requirement.properties),
    Object.keys(existing.$defs.requirement.properties).filter(member => !selectors.includes(member)));
  assert.deepEqual(Object.keys(birth.$defs.membership_requirement.properties),
    Object.keys(existing.$defs.membership_requirement.properties).filter(member => !selectors.includes(member)));
  assert.equal(Object.hasOwn(birth.$defs.collection.properties, "row_id"), false);
  for (const name of ["requirement_verification", "behavior", "entities", "membership_clause", "unresolved_meaning"]) {
    assert.deepEqual(snapshot(birth.$defs[name]), snapshot(existing.$defs[name]), name);
  }
  const meaning = dereferenced(existing);
  assert.deepEqual(snapshot(birth.properties.obligations.items.properties.case),
    meaning.obligations.items.oneOf[0].properties.case.oneOf[0]);
  for (const kind of ["initiative", "decision"]) {
    const schema = recordAuthoringChangeSchema(kind, "existing");
    assert.equal(names.some(name => Object.hasOwn(schema.$defs, name)), false, kind);
    assert.notEqual(schema.$defs, existing.$defs, `${kind}: definitions are not shared across variants' caches`);
  }
  assert.notEqual(birth.$defs, existing.$defs);
});

test("birth target provenance keeps the ready-slice owner's complete meaning and refuses missing definitions", () => {
  const ownerBefore = snapshot(WORK_RECORD_READY_SLICE_EXPECTED_EDIT_TARGET_SCHEMA);
  const birth = recordAuthoringChangeSchema("work_item", "birth");
  const { editTargetProvenance: name } = WORK_ITEM_BIRTH_SHARED_DEFINITIONS;
  const target = birth.properties.ready_slices.items.properties.expected_edit_targets.items;
  const fields = ownerBefore.properties.facet_provenance.properties;
  assert.equal(Object.keys(birth.$defs).at(-1), name);
  assert.deepEqual(birth.$defs[name], fields.path);
  for (const field of Object.keys(fields)) {
    assert.deepEqual(target.properties.facet_provenance.properties[field], { $ref: `#/$defs/${name}` });
    assert.deepEqual(dereferenced(birth, target.properties.facet_provenance.properties[field]), fields[field]);
  }
  assert.deepEqual(dereferenced(birth, target), ownerBefore);
  const changed = structuredClone(birth);
  changed.$defs[name].anyOf[0].enum = changed.$defs[name].anyOf[0].enum.slice(1);
  assert.notDeepEqual(dereferenced(changed, target), ownerBefore, "a removed allowed provenance is a different meaning");
  const { [name]: _withheld, ...remaining } = birth.$defs;
  assert.throws(() => resolveRecordAuthoringDefinition({ ...birth, $defs: remaining },
    target.properties.facet_provenance.properties.path), refused(CODES.REFERENCE_UNRESOLVED, name));
  assert.deepEqual(snapshot(WORK_RECORD_READY_SLICE_EXPECTED_EDIT_TARGET_SCHEMA), ownerBefore, "the owner is never mutated");
});

test("sharing copies only the path to a shared node and never changes an input", () => {
  const shared = { type: "object", description: "Shared.", additionalProperties: false, required: ["a"],
    properties: { a: { type: "string", minLength: 1 } } };
  const untouched = { type: "array", items: { type: "string" } };
  const properties = { rows: { oneOf: [{ type: "object", properties: { nested: shared, other: untouched } },
    { type: "object", properties: { nested: shared } }] }, plain: untouched };
  const definitions = { existing: { type: "integer" } };
  const before = snapshot({ properties, definitions, shared });
  const result = shareRecordAuthoringDefinitions({ properties, definitions, shared: [["nested_row", shared]] });
  assert.deepEqual(snapshot({ properties, definitions, shared }), before, "no input is mutated");
  assert.deepEqual(Object.keys(result.$defs), ["existing", "nested_row"], "appended after the definitions already there");
  assert.equal(result.$defs.nested_row, shared, "the definition is the owner's own node");
  assert.equal(result.$defs.existing, definitions.existing);
  assert.deepEqual(result.properties.rows.oneOf.map(row => row.properties.nested),
    [{ $ref: "#/$defs/nested_row" }, { $ref: "#/$defs/nested_row" }]);
  assert.equal(result.properties.plain, untouched, "a subtree holding no shared node keeps its identity");
  assert.equal(result.properties.rows.oneOf[0].properties.other, untouched);
  assert.notEqual(result.properties.rows, properties.rows, "the path to a replacement is a copy");

  assert.deepEqual(shareRecordAuthoringDefinitions({ properties, definitions, shared: [["nested_row", shared]] }), result);
  const inner = { type: "string", enum: ["x"] };
  const outer = { type: "object", properties: { inner } };
  const nested = shareRecordAuthoringDefinitions({ properties: { a: outer, b: outer, c: inner }, shared: [["outer", outer], ["inner", inner]] });
  assert.deepEqual([Object.keys(nested.$defs), nested.$defs.outer.properties.inner, nested.properties.c],
    [["outer", "inner"], { $ref: "#/$defs/inner" }, { $ref: "#/$defs/inner" }], "a shared node inside another is referenced there too");
});

test("a name that collides, a node that is unused or a reference that cannot be followed fails by name", () => {
  const node = { type: "object", properties: {} };
  const properties = { a: node, b: node };
  const share = (shared, definitions = { taken: {} }) => () => shareRecordAuthoringDefinitions({ properties, definitions, shared });
  assert.throws(share([["taken", node]]), refused(CODES.NAME_COLLISION, "taken"));
  assert.throws(share([["once", node], ["once", { type: "string" }]]), refused(CODES.NAME_COLLISION, "once"));
  assert.throws(share([["unused", { type: "object", properties: {} }]]), refused(CODES.NODE_UNUSED, "unused"));
  assert.throws(share([["Bad-Name", node]]), refused(CODES.NAME_INVALID, "Bad-Name"));
  assert.throws(share([["alias", { $ref: "#/$defs/taken" }]]), refused(CODES.NODE_INVALID, "alias"));
  assert.throws(share([["scalar", "text"]]), refused(CODES.NODE_INVALID, "scalar"));

  const schema = { $defs: { present: { type: "string" }, alias: { $ref: "#/$defs/present" } } };
  assert.equal(resolveRecordAuthoringDefinition(schema, { type: "integer" }).type, "integer", "a node that is no reference is itself");
  assert.equal(resolveRecordAuthoringDefinition(schema, recordAuthoringDefinitionReference("present")), schema.$defs.present);
  assert.throws(() => resolveRecordAuthoringDefinition(schema, { $ref: "#/$defs/absent" }), refused(CODES.REFERENCE_UNRESOLVED, "absent"));
  assert.throws(() => resolveRecordAuthoringDefinition(schema, { $ref: "#/$defs/alias" }), refused(CODES.REFERENCE_UNSUPPORTED, "alias"));
  for (const unsupported of ["https://example.test/schema.json", "#/properties/a", "#/$defs/present/properties/x", "#/$defs/Bad Name"]) {
    assert.throws(() => recordAuthoringDefinitionName({ $ref: unsupported }),
      error => error.code === CODES.REFERENCE_UNSUPPORTED && error.message.includes(unsupported), unsupported);
  }
  assert.throws(() => recordAuthoringDefinitionName({ $ref: 7 }), error => error.code === CODES.REFERENCE_UNSUPPORTED);
  assert.equal(recordAuthoringDefinitionName({ type: "string" }), null);
});
