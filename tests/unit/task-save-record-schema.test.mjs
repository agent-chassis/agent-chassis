import assert from "node:assert/strict";
import test from "node:test";

import { WORK_RECORD_EDIT_FIELD_REGISTRY } from
  "../../packages/wiki-core/src/lib/work-record-contract-edit-operations.mjs";
import { kindRecordEditableScalarFields } from "../../packages/wiki-core/src/lib/kind-record-edit.mjs";
import * as readySliceOwner from "../../packages/wiki-core/src/lib/work-record-ready-slice-contract.mjs";
import * as authoringSchemaOwner from "../../packages/wiki-core/src/lib/record-authoring-schema.mjs";
import { WORK_RECORD_READY_SLICE_ACCEPTANCE_SCHEMA, WORK_RECORD_READY_SLICE_CREATION_REQUIREMENTS,
  WORK_RECORD_READY_SLICE_DISPATCH_INTENT_ASSERTION_VALUES, WORK_RECORD_READY_SLICE_EXPECTED_EDIT_TARGET_SCHEMA, WORK_RECORD_READY_SLICE_SHAPING_MODES } from
  "../../packages/wiki-core/src/lib/work-record-ready-slice-contract.mjs";
import { RECORD_KIND_SPECS } from "../../packages/wiki-core/src/lib/work-record-kind-registry.mjs";
import * as structure from "../../packages/wiki-core/src/lib/work-record-schema-structure.mjs";
import { WORK_RECORD_EXPECTED_EDIT_TARGET_KIND_VALUES, WORK_RECORD_EXPECTED_EDIT_TARGET_OPERATION_VALUES } from
  "../../packages/wiki-core/src/lib/work-record-target-metrics.mjs";
import { WORK_UNIT_FEATURE_VECTOR_ACTIVITY_KIND_VALUES, WORK_UNIT_FEATURE_VECTOR_ARTIFACT_KIND_VALUES,
  WORK_UNIT_FEATURE_VECTOR_GRANULARITY_VALUES } from "../../packages/wiki-core/src/lib/work-record-schema-constants.mjs";
import {
  WORK_ITEM_CRITERION_NOTES,
  WORK_ITEM_ORDINARY_MEMBERS,
  WORK_ITEM_READY_DISPATCH_ASSERTION_NOTES,
  WORK_ITEM_SLICE_CONTRACT_MEMBERS,
  WORK_ITEM_SLICE_CONTRACT_MEMBER_NOTE,
  WORK_ITEM_SLICE_LIST_NOTES,
  recordAuthoringChangeSchema,
  validateRecordAuthoringChanges
} from "../../packages/wiki-core/src/lib/record-authoring-schema.mjs";

const invalid = (kind, changes, context = "existing") =>
  validateRecordAuthoringChanges(kind, context, changes).map(({ code, path }) => [code, path]);
const INVALID = "record_authoring_change_invalid";

const READY_CREATION = Object.freeze({ key: "ready", title: "Ready", depends_on: [], read_scope: ["AGENTS.md"],
  repo_paths: ["packages/example/ready.mjs"], write_scope: ["packages/example/ready.mjs"],
  acceptance: { criteria: ["It is ready."], validation: ["Run the focused test."] },
  expected_edit_targets: [{ path: "packages/example/ready.mjs", name: "readySlice", kind: "function", operation: "modify" }] });

test('authoring diagnosis preserves native constraints and the selected row type', () => {
  const diagnose = changes => validateRecordAuthoringChanges('work_item', 'existing', changes);
  for (const [changes, path, constraint] of [
    [{ obligations: [17] }, 'changes.obligations[0]', { keyword: 'type', type: 'object' }],
    [{ criteria: [{ key: 'INVALID_LABEL', text: 'Meaning.' }] }, 'changes.criteria[0].key',
      { keyword: 'pattern', pattern: '^[a-z][a-z0-9-]{0,63}$' }],
    [{ criteria: [{ key: 'missing-text' }] }, 'changes.criteria[0].text',
      { keyword: 'required', missingProperty: 'text' }]
  ]) {
    const issues = diagnose(changes);
    assert.equal(issues.length, 1, JSON.stringify(issues));
    assert.equal(issues[0].path, path);
    assert.deepEqual(issues[0].constraint, constraint);
  }
  const enumIssue = diagnose({ obligations: [{ key: 'invalid-observation', case: {
    observation: { kind: 'unsupported-observation' } } }] })[0];
  assert.equal(enumIssue.path, 'changes.obligations[0].case.observation.kind');
  assert.equal(enumIssue.constraint.keyword, 'enum');
  assert.ok(enumIssue.constraint.allowedValues.includes('return_value'));
  assert.equal(enumIssue.constraint.allowedValues.includes('unsupported-observation'), false);
});

