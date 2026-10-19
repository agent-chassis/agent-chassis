import { inputContractChoices } from '../../packages/wiki-mcp/src/lib/task-read-wiki-input-contract-choices.mjs';

import { admit } from '../../packages/wiki-core/src/lib/controlled-requirement-authoring-schema.mjs';
import { relationCapability } from '../../packages/wiki-core/src/lib/requirement-schema-exposure.mjs';
import { CONTROLLED_VOCABULARY } from '@agent-chassis/controlled-contract/vocabulary';
import { requirementSchemaBranch, requirementSchemaDetail, requirementSchemaIdentity, inferredRequirementCapabilities } from '../../packages/wiki-mcp/src/lib/requirement-authoring-schema-guidance.mjs';
import { REQUIREMENT_AUTHORING_GUIDANCE, requirementGuidanceRevision, resolveRequirementAuthoringGuidance } from '../../packages/wiki-mcp/src/lib/requirement-authoring-guidance.mjs';
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { z } from "zod";

import { RECORD_AUTHORING_LABEL_PATTERN, WORK_ITEM_SLICE_CONTRACT_MEMBERS, workItemRequirementBatchSchema } from
  "../../packages/wiki-core/src/lib/record-authoring-schema.mjs";
import { createRequire } from "node:module";
import { INPUT_SCHEMA_EXPOSURE_CODES, bindInputSchemaExposure, compactInputSchemaAdvertisement,
  isScalarMemberDeclaration, sameInputSchemaExposure } from
  "../../packages/wiki-mcp/src/lib/input-schema-exposure.mjs";
import { REGISTERED_TOOL_REQUEST_CONTRACT_CODES, createRegisteredToolRequestContractStore } from
  "../../packages/wiki-mcp/src/lib/registered-tool-request-contracts.mjs";
import { SAVE_RECORD_INPUT_EXPOSURE_CODES, SAVE_RECORD_WHOLE_RECORD_GROUP, createSaveRecordInputExposure } from
  "../../packages/wiki-mcp/src/lib/save-record-input-exposure.mjs";
import { createSaveRecordInputContract, saveRecordUnitVariant } from
  "../../packages/wiki-mcp/src/lib/task-save-record-tools.mjs";

const CODES = INPUT_SCHEMA_EXPOSURE_CODES;
const snapshot = value => JSON.parse(JSON.stringify(value));
const refusedWith = (code, at = null) => (error) => {
  assert.equal(error.code, code, error.message);
  if (at !== null) assert.equal(error.path, at, error.message);
  return true;
};

const VARIANTS = ["WK-0001", "WK-0001#SLICE-001", "IN-0001", "DEC-0001"].map(unit => saveRecordUnitVariant(unit));
const realDeclaration = (changeSchemas = createSaveRecordInputContract(z).changeSchemas) =>
  createSaveRecordInputExposure({ changeSchemas, variants: VARIANTS, registeredTier: "paid_cce" });
