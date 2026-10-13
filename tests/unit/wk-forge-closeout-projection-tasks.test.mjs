import test from "node:test";
import assert from "node:assert/strict";

import { authenticateWkCloseoutProjection } from
  "../../packages/agent-launch-cli/src/lib/wk-forge-handoff-recovery.mjs";
import { planWorkRecordTaskEdit } from "../../packages/wiki-core/src/operations/work-records-edits.mjs";
import { closeoutSectionsDriftFields, closeoutSliceDriftFields, sectionsDriftGuidance } from
  "../../packages/wiki-mcp/src/lib/dispatch-tools/forge-handoff-drift-guidance.mjs";

const WK = "WK-2738";
const task = (text, status = "todo") => ({ text, status });

function candidateRecord() {
  return {
    id: WK,
    status: "review",
    updated: "2026-10-01",
    title: "t",
    acceptance: { criteria: ["c"], validation: ["v"] },
    sections: { summary: "s", scope: { items: ["a"], out_of_scope: [] },
      tasks: [task("first"), task("second"), task("third", "done")], agent_notes: "" },
    slices: [
      { id: "SLICE-001", work_kind: "implementation", status: "done", title: "delivered",
        updated: "2026-10-01", write_scope: ["src/a.mjs"],
        sections: { summary: "x", tasks: [task("slice task")] } },
      { id: "SLICE-002", title: "review", work_kind: "review", review_purpose: "terminal_whole_wk",
        status: "todo", updated: "2026-10-01", write_scope: [],
        dispatch_intent: { intended_agent_role: "reviewer", target_unit: "slice" },
        sections: { tasks: [task("review task")] } }
    ]
  };
}

function edited(mutate, base = candidateRecord()) {
  const record = structuredClone(base);
  record.updated = "2026-10-11";
  mutate(record);
  return record;
}

function markDone(record, index, sliceId = null) {
  const unit = sliceId === null ? { kind: "record" } : { kind: "slice", slice_id: sliceId };
  const planned = planWorkRecordTaskEdit(record, unit, { action: "mark_done", index });
  assert.equal(planned.kind, "planned", JSON.stringify(planned));
  return { ...planned.updatedRecord, updated: "2026-10-11" };
}

const authenticate = (liveRecord, { candidate = candidateRecord(), published = null } = {}) =>
  authenticateWkCloseoutProjection({ candidateRecord: candidate, liveRecord, publishedRecord: published });

const completion = (index, prefix = "sections.tasks") =>
  ({ path: `${prefix}[${index}].status`, change: "task_completion", candidate_value: "todo", observed_value: "done" });
const unsupported = (path, candidate_value, observed_value) =>
  ({ path, change: "unsupported", candidate_value, observed_value });
const drift = (fields, differences, permitted = []) => ({
  ok: false, reason: "unrelated_sections_drift", unit: WK, fields,
  ...(permitted.length === 0 ? {} : { permitted_task_completions: permitted }), differences
});

test("a parent task the canonical writer marked done is carried, and counts as the closeout change", () => {
  const live = markDone(candidateRecord(), 0);
  const before = structuredClone(live);
  const result = authenticate(live);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.completed_tasks, [{ unit: WK, paths: ["sections.tasks[0].status"] }]);
  assert.deepEqual(result.closed_slice_ids, []);
  assert.equal(result.closeoutRecord, live, "the observed live record is carried, never rebuilt");
  assert.deepEqual(live, before, "nothing is restored into the carried record");
  assert.deepEqual(live.sections.tasks, [task("first", "done"), task("second"), task("third", "done")],
    "identity, text and order with the live completion state");

  const both = markDone(live, 1);
  assert.deepEqual(authenticate(both).completed_tasks,
    [{ unit: WK, paths: ["sections.tasks[0].status", "sections.tasks[1].status"] }]);

  assert.deepEqual(authenticate(structuredClone(candidateRecord())).completed_tasks, []);
  assert.deepEqual(authenticate(edited(() => {})), { ok: false, reason: "updated_delta" });
});

