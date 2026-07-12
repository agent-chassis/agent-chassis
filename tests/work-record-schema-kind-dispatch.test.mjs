

import assert from "node:assert/strict";
import test from "node:test";

import { validateWorkRecord } from "../packages/wiki-core/src/lib/work-record-schema.mjs";
import {
  DECISION_STATUS_VALUES,
  INITIATIVE_STATUS_VALUES
} from "../packages/wiki-core/src/lib/work-record-kind-registry.mjs";
import { WORK_RECORD_STATUS_VALUES } from "../packages/wiki-core/src/lib/work-record-schema-constants.mjs";

function validWorkItem(overrides = {}) {
  return {
    schema_version: "work-record.v1",
    id: "WK-9001",
    repo: "agent-chassis/agent-chassis",
    title: "Fixture work item",
    record_kind: "work_item",
    work_kind: "implementation",
    status: "todo",
    priority: "high",
    owner: "codex",
    created: "2026-07-10",
    updated: "2026-07-10",
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
      requires_escalation: false
    },
    acceptance: { criteria: [], validation: [] },

    sections: {
      summary: "Fixture summary",
      why_it_matters: "Fixture rationale",
      scope: { items: [], out_of_scope: [] },
      tasks: [],
      references: [],
      agent_notes: "Fixture notes",
      closure: null
    },
    children: [],
    slices: [],
    escalations: [],
    projections: [],
    ...overrides
  };
}

function validDecision(overrides = {}) {
  return {
    schema_version: "work-record.v1",
    id: "DEC-9001",
    record_kind: "decision",
    title: "Fixture decision",
    status: "proposed",
    date: "2026-07-10",
    owners: ["codex"],
    ...overrides
  };
}

function validInitiative(overrides = {}) {
  return {
    schema_version: "work-record.v1",
    id: "IN-9001",
    record_kind: "initiative",
    title: "Fixture initiative",
    status: "todo",
    priority: "high",
    owner: "codex",
    created: "2026-07-10",
    updated: "2026-07-10",
    ...overrides
  };
}

test("validateWorkRecord validates a decision.v1 record through the registry with no diagnostics", () => {
  assert.deepEqual(validateWorkRecord(validDecision()), []);
});

test("validateWorkRecord validates an initiative.v1 record through the registry with no diagnostics", () => {
  assert.deepEqual(validateWorkRecord(validInitiative()), []);
});

test("validateWorkRecord routes to the decision status vocabulary, not the work-item one", () => {

  const diagnostics = validateWorkRecord(validDecision({ status: "todo" }));
  const statusDiag = diagnostics.find((d) => d.path === "status");
  assert.ok(statusDiag, "expected a status diagnostic routed through the decision spec");
  assert.equal(statusDiag.code, "invalid_record");
  assert.ok(
    statusDiag.message.includes(DECISION_STATUS_VALUES.join(", ")),
    "status message must enumerate the decision lifecycle vocabulary"
  );

  const initDiag = validateWorkRecord(validInitiative({ status: "accepted" }));
  const initStatusDiag = initDiag.find((d) => d.path === "status");
  assert.ok(initStatusDiag, "expected a status diagnostic routed through the initiative spec");
  assert.ok(
    initStatusDiag.message.includes(INITIATIVE_STATUS_VALUES.join(", ")),
    "status message must enumerate the initiative status vocabulary"
  );
});

test("validateWorkRecord returns unsupported_record_kind for a source record", () => {
  const diagnostics = validateWorkRecord({
    schema_version: "work-record.v1",
    record_kind: "source",
    id: "SRC-1"
  });
  const diag = diagnostics.find((d) => d.code === "unsupported_record_kind");
  assert.ok(diag, "expected an unsupported_record_kind diagnostic for source");
  assert.equal(diag.path, "record_kind");
  assert.ok(diag.message.includes("source"));
});

test("validateWorkRecord returns unsupported_record_kind for an area record", () => {
  const diagnostics = validateWorkRecord({
    schema_version: "work-record.v1",
    record_kind: "area",
    id: "AREA-1"
  });
  const diag = diagnostics.find((d) => d.code === "unsupported_record_kind");
  assert.ok(diag, "expected an unsupported_record_kind diagnostic for area");
  assert.equal(diag.path, "record_kind");
  assert.ok(diag.message.includes("area"));
});

test("validateWorkRecord still passes a valid work_item unchanged", () => {
  assert.deepEqual(validateWorkRecord(validWorkItem()), []);
});

test("validateWorkRecord still diagnoses a work_item missing a required field", () => {
  const missing = validWorkItem();
  delete missing.title;
  const diagnostics = validateWorkRecord(missing);
  const titleDiag = diagnostics.find((d) => d.path === "title");
  assert.ok(titleDiag, "expected a diagnostic for the missing work_item title");
  assert.equal(titleDiag.code, "invalid_record");
  assert.equal(titleDiag.message, "title is required");
});

test("validateWorkRecord still diagnoses a work_item with a bad status", () => {
  const diagnostics = validateWorkRecord(validWorkItem({ status: "nope" }));
  const statusDiag = diagnostics.find((d) => d.path === "status");
  assert.ok(statusDiag, "expected a status diagnostic for an invalid work_item status");
  assert.equal(statusDiag.code, "invalid_record");

  assert.ok(
    WORK_RECORD_STATUS_VALUES.every((status) => statusDiag.message.includes(status)),
    "status message must enumerate the work-item status vocabulary"
  );
});
