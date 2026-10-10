import assert from "node:assert/strict";
import test from "node:test";

import { CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_UPSERT_INPUT_SCHEMA as semantic } from
  "../../packages/wiki-core/src/lib/controlled-contract-tools.mjs";
import { WORK_RECORD_EDIT_FIELD_REGISTRY } from
  "../../packages/wiki-core/src/lib/work-record-contract-edit-operations.mjs";
import { kindRecordEditableScalarFields } from "../../packages/wiki-core/src/lib/kind-record-edit.mjs";
import { RECORD_KIND_SPECS } from "../../packages/wiki-core/src/lib/work-record-kind-registry.mjs";
import { WORK_RECORD_READY_SLICE_CREATION_REQUIREMENTS } from
  "../../packages/wiki-core/src/lib/work-record-ready-slice-contract.mjs";
import { WORK_ITEM_ORDINARY_MEMBERS, WORK_ITEM_SLICE_CONTRACT_MEMBERS, recordAuthoringChangeSchema,
  validateRecordAuthoringChanges } from
  "../../packages/wiki-core/src/lib/record-authoring-schema.mjs";

const semanticBefore = structuredClone(semantic);
const kinds = ["work_item", "decision", "initiative"];
const INVALID = "record_authoring_change_invalid";
const diagnostics = (kind, changes, context = "birth") =>
  validateRecordAuthoringChanges(kind, context, changes);
const accepted = (kind, changes) => assert.deepEqual(diagnostics(kind, changes), [], JSON.stringify(changes));
function refused(changes, path, kind = "work_item") {
  const result = diagnostics(kind, changes);
  assert.ok(result.length > 0, `accepted ${JSON.stringify(changes)}`);
  assert.ok(result.every(row => row.code === INVALID && row.severity === "error"));
  assert.ok(result.some(row => row.path === path), JSON.stringify(result));
  assert.ok(result.every(row => row.message.startsWith(row.path)), JSON.stringify(result));
}

const ordinaryValues = {
  title: "Draft", summary: { text: "Summary." }, user_requirements: "Requested.",
  why_it_matters: "Purpose.", notes: "Notes.", priority: "medium", base_branch: "main",
  read_scope: ["docs/work-record-schema.md"], write_scope: ["packages/a.mjs"], repo_paths: ["packages/a.mjs"],
  depends_on: ["WK-0001"], related: ["WK-0002"], blocks: ["WK-0003"],
  material_refs: [{ ref: "retained-source" }], validation: ["Check."], owner: "operator", tags: ["draft"],
  scope_items: ["Included."], scope_out_of_scope: ["Excluded."], references: ["docs/work-record-schema.md"]
};
const requirement = { modality: "must", subject: { select: "ref-subject" },
  behavior: { relation: "returns", objects: [{ boolean: true }] } };
const authoredCase = { verification: "$verification", observation: { kind: "return_value" } };

const readyCreation = { title: "Ready slice", depends_on: [], read_scope: ["AGENTS.md"],
  repo_paths: ["packages/a.mjs"], write_scope: ["packages/a.mjs"],
  acceptance: { criteria: ["It is ready."], validation: ["Check."] },
  expected_edit_targets: [{ path: "packages/a.mjs", name: "a", kind: "module", operation: "modify" }] };
const rowLocations = [
  ["entries", { key: "entry", title: "Entry", content: { text: "Body." } }, 1],
  ["dispositions", { key: "judgment", entry: { id: "$entry", version: 1 },
    finding_id: "F1", disposition: "accept", rationale: "Retained." }, 1],
  ["criteria", { key: "criterion", text: "It works." }, "derived:criterion"],
  ["requirements", { key: "requirement", ...requirement }, "claim-existing"],
  ["obligations", { key: "obligation", statement: "It works." }, "OBL-EXISTING"],
  ["obligations[].case", { key: "case", ...authoredCase }, "case-existing"],
  ["slices", { key: "slice", title: "Draft slice" }, "SLICE-001"],
  ["ready_slices", { key: "ready", ...readyCreation }, "SLICE-001"]
];
const rowInput = (location, rows) => location === "obligations[].case"
  ? { obligations: rows.map((row, index) => ({ key: `obligation-${index}`, case: row })) }
  : { [location]: rows };
