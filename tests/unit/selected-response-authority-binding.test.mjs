

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { z } from "zod";

import { measureMcpInlineResultBytes } from "../../packages/wiki-mcp/src/lib/mcp-response.mjs";
import {
  createSelectedResponseSession,
  readSelectedResponseSource,
  selectedResponseDetailSchema,
  selectedResponseRequestSchema
} from "../../packages/wiki-mcp/src/lib/selected-response-snapshot.mjs";
import { createTestResourceScope } from "../helpers/test-resource-scope.mjs";

const isDeepStrictEqualSelector = (actual, expectedValue) => JSON.stringify(actual) === JSON.stringify(expectedValue);

const ROUTE = "workspace_assess_contract";
const MARKER = "retained-carrier-marker-λ";
const WORKER_A = Object.freeze({ role: "worker", run: { run_id: "run-a", retry_id: 0 },
  population: { kind: "assigned", unit: "WK-0001#SLICE-001" }, source_generation: "sha256:aaa" });
const WORKER_B = Object.freeze({ ...WORKER_A, run: { run_id: "run-b", retry_id: 0 } });
const REVIEWER = Object.freeze({ role: "reviewer", run: { run_id: "run-a", retry_id: 0 },
  population: { kind: "repository" }, source_generation: "sha256:aaa" });

function session(env, options = {}) {
  return createSelectedResponseSession({
    route: ROUTE,
    requestSchema: selectedResponseRequestSchema(z.object({ unit: z.string().min(1),
      detail: selectedResponseDetailSchema(z) }).strict()),
    buildDetailArguments: (binding, selection) => ({ unit: binding.unit, detail: selection }),
    env,
    ...options
  });
}

function binding(authority) {
  return { route: ROUTE, repository: "fixture-repo", unit: "WK-0001#SLICE-001",
    ...(authority === undefined ? {} : { authority_identity: authority }) };
}

function expected(authority) {
  return { route: ROUTE, repository: "fixture-repo", unit: "WK-0001#SLICE-001",
    ...(authority === undefined ? {} : { authority_identity: authority }) };
}

const carrier = { rows: Array.from({ length: 180 }, (_, index) =>
  ({ index, text: `${MARKER} ${index} ${"x".repeat(80)}` })) };

function refusedBefore(disclosure, reason) {
  return (error) => {
    assert.equal(error?.envelope?.code, "selected_response_query_invalid", String(error?.stack ?? error));
    assert.equal(JSON.stringify(error.envelope).includes(MARKER), false,
      "a refusal discloses no retained carrier content");
    const facts = Object.fromEntries(error.envelope.deciding_facts.map(({ field, value }) => [field, value]));
    assert.equal(facts["selected_response.invalid_reason"], reason, disclosure);
    return true;
  };
}