const sourceIdentity = (schema, variant = "work_item") => {
  const declaration = realDeclaration({ ...createSaveRecordInputContract(z).changeSchemas, [variant]: schema }).sources[variant];
  return { schema, branches: Object.fromEntries(Object.entries(declaration.branches ?? {}).map(([member, branch]) => [member, branch.metadata])), guidance: declaration.guidance ?? {} };
};
const sha256 = value => `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
const pick = (object, names) => Object.fromEntries(names.map(name => [name, object[name]]));
const ACCEPTANCE_MEMBERS = Object.freeze({
  work_item: ["criteria", "requirements", "obligations", "controlled_acceptance", "refresh_proofs"],
  work_item_slice: ["criteria", "requirements", "obligations", "controlled_acceptance"]
});

const syntheticSource = () => ({
  type: "object", additionalProperties: false, minProperties: 1,
  $defs: {
    id: { type: "string", pattern: "^[a-z]+$" },
    row: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { $ref: "#/$defs/id" } } },
    tree: { type: "object", properties: { children: { type: "array", items: { $ref: "#/$defs/tree" } } } },
    a: { anyOf: [{ $ref: "#/$defs/b" }, { type: "null" }] },
    b: { type: "object", properties: { back: { $ref: "#/$defs/a" } } },
    unreached: { type: "integer" },
    "with/slash": { const: 1 }
  },
  properties: {
    plain: { type: "string", minLength: 1 },
    rows: { type: "array", minItems: 1, items: { $ref: "#/$defs/row" } },
    owner: { $ref: "#/$defs/id" },
    forest: { $ref: "#/$defs/tree" },
    loop: { $ref: "#/$defs/a" },
    escaped: { $ref: "#/$defs/with~1slash" },
    open: { type: "object", additionalProperties: { type: "string" } },
    data: { const: { $ref: "#/$defs/missing" }, enum: [{ $ref: "elsewhere" }],
      properties: { $ref: { type: "string" } } }
  }
});
const group = (schema, name = "all") => [{ name, members: Object.keys(schema.properties) }];
const bindSynthetic = (schema = syntheticSource(), extra = {}) =>
  bindInputSchemaExposure({ digest: sha256, sources: { synthetic: { schema, groups: group(schema), ...extra } } })
    .source("synthetic");

test("selected input contracts preserve authoritative variant schemas", async (t) => {
  const { changeSchemas } = createSaveRecordInputContract(z);
  const before = snapshot(changeSchemas);
  const binding = bindInputSchemaExposure(realDeclaration(changeSchemas));
  assert.deepEqual(binding.sourceNames, ["work_item", "work_item_slice", "initiative", "decision"]);

  await t.test("every member of every variant is selected verbatim and has exactly one home", () => {
    for (const name of binding.sourceNames) {
      const source = binding.source(name);
      const owner = before[name];
      assert.deepEqual(source.members, Object.keys(owner.properties), name);
      assert.deepEqual(source.groups.flatMap(({ members }) => members).sort(), Object.keys(owner.properties).sort(),
        `${name}: every source member is assigned once`);
      for (const member of source.members) {
        const selected = source.select({ members: [member] });
        assert.deepEqual(selected.members, [member]);
        assert.deepEqual(selected.schema.properties, { [member]: owner.properties[member] }, `${name}.${member}`);
        assert.equal(selected.schema.properties[member], changeSchemas[name].properties[member],
          `${name}.${member} is the owner's own node, not a copy`);

        assert.deepEqual(pick(selected.schema, ["type", "additionalProperties", "minProperties"]),
          { type: "object", additionalProperties: false, minProperties: 1 });
      }
    }
    assert.deepEqual(snapshot(changeSchemas), before, "binding and selecting change no source");
  });

  await t.test("a job is one selection: prose, and combined acceptance authoring", () => {
    const record = binding.source("work_item");
    const prose = record.select({ members: ["notes"] });
    assert.deepEqual(prose.schema, { type: "object", additionalProperties: false, minProperties: 1,
      if: before.work_item.if, then: before.work_item.then,
      $defs: { content_carrier: before.work_item.$defs.content_carrier },
      properties: { notes: before.work_item.properties.notes } });
    assert.deepEqual(prose.guidance, []);

    for (const [variant, members] of Object.entries(ACCEPTANCE_MEMBERS)) {
      const source = binding.source(variant);
      const acceptance = source.select({ groups: ["acceptance"] });
      assert.deepEqual(acceptance.members, members, variant);
      assert.deepEqual(acceptance.schema.properties, pick(before[variant].properties, members));
      assert.deepEqual(acceptance.guidance.map(({ member }) => member), ["requirements", "obligations"]);
      assert.ok(acceptance.guidance.every(({ topics }) => topics.length > 0 && topics.every(topic => topic.length > 0)));

      const bundle = source.select({ groups: ["acceptance", "tasks"], members: ["title", "criteria"] });
      assert.deepEqual(bundle.members, ["title", "tasks", ...members]);
      assert.deepEqual(bundle.schema.properties, pick(before[variant].properties, bundle.members));
    }

    for (const name of ["initiative", "decision"]) {
      const whole = binding.source(name).select({ groups: [SAVE_RECORD_WHOLE_RECORD_GROUP] });
      assert.deepEqual(whole.schema.properties, before[name].properties, name);
    }
  });

  await t.test("a work-item selection carries exactly the owner definitions it reaches", () => {

    const reached = (owner, members) => {
      const names = new Set();
      (function walk(node) {
        if (Array.isArray(node)) return node.forEach(walk);
        if (node === null || typeof node !== "object") return undefined;
        if (typeof node.$ref === "string") {
          const name = node.$ref.slice("#/$defs/".length);
          if (!names.has(name)) { names.add(name); walk(owner.$defs[name]); }
          return undefined;
        }
        return Object.values(node).forEach(walk);
      })(members.map(member => owner.properties[member]));
      return Object.keys(owner.$defs).filter(name => names.has(name));
    };
    const combined = ["criteria", "requirements", "obligations", "controlled_acceptance"];
    for (const name of ["work_item", "work_item_slice"]) {
      const source = binding.source(name), owner = changeSchemas[name];
      const shared = ["obligation_case", "obligation_statement", "obligation_criteria", "obligation_claims", "obligation_proof", "case_component", "case_target", "case_falsification", "ready_slice_edit_targets",
        "content_carrier", "edit_target_provenance"];

      const batchInventory = Object.keys(workItemRequirementBatchSchema().$defs);
      const batch = reached(owner, ["requirements"]);
      assert.deepEqual(Object.keys(owner.$defs).slice(-shared.length), shared, name);
      assert.deepEqual(Object.keys(owner.$defs).slice(-shared.length - batchInventory.length, -shared.length), batchInventory, name);
      for (const [members, expected] of [
        [["requirements"], batch],
        [["obligations"], shared.slice(0, 8)],
        [["ready_slices"], ["ready_slice_edit_targets", "content_carrier", "edit_target_provenance"]],
        [["criteria"], []], [["notes"], ["content_carrier"]], [["title", "tasks"], []], [["slices"], []], [["controlled_acceptance"], []],

        [combined, [...batch, ...shared.slice(0, 8)]], [[...combined.slice(1), "ready_slices"], [...batch, ...shared]]]) {
        const selected = source.select({ members });
        const defined = Object.keys(selected.schema.$defs ?? {});
        assert.deepEqual(defined, reached(owner, members), `${name}: ${members}`);
        assert.deepEqual(defined, expected, `${name}: ${members} reaches exactly its own definitions`);
        assert.equal(Object.hasOwn(selected.schema, "$defs"), expected.length > 0, `${name}: ${members}`);

        for (const definition of defined) assert.equal(selected.schema.$defs[definition], owner.$defs[definition]);
        for (const member of selected.members) assert.equal(selected.schema.properties[member], owner.properties[member]);
        const references = (JSON.stringify(selected.schema).match(/"\$ref":"[^"]+"/gu) ?? [])
          .map(reference => JSON.parse(`{${reference}}`).$ref);
        assert.ok(references.every(reference => Object.hasOwn(selected.schema.$defs ?? {}, reference.slice("#/$defs/".length))),
          `${name}: ${members} is self-contained`);
        assert.equal(selected.digest, sha256(sourceIdentity(owner, name)), `${name}: the digest is of the whole source, whatever is selected`);
      }

      const { schema } = source.select({ members: combined });
      assert.deepEqual(schema.properties.requirements.properties.requirements.items,
        { oneOf: [{ $ref: "#/$defs/requirement" }, { $ref: "#/$defs/membership_requirement" }, { $ref: "#/$defs/definition_requirement" }] });
      assert.equal(schema.$defs.definition_requirement.properties.verification, undefined,
        'a pure definition has no verification claim');
      assert.deepEqual([schema.$defs.requirement, schema.$defs.membership_requirement].map(row => row.properties.verification),
        [{ $ref: "#/$defs/requirement_verification" }, { $ref: "#/$defs/requirement_verification" }]);
      assert.deepEqual(schema.properties.obligations.items.oneOf.map(row => row.properties.case),
        [{ $ref: "#/$defs/obligation_case" }, { $ref: "#/$defs/obligation_case" }]);
    }
    assert.notEqual(binding.source("work_item").digest, binding.source("work_item_slice").digest);
    for (const name of ["initiative", "decision"]) {
      assert.equal(Object.hasOwn(binding.source(name).select({ groups: [SAVE_RECORD_WHOLE_RECORD_GROUP] }).schema, "$defs"), false, name);
    }
  });

  await t.test("nested constraints of the controlled members survive selection", () => {
    const { properties, $defs: definitions } = binding.source("work_item_slice").select({ groups: ["acceptance", "slice_shaping", "planning"] }).schema;

    const [labelled, saved] = properties.obligations.items.oneOf;
    assert.deepEqual([labelled.required, saved.required, labelled.additionalProperties, saved.additionalProperties,
      Object.hasOwn(labelled.properties, "id"), Object.hasOwn(saved.properties, "key")],
    [["key"], ["id"], false, false, false, false]);
    assert.equal(labelled.properties.key.pattern, RECORD_AUTHORING_LABEL_PATTERN);
    assert.deepEqual(properties.criteria.items.oneOf[0].required, ["key", "text"]);

    assert.deepEqual([properties.requirements.additionalProperties, Object.keys(properties.requirements.properties),
      pick(properties.requirements.properties.requirements, ["minItems", "maxItems"])],
    [false, ["entities", "requirements", "collections", "unresolved"], { minItems: 1, maxItems: 8 }]);
    assert.deepEqual([definitions.requirement.required, definitions.membership_requirement.required,
      definitions.requirement.additionalProperties, definitions.membership_requirement.additionalProperties],
    [["subject", "behavior"], ["subject", "membership"], false, false]);

    assert.deepEqual(pick(properties.controlled_acceptance, ["required", "additionalProperties", "properties"]),
      { required: ["disposition"], additionalProperties: false, properties: { disposition: { const: "required" } } });
    assert.deepEqual([labelled, saved].map(row => Object.hasOwn(row.properties, "proof_opt_out")), [false, false]);

    assert.equal(properties.validation.items.anyOf.length, before.work_item_slice.properties.validation.items.anyOf.length);
    assert.equal(properties.validation.items.anyOf[1].additionalProperties, true);
    assert.equal(definitions.obligation_proof.properties.parameters.additionalProperties, true);
    assert.equal(properties.slices.items.oneOf[0].properties.sections.additionalProperties, true);
  });

  await t.test("applicability is the variant's own source", () => {
    const record = binding.source("work_item"), slice = binding.source("work_item_slice");
    assert.deepEqual(slice.select({ groups: ["slice_assignment"] }).members, WORK_ITEM_SLICE_CONTRACT_MEMBERS);
    assert.throws(() => record.select({ groups: ["slice_assignment"] }), refusedWith(CODES.SELECTION_GROUP_UNKNOWN));
    assert.throws(() => record.select({ members: ["work_kind"] }), refusedWith(CODES.SELECTION_MEMBER_UNKNOWN));
    assert.throws(() => binding.source("initiative").select({ members: ["criteria"] }),
      refusedWith(CODES.SELECTION_MEMBER_UNKNOWN));
    assert.throws(() => binding.source("work_item_birth"), refusedWith(CODES.SOURCE_UNKNOWN));
  });

  await t.test("metadata that disagrees with its source binds nothing", () => {
    const declared = realDeclaration(changeSchemas);
    const withGroups = (name, groups) => ({ ...declared, sources: { ...declared.sources,
      [name]: { ...declared.sources[name], groups } } });
    const groups = declared.sources.work_item.groups;
    assert.throws(() => bindInputSchemaExposure(withGroups("work_item", [...groups, { name: "extra", members: ["work_kind"] }])),
      refusedWith(CODES.GROUP_MEMBER_UNKNOWN));
    assert.throws(() => bindInputSchemaExposure(withGroups("work_item", [...groups, { name: "extra", members: ["title"] }])),
      refusedWith(CODES.GROUP_MEMBER_DUPLICATE));
    assert.throws(() => bindInputSchemaExposure(withGroups("work_item", groups.filter(({ name }) => name !== "tasks"))),
      (error) => refusedWith(CODES.MEMBER_UNASSIGNED)(error) && /tasks/u.test(error.message));
    assert.throws(() => bindInputSchemaExposure({ ...declared, sources: { ...declared.sources,
      work_item: { ...declared.sources.work_item, guidance: { work_kind: [["fields"]] } } } }), refusedWith(CODES.GUIDANCE_INVALID));

    const { title: _title, ...withoutTitle } = changeSchemas.work_item.properties;
    assert.throws(() => realDeclaration({ ...changeSchemas, work_item: { ...changeSchemas.work_item, properties: withoutTitle } }),
      (error) => error.code === SAVE_RECORD_INPUT_EXPOSURE_CODES.MEMBER_NOT_IN_SOURCE && /title/u.test(error.message));
    const novel = { ...changeSchemas, work_item: { ...changeSchemas.work_item,
      properties: { ...changeSchemas.work_item.properties, novel: { type: "string" } } } };
    assert.throws(() => bindInputSchemaExposure(realDeclaration(novel)),
      (error) => refusedWith(CODES.MEMBER_UNASSIGNED)(error) && /novel/u.test(error.message));
    const { work_item_slice: _slice, ...missingVariant } = changeSchemas;
    assert.throws(() => realDeclaration(missingVariant),
      (error) => error.code === SAVE_RECORD_INPUT_EXPOSURE_CODES.VARIANT_SOURCE_MISSING);
  });

  await t.test("an empty, unknown or malformed selection is refused", () => {
    const record = binding.source("work_item");
    assert.throws(() => record.select({}), refusedWith(CODES.SELECTION_EMPTY));
    assert.throws(() => record.select({ members: [], groups: [] }), refusedWith(CODES.SELECTION_EMPTY));
    assert.throws(() => record.select({ members: ["no_such_member"] }), refusedWith(CODES.SELECTION_MEMBER_UNKNOWN));
    assert.throws(() => record.select({ groups: ["no_such_group"] }), refusedWith(CODES.SELECTION_GROUP_UNKNOWN));
    for (const malformed of [undefined, null, ["title"], "title", { members: "title" }, { members: ["title", "title"] },
      { members: [""] }, { members: [1] }, { groups: ["tasks", "tasks"] }, { members: ["title"], fields: ["notes"] }]) {
      assert.throws(() => record.select(malformed), refusedWith(CODES.SELECTION_INVALID), JSON.stringify(malformed));
    }
  });

  await t.test("reachable definitions are complete, verbatim and bounded to what is reached", () => {
    const schema = syntheticSource();
    const owner = snapshot(schema);
    const source = bindSynthetic(schema);
    const definitions = selection => Object.keys(source.select({ members: selection }).schema.$defs ?? {});
    assert.deepEqual(definitions(["plain"]), []);
    assert.equal(Object.hasOwn(source.select({ members: ["plain"] }).schema, "$defs"), false);
    assert.deepEqual(definitions(["owner"]), ["id"]);
    assert.deepEqual(definitions(["rows"]), ["id", "row"], "a nested reference brings its own references");
    assert.deepEqual(definitions(["rows", "owner"]), ["id", "row"], "a shared definition is stated once");
    assert.deepEqual(definitions(["forest"]), ["tree"], "a self-reference terminates");
    assert.deepEqual(definitions(["loop"]), ["a", "b"], "a reference cycle terminates");
    assert.deepEqual(definitions(["escaped"]), ["with/slash"]);
    assert.deepEqual(definitions(["data"]), [], "a reference-shaped value or property name is not a reference");
    const all = source.select({ groups: ["all"] });
    assert.deepEqual(Object.keys(all.schema.$defs), ["id", "row", "tree", "a", "b", "with/slash"],
      "only the unreached definition is absent, in the owner's order");
    assert.deepEqual(all.schema.$defs, pick(owner.$defs, Object.keys(all.schema.$defs)));
    assert.deepEqual(all.schema.properties, owner.properties);
    assert.equal(all.schema.$defs.row, schema.$defs.row);
    assert.deepEqual(all.schema.properties.open.additionalProperties, { type: "string" }, "an open map stays open");
    assert.deepEqual(snapshot(schema), owner);
  });

  await t.test("a definition only the object's own constraints reach comes with every selection", () => {
    const schema = syntheticSource();

    Object.assign(schema.$defs, { limit: { type: "integer", maximum: 3 },
      guard: { type: "object", properties: { size: { $ref: "#/$defs/limit" } } } });
    schema.allOf = [{ $ref: "#/$defs/guard" }, { anyOf: [{ required: ["plain"] }, { $ref: "#/$defs/id" }] }];
    const owner = snapshot(schema);
    const source = bindSynthetic(schema);
    const plain = source.select({ members: ["plain"] }).schema;
    assert.deepEqual(Object.keys(plain.$defs ?? {}), ["id", "limit", "guard"],
      "in the owner's order, transitive dependency included");
    assert.deepEqual(plain.$defs, pick(owner.$defs, ["id", "limit", "guard"]));
    assert.deepEqual(plain.allOf, owner.allOf);
    assert.equal(plain.allOf, schema.allOf, "the root constraint is the owner's own node");
    assert.deepEqual([plain.$defs.guard === schema.$defs.guard, plain.$defs.limit === schema.$defs.limit], [true, true]);

    assert.deepEqual(Object.keys(source.select({ members: ["rows", "loop"] }).schema.$defs),
      ["id", "row", "a", "b", "limit", "guard"]);
    assert.equal(Object.hasOwn(source.select({ groups: ["all"] }).schema.$defs, "unreached"), false);

    const withRoot = (constraint) => () => bindSynthetic({ ...syntheticSource(), ...constraint });
    assert.throws(withRoot({ allOf: [{ $ref: "#/$defs/absent" }] }), (error) =>
      refusedWith(CODES.REFERENCE_UNRESOLVED, "/allOf/0/$ref")(error) && error.source === "synthetic" &&
      error.cause_detail === "#/$defs/absent names no definition of this source");
    assert.throws(withRoot({ allOf: [{ $ref: "https://example.test/schema.json" }] }), (error) =>
      refusedWith(CODES.REFERENCE_UNSUPPORTED, "/allOf/0/$ref")(error) && error.source === "synthetic" &&
      error.cause_detail === 'only #/$defs/<name> references are supported; found "https://example.test/schema.json"');
    assert.throws(withRoot({ if: { not: { $dynamicRef: "#node" } } }), (error) =>
      refusedWith(CODES.REFERENCE_UNSUPPORTED, "/if/not/$dynamicRef")(error) && error.source === "synthetic" &&
      error.cause_detail === "$dynamicRef is not a local definition reference");
  });

  await t.test("a reference that cannot be followed is refused where it is made", () => {
    const withMember = (member, at) => {
      const schema = syntheticSource();
      (at ?? schema.properties).broken = member;
      return () => bindSynthetic(schema);
    };
    assert.throws(withMember({ $ref: "#/$defs/absent" }),
      refusedWith(CODES.REFERENCE_UNRESOLVED, "/properties/broken/$ref"));
    assert.throws(withMember({ type: "array", items: { anyOf: [{ $ref: "#/$defs/absent" }] } }),
      refusedWith(CODES.REFERENCE_UNRESOLVED, "/properties/broken/items/anyOf/0/$ref"));
    for (const unsupported of [{ $ref: "https://example.test/schema.json" }, { $ref: "#/properties/plain" },
      { $ref: "#/$defs/row/properties/id" }, { $ref: 7 }, { $dynamicRef: "#node" }, { $recursiveRef: "#" }]) {
      assert.throws(withMember(unsupported), refusedWith(CODES.REFERENCE_UNSUPPORTED), JSON.stringify(unsupported));
    }

    const unreachedDefect = syntheticSource();
    unreachedDefect.$defs.unreached = { $ref: "#/$defs/absent" };
    assert.throws(() => bindSynthetic(unreachedDefect), refusedWith(CODES.REFERENCE_UNRESOLVED, "/$defs/unreached/$ref"));
    for (const invalid of [null, [], {}, { type: "object", properties: {} }, { properties: { a: {} }, $defs: [] }]) {
      assert.throws(() => bindInputSchemaExposure({ digest: sha256,
        sources: { synthetic: { schema: invalid, groups: [{ name: "all", members: ["a"] }] } } }),
      refusedWith(CODES.SOURCE_INVALID), JSON.stringify(invalid));
    }
    assert.throws(() => bindInputSchemaExposure({ sources: {} }), refusedWith(CODES.DECLARATION_INVALID));
  });
});

