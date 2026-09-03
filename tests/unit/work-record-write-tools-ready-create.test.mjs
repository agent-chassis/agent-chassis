import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const removedTool = "workspace_work_record_create_ready";

test("WK-2429 retires the former ready-create owners and registration", async () => {
  const registration = await readFile(path.join(
    repoRoot,
    "packages/wiki-mcp/src/lib/work-record-write-tools.mjs"
  ), "utf8");
  assert.equal(registration.includes(removedTool), false);

  for (const relativePath of [
    "packages/wiki-mcp/src/lib/work-record-ready-create-tool-schema.mjs",
    "packages/wiki-core/src/operations/work-record-ready-create.mjs",
    "packages/wiki-core/src/lib/work-record-ready-create-contract.mjs",
    "packages/wiki-core/src/lib/work-record-ready-create-diagnostics.mjs",
    "packages/wiki-core/src/lib/work-record-ready-create-example.mjs",
    "packages/wiki-core/src/lib/work-record-ready-create-transaction.mjs",
    "tests/fixtures/work-record-ready-create-request.mjs"
  ]) {
    await assert.rejects(access(path.join(repoRoot, relativePath)), { code: "ENOENT" });
  }
});