test("selected response validates authority on hot and retained detail paths", async () => {
  const scope = createTestResourceScope();
  try {
    const dir = await scope.acquire("response state",
      () => mkdtempSync(path.join(os.tmpdir(), "selected-authority-")),
      (created) => rmSync(created, { recursive: true, force: true }));
    const env = { ...process.env, WIKI_MCP_RESPONSE_STATE_DIR: dir };
    const requiring = session(env, { requireAuthorityIdentity: true });

    assert.throws(() => requiring.retain({ binding: binding(), carrier }),
      refusedBefore("retention without identity", "authority_identity_missing"));
    const { source, snapshot_identity: snapshotIdentity } =
      requiring.retain({ binding: binding(WORKER_A), carrier });
    const envelope = readSelectedResponseSource(source, { env, expected: { route: ROUTE } });
    assert.deepEqual(envelope.binding.authority_identity, WORKER_A,
      "the retained envelope carries the authority identity");

    const first = await requiring.detail({ expected: expected(WORKER_A),
      detail: { source, snapshot_identity: snapshotIdentity, collection: "rows" } });
    assert.ok(first.page.items.length > 0 && first.page.items.length < carrier.rows.length);
    assert.match(first.page.retained_source.authority_identity_sha256, /^[0-9a-f]{64}$/u,
      "the hot summary carries the comparable identity");
    const cursorDetail = first.next_calls[0].arguments.detail;
    assert.ok(cursorDetail.cursor, "the collection continues by cursor");
    for (const [label, authority, reason] of [
      ["absent expected", undefined, "authority_identity_missing"],
      ["cross-run", WORKER_B, "source_binding_mismatch"],
      ["cross-role", REVIEWER, "source_binding_mismatch"]]) {
      await assert.rejects(requiring.detail({ expected: expected(authority),
        detail: { source, snapshot_identity: snapshotIdentity, collection: "rows" } }),
      refusedBefore(`snapshot identity: ${label}`, reason));

      await assert.rejects(requiring.detail({ expected: expected(authority), detail: cursorDetail }),
        refusedBefore(`hot cursor: ${label}`, reason));
    }
    const continued = await requiring.detail({ expected: expected(WORKER_A), detail: cursorDetail });
    assert.equal(continued.page.offset, first.page.items.length);

    const restarted = session(env, { requireAuthorityIdentity: true });
    for (const [label, authority, reason] of [
      ["absent expected", undefined, "authority_identity_missing"],
      ["cross-run", WORKER_B, "source_binding_mismatch"],
      ["cross-role", REVIEWER, "source_binding_mismatch"]]) {
      await assert.rejects(restarted.detail({ expected: expected(authority),
        detail: { source, collection: "rows" } }), refusedBefore(`cold locator: ${label}`, reason));
    }
    const rehydrated = await restarted.detail({ expected: expected(WORKER_A),
      detail: { source, collection: "rows" } });
    assert.deepEqual(rehydrated.page.items, first.page.items, "the equal identity reads the same page");

    await assert.rejects(restarted.detail({ expected: expected(WORKER_A), detail: cursorDetail }),
      (error) => error?.envelope?.code === "selected_response_snapshot_unavailable");

    const unconfigured = session(env);
    const legacyShape = unconfigured.retain({ binding: binding(), carrier });
    const retainedBinding = readSelectedResponseSource(legacyShape.source,
      { env, expected: { route: ROUTE } }).binding;
    assert.deepEqual(Object.keys(retainedBinding).sort(),
      ["observation_identity", "query_identity", "repository", "route", "unit"],
      "an unconfigured session keeps its exact retained binding shape");
    await assert.rejects(restarted.detail({ expected: expected(WORKER_A),
      detail: { source: legacyShape.source, collection: "rows" } }),
    refusedBefore("cold locator without retained identity", "source_binding_mismatch"));

    const plain = await unconfigured.detail({ expected: expected(),
      detail: { source: legacyShape.source, snapshot_identity: legacyShape.snapshot_identity,
        collection: "rows" } });
    assert.equal(Object.hasOwn(plain.page.retained_source, "authority_identity_sha256"), false);
    assert.equal(plain.page.items[0].value.index, 0);
  } finally {
    await scope.dispose();
  }
});