test('retained graph evidence accepts only the exact producer locator', () => {
  const locator = { ref_id: 'aB3_dE9x' };
  assert.deepEqual(invalid('work_item', { retained_graph_evidence: locator }), []);

  for (const source of [{}, { ref_id: 'retained-impact' }, { ...locator, sha256: 'a'.repeat(64) },
    { ...locator, graph_impact: {} }, { ...locator, permission: true }]) {
    assert.ok(invalid('work_item', { retained_graph_evidence: source }).length > 0);
  }
  assert.deepEqual(invalid('initiative', { retained_graph_evidence: locator }), [[INVALID, 'changes.retained_graph_evidence']]);
});

test("record authoring schema is closed and derived from the existing owners", () => {
  const workItem = recordAuthoringChangeSchema("work_item");
  assert.equal(workItem.additionalProperties, false);

  for (const { member, field } of WORK_ITEM_ORDINARY_MEMBERS) {
    assert.ok(WORK_RECORD_EDIT_FIELD_REGISTRY.some((entry) => entry.field === field), field);
    assert.ok(Object.hasOwn(workItem.properties, member), member);
  }
  for (const member of ["initiative", "criteria", "requirements", "obligations", "controlled_acceptance",
    "slices", "remove", "status", "closure"]) assert.ok(Object.hasOwn(workItem.properties, member), member);

  for (const member of ["repo", "repository", "workspace", "path", "fields", "tool", "args", "arguments",
    "proof_posture", "derived_evidence", "projections", "id", "allow_proof_posture", "lease"]) {
    assert.equal(Object.hasOwn(workItem.properties, member), false, member);
    assert.deepEqual(invalid("work_item", { title: "Kept", [member]: "x" }), [[INVALID, `changes.${member}`]]);
  }
  assert.deepEqual(invalid("work_item", {}), [[INVALID, "changes"]]);
  assert.deepEqual(invalid("work_item", { title: "Only a title" }), []);

  for (const kind of ["decision", "initiative"]) {
    const schema = recordAuthoringChangeSchema(kind);
    assert.deepEqual(Object.keys(schema.properties).filter((member) => !["sections", "status"].includes(member)).sort(),
      [...kindRecordEditableScalarFields(kind)].sort());
    assert.deepEqual(Object.keys(schema.properties.sections.properties),
      Object.keys(RECORD_KIND_SPECS[kind].sectionSpec));
    for (const managed of ["ratified", "ratified_by", "updated", "updated_by", "id", "record_kind"]) {
      assert.deepEqual(invalid(kind, { [managed]: "x" }), [[INVALID, `changes.${managed}`]], `${kind}.${managed}`);
    }
    assert.deepEqual(invalid(kind, { sections: { unknown: "x" } }), [[INVALID, "changes.sections.unknown"]]);
  }

  assert.deepEqual(invalid("decision", { status: "rejected" }), []);
  assert.deepEqual(invalid("decision", { status: "accepted" }), [[INVALID, "changes.status"]]);
  assert.deepEqual(invalid("initiative", { status: "done" }), [[INVALID, "changes.status"]]);

  assert.deepEqual(invalid("initiative", { summary: "Scalar.", sections: { summary: "Body." } }), []);

  const birth = recordAuthoringChangeSchema("work_item", "birth");
  assert.deepEqual(["remove", "status", "closure"].filter((member) => Object.hasOwn(birth.properties, member)), []);
  assert.ok(Object.hasOwn(birth.properties, "criteria"));
  assert.throws(() => recordAuthoringChangeSchema("work_item", "operator"), TypeError);
  assert.throws(() => recordAuthoringChangeSchema("source"), TypeError);
});

test("record authoring rows carry exactly one of key or id and typed label references", () => {
  const obligation = (row) => invalid("work_item", { obligations: [row] });
  assert.deepEqual(obligation({ key: "new-row", statement: "A new obligation." }), []);
  assert.deepEqual(obligation({ id: "OBL-A", statement: "An existing obligation." }), []);
  assert.deepEqual(obligation({ key: "both", id: "OBL-A" }), [[INVALID, "changes.obligations[0]"]]);
  assert.deepEqual(obligation({ statement: "Neither." }), [[INVALID, "changes.obligations[0]"]]);
  assert.deepEqual(obligation({ key: "Not A Label" }).map(([, path]) => path), ["changes.obligations[0].key"]);

  for (const member of ["obligation_id", "controlled_contract_node_ids", "acceptance_criteria", "proof_name"]) {
    assert.deepEqual(obligation({ key: "row", [member]: "x" }), [[INVALID, `changes.obligations[0].${member}`]]);
  }
  assert.deepEqual(obligation({ key: "row", claims: ["$requirement", "claim-existing"], criteria: ["$criterion"],
    proof: { name: "proof.verification.test-validity" },
    case: { key: "case-label", verification: "$verification", observation: { kind: "return_value" } } }), []);
  assert.deepEqual(obligation({ id: "OBL-A", case: { observation: { kind: 42 } } }),
    [[INVALID, "changes.obligations[0].case.observation.kind"]]);
  assert.deepEqual(obligation({ id: "OBL-A", case: { key: "label", id: "case-a" } }),
    [[INVALID, "changes.obligations[0].case"]]);

  assert.deepEqual(invalid("work_item", { criteria: [{ key: "exists", text: "It exists." }] }), []);
  assert.deepEqual(invalid("work_item", { criteria: [{ id: "derived:abc", text: "Reworded." }] }), []);
  assert.deepEqual(invalid("work_item", { criteria: [{ key: "exists" }] }).map(([, path]) => path),
    ["changes.criteria[0].text"]);

  assert.deepEqual(invalid("work_item", { remove: { obligations: [{ id: "OBL-A", scope: "obligation" }] } }), []);
  assert.deepEqual(invalid("work_item", { remove: { obligations: [{ id: "OBL-A" }] } }),
    [[INVALID, "changes.remove.obligations[0].scope"]]);

  assert.deepEqual(invalid("work_item", { remove: {} }), []);
  assert.ok(invalid("work_item", { controlled_acceptance: { disposition: "opted_out" } })
    .some(([, path]) => path === "changes.controlled_acceptance.rationale"), "an opt-out needs its rationale");
});