test("schema exposure is deterministic and retains bounded state", async (t) => {
  const { changeSchemas } = createSaveRecordInputContract(z);

  await t.test("cold, warm and reordered selections of one set agree", () => {
    for (const [variant, acceptance] of Object.entries(ACCEPTANCE_MEMBERS)) {
      const cold = bindInputSchemaExposure(realDeclaration(changeSchemas)).source(variant);
      const warm = bindInputSchemaExposure(realDeclaration(changeSchemas)).source(variant);
      warm.select({ groups: ["content"] });
      const explicit = [cold.select({ members: ["obligations", "title", "criteria", "requirements", "controlled_acceptance"] }),
        warm.select({ members: ["controlled_acceptance", "requirements", "criteria", "obligations", "title"] })];
      assert.equal(JSON.stringify(explicit[0]), JSON.stringify(explicit[1]), variant);
      assert.deepEqual(explicit[0].members, ["title", "criteria", "requirements", "obligations", "controlled_acceptance"]);
      const grouped = [cold.select({ groups: ["acceptance"], members: ["title"] }),
        warm.select({ members: ["title", "criteria"], groups: ["acceptance"] })];
      assert.equal(JSON.stringify(grouped[0]), JSON.stringify(grouped[1]), variant);
      assert.deepEqual(grouped[0].members, ["title", ...acceptance]);
    }
  });

  await t.test("the digest identifies the whole owner source and exposure metadata", () => {
    const source = bindInputSchemaExposure(realDeclaration(changeSchemas)).source("work_item");
    assert.equal(source.digest, sha256(sourceIdentity(changeSchemas.work_item)));
    assert.equal(source.select({ members: ["title"] }).digest, source.digest, "a selection carries its source's identity");
    assert.equal(source.select({ groups: ["acceptance"] }).digest, source.digest);
    assert.notEqual(source.digest, bindInputSchemaExposure(realDeclaration(changeSchemas)).source("work_item_slice").digest);

    const equal = { ...changeSchemas, work_item: snapshot(changeSchemas.work_item) };
    assert.equal(bindInputSchemaExposure(realDeclaration(equal)).source("work_item").digest, source.digest);
    const changed = snapshot(changeSchemas.work_item);
    changed.properties.initiative.pattern = "^IN-[0-9]{5}$";
    assert.notEqual(bindInputSchemaExposure(realDeclaration({ ...changeSchemas, work_item: changed })).source("work_item").digest,
      source.digest);
  });

  await t.test("many different selections retain no state of their own", () => {
    let digests = 0;
    const declared = realDeclaration(changeSchemas);
    const binding = bindInputSchemaExposure({ ...declared, digest: (value) => { digests += 1; return sha256(value); } });
    assert.equal(digests, 0, "binding computes no identity until one is read");
    const source = binding.source("work_item_slice");
    const { members } = source;
    const seen = new Set();
    for (let size = 1; size <= members.length; size += 1) {
      for (let start = 0; start < members.length; start += 7) {
        const subset = [...members.slice(start), ...members.slice(0, start)].slice(0, size);
        const selected = source.select({ members: subset });
        seen.add(JSON.stringify(selected.members));
        assert.equal(selected.members.length, size);
        assert.ok(selected.members.every(member => selected.schema.properties[member] === changeSchemas.work_item_slice.properties[member]));
      }
    }
    assert.ok(seen.size > 150, `${seen.size} distinct selections`);
    assert.equal(digests, 1, "one identity per source, however many selections are made");

    const again = [source.select({ groups: ["acceptance"] }), source.select({ groups: ["acceptance"] })];
    assert.deepEqual(again[0], again[1]);
    assert.notEqual(again[0], again[1]);
    assert.notEqual(again[0].schema, again[1].schema);
    assert.equal(again[0].schema.properties.obligations, again[1].schema.properties.obligations);
    assert.ok(Object.isFrozen(binding) && Object.isFrozen(source) && Object.isFrozen(again[0]) && Object.isFrozen(again[0].schema));
    assert.deepEqual(Object.keys(source), ["name", "members", "groups", "select", "branches", "digest"]);
  });

  await t.test("only a successful registration lends a binding, to its own registrar", () => {
    const declared = realDeclaration(changeSchemas);
    const inputSchema = z.object({ unit: z.string() }).strict();
    const declaration = { inputSchema, advertisedInputSchema: undefined, inputSchemaExposure: declared };
    const retain = (store, ...declaredExposure) => {
      const exposure = declaredExposure.length === 0 ? declared : declaredExposure[0];
      store.assertRetainable("save_record", { ...declaration, inputSchemaExposure: exposure });
      const bound = store.bindExposure(exposure);
      store.retain("save_record", { ...declaration, inputSchemaExposure: exposure, publishedInputSchema: inputSchema,
        boundInputSchemaExposure: bound });
    };
    const exposureOf = store => store.lookup.contractFor("save_record")?.inputSchemaExposure ?? null;

    const hidden = createRegisteredToolRequestContractStore();
    assert.equal(hidden.lookup.contractFor("save_record"), null);

    const failed = createRegisteredToolRequestContractStore();
    const invalid = { ...declared, sources: { ...declared.sources,
      work_item: { ...declared.sources.work_item, groups: declared.sources.work_item.groups.slice(1) } } };
    assert.throws(() => retain(failed, invalid), refusedWith(CODES.MEMBER_UNASSIGNED));
    assert.equal(failed.lookup.contractFor("save_record"), null);

    const plain = createRegisteredToolRequestContractStore();
    plain.retain("save_record", { inputSchema, advertisedInputSchema: undefined, publishedInputSchema: inputSchema });
    assert.equal(exposureOf(plain), null);

    const first = createRegisteredToolRequestContractStore(), second = createRegisteredToolRequestContractStore();
    retain(first);
    assert.equal(exposureOf(second), null, "another registrar's binding is invisible");
    retain(second);
    assert.notEqual(exposureOf(first), exposureOf(second));
    assert.deepEqual(exposureOf(first).source("work_item").select({ members: ["title"] }).schema.properties,
      { title: changeSchemas.work_item.properties.title });

    assert.equal(sameInputSchemaExposure(declared, realDeclaration(changeSchemas)), true);
    retain(first, realDeclaration(changeSchemas));
    assert.ok(exposureOf(first));

    const changed = realDeclaration({ ...changeSchemas, work_item: snapshot(changeSchemas.work_item) });
    assert.equal(sameInputSchemaExposure(declared, changed), false);
    assert.throws(() => retain(first, changed), (error) => error.code === REGISTERED_TOOL_REQUEST_CONTRACT_CODES.CONFLICT);
    assert.equal(first.lookup.contractFor("save_record"), null, "no earlier detail survives a conflicting source");
    assert.throws(() => retain(first), (error) => error.code === REGISTERED_TOOL_REQUEST_CONTRACT_CODES.CONFLICT);
    assert.throws(() => retain(second, undefined), (error) => error.code === REGISTERED_TOOL_REQUEST_CONTRACT_CODES.CONFLICT);
    assert.equal(exposureOf(second), null);
  });
});

