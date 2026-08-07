import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

import { z } from "zod";

import { jsonContent, errorContent } from "./mcp-response.mjs";
import { shapeWriteResponse } from "./write-response-boundary.mjs";
import {
  createCompactContractEditResponse,
  createCompactWorkRecordEditResponse,
  validateOptionalExpectedSourceDigest
} from "./work-record-write-route-helpers.mjs";
import { registerWorkRecordWriteTools } from "./work-record-write-tools.mjs";
import { WORK_RECORD_CONTRACT_LIST_FIELDS } from "@agent-chassis/wiki-core/src/lib/work-record-contract-edit.mjs";
import { WORK_RECORD_STATUS_VALUES } from "@agent-chassis/wiki-core/src/lib/work-record-schema-constants.mjs";

const FIXTURE_RECORD_PATH = path.resolve("wiki/work-records/WK-1160.json");
const WORKSPACE_REPO = "agent-chassis";
const STALE_DIGEST = `sha256:${"0".repeat(64)}`;
const WORKSPACE_TOOL_CONSTANTS = {
  WORK_RECORD_STATUS_VALUES,
  WORK_RECORD_CONTRACT_LIST_FIELDS,
  WORKSPACE_WORK_RECORD_SET_STATUS_TOOL_NAME: "workspace_work_record_set_status",
  WORKSPACE_WORK_RECORD_SET_TASK_TOOL_NAME: "workspace_work_record_set_task",
  WORKSPACE_WORK_RECORD_REFRESH_ADMISSION_METRICS_TOOL_NAME: "workspace_work_record_refresh_admission_metrics",
  WORKSPACE_WORK_RECORD_REFRESH_TARGET_RESOLUTION_EVIDENCE_TOOL_NAME:
    "workspace_work_record_refresh_target_resolution_evidence",
  WORKSPACE_WORK_RECORD_CLEANUP_DERIVED_EVIDENCE_TOOL_NAME:
    "workspace_work_record_cleanup_derived_evidence"
};

function parseStructuredResponse(result) {
  assert.equal(result.isError, undefined);
  assert.equal(result.content[0].type, "text");
  assert.ok(result.structuredContent);
  return result.structuredContent;
}

async function loadFixtureRecord() {
  return JSON.parse(await readFile(FIXTURE_RECORD_PATH, "utf8"));
}

