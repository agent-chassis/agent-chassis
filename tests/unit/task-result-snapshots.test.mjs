import assert from "node:assert/strict";
import test from "node:test";

import {
  createTaskResultSnapshotRegistry,
  defineTaskResultCollectionDescriptors
} from "../../packages/controlled-contract/current.mjs";

const [ROWS] = defineTaskResultCollectionDescriptors([
  {
    collection: "rows",
    stable_id: "row_id",
    fields: ["row_id", "state", "detail"],
    selectors: ["id", "state"]
  }
]);

function registry(options = {}) {
  return createTaskResultSnapshotRegistry({
    random: (size) => Buffer.alloc(size, 7),
    collectionDescriptor: (domain, collection) =>
      domain === "demo" && collection === "rows" ? ROWS : null,
    maximumItems: 2,
    maximumBytes: 2048,
    ...options
  });
}

function put(target, result, sourceKind = "workspace_errors_log") {
  return target.put({
    domain: "demo",
    result,
    sourceIdentity: { workspace_repo: "current", source_kind: sourceKind },
    recovery: { tool: "demo_report", arguments: { source_kind: sourceKind } }
  });
}

test("authenticated immutable snapshots page deterministically with exact accounting", async () => {
  const target = registry();
  const source = { rows: [
    { row_id: "R-3", state: "open", detail: "three" },
    { row_id: "R-1", state: "closed", detail: "one" },
    { row_id: "R-2", state: "open", detail: "two" }
  ] };
  const identity = put(target, source);
  source.rows[0].detail = "mutated-after-snapshot";

  const first = await target.query({
    identity,
    domain: "demo",
    collection: "rows",
    maximumItems: 2,
    expectedSourceIdentity: { source_kind: "workspace_errors_log" }
  });
  assert.deepEqual(first.items.map(({ row_id }) => row_id), ["R-1", "R-2"]);
  assert.equal(Object.hasOwn(first, "changed_source_classes"), false);
  assert.deepEqual({
    total: first.total,
    returned: first.returned,
    remaining: first.remaining,
    complete: first.complete
  }, { total: 3, returned: 2, remaining: 1, complete: false });
  assert.equal(first.continuation.kind, "cursor");

  const second = await target.query({
    domain: "demo",
    cursor: first.continuation.cursor,
    expectedSourceIdentity: { source_kind: "workspace_errors_log" }
  });
  assert.equal(second.items[0].detail, "three");
  assert.deepEqual({ total: second.total, returned: second.returned, remaining: second.remaining },
    { total: 3, returned: 1, remaining: 0 });
  assert.equal(second.offset, 2);
  assert.equal(second.complete, true);
  assert.equal(second.continuation, null);
});

test("an injected domain page context appears once on every continuation page", async () => {
  const target = registry({
    projectPageContext: ({ collection }) => collection === "rows"
      ? { evaluation_context: { owner: "demo", scope: "page" } }
      : null
  });
  const identity = put(target, { rows: [
    { row_id: "R-1", state: "open", detail: "one" },
    { row_id: "R-2", state: "open", detail: "two" },
    { row_id: "R-3", state: "open", detail: "three" }
  ] });
  const first = await target.query({ identity, domain: "demo", collection: "rows" });
  const second = await target.query({
    domain: "demo",
    cursor: first.continuation.cursor
  });
  for (const page of [first, second]) {
    assert.deepEqual(page.evaluation_context, { owner: "demo", scope: "page" });
    assert.equal(page.items.some((row) => Object.hasOwn(row, "evaluation_context")), false);
  }
});

