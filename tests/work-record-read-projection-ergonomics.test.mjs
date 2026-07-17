import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";

import {
  bootstrapRepo,
  getWorkRecordSummary,
  getWikiRecord,
  readWikiPage
} from "../packages/wiki-core/src/index.mjs";

async function withTempDir(fn) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wiki-read-projection-test-"));
  try {
    await fn(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function makeSuppressedSlice(status, i, { agentNotes = undefined } = {}) {
  return {
    id: `${status}-slice-${i}`,
    title: `${status} slice ${i}`,
    work_kind: "implementation",
    status,
    priority: "high",
    owner: "unassigned",
    depends_on: [],
    write_scope: ["packages/some-file.mjs"],
    docs: ["AGENTS.md"],
    repo_paths: ["packages/some-file.mjs"],
    acceptance: {
      criteria: Array.from({ length: 5 }, (_, j) => `Criterion ${j + 1} for ${status}-slice-${i}: ${"detail ".repeat(30)}`),
      validation: ["npm test", "node --check packages/some-file.mjs"]
    },
    dispatch_intent: {
      intended_agent_role: "worker",
      target_unit: "slice",
      requires_graph_impact: false,
      requires_escalation: false
    },
    sections: {
      closure: {
        summary: `Closure for ${status}-slice-${i}: ` + "summary text ".repeat(100),
        validation: ["tests passed"],
        follow_ups: ["follow up item"]
      },
      ...(agentNotes === undefined ? {} : { agent_notes: agentNotes })
    }
  };
}

function makeDoneSlice(i, opts) {
  return makeSuppressedSlice("done", i, opts);
}

function makeWorkingSlice(id, status, { agentNotes = undefined } = {}) {
  return {
    id,
    title: `Working slice: ${id}`,
    work_kind: "implementation",
    status,
    priority: "high",
    owner: "unassigned",
    depends_on: ["done-slice-0"],
    write_scope: ["packages/active-file.mjs"],
    docs: ["AGENTS.md", "docs/mcp-integration.md"],
    repo_paths: ["packages/active-file.mjs", "tests/active.test.mjs"],
    acceptance: {
      criteria: [`Criterion A for ${id}`, `Criterion B for ${id}`],
      validation: ["node --test tests/active.test.mjs"]
    },
    dispatch_intent: {
      intended_agent_role: "worker",
      target_unit: "slice",
      requires_graph_impact: false,
      requires_escalation: false
    },
    sections: {
      closure: null,
      ...(agentNotes === undefined ? {} : { agent_notes: agentNotes })
    }
  };
}

function buildCurrentSlices(count = 3) {
  const base = [
    makeWorkingSlice("active-slice", "active", { agentNotes: "string note body" }),
    makeWorkingSlice("todo-slice", "todo"),
    makeWorkingSlice("blocked-slice", "blocked", { agentNotes: ["array note one", "array note two"] })
  ];
  if (count <= base.length) {
    return base.slice(0, count);
  }
  return [
    ...base,
    ...Array.from({ length: count - base.length }, (_, i) =>
      makeWorkingSlice(`todo-extra-slice-${i}`, "todo", {
        agentNotes: i % 2 === 0 ? `extra string note ${i}` : undefined
      })
    )
  ];
}

function buildTrackerFixture(
  id,
  numDoneSlices,
  { currentSliceCount = 3, cancelledSliceCount = 1, parkedSliceCount = 1 } = {}
) {
  const slices = [
    ...Array.from({ length: numDoneSlices }, (_, i) => makeDoneSlice(i)),
    ...Array.from({ length: cancelledSliceCount }, (_, i) =>
      makeSuppressedSlice("cancelled", i, { agentNotes: "cancelled note body" })
    ),
    ...Array.from({ length: parkedSliceCount }, (_, i) =>
      makeSuppressedSlice("parked", i, { agentNotes: ["parked note one", "parked note two"] })
    ),
    ...buildCurrentSlices(currentSliceCount)
  ];
  return {
    schema_version: "work-record.v1",
    id,
    repo: "agent-chassis/agent-chassis",
    title: "Projection ergonomics test tracker",
    record_kind: "work_item",
    work_kind: "tracker",
    status: "active",
    priority: "high",
    owner: "unassigned",
    created: "2026-01-01",
    updated: "2026-01-01",
    initiative: null,
    docs: [],
    repo_paths: [],
    write_scope: [],
    depends_on: [],
    blocks: [],
    related: [],
    dispatch_intent: {
      intended_agent_role: "worker",
      target_unit: "record",
      requires_graph_impact: false,
      requires_escalation: false
    },
    acceptance: { criteria: [], validation: [] },
    sections: {
      summary: "Test fixture for projection ergonomics.",
      agent_notes: "record-level note body must stay out of compact projections",
      closure: null
    },
    children: [],
    slices,
    escalations: [],
    projections: [],
    migration: null,
    derived_evidence: []
  };
}

async function installFixture(tempDir, fixture) {
  const target = path.join(tempDir, "wiki", "work-records", `${fixture.id}.json`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  return target;
}

test("core reads reserve the complete work-record namespaces to anchored flat paths", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/reserved-read-path-test" });
    for (const reservedPath of [
      "wiki/work-records/nested/WK-9900.json",
      "wiki/work-records//WK-9900.json",
      "wiki//work-records/WK-9900.json",
      "wiki/./work-records/WK-9900.json",
      "wiki/work-records/evidence/nested/WK-9900.graph.json",
      "wiki/work-records/evidence//WK-9900.graph.json",
      "wiki/work-records/not-a-record.md"
    ]) {
      await assert.rejects(
        readWikiPage({ dir: tempDir, path: reservedPath }),
        /Malformed reserved work-record path/
      );
    }

    const genericPath = path.join(tempDir, "docs", "reserved-path-generic.md");
    await writeFile(genericPath, "# Safe generic page\n", "utf8");
    const generic = await readWikiPage({
      dir: tempDir,
      path: "docs/reserved-path-generic.md"
    });
    assert.equal(generic.format, "markdown");
  });
});