test("WK-2721: a route-configured compact presenter bounds admission, ranges and emission", async () => {
  const scope = createTestResourceScope();
  try {
    const dir = await scope.acquire("response state",
      () => mkdtempSync(path.join(os.tmpdir(), "selected-compact-")),
      (created) => rmSync(created, { recursive: true, force: true }));
    const env = { ...process.env, WIKI_MCP_RESPONSE_STATE_DIR: dir };
    const route = "workspace_run_test";
    const { measureMcpInlineResultBytes } = await import("../../packages/wiki-mcp/src/lib/mcp-response.mjs");
    let presented = 0;

    const presentResponse = (response) => {
      presented += 1;
      const page = response.page;

      const nextDetail = response.next_calls[0]?.arguments?.detail;
      const next = nextDetail === undefined ? null
        : Object.fromEntries(Object.entries(nextDetail).filter(([key]) => key !== "cursor"));
      return { compact: true, collection: page.collection, selector: page.selector ?? null,
        ...(page.value_base64 === undefined ? {} : { offset: page.offset, length: page.length,
          total: page.total, value_base64: page.value_base64 }),
        ...(page.items === undefined ? {} : { items: page.items }),
        ...(Object.hasOwn(page, "value") ? { value: page.value } : {}),
        ...(page.range_required === true ? { range_required: true, total: page.total } : {}),
        next };
    };
    const compact = (options = {}) => createSelectedResponseSession({
      route,
      requestSchema: selectedResponseRequestSchema(z.object({ detail: selectedResponseDetailSchema(z) }).strict()),
      buildDetailArguments: (_binding, selection) => ({ detail: selection }),
      requireAuthorityIdentity: true,
      maximumBytes: 1024,
      presentResponse,
      env,
      ...options
    });
    const stdout = `${"ünïcödé ✓ \"quoted\" \\ \u0001 ".repeat(900)}END`;
    const owner = compact();
    const { source } = owner.retain({ binding: { route, repository: "fixture-repo", unit: null,
      authority_identity: WORKER_A }, carrier: { stdout, status: "failed" } });
    const expectedBinding = { route, repository: "fixture-repo", unit: null, authority_identity: WORKER_A };
    const emitted = [];
    const read = async (session, detail) => {
      const before = presented;
      const response = await session.detail({ expected: expectedBinding, detail });
      assert.equal(response.compact, true, "the emitted object is the route's presentation");
      assert.ok(presented > before, "emission went through the presenter");
      emitted.push(measureMcpInlineResultBytes(response));
      return response;
    };

    await read(owner, { source, collection: "members" });
    const field = await read(owner, { source, collection: "members", selector: { id: "stdout" },
      field_path: ["value"] });
    assert.equal(field.range_required, true);

    const chunks = [];
    let next = field.next;
    let reads = 0;
    while (next !== null) {
      const page = await read(owner, next);
      chunks.push(Buffer.from(page.value_base64, "base64"));
      next = page.next;
      reads += 1;
      assert.ok(reads < 400, "the range walk terminates");
    }
    assert.equal(Buffer.concat(chunks).toString("utf8"), stdout);
    assert.ok(reads > 1, "the field needed several bounded ranges");
    assert.ok(emitted.every((bytes) => bytes <= 1024), `every response fits: ${Math.max(...emitted)}`);

    const restarted = compact();
    const cold = await read(restarted, { source, collection: "members", selector: { id: "stdout" },
      field_path: ["value"], offset: 0, length: 64 });
    assert.equal(Buffer.from(cold.value_base64, "base64").toString("utf8"), Buffer.from(stdout).subarray(0, 64)
      .toString("utf8"));
    await assert.rejects(restarted.detail({ expected: { ...expectedBinding, authority_identity: WORKER_B },
      detail: { source, collection: "members" } }), refusedBefore("cold foreign authority", "source_binding_mismatch"));
    assert.ok(Math.max(...emitted) <= 1024);

    const generic = session(env, { requireAuthorityIdentity: true });
    const plain = generic.retain({ binding: binding(WORKER_A), carrier });
    const genericPage = await generic.detail({ expected: expected(WORKER_A),
      detail: { source: plain.source, collection: "rows" } });
    assert.equal(genericPage.schema_version, "selected-response-detail.v1");
    assert.equal(generic.maximumBytes > 1024, true);
    assert.throws(() => compact({ maximumBytes: 1e9 }), TypeError,
      "a route bound may only tighten the delivery bound");
  } finally {
    await scope.dispose();
  }
});

