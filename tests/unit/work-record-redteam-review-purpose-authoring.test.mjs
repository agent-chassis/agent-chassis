import assert from "node:assert/strict";
import test from "node:test";

import { planWorkRecordReadySlice } from
  "../../packages/wiki-core/src/lib/work-record-ready-slice-contract.mjs";
import { upsertSlice } from
  "../../packages/wiki-core/src/lib/work-record-contract-edit-operations.mjs";

function parent(slices = []) {
  return {
    schema_version: "work-record.v1",
    id: "WK-9298",
    repo: "agent-chassis/agent-chassis",
    title: "Ready-slice authoring fixture",
    record_kind: "work_item",
    work_kind: "implementation",
    status: "todo",
    priority: "medium",
    owner: "unassigned",
    created: "2026-08-23",
    updated: "2026-08-23",
    read_scope: ["AGENTS.md"],
    repo_paths: [],
    write_scope: [],
    depends_on: [],
    blocks: [],
    related: [],
    dispatch_intent: {
      intended_agent_role: null,
      target_unit: "none",
      requires_graph_impact: false,
      requires_escalation: false,
    },
    acceptance: { criteria: [], validation: [] },
    sections: {
      summary: "",
      why_it_matters: "",
      scope: { items: [], out_of_scope: [] },
      tasks: [],
      references: [],
      agent_notes: "",
      closure: null,
    },
    children: [],
    slices,
    escalations: [],
    projections: [],
    migration: null,
    initiative: "IN-0030",
  };
}

function request(overrides = {}) {
  return {
    unit: "WK-9298",
    shaping_mode: "redteam",
    title: "Standalone redteam",
    read_scope: ["AGENTS.md"],
    repo_paths: ["docs/work-record-schema.md"],
    acceptance: { criteria: ["Inspect only."], validation: ["node --test"] },
    ...overrides,
  };
}

test("ready-slice redteam shaping requires an explicitly authored standalone purpose", () => {
  const explicit = planWorkRecordReadySlice(parent(), request({ review_purpose: "standalone" }));
  assert.equal(explicit.ok, true, JSON.stringify(explicit.diagnostics));
  assert.equal(explicit.updatedRecord.slices[0].review_purpose, "standalone");

  const parentRecord = parent();
  const snapshot = structuredClone(parentRecord);
  const omitted = planWorkRecordReadySlice(parentRecord, request());
  assert.equal(omitted.ok, false);
  assert.equal(omitted.updatedRecord, null);
  assert.equal(omitted.diagnostics.length, 1);
  assert.equal(omitted.diagnostics[0].code, "ready_slice_missing_required_field");
  assert.equal(omitted.diagnostics[0].severity, "error");
  assert.equal(omitted.diagnostics[0].path, "review_purpose");
  assert.match(omitted.diagnostics[0].message, /"standalone"/u);
  assert.match(omitted.diagnostics[0].message, /retry/u);
  assert.deepEqual(parentRecord, snapshot);
});

test("ready-slice redteam update persists explicit standalone and refuses clearing it", () => {
  const created = planWorkRecordReadySlice(parent(), request({ review_purpose: "standalone" }));
  assert.equal(created.ok, true, JSON.stringify(created.diagnostics));
  const updated = planWorkRecordReadySlice(created.updatedRecord, {
    unit: "WK-9298",
    slice_id: "SLICE-001",
    shaping_mode: "redteam",
    review_purpose: "standalone",
  });
  assert.equal(updated.ok, true, JSON.stringify(updated.diagnostics));
  assert.equal(updated.updatedRecord.slices[0].review_purpose, "standalone");

  const legacy = parent([{
    ...created.updatedRecord.slices[0],
    review_purpose: undefined,
  }]);
  delete legacy.slices[0].review_purpose;
  const reshaped = planWorkRecordReadySlice(legacy, {
    unit: "WK-9298",
    slice_id: "SLICE-001",
    shaping_mode: "redteam",
    title: "Renamed standalone redteam",
  });
  assert.equal(reshaped.ok, false);
  assert.equal(reshaped.diagnostics[0].code, "ready_slice_missing_required_field");
  assert.equal(reshaped.diagnostics[0].path, "review_purpose");
});