test("tracker compact default via readWikiPage: slice_counts and working_slices present, no full slice bodies", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/projection-test" });
    const fixture = buildTrackerFixture("WK-9901", 20);
    await installFixture(tempDir, fixture);

    const result = await readWikiPage({
      dir: tempDir,
      path: "wiki/work-records/WK-9901.json"
    });

    assert.equal(result.format, "json-work-record");
    assert.equal(result.work_kind, "tracker");

    assert.ok(result.slice_counts, "compact default must include slice_counts");
    assert.equal(result.slice_counts.total, 25, "total must count all slices");
    assert.equal(result.slice_counts.by_status.done, 20, "by_status.done must equal done-slice count");
    assert.equal(result.slice_counts.by_status.cancelled, 1);
    assert.equal(result.slice_counts.by_status.parked, 1);
    assert.equal(result.slice_counts.by_status.active, 1);
    assert.equal(result.slice_counts.by_status.todo, 1);
    assert.equal(result.slice_counts.by_status.blocked, 1);

    assert.deepEqual(result.slice_detail_omissions.suppressed_statuses, ["done", "cancelled", "parked"]);
    assert.equal(result.slice_detail_omissions.suppressed_total, 22);
    assert.equal(result.slice_detail_omissions.suppressed_by_status.done, 20);
    assert.equal(result.slice_detail_omissions.suppressed_by_status.cancelled, 1);
    assert.equal(result.slice_detail_omissions.suppressed_by_status.parked, 1);
    assert.equal(result.slice_detail_omissions.current_slices_total, 3);
    assert.equal(result.slice_detail_omissions.current_slices_returned, 3);
    assert.equal(result.slice_detail_omissions.current_slices_truncated, false);
    assert.equal(result.slice_detail_omissions.current_slices_omitted_count, 0);

    assert.ok(Array.isArray(result.working_slices), "compact default must include working_slices");
    assert.equal(result.working_slices.length, 3, "working_slices must contain only non-suppressed slices");

    const sliceIds = result.working_slices.map((s) => s.id);
    assert.ok(sliceIds.includes("active-slice"));
    assert.ok(sliceIds.includes("todo-slice"));
    assert.ok(sliceIds.includes("blocked-slice"));

    assert.equal(
      result.working_slices.some((s) => s.id.startsWith("done-slice-")),
      false,
      "working_slices must not include done slices"
    );
    assert.equal(
      result.working_slices.some((s) => s.id.startsWith("cancelled-slice-")),
      false,
      "working_slices must not include cancelled slices"
    );
    assert.equal(
      result.working_slices.some((s) => s.id.startsWith("parked-slice-")),
      false,
      "working_slices must not include parked slices"
    );

    const byId = Object.fromEntries(result.working_slices.map((s) => [s.id, s]));
    assert.equal(byId["active-slice"].agent_notes_bytes, Buffer.byteLength("string note body", "utf8"));
    assert.equal(byId["todo-slice"].agent_notes_bytes, 0);
    assert.equal(
      byId["blocked-slice"].agent_notes_bytes,
      Buffer.byteLength(["array note one", "array note two"].join("\n"), "utf8")
    );

    assert.equal(
      Object.prototype.hasOwnProperty.call(result, "record"),
      false,
      "compact default must not include full record"
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(result, "agent_notes"),
      false,
      "compact default must not include record-level agent_notes body"
    );
    assert.equal(JSON.stringify(result).includes("record-level note body"), false);
    assert.equal(JSON.stringify(result).includes("string note body"), false);
    assert.equal(JSON.stringify(result).includes("array note one"), false);
    assert.equal(JSON.stringify(result).includes("cancelled note body"), false);
    assert.equal(JSON.stringify(result).includes("parked note one"), false);
  });
});