test("selected response applies a route collection projection on warm and cold reads", async () => {
  const scope = createTestResourceScope();
  try {
    const dir = await scope.acquire("response state",
      () => mkdtempSync(path.join(os.tmpdir(), "selected-projection-")),
      (created) => rmSync(created, { recursive: true, force: true }));
    const env = { ...process.env, WIKI_MCP_RESPONSE_STATE_DIR: dir };
    const RAW = "raw-topology-only-in-carrier";
    const original = { patch: `${RAW} ${MARKER}`, findings: Array.from({ length: 150 }, (_, index) =>
      ({ file: `src/file-${index}.mjs`, line: index + 1, raw: RAW, text: `${MARKER} ${"y".repeat(90)}` })) };
    const input = structuredClone(original);

    const expectedRows = original.findings.map((finding, index) => ({ id: `match-${index}`,
      value: { at: `${finding.file}:${finding.line}`, text: finding.text } })).reverse();
    let projections = 0;
    const projectCollections = (retained) => {
      projections += 1;
      return { matches: retained.findings.map((finding, index) => ({ id: `match-${index}`,
        value: { at: `${finding.file}:${finding.line}`, text: finding.text } })).reverse() };
    };
    const observed = (identity, options = {}) => session(env, { requireAuthorityIdentity: true,
      projectCollections, resolveCurrentObservationIdentity: () => identity, ...options });
    const bound = { ...binding(WORKER_A), observation_identity: "A" };

    assert.throws(() => session(env, { projectCollections: "matches" }),
      { name: "TypeError", message: "a selected-response collection projector must be a function" });

    const warm = observed("A");
    const { source } = warm.retain({ binding: bound, carrier: input });
    assert.equal(projections, 1, "one retention projects once");
    assert.deepEqual(input, original, "the projector leaves the supplied carrier untouched");
    assert.deepEqual(readSelectedResponseSource(source, { env, expected: { route: ROUTE } }).carrier,
      original, "the retained original is the input carrier, not its projection");

    const pages = [];
    let detail = { source, collection: "matches" };
    while (detail !== null) {
      const response = await warm.detail({ expected: expected(WORKER_A), detail });
      assert.ok(measureMcpInlineResultBytes(response) <= warm.maximumBytes, "every frame fits the bound");
      assert.equal(response.observation.state, "current");
      assert.equal(response.page.matched_count, expectedRows.length);
      assert.equal(response.page.offset, pages.reduce((sum, page) => sum + page.page.items.length, 0));
      pages.push(response);
      detail = response.next_calls[0]?.arguments.detail ?? null;
      assert.ok(pages.length < 200, "the traversal terminates");
    }
    assert.ok(pages.length > 2, "the collection needs several pages");
    assert.deepEqual(pages.flatMap((response) => response.page.items), expectedRows);
    assert.equal(JSON.stringify(pages).includes(RAW), false, "no raw carrier member is paged");

    for (const collection of ["members", "findings"]) {
      await assert.rejects(warm.detail({ expected: expected(WORKER_A), detail: { source, collection } }),
        refusedBefore(`custom view: ${collection}`, "collection_unknown"));
    }

    const second = pages[1];
    const lost = pages[0].next_calls[0].arguments.detail;
    assert.ok(lost.cursor && second.page.offset > 0);
    const projectedBeforeRestart = projections;
    const cold = observed("B");
    const refusal = await cold.detail({ expected: expected(WORKER_A), detail: lost })
      .then(() => assert.fail("a lost cursor is refused"), (error) => error.envelope);
    assert.equal(refusal.code, "selected_response_snapshot_unavailable");
    assert.equal(refusal.recovery.state, "callable");
    const recovery = refusal.next_calls[0].arguments.detail;
    assert.deepEqual(recovery, { source, collection: "matches", ordinal: second.page.offset });
    for (const [label, foreign] of [["authority", expected(WORKER_B)],
      ["repository", { ...expected(WORKER_A), repository: "other-repo" }]]) {
      await assert.rejects(cold.detail({ expected: foreign, detail: recovery }),
        refusedBefore(`cold recovery: foreign ${label}`, "source_binding_mismatch"));
    }
    const recovered = await cold.detail({ expected: expected(WORKER_A), detail: recovery });
    assert.ok(projections > projectedBeforeRestart, "cold recovery goes through the projector");
    assert.equal(recovered.observation.state, "changed");
    assert.equal(recovered.page.offset, second.page.offset);
    assert.equal(recovered.page.matched_count, expectedRows.length);
    assert.deepEqual(recovered.page.items, second.page.items);
    assert.ok(measureMcpInlineResultBytes(recovered) <= cold.maximumBytes);
    await assert.rejects(cold.detail({ expected: expected(WORKER_A),
      detail: { source, collection: "members" } }), refusedBefore("cold custom view", "collection_unknown"));
    assert.deepEqual(readSelectedResponseSource(source, { env, expected: { route: ROUTE } }).carrier, original);

    const failure = new Error("projector sentinel");
    const failing = session(env, { requireAuthorityIdentity: true,
      projectCollections: () => { throw failure; } });
    assert.throws(() => failing.retain({ binding: bound, carrier: input }), (error) => error === failure);
    await assert.rejects(failing.detail({ expected: expected(WORKER_A),
      detail: { source, collection: "matches" } }), (error) => error === failure);
    await assert.rejects(failing.detail({ expected: expected(WORKER_A),
      detail: { source, collection: "findings" } }), (error) => error === failure);

    const generic = session(env, { requireAuthorityIdentity: true });
    const members = await generic.detail({ expected: expected(WORKER_A),
      detail: { source, collection: "members" } });
    assert.deepEqual(members.page.items.map((row) => row.id), ["patch", "findings"]);
    const rows = await generic.detail({ expected: expected(WORKER_A),
      detail: { source, collection: "findings" } });
    assert.deepEqual(rows.page.items[0], { id: "0", value: original.findings[0] });
    await assert.rejects(generic.detail({ expected: expected(WORKER_A),
      detail: { source, collection: "matches" } }), refusedBefore("generic view", "collection_unknown"));
  } finally {
    await scope.dispose();
  }
});

