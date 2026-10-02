

import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import {
  WORK_RECORD_SLICE_PAGE_DEFAULT_LIMIT,
  WORK_RECORD_SLICE_PAGE_MAX_LIMIT
} from "../../packages/wiki-core/src/lib/work-record-summary.mjs";
import {
  projectWorkRecordSlicePage
} from "../../packages/wiki-core/src/lib/work-record-bounded-projections.mjs";
import {
  runWorkRecordReadWithCompactGate,
  runWorkRecordSummaryWithCompactGate
} from "../../packages/wiki-mcp/src/lib/work-record-compact-read-gate.mjs";
import { registerWorkRecordReadTools } from "../../packages/wiki-mcp/src/lib/work-record-read-tools.mjs";
import { getRuntimeBlockerEntry } from "../../packages/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
import { registerWikiCoreTools } from "../../packages/wiki-mcp/src/lib/wiki-core-tools.mjs";

const WORKSPACE_REPO = "agent-chassis/agent-chassis";
const WORKSPACE_DIR = "/repo";
const RECORD_ID = "WK-9000";
const SOURCE_DIGEST = `sha256:${"a".repeat(64)}`;
const MOVED_SOURCE_DIGEST = `sha256:${"b".repeat(64)}`;

const SOURCE_FRESHNESS = "a".repeat(16);
const MOVED_FRESHNESS = "b".repeat(16);

function sliceId(index) {
  return `SLICE-${String(index + 1).padStart(3, "0")}`;
}

function trackerRecord({ sliceCount = 43, titleFiller = "" } = {}) {
  return {
    id: RECORD_ID,
    work_kind: "tracker",
    status: "active",
    slices: Array.from({ length: sliceCount }, (unused, index) => ({
      id: sliceId(index),
      title: `Slice ${index + 1}${titleFiller}`,
      work_kind: index < 20 ? "review" : "implementation",
      status: index % 4 === 0 ? "done" : "todo"
    }))
  };
}

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
      slices: [{ id: sliceId(1), status: "todo", agent_notes_bytes: 64 }]
    }
  };
}

function summaryDriver({ record = trackerRecord(), sourceDigest = SOURCE_DIGEST } = {}) {
  const calls = [];
  return {
    calls,
    run(args) {
      calls.push(args);
      return runWorkRecordSummaryWithCompactGate({
        workspaceRepo: WORKSPACE_REPO,
        workspaceDir: WORKSPACE_DIR,
        args,
        getWorkRecordSummary: async () => summaryFixture(),
        readWorkRecordById: async () => ({ source_digest: sourceDigest, valid: true, record }),
        isToolVisible: () => true
      });
    }
  };
}

function getRecordDriver({ record = trackerRecord() } = {}) {
  const calls = [];
  return {
    calls,
    run(args) {
      calls.push(args);
      return runWorkRecordReadWithCompactGate({
        workspaceRepo: WORKSPACE_REPO,
        workspaceDir: WORKSPACE_DIR,
        toolFamily: "workspace_get_record",
        args,
        readCompact: async () => ({
          format: "json-work-record",
          valid: true,
          record_id: RECORD_ID,
          source_digest: "sha256:compact",
          work_kind: "tracker",
          slice_counts: { total: 43 },
          working_slices: [{ id: sliceId(1), status: "todo", agent_notes_bytes: 64 }]
        }),
        readExpensive: async () => {
          throw new Error("enumeration must not reach the expensive reader");
        },
        readWorkRecordById: async () => ({ source_digest: SOURCE_DIGEST, valid: true, record })
      });
    }
  };
}

function captureRegisteredTools(register) {
  const tools = new Map();
  register((name, definition, handler) => tools.set(name, { definition, handler }));
  return tools;
}

