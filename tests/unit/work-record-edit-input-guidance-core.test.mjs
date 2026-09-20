import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import {
  WORK_RECORD_EDIT_FIELD_REGISTRY,
  WORK_RECORD_EDIT_SPECIALIZED_FIELD_OWNERS
} from "../../packages/wiki-core/src/lib/work-record-contract-edit-operations.mjs";
import {
  WorkRecordEditInputGuidanceCoverageError,
  createWorkRecordEditFieldGuidance,
  createWorkRecordEditFieldInventory
} from "../../packages/wiki-core/src/lib/work-record-edit-input-guidance.mjs";
import {
  WorkRecordEditInputContractCoverageError,
  createWorkRecordEditInputRequestFacts,
  createWorkRecordEditInputSchema
} from "../../packages/wiki-mcp/src/lib/work-record-edit-input-contract.mjs";

const facadeEntries = () => WORK_RECORD_EDIT_FIELD_REGISTRY.filter(({ facade }) => facade);

function requestsFromGuidance(guidance) {
  return guidance.actions.flatMap(({ request_shapes }) =>
    request_shapes.map(({ example }) => example));
}

test("editor guidance derives its complete current population from canonical owners", () => {
  const requestFacts = createWorkRecordEditInputRequestFacts(z);
  const inventory = createWorkRecordEditFieldInventory({ requestFacts });
  const expectedFields = [...new Set(facadeEntries().map(({ field }) => field))];

  assert.equal(inventory.complete, true);
  assert.equal(inventory.registry_entry_count, facadeEntries().length);
  assert.equal(inventory.total_count, expectedFields.length);
  assert.deepEqual(inventory.fields.map(({ field }) => field), expectedFields);
  assert.equal(inventory.fields.some(({ field }) => field === "docs"), false);
  for (const field of ["acceptance.criteria", "acceptance.validation"]) {
    assert.equal(inventory.fields.some((row) => row.field === field), true, field);
  }

  for (const entry of facadeEntries()) {
    const row = inventory.fields.find(({ field }) => field === entry.field);
    assert.ok(row, entry.id);
    assert.equal(row.kind, entry.kind, entry.id);
    for (const scope of entry.applicability) assert.ok(row.applicability.includes(scope), entry.id);

    for (const action of entry.actions) {
      assert.ok(row.actions.includes(action), `${entry.id}:${action}`);
    }
    assert.equal(Object.hasOwn(row, "value_constraints"), false, entry.id);
    assert.equal(
      row.actions.every((action) => typeof action === "string"),
      true,
      entry.id
    );
    if (entry.kind === "task") {
      assert.deepEqual(row.selectors, { mark_done: ["text", "index"], replace_text: ["text", "index"] },
        entry.id);
    } else {
      assert.equal(Object.hasOwn(row, "selectors"), false, entry.id);
    }
    assert.ok(
      requestFacts.variants.some(({ registry_entry_ids }) => registry_entry_ids.includes(entry.id)),
      `missing schema fact for ${entry.id}`
    );
  }

  const editorSchema = createWorkRecordEditInputSchema(z);
  for (const entry of facadeEntries()) {
    const selected = createWorkRecordEditFieldGuidance({
      field: entry.field,
      scope: entry.applicability[0],
      requestFacts
    });
    assert.equal(selected.ok, true, entry.id);
    assert.deepEqual(selected.actions.map(({ action }) => action), entry.actions, entry.id);
    for (const action of selected.actions) {
      assert.notEqual(action.value_constraints, undefined, `${entry.id}:${action.action}`);
      assert.ok(action.request_shapes.length > 0, `${entry.id}:${action.action}`);
      for (const shape of action.request_shapes) {
        assert.equal(editorSchema.safeParse(shape.example).success, true,
          `${entry.id}:${action.action}`);
      }
    }
  }

  const semantic = createWorkRecordEditFieldGuidance({
    field: "acceptance",
    scope: "record",
    requestFacts
  });
  assert.equal(semantic.ok, false);
  assert.equal(semantic.diagnostic.code, "field_owner_mismatch");
  assert.equal(semantic.diagnostic.owner, WORK_RECORD_EDIT_SPECIALIZED_FIELD_OWNERS
    .find(({ prefixes }) => prefixes.includes("acceptance")).owner);
  assert.equal(semantic.diagnostic.authority_limb, "mechanical_failure");

  const unknown = createWorkRecordEditFieldGuidance({
    field: "not_a_field",
    scope: "record",
    requestFacts
  });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.diagnostic.code, "unsupported_edit_field");

  const future = {
    id: "future_summary.record",
    field: "sections.future_summary",
    kind: "scalar",
    canonical_address: ["sections", "future_summary"],
    applicability: ["record"],
    value_schema: { type: "string", trim: true, min_length: 1 },
    actions: ["replace"],
    owner: "editWorkRecordByUnit",
    facade: true
  };
  const futureRegistry = [...WORK_RECORD_EDIT_FIELD_REGISTRY, future];
  const futureFacts = createWorkRecordEditInputRequestFacts(z, { registry: futureRegistry });
  const futureInventory = createWorkRecordEditFieldInventory({
    registry: futureRegistry,
    requestFacts: futureFacts
  });
  assert.ok(futureInventory.fields.some(({ field }) => field === future.field));
  const futureGuidance = createWorkRecordEditFieldGuidance({
    field: future.field,
    scope: "record",
    registry: futureRegistry,
    requestFacts: futureFacts
  });
  assert.equal(futureGuidance.ok, true);
  assert.equal(
    createWorkRecordEditInputSchema(z, { registry: futureRegistry })
      .safeParse(requestsFromGuidance(futureGuidance)[0]).success,
    true
  );

  assert.throws(
    () => createWorkRecordEditFieldInventory({ registry: futureRegistry, requestFacts }),
    (error) => error instanceof WorkRecordEditInputGuidanceCoverageError &&
      error.code === "missing_request_variant" && error.entry_id === future.id
  );
  assert.throws(
    () => createWorkRecordEditFieldInventory({
      requestFacts: {
        ...requestFacts,
        semantic_refusals: requestFacts.semantic_refusals.slice(1)
      }
    }),
    (error) => error instanceof WorkRecordEditInputGuidanceCoverageError &&
      error.code === "missing_semantic_refusal_variant" &&
      error.field === requestFacts.semantic_refusals[0].field
  );
  assert.throws(
    () => createWorkRecordEditInputRequestFacts(z, {
      registry: [...WORK_RECORD_EDIT_FIELD_REGISTRY, { ...future, id: "future_object.record", kind: "object" }]
    }),
    (error) => error instanceof WorkRecordEditInputContractCoverageError &&
      error.code === "unsupported_registry_kind" && error.entry_id === "future_object.record"
  );
});