test("an explicitly redteam-shaped update must carry the purpose in the request itself", () => {

  const created = planWorkRecordReadySlice(parent(), request({ review_purpose: "standalone" }));
  assert.equal(created.ok, true, JSON.stringify(created.diagnostics));
  const conforming = created.updatedRecord;
  assert.equal(conforming.slices[0].review_purpose, "standalone");

  const snapshot = structuredClone(conforming);
  const omitted = planWorkRecordReadySlice(conforming, {
    unit: "WK-9298",
    slice_id: "SLICE-001",
    shaping_mode: "redteam",
    title: "Renamed standalone redteam",
  });
  assert.equal(omitted.ok, false);
  assert.equal(omitted.updatedRecord, null);
  assert.equal(omitted.diagnostics.length, 1);
  assert.equal(omitted.diagnostics[0].code, "ready_slice_missing_required_field");
  assert.equal(omitted.diagnostics[0].severity, "error");
  assert.equal(omitted.diagnostics[0].path, "review_purpose");
  assert.match(omitted.diagnostics[0].message, /"standalone"/u);
  assert.deepEqual(conforming, snapshot);

  const restated = planWorkRecordReadySlice(conforming, {
    unit: "WK-9298",
    slice_id: "SLICE-001",
    shaping_mode: "redteam",
    review_purpose: "standalone",
    title: "Renamed standalone redteam",
  });
  assert.equal(restated.ok, true, JSON.stringify(restated.diagnostics));
  assert.equal(restated.updatedRecord.slices[0].review_purpose, "standalone");
  assert.equal(restated.updatedRecord.slices[0].title, "Renamed standalone redteam");

  const implicit = planWorkRecordReadySlice(conforming, {
    unit: "WK-9298",
    slice_id: "SLICE-001",
    title: "Implicitly shaped rename",
  });
  assert.equal(implicit.ok, true, JSON.stringify(implicit.diagnostics));
  assert.equal(implicit.updatedRecord.slices[0].review_purpose, "standalone");

  const incompatible = planWorkRecordReadySlice(conforming, {
    unit: "WK-9298",
    slice_id: "SLICE-001",
    shaping_mode: "redteam",
    review_purpose: "terminal_whole_wk",
  });
  assert.equal(incompatible.ok, false);
  assert.equal(incompatible.diagnostics[0].code, "ready_slice_review_purpose_incompatible");

  const createdAgain = planWorkRecordReadySlice(parent(), request({ review_purpose: "standalone" }));
  assert.equal(createdAgain.ok, true, JSON.stringify(createdAgain.diagnostics));
});

test("ready-slice keeps redteam terminal closed and other shaping behavior unchanged", () => {
  const terminal = planWorkRecordReadySlice(
    parent(),
    request({ review_purpose: "terminal_whole_wk" }),
  );
  assert.equal(terminal.ok, false);
  assert.equal(terminal.diagnostics[0].code, "ready_slice_review_purpose_incompatible");

  const reviewer = planWorkRecordReadySlice(parent(), request({
    shaping_mode: "reviewer",
  }));
  assert.equal(reviewer.ok, true, JSON.stringify(reviewer.diagnostics));
  assert.equal(reviewer.updatedRecord.slices[0].review_purpose, "standalone");

  const implementation = planWorkRecordReadySlice(parent(), request({
    shaping_mode: "implementation",
    review_purpose: "standalone",
    write_scope: ["feature.txt"],
    expected_edit_targets: [{
      path: "feature.txt", name: "feature", kind: "module", operation: "modify",
    }],
  }));
  assert.equal(implementation.ok, false);
  assert.equal(implementation.diagnostics[0].code, "ready_slice_review_purpose_incompatible");
});