const rowPath = (location, index) => location === "obligations[].case"
  ? `changes.obligations[${index}].case` : `changes.${location}[${index}]`;

test("birth schema accepts empty drafts and preserves owner-derived kind fields", async t => {
  for (const kind of kinds) await t.test(kind, () => {
    accepted(kind, {});
    assert.deepEqual(diagnostics(kind, {}, "existing").map(({ code, path }) => [code, path]), [[INVALID, "changes"]]);
    const schema = recordAuthoringChangeSchema(kind, "birth");
    assert.equal(schema.additionalProperties, false);
    if (kind === "work_item") {
      assert.deepEqual(Object.keys(ordinaryValues).sort(), WORK_ITEM_ORDINARY_MEMBERS.map(row => row.member).sort());
      for (const { member, field } of WORK_ITEM_ORDINARY_MEMBERS) {
        assert.ok(WORK_RECORD_EDIT_FIELD_REGISTRY.some(row => row.field === field));
        accepted(kind, { [member]: ordinaryValues[member] });
      }
      accepted(kind, { initiative: "IN-0001", retained_graph_evidence: { ref_id: "aB3_dE9x" } });

      const sliceContract = { work_kind: "implementation", target_unit: "slice", agent_role: "worker",
        expected_edit_targets: [{ path: "packages/a.mjs", name: "a", kind: "module", operation: "modify" }],
        expected_changed_line_budget: 10 };
      assert.deepEqual(Object.keys(sliceContract), [...WORK_ITEM_SLICE_CONTRACT_MEMBERS]);
      assert.deepEqual(WORK_ITEM_SLICE_CONTRACT_MEMBERS.filter(member => Object.hasOwn(schema.properties, member)), []);
      assert.deepEqual(diagnostics(kind, { title: "Draft", ...sliceContract }).map(({ code, path }) => [code, path]),
        WORK_ITEM_SLICE_CONTRACT_MEMBERS.map(member => ["record_authoring_member_not_applicable", `changes.${member}`]));
      for (const [member, value] of Object.entries(sliceContract)) {
        const [refusal, ...rest] = diagnostics(kind, { [member]: value });
        assert.deepEqual([refusal.code, refusal.path, rest], ["record_authoring_member_not_applicable", `changes.${member}`, []]);
        assert.ok(refusal.message.startsWith(`${refusal.path} is a slice contract member; it does not apply to a new record`),
          refusal.message);
        assert.match(refusal.message, /ready_slices or slices row/u);
      }

      accepted(kind, { slices: [{ key: "slice", dispatch_intent: { id: "nested-authored-data" },
        sections: { id: "body-data" } }], ready_slices: [{ key: "ready", ...readyCreation, status: "done" }] });
    } else {
      assert.deepEqual(Object.keys(schema.properties).filter(key => key !== "sections").sort(),
        [...kindRecordEditableScalarFields(kind)].sort());
      assert.deepEqual(Object.keys(schema.properties.sections.properties), Object.keys(RECORD_KIND_SPECS[kind].sectionSpec));
      accepted(kind, kind === "initiative"
        ? { title: "Initiative", summary: "Scalar.", sections: { summary: "Body.", goals: "Goal.", milestones: "First." },
          tags: ["draft"], target: null, included_issues: [{ id: "WK-0001" }] }
        : { title: "Decision", owners: ["operator"], date: "2026-10-04", area: null, docs: ["docs/a.md"],
          sections: { context: "Context.", decision: "Choice.", consequences: "Effects." }, enforcement: { id: "semantic-data" } });
      refused({ sections: { unknown: "x" } }, "changes.sections.unknown", kind);
    }
    for (const member of ["unknown", "remove", "status", "closure", "id", "repo", "repository", "path",
      "created", "updated", "updated_by", "provenance", "ratified", "ratified_by", "proof_posture",
      "derived_evidence", "projections", "allow_proof_posture", "authority", "record_kind"]) {
      assert.deepEqual(diagnostics(kind, { [member]: "x" }).map(({ code, path }) => [code, path]),
        [[INVALID, `changes.${member}`]], `${kind}.${member}`);
    }
    refused({ title: 42 }, "changes.title", kind);
  });
});

