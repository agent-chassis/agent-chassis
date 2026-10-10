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
    depends_on: [],
    read_scope: ["AGENTS.md"],
    repo_paths: ["docs/work-record-schema.md"],
    write_scope: [],
    acceptance: { criteria: ["Inspect only."], validation: ["node --test"] },
    ...overrides,
  };
}

test("ready-slice redteam creation derives and persists the standalone purpose", () => {

  const parentRecord = parent();
  const snapshot = structuredClone(parentRecord);
  const derived = planWorkRecordReadySlice(parentRecord, request());
  assert.equal(derived.ok, true, JSON.stringify(derived.diagnostics));
  assert.equal(derived.updatedRecord.slices[0].review_purpose, "standalone");
  assert.equal(derived.updatedRecord.slices[0].work_kind, "redteam");
  assert.equal(derived.updatedRecord.slices[0].dispatch_intent.intended_agent_role, "redteam");
  assert.equal(Object.hasOwn(derived.updatedRecord, "completion_policy"), false);
  assert.deepEqual(derived.allowedPersistedPrefixes, ["slices[0]"]);
  assert.deepEqual(parentRecord, snapshot);

  const explicit = planWorkRecordReadySlice(parent(), request({ review_purpose: "standalone" }));
  assert.equal(explicit.ok, true, JSON.stringify(explicit.diagnostics));
  assert.deepEqual(explicit.updatedRecord, derived.updatedRecord);
});

test("explicit redteam reshaping derives the purpose and ordinary updates preserve it", () => {
  const created = planWorkRecordReadySlice(parent(), request());
  assert.equal(created.ok, true, JSON.stringify(created.diagnostics));
  const conforming = created.updatedRecord;

  const renamed = planWorkRecordReadySlice(conforming, {
    unit: "WK-9298",
    slice_id: "SLICE-001",
    shaping_mode: "redteam",
    title: "Renamed standalone redteam",
  });
  assert.equal(renamed.ok, true, JSON.stringify(renamed.diagnostics));
  assert.equal(renamed.updatedRecord.slices[0].review_purpose, "standalone");
  assert.equal(renamed.updatedRecord.slices[0].title, "Renamed standalone redteam");
  assert.deepEqual(renamed.changedFields, ["slices[SLICE-001].title"]);

  const restated = planWorkRecordReadySlice(conforming, {
    unit: "WK-9298",
    slice_id: "SLICE-001",
    shaping_mode: "redteam",
    review_purpose: "standalone",
    title: "Renamed standalone redteam",
  });
  assert.equal(restated.ok, true, JSON.stringify(restated.diagnostics));
  assert.deepEqual(restated.updatedRecord, renamed.updatedRecord);

  const purposeless = parent([structuredClone(conforming.slices[0])]);
  delete purposeless.slices[0].review_purpose;
  const reshaped = planWorkRecordReadySlice(purposeless, {
    unit: "WK-9298",
    slice_id: "SLICE-001",
    shaping_mode: "redteam",
  });
  assert.equal(reshaped.ok, true, JSON.stringify(reshaped.diagnostics));
  assert.equal(reshaped.updatedRecord.slices[0].review_purpose, "standalone");
  assert.deepEqual(reshaped.changedFields, ["slices[SLICE-001].review_purpose"]);

  const ordinary = planWorkRecordReadySlice(conforming, {
    unit: "WK-9298",
    slice_id: "SLICE-001",
    title: "Implicitly shaped rename",
  });
  assert.equal(ordinary.ok, true, JSON.stringify(ordinary.diagnostics));
  assert.equal(ordinary.shapingMode, "redteam");
  assert.equal(ordinary.updatedRecord.slices[0].review_purpose, "standalone");
  assert.deepEqual(ordinary.changedFields, ["slices[SLICE-001].title"]);

  const purposelessSnapshot = structuredClone(purposeless);
  const unselected = planWorkRecordReadySlice(purposeless, {
    unit: "WK-9298",
    slice_id: "SLICE-001",
    title: "Implicitly shaped rename",
  });
  assert.equal(unselected.ok, false);
  assert.equal(unselected.updatedRecord, null);
  assert.equal(unselected.diagnostics.length, 1);
  assert.equal(unselected.diagnostics[0].code, "ready_slice_missing_required_field");
  assert.equal(unselected.diagnostics[0].path, "review_purpose");
  assert.match(unselected.diagnostics[0].message, /retry the same authoring call with shaping_mode: "redteam"/u);
  assert.doesNotMatch(unselected.diagnostics[0].message, /explicitly authored/u);
  assert.deepEqual(purposeless, purposelessSnapshot);

  const retried = planWorkRecordReadySlice(purposeless, {
    unit: "WK-9298",
    slice_id: "SLICE-001",
    shaping_mode: "redteam",
    title: "Implicitly shaped rename",
  });
  assert.equal(retried.ok, true, JSON.stringify(retried.diagnostics));
  assert.equal(retried.updatedRecord.slices[0].review_purpose, "standalone");
  assert.equal(retried.updatedRecord.slices[0].title, "Implicitly shaped rename");
});

