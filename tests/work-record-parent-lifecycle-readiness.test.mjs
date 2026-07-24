import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  evaluateWorkRecordParentLifecycleContract
} from "../packages/wiki-core/src/lib/work-record-parent-lifecycle-contract.mjs";
import {
  MISSING_INITIATIVE_REF_NAMESPACE_DECISION_CODE,
  WORK_RECORD_DISPATCH_DECISION_CODES,
  validateWorkRecordDispatchById
} from "../packages/wiki-core/src/lib/work-record-dispatch.mjs";

const CLEAN_GRAPH = Object.freeze({
  graph_available: true,
  graph_state: "available",
  staleness: "fresh",
  dirty_state: "clean"
});

const PARENT_LIFECYCLE_INCOMPLETE_CODE = "parent_lifecycle_contract_incomplete";

function terminalReviewSlice(id = "SLICE-002") {
  return {
    id,
    title: "Terminal whole-WK findings-only review",
    work_kind: "review",
    status: "todo",
    priority: "high",
    owner: "codex",
    depends_on: [],
    read_scope: ["AGENTS.md"],
    repo_paths: ["packages/wiki-core/src/lib/work-record-dispatch.mjs"],
    write_scope: [],
    dispatch_intent: {
      intended_agent_role: "reviewer",
      target_unit: "slice",
      requires_graph_impact: false,
      requires_escalation: false
    },
    acceptance: {
      criteria: ["Report findings against the complete terminal candidate."],
      validation: ["node --test tests/work-record-parent-lifecycle-readiness.test.mjs"]
    },
    review_purpose: "terminal_whole_wk",
    sections: { agent_notes: "" }
  };
}

function implementationSlice() {
  return {
    id: "SLICE-001",
    title: "Implementation",
    work_kind: "implementation",
    status: "active",
    priority: "high",
    owner: "codex",
    depends_on: [],
    read_scope: ["AGENTS.md"],
    repo_paths: ["docs/mcp-dispatch-runtime-contract.md"],
    write_scope: ["docs/mcp-dispatch-runtime-contract.md"],
    dispatch_intent: {
      intended_agent_role: "worker",
      target_unit: "slice",
      requires_graph_impact: false,
      requires_escalation: false
    },
    acceptance: {
      criteria: ["Implement the requested dispatch guard."],
      validation: ["node --test tests/work-record-parent-lifecycle-readiness.test.mjs"]
    },
    sections: { agent_notes: "" }
  };
}

function completeRecord() {
  return {
    schema_version: "work-record.v1",
    id: "WK-9716",
    repo: "agent-chassis/agent-chassis",
    title: "Parent lifecycle fixture",
    record_kind: "work_item",
    work_kind: "implementation",
    status: "active",
    priority: "high",
    owner: "codex",
    created: "2026-07-23",
    updated: "2026-07-23",
    initiative: "IN-0030",
    read_scope: ["AGENTS.md"],
    repo_paths: ["docs/mcp-dispatch-runtime-contract.md"],
    write_scope: ["docs/mcp-dispatch-runtime-contract.md"],
    depends_on: [],
    blocks: [],
    related: [],
    dispatch_intent: {
      intended_agent_role: "worker",
      target_unit: "slice",
      requires_graph_impact: false,
      requires_escalation: false
    },
    acceptance: {
      criteria: ["The parent contract is complete before slice dispatch."],
      validation: ["node --test tests/work-record-parent-lifecycle-readiness.test.mjs"]
    },
    sections: {
      summary: "Parent lifecycle fixture.",
      why_it_matters: "Pins non-authorizing parent lifecycle facts.",
      scope: { items: ["dispatch"], out_of_scope: ["organization policy"] },
      tasks: [{ text: "Validate dispatch.", status: "todo" }],
      references: ["AGENTS.md"],
      agent_notes: "",
      closure: null
    },
    children: [],
    slices: [implementationSlice(), terminalReviewSlice()],
    escalations: [],
    projections: [],
    migration: null,
    derived_evidence: []
  };
}