test("tracker compact default: current-slice cap is explicit when current work is truncated", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/projection-cap-test" });
    const fixture = buildTrackerFixture("WK-9912", 2, { currentSliceCount: 35 });
    await installFixture(tempDir, fixture);

    const result = await readWikiPage({
      dir: tempDir,
      path: "wiki/work-records/WK-9912.json"
    });

    assert.equal(result.slice_counts.total, 39, "total must include suppressed and current slices");
    assert.equal(result.slice_counts.by_status.done, 2);
    assert.equal(result.slice_counts.by_status.cancelled, 1);
    assert.equal(result.slice_counts.by_status.parked, 1);
    assert.equal(result.slice_counts.by_status.todo, 33);
    assert.equal(result.slice_counts.by_status.active, 1);
    assert.equal(result.slice_counts.by_status.blocked, 1);

    assert.equal(result.working_slices.length, 30, "default current-slice projection keeps the documented cap");
    assert.equal(result.slice_detail_omissions.current_slices_total, 35);
    assert.equal(result.slice_detail_omissions.current_slices_returned, 30);
    assert.equal(result.slice_detail_omissions.current_slices_limit, 30);
    assert.equal(result.slice_detail_omissions.current_slices_truncated, true);
    assert.equal(result.slice_detail_omissions.current_slices_omitted_count, 5);

    const returnedIds = result.working_slices.map((s) => s.id);
    assert.equal(returnedIds.includes("todo-extra-slice-26"), true);
    assert.equal(returnedIds.includes("todo-extra-slice-27"), false);
    assert.equal(returnedIds.some((id) => id.startsWith("done-slice-")), false);
    assert.equal(returnedIds.some((id) => id.startsWith("cancelled-slice-")), false);
    assert.equal(returnedIds.some((id) => id.startsWith("parked-slice-")), false);
  });
});

test("tracker compact default: working_slice summaries omit acceptance bodies, closure, write_scope, docs", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/projection-test-2" });
    const fixture = buildTrackerFixture("WK-9902", 5);
    await installFixture(tempDir, fixture);

    const result = await readWikiPage({ dir: tempDir, path: "wiki/work-records/WK-9902.json" });

    assert.ok(Array.isArray(result.working_slices));
    for (const ws of result.working_slices) {
      assert.equal(typeof ws.id, "string");
      assert.equal(typeof ws.title, "string");
      assert.equal(typeof ws.status, "string");
      assert.equal(typeof ws.acceptance_criteria_count, "number");
      assert.equal(typeof ws.validation_count, "number");
      assert.equal(typeof ws.agent_notes_bytes, "number");
      assert.ok(ws.acceptance_criteria_count > 0, "acceptance_criteria_count must reflect actual criteria");

      assert.equal(
        Object.prototype.hasOwnProperty.call(ws, "acceptance"),
        false,
        "working slice summary must not include acceptance object"
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(ws, "write_scope"),
        false,
        "working slice summary must not include write_scope"
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(ws, "docs"),
        false,
        "working slice summary must not include docs"
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(ws, "sections"),
        false,
        "working slice summary must not include sections"
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(ws, "agent_notes"),
        false,
        "working slice summary must not include agent note bodies"
      );
    }
  });
});

test("tracker compact default: response size does not scale with done-slice count", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/projection-scale-test" });

    const fixture5 = buildTrackerFixture("WK-9910", 5);
    const fixture50 = buildTrackerFixture("WK-9911", 50);
    await installFixture(tempDir, fixture5);
    await installFixture(tempDir, fixture50);

    const result5 = await readWikiPage({ dir: tempDir, path: "wiki/work-records/WK-9910.json" });
    const result50 = await readWikiPage({ dir: tempDir, path: "wiki/work-records/WK-9911.json" });

    const size5 = JSON.stringify(result5).length;
    const size50 = JSON.stringify(result50).length;

    assert.ok(
      size50 - size5 < 500,
      `compact default size must not scale with done-slice count: size5=${size5}, size50=${size50}, diff=${size50 - size5}`
    );
  });
});

test("tracker compact default via getWikiRecord: same projection behavior", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/projection-get-record-test" });
    const fixture = buildTrackerFixture("WK-9903", 10);
    await installFixture(tempDir, fixture);

    const result = await getWikiRecord({ dir: tempDir, id: "WK-9903" });

    assert.equal(result.format, "json-work-record");
    assert.equal(result.work_kind, "tracker");
    assert.ok(result.slice_counts, "getWikiRecord compact must include slice_counts");
    assert.equal(result.slice_counts.by_status.done, 10);
    assert.equal(result.slice_counts.by_status.cancelled, 1);
    assert.equal(result.slice_counts.by_status.parked, 1);
    assert.equal(result.slice_detail_omissions.suppressed_by_status.done, 10);
    assert.equal(result.slice_detail_omissions.suppressed_by_status.cancelled, 1);
    assert.equal(result.slice_detail_omissions.suppressed_by_status.parked, 1);
    assert.ok(Array.isArray(result.working_slices));
    assert.equal(result.working_slices.length, 3);
    assert.equal(result.working_slices.every((s) => typeof s.agent_notes_bytes === "number"), true);
    assert.equal(JSON.stringify(result).includes("record-level note body"), false);
    assert.equal(JSON.stringify(result).includes("string note body"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(result, "record"), false);
  });
});