test("all 43 slices are reachable within the declared call budget, each exactly once", async () => {
  const record = trackerRecord();
  const driver = summaryDriver({ record });

  const lean = await driver.run({ id: RECORD_ID });
  const enumeration = lean.next_calls.find((entry) => Object.hasOwn(entry.arguments, "slice_offset"));
  assert.deepEqual(enumeration, {
    tool: "workspace_work_record_summary",
    arguments: { repo: WORKSPACE_REPO, unit: RECORD_ID, slice_offset: 0 }
  });

  const collected = [];
  let pageSize = null;
  let request = enumeration.arguments;
  let guard = 0;
  let lastPage = null;
  while (guard < 50) {
    guard += 1;
    const page = await driver.run(request);
    assert.equal(page.accepted, true);
    assert.equal(page.source_digest, SOURCE_FRESHNESS);

    assert.notEqual(page.response_size.class, "large");
    if (pageSize === null) pageSize = page.slice_page.applied_limit;
    collected.push(...page.slice_page.slices.map((slice) => slice.id));
    lastPage = page.slice_page;
    if (page.slice_page.final) break;
    request = page.next_calls[0].arguments;
    assert.equal(page.next_calls[0].tool, "workspace_work_record_summary");

    assert.equal(request.expected_source_digest, SOURCE_FRESHNESS);
  }

  assert.equal(lastPage.final, true, "the final page is unambiguously final");
  assert.equal(lastPage.has_more, false);
  assert.equal(lastPage.next_offset, null);

  assert.equal(collected.length, 43);
  assert.equal(new Set(collected).size, 43);
  assert.deepEqual([...collected].sort(), record.slices.map((slice) => slice.id).sort());

  const budget = Math.ceil(43 / pageSize) + 1;
  assert.equal(driver.calls.length, budget, `enumeration must fit ceil(43/${pageSize}) + 1 calls`);
});

test("a caller never constructs a slice id: every page comes from the previous page's next call", async () => {
  const driver = summaryDriver();
  let request = { id: RECORD_ID, slice_offset: 0 };
  const seen = [];
  for (let index = 0; index < 10; index += 1) {
    const page = await driver.run(request);
    seen.push(...page.slice_page.slices.map((slice) => slice.id));
    if (page.slice_page.final) break;
    request = page.next_calls[0].arguments;
    assert.equal(
      Object.hasOwn(request, "slice_offset") && Number.isInteger(request.slice_offset),
      true,
      "the next page is requested by offset, never by a constructed slice id"
    );
  }
  assert.equal(seen.length, 43);
});

test("a page whose digest differs reports the mismatch instead of continuing silently", async () => {
  const driver = summaryDriver();
  const first = await driver.run({ id: RECORD_ID, slice_offset: 0, slice_limit: 3, slice_status: "todo" });
  assert.equal(first.accepted, true);

  const moved = summaryDriver({ sourceDigest: MOVED_SOURCE_DIGEST });
  const second = await moved.run({
    ...first.next_calls[0].arguments,
    expected_source_digest: SOURCE_FRESHNESS
  });

  assert.equal(second.accepted, false);
  assert.equal(second.reason_code, "selected_read_stale_source_digest");
  const entry = getRuntimeBlockerEntry(second.reason_code);
  assert.deepEqual([entry.category, entry.actor_recovery, entry.blocking], ["read_disclosure", "caller_retry", false]);
  assert.equal(second.source_digest_matches, false);
  assert.equal(second.expected_source_digest, SOURCE_FRESHNESS);
  assert.equal(second.source_digest, MOVED_FRESHNESS);
  assert.equal(second.slice_page, null, "a mismatched page returns no slices");
  assert.equal(JSON.stringify(second).includes("token"), false, "the refusal gives no token advice");

  assert.equal(second.next_calls.length, 1);
  assert.equal(second.next_calls[0].recommended, true);
  assert.deepEqual(second.next_calls[0].arguments, {
    id: RECORD_ID,
    slice_offset: 0,
    expected_source_digest: MOVED_FRESHNESS,
    slice_limit: 3,
    slice_status: ["todo"]
  });

  const restarted = await moved.run(second.next_calls[0].arguments);
  assert.equal(restarted.accepted, true);
  assert.equal(restarted.source_digest_matches, true);
  assert.equal(restarted.slice_page.offset, 0);
  assert.deepEqual(restarted.slice_page.status_filter, ["todo"]);
  assert.ok(restarted.slice_page.slices.length > 0 && restarted.slice_page.slices.length <= 3);
  assert.ok(restarted.slice_page.slices.every((slice) => slice.status === "todo"));
});