test("ready-slice expected edit targets are the owner's closed four-field objects", () => {
  const target = { path: "packages/example/ready.mjs", name: "readySlice", kind: "function", operation: "modify" };
  const at = "changes.ready_slices[0].expected_edit_targets[0]";
  assert.deepEqual(WORK_RECORD_READY_SLICE_EXPECTED_EDIT_TARGET_SCHEMA.required, Object.keys(target));
  for (const context of ["existing", "birth"]) {

    for (const row of [recordAuthoringChangeSchema("work_item", context).properties.ready_slices.items]
      .flatMap((items) => items.oneOf ?? [items])) {
      assert.deepEqual(row.properties.expected_edit_targets,
        { type: "array", items: WORK_RECORD_READY_SLICE_EXPECTED_EDIT_TARGET_SCHEMA }, context);
    }
    const targets = (...entries) => invalid("work_item",
      { ready_slices: [{ ...READY_CREATION, expected_edit_targets: entries }] }, context);
    assert.deepEqual(targets(target), [], context);
    assert.deepEqual(targets(), [], context);
    for (const entry of [target.path, 17, null, [target]]) {
      assert.deepEqual(targets(entry), [[INVALID, at]], `${context}: ${JSON.stringify(entry)}`);
    }
    for (const member of Object.keys(target)) {
      const { [member]: _omitted, ...rest } = target;
      assert.deepEqual(targets(rest), [[INVALID, `${at}.${member}`]], `${context}: missing ${member}`);
    }
    assert.deepEqual(targets({ ...target, symbol: "readySlice" }), [[INVALID, `${at}.symbol`]], context);
    assert.deepEqual(targets({ ...target, kind: "symbol" }), [[INVALID, `${at}.kind`]], context);
    assert.deepEqual(targets({ ...target, operation: "rewrite" }), [[INVALID, `${at}.operation`]], context);

    assert.deepEqual(targets({ ...target, activity_kind: "implementation_modify",
      artifact_kind: "production_code_module", granularity: "function", optional: true,
      facet_provenance: { activity_kind: "authored_record", granularity: null } },
    { ...target, activity_kind: "implementation", artifact_kind: "source" },
    { ...target, activity_kind: null, artifact_kind: null, granularity: null }), [], context);
    assert.deepEqual(targets({ ...target, optional: "true" }), [[INVALID, `${at}.optional`]], context);
    assert.deepEqual(targets({ ...target, facet_provenance: { symbol: "authored_record" } }),
      [[INVALID, `${at}.facet_provenance.symbol`]], context);

    assert.deepEqual(targets({ ...target, path: "../outside.mjs" },
      { ...target, kind: "docs_section", artifact_kind: "source" }), [], context);
  }
});

const ORDINARY_TARGET = Object.freeze({ path: "packages/example/ready.mjs", name: "readySlice", kind: "function",
  operation: "modify" });
const ORDINARY_TARGET_PLACEMENTS = Object.freeze([
  ["existing", "changes.slices[0].expected_edit_targets", (targets) => ({ slices: [{ key: "slice", expected_edit_targets: targets }] })],
  ["existing", "changes.slices[0].expected_edit_targets", (targets) => ({ slices: [{ id: "SLICE-001", expected_edit_targets: targets }] })],
  ["birth", "changes.slices[0].expected_edit_targets", (targets) => ({ slices: [{ key: "slice", expected_edit_targets: targets }] })],
  ["existing_slice", "changes.expected_edit_targets", (targets) => ({ expected_edit_targets: targets })]]);
const ownerRefusals = (targets) => {
  const diagnostics = [];
  structure.validateExpectedEditTargets(diagnostics, targets, "expected_edit_targets");
  return diagnostics.map(({ path }) => path.replace(/^expected_edit_targets/u, ""));
};

test("ordinary slice expected edit targets accept the owner's four-field target object", () => {
  assert.deepEqual(ownerRefusals([ORDINARY_TARGET]), []);
  for (const [context, at, changes] of ORDINARY_TARGET_PLACEMENTS) {
    assert.deepEqual(invalid("work_item", changes([ORDINARY_TARGET]), context), [], `${context}: ${at}`);
  }
});