test("selected_slice: returns the canonical selected-unit contract without sibling history", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/projection-slice-test" });
    const fixture = buildTrackerFixture("WK-9904", 10);
    await installFixture(tempDir, fixture);

    const result = await readWikiPage({
      dir: tempDir,
      path: "wiki/work-records/WK-9904.json",
      selected_slice: "active-slice"
    });

    assert.equal(result.selected_slice_found, true);
    assert.equal(result.selected_slice_id, "active-slice");

    const sl = result.selected_slice;
    assert.ok(sl, "selected_slice must be present");
    assert.equal(sl.id, "active-slice");
    assert.equal(sl.status, "active");

    assert.ok(sl.acceptance, "selected_slice must include acceptance");
    assert.ok(Array.isArray(sl.acceptance.criteria) && sl.acceptance.criteria.length > 0);

    assert.ok(Array.isArray(sl.write_scope), "selected_slice must include write_scope");
    assert.ok(Array.isArray(sl.repo_paths), "selected_slice must include repo_paths");
    assert.deepEqual(
      sl.read_scope,
      ["AGENTS.md", "docs/mcp-integration.md"],
      "legacy docs must project through canonical read_scope"
    );
    assert.equal(Object.hasOwn(sl, "docs"), false);
    assert.ok(sl.dispatch_intent, "selected_slice must include dispatch_intent");
    assert.equal(sl.agent_notes, "string note body");
    assert.equal(Object.hasOwn(sl, "agent_notes_bytes"), false);
    assert.equal(Object.hasOwn(sl, "closure_summary"), false);
    assert.deepEqual(sl.sections, { agent_notes: "string note body" });

    assert.equal(
      Object.prototype.hasOwnProperty.call(result, "record"),
      false,
      "sibling slice history must not appear in result"
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(result, "slice_counts"),
      false,
      "selected_slice compact response must not include sibling slice counts"
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(result, "working_slices"),
      false,
      "selected_slice compact response must not include sibling working slices"
    );
  });
});

test("selected_slice sections exclude authored closure outside the agent_notes allowlist", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/projection-done-slice-test" });
    const fixture = buildTrackerFixture("WK-9905", 5);
    await installFixture(tempDir, fixture);

    const result = await readWikiPage({
      dir: tempDir,
      path: "wiki/work-records/WK-9905.json",
      selected_slice: "done-slice-0"
    });

    assert.equal(result.selected_slice_found, true);
    const sl = result.selected_slice;
    assert.equal(sl.status, "done");
    assert.deepEqual(sl.sections, {});
    assert.equal(Object.hasOwn(sl.sections, "closure"), false);
    assert.equal(Object.hasOwn(sl, "closure_summary"), false);
  });
});

test("selected_slice not found: selected_slice_found is false, selected_slice is null", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/projection-missing-slice-test" });
    const fixture = buildTrackerFixture("WK-9906", 3);
    await installFixture(tempDir, fixture);

    const result = await readWikiPage({
      dir: tempDir,
      path: "wiki/work-records/WK-9906.json",
      selected_slice: "nonexistent-slice"
    });

    assert.equal(result.selected_slice_found, false);
    assert.equal(result.selected_slice_id, "nonexistent-slice");
    assert.equal(result.selected_slice, null);
  });
});

test("selected_slice via getWikiRecord: same behavior", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/projection-get-record-slice-test" });
    const fixture = buildTrackerFixture("WK-9907", 5);
    await installFixture(tempDir, fixture);

    const result = await getWikiRecord({
      dir: tempDir,
      id: "WK-9907",
      selected_slice: "todo-slice"
    });

    assert.equal(result.selected_slice_found, true);
    assert.equal(result.selected_slice.id, "todo-slice");
    assert.ok(result.selected_slice.acceptance);
    assert.equal(result.selected_slice.acceptance.criteria.length, 2);
    assert.equal(Object.hasOwn(result.selected_slice, "agent_notes"), false);
    assert.equal(Object.hasOwn(result.selected_slice, "agent_notes_bytes"), false);
  });
});

test("selected_slice with array-form notes returns the authored selected-unit note body", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/projection-array-note-slice-test" });
    const fixture = buildTrackerFixture("WK-9913", 5);
    await installFixture(tempDir, fixture);

    const result = await getWikiRecord({
      dir: tempDir,
      id: "WK-9913",
      selected_slice: "blocked-slice"
    });

    assert.equal(result.selected_slice_found, true);
    assert.deepEqual(result.selected_slice.agent_notes, ["array note one", "array note two"]);
    assert.equal(Object.hasOwn(result.selected_slice, "agent_notes_bytes"), false);
  });
});

test("selected_slice preserves canonical empty notes and nullable non-negative budgets", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/projection-typed-slice-test" });
    const fixture = buildTrackerFixture("WK-9917", 2);
    const active = fixture.slices.find((slice) => slice.id === "active-slice");
    active.sections.agent_notes = "";
    active.expected_changed_line_budget = null;
    const blocked = fixture.slices.find((slice) => slice.id === "blocked-slice");
    blocked.sections.agent_notes = [];
    blocked.expected_changed_line_budget = 0;
    await installFixture(tempDir, fixture);

    const emptyString = await readWikiPage({
      dir: tempDir,
      path: "wiki/work-records/WK-9917.json",
      selected_slice: "active-slice"
    });
    assert.equal(emptyString.selected_slice.agent_notes, "");
    assert.equal(emptyString.selected_slice.sections.agent_notes, "");
    assert.equal(emptyString.selected_slice.expected_changed_line_budget, null);

    const emptyArray = await getWikiRecord({
      dir: tempDir,
      id: "WK-9917",
      selected_slice: "blocked-slice"
    });
    assert.deepEqual(emptyArray.selected_slice.agent_notes, []);
    assert.deepEqual(emptyArray.selected_slice.sections.agent_notes, []);
    assert.equal(emptyArray.selected_slice.expected_changed_line_budget, 0);
  });
});

