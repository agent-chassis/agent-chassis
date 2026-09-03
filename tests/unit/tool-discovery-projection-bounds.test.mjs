import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";

import {
  compactToolDiscoveryEntry,
  describeToolDiscoveryTools,
  listToolDiscoveryTools,
  loadToolDiscoveryDescriptor,
  rankToolDiscoveryTools,
  TOOL_DISCOVERY_COMPACT_ENTRY_FIELDS,
  TOOL_DISCOVERY_LIST_ENTRY_FIELDS,
  TOOL_DISCOVERY_LIST_MAX_BYTES,
  TOOL_DISCOVERY_SCHEMA_VERSION
} from "../../packages/wiki-core/src/lib/tool-discovery.mjs";

import {
  createBoundedToolDiscoveryListEnvelope,
  TOOL_DISCOVERY_LIST_RESULT_MAX_BYTES
} from "../../packages/wiki-core/src/lib/tool-discovery/projection.mjs";
import {
  errorContent,
  guardToolHandler,
  jsonContent
} from "../../packages/wiki-mcp/src/lib/mcp-response.mjs";
import { registerToolDiscoveryTools } from "../../packages/wiki-mcp/src/lib/tool-discovery-tools.mjs";
import { makeTool } from "../tool-discovery-helpers.mjs";

function assertNoDuplicateSummaryField(row, context) {
  assert.ok(
    !Object.prototype.hasOwnProperty.call(row, "description_summary"),
    `${context}: compact row must not emit description_summary`
  );
  if (
    Object.prototype.hasOwnProperty.call(row, "summary") &&
    Object.prototype.hasOwnProperty.call(row, "description_summary")
  ) {
    assert.notEqual(
      row.summary,
      row.description_summary,
      `${context}: compact row must not carry byte-identical summary/description_summary`
    );
  }
}

test("WK-1041#SLICE-001 compact projection keeps summary and drops the duplicate description_summary", async () => {

  assert.ok(
    TOOL_DISCOVERY_COMPACT_ENTRY_FIELDS.includes("summary"),
    "compact field set must retain summary"
  );
  assert.ok(
    !TOOL_DISCOVERY_COMPACT_ENTRY_FIELDS.includes("description_summary"),
    "compact field set must not list description_summary"
  );

  const compacted = compactToolDiscoveryEntry({
    tool_name: "fixture_tool",
    display_name: "Fixture Tool",
    kind: "cli_command",
    entrypoint: "run fixture_tool",
    task_ids: ["dispatch-worker"],
    runtime_posture: "supported",
    recommended_route: "cli",
    priority: 10,
    notes: "Does a fixture thing. Extra detail that should not bloat the row."
  });
  assert.equal(
    compacted.summary,
    "Does a fixture thing.",
    "summary must be backfilled from the first notes sentence"
  );
  assertNoDuplicateSummaryField(compacted, "compactToolDiscoveryEntry(notes-only)");

  const descriptor = await loadToolDiscoveryDescriptor();
  const listed = listToolDiscoveryTools(descriptor);
  assert.ok(listed.tools.length > 0, "expected at least one compact list row");
  for (const row of listed.tools) {
    assertNoDuplicateSummaryField(row, `listToolDiscoveryTools ${row.tool_name}`);
  }

  for (const row of describeToolDiscoveryTools(descriptor, {}, { verbose: false })) {
    assertNoDuplicateSummaryField(row, `describeToolDiscoveryTools compact ${row.tool_name}`);
  }

  for (const row of rankToolDiscoveryTools(descriptor, {}, { verbose: false })) {
    assertNoDuplicateSummaryField(row, `rankToolDiscoveryTools compact ${row.tool_name}`);
  }

  const verbose = rankToolDiscoveryTools(descriptor, {}, { verbose: true });
  assert.ok(verbose.length > 0, "expected verbose rows");
  assert.ok(
    verbose.some((row) => Object.prototype.hasOwnProperty.call(row, "notes")),
    "verbose rows must still expose raw notes"
  );
});