function clone(value) {
  return structuredClone(value);
}

async function withRecord(t, record) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wk1716-parent-lifecycle-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, "wiki", "work-records"), { recursive: true });
  await writeFile(
    path.join(dir, "wiki", "work-records", `${record.id}.json`),
    JSON.stringify(record),
    "utf8"
  );
  return dir;
}

async function dispatchSlice(t, record, overrides = {}) {
  const dir = await withRecord(t, record);
  return validateWorkRecordDispatchById({
    dir,
    unitAddress: `${record.id}#SLICE-001`,
    graph_state: CLEAN_GRAPH,
    graph_import_adjacency: [],
    ...overrides
  });
}

test("WK-1715 failure shape is a closed ordered incomplete result", () => {
  const record = completeRecord();
  delete record.initiative;
  record.acceptance = { criteria: [], validation: [] };
  record.slices = [implementationSlice()];

  assert.deepEqual(evaluateWorkRecordParentLifecycleContract(record), {
    complete: false,
    missing_facts: [
      "initiative",
      "acceptance.criteria",
      "acceptance.validation",
      "terminal_review_contract_unit"
    ],
    ambiguous_facts: []
  });
});

test("each required parent fact is an independent projection witness", () => {
  const mutations = [
    ["initiative", (record) => { delete record.initiative; }],
    ["acceptance.criteria", (record) => { record.acceptance.criteria = []; }],
    ["acceptance.validation", (record) => { record.acceptance.validation = []; }],
    ["terminal_review_contract_unit", (record) => { record.slices.pop(); }]
  ];

  for (const [fact, mutate] of mutations) {
    const record = completeRecord();
    mutate(record);
    assert.deepEqual(
      evaluateWorkRecordParentLifecycleContract(record),
      { complete: false, missing_facts: [fact], ambiguous_facts: [] },
      `removing ${fact} must fail its dedicated projection regression`
    );
  }
});

test("two eligible terminal contract units produce typed ambiguity", () => {
  const record = completeRecord();
  record.slices.push(terminalReviewSlice("SLICE-003"));
  assert.deepEqual(evaluateWorkRecordParentLifecycleContract(record), {
    complete: false,
    missing_facts: [],
    ambiguous_facts: ["terminal_review_contract_unit"]
  });
});

test("ineligible review shapes do not satisfy terminal routing identity", () => {
  const variants = [
    ["wrong purpose", (slice) => { slice.review_purpose = "standalone"; }],
    ["non-review kind", (slice) => { slice.work_kind = "redteam"; }],
    ["non-empty write scope", (slice) => { slice.write_scope = ["docs/file.md"]; }],
    ["done", (slice) => { slice.status = "done"; }],
    ["cancelled", (slice) => { slice.status = "cancelled"; }]
  ];

  for (const [name, mutate] of variants) {
    const record = completeRecord();
    mutate(record.slices[1]);
    const result = evaluateWorkRecordParentLifecycleContract(record);
    assert.deepEqual(result.missing_facts, ["terminal_review_contract_unit"], name);
    assert.deepEqual(result.ambiguous_facts, [], name);
  }
});

test("parent status and plural advisory attempt evidence do not affect completeness", () => {
  const expectedSlice = terminalReviewSlice();
  for (const status of ["todo", "active", "blocked", "review", "done", "cancelled"]) {
    const record = completeRecord();
    record.status = status;
    record.review_runs = [{ outcome: "clean" }, { outcome: "blocking_findings" }];
    record.redteam_runs = [{ outcome: "medium_findings" }];
    record.receipts = [{ result: "accepted" }, { result: "rejected" }];
    record.findings = [{ severity: "high" }];
    assert.deepEqual(evaluateWorkRecordParentLifecycleContract(record), {
      complete: true,
      terminal_review_contract_unit: expectedSlice
    });
  }
});

