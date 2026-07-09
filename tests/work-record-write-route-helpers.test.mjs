

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  runWorkspaceWorkRecordCleanupDerivedEvidenceRoute,
  runWorkspaceWorkRecordAdmissionRefreshRoute,
  createCompactWorkRecordEditResponse,
  createCompactContractEditResponse
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

const STALE_CURRENT_DIGEST = "sha256:" + "a".repeat(64);
const GUARD_EXPECTED_DIGEST = "sha256:" + "b".repeat(64);
const CANONICAL_RECORD_PATH = "wiki/work-records/WK-0892.json";

function staleWriteResult({ guarded } = { guarded: false }) {
  return {
    valid: false,
    written: false,
    diagnostics: [
      {
        code: "stale_source_digest",
        severity: "error",
        message: "source digest does not match the current on-disk record",
        path: CANONICAL_RECORD_PATH
      }
    ],
    record_id: "WK-0892",
    source_digest: "sha256:" + "c".repeat(64),
    canonical_record_path: CANONICAL_RECORD_PATH,
    current_source_digest: STALE_CURRENT_DIGEST,
    ...(guarded ? { expected_source_digest: GUARD_EXPECTED_DIGEST } : {})
  };
}

function successfulWriteResult() {
  return {
    valid: true,
    written: true,
    no_op: false,
    changed_fields: ["status"],
    record_id: "WK-0892",
    source_digest: "sha256:" + "d".repeat(64),
    canonical_record_path: CANONICAL_RECORD_PATH,
    status: "active",
    diagnostics: []
  };
}

function nonStaleRefusalResult() {
  return {
    valid: true,
    written: false,
    diagnostics: [
      {
        code: "work_record_write_failed",
        severity: "error",
        message: "failed to write canonical work record JSON",
        path: CANONICAL_RECORD_PATH
      }
    ],
    record_id: "WK-0892",
    source_digest: "sha256:" + "d".repeat(64),
    canonical_record_path: CANONICAL_RECORD_PATH
  };
}

function assertStaleRetrySurfaced(response) {
  assert.equal(
    response.current_source_digest,
    STALE_CURRENT_DIGEST,
    "stale refusal must surface the fresh current_source_digest"
  );
  assert.equal(typeof response.next_action, "string");
  assert.ok(response.next_action.length > 0, "stale refusal must carry a retry next_action");

  assert.match(response.next_action, /stale_source_digest/);
  assert.match(response.next_action, /expected_source_digest/);
}

for (const [label, compactor] of [
  ["createCompactWorkRecordEditResponse", createCompactWorkRecordEditResponse],
  ["createCompactContractEditResponse", createCompactContractEditResponse]
]) {
  test(`WK-1411 C3: ${label} surfaces current_source_digest + retry next_action on a BLIND stale refusal`, () => {
    const response = compactor("agent-chassis/agent-chassis", staleWriteResult({ guarded: false }));
    assertStaleRetrySurfaced(response);
  });

  test(`WK-1411 C3: ${label} surfaces current_source_digest + retry next_action on a GUARDED stale refusal`, () => {
    const response = compactor("agent-chassis/agent-chassis", staleWriteResult({ guarded: true }));
    assertStaleRetrySurfaced(response);

    assert.equal(response.expected_source_digest, GUARD_EXPECTED_DIGEST);
  });

  test(`WK-1411 C3: ${label} does not attach a stale digest/next_action on a successful write`, () => {
    const response = compactor("agent-chassis/agent-chassis", successfulWriteResult());
    assert.equal(response.written, true);

    assert.equal(
      Object.prototype.hasOwnProperty.call(response, "current_source_digest"),
      false,
      "successful write must not carry current_source_digest"
    );
    assert.ok(!response.next_action, "successful write must not carry a stale retry next_action");
  });

  test(`WK-1411 C3: ${label} does not attach the stale retry on a non-stale refusal`, () => {
    const response = compactor("agent-chassis/agent-chassis", nonStaleRefusalResult());
    assert.equal(response.written, false);
    assert.equal(
      Object.prototype.hasOwnProperty.call(response, "current_source_digest"),
      false,
      "non-stale refusal must not gain a current_source_digest from the C3 path"
    );
    assert.ok(
      !response.next_action || !/stale_source_digest/.test(response.next_action),
      "non-stale refusal must not carry the stale retry next_action"
    );
  });
}