test("default list rows keep only selection-critical fields with exact count metadata", async () => {
  const descriptor = await loadToolDiscoveryDescriptor();
  const listed = listToolDiscoveryTools(descriptor);
  const expectedFields = ["task_ids", "tool_name"];

  assert.deepEqual([...TOOL_DISCOVERY_LIST_ENTRY_FIELDS].sort(), expectedFields);
  assert.ok(listed.tools.length > 0);
  for (const row of listed.tools) {
    assert.deepEqual(Object.keys(row).sort(), expectedFields);
  }
  assert.equal(listed.returned_count, listed.tools.length);
  assert.equal(listed.truncated_count, listed.total_count - listed.returned_count);
  assert.equal(listed.count_truncated, listed.total_count > listed.limit_applied);
  assert.equal(listed.byte_truncated, false);
  assert.equal(listed.truncated, listed.truncated_count > 0);
  assert.equal(listed.byte_limit, TOOL_DISCOVERY_LIST_MAX_BYTES);
  assert.ok(Buffer.byteLength(JSON.stringify(listed, null, 2), "utf8") <= listed.byte_limit);
  assert.equal(listed.next_calls[0].tool, "workspace_tools_query");
  assert.deepEqual(listed.next_calls[0].target_by, ["task_id", "tool_name"]);
});

test("large catalogs enforce count and byte bounds independently", () => {
  const tools = Array.from({ length: 240 }, (_, index) =>
    makeTool(
      `synthetic_tool_${String(index).padStart(3, "0")}_${"x".repeat(72)}`,
      {
        task_ids: [
          "dispatch-worker",
          `synthetic-selection-task-${String(index).padStart(3, "0")}`
        ]
      }
    )
  );

  const countBounded = listToolDiscoveryTools(tools, {}, { defaultLimit: 3 });
  assert.equal(countBounded.total_count, tools.length);
  assert.equal(countBounded.returned_count, 3);
  assert.equal(countBounded.truncated_count, tools.length - 3);
  assert.equal(countBounded.count_truncated, true);
  assert.equal(countBounded.byte_truncated, false);

  const byteBounded = listToolDiscoveryTools(tools, { limit: 10_000 });
  assert.equal(byteBounded.total_count, tools.length);
  assert.equal(byteBounded.limit_applied, 10_000);
  assert.equal(byteBounded.count_truncated, false);
  assert.equal(byteBounded.byte_truncated, true);
  assert.equal(byteBounded.returned_count, byteBounded.tools.length);
  assert.equal(byteBounded.truncated_count, tools.length - byteBounded.returned_count);
  assert.equal(byteBounded.truncated, true);
  assert.ok(byteBounded.returned_count > 0);
  assert.ok(byteBounded.returned_count < tools.length);
  assert.ok(
    Buffer.byteLength(JSON.stringify(byteBounded, null, 2), "utf8") <=
      TOOL_DISCOVERY_LIST_MAX_BYTES
  );
});

function measureTwoChannelResultBytes(envelope) {
  const json = JSON.stringify(envelope);
  return Buffer.byteLength(
    JSON.stringify({ content: [{ type: "text", text: json }], structuredContent: envelope }),
    "utf8"
  );
}

function makeLargeSyntheticCatalog(count) {
  return Array.from({ length: count }, (_, index) =>
    makeTool(`synthetic_tool_${String(index).padStart(4, "0")}_${"é".repeat(48)}`, {
      task_ids: ["dispatch-worker", `synthetic-selection-task-${String(index).padStart(4, "0")}`]
    })
  );
}

test("the complete-result ceiling bounds the list independently of the structured payload", () => {
  const tools = makeLargeSyntheticCatalog(400);

  const structuredOnly = listToolDiscoveryTools(tools, { limit: 10_000 });
  const dualBounded = listToolDiscoveryTools(
    tools,
    { limit: 10_000 },
    { measureResultBytes: measureTwoChannelResultBytes }
  );

  for (const envelope of [structuredOnly, dualBounded]) {
    assert.ok(
      Buffer.byteLength(JSON.stringify(envelope, null, 2), "utf8") <= TOOL_DISCOVERY_LIST_MAX_BYTES
    );
  }
  assert.ok(
    measureTwoChannelResultBytes(structuredOnly) > TOOL_DISCOVERY_LIST_RESULT_MAX_BYTES,
    "the fixture must be large enough that the structured bound alone is insufficient"
  );
  assert.ok(
    measureTwoChannelResultBytes(dualBounded) <= TOOL_DISCOVERY_LIST_RESULT_MAX_BYTES
  );
  assert.ok(dualBounded.returned_count > 0);
  assert.ok(dualBounded.returned_count < structuredOnly.returned_count);

  assert.equal(dualBounded.total_count, tools.length);
  assert.equal(dualBounded.returned_count, dualBounded.tools.length);
  assert.equal(dualBounded.truncated_count, tools.length - dualBounded.returned_count);
  assert.equal(dualBounded.limit_applied, 10_000);
  assert.equal(dualBounded.byte_limit, TOOL_DISCOVERY_LIST_MAX_BYTES);
  assert.equal(dualBounded.result_byte_limit, TOOL_DISCOVERY_LIST_RESULT_MAX_BYTES);
  assert.equal(dualBounded.count_truncated, false);
  assert.equal(dualBounded.byte_truncated, true);
  assert.equal(dualBounded.truncated, true);
  assert.deepEqual(
    dualBounded.next_calls.map((entry) => entry.tool),
    ["workspace_tools_query", "workspace_tools_describe"]
  );

  const raised = listToolDiscoveryTools(
    tools,
    { limit: 1_000_000 },
    { measureResultBytes: measureTwoChannelResultBytes }
  );
  assert.equal(raised.returned_count, dualBounded.returned_count);
  assert.ok(measureTwoChannelResultBytes(raised) <= TOOL_DISCOVERY_LIST_RESULT_MAX_BYTES);

  assert.equal(structuredOnly.result_byte_limit, undefined);
});

