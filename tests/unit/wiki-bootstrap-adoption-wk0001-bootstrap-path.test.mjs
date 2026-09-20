import test from "node:test";
import assert from "node:assert/strict";

import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  allocateId,
  bootstrapRepo,
  createWikiRecord
} from "../../packages/wiki-core/src/index.mjs";
import { workspaceInitiativeStatus } from "../../packages/wiki-core/src/operations/initiative-status.mjs";
import { assignWorkRecordToInitiativeByUnit } from "../../packages/wiki-core/src/operations/work-record-contract-edit.mjs";
import { renderRecordByKindMarkdown } from "../../packages/wiki-core/src/lib/work-record-kind-renderer.mjs";

test("fresh bootstrap makes IN-0001 immediately usable without consuming WK-0001", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wiki-bootstrap-"));
  try {
    const result = await bootstrapRepo({ dir, repo: "example/repo" });
    const initiativePath = path.join(dir, "wiki/initiatives/IN-0001.json");
    const projectionPath = path.join(dir, "wiki/initiatives/IN-0001.md");
    const initiative = JSON.parse(await readFile(initiativePath, "utf8"));
    assert.equal(
      await readFile(projectionPath, "utf8"),
      renderRecordByKindMarkdown(initiative).markdown
    );
    assert.equal("adoptionWorkRecords" in result, false);
    await assert.rejects(readFile(path.join(dir, "wiki/work-records/WK-0001.json"), "utf8"), { code: "ENOENT" });
    assert.equal(result.allocatorState.work_item, 0);
    assert.equal(result.allocatorState.initiative, 1);

    const status = await workspaceInitiativeStatus({ repoRoot: dir, initiative: "IN-0001" });
    assert.equal(status.scope.initiative, "IN-0001");
    assert.equal(status.next_action.reason_code, "allocation_required");
    assert.equal(status.next_action.suggested_tool, "workspace_create_record");

    await rm(projectionPath);
    await rm(path.join(dir, "wiki", ".id-state.json"));
    const nextInitiative = await allocateId({
      dir,
      type: "initiative",
      repo: "example/repo"
    });
    assert.equal(nextInitiative.id, "IN-0002");

    const created = await createWikiRecord({
      dir,
      type: "issue",
      title: "First user-created work item"
    });
    assert.equal(created.id, "WK-0001");

    const assigned = await assignWorkRecordToInitiativeByUnit({
      dir,
      unit: created.id,
      initiative: "IN-0001"
    });
    assert.equal(assigned.valid, true);
    assert.equal(assigned.written, true);
    const workRecord = JSON.parse(await readFile(path.join(dir, created.relativeFile), "utf8"));
    assert.equal(workRecord.initiative, "IN-0001");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("bootstrap rerun preserves existing canonical IN-0001 and WK-0001 bytes", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wiki-bootstrap-"));
  try {
    await bootstrapRepo({ dir, repo: "example/repo" });
    const initiativePath = path.join(dir, "wiki/initiatives/IN-0001.json");
    const projectionPath = path.join(dir, "wiki/initiatives/IN-0001.md");
    const workRecordPath = path.join(dir, "wiki/work-records/WK-0001.json");
    const initiative = JSON.parse(await readFile(initiativePath, "utf8"));
    initiative.title = "Operator-owned initiative";
    initiative.sections.summary = "Operator-owned canonical state.";
    const initiativeBytes = `${JSON.stringify(initiative, null, 2)}\n`;
    const workRecordBytes = '{"id":"WK-0001","operatorOwned":true}\n';
    await writeFile(initiativePath, initiativeBytes);
    await writeFile(projectionPath, "stale generated projection\n");
    await mkdir(path.dirname(workRecordPath), { recursive: true });
    await writeFile(workRecordPath, workRecordBytes);
    await bootstrapRepo({ dir, repo: "example/repo" });
    assert.deepEqual(JSON.parse(await readFile(initiativePath, "utf8")), initiative);
    assert.equal(
      await readFile(projectionPath, "utf8"),
      renderRecordByKindMarkdown(initiative).markdown
    );
    assert.equal(await readFile(workRecordPath, "utf8"), workRecordBytes);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
