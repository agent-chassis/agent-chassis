import test from "node:test";
import assert from "node:assert/strict";

import { summarizeWorkRecord } from "./work-record-summary.mjs";

function terminalRecord(status) {
  return {
    id: "WK-1836",
    record_kind: "work_item",
    work_kind: "implementation",
    status,
    depends_on: ["WK-0537"],
    acceptance: { validation: ["npm test"] },
    slices: [{ id: "SLICE-001", work_kind: "review", status: "todo" }]
  };
}

test("record-scope terminal status precedes blockers, review, and validation", () => {
  for (const status of ["done", "cancelled"]) {
    const summary = summarizeWorkRecord(terminalRecord(status));

    assert.equal(summary.next_action, "close out");
    assert.deepEqual(summary.blockers, [
      {
        kind: "depends_on",
        source: "depends_on",
        resolution: "unresolved",
        entry: { id: "WK-0537", marker: "unresolved", selected_status: null }
      }
    ]);
    assert.equal(summary.review_state.status, "open");
    assert.deepEqual(summary.validation, ["npm test"]);
  }
});

function dependencyRecord(status, id = "WK-0537") {
  return { id, record_kind: "work_item", status };
}

test("done dependency is satisfied and excluded from blockers", () => {
  const summary = summarizeWorkRecord(
    { id: "WK-1836", status: "active", depends_on: ["WK-0537"] },
    { dependencyResolver: () => dependencyRecord("done") }
  );

  assert.deepEqual(summary.blockers, []);
});

test("open dependency remains an unsatisfied blocker", () => {
  const summary = summarizeWorkRecord(
    { id: "WK-1836", status: "active", depends_on: ["WK-0537"] },
    { dependencyResolver: () => dependencyRecord("active") }
  );

  assert.equal(summary.blockers[0].resolution, "unsatisfied_open");
  assert.equal(summary.blockers[0].entry.marker, "unsatisfied");
  assert.equal(summary.blockers[0].entry.selected_status, "active");
});

test("cancelled dependency remains a distinct blocker", () => {
  const summary = summarizeWorkRecord(
    { id: "WK-1836", status: "active", depends_on: ["WK-0537"] },
    { dependencyResolver: () => dependencyRecord("cancelled") }
  );

  assert.equal(summary.blockers[0].resolution, "cancelled");
  assert.equal(summary.blockers[0].entry.marker, "cancelled");
});

test("same-record dependencies resolve without a resolver", () => {
  const summary = summarizeWorkRecord({
    id: "WK-1836",
    status: "active",
    depends_on: ["WK-1836#SLICE-001"],
    slices: [{ id: "SLICE-001", status: "done" }]
  });

  assert.deepEqual(summary.blockers, []);
});

test("slice-scope done dependency is excluded for bare and qualified addresses", () => {
  const baseRecord = {
    id: "WK-1836",
    status: "active",
    slices: [
      { id: "SLICE-001", status: "active", depends_on: ["SLICE-009"] },
      { id: "SLICE-009", status: "done" }
    ]
  };
  const bare = summarizeWorkRecord(baseRecord, {
    unit: { kind: "slice", slice_id: "SLICE-001" }
  });
  const qualified = summarizeWorkRecord({
    ...baseRecord,
    slices: [
      { id: "SLICE-001", status: "active", depends_on: ["WK-1836#SLICE-009"] },
      { id: "SLICE-009", status: "done" }
    ]
  }, {
    unit: { kind: "slice", slice_id: "SLICE-001" }
  });

  assert.deepEqual(bare.selected_unit_summary.blockers, []);
  assert.deepEqual(qualified.selected_unit_summary.blockers, []);
});

test("slice-scope cancelled dependency remains a distinct blocker", () => {
  const summary = summarizeWorkRecord({
    id: "WK-1836",
    status: "active",
    slices: [
      { id: "SLICE-001", status: "active", depends_on: ["SLICE-009"] },
      { id: "SLICE-009", status: "cancelled" }
    ]
  }, { unit: { kind: "slice", slice_id: "SLICE-001" } });

  assert.deepEqual(summary.selected_unit_summary.blockers, [{
    kind: "depends_on",
    source: "depends_on",
    resolution: "cancelled",
    entry: { id: "SLICE-009", marker: "cancelled", selected_status: "cancelled" }
  }]);
});

test("unresolvable slice-scope dependency remains a blocker", () => {
  const summary = summarizeWorkRecord({
    id: "WK-1836",
    status: "active",
    slices: [
      { id: "SLICE-001", status: "active", depends_on: ["SLICE-999"] }
    ]
  }, { unit: { kind: "slice", slice_id: "SLICE-001" } });

  assert.deepEqual(summary.selected_unit_summary.blockers, [{
    kind: "depends_on",
    source: "depends_on",
    resolution: "unresolved",
    entry: { id: "SLICE-999", marker: "unresolved", selected_status: null }
  }]);
});

test("slice-scope open dependency retains its selected status and unsatisfied marker", () => {
  const summary = summarizeWorkRecord({
    id: "WK-1836",
    status: "active",
    slices: [
      { id: "SLICE-001", work_kind: "implementation", status: "active", depends_on: ["SLICE-009"] },
      { id: "SLICE-009", status: "active" }
    ]
  }, { unit: { kind: "slice", slice_id: "SLICE-001" } });

  assert.deepEqual(summary.selected_unit_summary.blockers, [{
    kind: "depends_on",
    source: "depends_on",
    resolution: "unsatisfied_open",
    entry: { id: "SLICE-009", marker: "unsatisfied", selected_status: "active" }
  }]);
});

