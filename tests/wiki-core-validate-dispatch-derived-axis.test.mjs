import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import {
  deriveDispatchRole,
  loadDispatchSubject,
  refuseDerivedAxis,
  validateWorkRecordDispatch,
  validateWorkRecordDispatchReport
} from "../packages/wiki-core/src/operations/validate-dispatch.mjs";
import { validateWorkRecord } from "../packages/wiki-core/src/lib/work-record-schema.mjs";

const UNIT = "WK-1892#SLICE-006";

function subject(intended_agent_role, work_kind = "review") {
  return {
    work_kind,
    dispatch_intent: { intended_agent_role }
  };
}

function textRecordStore(text, exists = true) {
  return {
    async pathExists() { return exists; },
    async readText() { return text; }
  };
}

function reviewRecord(id = "WK-1425", sliceId = null) {
  return {
    schema_version: "work-record.v1",
    id,
    repo: "agent-chassis/agent-chassis",
    title: "Self-contained review fixture",
    record_kind: "work_item",
    work_kind: "review",
    status: "active",
    priority: "medium",
    owner: "unassigned",
    created: "2026-01-01",
    updated: "2026-01-01",
    resolution: "unresolved",
    read_scope: [],
    repo_paths: [],
    write_scope: [],
    depends_on: [],
    blocks: [],
    related: [],
    dispatch_intent: {
      intended_agent_role: "reviewer",
      target_unit: sliceId ? "slice" : "record",
      requires_graph_impact: false,
      requires_escalation: false
    },
    acceptance: {
      criteria: ["The review fixture is dispatchable."],
      validation: ["Run the focused validation test."]
    },
    sections: {
      summary: "Self-contained review fixture.",
      why_it_matters: "The fixture exercises dispatch readiness.",
      scope: { items: [], out_of_scope: [] },
      tasks: [],
      references: [],
      agent_notes: "",
      closure: null
    },
    children: [],
    slices: sliceId ? [{
      id: sliceId,
      title: "Self-contained terminal review slice",
      work_kind: "review",
      status: "done",
      priority: "medium",
      owner: "unassigned",
      depends_on: [],
      read_scope: [],
      repo_paths: [],
      write_scope: [],
      dispatch_intent: {
        intended_agent_role: "reviewer",
        target_unit: "slice",
        requires_graph_impact: false,
        requires_escalation: false
      },
      acceptance: {
        criteria: ["The review slice is dispatchable."],
        validation: ["Run the focused validation test."]
      },
      review_purpose: "terminal_whole_wk"
    }] : [],
    escalations: [],
    projections: [],
    migration: null
  };
}