test("completion on a slice C holds is carried with the writer's moved date and is never a slice closeout", () => {
  const implementation = markDone(candidateRecord(), 0, "SLICE-001");
  implementation.slices[0].updated = "2026-10-11";
  const result = authenticate(implementation);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.completed_tasks, [{ unit: `${WK}#SLICE-001`, paths: ["sections.tasks[0].status"] }]);
  assert.deepEqual(result.closed_slice_ids, []);

  const review = markDone(candidateRecord(), 0, "SLICE-002");
  assert.deepEqual(authenticate(review).completed_tasks,
    [{ unit: `${WK}#SLICE-002`, paths: ["sections.tasks[0].status"] }]);

  const sliceDrift = (fields, differences) => ({
    ok: false, reason: "unrelated_slice_drift", slice_id: "SLICE-001", cause: "unsupported_change", fields,
    permitted_task_completions: ["sections.tasks[0].status"], differences
  });
  const widened = structuredClone(implementation);
  widened.slices[0].write_scope = ["src/**"];
  assert.deepEqual(authenticate(widened), sliceDrift(["write_scope"],
    [unsupported("write_scope", ["src/a.mjs"], ["src/**"]), completion(0)]));

  const rewritten = structuredClone(implementation);
  rewritten.slices[0].sections.tasks[0].text = "another slice task";
  assert.deepEqual(authenticate(rewritten), sliceDrift(["sections.tasks[0].text"], [
    { path: "updated", change: "moved_date", candidate_value: "2026-10-01", observed_value: "2026-10-11" },
    completion(0), unsupported("sections.tasks[0].text", "slice task", "another slice task")]));
  const summarized = structuredClone(candidateRecord());
  summarized.updated = "2026-10-11";
  summarized.slices[0].sections.summary = "rewritten";
  assert.deepEqual(authenticate(summarized), { ok: false, reason: "unrelated_slice_drift", slice_id: "SLICE-001",
    cause: "unsupported_change", fields: ["sections.summary"],
    differences: [unsupported("sections.summary", "x", "rewritten")] });

  const added = edited((record) => {
    record.slices.push({ ...structuredClone(record.slices[0]), id: "SLICE-003" });
  });
  assert.deepEqual(authenticate(added), { ok: false, reason: "slice_cardinality", slice_id: "SLICE-003" });
});

test("every other task change is drift by its exact path and values, including beside a completion", () => {
  const done = () => markDone(candidateRecord(), 0);
  const cases = [
    ["a rewrite beside a completion", (record) => { record.sections.tasks[1].text = "rewritten"; },
      drift(["sections.tasks[1].text"], [completion(0), unsupported("sections.tasks[1].text", "second", "rewritten")],
        ["sections.tasks[0].status"])],
    ["the completed task itself rewritten", (record) => { record.sections.tasks[0].text = "rewritten"; },
      drift(["sections.tasks[0].text"], [completion(0), unsupported("sections.tasks[0].text", "first", "rewritten")],
        ["sections.tasks[0].status"])],
    ["a completed task reopened", (record) => { record.sections.tasks[2].status = "todo"; },
      drift(["sections.tasks[2].status"], [completion(0), unsupported("sections.tasks[2].status", "done", "todo")],
        ["sections.tasks[0].status"])],
    ["a status the writer never writes", (record) => { record.sections.tasks[1].status = "cancelled"; },
      drift(["sections.tasks[1].status"], [completion(0), unsupported("sections.tasks[1].status", "todo", "cancelled")],
        ["sections.tasks[0].status"])],
    ["an added member", (record) => { record.sections.tasks[0].owner = "someone"; },
      drift(["sections.tasks[0].owner"], [unsupported("sections.tasks[0].owner", null, "someone"), completion(0)],
        ["sections.tasks[0].status"])],
    ["an appended task", (record) => { record.sections.tasks.push(task("fourth")); },
      drift(["sections.tasks[3]"], [completion(0), unsupported("sections.tasks[3]", null, task("fourth"))],
        ["sections.tasks[0].status"])],
    ["a removed task", (record) => { record.sections.tasks.pop(); },
      drift(["sections.tasks[2]"], [completion(0), unsupported("sections.tasks[2]", task("third", "done"), null)],
        ["sections.tasks[0].status"])],
    ["reordered tasks", (record) => { record.sections.tasks.reverse(); }, drift(
      ["sections.tasks[0].text", "sections.tasks[2].text"],
      [completion(0), unsupported("sections.tasks[0].text", "first", "third"),
        unsupported("sections.tasks[2].text", "third", "first")],
      ["sections.tasks[0].status"])],
    ["a task replaced by a non-object", (record) => { record.sections.tasks[1] = "second"; },
      drift(["sections.tasks[1]"], [completion(0), unsupported("sections.tasks[1]", task("second"), "second")],
        ["sections.tasks[0].status"])],
    ["tasks removed whole", (record) => { delete record.sections.tasks; },
      drift(["sections.tasks"], [unsupported("sections.tasks", candidateRecord().sections.tasks, null)])]
  ];
  for (const [label, mutate, expected] of cases) {
    const live = done();
    mutate(live);
    const before = structuredClone(live);
    assert.deepEqual(authenticate(live), expected, label);
    assert.deepEqual(live, before, `${label}: the live record is untouched`);
  }
});

