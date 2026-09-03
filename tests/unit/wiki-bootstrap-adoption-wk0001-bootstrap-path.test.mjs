import test from "node:test";
import assert from "node:assert/strict";

import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  bootstrapRepo,
  getStaticIn0001AdoptionSeed,
  renderStaticIn0001AdoptionSeedMarkdown
} from "../../packages/wiki-core/src/index.mjs";

test("minimal IN-0001 renderer emits only title and summary", () => {
  const seed = { title: "Seed title", summary: "Seed summary" };
  assert.equal(renderStaticIn0001AdoptionSeedMarkdown(seed), "# Seed title\n\nSeed summary\n");
});

test("fresh bootstrap leaves WK-0001 unmaterialized and allocator-eligible", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wiki-bootstrap-"));
  try {
    const result = await bootstrapRepo({ dir, repo: "example/repo" });
    const seed = getStaticIn0001AdoptionSeed();
    const initiative = await readFile(path.join(dir, "wiki/initiatives/IN-0001.md"), "utf8");
    assert.ok(initiative.endsWith(`${renderStaticIn0001AdoptionSeedMarkdown(seed)}`));
    assert.equal("adoptionWorkRecords" in result, false);
    await assert.rejects(readFile(path.join(dir, "wiki/work-records/WK-0001.json"), "utf8"), { code: "ENOENT" });
    assert.equal(result.allocatorState.work_item, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("bootstrap rerun preserves existing IN-0001 and WK-0001 bytes", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wiki-bootstrap-"));
  try {
    await bootstrapRepo({ dir, repo: "example/repo" });
    const initiativePath = path.join(dir, "wiki/initiatives/IN-0001.md");
    const workRecordPath = path.join(dir, "wiki/work-records/WK-0001.json");
    const initiativeBytes = "---\nid: IN-0001\n---\noperator-owned initiative\n";
    const workRecordBytes = '{"id":"WK-0001","operatorOwned":true}\n';
    await writeFile(initiativePath, initiativeBytes);
    await mkdir(path.dirname(workRecordPath), { recursive: true });
    await writeFile(workRecordPath, workRecordBytes);
    await bootstrapRepo({ dir, repo: "example/repo" });
    assert.equal(await readFile(initiativePath, "utf8"), initiativeBytes);
    assert.equal(await readFile(workRecordPath, "utf8"), workRecordBytes);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
