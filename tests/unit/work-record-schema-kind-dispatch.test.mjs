

import assert from "node:assert/strict";
import test from "node:test";

import { validateWorkRecord } from "../../packages/wiki-core/src/lib/work-record-schema.mjs";
import {
  validateAcceptanceValidationSection
} from "../../packages/wiki-core/src/lib/work-record-schema-validators.mjs";
import {
  DECISION_STATUS_VALUES,
  INITIATIVE_STATUS_VALUES
} from "../../packages/wiki-core/src/lib/work-record-kind-registry.mjs";
import { WORK_RECORD_STATUS_VALUES } from "../../packages/wiki-core/src/lib/work-record-schema-constants.mjs";

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

test("review_purpose defaults structurally and rejects unknown or incompatible values", () => {
  const reviewSlice = {
    id: "SLICE-001",
    title: "Terminal review",
    work_kind: "review",
    status: "todo",
    write_scope: [],
    repo_paths: ["packages/wiki-core"],
    read_scope: ["AGENTS.md"],
    depends_on: [],
    acceptance: { criteria: ["Review"], validation: ["Report findings"] },
    dispatch_intent: {
      intended_agent_role: "reviewer",
      target_unit: "slice",
      requires_graph_impact: false,
      requires_escalation: false
    }
  };
  assert.deepEqual(validateWorkRecord(validWorkItem({ slices: [reviewSlice] })), []);
  assert.deepEqual(validateWorkRecord(validWorkItem({
    slices: [{ ...reviewSlice, review_purpose: "terminal_whole_wk" }]
  })), []);
  assert.ok(validateWorkRecord(validWorkItem({
    slices: [{ ...reviewSlice, review_purpose: "unknown" }]
  })).some((entry) => entry.path === "slices[0].review_purpose"));
  assert.ok(validateWorkRecord(validWorkItem({
    slices: [{ ...reviewSlice, work_kind: "implementation", review_purpose: "standalone" }]
  })).some((entry) => entry.path === "slices[0].review_purpose"));
});

function sliceWithValidation(validation) {
  return {
    id: "SLICE-001",
    title: "Validation section carrier",
    work_kind: "implementation",
    status: "todo",
    write_scope: [],
    repo_paths: ["packages/wiki-core"],
    read_scope: ["AGENTS.md"],
    depends_on: [],
    acceptance: { criteria: ["Criterion"], validation },
    dispatch_intent: {
      intended_agent_role: "worker",
      target_unit: "slice",
      requires_graph_impact: false,
      requires_escalation: false
    }
  };
}

function helperDiagnostics(validation, prefix) {
  const diagnostics = [];
  validateAcceptanceValidationSection(diagnostics, validation, prefix);
  return diagnostics;
}

function schemaValidationDiagnostics(record, prefix) {
  return validateWorkRecord(record).filter((entry) => String(entry.path ?? "").startsWith(prefix));
}

const ACCEPTANCE_VALIDATION_CORPUS = [
  ["empty section", [], []],
  ["text notes stay inert", ["node --test tests/a.test.mjs", "Run focused checks."], []],
  ["current executable entries", [
    { operation: "node_test", target: "tests/a.test.mjs", verification_ids: ["V-1", "V-2"] },
    { operation: "node_test", target: "tests/b.test.mjs", verification_ids: ["V-3"] }
  ], []],
  ["note object", [
    { note: "Inspect the focused result.", verification_ids: ["V-NOTE"] }
  ], []],
  ["non-array section", "Run focused checks.", [["", " must be an array"]]],
  ["blank note", ["   "], [["[0]", "[0] must be a nonblank note"]]],
  ["numeric entry", [42], [["[0]", "[0] must be a note string or current structured validation object"]]],
  ["obsolete command object", [
    { command: "node --test tests/a.test.mjs", verification_ids: ["V-1"] }
  ], [["[0]", "[0] must contain exactly note and verification_ids"]]],
  ["unknown operation", [
    { operation: "node_check", target: "tests/a.test.mjs", verification_ids: [] }
  ], [["[0].operation", "[0].operation must be node_test"]]],
  ["invalid target", [
    { operation: "node_test", target: "../tests/a.test.mjs", verification_ids: [] }
  ], [["[0].target", "[0].target must be one canonical repository-relative .mjs test-module path"]]],
  ["extra field", [
    { operation: "node_test", target: "tests/a.test.mjs", verification_ids: [], extra: true }
  ], [["[0]", "[0] must contain exactly operation, target, and verification_ids"]]],
  ["duplicate identity inside one entry", [
    { operation: "node_test", target: "tests/a.test.mjs", verification_ids: ["V-1", "V-1"] }
  ], [["[0].verification_ids[1]", "[0].verification_ids[1] duplicates verification identity 'V-1'"]]],
  ["duplicate executable binding", [
    { operation: "node_test", target: "tests/a.test.mjs", verification_ids: ["V-1"] },
    { operation: "node_test", target: "tests/b.test.mjs", verification_ids: ["V-1"] }
  ], [["[1].verification_ids", "[1].verification_ids duplicates executable verification binding 'V-1'"]]]
];