test("unrelated section drift names each path and compared value, with a compared completion listed apart", () => {
  const cases = [
    ["summary", (record) => { record.sections.summary = "rewritten"; },
      drift(["sections.summary"], [unsupported("sections.summary", "s", "rewritten")])],
    ["a nested scope member", (record) => { record.sections.scope.items.push("b"); },
      drift(["sections.scope.items"], [unsupported("sections.scope.items", ["a"], ["a", "b"])])],
    ["an added section", (record) => { record.sections.material_refs = [{ ref: "r" }]; },
      drift(["sections.material_refs"], [unsupported("sections.material_refs", null, [{ ref: "r" }])])],
    ["a non-canonical first closure", (record) => { record.sections.closure = { summary: "x" }; },
      drift(["sections.closure"], [unsupported("sections.closure", null, { summary: "x" })])],
    ["several sections at once", (record) => {
      record.sections.summary = "rewritten";
      record.sections.scope.out_of_scope = ["z"];
    }, drift(["sections.scope.out_of_scope", "sections.summary"], [
      unsupported("sections.scope.out_of_scope", [], ["z"]), unsupported("sections.summary", "s", "rewritten")])]
  ];
  for (const [label, mutate, expected] of cases) {
    assert.deepEqual(authenticate(edited(mutate)), expected, label);
  }

  const live = markDone(candidateRecord(), 1);
  live.sections.summary = "rewritten";
  assert.deepEqual(authenticate(live), drift(["sections.summary"],
    [unsupported("sections.summary", "s", "rewritten"), completion(1)], ["sections.tasks[1].status"]));

  const acceptance = markDone(candidateRecord(), 0);
  acceptance.acceptance.criteria = ["relaxed"];
  assert.deepEqual(authenticate(acceptance),
    { ok: false, reason: "unrelated_record_drift", fields: ["acceptance.criteria"] });
});

test("a refresh keeps every task the published closeout completed and carries later completions", () => {
  const published = markDone(candidateRecord(), 0);
  const later = markDone(published, 1);
  const result = authenticate(later, { published });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.completed_tasks,
    [{ unit: WK, paths: ["sections.tasks[0].status", "sections.tasks[1].status"] }]);
  assert.equal(authenticate(structuredClone(published), { published }).ok, true, "the published content again");

  const reopened = edited((record) => { record.sections.agent_notes = "note"; });
  assert.equal(authenticate(reopened).ok, true, "admitted against C alone");
  assert.deepEqual(authenticate(reopened, { published }),
    { ok: false, reason: "published_closeout_drift", unit: WK, field: "sections.tasks[0].status" });

  const publishedSlice = markDone(candidateRecord(), 0, "SLICE-001");
  assert.deepEqual(authenticate(reopened, { published: publishedSlice }), {
    ok: false, reason: "published_closeout_drift", unit: `${WK}#SLICE-001`, field: "sections.tasks[0].status"
  });
});

test("a second closing slice, and members that do not form a closeout, are named as the cause", () => {
  const CLOSURE = { summary: "closed", validation: [], follow_ups: [] };
  const candidate = candidateRecord();
  candidate.slices[0].status = "review";
  candidate.slices.splice(1, 0, { ...structuredClone(candidate.slices[0]), id: "SLICE-003",
    sections: { summary: "y" } });
  const close = (slice) => Object.assign(slice, { status: "done", updated: "2026-10-11",
    sections: { ...slice.sections, closure: CLOSURE } });
  const one = edited((record) => { close(record.slices[0]); }, candidate);
  assert.deepEqual(authenticate(one, { candidate }).closed_slice_ids, ["SLICE-001"]);
  const two = edited((record) => { close(record.slices[0]); close(record.slices[1]); }, candidate);
  assert.deepEqual(authenticate(two, { candidate }), {
    ok: false, reason: "unrelated_slice_drift", slice_id: "SLICE-003", cause: "another_slice_closes",
    fields: ["status", "updated", "sections.closure"], closing_slice_id: "SLICE-001",
    differences: [
      { path: "status", change: "slice_closeout", candidate_value: "review", observed_value: "done" },
      { path: "updated", change: "moved_date", candidate_value: "2026-10-01", observed_value: "2026-10-11" },
      { path: "sections.closure", change: "slice_closeout", candidate_value: null, observed_value: CLOSURE }]
  });

  const closureOnly = edited((record) => { record.slices[0].sections.closure = CLOSURE; }, candidate);
  assert.deepEqual(authenticate(closureOnly, { candidate }), {
    ok: false, reason: "unrelated_slice_drift", slice_id: "SLICE-001", cause: "not_a_slice_closeout",
    fields: ["sections.closure"], differences: [
      { path: "sections.closure", change: "slice_closeout", candidate_value: null, observed_value: CLOSURE }]
  });
});