test("ordinary slice expected edit targets refuse a string the owner refuses", () => {
  assert.deepEqual(ownerRefusals([ORDINARY_TARGET.path]), ["[0]"]);
  for (const [context, at, changes] of ORDINARY_TARGET_PLACEMENTS) {
    assert.deepEqual(invalid("work_item", changes([ORDINARY_TARGET.path]), context), [[INVALID, `${at}[0]`]],
      `${context}: ${at}`);
  }
});

test("ordinary slice expected edit target declaration agrees with the record owner", () => {
  const target = ORDINARY_TARGET;
  const without = (member) => { const { [member]: _omitted, ...rest } = target; return rest; };
  const ownerOnly = new Set(["unsupported kind", "unsupported operation", "unsupported provenance value"]);
  const cases = [
    ["four fields", target, null],
    ...Object.keys(target).map((member) => [`missing ${member}`, without(member), `[0].${member}`]),
    ...Object.keys(target).map((member) => [`blank ${member}`, { ...target, [member]: "  " }, `[0].${member}`]),
    ...Object.keys(target).map((member) => [`non-string ${member}`, { ...target, [member]: 7 }, `[0].${member}`]),
    ["number", 17, "[0]"], ["null", null, "[0]"], ["array", [target], "[0]"],

    ["normalized kind and operation", { ...target, kind: " Function ", operation: "MODIFY" }, null],
    ["unsupported kind", { ...target, kind: "symbol" }, "[0].kind"],
    ["unsupported operation", { ...target, operation: "rewrite" }, "[0].operation"],
    ["canonical facets", { ...target, activity_kind: "implementation_modify", artifact_kind: "production_code_module",
      granularity: "function", optional: true, facet_provenance: { activity_kind: "authored_record", granularity: null } }, null],
    ["null facets", { ...target, activity_kind: null, artifact_kind: null, granularity: null, facet_provenance: null,
      optional: false }, null],

    ["coarse activity_kind", { ...target, activity_kind: "implementation" }, "[0].activity_kind"],
    ["coarse artifact_kind", { ...target, artifact_kind: "source" }, "[0].artifact_kind"],
    ["unsupported granularity", { ...target, granularity: "paragraph" }, "[0].granularity"],
    ["non-boolean optional", { ...target, optional: "true" }, "[0].optional"],
    ["null optional", { ...target, optional: null }, "[0].optional"],
    ["non-object provenance", { ...target, facet_provenance: "authored_record" }, "[0].facet_provenance"],
    ["unsupported provenance value", { ...target, facet_provenance: { kind: "guessed" } }, "[0].facet_provenance.kind"],

    ["further member", { ...target, symbol: "readySlice", note: { any: ["value"] } }, null]];
  for (const [name, entry, refusedAt] of cases) {
    assert.deepEqual(ownerRefusals([entry]), refusedAt === null ? [] : [refusedAt], `owner: ${name}`);
    for (const [context, at, changes] of ORDINARY_TARGET_PLACEMENTS) {
      assert.deepEqual(invalid("work_item", changes([entry]), context),
        refusedAt === null || ownerOnly.has(name) ? [] : [[INVALID, `${at}${refusedAt}`]], `${context} ${at}: ${name}`);
    }
  }
  for (const [context, at, changes] of ORDINARY_TARGET_PLACEMENTS) {
    assert.deepEqual(invalid("work_item", changes([]), context), [], `${context} ${at}: no targets`);
    assert.deepEqual(invalid("work_item", changes(target.path), context), [[INVALID, at]], `${context} ${at}: not a list`);
  }

  const declared = structure.WORK_RECORD_EXPECTED_EDIT_TARGET_SCHEMA;
  assert.deepEqual([declared.type, declared.additionalProperties, declared.required],
    ["object", true, Object.keys(target)]);
  assert.deepEqual(Object.keys(declared.properties), [...Object.keys(target), "activity_kind", "artifact_kind",
    "granularity", "facet_provenance", "optional"]);
  for (const [member, values] of [["kind", WORK_RECORD_EXPECTED_EDIT_TARGET_KIND_VALUES],
    ["operation", WORK_RECORD_EXPECTED_EDIT_TARGET_OPERATION_VALUES]]) {
    assert.ok(declared.properties[member].description.endsWith(values.join(", ")), member);
    assert.equal(Object.hasOwn(declared.properties[member], "enum"), false, member);
  }
  for (const [member, values] of [["activity_kind", WORK_UNIT_FEATURE_VECTOR_ACTIVITY_KIND_VALUES],
    ["artifact_kind", WORK_UNIT_FEATURE_VECTOR_ARTIFACT_KIND_VALUES],
    ["granularity", WORK_UNIT_FEATURE_VECTOR_GRANULARITY_VALUES]]) {
    assert.deepEqual(declared.properties[member].anyOf[0].enum, [...values], member);
  }
  for (const context of ["existing", "birth"]) {
    const rows = recordAuthoringChangeSchema("work_item", context).properties.slices.items;
    for (const row of rows.oneOf ?? [rows]) {
      assert.deepEqual(row.properties.expected_edit_targets, { type: "array", items: declared }, context);
    }
  }
  assert.deepEqual(recordAuthoringChangeSchema("work_item", "existing_slice").properties.expected_edit_targets,
    { type: "array", items: declared, description: WORK_ITEM_SLICE_CONTRACT_MEMBER_NOTE });

  assert.notDeepEqual(declared, WORK_RECORD_READY_SLICE_EXPECTED_EDIT_TARGET_SCHEMA);
  assert.equal(WORK_RECORD_READY_SLICE_EXPECTED_EDIT_TARGET_SCHEMA.additionalProperties, false);
});