async function createTempWorkspace({
  mutateRecord = null
} = {}) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wiki-mcp-write-tools-"));
  const workspaceRecordPath = path.join(tempDir, "wiki", "work-records", "WK-1160.json");
  try {
    const record = await loadFixtureRecord();
    if (typeof mutateRecord === "function") {
      mutateRecord(record);
    }
    await mkdir(path.dirname(workspaceRecordPath), { recursive: true });
    await writeFile(workspaceRecordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    return { tempDir, workspaceRecordPath, record };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

function createToolRegistry(workspaceDir) {
  const tools = new Map();
  registerWorkRecordWriteTools({
    registerTool: (name, config, handler) => {
      tools.set(name, { config, handler });
    },
    workspaceRepos: [{ repo: WORKSPACE_REPO, dir: workspaceDir }],
    z,
    jsonContent,
    errorContent,
    resolveWorkspaceRepo: (workspaceRepos, repo) => {
      if (!repo) {
        return workspaceRepos[0];
      }
      const workspace = workspaceRepos.find((entry) => entry.repo === repo);
      if (!workspace) {
        throw new Error(`Unknown workspace repo: ${repo}`);
      }
      return workspace;
    },
    shapeWriteResponse,
    createCompactWorkRecordEditResponse,
    createCompactContractEditResponse,
    validateOptionalExpectedSourceDigest,
    runWorkspaceWorkRecordAdmissionRefreshRoute: async () => {
      throw new Error("unexpected refresh route invocation");
    },
    runWorkspaceWorkRecordCleanupDerivedEvidenceRoute: async () => {
      throw new Error("unexpected cleanup route invocation");
    },
    constants: WORKSPACE_TOOL_CONSTANTS
  });
  return tools;
}

test("workspace_work_record_set_status still works when expected_source_digest is omitted", async () => {

  const { tempDir, record } = await createTempWorkspace();
  try {
    const tools = createToolRegistry(tempDir);
    const response = await tools.get("workspace_work_record_set_status").handler({
      repo: WORKSPACE_REPO,
      unit: "WK-1160",
      status: record.status
    });

    const structured = parseStructuredResponse(response);
    assert.equal(structured.status, record.status);
    assert.equal(structured.no_op, true);
    assert.equal(structured.written, false);
    assert.equal(structured.valid, true);
    assert.equal(structured.expected_source_digest, undefined);
    assert.equal(structured.current_source_digest, undefined);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("workspace_work_record_set_status refuses a stale expected_source_digest", async () => {
  const { tempDir } = await createTempWorkspace();
  try {
    const tools = createToolRegistry(tempDir);
    const response = await tools.get("workspace_work_record_set_status").handler({
      repo: WORKSPACE_REPO,
      unit: "WK-1160",
      status: WORK_RECORD_STATUS_VALUES.includes("review")
        ? "review"
        : WORK_RECORD_STATUS_VALUES.find((value) => value !== "todo") ?? "active",
      expected_source_digest: STALE_DIGEST
    });

    const structured = parseStructuredResponse(response);
    assert.equal(structured.valid, false);
    assert.equal(structured.written, false);
    assert.equal(structured.no_op, false);
    assert.equal(structured.expected_source_digest, STALE_DIGEST);
    assert.equal(typeof structured.current_source_digest, "string");
    assert.notEqual(structured.current_source_digest, STALE_DIGEST);
    assert.equal(structured.diagnostics[0].code, "stale_source_digest");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("workspace_work_record_set_task still works when expected_source_digest is omitted", async () => {
  const { tempDir } = await createTempWorkspace({
    mutateRecord: (record) => {
      assert.ok(Array.isArray(record.sections.tasks));
      assert.ok(record.sections.tasks.length > 0);
      record.sections.tasks[0].status = "done";
    }
  });
  try {
    const tools = createToolRegistry(tempDir);
    const fixtureRecord = await loadFixtureRecord();
    const taskText = fixtureRecord.sections.tasks[0].text;
    const response = await tools.get("workspace_work_record_set_task").handler({
      repo: WORKSPACE_REPO,
      unit: "WK-1160",
      text: taskText
    });

    const structured = parseStructuredResponse(response);
    assert.equal(structured.no_op, true);
    assert.equal(structured.written, false);
    assert.equal(structured.valid, true);
    assert.equal(structured.status, "done");
    assert.equal(structured.expected_source_digest, undefined);
    assert.equal(structured.current_source_digest, undefined);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("workspace_work_record_set_status projects the core forge completion refusal without mutation", async () => {
  const forge = (record) => {
    record.status = "review";
    record.completion_policy = "forge_confirmed_merge";
  };
  const sliceUnit = `WK-1160#${(await loadFixtureRecord()).slices[0].id}`;

  for (const [name, mutateRecord, unit, refusal] of [
    ["forge parent done refused", forge, "WK-1160", "forge_confirmed_completion_required"],
    ["non-forge parent done unchanged", (record) => { record.status = "review"; }, "WK-1160", null],
    ["forge slice done unchanged", (record) => { forge(record); record.slices[0].status = "review"; }, sliceUnit, null]
  ]) {
    const { tempDir, workspaceRecordPath } = await createTempWorkspace({ mutateRecord });
    try {
      const before = await readFile(workspaceRecordPath, "utf8");
      const structured = parseStructuredResponse(
        await createToolRegistry(tempDir).get("workspace_work_record_set_status").handler({
          repo: WORKSPACE_REPO,
          unit,
          status: "done"
        })
      );
      assert.equal(structured.valid, !refusal, name);
      assert.equal(structured.written, !refusal, name);
      assert.equal(structured.no_op, false, name);
      if (refusal) {
        assert.equal(structured.diagnostics[0].code, refusal, name);
        assert.equal(await readFile(workspaceRecordPath, "utf8"), before, name);
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
});

test("workspace_work_record_set_task refuses a stale expected_source_digest", async () => {
  const fixtureRecord = await loadFixtureRecord();
  const taskText = fixtureRecord.sections.tasks[0].text;
  const { tempDir } = await createTempWorkspace();
  try {
    const tools = createToolRegistry(tempDir);
    const response = await tools.get("workspace_work_record_set_task").handler({
      repo: WORKSPACE_REPO,
      unit: "WK-1160",
      text: taskText,
      expected_source_digest: STALE_DIGEST
    });

    const structured = parseStructuredResponse(response);
    assert.equal(structured.valid, false);
    assert.equal(structured.written, false);
    assert.equal(structured.no_op, false);
    assert.equal(structured.expected_source_digest, STALE_DIGEST);
    assert.equal(typeof structured.current_source_digest, "string");
    assert.notEqual(structured.current_source_digest, STALE_DIGEST);
    assert.equal(structured.diagnostics[0].code, "stale_source_digest");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