test("slice drift guidance reads the slice only for an unsupported change", () => {
  const refusal = { category: "eligibility" };
  const detail = (projection) => ({ stage: "closeout", reason: "local_WK_not_authenticated_against_candidate",
    projection });
  const slice = { reason: "unrelated_slice_drift", slice_id: "SLICE-001", cause: "unsupported_change",
    fields: ["write_scope"] };
  assert.deepEqual(closeoutSliceDriftFields(refusal, detail(slice)), { slice_id: "SLICE-001", fields: ["write_scope"] });
  for (const [label, other] of [
    ["a second closing slice", { ...slice, cause: "another_slice_closes", closing_slice_id: "SLICE-002" }],
    ["members that form no closeout", { ...slice, cause: "not_a_slice_closeout" }],
    ["no named path", { ...slice, fields: [] }],
    ["no slice identity", { ...slice, slice_id: "elsewhere" }]
  ]) {
    assert.equal(closeoutSliceDriftFields(refusal, detail(other)), null, label);
    assert.equal(sectionsDriftGuidance({ refusal, detail: detail(other), assignedUnit: WK, code: "c",
      decidingFacts: [], observedFacts: {}, carried: null, requestSchemaAuthority: null }), null, label);
  }
  const unavailable = sectionsDriftGuidance({ refusal, detail: detail(slice), assignedUnit: WK, code: "c",
    decidingFacts: [], observedFacts: {}, carried: null, requestSchemaAuthority: null });
  assert.equal(unavailable.recovery.responsible_actor, "coordinator");
  assert.match(unavailable.recovery.prerequisite, new RegExp(`slice ${WK}#SLICE-001 of the live WK record`, "u"));
  assert.match(unavailable.recovery.retry_condition, /slice_drift\.differences candidate_value/u);
});

test("sections drift guidance is selected only from the executor's exact named paths", () => {
  const refusal = { category: "eligibility" };
  const detail = (projection) => ({ stage: "closeout", reason: "local_WK_not_authenticated_against_candidate",
    projection });
  const named = detail({ reason: "unrelated_sections_drift", unit: WK, fields: ["sections.summary"] });
  assert.deepEqual(closeoutSectionsDriftFields(refusal, named, WK), ["sections.summary"]);
  for (const [label, other, unit] of [
    ["another unit", named, "WK-0001"],
    ["no named path", detail({ reason: "unrelated_sections_drift", unit: WK, fields: [] }), WK],
    ["a bare label", detail({ reason: "unrelated_sections_drift" }), WK],
    ["record drift", detail({ reason: "unrelated_record_drift", unit: WK, fields: ["owner"] }), WK],
    ["another stage", { ...named, stage: "landing" }, WK]
  ]) {
    assert.equal(closeoutSectionsDriftFields(refusal, other, unit), null, label);
    assert.equal(sectionsDriftGuidance({ refusal, detail: other, assignedUnit: unit, code: "c",
      decidingFacts: [], observedFacts: {}, carried: null, requestSchemaAuthority: null }), null, label);
  }

  const unavailable = sectionsDriftGuidance({ refusal, detail: named, assignedUnit: WK, code: "c",
    decidingFacts: [], observedFacts: {}, carried: null, requestSchemaAuthority: null });
  assert.equal(Object.hasOwn(unavailable, "refusal"), false);
  assert.deepEqual(unavailable.unavailable.missing, ["registrar_request_schema_authority"]);
  assert.equal(unavailable.recovery.responsible_actor, "coordinator");
  assert.match(unavailable.recovery.explanation, /Publication restored nothing into the live record/u);
  assert.doesNotMatch(JSON.stringify(unavailable.recovery), /workspace_(inspect|advance)_candidate/u);
});
