import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";

import { z } from "zod";

import { jsonContent, errorContent } from "../../packages/wiki-mcp/src/lib/mcp-response.mjs";
import { registerWorkRecordReadTools } from "../../packages/wiki-mcp/src/lib/work-record-read-tools.mjs";
import { readWorkRecordById } from "../../packages/wiki-core/src/operations/work-records-store-io.mjs";

function buildRegistration(workspaceDir) {
  const registrations = new Map();
  registerWorkRecordReadTools({
    registerTool: (name, definition, handler) => {
      registrations.set(name, { definition, handler });
    },
    workspaceRepos: [{ repo: "test/fixture", dir: workspaceDir }],
    z,
    jsonContent,
    errorContent,
    resolveWorkspaceRepo: (repos) => repos[0],
    createCompactValidateDispatchResponse: () => ({})
  });
  const registration = registrations.get("workspace_record_staleness_check");
  assert.ok(registration, "workspace_record_staleness_check must be registered");
  return registration;
}

function buildHandler(workspaceDir) {
  return buildRegistration(workspaceDir).handler;
}

function validRecord(id, note = "initial") {
  return {
    schema_version: "work-record.v1",
    id,
    repo: "agent-chassis/agent-chassis",
    title: `staleness fixture ${id}`,
    record_kind: "work_item",
    work_kind: "implementation",
    status: "todo",
    priority: "P2",
    owner: "test",
    created: "2026-01-01",
    updated: "2026-01-02",
    read_scope: [],
    repo_paths: [],
    write_scope: [],
    depends_on: [],
    blocks: [],
    related: [],
    dispatch_intent: {
      intended_agent_role: null,
      target_unit: "none",
      requires_graph_impact: false,
      requires_escalation: false
    },
    acceptance: { criteria: [], validation: [] },
    sections: {
      summary: "staleness fixture",
      why_it_matters: "staleness fixture",
      scope: { items: [], out_of_scope: [] },
      tasks: [],
      references: [],
      agent_notes: note,
      closure: null
    },
    children: [],
    slices: [],
    escalations: [],
    projections: []
  };
}

async function setupWorkspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "record-staleness-"));
  await mkdir(path.join(root, "wiki", "work-records"), { recursive: true });
  return root;
}

async function writeRecord(root, record) {
  await writeFile(
    path.join(root, "wiki", "work-records", `${record.id}.json`),
    `${JSON.stringify(record, null, 2)}\n`
  );
}

async function digestOf(root, id) {
  const loaded = await readWorkRecordById({ dir: root, id });
  assert.equal(loaded.valid, true, `${id} fixture must load valid`);
  assert.equal(typeof loaded.source_digest, "string");
  return loaded.source_digest;
}

function payloadOf(result) {
  assert.ok(!result.isError, `expected a success envelope, got: ${JSON.stringify(result)}`);
  return result.structuredContent;
}

test("a record whose digest has not moved since the read resolves as unchanged", async () => {
  const root = await setupWorkspace();
  await writeRecord(root, validRecord("WK-9101"));
  const observed = await digestOf(root, "WK-9101");

  const handler = buildHandler(root);
  const payload = payloadOf(
    await handler({ entries: [{ id: "WK-9101", observed_source_digest: observed }] })
  );

  assert.equal(payload.total_count, 1);
  assert.equal(payload.returned_count, 1);
  assert.equal(payload.has_more, false);
  assert.deepEqual(payload.unchecked_ids, []);
  assert.deepEqual(payload.results, [
    { id: "WK-9101", observed_source_digest: observed, state: "unchanged" }
  ]);
});

test("a record edited after it was read resolves as changed and carries the current digest", async () => {
  const root = await setupWorkspace();
  await writeRecord(root, validRecord("WK-9102", "before"));
  const observed = await digestOf(root, "WK-9102");

  await writeRecord(root, validRecord("WK-9102", "after"));
  const current = await digestOf(root, "WK-9102");
  assert.notEqual(current, observed, "the fixture edit must move the source digest");

  const handler = buildHandler(root);
  const payload = payloadOf(
    await handler({ entries: [{ id: "WK-9102", observed_source_digest: observed }] })
  );

  assert.equal(payload.returned_count, 1);
  assert.deepEqual(payload.results, [
    {
      id: "WK-9102",
      observed_source_digest: observed,
      state: "changed",

      current_source_digest: current
    }
  ]);
});

test("a record absent from disk resolves as absent, not as changed", async () => {
  const root = await setupWorkspace();
  const observed = `sha256:${"a".repeat(64)}`;

  const handler = buildHandler(root);
  const payload = payloadOf(
    await handler({ entries: [{ id: "WK-9103", observed_source_digest: observed }] })
  );

  assert.deepEqual(payload.results, [
    { id: "WK-9103", observed_source_digest: observed, state: "absent" }
  ]);
  assert.notEqual(payload.results[0].state, "changed");

  assert.equal(
    Object.prototype.hasOwnProperty.call(payload.results[0], "current_source_digest"),
    false
  );
});

