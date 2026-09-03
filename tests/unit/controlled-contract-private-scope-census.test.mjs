import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { queryControlledContractPrivateScopeCensusOperation } from
  "../../packages/wiki-core/src/operations/controlled-contract.mjs";

test("private-scope census is exact, ID ordered, digest-bound, and read-only", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wk2426-census-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "wiki", "work-records"), { recursive: true });
  const record = (id, writeScope) => ({
    schema_version: "work-record.v1", id, status: "doing",
    read_scope: [], repo_paths: [], write_scope: writeScope, slices: []
  });
  await writeFile(path.join(root, "wiki", "work-records", "WK-2998.json"),
    `${JSON.stringify(record("WK-2998", ["src/**"]))}\n`);
  await writeFile(path.join(root, "wiki", "work-records", "WK-2997.json"),
    `${JSON.stringify(record("WK-2997", ["wiki/**"]))}\n`);

  const before = await queryControlledContractPrivateScopeCensusOperation({ repoRoot: root });
  const after = await queryControlledContractPrivateScopeCensusOperation({ repoRoot: root });
  assert.deepEqual(after, before);
  assert.equal(before.counts.nonterminal_intersections, 1);
  assert.equal(before.items[0].unit_address, "WK-2997");
  assert.equal(before.local_refusal_authority, false);
  assert.ok(Buffer.byteLength(JSON.stringify(before, null, 2), "utf8") <= 16384);
});

test("private-scope census derives effective terminality from parent and slice status", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wk2426-census-status-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "wiki", "work-records");
  await mkdir(directory, { recursive: true });
  const write = async (id, parentStatus, sliceStatus) => writeFile(
    path.join(directory, `${id}.json`),
    `${JSON.stringify({
      schema_version: "work-record.v1", id, status: parentStatus,
      read_scope: [], repo_paths: [], write_scope: [],
      slices: [{ id: "SLICE-001", status: sliceStatus,
        read_scope: ["wiki/contracts"], repo_paths: [], write_scope: [] }]
    })}\n`
  );
  await write("WK-2901", "done", "active");
  await write("WK-2902", "cancelled", "active");
  await write("WK-2903", "active", "done");
  await write("WK-2904", "active", "cancelled");
  await write("WK-2905", "active", "active");

  const page = await queryControlledContractPrivateScopeCensusOperation({ repoRoot: root });
  assert.equal(page.counts.intersections, 5);
  assert.equal(page.counts.terminal_intersections, 4);
  assert.equal(page.counts.nonterminal_intersections, 1);
  assert.deepEqual(page.items.map(({ unit_address: address }) => address),
    ["WK-2905#SLICE-001"]);
  assert.equal(page.items[0].status, "active");
  assert.equal(page.items[0].parent_status, "active");
});