test("work-record summary compact default: matches read/get suppressed-status and note-byte policy", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/projection-summary-test" });
    const fixture = buildTrackerFixture("WK-9914", 7, {
      cancelledSliceCount: 2,
      parkedSliceCount: 3
    });
    await installFixture(tempDir, fixture);

    const readResult = await readWikiPage({
      dir: tempDir,
      path: "wiki/work-records/WK-9914.json"
    });
    const summaryResult = await getWorkRecordSummary({ dir: tempDir, unit: "WK-9914" });

    assert.equal(summaryResult.valid, true);
    assert.equal(summaryResult.selected_unit.address, "WK-9914");

    const summary = summaryResult.summary;
    assert.equal(summary.work_kind, "tracker");
    assert.deepEqual(summary.slice_detail_omissions.statuses, ["done", "cancelled", "parked"]);
    assert.equal(summary.slice_detail_omissions.count, 12);
    assert.equal(summary.slice_detail_omissions.by_status.done, 7);
    assert.equal(summary.slice_detail_omissions.by_status.cancelled, 2);
    assert.equal(summary.slice_detail_omissions.by_status.parked, 3);
    assert.equal(summary.slice_count, readResult.slice_counts.total);
    assert.equal(summary.slice_status_counts.done, readResult.slice_counts.by_status.done);
    assert.equal(summary.slice_status_counts.cancelled, readResult.slice_counts.by_status.cancelled);
    assert.equal(summary.slice_status_counts.parked, readResult.slice_counts.by_status.parked);
    assert.equal(summary.slice_status_counts.active, readResult.slice_counts.by_status.active);
    assert.equal(summary.slice_status_counts.todo, readResult.slice_counts.by_status.todo);
    assert.equal(summary.slice_status_counts.blocked, readResult.slice_counts.by_status.blocked);

    assert.equal(summary.slices.length, 3, "summary must include only non-suppressed slice rows");
    const summaryIds = summary.slices.map((s) => s.id);
    assert.deepEqual(summaryIds.sort(), ["active-slice", "blocked-slice", "todo-slice"]);
    assert.equal(summaryIds.some((id) => id.startsWith("done-slice-")), false);
    assert.equal(summaryIds.some((id) => id.startsWith("cancelled-slice-")), false);
    assert.equal(summaryIds.some((id) => id.startsWith("parked-slice-")), false);

    const byId = Object.fromEntries(summary.slices.map((s) => [s.id, s]));
    assert.equal(byId["active-slice"].agent_notes_bytes, Buffer.byteLength("string note body", "utf8"));
    assert.equal(byId["todo-slice"].agent_notes_bytes, 0);
    assert.equal(
      byId["blocked-slice"].agent_notes_bytes,
      Buffer.byteLength(["array note one", "array note two"].join("\n"), "utf8")
    );

    for (const sliceSummary of summary.slices) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(sliceSummary, "agent_notes"),
        false,
        "WK-level summary slice rows must not include note bodies"
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(sliceSummary, "sections"),
        false,
        "WK-level summary slice rows must not include sections"
      );
    }
    assert.equal(
      Object.prototype.hasOwnProperty.call(summary, "agent_notes"),
      false,
      "WK-level summary must not include record-level agent notes"
    );
    assert.equal(JSON.stringify(summary).includes("record-level note body"), false);
    assert.equal(JSON.stringify(summary).includes("string note body"), false);
    assert.equal(JSON.stringify(summary).includes("array note one"), false);
    assert.equal(JSON.stringify(summary).includes("cancelled note body"), false);
    assert.equal(JSON.stringify(summary).includes("parked note one"), false);
  });
});

test("work-record summary selected slice: includes selected notes and shared byte count", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/projection-summary-slice-test" });
    const fixture = buildTrackerFixture("WK-9915", 5);
    await installFixture(tempDir, fixture);

    const stringNoteResult = await getWorkRecordSummary({
      dir: tempDir,
      unit: "WK-9915#active-slice"
    });
    assert.equal(stringNoteResult.valid, true);
    assert.equal(stringNoteResult.selected_unit.kind, "slice");
    assert.equal(stringNoteResult.summary.selected_unit_summary.id, "active-slice");
    assert.equal(stringNoteResult.summary.selected_unit_summary.agent_notes, "string note body");
    assert.equal(
      stringNoteResult.summary.selected_unit_summary.agent_notes_bytes,
      Buffer.byteLength("string note body", "utf8")
    );

    const arrayNoteResult = await getWorkRecordSummary({
      dir: tempDir,
      unit: "WK-9915#blocked-slice"
    });
    assert.equal(arrayNoteResult.valid, true);
    assert.equal(arrayNoteResult.summary.selected_unit_summary.id, "blocked-slice");
    assert.deepEqual(
      arrayNoteResult.summary.selected_unit_summary.agent_notes,
      ["array note one", "array note two"]
    );
    assert.equal(
      arrayNoteResult.summary.selected_unit_summary.agent_notes_bytes,
      Buffer.byteLength(["array note one", "array note two"].join("\n"), "utf8")
    );

    const noNoteResult = await getWorkRecordSummary({
      dir: tempDir,
      unit: "WK-9915#todo-slice"
    });
    assert.equal(noNoteResult.valid, true);
    assert.equal(noNoteResult.summary.selected_unit_summary.agent_notes, null);
    assert.equal(noNoteResult.summary.selected_unit_summary.agent_notes_bytes, 0);
  });
});