test("a record present but unparsable resolves as unreadable with the loader's diagnostic codes", async () => {
  const root = await setupWorkspace();
  await writeFile(path.join(root, "wiki", "work-records", "WK-9104.json"), "{ not json\n");
  const observed = `sha256:${"b".repeat(64)}`;

  const handler = buildHandler(root);
  const payload = payloadOf(
    await handler({ entries: [{ id: "WK-9104", observed_source_digest: observed }] })
  );

  const [entry] = payload.results;
  assert.equal(entry.state, "unreadable");
  assert.equal(entry.id, "WK-9104");
  assert.deepEqual(entry.diagnostic_codes, ["invalid_json"]);

  assert.equal(Object.prototype.hasOwnProperty.call(entry, "current_source_digest"), false);
  assert.notEqual(entry.state, "absent");
  assert.notEqual(entry.state, "changed");
});

test("a record that parses but fails schema validation resolves as unreadable", async () => {
  const root = await setupWorkspace();

  const schemaInvalid = { ...validRecord("WK-9105"), status: "not-a-real-status" };
  await writeRecord(root, schemaInvalid);

  const loaded = await readWorkRecordById({ dir: root, id: "WK-9105" });
  assert.equal(loaded.valid, false, "the fixture must fail schema validation");
  assert.equal(
    typeof loaded.source_digest,
    "string",
    "the fixture must still carry a digest, so only the valid !== true clause can classify it"
  );

  const handler = buildHandler(root);
  const payload = payloadOf(
    await handler({
      entries: [{ id: "WK-9105", observed_source_digest: loaded.source_digest }]
    })
  );

  const [entry] = payload.results;
  assert.equal(entry.id, "WK-9105");
  assert.equal(entry.state, "unreadable");
  assert.ok(
    entry.diagnostic_codes.includes("invalid_record"),
    `expected an invalid_record diagnostic, got: ${JSON.stringify(entry.diagnostic_codes)}`
  );

  assert.equal(Object.prototype.hasOwnProperty.call(entry, "current_source_digest"), false);

  assert.notEqual(entry.state, "unchanged");
  assert.notEqual(entry.state, "absent");
});

test("an over-cap submission reports bounded counts and names every skipped identity", async () => {
  const root = await setupWorkspace();
  await writeRecord(root, validRecord("WK-9200"));
  const observed = await digestOf(root, "WK-9200");

  const submitted = Array.from({ length: 105 }, (_unused, index) => ({
    id: `WK-${String(9200 + index).padStart(4, "0")}`,
    observed_source_digest: observed
  }));

  const handler = buildHandler(root);
  const payload = payloadOf(await handler({ entries: submitted }));

  assert.equal(payload.entry_limit, 100);
  assert.equal(payload.total_count, 105);
  assert.equal(payload.returned_count, 100);
  assert.equal(payload.has_more, true);
  assert.equal(payload.results.length, 100);
  assert.deepEqual(
    payload.unchecked_ids,
    submitted.slice(100).map((entry) => entry.id)
  );

  assert.equal(payload.total_count - payload.returned_count, payload.unchecked_ids.length);

  assert.equal(payload.results[0].state, "unchanged");
});

test("a malformed request refuses instead of returning a partial success envelope", async () => {
  const root = await setupWorkspace();
  const handler = buildHandler(root);
  const observed = `sha256:${"c".repeat(64)}`;

  const empty = await handler({ entries: [] });
  assert.equal(empty.isError, true);

  const badId = await handler({ entries: [{ id: "DEC-0001", observed_source_digest: observed }] });
  assert.equal(badId.isError, true);
  assert.match(badId.content[0].text, /WK-####/);

  const tokenAsDigest = await handler({
    entries: [{ id: "WK-9101", observed_source_digest: "compact-read-token-abc" }]
  });
  assert.equal(tokenAsDigest.isError, true);
  assert.match(tokenAsDigest.content[0].text, /compact_read_token/);

  const extraField = await handler({
    entries: [{ id: "WK-9101", observed_source_digest: observed, compact_read_token: "x" }]
  });
  assert.equal(extraField.isError, true);
});

test("the registered entries schema rejects a malformed id or digest", async () => {
  const root = await setupWorkspace();
  const { definition } = buildRegistration(root);
  const entriesSchema = definition.inputSchema.entries;
  assert.equal(
    typeof entriesSchema?.safeParse,
    "function",
    "entries must be registered as a parseable schema, not an untyped passthrough"
  );

  const digest = `sha256:${"d".repeat(64)}`;
  assert.equal(
    entriesSchema.safeParse([{ id: "WK-9101", observed_source_digest: digest }]).success,
    true,
    "a canonical entry must parse"
  );

  for (const id of ["DEC-0001", "WK-91", "WK-91011", "wk-9101", "WK-9101 "]) {
    assert.equal(
      entriesSchema.safeParse([{ id, observed_source_digest: digest }]).success,
      false,
      `id ${JSON.stringify(id)} is not a canonical WK-#### identity`
    );
  }

  for (const observedSourceDigest of [
    "compact-read-token-abc",
    `sha256:${"d".repeat(63)}`,
    `sha256:${"d".repeat(65)}`,
    `sha256:${"D".repeat(64)}`,
    `sha1:${"d".repeat(64)}`,
    `sha256:${"g".repeat(64)}`,
    "d".repeat(64)
  ]) {
    assert.equal(
      entriesSchema
        .safeParse([{ id: "WK-9101", observed_source_digest: observedSourceDigest }])
        .success,
      false,
      `digest ${JSON.stringify(observedSourceDigest)} is not a raw sha256:<hex> source_digest`
    );
  }
});