test("parent_lifecycle_contract_incomplete is not a dispatch decision code", () => {

  assert.equal(
    WORK_RECORD_DISPATCH_DECISION_CODES.includes(PARENT_LIFECYCLE_INCOMPLETE_CODE),
    false
  );
});

test("missing_initiative_ref_namespace is the narrow initiative refusal code", () => {
  assert.equal(MISSING_INITIATIVE_REF_NAMESPACE_DECISION_CODE, "missing_initiative_ref_namespace");
  assert.equal(
    WORK_RECORD_DISPATCH_DECISION_CODES.includes(MISSING_INITIATIVE_REF_NAMESPACE_DECISION_CODE),
    true
  );
});

test("implementation-slice dispatch refuses when the parent initiative is absent", async (t) => {

  const record = completeRecord();
  delete record.initiative;
  const readiness = await dispatchSlice(t, record);
  assert.equal(readiness.dispatchable, false, JSON.stringify(readiness));
  assert.equal(readiness.decision_code, MISSING_INITIATIVE_REF_NAMESPACE_DECISION_CODE);
  assert.equal(Object.hasOwn(readiness, "parent_lifecycle_contract"), false);
});

test("implementation-slice dispatch refuses a non-canonical parent initiative", async (t) => {
  for (const initiative of ["IN-30", "IN-00300", "INITIATIVE-0030", "0030", "", "in-0030"]) {
    const record = completeRecord();
    record.initiative = initiative;
    const readiness = await dispatchSlice(t, record);
    assert.equal(readiness.dispatchable, false, `${JSON.stringify(initiative)}: ${JSON.stringify(readiness)}`);
    assert.equal(
      readiness.decision_code,
      MISSING_INITIATIVE_REF_NAMESPACE_DECISION_CODE,
      JSON.stringify(initiative)
    );
  }
});

test("implementation-slice dispatch proceeds with missing parent acceptance.criteria", async (t) => {

  const record = completeRecord();
  record.acceptance = { criteria: [], validation: [] };
  const readiness = await dispatchSlice(t, record);
  assert.equal(readiness.dispatchable, true, JSON.stringify(readiness));
  assert.equal(readiness.decision_code, "dispatchable");
  assert.equal(Object.hasOwn(readiness, "parent_lifecycle_contract"), false);
});

test("implementation-slice dispatch proceeds with missing parent acceptance.validation", async (t) => {

  const record = completeRecord();
  record.acceptance = { criteria: [], validation: [] };
  const readiness = await dispatchSlice(t, record);
  assert.equal(readiness.dispatchable, true, JSON.stringify(readiness));
  assert.equal(readiness.decision_code, "dispatchable");
});

test("implementation-slice dispatch proceeds with no terminal-review unit", async (t) => {
  const record = completeRecord();
  record.slices = [implementationSlice()];
  const readiness = await dispatchSlice(t, record);
  assert.equal(readiness.dispatchable, true, JSON.stringify(readiness));
  assert.equal(readiness.decision_code, "dispatchable");
});

test("implementation-slice dispatch proceeds with multiple terminal-review units", async (t) => {

  const record = completeRecord();
  record.slices.push(terminalReviewSlice("SLICE-003"));
  const readiness = await dispatchSlice(t, record);
  assert.equal(readiness.dispatchable, true, JSON.stringify(readiness));
  assert.equal(readiness.decision_code, "dispatchable");
});

test("implementation-slice dispatch proceeds with every parent PLANNING fact absent", async (t) => {

  const record = completeRecord();
  record.acceptance = { criteria: [], validation: [] };
  record.slices = [implementationSlice()];
  const readiness = await dispatchSlice(t, record);
  assert.equal(readiness.dispatchable, true, JSON.stringify(readiness));
  assert.equal(readiness.decision_code, "dispatchable");
  assert.notEqual(readiness.decision_code, PARENT_LIFECYCLE_INCOMPLETE_CODE);
  assert.notEqual(readiness.decision_code, MISSING_INITIATIVE_REF_NAMESPACE_DECISION_CODE);
  assert.equal(Object.hasOwn(readiness, "parent_lifecycle_contract"), false);
});