test("compact advertisements defer composite members and only widen", async (t) => {
  const Ajv = createRequire(import.meta.url)("ajv");
  const validator = schema => new Ajv({ strict: false, allErrors: true }).compile(schema);

  await t.test("every member of every real variant stays, scalar members complete, composite members deferred", () => {
    const { changeSchemas } = createSaveRecordInputContract(z);
    const before = snapshot(changeSchemas);
    for (const [name, source] of Object.entries(changeSchemas)) {
      const compact = compactInputSchemaAdvertisement(source);
      assert.deepEqual(Object.keys(compact.properties), Object.keys(before[name].properties), `${name}: owner order`);
      assert.deepEqual(pick(compact, ["type", "additionalProperties", "minProperties"]),
        { type: "object", additionalProperties: false, minProperties: 1 });
      assert.equal(Object.hasOwn(compact, "$defs") || JSON.stringify(compact).includes("$ref"), false, name);
      for (const [member, owner] of Object.entries(before[name].properties)) {
        const node = compact.properties[member];
        const composite = ["oneOf", "anyOf", "allOf", "items", "properties", "$ref"].some(keyword => Object.hasOwn(owner, keyword)) ||
          owner.type === "object" || owner.type === "array";
        assert.equal(isScalarMemberDeclaration(owner), !composite, `${name}.${member}: the cut is the member's structure`);
        assert.deepEqual(node, composite ? (owner.description === undefined ? {} : { description: owner.description }) : owner,
          `${name}.${member}`);
      }
    }
    assert.deepEqual(snapshot(changeSchemas), before, "projecting changes no source");

    const bound = bindInputSchemaExposure(realDeclaration(changeSchemas)).source("work_item");
    assert.equal(bound.digest, sha256(sourceIdentity(changeSchemas.work_item)));
    assert.equal(bound.select({ members: ["obligations"] }).schema.properties.obligations, changeSchemas.work_item.properties.obligations);
  });

  await t.test("root constraints and references never leave a dangling or narrower grammar", () => {
    const source = { ...syntheticSource(), required: ["plain"], maxProperties: 4,
      allOf: [{ $ref: "#/$defs/row" }, { required: ["owner"] }], if: { properties: { plain: { const: "x" } } },
      then: { required: ["rows"] }, not: { required: ["loop"] }, dependentRequired: { owner: ["rows"] },
      dependentSchemas: { owner: { $ref: "#/$defs/id" } }, propertyNames: { pattern: "^[a-z]+$" },
      patternProperties: { "^x-": { $ref: "#/$defs/id" } }, $id: "https://example.test/synthetic.json", $comment: "owner note" };
    source.properties.code = { type: ["string", "null"], enum: ["a", "b", null], description: "A code." };
    source.properties.literal = { const: 3 };
    source.properties.annotated = { description: "Only an annotation." };
    source.properties.nullable = { anyOf: [{ type: "string" }, { type: "null" }] };
    const owner = snapshot(source);
    const compact = compactInputSchemaAdvertisement(source);
    assert.deepEqual(snapshot(source), owner, "the source is unchanged");

    const { properties, ...constraints } = compact;
    assert.deepEqual(constraints, { type: "object", additionalProperties: false, minProperties: 1, required: ["plain"],
      maxProperties: 4 });
    assert.equal(JSON.stringify(compact).includes("$ref") || JSON.stringify(compact).includes("$defs"), false);
    assert.deepEqual(properties, { plain: owner.properties.plain, rows: {}, owner: {}, forest: {}, loop: {}, escaped: {},
      open: {}, data: {}, code: owner.properties.code, literal: { const: 3 }, annotated: { description: "Only an annotation." },
      nullable: {} });
    assert.equal(properties.plain, source.properties.plain, "a scalar member is the owner's own node");

    const full = validator({ ...owner, allOf: undefined, if: undefined, then: undefined, not: undefined,
      dependentSchemas: undefined, patternProperties: undefined, propertyNames: undefined, dependentRequired: undefined,
      $id: undefined });
    const admits = validator(compact);
    for (const value of [{ plain: "p" }, { plain: "p", rows: [{ id: "a" }], owner: "b" }, { plain: "p", open: { any: "x" } },
      { plain: "p", code: null, literal: 3, nullable: null }, { plain: "p", forest: { children: [{ children: [] }] } }]) {
      assert.equal(full(value), true, `owner-valid: ${JSON.stringify(value)}`);
      assert.equal(admits(value), true, `admitted: ${JSON.stringify(value)}`);
    }

    assert.deepEqual([admits({ plain: "p", rows: "not rows" }), full({ plain: "p", rows: "not rows" })], [true, false]);
    for (const refused of [{}, { plain: "" }, { plain: "p", unlisted: 1 }, { plain: "p", code: "c" }, { plain: "p", literal: 4 }]) {
      assert.equal(admits(refused), false, JSON.stringify(refused));
    }
    for (const invalid of [null, [], {}, { type: "object" }]) {
      assert.throws(() => compactInputSchemaAdvertisement(invalid), /declared members/u, JSON.stringify(invalid));
    }
  });
});