test("a larger synthetic catalog stays bounded at every count limit", () => {
  const tools = makeLargeSyntheticCatalog(900);
  const expectedOrder = rankToolDiscoveryTools(tools, {}, { verbose: false }).map(
    (row) => row.tool_name
  );

  for (const limit of [1, 5, 20, 200, 10_000]) {
    const bounded = listToolDiscoveryTools(
      tools,
      { limit },
      { measureResultBytes: measureTwoChannelResultBytes }
    );
    const label = `limit=${limit}`;
    assert.ok(
      Buffer.byteLength(JSON.stringify(bounded, null, 2), "utf8") <= TOOL_DISCOVERY_LIST_MAX_BYTES,
      label
    );
    assert.ok(measureTwoChannelResultBytes(bounded) <= TOOL_DISCOVERY_LIST_RESULT_MAX_BYTES, label);
    assert.equal(bounded.total_count, tools.length, label);
    assert.equal(bounded.returned_count, bounded.tools.length, label);
    assert.equal(bounded.truncated_count, tools.length - bounded.returned_count, label);
    assert.equal(bounded.count_truncated, tools.length > limit, label);
    assert.equal(bounded.truncated, true, label);
    assert.ok(bounded.next_calls.length === 2, label);
    for (const row of bounded.tools) {
      assert.deepEqual(Object.keys(row).sort(), ["task_ids", "tool_name"], label);
    }

    assert.deepEqual(
      bounded.tools.map((row) => row.tool_name),
      expectedOrder.slice(0, bounded.returned_count),
      label
    );
  }
});

test("oversized carried-over diagnostics are shed rather than crowding out the catalog", () => {
  const tools = makeLargeSyntheticCatalog(40).map((tool) => compactToolDiscoveryEntry(tool));
  const diagnostics = Array.from({ length: 120 }, (_, index) => ({
    code: "invalid_task_id",
    level: "error",
    message: `tools[${index}].task_ids[0] is not a controlled task id`,
    paths: [`tools[${index}].task_ids[0]`]
  }));

  const healthy = createBoundedToolDiscoveryListEnvelope(
    { schema_version: TOOL_DISCOVERY_SCHEMA_VERSION, diagnostics: [] },
    tools,
    { totalCount: tools.length, limit: 5, resultField: "tools" }
  );
  assert.deepEqual(healthy.diagnostics, [], "a healthy envelope keeps its diagnostics verbatim");
  assert.equal(healthy.diagnostics_omitted, undefined);
  assert.equal(healthy.returned_count, 5);

  const degraded = createBoundedToolDiscoveryListEnvelope(
    { schema_version: TOOL_DISCOVERY_SCHEMA_VERSION, diagnostics },
    tools,
    {
      totalCount: tools.length,
      limit: 20,
      resultField: "tools",
      measureResultBytes: measureTwoChannelResultBytes
    }
  );
  assert.equal(degraded.diagnostics, undefined, "diagnostics detail is shed, not truncated in place");
  assert.equal(degraded.diagnostics_omitted, diagnostics.length);
  assert.ok(degraded.returned_count > 0, "the catalog scan still returns selectable rows");
  assert.equal(degraded.total_count, tools.length);
  assert.ok(measureTwoChannelResultBytes(degraded) <= TOOL_DISCOVERY_LIST_RESULT_MAX_BYTES);
  assert.ok(
    Buffer.byteLength(JSON.stringify(degraded, null, 2), "utf8") <= TOOL_DISCOVERY_LIST_MAX_BYTES
  );
});