test("slice-scope all-done dependencies clear blockers and continue work", () => {
  const summary = summarizeWorkRecord({
    id: "WK-1836",
    status: "active",
    slices: [
      {
        id: "SLICE-005",
        work_kind: "implementation",
        status: "active",
        depends_on: ["SLICE-002", "SLICE-003", "SLICE-004"]
      },
      { id: "SLICE-002", status: "done" },
      { id: "SLICE-003", status: "done" },
      { id: "SLICE-004", status: "done" }
    ]
  }, { unit: { kind: "slice", slice_id: "SLICE-005" } });

  assert.deepEqual(summary.selected_unit_summary.blockers, []);
  assert.notEqual(summary.selected_unit_summary.next_action, "resolve blockers");
});

test("slice-scope dependencies continue after a satisfied edge", () => {
  const summary = summarizeWorkRecord({
    id: "WK-1836",
    status: "active",
    slices: [
      {
        id: "SLICE-005",
        work_kind: "implementation",
        status: "active",
        depends_on: ["SLICE-002", "SLICE-003", "SLICE-004"]
      },
      { id: "SLICE-002", status: "done" },
      { id: "SLICE-003", status: "active" },
      { id: "SLICE-004", status: "done" }
    ]
  }, { unit: { kind: "slice", slice_id: "SLICE-005" } });

  assert.deepEqual(summary.selected_unit_summary.blockers, [{
    kind: "depends_on",
    source: "depends_on",
    resolution: "unsatisfied_open",
    entry: { id: "SLICE-003", marker: "unsatisfied", selected_status: "active" }
  }]);
});

test("record-level escalation blockers preserve shape, ordering, and precedence", () => {
  const summary = summarizeWorkRecord(
    {
      id: "WK-1836",
      status: "active",
      depends_on: ["WK-0537"],
      escalations: [
        { id: "ESC-OPEN", kind: "risk", status: "open", reason: "open risk" },
        { id: "ESC-ACCEPTED", kind: "scope", status: "accepted", reason: "accepted scope" }
      ],
      slices: [
        { id: "SLICE-001", work_kind: "implementation", status: "active", depends_on: ["SLICE-009"] },
        { id: "SLICE-009", status: "done" }
      ]
    },
    {
      unit: { kind: "slice", slice_id: "SLICE-001" },
      dependencyResolver: () => ({ id: "WK-0537", status: "active" })
    }
  );

  assert.deepEqual(summary.blockers, [
    {
      kind: "open_escalation",
      source: "escalations",
      entry: {
        id: "ESC-OPEN",
        kind: "risk",
        status: "open",
        reason: "open risk",
        requested_by: null,
        accepted_by: null
      }
    },
    {
      kind: "accepted_escalation",
      source: "escalations",
      entry: {
        id: "ESC-ACCEPTED",
        kind: "scope",
        status: "accepted",
        reason: "accepted scope",
        requested_by: null,
        accepted_by: null
      }
    },
    {
      kind: "depends_on",
      source: "depends_on",
      resolution: "unsatisfied_open",
      entry: { id: "WK-0537", marker: "unsatisfied", selected_status: "active" }
    }
  ]);
  assert.deepEqual(summary.selected_unit_summary.blockers, []);
});

test("missing, mismatched, and throwing resolvers remain unresolved", () => {
  const missing = summarizeWorkRecord({
    id: "WK-1836", status: "active", depends_on: ["WK-0537"]
  });
  const mismatch = summarizeWorkRecord(
    { id: "WK-1836", status: "active", depends_on: ["WK-0537"] },
    { dependencyResolver: () => dependencyRecord("done", "WK-9999") }
  );
  const throwing = summarizeWorkRecord(
    { id: "WK-1836", status: "active", depends_on: ["WK-0537"] },
    { dependencyResolver: () => { throw new Error("resolver failed"); } }
  );

  for (const summary of [missing, mismatch, throwing]) {
    assert.equal(summary.blockers[0].resolution, "unresolved");
    assert.equal(summary.blockers[0].entry.marker, "unresolved");
    assert.equal(summary.blockers[0].entry.selected_status, null);
  }
});

test("slice evidence requires the addressed slice to exist", () => {
  const summary = summarizeWorkRecord(
    { id: "WK-1836", status: "active", depends_on: ["WK-0537#SLICE-999"] },
    { dependencyResolver: () => dependencyRecord("done") }
  );

  assert.equal(summary.blockers[0].resolution, "unresolved");
});

test("slice-scope blocker precedence remains unchanged", () => {
  const summary = summarizeWorkRecord(
    {
      id: "WK-1836",
      record_kind: "work_item",
      status: "active",
      slices: [
        {
          id: "SLICE-002",
          work_kind: "review",
          status: "active",
          depends_on: ["WK-0537"]
        }
      ]
    },
    { unit: { kind: "slice", slice_id: "SLICE-002" } }
  );

  assert.equal(summary.selected_unit_summary.next_action, "resolve blockers");
  assert.equal(summary.selected_unit_summary.next_action, "resolve blockers");
});