test("work-record summary compact default: WK-0732-shaped tracker stays bounded", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/projection-summary-scale-test" });
    const fixture = buildTrackerFixture("WK-9916", 92, {
      cancelledSliceCount: 10,
      parkedSliceCount: 8,
      currentSliceCount: 13
    });
    await installFixture(tempDir, fixture);

    const result = await getWorkRecordSummary({ dir: tempDir, unit: "WK-9916" });
    const summary = result.summary;
    const serializedBytes = Buffer.byteLength(JSON.stringify(result), "utf8");

    assert.equal(result.valid, true);
    assert.equal(summary.slice_count, 123);
    assert.equal(summary.slice_status_counts.done, 92);
    assert.equal(summary.slice_status_counts.cancelled, 10);
    assert.equal(summary.slice_status_counts.parked, 8);
    assert.equal(summary.slice_detail_omissions.count, 110);
    assert.equal(summary.slices.length, 13, "summary should include only current/non-suppressed rows");
    assert.ok(
      serializedBytes < 20000,
      `WK-0732-shaped compact summary must stay comfortably bounded: ${serializedBytes} bytes`
    );
    assert.equal(JSON.stringify(summary).includes("Closure for done-slice-0"), false);
    assert.equal(JSON.stringify(summary).includes("record-level note body"), false);
    assert.equal(JSON.stringify(summary).includes("extra string note"), false);
  });
});

test("include_record:true restores full slices array; suppresses tracker projection fields", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/projection-full-record-test" });
    const fixture = buildTrackerFixture("WK-9908", 15);
    await installFixture(tempDir, fixture);

    const result = await readWikiPage({
      dir: tempDir,
      path: "wiki/work-records/WK-9908.json",
      include_record: true
    });

    assert.ok(result.record, "include_record:true must include full record");
    assert.ok(Array.isArray(result.record.slices));
    assert.equal(result.record.slices.length, 20, "full record must include all slices (15 done + 2 suppressed + 3 working)");

    assert.equal(
      Object.prototype.hasOwnProperty.call(result, "slice_counts"),
      false,
      "include_record must suppress slice_counts tracker projection"
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(result, "working_slices"),
      false,
      "include_record must suppress working_slices tracker projection"
    );
  });
});

test("verbose:true restores full slices array; suppresses tracker projection fields", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/projection-verbose-test" });
    const fixture = buildTrackerFixture("WK-9909", 10);
    await installFixture(tempDir, fixture);

    const result = await readWikiPage({
      dir: tempDir,
      path: "wiki/work-records/WK-9909.json",
      verbose: true
    });

    assert.ok(result.record, "verbose:true must include full record");
    assert.ok(Array.isArray(result.record.slices));
    assert.equal(result.record.slices.length, 15, "verbose must include all slices (10 done + 2 suppressed + 3 working)");

    assert.equal(
      Object.prototype.hasOwnProperty.call(result, "slice_counts"),
      false,
      "verbose must suppress compact tracker projection fields"
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(result, "working_slices"),
      false,
      "verbose must suppress compact tracker projection fields"
    );
  });
});

function makeGraphSidecarEntry({ address, recordId, sliceId, replayDetailAvailable, entryDigest }) {
  const unit = {
    kind: sliceId ? "slice" : "work_item",
    address,
    record_id: recordId,
    slice_id: sliceId ?? null
  };
  if (replayDetailAvailable) {
    return {
      unit,
      replay_detail_available: true,
      graph_entry_digest: entryDigest,
      raw_evidence_digest: `sha256:${"a".repeat(64)}`,
      graph_impact: {
        query_kind: "graph_impact_paths",
        input_paths: ["packages/wiki-core/src/x.mjs"],
        validated_paths: ["packages/wiki-core/src/x.mjs"],
        graph_nodes: ["node-1", "node-2"],
        graph_edges: ["edge-1"],
        canonical_refs: ["ref-1"]
      },
      graph_impact_summary: { kind: "graph_impact_agent_summary", query_kind: "graph_impact_paths" },
      graph_impact_summary_ref: {
        raw_evidence_digest: `sha256:${"a".repeat(64)}`,
        summary: { kind: "graph_impact_agent_summary", query_kind: "graph_impact_paths" }
      }
    };
  }
  return {
    unit,
    replay_detail_available: false,
    graph_entry_digest: entryDigest,
    raw_evidence_digest: `sha256:${"c".repeat(64)}`,
    graph_impact_summary_ref: {
      raw_evidence_digest: `sha256:${"c".repeat(64)}`,
      input_paths: ["packages/wiki-core/src/y.mjs"],
      validated_paths: ["packages/wiki-core/src/y.mjs"]
    }
  };
}

