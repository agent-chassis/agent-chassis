

import assert from "node:assert/strict";
import test from "node:test";

import { buildSliceDagProjection } from "../packages/wiki-core/src/lib/work-record-dispatch-slice-dag.mjs";

function makeRecord(slices, overrides = {}) {
  return {
    schema_version: "work-record.v1",
    id: "WK-9001",
    repo: "agent-chassis/agent-chassis",
    record_kind: "work_item",
    slices,
    ...overrides
  };
}

function slice(id, status, dependsOn = [], workKind = "implementation") {
  return { id, status, work_kind: workKind, depends_on: dependsOn };
}

function findSlice(projection, id) {
  return projection.slices.find((entry) => entry.slice_id === id);
}

test("chain (WK-1455 shape): single ready root, rest blocked, done slice segregated", () => {
  const record = makeRecord([
    slice("SLICE-001", "done", [], "redteam"),
    slice("SLICE-005", "todo", []),
    slice("SLICE-002", "todo", ["SLICE-005"]),
    slice("SLICE-003", "todo", ["SLICE-002"]),
    slice("SLICE-004", "todo", ["SLICE-003"]),
    slice("SLICE-006", "todo", ["SLICE-004"]),
    slice("SLICE-007", "todo", ["SLICE-006"]),
    slice("SLICE-008", "todo", ["SLICE-007"]),
    slice("SLICE-009", "todo", ["SLICE-008"])
  ]);

  const projection = buildSliceDagProjection(record);

  assert.deepEqual(projection.frontier, ["SLICE-005"]);
  assert.deepEqual(projection.done, ["SLICE-001"]);
  assert.deepEqual(projection.blocked, [
    "SLICE-002",
    "SLICE-003",
    "SLICE-004",
    "SLICE-006",
    "SLICE-007",
    "SLICE-008",
    "SLICE-009"
  ]);

  assert.deepEqual(projection.parallel_branch_sets, [["SLICE-005"]]);

  assert.equal(findSlice(projection, "SLICE-005").state, "ready");
  assert.equal(findSlice(projection, "SLICE-001").state, "done");

  const blockedTwo = findSlice(projection, "SLICE-002");
  assert.equal(blockedTwo.state, "blocked");
  assert.equal(blockedTwo.unsatisfied_edge_count, 1);
  assert.deepEqual(blockedTwo.blocked_by, [
    {
      slice_id: "SLICE-005",
      selected_status: "todo",
      marker: "unsatisfied",
      address: "SLICE-005"
    }
  ]);

  assert.deepEqual(projection.diagnostics, []);
});

test("parallel: two independent branches plus a done slice yield two branch sets", () => {
  const record = makeRecord([
    slice("SLICE-000", "done", []),
    slice("SLICE-001", "todo", []),
    slice("SLICE-002", "todo", ["SLICE-001"]),
    slice("SLICE-003", "todo", []),
    slice("SLICE-004", "todo", ["SLICE-003"])
  ]);

  const projection = buildSliceDagProjection(record);

  assert.deepEqual(projection.frontier, ["SLICE-001", "SLICE-003"]);
  assert.deepEqual(projection.done, ["SLICE-000"]);
  assert.deepEqual(projection.blocked, ["SLICE-002", "SLICE-004"]);

  assert.deepEqual(projection.parallel_branch_sets, [["SLICE-001"], ["SLICE-003"]]);
});

test("diamond: A done; B,C ready and share ancestry/descendant -> one branch set", () => {
  const record = makeRecord([
    slice("SLICE-001", "done", []),
    slice("SLICE-002", "todo", ["SLICE-001"]),
    slice("SLICE-003", "todo", ["SLICE-001"]),
    slice("SLICE-004", "todo", ["SLICE-002", "SLICE-003"])
  ]);

  const projection = buildSliceDagProjection(record);

  assert.deepEqual(projection.frontier, ["SLICE-002", "SLICE-003"]);
  assert.deepEqual(projection.done, ["SLICE-001"]);
  assert.deepEqual(projection.blocked, ["SLICE-004"]);

  assert.deepEqual(projection.parallel_branch_sets, [["SLICE-002", "SLICE-003"]]);

  const d = findSlice(projection, "SLICE-004");
  assert.equal(d.unsatisfied_edge_count, 2);
  assert.deepEqual(
    d.blocked_by.map((entry) => entry.slice_id),
    ["SLICE-002", "SLICE-003"]
  );
});