test("selected response pages a route selection with declared selector keys and row projection", async () => {
  const scope = createTestResourceScope();
  try {
    const dir = await scope.acquire("response state",
      () => mkdtempSync(path.join(os.tmpdir(), "selected-route-selection-")),
      (created) => rmSync(created, { recursive: true, force: true }));
    const env = { ...process.env, WIKI_MCP_RESPONSE_STATE_DIR: dir };

    const authored = Array.from({ length: 150 }, (_, index) => ({ kind: index % 3 === 0 ? "call" : "import",
      tag: index % 2 === 0 ? "even" : "odd",
      text: `${MARKER} ${index} ${"z".repeat(index === 12 ? 12_000 : 70)}` }));
    const calls = authored.map((value, index) => ({ id: String(index), value }))
      .filter((row) => row.value.kind === "call");
    const evenCalls = calls.filter((row) => row.value.tag === "even");
    const counters = { selections: 0, projections: 0, oversized: 0 };
    const held = new WeakMap();
    const options = {
      requireAuthorityIdentity: true,
      selectorKeys: ["kind", "tag"],
      projectCollections: (retained) => {
        counters.projections += 1;
        return { rows: retained.rows.map((value, index) => ({ id: String(index), value })) };
      },

      selectRows: ({ collections, collection, selector }) => {
        const key = JSON.stringify([collection, selector]);
        if (!held.has(collections)) held.set(collections, new Map());
        if (!held.get(collections).has(key)) {
          counters.selections += 1;
          if (!Array.isArray(collections[collection])) throw routeRefusal;
          held.get(collections).set(key, { metadata: { selected_by: selector },
            rows: collections[collection].filter((row) => Object.entries(selector ?? {})
              .every(([name, value]) => row.value[name] === value)) });
        }
        return held.get(collections).get(key);
      },
      projectRow: (_domain, _collection, row) => {
        counters.oversized += 1;
        return { id: row.id, oversized: true };
      }
    };
    const routeRefusal = Object.assign(new Error("route refusal"), { envelope: { code: "route_refusal" } });
    for (const invalid of [{ selectorKeys: [] }, { selectorKeys: "kind" }, { selectRows: {} }, { projectRow: 1 }]) {
      assert.throws(() => session(env, invalid), TypeError, JSON.stringify(invalid));
    }
    const routed = session(env, options);
    const { source, snapshot_identity: snapshotIdentity } =
      routed.retain({ binding: binding(WORKER_A), carrier: { rows: authored } });
    const traverse = async (host, detail) => {
      const pages = [];
      for (let next = detail; next !== undefined; next = pages.at(-1).next_calls[0]?.arguments.detail) {
        const response = await host.detail({ expected: expected(WORKER_A), detail: next });
        assert.ok(measureMcpInlineResultBytes(response) <= host.maximumBytes, "every frame fits the bound");
        pages.push(response);
        assert.ok(pages.length < 100);
      }
      return pages;
    };
    const itemsOf = (pages) => pages.flatMap((response) => response.page.items);

    const selected = { source, snapshot_identity: snapshotIdentity, collection: "rows", selector: { kind: "call" } };
    const pages = await traverse(routed, selected);
    assert.ok(pages.length > 2);
    assert.ok(pages.every((response) => response.page.total === calls.length &&
      isDeepStrictEqualSelector(response.page.selected, { selected_by: { kind: "call" } })));

    assert.deepEqual(itemsOf(pages), calls.map((row) => row.id === "12" ? { id: "12", oversized: true } : row));
    const continuation = pages[0].next_calls[0].arguments.detail;
    assert.deepEqual([continuation.selector, continuation.ordinal], [{ kind: "call" }, pages[0].page.returned]);
    assert.deepEqual(itemsOf(await traverse(routed, { ...selected, selector: { kind: "call", tag: "even" } })),
      evenCalls.map((row) => row.id === "12" ? { id: "12", oversized: true } : row), "selectors are conjunctive");
    assert.deepEqual(itemsOf(await traverse(routed, { source, snapshot_identity: snapshotIdentity,
      collection: "rows" })).length, authored.length, "an unselected read pages every row");
    const selectionsAfterWarm = counters.selections;
    await traverse(routed, selected);
    assert.equal(counters.selections, selectionsAfterWarm, "a warm repeat reuses the held selection");
    assert.equal(counters.projections, 1);

    await assert.rejects(routed.detail({ expected: expected(WORKER_A),
      detail: { ...continuation, selector: { kind: "import" } } }),
    refusedBefore("a cursor under another selector", "cursor_selection_mismatch"));
    await assert.rejects(routed.detail({ expected: expected(WORKER_A),
      detail: { ...selected, selector: { id: "0" } } }), refusedBefore("undeclared key", "selector_invalid"));
    await assert.rejects(routed.detail({ expected: expected(WORKER_A),
      detail: { ...selected, collection: "absent" } }), (error) => error === routeRefusal);
    await assert.rejects(routed.detail({ expected: expected(WORKER_B), detail: selected }),
      refusedBefore("foreign authority", "source_binding_mismatch"));

    const cold = session(env, options);
    const refusal = await cold.detail({ expected: expected(WORKER_A), detail: continuation })
      .then(() => assert.fail("a lost cursor is refused"), (error) => error.envelope);
    assert.equal(refusal.code, "selected_response_snapshot_unavailable");
    const recovery = refusal.next_calls[0].arguments.detail;
    assert.deepEqual(recovery, { source, collection: "rows", selector: { kind: "call" },
      ordinal: pages[0].page.returned });
    assert.deepEqual(itemsOf(await traverse(cold, recovery)), itemsOf(pages.slice(1)));
    assert.equal(counters.projections, 2, "cold recovery projects the source once");

    const plain = session(env, { requireAuthorityIdentity: true,
      projectCollections: options.projectCollections });
    const byId = await plain.detail({ expected: expected(WORKER_A),
      detail: { source, collection: "rows", selector: { id: "3" } } });
    assert.deepEqual([byId.page.items, Object.hasOwn(byId.page, "selected")],
      [[{ id: "3", value: authored[3] }], false]);
    await assert.rejects(plain.detail({ expected: expected(WORKER_A),
      detail: { source, collection: "rows", selector: { kind: "call" } } }),
    refusedBefore("a route key on a default session", "selector_invalid"));
    assert.ok(counters.oversized >= 2);

    const reported = [];
    let report = { kind: "route_observation", state: "unavailable", cause: "route_cause" };
    const observing = session(env, { ...options, measuredObservation: { kind: "route_observation",
      state: "unavailable", cause: "c".repeat(64) },
    describeObservation: async (retained) => { reported.push(retained.repository); return report; } });
    const observedPages = await traverse(observing, { source, collection: "rows", selector: { kind: "call" } });
    assert.equal(reported.length, observedPages.length, "one observation for each served page, none for sizing");
    assert.ok(observedPages.every((response) => response.observation === report));
    report = { kind: "route_observation", state: "current" };
    const again = await traverse(observing, { source, collection: "rows", selector: { kind: "call" } });
    assert.deepEqual(again.map((response) => [response.observation, response.page.offset, response.page.items]),
      observedPages.map((response) => [report, response.page.offset, response.page.items]),
      "boundaries are the same whatever the owner reports");
    assert.deepEqual(byId.observation, { kind: "retained_prior_observation", state: "unavailable" },
      "a session without an observation owner keeps the default label");
    for (const invalid of [{ describeObservation: async () => report },
      { measuredObservation: { state: "unavailable" } }, { describeObservation: "x", measuredObservation: {} }]) {
      assert.throws(() => session(env, invalid), TypeError, Object.keys(invalid).join());
    }

    const wide = { kind: "call", tag: "even" };
    const heavy = { kind: "route_observation", state: "unavailable", cause: "h".repeat(20_000) };
    const rejectedCursors = [];
    const complete = session(env, { ...options, describeObservation: async () => heavy,
      completePageDelivery: { acceptsCursor: (cursor) => { rejectedCursors.push(cursor); return false; } } });
    const completePages = [];
    for (let next = { source, collection: "rows", selector: wide }; next !== undefined;
      next = completePages.at(-1).next_calls[0]?.arguments.detail) {
      const response = await complete.detail({ expected: expected(WORKER_A), detail: next });
      assert.ok(measureMcpInlineResultBytes({ items: response.page.items }) <= complete.maximumBytes,
        "the rows of a page fit the bound");
      assert.ok(measureMcpInlineResultBytes(response) > complete.maximumBytes, "the whole page does not");
      assert.equal(response.observation, heavy);
      completePages.push(response);
      assert.ok(completePages.length < 100);
    }
    assert.ok(completePages.length > 1);
    assert.deepEqual(itemsOf(completePages), evenCalls.map((row) => row.id === "12" ? { id: "12", oversized: true } : row));
    assert.equal(rejectedCursors.length, completePages.length - 1);
    for (const [index, response] of completePages.slice(0, -1).entries()) {
      const { snapshot_identity: identity, ...position } = response.next_calls[0].arguments.detail;
      assert.equal(typeof identity, "string");
      assert.deepEqual(position, { source, collection: "rows", selector: wide,
        ordinal: completePages[index + 1].page.offset }, "no cursor: the same position by ordinal");
    }
    const sized = session(env, { ...options, describeObservation: async () => heavy,
      measuredObservation: { kind: "route_observation", state: "unavailable", cause: "c".repeat(64) } });
    await assert.rejects(sized.detail({ expected: expected(WORKER_A),
      detail: { source, collection: "rows", selector: wide } }),
    refusedBefore("default delivery of an oversized page", "projection_exceeds_delivery_bound"));
    assert.throws(() => session(env, { completePageDelivery: {} }), TypeError);
  } finally {
    await scope.dispose();
  }
});