async function withOnDiskRecord(text, callback) {
  const dir = await mkdtemp(path.join(tmpdir(), "validate-dispatch-"));
  try {
    await mkdir(path.join(dir, "wiki", "work-records"), { recursive: true });
    await writeFile(path.join(dir, "wiki", "work-records", "WK-1425.json"), text);
    return await callback(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function withMissingRecord(callback) {
  const dir = await mkdtemp(path.join(tmpdir(), "validate-dispatch-"));
  try {
    return await callback(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function assertFixtureSchemaValid(record, unitAddress) {
  const diagnostics = validateWorkRecord(record);
  assert.equal(
    diagnostics.length,
    0,
    `fixture for ${unitAddress} must satisfy work-record.v1, got ${diagnostics.length} `
      + `diagnostic(s): ${diagnostics.map((d) => `${d.path}: ${d.message}`).join("; ")}`
  );
}

test("derivation has a defined axis for every non-null work-record role", () => {
  assert.deepEqual(deriveDispatchRole(subject("worker"), UNIT), {
    dispatch_role: "implementation"
  });
  assert.deepEqual(deriveDispatchRole(subject("reviewer"), UNIT), {
    dispatch_role: "read_only"
  });
  assert.deepEqual(deriveDispatchRole(subject("redteam"), UNIT), {
    dispatch_role: "read_only"
  });
  assert.deepEqual(deriveDispatchRole(subject("decision_worker"), UNIT), {
    dispatch_role: "implementation"
  });
  assert.deepEqual(deriveDispatchRole(subject("orchestrator"), UNIT), {
    dispatch_role: "implementation"
  });
});

test("null and unmapped roles refuse with actionable axis diagnostics", () => {
  const nullResult = deriveDispatchRole(subject(null), UNIT);
  assert.equal(nullResult.refusal.dispatchable, false);
  assert.equal(nullResult.refusal.decision_code, "dispatch_readiness_axis_ambiguous");
  assert.equal(nullResult.refusal.axis_refusal.reason, "intended_agent_role_null");
  assert.equal(nullResult.refusal.axis_refusal.observed_field, "dispatch_intent.intended_agent_role");
  assert.equal(nullResult.refusal.axis_refusal.observed_value, null);
  assert.equal(nullResult.refusal.axis_refusal.remediation.argument, "dispatch_role");

  const unmappedResult = deriveDispatchRole(subject("constructor"), UNIT);
  assert.equal(unmappedResult.refusal.dispatchable, false);
  assert.equal(unmappedResult.refusal.decision_code, "dispatch_readiness_axis_ambiguous");
  assert.equal(
    unmappedResult.refusal.axis_refusal.reason,
    "intended_agent_role_has_no_readiness_axis"
  );
  assert.equal(unmappedResult.refusal.axis_refusal.observed_value, "constructor");
  assert.match(unmappedResult.refusal.reasons[0], /does not map/);

  const toStringResult = deriveDispatchRole(subject("toString"), UNIT);
  assert.equal(toStringResult.refusal.dispatchable, false);
  assert.equal(toStringResult.refusal.axis_refusal.observed_value, "toString");
});

test("derived read_only refuses only for implementation work, while explicit-axis callers remain independent", () => {
  const implementationResult = deriveDispatchRole(subject("redteam", "implementation"), UNIT);
  assert.equal(implementationResult.refusal.dispatchable, false);
  assert.equal(
    implementationResult.refusal.axis_refusal.reason,
    "derived_read_only_implementation_guard"
  );

  const reviewResult = deriveDispatchRole(subject("redteam", "review"), UNIT);
  assert.deepEqual(reviewResult, { dispatch_role: "read_only" });
  const implementationAxis = deriveDispatchRole(subject("worker", "implementation"), UNIT);
  assert.deepEqual(implementationAxis, { dispatch_role: "implementation" });
});

test("unmapped roles do not inherit the implementation guard", () => {
  const result = refuseDerivedAxis({
    subject: subject("constructor", "implementation"),
    unitAddress: UNIT
  });
  assert.equal(result.axis_refusal.reason, "intended_agent_role_has_no_readiness_axis");
  assert.equal(result.axis_refusal.observed_value, "constructor");
});

test("implementation units with unmapped roles publish the same axis refusal", async () => {
  const record = JSON.parse(await readFile("wiki/work-records/WK-1425.json", "utf8"));
  record.dispatch_intent.intended_agent_role = "constructor";
  const result = await validateWorkRecordDispatch({
    dir: ".",
    unitAddress: "WK-1425",
    recordStore: textRecordStore(JSON.stringify(record))
  });
  assert.equal(result.decision_code, "invalid_record");
  assert.equal(result.axis_refusal.reason, "intended_agent_role_has_no_readiness_axis");
  assert.equal(result.axis_refusal.observed_value, "constructor");
  assert.match(result.reasons.join(" "), /intended_agent_role/);
  assert.match(result.reasons.join(" "), /worker|reviewer|redteam|decision_worker|orchestrator/);
  assert.doesNotMatch(result.reasons[0], /read_only/);
});

test("report refusals retain the normal boolean report envelope", async () => {
  const result = await validateWorkRecordDispatchReport({
    dir: ".",
    unitAddress: UNIT,
    recordStore: {
      async pathExists() { return false; },
      async readText() { throw new Error("unreachable"); }
    }
  });
  assert.equal(result.report_mode, true);
  assert.equal(result.readiness.dispatchable, false);
});

test("public validation preserves a load failure instead of reporting axis ambiguity", async () => {
  const recordStore = {
    async pathExists() { return false; },
    async readText() { throw new Error("unreachable"); }
  };
  const result = await validateWorkRecordDispatch({
    dir: ".",
    unitAddress: "WK-9111",
    recordStore
  });
  assert.notEqual(result.decision_code, "dispatch_readiness_axis_ambiguous");
  assert.equal(result.decision_code, "missing_json_record");
});

test("refuseDerivedAxis returns a readiness refusal instead of dereferencing an absent source", () => {
  assert.doesNotThrow(() => refuseDerivedAxis({
    subject: subject(null),
    unitAddress: UNIT
  }));
  const refusal = refuseDerivedAxis({ subject: subject(null), unitAddress: UNIT });
  assert.equal(refusal.dispatchable, false);
  assert.equal(refusal.readiness, undefined);
});

test("loadDispatchSubject reads through the supplied recordStore seam", async () => {
  const calls = [];
  const recordStore = {
    async pathExists(path) {
      calls.push(["pathExists", path]);
      return true;
    },
    async readText(path) {
      calls.push(["readText", path]);
      return readFile("wiki/work-records/WK-1425.json", "utf8");
    }
  };

  const loaded = await loadDispatchSubject({
    dir: ".",
    unitAddress: "WK-1425",
    recordStore
  });
  assert.equal(loaded.id, "WK-1425");
  assert.deepEqual(calls.map(([method]) => method), ["pathExists", "readText"]);
});

test("invalid authored roles remain diagnostic evidence without selecting an axis on the default loader", async () => {
  const record = JSON.parse(await readFile("wiki/work-records/WK-1425.json", "utf8"));
  record.dispatch_intent.intended_agent_role = "constructor";
  await withOnDiskRecord(JSON.stringify(record), async (dir) => {
    for (const dispatch_role of [undefined, "implementation", "read_only"]) {
      const options = {
        dir,
        unitAddress: "WK-1425",
        ...(dispatch_role === undefined ? {} : { dispatch_role })
      };
      const strict = await validateWorkRecordDispatch(options);
      const report = await validateWorkRecordDispatchReport(options);
      assert.equal(strict.decision_code, "invalid_record");
      assert.equal(strict.axis_refusal.observed_value, "constructor");
      assert.equal(strict.axis_refusal.observed_field, "dispatch_intent.intended_agent_role");
      assert.equal(strict.axis_refusal.remediation.argument, "dispatch_role");
      assert.equal(report.readiness.decision_code, "invalid_record");
      assert.equal(report.readiness.axis_refusal.observed_value, "constructor");
      assert.equal(report.readiness.axis_refusal.observed_field, "dispatch_intent.intended_agent_role");
      assert.equal(report.readiness.axis_refusal.remediation.argument, "dispatch_role");
    }
  });
});

test("malformed records remain invalid_record across strict and report axes", async () => {
  await withOnDiskRecord("{ malformed", async (dir) => {
    for (const dispatch_role of [undefined, "implementation", "read_only"]) {
      const options = {
        dir,
        unitAddress: "WK-1425",
        ...(dispatch_role === undefined ? {} : { dispatch_role })
      };
      const strict = await validateWorkRecordDispatch(options);
      const report = await validateWorkRecordDispatchReport(options);
      assert.equal(strict.decision_code, "invalid_record");
      assert.equal(report.readiness.decision_code, "invalid_record");
    }
  });
});

test("missing records remain missing_json_record across strict and report axes", async () => {
  await withMissingRecord(async (dir) => {
    for (const dispatch_role of [undefined, "implementation", "read_only"]) {
      const options = {
        dir,
        unitAddress: "WK-1425",
        ...(dispatch_role === undefined ? {} : { dispatch_role })
      };
      const strict = await validateWorkRecordDispatch(options);
      const report = await validateWorkRecordDispatchReport(options);
      assert.equal(strict.decision_code, "missing_json_record");
      assert.equal(report.readiness.decision_code, "missing_json_record");
    }
  });
});

test("report-mode axis refusal is nested in the consumer readiness object", async () => {
  const record = JSON.parse(await readFile("wiki/work-records/WK-1425.json", "utf8"));
  record.dispatch_intent.intended_agent_role = "redteam";
  const result = await validateWorkRecordDispatchReport({
    dir: ".",
    unitAddress: "WK-1425",
    recordStore: textRecordStore(JSON.stringify(record)),
    graph_state: { status: "unavailable", reason: "test" }
  });
  assert.equal(result.report_mode, true);
  assert.equal(result.readiness.decision_code, "dispatch_readiness_axis_ambiguous");
  assert.equal(result.readiness.dispatchable, false);
  assert.equal(result.readiness.axis_refusal.reason, "derived_read_only_implementation_guard");
});

test("one public validation call shares one recordStore snapshot across axis and readiness", async () => {
  const calls = [];
  const record = JSON.parse(await readFile("wiki/work-records/WK-1425.json", "utf8"));
  record.work_kind = "implementation";
  record.dispatch_intent.intended_agent_role = "redteam";
  record.write_scope = [];
  const recordStore = {
    async pathExists(filePath) {
      calls.push(["pathExists", filePath]);
      return true;
    },
    async readText(filePath) {
      calls.push(["readText", filePath]);
      return JSON.stringify(record);
    }
  };
  const result = await validateWorkRecordDispatch({
    dir: ".",
    unitAddress: "WK-1425",
    recordStore
  });
  assert.equal(result.decision_code, "dispatch_readiness_axis_ambiguous");
  assert.equal(result.dispatchable, false);
  assert.deepEqual(calls.map(([method]) => method), ["pathExists", "readText"]);
});

test("derived read_only remains dispatchable for a review-shaped unit", async () => {
  const record = reviewRecord();
  record.review_purpose = "terminal_whole_wk";
  assertFixtureSchemaValid(record, "WK-1425");
  const result = await validateWorkRecordDispatch({
    dir: ".",
    unitAddress: "WK-1425",
    recordStore: textRecordStore(JSON.stringify(record)),
    graph_state: { status: "unavailable", reason: "test" }
  });
  assert.equal(result.dispatch_role, "read_only");
  assert.equal(result.dispatchable, true);
});

test("slice selection derives read_only for a terminal findings-only review slice", async () => {
  const record = reviewRecord("WK-1793", "SLICE-005");
  assertFixtureSchemaValid(record, "WK-1793#SLICE-005");
  const result = await validateWorkRecordDispatch({
    dir: ".",
    unitAddress: "WK-1793#SLICE-005",
    recordStore: textRecordStore(JSON.stringify(record)),
    graph_state: { status: "unavailable", reason: "test" }
  });
  assert.equal(result.dispatch_role, "read_only");
  assert.equal(result.dispatchable, true);
});

test("a rejected record read is shared by axis selection and readiness", async () => {
  for (const validate of [validateWorkRecordDispatch, validateWorkRecordDispatchReport]) {
    for (const dispatch_role of [undefined, "implementation", "read_only"]) {
      const calls = [];
      const recordStore = {
        async pathExists(filePath) {
          calls.push(["pathExists", filePath]);
          return true;
        },
        async readText(filePath) {
          calls.push(["readText", filePath]);
          throw new Error("snapshot read failed");
        }
      };
      const options = {
        dir: ".",
        unitAddress: "WK-1425",
        recordStore,
        ...(dispatch_role === undefined ? {} : { dispatch_role })
      };
      const result = await validate(options);
      const readiness = validate === validateWorkRecordDispatchReport
        ? result.readiness
        : result;
      assert.equal(readiness.decision_code, "missing_json_record");
      assert.equal(
        readiness.dispatch_role,
        dispatch_role === "read_only" ? "read_only" : "implementation"
      );
      assert.deepEqual(calls.map(([method]) => method), ["pathExists", "readText"]);
    }
  }
});

test("public validators preserve missing-slice decisions on omitted and explicit axes", async () => {
  const recordStore = textRecordStore(await readFile("wiki/work-records/WK-1892.json", "utf8"));
  for (const dispatch_role of [undefined, "implementation", "read_only"]) {
    const options = {
      dir: ".",
      unitAddress: "WK-1892#SLICE-999",
      recordStore,
      ...(dispatch_role === undefined ? {} : { dispatch_role })
    };
    const strict = await validateWorkRecordDispatch(options);
    const report = await validateWorkRecordDispatchReport(options);
    assert.equal(strict.decision_code, "missing_slice");
    assert.equal(report.report_mode, true);
    assert.equal(report.readiness.decision_code, "missing_slice");
  }
});