function buildGraphSidecarFixture(recordId, { withRecordEntry = true } = {}) {
  return {
    schema_version: "work-record-graph-evidence-sidecar.v1",
    record_id: recordId,
    generated_at: "2026-05-31T00:00:00Z",
    updated_at: "2026-05-31T00:00:00Z",
    generator: { name: "agent-chassis", version: "0.2.0" },
    record: withRecordEntry
      ? makeGraphSidecarEntry({
          address: recordId,
          recordId,
          sliceId: null,
          replayDetailAvailable: true,
          entryDigest: `sha256:${"d".repeat(64)}`
        })
      : null,
    slices: {
      "slice-one": makeGraphSidecarEntry({
        address: `${recordId}#slice-one`,
        recordId,
        sliceId: "slice-one",
        replayDetailAvailable: true,
        entryDigest: `sha256:${"e".repeat(64)}`
      }),
      "slice-two": makeGraphSidecarEntry({
        address: `${recordId}#slice-two`,
        recordId,
        sliceId: "slice-two",
        replayDetailAvailable: false,
        entryDigest: `sha256:${"f".repeat(64)}`
      })
    }
  };
}

async function installGraphSidecar(tempDir, recordId, fixture) {
  const target = path.join(tempDir, "wiki", "work-records", "evidence", `${recordId}.graph.json`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  return target;
}

test("graph sidecar compact default: ids/counts/digests only, no full replay payloads", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/graph-sidecar-compact-test" });
    await installGraphSidecar(tempDir, "WK-9930", buildGraphSidecarFixture("WK-9930"));

    const result = await readWikiPage({
      dir: tempDir,
      path: "wiki/work-records/evidence/WK-9930.graph.json"
    });

    assert.equal(result.format, "graph-evidence-sidecar");
    assert.equal(result.schema_version, "work-record-graph-evidence-sidecar.v1");
    assert.equal(result.record_id, "WK-9930");
    assert.equal(result.generated_at, "2026-05-31T00:00:00Z");
    assert.match(result.graph_sidecar_digest, /^sha256:[0-9a-f]{64}$/);

    assert.ok(result.record_entry, "compact default must include record-entry availability summary");
    assert.equal(result.record_entry.available, true);
    assert.equal(result.record_entry.graph_entry_digest, `sha256:${"d".repeat(64)}`);
    assert.equal(result.record_entry.replay_detail_available, true);
    assert.equal(
      Object.prototype.hasOwnProperty.call(result.record_entry, "graph_impact"),
      false,
      "compact record-entry summary must not embed full graph_impact replay payload"
    );

    assert.equal(result.slice_count, 2);
    assert.equal(result.slices.length, 2);
    const byId = Object.fromEntries(result.slices.map((s) => [s.slice_id, s]));
    assert.deepEqual(Object.keys(byId).sort(), ["slice-one", "slice-two"]);
    assert.equal(byId["slice-one"].unit_address, "WK-9930#slice-one");
    assert.equal(byId["slice-one"].graph_entry_digest, `sha256:${"e".repeat(64)}`);
    assert.equal(byId["slice-one"].replay_detail_available, true);
    assert.equal(byId["slice-two"].replay_detail_available, false);

    for (const sliceSummary of result.slices) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(sliceSummary, "graph_impact"),
        false,
        "compact slice summary must not embed full graph_impact replay payload"
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(sliceSummary, "graph_impact_summary"),
        false,
        "compact slice summary must not embed graph_impact_summary"
      );
    }

    assert.equal(
      Object.prototype.hasOwnProperty.call(result, "sidecar"),
      false,
      "compact default must not include the full sidecar"
    );
    assert.equal(
      JSON.stringify(result).includes("graph_nodes"),
      false,
      "compact default must not leak raw graph nodes/edges"
    );
  });
});

test("graph sidecar selected_slice: returns one slice replay entry without sibling entries", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/graph-sidecar-slice-test" });
    await installGraphSidecar(tempDir, "WK-9931", buildGraphSidecarFixture("WK-9931"));

    const result = await readWikiPage({
      dir: tempDir,
      path: "wiki/work-records/evidence/WK-9931.graph.json",
      selected_slice: "slice-one"
    });

    assert.equal(result.format, "graph-evidence-sidecar");
    assert.equal(result.selected_slice_id, "slice-one");
    assert.equal(result.selected_slice_found, true);

    const entry = result.selected_slice;
    assert.ok(entry, "selected_slice must return the slice entry");
    assert.equal(entry.unit.address, "WK-9931#slice-one");
    assert.equal(entry.replay_detail_available, true);
    assert.ok(entry.graph_impact, "selected slice replay entry must include full graph_impact");
    assert.ok(Array.isArray(entry.graph_impact.graph_nodes));

    assert.equal(
      Object.prototype.hasOwnProperty.call(result, "slices"),
      false,
      "selected_slice must not include the sibling slices map/list"
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(result, "record_entry"),
      false,
      "selected_slice must not include the record entry"
    );
    assert.equal(
      JSON.stringify(result).includes("slice-two"),
      false,
      "selected_slice must not leak sibling slice entries"
    );
  });
});