test("WK-2172: following next_offset enumerates the complete catalog exactly once", () => {
  const tools = makeLargeSyntheticCatalog(300);
  const expectedOrder = rankToolDiscoveryTools(tools, {}, { verbose: false }).map(
    (row) => row.tool_name
  );
  const seenNames = [];
  let offset = 0;
  let pages = 0;
  let page;

  do {
    page = listToolDiscoveryTools(
      tools,
      { limit: 10_000 },
      { offset, measureResultBytes: measureTwoChannelResultBytes }
    );
    pages += 1;
    const label = `offset=${offset}`;

    assert.ok(
      Buffer.byteLength(JSON.stringify(page, null, 2), "utf8") <= TOOL_DISCOVERY_LIST_MAX_BYTES,
      label
    );
    assert.ok(measureTwoChannelResultBytes(page) <= TOOL_DISCOVERY_LIST_RESULT_MAX_BYTES, label);
    assert.equal(page.offset, offset, label);
    assert.equal(page.total_count, tools.length, label);
    assert.equal(page.returned_count, page.tools.length, label);
    assert.ok(page.returned_count > 0, `${label}: a page must make forward progress`);

    seenNames.push(...page.tools.map((row) => row.tool_name));

    if (page.has_more) {

      assert.equal(page.next_offset, offset + page.returned_count, label);
      offset = page.next_offset;
    } else {
      assert.equal(page.next_offset, null, label);
    }
    assert.ok(pages <= tools.length, "paging must terminate");
  } while (page.has_more);

  assert.ok(pages > 1, "the fixture must be large enough to force multiple pages");

  assert.equal(seenNames.length, tools.length);
  assert.equal(new Set(seenNames).size, tools.length);
  assert.deepEqual(seenNames, expectedOrder);
});

test("WK-2172: a page bounded by bytes rather than count resumes at the first row it dropped", () => {
  const tools = makeLargeSyntheticCatalog(400);
  const fullRanking = rankToolDiscoveryTools(tools, {}, { verbose: false }).map(
    (row) => row.tool_name
  );

  const first = listToolDiscoveryTools(
    tools,
    { limit: 10_000 },
    { measureResultBytes: measureTwoChannelResultBytes }
  );

  assert.equal(first.count_truncated, false);
  assert.equal(first.byte_truncated, true);
  assert.equal(first.truncated, true);
  assert.equal(first.offset, 0);
  assert.equal(first.has_more, true);
  assert.equal(first.next_offset, first.returned_count);

  const second = listToolDiscoveryTools(
    tools,
    { limit: 10_000 },
    { offset: first.next_offset, measureResultBytes: measureTwoChannelResultBytes }
  );
  assert.equal(second.offset, first.next_offset);
  assert.ok(second.returned_count > 0);
  assert.ok(measureTwoChannelResultBytes(second) <= TOOL_DISCOVERY_LIST_RESULT_MAX_BYTES);
  assert.ok(
    Buffer.byteLength(JSON.stringify(second, null, 2), "utf8") <= TOOL_DISCOVERY_LIST_MAX_BYTES
  );

  assert.deepEqual(
    first.tools.map((row) => row.tool_name),
    fullRanking.slice(0, first.returned_count)
  );
  assert.equal(second.tools[0].tool_name, fullRanking[first.returned_count]);
  assert.deepEqual(
    second.tools.map((row) => row.tool_name),
    fullRanking.slice(second.offset, second.offset + second.returned_count)
  );
  assert.deepEqual(
    [...first.tools, ...second.tools].map((row) => row.tool_name),
    fullRanking.slice(0, second.offset + second.returned_count)
  );
});