test("slice contract members are declared and accepted for an existing slice unit only", () => {
  const NOT_APPLICABLE = "record_authoring_member_not_applicable";
  const values = { work_kind: "implementation", target_unit: "slice", agent_role: "worker",
    expected_edit_targets: [ORDINARY_TARGET], expected_changed_line_budget: 10 };
  assert.deepEqual(Object.keys(values), [...WORK_ITEM_SLICE_CONTRACT_MEMBERS]);
  const slice = recordAuthoringChangeSchema("work_item", "existing_slice");
  const sliceRows = (context) => {
    const { ready_slices: ready, slices } = recordAuthoringChangeSchema("work_item", context).properties;
    return { ready_slices: (ready.items.oneOf ?? [ready.items])[0], slices: (slices.items.oneOf ?? [slices.items])[0] };
  };
  for (const context of ["existing", "birth"]) {
    const schema = recordAuthoringChangeSchema("work_item", context);
    assert.deepEqual(WORK_ITEM_SLICE_CONTRACT_MEMBERS.filter((member) => Object.hasOwn(schema.properties, member)), [], context);
    for (const [member, value] of Object.entries(values)) {
      const refusal = validateRecordAuthoringChanges("work_item", context, { [member]: value });
      assert.deepEqual(refusal.map(({ code, severity, path }) => [code, severity, path]),
        [[NOT_APPLICABLE, "error", `changes.${member}`]], `${context}: ${member}`);
      const [{ message, constraint }] = refusal;
      assert.ok(message.startsWith(`changes.${member} is a slice contract member`), message);
      assert.match(message, /slice unit/u);
      assert.deepEqual([constraint.keyword, constraint.member, constraint.applies_to],
        ["applicability", member, "slice_unit"]);

      assert.deepEqual(constraint.row_members.map((row) => row.split("[].")[0]), ["ready_slices", "slices"]);
      for (const placement of constraint.row_members) {
        const [list, rowMember] = placement.split("[].");
        const [head, nested] = rowMember.split(".");
        const declared = sliceRows(context)[list].properties[head];
        assert.ok(declared !== undefined, `${context}: ${placement}`);
        if (nested !== undefined && declared.additionalProperties === false) {
          assert.ok(Object.hasOwn(declared.properties, nested), `${context}: ${placement}`);
        }
        assert.ok(message.includes(rowMember), message);
      }

      assert.doesNotMatch(JSON.stringify(refusal), /SLICE-[0-9]|WK-[0-9]|revision|next_call/u);
    }

    const several = validateRecordAuthoringChanges("work_item", context,
      { title: "Kept", ...values, unknown: true }).map(({ code, path }) => [code, path]);
    assert.deepEqual(several, [...WORK_ITEM_SLICE_CONTRACT_MEMBERS.map((member) => [NOT_APPLICABLE, `changes.${member}`]),
      [INVALID, "changes.unknown"]], context);

    assert.deepEqual(invalid("work_item", { ready_slices: [{ ...READY_CREATION, work_kind: "implementation",
      dispatch_intent: { intended_agent_role: "worker", target_unit: "slice" }, expected_changed_line_budget: 10 }],
    slices: [{ key: "slice", work_kind: "implementation", expected_edit_targets: [ORDINARY_TARGET] }] }, context), [], context);
  }

  assert.deepEqual(Object.keys(slice.properties).filter((member) => !WORK_ITEM_SLICE_CONTRACT_MEMBERS.includes(member)),
    Object.keys(recordAuthoringChangeSchema("work_item", "existing").properties));

  assert.deepEqual(Object.keys(slice.properties).filter((member) =>
    slice.properties[member].description === WORK_ITEM_SLICE_CONTRACT_MEMBER_NOTE), [...WORK_ITEM_SLICE_CONTRACT_MEMBERS]);
  for (const [member, value] of Object.entries(values)) {
    assert.deepEqual(invalid("work_item", { [member]: value }, "existing_slice"), [], member);
  }
  assert.deepEqual(invalid("work_item", values, "existing_slice"), []);
  assert.deepEqual(invalid("work_item", {}, "existing_slice"), [[INVALID, "changes"]]);
  assert.deepEqual(invalid("work_item", { work_kind: 4 }, "existing_slice"), [[INVALID, "changes.work_kind"]]);

  for (const kind of ["decision", "initiative"]) {
    assert.throws(() => recordAuthoringChangeSchema(kind, "existing_slice"), TypeError);
    assert.deepEqual(invalid(kind, { work_kind: "implementation" }), [[INVALID, "changes.work_kind"]]);
  }
});