test("ready-slice dispatch_intent is a closed partial declaration in both contexts", () => {
  const members = ["intended_agent_role", "target_unit", "requires_graph_impact", "requires_escalation"];
  for (const context of ["birth", "existing"]) {
    const row = context === "birth" ? { key: "ready", ...readyCreation } : { id: "SLICE-001" };
    const check = dispatchIntent => diagnostics("work_item", { ready_slices: [{ ...row, dispatch_intent: dispatchIntent }] },
      context).map(({ code, path }) => [code, path]);
    const schema = recordAuthoringChangeSchema("work_item", context).properties.ready_slices.items;
    const declared = (schema.oneOf ?? [schema]).map(variant => variant.properties.dispatch_intent);
    for (const declaration of declared) {
      assert.deepEqual([declaration.additionalProperties, declaration.required, Object.keys(declaration.properties)],
        [false, undefined, members], context);
    }
    for (const partial of [{}, { requires_graph_impact: true }, { requires_escalation: false },
      { intended_agent_role: "worker", target_unit: "slice" },
      { intended_agent_role: "reviewer", target_unit: "slice", requires_graph_impact: false, requires_escalation: true }]) {
      assert.deepEqual(check(partial), [], `${context}: ${JSON.stringify(partial)}`);
    }
    const at = member => `changes.ready_slices[0].dispatch_intent${member}`;
    for (const [invalid, path] of [[{ requires_graph_impact: "true" }, at(".requires_graph_impact")],
      [{ requires_escalation: null }, at(".requires_escalation")], [{ intended_agent_role: null }, at(".intended_agent_role")],
      [{ target_unit: 1 }, at(".target_unit")], [{ requires_review: true }, at(".requires_review")],
      [{ id: "nested-authored-data" }, at(".id")], [[], at("")], [null, at("")]]) {
      assert.deepEqual(check(invalid), [[INVALID, path]], `${context}: ${JSON.stringify(invalid)}`);
    }

    assert.deepEqual(diagnostics("work_item", { slices: [{ ...(context === "birth" ? { key: "slice" } : { id: "SLICE-001" }),
      dispatch_intent: { requires_review: true } }] }, context), []);
  }
});

