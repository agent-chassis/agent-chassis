

import test from "node:test";
import assert from "node:assert/strict";

import {
  runWorkRecordReadWithCompactGate,
  runWorkRecordSummaryWithCompactGate
} from "../../packages/wiki-mcp/src/lib/work-record-compact-read-gate.mjs";

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

function readFixture() {
  return {
    format: "json-work-record",
    valid: true,
    record_id: RECORD_ID,
    relativePath: RECORD_PATH,
    source_digest: "sha256:compact",
    work_kind: "tracker",
    slice_counts: { total: 43 },
    working_slices: [{ id: RETURNED_SLICE_ID, status: "active", agent_notes_bytes: 128 }]
  };
}

function runSummary(args, { record = trackerRecord() } = {}) {
  return runWorkRecordSummaryWithCompactGate({
    workspaceRepo: WORKSPACE_REPO,
    workspaceDir: WORKSPACE_DIR,
    args,
    getWorkRecordSummary: async () => summaryFixture(),
    readWorkRecordById: async () => ({ source_digest: "sha256:source-a", record })
  });
}

function runRead(toolFamily, args, { record = trackerRecord() } = {}) {
  return runWorkRecordReadWithCompactGate({
    workspaceRepo: WORKSPACE_REPO,
    workspaceDir: WORKSPACE_DIR,
    toolFamily,
    args,
    readCompact: async () => readFixture(),
    readExpensive: async () => {
      throw new Error("the compact path must not call the expensive reader");
    },
    readWorkRecordById: async () => ({ source_digest: "sha256:source-a", record })
  });
}