function expectedDiagnostics(expected, prefix) {
  return expected.map(([suffix, message]) => ({
    code: "invalid_record",
    severity: "error",
    message: `${prefix}${message}`,
    path: `${prefix}${suffix}`
  }));
}

test("the canonical acceptance.validation section validator owns every entry rule", () => {
  for (const [label, section, expected] of ACCEPTANCE_VALIDATION_CORPUS) {
    assert.deepEqual(
      helperDiagnostics(section, "acceptance.validation"),
      expectedDiagnostics(expected, "acceptance.validation"),
      `canonical helper disagreed on: ${label}`
    );
  }
});

test("validateAcceptance delegates the complete validation section to the canonical validator", () => {
  for (const [label, section, expected] of ACCEPTANCE_VALIDATION_CORPUS) {
    const recordPrefix = "acceptance.validation";
    assert.deepEqual(
      schemaValidationDiagnostics(
        validWorkItem({ acceptance: { criteria: [], validation: section } }),
        recordPrefix
      ),
      expectedDiagnostics(expected, recordPrefix),
      `record-level schema diagnostics diverged from the canonical validator on: ${label}`
    );

    const slicePrefix = "slices[0].acceptance.validation";
    assert.deepEqual(
      schemaValidationDiagnostics(
        validWorkItem({ slices: [sliceWithValidation(section)] }),
        slicePrefix
      ),
      expectedDiagnostics(expected, slicePrefix),
      `slice-level schema diagnostics diverged from the canonical validator on: ${label}`
    );
  }
});

test("a record carrying notes and current declarations validates clean", () => {
  const structured = [
    { operation: "node_test", target: "tests/a.test.mjs", verification_ids: ["V-1", "V-2"] }
  ];
  const mixed = [
    "node --test tests/b.test.mjs",
    { operation: "node_test", target: "tests/c.test.mjs", verification_ids: ["V-3"] }
  ];
  assert.deepEqual(
    validateWorkRecord(
      validWorkItem({
        acceptance: { criteria: ["Record criterion"], validation: structured },
        slices: [sliceWithValidation(mixed)]
      })
    ),
    []
  );
});

test("verification-identity uniqueness is scoped to one validation section", () => {
  const shared = [{ operation: "node_test", target: "tests/a.test.mjs",
    verification_ids: ["V-1"] }];
  assert.deepEqual(
    validateWorkRecord(
      validWorkItem({
        acceptance: { criteria: ["Record criterion"], validation: shared },
        slices: [sliceWithValidation([...shared])]
      })
    ),
    []
  );

  const firstSection = [];
  validateAcceptanceValidationSection(firstSection, shared, "acceptance.validation");
  const secondSection = [];
  validateAcceptanceValidationSection(secondSection, shared, "acceptance.validation");
  assert.deepEqual(firstSection, []);
  assert.deepEqual(secondSection, []);
});

test("the canonical acceptance.validation validator returns facts and mutates nothing", () => {
  const section = [
    "node --test tests/a.test.mjs",
    { command: "node --test tests/b.test.mjs", verification_ids: ["V-1", "V-2"] },
    { command: "   ", verification_ids: ["V-2"] }
  ];
  const snapshot = JSON.stringify(section);
  const diagnostics = [];
  const returned = validateAcceptanceValidationSection(
    diagnostics,
    section,
    "acceptance.validation"
  );
  assert.equal(returned, undefined);
  assert.equal(JSON.stringify(section), snapshot);
  assert.ok(diagnostics.length > 0);
  assert.ok(diagnostics.every((entry) => entry.code === "invalid_record"));
  assert.ok(diagnostics.every((entry) => Object.keys(entry).length === 4));
});