test("editor guidance covers field shapes and exact value boundaries", () => {
  const requestFacts = createWorkRecordEditInputRequestFacts(z);
  const schema = createWorkRecordEditInputSchema(z);
  const inventory = createWorkRecordEditFieldInventory({ requestFacts });
  assert.deepEqual(
    requestFacts.common_request_contract.contract.required,
    ["unit"]
  );
  assert.deepEqual(
    Object.keys(requestFacts.common_request_contract.contract.properties),
    ["repo", "unit", "expected_source_digest", "verbose"]
  );
  assert.equal(requestFacts.common_request_contract.contract.additionalProperties, false);

  for (const row of inventory.fields) {
    for (const scope of row.applicability) {
      const guidance = createWorkRecordEditFieldGuidance({
        field: row.field,
        scope,
        requestFacts
      });
      assert.equal(guidance.ok, true, `${row.field}:${scope}`);
      for (const request of requestsFromGuidance(guidance)) {
        const parsed = schema.safeParse(request);
        assert.equal(parsed.success, true,
          `${row.field}:${scope} ${JSON.stringify(parsed.error?.issues ?? [])}`);
      }
    }
  }
  const exampleIdentities = new Set();
  for (const row of inventory.fields) {
    for (const scope of row.applicability) {
      const selected = createWorkRecordEditFieldGuidance({
        field: row.field, scope, requestFacts
      });
      for (const request of requestsFromGuidance(selected)) {
        const selector = Object.hasOwn(request, "text")
          ? "text" : Object.hasOwn(request, "index") ? "index" : "none";
        exampleIdentities.add(`${request.kind}:${request.field}:${request.action}:${selector}`);
      }
    }
  }
  assert.deepEqual(
    [...exampleIdentities],
    requestFacts.variants.map(({ identity }) => identity),
    "examples cover every distinct schema-owned request shape"
  );

  const priority = createWorkRecordEditFieldGuidance({
    field: "priority", scope: "record", requestFacts
  });
  assert.deepEqual(priority.actions[0].value_constraints.enum,
    ["critical", "high", "medium", "low"]);
  assert.equal(schema.safeParse({
    unit: "WK-0000", kind: "scalar", field: "priority", action: "replace", value: "urgent"
  }).success, false);

  const titleRequest = {
    unit: "WK-0000", kind: "scalar", field: "title", action: "replace", value: "  title  "
  };
  const title = schema.safeParse(titleRequest);
  assert.equal(title.success, true);
  assert.equal(title.data.value, "title");
  assert.equal(schema.safeParse({ ...titleRequest, value: "   " }).success, false);
  assert.equal(schema.safeParse({
    ...titleRequest, field: "sections.summary", value: { text: "" }
  }).success, true);
  assert.equal(schema.safeParse({
    ...titleRequest, field: "sections.summary", value: ""
  }).success, false);
  assert.equal(schema.safeParse({
    ...titleRequest, field: "owner", value: ""
  }).success, false);

  const notesEntry = facadeEntries().find(({ id }) => id === "agent_notes.record");
  const maximum = notesEntry.value_schema.max_utf8_bytes;
  const notesRequest = {
    unit: "WK-0000",
    kind: "scalar",
    field: "sections.agent_notes",
    action: "replace"
  };
  assert.equal(schema.safeParse({ ...notesRequest, value: { text: "a".repeat(maximum) } }).success, true);
  assert.equal(schema.safeParse({ ...notesRequest, value: { text: "a".repeat(maximum + 1) } }).success, true,
    "the destination byte limit is enforced after exact reference resolution");
  assert.equal(schema.safeParse({ ...notesRequest, value: { ref: "opaque" } }).success, true);
  assert.equal(schema.safeParse({ ...notesRequest, value: {
    parts: [{ ref: "before" }, { text: "replacement" }, { ref: "after" }]
  } }).success, true);
  assert.equal(schema.safeParse({ ...notesRequest, value: "bare" }).success, false);
  assert.equal(schema.safeParse({ ...notesRequest, value: { text: "\ud800" } }).success, false);
  const notes = createWorkRecordEditFieldGuidance({
    field: "sections.agent_notes", scope: "record", requestFacts
  });
  assert.equal(notes.actions[0].value_constraints.type, "entry_content");
  assert.deepEqual(notes.actions[0].value_constraints.alternatives, ["text", "ref", "parts"]);
  assert.equal(notes.actions[0].value_constraints.max_parts, 256);
  assert.equal(notes.actions[0].value_constraints.destination.max_utf8_bytes, maximum);
  assert.equal(notes.actions[0].request_shapes[0].example.value.text,
    "Complete replacement notes text");
  assert.ok(notes.semantics.contract_coverage.unprojected_constraints.some(({ path, reason }) =>
    path === "$.value" && reason === "post_resolution_destination_validation"));
  assert.match(notes.semantics.replacement.notes, /whole notes field/i);
  assert.match(notes.semantics.replacement.notes, /include prior notes/i);

  const listBase = { unit: "WK-0000", kind: "list", field: "tags" };
  assert.equal(schema.safeParse({ ...listBase, action: "replace", value: ["one"] }).success, true);
  assert.equal(schema.safeParse({ ...listBase, action: "replace", value: [] }).success, true);
  assert.equal(schema.safeParse({ ...listBase, action: "replace", value: "one" }).success, false);
  assert.equal(schema.safeParse({ ...listBase, action: "replace", value: [1] }).success, false);
  assert.equal(schema.safeParse({ ...listBase, action: "append", value: "one" }).success, true);
  assert.equal(schema.safeParse({ ...listBase, action: "append", value: "" }).success, true);
  assert.equal(schema.safeParse({ ...listBase, action: "append", value: ["one"] }).success, false);

  const taskBase = { unit: "WK-0000", kind: "task", field: "sections.tasks" };
  for (const accepted of [
    { ...taskBase, action: "mark_done", index: 0 },
    { ...taskBase, action: "mark_done", index: "0" },
    { ...taskBase, action: "mark_done", text: "existing" },
    { ...taskBase, action: "replace_text", index: 0, value: { text: "replacement" } },
    { ...taskBase, action: "append_todo", value: { text: "new task" } }
  ]) assert.equal(schema.safeParse(accepted).success, true, JSON.stringify(accepted));
  const trimmedSelector = schema.safeParse({ ...taskBase, action: "mark_done", text: "  existing  " });
  assert.equal(trimmedSelector.success, true);
  assert.equal(trimmedSelector.data.text, "existing");
  for (const rejected of [
    { ...taskBase, action: "mark_done" },
    { ...taskBase, action: "mark_done", index: 0, text: "existing" },
    { ...taskBase, action: "mark_done", index: -1 },
    { ...taskBase, action: "mark_done", index: 0.5 },
    { ...taskBase, action: "mark_done", index: "01" },
    { ...taskBase, action: "mark_done", text: "   " },
    { ...taskBase, action: "replace_text", index: 0, value: "replacement" },
    { ...taskBase, action: "append_todo", value: "new", index: 0 },
    { ...taskBase, action: "append_todo", value: { text: "new" }, unknown: true }
  ]) assert.equal(schema.safeParse(rejected).success, false, JSON.stringify(rejected));
  const tasks = createWorkRecordEditFieldGuidance({
    field: "sections.tasks", scope: "slice", requestFacts
  });
  assert.deepEqual(
    tasks.actions.find(({ action }) => action === "mark_done")
      .request_shapes.map(({ selector }) => selector),
    ["text", "index"]
  );
  assert.equal(
    tasks.actions.find(({ action }) => action === "mark_done")
      .request_shapes.find(({ selector }) => selector === "index").index_base,
    0
  );
  assert.match(tasks.semantics.replacement.tasks, /preserves.*status/i);
  assert.match(tasks.semantics.no_op, /do not churn/i);

  assert.equal(Object.hasOwn(tasks.semantics.replacement, "notes"), false);
  assert.equal(Object.hasOwn(tasks.semantics.replacement, "acceptance_validation"), false);
  assert.equal(tasks.semantics.digests.mutation_record.request_path, "expected_source_digest");

  const wrongScope = createWorkRecordEditFieldGuidance({
    field: "title", scope: "slice", requestFacts
  });
  assert.equal(wrongScope.ok, false);
  assert.equal(wrongScope.diagnostic.code, "invalid_edit_applicability");
  assert.equal(wrongScope.diagnostic.authority_limb, "mechanical_failure");

  assert.equal(notes.semantics.digests.mutation_record.request_path, "expected_source_digest");
  assert.equal(notes.semantics.digests.mutation_record.checked_before_no_op, true);
  assert.equal(notes.semantics.digests.guidance_traversal.source, "editor_input_contract");
  assert.equal(
    notes.semantics.digests.guidance_traversal.request_path,
    "input_contract.expected_source_digest"
  );
  assert.equal(notes.semantics.digests.guidance_traversal.accepted_as_mutation_digest, false);
  assert.equal(notes.semantics.contract_coverage.completeness, "partial");
  assert.ok(notes.semantics.contract_coverage.unprojected_constraints.some(
    ({ path, reason }) => path === "$.expected_source_digest" &&
      reason === "post_schema_validation"
  ));

  for (const scope of ["record", "slice"]) {
    const criteria = createWorkRecordEditFieldGuidance({
      field: "acceptance.criteria", scope, requestFacts
    });
    assert.equal(criteria.ok, true, scope);
    assert.equal(criteria.kind, "list", scope);
    assert.equal(criteria.semantics.replacement.list,
      inventory.semantics.replacement.list, `acceptance.criteria:${scope}`);
    assert.equal(Object.hasOwn(criteria.semantics.replacement, "acceptance_validation"), false,
      `acceptance.criteria:${scope} must not carry the acceptance.validation-only rule`);
    assert.equal(Object.hasOwn(criteria.semantics.replacement, "notes"), false, scope);
    assert.deepEqual(Object.keys(criteria.semantics.replacement), ["list"], scope);

    const validation = createWorkRecordEditFieldGuidance({
      field: "acceptance.validation", scope, requestFacts
    });
    assert.equal(validation.ok, true, scope);
    assert.equal(validation.semantics.replacement.list,
      inventory.semantics.replacement.list, `acceptance.validation:${scope}`);
    assert.equal(validation.semantics.replacement.acceptance_validation,
      inventory.semantics.replacement.acceptance_validation, scope);
    assert.match(validation.semantics.replacement.acceptance_validation,
      /node_test bindings are preserved/u, scope);
    assert.match(validation.semantics.replacement.acceptance_validation,
      /authored only by controlled-contract proof operations/u, scope);

    for (const selected of [criteria, validation]) {
      assert.equal(selected.semantics.no_op, inventory.semantics.no_op, scope);
      assert.deepEqual(selected.semantics.digests, inventory.semantics.digests, scope);
      assert.deepEqual(selected.applicability, ["record", "slice"], scope);
      assert.deepEqual(selected.actions.map(({ action }) => action), ["replace", "append"], scope);
      assert.equal(selected.registry_entry_id,
        facadeEntries().find(({ field }) => field === selected.field).id, scope);
      for (const request of requestsFromGuidance(selected)) {
        assert.equal(schema.safeParse(request).success, true, JSON.stringify(request));
      }
    }
  }

  assert.match(inventory.semantics.replacement.acceptance_validation,
    /acceptance\.validation replace supplies the complete note list/u);

  for (const { prefixes, owner } of WORK_RECORD_EDIT_SPECIALIZED_FIELD_OWNERS) {
    for (const prefix of prefixes) {
      const selected = createWorkRecordEditFieldGuidance({
        field: prefix, scope: "record", requestFacts
      });
      assert.equal(selected.ok, false, prefix);
      assert.equal(selected.diagnostic.code, "field_owner_mismatch", prefix);
      assert.equal(selected.diagnostic.owner, owner, prefix);
    }
  }
});