test("selectors, cursor isolation, source isolation, and loud unknown state are enforced", async () => {
  const target = registry();
  const identity = put(target, { rows: [
    { row_id: "R-1", state: "open", detail: "one" },
    { row_id: "R-2", state: "closed", detail: "two" },
    { row_id: "R-3", state: "open", detail: "three" }
  ] });
  const selected = await target.query({
    identity, domain: "demo", collection: "rows", selector: { state: "open" },
    maximumItems: 2
  });
  assert.deepEqual(selected.items.map(({ row_id }) => row_id), ["R-1", "R-3"]);

  const page = await target.query({ identity, domain: "demo", collection: "rows" });
  const cursor = page.continuation.cursor;
  await assert.rejects(target.query({
    domain: "demo", cursor, collection: "rows"
  }), (error) => error.details.reason === "cursor_and_selector_are_mutually_exclusive");
  await assert.rejects(target.query({
    domain: "other", cursor
  }), (error) => error.details.reason === "cursor_domain_mismatch");
  await assert.rejects(target.query({
    domain: "demo", cursor,
    expectedSourceIdentity: { source_kind: "retained_smoke_evidence" }
  }), (error) => error.details.reason === "cursor_source_mismatch");
  await assert.rejects(target.query({
    domain: "demo", cursor,
    expectedSourceIdentity: { workspace_repo: "other" }
  }), (error) => error.details.reason === "cursor_source_mismatch");
  const [body, mac] = cursor.split(".");
  const replacement = mac.at(-1) === "x" ? "y" : "x";
  await assert.rejects(target.query({
    domain: "demo", cursor: `${body}.${mac.slice(0, -1)}${replacement}`
  }), (error) => error.code === "task_result_snapshot_unavailable");
  await assert.rejects(target.query({
    identity: "x".repeat(43), domain: "demo", collection: "rows"
  }), (error) => error.details.reason === "identity_unknown_expired_evicted_or_restarted");
  await assert.rejects(target.query({
    identity, domain: "demo", collection: "unknown"
  }), (error) => error.details.reason === "collection_unknown");
  await assert.rejects(target.query({
    identity, domain: "demo", collection: "rows", offset: 0, length: 1
  }), (error) => error.details.reason === "scalar_range_requires_field_path");
  await assert.rejects(target.query({
    identity,
    domain: "demo",
    collection: "rows",
    currentSourceIdentity: { workspace_repo: "other", source_kind: "workspace_errors_log" }
  }), (error) => error.details.reason === "source_identity_changed" &&
    error.details.changed_source_classes.length === 1 &&
    error.details.changed_source_classes[0] === "workspace_repo");
});

test("selected scalar ranges are explicit and snapshot expiry returns rerun recovery", async () => {
  let clock = 1000;
  const target = registry({ now: () => clock, ttlMs: 100 });
  const detail = "x".repeat(5000);
  const identity = put(target, { rows: [{ row_id: "R-1", state: "open", detail }] });
  const metadata = await target.query({
    identity,
    domain: "demo",
    collection: "rows",
    selector: { id: "R-1" },
    fieldPath: ["detail"]
  });
  assert.equal(metadata.range_required, true);
  const range = await target.query({
    identity,
    domain: "demo",
    collection: "rows",
    selector: { id: "R-1" },
    fieldPath: ["detail"],
    offset: 0,
    length: 256
  });
  assert.equal(Buffer.from(range.value_base64, "base64").toString("utf8"), detail.slice(0, 256));
  assert.equal(range.total, 5000);
  assert.equal(range.returned, 256);
  assert.equal(range.remaining, 4744);

  clock = 1101;
  await assert.rejects(target.query({ identity, domain: "demo", collection: "rows" }),
    (error) => error.code === "task_result_snapshot_unavailable" &&
      error.details.recovery.tool === "demo_report");
});

test("caller recovery survives a restarted registry for unknown identities and cursors", async () => {
  const beforeRestart = registry();
  const identity = put(beforeRestart, { rows: [
    { row_id: "R-1", state: "open", detail: "one" },
    { row_id: "R-2", state: "open", detail: "two" },
    { row_id: "R-3", state: "open", detail: "three" }
  ] });
  const first = await beforeRestart.query({ identity, domain: "demo", collection: "rows" });
  const recovery = { tool: "demo_report", arguments: { source_kind: "workspace_errors_log" } };
  const afterRestart = registry({ random: (size) => Buffer.alloc(size, 8) });

  for (const request of [
    { identity, domain: "demo", collection: "rows", recovery },
    { domain: "demo", cursor: first.continuation.cursor, recovery }
  ]) {
    await assert.rejects(afterRestart.query(request), (error) =>
      error.code === "task_result_snapshot_unavailable" &&
      error.details.recovery.tool === "demo_report" &&
      error.details.recovery.arguments.source_kind === "workspace_errors_log");
  }
});