test("ready-slice creation rows require the owner's creation fields and update rows may omit them", () => {
  const complete = READY_CREATION;
  const at = (member) => [INVALID, `changes.ready_slices[0].${member}`];
  const without = (row, ...members) => Object.fromEntries(Object.entries(row).filter(([member]) => !members.includes(member)));
  for (const context of ["existing", "birth"]) {
    const rows = (row) => invalid("work_item", { ready_slices: [row] }, context);
    assert.deepEqual(rows(complete), [], context);

    assert.deepEqual(rows(without(complete, "depends_on", "acceptance")), [at("depends_on"), at("acceptance")], context);
    assert.deepEqual(rows({ key: "ready" }),
      WORK_RECORD_READY_SLICE_CREATION_REQUIREMENTS.implementation.map(at), context);

    for (const mode of ["reviewer", "redteam"]) {
      assert.deepEqual(rows({ ...without(complete, "write_scope"), shaping_mode: mode }), [], `${context}: ${mode}`);
      assert.deepEqual(rows({ key: "ready", shaping_mode: mode }),
        WORK_RECORD_READY_SLICE_CREATION_REQUIREMENTS[mode].map(at), `${context}: ${mode}`);
    }
    assert.deepEqual(rows(without(complete, "depends_on", "write_scope")), [at("depends_on"), at("write_scope")], context);

    for (const [acceptance, members] of [[{ criteria: ["It is ready."] }, ["acceptance.validation"]],
      [{ validation: ["Run the focused test."] }, ["acceptance.criteria"]],
      [{}, ["acceptance.criteria", "acceptance.validation"]],
      [{ ...complete.acceptance, notes: [] }, ["acceptance.notes"]],
      [{ ...complete.acceptance, criteria: "It is ready." }, ["acceptance.criteria"]]]) {
      assert.deepEqual(rows({ ...complete, acceptance }), members.map(at), `${context}: ${JSON.stringify(acceptance)}`);
    }

    const items = recordAuthoringChangeSchema("work_item", context).properties.ready_slices.items;
    const [created, updated] = items.oneOf ?? [items];
    assert.deepEqual(created.required, ["key", ...WORK_RECORD_READY_SLICE_CREATION_REQUIREMENTS.every_shaping_mode], context);
    assert.deepEqual(created.properties.acceptance, WORK_RECORD_READY_SLICE_ACCEPTANCE_SCHEMA, context);
    if (updated !== undefined) {
      assert.deepEqual(updated.required, ["id"]);
      assert.deepEqual(updated.properties.acceptance, WORK_RECORD_READY_SLICE_ACCEPTANCE_SCHEMA);
    }
  }

  assert.deepEqual(invalid("work_item", { ready_slices: [{ id: "SLICE-001" }] }), []);
  assert.deepEqual(invalid("work_item", { ready_slices: [{ id: "SLICE-001", title: "Renamed" }] }), []);
  assert.deepEqual(invalid("work_item", { ready_slices: [{ id: "SLICE-001", acceptance: { criteria: [] } }] }),
    [at("acceptance.validation")]);
});