test("WK-2716: a hot field correction is offered only to the retained authority", async () => {
  const scope = createTestResourceScope();
  try {
    const dir = await scope.acquire("response state",
      () => mkdtempSync(path.join(os.tmpdir(), "selected-correction-")),
      (created) => rmSync(created, { recursive: true, force: true }));
    const env = { ...process.env, WIKI_MCP_RESPONSE_STATE_DIR: dir };
    const requiring = session(env, { requireAuthorityIdentity: true });
    const { source, snapshot_identity: snapshotIdentity } =
      requiring.retain({ binding: binding(WORKER_A), carrier });
    const hot = { source, snapshot_identity: snapshotIdentity, collection: "rows" };
    for (const [invalid, corrected] of [
      [{ field_path: ["index"] }, hot],
      [{ selector: { id: "3" }, field_path: ["index"] }, { ...hot, selector: { id: "3" } }]]) {
      const refusal = await requiring.detail({ expected: expected(WORKER_A), detail: { ...hot, ...invalid } })
        .then(() => assert.fail("an invalid field selection is refused"), (error) => error.envelope);
      assert.equal(refusal.recovery.state, "callable");
      assert.deepEqual(refusal.next_calls.map((call) => call.arguments),
        [{ unit: "WK-0001#SLICE-001", detail: corrected }]);

      for (const authority of [WORKER_B, REVIEWER]) {
        await assert.rejects(requiring.detail({ expected: expected(authority), detail: { ...hot, ...invalid } }),
          (error) => {
            assert.equal(error.envelope.no_supported_route, true);
            assert.equal(Object.hasOwn(error.envelope, "next_calls"), false);
            assert.equal(JSON.stringify(error.envelope).includes(MARKER), false);
            return true;
          });
      }
    }
  } finally {
    await scope.dispose();
  }
});

