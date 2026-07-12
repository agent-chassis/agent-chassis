import test from "node:test";
import assert from "node:assert/strict";

import {
  runWorkRecordReadWithCompactGate,
  runWorkRecordSummaryWithCompactGate
} from "../packages/wiki-mcp/src/lib/work-record-compact-read-gate.mjs";
import {
  getRuntimeBlockerEntry,
  isRuntimeBlockerCode
} from "../packages/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
import {
  validateNextCalls
} from "../packages/wiki-core/src/lib/next-calls-descriptor.mjs";

const WORKSPACE_REPO = "agent-chassis/agent-chassis";
const WORKSPACE_DIR = "/repo";
const RECORD_ID = "WK-9000";

function trackerSummaryFixture() {
  return {
    valid: true,
    record_id: RECORD_ID,
    source_digest: "sha256:compact",
    summary: {
      id: RECORD_ID,
      work_kind: "tracker",
      slice_count: 10,
      slice_detail_omissions: {
        count: 7,
        detail_available_via: ["selected_slice", "selected_unit"]
      },
      slices: [
        { id: "SLICE-001", status: "todo", agent_notes_bytes: 312 },
        { id: "SLICE-002", status: "active", agent_notes_bytes: 428 },
        { id: "SLICE-003", status: "review", agent_notes_bytes: 0 }
      ]
    }
  };
}

function trackerReadFixture() {
  return {
    format: "json-work-record",
    valid: true,
    record_id: RECORD_ID,
    source_digest: "sha256:compact",
    work_kind: "tracker",
    slice_counts: { total: 10 },
    slice_detail_omissions: {
      suppressed_total: 8,
      current_slices_omitted_count: 8
    },
    working_slices: [
      { id: "SLICE-001", status: "todo", agent_notes_bytes: 111 },
      { id: "SLICE-002", status: "active", agent_notes_bytes: 222 }
    ]
  };
}

function selectedSliceReadFixture() {
  return {
    ...trackerReadFixture(),
    selected_slice: {
      id: "SLICE-002",
      status: "active",
      agent_notes: "selected slice body should stay scoped to the selection"
    },
    working_slices: [
      { id: "SLICE-002", status: "active", agent_notes_bytes: 222 }
    ]
  };
}

function expensiveSummaryFixture() {
  return {
    valid: true,
    record_id: RECORD_ID,
    source_digest: "sha256:compact",
    full_summary: {
      slices: [
        { id: "SLICE-001", agent_notes: "full sibling slice body" },
        { id: "SLICE-002", agent_notes: "selected slice body" }
      ]
    }
  };
}

function assertNoFullTrackerOrSliceBodies(value) {
  const text = JSON.stringify(value);
  assert.equal(
    Object.prototype.hasOwnProperty.call(value, "record"),
    false,
    "response must not include a raw record payload"
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(value, "full_summary"),
    false,
    "response must not include full tracker summary payload"
  );
  assert.equal(
    text.includes("full sibling slice body"),
    false,
    "response must not leak full sibling slice bodies"
  );
  assert.equal(
    text.includes("selected slice body"),
    false,
    "default/refusal responses must not leak slice bodies"
  );
  assert.equal(
    text.includes('"agent_notes":'),
    false,
    "default/refusal responses must omit agent note bodies"
  );
}

function assertNextCallsList(metadata) {
  assert.ok(Array.isArray(metadata.next_calls), "metadata must carry the canonical next_calls list");
  assert.ok(metadata.next_calls.length >= 1, "next_calls list must be non-empty for a gate response");
  const validation = validateNextCalls(metadata.next_calls);
  assert.equal(
    validation.valid,
    true,
    `next_calls must conform to the descriptor shape: ${validation.errors.join("; ")}`
  );
  for (const entry of metadata.next_calls) {
    assert.equal(typeof entry.tool, "string");

    assert.equal(entry.recommended, true, "gate next_calls entries are recommended members");
  }
}