test("a matching digest continues without complaint", async () => {
  const driver = summaryDriver();
  const page = await driver.run({
    id: RECORD_ID,
    slice_offset: 0,
    expected_source_digest: SOURCE_FRESHNESS
  });
  assert.equal(page.accepted, true);
  assert.equal(page.source_digest_matches, true);
});

test("a limit above the server maximum clamps and the response states the applied limit", async () => {
  const driver = summaryDriver();
  const page = await driver.run({ id: RECORD_ID, slice_offset: 0, slice_limit: 5000 });

  assert.equal(page.slice_page.requested_limit, 5000);
  assert.equal(page.slice_page.applied_limit, WORK_RECORD_SLICE_PAGE_MAX_LIMIT);
  assert.equal(page.slice_page.limit_clamped, true);
  assert.equal(page.slice_page.limit_clamp_reason, "server_max_limit");
  assert.equal(page.slice_page.server_max_limit, WORK_RECORD_SLICE_PAGE_MAX_LIMIT);
});

test("the clamp applies to response size class, not only to count", async () => {

  const record = trackerRecord({ sliceCount: 60, titleFiller: "x".repeat(400) });
  const page = projectWorkRecordSlicePage(record, {
    offset: 0,
    limit: WORK_RECORD_SLICE_PAGE_MAX_LIMIT
  });

  assert.ok(
    page.applied_limit < WORK_RECORD_SLICE_PAGE_MAX_LIMIT,
    "a page of large slice rows is clamped below the count maximum"
  );
  assert.equal(page.limit_clamped, true);
  assert.equal(page.limit_clamp_reason, "response_size_class");
  assert.equal(page.returned, page.slices.length);
  assert.equal(page.applied_limit, page.returned, "the applied limit is stated, not silently truncated");
  assert.ok(Buffer.byteLength(JSON.stringify(page.slices), "utf8") <= 8192);
  assert.equal(page.has_more, true);
  assert.equal(page.next_offset, page.returned);
});

test("a status filter returns only that status and reports both populations", async () => {
  const record = trackerRecord();
  const doneCount = record.slices.filter((slice) => slice.status === "done").length;
  const driver = summaryDriver({ record });
  const page = await driver.run({ id: RECORD_ID, slice_offset: 0, slice_status: "done" });

  assert.deepEqual(page.slice_page.status_filter, ["done"]);
  assert.equal(
    page.slice_page.slices.every((slice) => slice.status === "done"),
    true
  );
  assert.equal(page.slice_page.filtered_total, doneCount);

  assert.equal(page.slice_page.unfiltered_total, 43);
  assert.ok(page.slice_page.unfiltered_total > page.slice_page.filtered_total);
});

test("an offset past the end is an empty, explicitly-final page rather than an error or a wrapped first page", async () => {
  const driver = summaryDriver();
  const page = await driver.run({ id: RECORD_ID, slice_offset: 500 });

  assert.equal(page.accepted, true);
  assert.deepEqual(page.slice_page.slices, []);
  assert.equal(page.slice_page.returned, 0);
  assert.equal(page.slice_page.final, true);
  assert.equal(page.slice_page.has_more, false);
  assert.equal(page.slice_page.next_offset, null);
  assert.deepEqual(page.next_calls, []);
});

test("enumeration composes with the compact-first gate: no prior read, no refusal, not an expensive option", async () => {
  const driver = summaryDriver();
  const page = await driver.run({ id: RECORD_ID, slice_offset: 0 });

  assert.equal(page.accepted, true);
  assert.equal(Object.hasOwn(page, "reason_code"), false);
  assert.equal(Object.hasOwn(page, "blocked_expensive_options"), false);
  assert.equal(driver.calls.length, 1, "the first enumeration call needs no prior compact read");
});