test("redteam shaping refuses a contradictory purpose, role, or work kind without changing the record", () => {
  const created = planWorkRecordReadySlice(parent(), request());
  assert.equal(created.ok, true, JSON.stringify(created.diagnostics));
  const reshape = (overrides) => ({
    unit: "WK-9298", slice_id: "SLICE-001", shaping_mode: "redteam", ...overrides,
  });
  const reviewerIntent = {
    intended_agent_role: "reviewer",
    target_unit: "slice",
    requires_graph_impact: false,
    requires_escalation: false,
  };
  const cases = [
    ["terminal purpose", { review_purpose: "terminal_whole_wk" },
      "ready_slice_review_purpose_incompatible", "review_purpose"],
    ["invalid purpose", { review_purpose: "adversarial" }, "ready_slice_invalid_field", "review_purpose"],
    ["conflicting work_kind", { work_kind: "review" }, "ready_slice_shaping_conflict", "work_kind"],
    ["conflicting role", { dispatch_intent: reviewerIntent }, "ready_slice_shaping_conflict", "dispatch_intent"],
  ];
  for (const [name, overrides, code, path] of cases) {
    for (const [record, build] of [
      [parent(), () => request(overrides)],
      [created.updatedRecord, () => reshape(overrides)],
    ]) {
      const snapshot = structuredClone(record);
      const refused = planWorkRecordReadySlice(record, build());
      assert.equal(refused.ok, false, name);
      assert.equal(refused.updatedRecord, null, name);
      assert.equal(refused.diagnostics.length, 1, name);
      assert.equal(refused.diagnostics[0].code, code, name);
      assert.equal(refused.diagnostics[0].path, path, name);
      assert.deepEqual(record, snapshot, name);
    }
  }
});

test("terminal whole-WK review stays an explicit reviewer choice that redteam shaping never selects", () => {
  const policy = "forge_confirmed_merge";
  const terminal = planWorkRecordReadySlice(parent(), request({
    shaping_mode: "reviewer", review_purpose: "terminal_whole_wk", completion_policy: policy,
  }));
  assert.equal(terminal.ok, true, JSON.stringify(terminal.diagnostics));
  assert.equal(terminal.updatedRecord.slices[0].review_purpose, "terminal_whole_wk");
  assert.equal(terminal.updatedRecord.completion_policy, policy);

  const redteamPolicy = planWorkRecordReadySlice(parent(), request({ completion_policy: policy }));
  assert.equal(redteamPolicy.ok, false);
  assert.equal(redteamPolicy.diagnostics[0].code, "ready_slice_completion_policy_incompatible");

  const beside = planWorkRecordReadySlice(terminal.updatedRecord, request());
  assert.equal(beside.ok, true, JSON.stringify(beside.diagnostics));
  assert.deepEqual(beside.updatedRecord.slices[0], terminal.updatedRecord.slices[0]);
  assert.equal(beside.updatedRecord.slices[1].review_purpose, "standalone");
  assert.equal(beside.updatedRecord.completion_policy, policy);
  assert.deepEqual(beside.allowedPersistedPrefixes, ["slices[1]"]);
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
