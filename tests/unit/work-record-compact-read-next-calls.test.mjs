

import test from "node:test";
import assert from "node:assert/strict";

import {
  runWorkRecordReadWithCompactGate,
  runWorkRecordSummaryWithCompactGate
} from "../../packages/wiki-mcp/src/lib/work-record-compact-read-gate.mjs";
import { buildContinuationMetadata } from
  "../../packages/wiki-mcp/src/lib/work-record-compact-read-continuation.mjs";

const SUMMARY = "workspace_work_record_summary";
const READ_PAGE = "workspace_read_page";
const WORKSPACE_REPO = "agent-chassis/agent-chassis";
const WORKSPACE_DIR = "/repo";
const RECORD_ID = "WK-9000";
const RECORD_PATH = `wiki/work-records/${RECORD_ID}.json`;

function sliceId(index) {
  return `SLICE-${String(index + 1).padStart(3, "0")}`;
}

function trackerRecord({ sliceCount = 43 } = {}) {
  return {
    id: RECORD_ID,
    work_kind: "tracker",
    status: "active",
    write_scope: ["packages/example.mjs"],
    acceptance: { criteria: ["Criterion"], validation: ["node --test"] },
    slices: Array.from({ length: sliceCount }, (unused, index) => ({
      id: sliceId(index),
      title: `Slice ${index + 1}`,
      work_kind: index < 20 ? "review" : "implementation",
      status: index === 22 ? "active" : "done"
    }))
  };
}

const RETURNED_SLICE_ID = sliceId(22);

function summaryFixture() {
  return {
    valid: true,
    record_id: RECORD_ID,
    source_digest: "sha256:compact",
    summary: {
      id: RECORD_ID,
      work_kind: "tracker",
      slice_count: 43,
      slices_total: 43,
      slices: [{ id: RETURNED_SLICE_ID, status: "active", agent_notes_bytes: 128 }],
      review_state: {
        review_slices: [{ id: sliceId(0), status: "done" }],
        review_slices_total: 20
      }
    }
  };
}

function readFixture({ workKind = "tracker", total = 43, rows = null } = {}) {
  return {
    format: "json-work-record",
    valid: true,
    record_id: RECORD_ID,
    relativePath: RECORD_PATH,
    source_digest: "sha256:compact",
    work_kind: workKind,
    slice_counts: { total },
    working_slices: rows ?? [{ id: RETURNED_SLICE_ID, status: "active", agent_notes_bytes: 128 }]
  };
}

function runSummary(args, { record = trackerRecord() } = {}) {
  return runWorkRecordSummaryWithCompactGate({
    workspaceRepo: WORKSPACE_REPO,
    workspaceDir: WORKSPACE_DIR,
    args,
    readWorkRecordById: async () => ({ source_digest: "sha256:source-a", valid: true, record }),
    isToolVisible: () => true
  });
}

function runRead(toolFamily, args, { record = trackerRecord(), compact = readFixture } = {}) {
  return runWorkRecordReadWithCompactGate({
    workspaceRepo: WORKSPACE_REPO,
    workspaceDir: WORKSPACE_DIR,
    toolFamily,
    args,
    readCompact: async () => compact(),
    readExpensive: async () => {
      throw new Error("the compact path must not call the expensive reader");
    },
    readWorkRecordById: async () => ({ source_digest: "sha256:source-a", record }),
    isToolVisible: () => true
  });
}

function continuation(toolFamily, args, { record = trackerRecord(), compact = null } = {}) {
  const compactResult = compact?.() ?? (toolFamily === SUMMARY ? summaryFixture() : readFixture());
  return buildContinuationMetadata({
    toolFamily,
    compactResult,
    selector: { selected: args.id ?? args.unit ?? args.path, selected_slice: null },
    args,
    record
  });
}

