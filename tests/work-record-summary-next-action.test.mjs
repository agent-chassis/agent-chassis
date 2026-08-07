import assert from "node:assert/strict";
import test from "node:test";
import { getWorkRecordSummary } from "../packages/wiki-core/src/operations/work-record-summary.mjs";

const dir = "/workspace";

function storeFor(records, failures = new Set()) {
  return {
    async pathExists() {
      return true;
    },
    async readText(filePath) {
      const id = filePath.split("/").pop().replace(/\.json$/, "");
      if (failures.has(id)) throw new Error(`cannot read ${id}`);
      return JSON.stringify(records[id]);
    }
  };
}

function record(id, status, depends_on = [], slices = []) {
  return {
    schema_version: "work-record.v1",
    id,
    repo: "agent-chassis/agent-chassis",
    title: id,
    record_kind: "work_item",
    work_kind: "implementation",
    status,
    priority: "medium",
    owner: "unassigned",
    created: "2026-01-01",
    updated: "2026-01-01",
    resolution: "unresolved",
    read_scope: [],
    repo_paths: [],
    write_scope: [],
    depends_on,
    blocks: [],
    related: [],
    dispatch_intent: {
      intended_agent_role: "worker",
      target_unit: "record",
      requires_graph_impact: false,
      requires_escalation: false
    },
    escalations: [],
    projections: [],
    acceptance: { criteria: [], validation: [] },
    sections: {
      summary: `Summary for ${id}`,
      why_it_matters: `Why ${id} matters`,
      scope: { items: [], out_of_scope: [] },
      tasks: [],
      references: [],
      agent_notes: "",
      closure: null
    },
    children: [],
    slices,
    initiative: "IN-0016"
  };
}

test("operations summary resolves done record dependencies", async () => {
  const records = {
    "WK-0537": record("WK-0537", "todo", ["WK-0528", "WK-0529"]),
    "WK-0528": record("WK-0528", "done"),
    "WK-0529": record("WK-0529", "done")
  };

  const result = await getWorkRecordSummary({
    dir,
    id: "WK-0537",
    recordStore: storeFor(records)
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.summary.blockers, []);
  assert.equal(result.summary.selected_unit_summary.next_action, "continue work");
});

test("operations summary resolves cross-record slices and isolates failures", async () => {
  const records = {
    "WK-1000": record("WK-1000", "todo", ["WK-1001#build", "WK-1002"]),
    "WK-1001": record("WK-1001", "todo", [], [
      {
        id: "build",
        title: "Build",
        work_kind: "implementation",
        status: "done",
        priority: "medium",
        owner: "unassigned",
        depends_on: [],
        read_scope: [],
        repo_paths: [],
        write_scope: [],
        dispatch_intent: {
          intended_agent_role: "worker",
          target_unit: "slice",
          requires_graph_impact: false,
          requires_escalation: false
        },
        acceptance: { criteria: [], validation: [] }
      }
    ]),
    "WK-1002": record("WK-1002", "done")
  };

  const result = await getWorkRecordSummary({
    dir,
    id: "WK-1000",
    recordStore: storeFor(records, new Set(["WK-1002"]))
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.summary.blockers, [
    {
      kind: "depends_on",
      source: "depends_on",
      resolution: "unresolved",
      entry: { id: "WK-1002", marker: "unresolved", selected_status: null }
    }
  ]);
});

test("operations summary retains a genuinely open dependency as a blocker", async () => {
  const records = {
    "WK-2000": record("WK-2000", "todo", ["WK-2001"]),
    "WK-2001": record("WK-2001", "todo")
  };

  const result = await getWorkRecordSummary({
    dir,
    id: "WK-2000",
    recordStore: storeFor(records)
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.summary.blockers, [
    {
      kind: "depends_on",
      source: "depends_on",
      resolution: "unsatisfied_open",
      entry: { id: "WK-2001", marker: "unsatisfied", selected_status: "todo" }
    }
  ]);
  assert.equal(result.summary.selected_unit_summary.next_action, "resolve blockers");
});

test("operations summary resolves done dependencies for a selected slice", async () => {
  const records = {
    "WK-1836": record("WK-1836", "active", [], [
      {
        id: "SLICE-005",
        title: "Selected slice",
        work_kind: "implementation",
        status: "active",
        priority: "medium",
        owner: "unassigned",
        depends_on: ["SLICE-002", "SLICE-003", "SLICE-004"],
        read_scope: [],
        repo_paths: [],
        write_scope: [],
        dispatch_intent: {
          intended_agent_role: "worker",
          target_unit: "slice",
          requires_graph_impact: false,
          requires_escalation: false
        },
        acceptance: { criteria: [], validation: [] }
      },
      { id: "SLICE-002", status: "done" },
      { id: "SLICE-003", status: "done" },
      { id: "SLICE-004", status: "done" }
    ])
  };

  const result = await getWorkRecordSummary({
    dir,
    unit: "WK-1836#SLICE-005",
    recordStore: storeFor(records)
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.summary.selected_unit_summary.blockers, []);
  assert.notEqual(result.summary.selected_unit_summary.next_action, "resolve blockers");
});