function signature(tool, callArguments) {
  return JSON.stringify([
    tool,
    Object.entries(callArguments ?? {})
      .filter(([key, value]) =>
        !["compact_read_token", "repo", "profile", "extensionNamespaces"].includes(key) &&
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

test("a compact read by id emits neither the originating call nor its token-bearing twin", async () => {
  const result = await runSummary({ id: RECORD_ID });
  const list = result.compact_read.next_calls;

  assertNoEntryEquivalentTo(list, "workspace_work_record_summary", { id: RECORD_ID });
  assertNoEntryEquivalentTo(list, "workspace_work_record_summary", {
    id: RECORD_ID,
    compact_read_token: result.compact_read.compact_read_token
  });
  assert.ok(list.length > 0, "a response that withheld content still recommends a next step");
});

test("a read keyed by unit or path still recognizes the id-keyed form of itself", async () => {
  for (const args of [{ unit: RECORD_ID }, { path: RECORD_PATH }]) {
    const result = await runSummary(args);
    assertNoEntryEquivalentTo(result.compact_read.next_calls, "workspace_work_record_summary", {
      id: RECORD_ID
    });
  }
});

test("per-slice entries are drawn from the withheld slices, never the returned ones", async () => {
  const result = await runSummary({ id: RECORD_ID });
  const list = result.compact_read.next_calls;

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
  assert.equal(
    result.compact_read.omitted_detail_counts.included_slices_with_omitted_agent_notes,
    1,
    "that entry exists because the ledger counted a withheld note body"
  );
  for (const id of emittedSliceIds.slice(0, -1)) {
    assert.notEqual(id, RETURNED_SLICE_ID, "a withheld-slice entry never names a returned row");
  }
});

test("a response whose only withheld slice-side content is note bodies names the selector that reaches them", async () => {
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
  const result = await runWorkRecordSummaryWithCompactGate({
    workspaceRepo: WORKSPACE_REPO,
    workspaceDir: WORKSPACE_DIR,
    args: { id: RECORD_ID },
    getWorkRecordSummary: async () => ({
      valid: true,
      record_id: RECORD_ID,
      source_digest: "sha256:compact",
      summary: {
        id: RECORD_ID,
        work_kind: "implementation",
        slice_count: 1,
        slices_total: 1,

        slices: [{ id: sliceId(0), status: "active", agent_notes_bytes: 4096 }]
      }
    }),
    readWorkRecordById: async () => ({ source_digest: "sha256:source-a", record })
  });

  const ledger = result.compact_read.omitted_detail_counts;
  assert.equal(ledger.slices, 0, "no slice row was dropped");
  assert.equal(ledger.record_fields, 0, "the record authors no contract fields");
  assert.equal(ledger.included_slices_with_omitted_agent_notes, 1);

  assert.deepEqual(result.compact_read.detail_available_via, ["unit_agent_notes"]);
  assert.deepEqual(result.compact_read.next_calls, [{
    tool: "workspace_work_record_summary",
    arguments: { unit: `${RECORD_ID}#${sliceId(0)}` },
    recommended: true
  }]);
});

test("the entry that reaches every withheld slice outranks the per-slice entries", async () => {
  const result = await runSummary({ id: RECORD_ID });
  const list = result.compact_read.next_calls;

  assert.deepEqual(list[0], {
    tool: "workspace_work_record_summary",
    arguments: { id: RECORD_ID, slice_offset: 0 },
    recommended: true
  });
  const enumerationIndex = 0;
  const firstPerSlice = list.findIndex((entry) => typeof entry.arguments?.unit === "string");
  assert.ok(
    firstPerSlice > enumerationIndex,
    "one enumeration reaches all 42 withheld slices; a per-slice entry reaches one"
  );
});

test("the bounded per-slice cap is disclosed rather than silently applied", async () => {
  const result = await runSummary({ id: RECORD_ID });
  const coverage = result.compact_read.next_calls_coverage;

  assert.equal(coverage.omitted_slices, 42);
  assert.equal(coverage.per_slice_entry_limit, 3);

  assert.equal(coverage.omitted_slices_addressed, 42);
  assert.equal(coverage.omitted_slices_unaddressed, 0);
  assert.equal(coverage.complete, true);
});

test("without a route that reaches the whole withheld set the shortfall is reported", async () => {

  const result = await runRead("workspace_read_page", { path: RECORD_PATH });
  const list = result.compact_read.next_calls;

  assertNoEntryEquivalentTo(list, "workspace_read_page", { path: RECORD_PATH });
  const perSlice = list.filter((entry) => typeof entry.arguments?.selected_slice === "string");
  assert.equal(perSlice.length, 3, "the per-slice cap still bounds the list");
  assert.equal(
    perSlice.some((entry) => entry.arguments.selected_slice === RETURNED_SLICE_ID),
    false
  );
  assert.equal(result.compact_read.next_calls_coverage.omitted_slices, 42);
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

test("a refusal recommends the compact-first read its own reason_code names", async () => {
  const result = await runSummary({ id: RECORD_ID, verbose: true });

  assert.equal(result.accepted, false);
  assert.equal(result.reason_code, "compact_first_required");

  assertNoEntryEquivalentTo(result.next_calls, "workspace_work_record_summary", {
    id: RECORD_ID,
    verbose: true
  });
  assert.deepEqual(result.next_calls[0], {
    tool: "workspace_work_record_summary",
    arguments: { id: RECORD_ID },
    recommended: true
  });
});

test("a record with nothing withheld emits no entry pretending otherwise", async () => {
  const record = {
    id: RECORD_ID,
    work_kind: "implementation",
    status: "active",
    write_scope: ["packages/example.mjs"],
    acceptance: { criteria: ["Criterion"], validation: ["node --test"] },
    slices: []
  };
  const result = await runWorkRecordSummaryWithCompactGate({
    workspaceRepo: WORKSPACE_REPO,
    workspaceDir: WORKSPACE_DIR,
    args: { id: RECORD_ID },
    getWorkRecordSummary: async () => ({
      valid: true,
      record_id: RECORD_ID,
      source_digest: "sha256:compact",
      summary: {
        id: RECORD_ID,
        work_kind: "implementation",
        slice_count: 0,
        slices_total: 0,
        slices: []
      }
    }),
    readWorkRecordById: async () => ({ source_digest: "sha256:source-a", record })
  });

  const list = result.compact_read.next_calls;
  assert.equal(
    list.some((entry) => Object.hasOwn(entry.arguments ?? {}, "slice_offset")),
    false,
    "a sliceless record advertises no slice enumeration"
  );
  assert.equal(result.compact_read.next_calls_coverage.omitted_slices, 0);
  assert.equal(result.compact_read.next_calls_coverage.complete, true);

  assert.deepEqual(list[0], {
    tool: "workspace_work_record_summary",
    arguments: { id: RECORD_ID, selected_record: true },
    recommended: true
  });
});

test("a record that authors no contract fields advertises no route to them", async () => {
  const record = {
    id: RECORD_ID,
    work_kind: "implementation",
    status: "active",
    write_scope: [],
    acceptance: { criteria: [], validation: [] },
    slices: []
  };
  const result = await runWorkRecordSummaryWithCompactGate({
    workspaceRepo: WORKSPACE_REPO,
    workspaceDir: WORKSPACE_DIR,
    args: { id: RECORD_ID },
    getWorkRecordSummary: async () => ({
      valid: true,
      record_id: RECORD_ID,
      source_digest: "sha256:compact",
      summary: {
        id: RECORD_ID,
        work_kind: "implementation",
        slice_count: 0,
        slices_total: 0,
        slices: []
      }
    }),
    readWorkRecordById: async () => ({ source_digest: "sha256:source-a", record })
  });

  assert.equal(result.compact_read.omitted_detail_counts.record_fields, 0);
  assert.equal(
    result.compact_read.next_calls.some((entry) =>
      entry.arguments?.selected_record === true),
    false,
    "no selected_record entry is emitted when the filtered count is 0"
  );
  assert.deepEqual(result.compact_read.next_calls, []);
  assert.deepEqual(result.compact_read.detail_available_via, []);
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
  const compactResult = {
    format: "json-work-record",
    valid: true,
    record_id: RECORD_ID,
    relativePath: RECORD_PATH,
    source_digest: "sha256:compact",
    work_kind: "implementation",
    slice_counts: { total: 0 },
    working_slices: []
  };

  for (const [toolFamily, args] of [
    ["workspace_get_record", { id: RECORD_ID }],
    ["workspace_read_page", { path: RECORD_PATH }]
  ]) {
    const result = await runWorkRecordReadWithCompactGate({
      workspaceRepo: WORKSPACE_REPO,
      workspaceDir: WORKSPACE_DIR,
      toolFamily,
      args,
      readCompact: async () => ({ ...compactResult }),
      readExpensive: async () => {
        throw new Error("the compact path must not call the expensive reader");
      },
      readWorkRecordById: async () => ({ source_digest: "sha256:source-a", record })
    });

    assert.equal(result.compact_read.omitted_detail_counts.record_fields, 3);
    assert.deepEqual(result.compact_read.next_calls, [{
      tool: "workspace_work_record_summary",
      arguments: { id: RECORD_ID, selected_record: true },
      recommended: true
    }], `${toolFamily} must route its withheld record fields somewhere reachable`);

    assert.deepEqual(result.compact_read.detail_available_via, []);
  }
});