test("birth schema refuses existing-row selectors at every authored depth", async t => {
  for (const [location, positive, id] of rowLocations) await t.test(location, () => {
    accepted("work_item", rowInput(location, [positive]));
    const { key: _key, ...body } = positive;
    refused(rowInput(location, [{ id, ...body }]), `${rowPath(location, 0)}.id`);
    refused(rowInput(location, [{ ...positive, id }]), `${rowPath(location, 0)}.id`);
    refused(rowInput(location, [positive, { ...positive, unknown: true }]), `${rowPath(location, 1)}.unknown`);
    const trailingSelector = diagnostics("work_item", rowInput(location, [positive, { id, ...body }]));
    assert.ok(trailingSelector.some(row => row.path === `${rowPath(location, 1)}.id`), JSON.stringify(trailingSelector));
    assert.ok(trailingSelector.every(row => row.path.startsWith(rowPath(location, 1))), JSON.stringify(trailingSelector));
  });
  await t.test("optional labels and semantic reference identities", () => {
    accepted("work_item", { requirements: [requirement], obligations: [{ key: "obligation", case: {} }] });
    accepted("work_item", { entries: [{ key: "entry", title: "First", content: { text: "Body" } }],
      dispositions: [{ key: "judgment", entry: { id: 1, version: 1 }, selected_text: { text: "Finding", occurrence: 0 } }],
      criteria: [{ key: "criterion", text: "Works." }], requirements: [{ ...requirement, verification: {
        key: "verification", method: "test", verifier: { select: "ref-verifier" },
        observes: requirement.behavior, fails_when: requirement.behavior } }],
      obligations: [{ key: "obligation", claims: ["$requirement", "claim-existing"], criteria: ["$criterion", "derived:existing"],
        proof: { name: "proof.verification.test-validity", parameters: { id: "authored-data" } }, case: authoredCase }] });
    accepted("work_item", { requirements: [{ ...requirement, subject: { declare: {
      type_term: "module", identity: { kind: "repo_path", repository: "test/repo", path: "packages/a.mjs" } } } }] });
    refused({ entries: [{ title: "Missing label", content: { text: "Body" } }] }, "changes.entries[0].key");
    refused({ criteria: [{ key: "Invalid Label", text: "Works." }] }, "changes.criteria[0].key");
    refused({ obligations: [{ key: "obligation", case: { observation: { kind: 42 } } }] },
      "changes.obligations[0].case.observation.kind");
  });
  await t.test("only the authentic new-task action is declared", () => {
    for (const value of ["A task", "  A task  ", "", "   "]) accepted("work_item", { tasks: [{ action: "append_todo", value }] });

    for (const action of ["mark_done", "replace_text"]) refused({ tasks: [{ action, value: "Task" }] }, "changes.tasks[0].action");
    for (const [member, value] of [["index", 0], ["text", "Task"]]) {
      refused({ tasks: [{ action: "append_todo", value: "Task", [member]: value }] }, `changes.tasks[0].${member}`);
    }
    for (const [task, member] of [[{ action: "append_todo" }, "value"], [{ value: "Task" }, "action"]]) {
      refused({ tasks: [task] }, `changes.tasks[0].${member}`);
    }
    refused({ tasks: [{ action: "append_todo", value: "First" }, { action: "append_todo", value: 42 }] }, "changes.tasks[1].value");
    const taskSchema = recordAuthoringChangeSchema("work_item", "birth").properties.tasks.items;
    assert.deepEqual(taskSchema.required, ["action", "value"]);
    assert.deepEqual(Object.keys(taskSchema.properties).sort(), ["action", "value"]);
  });
});