function assertSelectedResourcesSibling(metadata, expected) {
  assert.ok(
    Object.prototype.hasOwnProperty.call(metadata, "selected_resources"),
    "metadata must carry the selected_resources sibling field"
  );
  const resources = metadata.selected_resources;
  assert.deepEqual(Object.keys(resources).sort(), ["id", "selection_reason", "type"]);
  assert.equal(resources.type, expected.type);
  assert.equal(resources.id, expected.id);
  assert.equal(resources.selection_reason, expected.selection_reason);

  assert.equal(Object.prototype.hasOwnProperty.call(resources, "tool"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(resources, "recommended"), false);
}

function readGateHarness({ sourceDigest = "sha256:source-a", fixture = trackerReadFixture } = {}) {
  const calls = [];
  return {
    calls,
    run(toolFamily, args) {
      return runWorkRecordReadWithCompactGate({
        workspaceRepo: WORKSPACE_REPO,
        workspaceDir: WORKSPACE_DIR,
        toolFamily,
        args,
        readCompact: async (readArgs) => {
          calls.push(readArgs);
          return fixture();
        },
        readExpensive: async () => {
          throw new Error("default read should not call the expensive reader");
        },
        readWorkRecordById: async () => ({ source_digest: sourceDigest })
      });
    }
  };
}

function summaryGateHarness({ sourceDigest = "sha256:source-a" } = {}) {
  const calls = [];
  return {
    calls,
    run(args) {
      return runWorkRecordSummaryWithCompactGate({
        workspaceRepo: WORKSPACE_REPO,
        workspaceDir: WORKSPACE_DIR,
        args,
        getWorkRecordSummary: async (summaryArgs) => {
          calls.push(summaryArgs);
          if (summaryArgs.verbose || summaryArgs.include_full_summary) {
            return expensiveSummaryFixture();
          }
          return trackerSummaryFixture();
        },
        readWorkRecordById: async () => ({ source_digest: sourceDigest })
      });
    }
  };
}

test("default tracker summary returns compact continuation metadata without full bodies", async () => {
  const harness = summaryGateHarness();
  const result = await harness.run({ id: RECORD_ID });

  assert.equal(result.valid, true);
  assert.equal(result.record_id, RECORD_ID);
  assert.equal(result.compact_read.schema_version, "work-record-compact-read-gate.v1");
  assert.equal(result.compact_read.source_digest, "sha256:source-a");
  assert.equal(typeof result.compact_read.compact_read_token, "string");
  assert.match(result.compact_read.compact_read_token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(result.compact_read.omitted_detail_counts, {
    slice_detail_omissions: 7,
    included_slices_with_omitted_agent_notes: 2
  });
  assert.ok(result.compact_read.detail_available_via.includes("selected_slice"));
  assert.equal(harness.calls.length, 1);
  assertNoFullTrackerOrSliceBodies(result);
});

test("first-call expensive tracker summary refuses compactly", async () => {
  const harness = summaryGateHarness();
  const result = await harness.run({ id: RECORD_ID, verbose: true });

  assert.equal(result.accepted, false);
  assert.equal(result.schema_version, "work-record-compact-read-refusal.v1");
  assert.equal(result.tool, "workspace_work_record_summary");
  assert.deepEqual(result.blocked_expensive_options, ["verbose"]);
  assert.equal(result.reason_code, "compact_first_required");
  assert.equal(result.source_digest, "sha256:source-a");
  assert.equal(result.response_size_risk.class, "small");
  assert.equal(harness.calls.length, 1, "refusal must not call the expensive summary reader");
  assertNoFullTrackerOrSliceBodies(result);
});

test("selected-slice expensive summary escalation stays bounded", async () => {
  const harness = summaryGateHarness();
  const compact = await harness.run({ unit: `${RECORD_ID}#SLICE-002` });
  const result = await harness.run({
    unit: `${RECORD_ID}#SLICE-002`,
    verbose: true,
    compact_read_token: compact.compact_read.compact_read_token
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.summary.slices, []);
  assert.equal(result.compact_read.reason_code, "selected_slice_compact_detail_required");
  assert.deepEqual(result.compact_read.downgraded_expensive_options, ["verbose"]);
  assert.equal(harness.calls.length, 2, "selected-slice escalation must not delegate to full summary");
  assert.equal(harness.calls[0].verbose, false);
  assert.equal(harness.calls[1].verbose, false);
  assertNoFullTrackerOrSliceBodies(result);
});

test("invalid compact token refuses without full tracker payload", async () => {
  const harness = summaryGateHarness();
  const result = await harness.run({
    id: RECORD_ID,
    include_full_summary: true,
    compact_read_token: "not-a-valid-token"
  });

  assert.equal(result.accepted, false);
  assert.deepEqual(result.blocked_expensive_options, ["include_full_summary"]);
  assert.equal(result.reason_code, "compact_read_token_malformed");
  assert.equal(harness.calls.length, 1);
  assertNoFullTrackerOrSliceBodies(result);
});

test("stale compact token refuses after source digest changes", async () => {
  const initial = summaryGateHarness({ sourceDigest: "sha256:old-source" });
  const compact = await initial.run({ id: RECORD_ID });
  const staleToken = compact.compact_read.compact_read_token;

  const changed = summaryGateHarness({ sourceDigest: "sha256:new-source" });
  const result = await changed.run({
    id: RECORD_ID,
    verbose: true,
    compact_read_token: staleToken
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason_code, "compact_read_token_stale_source_digest");
  assert.equal(result.source_digest, "sha256:new-source");
  assertNoFullTrackerOrSliceBodies(result);
});

test("valid compact token still refuses unselected large-tracker full escalation", async () => {
  const harness = summaryGateHarness();
  const compact = await harness.run({ id: RECORD_ID });
  const result = await harness.run({
    id: RECORD_ID,
    verbose: true,
    compact_read_token: compact.compact_read.compact_read_token
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason_code, "compact_read_selected_detail_required");
  assert.equal(harness.calls.length, 2);
  assertNoFullTrackerOrSliceBodies(result);
});

async function assertSelectedSliceReadEscalationIsBounded({ toolFamily, args }) {
  const calls = [];
  const result = await runWorkRecordReadWithCompactGate({
    workspaceRepo: WORKSPACE_REPO,
    workspaceDir: WORKSPACE_DIR,
    toolFamily,
    args,
    readCompact: async (readArgs) => {
      calls.push(readArgs);
      return selectedSliceReadFixture();
    },
    readExpensive: async () => {
      throw new Error("selected-slice read should not call the expensive reader");
    },
    readWorkRecordById: async () => ({ source_digest: "sha256:source-a" })
  });

  assert.equal(result.format, "json-work-record");
  assert.equal(result.compact_read.reason_code, "selected_slice_compact_detail_required");
  assert.deepEqual(result.compact_read.downgraded_expensive_options, ["include_record"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].include_record, false);
  assert.equal(calls[0].include_body, false);
  assert.equal(calls[0].include_raw, false);
}

test("selected-slice read escalation is bounded for workspace_get_record", async () => {
  await assertSelectedSliceReadEscalationIsBounded({
    toolFamily: "workspace_get_record",
    args: {
      id: RECORD_ID,
      selected_slice: "SLICE-002",
      include_record: true
    }
  });
});

test("selected-slice read escalation is bounded for workspace_read_page", async () => {
  await assertSelectedSliceReadEscalationIsBounded({
    toolFamily: "workspace_read_page",
    args: {
      path: `wiki/work-records/${RECORD_ID}.json`,
      selected_slice: "SLICE-002",
      include_record: true
    }
  });
});

test("compact-read gate emits only registry-registered read_disclosure reason codes", async () => {
  const emitted = new Set();

  {
    const harness = summaryGateHarness();
    const result = await harness.run({ id: RECORD_ID, verbose: true });
    assert.equal(result.reason_code, "compact_first_required");
    emitted.add(result.reason_code);
  }

  {
    const harness = summaryGateHarness();
    const result = await harness.run({
      id: RECORD_ID,
      include_full_summary: true,
      compact_read_token: "not-a-valid-token"
    });
    assert.equal(result.reason_code, "compact_read_token_malformed");
    emitted.add(result.reason_code);
  }

  {
    const initial = summaryGateHarness({ sourceDigest: "sha256:old-source" });
    const compact = await initial.run({ id: RECORD_ID });
    const changed = summaryGateHarness({ sourceDigest: "sha256:new-source" });
    const result = await changed.run({
      id: RECORD_ID,
      verbose: true,
      compact_read_token: compact.compact_read.compact_read_token
    });
    assert.equal(result.reason_code, "compact_read_token_stale_source_digest");
    emitted.add(result.reason_code);
  }

  {
    const harness = summaryGateHarness();
    const compact = await harness.run({ id: RECORD_ID });
    const result = await harness.run({
      id: RECORD_ID,
      verbose: true,
      compact_read_token: compact.compact_read.compact_read_token
    });
    assert.equal(result.reason_code, "compact_read_selected_detail_required");
    emitted.add(result.reason_code);
  }

  {
    const harness = summaryGateHarness();
    const compact = await harness.run({ unit: `${RECORD_ID}#SLICE-002` });
    const result = await harness.run({
      unit: `${RECORD_ID}#SLICE-002`,
      verbose: true,
      compact_read_token: compact.compact_read.compact_read_token
    });
    assert.equal(result.compact_read.reason_code, "selected_slice_compact_detail_required");
    emitted.add(result.compact_read.reason_code);
  }

  {
    const result = await runWorkRecordReadWithCompactGate({
      workspaceRepo: WORKSPACE_REPO,
      workspaceDir: WORKSPACE_DIR,
      toolFamily: "workspace_get_record",
      args: { id: RECORD_ID, selected_slice: "SLICE-002", include_record: true },
      readCompact: async () => selectedSliceReadFixture(),
      readExpensive: async () => {
        throw new Error("selected-slice read should not call the expensive reader");
      },
      readWorkRecordById: async () => ({ source_digest: "sha256:source-a" })
    });
    emitted.add(result.compact_read.reason_code);
  }

  assert.ok(
    emitted.size >= 5,
    "the gate battery must exercise several distinct refusal reason codes"
  );

  for (const code of emitted) {
    assert.ok(
      isRuntimeBlockerCode(code),
      `emitted reason_code "${code}" must be registered in runtime-blocker-codes.v1`
    );
    const entry = getRuntimeBlockerEntry(code);
    assert.equal(
      entry.category,
      "read_disclosure",
      `emitted reason_code "${code}" must be registered under category read_disclosure`
    );
    assert.equal(
      entry.actor_recovery,
      "caller_retry",
      `emitted reason_code "${code}" must be registered with actor_recovery caller_retry`
    );
    assert.equal(
      entry.blocking,
      false,
      `emitted reason_code "${code}" must be registered as non-blocking`
    );
  }
});

test("default tracker summary emits the canonical next_calls list and selected_resources", async () => {
  const harness = summaryGateHarness();
  const result = await harness.run({ id: RECORD_ID });

  assertNextCallsList(result.compact_read);

  assert.deepEqual(result.compact_read.next_calls[0], {
    tool: "workspace_work_record_summary",
    arguments: { id: RECORD_ID },
    recommended: true
  });

  assertSelectedResourcesSibling(result.compact_read, {
    type: "work_record",
    id: RECORD_ID,
    selection_reason: "compact_read_compact_first_scope"
  });
});

test("first-call expensive summary refusal emits the canonical list and selected_resources", async () => {
  const harness = summaryGateHarness();
  const result = await harness.run({ id: RECORD_ID, verbose: true });

  assert.equal(result.accepted, false);
  assertNextCallsList(result);
  assertSelectedResourcesSibling(result, {
    type: "work_record",
    id: RECORD_ID,
    selection_reason: "compact_read_compact_first_scope"
  });
});

test("selected-slice summary emits slice-scoped selected_resources and the canonical list", async () => {
  const harness = summaryGateHarness();
  const result = await harness.run({ unit: `${RECORD_ID}#SLICE-002` });

  assertNextCallsList(result.compact_read);
  assertSelectedResourcesSibling(result.compact_read, {
    type: "slice",
    id: `${RECORD_ID}#SLICE-002`,
    selection_reason: "compact_read_selected_slice_scope"
  });
});

test("default get_record read emits the canonical list and selected_resources", async () => {
  const harness = readGateHarness();
  const result = await harness.run("workspace_get_record", { id: RECORD_ID });

  assert.equal(result.format, "json-work-record");
  assertNextCallsList(result.compact_read);
  assert.deepEqual(result.compact_read.next_calls[0], {
    tool: "workspace_get_record",
    arguments: { id: RECORD_ID },
    recommended: true
  });
  assertSelectedResourcesSibling(result.compact_read, {
    type: "work_record",
    id: RECORD_ID,
    selection_reason: "compact_read_compact_first_scope"
  });
});

test("default read_page read emits the canonical list and selected_resources", async () => {
  const harness = readGateHarness();
  const result = await harness.run("workspace_read_page", {
    path: `wiki/work-records/${RECORD_ID}.json`
  });

  assert.equal(result.format, "json-work-record");
  assertNextCallsList(result.compact_read);
  assert.deepEqual(result.compact_read.next_calls[0], {
    tool: "workspace_read_page",
    arguments: { path: `wiki/work-records/${RECORD_ID}.json` },
    recommended: true
  });
  assertSelectedResourcesSibling(result.compact_read, {
    type: "work_record",
    id: RECORD_ID,
    selection_reason: "compact_read_compact_first_scope"
  });
});
