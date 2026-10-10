

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { jsonContent, measureMcpInlineResultBytes } from "../../packages/wiki-mcp/src/lib/mcp-response.mjs";
import {
  createSelectedResponseSession,
  selectedResponseDetailSchema,
  selectedResponseRequestSchema
} from "../../packages/wiki-mcp/src/lib/selected-response-snapshot.mjs";
import { assertStructuredCarrier } from "../helpers/mcp-journey-accounting.mjs";
import { createTestResourceScope } from "../helpers/test-resource-scope.mjs";

const ROUTE = "query_code_index";
const AUTHORITY = Object.freeze({ role: "orchestrator", run: { run_id: "run-a", retry_id: 0 } });
const FIXTURE_MARKER = "selector-lookup-fixture-collection";
const NATIVE_FILTER = Array.prototype.filter;
const SNAPSHOT_SOURCE = fileURLToPath(new URL(
  "../../packages/wiki-mcp/src/lib/selected-response-snapshot.mjs", import.meta.url));

function authoredCarrier(label, { rows: rowCount = 600 } = {}) {
  const parts = [];
  const groups = new Map();
  const add = (id, text) => {
    const row = { id, value: { marker: FIXTURE_MARKER, text: `${label} ${text} ${"x".repeat(96)}` } };
    parts.push(row);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(row);
  };
  for (let index = 0; index < rowCount; index += 1) {
    if (index % 3 === 0) add("group", `group row ${index}`);
    else if (index % 50 === 1) add("__proto__", `proto row ${index}`);
    else if (index % 50 === 2) add("constructor", `constructor row ${index}`);
    else if (index % 50 === 4) add("toString", `toString row ${index}`);
    else add(`unrelated-${index}`, `unrelated row ${index}`);
  }

  const other = [{ id: "group", value: { marker: "other", text: `${label} other group 0` } },
    { id: "single", value: { marker: "other", text: `${label} other single` } },
    { id: "group", value: { marker: "other", text: `${label} other group 1` } }];
  return { carrier: { parts, other, empty: [] }, parts, groups, other };
}