function signature(tool, callArguments) {
  return JSON.stringify([
    tool,
    Object.entries(callArguments ?? {})
      .filter(([key, value]) =>
        !["repo", "profile", "extensionNamespaces"].includes(key) &&
        value !== null &&
        value !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  ]);
}

function assertNoEntryEquivalentTo(list, tool, callArguments) {
  const forbidden = signature(tool, callArguments);
  for (const entry of list) {
    assert.notEqual(
      signature(entry.tool, entry.arguments),
      forbidden,
      `next_calls must not re-offer ${JSON.stringify({ tool, arguments: callArguments })}`
    );
  }
}

test("the lean default emits neither the originating call nor any per-slice row", async () => {
  const result = await runSummary({ id: RECORD_ID });

  assertNoEntryEquivalentTo(result.next_calls, SUMMARY, { id: RECORD_ID });
  assert.deepEqual(result.next_calls, [
    { tool: SUMMARY, arguments: { repo: WORKSPACE_REPO, unit: RECORD_ID, slice_offset: 0 } },
    { tool: SUMMARY, arguments: { repo: WORKSPACE_REPO, unit: RECORD_ID, details: {} } }
  ]);
  assert.equal(
    new Set(result.next_calls.map((entry) => signature(entry.tool, entry.arguments))).size,
    result.next_calls.length,
    "every emitted call is distinct"
  );
});

test("a summary continuation keyed by unit or path still recognizes the id-keyed form of itself", () => {
  for (const args of [{ unit: RECORD_ID }, { path: RECORD_PATH }]) {
    const result = continuation(SUMMARY, args);
    assertNoEntryEquivalentTo(result.next_calls, SUMMARY, { id: RECORD_ID });
    assert.deepEqual(result.next_calls[0], {
      tool: SUMMARY,
      arguments: { id: RECORD_ID, slice_offset: 0 },
      recommended: true
    });
  }
});

test("per-slice entries are drawn from the withheld slices, never the returned ones", () => {
  const result = continuation(SUMMARY, { id: RECORD_ID });
  const list = result.next_calls;

  const emittedSliceIds = list
    .filter((entry) => typeof entry.arguments?.unit === "string")
    .map((entry) => entry.arguments.unit.split("#")[1]);

  assert.ok(emittedSliceIds.length > 0, "per-slice entries are emitted for a record with withheld slices");
  const record = trackerRecord();
  for (const id of emittedSliceIds) {
    assert.ok(record.slices.some((slice) => slice.id === id), `${id} is a real slice of the record`);
  }

  const returnedRowEntries = emittedSliceIds.filter((id) => id === RETURNED_SLICE_ID);
  assert.equal(returnedRowEntries.length, 1, "the returned row is named once, for its withheld notes");
  assert.equal(
    emittedSliceIds.indexOf(RETURNED_SLICE_ID),
    emittedSliceIds.length - 1,
    "the withheld-slice entries come first; the note-body entry is the narrowest reach"
  );
  assert.ok(
    result.detail_available_via.includes("unit_agent_notes"),
    "that entry exists because a withheld note body was counted"
  );
  for (const id of emittedSliceIds.slice(0, -1)) {
    assert.notEqual(id, RETURNED_SLICE_ID, "a withheld-slice entry never names a returned row");
  }
});

test("a response whose only withheld slice-side content is note bodies names the selector that reaches them", () => {
  const record = {
    id: RECORD_ID,
    work_kind: "implementation",
    status: "active",
    write_scope: [],
    acceptance: { criteria: [], validation: [] },
    slices: [
      { id: sliceId(0), title: "Only slice", work_kind: "implementation", status: "active" }
    ]
  };
  const result = continuation(SUMMARY, { id: RECORD_ID }, {
    record,
    compact: () => ({
      valid: true,
      record_id: RECORD_ID,
      source_digest: "sha256:compact",
      summary: {
        id: RECORD_ID,
        work_kind: "tracker",
        slice_count: 1,
        slices_total: 1,

        slices: [{ id: sliceId(0), status: "active", agent_notes_bytes: 4096 }]
      }
    })
  });

  assert.deepEqual(result.detail_available_via, ["unit_agent_notes"]);
  assert.deepEqual(result.next_calls, [
    { tool: SUMMARY, arguments: { unit: `${RECORD_ID}#${sliceId(0)}` }, recommended: true }
  ]);
});

test("the entry that reaches every withheld slice outranks the per-slice entries", () => {
  const list = continuation(SUMMARY, { id: RECORD_ID }).next_calls;

  assert.deepEqual(list[0], {
    tool: SUMMARY,
    arguments: { id: RECORD_ID, slice_offset: 0 },
    recommended: true
  });
  const firstPerSlice = list.findIndex((entry) => typeof entry.arguments?.unit === "string");
  assert.ok(
    firstPerSlice > 0,
    "one enumeration reaches all 42 withheld slices; a per-slice entry reaches one"
  );
});

test("the bounded per-slice cap is disclosed rather than silently applied", () => {
  const coverage = continuation(SUMMARY, { id: RECORD_ID }).next_calls_coverage;

  assert.equal(coverage.omitted_slices, 42);
  assert.equal(coverage.per_slice_entry_limit, 3);

  assert.equal(coverage.omitted_slices_addressed, 42);
  assert.equal(coverage.omitted_slices_unaddressed, 0);
  assert.equal(coverage.complete, true);
});

test("read_page reaches withheld slices through the summary enumeration and caps per-slice entries", () => {
  const result = continuation(READ_PAGE, { path: RECORD_PATH });
  const list = result.next_calls;

  assertNoEntryEquivalentTo(list, READ_PAGE, { path: RECORD_PATH });
  const perSlice = list.filter((entry) => typeof entry.arguments?.selected_slice === "string");
  assert.equal(perSlice.length, 3, "the per-slice cap still bounds the list");
  assert.equal(
    perSlice.some((entry) => entry.arguments.selected_slice === RETURNED_SLICE_ID),
    false
  );
  assert.ok(list.some((entry) => entry.tool === SUMMARY &&
    entry.arguments.id === RECORD_ID && entry.arguments.slice_offset === 0));
  assert.equal(result.next_calls_coverage.omitted_slices, 42);
});

test("get_record emits its own enumeration and never re-offers the call that produced the response", async () => {
  const result = await runRead("workspace_get_record", { id: RECORD_ID });
  const list = result.compact_read.next_calls;

  assertNoEntryEquivalentTo(list, "workspace_get_record", { id: RECORD_ID });
  assert.deepEqual(list[0], {
    tool: "workspace_get_record",
    arguments: { id: RECORD_ID, slice_offset: 0 },
    recommended: true
  });
});

function slicelessSummary() {
  return {
    valid: true,
    record_id: RECORD_ID,
    source_digest: "sha256:compact",
    summary: { id: RECORD_ID, work_kind: "tracker", slice_count: 0, slices_total: 0, slices: [] }
  };
}

test("a record with nothing withheld emits no entry pretending otherwise", async () => {
  const record = {
    id: RECORD_ID,
    work_kind: "implementation",
    status: "active",
    write_scope: ["packages/example.mjs"],
    acceptance: { criteria: ["Criterion"], validation: ["node --test"] },
    slices: []
  };
  const lean = await runSummary({ id: RECORD_ID }, { record });
  assert.deepEqual(lean.next_calls, [
    { tool: SUMMARY, arguments: { repo: WORKSPACE_REPO, unit: RECORD_ID, details: {} } }
  ], "a sliceless record's default names no slice enumeration");

  const result = continuation(SUMMARY, { id: RECORD_ID }, { record, compact: slicelessSummary });
  const list = result.next_calls;
  assert.equal(
    list.some((entry) => Object.hasOwn(entry.arguments ?? {}, "slice_offset")),
    false,
    "a sliceless record advertises no slice enumeration"
  );
  assert.equal(result.next_calls_coverage.omitted_slices, 0);
  assert.equal(result.next_calls_coverage.complete, true);

  assert.deepEqual(list, [
    { tool: SUMMARY, arguments: { id: RECORD_ID, selected_record: true }, recommended: true }
  ]);
});

test("a record that authors no contract fields advertises no route to them", () => {
  const record = {
    id: RECORD_ID,
    work_kind: "implementation",
    status: "active",
    write_scope: [],
    acceptance: { criteria: [], validation: [] },
    slices: []
  };
  const result = continuation(SUMMARY, { id: RECORD_ID }, { record, compact: slicelessSummary });

  assert.equal(
    result.next_calls.some((entry) => entry.arguments?.selected_record === true),
    false,
    "no selected_record entry is emitted when the filtered count is 0"
  );
  assert.deepEqual(result.next_calls, []);
  assert.deepEqual(result.detail_available_via, []);
});

test("the read family routes withheld record fields to the summary family's bounded route", async () => {
  const record = {
    id: RECORD_ID,
    work_kind: "implementation",
    status: "active",
    write_scope: ["packages/example.mjs"],
    acceptance: { criteria: ["Criterion"], validation: ["node --test"] },
    slices: []
  };
  const recordFieldsCall = {
    tool: SUMMARY,
    arguments: { id: RECORD_ID, selected_record: true },
    recommended: true
  };

  const getRecord = await runRead("workspace_get_record", { id: RECORD_ID }, {
    record,
    compact: () => readFixture({ workKind: "implementation", total: 0, rows: [] })
  });
  assert.equal(getRecord.compact_read.omitted_detail_counts.record_fields, 3);
  assert.deepEqual(getRecord.compact_read.next_calls, [recordFieldsCall]);

  assert.deepEqual(getRecord.compact_read.detail_available_via, []);

  const readPage = continuation(READ_PAGE, { path: RECORD_PATH }, {
    record,
    compact: () => readFixture({ total: 0, rows: [] })
  });
  assert.deepEqual(readPage.next_calls, [recordFieldsCall]);
  assert.deepEqual(readPage.detail_available_via, []);
});