test("workspace_get_record serves the same enumeration on its own surface", async () => {
  const driver = getRecordDriver();
  const page = await driver.run({ id: RECORD_ID, slice_offset: 40 });

  assert.equal(page.tool, "workspace_get_record");
  assert.equal(page.accepted, true);
  assert.deepEqual(page.slice_page.slices.map((slice) => slice.id), [
    sliceId(40),
    sliceId(41),
    sliceId(42)
  ]);
  assert.equal(page.slice_page.final, true);
});

test("enumeration and a selected slice are mutually exclusive on both surfaces", async () => {
  const summary = summaryDriver();
  await assert.rejects(
    summary.run({ unit: `${RECORD_ID}#SLICE-002`, slice_offset: 0 }),
    (error) => error.name === "WorkRecordSelectorValidationError" &&
      error.code === "selector_conflict"
  );

  const getRecord = getRecordDriver();
  await assert.rejects(
    getRecord.run({ id: RECORD_ID, selected_slice: "SLICE-002", slice_offset: 0 }),
    (error) => error.name === "WorkRecordSelectorValidationError" &&
      error.code === "selector_conflict"
  );
});

test("the enumeration parameters are declared in the published schemas, not merely honored", () => {
  const summaryTools = captureRegisteredTools((registerTool) => {
    registerWorkRecordReadTools({
      registerTool,
      workspaceRepos: { repos: new Map() },
      z,
      jsonContent: (value) => value,
      errorContent: (error) => error,
      resolveWorkspaceRepo: () => ({ repo: WORKSPACE_REPO, dir: WORKSPACE_DIR }),
      createCompactValidateDispatchResponse: (value) => value
    });
  });
  const coreTools = captureRegisteredTools((registerTool) => {
    registerWikiCoreTools({
      registerTool,
      workspaceRepos: { repos: new Map() },
      z,
      emptySchema: {},
      extensionNamespacesSchema: z.array(z.string()).optional(),
      jsonContent: (value) => value,
      errorContent: (error) => error,
      resolveWorkspaceRepo: () => ({ repo: WORKSPACE_REPO, dir: WORKSPACE_DIR }),
      section: "primary"
    });
  });

  for (const [name, tools] of [
    ["workspace_work_record_summary", summaryTools],
    ["workspace_get_record", coreTools]
  ]) {
    const schema = tools.get(name).definition.inputSchema;
    const parsed = schema.parse({
      id: RECORD_ID,
      slice_offset: 0,
      slice_limit: 10,
      slice_status: ["todo", "active"],
      expected_source_digest: SOURCE_FRESHNESS
    });
    assert.equal(parsed.slice_offset, 0);
    assert.equal(parsed.slice_limit, 10);
    assert.deepEqual(parsed.slice_status, ["todo", "active"]);
    assert.equal(parsed.expected_source_digest, SOURCE_FRESHNESS);

    assert.throws(() => schema.parse({ id: RECORD_ID, slice_offset: -1 }));
    assert.throws(() => schema.parse({ id: RECORD_ID, slice_limit: 0 }));
  }

  const readPageSchema = coreTools.get("workspace_read_page").definition.inputSchema;
  assert.throws(() => readPageSchema.parse({
    path: `wiki/work-records/${RECORD_ID}.json`,
    slice_offset: 0
  }));
});

test("the default page size is the one the enumeration actually applies", async () => {
  const driver = summaryDriver();
  const page = await driver.run({ id: RECORD_ID, slice_offset: 0 });
  assert.equal(page.slice_page.requested_limit, WORK_RECORD_SLICE_PAGE_DEFAULT_LIMIT);
  assert.equal(page.slice_page.applied_limit, WORK_RECORD_SLICE_PAGE_DEFAULT_LIMIT);
  assert.equal(page.slice_page.limit_clamped, false);
  assert.equal(page.slice_page.limit_clamp_reason, null);
});