test("selected response reuses id groups without rescanning unrelated rows", async (t) => {
  const scope = createTestResourceScope();
  t.after(() => scope.dispose());
  const dir = await scope.acquire("response state",
    () => mkdtempSync(path.join(os.tmpdir(), "selected-lookup-")),
    (created) => rmSync(created, { recursive: true, force: true }));
  const env = { ...process.env, WIKI_MCP_RESPONSE_STATE_DIR: dir };
  const first = authoredCarrier("first");
  const second = authoredCarrier("second", { rows: 90 });
  const unrelatedToGroup = first.parts.length - first.groups.get("group").length;
  assert.ok(first.groups.get("group").length === 200 && unrelatedToGroup === 400);

  const scans = { calls: 0, unrelated: 0 };
  t.after(() => { Array.prototype.filter = NATIVE_FILTER; });
  Array.prototype.filter = function filter(predicate, ...rest) {
    if (this.length < 50 || this[1]?.value?.marker !== FIXTURE_MARKER) {
      return NATIVE_FILTER.call(this, predicate, ...rest);
    }
    scans.calls += 1;
    return NATIVE_FILTER.call(this, (row, ...position) => {
      const kept = predicate(row, ...position);
      if (!kept) scans.unrelated += 1;
      return kept;
    }, ...rest);
  };

  let projections = 0;
  let currentHead = "A";
  const createSession = () => createSelectedResponseSession({
    route: ROUTE,
    requestSchema: selectedResponseRequestSchema(z.object({ detail: selectedResponseDetailSchema(z) }).strict()),
    buildDetailArguments: (_binding, selection) => ({ detail: selection }),
    requireAuthorityIdentity: true,

    projectCollections: (carrier) => { projections += 1; return { ...carrier }; },
    resolveCurrentObservationIdentity: () => currentHead,
    env
  });
  const binding = { route: ROUTE, repository: "fixture-repo", unit: null, observation_identity: "A",
    authority_identity: AUTHORITY };
  const expected = { route: ROUTE, repository: "fixture-repo", unit: null, authority_identity: AUTHORITY };
  const frames = [];
  const read = async (session, detail) => {
    const response = await session.detail({ expected, detail });
    assert.ok(measureMcpInlineResultBytes(response) <= session.maximumBytes, "the frame fits the bound");
    assertStructuredCarrier(jsonContent(response, { env }));
    frames.push(response);
    return response;
  };

  const pagesFrom = async (session, detail) => {
    const pages = [];
    for (let next = detail; next !== undefined; next = pages.at(-1).next_calls[0]?.arguments.detail) {
      pages.push(await read(session, next));
      assert.ok(pages.length < 400, "the traversal terminates");
    }
    return pages;
  };
  const rowsOf = (pages) => pages.flatMap((response) => response.page.items);

  const warm = createSession();
  const { source, snapshot_identity: snapshotIdentity } = warm.retain({ binding, carrier: first.carrier });
  const retainedSecond = warm.retain({ binding, carrier: second.carrier });
  assert.equal(projections, 2, "each retention projects once");
  const hot = { source, snapshot_identity: snapshotIdentity };
  const scansBeforeReads = { ...scans };

  const groupPages = await pagesFrom(warm, { ...hot, collection: "parts", selector: { id: "group" } });
  assert.ok(groupPages.length > 3, "the selected group needs several pages");
  assert.ok(groupPages.every((response) => response.page.total === 200));
  assert.deepEqual(rowsOf(groupPages), first.groups.get("group"));
  assert.deepEqual(groupPages.map((response) => response.page.offset),
    groupPages.map((_, index) => rowsOf(groupPages.slice(0, index)).length));
  const repeated = await pagesFrom(warm, { ...hot, collection: "parts", selector: { id: "group" } });
  assert.deepEqual(repeated.map((response) => [response.page.offset, response.page.items]),
    groupPages.map((response) => [response.page.offset, response.page.items]));
  const third = groupPages[2];
  const sought = await read(warm, { ...hot, collection: "parts", selector: { id: "group" },
    ordinal: third.page.offset });
  assert.deepEqual([sought.page.offset, sought.page.items], [third.page.offset, third.page.items]);

  for (const id of ["__proto__", "constructor", "toString", "unrelated-5", "absent", "hasOwnProperty"]) {
    const rows = first.groups.get(id) ?? [];
    const pages = await pagesFrom(warm, { ...hot, collection: "parts", selector: { id } });
    assert.deepEqual([pages[0].page.total, rowsOf(pages)], [rows.length, rows], id);
  }
  assert.ok(first.groups.get("__proto__").length > 1 && first.groups.get("constructor").length > 1);

  assert.deepEqual(rowsOf(await pagesFrom(warm, { ...hot, collection: "other", selector: { id: "group" } })),
    [first.other[0], first.other[2]]);
  const secondHot = { source: retainedSecond.source, snapshot_identity: retainedSecond.snapshot_identity };
  assert.deepEqual(rowsOf(await pagesFrom(warm, { ...secondHot, collection: "parts", selector: { id: "group" } })),
    second.groups.get("group"));
  assert.deepEqual(rowsOf(await pagesFrom(warm, { ...secondHot, collection: "other", selector: { id: "group" } })),
    [second.other[0], second.other[2]]);

  for (const detail of [{ collection: "empty" }, { collection: "empty", selector: { id: "group" } }]) {
    const empty = await read(warm, { ...hot, ...detail });
    assert.deepEqual([empty.page.total, empty.page.items, empty.next_calls], [0, [], []]);
  }

  assert.deepEqual(rowsOf(await pagesFrom(warm, { ...hot, collection: "parts" })), first.parts);

  assert.equal(projections, 2, "snapshot and cursor reads reuse the retained projection");
  assert.deepEqual(scans, scansBeforeReads, "no selected read filters the whole backing collection");
  assert.deepEqual(scans, { calls: 0, unrelated: 0 });

  const counted = first.parts.filter((row) => row.id === "group");
  assert.deepEqual([counted.length, scans.calls, scans.unrelated], [200, 1, unrelatedToGroup]);

  const source_text = readFileSync(SNAPSHOT_SOURCE, "utf8");
  const projectPage = source_text.slice(source_text.indexOf("projectPage: ({"),
    source_text.indexOf("projectPageContext:"));
  assert.match(projectPage, /selector === null \? rows : rowsWithId\(rows, selector\.id\)/u);
  assert.doesNotMatch(projectPage, /\.filter\(|\.find\(|\.reduce\(|\.forEach\(|\bfor\s*\(|\bwhile\s*\(/u);
  const lookup = source_text.slice(source_text.indexOf("function rowsWithId("),
    source_text.indexOf("const registry = createTaskResultSnapshotRegistry"));
  assert.match(lookup, /idGroupsByCollection\.get\(rows\)[\s\S]*if \(groups === undefined\) \{[\s\S]*for \(const row of rows\)[\s\S]*idGroupsByCollection\.set\(rows, groups\);\s*\}\s*return groups\.get\(id\)/u,
    "the only pass over a collection is inside the build-once branch");
  assert.equal(source_text.split("new WeakMap()").length - 1, 2, "the index is a session-local WeakMap");

  currentHead = "B";
  const cold = createSession();
  const lost = groupPages[1].next_calls[0].arguments.detail;
  const refusal = await cold.detail({ expected, detail: lost })
    .then(() => assert.fail("a lost cursor is refused"), (error) => error.envelope);
  assert.equal(refusal.code, "selected_response_snapshot_unavailable");
  const recovery = refusal.next_calls[0].arguments.detail;
  assert.deepEqual(recovery, { source, collection: "parts", selector: { id: "group" },
    ordinal: third.page.offset });
  const recovered = await pagesFrom(cold, recovery);
  assert.equal(projections, 3, "cold recovery projects the source once");
  assert.equal(recovered[0].observation.state, "changed");
  assert.deepEqual(recovered.map((response) => [response.page.offset, response.page.total, response.page.items]),
    groupPages.slice(2).map((response) => [response.page.offset, 200, response.page.items]));

  const coldHot = { source, snapshot_identity: recovered[0].next_calls[0].arguments.detail.snapshot_identity };
  for (let pass = 0; pass < 3; pass += 1) {
    assert.deepEqual(rowsOf(await pagesFrom(cold, { ...coldHot, collection: "parts", selector: { id: "group" } })),
      first.groups.get("group"));
  }
  assert.equal(projections, 3);
  assert.deepEqual(scans, { calls: 1, unrelated: unrelatedToGroup }, "only the test's own control filtered");
  assert.ok(frames.length > 40);
});

test("the selector lookup test leaves no mock behind", () => {
  assert.equal(Array.prototype.filter, NATIVE_FILTER);
});