const declarations = () => createSaveRecordInputExposure({ changeSchemas: createSaveRecordInputContract(z).changeSchemas,
  variants: [saveRecordUnitVariant('WK-0001')], registeredTier: 'paid_cce' });
const scoped = requested => bindInputSchemaExposure(declarations()).source('work_item').select({
  members: ['criteria', 'requirements', 'obligations'], branches: { requirements: requested } });
const literal = value => ({ value: { literal: { int64Value: String(value) } } });
const scalarBatch = { entities: { amount: 'cc:state', result: 'cc:state', check: 'cc:test' }, requirements: [
  { subject: 'amount', definition: true, behavior: { relation: 'value:equals', objects: [literal(3)] } },
  { subject: 'result', modality: 'MUST', behavior: { relation: 'value:equals', objects: [{ value: { referent: 'amount' } }] },
    verification: { method: 'analysis', verifier: 'check', observes: { relation: 'reference:covers', objects: [{ referent: 'result' }] },
      fails_when: { relation: 'value:not_equals', objects: [{ value: { referent: 'amount' } }] } } }
] };

test('requirements capability exposure preserves owner semantics and complete dependency closure', () => {
  const full = workItemRequirementBatchSchema();
  for (const requested of [['relationships'], ['relationships', 'scalar_values'], ['relationships', 'typed_values']]) {
    const selection = scoped(requested), schema = selection.schema;
    assert.ok(Buffer.byteLength(JSON.stringify(schema)) > 0);
    const checkRefs = node => {
      if (!node || typeof node !== 'object') return;
      if (node.$ref) assert.ok(schema.$defs[node.$ref.slice('#/$defs/'.length)], node.$ref);
      Object.values(node).forEach(checkRefs);
    };
    checkRefs(schema);
    const scope = selection.branches?.requirements;
    const guidance = resolveRequirementAuthoringGuidance(['authoring_vocabulary', 'capabilities', ...requested]).value;
    assert.deepEqual(guidance.relation_details.map(row => row.term).sort(), requirementSchemaBranch("existing").select({ properties: { requirements: {} } }, requested).terms);
    assert.ok(guidance.relation_details.some(row => row.term === 'number:has_cardinality'));
    assert.deepEqual(guidance.relation_details.find(row => row.term === 'reference:covers').positions, ['observes']);
    if (requested.includes('typed_values')) {
      assert.deepEqual(workItemRequirementBatchSchema('existing', requested), full, 'capability union reconstructs the owner grammar');
      assert.equal(scope, undefined, 'complete capability union uses the whole route without duplicate metadata');
      const whole = bindInputSchemaExposure(declarations()).source('work_item').select({ members: selection.members });
      assert.deepEqual(selection, whole, 'whole-equivalent schema and instructions have exactly one disclosure');
    } else {
      assert.equal(schema.$defs.requirement.properties.for_each, undefined);
      assert.equal(schema.$defs.value_binding, undefined);
      assert.equal(schema.$defs.membership_clause.oneOf.length, 1);
    }
  }
  assert.deepEqual(admit(full, scalarBatch), []);
  const scalar = scoped(['relationships', 'scalar_values']).schema;
  assert.deepEqual(admit(scalar, scalarBatch, scalar.properties.requirements), [], 'primitive definition and its normative independent falsifier are complete');
  const ordinary = scoped(['relationships']).schema;
  assert.ok(admit(ordinary, scalarBatch, ordinary.properties.requirements).length);
  const structured = structuredClone(scalarBatch);
  structured.requirements[0].behavior.objects = [{ value: { list: { element_type: 'int', items: [{ literal: { int64Value: '3' } }] } } }];
  assert.deepEqual(admit(full, structured), []);
  assert.ok(admit(scalar, structured, scalar.properties.requirements).length, 'structured feature withheld stops before a write');
  assert.deepEqual(inferredRequirementCapabilities(scalarBatch), ['relationships', 'scalar_values']);
  assert.equal(inferredRequirementCapabilities(structured), undefined, 'typed job uses the complete route');
  assert.equal(inferredRequirementCapabilities({ requirements: [{ behavior: { relation: 'invented:unknown' } }] }), null);
  for (const requested of [[], ['unknown'], ['relationships', 'relationships']]) assert.throws(() => scoped(requested), /requirements_capability_selection_invalid/);
  const unclassified = CONTROLLED_VOCABULARY.operators.find(row => row.term === 'value:add');

  assert.throws(() => relationCapability({ ...unclassified, signature: { ...unclassified.signature, type_rule: 'new_unclassified_rule' } }), /requirements_capability_unclassified_operator/);
});