test("existing work-item declarations state what each slice list and shaping mode is for", () => {
  const { supported, creation_default: creationDefault } = WORK_RECORD_READY_SLICE_SHAPING_MODES;

  assert.deepEqual(supported, Object.keys(WORK_RECORD_READY_SLICE_CREATION_REQUIREMENTS)
    .filter((mode) => mode !== "every_shaping_mode"));
  assert.equal(creationDefault, "implementation");
  for (const context of ["existing", "existing_slice"]) {
    const { slices, ready_slices: ready } = recordAuthoringChangeSchema("work_item", context).properties;
    assert.equal(slices.description, WORK_ITEM_SLICE_LIST_NOTES.slices, context);
    assert.equal(ready.description, WORK_ITEM_SLICE_LIST_NOTES.ready_slices, context);
    for (const list of [slices.description, ready.description]) {
      assert.match(list, /^Parent WK only, never WK#SLICE\./u, context);
      assert.match(list, /key creates a slice; id selects an existing one\./u, context);
      assert.match(list, /returns it in bindings\.slice\[key\]; later selected-unit operations use WK#<returned ID>\./u, context);
    }
    assert.match(slices.description, /ordinary slice definitions, including incomplete drafts\./u, context);
    assert.match(slices.description, /dispatch_intent replaces the saved object whole\./u, context);
    assert.match(ready.description, /through assignment shaping and its structural completeness checks/u, context);
    assert.match(ready.description, /does not approve dispatch, start an agent or grant proof credit\./u, context);
    assert.match(ready.description, /derives the agent role and target unit; dispatch_intent is a partial update/u, context);

    for (const row of ready.items.oneOf) {
      assert.deepEqual(row.properties.shaping_mode,
        { type: "string", description: WORK_ITEM_SLICE_LIST_NOTES.shaping_mode }, context);
    }
    const mode = ready.items.oneOf[0].properties.shaping_mode.description;
    assert.ok(mode.startsWith(`One of ${supported.join(", ")}. Creation defaults to ${creationDefault}.`), mode);
    assert.match(mode, /update that omits it uses the saved shape .+ unsupported saved shape is refused, never defaulted\./u);
  }

  for (const mode of [...supported, " reviewer ", "unknown"]) {
    assert.deepEqual(invalid("work_item", { ready_slices: [{ id: "SLICE-001", shaping_mode: mode }] }), [], mode);
  }

  const birth = recordAuthoringChangeSchema("work_item", "birth").properties;
  assert.deepEqual([birth.slices.description, birth.ready_slices.description,
    birth.ready_slices.items.properties.shaping_mode],
  [undefined, undefined, { type: "string", description: WORK_ITEM_SLICE_LIST_NOTES.shaping_mode }]);
});

test("ready-slice dispatch_intent assertions state the owner's accepted values and stay owner-validated", () => {
  const values = WORK_RECORD_READY_SLICE_DISPATCH_INTENT_ASSERTION_VALUES;
  assert.deepEqual(Object.keys(WORK_ITEM_READY_DISPATCH_ASSERTION_NOTES), Object.keys(values));
  const { intended_agent_role: role, target_unit: target } = WORK_ITEM_READY_DISPATCH_ASSERTION_NOTES;
  for (const [member, note] of Object.entries(WORK_ITEM_READY_DISPATCH_ASSERTION_NOTES)) {
    assert.ok(note.startsWith("Normally omit: shaping derives it."), note);
    assert.match(note, /A stated value only asserts the derived assignment/u, member);
    assert.ok(note.includes(`: ${values[member].join(", ")}. `), note);
    assert.ok(note.endsWith("The slice owner validates it, ignoring surrounding whitespace."), note);
  }
  assert.match(role, /must agree with shaping_mode: worker, reviewer, redteam\./u);
  assert.match(target, /Assignment category, not a WK address\..+: slice\./u);
  const variants = (context) => {
    const { items } = recordAuthoringChangeSchema("work_item", context).properties.ready_slices;
    return items.oneOf ?? [items];
  };
  for (const context of ["existing", "existing_slice", "birth"]) {
    const rows = variants(context);
    assert.equal(rows.length, context === "birth" ? 1 : 2, context);
    for (const row of rows) {
      const { properties, required } = row.properties.dispatch_intent;
      assert.equal(required, undefined, context);
      for (const member of Object.keys(values)) {
        assert.deepEqual(properties[member],
          { type: "string", description: WORK_ITEM_READY_DISPATCH_ASSERTION_NOTES[member] }, `${context}: ${member}`);
      }
    }
  }

  assert.deepEqual(variants("birth")[0].properties.dispatch_intent, variants("existing")[0].properties.dispatch_intent);

  for (const dispatchIntent of [{}, { intended_agent_role: " reviewer ", target_unit: "\tslice\n" },
    { intended_agent_role: "none", target_unit: "WK-0001" }]) {
    assert.deepEqual(invalid("work_item", { ready_slices: [{ id: "SLICE-001", dispatch_intent: dispatchIntent }] }), [],
      JSON.stringify(dispatchIntent));
    assert.deepEqual(invalid("work_item", { ready_slices: [{ ...READY_CREATION, dispatch_intent: dispatchIntent }] }, "birth"),
      [], JSON.stringify(dispatchIntent));
  }
});

test("ready-slice closed-value members state the owner's accepted values and stay open strings", () => {
  const accepted = readySliceOwner.WORK_RECORD_READY_SLICE_ACCEPTED_VALUES;
  const { WORK_ITEM_READY_CLOSED_VALUE_NOTES } = authoringSchemaOwner;
  const members = ["status", "priority", "work_kind", "review_purpose", "completion_policy"];
  assert.deepEqual(Object.keys(WORK_ITEM_READY_CLOSED_VALUE_NOTES ?? {}), members);
  for (const member of members) {
    const note = WORK_ITEM_READY_CLOSED_VALUE_NOTES[member];
    assert.ok(note.endsWith(`One of: ${accepted[member].join(", ")}.`), note);
    assert.ok(Buffer.byteLength(note) <= 96, `${member} note stays concise: ${note}`);
  }
  for (const context of ["existing", "existing_slice", "birth"]) {
    const { items } = recordAuthoringChangeSchema("work_item", context).properties.ready_slices;
    for (const row of items.oneOf ?? [items]) {
      for (const member of members) {
        assert.deepEqual(row.properties[member],
          { type: "string", description: WORK_ITEM_READY_CLOSED_VALUE_NOTES[member] }, `${context}: ${member}`);
      }
    }
  }
  for (const values of [{ status: " todo ", priority: "\thigh\n", work_kind: " implementation " },
    { status: "unsupported", priority: "URGENT", work_kind: "design", review_purpose: "none", completion_policy: "none" }]) {
    assert.deepEqual(invalid("work_item", { ready_slices: [{ id: "SLICE-001", ...values }] }), [], JSON.stringify(values));
    assert.deepEqual(invalid("work_item", { ready_slices: [{ ...READY_CREATION, ...values }] }, "birth"), [],
      JSON.stringify(values));
  }
});

test("a refused ready-slice creation row names its missing and empty members together", () => {
  const at = (member) => `changes.ready_slices[0].${member}`;
  const without = (row, ...omitted) => Object.fromEntries(Object.entries(row).filter(([member]) => !omitted.includes(member)));
  for (const context of ["existing", "birth"]) {
    const rows = (row) => invalid("work_item", { ready_slices: [row] }, context);
    assert.deepEqual(rows(without(READY_CREATION, "depends_on", "write_scope", "expected_edit_targets")),
      [[INVALID, at("depends_on")], [INVALID, at("write_scope")], [INVALID, at("expected_edit_targets")]], context);
    assert.deepEqual(rows({ ...without(READY_CREATION, "title"), read_scope: [], repo_paths: [], write_scope: [],
      expected_edit_targets: [], acceptance: { criteria: [], validation: [] } }), [[INVALID, at("title")],
      ["ready_slice_incomplete_contract", at("read_scope")], ["ready_slice_incomplete_contract", at("repo_paths")],
      ["ready_slice_incomplete_contract", at("acceptance.criteria")],
      ["ready_slice_incomplete_contract", at("acceptance.validation")],
      ["ready_slice_implementation_write_scope_empty", at("write_scope")],
      ["ready_slice_implementation_targets_empty", at("expected_edit_targets")]], context);

    assert.deepEqual(rows({ ...without(READY_CREATION, "title", "write_scope", "expected_edit_targets"),
      shaping_mode: "reviewer", read_scope: 7, repo_paths: [] }), [[INVALID, at("title")], [INVALID, at("read_scope")],
      ["ready_slice_incomplete_contract", at("repo_paths")]], context);
    const [, empty] = validateRecordAuthoringChanges("work_item", context,
      { ready_slices: [{ ...without(READY_CREATION, "title"), read_scope: [] }] });
    assert.deepEqual(empty, { code: "ready_slice_incomplete_contract", severity: "error", path: at("read_scope"),
      message: `${at("read_scope")} must be non-empty` }, context);

    assert.deepEqual(rows({ ...READY_CREATION, read_scope: [] }), [], context);
  }
  assert.deepEqual(invalid("work_item", { ready_slices: [{ id: "SLICE-001", read_scope: [], unknown: true }] }),
    [[INVALID, at("unknown")]]);
});

test("work-item declarations separate criterion label references from literal slice acceptance text", () => {
  const { criteria: acceptanceText } = WORK_RECORD_READY_SLICE_ACCEPTANCE_SCHEMA.properties;
  assert.match(acceptanceText.description, /^The slice's own readable outcomes\./u);
  assert.match(acceptanceText.description, /A string is literal text, never a \$key reference/u);
  assert.match(acceptanceText.description, /parent criterion label copies no text and transfers no coverage/u);
  assert.match(acceptanceText.description, /object states text beside verification_method, evidence_target or facet_provenance/u);
  assert.equal(WORK_RECORD_READY_SLICE_ACCEPTANCE_SCHEMA.properties.validation.description, undefined);
  for (const context of ["existing", "existing_slice", "birth"]) {
    const properties = recordAuthoringChangeSchema("work_item", context).properties;
    const variants = (items) => items.oneOf ?? [items];
    assert.equal(properties.criteria.description, WORK_ITEM_CRITERION_NOTES.criteria, context);
    for (const row of variants(properties.obligations.items)) {
      assert.equal(row.properties.criteria.description, WORK_ITEM_CRITERION_NOTES.obligation_criteria, context);
    }
    for (const row of variants(properties.ready_slices.items)) {
      assert.equal(row.properties.acceptance.properties.criteria.description, acceptanceText.description, context);
    }
  }
  assert.match(WORK_ITEM_CRITERION_NOTES.criteria, /^Readable criteria of the selected unit\..+key is its same-request label/u);
  assert.match(WORK_ITEM_CRITERION_NOTES.obligation_criteria,
    /^Criterion ids or \$key labels of changes\.criteria rows; a label resolves to the issued identity, never to text\.$/u);

  const acceptance = { criteria: ["$c1", "Costs $5 or less.", { text: "It is ready.", verification_method: "test_execution",
    evidence_target: null }], validation: ["Run the focused test."] };
  assert.deepEqual(invalid("work_item", { ready_slices: [{ ...READY_CREATION, acceptance }] }), []);
  assert.deepEqual(invalid("work_item", { slices: [{ key: "draft", title: "Draft", acceptance }] }), []);

  assert.deepEqual(invalid("work_item", { criteria: [{ key: "own", text: "It is ready." }],
    obligations: [{ key: "prove", statement: "It is ready.", criteria: ["$own", "held-criterion-identity"] }] },
  "existing_slice"), []);
});
