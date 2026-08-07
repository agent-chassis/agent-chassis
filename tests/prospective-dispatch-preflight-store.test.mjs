import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildWorkRecordDuplicateClaimsIndex,
  getWorkRecordPath,
  loadWorkRecordById
} from "../packages/wiki-core/src/lib/work-record-store.mjs";
import { createProspectiveWorkRecordStore } from "../packages/wiki-core/src/lib/work-record-prospective-preflight-store.mjs";

const proposedRecord = {
  schema_version: "work-record.v1",
  record_kind: "work_item",
  id: "WK-prospective",
  title: "Prospective record",
  repo: "agent-chassis/agent-chassis",
  work_kind: "implementation",
  status: "todo",
  priority: "medium",
  read_scope: [],
  repo_paths: [],
  write_scope: [],
  validation: [],
  acceptance: [],
  dispatch_intent: {
    intended_agent_role: "worker",
    target_unit: "slice",
    requires_graph_impact: false,
    requires_escalation: false
  },
  slices: []
};

async function digestFiles(paths) {
  const entries = [];
  for (const filePath of paths) {
    entries.push([
      filePath,
      createHash("sha256").update(await readFile(filePath)).digest("hex")
    ]);
  }
  return entries;
}

async function withFixture(callback) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "prospective-store-"));
  const canonicalPath = getWorkRecordPath(dir, proposedRecord.id);
  const otherPath = path.join(dir, "wiki/work-records/other.json");
  await mkdir(path.dirname(canonicalPath), { recursive: true });
  await writeFile(canonicalPath, JSON.stringify({ ...proposedRecord, title: "persisted" }, null, 2));
  await writeFile(otherPath, JSON.stringify({ ...proposedRecord, id: "other-id" }, null, 2));
  try {
    return await callback({ dir, canonicalPath, otherPath });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("prospective store overlays all three reads and declares live worktree capability", async () => {
  await withFixture(async ({ dir, canonicalPath, otherPath }) => {
    const store = createProspectiveWorkRecordStore({ dir, proposedRecord });
    const subjectAlias = path.join(dir, ".", "wiki/work-records", "WK-prospective.json");

    assert.deepEqual(Object.keys(store).sort(), ["capabilities", "listJsonPaths", "pathExists", "readText"]);
    assert.deepEqual(store.capabilities, { live_worktree: true });
    for (const mutator of ["write", "writeText", "mkdir", "remove"]) {
      assert.equal(Object.hasOwn(store, mutator), false, `unexpected mutator: ${mutator}`);
    }
    assert.equal(await store.readText(subjectAlias), `${JSON.stringify(proposedRecord, null, 2)}\n`);
    assert.equal(await store.readText(otherPath), await readFile(otherPath, "utf8"));
    assert.equal(await store.pathExists(subjectAlias), true);
    assert.equal(await store.pathExists(path.join(dir, "missing.json")), false);

    const listed = await store.listJsonPaths();
    assert.deepEqual(listed, [...new Set([canonicalPath, otherPath].map((entry) => path.resolve(entry)))].sort((left, right) => left.localeCompare(right)));
  });
});

test("canonical subject path shadows persisted body without duplicate claim", async () => {
  await withFixture(async ({ dir }) => {
    const store = createProspectiveWorkRecordStore({ dir, proposedRecord });
    const duplicateClaimsIndex = await buildWorkRecordDuplicateClaimsIndex({ dir, recordStore: store });
    const loaded = await loadWorkRecordById({
      dir,
      id: proposedRecord.id,
      recordStore: store,
      duplicateClaimsIndex
    });

    assert.equal(loaded.record.title, proposedRecord.title);
    assert.equal(loaded.duplicate_claims.length, 0);
    assert.equal(loaded.diagnostics.some((entry) => entry.code === "duplicate_record_id"), false);
  });
});

test("another path claiming the proposed id remains a duplicate claim", async () => {
  await withFixture(async ({ dir, otherPath }) => {
    await writeFile(otherPath, JSON.stringify({ ...proposedRecord, id: proposedRecord.id, title: "duplicate" }, null, 2));
    const store = createProspectiveWorkRecordStore({ dir, proposedRecord });
    const duplicateClaimsIndex = await buildWorkRecordDuplicateClaimsIndex({ dir, recordStore: store });
    const loaded = await loadWorkRecordById({
      dir,
      id: proposedRecord.id,
      recordStore: store,
      duplicateClaimsIndex
    });

    assert.equal(loaded.duplicate_claims.length, 1);
    assert.equal(loaded.duplicate_claims[0].path, "wiki/work-records/other.json");
    assert.equal(loaded.diagnostics.some((entry) => entry.code === "duplicate_record_id"), true);
  });
});

test("overlay reads do not mutate work-record bytes", async () => {
  await withFixture(async ({ dir, canonicalPath, otherPath }) => {
    const before = await digestFiles([canonicalPath, otherPath]);
    const store = createProspectiveWorkRecordStore({ dir, proposedRecord });
    await store.readText(canonicalPath);
    await store.pathExists(canonicalPath);
    await store.listJsonPaths();
    await store.readText(otherPath);
    const after = await digestFiles([canonicalPath, otherPath]);
    assert.deepEqual(after, before);
  });
});