test("a complete parent contract also leaves implementation-slice structural dispatch ready", async (t) => {
  const readiness = await dispatchSlice(t, completeRecord());
  assert.equal(readiness.dispatchable, true, JSON.stringify(readiness));
  assert.equal(readiness.decision_code, "dispatchable");
  assert.equal(Object.hasOwn(readiness, "parent_lifecycle_contract"), false);
});

test("missing parent PLANNING facts no longer short-circuit before CCE evaluation", async (t) => {

  const record = completeRecord();
  record.acceptance = { criteria: [], validation: [] };
  record.slices = [implementationSlice()];
  const readiness = await dispatchSlice(t, record, { node_engine_admissibility: true });
  assert.equal(readiness.dispatchable, true, JSON.stringify(readiness));
  assert.notEqual(readiness.decision_code, PARENT_LIFECYCLE_INCOMPLETE_CODE);
  assert.equal(readiness.admissibility?.admissible, true, JSON.stringify(readiness.admissibility));
  assert.equal(readiness.admissibility?.authority, "local_only_config");
});

test("empty selected-slice acceptance still refuses before dispatch", async (t) => {
  const record = completeRecord();
  record.slices[0].acceptance = { criteria: [], validation: [] };
  const readiness = await dispatchSlice(t, record);
  assert.equal(readiness.dispatchable, false, JSON.stringify(readiness));
  assert.equal(readiness.decision_code, "missing_validation");
});

test("missing selected-slice acceptance.criteria still refuses before dispatch", async (t) => {
  const record = completeRecord();
  record.slices[0].acceptance = {
    criteria: [],
    validation: ["node --test tests/work-record-parent-lifecycle-readiness.test.mjs"]
  };
  const readiness = await dispatchSlice(t, record);
  assert.equal(readiness.dispatchable, false, JSON.stringify(readiness));
  assert.equal(readiness.decision_code, "missing_validation");
});

test("missing selected-slice acceptance.validation still refuses before dispatch", async (t) => {
  const record = completeRecord();
  record.slices[0].acceptance = {
    criteria: ["Implement the requested dispatch guard."],
    validation: []
  };
  const readiness = await dispatchSlice(t, record);
  assert.equal(readiness.dispatchable, false, JSON.stringify(readiness));
  assert.equal(readiness.decision_code, "missing_validation");
});

test("a malformed selected-unit slice id still refuses before dispatch", async (t) => {
  const readiness = await validateWorkRecordDispatchById({
    dir: await withRecord(t, completeRecord()),
    unitAddress: "WK-9716#SLICE-XYZ",
    graph_state: CLEAN_GRAPH,
    graph_import_adjacency: []
  });
  assert.equal(readiness.dispatchable, false);
  assert.equal(readiness.decision_code, "invalid_record");
  assert.notEqual(readiness.decision_code, PARENT_LIFECYCLE_INCOMPLETE_CODE);
});

test("a missing selected slice still refuses before dispatch", async (t) => {
  const readiness = await validateWorkRecordDispatchById({
    dir: await withRecord(t, completeRecord()),
    unitAddress: "WK-9716#SLICE-404",
    graph_state: CLEAN_GRAPH,
    graph_import_adjacency: []
  });
  assert.equal(readiness.dispatchable, false);
  assert.equal(readiness.decision_code, "missing_slice");
});

test("an empty write scope on the implementation slice still refuses", async (t) => {
  const record = completeRecord();
  record.slices[0].write_scope = [];
  const readiness = await dispatchSlice(t, record);
  assert.equal(readiness.dispatchable, false);
  assert.equal(readiness.decision_code, "missing_write_scope");
});