test('instruction views defer schemas and selected details retain complete transitive constraints', () => {
  const batch = REQUIREMENT_AUTHORING_GUIDANCE.save_record_inputs.requirement_batch;
  assert.equal(batch.schema, undefined);
  assert.equal(batch.accepted_definitions, undefined);
  assert.equal(batch.compact_record_comparison, undefined);
  assert.ok(batch.source_link.matching && batch.row_addressing && batch.correction && batch.batching);
  for (const name of Object.keys(workItemRequirementBatchSchema().$defs)) {
    const selected = requirementSchemaDetail(['existing', name]);
    assert.equal(selected.ok, true);
    assert.equal(selected.value.$ref, `#/$defs/${name}`);
    assert.deepEqual(selected.value.$defs[name], workItemRequirementBatchSchema().$defs[name]);
    const visit = node => {
      if (!node || typeof node !== 'object') return;
      if (node.$ref) assert.ok(selected.value.$defs[node.$ref.slice('#/$defs/'.length)], `${name}: ${node.$ref}`);
      Object.values(node).forEach(visit);
    };
    visit(selected.value);
  }
  assert.equal(requirementSchemaDetail(['existing', 'unknown']).ok, false);
  const identity = requirementSchemaIdentity();
  const before = requirementGuidanceRevision('paid_cce', identity);
  const hidden = structuredClone(identity);
  hidden.existing.$defs.value_type.oneOf[0].enum.push('invented');
  assert.notEqual(requirementGuidanceRevision('paid_cce', hidden), before);
  const metadata = structuredClone(identity);
  metadata.exposure.capabilities.typed_values.description += ' changed';
  assert.notEqual(requirementGuidanceRevision('paid_cce', metadata), before);
  const original = declarations();
  const drifted = { ...original, sources: { work_item: { ...original.sources.work_item, schema: structuredClone(original.sources.work_item.schema) } } };
  drifted.sources.work_item.schema.$defs.requirement.properties.unclassified_new_feature = { type: 'string' };
  assert.throws(() => bindInputSchemaExposure(drifted), /requirements_capability_source_drift/);
  const declaration = declarations(), bound = bindInputSchemaExposure(declaration).source('work_item');
  const changed = declarations();
  changed.sources.work_item.branches.requirements.metadata = { ...changed.sources.work_item.branches.requirements.metadata, revision: 2 };
  assert.notEqual(bound.digest, bindInputSchemaExposure(changed).source('work_item').digest);
});