test("graph sidecar selected_slice not found: selected_slice_found false, selected_slice null", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/graph-sidecar-missing-slice-test" });
    await installGraphSidecar(tempDir, "WK-9932", buildGraphSidecarFixture("WK-9932"));

    const result = await readWikiPage({
      dir: tempDir,
      path: "wiki/work-records/evidence/WK-9932.graph.json",
      selected_slice: "nonexistent"
    });

    assert.equal(result.selected_slice_id, "nonexistent");
    assert.equal(result.selected_slice_found, false);
    assert.equal(result.selected_slice, null);
  });
});

test("graph sidecar selected_record: returns only the record-level entry", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/graph-sidecar-record-test" });
    await installGraphSidecar(tempDir, "WK-9933", buildGraphSidecarFixture("WK-9933"));

    const result = await readWikiPage({
      dir: tempDir,
      path: "wiki/work-records/evidence/WK-9933.graph.json",
      selected_record: true
    });

    assert.equal(result.format, "graph-evidence-sidecar");
    assert.equal(result.selected_record, true);
    assert.equal(result.record_entry_found, true);

    const entry = result.record_entry;
    assert.ok(entry, "selected_record must return the record entry");
    assert.equal(entry.unit.address, "WK-9933");
    assert.ok(entry.graph_impact, "record replay entry must include full graph_impact");

    assert.equal(
      Object.prototype.hasOwnProperty.call(result, "slices"),
      false,
      "selected_record must not include the slices map/list"
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(result, "selected_slice"),
      false,
      "selected_record must not include a selected_slice field"
    );
    assert.equal(
      JSON.stringify(result).includes("slice-one"),
      false,
      "selected_record must not leak slice entries"
    );
  });
});

test("graph sidecar selected_record on sidecar with no record entry: record_entry_found false", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/graph-sidecar-no-record-test" });
    await installGraphSidecar(
      tempDir,
      "WK-9934",
      buildGraphSidecarFixture("WK-9934", { withRecordEntry: false })
    );

    const result = await readWikiPage({
      dir: tempDir,
      path: "wiki/work-records/evidence/WK-9934.graph.json",
      selected_record: true
    });

    assert.equal(result.selected_record, true);
    assert.equal(result.record_entry_found, false);
    assert.equal(result.record_entry, null);
  });
});

test("graph sidecar verbose / include_record: returns the full sidecar", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/graph-sidecar-verbose-test" });
    await installGraphSidecar(tempDir, "WK-9935", buildGraphSidecarFixture("WK-9935"));

    const verbose = await readWikiPage({
      dir: tempDir,
      path: "wiki/work-records/evidence/WK-9935.graph.json",
      verbose: true
    });
    assert.equal(verbose.format, "graph-evidence-sidecar");
    assert.ok(verbose.sidecar, "verbose must return the full sidecar");
    assert.equal(verbose.sidecar.schema_version, "work-record-graph-evidence-sidecar.v1");
    assert.deepEqual(Object.keys(verbose.sidecar.slices).sort(), ["slice-one", "slice-two"]);
    assert.ok(verbose.sidecar.slices["slice-one"].graph_impact);
    assert.ok(verbose.sidecar.record.graph_impact);

    const includeRecord = await readWikiPage({
      dir: tempDir,
      path: "wiki/work-records/evidence/WK-9935.graph.json",
      include_record: true
    });
    assert.ok(includeRecord.sidecar, "include_record must also return the full sidecar");
    assert.equal(includeRecord.sidecar.record_id, "WK-9935");
  });
});

test("graph sidecar: selected_slice and selected_record are mutually exclusive", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/graph-sidecar-mutex-test" });
    await installGraphSidecar(tempDir, "WK-9936", buildGraphSidecarFixture("WK-9936"));

    await assert.rejects(
      readWikiPage({
        dir: tempDir,
        path: "wiki/work-records/evidence/WK-9936.graph.json",
        selected_slice: "slice-one",
        selected_record: true
      }),
      /mutually exclusive/
    );
  });
});

test("non-tracker work_kind: compact default does not include slice_counts or working_slices", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/projection-non-tracker-test" });
    const implFixture = {
      schema_version: "work-record.v1",
      id: "WK-9920",
      repo: "agent-chassis/agent-chassis",
      title: "Non-tracker fixture",
      record_kind: "work_item",
      work_kind: "implementation",
      status: "todo",
      priority: "high",
      owner: "unassigned",
      created: "2026-01-01",
      updated: "2026-01-01",
      initiative: null,
      docs: [],
      repo_paths: [],
      write_scope: [],
      depends_on: [],
      blocks: [],
      related: [],
      dispatch_intent: {
        intended_agent_role: "worker",
        target_unit: "record",
        requires_graph_impact: false,
        requires_escalation: false
      },
      acceptance: { criteria: ["Do the thing"], validation: ["npm test"] },
      sections: { summary: "Non-tracker fixture.", closure: null },
      children: [],
      slices: [],
      escalations: [],
      projections: [],
      migration: null,
      derived_evidence: []
    };
    await installFixture(tempDir, implFixture);

    const result = await readWikiPage({ dir: tempDir, path: "wiki/work-records/WK-9920.json" });

    assert.equal(result.work_kind, "implementation");
    assert.equal(
      Object.prototype.hasOwnProperty.call(result, "slice_counts"),
      false,
      "non-tracker must not have slice_counts"
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(result, "working_slices"),
      false,
      "non-tracker must not have working_slices"
    );
  });
});