test("WK-2716: range and ordinal corrections are authenticated hot and cold before disclosure", async () => {
  const scope = createTestResourceScope();
  try {
    const dir = await scope.acquire("response state",
      () => mkdtempSync(path.join(os.tmpdir(), "selected-page-correction-")),
      (created) => rmSync(created, { recursive: true, force: true }));
    const env = { ...process.env, WIKI_MCP_RESPONSE_STATE_DIR: dir };
    const requiring = session(env, { requireAuthorityIdentity: true });
    const { source, snapshot_identity: snapshotIdentity } =
      requiring.retain({ binding: binding(WORKER_A), carrier });
    const first = await requiring.detail({ expected: expected(WORKER_A),
      detail: { source, collection: "rows" } });
    const second = await requiring.detail({ expected: expected(WORKER_A),
      detail: first.next_calls[0].arguments.detail });
    const start = second.page.offset;
    assert.ok(start > 1 && second.page.returned > 1);
    const correctionOf = (promise) => promise.then(() => assert.fail("the selection is refused"),
      (error) => error.envelope);
    const foreign = [expected(WORKER_B), expected(REVIEWER),
      { ...expected(WORKER_A), unit: "WK-0001#SLICE-002" }, { ...expected(WORKER_A), repository: "other-repo" }];

    const restarted = session(env, { requireAuthorityIdentity: true });
    for (const [label, host, base] of [["hot", requiring, { source, snapshot_identity: snapshotIdentity }],
      ["cold", restarted, { source }]]) {
      const cases = [
        [{ collection: "rows", offset: 1, length: 3 }, { ...base, collection: "rows" }, first.page.items],
        [{ collection: "rows", selector: { id: "3" }, offset: 1, length: 3 },
          { ...base, collection: "rows", selector: { id: "3" } }, [{ id: "3", value: carrier.rows[3] }]],
        [{ collection: "rows", ordinal: start + 1 }, { ...base, collection: "rows", ordinal: start },
          second.page.items]];
      for (const [invalid, corrected, rows] of cases) {
        const refusal = await correctionOf(host.detail({ expected: expected(WORKER_A),
          detail: { ...base, ...invalid } }));
        assert.equal(refusal.recovery.state, "callable", `${label} ${JSON.stringify(invalid)}`);
        assert.deepEqual(refusal.next_calls.map((call) => call.arguments),
          [{ unit: "WK-0001#SLICE-001", detail: corrected }], `${label} ${JSON.stringify(invalid)}`);
        const followed = await host.detail({ expected: expected(WORKER_A), detail: corrected });
        assert.deepEqual(followed.page.items, rows, `${label}: the corrected call works unchanged`);

        for (const other of foreign) {
          await assert.rejects(host.detail({ expected: other, detail: { ...base, ...invalid } }), (error) => {
            assert.equal(Object.hasOwn(error.envelope, "next_calls"), false, `${label} foreign correction`);
            assert.equal(JSON.stringify(error.envelope).includes(MARKER), false);
            assert.equal(JSON.stringify(error.envelope).includes(`"ordinal":${start}`), false,
              "the containing page start is not disclosed");
            return true;
          });
        }
      }
    }
  } finally {
    await scope.dispose();
  }
});