test("ready-slice refuses a caller-authored findings role conflict without normalizing it", () => {
  for (const [shapingMode, role] of [["redteam", "reviewer"], ["reviewer", "redteam"]]) {
    const result = planWorkRecordReadySlice(parent(), request({
      shaping_mode: shapingMode,
      review_purpose: "standalone",
      dispatch_intent: {
        intended_agent_role: role,
        target_unit: "slice",
        requires_graph_impact: false,
        requires_escalation: false,
      },
    }));
    assert.equal(result.ok, false, `${shapingMode}/${role}`);
    assert.equal(result.diagnostics[0].code, "ready_slice_shaping_conflict");
    assert.equal(result.updatedRecord, null);
  }

  const workKindConflict = planWorkRecordReadySlice(parent(), request({
    shaping_mode: "redteam",
    review_purpose: "standalone",
    work_kind: "review",
  }));
  assert.equal(workKindConflict.ok, false);
  assert.equal(workKindConflict.diagnostics[0].code, "ready_slice_shaping_conflict");
});

test("raw slice upsert derives an omitted findings role and refuses an explicit conflict", () => {
  const record = parent();
  for (const [workKind, role] of [["redteam", "redteam"], ["review", "reviewer"]]) {
    const created = upsertSlice(record, {
      slice: {
        id: "SLICE-001",
        title: "Findings unit",
        work_kind: workKind,
        write_scope: [],
        acceptance: { criteria: ["Inspect only."], validation: ["node --test"] },
      },
    });
    assert.equal(created.ok, true, JSON.stringify(created.diagnostics));
    assert.equal(created.updatedRecord.slices[0].dispatch_intent.intended_agent_role, role);

    assert.equal(Object.hasOwn(created.updatedRecord.slices[0], "review_purpose"), false);
  }

  const implementation = upsertSlice(record, {
    slice: { id: "SLICE-001", title: "Implementation", work_kind: "implementation" },
  });
  assert.equal(implementation.ok, true, JSON.stringify(implementation.diagnostics));
  assert.equal(
    implementation.updatedRecord.slices[0].dispatch_intent.intended_agent_role,
    "worker",
  );

  const conflicted = upsertSlice(record, {
    slice: {
      id: "SLICE-001",
      title: "Contradictory findings unit",
      work_kind: "redteam",
      write_scope: [],
      acceptance: { criteria: ["Inspect only."], validation: ["node --test"] },
      dispatch_intent: {
        intended_agent_role: "worker",
        target_unit: "slice",
        requires_graph_impact: false,
        requires_escalation: false,
      },
    },
  });
  assert.equal(conflicted.ok, false);
  assert.equal(conflicted.updatedRecord, null);
  assert.equal(conflicted.diagnostics[0].code, "findings_role_conflict");
  assert.equal(conflicted.diagnostics[0].path, "slice.dispatch_intent.intended_agent_role");
});

test("raw slice upsert never repairs a legacy contradiction and fails loud on it", () => {
  const legacy = parent([{
    id: "SLICE-001",
    title: "Legacy contradictory findings unit",
    work_kind: "review",
    status: "todo",
    priority: "medium",
    owner: "unassigned",
    depends_on: [],
    read_scope: ["AGENTS.md"],
    repo_paths: ["docs/work-record-schema.md"],
    write_scope: [],
    dispatch_intent: {
      intended_agent_role: "worker",
      target_unit: "slice",
      requires_graph_impact: false,
      requires_escalation: false,
    },
    acceptance: { criteria: ["Inspect only."], validation: ["node --test"] },
  }]);
  const snapshot = structuredClone(legacy);

  const renamed = upsertSlice(legacy, { slice: { id: "SLICE-001", title: "Renamed" } });
  assert.equal(renamed.ok, false);
  assert.equal(renamed.updatedRecord, null);
  const conflict = renamed.diagnostics.find(
    (entry) => entry.path === "slices[0].dispatch_intent.intended_agent_role",
  );
  assert.ok(conflict, JSON.stringify(renamed.diagnostics));
  assert.equal(conflict.severity, "error");
  assert.deepEqual(legacy, snapshot);
});