test("birth schema projection leaves existing-save contracts unchanged", async () => {

  const freshOwner = order => {
    const url = new URL("../../packages/wiki-core/src/lib/record-authoring-schema.mjs", import.meta.url);
    url.search = order;
    return import(url.href);
  };
  const existingFirst = await freshOwner("existing-first");
  const birthFirst = await freshOwner("birth-first");
  const sliceFirst = await freshOwner("slice-first");

  const sliceBefore = structuredClone(sliceFirst.recordAuthoringChangeSchema("work_item", "existing_slice"));
  const schemasBefore = kinds.map(kind => structuredClone(existingFirst.recordAuthoringChangeSchema(kind, "existing")));
  const corpus = kinds.flatMap(kind => [
    [kind, {}, ["changes"]], [kind, { title: "Draft" }, []],
    [kind, { title: 42 }, ["changes.title"]], [kind, { id: "forged" }, ["changes.id"]]
  ]);
  for (const [location, positive, id] of rowLocations) {
    const { key: _key, ...body } = positive;
    corpus.push(["work_item", rowInput(location, [{ id, ...body }]), []]);
    corpus.push(["work_item", rowInput(location, [{ ...positive, id }]), [rowPath(location, 0)]]);
  }
  corpus.push(
    ["work_item", { obligations: [{ id: "OBL-A", case: { observation: { kind: 42 } } }] },
      ["changes.obligations[0].case.observation.kind"]],
    ["work_item", { obligations: [{ id: "OBL-A", case: { key: "case", id: "case-existing" } }] },
      ["changes.obligations[0].case"]],
    ["work_item", { tasks: [{ action: "mark_done", index: 0 }, { action: "replace_text", text: "Old", value: "New" },
      { action: "append_todo", value: "New task" }] }, []],
    ["work_item", { tasks: [{ action: "unsupported" }] }, ["changes.tasks[0].action"]],
    ["work_item", { status: "done", closure: { summary: "Done.", validation: [], follow_ups: [] }, remove: {} }, []],
    ["decision", { status: "rejected" }, []], ["decision", { status: "accepted" }, ["changes.status"]],
    ["decision", { owners: ["operator"], date: "2026-10-04" }, []],
    ["decision", { ratified_by: "operator" }, ["changes.ratified_by"]],
    ["initiative", { summary: "Scalar.", sections: { summary: "Body." } }, []],
    ["initiative", { sections: { unknown: "Body." } }, ["changes.sections.unknown"]],
    ["initiative", { status: "done" }, ["changes.status"]]
  );
  const evaluate = owner => corpus.map(([kind, changes, paths]) => {
    const result = owner.validateRecordAuthoringChanges(kind, "existing", changes);
    assert.deepEqual(result.map(row => row.path), paths, `${kind}: ${JSON.stringify(changes)}`);
    assert.ok(result.every(row => row.code === INVALID && row.severity === "error"));
    return result;
  });
  const diagnosticsBefore = evaluate(existingFirst);
  for (const kind of kinds) {
    existingFirst.recordAuthoringChangeSchema(kind, "birth");
    birthFirst.recordAuthoringChangeSchema(kind, "birth");
  }
  existingFirst.recordAuthoringChangeSchema("work_item", "existing_slice");
  const birthsBefore = kinds.map(kind => structuredClone(birthFirst.recordAuthoringChangeSchema(kind, "birth")));
  for (const owner of [existingFirst, birthFirst, sliceFirst]) {
    assert.deepEqual(kinds.map(kind => owner.recordAuthoringChangeSchema(kind, "existing")), schemasBefore);

    assert.deepEqual(owner.recordAuthoringChangeSchema("work_item", "existing_slice"), sliceBefore);
    assert.deepEqual(kinds.map(kind => owner.recordAuthoringChangeSchema(kind, "birth")), birthsBefore);
    assert.deepEqual(["existing", "existing_slice", "birth"].map(context => WORK_ITEM_SLICE_CONTRACT_MEMBERS.every(member =>
      Object.hasOwn(owner.recordAuthoringChangeSchema("work_item", context).properties, member))), [false, true, false]);
    assert.equal(owner.recordAuthoringChangeSchema("work_item", "existing_slice"),
      owner.recordAuthoringChangeSchema("work_item", "existing_slice"));
    assert.deepEqual(evaluate(owner), diagnosticsBefore);

    const [created, updated] = owner.recordAuthoringChangeSchema("work_item", "existing").properties.ready_slices.items.oneOf;
    assert.deepEqual(owner.recordAuthoringChangeSchema("work_item", "birth").properties.ready_slices.items, created);
    assert.deepEqual([created.required, updated.required],
      [["key", ...WORK_RECORD_READY_SLICE_CREATION_REQUIREMENTS.every_shaping_mode], ["id"]]);
    const { depends_on: _dependsOn, acceptance: _acceptance, ...incomplete } = readyCreation;
    for (const context of ["existing", "birth"]) {
      assert.deepEqual(owner.validateRecordAuthoringChanges("work_item", context, { ready_slices: [{ key: "ready", ...incomplete }] })
        .map(row => row.path), ["changes.ready_slices[0].depends_on", "changes.ready_slices[0].acceptance"], context);
    }
    assert.deepEqual(owner.validateRecordAuthoringChanges("work_item", "existing", { ready_slices: [{ id: "SLICE-001" }] }), []);
    for (const kind of ["source", "area"]) {
      assert.throws(() => owner.recordAuthoringChangeSchema(kind, "existing"), TypeError);
      assert.throws(() => owner.validateRecordAuthoringChanges(kind, "existing", { title: "Unsupported" }), TypeError);
    }

    const births = kinds.map(kind => structuredClone(owner.recordAuthoringChangeSchema(kind, "birth")));
    assert.deepEqual(kinds.map(kind => owner.recordAuthoringChangeSchema(kind, "birth")), births);
  }
  assert.deepEqual(semantic, semanticBefore, "the semantic owner's shared declaration must never be mutated");
});