test("WK-2172: neither a caller limit nor an offset can buy rows past the byte ceiling", () => {
  const tools = makeLargeSyntheticCatalog(400);
  const offset = 50;

  const bounded = listToolDiscoveryTools(
    tools,
    { limit: 10_000 },
    { offset, measureResultBytes: measureTwoChannelResultBytes }
  );
  const raised = listToolDiscoveryTools(
    tools,
    { limit: 1_000_000 },
    { offset, measureResultBytes: measureTwoChannelResultBytes }
  );
  assert.equal(raised.returned_count, bounded.returned_count);

  for (const [label, page] of [["bounded", bounded], ["raised", raised]]) {
    assert.ok(
      Buffer.byteLength(JSON.stringify(page, null, 2), "utf8") <= TOOL_DISCOVERY_LIST_MAX_BYTES,
      label
    );
    assert.ok(measureTwoChannelResultBytes(page) <= TOOL_DISCOVERY_LIST_RESULT_MAX_BYTES, label);
    assert.equal(page.offset, offset, label);
    assert.equal(page.byte_truncated, true, label);
    assert.equal(page.total_count, tools.length, label);
    assert.equal(page.has_more, true, label);
    assert.equal(page.next_offset, offset + page.returned_count, label);
  }

  const structuredOnly = listToolDiscoveryTools(tools, { limit: 1_000_000 }, { offset });
  assert.ok(
    Buffer.byteLength(JSON.stringify(structuredOnly, null, 2), "utf8") <=
      TOOL_DISCOVERY_LIST_MAX_BYTES
  );
  assert.equal(structuredOnly.offset, offset);

  const past = listToolDiscoveryTools(
    tools,
    { limit: 20 },
    { offset: tools.length + 10, measureResultBytes: measureTwoChannelResultBytes }
  );
  assert.equal(past.returned_count, 0);
  assert.equal(past.has_more, false);
  assert.equal(past.next_offset, null);
  assert.equal(past.total_count, tools.length);
});

function registerShapedDiscoveryHandlers({ augmentDescriptor, sessionRole = "operator" } = {}) {
  const handlers = new Map();
  registerToolDiscoveryTools({
    registerTool(name, _definition, handler) {
      handlers.set(name, guardToolHandler(handler, { name }));
    },
    jsonContent,
    errorContent,
    augmentDescriptor,
    registeredTier: "paid_cce",
    sessionRole
  });
  return handlers;
}

test("WK-2172: the registered workspace_tools_list route pages on a non-zero offset", async () => {
  const descriptor = await loadToolDiscoveryDescriptor();
  const template = (descriptor.tools || []).find((tool) => Array.isArray(tool.task_ids));
  assert.ok(template, "the descriptor must carry at least one entry with task ids");

  const CATALOG_SIZE = 12;
  const catalog = Array.from({ length: CATALOG_SIZE }, (_, index) => ({
    ...template,
    tool_name: `paged_tool_${String(index).padStart(2, "0")}`,
    display_name: `Paged ${index}`,
    entrypoint: `paged_tool_${String(index).padStart(2, "0")}`,
    task_ids: [...template.task_ids]
  }));
  const handlers = registerShapedDiscoveryHandlers({
    augmentDescriptor: (loaded) => ({ ...loaded, tools: catalog })
  });
  const list = (args) => handlers.get("workspace_tools_list")(args);

  const unpaged = (await list({ limit: 10_000 })).structuredContent;
  assert.equal(unpaged.total_count, CATALOG_SIZE);
  assert.equal(unpaged.returned_count, CATALOG_SIZE, "the whole catalog must fit one response");
  assert.equal(unpaged.truncated, false);
  const fullRanking = unpaged.results.map((row) => row.tool_name);

  const middle = (await list({ limit: 4, offset: 6 })).structuredContent;
  assert.equal(middle.offset, 6);
  assert.equal(middle.returned_count, 4);
  assert.deepEqual(middle.results.map((row) => row.tool_name), fullRanking.slice(6, 10));
  for (const row of middle.results) {
    assert.deepEqual(Object.keys(row).sort(), ["task_ids", "tool_name"]);
  }
  assert.equal(middle.has_more, true);
  assert.equal(middle.next_offset, 10);

  assert.equal(middle.truncated_count, CATALOG_SIZE - (6 + 4));

  const last = (await list({ limit: 4, offset: 8 })).structuredContent;
  assert.equal(last.offset, 8);
  assert.deepEqual(last.results.map((row) => row.tool_name), fullRanking.slice(8, CATALOG_SIZE));
  assert.equal(last.count_truncated, false);
  assert.equal(last.byte_truncated, false);
  assert.equal(last.truncated, false);
  assert.equal(last.has_more, false);
  assert.equal(last.next_offset, null);
  assert.equal(last.truncated_count, 0);

  const past = (await list({ limit: 4, offset: 1_000 })).structuredContent;
  assert.equal(past.returned_count, 0);
  assert.equal(past.truncated_count, 0);
  assert.equal(past.has_more, false);
});