test("cycle: mutual depends_on is non-fatal; members blocked with a diagnostic", () => {
  const record = makeRecord([
    slice("SLICE-001", "todo", ["SLICE-002"]),
    slice("SLICE-002", "todo", ["SLICE-001"])
  ]);

  const projection = buildSliceDagProjection(record);

  assert.deepEqual(projection.frontier, []);
  assert.deepEqual(projection.blocked, ["SLICE-001", "SLICE-002"]);
  assert.deepEqual(projection.parallel_branch_sets, []);

  const cycle = projection.diagnostics.find((entry) => entry.code === "cycle");
  assert.ok(cycle, "expected a cycle diagnostic");
  assert.match(cycle.message, /SLICE-001/);
  assert.match(cycle.message, /SLICE-002/);
});

test("dangling target: unknown intra-record predecessor -> missing_target marker + diagnostic", () => {
  const record = makeRecord([slice("SLICE-A", "todo", ["SLICE-999"])]);

  const projection = buildSliceDagProjection(record);

  assert.deepEqual(projection.frontier, []);
  assert.deepEqual(projection.blocked, ["SLICE-A"]);

  const a = findSlice(projection, "SLICE-A");
  assert.equal(a.unsatisfied_edge_count, 1);
  assert.deepEqual(a.blocked_by, [
    {
      slice_id: "SLICE-999",
      selected_status: null,
      marker: "missing_target",
      address: "SLICE-999"
    }
  ]);
  assert.ok(
    projection.diagnostics.some((entry) => entry.code === "missing_target"),
    "expected a missing_target diagnostic"
  );
});

test("cross-record-deferred: another record's slice keeps the slice off the frontier", () => {
  const record = makeRecord([slice("SLICE-A", "todo", ["WK-1455#SLICE-003"])]);

  const projection = buildSliceDagProjection(record);

  assert.deepEqual(projection.frontier, []);
  assert.deepEqual(projection.blocked, ["SLICE-A"]);

  const a = findSlice(projection, "SLICE-A");
  assert.equal(a.state, "blocked");
  assert.equal(a.unsatisfied_edge_count, 1);
  assert.deepEqual(a.blocked_by, [
    {
      slice_id: "SLICE-003",
      selected_status: null,
      marker: "cross_record_deferred",
      address: "WK-1455#SLICE-003"
    }
  ]);
  assert.ok(
    projection.diagnostics.some((entry) => entry.code === "cross_record_deferred"),
    "expected a cross_record_deferred diagnostic"
  );
});

test("cancelled predecessor: satisfy gate unchanged; successor blocked with terminal marker", () => {
  const record = makeRecord([
    slice("SLICE-001", "cancelled", []),
    slice("SLICE-002", "todo", ["SLICE-001"])
  ]);

  const projection = buildSliceDagProjection(record);

  assert.deepEqual(projection.frontier, ["SLICE-001"]);
  assert.deepEqual(projection.done, []);
  assert.deepEqual(projection.blocked, ["SLICE-002"]);
  assert.equal(findSlice(projection, "SLICE-001").state, "ready");

  const b = findSlice(projection, "SLICE-002");
  assert.equal(b.state, "blocked");
  assert.deepEqual(b.blocked_by, [
    {
      slice_id: "SLICE-001",
      selected_status: "cancelled",
      marker: "terminal_predecessor",
      address: "SLICE-001"
    }
  ]);
  assert.ok(
    projection.diagnostics.some((entry) => entry.code === "terminal_predecessor"),
    "expected a terminal_predecessor diagnostic"
  );
});

test("degenerate inputs: non-record / no slices yields an empty projection, no throw", () => {
  const empty = {
    slices: [],
    frontier: [],
    blocked: [],
    done: [],
    parallel_branch_sets: [],
    diagnostics: []
  };
  assert.deepEqual(buildSliceDagProjection(null), empty);
  assert.deepEqual(buildSliceDagProjection({}), empty);
  assert.deepEqual(buildSliceDagProjection(makeRecord([])), empty);
});

test("no-dependency slices are all on the frontier as independent branch sets", () => {
  const record = makeRecord([
    slice("SLICE-A", "todo", []),
    slice("SLICE-B", "todo", [])
  ]);

  const projection = buildSliceDagProjection(record);

  assert.deepEqual(projection.frontier, ["SLICE-A", "SLICE-B"]);
  assert.deepEqual(projection.parallel_branch_sets, [["SLICE-A"], ["SLICE-B"]]);
});
