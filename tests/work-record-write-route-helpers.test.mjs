

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  runWorkspaceWorkRecordCleanupDerivedEvidenceRoute,
  runWorkspaceWorkRecordAdmissionRefreshRoute
} from "../packages/wiki-mcp/src/lib/work-record-write-route-helpers.mjs";

async function withWorkspace(run) {
  const dir = await mkdtemp(path.join(tmpdir(), "wk1056-write-route-"));
  try {
    const workspaceRepos = { repos: new Map([["repo", dir]]), currentAlias: "repo" };
    return await run(workspaceRepos);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function cleanupSelectedUnit(workspaceRepos, unit) {
  const res = await runWorkspaceWorkRecordCleanupDerivedEvidenceRoute({
    workspaceRepos,
    args: { repo: "repo", unit, verbose: true }
  });
  return res.structuredContent.selected_unit;
}

async function refreshSelectedUnit(workspaceRepos, unit) {
  const res = await runWorkspaceWorkRecordAdmissionRefreshRoute({
    workspaceRepos,
    args: { repo: "repo", unit, verbose: true },
    toolName: "workspace_work_record_refresh_admission_metrics"
  });
  return res.structuredContent.selected_unit;
}

test("WK-1056: cleanup route accepts canonical ordinal SLICE-### slice ids", async () => {
  await withWorkspace(async (workspaceRepos) => {
    const selected = await cleanupSelectedUnit(workspaceRepos, "WK-0892#SLICE-001");
    assert.deepEqual(selected, {
      kind: "slice",
      address: "WK-0892#SLICE-001",
      record_id: "WK-0892",
      slice_id: "SLICE-001"
    });
  });
});

test("WK-1056: cleanup route still accepts grandfathered lowercase semantic slice ids", async () => {
  await withWorkspace(async (workspaceRepos) => {
    const selected = await cleanupSelectedUnit(workspaceRepos, "WK-0730#core-edit");
    assert.deepEqual(selected, {
      kind: "slice",
      address: "WK-0730#core-edit",
      record_id: "WK-0730",
      slice_id: "core-edit"
    });
  });
});

test("WK-1056: cleanup route rejects malformed slice ids (null selected_unit)", async () => {
  await withWorkspace(async (workspaceRepos) => {
    for (const malformed of [
      "WK-0892#SLICE-1",
      "WK-0892#SLICE-0001",
      "WK-0892#SLICE-ABC",
      "WK-0892#"
    ]) {
      const selected = await cleanupSelectedUnit(workspaceRepos, malformed);
      assert.equal(selected, null, `expected null selected_unit for ${malformed}`);
    }
  });
});

test("WK-1056: WK record-address validation is unchanged", async () => {
  await withWorkspace(async (workspaceRepos) => {

    assert.deepEqual(await cleanupSelectedUnit(workspaceRepos, "WK-0892"), {
      kind: "work_item",
      address: "WK-0892",
      record_id: "WK-0892",
      slice_id: null
    });

    for (const bad of ["not-an-id", "WK-1", "WK-12345", "WK-0892#a#b"]) {
      assert.equal(
        await cleanupSelectedUnit(workspaceRepos, bad),
        null,
        `expected null selected_unit for ${bad}`
      );
    }
  });
});

test("WK-1358: admission-refresh route projects canonical ordinal SLICE-### selected_unit", async () => {
  await withWorkspace(async (workspaceRepos) => {
    assert.deepEqual(await refreshSelectedUnit(workspaceRepos, "WK-0892#SLICE-001"), {
      kind: "slice",
      address: "WK-0892#SLICE-001",
      record_id: "WK-0892",
      slice_id: "SLICE-001"
    });
  });
});

test("WK-1358: admission-refresh route still accepts grandfathered semantic slice ids", async () => {
  await withWorkspace(async (workspaceRepos) => {
    assert.equal(
      (await refreshSelectedUnit(workspaceRepos, "WK-0730#core-edit")).slice_id,
      "core-edit"
    );
  });
});

test("WK-1358: admission-refresh route rejects malformed slice ids", async () => {
  await withWorkspace(async (workspaceRepos) => {
    assert.equal(await refreshSelectedUnit(workspaceRepos, "WK-0892#SLICE-1"), null);
  });
});
