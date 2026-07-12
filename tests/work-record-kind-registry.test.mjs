

import assert from "node:assert/strict";
import test from "node:test";

import {
  RECORD_KIND_SPECS,
  DECISION_STATUS_VALUES,
  INITIATIVE_STATUS_VALUES,
  getRecordKindSpec,
  validateRecordByKind
} from "../packages/wiki-core/src/lib/work-record-kind-registry.mjs";
import {
  WORK_RECORD_STATUS_VALUES,
  REQUIRED_STRING_TOP_LEVEL_FIELDS,
  REQUIRED_ARRAY_OF_STRING_TOP_LEVEL_FIELDS
} from "../packages/wiki-core/src/lib/work-record-schema-constants.mjs";

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
    dispatch_intent: {},
    acceptance: {},
    sections: {},
    children: [],
    slices: [],
    escalations: [],
    projections: [],
    ...overrides
  };
}

function validDecision(overrides = {}) {
  return {
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

test("work_item spec preserves today's required top-level, status, and section shape", () => {
  const spec = RECORD_KIND_SPECS.work_item;
  assert.ok(spec, "work_item spec must exist in the registry");

  assert.deepEqual(spec.requiredTopLevel.record_kind, { type: "const", value: "work_item" });

  for (const field of REQUIRED_STRING_TOP_LEVEL_FIELDS) {
    assert.equal(
      spec.requiredTopLevel[field]?.type,
      "string",
      `work_item required string field "${field}" must be present`
    );
  }
  for (const field of REQUIRED_ARRAY_OF_STRING_TOP_LEVEL_FIELDS) {
    assert.equal(
      spec.requiredTopLevel[field]?.type,
      "string_array",
      `work_item required string-array field "${field}" must be present`
    );
  }

  for (const field of ["dispatch_intent", "acceptance", "sections"]) {
    assert.equal(spec.requiredTopLevel[field]?.type, "object");
  }
  for (const field of ["children", "slices", "escalations", "projections"]) {
    assert.equal(spec.requiredTopLevel[field]?.type, "array");
  }

  assert.equal(spec.statusEnum, WORK_RECORD_STATUS_VALUES);

  assert.deepEqual(Object.keys(spec.sectionSpec).sort(), [
    "agent_notes",
    "closure",
    "references",
    "scope",
    "summary",
    "tasks",
    "why_it_matters"
  ]);
});

test("a valid work_item record passes with no diagnostics", () => {
  assert.deepEqual(validateRecordByKind(validWorkItem()), []);
});

test("a valid decision.v1 record passes with no diagnostics", () => {
  assert.deepEqual(validateRecordByKind(validDecision()), []);
});

test("a valid initiative.v1 record passes with no diagnostics", () => {
  assert.deepEqual(validateRecordByKind(validInitiative()), []);
});

test("valid decisions accept every DEC status in the lifecycle vocabulary", () => {
  for (const status of DECISION_STATUS_VALUES) {
    assert.deepEqual(
      validateRecordByKind(validDecision({ status })),
      [],
      `decision status "${status}" must validate`
    );
  }
});

test("getRecordKindSpec resolves each supported kind and rejects others", () => {
  assert.equal(getRecordKindSpec("work_item"), RECORD_KIND_SPECS.work_item);
  assert.equal(getRecordKindSpec("decision"), RECORD_KIND_SPECS.decision);
  assert.equal(getRecordKindSpec("initiative"), RECORD_KIND_SPECS.initiative);
  assert.equal(getRecordKindSpec("source"), null);
  assert.equal(getRecordKindSpec(null), null);
  assert.equal(getRecordKindSpec(42), null);
});

function messagesFor(diagnostics, path) {
  return diagnostics.filter((d) => d.path === path).map((d) => d.message);
}

test("work_item missing a required field and a bad status both diagnose", () => {
  const missing = validWorkItem();
  delete missing.title;
  const missingDiag = validateRecordByKind(missing);
  assert.deepEqual(messagesFor(missingDiag, "title"), ["title is required"]);

  const badStatus = validateRecordByKind(validWorkItem({ status: "nope" }));
  const statusDiag = badStatus.find((d) => d.path === "status");
  assert.ok(statusDiag, "expected a status diagnostic");
  assert.equal(statusDiag.code, "invalid_record");
  assert.ok(
    statusDiag.message.includes(WORK_RECORD_STATUS_VALUES.join(", ")),
    "status message must enumerate the allowed work-item statuses"
  );
});

test("decision missing a required field and a bad status both diagnose", () => {
  const missing = validDecision();
  delete missing.owners;
  const missingDiag = validateRecordByKind(missing);
  assert.deepEqual(messagesFor(missingDiag, "owners"), ["owners is required"]);

  const badStatus = validateRecordByKind(validDecision({ status: "todo" }));
  const statusDiag = badStatus.find((d) => d.path === "status");
  assert.ok(statusDiag, "expected a status diagnostic");
  assert.equal(statusDiag.code, "invalid_record");

  assert.ok(
    statusDiag.message.includes(DECISION_STATUS_VALUES.join(", ")),
    "status message must enumerate the allowed decision statuses"
  );
});

test("initiative missing a required field and a bad status both diagnose", () => {
  const missing = validInitiative();
  delete missing.owner;
  const missingDiag = validateRecordByKind(missing);
  assert.deepEqual(messagesFor(missingDiag, "owner"), ["owner is required"]);

  const badStatus = validateRecordByKind(validInitiative({ status: "accepted" }));
  const statusDiag = badStatus.find((d) => d.path === "status");
  assert.ok(statusDiag, "expected a status diagnostic");
  assert.equal(statusDiag.code, "invalid_record");
  assert.ok(
    statusDiag.message.includes(INITIATIVE_STATUS_VALUES.join(", ")),
    "status message must enumerate the allowed initiative statuses"
  );
});

test("decision body sections are type-checked when present", () => {
  const bad = validDecision({ sections: { decision: 123 } });
  const diag = validateRecordByKind(bad).find((d) => d.path === "sections.decision");
  assert.ok(diag, "expected a diagnostic for a non-string decision section");
  assert.equal(diag.code, "invalid_record");

  assert.deepEqual(
    validateRecordByKind(validDecision({ sections: { context: "", decision: "d", consequences: "" } })),
    []
  );
});

test("the reserved decision enforcement block is accepted without shape checks", () => {

  for (const enforcement of [{ anything: [1, 2, 3] }, "opaque", 7, null, ["x"]]) {
    assert.deepEqual(
      validateRecordByKind(validDecision({ enforcement })),
      [],
      `reserved enforcement value ${JSON.stringify(enforcement)} must be accepted`
    );
  }

  assert.deepEqual(validateRecordByKind(validDecision({ ratified: "2026-07-11" })), []);
  assert.deepEqual(validateRecordByKind(validDecision({ ratified: null })), []);
  const badRatified = validateRecordByKind(validDecision({ ratified: { by: "op" } }));
  const ratifiedDiag = badRatified.find((d) => d.path === "ratified");
  assert.ok(ratifiedDiag, "expected a diagnostic for a non-string ratified value");
  assert.equal(ratifiedDiag.code, "invalid_record");
});

test("the reserved initiative included_issues field is accepted without shape checks", () => {
  for (const included of [[{ id: "WK-1" }], "opaque", 3, null]) {
    assert.deepEqual(
      validateRecordByKind(validInitiative({ included_issues: included })),
      [],
      `reserved included_issues value ${JSON.stringify(included)} must be accepted`
    );
  }
});

test("an unsupported record_kind yields an unsupported_record_kind diagnostic", () => {
  const diagnostics = validateRecordByKind({ record_kind: "source", id: "SRC-1" });
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "unsupported_record_kind");
  assert.equal(diagnostics[0].path, "record_kind");
  assert.ok(diagnostics[0].message.includes("source"));
});

test("a missing or non-string record_kind is reported before dispatch", () => {
  const missing = validateRecordByKind({ id: "X" });
  assert.equal(missing.length, 1);
  assert.equal(missing[0].code, "invalid_record");
  assert.equal(missing[0].path, "record_kind");

  const nonObject = validateRecordByKind("not-a-record");
  assert.equal(nonObject.length, 1);
  assert.equal(nonObject[0].code, "invalid_record");
});