test('schema choices retain a callable whole-member route when no requirement branch is selected', () => {
  const source = bindInputSchemaExposure(declarations()).source('work_item');
  const choices = inputContractChoices({ source, tool: 'save_record', reference: { ref_id: 'AAAAAAAA' },
    members: ['title'], readTool: 'workspace_read_wiki' });
  assert.deepEqual(choices.map(call => call.arguments), [{ reference: { ref_id: 'AAAAAAAA' },
    select: { input_contract: { tool: 'save_record', members: ['title'] } } }]);
});

test('schema navigation omits the more expensive full-equivalent scoped twin', () => {
  const source = bindInputSchemaExposure(declarations()).source('work_item');
  const choices = inputContractChoices({ source, tool: 'save_record', reference: { ref_id: 'AAAAAAAA' },
    members: ['criteria', 'requirements'], readTool: 'workspace_read_wiki' });
  assert.equal(choices.length, 3);
  assert.deepEqual(choices.slice(0, 2).map(call => call.arguments.select.input_contract.branches.requirements),
    [['relationships'], ['relationships', 'scalar_values']]);
  assert.equal(choices.at(-1).arguments.select.input_contract.branches, undefined);
  assert.match(choices.at(-1).purpose, /typed relationships/u);
});

test('ready-slice selections disclose complete incumbent create and update variants', () => {
  const source = bindInputSchemaExposure(realDeclaration()).source('work_item');
  const whole = source.select({ members: ['ready_slices'] });
  for (const [index, mode] of ['create', 'update'].entries()) {
    const selected = source.select({ members: ['ready_slices'], branches: { ready_slices: [mode] } });
    const { 'x-record-authoring-row': _tag, oneOf, ...constraints } = whole.schema.properties.ready_slices.items;
    assert.deepEqual(selected.schema.properties.ready_slices.items, { ...constraints, ...oneOf[index] });
    assert.deepEqual(selected.branches.ready_slices, { effective: [mode], excluded: [index === 0 ? 'update' : 'create'] });
    assert.deepEqual(selected.schema.$defs, whole.schema.$defs, 'each variant reaches the same complete definitions');
  }
  for (const requested of [[], ['create', 'create'], ['unknown']]) assert.throws(() =>
    source.select({ members: ['ready_slices'], branches: { ready_slices: requested } }), /selection_invalid/);
  assert.deepEqual(source.select({ members: ['ready_slices'], branches: { ready_slices: ['update', 'create'] } }), whole);
});
