import assert from "node:assert/strict";
import test from "node:test";

import { validateWorkRecord } from
  "../../packages/wiki-core/src/lib/work-record-schema.mjs";

function recordWithSlice(slice) {
  return {
    schema_version: "work-record.v1",
    id: "WK-9298",
    repo: "agent-chassis/agent-chassis",
    title: "Redteam review purpose schema fixture",
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
    slices: [slice],
    escalations: [],
    projections: [],
    migration: null,
    initiative: "IN-0030",
  };
}

function findingsSlice({ workKind, role, reviewPurpose } = {}) {
  const slice = {
    id: "SLICE-001",
    title: "Findings-only unit",
    work_kind: workKind,
    status: "todo",
    priority: "medium",
    owner: "unassigned",
    depends_on: [],
    read_scope: ["AGENTS.md"],
    repo_paths: ["docs/work-record-schema.md"],
    write_scope: [],
    dispatch_intent: {
      intended_agent_role: role,
      target_unit: "slice",
      requires_graph_impact: false,
      requires_escalation: false,
    },
    acceptance: { criteria: ["Inspect only."], validation: ["node --test"] },
    sections: { agent_notes: "" },
  };
  if (reviewPurpose !== undefined) slice.review_purpose = reviewPurpose;
  return slice;
}

function purposeDiagnostics(slice) {
  return validateWorkRecord(recordWithSlice(slice)).filter(
    (entry) => entry.path === "slices[0].review_purpose",
  );
}

test("review and redteam review_purpose compatibility is explicit and closed", () => {
  for (const reviewPurpose of ["standalone", "terminal_whole_wk"]) {
    assert.deepEqual(purposeDiagnostics(findingsSlice({
      workKind: "review", role: "reviewer", reviewPurpose,
    })), []);
  }
  assert.deepEqual(purposeDiagnostics(findingsSlice({
    workKind: "redteam", role: "redteam", reviewPurpose: "standalone",
  })), []);

  const omitted = findingsSlice({ workKind: "redteam", role: "redteam" });
  assert.deepEqual(purposeDiagnostics(omitted), []);
  assert.equal(Object.hasOwn(omitted, "review_purpose"), false);

  for (const [slice, expectedMessage] of [
    [findingsSlice({ workKind: "redteam", role: "redteam", reviewPurpose: "terminal_whole_wk" }), /review work or standalone redteam/u],
    [findingsSlice({ workKind: "implementation", role: "worker", reviewPurpose: "standalone" }), /review work or standalone redteam/u],
    [findingsSlice({ workKind: "review", role: "reviewer", reviewPurpose: "unknown" }), /one of/u],
  ]) {
    const diagnostics = purposeDiagnostics(slice);
    assert.ok(diagnostics.length >= 1);
    assert.ok(diagnostics.some((entry) => expectedMessage.test(entry.message)));
  }
});

function roleDiagnostics(slice) {
  return validateWorkRecord(recordWithSlice(slice)).filter(
    (entry) => entry.path === "slices[0].dispatch_intent.intended_agent_role",
  );
}

test("findings role conflicts are error-severity schema diagnostics, never repairs", () => {
  for (const [workKind, role] of [["review", "redteam"], ["redteam", "reviewer"], ["review", "worker"]]) {
    const slice = findingsSlice({ workKind, role, reviewPurpose: undefined });
    const snapshot = structuredClone(slice);
    const diagnostics = roleDiagnostics(slice);
    assert.equal(diagnostics.length, 1, `${workKind}/${role}`);
    assert.equal(diagnostics[0].severity, "error", `${workKind}/${role}`);
    assert.equal(diagnostics[0].code, "invalid_record", `${workKind}/${role}`);
    assert.match(diagnostics[0].message, /a conflicting authored role is refused, not normalized/u);

    assert.equal(
      validateWorkRecord(recordWithSlice(slice)).some((entry) => entry.severity === "error"),
      true,
      `${workKind}/${role}`,
    );
    assert.deepEqual(slice, snapshot);
  }

  assert.deepEqual(roleDiagnostics(findingsSlice({ workKind: "review", role: "reviewer" })), []);
  assert.deepEqual(roleDiagnostics(findingsSlice({ workKind: "redteam", role: "redteam" })), []);
  assert.deepEqual(
    roleDiagnostics({ ...findingsSlice({ workKind: "review", role: "reviewer" }), work_kind: "implementation" }),
    [],
  );
});

test("the role-conflict error reaches live work only, at both unit levels", () => {
  const conflicted = (overrides = {}) => ({
    ...findingsSlice({ workKind: "review", role: "worker" }),
    ...overrides,
  });

  for (const status of ["done", "cancelled"]) {
    assert.deepEqual(roleDiagnostics(conflicted({ status })), [], status);
  }

  for (const status of ["inbox", "todo", "active", "review", "blocked", "parked"]) {
    assert.equal(roleDiagnostics(conflicted({ status })).length, 1, status);
  }

  for (const recordStatus of ["done", "cancelled"]) {
    const record = { ...recordWithSlice(conflicted({ status: "todo" })), status: recordStatus };
    assert.deepEqual(
      validateWorkRecord(record).filter((entry) => entry.severity === "error"),
      [],
      recordStatus,
    );
  }

  const terminalBadPurpose = {
    ...findingsSlice({ workKind: "redteam", role: "redteam", reviewPurpose: "terminal_whole_wk" }),
    status: "done",
  };
  assert.ok(purposeDiagnostics(terminalBadPurpose).some((entry) => entry.severity === "error"));
});

test("an omitted redteam purpose at rest is absence, not a schema failure", () => {
  const omitted = findingsSlice({ workKind: "redteam", role: "redteam" });
  assert.equal(Object.hasOwn(omitted, "review_purpose"), false);
  assert.deepEqual(validateWorkRecord(recordWithSlice(omitted)), []);
});

test("record-scoped findings semantics use the same owner, paths, and severity", () => {
  const record = recordWithSlice(findingsSlice({ workKind: "review", role: "reviewer" }));
  const conflicted = {
    ...record,
    work_kind: "review",
    write_scope: [],
    dispatch_intent: { ...record.dispatch_intent, intended_agent_role: "worker" },
  };
  const diagnostics = validateWorkRecord(conflicted).filter(
    (entry) => entry.path === "dispatch_intent.intended_agent_role",
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].severity, "error");

  const badPurpose = { ...record, work_kind: "implementation", review_purpose: "standalone" };
  assert.ok(validateWorkRecord(badPurpose).some(
    (entry) => entry.path === "review_purpose" && entry.severity === "error",
  ));
});
