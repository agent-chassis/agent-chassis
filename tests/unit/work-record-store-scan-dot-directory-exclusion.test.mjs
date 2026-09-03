import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

import {
  buildWorkRecordDuplicateClaimsIndex,
  captureCanonicalWorkRecordInventory,
  listCanonicalWorkRecordPaths,
  listWorkRecordJsonPaths,
  loadWorkRecordByPath
} from "../../packages/wiki-core/src/lib/work-record-store.mjs";

const RECORD = {
  schema_version: "work-record.v1",
  kind: "implementation",
  status: "todo",
  title: "scan fixture"
};

async function writeRecord(root, relativePath, id) {
  const filePath = path.join(root, "wiki", "work-records", relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify({ ...RECORD, id })}\n`, "utf8");
  return filePath;
}

function hasDiagnostic(result, code) {
  return result.diagnostics.some((diagnostic) => diagnostic.code === code);
}

test("work-record scans exclude only writer temp directories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "work-record-scan-"));
  try {
    await writeRecord(root, "WK-1913.json", "WK-1913");
    await writeRecord(root, "WK-1914.json", "WK-1914");
    await writeRecord(root, "WK-1915.json", "WK-1915");
    await writeRecord(root, "WK-1919.json", "WK-1913");
    await writeFile(path.join(root, "wiki", "work-records", "WK-1920.json"), "{invalid", "utf8");
    await writeRecord(root, ".record-tmp-fixture/WK-1913.json", "WK-1913");
    await writeRecord(root, ".work-record-escalation-fixture/WK-1914.json", "WK-1914");
    await writeRecord(root, ".graph-sidecar-tmp-fixture/WK-1915.json", "WK-1915");
    await writeRecord(root, ".archive/WK-1913.json", "WK-1913");
    await writeRecord(root, ".WK-1916.json", "WK-1916");
    await writeRecord(root, "nested/WK-1917.json", "WK-1917");
    await writeRecord(root, "evidence/WK-1913.sidecar.json", "WK-1913");
    await writeRecord(root, "committed-a/WK-1918.json", "WK-1918");
    await writeRecord(root, "committed-b/WK-1918.json", "WK-1918");

    const paths = await listWorkRecordJsonPaths(root);
    const relativePaths = paths.map((filePath) => path.relative(root, filePath).split(path.sep).join("/"));

    assert.ok(relativePaths.includes("wiki/work-records/.archive/WK-1913.json"));
    assert.ok(relativePaths.includes("wiki/work-records/.WK-1916.json"));
    assert.ok(relativePaths.includes("wiki/work-records/nested/WK-1917.json"));
    assert.ok(relativePaths.includes("wiki/work-records/evidence/WK-1913.sidecar.json"));
    assert.ok(relativePaths.includes("wiki/work-records/committed-a/WK-1918.json"));
    assert.ok(relativePaths.includes("wiki/work-records/committed-b/WK-1918.json"));
    assert.ok(!relativePaths.some((filePath) => filePath.includes(".record-tmp-fixture/")));
    assert.ok(!relativePaths.some((filePath) => filePath.includes(".work-record-escalation-fixture/")));
    assert.ok(!relativePaths.some((filePath) => filePath.includes(".graph-sidecar-tmp-fixture/")));

    const canonicalPaths = (await listCanonicalWorkRecordPaths(root)).map((filePath) =>
      path.relative(root, filePath).split(path.sep).join("/")
    );
    assert.deepEqual(canonicalPaths, [
      "wiki/work-records/WK-1913.json",
      "wiki/work-records/WK-1914.json",
      "wiki/work-records/WK-1915.json",
      "wiki/work-records/WK-1919.json",
      "wiki/work-records/WK-1920.json"
    ]);

    const opens = [];
    const inventory = await captureCanonicalWorkRecordInventory({
      dir: root,
      recordStore: {
        async listJsonPaths() {
          return paths;
        },
        async readText(filePath) {
          opens.push(path.relative(root, filePath).split(path.sep).join("/"));
          return (await import("node:fs/promises")).readFile(filePath, "utf8");
        }
      }
    });
    assert.deepEqual(opens, canonicalPaths);
    assert.deepEqual(inventory.map((entry) => entry.relativePath), canonicalPaths);
    assert.ok(inventory.every((entry) => entry.prefix.length <= 2));
    assert.ok(inventory.some((entry) => entry.relativePath.endsWith("WK-1920.json")));
    assert.ok(!opens.some((entry) => entry.includes("evidence/") || entry.includes("nested/")));

    const index = await buildWorkRecordDuplicateClaimsIndex({ dir: root });
    const canonical = await loadWorkRecordByPath({
      dir: root,
      path: "wiki/work-records/WK-1913.json",
      duplicateClaimsIndex: index
    });
    assert.ok(hasDiagnostic(canonical, "duplicate_record_id"));

    for (const id of ["WK-1914", "WK-1915"]) {
      const result = await loadWorkRecordByPath({
        dir: root,
        path: `wiki/work-records/${id}.json`,
        duplicateClaimsIndex: index
      });
      assert.ok(!hasDiagnostic(result, "duplicate_record_id"), id);
    }

    const committedDuplicate = await loadWorkRecordByPath({
      dir: root,
      path: "wiki/work-records/committed-a/WK-1918.json",
      duplicateClaimsIndex: index
    });
    assert.ok(!hasDiagnostic(committedDuplicate, "duplicate_record_id"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
